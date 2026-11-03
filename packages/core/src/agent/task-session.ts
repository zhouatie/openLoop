/**
 * 任务会话反查：任务复用的就是同一条 pi 会话，会话文件本身没有任务字段，
 * 这里按任务上下文记录的会话 ID 建立「会话 → 任务」映射，供智能体侧栏标注归属。
 */
import type { Task } from '../types';

/** 侧栏标注所需的任务引用 */
export interface TaskSessionRef {
  id: string;
  title: string;
}

/** 任务会话 ID：上下文已记录的优先，否则按任务 ID 推导（与执行器同一约定） */
export function resolveTaskSessionId(task: Task): string {
  const recorded = task.context?.sessionId || task.context?.piSessionId;
  if (recorded) return String(recorded);
  return `session_${task.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** 会话 → 任务 反查表；同一会话被多个任务占用时保留先到的（调用方按最近更新排序） */
export function buildTaskSessionIndex(tasks: Task[]): Map<string, TaskSessionRef> {
  const index = new Map<string, TaskSessionRef>();
  for (const task of tasks) {
    const sessionId = resolveTaskSessionId(task);
    if (index.has(sessionId)) continue;
    index.set(sessionId, { id: task.id, title: task.title });
  }
  return index;
}
