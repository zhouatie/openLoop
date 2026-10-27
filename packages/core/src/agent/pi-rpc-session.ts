import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import {
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
    const args: string[] = [
      '--mode', 'rpc',
      '--session-id', options.sessionId,
      '--name', `openLoop: ${options.taskTitle.slice(0, 50)}`,
    ];

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
      this.emitStatus({ active: false, isBusy: false });
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

  private handleRpcRecord(record: any) {
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
        this.emitStatus({ isBusy: true, active: this.active });
        this.notifyUpdate(true);
        break;

      case 'turn_start':
        this.isBusy = true;
        this.turnSeq += 1;
        this.emitStatus({ isBusy: true });
        this.notifyUpdate(true);
        break;

      case 'message_start': {
        const msg = record.message;
        if (!msg) break;

        if (msg.role === 'user') {
          const userText = Array.isArray(msg.content)
            ? msg.content.map((c: any) => c.text || '').join('')
            : String(msg.content || '');

          // 避免重复推入相同的 user 消息
          // 当通过 sendPrompt / steer 发送时，已在前置乐观推入 messages（并包含 attachments 结构化数据）
          // Pi RPC 进程回调的 userText 可能会追加【用户随附参考图片】说明
          const lastMsg = this.messages[this.messages.length - 1];
          const isAlreadyTracked =
            lastMsg &&
            lastMsg.role === 'user' &&
            (lastMsg.content === userText ||
              (Boolean(lastMsg.content) && userText.startsWith(lastMsg.content)) ||
              (Boolean(lastMsg.attachments && lastMsg.attachments.length > 0) &&
                userText.includes('【用户随附参考图片】')));

          if (!isAlreadyTracked && (!lastMsg || lastMsg.role !== 'user')) {
            const userMessage: SessionChatMessage = {
              id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              role: 'user',
              content: userText,
              timestamp: Date.now(),
              turn: this.turnSeq || undefined,
              source: 'live',
            };
            this.messages.push(userMessage);
            this.emitMessage(userMessage);
            this.notifyUpdate(true);
          }
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
        if (this.currentAssistantMessage) {
          // 流式增量拼接的文本也可能携带完成标记，兜底判定一次
          if (this.currentAssistantMessage.content?.includes(PIPELINE_DONE_MARKER)) this.doneMarkerSeen = true;
          this.currentAssistantMessage.isStreaming = false;
          this.currentAssistantMessage.isThinking = false;
          this.emitMessagePatch(this.currentAssistantMessage.id, { isStreaming: false, isThinking: false });
          this.currentAssistantMessage = null;
        }
        this.emitStatus({ isBusy: false, active: this.active });
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
   * 发送普通提示词（启动新轮次）
   */
  public async sendPrompt(message: string, attachments?: TaskAttachment[]): Promise<any> {
    this.isPaused = false;
    this.isBusy = true;
    this.awaitingInput = false;
    this.doneMarkerSeen = false;
    this.lastError = undefined;

    // 前置压入用户消息展示
    const userMessage: SessionChatMessage = {
      id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: message,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
      turn: this.turnSeq + 1 || undefined,
      source: 'live',
    };
    this.messages.push(userMessage);
    this.emitMessage(userMessage);
    this.emitStatus({ isBusy: true, isPaused: false, awaitingInput: false });
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
    // 立即压入用户消息
    const userMessage: SessionChatMessage = {
      id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: message,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
      turn: this.turnSeq || undefined,
      source: 'live',
    };
    this.messages.push(userMessage);
    this.emitMessage(userMessage);
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
      this.emitStatus({ isPaused: true, isBusy: false });
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
      messages: [...this.messages],
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
export class PiRpcSessionManager {
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

    return session;
  }

  public getSession(taskId: string): PiRpcSessionInstance | undefined {
    return this.sessions.get(taskId);
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
