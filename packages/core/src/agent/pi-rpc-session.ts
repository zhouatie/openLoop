import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  PendingUserInput,
  SessionChatMessage,
  ToolExecutionRecord,
  TaskSessionState,
  Task,
  TaskAttachment,
  RuntimeSettingsPatch,
  RuntimeSettingsApplyResult,
  RuntimeSettingsApplySummary,
} from '../types';
import { createLogger } from '../logger';
import { compactToolResult } from './agent-format';
import {
  AgentStatusEvent,
  AgentStreamEvent,
  classifyToolKind,
  compactToolForEvent,
  compactUsage,
} from './agent-events';

const logger = createLogger('PiRpcSession');

/** Agent 显式声明完成的标记：只有输出该标记，流水线才允许流转到下一个节点 */
export const PIPELINE_DONE_MARKER = '[OPENLOOP_DONE]';

/**
 * 全量快照限频间隔
 * 流式期间增量事件逐包推送，快照只负责对账，不需要跟每个 token 同步。
 */
const PI_SNAPSHOT_INTERVAL_MS = 120;

/**
 * 会话树导航桥：pi 的 RPC 协议没有暴露 navigateTree，只能通过扩展命令触发
 * 编译产物与本文件同目录树，跟着 dist 一起分发。
 */
const TREE_EXTENSION_PATH = path.join(__dirname, 'extensions', 'openloop-tree.js');
/** 内部命令名：与 extension 里 registerCommand 的名字一致 */
const TREE_COMMAND = 'openloop-tree';

/** 工具入参摘要：只保留可展示的原始字段，供工具卡直接渲染 */
function summarizeToolInput(args: any): Record<string, any> | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const summary: Record<string, any> = {};
  let count = 0;
  for (const [key, value] of Object.entries(args)) {
    if (count >= 20) break;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      summary[key] = value.length > 500 ? `${value.slice(0, 500)}…` : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      summary[key] = value;
    }
    count += 1;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

/** 单张内联图片上限，超过则不给工具卡内联，避免快照体积失控 */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_IMAGES = 4;

/** 工具结果里的图片块转成可渲染的 data URL（截图类工具的预览来源） */
function resultImageUrls(result: any): string[] {
  const content = Array.isArray(result?.content) ? result.content : [];
  const urls: string[] = [];
  for (const block of content) {
    if (urls.length >= MAX_INLINE_IMAGES) break;
    if (!block || block.type !== 'image' || typeof block.data !== 'string') continue;
    const data = block.data;
    if (!data || data.length > MAX_INLINE_IMAGE_BYTES) continue;
    urls.push(`data:${block.mimeType || 'image/png'};base64,${data}`);
  }
  return urls;
}

export interface PiRpcSessionOptions {
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  sessionId: string;
  agentName?: string;
  model?: string;
  thinking?: string;
  tools?: string;
  /** 排除的工具列表，逗号分隔，例如 'edit,write' */
  excludeTools?: string;
  /** 关闭全部工具，仅进行纯文本推理（一次性规划场景） */
  disableTools?: boolean;
  cwd?: string;
  env?: Record<string, string>;
  initialPrompt: string;
  initialAttachments?: TaskAttachment[];
  /** 流水线节点场景：Agent 未输出完成标记时停留在本节点等待用户回复，不自动流转下游 */
  awaitCompletionMarker?: boolean;
  /**
   * 是否在进程启动后自动发送 initialPrompt
   * 历史会话浏览、纯面板打开场景传 false，等用户手动发消息再启动轮次
   */
  autoStart?: boolean;
  onLog?: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
  onUpdate?: (state: TaskSessionState) => void;
  /** 增量事件回调：流式期间只推变化部分，全量快照由 onUpdate 限频兜底 */
  onEvent?: (event: AgentStreamEvent) => void;
  onFinished?: (error?: string) => void;
}

export class PiRpcSessionInstance extends EventEmitter {
  public taskId: string;
  public sessionId: string;
  public agentName: string;
  public model?: string;
  public messages: SessionChatMessage[] = [];
  public isBusy: boolean = false;
  public isPaused: boolean = false;
  /** 本轮已结束但 Agent 未声明完成，正在等待用户回复 */
  public awaitingInput: boolean = false;
  public active: boolean = true;
  public thinking?: string;
  public pendingModel?: string;
  public modelError?: string;
  public lastError?: string;
  /** 本轮（一次用户提交）开始时间，运行中用于显示用时 */
  public turnStartedAt?: number;
  /** 上一轮从开始到结束的用时（毫秒） */
  public lastTurnDurationMs?: number;
  /**
   * 进程内导航后的叶子条目：pi 切换分支只改内存里的指针，不写文件，
   * 因此必须由 openLoop 记住，否则读盘会读到被放弃的分支。
   * undefined=跟文件末尾一致（pi 重启后的语义），null=已回退到会话起点。
   */
  public leafEntryId?: string | null;

  private modelPattern?: string;
  private pendingThinking?: string;
  private modelsCache: Array<{ id: string; provider: string }> | null = null;
  private switching = false;
  private child: ChildProcess | null = null;
  private cmdSeq = 0;
  private pendingCommands = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private stdoutBuffer = '';
  private onLog?: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
  private onUpdateCallback?: (state: TaskSessionState) => void;
  private onEventCallback?: (event: AgentStreamEvent) => void;
  private onFinishedCallback?: (error?: string) => void;
  private currentAssistantMessage: SessionChatMessage | null = null;
  /** 本地回显层：已提交、等待 pi 采纳的用户输入 */
  private pendingInputs: PendingUserInput[] = [];
  private initialPromptSent = false;
  private executionCompleted = false;
  private awaitCompletionMarker: boolean;
  private doneMarkerSeen = false;
  /** 当前轮次序号（从 1 开始） */
  private turnSeq = 0;
  /** 全量快照限频：首个事件立即发，之后最多每 120ms 一包 */
  private snapshotTimer?: NodeJS.Timeout;
  private snapshotPending = false;
  /** 增量事件计数，仅供开发环境采样日志 */
  private eventSeq = 0;
  /** 会话树桥最近一次报错，供 navigateTo / fork 判定成败 */
  private treeBridgeError?: string;
  /** 桥是否已随子进程装载：没装载时斜杠命令会被当成普通提问发给模型 */
  private treeBridgeReady = false;

