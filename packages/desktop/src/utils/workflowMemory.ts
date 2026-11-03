/**
 * 上次使用的流水线记忆：看板新建任务弹窗与 agent 任务面板共用同一份，
 * 新建任务时不再按列表顺序硬猜默认值。
 */
const STORAGE_KEY_LAST_WORKFLOW = 'openloop_last_used_workflow_id';

export function readLastWorkflowId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_LAST_WORKFLOW) || '';
  } catch (_) {
    return '';
  }
}

export function rememberWorkflowId(id: string): void {
  const trimmed = (id || '').trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(STORAGE_KEY_LAST_WORKFLOW, trimmed);
  } catch (_) {
    // 存储不可用不影响创建
  }
}
