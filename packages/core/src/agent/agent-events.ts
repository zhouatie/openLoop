import type {
  PendingUserInput,
  SessionChatMessage,
  SessionUsage,
  TaskSessionState,
  ToolExecutionRecord,
  ToolKind,
} from '../types';

/**
 * Agent 会话推流事件
 *
 * 设计目标：流式输出期间只推送增量，避免每个 token 都序列化全部历史消息。
 * - `snapshot`：权威全量快照，用于重连、切会话、以及增量累积误差的兜底对账
 * - 其余事件：只携带真正变化的部分，单包目标 < 1KB
 */
export type AgentStreamEvent =
  | AgentSnapshotEvent
  | AgentMessageEvent
  | AgentMessageDeltaEvent
  | AgentMessagePatchEvent
  | AgentToolEvent
  | AgentPendingEvent
  | AgentTitleEvent
  | AgentStatusEvent;

/** 会话名变化：任务标题、自动命名或用户重命名的结果，供侧栏即时换标题 */
export interface AgentTitleEvent {
  kind: 'title';
  taskId: string;
  title: string;
}

export interface AgentSnapshotEvent {
  kind: 'snapshot';
  taskId: string;
  state: TaskSessionState;
}

export interface AgentMessageEvent {
  kind: 'message';
  taskId: string;
  message: SessionChatMessage;
}

export interface AgentMessageDeltaEvent {
  kind: 'message_delta';
  taskId: string;
  messageId: string;
  field: 'content' | 'thinking';
  delta: string;
  isStreaming?: boolean;
  isThinking?: boolean;
}

export interface AgentMessagePatchEvent {
  kind: 'message_patch';
  taskId: string;
  messageId: string;
  patch: Partial<SessionChatMessage>;
}

export interface AgentToolEvent {
  kind: 'tool';
  taskId: string;
  messageId: string;
  tool: ToolExecutionRecord;
}

/** 本地回显层变更：已提交、等待 Agent 采纳的用户输入 */
export interface AgentPendingEvent {
  kind: 'pending';
  taskId: string;
  pendingInputs: PendingUserInput[];
}

export interface AgentStatusEvent {
  kind: 'status';
  taskId: string;
  patch: Partial<
    Pick<
      TaskSessionState,
      | 'active'
      | 'isBusy'
      | 'isPaused'
      | 'awaitingInput'
      | 'model'
      | 'pendingModel'
      | 'modelError'
      | 'lastError'
      | 'agentName'
      | 'sessionId'
      | 'turnStartedAt'
      | 'lastTurnDurationMs'
    >
  >;
}

/** 单个工具调用事件的推送上限：超大结果留在快照里，增量包只带摘要 */
const MAX_EVENT_TEXT = 2000;

/** 粗粒度工具分类，供界面选择卡片形态（纯展示用，不参与业务判定） */
export function classifyToolKind(name: string | undefined): ToolKind {
  const tool = (name || '').toLowerCase();
  if (!tool) return 'other';
  if (tool === 'bash' || tool === 'shell' || tool === 'terminal' || tool.startsWith('bash_')) return 'execute';
  if (tool === 'read' || tool === 'ls' || tool === 'glob' || tool === 'view' || tool === 'cat') return 'read';
  if (tool === 'write' || tool === 'edit' || tool === 'patch' || tool === 'apply_patch' || tool === 'multiedit')
    return 'write';
  if (tool === 'grep' || tool === 'find' || tool === 'search' || tool === 'codebase_search') return 'search';
  if (tool.startsWith('web') || tool === 'fetch' || tool === 'browser') return 'browse';
  if (tool === 'task' || tool === 'subagent' || tool === 'agent') return 'agent';
  if (tool.startsWith('image') || tool === 'screenshot') return 'media';
  return 'other';
}

/** 把 pi 的 usage 结构压成界面需要的几个数字 */
export function compactUsage(usage: any): SessionUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const cost = typeof usage.cost === 'object' && usage.cost ? usage.cost.total : usage.cost;
  const compact: SessionUsage = {
    input: typeof usage.input === 'number' ? usage.input : undefined,
    output: typeof usage.output === 'number' ? usage.output : undefined,
    cacheRead: typeof usage.cacheRead === 'number' ? usage.cacheRead : undefined,
    cacheWrite: typeof usage.cacheWrite === 'number' ? usage.cacheWrite : undefined,
    totalTokens: typeof usage.totalTokens === 'number' ? usage.totalTokens : undefined,
    cost: typeof cost === 'number' ? cost : undefined,
  };
  const defined = Object.values(compact).some((value) => typeof value === 'number');
  return defined ? compact : undefined;
}

