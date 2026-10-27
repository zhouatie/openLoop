import type { Task, KanbanColumn, TaskStatus } from '@openloop/core';

export type ColumnSortField = 'createdAt' | 'updatedAt' | 'title' | 'id' | 'status';
export type ColumnSortDirection = 'asc' | 'desc';

export interface ColumnSortRule {
  field: ColumnSortField;
  direction: ColumnSortDirection;
}

export type ColumnSortConfigMap = Record<KanbanColumn, ColumnSortRule>;

export interface SortOptionItem {
  id: string;
  field: ColumnSortField;
  direction: ColumnSortDirection;
  label: string;
  shortLabel: string;
  description: string;
  category: 'time' | 'info' | 'status';
}

export const DEFAULT_SORT_RULE: ColumnSortRule = {
  field: 'updatedAt',
  direction: 'desc',
};

export const SORT_OPTIONS: SortOptionItem[] = [
  {
    id: 'updatedAt-desc',
    field: 'updatedAt',
    direction: 'desc',
    label: '更新时间 (最近更新)',
    shortLabel: '最近更新',
    description: '按最近活动时间降序',
    category: 'time',
  },
  {
    id: 'updatedAt-asc',
    field: 'updatedAt',
    direction: 'asc',
    label: '更新时间 (最早更新)',
    shortLabel: '最早更新',
    description: '按活动时间升序',
    category: 'time',
  },
  {
    id: 'createdAt-desc',
    field: 'createdAt',
    direction: 'desc',
    label: '创建时间 (最新优先)',
    shortLabel: '最新创建',
    description: '按任务创建时间降序',
    category: 'time',
  },
  {
    id: 'createdAt-asc',
    field: 'createdAt',
    direction: 'asc',
    label: '创建时间 (最早优先)',
    shortLabel: '最早创建',
    description: '按任务创建时间升序',
    category: 'time',
  },
  {
    id: 'title-asc',
    field: 'title',
    direction: 'asc',
    label: '任务标题 (A 到 Z)',
    shortLabel: '标题 A-Z',
    description: '按标题拼音/字母升序',
    category: 'info',
  },
  {
    id: 'title-desc',
    field: 'title',
    direction: 'desc',
    label: '任务标题 (Z 到 A)',
    shortLabel: '标题 Z-A',
    description: '按标题拼音/字母降序',
    category: 'info',
  },
  {
    id: 'id-desc',
    field: 'id',
    direction: 'desc',
    label: '任务编号 (倒序)',
    shortLabel: '编号倒序',
    description: '按任务 ID 倒序排列',
    category: 'info',
  },
  {
    id: 'id-asc',
    field: 'id',
    direction: 'asc',
    label: '任务编号 (正序)',
    shortLabel: '编号正序',
    description: '按任务 ID 正序排列',
    category: 'info',
  },
  {
    id: 'status-asc',
    field: 'status',
    direction: 'asc',
    label: '状态优先 (活跃在前)',
    shortLabel: '活跃优先',
    description: '运行中 > 待验收 > 待处理 > 失败 > 已完成',
    category: 'status',
  },
];

const STATUS_PRIORITY: Record<TaskStatus, number> = {
  running: 1,
  waiting_approval: 2,
  pending: 3,
  failed: 4,
  completed: 5,
  cancelled: 6,
};

export const KANBAN_SORT_STORAGE_KEY = 'openloop:kanban_column_sort_rules';

export function findSortOption(rule: ColumnSortRule): SortOptionItem {
  const match = SORT_OPTIONS.find(
    (opt) => opt.field === rule.field && opt.direction === rule.direction
  );
  return match || SORT_OPTIONS[0];
}

export function isDefaultSortRule(rule: ColumnSortRule): boolean {
  return rule.field === DEFAULT_SORT_RULE.field && rule.direction === DEFAULT_SORT_RULE.direction;
}

export function loadColumnSortConfig(columns: KanbanColumn[]): ColumnSortConfigMap {
  const result: Partial<ColumnSortConfigMap> = {};
  let loadedFromStorage = false;

  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(KANBAN_SORT_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const col of columns) {
          const rule = parsed[col];
          if (
            rule &&
            typeof rule.field === 'string' &&
            typeof rule.direction === 'string' &&
            SORT_OPTIONS.some((o) => o.field === rule.field && o.direction === rule.direction)
          ) {
            result[col] = {
              field: rule.field,
              direction: rule.direction,
            };
          }
        }
        loadedFromStorage = true;
      }
    }
  } catch (err) {
    console.warn('[KanbanSort] 读取列排序配置失败，降级为默认排序:', err);
  }

  // 为未配置的列补齐默认规则
  for (const col of columns) {
    if (!result[col]) {
      result[col] = { ...DEFAULT_SORT_RULE };
    }
  }

  console.log('[KanbanSort] 初始化看板列排序规则:', {
    fromStorage: loadedFromStorage,
    config: result,
  });

  return result as ColumnSortConfigMap;
}

export function saveColumnSortConfig(config: ColumnSortConfigMap): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(KANBAN_SORT_STORAGE_KEY, JSON.stringify(config));
    }
  } catch (err) {
    console.warn('[KanbanSort] 保存列排序规则至持久化缓存失败:', err);
  }
}

export function sortTasks(tasks: Task[], rule: ColumnSortRule): Task[] {
  return [...tasks].sort((a, b) => {
    let comparison = 0;
    switch (rule.field) {
      case 'createdAt':
        comparison = (a.createdAt || 0) - (b.createdAt || 0);
        break;
      case 'updatedAt':
        comparison = (a.updatedAt || 0) - (b.updatedAt || 0);
        break;
      case 'title':
        comparison = (a.title || '').localeCompare(b.title || '', 'zh-CN');
        break;
      case 'id':
        comparison = (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
        break;
      case 'status': {
        const pA = STATUS_PRIORITY[a.status] ?? 99;
        const pB = STATUS_PRIORITY[b.status] ?? 99;
        comparison = pA - pB;
        break;
      }
      default:
        comparison = (a.createdAt || 0) - (b.createdAt || 0);
    }

    const primaryResult = rule.direction === 'asc' ? comparison : -comparison;
    if (primaryResult !== 0) {
      return primaryResult;
    }

    // 稳定排序兜底：相同权重时以创建时间降序，最后以任务 ID 正序决胜
    const secondaryTime = (b.createdAt || 0) - (a.createdAt || 0);
    if (secondaryTime !== 0) return secondaryTime;
    return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true });
  });
}
