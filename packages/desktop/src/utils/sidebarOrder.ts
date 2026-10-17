import { PluginManifest } from '@openloop/core';

export const FIXED_SIDEBAR_IDS = ['kanban', 'workflow-editor'] as const;
export const STORAGE_KEY_SIDEBAR_ORDER = 'openloop_sidebar_order_v1';

/**
 * 从 localStorage 读取已保存的侧边栏排序 ID 列表
 */
export function getStoredSidebarOrder(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SIDEBAR_ORDER);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.warn('[SidebarOrder] 读取排序缓存失败，使用默认排序:', err);
    }
  }
  return [];
}

/**
 * 持久化侧边栏排序到 localStorage
 */
export function saveStoredSidebarOrder(order: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_SIDEBAR_ORDER, JSON.stringify(order));
    if (import.meta.env?.DEV) {
      console.log('[SidebarOrder] 已保存最新侧边栏顺序:', order);
    }
  } catch (err) {
    console.error('[SidebarOrder] 保存排序至 localStorage 异常:', err);
  }
}

/**
 * 获取过滤并完成排序的侧边栏插件列表
 * 规则：
 * 1. 过滤掉 'plugin-manager'（插件扩展已移至系统设置内）
 * 2. 索引 0 固定为 'kanban'（任务看板，不可排）
 * 3. 索引 1 固定为 'workflow-editor'（流程编排，不可排）
 * 4. 索引 >= 2 的其他扩展插件（带有 sidebarItem）根据 customOrder 排序
 */
export function getSortedSidebarPlugins(
  plugins: PluginManifest[],
  customOrder?: string[]
): PluginManifest[] {
  const activeOrder = customOrder || getStoredSidebarOrder();

  // 1. 获取固定前两项
  const kanban = plugins.find((p) => p.id === 'kanban');
  const workflow = plugins.find((p) => p.id === 'workflow-editor');

  const fixedList: PluginManifest[] = [];
  if (kanban) fixedList.push(kanban);
  if (workflow) fixedList.push(workflow);

  // 2. 筛选出除了固定项和插件扩展以外的、挂载到侧边栏的扩展插件
  const others = plugins.filter(
    (p) =>
      p.id !== 'kanban' &&
      p.id !== 'workflow-editor' &&
      p.id !== 'plugin-manager' &&
      Boolean(p.sidebarItem)
  );

  // 3. 根据 customOrder 排序
  const sortedOthers = [...others].sort((a, b) => {
    const idxA = activeOrder.indexOf(a.id);
    const idxB = activeOrder.indexOf(b.id);

    // 若都在自定义顺序中，按顺序排
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    // 在自定义列表中的优先排在前面
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;

    // 都不在自定义列表中时，回退到原始 order 字段或字母序
    const orderA = a.sidebarItem?.order ?? 999;
    const orderB = b.sidebarItem?.order ?? 999;
    return orderA - orderB;
  });

  return [...fixedList, ...sortedOthers];
}

/**
 * 调整可排序项的位置（严禁移动前两项固定项）
 */
export function moveSidebarItem(
  currentPlugins: PluginManifest[],
  fromIndex: number,
  toIndex: number
): PluginManifest[] {
  // 保护前两项不可排序
  if (fromIndex < 2 || toIndex < 2) {
    if (import.meta.env?.DEV) {
      console.warn('[SidebarOrder] 忽略非法排序请求: 任务看板与流程编排为系统固定项，不可调整位置', {
        fromIndex,
        toIndex,
      });
    }
    return currentPlugins;
  }

  if (
    fromIndex < 0 ||
    fromIndex >= currentPlugins.length ||
    toIndex < 0 ||
    toIndex >= currentPlugins.length ||
    fromIndex === toIndex
  ) {
    return currentPlugins;
  }

  const result = [...currentPlugins];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);

  const newOrderIds = result.map((p) => p.id);
  saveStoredSidebarOrder(newOrderIds);

  if (import.meta.env?.DEV) {
    console.log('[SidebarOrder] 成功调整侧边栏项顺序:', {
      movedId: removed.id,
      fromIndex,
      toIndex,
      newOrderIds,
    });
  }

  return result;
}
