import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { Store } from '../store';
import { Task, WorkflowDefinition, WorkflowNode } from '../types';
import { ExecutorRegistry, ExecutionResult } from '../executors';
import { WorktreeManager, TaskProcessManager } from '../worktree/worktree-manager';
import { createLogger } from '../logger';
import { PipelineHost, StepLog, buildNodeContext, captureWorktreeDiff } from './pipeline-host';

const scriptLogger = createLogger('ScriptPipeline');

interface PendingCall {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

interface ApprovalSlot {
  stepId: string;
  deliver: (value: any) => void;
}

interface RunningScript {
  taskId: string;
  task: Task;
  child: ChildProcess;
  abort: AbortController;
  pending: Map<number, PendingCall>;
  stepSeq: number;
  currentStepId: string;
  steps: StepLog;
  approval?: ApprovalSlot;
  done: boolean;
  exitCode: number | null;
}

const BOOTSTRAP_SOURCE = `import fs from 'node:fs';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const [, , scriptFile, contextFile] = process.argv;
const pending = new Map();
let seq = 0;

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n');

const call = (api, args) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  send({ type: 'request', id, api, args });
});

const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));

const api = {
  log: (message, stream = 'stdout') => call('log', [String(message ?? ''), stream]),
  node: (type, config = {}, opts = {}) => call('node', [String(type), config || {}, opts || {}]),
  cli: (command, opts = {}) => call('cli', [String(command), opts || {}]),
  agent: (options = {}) => call('agent', [options || {}]),
  approve: (options = {}) => call('approve', [options || {}]),
  sandbox: {
    create: (opts = {}) => call('sandbox.create', [opts || {}]),
    diff: () => call('sandbox.diff', []),
    merge: (opts = {}) => call('sandbox.merge', [opts || {}]),
    cleanup: () => call('sandbox.cleanup', []),
    info: () => call('sandbox.info', []),
  },
  task: context.task,
  params: context.params,
  workspace: context.workspace,
};
api.sandbox.worktree = api.sandbox;
api.worktree = api.sandbox;
globalThis.openloop = api;

const format = (value) => {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};
for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
  const stream = level === 'warn' || level === 'error' ? 'stderr' : 'stdout';
  console[level] = (...args) => { api.log(args.map(format).join(' '), stream); };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const slot = msg && pending.get(msg.id);
  if (!slot) return;
  pending.delete(msg.id);
  if (msg.ok) slot.resolve(msg.value);
  else slot.reject(new Error(msg.error || '系统调用失败'));
});

const finish = (result) => {
  send({ type: 'done', result: result ?? { status: 'success' } });
  process.exit(result && result.status === 'failed' ? 1 : 0);
};

try {
  const mod = await import(pathToFileURL(scriptFile).href);
  const entry = mod.default || mod.run;
  if (typeof entry !== 'function') throw new Error('脚本缺少 export default 函数');
  const result = await entry({ ...api, ...context });
  finish(result);
} catch (err) {
  send({ type: 'log', stream: 'stderr', message: '[脚本异常] ' + (err && err.message ? err.message : String(err)) });
  finish({ status: 'failed', error: err && err.message ? err.message : String(err) });
}
`;

const SHIM_SOURCE = `const api = () => globalThis.openloop;
export const log = (...a) => api().log(...a);
export const node = (...a) => api().node(...a);
export const cli = (...a) => api().cli(...a);
export const agent = (...a) => api().agent(...a);
export const approve = (...a) => api().approve(...a);
export const sandbox = api().sandbox;
export const task = api().task;
export const params = api().params;
export const workspace = api().workspace;
export default api;
`;

/**
 * 脚本流水线运行时：一条流水线 = 一段 JS。
 * 宿主负责系统能力（沙箱 / CLI / Agent / 人工卡点），脚本只负责逻辑编排。
 */
export class ScriptRuntime {
  private runs = new Map<string, RunningScript>();

  constructor(
    private store: Store,
    private registry: ExecutorRegistry,
    private host: PipelineHost
  ) {}

