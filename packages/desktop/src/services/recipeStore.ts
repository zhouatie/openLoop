import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot,
  Zap,
  Target,
  FileVideo,
  CheckSquare,
  Terminal,
  GitCommit,
  Rocket,
  Layers,
  Sparkles,
  ClipboardCheck,
  Cpu,
  Workflow,
  CheckCircle2,
  FileCode,
  ShieldCheck,
  PlayCircle,
  Bell,
} from 'lucide-react';
import { NodeType, NodeConfig } from '@openloop/core';
import { WORKFLOW_RECIPES, WorkflowRecipe } from '../constants/workflowRecipes';

export const STORAGE_KEY_CUSTOM_RECIPES = 'openloop_custom_recipes';
export const STORAGE_KEY_PINNED_RECIPES = 'openloop_pinned_recipe_ids';
export const EVENT_RECIPES_UPDATED = 'openloop:recipes_updated';

// 默认固定在左侧常用动作坞的经典配方
export const DEFAULT_PINNED_RECIPE_IDS: string[] = [
  'agent-feature',
  'cli-lint',
  'qa-approval-gate',
  'midscene-test',
  'git-auto-commit',
  'hook-notify',
];

interface SerializedCustomRecipe {
  id: string;
  name: string;
  subtitle: string;
  type: NodeType;
  badge?: string;
  defaultName: string;
  defaultConfig: Partial<NodeConfig>;
  description?: string;
  createdAt: number;
}

// 根据 NodeType 获取默认视觉配置与图标
export function getNodeTypeVisuals(type: NodeType, name?: string, command?: string) {
  const isGit =
    type === 'cli' &&
    (name?.toLowerCase().includes('git') || command?.toLowerCase().includes('git'));
  if (isGit) {
    return {
      icon: GitCommit,
      iconBg: 'bg-[#1c1c21]',
      iconText: 'text-white',
      borderClass: 'border-[#1c1c21]',
    };
  }

  const isDeploy =
    type === 'cli' &&
    (name?.includes('部署') ||
      name?.toLowerCase().includes('deploy') ||
      command?.toLowerCase().includes('deploy'));
  if (isDeploy) {
    return {
      icon: Rocket,
      iconBg: 'bg-[#0f172a]',
      iconText: 'text-[#38bdf8]',
      borderClass: 'border-[#0f172a]',
    };
  }

  switch (type) {
    case 'agent':
      return {
        icon: Bot,
        iconBg: 'bg-[#eeedfd]',
        iconText: 'text-[#4f46e5]',
        borderClass: 'border-[#d8d6fb]',
      };
    case 'cli':
      return {
        icon: Terminal,
        iconBg: 'bg-[#f4f4f6]',
        iconText: 'text-[#4b4b53]',
        borderClass: 'border-[#e3e3e8]',
      };
    case 'qa-approval':
      return {
        icon: CheckSquare,
        iconBg: 'bg-[#fef3c7]',
        iconText: 'text-[#b45309]',
        borderClass: 'border-[#fde68a]',
      };
    case 'midscene':
      return {
        icon: Target,
        iconBg: 'bg-[#e4f6ec]',
        iconText: 'text-[#15803d]',
        borderClass: 'border-[#bbf7d0]',
      };
    case 'stitch-image':
      return {
        icon: FileVideo,
        iconBg: 'bg-[#eff6ff]',
        iconText: 'text-[#1d4ed8]',
        borderClass: 'border-[#bfdbfe]',
      };
    case 'hook':
      return {
        icon: Zap,
        iconBg: 'bg-[#ffedd5]',
        iconText: 'text-[#c2410c]',
        borderClass: 'border-[#fed7aa]',
      };
    case 'env-prepare':
      return {
        icon: Cpu,
        iconBg: 'bg-[#ecfdf5]',
        iconText: 'text-[#047857]',
        borderClass: 'border-[#a7f3d0]',
      };
    case 'sub-workflow':
      return {
        icon: Workflow,
        iconBg: 'bg-[#f0f9ff]',
        iconText: 'text-[#0284c7]',
        borderClass: 'border-[#bae6fd]',
      };
    case 'qa-planner':
      return {
        icon: ClipboardCheck,
        iconBg: 'bg-[#fdf4ff]',
        iconText: 'text-[#a21caf]',
        borderClass: 'border-[#f5d0fe]',
      };
    case 'worktree-setup':
    case 'worktree-merge':
    case 'worktree-cleanup':
      return {
        icon: Layers,
        iconBg: 'bg-[#f0fdf4]',
        iconText: 'text-[#15803d]',
        borderClass: 'border-[#bbf7d0]',
      };
    case 'custom':
    default:
      return {
        icon: Sparkles,
        iconBg: 'bg-[#fdf2f8]',
        iconText: 'text-[#db2777]',
        borderClass: 'border-[#fbcfe8]',
      };
  }
}

