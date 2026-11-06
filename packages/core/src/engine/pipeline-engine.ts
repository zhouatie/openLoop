import { EventEmitter } from 'events';
import path from 'path';
import { ChildProcess } from 'child_process';
import { Store } from '../store';
import { Task, LogEntry } from '../types';
import { ExecutorRegistry } from '../executors';
import { createLogger } from '../logger';
import { PiSessionManager } from '../agent/pi-session';
import { WorktreeManager, TaskProcessManager } from '../worktree/worktree-manager';
import { MarkdownRuntime } from '../pipeline/markdown-runtime';

const engineLogger = createLogger('Engine:Pipeline');

export class PipelineEngine extends EventEmitter {
  private store: Store;
  private registry: ExecutorRegistry;
  private runningTasks: Set<string> = new Set();
  private abortControllers: Map<string, AbortController> = new Map();
  private activeProcesses: Map<string, Set<ChildProcess>> = new Map();
  private markdownRuntime: MarkdownRuntime;

  constructor(store: Store, registry?: ExecutorRegistry) {
    super();
    this.store = store;
    this.registry = registry || new ExecutorRegistry();
    const host = {
      emit: (event: string, payload: any) => this.emit(event, payload),
      log: (taskId: string, nodeId: string, stream: 'stdout' | 'stderr' | 'system', message: string) =>
        this.log(taskId, nodeId, stream, message),
      registerChildProcess: (taskId: string, child: ChildProcess) => {
        const procSet = this.activeProcesses.get(taskId);
        if (!procSet) return;
        procSet.add(child);
        child.on('exit', () => procSet.delete(child));
      },
    };
    this.markdownRuntime = new MarkdownRuntime(store, this.registry, host);
  }

  public getRegistry(): ExecutorRegistry {
    return this.registry;
  }

