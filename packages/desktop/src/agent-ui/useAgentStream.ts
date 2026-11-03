import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PendingUserInput, SessionChatMessage, TaskAttachment, TaskSessionState } from '@openloop/core/types';
import { applyAgentEvent } from '@openloop/core/agent-events';
import { api } from '../services/api';

/** pi 一轮结束到下一轮开始之间有几十毫秒的 isBusy:false 间隙，界面要跨过它，否则按钮与运行指示会闪 */
const BUSY_IDLE_GRACE_MS = 700;

/** 全局 Agent 会话的事件路由键前缀：同一条物理会话在别处继续对话时，事件带这个前缀 */
const GLOBAL_AGENT_PREFIX = 'agent_';
/** 外部同会话改动的快照间隔：一轮只需补一次，避免流式期间反复读盘 */
const EXTERNAL_RELOAD_MIN_MS = 1500;

/** 会话侧的写操作由调用方按场景注入（任务会话 / 全局会话走不同接口） */
export interface AgentTransport {
  send: (
    message: string,
    attachments?: TaskAttachment[],
    extra?: Record<string, unknown>
  ) => Promise<unknown>;
  /** 撤回一条还没被采纳的排队输入 */
  withdraw?: (pendingId: string) => Promise<unknown>;
  pause?: () => Promise<unknown>;
  resume?: () => Promise<unknown>;
  stop?: () => Promise<unknown>;
}

export interface UseAgentStreamOptions {
  /** 事件路由键：任务会话为 task.id，全局会话为 `agent_<sessionId>` */
  streamKey: string | null;
  /** 首屏快照来源 */
  load?: () => Promise<TaskSessionState | null | undefined>;
  /** 历史消息：浏览历史会话时拼在实时消息之前 */
  historyMessages?: SessionChatMessage[];
  transport?: AgentTransport;
  enabled?: boolean;
}