/**
 * 读取本地存储的所有自定义动作配方
 */
export function getCustomRecipes(): WorkflowRecipe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_RECIPES);
    if (!raw) return [];
    const list: SerializedCustomRecipe[] = JSON.parse(raw);
    if (!Array.isArray(list)) return [];

    return list.map((item) => {
      const visuals = getNodeTypeVisuals(item.type, item.name, item.defaultConfig?.command);
      return {
        id: item.id,
        name: item.name,
        subtitle: item.subtitle || '自定义动作配方',
        category: 'custom',
        categoryLabel: '我的预设',
        type: item.type,
        icon: visuals.icon,
        iconBg: visuals.iconBg,
        iconText: visuals.iconText,
        borderClass: visuals.borderClass,
        badge: item.badge || '预设',
        defaultName: item.defaultName || item.name,
        defaultConfig: item.defaultConfig || {},
        description: item.description || item.subtitle || '用户自定义保存的动作步骤配方',
        isCustom: true,
        createdAt: item.createdAt || Date.now(),
      };
    });
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.warn('[recipeStore] 读取自定义配方异常:', err);
    }
    return [];
  }
}

/**
 * 获取当前已 Pin (固定到左侧边栏) 的配方 ID 列表
 */
export function getPinnedRecipeIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PINNED_RECIPES);
    if (!raw) return DEFAULT_PINNED_RECIPE_IDS;
    const list = JSON.parse(raw);
    if (Array.isArray(list)) return list;
  } catch (err) {
    if (import.meta.env?.DEV) {
      console.warn('[recipeStore] 读取 Pinned 列表异常:', err);
    }
  }
  return DEFAULT_PINNED_RECIPE_IDS;
}

/**
 * 获取合并后的完整配方列表 (内置 + 自定义) 并标注 isPinned 状态
 */
export function getMergedRecipes(): WorkflowRecipe[] {
  const customList = getCustomRecipes();
  const pinnedIds = new Set(getPinnedRecipeIds());

  const merged = [...customList, ...WORKFLOW_RECIPES].map((recipe) => ({
    ...recipe,
    isPinned: pinnedIds.has(recipe.id),
  }));

  return merged;
}

/**
 * 获取固定在左侧边栏的常用动作配方列表 (按固定顺序排序)
 */
export function getPinnedRecipes(): WorkflowRecipe[] {
  const pinnedIds = getPinnedRecipeIds();
  const allMap = new Map<string, WorkflowRecipe>();

  getMergedRecipes().forEach((r) => allMap.set(r.id, r));

  const result: WorkflowRecipe[] = [];
  pinnedIds.forEach((id) => {
    const found = allMap.get(id);
    if (found) {
      result.push(found);
    }
  });

  return result;
}

/**
 * 保存新的自定义动作配方 (可指定是否立即固定至边栏)
 */
