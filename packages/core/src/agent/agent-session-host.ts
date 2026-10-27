import os from 'os';
import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import type { TaskAttachment, TaskSessionState } from '../types';
import type { AgentStreamEvent } from './agent-events';
import { PiRpcSessionInstance } from './pi-rpc-session';
import { piSessionIndex } from './session-index';

const logger = createLogger('AgentSessionHost');

export interface OpenAgentSessionOptions {
  cwd?: string;
  model?: string;
  thinking?: string;
  /** 打开即发送的首条消息 */
  initialPrompt?: string;
  /** 与首条消息一同发送的附件 */
  initialAttachments?: TaskAttachment[];
  /** 复用已有进程时随消息发送的附件 */
  attachments?: TaskAttachment[];
}

export interface OpenAgentSessionResult {
  sessionId: string;
  state: TaskSessionState;
  created: boolean;
}

/** 全局 Agent 会话的合成 taskId 前缀，用于与任务会话区分 */
export const GLOBAL_AGENT_PREFIX = 'agent_';

/**
 * 全局 Agent 会话宿主
 *
 * 任务流水线里的会话由 dag-engine 持有；侧边栏「智能体开发」这类不绑定任务的会话
 * 没有 DAG 上下文，统一由这里托管：一个 pi session 一个子进程，事件直接推给 WS。
 */
export class AgentSessionHost extends EventEmitter {
  private static instance: AgentSessionHost;
  private sessions = new Map<string, PiRpcSessionInstance>();
  /** 记录每个会话最后一次已知的 cwd，重启进程时沿用 */
  private cwdBySession = new Map<string, string>();

  public static getInstance(): AgentSessionHost {
    if (!AgentSessionHost.instance) {
      AgentSessionHost.instance = new AgentSessionHost();
    }
    return AgentSessionHost.instance;
  }

  /** 打开（或复用）一个全局会话进程，不发送任何消息 */
  public async open(sessionId: string, options: OpenAgentSessionOptions = {}): Promise<OpenAgentSessionResult> {
    const existing = this.sessions.get(sessionId);
    if (existing && existing.active) {
      return { sessionId, state: existing.getState(), created: false };
    }

    const summary = await piSessionIndex.find(sessionId).catch(() => undefined);
    const cwd = options.cwd || summary?.cwd || os.homedir();
    const taskId = `${GLOBAL_AGENT_PREFIX}${sessionId}`;

    const session = new PiRpcSessionInstance({
      taskId,
      taskTitle: summary?.firstUserMessage || 'Agent 会话',
      sessionId,
      cwd,
      model: options.model,
      thinking: options.thinking,
      initialPrompt: options.initialPrompt || '',
      initialAttachments: options.initialAttachments,
      autoStart: Boolean(options.initialPrompt),
      awaitCompletionMarker: false,
      onEvent: (event) => {
        // 快照走 onUpdate → agent:chat_update 通道，stream 只承载增量
        if (event.kind === 'snapshot') return;
        this.emit('stream', event);
      },
      onUpdate: (state) => this.emit('update', state),
      onLog: (stream, message) => {
        if (process.env.NODE_ENV !== 'production') {
          logger.debug(`[${sessionId}] ${stream}: ${message.slice(0, 200)}`);
        }
      },
    });

    this.sessions.set(sessionId, session);
    this.cwdBySession.set(sessionId, cwd);
    logger.info(`打开全局 Agent 会话: ${sessionId} (cwd: ${cwd})`);

    return { sessionId, state: session.getState(), created: true };
  }

  /** 向全局会话发送消息，进程不在时自动拉起 */
  public async chat(sessionId: string, message: string, options: OpenAgentSessionOptions = {}): Promise<TaskSessionState> {
    let session = this.sessions.get(sessionId);
    if (!session || !session.active) {
      const opened = await this.open(sessionId, {
        ...options,
        initialPrompt: message,
        initialAttachments: options.attachments,
      });
      session = this.sessions.get(sessionId);
      if (!session) throw new Error('Agent 会话启动失败');
      // open() 已经带着首条消息启动，直接返回当前状态
      return opened.state;
    }
    await session.sendUserMessage(message, options.attachments);
    return session.getState();
  }

  public getState(sessionId: string): TaskSessionState | undefined {
    return this.sessions.get(sessionId)?.getState();
  }

  public isLive(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return Boolean(session && session.active);
  }

  public listLive(): string[] {
    return [...this.sessions.entries()].filter(([, session]) => session.active).map(([id]) => id);
  }

  public async pause(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.pause();
  }

  public async resume(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.resume();
  }

  public stop(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.terminate();
    this.sessions.delete(sessionId);
    return true;
  }

  public terminateAll() {
    for (const session of this.sessions.values()) {
      session.terminate();
    }
    this.sessions.clear();
  }

  /** 供 WS 层订阅增量事件 */
  public onStream(listener: (event: AgentStreamEvent) => void): () => void {
    this.on('stream', listener);
    return () => this.off('stream', listener);
  }
}

export const agentSessionHost = AgentSessionHost.getInstance();
