/**
 * 任务候选：@ 引用与 ➕ 面板共用一份短缓存。
 * 每次敲键都打任务接口没有意义，过期后下一次询问自然刷新。
 */
import type { TaskStatus } from '@openloop/core';
import { api } from '../services/api';

export interface TaskOption {
  id: string;
  title: string;
  workflowId: string;
  status: TaskStatus;
  /** 任务组根节点：子工序各自推进，不单独出现在候选里 */
  isGroup: boolean;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待启动',
  running: '运行中',
  waiting_approval: '待确认',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const CACHE_TTL_MS = 15_000;
let cache: { at: number; items: TaskOption[] } | null = null;

/** 新建任务后清缓存：下一次打开候选能看到刚建的任务与任务组 */
export function invalidateTaskOptions(): void {
  cache = null;
}

export async function loadTaskOptions(): Promise<TaskOption[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;
  const list = await api.getTasks();
  const items = list
    .filter((task) => task.kind !== 'subtask')
    .map((task) => ({
      id: task.id,
      title: task.title || '未命名任务',
      workflowId: task.workflowId,
      status: task.status,
      isGroup: task.kind === 'group',
    }));
  cache = { at: Date.now(), items };
  return items;
}