export function saveCustomRecipe(input: {
  name: string;
  subtitle?: string;
  type: NodeType;
  defaultConfig: Partial<NodeConfig>;
  description?: string;
  badge?: string;
  pinToSidebar?: boolean;
}): WorkflowRecipe {
  const id = `custom_${input.type}_${Date.now().toString(36)}`;
  const item: SerializedCustomRecipe = {
    id,
    name: input.name.trim(),
    subtitle: input.subtitle?.trim() || `${input.type.toUpperCase()} 自定义动作`,
    type: input.type,
    badge: input.badge || '自定义',
    defaultName: input.name.trim(),
    defaultConfig: input.defaultConfig || {},
    description: input.description?.trim() || input.subtitle?.trim() || '',
    createdAt: Date.now(),
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_RECIPES);
    const prevList: SerializedCustomRecipe[] = raw ? JSON.parse(raw) : [];
    const nextList = [item, ...prevList];
    localStorage.setItem(STORAGE_KEY_CUSTOM_RECIPES, JSON.stringify(nextList));

    if (input.pinToSidebar) {
      const pinned = getPinnedRecipeIds();
      if (!pinned.includes(id)) {
        localStorage.setItem(STORAGE_KEY_PINNED_RECIPES, JSON.stringify([id, ...pinned]));
      }
    }

    if (import.meta.env?.DEV) {
      console.log('[recipeStore] 自定义配方保存成功:', item);
    }
    window.dispatchEvent(new CustomEvent(EVENT_RECIPES_UPDATED));
  } catch (err) {
    console.error('[recipeStore] 保存自定义配方失败:', err);
  }

  const visuals = getNodeTypeVisuals(item.type, item.name, item.defaultConfig?.command);
  return {
    ...item,
    category: 'custom',
    categoryLabel: '我的预设',
    icon: visuals.icon,
    iconBg: visuals.iconBg,
    iconText: visuals.iconText,
    borderClass: visuals.borderClass,
    isCustom: true,
    isPinned: Boolean(input.pinToSidebar),
  };
}

/**
 * 删除自定义配方
 */
export function deleteCustomRecipe(id: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_RECIPES);
    if (raw) {
      const prevList: SerializedCustomRecipe[] = JSON.parse(raw);
      const nextList = prevList.filter((item) => item.id !== id);
      localStorage.setItem(STORAGE_KEY_CUSTOM_RECIPES, JSON.stringify(nextList));
    }

    // 同时移出 Pinned 列表
    const pinned = getPinnedRecipeIds();
    if (pinned.includes(id)) {
      localStorage.setItem(
        STORAGE_KEY_PINNED_RECIPES,
        JSON.stringify(pinned.filter((pid) => pid !== id))
      );
    }

    if (import.meta.env?.DEV) {
      console.log('[recipeStore] 删除自定义配方成功:', id);
    }
    window.dispatchEvent(new CustomEvent(EVENT_RECIPES_UPDATED));
  } catch (err) {
    console.error('[recipeStore] 删除自定义配方失败:', err);
  }
}

/**
 * 切换某个配方的 Pin (固定到左侧常用坞) 状态
 */
export function togglePinRecipe(id: string): boolean {
  try {
    const pinned = getPinnedRecipeIds();
    const isPinned = pinned.includes(id);
    let nextPinned: string[];

    if (isPinned) {
      nextPinned = pinned.filter((pid) => pid !== id);
    } else {
      nextPinned = [...pinned, id];
    }

    localStorage.setItem(STORAGE_KEY_PINNED_RECIPES, JSON.stringify(nextPinned));
    if (import.meta.env?.DEV) {
      console.log('[recipeStore] 切换配方 Pin 状态:', { id, nextPinned: !isPinned });
    }
    window.dispatchEvent(new CustomEvent(EVENT_RECIPES_UPDATED));
    return !isPinned;
  } catch (err) {
    console.error('[recipeStore] 切换 Pin 状态失败:', err);
    return false;
  }
}

/**
 * React 响应式 Hook
 */
export function useWorkflowRecipes() {
  const [allRecipes, setAllRecipes] = useState<WorkflowRecipe[]>(() => getMergedRecipes());
  const [pinnedRecipes, setPinnedRecipes] = useState<WorkflowRecipe[]>(() => getPinnedRecipes());

  const reload = useCallback(() => {
    setAllRecipes(getMergedRecipes());
    setPinnedRecipes(getPinnedRecipes());
  }, []);

  useEffect(() => {
    const handleUpdate = () => reload();
    window.addEventListener(EVENT_RECIPES_UPDATED, handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener(EVENT_RECIPES_UPDATED, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [reload]);

  const customRecipes = allRecipes.filter((r) => r.isCustom);

  return {
    allRecipes,
    pinnedRecipes,
    customRecipes,
    reload,
    togglePin: togglePinRecipe,
    deleteCustom: deleteCustomRecipe,
    saveCustom: saveCustomRecipe,
  };
}