export interface UseAgentStreamResult {
  state: TaskSessionState | null;
  messages: SessionChatMessage[];
  /** 已提交、等待 Agent 采纳的用户输入：不属于会话流，渲染在流尾部 */
  pendingInputs: PendingUserInput[];
  isBusy: boolean;
  awaitingInput: boolean;
  active: boolean;
  lastError?: string;
  sendMessage: (
    message: string,
    attachments?: TaskAttachment[],
    extra?: Record<string, unknown>
  ) => Promise<void>;
  /** 撤回排队中的插话（未实现时不提供） */
  withdraw?: (pendingId: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * 同一条物理消息在两侧 id 不同（磁盘用 pi 条目 id，实时段用时间戳 id），只能按内容对齐。
 * 流式中的实时内容可能只是磁盘内容的片段，所以按前缀兼容比较。
 */
function sameMessage(a: SessionChatMessage, b: SessionChatMessage): boolean {
  if (a.role !== b.role) return false;
  const left = a.content || '';
  const right = b.content || '';
  if (left === right) return true;
  if (left.length === right.length || left.length === 0 || right.length === 0) return false;
  return left.length > right.length ? left.startsWith(right) : right.startsWith(left);
}

interface OverlapCache {
  history?: SessionChatMessage[];
  head?: string;
  start: number;
}

/** 对齐时向前看几行：压缩提示这类历史独有的行会让两侧错位，但错位只在一两行内 */
const ALIGN_LOOKAHEAD = 16;

/** 从 from 起向后找一条与 target 同内容的行，返回下标；找不到返回 -1 */
function findMatch(rows: SessionChatMessage[], from: number, target: SessionChatMessage): number {
  const end = Math.min(rows.length, from + ALIGN_LOOKAHEAD);
  for (let index = from; index < end; index += 1) {
    if (sameMessage(rows[index], target)) return index;
  }
  return -1;
}

/**
 * 实时段在历史里的起点
 *
 * 实时段是同一会话的尾部延续，定位只需要一个锚点：从后往前找第一条能与实时段连续对齐的历史消息。
 * 历史里还有实时段不会产生的行（压缩提示、扩展消息、pi 没有回显的重复用户消息），
 * 对齐时允许跳过它们，否则一遇到压缩提示就找不到锚点。
 * 越靠后的同文消息越可能是实时段的起点，所以从后往前扫、命中即停。
 * 历史与实时段都不再变化时（同一数组 + 同一首条消息）直接复用上次结果，流式期间每帧都是 O(1)。
 */
function findOverlapStart(
  history: SessionChatMessage[],
  live: SessionChatMessage[],
  cache: OverlapCache
): number {
  const head = live[0].id;
  if (cache.history === history && cache.head === head) return cache.start;

  let start = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (!sameMessage(history[index], live[0])) continue;
    let cursor = index + 1;
    let matched = 1;
    while (matched < live.length && cursor < history.length) {
      if (sameMessage(history[cursor], live[matched])) {
        matched += 1;
        cursor += 1;
        continue;
      }
      const skip = findMatch(history, cursor + 1, live[matched]);
      if (skip < 0) break;
      cursor = skip;
    }
    // 只认两种收尾：实时段全部对上，或历史尾部全部用完（实时段带着还没落盘的新消息）
    if (matched === live.length || cursor >= history.length) {
      start = index;
      break;
    }
  }

  cache.history = history;
  cache.head = head;
  cache.start = start;
  return start;
}

/** 消息指纹：同一条消息两侧 id 不同，只能按角色 + 正文对齐 */
function signature(message: SessionChatMessage): string {
  return `${message.role}\u0000${message.content || ''}`;
}

/**
 * 找不到锚点时的兜底：历史一行都不动，只把历史里还没有的实时消息补在末尾。
 * 实时段永远比历史新，补在末尾不会让旧消息跑到最新消息下面。
 */
function appendFreshLive(history: SessionChatMessage[], live: SessionChatMessage[]): SessionChatMessage[] {
  const left = new Map<string, number>();
  for (const message of history) left.set(signature(message), (left.get(signature(message)) || 0) + 1);

  const fresh: SessionChatMessage[] = [];
  for (const message of live) {
    const key = signature(message);
    const count = left.get(key) || 0;
    if (count > 0) {
      left.set(key, count - 1);
      continue;
    }
    fresh.push(message);
  }
  return fresh.length === 0 ? history : history.concat(fresh);
}

/**
 * 对齐合并
 *
 * 对齐的行以实时段为准（它持有流式状态与工具记录，增量事件也按它的 id 打补丁），
 * 历史独有的行留在原位，实时段独有的行插在对齐位置。
 * 历史任何一行都不会被挪到末尾：旧消息出现在最新消息下面，正是这条规则要杜绝的。
 */
function alignLive(
  history: SessionChatMessage[],
  live: SessionChatMessage[],
  start: number
): SessionChatMessage[] {
  const merged = history.slice(0, start);
  let cursor = start;
  let index = 0;

  while (index < live.length) {
    if (cursor >= history.length) {
      merged.push(live[index]);
      index += 1;
      continue;
    }
    if (sameMessage(history[cursor], live[index])) {
      merged.push(live[index]);
      cursor += 1;
      index += 1;
      continue;
    }
    // 历史独有的行（压缩提示等）：原位保留，继续用实时段对齐
    if (findMatch(history, cursor + 1, live[index]) >= 0) {
      merged.push(history[cursor]);
      cursor += 1;
      continue;
    }
    // 实时段独有的行（还没落盘的新消息）：插在对齐位置
    if (findMatch(live, index + 1, history[cursor]) >= 0) {
      merged.push(live[index]);
      index += 1;
      continue;
    }
    // 同一条消息内容被改写：以实时段为准
    merged.push(live[index]);
    cursor += 1;
    index += 1;
  }

  for (; cursor < history.length; cursor += 1) merged.push(history[cursor]);
  return merged;
}

function mergeMessages(
  history: SessionChatMessage[] | undefined,
  live: SessionChatMessage[] | undefined,
  cache: OverlapCache
): SessionChatMessage[] {
  if (!live || live.length === 0) return history || [];
  if (!history || history.length === 0) return live;

  const start = findOverlapStart(history, live, cache);
  if (start < 0) return appendFreshLive(history, live);

  return alignLive(history, live, start);
}

/**
 * Agent 会话数据源
 *
 * 逐事件归约到 ref，渲染按动画帧合并，避免每个 token 触发一次 React 更新。
 * 未被修改的消息对象引用保持不变，配合行级 memo 可跳过重渲染。
 */
export function useAgentStream(options: UseAgentStreamOptions): UseAgentStreamResult {
  const { streamKey, load, historyMessages, transport, enabled = true } = options;

  const stateRef = useRef<TaskSessionState | null>(null);
  /** 实时事件序号：用于识别并丢弃过期的快照请求结果 */
  const stateStampRef = useRef(0);
  /** 上一次因外部同会话改动而取快照的时间 */
  const externalReloadAtRef = useRef(0);
  const historyRef = useRef<SessionChatMessage[] | undefined>(historyMessages);
  const frameRef = useRef<number | null>(null);
  const [, forceRender] = useReducer((value: number) => value + 1, 0);

  historyRef.current = historyMessages;

  const scheduleRender = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      forceRender();
    });
  }, []);

  /**
   * busy 稳定化：置位立刻生效，熄灭延迟 BUSY_IDLE_GRACE_MS，跨过一轮之间的间隙。
   * 由事件驱动而不是靠渲染副作用，避免某次渲染被合并后运行指示一直不熄灭。
   */
  const [steadyBusy, setSteadyBusy] = useState(false);
  const stoppedRef = useRef<number>(0);
  const idleTimerRef = useRef<number | null>(null);
  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current === null) return;
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  }, []);
  const syncBusy = useCallback((busy: boolean) => {
    if (import.meta.env?.DEV) console.log('[AgentStream] busy 同步:', busy);
    clearIdleTimer();
    if (busy) {
      if (stoppedRef.current && Date.now() - stoppedRef.current < 3000) {
        if (import.meta.env?.DEV) console.log('[AgentStream] 终止保护期内，忽略 busy: true');
        return;
      }
      setSteadyBusy(true);
      return;
    }
    stoppedRef.current = 0;
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      setSteadyBusy(false);
    }, BUSY_IDLE_GRACE_MS);
  }, [clearIdleTimer]);

  /**
   * 切换会话：运行态属于产生它的那条会话。已完成的会话没有实时状态，
   * 靠快照熄灭不了，只能在切换的当帧就地熄灭，否则运行指示会一直停在上一条会话上。
   */
  const [busyKey, setBusyKey] = useState(streamKey);
  if (busyKey !== streamKey) {
    setBusyKey(streamKey);
    setSteadyBusy(false);
    clearIdleTimer();
  }

  useEffect(
    () => () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    },
    []
  );

  const reload = useCallback(async () => {
    if (!load) return;
    // 快照请求在途期间若已有实时事件到达，说明快照比现状旧，直接丢弃，
    // 否则旧的 isBusy 会把运行指示卡在「进行中」。
    const stamp = stateStampRef.current;
    try {
      const next = await load();
      if (stamp !== stateStampRef.current) return;
      if (!next) {
        // 没有实时状态 = 进程已结束（已完成的历史会话）：运行指示必须立刻熄灭，不等宽限期
        if (import.meta.env?.DEV) console.log('[AgentStream] 会话无实时状态，运行指示熄灭');
        stateRef.current = null;
        clearIdleTimer();
        setSteadyBusy(false);
        scheduleRender();
        return;
      }
      stateRef.current = next;
      syncBusy(Boolean(next.isBusy));
      scheduleRender();
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.warn('[AgentStream] 加载会话快照失败:', err);
      }
    }
  }, [load, scheduleRender, syncBusy, clearIdleTimer]);

  useEffect(() => {
    if (!enabled || !streamKey) return;
    let disposed = false;

    stateRef.current = null;
    reload();

    /** 事件是否来自同一条物理会话的另一个进程（例如全局 Agent 面板接着对话） */
    const isExternalSameSession = (routeKey: string) => {
      const ownSessionId = stateRef.current?.sessionId;
      return Boolean(ownSessionId) && routeKey === `${GLOBAL_AGENT_PREFIX}${ownSessionId}`;
    };

    const offSnapshot = api.on('agent:chat_update', (state: TaskSessionState) => {
      if (disposed || !state) return;
      if (state.taskId !== streamKey) {
        // 同一份 pi 会话在别处被继续对话：只当刷新信号，等这一轮闲下来再重新取快照
        if (!isExternalSameSession(state.taskId) || state.isBusy) return;
        // 自己这场会话有常驻进程时，实时事件已经覆盖，不必再取快照
        if (stateRef.current?.active) return;
        const now = Date.now();
        if (now - externalReloadAtRef.current < EXTERNAL_RELOAD_MIN_MS) return;
        externalReloadAtRef.current = now;
        if (import.meta.env?.DEV) console.log('[AgentStream] 同一会话在别处有新消息，刷新快照:', state.taskId);
        void reload();
        return;
      }
      if (import.meta.env?.DEV) console.log('[AgentStream] 快照', state.taskId, 'isBusy=', state.isBusy);
      stateStampRef.current += 1;
      // 快照为权威状态：保留历史前缀，实时段整体替换
      stateRef.current = { ...state, messages: state.messages };
      syncBusy(Boolean(state.isBusy));
      scheduleRender();
    });

    const offStream = api.on('agent:stream', (event) => {
      if (disposed || !event || event.taskId !== streamKey) return;
      if (import.meta.env?.DEV && event.kind !== 'message_delta') {
        console.log('[AgentStream] 增量', event.kind, (event as any).patch || '');
      }
      const next = applyAgentEvent(stateRef.current, event);
      if (next === stateRef.current) return;
      stateStampRef.current += 1;
      stateRef.current = next;
      syncBusy(Boolean(next?.isBusy));
      scheduleRender();
    });

    return () => {
      disposed = true;
      offSnapshot();
      offStream();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [streamKey, enabled, reload, scheduleRender, syncBusy]);

  const sendMessage = useCallback(
    async (message: string, attachments?: TaskAttachment[], extra?: Record<string, unknown>) => {
      if (!transport || !message.trim()) return;
      stoppedRef.current = 0;
      await transport.send(message.trim(), attachments, extra);
    },
    [transport]
  );

  const pause = useCallback(async () => {
    stoppedRef.current = Date.now();
    clearIdleTimer();
    setSteadyBusy(false);
    if (stateRef.current) {
      stateRef.current = { ...stateRef.current, isBusy: false };
      scheduleRender();
    }
    try {
      await transport?.pause?.();
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[AgentStream] 暂停会话失败:', err);
    }
  }, [transport, clearIdleTimer, scheduleRender]);
  const withdraw = useCallback(
    async (pendingId: string) => {
      if (import.meta.env?.DEV) console.log('[AgentStream] 撤回排队输入:', pendingId);
      await transport?.withdraw?.(pendingId);
    },
    [transport]
  );

  const resume = useCallback(async () => {
    stoppedRef.current = 0;
    await transport?.resume?.();
  }, [transport]);

  const stop = useCallback(async () => {
    stoppedRef.current = Date.now();
    clearIdleTimer();
    setSteadyBusy(false);
    if (stateRef.current) {
      stateRef.current = { ...stateRef.current, isBusy: false };
      scheduleRender();
    }
    try {
      await transport?.stop?.();
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[AgentStream] 停止会话失败:', err);
    }
  }, [transport, clearIdleTimer, scheduleRender]);

  const state = stateRef.current;
  const overlapCache = useRef<OverlapCache>({ start: -1 });
  const messages = useMemo(
    () => mergeMessages(historyRef.current, state?.messages, overlapCache.current),
    [state, historyRef.current]
  );
  const pendingInputs = useMemo(() => state?.pendingInputs ?? [], [state]);
  const pendingCount = pendingInputs.length;
  useEffect(() => {
    if (import.meta.env?.DEV) console.log('[AgentStream] 本地回显数量:', pendingCount);
  }, [pendingCount]);

  return {
    state,
    messages,
    pendingInputs,
    isBusy: steadyBusy,
    awaitingInput: Boolean(state?.awaitingInput),
    active: state ? state.active : true,
    lastError: state?.lastError,
    sendMessage,
    withdraw,
    pause,
    resume,
    stop,
    reload,
  };
}