  /** 运行时目录：bootstrap、import 代理、脚本与上下文临时文件 */
  private get runtimeDir(): string {
    return path.join(this.store.getDataDir(), 'pipeline-runtime');
  }

  private ensureRuntimeFiles(): { bootstrap: string } {
    const dir = this.runtimeDir;
    const scriptsDir = path.join(dir, 'scripts');
    const shimDir = path.join(scriptsDir, 'node_modules', 'openloop');
    for (const target of [dir, scriptsDir, shimDir]) {
      fs.mkdirSync(target, { recursive: true });
    }

    const bootstrap = path.join(dir, 'bootstrap.mjs');
    if (!fs.existsSync(bootstrap)) fs.writeFileSync(bootstrap, BOOTSTRAP_SOURCE);

    const shimPackage = path.join(shimDir, 'package.json');
    if (!fs.existsSync(shimPackage)) {
      fs.writeFileSync(
        shimPackage,
        JSON.stringify({ name: 'openloop', version: '1.0.0', type: 'module', exports: './index.mjs' }, null, 2)
      );
    }
    const shimIndex = path.join(shimDir, 'index.mjs');
    if (!fs.existsSync(shimIndex)) fs.writeFileSync(shimIndex, SHIM_SOURCE);

    return { bootstrap };
  }

  private scriptFile(taskId: string): string {
    return path.join(this.runtimeDir, 'scripts', `${taskId}.mjs`);
  }

  private contextFile(taskId: string): string {
    return path.join(this.runtimeDir, 'scripts', `${taskId}.context.json`);
  }

  private stepName(type: string, config: Record<string, any>): string {
    if (type === 'cli') {
      const command = String(config.command || '').split('\n')[0].trim();
      return command ? `命令: ${command.slice(0, 60)}` : '命令执行';
    }
    if (type === 'agent') return config.agentName || 'AI Agent';
    if (type === 'worktree-setup') return '沙箱就绪';
    if (type === 'worktree-merge') return '合并代码';
    if (type === 'worktree-cleanup') return '清理沙箱';
    if (type === 'qa-approval') return '人工验收';
    if (type === 'midscene') return 'UI 自动化验收';
    if (type === 'qa-planner') return 'QA 用例设计';
    if (type === 'env-prepare') return '服务就绪';
    return `节点: ${type}`;
  }

  /** 采集沙箱代码改动，供人工卡点直接查看 Diff */
  private captureDiff(task: Task): any {
    return captureWorktreeDiff(task);
  }

  private async runNode(
    task: Task,
    workflow: WorkflowDefinition,
    run: RunningScript,
    type: string,
    config: Record<string, any>,
    opts: Record<string, any> = {}
  ): Promise<any> {
    const name = opts.name || this.stepName(type, config);
    const stepId = run.steps.begin(task, type, name, ++run.stepSeq);
    run.currentStepId = stepId;
    const node: WorkflowNode = {
      id: stepId,
      type: type as WorkflowNode['type'],
      name,
      config: { ...config },
    } as WorkflowNode;

    let result: ExecutionResult;
    try {
      result = await this.registry
        .get(type)
        .execute(
          buildNodeContext({
            store: this.store,
            host: this.host,
            task,
            workflow,
            node,
            abortSignal: run.abort.signal,
          })
        );
    } catch (err: any) {
      scriptLogger.error(`脚本步骤执行异常: ${err?.message}`, err, { taskId: task.id, nodeId: stepId });
      result = { status: 'failed', exitCode: 1, error: err?.message || String(err) };
    }

    run.steps.end(task, stepId, type, name, result);
    return {
      ok: result.status === 'success' || result.status === 'skipped',
      status: result.status,
      output: result.output ?? null,
      error: result.error ?? null,
      exitCode: result.exitCode ?? 0,
      artifacts: result.artifacts ?? null,
      stepId,
    };
  }

