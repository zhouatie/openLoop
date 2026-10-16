import React, { useRef, useEffect } from 'react';
import {
  ArrowUpDown,
  Clock,
  RotateCcw,
  FileText,
  Hash,
  Sparkles,
  Check,
  Layers,
} from 'lucide-react';
import type { KanbanColumn } from '@openloop/core';
import {
  ColumnSortRule,
  SORT_OPTIONS,
  SortOptionItem,
  findSortOption,
  isDefaultSortRule,
} from '../utils/kanbanSort';

interface KanbanColumnSortDropdownProps {
  columnKey: KanbanColumn;
  columnTitle: string;
  currentRule: ColumnSortRule;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelectRule: (rule: ColumnSortRule) => void;
  onApplyToAll: (rule: ColumnSortRule) => void;
  onReset: () => void;
}

const getOptionIcon = (opt: SortOptionItem) => {
  switch (opt.category) {
    case 'time':
      return Clock;
    case 'info':
      return opt.field === 'title' ? FileText : Hash;
    case 'status':
      return Sparkles;
    default:
      return Clock;
  }
};

export const KanbanColumnSortDropdown: React.FC<KanbanColumnSortDropdownProps> = ({
  columnKey,
  columnTitle,
  currentRule,
  isOpen,
  onToggle,
  onClose,
  onSelectRule,
  onApplyToAll,
  onReset,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentOption = findSortOption(currentRule);
  const isDefault = isDefaultSortRule(currentRule);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      {/* 排序触发按钮 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`h-[20px] rounded-[4px] border text-[10.5px] font-medium flex items-center transition-colors cursor-pointer select-none ${
          !isDefault || isOpen
            ? 'px-1.5 bg-white border-[#b9b9c2] text-[#1c1c21] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
            : 'px-1 border-transparent text-[#85858d] hover:text-[#1c1c21] hover:bg-white/80 hover:border-[#e3e3e8]'
        }`}
        title={`列排序: ${currentOption.label}`}
      >
        <ArrowUpDown
          size={11}
          className={!isDefault || isOpen ? 'text-[#1c1c21]' : 'text-[#85858d]'}
        />
        {!isDefault && (
          <span className="ml-1 text-[10px] text-[#1c1c21] font-normal truncate max-w-[62px]">
            {currentOption.shortLabel}
          </span>
        )}
      </button>

      {/* 排序选项浮层 */}
      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-[26px] right-0 w-[234px] bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_10px_26px_rgba(20,22,30,0.14)] p-1.5 z-40 animate-in fade-in zoom-in-95 duration-100"
        >
          {/* 标题栏 */}
          <div className="px-2 py-1 text-[10.5px] font-semibold text-[#85858d] uppercase tracking-wider flex items-center justify-between border-b border-[#ececf0] pb-1.5 mb-1">
            <span className="truncate">列排序 · {columnTitle}</span>
            <span className="text-[10px] font-mono font-normal text-[#85858d]">
              {currentOption.shortLabel}
            </span>
          </div>

          {/* 选项列表 */}
          <div className="max-h-[260px] overflow-y-auto space-y-0.5 pr-0.5">
            {SORT_OPTIONS.map((opt) => {
              const isSelected =
                opt.field === currentRule.field && opt.direction === currentRule.direction;
              const Icon = getOptionIcon(opt);

              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onSelectRule({ field: opt.field, direction: opt.direction });
                    onClose();
                  }}
                  className={`w-full px-2 py-1.5 text-left flex items-center justify-between rounded-[6px] text-[11.5px] transition-colors cursor-pointer ${
                    isSelected
                      ? 'text-[#1c1c21] font-medium bg-[#f4f4f7]'
                      : 'text-[#4b4b53] hover:text-[#1c1c21] hover:bg-[#f9f9fb]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon
                      size={12}
                      className={isSelected ? 'text-[#1c1c21]' : 'text-[#85858d]'}
                    />
                    <span className="truncate">{opt.label}</span>
                  </div>
                  {isSelected && <Check size={12} className="text-[#1c1c21] shrink-0 ml-1.5" />}
                </button>
              );
            })}
          </div>

          {/* 底部快捷操作 */}
          <div className="my-1 border-t border-[#ececf0]" />

          <button
            type="button"
            onClick={() => {
              onApplyToAll(currentRule);
              onClose();
            }}
            className="w-full px-2 py-1.5 text-left text-[11px] text-[#4b4b53] hover:text-[#1c1c21] hover:bg-[#f4f4f7] rounded-[5px] flex items-center gap-1.5 transition-colors cursor-pointer"
            title="将此排序规则应用至所有看板列"
          >
            <Layers size={11} className="text-[#85858d]" />
            <span>应用此规则到所有列</span>
          </button>

          {!isDefault && (
            <button
              type="button"
              onClick={() => {
                onReset();
                onClose();
              }}
              className="w-full px-2 py-1 text-left text-[10.5px] text-[#85858d] hover:text-[#d64545] hover:bg-[#fdf2f2] rounded-[5px] flex items-center gap-1.5 transition-colors cursor-pointer mt-0.5"
            >
              <RotateCcw size={10} />
              <span>恢复此列默认排序</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