/** 工具事件瘦身：超大输出不进入增量包，由快照兜底 */
export function compactToolForEvent(tool: ToolExecutionRecord): ToolExecutionRecord {
  const result = tool.result;
  if (typeof result === 'string' && result.length > MAX_EVENT_TEXT) {
    return { ...tool, result: `${result.slice(0, MAX_EVENT_TEXT)}\n… (${result.length - MAX_EVENT_TEXT} 字符已省略)` };
  }
  if (result && typeof result === 'object') {
    try {
      const serialized = JSON.stringify(result);
      if (serialized.length > MAX_EVENT_TEXT) {
        return { ...tool, result: `${serialized.slice(0, MAX_EVENT_TEXT)}…` };
      }
    } catch (_) {
      return { ...tool, result: '[结果无法序列化]' };
    }
  }
  return tool;
}

function upsertMessage(messages: SessionChatMessage[], next: SessionChatMessage): SessionChatMessage[] {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index < 0) return [...messages, next];
  if (messages[index] === next) return messages;
  const copy = messages.slice();
  copy[index] = next;
  return copy;
}

function patchMessage(
  messages: SessionChatMessage[],
  messageId: string,
  updater: (message: SessionChatMessage) => SessionChatMessage
): SessionChatMessage[] {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return messages;
  const next = updater(messages[index]);
  if (next === messages[index]) return messages;
  const copy = messages.slice();
  copy[index] = next;
  return copy;
}

/**
 * 客户端归约器：把事件流还原成完整会话状态。
 * 服务端与渲染进程共用同一份实现，避免两端语义漂移。
 * 返回原引用表示未发生变化，便于 React 层跳过重渲染。
 */
export function applyAgentEvent(
  state: TaskSessionState | null,
  event: AgentStreamEvent
): TaskSessionState | null {
  if (event.kind === 'snapshot') {
    return event.state;
  }

  if (!state) {
    if (event.kind === 'status' || event.kind === 'pending' || event.kind === 'message') {
      state = {
        taskId: event.taskId,
        active: true,
        isBusy: false,
        isPaused: false,
        messages: [],
      };
    } else {
      // 快照到达之前先忽略增量，避免半截状态
      return state;
    }
  }

  if (state.taskId !== event.taskId) {
    return state;
  }

  switch (event.kind) {
    case 'message': {
      const messages = upsertMessage(state.messages, event.message);
      return messages === state.messages ? state : { ...state, messages };
    }

    case 'message_delta': {
      const messages = patchMessage(state.messages, event.messageId, (message) => {
        const base = message[event.field] || '';
        return {
          ...message,
          [event.field]: base + event.delta,
          isStreaming: event.isStreaming ?? message.isStreaming,
          isThinking: event.isThinking ?? message.isThinking,
        };
      });
      return messages === state.messages ? state : { ...state, messages };
    }

    case 'message_patch': {
      const messages = patchMessage(state.messages, event.messageId, (message) => ({
        ...message,
        ...event.patch,
      }));
      return messages === state.messages ? state : { ...state, messages };
    }

    case 'tool': {
      const messages = patchMessage(state.messages, event.messageId, (message) => {
        const tools = message.tools ? message.tools.slice() : [];
        const index = tools.findIndex((tool) => tool.id === event.tool.id);
        if (index < 0) tools.push(event.tool);
        else tools[index] = { ...tools[index], ...event.tool };
        return { ...message, tools };
      });
      return messages === state.messages ? state : { ...state, messages };
    }

    case 'status': {
      return { ...state, ...event.patch };
    }

    case 'pending': {
      return { ...state, pendingInputs: event.pendingInputs };
    }

    default:
      return state;
  }
}

/** 判断事件是否属于某个任务（服务端广播路由用） */
export function eventTaskId(event: AgentStreamEvent): string {
  return event.taskId;
}

/** 合并批量增量事件，减少渲染进程 dispatch 次数 */
export function applyAgentEvents(
  state: TaskSessionState | null,
  events: AgentStreamEvent[]
): TaskSessionState | null {
  let next = state;
  for (const event of events) {
    next = applyAgentEvent(next, event);
  }
  return next;
}