  constructor(options: PiRpcSessionOptions) {
    super();
    this.taskId = options.taskId;
    this.sessionId = options.sessionId;
    this.agentName = options.agentName || 'OpenLoop Agent';
    this.model = options.model;
    this.modelPattern = options.model?.trim() || undefined;
    this.thinking = options.thinking;
    this.onLog = options.onLog;
    this.onUpdateCallback = options.onUpdate;
    this.onEventCallback = options.onEvent;
    this.onFinishedCallback = options.onFinished;
    this.awaitCompletionMarker = options.awaitCompletionMarker === true;

    this.spawnRpcProcess(options);
  }

  private spawnRpcProcess(options: PiRpcSessionOptions) {
    const args: string[] = ['--mode', 'rpc', '--session-id', options.sessionId];
    // 有真实标题才写会话名：空标题会污染 pi 的 session_info，挡住后续 AI 命名
    if (options.taskTitle && options.taskTitle.trim()) {
      args.push('--name', `openLoop: ${options.taskTitle.trim().slice(0, 50)}`);
    }

    if (options.model && options.model.trim()) {
      args.push('--model', options.model.trim());
    }
    if (options.thinking && options.thinking !== 'off') {
      args.push('--thinking', options.thinking);
    }
    if (options.tools && options.tools.trim()) {
      args.push('--tools', options.tools.trim());
    }
    if (options.excludeTools && options.excludeTools.trim()) {
      args.push('--exclude-tools', options.excludeTools.trim());
    }
    if (options.disableTools) {
      args.push('--no-tools');
    }
    // 会话树桥：只在脚本存在时装载，缺失时导航与分叉直接报错，不改发模型请求
    this.treeBridgeReady = fs.existsSync(TREE_EXTENSION_PATH);
    if (this.treeBridgeReady) {
      args.push('--extension', TREE_EXTENSION_PATH);
    }

    const cwd = options.cwd || os.tmpdir();
    const nodeBinDir = path.dirname(process.execPath);
    const extraPath = [
      nodeBinDir,
      path.join(os.homedir(), '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ].join(':');
    const env = {
      ...process.env,
      PATH: `${extraPath}:${process.env.PATH || ''}`,
      ...(options.env || {}),
    };

    logger.info(`启动 Pi RPC 会话进程: pi ${args.join(' ')} (CWD: ${cwd})`, undefined, {
      taskId: this.taskId,
    });
    this.emitLog('system', `[Pi RPC] 建立长连接 Agent 会话 (Session: ${this.sessionId})`);

    const isUnix = process.platform !== 'win32';
    this.child = spawn('pi', args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: isUnix,
    });

    if (this.child.stdout) {
      this.child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    }

    if (this.child.stderr) {
      this.child.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) {
          // 过滤 pi CLI 初始分配新 session 时的正常初始化提示，避免在界面终端显示红色 Warning
          if (text.includes('No project session found with id') && text.includes('creating a new session with that id')) {
            logger.debug(`[Pi RPC] 首次会话初始化提示已静默: ${text}`);
            return;
          }
          this.emitLog('stderr', text);
        }
      });
    }

    this.child.on('error', (err) => {
      logger.error(`Pi RPC 进程启动失败: ${err.message}`, undefined, { taskId: this.taskId });
      this.emitLog('stderr', `[Pi RPC 异常] ${err.message}`);
      this.active = false;
      this.emitStatus({ active: false });
      this.notifyUpdate(true);
      if (this.onFinishedCallback && !this.executionCompleted) {
        this.executionCompleted = true;
        this.onFinishedCallback(err.message);
      }
    });

    this.child.on('close', (code) => {
      logger.info(`Pi RPC 进程退出，退出码: ${code}`, undefined, { taskId: this.taskId });
      this.active = false;
      this.isBusy = false;
      this.clearPendingInputs();
      this.finishTurn();
      this.emitStatus({ active: false, isBusy: false, turnStartedAt: this.turnStartedAt });
      this.notifyUpdate(true);
      if (this.onFinishedCallback && !this.executionCompleted) {
        this.executionCompleted = true;
        this.onFinishedCallback(code === 0 ? undefined : `Process exited with code ${code}`);
      }
    });

    // 进程建立后，发送初始 Prompt
    if (options.autoStart === false) {
      return;
    }
    setTimeout(() => {
      if (this.active && !this.initialPromptSent) {
        this.initialPromptSent = true;
        this.sendPrompt(options.initialPrompt, options.initialAttachments).catch((err) => {
          const errMsg = err?.message || '发送初始 Prompt 失败';
          logger.error(`发送初始 Prompt 失败: ${errMsg}`, undefined, { taskId: this.taskId });
          this.emitLog('stderr', `[Agent 报错] ${errMsg}`);
          this.lastError = errMsg;
          if (this.onFinishedCallback && !this.executionCompleted) {
            this.executionCompleted = true;
            this.awaitingInput = false;
            this.onFinishedCallback(errMsg);
          }
        });
      }
    }, 400);
  }

  /**
   * 登记本地回显：气泡立即出现，但只属于回显层，不进会话流
   * 会话流只由 pi 的 message_start 驱动，两边不会重复。
   */
  private queuePendingInput(
    content: string,
    attachments: TaskAttachment[] | undefined,
    placement: PendingUserInput['placement']
  ) {
    if (!content.trim()) return;
    logger.debug(`登记本地回显 (${placement}): "${content.slice(0, 40)}"`, undefined, { taskId: this.taskId });
    this.pendingInputs = [
      ...this.pendingInputs,
      {
        id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        content,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
        placement,
        createdAt: Date.now(),
      },
    ];
    this.emitPending();
  }

  /**
   * pi 采纳某条输入时取出对应的本地回显
   * 回显文本可能追加【用户随附参考图片】说明，所以按前缀匹配。
   */
  private takePendingInput(content: string): PendingUserInput | null {
    if (!content) return null;
    const index = this.pendingInputs.findIndex(
      (pending) => content === pending.content || content.startsWith(pending.content)
    );
    if (index < 0) return null;
    const taken = this.pendingInputs[index];
    this.pendingInputs = this.pendingInputs.filter((_, i) => i !== index);
    logger.debug(`本地回显已被 Agent 采纳: "${content.slice(0, 40)}"`, undefined, { taskId: this.taskId });
    return taken;
  }

  /** 清空本地回显层（采纳、中止或会话被清空时调用） */
  public clearPendingInputs() {
    if (this.pendingInputs.length === 0) return;
    this.pendingInputs = [];
    this.emitPending();
  }

  private emitPending() {
    this.emitEvent({ kind: 'pending', taskId: this.taskId, pendingInputs: [...this.pendingInputs] });
  }

  /** 记录本轮开始时间；一次用户提交可能含多个 turn（工具调用），只在首个 turn 定时 */
  private markTurnStart() {
    if (this.turnStartedAt === undefined) this.turnStartedAt = Date.now();
  }

  /** 本轮结束：冻结用时，供界面显示「已完成，用时 N 秒」 */
  private finishTurn() {
    if (this.turnStartedAt === undefined) return;
    this.lastTurnDurationMs = Date.now() - this.turnStartedAt;
    this.turnStartedAt = undefined;
  }

  private emitLog(stream: 'stdout' | 'stderr' | 'system', message: string) {
    if (this.onLog) {
      this.onLog(stream, message);
    }
  }

  /** 抹除完成标记，标记仅用于流水线判定，不展示在会话气泡中 */
  private stripDoneMarker(text: string): string {
    if (!text.includes(PIPELINE_DONE_MARKER)) return text;
    return text.split(PIPELINE_DONE_MARKER).join('').replace(/\n{3,}/g, '\n\n').trimEnd();
  }

  private handleStdout(chunk: Buffer) {
    this.stdoutBuffer += chunk.toString('utf-8');
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed);
        this.handleRpcRecord(record);
      } catch (_) {
        // 非 JSON 格式普通日志输出
        this.emitLog('stdout', trimmed);
      }
    }
  }

  /** 扩展 UI 请求：approval 卡片等交互，由上层接管渲染与回应 */
  public respondExtensionUi(id: string, response: { value?: string; confirmed?: boolean; cancelled?: boolean }) {
    const payload: any = { type: 'extension_ui_response', id, ...response };
    try {
      this.child?.stdin?.write(`${JSON.stringify(payload)}\n`);
    } catch (err) {
      this.emitLog('system', `[Pi RPC] 扩展 UI 回应失败: ${String(err)}`);
    }
  }

  private handleRpcRecord(record: any) {
    // 0. 扩展报错：会话树导航桥的失败要能被上层感知，不能静默
    if (record.type === 'extension_error') {
      const source = String(record.extensionPath || '');
      if (source.includes(TREE_COMMAND)) {
        this.treeBridgeError = String(record.error || '会话树导航失败');
        this.emitLog('stderr', `[会话树] ${this.treeBridgeError}`);
        return;
      }
    }

    // 0. 扩展 UI 请求（确认 / 选择 / 输入）
    if (record.type === 'extension_ui_request') {
      const method = String(record.method || '');
      if (method === 'select' || method === 'confirm' || method === 'input' || method === 'editor') {
        this.emit('uiRequest', {
          id: record.id,
          method,
          title: record.title || '',
          message: record.message || '',
          options: Array.isArray(record.options) ? record.options : undefined,
          placeholder: record.placeholder,
          timeout: typeof record.timeout === 'number' ? record.timeout : undefined,
        });
      } else {
        this.emitLog('system', `[Pi RPC] 扩展 UI: ${method} ${record.title || ''}`.trim());
      }
      return;
    }

    // 1. 命令响应匹配
    if (record.type === 'response') {
      if (record.id && this.pendingCommands.has(record.id)) {
        const deferred = this.pendingCommands.get(record.id)!;
        this.pendingCommands.delete(record.id);
        if (record.success) {
          deferred.resolve(record.data);
        } else {
          deferred.reject(new Error(record.error || 'Command failed'));
        }
      }
      return;
    }

    // 2. 状态与会话生命周期事件
    switch (record.type) {
      case 'agent_start':
        this.isBusy = true;
        this.markTurnStart();
        this.emitStatus({ isBusy: true, active: this.active, turnStartedAt: this.turnStartedAt });
        this.notifyUpdate(true);
        break;

      case 'turn_start':
        this.isBusy = true;
        this.turnSeq += 1;
        this.markTurnStart();
        this.emitStatus({ isBusy: true, turnStartedAt: this.turnStartedAt });
        this.notifyUpdate(true);
        break;

      case 'message_start': {
        const msg = record.message;
        if (!msg) break;

        if (msg.role === 'user') {
          // 新消息会以当前叶子为父追写，叶子回到文件末尾，跟踪值失效
          this.leafEntryId = undefined;
          const userText = Array.isArray(msg.content)
            ? msg.content.map((c: any) => c.text || '').join('')
            : String(msg.content || '');

          // pi 采纳该输入：本地回显退出，会话流接管（单源，不会重复）
          const taken = this.takePendingInput(userText);

          const userMessage: SessionChatMessage = {
            id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: 'user',
            content: userText,
            attachments: taken?.attachments,
            timestamp: taken?.createdAt ?? Date.now(),
            turn: this.turnSeq || undefined,
            source: 'live',
          };
          this.messages.push(userMessage);
          this.emitMessage(userMessage);
          if (taken) this.emitPending();
          this.notifyUpdate(true);
        } else if (msg.role === 'assistant') {
          const newAssistantMsg: SessionChatMessage = {
            id: `msg_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: '',
            isStreaming: true,
            isThinking: false,
            tools: [],
            timestamp: Date.now(),
            turn: this.turnSeq || undefined,
            model: msg.model || this.model,
            source: 'live',
          };
          this.currentAssistantMessage = newAssistantMsg;
          this.messages.push(newAssistantMsg);
          this.emitMessage(newAssistantMsg);
          this.notifyUpdate(true);
        }
        break;
      }

      case 'message_update': {
        const ev = record.assistantMessageEvent;
        if (!ev || !this.currentAssistantMessage) break;

        if (ev.type === 'thinking_start') {
          this.currentAssistantMessage.isThinking = true;
          this.emitMessagePatch(this.currentAssistantMessage.id, { isThinking: true });
          this.notifyUpdate();
        } else if (ev.type === 'thinking_delta') {
          this.currentAssistantMessage.isThinking = true;
          this.currentAssistantMessage.thinking = (this.currentAssistantMessage.thinking || '') + (ev.delta || '');
          this.emitDelta('thinking', ev.delta || '', { isThinking: true });
        } else if (ev.type === 'thinking_end') {
          this.currentAssistantMessage.isThinking = false;
          if (ev.content) {
            this.currentAssistantMessage.thinking = ev.content;
          }
          this.emitMessagePatch(this.currentAssistantMessage.id, {
            isThinking: false,
            thinking: this.currentAssistantMessage.thinking,
          });
          this.notifyUpdate();
        } else if (ev.type === 'text_start') {
          this.currentAssistantMessage.isStreaming = true;
          this.emitMessagePatch(this.currentAssistantMessage.id, { isStreaming: true });
          this.notifyUpdate();
        } else if (ev.type === 'text_delta') {
          this.currentAssistantMessage.isStreaming = true;
          this.currentAssistantMessage.content = (this.currentAssistantMessage.content || '') + (ev.delta || '');
          this.emitDelta('content', ev.delta || '', { isStreaming: true });
        } else if (ev.type === 'text_end') {
          if (ev.content) {
            this.currentAssistantMessage.content = ev.content;
          }
          this.emitMessagePatch(this.currentAssistantMessage.id, {
            content: this.currentAssistantMessage.content,
          });
          this.notifyUpdate();
        } else if (ev.type === 'toolcall_start') {
          if (!this.currentAssistantMessage.tools) this.currentAssistantMessage.tools = [];
          const tool: ToolExecutionRecord = {
            id: ev.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: ev.toolName,
            status: 'running',
            kind: classifyToolKind(ev.toolName),
          };
          this.currentAssistantMessage.tools.push(tool);
          this.emitTool(this.currentAssistantMessage.id, tool);
          this.notifyUpdate();
        } else if (ev.type === 'error') {
          const errText = ev.error?.message || ev.error || ev.reason || '流式输出异常';
          const errMsg = typeof errText === 'string' ? errText : JSON.stringify(errText);
          this.lastError = errMsg;
          this.emitLog('stderr', `[Agent 报错] ${errMsg}`);
          if (this.currentAssistantMessage) {
            this.currentAssistantMessage.errorMessage = errMsg;
            this.currentAssistantMessage.stopReason = 'error';
            this.emitMessagePatch(this.currentAssistantMessage.id, {
              errorMessage: errMsg,
              stopReason: 'error',
            });
          }
          this.notifyUpdate(true);
        }
        break;
      }

      case 'tool_execution_start': {
        const owner = this.findToolOwner(record.toolCallId);
        if (owner) {
          owner.tool.args = record.args;
          owner.tool.input = summarizeToolInput(record.args);
          if (!owner.tool.kind) owner.tool.kind = classifyToolKind(owner.tool.name);
          this.emitTool(owner.messageId, owner.tool);
          this.notifyUpdate();
        }
        const toolLabel = record.toolName ? `[${record.toolName}]` : '';
        const argsPreview = record.args ? ` 参数: ${JSON.stringify(record.args).slice(0, 100)}` : '';
        this.emitLog('stdout', `[Agent 工具调用] 正在执行 ${toolLabel}${argsPreview}`);
        break;
      }

      case 'tool_execution_end': {
        const owner = this.findToolOwner(record.toolCallId);
        let toolName = '';
        if (owner) {
          owner.tool.result = compactToolResult(record.result);
          owner.tool.status = record.isError ? 'error' : 'success';
          owner.tool.durationMs = record.durationMs;
          const images = resultImageUrls(record.result);
          if (images.length > 0) owner.tool.imageUrls = images;
          toolName = owner.tool.name;
          this.emitTool(owner.messageId, owner.tool);
          this.notifyUpdate(true);
        }
        const statusText = record.isError ? '失败' : '完成';
        const costText = record.durationMs !== undefined ? ` (耗时: ${record.durationMs}ms)` : '';
        this.emitLog(
          record.isError ? 'stderr' : 'stdout',
          `[Agent 工具${statusText}] ${toolName ? `[${toolName}] ` : ''}执行${statusText}${costText}`
        );
        break;
      }

      case 'message_end': {
        const msg = record.message;
        if (!msg || msg.role !== 'assistant') break;

        const rawContent = msg?.content;
        const contentText = typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('')
            : '';

        if (this.currentAssistantMessage) {
          this.currentAssistantMessage.isStreaming = false;
          this.currentAssistantMessage.isThinking = false;
          if (contentText) {
            if (contentText.includes(PIPELINE_DONE_MARKER)) this.doneMarkerSeen = true;
            this.currentAssistantMessage.content = this.stripDoneMarker(contentText);
            // 将 Agent 生成的最终结论同步打入终端日志，便于在终端抽屉中闭环查看
            const summaryText = this.currentAssistantMessage.content.trim();
            if (summaryText) {
              this.emitLog('stdout', `[Agent 输出] ${summaryText.slice(0, 300)}${summaryText.length > 300 ? '...' : ''}`);
            }
          }
          if (msg?.errorMessage || msg?.stopReason === 'error') {
            const errorText = msg?.errorMessage || '模型调用失败';
            this.lastError = errorText;
            this.currentAssistantMessage.errorMessage = errorText;
            this.currentAssistantMessage.stopReason = msg?.stopReason || 'error';
            this.emitLog('stderr', `[Agent 报错] 模型接口异常: ${errorText}`);
          }
          // 用量与模型归属：供输入框上方统计胶囊与工具卡展示
          const usage = compactUsage(msg?.usage);
          if (usage) this.currentAssistantMessage.usage = usage;
          if (msg?.model) this.currentAssistantMessage.model = msg.model;
          if (msg?.stopReason) this.currentAssistantMessage.stopReason = msg.stopReason;
          this.emitMessage(this.currentAssistantMessage);
          this.notifyUpdate(true);
          this.currentAssistantMessage = null;
        } else if (msg?.errorMessage || msg?.stopReason === 'error') {
          const errorText = msg?.errorMessage || '模型调用失败';
          this.lastError = errorText;
          this.emitLog('stderr', `[Agent 报错] 模型接口异常: ${errorText}`);
        }
        break;
      }

      case 'turn_end': {
        const msg = record.message;
        if (msg?.errorMessage || msg?.stopReason === 'error') {
          const errorText = msg.errorMessage || '模型调用失败';
          this.lastError = errorText;
          const targetMsg =
            this.currentAssistantMessage ||
            this.messages.slice().reverse().find((m) => m.role === 'assistant');
          if (targetMsg) {
            targetMsg.errorMessage = errorText;
            targetMsg.stopReason = msg.stopReason || 'error';
            this.emitMessagePatch(targetMsg.id, { errorMessage: errorText, stopReason: msg.stopReason || 'error' });
          }
        }
        // 一轮结束即空闲：状态位必须同时落到快照，否则快照仍报忙碌，界面运行指示会赖着不消失
        this.isBusy = false;
        this.emitStatus({ isBusy: false });
        this.notifyUpdate(true);
        break;
      }

      case 'error': {
        const errorText = record.message || record.error || 'RPC 内部错误';
        this.lastError = errorText;
        this.emitLog('stderr', `[Pi RPC 错误] ${errorText}`);
        const targetMsg =
          this.currentAssistantMessage ||
          this.messages.slice().reverse().find((m) => m.role === 'assistant');
        if (targetMsg) {
          targetMsg.errorMessage = errorText;
          targetMsg.stopReason = 'error';
          this.emitMessagePatch(targetMsg.id, { errorMessage: errorText, stopReason: 'error' });
        }
        this.emitStatus({ lastError: errorText });
        this.notifyUpdate(true);
        break;
      }

      case 'agent_settled': {
        this.isBusy = false;
        // 一轮结束后仍未送达的输入不会再进本轮，回显层清零；若 pi 稍后采纳，会话流仍会显示它
        this.clearPendingInputs();
        this.finishTurn();
        if (this.currentAssistantMessage) {
          // 流式增量拼接的文本也可能携带完成标记，兜底判定一次
          if (this.currentAssistantMessage.content?.includes(PIPELINE_DONE_MARKER)) this.doneMarkerSeen = true;
          this.currentAssistantMessage.isStreaming = false;
          this.currentAssistantMessage.isThinking = false;
          this.emitMessagePatch(this.currentAssistantMessage.id, { isStreaming: false, isThinking: false });
          this.currentAssistantMessage = null;
        }
        this.emitStatus({
          isBusy: false,
          active: this.active,
          turnStartedAt: this.turnStartedAt,
          lastTurnDurationMs: this.lastTurnDurationMs,
        });
        this.notifyUpdate(true);

        // 本轮空闲后应用排队中的模型 / 思考强度变更
        this.flushPendingSettings().catch((err) => {
          logger.error(`应用排队中的运行时配置失败: ${err?.message || err}`, undefined, {
            taskId: this.taskId,
          });
        });

        // 首次提示执行结束且没有在等待排队消息时，通知节点执行完成
        if (this.initialPromptSent && !this.executionCompleted && !record.aborted && !this.isPaused) {
          if (this.lastError) {
            // 本轮执行发生模型或系统报错，直接标记失败并通知错误，绝不能误判为“等待用户确认”
            this.executionCompleted = true;
            this.awaitingInput = false;
            if (this.onFinishedCallback) {
              this.onFinishedCallback(this.lastError);
            }
          } else if (this.awaitCompletionMarker && !this.doneMarkerSeen) {
            // 未声明完成：视为仍在向用户确认信息，节点保持运行并等待用户回复，绝不流转下游
            if (!this.awaitingInput) {
              this.awaitingInput = true;
              this.emitLog(
                'system',
                '[等待用户回复] Agent 本轮未声明完成，流水线停留在本节点，不会流转到下一个节点'
              );
              this.notifyUpdate();
            }
          } else {
            this.executionCompleted = true;
            if (this.onFinishedCallback) {
              this.onFinishedCallback();
            }
          }
        }
        break;
      }
    }
  }

  private sendCommand(command: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin || !this.active) {
        return reject(new Error('RPC session process is not active'));
      }
      const id = `cmd_${++this.cmdSeq}_${Date.now()}`;
      command.id = id;
      this.pendingCommands.set(id, { resolve, reject });
      try {
        this.child.stdin.write(JSON.stringify(command) + '\n');
      } catch (err: any) {
        this.pendingCommands.delete(id);
        reject(err);
      }
    });
  }

  /**
   * 在同一个会话文件内切换叶子（pi 的 /tree 语义）
   * 走扩展命令，不产生模型调用，代价是一次进程内指针移动。
   */
  public async navigateTo(entryId: string): Promise<void> {
    if (!this.active) throw new Error('会话未启动，无法切换分支');
    await this.runTreeBridge('nav', entryId);
  }

  /** 走扩展桥执行一次会话树操作：pi 没有对应 RPC 命令，只能靠内部斜杠命令触发 */
  private async runTreeBridge(action: 'nav' | 'fork', entryId: string): Promise<void> {
    if (!this.treeBridgeReady) throw new Error('会话树桥未装载，无法导航或分叉');
    this.treeBridgeError = undefined;
    try {
      await this.sendCommand({ type: 'prompt', message: `/${TREE_COMMAND} ${action} ${entryId}` });
    } finally {
      if (this.treeBridgeError) throw new Error(this.treeBridgeError);
    }
  }

  /** 用指定分支的消息替换实时消息列表（导航后由上层按新分支重建） */
  public replaceMessages(messages: SessionChatMessage[]) {
    this.messages = messages;
    this.currentAssistantMessage = null;
    this.notifyUpdate(true);
  }

  /**
   * 从某条消息分叉出新会话：新会话以该条目为末尾（含这条回答），源会话一个字节都不动。
   * pi 只会切换子进程的活动会话，所以这里跟着换掉本地 session id。
   */
  public async fork(entryId: string): Promise<{
    cancelled?: boolean;
    sessionId: string;
  }> {
    if (!this.active) throw new Error('会话未启动，无法分叉');
    await this.runTreeBridge('fork', entryId);
    let nextSessionId = this.sessionId;
    try {
      const state = await this.sendCommand({ type: 'get_state' });
      const sid = state?.sessionId;
      if (typeof sid === 'string' && sid) nextSessionId = sid;
    } catch (err: any) {
      this.onLog?.('system', `分叉后读取状态失败: ${err?.message || err}`);
    }
    // 会话没换：pi 侧取消了这次分叉，保持原样
    if (nextSessionId === this.sessionId) {
      return { cancelled: true, sessionId: nextSessionId };
    }
    this.sessionId = nextSessionId;
    // 分叉后当前上下文已被替换，清空本地消息，由前端重新加载历史
    this.messages = [];
    this.leafEntryId = undefined;
    this.clearPendingInputs();
    this.currentAssistantMessage = null;
    this.isBusy = false;
    this.isPaused = false;
    this.awaitingInput = false;
    logger.info(`会话分叉: ${entryId} -> ${nextSessionId}`, undefined, { taskId: this.taskId });
    return { cancelled: false, sessionId: nextSessionId };
  }

  /**
   * 发送普通提示词（启动新轮次）
   */
  public async sendPrompt(message: string, attachments?: TaskAttachment[]): Promise<any> {
    this.isPaused = false;
    this.isBusy = true;
    this.awaitingInput = false;
    this.doneMarkerSeen = false;
    this.lastError = undefined;
    this.markTurnStart();

    // 先只上回显层：气泡立即出现，会话流等 pi 采纳后再接管
    this.queuePendingInput(message, attachments, 'turn');
    this.emitStatus({ isBusy: true, isPaused: false, awaitingInput: false, turnStartedAt: this.turnStartedAt });
    this.notifyUpdate(true);

    let actualMessage = message;
    if (attachments && attachments.length > 0) {
      const imagesPrompt = attachments
        .map((att, idx) => `[参考图片 ${idx + 1}: ${att.name}] 本地文件路径: ${att.path}`)
        .join('\n');
      actualMessage = actualMessage
        ? `${actualMessage}\n\n【用户随附参考图片】\n${imagesPrompt}`
        : `【用户随附参考图片】\n${imagesPrompt}`;
    }

    logger.info(
      `向 Agent 会话发送 Prompt: "${message.slice(0, 40)}" (含 ${attachments?.length || 0} 个图片附件)`,
      undefined,
      { taskId: this.taskId }
    );

    return this.sendCommand({
      type: 'prompt',
      message: actualMessage,
    });
  }

  /**
   * 在运行中无缝插话 (Steer)
   */
  public async steer(message: string, attachments?: TaskAttachment[]): Promise<any> {
    this.isPaused = false;
    this.awaitingInput = false;
    this.lastError = undefined;
    // 先只上回显层：气泡立即出现，会话流等 pi 采纳后再接管
    this.queuePendingInput(message, attachments, 'steering');
    this.emitStatus({ awaitingInput: false });
    this.notifyUpdate(true);

    let actualMessage = message;
    if (attachments && attachments.length > 0) {
      const imagesPrompt = attachments
        .map((att, idx) => `[参考图片 ${idx + 1}: ${att.name}] 本地文件路径: ${att.path}`)
        .join('\n');
      actualMessage = actualMessage
        ? `${actualMessage}\n\n【用户随附参考图片】\n${imagesPrompt}`
        : `【用户随附参考图片】\n${imagesPrompt}`;
    }

    logger.info(
      `向 Agent 会话进行 Steer 插话: "${message.slice(0, 40)}" (含 ${attachments?.length || 0} 个图片附件)`,
      undefined,
      { taskId: this.taskId }
    );

    return this.sendCommand({
      type: 'steer',
      message: actualMessage,
    });
  }

  /**
   * 用户直接从输入框发消息（自动智能选择 prompt 或 steer）
   */
  public async sendUserMessage(message: string, attachments?: TaskAttachment[]): Promise<any> {
    if (this.isBusy) {
      return this.steer(message, attachments);
    } else {
      return this.sendPrompt(message, attachments);
    }
  }

  /**
   * 暂停会话 (通过 abort 命令停止当前推理和工具执行，进入空闲待命)
   */
  public async pause(): Promise<boolean> {
    if (!this.active) return false;
    this.isPaused = true;
    try {
      await this.sendCommand({ type: 'abort' });
      this.isBusy = false;
      this.clearPendingInputs();
      this.finishTurn();
      this.emitStatus({ isPaused: true, isBusy: false, turnStartedAt: this.turnStartedAt });
      this.notifyUpdate(true);
      return true;
    } catch (e: any) {
      logger.error(`暂停会话失败: ${e.message}`, undefined, { taskId: this.taskId });
      return false;
    }
  }

  /**
   * 恢复会话 (继续让 Agent 推进)
   */
  public async resume(): Promise<boolean> {
    this.isPaused = false;
    this.lastError = undefined;
    try {
      await this.sendPrompt('请继续完成刚才的工作。');
      return true;
    } catch (e: any) {
      logger.error(`恢复会话失败: ${e.message}`, undefined, { taskId: this.taskId });
      return false;
    }
  }

  /**
   * 运行时同步模型 / 思考强度（不重启进程、不丢上下文）
   * 忙碌中或正在切换时暂存，本轮结束后由 flushPendingSettings 自动应用
   */
  public async applyRuntimeSettings(patch: RuntimeSettingsPatch): Promise<RuntimeSettingsApplyResult> {
    const modelPattern = patch.model === undefined ? undefined : patch.model.trim();
    const thinkingLevel = patch.thinking === undefined ? undefined : patch.thinking.trim();

    const modelChanged = modelPattern !== undefined && modelPattern !== this.modelPattern;
    const thinkingChanged = thinkingLevel !== undefined && thinkingLevel !== this.thinking;
    // 未变化直接跳过，避免无谓的进程间命令
    if (!modelChanged && !thinkingChanged) return 'applied';

    const effective: RuntimeSettingsPatch = {};
    let inheritsDefaultModel = false;
    if (modelChanged) {
      if (modelPattern === '') {
        // 留空表示继承引擎默认模型，无法热切换，只能在新建会话时生效
        inheritsDefaultModel = true;
      } else {
        effective.model = modelPattern;
      }
    }
    if (thinkingChanged) effective.thinking = thinkingLevel;

    // 仅剩下「继承默认模型」需求：不向进程下发任何命令，只标记待生效
    if (!effective.model && !effective.thinking) {
      this.pendingModel = '';
      this.modelError = undefined;
      this.notifyUpdate();
      return 'queued';
    }

    let result: RuntimeSettingsApplyResult;
    if (!this.active) {
      result = 'failed';
    } else if (this.isBusy || this.switching) {
      this.rememberPending(effective);
      this.notifyUpdate();
      return 'queued';
    } else {
      result = await this.applySettingsPatch(effective);
    }

    if (inheritsDefaultModel) {
      this.pendingModel = '';
      this.notifyUpdate();
      return result === 'failed' ? 'failed' : 'queued';
    }
    return result;
  }

  private rememberPending(patch: RuntimeSettingsPatch) {
    if (patch.model !== undefined) this.pendingModel = patch.model;
    if (patch.thinking !== undefined) this.pendingThinking = patch.thinking;
  }

  private async flushPendingSettings(): Promise<void> {
    if (!this.pendingModel && !this.pendingThinking) return;
    // 待生效模型为空字符串表示需继承引擎默认，只能等下次新建会话
    const patch: RuntimeSettingsPatch = {};
    if (this.pendingModel) patch.model = this.pendingModel;
    if (this.pendingThinking) patch.thinking = this.pendingThinking;
    if (!patch.model && !patch.thinking) return;
    this.pendingModel = undefined;
    this.pendingThinking = undefined;
    await this.applySettingsPatch(patch);
  }

  private async applySettingsPatch(patch: RuntimeSettingsPatch): Promise<RuntimeSettingsApplyResult> {
    this.switching = true;
    try {
      if (patch.model) {
        const resolved = await this.resolveModel(patch.model);
        if (!resolved) {
          this.modelError = `未找到唯一匹配的模型: ${patch.model}`;
          logger.warn(`模型切换失败，保留原模型: ${this.modelError}`, undefined, { taskId: this.taskId });
          this.notifyUpdate();
          return 'failed';
        }
        await this.sendCommandWithTimeout({ type: 'set_model', provider: resolved.provider, modelId: resolved.id });
        this.model = `${resolved.provider}/${resolved.id}`;
        this.modelPattern = patch.model;
      }

      if (patch.thinking) {
        await this.sendCommandWithTimeout({ type: 'set_thinking_level', level: patch.thinking });
        this.thinking = patch.thinking;
      }

      this.modelError = undefined;
      this.pendingModel = undefined;
      this.pendingThinking = undefined;
      this.notifyUpdate();
      logger.info(
        `会话运行时配置已切换: 模型=${this.model || '继承默认'}, 思考强度=${this.thinking || '未设置'}`,
        undefined,
        { taskId: this.taskId }
      );
      return 'applied';
    } catch (e: any) {
      this.modelError = e?.message || '运行时配置切换失败';
      logger.error(`会话运行时配置切换失败，保留原模型: ${this.modelError}`, undefined, {
        taskId: this.taskId,
      });
      this.notifyUpdate();
      return 'failed';
    } finally {
      this.switching = false;
    }
  }

  /** 供上层列举可用模型（模型选择器） */
  public async listModels(): Promise<Array<{ id: string; provider: string }>> {
    if (!this.active) return [];
    return this.getAvailableModels().catch(() => []);
  }

  private async getAvailableModels(): Promise<Array<{ id: string; provider: string }>> {
    if (this.modelsCache) return this.modelsCache;
    const data = await this.sendCommandWithTimeout({ type: 'get_available_models' }, 3000);
    const models = Array.isArray(data?.models) ? data.models : [];
    const resolved = models
      .filter((m: any) => m && typeof m.id === 'string' && typeof m.provider === 'string')
      .map((m: any) => ({ id: m.id, provider: m.provider }));
    this.modelsCache = resolved;
    return resolved;
  }

  /** 带超时的命令下发，避免进程无响应时阻塞设置保存链路 */
  private async sendCommandWithTimeout(command: any, timeoutMs = 3000): Promise<any> {
    let timer: any;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`命令响应超时 (${command.type})`)), timeoutMs);
    });
    try {
      return await Promise.race([this.sendCommand(command), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 将设置页的自由文本模型描述解析为 provider + modelId
   * 匹配优先级：provider/id 精确 → id 精确 → 唯一模糊匹配；歧义时放弃，绝不猜测
   */
  private async resolveModel(pattern: string): Promise<{ id: string; provider: string } | null> {
    const models = await this.getAvailableModels();
    if (models.length === 0) return null;

    // 去掉 pi CLI 支持的 :thinking 后缀，思考强度走 set_thinking_level
    const target = pattern.split(':')[0].trim();
    if (!target) return null;

    const slashIndex = target.indexOf('/');
    if (slashIndex > 0) {
      const provider = target.slice(0, slashIndex);
      const id = target.slice(slashIndex + 1);
      const hit = models.find((m) => m.provider === provider && m.id === id);
      if (hit) return hit;
    }

    const exact = models.filter((m) => m.id === target);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;

    const lower = target.toLowerCase();
    const fuzzy = models.filter((m) => `${m.provider}/${m.id}`.toLowerCase().includes(lower));
    return fuzzy.length === 1 ? fuzzy[0] : null;
  }

  /**
   * 获取当前会话状态快照
   */
  public getState(): TaskSessionState {
    return {
      taskId: this.taskId,
      active: this.active,
      isBusy: this.isBusy,
      isPaused: this.isPaused,
      awaitingInput: this.awaitingInput,
      turnStartedAt: this.turnStartedAt,
      lastTurnDurationMs: this.lastTurnDurationMs,
      messages: [...this.messages],
      pendingInputs: [...this.pendingInputs],
      agentName: this.agentName,
      model: this.model,
      pendingModel: this.pendingModel,
      modelError: this.modelError,
      lastError: this.lastError,
      sessionId: this.sessionId,
      piSessionId: this.sessionId,
      resumeCommand: `pi --session ${this.sessionId}`,
      agentProvider: 'pi',
    };
  }

  /**
   * 推送增量事件（单包小、按需推送）
   */
  private emitEvent(event: AgentStreamEvent) {
    this.eventSeq += 1;
    if (process.env.NODE_ENV !== 'production' && this.eventSeq % 200 === 0) {
      logger.debug(`[Pi RPC] 已推送 ${this.eventSeq} 个增量事件 (${event.kind})`, undefined, {
        taskId: this.taskId,
      });
    }
    if (this.onEventCallback) {
      this.onEventCallback(event);
    }
    this.emit('stream', event);
  }

  /** 定位工具调用所属的消息，返回可变引用与消息 ID */
  private findToolOwner(toolCallId: string): { messageId: string; tool: ToolExecutionRecord } | null {
    if (toolCallId && this.currentAssistantMessage?.tools) {
      const tool = this.currentAssistantMessage.tools.find((t) => t.id === toolCallId);
      if (tool) return { messageId: this.currentAssistantMessage.id, tool };
    }
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      const tool = message.tools?.find((t) => t.id === toolCallId);
      if (tool) return { messageId: message.id, tool };
    }
    return null;
  }

  /** 流式文本增量：只在消息已存在时推送，避免半截消息污染状态 */
  private emitDelta(field: 'content' | 'thinking', delta: string, flags?: { isStreaming?: boolean; isThinking?: boolean }) {
    if (!delta) return;
    const message = this.currentAssistantMessage;
    if (!message) return;
    this.emitEvent({
      kind: 'message_delta',
      taskId: this.taskId,
      messageId: message.id,
      field,
      delta,
      isStreaming: flags?.isStreaming,
      isThinking: flags?.isThinking,
    });
  }

  /** 推送完整消息（新增或既有消息的整条覆盖） */
  private emitMessage(message: SessionChatMessage) {
    this.emitEvent({ kind: 'message', taskId: this.taskId, message });
  }

  /** 推送消息局部变更（状态翻转、错误信息等） */
  private emitMessagePatch(messageId: string, patch: Partial<SessionChatMessage>) {
    this.emitEvent({ kind: 'message_patch', taskId: this.taskId, messageId, patch });
  }

  /** 推送工具调用状态 */
  private emitTool(messageId: string, tool: ToolExecutionRecord) {
    this.emitEvent({ kind: 'tool', taskId: this.taskId, messageId, tool: compactToolForEvent(tool) });
  }

  /** 推送会话级状态位（忙碌、等待回复、模型等） */
  private emitStatus(patch: AgentStatusEvent['patch']) {
    this.emitEvent({ kind: 'status', taskId: this.taskId, patch });
  }

  /**
   * 全量快照：限频推送，首包立即发出，之后最多 120ms 一包
   * @param immediate 强制立即推送（消息边界、错误、结束、进程退出等）
   */
  private notifyUpdate(immediate = false) {
    if (this.snapshotTimer) {
      if (!immediate) {
        this.snapshotPending = true;
        return;
      }
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
      this.snapshotPending = false;
    }

    const state = this.getState();
    if (this.onUpdateCallback) {
      this.onUpdateCallback(state);
    }
    this.emit('update', state);
    this.emitEvent({ kind: 'snapshot', taskId: this.taskId, state });

    if (immediate) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      if (!this.snapshotPending) return;
      this.snapshotPending = false;
      this.notifyUpdate();
    }, PI_SNAPSHOT_INTERVAL_MS);
    this.snapshotTimer.unref?.();
  }

  /**
   * 彻底停止并销毁子进程
   */
  public terminate() {
    this.active = false;
    this.isBusy = false;
    if (this.child) {
      try {
        if (this.child.stdin && !this.child.stdin.destroyed) {
          this.child.stdin.end();
        }
        if (this.child.pid) {
          if (process.platform !== 'win32') {
            process.kill(-this.child.pid, 'SIGKILL');
          } else {
            this.child.kill('SIGKILL');
          }
        }
      } catch (_) {}
      this.child = null;
    }
    this.emitStatus({ active: false, isBusy: false });
    this.notifyUpdate(true);
  }
}

/**
 * 全局 Pi RPC 会话管理器
 */
export class PiRpcSessionManager extends EventEmitter {
  private static instance: PiRpcSessionManager;
  private sessions = new Map<string, PiRpcSessionInstance>();

  public static getInstance(): PiRpcSessionManager {
    if (!PiRpcSessionManager.instance) {
      PiRpcSessionManager.instance = new PiRpcSessionManager();
    }
    return PiRpcSessionManager.instance;
  }

  public createSession(options: PiRpcSessionOptions): PiRpcSessionInstance {
    // 若已存在相同任务的活跃会话，先安全终止
    const existing = this.sessions.get(options.taskId);
    if (existing) {
      existing.terminate();
      this.sessions.delete(options.taskId);
    }

    const session = new PiRpcSessionInstance(options);
    this.sessions.set(options.taskId, session);

    session.on('update', () => {
      // 保持活跃会话引用
    });
    // 扩展 UI 请求（审批卡）转给上层：带上任务路由键，界面据此过滤
    session.on('uiRequest', (request) => {
      this.emit('uiRequest', { ...request, taskId: options.taskId, sessionId: session.sessionId });
    });

    return session;
  }

  public getSession(taskId: string): PiRpcSessionInstance | undefined {
    return this.sessions.get(taskId);
  }

  /** 正在跑一轮回复的 pi 会话 id：「智能体开发」面板据此显示运行指示 */
  public listBusySessionIds(): string[] {
    return [...this.sessions.values()]
      .filter((session) => session.active && session.isBusy)
      .map((session) => session.sessionId);
  }

  /** 按 pi 会话 id 取实时状态：流水线 agent 节点与全局会话共用同一份 pi 会话 */
  public getStateBySessionId(sessionId: string): TaskSessionState | undefined {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) return session.getState();
    }
    return undefined;
  }

  /**
   * 将模型 / 思考强度变更同步到所有活跃会话
   * 并行下发，不重启进程，不阻塞设置保存
   */
  public async applyRuntimeSettings(patch: RuntimeSettingsPatch): Promise<RuntimeSettingsApplySummary> {
    const sessions = [...this.sessions.values()];
    const summary: RuntimeSettingsApplySummary = { applied: 0, queued: 0, failed: 0 };
    if (sessions.length === 0) return summary;

    const results = await Promise.allSettled(sessions.map((s) => s.applyRuntimeSettings(patch)));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        summary[result.value] += 1;
      } else {
        summary.failed += 1;
      }
    }

    logger.info(
      `运行时配置同步完成: ${sessions.length} 个活跃会话 (已生效 ${summary.applied}, 排队 ${summary.queued}, 失败 ${summary.failed})`
    );
    return summary;
  }

  public removeSession(taskId: string) {
    const session = this.sessions.get(taskId);
    if (session) {
      session.terminate();
      this.sessions.delete(taskId);
    }
  }

  public terminateAll() {
    for (const session of this.sessions.values()) {
      session.terminate();
    }
    this.sessions.clear();
  }
}
