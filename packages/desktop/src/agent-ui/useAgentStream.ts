import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PendingUserInput, SessionChatMessage, TaskAttachment, TaskSessionState } from '@openloop/core/types';
import { applyAgentEvent } from '@openloop/core/agent-events';
import { api } from '../services/api';

/** pi 一轮结束到下一轮开始之间有几十毫秒的 isBusy:false 间隙，界面要跨过它，否则按钮与运行指示会闪 */
const BUSY_IDLE_GRACE_MS = 700;

/** 会话侧的写操作由调用方按场景注入（任务会话 / 全局会话走不同接口） */
export interface AgentTransport {
  send: (
    message: string,
    attachments?: TaskAttachment[],
    extra?: Record<string, unknown>
  ) => Promise<unknown>;
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

/**
 * 实时段在历史里的起点
 *
 * 实时段是同一会话的尾部延续，定位只需要一个锚点：从后往前找第一条能与实时段连续对齐的历史消息。
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
    let matched = 1;
    while (
      matched < live.length &&
      index + matched < history.length &&
      sameMessage(history[index + matched], live[matched])
    ) {
      matched += 1;
    }
    // 只认两种收尾：实时段全部对上，或历史尾部全部对上（实时段带着还没落盘的新消息）
    if (matched === live.length || index + matched === history.length) {
      start = index;
      break;
    }
  }

  cache.history = history;
  cache.head = head;
  cache.start = start;
  return start;
}

function mergeMessages(
  history: SessionChatMessage[] | undefined,
  live: SessionChatMessage[] | undefined,
  cache: OverlapCache
): SessionChatMessage[] {
  if (!live || live.length === 0) return history || [];
  if (!history || history.length === 0) return live;

  const start = findOverlapStart(history, live, cache);
  if (start < 0) {
    const seen = new Set(history.map((message) => message.id));
    const extra = live.filter((message) => !seen.has(message.id));
    return extra.length === 0 ? history : history.concat(extra);
  }

  const covered = Math.min(live.length, history.length - start);
  // 历史已被实时段完全覆盖：直接用实时段，不多一次数组拷贝
  if (start === 0 && covered === history.length) return live;
  // 重叠部分一律以实时段为准：它持有流式状态与工具记录，增量事件也按它的 id 打补丁
  return history.slice(0, start).concat(live, history.slice(start + covered));
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
      setSteadyBusy(true);
      return;
    }
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

    const offSnapshot = api.on('agent:chat_update', (state: TaskSessionState) => {
      if (disposed || !state || state.taskId !== streamKey) return;
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
      await transport.send(message.trim(), attachments, extra);
    },
    [transport]
  );

  const pause = useCallback(async () => {
    await transport?.pause?.();
  }, [transport]);

  const resume = useCallback(async () => {
    await transport?.resume?.();
  }, [transport]);

  const stop = useCallback(async () => {
    await transport?.stop?.();
  }, [transport]);

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
    pause,
    resume,
    stop,
    reload,
  };
}
