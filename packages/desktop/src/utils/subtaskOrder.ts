import type { Task } from '@openloop/core';

export interface OrderedSubTask {
  st: Task;
  orderNo: number;
}

/**
 * 子工序展示排序：未完成的排在已完成之前；同组内按最新添加在前。
 * orderNo 仍沿用创建顺序。
 */
export function orderSubTasksForDisplay(subTasks: Task[]): OrderedSubTask[] {
  const items = subTasks.map((st, idx) => ({ st, orderNo: idx + 1 })).reverse();
  return [
    ...items.filter((item) => item.st.status !== 'completed'),
    ...items.filter((item) => item.st.status === 'completed'),
  ];
}
