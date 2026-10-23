import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Workflow, ChevronDown, Check, Search, X } from 'lucide-react';
import type { WorkflowDefinition } from '@openloop/core';
import { HighlightMatch } from './HighlightMatch';

interface WorkflowPickerProps {
  value: string;
  onChange: (workflowId: string) => void;
  workflows: WorkflowDefinition[];
  placeholder?: string;
  className?: string;
}

/**
 * 支持关键词搜索的流水线选择器，交互与视觉对齐 WorkspacePicker。
 */
export const WorkflowPicker: React.FC<WorkflowPickerProps> = ({
  value,
  onChange,
  workflows,
  placeholder = '选择执行流水线...',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const selectedWf = useMemo(() => workflows.find((wf) => wf.id === value), [workflows, value]);

  // 按搜索词即时过滤流水线（名称 / ID / 描述 / 标签，支持多词）
  const filteredWorkflows = useMemo(() => {
    const keywords = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return workflows;

    return workflows.filter((wf) =>
      keywords.every(
        (kw) =>
          wf.name.toLowerCase().includes(kw) ||
          wf.id.toLowerCase().includes(kw) ||
          (wf.description || '').toLowerCase().includes(kw) ||
          (wf.tags || []).some((tag) => tag.toLowerCase().includes(kw))
      )
    );
  }, [workflows, searchQuery]);

  // 展开时重置搜索词、定位当前选中项并聚焦搜索框
  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    const currentIdx = workflows.findIndex((wf) => wf.id === value);
    setHighlightedIndex(currentIdx >= 0 ? currentIdx : 0);
    const timer = setTimeout(() => searchInputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    itemRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  // 点击外部收起浮层
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = useCallback(
    (workflowId: string) => {
      onChange(workflowId);
      setIsOpen(false);
      if (import.meta.env?.DEV) {
        console.log('[WorkflowPicker] 用户选定执行流水线:', workflowId);
      }
    },
    [onChange]
  );

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredWorkflows.length === 0) return;
      setHighlightedIndex((prev) => (prev + 1) % filteredWorkflows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredWorkflows.length === 0) return;
      setHighlightedIndex((prev) => (prev - 1 + filteredWorkflows.length) % filteredWorkflows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredWorkflows[highlightedIndex];
      if (target) handleSelect(target.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (searchQuery) {
        setSearchQuery('');
      } else {
        setIsOpen(false);
      }
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* 单行触发控件 */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        title={selectedWf ? `${selectedWf.name} (${selectedWf.id})` : placeholder}
        className={`w-full h-[26px] px-1.5 rounded-[5px] border transition-all cursor-pointer flex items-center justify-between gap-1 select-none ${
          isOpen
            ? 'border-[#4f46e5] bg-white ring-1 ring-[#eeedfd]'
            : 'border-[#e3e3e8] bg-[#f9f9fb] hover:bg-white hover:border-[#b9b9c2]'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Workflow
            size={11.5}
            className={`shrink-0 ${selectedWf ? 'text-[#4f46e5]' : 'text-[#85858d]'}`}
          />
          {selectedWf ? (
            <>
              <span className="font-medium text-[11px] text-[#1c1c21] truncate">{selectedWf.name}</span>
              <span className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1 rounded shrink-0 truncate max-w-[110px]">
                {selectedWf.id}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-[#85858d] truncate">{placeholder}</span>
          )}
        </div>

        <ChevronDown
          size={11}
          className={`shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-[#4f46e5]' : 'text-[#85858d]'
          }`}
        />
      </div>

      {/* 搜索 + 列表浮层 */}
      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 min-w-[220px] bg-white border border-[#e3e3e8] rounded-[8px] shadow-[0_12px_30px_rgba(20,22,30,0.12)] z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100">
          <div className="p-1.5 border-b border-[#ececf0] bg-[#fafafc]">
            <div className="relative flex items-center">
              <Search size={12} className="absolute left-2 text-[#85858d] pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="搜索流水线名称或 ID..."
                className="w-full h-[24px] pl-6 pr-6 bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[5px] text-[11px] text-[#1c1c21] placeholder:text-[#85858d] outline-none shadow-sm transition-all"
                onClick={(e) => e.stopPropagation()}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-1.5 w-4 h-4 rounded flex items-center justify-center text-[#85858d] hover:text-[#1c1c21] transition-colors"
                  title="清空搜索"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          <div className="px-2.5 py-1 text-[10px] font-semibold text-[#85858d] uppercase tracking-wider flex items-center justify-between border-b border-[#ececf0] select-none">
            <span className="flex items-center gap-1 text-[#4f46e5]">
              <Search size={10} />
              <span>
                {searchQuery.trim() ? `匹配结果 (${filteredWorkflows.length})` : `全部流水线 (${filteredWorkflows.length})`}
              </span>
            </span>
            <span className="text-[9px] font-normal lowercase">↑↓ 导航 · Enter 选中</span>
          </div>

          <div className="max-h-[190px] overflow-y-auto px-1 py-0.5 space-y-0.5">
            {filteredWorkflows.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-[#85858d]">未找到匹配的流水线</div>
            ) : (
              filteredWorkflows.map((wf, idx) => {
                const isSelected = wf.id === value;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <div
                    key={wf.id}
                    ref={(el) => (itemRefs.current[idx] = el)}
                    onClick={() => handleSelect(wf.id)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    title={`${wf.name} (${wf.id})`}
                    className={`px-2 py-1.5 rounded-[5px] cursor-pointer transition-colors flex items-center justify-between gap-2 text-[11.5px] ${
                      isHighlighted || isSelected
                        ? 'bg-[#eeedfd] text-[#4f46e5]'
                        : 'hover:bg-[#f4f4f7] text-[#1c1c21]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <Workflow
                        size={11.5}
                        className={`shrink-0 ${isSelected || isHighlighted ? 'text-[#4f46e5]' : 'text-[#85858d]'}`}
                      />
                      <span className="font-medium truncate">
                        <HighlightMatch text={wf.name} query={searchQuery} />
                      </span>
                      <span className="text-[9.5px] font-mono text-[#85858d] truncate shrink-0">
                        <HighlightMatch text={wf.id} query={searchQuery} />
                      </span>
                    </div>
                    {isSelected && <Check size={12} className="text-[#4f46e5] shrink-0" strokeWidth={2.5} />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
