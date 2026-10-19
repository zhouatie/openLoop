import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  X,
  Sparkles,
  ArrowRight,
  Layers,
  Pin,
  Trash2,
  BookmarkPlus,
} from 'lucide-react';
import {
  WORKFLOW_RECIPE_CATEGORIES,
  WorkflowRecipe,
  RecipeCategory,
} from '../../constants/workflowRecipes';
import { useWorkflowRecipes } from '../../services/recipeStore';
import { toast } from '../Toast';

export interface RecipePickerContextInfo {
  type: 'append' | 'insert' | 'create';
  sourceNodeName?: string;
  targetNodeName?: string;
}

interface RecipePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRecipe: (recipe: WorkflowRecipe) => void;
  contextInfo?: RecipePickerContextInfo;
}

export const RecipePickerModal: React.FC<RecipePickerModalProps> = ({
  isOpen,
  onClose,
  onSelectRecipe,
  contextInfo,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<RecipeCategory | 'all'>('all');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { allRecipes, togglePin, deleteCustom } = useWorkflowRecipes();

  // 每次打开重置状态并聚焦搜索框
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setSelectedCategory('all');
      setFocusedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // 过滤后的配方列表
  const filteredRecipes = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return allRecipes.filter((recipe) => {
      const matchCategory =
        selectedCategory === 'all' || recipe.category === selectedCategory;
      if (!matchCategory) return false;
      if (!term) return true;
      return (
        recipe.name.toLowerCase().includes(term) ||
        recipe.subtitle.toLowerCase().includes(term) ||
        recipe.description?.toLowerCase().includes(term) ||
        recipe.categoryLabel?.toLowerCase().includes(term) ||
        recipe.type.toLowerCase().includes(term)
      );
    });
  }, [searchTerm, selectedCategory, allRecipes]);

  // 键盘导航 (上下选择与回车确认)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) =>
          filteredRecipes.length > 0 ? (prev + 1) % filteredRecipes.length : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) =>
          filteredRecipes.length > 0
            ? (prev - 1 + filteredRecipes.length) % filteredRecipes.length
            : 0
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredRecipes[focusedIndex]) {
          if (import.meta.env?.DEV) {
            console.log('[RecipePickerModal] 回车选定配方:', filteredRecipes[focusedIndex].name);
          }
          onSelectRecipe(filteredRecipes[focusedIndex]);
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredRecipes, focusedIndex, onClose, onSelectRecipe]);

  if (!isOpen) return null;

  const headerTitle = useMemo(() => {
    if (!contextInfo) return '选择流水线步骤动作';
    if (contextInfo.type === 'append' && contextInfo.sourceNodeName) {
      return `在「${contextInfo.sourceNodeName}」之后追加步骤`;
    }
    if (
      contextInfo.type === 'insert' &&
      contextInfo.sourceNodeName &&
      contextInfo.targetNodeName
    ) {
      return `在「${contextInfo.sourceNodeName}」与「${contextInfo.targetNodeName}」之间插入步骤`;
    }
    return '添加流水线步骤动作';
  }, [contextInfo]);

  const handleTogglePin = (e: React.MouseEvent, recipe: WorkflowRecipe) => {
    e.stopPropagation();
    const willPin = !recipe.isPinned;
    togglePin(recipe.id);
    if (willPin) {
      toast.success(`已固定「${recipe.name}」到左侧常用步骤坞`);
    } else {
      toast.info(`已从左侧常用步骤坞取消固定`);
    }
  };

  const handleDeleteCustom = (e: React.MouseEvent, recipe: WorkflowRecipe) => {
    e.stopPropagation();
    deleteCustom(recipe.id);
    toast.success(`已删除自定义配方「${recipe.name}」`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_12px_40px_rgba(0,0,0,0.12)] w-full max-w-[620px] max-h-[82vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. 顶部 Header (依照 design-system.md 规范) */}
        <div className="h-[46px] px-4 bg-[#fafafc] border-b border-[#e3e3e8] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-[4px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center justify-center text-[#4f46e5] shrink-0">
              <Sparkles size={11} strokeWidth={2} />
            </div>
            <span className="text-[12.5px] font-semibold text-[#1c1c21] truncate">
              {headerTitle}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-0.5 rounded border border-[#e3e3e8]">
              ↑↓ 导航 · ↵ 确认
            </span>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer"
              title="关闭 (Esc)"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* 2. 搜索框与分类微胶囊 */}
        <div className="p-3 border-b border-[#f1f1f4] bg-white flex flex-col gap-2 shrink-0">
          <div className="relative flex items-center">
            <Search
              size={13}
              className="absolute left-2.5 text-[#85858d] pointer-events-none"
            />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setFocusedIndex(0);
              }}
              placeholder="搜索动作名称、类型、脚本或说明..."
              className="w-full h-[32px] pl-8 pr-7 bg-[#f9f9fb] focus:bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[6px] text-[12px] text-[#1c1c21] placeholder:text-[#85858d] outline-none transition-all shadow-xs"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 text-[#85858d] hover:text-[#1c1c21] p-0.5 rounded cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* 分类切换器 */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar">
            <button
              onClick={() => {
                setSelectedCategory('all');
                setFocusedIndex(0);
              }}
              className={`h-[24px] px-2.5 rounded-[5px] text-[11px] font-medium transition-all shrink-0 cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-[#1c1c21] text-white shadow-xs'
                  : 'bg-[#f4f4f6] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0]'
              }`}
            >
              全部 ({allRecipes.length})
            </button>
            {WORKFLOW_RECIPE_CATEGORIES.map((cat) => {
              const count = allRecipes.filter((r) => r.category === cat.id).length;
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategory(cat.id);
                    setFocusedIndex(0);
                  }}
                  className={`h-[24px] px-2.5 rounded-[5px] text-[11px] font-medium transition-all shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-[#1c1c21] text-white shadow-xs'
                      : 'bg-[#f4f4f6] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0]'
                  }`}
                >
                  {cat.label} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. 配方列表区域 (符合 design-system 单行紧凑高密度规范) */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#f1f1f4] min-h-[280px] p-1.5">
          {filteredRecipes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#85858d]">
              <Layers size={24} className="mb-2 text-[#a1a1aa]" />
              <div className="text-[12px] font-medium text-[#1c1c21] mb-1">
                {selectedCategory === 'custom'
                  ? '暂无自定义预设配方'
                  : '未匹配到相关动作'}
              </div>
              <div className="text-[11px] text-center max-w-sm px-4">
                {selectedCategory === 'custom'
                  ? '在流水线画布中选中并调通任意节点后，在右侧检查器点击「存为常用」，即可将该配置持久沉淀至此。'
                  : '请尝试更改搜索关键词或切换上方分类'}
              </div>
            </div>
          ) : (
            filteredRecipes.map((recipe, idx) => {
              const isFocused = idx === focusedIndex;
              const IconComp = recipe.icon;
              return (
                <div
                  key={recipe.id}
                  onClick={() => {
                    if (import.meta.env?.DEV) {
                      console.log('[RecipePickerModal] 点击选定动作配方:', recipe.name);
                    }
                    onSelectRecipe(recipe);
                    onClose();
                  }}
                  onMouseEnter={() => setFocusedIndex(idx)}
                  className={`group px-3 py-2.5 rounded-[6px] flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    isFocused ? 'bg-[#f4f4f7]' : 'hover:bg-[#fafafc]'
                  }`}
                >
                  {/* 左侧图标与文本主体 */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-[5px] ${recipe.iconBg} ${recipe.iconText} border ${recipe.borderClass} flex items-center justify-center shrink-0 transition-transform group-hover:scale-105`}
                    >
                      <IconComp size={13} strokeWidth={2.2} />
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[12px] font-medium text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors truncate`}
                        >
                          {recipe.name}
                        </span>
                        <span className="text-[9.5px] px-1 py-[0.5px] rounded bg-[#f4f4f6] text-[#71717a] font-mono border border-[#e3e3e8]">
                          {recipe.type}
                        </span>
                        {recipe.isCustom && (
                          <span className="text-[9.5px] px-1.5 py-[0.5px] rounded bg-[#faf5ff] text-[#9333ea] font-medium border border-[#e9d5ff]">
                            我的预设
                          </span>
                        )}
                        {!recipe.isCustom && recipe.badge && (
                          <span className="text-[9.5px] px-1.5 py-[0.5px] rounded bg-[#ecfdf5] text-[#059669] font-medium border border-[#a7f3d0]/60">
                            {recipe.badge}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-[#71717a] truncate mt-0.5">
                        {recipe.subtitle}
                      </div>
                    </div>
                  </div>

                  {/* 右侧微操作反馈：固定 Pin + 删除 (如果是自定义) + 选用 */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* 图钉快捷固定到常用坞 */}
                    <button
                      type="button"
                      onClick={(e) => handleTogglePin(e, recipe)}
                      className={`w-6 h-6 rounded-[4px] flex items-center justify-center transition-all cursor-pointer ${
                        recipe.isPinned
                          ? 'bg-[#eeedfd] text-[#4f46e5] border border-[#c7d2fe]'
                          : 'opacity-0 group-hover:opacity-100 text-[#85858d] hover:text-[#4f46e5] hover:bg-[#ececf0]'
                      }`}
                      title={
                        recipe.isPinned
                          ? '已固定到画布左侧常用步骤坞，点击取消'
                          : '固定到画布左侧常用步骤坞'
                      }
                    >
                      <Pin size={11} strokeWidth={recipe.isPinned ? 2.4 : 1.8} />
                    </button>

                    {/* 自定义配方支持删除 */}
                    {recipe.isCustom && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteCustom(e, recipe)}
                        className="w-6 h-6 rounded-[4px] opacity-0 group-hover:opacity-100 text-[#85858d] hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-all cursor-pointer"
                        title="删除该自定义配方"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}

                    {/* 选用提示 */}
                    <span className="text-[10.5px] text-[#4f46e5] font-medium flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                      <span>选用</span>
                      <ArrowRight size={10} strokeWidth={2.4} />
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 4. 底部微型操作提示条 */}
        <div className="h-[34px] px-3 bg-[#fafafc] border-t border-[#e3e3e8] flex items-center justify-between text-[10.5px] text-[#85858d] shrink-0">
          <div className="flex items-center gap-2">
            <span>单击或按 Enter 即可直接落库排版</span>
            <span className="text-[#d4d4d8]">|</span>
            <span className="flex items-center gap-1 text-[#63636b]">
              <Pin size={10} className="text-[#4f46e5]" />
              <span>点击图钉可将动作常驻到画布左侧步骤坞</span>
            </span>
          </div>
          <span className="font-mono text-[10px]">openLoop Recipe Engine</span>
        </div>
      </div>
    </div>
  );
};
