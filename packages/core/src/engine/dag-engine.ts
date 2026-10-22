import { EventEmitter } from 'events';
import path from 'path';
import { ChildProcess } from 'child_process';
import { Store } from '../store';
import { Task, WorkflowDefinition, WorkflowNode, WorkflowEdge, LogEntry, KanbanColumn, TaskSessionState } from '../types';
import { ExecutorRegistry, ExecutionContext } from '../executors';
import { createLogger } from '../logger';
import { PiRpcSessionManager } from '../agent/pi-rpc-session';
import { WorktreeManager, TaskProcessManager } from '../worktree/worktree-manager';
import { TaskDecomposer } from './task-decomposer';

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

    // 若当前任务为「任务组」，分流至任务组拓扑调度器
    if (task.kind === 'group') {
      return this.runTaskGroup(task);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      dagLogger.error(`启动任务失败: 关联工作流 ${task.workflowId} 未找到`, undefined, { taskId });
      throw new Error(`Workflow ${task.workflowId} not found`);
    }

    // 智能工序自适应评估：若允许自动拆解，AI/启发式评估是否需要原地升格为任务组 (串行/并行/DAG)
    if (!task.parentTaskId && task.kind !== 'subtask' && task.autoDecompose !== false) {
      const allWorkflows = this.store.getWorkflows();
      const plan = TaskDecomposer.getInstance().analyze(task, workflow, allWorkflows);
      if (plan.shouldDecompose && plan.subtasks && plan.subtasks.length >= 2) {
        dagLogger.info(
          `任务 ${taskId} 经评估属于复合需求，就地升格为任务组: ${plan.reason} (工序数: ${plan.subtasks.length}, 模式: ${plan.executionMode})`,
          undefined,
          { taskId }
        );
        this.log(
          task.id,
          'SYSTEM',
          'system',
          `✨ [AI 智能工序编排] 识别到该任务为多工序复合需求，已自动拆解为 ${plan.subtasks.length} 个工序 (${
            plan.executionMode === 'parallel' ? '全并行并发' : plan.executionMode === 'dag' ? 'DAG 拓扑' : '串行顺序推进'
          })`
        );

        // 升格当前任务
        task.kind = 'group';
        task.executionMode = plan.executionMode || 'serial';
        task.concurrencyLimit = plan.concurrencyLimit || 3;
        task.status = 'running';
        task.kanbanColumn = 'in_progress';

        const subTaskIds: string[] = [];
        const subIdMap = new Map<string, string>();

        for (let i = 0; i < plan.subtasks.length; i++) {
          const subTaskId = `task_${Date.now()}_sub_${i + 1}_${Math.random().toString(36).substring(2, 6)}`;
          subIdMap.set(`sub_${i + 1}`, subTaskId);
          subTaskIds.push(subTaskId);
        }

        for (let i = 0; i < plan.subtasks.length; i++) {
          const p = plan.subtasks[i];
          const subTaskId = subTaskIds[i];
          const resolvedDeps = (p.dependencies || [])
            .map((dep) => subIdMap.get(dep) || dep)
            .filter((d) => subTaskIds.includes(d));

          const subtask: Task = {
            id: subTaskId,
            title: p.title,
            description: p.description || task.description,
            workflowId: p.workflowId || task.workflowId,
            status: 'pending',
            kanbanColumn: 'in_progress',
            workspace: task.workspace,
            parentTaskId: task.id,
            dependencies: resolvedDeps,
            kind: 'subtask',
            createdAt: Date.now() + i,
            updatedAt: Date.now() + i,
            nodeRuns: {},
            context: { ...task.context, parentTaskId: task.id },
          };
          this.store.saveTask(subtask);
          this.emit('task:create', subtask);
        }

        task.subTaskIds = subTaskIds;
        this.store.saveTask(task);
        this.emit('task:update', task);

        // 无缝由任务组拓扑调度器接管子工序推进
        return this.runTaskGroup(task);
      }
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
        if (state.model) task.context.model = state.model;
        const prevAwaiting = !!task.context.awaitingInput;
        const nextAwaiting = !!state.awaitingInput;
        task.context.awaitingInput = nextAwaiting;
        this.store.saveTask(task);
        if (prevAwaiting !== nextAwaiting) {
          this.emit('task:update', task);
        }
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

    // 运行期间节点已被用户手动跳过（或任务已被终止）：丢弃本次执行结果，避免重复驱动下游
    const latestTask = this.store.getTask(task.id);
    const manualRunStatus = latestTask?.nodeRuns[node.id]?.status;
    if (manualRunStatus === 'skipped' || manualRunStatus === 'success') {
      dagLogger.info(`节点 [${node.name}] 运行期间已被用户手动处理，忽略本次执行结果`, undefined, {
        taskId: task.id,
        nodeId: node.id,
      });
      return;
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
    const hasPending = runs.some((r) => r.status === 'pending');

    // 若仍有并发节点正在执行、等待调度或等待人工审核，流水线未完成
    if (hasRunning || hasWaiting || hasPending) {
      return false;
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

        // 任务全部执行完成，立即清理所有后台进程与沙箱端口，绝不留存孤儿进程
        try {
          TaskProcessManager.stopAll(task.id);
          if (task.context?.worktree?.webPort) {
            WorktreeManager.getInstance().killPortIfBusy(task.context.worktree.webPort);
            WorktreeManager.unregisterTaskPorts(task.id);
          }
        } catch (cleanupErr: any) {
          dagLogger.warn(`[Task:Complete] 清理后台进程告警: ${cleanupErr.message}`);
        }

        dagLogger.info(
          `工作流 [${workflow.name}] 全部节点执行或按分支跳过完毕，任务标记为 COMPLETED`,
          undefined,
          { taskId: task.id }
        );
        this.log(task.id, 'SYSTEM', 'system', `========== 工作流全部节点已成功执行或按条件跳过！ ==========`);
      }
      this.store.saveTask(task);
      this.emit('task:update', task);

      // 若为子工序，联动同步更新父任务组进度
      if (task.parentTaskId) {
        try {
          const parentTask = this.store.getTask(task.parentTaskId);
          if (parentTask && parentTask.kind === 'group' && Array.isArray(parentTask.subTaskIds)) {
            const subtasks = parentTask.subTaskIds.map((id) => this.store.getTask(id)).filter(Boolean) as Task[];
            const completedCount = subtasks.filter((s) => s.status === 'completed').length;
            const failedCount = subtasks.filter((s) => s.status === 'failed').length;
            if (!parentTask.context) parentTask.context = {};
            parentTask.context.groupProgress = {
              completed: completedCount,
              failed: failedCount,
              total: subtasks.length,
            };
            if (completedCount === subtasks.length) {
              parentTask.status = 'completed';
              parentTask.kanbanColumn = 'done';
            }
            this.store.saveTask(parentTask);
            this.emit('task:update', parentTask);
          }
        } catch (syncErr: any) {
          dagLogger.warn(`[TaskGroup:SyncProgress] 同步父任务组进度失败: ${syncErr.message}`);
        }
      }

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
        } else if (currentTargetStatus === 'skipped') {
          dagLogger.info(
            `下游节点 [${targetNode.name}] 已标记为跳过 (skipped)，继续向下传导调度`,
            undefined,
            { taskId: task.id, nodeId: targetNode.id }
          );
          await this.triggerNextNodes(task, workflow, targetNode.id);
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

    // 人工验收通过，关停可能拉起的临时沙箱靶机服务，释放端口
    try {
      TaskProcessManager.stopAll(task.id);
      if (task.context?.worktree?.webPort) {
        WorktreeManager.getInstance().killPortIfBusy(task.context.worktree.webPort);
        WorktreeManager.unregisterTaskPorts(task.id);
      }
    } catch {}

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
    return this.finishNodeManually(taskId, targetNodeId, 'skipped');
  }

  /**
   * 用户确认当前节点已完成并继续执行下游
   * 用于 Agent 未输出完成标记、需要人工放行流水线的场景
   */
  async completeNode(taskId: string, targetNodeId?: string): Promise<Task> {
    return this.finishNodeManually(taskId, targetNodeId, 'success');
  }

  private async finishNodeManually(
    taskId: string,
    targetNodeId: string | undefined,
    status: 'skipped' | 'success'
  ): Promise<Task> {
    const actionText = status === 'success' ? '确认完成' : '跳过';
    const task = this.store.getTask(taskId);
    if (!task) {
      dagLogger.error(`${actionText}节点失败: Task ${taskId} 未找到`, undefined, { taskId });
      throw new Error(`Task ${taskId} not found`);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      dagLogger.error(`${actionText}节点失败: Workflow ${task.workflowId} 未找到`, undefined, { taskId });
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
      throw new Error(`无法确定要${actionText}的节点 ID (Task: ${taskId})`);
    }

    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) {
      throw new Error(`工作流中未找到节点 [${nodeId}]`);
    }

    dagLogger.warn(
      `收到${actionText}节点指令，任务: ${taskId}, 节点: [${node.name}] (${nodeId})`,
      undefined,
      { taskId, nodeId }
    );
    this.log(
      task.id,
      nodeId,
      'system',
      status === 'success'
        ? `[系统干预] 用户确认节点 [${node.name}] 已完成，流水线继续流转`
        : `[系统干预] 用户手动跳过了节点 [${node.name}]`
    );

    const now = Date.now();
    const existingRun = task.nodeRuns[nodeId];
    if (existingRun) {
      existingRun.status = status;
      existingRun.finishedAt = now;
      delete existingRun.error;
    } else {
      task.nodeRuns[nodeId] = {
        nodeId,
        status,
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
    this.emit('node:status', { taskId: task.id, nodeId, status });

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
   * 定制重试任务工作流：支持精确勾选节点、跳过未勾选节点、或从指定节点向下执行
   */
  async customRetryTask(
    taskId: string,
    options: {
      selectedNodeIds: string[];
      fromNodeId?: string;
    }
  ): Promise<Task> {
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${task.workflowId} not found`);
    }

    const { selectedNodeIds, fromNodeId } = options;
    const selectedSet = new Set(selectedNodeIds);

    dagLogger.info(
      `收到定制重试流水线指令: Task ${taskId}, From: ${fromNodeId || 'none'}, Selected: [${selectedNodeIds.join(', ')}]`,
      undefined,
      { taskId }
    );
    this.log(task.id, 'SYSTEM', 'system', `[定制重试] 用户触发流水线节点定制重试，已勾选 ${selectedNodeIds.length} 个节点重新执行`);

    const nodeOrderMap = new Map<string, number>();
    workflow.nodes.forEach((n, idx) => nodeOrderMap.set(n.id, idx));

    let startIndex = 0;
    if (fromNodeId) {
      const idx = nodeOrderMap.get(fromNodeId);
      if (idx !== undefined) startIndex = idx;
    }

    const now = Date.now();
    for (let i = 0; i < workflow.nodes.length; i++) {
      const node: WorkflowNode = workflow.nodes[i];
      const nid = node.id;

      if (i < startIndex) {
        // 在起始节点之前：如果用户未重新勾选它，且此前已成功，则保持成果不重跑
        if (!selectedSet.has(nid) && task.nodeRuns[nid]?.status === 'success') {
          continue;
        }
      }

      if (selectedSet.has(nid)) {
        // 用户选中的待重跑节点：重置为 pending
        if (task.nodeRuns[nid]) {
          task.nodeRuns[nid].status = 'pending';
          delete task.nodeRuns[nid].error;
          delete task.nodeRuns[nid].exitCode;
          delete task.nodeRuns[nid].finishedAt;
          task.nodeRuns[nid].startedAt = now;
        } else {
          task.nodeRuns[nid] = {
            nodeId: nid,
            status: 'pending',
            startedAt: now,
          };
        }
      } else {
        // 用户取消勾选的节点（在起始节点之后或未勾选）：标记为 skipped
        if (i >= startIndex) {
          task.nodeRuns[nid] = {
            nodeId: nid,
            status: 'skipped',
            startedAt: now,
            finishedAt: now,
          };
          this.log(task.id, nid, 'system', `[定制重试] 节点 [${node.name}] 被用户取消勾选，自动跳过`);
        }
      }
    }

    // 找到第一个需要执行的节点
    let firstNodeToRun: WorkflowNode | undefined;
    for (let i = startIndex; i < workflow.nodes.length; i++) {
      const node: WorkflowNode = workflow.nodes[i];
      if (selectedSet.has(node.id)) {
        firstNodeToRun = node;
        break;
      }
    }

    if (!firstNodeToRun) {
      throw new Error('未选择任何可执行的节点');
    }

    // 激活运行时上下文
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
    task.currentNodeId = firstNodeToRun.id;
    this.store.saveTask(task);
    this.emit('task:update', task);

    // 异步调度第一个节点
    this.scheduleNode(task, workflow, firstNodeToRun).catch((err) => {
      dagLogger.error(`定制重试调度异常 [${firstNodeToRun!.name}]: ${err.message}`, err, { taskId });
    });

    return task;
  }

  /**
   * 启动任务组 (Task Group) 执行：支持串行、并行与 DAG 依赖拓扑调度
   */
  async runTaskGroup(taskGroup: Task): Promise<void> {
    const groupId = taskGroup.id;
    if (this.runningTasks.has(groupId)) {
      if (taskGroup.status === 'failed' || taskGroup.status === 'cancelled' || taskGroup.status === 'completed') {
        dagLogger.info(`任务组 ${groupId} 处于终态 (${taskGroup.status})，清理残留运行锁并重新执行`, undefined, { taskId: groupId });
        this.runningTasks.delete(groupId);
        this.abortControllers.delete(groupId);
      } else {
        dagLogger.warn(`任务组 ${groupId} 已经在运行中，忽略重复启动请求`, undefined, { taskId: groupId });
        return;
      }
    }

    const subTaskIds = taskGroup.subTaskIds || [];
    if (subTaskIds.length === 0) {
      dagLogger.warn(`任务组 ${groupId} 未包含任何子任务，自动标记为已完成`, undefined, { taskId: groupId });
      taskGroup.status = 'completed';
      taskGroup.kanbanColumn = 'done';
      this.store.saveTask(taskGroup);
      this.emit('task:update', taskGroup);
      return;
    }

    this.runningTasks.add(groupId);
    const abortController = new AbortController();
    this.abortControllers.set(groupId, abortController);

    taskGroup.status = 'running';
    taskGroup.kanbanColumn = 'in_progress';
    if (!taskGroup.context) taskGroup.context = {};
    taskGroup.context.groupProgress = {
      completed: 0,
      failed: 0,
      total: subTaskIds.length,
    };
    this.store.saveTask(taskGroup);
    this.emit('task:update', taskGroup);

    const mode = taskGroup.executionMode || 'serial';
    const limit = Math.max(1, taskGroup.concurrencyLimit || (mode === 'serial' ? 1 : 3));
    dagLogger.info(
      `[TaskGroup] 启动任务组 [${taskGroup.title}] (模式: ${mode}, 子任务数: ${subTaskIds.length}, 并发限制: ${limit})`,
      undefined,
      { taskId: groupId }
    );
    this.log(groupId, 'GROUP', 'system', `========== 启动任务组 [${taskGroup.title}] (模式: ${mode}, 子任务数: ${subTaskIds.length}) ==========`);

    // 构建有效子任务依赖图
    const subtasks = subTaskIds
      .map((id) => this.store.getTask(id))
      .filter(Boolean) as Task[];

    // 默认继承父任务的工作区 (若子任务未明确指定)
    for (const sub of subtasks) {
      if (!sub.workspace && taskGroup.workspace) {
        sub.workspace = taskGroup.workspace;
        this.store.saveTask(sub);
      }
    }

    // 依赖映射
    const effectiveDeps = new Map<string, Set<string>>();
    for (let i = 0; i < subtasks.length; i++) {
      const sub = subtasks[i];
      const deps = new Set<string>();
      if (mode === 'serial') {
        if (i > 0) deps.add(subtasks[i - 1].id);
      } else if (mode === 'parallel') {
        // 无依赖，直接并行
      } else {
        // DAG 自定义模式
        if (Array.isArray(sub.dependencies)) {
          for (const depId of sub.dependencies) {
            deps.add(depId);
          }
        }
      }
      effectiveDeps.set(sub.id, deps);
    }

    const completed = new Set<string>();
    for (const sub of subtasks) {
      if (sub.status === 'completed') {
        completed.add(sub.id);
      }
    }
    const failed = new Set<string>();
    const running = new Set<string>();

    // 调度循环 Promise 控制器
    return new Promise<void>((resolve, reject) => {
      let isSettled = false;

      const finishGroup = (finalStatus: 'completed' | 'failed' | 'cancelled') => {
        if (isSettled) return;
        isSettled = true;

        this.runningTasks.delete(groupId);
        this.abortControllers.delete(groupId);

        const currentGroup = this.store.getTask(groupId) || taskGroup;
        currentGroup.status = finalStatus;
        currentGroup.kanbanColumn = finalStatus === 'completed' ? 'done' : 'backlog';
        currentGroup.context = {
          ...(currentGroup.context || {}),
          groupProgress: {
            completed: completed.size,
            failed: failed.size,
            total: subtasks.length,
          },
        };
        this.store.saveTask(currentGroup);
        this.emit('task:update', currentGroup);

        this.log(
          groupId,
          'GROUP',
          finalStatus === 'completed' ? 'system' : 'stderr',
          `========== 任务组执行结束: ${finalStatus.toUpperCase()} (成功: ${completed.size}, 失败: ${failed.size}, 总计: ${subtasks.length}) ==========`
        );

        if (finalStatus === 'failed') {
          reject(new Error(`任务组执行异常，存在失败的子任务`));
        } else {
          resolve();
        }
      };

      const checkAndPump = () => {
        if (isSettled) return;

        if (abortController.signal.aborted) {
          finishGroup('cancelled');
          return;
        }

        // 检查是否全部完成
        if (completed.size === subtasks.length) {
          finishGroup('completed');
          return;
        }

        // 检查是否有失败且没有其他正在执行的任务
        if (failed.size > 0 && running.size === 0) {
          finishGroup('failed');
          return;
        }

        // 如果已经有失败发生，不再调度新的子任务，等待运行中的子任务退出
        if (failed.size > 0) {
          return;
        }

        // 挑选就绪可调度的子任务
        for (const sub of subtasks) {
          if (running.size >= limit) break;
          if (completed.has(sub.id) || failed.has(sub.id) || running.has(sub.id)) continue;

          // 检查该子任务的所有前置依赖是否都已成功
          const requiredDeps = effectiveDeps.get(sub.id) || new Set();
          const allDepsSatisfied = Array.from(requiredDeps).every((depId) => completed.has(depId));
          if (!allDepsSatisfied) continue;

          // 入池启动
          running.add(sub.id);
          this.log(groupId, 'GROUP', 'system', `>>> 唤醒子任务 [${sub.title}] (${sub.id}) 并发执行`);

          this.runTask(sub.id)
            .then(() => {
              running.delete(sub.id);
              const freshSub = this.store.getTask(sub.id);
              if (freshSub && freshSub.status === 'completed') {
                completed.add(sub.id);
                this.log(groupId, 'GROUP', 'system', `✓ 子任务 [${sub.title}] 执行完成 (进度: ${completed.size}/${subtasks.length})`);
              } else if (freshSub && freshSub.status === 'waiting_approval') {
                this.log(groupId, 'GROUP', 'system', `⏸ 子任务 [${sub.title}] 处于待人工验收状态，等待验收确认后继续推进`);
              } else {
                failed.add(sub.id);
                this.log(groupId, 'GROUP', 'stderr', `✗ 子任务 [${sub.title}] 执行非成功状态: ${freshSub?.status}`);
              }
              // 同步更新父任务上下文进度
              const currentGroup = this.store.getTask(groupId) || taskGroup;
              if (!currentGroup.context) currentGroup.context = {};
              currentGroup.context.groupProgress = {
                completed: completed.size,
                failed: failed.size,
                total: subtasks.length,
              };
              this.store.saveTask(currentGroup);
              this.emit('task:update', currentGroup);

              checkAndPump();
            })
            .catch((err) => {
              running.delete(sub.id);
              failed.add(sub.id);
              this.log(groupId, 'GROUP', 'stderr', `✗ 子任务 [${sub.title}] 调度异常: ${err.message}`);

              const currentGroup = this.store.getTask(groupId) || taskGroup;
              if (!currentGroup.context) currentGroup.context = {};
              currentGroup.context.groupProgress = {
                completed: completed.size,
                failed: failed.size,
                total: subtasks.length,
              };
              this.store.saveTask(currentGroup);
              this.emit('task:update', currentGroup);

              checkAndPump();
            });
        }
      };

      // 启动初始批次
      checkAndPump();
    });
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

    // 0. 若为任务组，级联取消其所有正在运行的子任务
    if (task.kind === 'group' && Array.isArray(task.subTaskIds)) {
      dagLogger.warn(`级联终止任务组 ${taskId} 下属子任务: [${task.subTaskIds.join(', ')}]`, undefined, { taskId });
      for (const subId of task.subTaskIds) {
        if (this.runningTasks.has(subId)) {
          try {
            await this.cancelTask(subId);
          } catch (e: any) {
            dagLogger.warn(`级联终止子任务 ${subId} 告警: ${e.message}`, undefined, { taskId: subId });
          }
        }
      }
    }

    // 1. 触发任务级 AbortController 与 Pi RPC 终止
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
    }
    PiRpcSessionManager.getInstance().removeSession(taskId);

    // 2. 终止任务关联的所有后台守护进程与靶机进程 (通过 TaskProcessManager)
    TaskProcessManager.getInstance().stopAll(taskId);

    // 3. 强杀已注册的所有活跃子进程组
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

  public log(taskId: string, nodeId: string, stream: 'stdout' | 'stderr' | 'system', message: string) {
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
