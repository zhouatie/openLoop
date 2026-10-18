import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { SessionChatMessage, ToolExecutionRecord, TaskSessionState, Task, TaskAttachment } from '../types';
import { createLogger } from '../logger';

const logger = createLogger('PiRpcSession');

export interface PiRpcSessionOptions {
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  sessionId: string;
  agentName?: string;
  model?: string;
  thinking?: string;
  tools?: string;
  cwd?: string;
  env?: Record<string, string>;
  initialPrompt: string;
  onLog?: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
  onUpdate?: (state: TaskSessionState) => void;
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
  public active: boolean = true;

  private child: ChildProcess | null = null;
  private cmdSeq = 0;
  private pendingCommands = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private stdoutBuffer = '';
  private onLog?: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
  private onUpdateCallback?: (state: TaskSessionState) => void;
  private onFinishedCallback?: (error?: string) => void;
  private currentAssistantMessage: SessionChatMessage | null = null;
  private initialPromptSent = false;
  private executionCompleted = false;

  constructor(options: PiRpcSessionOptions) {
    super();
    this.taskId = options.taskId;
    this.sessionId = options.sessionId;
    this.agentName = options.agentName || 'OpenLoop Agent';
    this.model = options.model;
    this.onLog = options.onLog;
    this.onUpdateCallback = options.onUpdate;
    this.onFinishedCallback = options.onFinished;

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
      this.notifyUpdate();
      if (this.onFinishedCallback && !this.executionCompleted) {
        this.executionCompleted = true;
        this.onFinishedCallback(err.message);
      }
    });

    this.child.on('close', (code) => {
      logger.info(`Pi RPC 进程退出，退出码: ${code}`, undefined, { taskId: this.taskId });
      this.active = false;
      this.isBusy = false;
      this.notifyUpdate();
      if (this.onFinishedCallback && !this.executionCompleted) {
        this.executionCompleted = true;
        this.onFinishedCallback(code === 0 ? undefined : `Process exited with code ${code}`);
      }
    });

    // 进程建立后，发送初始 Prompt
    setTimeout(() => {
      if (this.active && !this.initialPromptSent) {
        this.initialPromptSent = true;
        this.sendPrompt(options.initialPrompt).catch((err) => {
          logger.error(`发送初始 Prompt 失败: ${err.message}`, undefined, { taskId: this.taskId });
        });
      }
    }, 400);
  }

  private emitLog(stream: 'stdout' | 'stderr' | 'system', message: string) {
    if (this.onLog) {
      this.onLog(stream, message);
    }
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
        this.notifyUpdate();
        break;

      case 'turn_start':
        this.isBusy = true;
        this.notifyUpdate();
        break;

      case 'message_start': {
        const msg = record.message;
        if (!msg) break;

        if (msg.role === 'user') {
          const userText = Array.isArray(msg.content)
            ? msg.content.map((c: any) => c.text || '').join('')
            : String(msg.content || '');

          // 避免重复推入相同的 user 消息
          const lastMsg = this.messages[this.messages.length - 1];
          if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userText) {
            this.messages.push({
              id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              role: 'user',
              content: userText,
              timestamp: Date.now(),
            });
            this.notifyUpdate();
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
          };
          this.currentAssistantMessage = newAssistantMsg;
          this.messages.push(newAssistantMsg);
          this.notifyUpdate();
        }
        break;
      }

      case 'message_update': {
        const ev = record.assistantMessageEvent;
        if (!ev || !this.currentAssistantMessage) break;

        if (ev.type === 'thinking_start') {
          this.currentAssistantMessage.isThinking = true;
          this.notifyUpdate();
        } else if (ev.type === 'thinking_delta') {
          this.currentAssistantMessage.isThinking = true;
          this.currentAssistantMessage.thinking = (this.currentAssistantMessage.thinking || '') + (ev.delta || '');
          this.notifyUpdate();
        } else if (ev.type === 'thinking_end') {
          this.currentAssistantMessage.isThinking = false;
          if (ev.content) {
            this.currentAssistantMessage.thinking = ev.content;
          }
          this.notifyUpdate();
        } else if (ev.type === 'text_start') {
          this.currentAssistantMessage.isStreaming = true;
          this.notifyUpdate();
        } else if (ev.type === 'text_delta') {
          this.currentAssistantMessage.isStreaming = true;
          this.currentAssistantMessage.content = (this.currentAssistantMessage.content || '') + (ev.delta || '');
          this.notifyUpdate();
        } else if (ev.type === 'text_end') {
          if (ev.content) {
            this.currentAssistantMessage.content = ev.content;
          }
          this.notifyUpdate();
        } else if (ev.type === 'toolcall_start') {
          if (!this.currentAssistantMessage.tools) this.currentAssistantMessage.tools = [];
          this.currentAssistantMessage.tools.push({
            id: ev.id,
            name: ev.toolName,
            status: 'running',
          });
          this.notifyUpdate();
        }
        break;
      }

      case 'tool_execution_start': {
        if (this.currentAssistantMessage && this.currentAssistantMessage.tools) {
          const targetTool = this.currentAssistantMessage.tools.find((t) => t.id === record.toolCallId);
          if (targetTool) {
            targetTool.args = record.args;
          }
          this.notifyUpdate();
        }
        const toolLabel = record.toolName ? `[${record.toolName}]` : '';
        const argsPreview = record.args ? ` 参数: ${JSON.stringify(record.args).slice(0, 100)}` : '';
        this.emitLog('stdout', `[Agent 工具调用] 正在执行 ${toolLabel}${argsPreview}`);
        break;
      }

      case 'tool_execution_end': {
        let toolName = '';
        if (this.currentAssistantMessage && this.currentAssistantMessage.tools) {
          const targetTool = this.currentAssistantMessage.tools.find((t) => t.id === record.toolCallId);
          if (targetTool) {
            targetTool.result = record.result;
            targetTool.status = record.isError ? 'error' : 'success';
            targetTool.durationMs = record.durationMs;
            toolName = targetTool.name;
          }
          this.notifyUpdate();
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
        if (this.currentAssistantMessage) {
          this.currentAssistantMessage.isStreaming = false;
          this.currentAssistantMessage.isThinking = false;
          if (record.message?.content && typeof record.message.content === 'string') {
            this.currentAssistantMessage.content = record.message.content;
            // 将 Agent 生成的最终结论同步打入终端日志，便于在终端抽屉中闭环查看
            const summaryText = record.message.content.trim();
            if (summaryText) {
              this.emitLog('stdout', `[Agent 输出] ${summaryText.slice(0, 300)}${summaryText.length > 300 ? '...' : ''}`);
            }
          }
          this.notifyUpdate();
        }
        break;
      }

      case 'agent_settled': {
        this.isBusy = false;
        if (this.currentAssistantMessage) {
          this.currentAssistantMessage.isStreaming = false;
          this.currentAssistantMessage.isThinking = false;
          this.currentAssistantMessage = null;
        }
        this.notifyUpdate();

        // 首次提示执行结束且没有在等待排队消息时，通知节点执行完成
        if (this.initialPromptSent && !this.executionCompleted && !record.aborted && !this.isPaused) {
          this.executionCompleted = true;
          if (this.onFinishedCallback) {
            this.onFinishedCallback();
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

    // 前置压入用户消息展示
    this.messages.push({
      id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: message,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
    });
    this.notifyUpdate();

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
    // 立即压入用户消息
    this.messages.push({
      id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: message,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
    });
    this.notifyUpdate();

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
      this.notifyUpdate();
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
    try {
      await this.sendPrompt('请继续完成刚才的工作。');
      return true;
    } catch (e: any) {
      logger.error(`恢复会话失败: ${e.message}`, undefined, { taskId: this.taskId });
      return false;
    }
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
      messages: [...this.messages],
      agentName: this.agentName,
      model: this.model,
      piSessionId: this.sessionId,
    };
  }

  private notifyUpdate() {
    const state = this.getState();
    if (this.onUpdateCallback) {
      this.onUpdateCallback(state);
    }
    this.emit('update', state);
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
    this.notifyUpdate();
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