  /**
   * 启动任务：任务组走拓扑调度，单任务执行其 Markdown 流程文档
   */
  async runTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) {
      engineLogger.error(`启动任务失败: 任务 ${taskId} 未找到`, undefined, { taskId });
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.kind === 'group') {
      return this.runTaskGroup(task);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      engineLogger.error(`启动任务失败: 关联流水线 ${task.workflowId} 未找到`, undefined, { taskId });
      throw new Error(`Workflow ${task.workflowId} not found`);
    }

    if (this.runningTasks.has(taskId)) {
      if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'completed') {
        engineLogger.info(`任务 ${taskId} 处于终态 (${task.status})，清理残留运行锁并重新执行`, undefined, { taskId });
        this.runningTasks.delete(taskId);
        this.abortControllers.delete(taskId);
        this.activeProcesses.delete(taskId);
      } else {
        engineLogger.warn(`任务 ${taskId} 已经在运行中，忽略重复启动请求`, undefined, { taskId });
        return;
      }
    }

    this.runningTasks.add(taskId);
    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);
    this.activeProcesses.set(taskId, new Set());

    try {
      await this.markdownRuntime.run(task, workflow);
    } catch (err: any) {
      engineLogger.error(`Markdown 流水线运行异常: ${err.message}`, err, { taskId });
      this.log(taskId, 'SCRIPT', 'stderr', `Markdown 流水线异常: ${err.message}`);
      const latest = this.store.getTask(taskId);
      if (latest && latest.status !== 'cancelled') {
        latest.status = 'failed';
        latest.kanbanColumn = 'backlog';
        this.store.saveTask(latest);
        this.emit('task:update', latest);
      }
    } finally {
      this.runningTasks.delete(taskId);
      this.abortControllers.delete(taskId);
      this.activeProcesses.delete(taskId);
    }
  }

  /**
   * 人工验收决策：唤醒挂起的编排 Agent
   */
  async resumeTask(taskId: string, approved: boolean, feedback?: string): Promise<Task> {
    engineLogger.info(
      `收到任务唤醒指令，Approved: ${approved}，反馈意见: "${feedback || ''}"`,
      undefined,
      { taskId }
    );
    const task = this.store.getTask(taskId);
    if (!task) {
      engineLogger.error(`唤醒任务失败: Task ${taskId} 未找到`, undefined, { taskId });
      throw new Error(`Task ${taskId} not found`);
    }

    const workflow = this.store.getWorkflow(task.workflowId);
    if (!workflow) {
      // 流水线已被删除（历史任务）：没有流程可继续，验收即收尾、驳回即打回
      engineLogger.warn(
        `流水线 ${task.workflowId} 已不存在，直接按人工验收结果收尾: ${taskId}`,
        undefined,
        { taskId, nodeId: task.currentNodeId }
      );
      if (task.currentNodeId) {
        this.log(
          task.id,
          task.currentNodeId,
          approved ? 'system' : 'stderr',
          approved
            ? '[QA 审核通过]: 流水线已删除，任务直接完成'
            : `[QA 审核驳回]: ${feedback || '未通过验收指标'}`
        );
      }
      if (approved) {
        task.status = 'completed';
        task.kanbanColumn = 'done';
        task.currentNodeId = undefined;
      } else {
        task.status = 'failed';
        task.kanbanColumn = 'backlog';
      }
      this.store.saveTask(task);
      this.emit('task:update', task);
      return task;
    }

    if (!this.markdownRuntime.resolveApproval(taskId, approved, feedback)) {
      engineLogger.warn(`任务 ${taskId} 当前没有待处理的人工卡点`, undefined, { taskId });
      throw new Error(`Task ${taskId} has no pending approval`);
    }
    return this.store.getTask(taskId) || task;
  }

  /**
   * 启动任务组 (Task Group) 执行：支持串行、并行与 DAG 依赖拓扑调度
   */
  async runTaskGroup(taskGroup: Task): Promise<void> {
    const groupId = taskGroup.id;
    if (this.runningTasks.has(groupId)) {
      if (taskGroup.status === 'failed' || taskGroup.status === 'cancelled' || taskGroup.status === 'completed') {
        engineLogger.info(`任务组 ${groupId} 处于终态 (${taskGroup.status})，清理残留运行锁并重新执行`, undefined, { taskId: groupId });
        this.runningTasks.delete(groupId);
        this.abortControllers.delete(groupId);
      } else {
        engineLogger.warn(`任务组 ${groupId} 已经在运行中，忽略重复启动请求`, undefined, { taskId: groupId });
        return;
      }
    }

    const subTaskIds = taskGroup.subTaskIds || [];
    if (subTaskIds.length === 0) {
      engineLogger.warn(`任务组 ${groupId} 未包含任何子任务，保持等待添加工序状态`, undefined, { taskId: groupId });
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
    engineLogger.info(
      `[TaskGroup] 启动任务组 [${taskGroup.title}] (模式: ${mode}, 子任务数: ${subTaskIds.length}, 并发限制: ${limit})`,
      undefined,
      { taskId: groupId }
    );
    this.log(groupId, 'GROUP', 'system', `========== 启动任务组 [${taskGroup.title}] (模式: ${mode}, 子任务数: ${subTaskIds.length}) ==========`);

    // 构建有效子任务依赖图
    const subtasks = subTaskIds
      .map((id) => this.store.getTask(id))
      .filter(Boolean) as Task[];

    // 默认继承父任务的工作区与快照 (若子任务未明确指定)
    for (const sub of subtasks) {
      let changed = false;
      if (!sub.workspace && taskGroup.workspace) {
        sub.workspace = taskGroup.workspace;
        changed = true;
      }
      if (!sub.context?.parentGroupSnapshot) {
        sub.context = {
          ...(sub.context || {}),
          parentTaskId: groupId,
          parentGroupSnapshot: {
            title: taskGroup.title,
            description: taskGroup.description || '',
            attachments: taskGroup.attachments,
          },
        };
        changed = true;
      }
      if (changed) {
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
    engineLogger.warn(`收到终止任务请求: ${taskId}`, undefined, { taskId });
    const task = this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Markdown 流水线：直接终止子进程、进程组与会话
    this.markdownRuntime.cancel(taskId);

    // 0. 若为任务组，级联取消其所有正在运行的子任务
    if (task.kind === 'group' && Array.isArray(task.subTaskIds)) {
      engineLogger.warn(`级联终止任务组 ${taskId} 下属子任务: [${task.subTaskIds.join(', ')}]`, undefined, { taskId });
      for (const subId of task.subTaskIds) {
        if (this.runningTasks.has(subId)) {
          try {
            await this.cancelTask(subId);
          } catch (e: any) {
            engineLogger.warn(`级联终止子任务 ${subId} 告警: ${e.message}`, undefined, { taskId: subId });
          }
        }
      }
    }

    // 1. 触发任务级 AbortController 与 Pi RPC 终止
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
    }
    PiSessionManager.getInstance().removeSession(taskId);

    // 2. 终止任务关联的所有后台守护进程与靶机进程 (通过 TaskProcessManager)
    TaskProcessManager.getInstance().stopAll(taskId);

    // 3. 强杀已注册的所有活跃子进程组
    const procs = this.activeProcesses.get(taskId);
    if (procs && procs.size > 0) {
      const isUnix = process.platform !== 'win32';
      for (const child of procs) {
        try {
          if (child.pid) {
            engineLogger.warn(`强杀子进程树 PID: ${child.pid}`, undefined, { taskId });
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
    if (task.context?.awaitingInput) {
      task.context.awaitingInput = false;
    }
    this.store.saveTask(task);

    this.log(task.id, 'SYSTEM', 'stderr', `[SYSTEM] 任务已被用户手动终止`);
    this.emit('task:update', task);

    engineLogger.info(`任务 ${taskId} 已成功终止并归位至待处理泳道`, undefined, { taskId });
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
      engineLogger.error(`[EXEC_STDERR] ${message}`, undefined, { taskId, nodeId });
    } else if (stream === 'system') {
      engineLogger.info(`[EXEC_SYSTEM] ${message}`, undefined, { taskId, nodeId });
    } else {
      engineLogger.info(`[EXEC_STDOUT] ${message}`, undefined, { taskId, nodeId });
    }
  }
}
