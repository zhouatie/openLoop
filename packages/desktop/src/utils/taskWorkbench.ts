/**
 * 任务详情工作台（Workbench）布局偏好：宽度的本地记忆
 */

const DETAIL_WIDTH_STORAGE_KEY = 'openloop_task_detail_width';

/** 宽屏工作台默认宽度：左档案 + 右 Agent 协作流同屏 */
export const DEFAULT_DETAIL_WIDTH = 1180;
/** 保证左右两栏都可用所需的最小宽度 */
export const MIN_DETAIL_WIDTH = 720;

/** 将宽度收敛到当前视口可容纳范围内 */
export function clampDetailWidth(width: number): number {
  const viewportMax = Math.max(MIN_DETAIL_WIDTH, window.innerWidth - 24);
  if (!Number.isFinite(width)) return Math.min(DEFAULT_DETAIL_WIDTH, viewportMax);
  return Math.min(Math.max(Math.round(width), MIN_DETAIL_WIDTH), viewportMax);
}

export function readDetailWidth(): number {
  try {
    const raw = localStorage.getItem(DETAIL_WIDTH_STORAGE_KEY);
    return clampDetailWidth(raw === null ? DEFAULT_DETAIL_WIDTH : Number(raw));
  } catch {
    return DEFAULT_DETAIL_WIDTH;
  }
}

export function saveDetailWidth(width: number): void {
  try {
    localStorage.setItem(DETAIL_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    /* 忽略隐私模式下的存储异常 */
  }
}