  private async waitApproval(
    task: Task,
    run: RunningScript,
    options: Record<string, any>
  ): Promise<any> {
    const title = options.title || '人工验收';
    const stepId = run.steps.begin(task, 'qa-approval', title, ++run.stepSeq);
    run.currentStepId = stepId;
    const diff = this.captureDiff(task);

    task.status = 'waiting_approval';
    task.currentNodeId = stepId;
    task.nodeRuns[stepId].status = 'waiting_approval';
    task.nodeRuns[stepId].output = {
      stepName: title,
      stepType: 'qa-approval',
      approvalPrompt: options.prompt || '',
      checklist: Array.isArray(options.checklist) ? options.checklist : [],
      artifacts: options.artifacts || [],
      worktree: diff,
    };
    this.store.saveTask(task);
    this.host.emit('task:update', task);
    this.host.emit('node:status', { taskId: task.id, nodeId: stepId, status: 'waiting_approval' });
    this.host.log(task.id, stepId, 'system', `[人工卡点] ${title}：等待验收决策`);

    return new Promise((resolve) => {
      run.approval = { stepId, deliver: resolve };
    });
  }

  /** 用户作出验收决策：唤醒挂起的脚本，返回是否命中了脚本卡点 */
  resolveApproval(taskId: string, approved: boolean, feedback?: string): boolean {
    const run = this.runs.get(taskId);
    if (!run?.approval) return false;
    if (this.store.getTask(taskId)?.status === 'cancelled') return false;
    const task = run.task;

    const { stepId, deliver } = run.approval;
    run.approval = undefined;
    const record = task.nodeRuns[stepId];
    if (record) {
      record.status = approved ? 'success' : 'failed';
      record.finishedAt = Date.now();
      record.output = { ...(record.output || {}), approved, feedback: feedback || '' };
      if (!approved) record.error = feedback || '验收驳回';
    }
    this.host.log(
      task.id,
      stepId,
      approved ? 'system' : 'stderr',
      approved ? `[验收通过] ${feedback || '继续执行'}` : `[验收驳回] ${feedback || '未通过验收指标'}`
    );

    task.status = approved ? 'running' : 'failed';
    if (!approved) task.kanbanColumn = 'backlog';

    // 验收决策后关停沙箱靶机进程，释放端口，避免遗留孤儿服务
    try {
      TaskProcessManager.stopAll(task.id);
      if (task.context?.worktree?.webPort) {
        WorktreeManager.getInstance().killPortIfBusy(task.context.worktree.webPort);
      }
    } catch {}

    this.store.saveTask(task);
    this.host.emit('task:update', task);
    this.host.emit('node:status', { taskId, nodeId: stepId, status: approved ? 'success' : 'failed' });
    deliver({ ok: approved, feedback: feedback || '' });
    return true;
  }

