import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { SessionChatMessage, TaskAttachment, TaskSessionState } from '@openloop/core/types';
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

  const reload = useCallback(async () => {
    if (!load) return;
    try {
      const next = await load();
      if (next) {
        stateRef.current = next;
        scheduleRender();
      }
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.warn('[AgentStream] 加载会话快照失败:', err);
      }
    }
  }, [load, scheduleRender]);

  useEffect(() => {
    if (!enabled || !streamKey) return;
    let disposed = false;

    stateRef.current = null;
    reload();

    const offSnapshot = api.on('agent:chat_update', (state: TaskSessionState) => {
      if (disposed || !state || state.taskId !== streamKey) return;
      // 快照为权威状态：保留历史前缀，实时段整体替换
      stateRef.current = { ...state, messages: state.messages };
      scheduleRender();
    });

    const offStream = api.on('agent:stream', (event) => {
      if (disposed || !event || event.taskId !== streamKey) return;
      const next = applyAgentEvent(stateRef.current, event);
      if (next !== stateRef.current) {
        stateRef.current = next;
        scheduleRender();
      }
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
  }, [streamKey, enabled, reload, scheduleRender]);

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

  // busy 稳定化：置位立刻生效，熄灭延迟 BUSY_IDLE_GRACE_MS，跨过一轮之间的间隙
  const rawBusy = Boolean(stateRef.current?.isBusy);
  const [steadyBusy, setSteadyBusy] = useState(rawBusy);
  useEffect(() => {
    if (rawBusy) {
      setSteadyBusy(true);
      return;
    }
    const timer = window.setTimeout(() => setSteadyBusy(false), BUSY_IDLE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [rawBusy]);

  const state = stateRef.current;
  const overlapCache = useRef<OverlapCache>({ start: -1 });
  const messages = useMemo(
    () => mergeMessages(historyRef.current, state?.messages, overlapCache.current),
    [state, historyRef.current]
  );

  return {
    state,
    messages,
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
