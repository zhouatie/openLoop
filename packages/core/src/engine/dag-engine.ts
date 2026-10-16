import { EventEmitter } from 'events';
import { Store } from '../store';
import { Task, WorkflowDefinition, WorkflowNode, LogEntry, KanbanColumn } from '../types';
import { ExecutorRegistry, ExecutionContext } from '../executors';

export class DagEngine extends EventEmitter {
  private store: Store;
  private registry: ExecutorRegistry;
  private runningTasks: Set<string> = new Set();

  constructor(store: Store, registry?: ExecutorRegistry) {
    super();
    this.store = store;
    this.registry = registry || new ExecutorRegistry();
  }

  public getRegistry(): ExecutorRegistry {
    return this.registry;
  }

  /**
   * 启动任务的工作流执行
   */
  async runTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${task.workflowId} not found`);
    }

    if (this.runningTasks.has(taskId)) {
      return;
    }

    this.runningTasks.add(taskId);
    task.status = 'running';
    task.kanbanColumn = 'in_progress';
    this.store.saveTask(task);
    this.emit('task:update', task);

    this.log(task.id, 'SYSTEM', 'system', `========== 启动工作流 [${workflow.name}] ==========`);

    // 确定起始节点：没有入边的节点
    const incomingEdgesCount = new Map<string, number>();
    for (const node of workflow.nodes) {
      incomingEdgesCount.set(node.id, 0);
    }
    for (const edge of workflow.edges) {
      const current = incomingEdgesCount.get(edge.target) || 0;
      incomingEdgesCount.set(edge.target, current + 1);
    }

    const startNodes = workflow.nodes.filter(
      (n) => (incomingEdgesCount.get(n.id) || 0) === 0
    );

    if (startNodes.length === 0 && workflow.nodes.length > 0) {
      // 存在环或异常，默认首个节点
      startNodes.push(workflow.nodes[0]);
    }

    try {
      // 并发或依次调度起始节点
      for (const startNode of startNodes) {
        await this.scheduleNode(task, workflow, startNode);
      }
    } catch (err: any) {
      this.log(task.id, 'SYSTEM', 'stderr', `执行异常: ${err.message}`);
      task.status = 'failed';
      this.store.saveTask(task);
      this.emit('task:update', task);
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  /**
   * 调度单个节点的执行
   */
  private async scheduleNode(
    task: Task,
    workflow: WorkflowDefinition,
    node: WorkflowNode
  ): Promise<void> {
    task.currentNodeId = node.id;

    // 动态调整看板泳道以反映当前流程阶段
    if (node.type === 'agent') {
      task.kanbanColumn = 'agent_executing';
    } else if (node.type === 'qa-approval' || node.type === 'midscene') {
      task.kanbanColumn = 'qa_review';
    } else {
      task.kanbanColumn = 'in_progress';
    }

    // 初始化节点运行状态
    task.nodeRuns[node.id] = {
      nodeId: node.id,
      status: 'running',
      startedAt: Date.now(),
    };
    this.store.saveTask(task);
    this.emit('task:update', task);
    this.emit('node:status', { taskId: task.id, nodeId: node.id, status: 'running' });

    this.log(task.id, node.id, 'system', `>>> 开始执行节点 [${node.name}] (${node.type})`);

    const executor = this.registry.get(node.type);
    const ctx: ExecutionContext = {
      task,
      node,
      variables: {
        ...workflow.variables,
        ...task.context,
        inputs: task.context,
      },
      emitLog: (stream, message) => {
        this.log(task.id, node.id, stream, message);
      },
    };

    const result = await executor.execute(ctx);
    const run = task.nodeRuns[node.id];
    run.status = result.status;
    run.finishedAt = Date.now();
    run.output = result.output;
    run.error = result.error;
    run.exitCode = result.exitCode;
    run.artifacts = result.artifacts;

    // 融合节点输出到任务全局上下文供下游插值使用
    if (result.output) {
      task.context[node.id] = result.output;
    }

    this.store.saveTask(task);
    this.emit('task:update', task);
    this.emit('node:status', { taskId: task.id, nodeId: node.id, status: result.status });

    if (result.status === 'failed') {
      this.log(task.id, node.id, 'stderr', `节点 [${node.name}] 执行失败，终止工作流`);
      task.status = 'failed';
      this.store.saveTask(task);
      this.emit('task:update', task);
      return;
    }

    if (result.status === 'waiting_approval') {
      this.log(task.id, node.id, 'system', `节点 [${node.name}] 挂起，等待人工审核流转`);
      task.status = 'waiting_approval';
      task.kanbanColumn = 'qa_review';
      this.store.saveTask(task);
      this.emit('task:update', task);
      return;
    }

    // 节点执行成功，调度下游节点
    this.log(task.id, node.id, 'system', `<<< 节点 [${node.name}] 执行完成`);
    await this.triggerNextNodes(task, workflow, node.id);
  }

  /**
   * 触发下游节点
   */
  private async triggerNextNodes(
    task: Task,
    workflow: WorkflowDefinition,
    completedNodeId: string
  ): Promise<void> {
    const outgoingEdges = workflow.edges.filter((e) => e.source === completedNodeId);

    if (outgoingEdges.length === 0) {
      // 检查是否所有节点都已经完成
      const allCompleted = workflow.nodes.every((n) => {
        const nr = task.nodeRuns[n.id];
        return nr && nr.status === 'success';
      });

      if (allCompleted) {
        task.status = 'completed';
        task.kanbanColumn = 'done';
        this.store.saveTask(task);
        this.emit('task:update', task);
        this.log(task.id, 'SYSTEM', 'system', `========== 工作流全部节点已成功执行完成！ ==========`);
      }
      return;
    }

    for (const edge of outgoingEdges) {
      const targetNode = workflow.nodes.find((n) => n.id === edge.target);
      if (!targetNode) continue;

      // 检查 targetNode 的所有入边节点是否都已执行成功
      const upstreamEdges = workflow.edges.filter((e) => e.target === targetNode.id);
      const allUpstreamSuccess = upstreamEdges.every((e) => {
        const nr = task.nodeRuns[e.source];
        return nr && nr.status === 'success';
      });

      if (allUpstreamSuccess) {
        await this.scheduleNode(task, workflow, targetNode);
      }
    }
  }

  /**
   * 人工/QA 审批流转唤醒
   */
  async resumeTask(taskId: string, approved: boolean, feedback?: string): Promise<Task> {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${task.workflowId} not found`);
    }

    const currentNodeId = task.currentNodeId;
    if (!currentNodeId || task.status !== 'waiting_approval') {
      throw new Error(`Task ${taskId} is not in waiting_approval state`);
    }

    const node = workflow.nodes.find((n) => n.id === currentNodeId);
    const nodeRun = task.nodeRuns[currentNodeId];

    if (!approved) {
      this.log(task.id, currentNodeId, 'stderr', `[QA 审核驳回]: ${feedback || '未通过验收指标'}`);
      if (nodeRun) {
        nodeRun.status = 'failed';
        nodeRun.finishedAt = Date.now();
      }
      task.status = 'failed';
      this.store.saveTask(task);
      this.emit('task:update', task);
      return task;
    }

    this.log(task.id, currentNodeId, 'system', `[QA 审核通过]: ${feedback || '验证指标符合要求，继续流转'}`);
    if (nodeRun) {
      nodeRun.status = 'success';
      nodeRun.finishedAt = Date.now();
    }
    task.status = 'running';
    this.store.saveTask(task);
    this.emit('task:update', task);

    // 继续调度下游
    await this.triggerNextNodes(task, workflow, currentNodeId);
    return task;
  }

  private log(taskId: string, nodeId: string, stream: 'stdout' | 'stderr' | 'system', message: string) {
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      taskId,
      nodeId,
      timestamp: Date.now(),
      stream,
      message,
    };
    this.store.addLog(entry);
    this.emit('log:new', entry);
  }
}
