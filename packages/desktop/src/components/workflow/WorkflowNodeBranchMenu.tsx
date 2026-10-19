import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  X,
  Sparkles,
  ArrowRight,
  CornerDownLeft,
  Layers,
} from 'lucide-react';
import {
  WORKFLOW_RECIPE_CATEGORIES,
  WorkflowRecipe,
  RecipeCategory,
} from '../../constants/workflowRecipes';
import { useWorkflowRecipes } from '../../services/recipeStore';

export interface WorkflowNodeBranchMenuProps {
  sourceNodeId: string;
  sourceNodeName?: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectRecipe: (recipe: WorkflowRecipe) => void;
}

/**
 * XMind 风格节点行内分支选单 (Inline Branching Popper)
 * 挂载在当前节点右侧，支持：
 * - 打开自动聚焦输入框
 * - 中英文模糊搜索匹配
 * - 方向键 ↑ / ↓ 选择
 * - Tab 或 Enter 立即选定创建并自动将焦点切到新节点 (支持连击 Tab Tab)
 * - Esc 快速退出
 */
export const WorkflowNodeBranchMenu: React.FC<WorkflowNodeBranchMenuProps> = ({
  sourceNodeId,
  sourceNodeName,
  isOpen,
  onClose,
  onSelectRecipe,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<RecipeCategory | 'all'>('all');
  const [highlightIndex, setHighlightIndex] = useState(0);

  const { allRecipes } = useWorkflowRecipes();

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 每次打开重置并聚焦
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setSelectedCategory('all');
      setHighlightIndex(0);
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // 模糊搜索过滤
  const filteredRecipes = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return allRecipes.filter((recipe) => {
      const matchCat = selectedCategory === 'all' || recipe.category === selectedCategory;
      if (!matchCat) return false;
      if (!term) return true;
      return (
        recipe.name.toLowerCase().includes(term) ||
        recipe.subtitle.toLowerCase().includes(term) ||
        recipe.description.toLowerCase().includes(term) ||
        recipe.categoryLabel.toLowerCase().includes(term) ||
        recipe.type.toLowerCase().includes(term)
      );
    });
  }, [searchTerm, selectedCategory, allRecipes]);

  // 当过滤列表变化时纠正高亮索引
  useEffect(() => {
    setHighlightIndex(0);
  }, [filteredRecipes.length]);

  // 高亮项随上下键滚动保持可见
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLElement>('[data-recipe-item]');
    if (items[highlightIndex]) {
      items[highlightIndex].scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  // 点击外部自动关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟添加监听避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // 键盘操作响应（核心流转：↑↓ 切换，Tab/Enter 确认，Esc 退出）
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setHighlightIndex((prev) => (filteredRecipes.length ? (prev + 1) % filteredRecipes.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setHighlightIndex((prev) =>
        filteredRecipes.length ? (prev - 1 + filteredRecipes.length) % filteredRecipes.length : 0
      );
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredRecipes[highlightIndex]) {
        onSelectRecipe(filteredRecipes[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="nodrag nopan absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 z-50 animate-in fade-in zoom-in-95 duration-150 select-none cursor-default"
      style={{ filter: 'drop-shadow(0 12px 32px rgba(15, 23, 42, 0.16))' }}
    >
      {/* 类似脑图向右延伸的视觉连接引导线与小三角指示 */}
      <div className="absolute -left-[16px] top-1/2 -translate-y-1/2 flex items-center pointer-events-none">
        <div className="w-[12px] h-[2px] bg-[#6366f1]/60" />
        <div className="w-0 h-0 border-y-[4px] border-y-transparent border-l-[6px] border-l-[#6366f1]" />
      </div>

      {/* 弹窗主体容器 */}
      <div className="w-[316px] rounded-[10px] bg-white border border-[#c7d2fe] ring-4 ring-[#4f46e5]/10 flex flex-col overflow-hidden text-left shadow-xl">
        {/* 顶部搜索与上下文标题 */}
        <div className="p-2.5 pb-2 bg-[#fbfbfe] border-b border-[#ececf2]">
          <div className="flex items-center justify-between text-[10.5px] text-[#63636b] mb-1.5 px-0.5">
            <span className="flex items-center gap-1 font-medium text-[#1c1c21] truncate max-w-[200px]">
              <Sparkles size={11} className="text-[#4f46e5] shrink-0" />
              <span className="truncate">接续: {sourceNodeName || sourceNodeId}</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-0.5 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-colors"
              title="关闭 (Esc)"
            >
              <X size={12} />
            </button>
          </div>

          {/* 搜索框 */}
          <div className="relative flex items-center">
            <Search
              size={12.5}
              className="absolute left-2.5 text-[#85858d] pointer-events-none"
            />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入动作名称或命令匹配 (↑↓选择, Tab确认)..."
              className="w-full h-[28px] pl-7 pr-14 rounded-[6px] bg-white border border-[#d8d8e2] focus:border-[#4f46e5] focus:ring-2 focus:ring-[#4f46e5]/15 text-[11.5px] text-[#1c1c21] outline-none transition-all placeholder:text-[#a0a0ab]"
            />
            <div className="absolute right-1.5 flex items-center gap-0.5 pointer-events-none">
              <span className="px-1 py-[1.5px] rounded bg-[#eeedfd] text-[#4f46e5] text-[9.5px] font-mono font-semibold">
                Tab
              </span>
            </div>
          </div>

          {/* 分类快捷微标签 */}
          <div className="flex items-center gap-1 mt-2 overflow-x-auto no-scrollbar pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-1.5 py-[1.5px] rounded-[4px] text-[10px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-[#1c1c21] text-white'
                  : 'bg-[#f4f4f6] text-[#63636b] hover:bg-[#ececf0]'
              }`}
            >
              全部
            </button>
            {WORKFLOW_RECIPE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-1.5 py-[1.5px] rounded-[4px] text-[10px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                  selectedCategory === cat.id
                    ? 'bg-[#4f46e5] text-white shadow-2xs'
                    : 'bg-[#f4f4f6] text-[#63636b] hover:bg-[#ececf0]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* 候选动作列表 */}
        <div
          ref={listRef}
          className="max-h-[240px] overflow-y-auto p-1.5 space-y-0.5"
          style={{ scrollbarWidth: 'thin' }}
        >
          {filteredRecipes.length === 0 ? (
            <div className="py-6 text-center text-[#85858d] text-[11px]">
              未找到匹配动作，尝试其他关键词
            </div>
          ) : (
            filteredRecipes.map((recipe, index) => {
              const IconComp = recipe.icon;
              const isHighlighted = index === highlightIndex;
              return (
                <div
                  key={recipe.id}
                  data-recipe-item
                  onMouseEnter={() => setHighlightIndex(index)}
                  onClick={() => onSelectRecipe(recipe)}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded-[6px] transition-all cursor-pointer ${
                    isHighlighted
                      ? 'bg-[#f5f3ff] text-[#1c1c21] ring-1 ring-[#c7d2fe]'
                      : 'hover:bg-[#f8f8fa] text-[#333338]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <span
                      className={`w-[22px] h-[22px] rounded-[5px] flex items-center justify-center shrink-0 ${recipe.iconBg} ${recipe.iconText}`}
                    >
                      <IconComp size={12} strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11.5px] font-medium truncate">
                          {recipe.name}
                        </span>
                        {recipe.popular && (
                          <span className="text-[8.5px] px-1 py-[0.5px] rounded bg-[#fef3c7] text-[#b45309] font-medium shrink-0">
                            常用
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[#85858d] truncate">
                        {recipe.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isHighlighted ? (
                      <span className="flex items-center gap-0.5 text-[9.5px] text-[#4f46e5] font-semibold bg-[#eeedfd] px-1.5 py-[1px] rounded">
                        <span>选定</span>
                        <CornerDownLeft size={9} />
                      </span>
                    ) : (
                      <span className="text-[9.5px] text-[#a0a0ab] font-mono">
                        {recipe.type}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部微操作提示 */}
        <div className="px-2.5 py-1.5 bg-[#fbfbfe] border-t border-[#ececf2] flex items-center justify-between text-[10px] text-[#85858d]">
          <div className="flex items-center gap-2">
            <span>
              <kbd className="px-1 py-[0.5px] bg-[#f0f0f4] rounded text-[9px] font-mono">↑↓</kbd>{' '}
              切换
            </span>
            <span>
              <kbd className="px-1 py-[0.5px] bg-[#eeedfd] text-[#4f46e5] rounded text-[9px] font-mono font-semibold">
                Tab
              </kbd>
              /
              <kbd className="px-1 py-[0.5px] bg-[#eeedfd] text-[#4f46e5] rounded text-[9px] font-mono font-semibold">
                ↵
              </kbd>{' '}
              确认创建
            </span>
          </div>
          <div>
            <kbd className="px-1 py-[0.5px] bg-[#f0f0f4] rounded text-[9px] font-mono">Esc</kbd>{' '}
            取消
          </div>
        </div>
      </div>
    </div>
  );
};
