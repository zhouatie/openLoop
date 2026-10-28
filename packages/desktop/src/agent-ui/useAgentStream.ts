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

function mergeMessages(
  history: SessionChatMessage[] | undefined,
  live: SessionChatMessage[] | undefined
): SessionChatMessage[] {
  if (!history || history.length === 0) return live || [];
  if (!live || live.length === 0) return history;
  const seen = new Set(history.map((message) => message.id));
  return history.concat(live.filter((message) => !seen.has(message.id)));
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

  const reload = useCallback(async () => {
    if (!load) return;
    // 快照请求在途期间若已有实时事件到达，说明快照比现状旧，直接丢弃，
    // 否则旧的 isBusy 会把运行指示卡在「进行中」。
    const stamp = stateStampRef.current;
    try {
      const next = await load();
      if (!next || stamp !== stateStampRef.current) return;
      stateRef.current = next;
      scheduleRender();
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
      if (import.meta.env?.DEV) console.log('[AgentStream] 快照', state.taskId, 'isBusy=', state.isBusy);
      stateStampRef.current += 1;
      // 快照为权威状态：保留历史前缀，实时段整体替换
      stateRef.current = { ...state, messages: state.messages };
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
    if (import.meta.env?.DEV) console.log('[AgentStream] rawBusy 变更:', rawBusy, streamKey);
    if (rawBusy) {
      setSteadyBusy(true);
      return;
    }
    const timer = window.setTimeout(() => setSteadyBusy(false), BUSY_IDLE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [rawBusy, streamKey]);

  const state = stateRef.current;
  const messages = useMemo(
    () => mergeMessages(historyRef.current, state?.messages),
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