  private async handleRequest(
    task: Task,
    workflow: WorkflowDefinition,
    run: RunningScript,
    api: string,
    args: any[]
  ): Promise<any> {
    switch (api) {
      case 'log':
        this.host.log(
          task.id,
          run.currentStepId,
          args[1] === 'stderr' ? 'stderr' : args[1] === 'system' ? 'system' : 'stdout',
          String(args[0] ?? '')
        );
        return null;

      case 'node':
        return this.runNode(task, workflow, run, String(args[0]), args[1] || {}, args[2] || {});

      case 'cli':
        return this.runNode(task, workflow, run, 'cli', { command: String(args[0] ?? '') }, args[1] || {});

      case 'agent': {
        const options = args[0] || {};
        const sessions: Record<string, string> = (task.context.scriptSessions ||= {});
        const base = `session_${task.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const key = typeof options.session === 'string' && options.session ? options.session : '';
        const sessionId = key ? sessions[key] || `${base}_${key}` : `${base}_${++run.stepSeq}`;
        task.context.sessionId = sessionId;
        task.context.piSessionId = sessionId;
        const result = await this.runNode(
          task,
          workflow,
          run,
          'agent',
          {
            prompt: options.prompt || task.description || task.title,
            cwd: options.cwd || undefined,
            agentName: options.agentName || undefined,
            timeoutSec: options.timeoutSec,
          },
          { name: options.name || options.agentName || 'AI Agent' }
        );
        if (key) sessions[key] = sessionId;
        task.context.sessionId = sessionId;
        task.context.piSessionId = sessionId;
        this.store.saveTask(task);
        return { ...result, sessionId, session: sessionId };
      }

      case 'approve':
        return this.waitApproval(task, run, args[0] || {});

      case 'sandbox.create': {
        const options = args[0] || {};
        return this.runNode(
          task,
          workflow,
          run,
          'worktree-setup',
          {
            cwd: options.cwd,
            sharedPaths: options.sharedPaths,
            allocatePorts: options.ports || options.allocatePorts,
            basePort: options.basePort,
            portBases: options.portBases,
          },
          { name: options.name || '沙箱就绪' }
        );
      }
      case 'sandbox.merge':
        return this.runNode(task, workflow, run, 'worktree-merge', {}, { name: args[0]?.name || '合并代码' });
      case 'sandbox.cleanup':
        return this.runNode(task, workflow, run, 'worktree-cleanup', {}, { name: args[0]?.name || '清理沙箱' });
      case 'sandbox.diff':
        return this.captureDiff(task);
      case 'sandbox.info':
        return task.context?.worktree || null;
      default:
        throw new Error(`未知的系统调用: ${api}`);
    }
  }

  private send(run: RunningScript, payload: Record<string, any>): void {
    if (!run.child.stdin || run.child.stdin.destroyed) return;
    try {
      run.child.stdin.write(JSON.stringify(payload) + '\n');
    } catch (err: any) {
      scriptLogger.warn(`脚本通道写入失败: ${err?.message}`, undefined, { taskId: run.taskId });
    }
  }

  private finalize(task: Task, workflow: WorkflowDefinition, run: RunningScript, result: any): void {
    if (run.done) return;
    run.done = true;

    // 用户已手动终止：保留 cancelled 终态，不再回写脚本结果
    if (run.abort.signal.aborted || this.store.getTask(task.id)?.status === 'cancelled') {
      task.status = 'cancelled';
      task.kanbanColumn = 'backlog';
      try {
        TaskProcessManager.stopAll(task.id);
      } catch {}
      this.store.saveTask(task);
      this.runs.delete(task.id);
      this.host.emit('task:update', task);
      return;
    }

    const failed = result?.status === 'failed' || (run.exitCode !== null && run.exitCode !== 0);
    task.status = failed ? 'failed' : 'completed';
    task.kanbanColumn = failed ? 'backlog' : 'done';
    if (failed && !task.context?.scriptError) {
      if (!task.context) task.context = {};
      task.context.scriptError = result?.error || `脚本退出码 ${run.exitCode}`;
    }
    if (!failed) delete task.context?.scriptError;

    try {
      TaskProcessManager.stopAll(task.id);
      if (task.context?.worktree?.webPort) {
        WorktreeManager.getInstance().killPortIfBusy(task.context.worktree.webPort);
      }
    } catch {}

    this.store.saveTask(task);
    this.host.emit('task:update', task);
    this.host.log(
      task.id,
      'SCRIPT',
      failed ? 'stderr' : 'system',
      failed
        ? `========== 脚本流水线 [${workflow.name}] 执行失败: ${result?.error || run.exitCode} ==========`
        : `========== 脚本流水线 [${workflow.name}] 执行完成 ==========`
    );
    this.runs.delete(task.id);
  }

  /** 启动脚本流水线（挂起等待人工卡点时 Promise 保持未完成） */
  async run(task: Task, workflow: WorkflowDefinition): Promise<void> {
    const script = (workflow.script || '').trim();
    if (!script) throw new Error('脚本流水线缺少脚本内容');

    if (this.runs.has(task.id)) {
      scriptLogger.warn(`脚本流水线已在运行，忽略重复启动: ${task.id}`, undefined, { taskId: task.id });
      return;
    }

    const { bootstrap } = this.ensureRuntimeFiles();
    const scriptPath = this.scriptFile(task.id);
    const contextPath = this.contextFile(task.id);
    fs.writeFileSync(scriptPath, script);
    fs.writeFileSync(
      contextPath,
      JSON.stringify(
        {
          task: {
            id: task.id,
            title: task.title,
            description: task.description || '',
            workspace: task.workspace || '',
            kanbanColumn: task.kanbanColumn,
          },
          params: { ...(workflow.variables || {}), ...(task.context?.params || {}) },
          workspace: task.workspace || workflow.defaultWorkspace || process.cwd(),
        },
        null,
        2
      )
    );

    task.status = 'running';
    task.nodeRuns = {};
    task.kanbanColumn = 'in_progress';
    this.store.saveTask(task);
    this.host.emit('task:update', task);
    this.host.log(task.id, 'SCRIPT', 'system', `========== 启动脚本流水线 [${workflow.name}] ==========`);
    scriptLogger.info(`启动脚本流水线 [${workflow.name}]`, { scriptBytes: script.length }, { taskId: task.id });

    const run: RunningScript = {
      taskId: task.id,
      task,
      child: undefined as unknown as ChildProcess,
      abort: new AbortController(),
      pending: new Map(),
      stepSeq: 0,
      currentStepId: 'SCRIPT',
      steps: new StepLog(this.store, this.host),
      done: false,
      exitCode: null,
    };

    const cwd = task.workspace || workflow.defaultWorkspace || process.cwd();
    const child = spawn(process.execPath, [bootstrap, scriptPath, contextPath], {
      cwd,
      env: {
        ...process.env,
        OPENLOOP_TASK_ID: task.id,
        OPENLOOP_WORKFLOW_ID: workflow.id,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    run.child = child;
    // 子进程被终止时写通道会抛 EPIPE，吞掉以免冲垮主服务
    child.stdin?.on('error', () => {});
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    this.runs.set(task.id, run);
    this.host.registerChildProcess?.(task.id, child);

    const stdout = readline.createInterface({ input: child.stdout! });
    const stderr = readline.createInterface({ input: child.stderr! });
    stderr.on('line', (line) => {
      if (line.trim()) this.host.log(task.id, run.currentStepId, 'stderr', line);
    });

    const onMessage = async (line: string) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === 'log') {
        this.host.log(task.id, run.currentStepId, msg.stream === 'stderr' ? 'stderr' : 'stdout', String(msg.message ?? ''));
        return;
      }
      if (msg.type === 'request') {
        let value: any = null;
        let ok = true;
        let error = '';
        try {
          value = await this.handleRequest(task, workflow, run, msg.api, msg.args || []);
        } catch (err: any) {
          ok = false;
          error = err?.message || String(err);
        }
        this.send(run, { type: 'response', id: msg.id, ok, value, error });
        return;
      }
      if (msg.type === 'done') {
        this.finalize(task, workflow, run, msg.result);
      }
    };
    stdout.on('line', (line) => {
      void onMessage(line);
    });

    child.on('exit', (code) => {
      run.exitCode = code;
      stdout.close();
      stderr.close();
      if (!run.done) {
        const failed = code !== 0 || run.abort.signal.aborted;
        this.finalize(task, workflow, run, {
          status: failed ? 'failed' : 'success',
          error: run.abort.signal.aborted ? '任务已被用户终止' : `脚本进程退出码 ${code}`,
        });
      } else {
        this.runs.delete(task.id);
      }
    });

    child.on('error', (err) => {
      scriptLogger.error(`脚本进程启动失败: ${err.message}`, err, { taskId: task.id });
      this.finalize(task, workflow, run, { status: 'failed', error: err.message });
    });

    // 保持 Promise 直到脚本结束或挂起在人工卡点
    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
      child.on('error', () => resolve());
    });
  }

  /** 终止脚本流水线进程 */
  cancel(taskId: string): boolean {
    const run = this.runs.get(taskId);
    if (!run) return false;
    run.abort.abort();
    const pid = run.child.pid;
    if (pid) {
      try {
        if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
        else run.child.kill('SIGKILL');
      } catch {}
    }
    this.runs.delete(taskId);
    return true;
  }

  isRunning(taskId: string): boolean {
    return this.runs.has(taskId);
  }
}
