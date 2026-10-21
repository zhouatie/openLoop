import { useEffect, useRef } from 'react';
import { Task } from '@openloop/core';

/** 需要人工介入的提醒类型：待验收确认，或执行失败退回待处理 */
type Attention = 'review' | 'failed';

const ATTENTION_LABELS: Record<Attention, string> = {
  review: '任务待验收',
  failed: '任务执行失败',
};

/** 从任务快照推导提醒类型；无人工介入需求时返回 null */
function attentionOf(task: Task): Attention | null {
  // 调试运行由流程编排页就地观察，且子任务的失败会汇总到所属任务组，均不单独提醒
  if (task.triggerSource === 'debug') return null;
  if (task.status === 'failed') return task.parentTaskId ? null : 'failed';
  if (task.status === 'waiting_approval' || task.kanbanColumn === 'qa_review') return 'review';
  return null;
}

function showNotification(title: string, body: string) {
  if (import.meta.env.DEV) {
    console.log('[Notify] 发送桌面通知:', { title, body });
  }
  if (window.electronAPI?.notify) {
    window.electronAPI.notify({ title, body }).catch((err) => {
      console.warn('[Notify] 桌面通知发送失败:', err);
    });
    return;
  }
  // 浏览器预览环境回退到 Web Notification
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(title, { body });
}

/**
 * 任务进入人工介入环节时发送桌面通知。
 * 首次观察到的任务只记录状态，避免启动或断线重连时补发历史提醒。
 */
export const useTaskNotifications = (tasks: Task[]): void => {
  const lastAttention = useRef<Map<string, Attention | null>>(new Map());

  useEffect(() => {
    if (window.electronAPI?.notify || typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    for (const task of tasks) {
      const current = attentionOf(task);
      const previous = lastAttention.current.get(task.id);
      if (previous !== undefined && current !== null && current !== previous) {
        showNotification(ATTENTION_LABELS[current], task.title);
      }
      lastAttention.current.set(task.id, current);
    }
  }, [tasks]);
};
