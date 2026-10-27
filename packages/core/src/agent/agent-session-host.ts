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
  /** 工具权限预设：full=全部工具，readonly=只读，noshell=禁用命令 */
  permission?: AgentPermissionPreset;
  /** 绝对工具名列表，优先于预设 */
  tools?: string;
  excludeTools?: string;
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

export type AgentPermissionPreset = 'full' | 'readonly' | 'noshell';

export const PERMISSION_PRESET_LABEL: Record<AgentPermissionPreset, string> = {
  full: '完全权限',
  readonly: '只读模式',
  noshell: '禁用命令',
};

/** 预设到 pi 启动参数的映射：工具集只能在进程启动时确定 */
export function permissionPresetFlags(preset: AgentPermissionPreset): { tools?: string; excludeTools?: string } {
  if (preset === 'readonly') return { tools: 'read,grep,find,ls' };
  if (preset === 'noshell') return { excludeTools: 'bash' };
  return {};
}

export interface AgentSessionSettings {
  model?: string;
  thinking?: string;
  permission: AgentPermissionPreset;
  cwd?: string;
}

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
  /** 记录每个会话的模型与权限设置，重启后沿用 */
  private settingsBySession = new Map<string, AgentSessionSettings>();

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
    const previous = this.settingsBySession.get(sessionId);
    const cwd = options.cwd || previous?.cwd || summary?.cwd || os.homedir();
    const taskId = `${GLOBAL_AGENT_PREFIX}${sessionId}`;
    const permission = options.permission || previous?.permission || 'full';
    const flags = permissionPresetFlags(permission);
    const model = options.model || previous?.model;
    const thinking = options.thinking || previous?.thinking;

    const session = new PiRpcSessionInstance({
      taskId,
      taskTitle: summary?.firstUserMessage || 'Agent 会话',
      sessionId,
      cwd,
      model,
      thinking,
      tools: options.tools || flags.tools,
      excludeTools: options.excludeTools || flags.excludeTools,
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

    // 扩展 UI 请求（审批 / 选择）转发给 WS 层
    session.on('uiRequest', (request: any) => {
      this.emit('uiRequest', { ...request, sessionId });
    });

    this.sessions.set(sessionId, session);
    this.cwdBySession.set(sessionId, cwd);
    this.settingsBySession.set(sessionId, { model, thinking, permission, cwd });
    logger.info(`打开全局 Agent 会话: ${sessionId} (cwd: ${cwd}, permission: ${permission})`);

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

  /** 模型 / 思考等级：进程在线时热切换，离线时记入下次启动参数 */
  public async setModel(
    sessionId: string,
    model?: string,
    thinking?: string
  ): Promise<{ applied: boolean; queued: boolean }> {
    const session = this.sessions.get(sessionId);
    const previous = this.settingsBySession.get(sessionId) || { permission: 'full' as AgentPermissionPreset };
    this.settingsBySession.set(sessionId, {
      ...previous,
      model: model || previous.model,
      thinking: thinking || previous.thinking,
    });
    if (!session || !session.active) return { applied: false, queued: true };
    const result = await session.applyRuntimeSettings({ model, thinking });
    return { applied: result !== 'failed', queued: result === 'queued' };
  }

  /** 权限预设：工具集在启动时固定，在线会话需要重启子进程 */
  public async setPermission(
    sessionId: string,
    preset: AgentPermissionPreset
  ): Promise<{ applied: boolean; restarted: boolean }> {
    const previous = this.settingsBySession.get(sessionId) || { permission: 'full' as AgentPermissionPreset };
    this.settingsBySession.set(sessionId, { ...previous, permission: preset });

    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return { applied: true, restarted: false };

    const cwd = this.cwdBySession.get(sessionId);
    this.stop(sessionId);
    await this.open(sessionId, { cwd, permission: preset });
    return { applied: true, restarted: true };
  }

  /** 会话可用模型列表；进程未启动时返回空数组 */
  public async listModels(sessionId: string): Promise<Array<{ id: string; provider: string }>> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.active) return [];
    return session.listModels();
  }

  public getSettings(sessionId: string): AgentSessionSettings {
    return this.settingsBySession.get(sessionId) || { permission: 'full' };
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

  /** 回应扩展 UI 请求 */
  public respondUiRequest(
    sessionId: string,
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean }
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.respondExtensionUi(id, response);
    return true;
  }

  /** 供 WS 层订阅扩展 UI 请求 */
  public onUiRequest(listener: (request: any) => void): () => void {
    this.on('uiRequest', listener);
    return () => this.off('uiRequest', listener);
  }

  /** 供 WS 层订阅增量事件 */
  public onStream(listener: (event: AgentStreamEvent) => void): () => void {
    this.on('stream', listener);
    return () => this.off('stream', listener);
  }
}

export const agentSessionHost = AgentSessionHost.getInstance();
