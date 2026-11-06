import { ChildProcess } from 'child_process';
import { Store } from '../store';
import { Task, WorkflowDefinition, WorkflowNode, TaskSessionState } from '../types';
import { AgentStreamEvent } from '../agent/agent-events';
import { ExecutionContext, ExecutionResult } from '../executors';
import { WorktreeManager } from '../worktree/worktree-manager';

/** 宿主提供的通道：事件广播、日志落库、子进程登记 */
export interface PipelineHost {
  emit: (event: string, payload: any) => void;
  log: (taskId: string, nodeId: string, stream: 'stdout' | 'stderr' | 'system', message: string) => void;
  registerChildProcess?: (taskId: string, child: ChildProcess) => void;
}

/**
 * 步骤记录器：一次系统调用落一条记录，界面时间轴与节点日志共用同一份数据。
 * 脚本流水线与 Markdown 流水线共用。
 */
export class StepLog {
  /** 最近开始的步骤 id，日志按它归档 */
  public current = '';

  constructor(private readonly store: Store, private readonly host: PipelineHost) {}

  begin(task: Task, type: string, name: string, seq: number): string {
    const stepId = `s${seq}`;
    this.current = stepId;
    // 步骤一开始就带上自报名与类型：界面无需等步骤结束就能知道这一步是什么
    task.nodeRuns[stepId] = {
      nodeId: stepId,
      status: 'running',
      startedAt: Date.now(),
      output: { stepName: name, stepType: type },
    };
    task.currentNodeId = stepId;
    this.persist(task);
    this.host.emit('node:status', { taskId: task.id, nodeId: stepId, status: 'running' });
    this.host.emit('task:update', task);
    this.host.log(task.id, stepId, 'system', `>>> ${name} (${type})`);
    return stepId;
  }

  end(task: Task, stepId: string, type: string, name: string, result: ExecutionResult): void {
    const record = task.nodeRuns[stepId];
    if (!record) return;
    record.status = result.status;
    record.finishedAt = Date.now();
    record.output = { stepName: name, stepType: type, result: result.output ?? null };
    record.error = result.error;
    record.exitCode = result.exitCode;
    record.artifacts = result.artifacts;
    this.persist(task);
    this.host.emit('task:update', task);
    this.host.emit('node:status', { taskId: task.id, nodeId: stepId, status: result.status });
    const suffix = result.status === 'success' || result.status === 'skipped' ? '✔' : '✘';
    this.host.log(task.id, stepId, 'system', `<<< ${suffix} ${name} (${result.status})`);
  }

  /** 落库前同步终止态，避免在途步骤把 cancelled 覆写回 running */
  persist(task: Task): void {
    const latest = this.store.getTask(task.id);
    if (latest?.status === 'cancelled') task.status = 'cancelled';
    this.store.saveTask(task);
  }
}

/** 执行器上下文：任务变量、沙箱端口与插值全部在这里统一装配 */
export function buildNodeContext(input: {
  store: Store;
  host: PipelineHost;
  task: Task;
  workflow: WorkflowDefinition;
  node: WorkflowNode;
  abortSignal?: AbortSignal;
}): ExecutionContext {
  const { store, host, task, workflow, node } = input;
  let persistAt = 0;
  return {
    task,
    node,
    settings: store.getSettings(),
    store,
    abortSignal: input.abortSignal,
    registerChildProcess: (child: ChildProcess) => {
      host.registerChildProcess?.(task.id, child);
    },
    variables: {
      task: {
        id: task.id,
        title: task.title,
        description: task.description || '',
        workflowId: task.workflowId,
        workspace: task.workspace || '',
      },
      ...(workflow.variables || {}),
      ...(task.context || {}),
      worktree: task.context?.worktree,
      ports: task.context?.worktree?.ports,
      testUrl: task.context?.worktree?.targetUrl,
      inputs: task.context,
    },
    emitLog: (stream, message) => host.log(task.id, node.id, stream, message),
    onSessionUpdate: (state: TaskSessionState) => {
      if (input.abortSignal?.aborted) return;
      if (!task.context) task.context = {};
      const patch: Record<string, any> = {
        chatMessages: state.messages,
        awaitingInput: !!state.awaitingInput,
      };
      if (state.model) patch.model = state.model;
      Object.assign(task.context, patch);
      const now = Date.now();
      if (now - persistAt >= 800) {
        persistAt = now;
        store.updateTaskContext(task.id, patch);
      }
      host.emit('agent:chat_update', state);
    },
    onSessionEvent: (event: AgentStreamEvent) => {
      if (input.abortSignal?.aborted) return;
      if (event.kind === 'snapshot') return;
      host.emit('agent:stream', event);
    },
  };
}

/** 采集沙箱代码改动，供人工卡点直接查看 Diff */
export function captureWorktreeDiff(task: Task): any {
  const wt = task.context?.worktree;
  if (!wt?.worktreeDir) return null;
  try {
    const diff = WorktreeManager.getInstance().getWorktreeDiff(wt.worktreeDir, wt.baseBranch, wt.baseCommit);
    wt.changedFiles = diff.changedFiles;
    wt.diffSummary = diff.diffSummary;
    wt.diffResult = diff.diffResult;
    return { changedFiles: diff.changedFiles, diffSummary: diff.diffSummary, diffResult: diff.diffResult };
  } catch {
    return null;
  }
}
