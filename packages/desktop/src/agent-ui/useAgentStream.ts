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
 * 消息的稳定身份：pi 会话条目 id
 *
 * 磁盘历史与实时段是同一份会话的前后两段，消息落盘后两侧拿到同一个条目 id。
 * 还没落盘的实时消息退回本地 id：它本身就不在历史里，不会与历史行撞车。
 */
function messageKey(message: SessionChatMessage): string {
  return message.entryId || message.id;
}

/**
 * 历史 + 实时段合并
 *
 * 按条目 id 归并：一条消息只出现一次，顺序始终是会话的写入顺序。
 * 绝不比内容：内容会被实时段改写（流式半句、完成标记抹除），短句重复（「好的」「继续」）时
 * 按内容根本判不出谁是谁，同一段对话就会在列表里出现两遍。
 */
function mergeMessages(
  history: SessionChatMessage[] | undefined,
  live: SessionChatMessage[] | undefined
): SessionChatMessage[] {
  if (!live || live.length === 0) return history || [];
  if (!history || history.length === 0) return live;

  const liveKeys = new Set(live.map(messageKey));
  const merged: SessionChatMessage[] = [];
  let historyIndex = 0;
  let liveIndex = 0;

  while (historyIndex < history.length && liveIndex < live.length) {
    const historyKey = messageKey(history[historyIndex]);
    if (historyKey === messageKey(live[liveIndex])) {
      // 同一条消息：以实时段为准，它持有流式状态与工具记录，增量事件也按它的 id 打补丁
      merged.push(live[liveIndex]);
      historyIndex += 1;
      liveIndex += 1;
      continue;
    }
    if (!liveKeys.has(historyKey)) {
      // 历史独有：压缩提示、扩展消息、别的进程后来写入的行，原位保留
      merged.push(history[historyIndex]);
      historyIndex += 1;
      continue;
    }
    // 实时独有：还没落盘的新消息，插在对齐位置
    merged.push(live[liveIndex]);
    liveIndex += 1;
  }

  for (; liveIndex < live.length; liveIndex += 1) merged.push(live[liveIndex]);
  for (; historyIndex < history.length; historyIndex += 1) merged.push(history[historyIndex]);
  return merged;
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
  const frameRef = useRef<number | null>(null);
  const [, forceRender] = useReducer((value: number) => value + 1, 0);

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
      stateRef.current = next ? { ...next, taskId: streamKey } : null;
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

    /** 事件是否来自同一条物理会话的另一个进程（例如全局 Agent 面板与任务流水线） */
    const isExternalSameSession = (routeKey: string) => {
      const ownSessionId = stateRef.current?.sessionId;
      if (!ownSessionId) return false;
      return (
        routeKey === `${GLOBAL_AGENT_PREFIX}${ownSessionId}` ||
        streamKey === `${GLOBAL_AGENT_PREFIX}${ownSessionId}`
      );
    };

    const offSnapshot = api.on('agent:chat_update', (state: TaskSessionState) => {
      if (disposed || !state) return;
      if (state.taskId !== streamKey) {
        // 同一份 pi 会话在别处被继续对话：重新拉取快照
        if (!isExternalSameSession(state.taskId)) return;
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
      // 快照为权威状态：保留历史前缀，实时段整体替换，确保路由标识对齐当前流键
      stateRef.current = { ...state, taskId: streamKey, messages: state.messages };
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
  const messages = useMemo(
    () => mergeMessages(historyMessages, state?.messages),
    [state, historyMessages]
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
