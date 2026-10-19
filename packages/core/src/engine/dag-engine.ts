import { EventEmitter } from 'events';
import path from 'path';
import { ChildProcess } from 'child_process';
import { Store } from '../store';
import { Task, WorkflowDefinition, WorkflowNode, WorkflowEdge, LogEntry, KanbanColumn, TaskSessionState } from '../types';
import { ExecutorRegistry, ExecutionContext } from '../executors';
import { createLogger } from '../logger';
import { PiRpcSessionManager } from '../agent/pi-rpc-session';
import { WorktreeManager } from '../worktree/worktree-manager';

const dagLogger = createLogger('Engine:DAG');

/**
 * 安全表达式求值函数
 * 支持评估例如: output === 'A', output.status === 'pass', exitCode === 0, score > 80 等表达式
 */
export function evaluateCondition(condition: string, evalContext: Record<string, any>): boolean {
  if (!condition || !condition.trim()) return true;
  const trimmed = condition.trim();

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  try {
    const keys = [
      'output',
      'exitCode',
      'status',
      'result',
      'context',
      'task',
      'variables',
      'window',
      'global',
      'process',
      'require',
      'module',
      '__dirname',
      '__filename',
    ];
    const vals = [
      evalContext.output,
      evalContext.exitCode,
      evalContext.status,
      evalContext.result,
      evalContext.context || {},
      evalContext.task || {},
      evalContext.variables || {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ];

    const fn = new Function(...keys, `"use strict"; return Boolean(${trimmed});`);
    return Boolean(fn(...vals));
  } catch (err: any) {
    dagLogger.warn(`[ConditionEval] 条件表达式求值失败: "${condition}", 错误: ${err.message}`);
    return false;
  }
}

export class DagEngine extends EventEmitter {
  private store: Store;
  private registry: ExecutorRegistry;
  private runningTasks: Set<string> = new Set();
  private abortControllers: Map<string, AbortController> = new Map();
  private activeProcesses: Map<string, Set<ChildProcess>> = new Map();

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
      dagLogger.error(`启动任务失败: 任务 ${taskId} 未找到`, undefined, { taskId });
      throw new Error(`Task ${taskId} not found`);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      dagLogger.error(`启动任务失败: 关联工作流 ${task.workflowId} 未找到`, undefined, { taskId });
      throw new Error(`Workflow ${task.workflowId} not found`);
    }

    if (this.runningTasks.has(taskId)) {
      if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'completed') {
        dagLogger.info(`任务 ${taskId} 处于终态 (${task.status})，清理残留运行锁并重新执行`, undefined, { taskId });
        this.runningTasks.delete(taskId);
        this.abortControllers.delete(taskId);
        this.activeProcesses.delete(taskId);
      } else {
        dagLogger.warn(`任务 ${taskId} 已经在运行中，忽略重复启动请求`, undefined, { taskId });
        return;
      }
    }

    this.runningTasks.add(taskId);
    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);
    this.activeProcesses.set(taskId, new Set());

    task.status = 'running';
    task.nodeRuns = {}; // 重新运行时清空历史节点状态，确保整条流水线干净重跑
    task.kanbanColumn = 'in_progress';
    this.store.saveTask(task);
    this.emit('task:update', task);

    dagLogger.info(
      `启动工作流 [${workflow.name}] 执行, Task: "${task.title}" (节点数: ${workflow.nodes.length}, 边数: ${workflow.edges.length})`,
      undefined,
      { taskId: task.id }
    );
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
      dagLogger.warn(
        `工作流未检测到无入边的起始节点（可能存在回环），回退为首个定义节点 [${workflow.nodes[0].name}]`,
        undefined,
        { taskId: task.id }
      );
      startNodes.push(workflow.nodes[0]);
    }

    dagLogger.info(
      `工作流起点计算完成，入口节点: [${startNodes.map((n) => n.name).join(', ')}]`,
      undefined,
      { taskId: task.id }
    );

    try {
      // 并发或依次调度起始节点
      for (const startNode of startNodes) {
        await this.scheduleNode(task, workflow, startNode);
      }
    } catch (err: any) {
      dagLogger.error(`工作流运行异常终止: ${err.message}`, err, { taskId: task.id });
      this.log(task.id, 'SYSTEM', 'stderr', `执行异常: ${err.message}`);
      task.status = 'failed';
      task.kanbanColumn = 'backlog'; // 异常终止，退回待处理泳道
      this.store.saveTask(task);
      this.emit('task:update', task);
    } finally {
      this.runningTasks.delete(taskId);
      this.abortControllers.delete(taskId);
      this.activeProcesses.delete(taskId);
      dagLogger.debug(`任务 ${task.id} 移出 active 运行集合`, undefined, { taskId: task.id });
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

    // 动态调整看板泳道以反映当前流程阶段：人工审批节点进入待验收，其他运行中节点统一处于执行中泳道
    if (node.type === 'qa-approval') {
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

    const settings = this.store.getSettings();
    if (node.type === 'agent' && (settings.agentProvider === 'pi' || !settings.agentProvider)) {
      if (!task.context) task.context = {};
      if (!task.context.piSessionId) {
        task.context.piSessionId = `session_${task.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      }
    }

    this.store.saveTask(task);
    this.emit('task:update', task);
    this.emit('node:status', { taskId: task.id, nodeId: node.id, status: 'running' });

    dagLogger.info(
      `调度节点 [${node.name}] (${node.type})，泳道流转为: ${task.kanbanColumn}`,
      { nodeConfig: node.config },
      { taskId: task.id, nodeId: node.id }
    );
    this.log(task.id, node.id, 'system', `>>> 开始执行节点 [${node.name}] (${node.type})`);

    const executor = this.registry.get(node.type);
    const abortController = this.abortControllers.get(task.id);
    const ctx: ExecutionContext = {
      task,
      node,
      settings,
      abortSignal: abortController?.signal,
      registerChildProcess: (child: ChildProcess) => {
        const procSet = this.activeProcesses.get(task.id);
        if (procSet) {
          procSet.add(child);
          child.on('exit', () => procSet.delete(child));
        }
      },
      variables: {
        task: {
          id: task.id,
          title: task.title,
          description: task.description || '',
          workflowId: task.workflowId,
          workspace: task.workspace || '',
        },
        ...workflow.variables,
        ...task.context,
        inputs: task.context,
      },
      emitLog: (stream, message) => {
        this.log(task.id, node.id, stream, message);
      },
      onSessionUpdate: (state: TaskSessionState) => {
        if (!task.context) task.context = {};
        task.context.chatMessages = state.messages;
        this.store.saveTask(task);
        this.emit('agent:chat_update', state);
      },
      store: this.store,
    };

    let result;
    try {
      result = await executor.execute(ctx);
    } catch (err: any) {
      dagLogger.error(`节点执行器执行抛出未捕获异常: ${err.message}`, err, {
        taskId: task.id,
        nodeId: node.id,
      });
      result = {
        status: 'failed' as const,
        exitCode: 1,
        error: err.message,
      };
    }

    const run = task.nodeRuns[node.id];
    run.status = result.status;
    run.finishedAt = Date.now();
    run.output = result.output;
    run.error = result.error;
    run.exitCode = result.exitCode;
    run.artifacts = result.artifacts;

    const duration = run.finishedAt - (run.startedAt || run.finishedAt);

    // 如果任务已经被手动终止 (cancelled)，保持已终止状态，直接退出流转
    const latestTask = this.store.getTask(task.id);
    if (latestTask && latestTask.status === 'cancelled') {
      dagLogger.info(`任务 ${task.id} 状态已为 cancelled，退出调度流转`, undefined, {
        taskId: task.id,
        nodeId: node.id,
      });
      return;
    }

    // 融合节点输出到任务全局上下文供下游插值使用
    if (result.output) {
      task.context[node.id] = result.output;
    }

    this.store.saveTask(task);
    this.emit('task:update', task);
    this.emit('node:status', { taskId: task.id, nodeId: node.id, status: result.status });

    if (result.status === 'failed') {
      dagLogger.error(
        `节点 [${node.name}] 执行失败 (耗时: ${duration}ms, 退出码: ${result.exitCode ?? '未知'}, 错误: ${result.error || '无详细错误'})`,
        undefined,
        { taskId: task.id, nodeId: node.id }
      );
      this.log(task.id, node.id, 'stderr', `节点 [${node.name}] 执行失败，终止工作流`);
      this.runningTasks.delete(task.id);
      this.abortControllers.delete(task.id);
      this.activeProcesses.delete(task.id);
      task.status = 'failed';
      task.kanbanColumn = 'backlog'; // 执行失败，退回待处理泳道，保持活跃泳道语义纯净
      this.store.saveTask(task);
      this.emit('task:update', task);
      return;
    }

    if (result.status === 'waiting_approval') {
      dagLogger.warn(
        `节点 [${node.name}] 触发挂起审核机制 (waiting_approval)，等待人工或验收介入`,
        undefined,
        { taskId: task.id, nodeId: node.id }
      );
      this.log(task.id, node.id, 'system', `节点 [${node.name}] 挂起，等待人工审核流转`);
      task.status = 'waiting_approval';
      task.kanbanColumn = 'qa_review';
      this.store.saveTask(task);
      this.emit('task:update', task);
      return;
    }

    // 节点执行成功，调度下游节点
    dagLogger.info(
      `节点 [${node.name}] 执行完成并标记为 success (耗时: ${duration}ms, 产物数: ${result.artifacts?.length || 0})`,
      undefined,
      { taskId: task.id, nodeId: node.id }
    );
    this.log(task.id, node.id, 'system', `<<< 节点 [${node.name}] 执行完成`);
    await this.triggerNextNodes(task, workflow, node.id);
  }

  /**
   * 评估出边是否满足触发条件
   */
  private isEdgeConditionMet(
    edge: WorkflowEdge,
    task: Task,
    workflow: WorkflowDefinition
  ): boolean {
    if (!edge.condition || !edge.condition.trim()) {
      return true;
    }
    const sourceRun = task.nodeRuns[edge.source];
    const evalContext = {
      output: sourceRun?.output,
      exitCode: sourceRun?.exitCode,
      status: sourceRun?.status,
      result: {
        output: sourceRun?.output,
        exitCode: sourceRun?.exitCode,
        status: sourceRun?.status,
        artifacts: sourceRun?.artifacts,
      },
      context: task.context || {},
      task: {
        id: task.id,
        title: task.title,
        description: task.description || '',
        workspace: task.workspace || '',
      },
      variables: workflow.variables || {},
    };

    const passed = evaluateCondition(edge.condition, evalContext);
    dagLogger.info(
      `[DAG:EdgeCondition] 评估出边 [${edge.source} -> ${edge.target}] 条件 "${edge.condition}": ${passed ? '满足' : '未满足'}`,
      {
        edgeId: edge.id,
        condition: edge.condition,
        passed,
        sourceStatus: sourceRun?.status,
        output: sourceRun?.output,
      },
      { taskId: task.id, nodeId: edge.source }
    );
    return passed;
  }

  /**
   * 级联跳过未命中的分支节点及其下游
   */
  private async cascadeSkipNode(
    task: Task,
    workflow: WorkflowDefinition,
    nodeId: string
  ): Promise<void> {
    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (task.nodeRuns[nodeId]?.status) {
      return;
    }

    const now = Date.now();
    task.nodeRuns[nodeId] = {
      nodeId,
      status: 'skipped',
      startedAt: now,
      finishedAt: now,
    };
    this.store.saveTask(task);
    this.emit('task:update', task);
    this.emit('node:status', { taskId: task.id, nodeId, status: 'skipped' });

    dagLogger.info(
      `[DAG:Skip] 分支条件未命中，系统自动跳过节点 [${node.name}] (${nodeId})`,
      undefined,
      { taskId: task.id, nodeId }
    );
    this.log(task.id, nodeId, 'system', `[条件分支] 分支条件未满足，系统自动跳过节点 [${node.name}]`);

    // 递归检查下游出边
    const outgoingEdges = workflow.edges.filter((e) => e.source === nodeId);
    for (const edge of outgoingEdges) {
      const targetNode = workflow.nodes.find((n) => n.id === edge.target);
      if (!targetNode || task.nodeRuns[targetNode.id]?.status) continue;

      const upstreamEdges = workflow.edges.filter((e) => e.target === targetNode.id);
      const allUpstreamResolved = upstreamEdges.every((e) => {
        const nr = task.nodeRuns[e.source];
        return nr && (nr.status === 'success' || nr.status === 'skipped');
      });

      if (allUpstreamResolved) {
        const anyActiveSuccess = upstreamEdges.some((e) => {
          const nr = task.nodeRuns[e.source];
          if (!nr || (nr.status !== 'success' && nr.status !== 'skipped')) return false;
          // 若上游节点状态为 skipped（手动跳过）：只要出边是无条件边，即视为流水线向下传递推进
          if (nr.status === 'skipped') {
            return !e.condition || !e.condition.trim();
          }
          return this.isEdgeConditionMet(e, task, workflow);
        });

        if (anyActiveSuccess) {
          dagLogger.info(
            `[DAG:Join] 汇聚节点 [${targetNode.name}] 检测到有效流转前置，启动调度`,
            undefined,
            { taskId: task.id, nodeId: targetNode.id }
          );
          await this.scheduleNode(task, workflow, targetNode);
        } else {
          await this.cascadeSkipNode(task, workflow, targetNode.id);
        }
      }
    }
  }

  /**
   * 检查工作流是否所有节点均已达到终态 (全部完成或按分支跳过)
   */
  private checkWorkflowCompletion(task: Task, workflow: WorkflowDefinition): boolean {
    const runs = Object.values(task.nodeRuns || {});
    const hasRunning = runs.some((r) => r.status === 'running');
    const hasWaiting = runs.some((r) => r.status === 'waiting_approval');

    // 若仍有并发节点正在执行或等待人工审核，流水线未完成
    if (hasRunning || hasWaiting) {
      return false;
    }

    // 容错处理：若流水线在执行过程中被动态修改模板增加了节点，或存在未激活的孤立分支，
    // 检查所有未曾执行过的节点。若当前已无活跃节点能到达它们，自动标记为 skipped
    for (const node of workflow.nodes) {
      if (!task.nodeRuns[node.id]) {
        task.nodeRuns[node.id] = {
          nodeId: node.id,
          status: 'skipped',
          output: { reason: '未激活分支或模板变更自动跳过' },
        };
      }
    }

    const allResolved = workflow.nodes.every((n) => {
      const nr = task.nodeRuns[n.id];
      return nr && (nr.status === 'success' || nr.status === 'skipped');
    });

    if (allResolved) {
      const allRuns = Object.values(task.nodeRuns || {});
      const hasFailed = allRuns.some((r) => r.status === 'failed');
      if (hasFailed) {
        this.runningTasks.delete(task.id);
        this.abortControllers.delete(task.id);
        this.activeProcesses.delete(task.id);
        task.status = 'failed';
        task.kanbanColumn = 'backlog';
      } else {
        task.status = 'completed';
        task.kanbanColumn = 'done';
        task.currentNodeId = undefined;
        this.runningTasks.delete(task.id);
        this.abortControllers.delete(task.id);
        this.activeProcesses.delete(task.id);
        dagLogger.info(
          `工作流 [${workflow.name}] 全部节点执行或按分支跳过完毕，任务标记为 COMPLETED`,
          undefined,
          { taskId: task.id }
        );
        this.log(task.id, 'SYSTEM', 'system', `========== 工作流全部节点已成功执行或按条件跳过！ ==========`);
      }
      this.store.saveTask(task);
      this.emit('task:update', task);
      return true;
    }
    return false;
  }

  /**
   * 触发下游节点 (支持多分支条件评估、未激活分支级联跳过与多路汇聚)
   */
  private async triggerNextNodes(
    task: Task,
    workflow: WorkflowDefinition,
    completedNodeId: string
  ): Promise<void> {
    const outgoingEdges = workflow.edges.filter((e) => e.source === completedNodeId);
    dagLogger.debug(
      `评估节点 [${completedNodeId}] 的下游流转，检测到出边数: ${outgoingEdges.length}`,
      undefined,
      { taskId: task.id, nodeId: completedNodeId }
    );

    if (outgoingEdges.length === 0) {
      this.checkWorkflowCompletion(task, workflow);
      return;
    }

    // 记录各条出边的条件评估结果
    const edgeResults = new Map<string, boolean>();
    for (const edge of outgoingEdges) {
      const passed = this.isEdgeConditionMet(edge, task, workflow);
      edgeResults.set(edge.id, passed);
    }

    for (const edge of outgoingEdges) {
      const targetNode = workflow.nodes.find((n) => n.id === edge.target);
      if (!targetNode) continue;

      const upstreamEdges = workflow.edges.filter((e) => e.target === targetNode.id);

      // 检查 targetNode 的所有入边 source 是否都已达到终态 (success 或 skipped)
      const allUpstreamResolved = upstreamEdges.every((e) => {
        const nr = task.nodeRuns[e.source];
        return nr && (nr.status === 'success' || nr.status === 'skipped');
      });

      if (!allUpstreamResolved) {
        dagLogger.debug(
          `下游节点 [${targetNode.name}] 仍有前置依赖节点未完成，等待汇聚调度`,
          undefined,
          { taskId: task.id, nodeId: targetNode.id }
        );
        continue;
      }

      // 所有上游均已达到终态，检查是否有任何一条入边满足激活条件
      const anyActiveSuccess = upstreamEdges.some((e) => {
        const nr = task.nodeRuns[e.source];
        if (!nr || (nr.status !== 'success' && nr.status !== 'skipped')) return false;

        // 若上游节点状态为 skipped（如用户手动跳过测试工序）：
        // 只要出边是无条件边，即视为流水线向下传递推进
        if (nr.status === 'skipped') {
          return !e.condition || !e.condition.trim();
        }

        if (e.source === completedNodeId) {
          return edgeResults.get(e.id) ?? true;
        }
        return this.isEdgeConditionMet(e, task, workflow);
      });

      if (anyActiveSuccess) {
        const currentTargetStatus = task.nodeRuns[targetNode.id]?.status;
        if (!currentTargetStatus || currentTargetStatus === 'failed' || currentTargetStatus === 'pending') {
          dagLogger.info(
            `下游节点 [${targetNode.name}] 条件满足且前置依赖已就绪，启动调度`,
            undefined,
            { taskId: task.id, nodeId: targetNode.id }
          );
          await this.scheduleNode(task, workflow, targetNode);
        }
      } else {
        if (!task.nodeRuns[targetNode.id]?.status) {
          dagLogger.info(
            `下游节点 [${targetNode.name}] 前置所有入边条件均未满足，执行级联跳过`,
            undefined,
            { taskId: task.id, nodeId: targetNode.id }
          );
          await this.cascadeSkipNode(task, workflow, targetNode.id);
        }
      }
    }

    this.checkWorkflowCompletion(task, workflow);
  }

  /**
   * 人工/QA 审批流转唤醒
   */
  async resumeTask(taskId: string, approved: boolean, feedback?: string): Promise<Task> {
    dagLogger.info(
      `收到任务唤醒指令，Approved: ${approved}，反馈意见: "${feedback || ''}"`,
      undefined,
      { taskId }
    );
    const task = this.store.getTask(taskId);
    if (!task) {
      dagLogger.error(`唤醒任务失败: Task ${taskId} 未找到`, undefined, { taskId });
      throw new Error(`Task ${taskId} not found`);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      dagLogger.error(`唤醒任务失败: Workflow ${task.workflowId} 未找到`, undefined, { taskId });
      throw new Error(`Workflow ${task.workflowId} not found`);
    }

    const currentNodeId = task.currentNodeId;
    if (!currentNodeId || task.status !== 'waiting_approval') {
      dagLogger.warn(
        `唤醒任务失败: 任务当前状态为 ${task.status}，不是 waiting_approval`,
        undefined,
        { taskId, nodeId: currentNodeId }
      );
      throw new Error(`Task ${taskId} is not in waiting_approval state`);
    }

    const node = workflow.nodes.find((n) => n.id === currentNodeId);
    const nodeRun = task.nodeRuns[currentNodeId];

    if (!approved) {
      dagLogger.warn(
        `节点 [${node?.name || currentNodeId}] QA 审批驳回: ${feedback || '未通过验收指标'}`,
        undefined,
        { taskId, nodeId: currentNodeId }
      );
      this.log(task.id, currentNodeId, 'stderr', `[QA 审核驳回]: ${feedback || '未通过验收指标'}`);
      
      // 如果存在 Worktree 靶机，安全停止临时端口服务释放资源
      if (task.context?.worktree?.worktreeDir) {
        try {
          const repoRoot = path.dirname(path.dirname(task.context.worktree.worktreeDir));
          WorktreeManager.getInstance().rejectAndCleanup(repoRoot, task.id, true, (msg) => {
            this.log(task.id, currentNodeId, 'system', msg);
          });
        } catch (e: any) {
          dagLogger.warn(`[Worktree:Cleanup Warning] ${e.message}`);
        }
      }

      if (nodeRun) {
        nodeRun.status = 'failed';
        nodeRun.finishedAt = Date.now();
      }
      this.runningTasks.delete(taskId);
      this.abortControllers.delete(taskId);
      this.activeProcesses.delete(taskId);
      task.status = 'failed';
      task.kanbanColumn = 'backlog'; // QA 驳回，打回待处理队列
      this.store.saveTask(task);
      this.emit('task:update', task);
      return task;
    }

    dagLogger.info(
      `节点 [${node?.name || currentNodeId}] QA 审批通过，继续后续节点流转`,
      undefined,
      { taskId, nodeId: currentNodeId }
    );
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

  /**
   * 手动跳过指定节点并继续执行下游
   */
  async skipNode(taskId: string, targetNodeId?: string): Promise<Task> {
    const task = this.store.getTask(taskId);
    if (!task) {
      dagLogger.error(`跳过节点失败: Task ${taskId} 未找到`, undefined, { taskId });
      throw new Error(`Task ${taskId} not found`);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      dagLogger.error(`跳过节点失败: Workflow ${task.workflowId} 未找到`, undefined, { taskId });
      throw new Error(`Workflow ${task.workflowId} not found`);
    }

    let nodeId = targetNodeId;
    if (!nodeId) {
      if (task.currentNodeId) {
        nodeId = task.currentNodeId;
      } else {
        const runs = Object.values(task.nodeRuns || {});
        const failedRun = runs.reverse().find((r) => r.status === 'failed');
        if (failedRun) {
          nodeId = failedRun.nodeId;
        }
      }
    }

    if (!nodeId) {
      throw new Error(`无法确定要跳过的节点 ID (Task: ${taskId})`);
    }

    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`工作流中未找到节点 [${nodeId}]`);
    }

    dagLogger.warn(
      `收到跳过节点指令，任务: ${taskId}, 节点: [${node.name}] (${nodeId})`,
      undefined,
      { taskId, nodeId }
    );
    this.log(task.id, nodeId, 'system', `[系统干预] 用户手动跳过了节点 [${node.name}]`);

    const now = Date.now();
    const existingRun = task.nodeRuns[nodeId];
    if (existingRun) {
      existingRun.status = 'skipped';
      existingRun.finishedAt = now;
      delete existingRun.error;
    } else {
      task.nodeRuns[nodeId] = {
        nodeId,
        status: 'skipped',
        startedAt: now,
        finishedAt: now,
      };
    }

    // 确保任务执行运行时上下文就绪
    if (!this.runningTasks.has(taskId)) {
      this.runningTasks.add(taskId);
    }
    if (!this.abortControllers.has(taskId)) {
      this.abortControllers.set(taskId, new AbortController());
    }
    if (!this.activeProcesses.has(taskId)) {
      this.activeProcesses.set(taskId, new Set());
    }

    task.status = 'running';
    task.kanbanColumn = 'in_progress';
    this.store.saveTask(task);
    this.emit('task:update', task);
    this.emit('node:status', { taskId: task.id, nodeId, status: 'skipped' });

    // 触发下游节点流转
    await this.triggerNextNodes(task, workflow, nodeId);

    return this.store.getTask(taskId) || task;
  }

  /**
   * 单独重试指定失败节点（无需从头重跑前序昂贵的 Agent 节点）
   */
  async retryNode(taskId: string, targetNodeId?: string): Promise<Task> {
    const task = this.store.getTask(taskId);
    if (!task) {
      dagLogger.error(`重试节点失败: Task ${taskId} 未找到`, undefined, { taskId });
      throw new Error(`Task ${taskId} not found`);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      dagLogger.error(`重试节点失败: Workflow ${task.workflowId} 未找到`, undefined, { taskId });
      throw new Error(`Workflow ${task.workflowId} not found`);
    }

    let nodeId = targetNodeId;
    if (!nodeId) {
      if (task.currentNodeId) {
        nodeId = task.currentNodeId;
      } else {
        const runs = Object.values(task.nodeRuns || {});
        const failedRun = runs.reverse().find((r) => r.status === 'failed');
        if (failedRun) {
          nodeId = failedRun.nodeId;
        }
      }
    }

    if (!nodeId) {
      throw new Error(`无法确定要重试的节点 ID (Task: ${taskId})`);
    }

    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`工作流中未找到节点 [${nodeId}]`);
    }

    dagLogger.info(
      `收到单节点重试指令，任务: ${taskId}, 节点: [${node.name}] (${nodeId})`,
      undefined,
      { taskId, nodeId }
    );
    this.log(task.id, nodeId, 'system', `[系统干预] 用户手动重试节点 [${node.name}]`);

    if (task.nodeRuns[nodeId]) {
      task.nodeRuns[nodeId].status = 'pending';
      delete task.nodeRuns[nodeId].error;
      delete task.nodeRuns[nodeId].exitCode;
      delete task.nodeRuns[nodeId].finishedAt;
    }

    // 递归获取以重试节点为起点的所有下游可达后继节点并级联重置
    const downstreamIds = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const outgoing = workflow.edges.filter((e) => e.source === curr);
      for (const e of outgoing) {
        if (!downstreamIds.has(e.target)) {
          downstreamIds.add(e.target);
          queue.push(e.target);
        }
      }
    }

    for (const dId of downstreamIds) {
      if (task.nodeRuns[dId]) {
        delete task.nodeRuns[dId];
      }
    }

    if (!this.runningTasks.has(taskId)) {
      this.runningTasks.add(taskId);
    }
    if (!this.abortControllers.has(taskId)) {
      this.abortControllers.set(taskId, new AbortController());
    }
    if (!this.activeProcesses.has(taskId)) {
      this.activeProcesses.set(taskId, new Set());
    }

    task.status = 'running';
    this.store.saveTask(task);
    this.emit('task:update', task);

    // 异步触发单节点调度
    this.scheduleNode(task, workflow, node).catch((err) => {
      dagLogger.error(`重试节点 [${node.name}] 调度异常: ${err.message}`, err, { taskId, nodeId });
    });

    return task;
  }

  /**
   * 终止正在运行的任务
   */
  async cancelTask(taskId: string): Promise<Task> {
    dagLogger.warn(`收到终止任务请求: ${taskId}`, undefined, { taskId });
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // 1. 触发任务级 AbortController 与 Pi RPC 终止
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
    }
    PiRpcSessionManager.getInstance().removeSession(taskId);

    // 2. 强杀已注册的所有活跃子进程组
    const procs = this.activeProcesses.get(taskId);
    if (procs && procs.size > 0) {
      const isUnix = process.platform !== 'win32';
      for (const child of procs) {
        try {
          if (child.pid) {
            dagLogger.warn(`强杀子进程树 PID: ${child.pid}`, undefined, { taskId });
            if (isUnix) {
              process.kill(-child.pid, 'SIGKILL');
            } else {
              child.kill('SIGKILL');
            }
          }
        } catch (_) {}
      }
      procs.clear();
    }

    this.runningTasks.delete(taskId);
    this.abortControllers.delete(taskId);
    this.activeProcesses.delete(taskId);

    // 3. 标记当前执行中节点为失败/终止
    if (task.currentNodeId && task.nodeRuns[task.currentNodeId]) {
      const nr = task.nodeRuns[task.currentNodeId];
      if (nr.status === 'running') {
        nr.status = 'failed';
        nr.error = '任务已被手动终止';
        nr.finishedAt = Date.now();
      }
    }

    // 4. 更新任务状态并归位回待处理泳道
    task.status = 'cancelled';
    task.kanbanColumn = 'backlog';
    this.store.saveTask(task);

    this.log(task.id, 'SYSTEM', 'stderr', `[SYSTEM] 任务已被用户手动终止`);
    this.emit('task:update', task);

    dagLogger.info(`任务 ${taskId} 已成功终止并归位至待处理泳道`, undefined, { taskId });
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

    // 关键链路：实时输出到终端控制台，确保 tee .run.log 完整捕获
    if (stream === 'stderr') {
      dagLogger.error(`[EXEC_STDERR] ${message}`, undefined, { taskId, nodeId });
    } else if (stream === 'system') {
      dagLogger.info(`[EXEC_SYSTEM] ${message}`, undefined, { taskId, nodeId });
    } else {
      dagLogger.info(`[EXEC_STDOUT] ${message}`, undefined, { taskId, nodeId });
    }
  }
}
