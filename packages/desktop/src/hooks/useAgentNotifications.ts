import { useEffect, useRef } from 'react';
import type { AgentStreamEvent } from '@openloop/core/agent-events';
import { api } from '../services/api';

/** 全局智能体会话的事件路由键前缀：流水线 agent 节点的会话也会经别名带上它 */
const SESSION_PREFIX = 'agent_';
/** 会话名缓存上限：只用于通知正文，超出后整体丢弃重来，不做淘汰 */
const MAX_TITLES = 200;

/** 用户此刻正在看的全局会话（面板可见时上报），用于抑制多余的弹窗打扰 */
let viewingSessionId: string | null = null;

/** 面板切换或关闭会话时上报；面板关闭即视为无人查看 */
export function setViewingAgentSession(sessionId: string | null): void {
  viewingSessionId = sessionId;
}

/** 路由键 → 会话名：由会话命名事件累积，通知正文据此说明是哪条会话 */
const sessionTitles = new Map<string, string>();

/** 会话列表一次性灌入会话名：列表接口自带名字，不必等命名事件逐个补齐 */
export function rememberAgentSessionTitles(entries: Array<{ id: string; title?: string }>): void {
  if (sessionTitles.size > MAX_TITLES) return;
  for (const entry of entries) {
    if (entry?.id && entry.title) sessionTitles.set(`${SESSION_PREFIX}${entry.id}`, entry.title);
  }
}

/** 用时文案：秒级足够，过一分钟才折成分，不在通知里堆小数 */
function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

function showNotification(title: string, body: string, sessionId: string, onOpen: (sessionId: string) => void): void {
  if (import.meta.env.DEV) {
    console.log('[AgentNotify] 发送桌面通知:', { title, body, sessionId });
  }
  if (window.electronAPI?.notify) {
    // 点击唤起窗口后由主进程回推 notification:activate，直达这条会话
    window.electronAPI.notify({ title, body, sessionId }).catch((err) => {
      console.warn('[AgentNotify] 桌面通知发送失败:', err);
    });
    return;
  }
  // 浏览器预览：主进程缺席，点击就在当前窗口里打开会话
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const notification = new Notification(title, { body });
  notification.onclick = () => {
    window.focus();
    onOpen(sessionId);
  };
}

/**
 * 这条会话是不是用户自己开的全局会话。
 * 流水线 agent 节点的会话同样带 `agent_` 前缀，用常驻会话清单区分，避免流水线跑一轮弹一条。
 * 一轮只查一次，不做缓存：缓存会把刚开的会话误判成流水线节点，漏掉该有的提醒。
 */
async function isStandaloneSession(sessionId: string): Promise<boolean> {
  const live = await api.getLiveAgentSessions().catch(() => null);
  if (!live) return false;
  return live.sessions.includes(sessionId);
}

/**
 * Agent 消息结束的全局通知
 *
 * 只订阅 `agent:stream` 并按事件类型早退，逐 token 的增量包一律不进入处理；
 * 一轮彻底收尾（pi 的 agent_settled 才带上一轮用时）才取一次归属清单并弹一条通知。
 * 用户正看着这条会话时不打扰，点击通知直达该会话。
 */
export function useAgentNotifications(onOpenSession: (sessionId: string) => void): void {
  const openRef = useRef(onOpenSession);
  openRef.current = onOpenSession;

  useEffect(() => {
    /** 本轮出过错的会话：错误与收尾是两个事件，收尾时据此换个说法 */
    const failed = new Set<string>();

    const handleTurnEnd = async (key: string, durationMs: number) => {
      const sessionId = key.slice(SESSION_PREFIX.length);
      const hasError = failed.delete(key);
      // 用户正盯着这条会话时不必再弹一次；窗口失焦则照常提醒
      if (viewingSessionId === sessionId && document.hasFocus()) {
        if (import.meta.env.DEV) console.log('[AgentNotify] 用户正在查看该会话，跳过通知:', sessionId);
        return;
      }
      if (!(await isStandaloneSession(sessionId))) {
        if (import.meta.env.DEV) console.log('[AgentNotify] 非全局会话（流水线节点），跳过通知:', sessionId);
        return;
      }
      const name = sessionTitles.get(key) || '智能体会话';
      showNotification(
        hasError ? 'Agent 执行出错' : 'Agent 回复完成',
        `${name} · 用时 ${formatDuration(durationMs)}`,
        sessionId,
        openRef.current
      );
    };

    const off = api.on('agent:stream', (event: AgentStreamEvent) => {
      const kind = event?.kind;
      // 流式增量占绝大多数，先按类型挡掉
      if (kind !== 'status' && kind !== 'title') return;
      const key = event.taskId;
      if (!key?.startsWith(SESSION_PREFIX)) return;

      if (kind === 'title') {
        if (!event.title) return;
        if (sessionTitles.size > MAX_TITLES) sessionTitles.clear();
        sessionTitles.set(key, event.title);
        return;
      }

      const patch = event.patch;
      if (patch.isBusy === true) {
        failed.delete(key);
        return;
      }
      if (patch.lastError) {
        failed.add(key);
        return;
      }
      // turn_end 只是单条回复结束、本轮还会继续跑工具；agent_settled 才带上一轮用时
      if (typeof patch.lastTurnDurationMs !== 'number') return;
      void handleTurnEnd(key, patch.lastTurnDurationMs);
    });

    // 主进程在通知点击时回推会话标识：唤起窗口后直达那条会话
    const offActivate = window.electronAPI?.on('notification:activate', (payload: { sessionId?: string }) => {
      if (!payload?.sessionId) return;
      if (import.meta.env.DEV) console.log('[AgentNotify] 点击通知，打开会话:', payload.sessionId);
      openRef.current(payload.sessionId);
    });

    return () => {
      off();
      offActivate?.();
    };
  }, []);
}
