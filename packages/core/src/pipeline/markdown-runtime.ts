import { Store } from '../store';
import { Task, WorkflowDefinition, WorkflowNode } from '../types';
import { ExecutorRegistry, ExecutionResult } from '../executors';
import { PiSessionInstance } from '../agent/pi-session';
import { WorktreeManager, TaskProcessManager } from '../worktree/worktree-manager';
import { createLogger } from '../logger';
import { PipelineHost, StepLog, buildNodeContext, captureWorktreeDiff } from './pipeline-host';

const markdownLogger = createLogger('MarkdownPipeline');

/** Markdown 流水线的文件头信息 */
export interface MarkdownPipelineMeta {
  /** 流水线 id，仓库里的文件头用；数据库里的记录是运行时副本 */
  id: string;
  /** 流水线名称，缺省回落到数据库里的名称 */
  name: string;
  tags: string[];
  /** 流程正文，去掉文件头后的全部内容 */
  body: string;
}

/**
 * 解析 Markdown 流水线。
 * 文件头只承载身份信息（name / tags），正文是人工写的流程说明，不解析成步骤。
 */
export function parseMarkdownPipeline(raw: string, fallbackName = ''): MarkdownPipelineMeta {
  const text = (raw || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const meta: MarkdownPipelineMeta = { id: '', name: fallbackName, tags: [], body: text.trim() };
  if (lines[0]?.trim() !== '---') return meta;

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return meta;

  for (const line of lines.slice(1, end)) {
    const hit = /^([A-Za-z][\w-]*)\s*:\s*(.+)$/.exec(line.trim());
    if (!hit) continue;
    const [, key, value] = hit;
    if (key === 'id') meta.id = value.trim();
    if (key === 'name') meta.name = value.trim();
    if (key === 'tags') {
      meta.tags = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  meta.body = lines.slice(end + 1).join('\n').trim();
  return meta;
}

/** 编排 Agent 可用的工具，同时是会话的工具白名单 */
const TOOL_NAMES = [
  'sandbox_create',
  'run_command',
  'agent_task',
  'run_node',
  'ask_human',
  'sandbox_merge',
  'sandbox_cleanup',
  'finish_pipeline',
];

interface MarkdownRun {
  task: Task;
  workflow: WorkflowDefinition;
  abort: AbortController;
  steps: StepLog;
  /** 流程文档声明的步骤标题，编排 Agent 只能在它们之内推进 */
  stepTitles: string[];
  seq: number;
  session?: PiSessionInstance;
  approval?: { stepId: string; deliver: (value: any) => void };
  finish?: () => void;
  done: boolean;
}

const SIMPLE_STRING = { type: 'string' } as const;
const STRING_LIST = { type: 'array', items: { type: 'string' } } as const;

/** 文档声明的步骤：流程文档里的二级标题 */
function extractStepTitles(body: string): string[] {
  const titles: string[] = [];
  for (const line of (body || '').split('\n')) {
    const hit = /^##\s+(.+?)\s*$/.exec(line);
    if (hit) titles.push(hit[1].trim());
  }
  return titles;
}

/** 步骤名比对键：去掉行首序号与全部空白，忽略大小写 */
function stepKey(name: string): string {
  return String(name || '')
    .replace(/^\s*\d+\s*[.、)]\s*/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 调用声明的步骤名是否属于流程文档（允许省略标题尾部的括号注释） */
function isDeclaredStep(titles: string[], name: string): boolean {
  const key = stepKey(name);
  if (key.length < 2) return false;
  return titles.some((title) => {
    const declared = stepKey(title);
    if (!declared) return false;
    return declared === key || declared.startsWith(key) || key.startsWith(declared);
  });
}

/**
 * 文档变量渲染：只替换当前已知的值，未解析的占位符原样保留。
 * 沙箱端口这类值建完沙箱才有，交给编排 Agent 从工具返回里取值。
 */
function renderDoc(body: string, variables: Record<string, any>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (raw, key: string) => {
    let value: any = variables;
    for (const part of key.split('.')) {
      if (value === undefined || value === null) return raw;
      value = value[part];
    }
    return value === undefined || value === null ? raw : String(value);
  });
}

/** 编排 Agent 的操作说明：追加在人工文档之后，人工只写流程本身 */
function composePrompt(task: Task, body: string): string {
  return `你是 openLoop 的流水线编排 Agent。按下面这份 Markdown 流程文档逐个步骤执行，直到流程结束。

【任务】
- 标题：${task.title}
- 说明：${task.description || '（无）'}
- 工作区：${task.workspace || '（未绑定工程目录）'}

【流程文档】
${body}

【执行约定】
1. 只能通过工具执行动作：sandbox_create、run_command、agent_task、run_node、ask_human、sandbox_merge、sandbox_cleanup。
2. 文档里的二级标题（##）是一个步骤，其余标题只是分节；调用工具时把步骤标题传给 name，界面按它显示步骤名。
3. 文档要求的硬门禁必须遵守：工具返回 status=failed 且文档写「失败就停」时，直接调用 finish_pipeline 并给出失败原因，不继续后续步骤。
4. 全部步骤完成且通过后，调用 finish_pipeline(status="success")。
5. 行内代码里的命令、端口、超时按原文使用，不要改写。
6. 文档里 {{ports.xxx}} 这类占位符在建沙箱后才有效：用 sandbox_create 返回的真实端口替换，不要留空。
7. 不确定下一步时，用 ask_human 让人类决定，不要自行猜测。
8. 只能在流程文档声明的步骤内推进：工具调用的 name 必须使用文档里的步骤标题原文。文档没写的诊断、校验、排查类动作一律不要执行，系统会直接拒绝并且不会产生节点。
9. 步骤返回 skipped 属于正常结果（例如任务没有配置验收用例），按文档继续执行下一个步骤，不要为它排查原因或补充步骤。`;
}

function describeStep(name: string, result: ExecutionResult): string {
  const lines = [`步骤「${name}」结果：${result.status}`];
  if (result.error) lines.push(`失败原因：${result.error}`);
  if (result.output !== undefined && result.output !== null) {
    const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    lines.push(`输出：${output.slice(0, 4000)}`);
  }
  return lines.join('\n');
}

/**
 * Markdown 流水线运行时：一条流水线 = 一份人工说明的流程文档。
 * 编排 Agent 读文档，通过受控工具驱动执行器；每次工具调用落一条步骤记录。
 */
export class MarkdownRuntime {
  private runs = new Map<string, MarkdownRun>();

  constructor(
    private store: Store,
    private registry: ExecutorRegistry,
    private host: PipelineHost
  ) {}

  async run(task: Task, workflow: WorkflowDefinition): Promise<void> {
    const raw = (workflow.markdown || '').trim();
    if (!raw) throw new Error('Markdown 流水线缺少流程内容');
    if (this.runs.has(task.id)) {
      markdownLogger.warn(`Markdown 流水线已在运行，忽略重复启动: ${task.id}`, undefined, { taskId: task.id });
      return;
    }

    const meta = parseMarkdownPipeline(raw, workflow.name);
    task.status = 'running';
    task.nodeRuns = {};
    task.kanbanColumn = 'in_progress';
    this.store.saveTask(task);
    this.host.emit('task:update', task);
    this.host.log(task.id, 'SCRIPT', 'system', `========== 启动 Markdown 流水线 [${workflow.name}] ==========`);
    this.host.log(task.id, 'SCRIPT', 'system', `[流程文档] ${meta.body.split('\n').length} 行，${meta.body.length} 字符`);
    markdownLogger.info(`启动 Markdown 流水线 [${workflow.name}]`, { chars: meta.body.length }, { taskId: task.id });

    const run: MarkdownRun = {
      task,
      workflow,
      abort: new AbortController(),
      steps: new StepLog(this.store, this.host),
      stepTitles: extractStepTitles(meta.body),
      seq: 0,
      done: false,
    };
    this.runs.set(task.id, run);

    await new Promise<void>((resolve) => {
      run.finish = resolve;
      this.start(run, meta.body).catch((err: any) => {
        markdownLogger.error(`Markdown 流水线启动失败: ${err?.message}`, err, { taskId: task.id });
        this.settle(run, { status: 'failed', error: err?.message || String(err) });
      });
    });
  }

  private async start(run: MarkdownRun, body: string): Promise<void> {
    const { task, workflow } = run;
    const settings = this.store.getSettings();
    const variables = {
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
    };

    const session = new PiSessionInstance({
      taskId: task.id,
      taskTitle: task.title,
      // 每次运行用独立会话：重跑必须重新读文档执行，不能续用上一轮的历史
      sessionId: `${task.id}_orchestrator_${Date.now().toString(36)}`,
      agentName: '流水线编排 Agent',
      model: settings.defaultModel,
      thinking: settings.reasoningLevel || 'high',
      cwd: task.workspace || workflow.defaultWorkspace || process.cwd(),
      tools: TOOL_NAMES.join(','),
      customTools: this.buildTools(run),
      initialPrompt: composePrompt(task, renderDoc(body, variables)),
      awaitCompletionMarker: false,
      onLog: (stream, message) => this.host.log(task.id, run.steps.current || 'SCRIPT', stream, message),
      onFinished: (error) => {
        if (error) {
          this.settle(run, { status: 'failed', error });
          return;
        }
        this.settle(run, { status: 'failed', error: '编排 Agent 未声明流程结束（未调用 finish_pipeline）' });
      },
    });
    run.session = session;

    run.abort.signal.addEventListener('abort', () => {
      session.terminate();
    });
  }

  /** 编排约束：只允许执行流程文档声明的步骤，禁止运行期自行新增节点 */
  private guardStep(run: MarkdownRun, tool: string, name: string): string | null {
    if (run.stepTitles.length === 0) return null;
    if (isDeclaredStep(run.stepTitles, name)) return null;

    markdownLogger.warn(
      `拒绝执行流程文档未声明的步骤: ${name}`,
      { tool, allowed: run.stepTitles },
      { taskId: run.task.id }
    );
    this.host.log(
      run.task.id,
      run.steps.current || 'SCRIPT',
      'stderr',
      `[编排约束] 拒绝执行文档未声明的步骤「${name}」(${tool})`
    );
    return [
      `已拒绝：流程文档里没有名为「${name}」的步骤。本次调用未执行，也没有产生节点。`,
      '流水线只允许执行文档声明的步骤，不能自行新增诊断、校验或排查步骤。',
      `文档共声明 ${run.stepTitles.length} 个步骤，按顺序为：`,
      ...run.stepTitles.map((title, index) => `${index + 1}. ${title}`),
      '请改用上面步骤标题的原文重新调用。如果文档确实缺少必要步骤，请调用 finish_pipeline(status="failed") 说明原因，或改用 ask_human 交给人决定，不要反复重试。',
    ].join('\n');
  }

  /** 执行一个内置步骤：落步骤记录，把结果交回编排 Agent */
  private async runStep(run: MarkdownRun, type: string, name: string, config: Record<string, any>) {
    const { task, workflow } = run;
    if (run.done) return { status: 'failed' as const, error: '流水线已结束', output: null };

    const stepId = run.steps.begin(task, type, name, ++run.seq);
    const node = { id: stepId, type, name, config } as WorkflowNode;

    let result: ExecutionResult;
    try {
      result = await this.registry.get(type).execute(
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
      markdownLogger.error(`Markdown 步骤执行异常: ${err?.message}`, err, { taskId: task.id, nodeId: stepId });
      result = { status: 'failed', exitCode: 1, error: err?.message || String(err) };
    }

    run.steps.end(task, stepId, type, name, result);
    return result;
  }

  /** 人工卡点：挂起工具调用，等界面作出决策 */
  private async waitApproval(run: MarkdownRun, options: Record<string, any>): Promise<string> {
    const { task } = run;
    const title = options.title || options.name || '人工验收';
    const stepId = run.steps.begin(task, 'qa-approval', title, ++run.seq);

    // 卡点即待验收泳道：看板依据 kanbanColumn 分流，缺这一步任务会一直停在执行中
    task.status = 'waiting_approval';
    task.kanbanColumn = 'qa_review';
    task.currentNodeId = stepId;
    task.nodeRuns[stepId].status = 'waiting_approval';
    task.nodeRuns[stepId].output = {
      stepName: title,
      stepType: 'qa-approval',
      approvalPrompt: options.prompt || '',
      checklist: Array.isArray(options.checklist) ? options.checklist : [],
      artifacts: [],
      worktree: captureWorktreeDiff(task),
    };
    this.store.saveTask(task);
    this.host.emit('task:update', task);
    this.host.emit('node:status', { taskId: task.id, nodeId: stepId, status: 'waiting_approval' });
    this.host.log(task.id, stepId, 'system', `[人工卡点] ${title}：等待验收决策`);

    const decided = await new Promise<{ approved: boolean; feedback: string }>((resolve) => {
      run.approval = { stepId, deliver: resolve };
    });
    return decided.approved
      ? `人工验收已通过。反馈：${decided.feedback || '无'}`
      : `人工验收被驳回。驳回意见：${decided.feedback || '未填写'}。流水线已终止。`;
  }

  /** 用户作出验收决策：唤醒挂起的编排 Agent，返回是否命中了 Markdown 卡点 */
  resolveApproval(taskId: string, approved: boolean, feedback?: string): boolean {
    const run = this.runs.get(taskId);
    if (!run?.approval) return false;
    if (this.store.getTask(taskId)?.status === 'cancelled') return false;

    const { task } = run;
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
    // 通过后编排继续推进，回到执行中泳道；驳回则打回待处理
    task.status = approved ? 'running' : 'failed';
    task.kanbanColumn = approved ? 'in_progress' : 'backlog';

    // 决策后关停沙箱靶机进程，释放端口，避免遗留孤儿服务
    try {
      TaskProcessManager.stopAll(task.id);
      if (task.context?.worktree?.webPort) {
        WorktreeManager.getInstance().killPortIfBusy(task.context.worktree.webPort);
      }
    } catch {}

    this.store.saveTask(task);
    this.host.emit('task:update', task);
    this.host.emit('node:status', { taskId, nodeId: stepId, status: approved ? 'success' : 'failed' });

    deliver({ approved, feedback: feedback || '' });
    if (!approved) {
      this.settle(run, { status: 'failed', error: feedback || '人工验收驳回' });
    }
    return true;
  }

  /** 结束一次运行：写终态、回收沙箱服务、唤醒等待中的 run() */
  private settle(run: MarkdownRun, outcome: { status: 'success' | 'failed'; error?: string }): void {
    if (run.done) return;
    run.done = true;
    const { task, workflow } = run;
    const cancelled =
      run.abort.signal.aborted || this.store.getTask(task.id)?.status === 'cancelled';
    const failed = !cancelled && outcome.status === 'failed';

    if (cancelled) {
      task.status = 'cancelled';
      task.kanbanColumn = 'backlog';
    } else if (failed) {
      task.status = 'failed';
      task.kanbanColumn = 'backlog';
      if (!task.context) task.context = {};
      task.context.markdownError = outcome.error || '流水线执行失败';
    } else {
      task.status = 'completed';
      task.kanbanColumn = 'done';
      delete task.context?.markdownError;
    }

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
      failed || cancelled ? 'stderr' : 'system',
      failed || cancelled
        ? `========== Markdown 流水线 [${workflow.name}] 执行失败: ${outcome.error || '任务已终止'} ==========`
        : `========== Markdown 流水线 [${workflow.name}] 执行完成 ==========`
    );
    this.runs.delete(task.id);
    run.finish?.();
    setTimeout(() => run.session?.terminate(), 0);
  }

  /** 终止运行中的 Markdown 流水线 */
  cancel(taskId: string): boolean {
    const run = this.runs.get(taskId);
    if (!run) return false;
    run.abort.abort();
    run.session?.terminate();
    this.settle(run, { status: 'failed', error: '任务已被用户终止' });
    return true;
  }

  isRunning(taskId: string): boolean {
    return this.runs.has(taskId);
  }

  /** 工具定义：会话只暴露这些能力，编排 Agent 无法直接改代码或跑任意进程 */
  private buildTools(run: MarkdownRun): any[] {
    // 工具对象里的 this 指向工具自身，这里用闭包固定运行时
    const runtime = this;
    const stepName = (params: any, fallback: string) =>
      typeof params?.name === 'string' && params.name.trim() ? params.name.trim() : fallback;

    const stepTool = (options: {
      name: string;
      label: string;
      description: string;
      parameters: Record<string, any>;
      run: (params: any) => Promise<{ type: string; name: string; config: Record<string, any> }>;
    }) =>
      ({
        name: options.name,
        label: options.label,
        description: options.description,
        parameters: options.parameters,
        promptSnippet: options.description,
        async execute(_toolCallId: string, params: any) {
          const plan = await options.run(params || {});
          const rejected = runtime.guardStep(run, options.name, plan.name);
          if (rejected) return { content: [{ type: 'text', text: rejected }] };
          const result = await runtime.runStep(run, plan.type, plan.name, plan.config);
          return { content: [{ type: 'text', text: describeStep(plan.name, result) }] };
        },
      }) as any;

    return [
      stepTool({
        name: 'sandbox_create',
        label: '建沙箱',
        description: '建立隔离 worktree 沙箱：分配端口、共享依赖，成功后任务工作区切换到沙箱目录。',
        parameters: {
          type: 'object',
          properties: {
            name: SIMPLE_STRING,
            sharedPaths: STRING_LIST,
            allocatePorts: STRING_LIST,
            basePort: { type: 'number' },
            portBases: { type: 'object' },
            timeoutSec: { type: 'number' },
          },
        },
        run: async (params) => ({
          type: 'worktree-setup',
          name: stepName(params, '沙箱就绪'),
          config: {
            sharedPaths: params.sharedPaths,
            allocatePorts: params.ports || params.allocatePorts,
            basePort: params.basePort,
            portBases: params.portBases,
          },
        }),
      }),
      stepTool({
        name: 'run_command',
        label: '执行命令',
        description: '在工作区执行一条 shell 命令，返回退出码与输出。',
        parameters: {
          type: 'object',
          properties: { name: SIMPLE_STRING, command: SIMPLE_STRING, timeoutSec: { type: 'number' } },
          required: ['command'],
        },
        run: async (params) => ({
          type: 'cli',
          name: stepName(params, `命令: ${String(params.command || '').slice(0, 60)}`),
          config: { command: String(params.command || ''), timeoutSec: params.timeoutSec },
        }),
      }),
      stepTool({
        name: 'agent_task',
        label: 'AI Agent',
        description: '起一轮 Agent 会话执行编码或分析任务，Agent 声明完成后返回。',
        parameters: {
          type: 'object',
          properties: {
            name: SIMPLE_STRING,
            prompt: SIMPLE_STRING,
            agentName: SIMPLE_STRING,
            cwd: SIMPLE_STRING,
            timeoutSec: { type: 'number' },
          },
          required: ['prompt'],
        },
        run: async (params) => ({
          type: 'agent',
          name: stepName(params, params.agentName || 'AI Agent'),
          config: {
            prompt: String(params.prompt || ''),
            agentName: params.agentName,
            cwd: params.cwd,
            timeoutSec: params.timeoutSec,
          },
        }),
      }),
      stepTool({
        name: 'run_node',
        label: '通用节点',
        description: '执行任意注册节点类型：qa-planner、midscene、env-prepare、hook、stitch-image 等。',
        parameters: {
          type: 'object',
          properties: { name: SIMPLE_STRING, type: SIMPLE_STRING, config: { type: 'object' } },
          required: ['type'],
        },
        run: async (params) => ({
          type: String(params.type || ''),
          name: stepName(params, `节点: ${params.type}`),
          config: { ...(params.config || {}) },
        }),
      }),
      stepTool({
        name: 'sandbox_merge',
        label: '合并代码',
        description: '把沙箱特性分支合并回本地开发分支。',
        parameters: { type: 'object', properties: { name: SIMPLE_STRING } },
        run: async (params) => ({
          type: 'worktree-merge',
          name: stepName(params, '合并代码'),
          config: {},
        }),
      }),
      stepTool({
        name: 'sandbox_cleanup',
        label: '清理沙箱',
        description: '释放沙箱端口与临时目录。',
        parameters: { type: 'object', properties: { name: SIMPLE_STRING } },
        run: async (params) => ({
          type: 'worktree-cleanup',
          name: stepName(params, '清理沙箱'),
          config: {},
        }),
      }),
      {
        name: 'ask_human',
        label: '人工卡点',
        description: '提交人工验收并挂起，等人类通过或驳回。通过后继续，驳回则整条流水线终止。',
        parameters: {
          type: 'object',
          properties: {
            name: SIMPLE_STRING,
            title: SIMPLE_STRING,
            prompt: SIMPLE_STRING,
            checklist: STRING_LIST,
          },
          required: ['title'],
        },
        promptSnippet: '提交人工验收卡点',
        async execute(_toolCallId: string, params: any) {
          const title = String(params?.title || params?.name || '');
          const rejected = runtime.guardStep(run, 'ask_human', title);
          if (rejected) return { content: [{ type: 'text', text: rejected }] };
          const text = await runtime.waitApproval(run, params || {});
          return { content: [{ type: 'text', text }] };
        },
      },
      {
        name: 'finish_pipeline',
        label: '结束流水线',
        description: '声明整条流水线结束。成功必须所有步骤通过；失败给出原因。',
        parameters: {
          type: 'object',
          properties: { status: { type: 'string', enum: ['success', 'failed'] }, reason: SIMPLE_STRING },
          required: ['status'],
        },
        promptSnippet: '结束流水线并声明结果',
        async execute(_toolCallId: string, params: any) {
          const ok = params?.status !== 'failed';
          const reason = typeof params?.reason === 'string' ? params.reason : '';
          setTimeout(() => runtime.settle(run, { status: ok ? 'success' : 'failed', error: reason }), 0);
          return {
            content: [{ type: 'text', text: ok ? '流水线已结束：成功' : `流水线已结束：失败（${reason || '未给出原因'}）` }],
          };
        },
      },
    ];
  }
}
