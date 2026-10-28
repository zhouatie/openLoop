import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  FolderGit2,
  FolderOpen,
  ChevronDown,
  Check,
  X,
  Clock,
  Search,
  Copy,
} from 'lucide-react';
import { HighlightMatch } from './HighlightMatch';
import { formatCompactPath, getWorkspaceDirName } from './workspace-path';
import { useDirectoryPicker } from './useDirectoryPicker';

export const STORAGE_KEY_LAST_WORKSPACE = 'openloop_last_used_workspace';
export const STORAGE_KEY_RECENT_WORKSPACES = 'openloop_recent_workspaces';
const MAX_RECENT_COUNT = 30;

interface WorkspacePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const WorkspacePicker: React.FC<WorkspacePickerProps> = ({
  value,
  onChange,
  placeholder = '选择工程工作区 (点击下拉或右侧浏览目录)...',
  className = '',
}) => {
  const { pick, dialog } = useDirectoryPicker();
  const [isOpen, setIsOpen] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RECENT_WORKSPACES);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 综合候选列表：合并当前选中项与最近项目，保持去重
  const candidateWorkspaces = useMemo(() => {
    const set = new Set<string>();
    const list: string[] = [];

    const addPath = (p: string) => {
      const trimmed = p?.trim();
      if (trimmed && !set.has(trimmed)) {
        set.add(trimmed);
        list.push(trimmed);
      }
    };

    if (value) {
      addPath(value);
    }
    recentWorkspaces.forEach(addPath);

    return list;
  }, [recentWorkspaces, value]);

  // 按搜索词即时过滤工作区候选列表（支持项目名与全路径多词匹配）
  const filteredWorkspaces = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return candidateWorkspaces;

    const keywords = q.split(/\s+/).filter(Boolean);
    return candidateWorkspaces.filter((wsPath) => {
      const name = getWorkspaceDirName(wsPath).toLowerCase();
      const compact = formatCompactPath(wsPath).toLowerCase();
      const full = wsPath.toLowerCase();

      return keywords.every(
        (kw) => name.includes(kw) || compact.includes(kw) || full.includes(kw)
      );
    });
  }, [candidateWorkspaces, searchQuery]);

  // 下拉打开时聚焦搜索输入框并重置状态
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setHoveredPath(null);
      const initialIdx = filteredWorkspaces.indexOf(value);
      setHighlightedIndex(initialIdx >= 0 ? initialIdx : 0);

      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // 搜索词变更时重置高亮索引
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  // 键盘导航高亮项时自动滚动保持在视野内
  useEffect(() => {
    if (highlightedIndex >= 0 && itemRefs.current[highlightedIndex]) {
      itemRefs.current[highlightedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [highlightedIndex]);

  // 点击外部收起下拉浮层
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // 记录并置顶最近项目历史 (LRU)
  const recordRecentWorkspace = useCallback(
    (pathToAdd: string) => {
      if (!pathToAdd || !pathToAdd.trim()) return;
      const trimmed = pathToAdd.trim();
      try {
        const updated = [
          trimmed,
          ...recentWorkspaces.filter((p) => p !== trimmed),
        ].slice(0, MAX_RECENT_COUNT);
        setRecentWorkspaces(updated);
        localStorage.setItem(STORAGE_KEY_RECENT_WORKSPACES, JSON.stringify(updated));
        localStorage.setItem(STORAGE_KEY_LAST_WORKSPACE, trimmed);
        if (import.meta.env?.DEV) {
          console.log('[WorkspacePicker] 更新工作区 LRU 记忆:', { latest: trimmed, all: updated });
        }
      } catch (err) {
        console.warn('[WorkspacePicker] 保存工作区记忆失败:', err);
      }
    },
    [recentWorkspaces]
  );

  const handleSelect = useCallback(
    (wsPath: string) => {
      onChange(wsPath);
      recordRecentWorkspace(wsPath);
      setIsOpen(false);
      if (import.meta.env?.DEV) {
        console.log('[WorkspacePicker] 用户在下拉中选定项目工作区:', wsPath);
      }
    },
    [onChange, recordRecentWorkspace]
  );

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    if (import.meta.env?.DEV) {
      console.log('[WorkspacePicker] 用户清空了工作区关联');
    }
  };

  // 复制完整绝对路径
  const handleCopyPath = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      if (import.meta.env?.DEV) {
        console.log('[WorkspacePicker] 已复制工作区全路径到剪贴板:', path);
      }
      setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.warn('[WorkspacePicker] 复制路径失败:', err);
    }
  };

  // 键盘快捷操作处理
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredWorkspaces.length === 0) return;
      setHighlightedIndex((prev) => (prev + 1) % filteredWorkspaces.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredWorkspaces.length === 0) return;
      setHighlightedIndex((prev) => (prev - 1 + filteredWorkspaces.length) % filteredWorkspaces.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (
        filteredWorkspaces.length > 0 &&
        highlightedIndex >= 0 &&
        highlightedIndex < filteredWorkspaces.length
      ) {
        handleSelect(filteredWorkspaces[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (searchQuery) {
        setSearchQuery('');
        setHighlightedIndex(0);
      } else {
        setIsOpen(false);
      }
    }
  };

  // 唤起目录选择：桌面端走系统原生面板，浏览器调试走应用内目录面板
  const handleBrowse = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isBrowsing) return;

    setIsBrowsing(true);
    setIsOpen(false);

    try {
      const chosen = await pick(value || undefined);
      if (chosen) {
        onChange(chosen);
        recordRecentWorkspace(chosen);
        if (import.meta.env?.DEV) {
          console.log('[WorkspacePicker] 目录选择成功并关联:', chosen);
        }
      } else {
        if (import.meta.env?.DEV) {
          console.log('[WorkspacePicker] 用户取消了目录选择');
        }
      }
    } catch (err) {
      console.error('[WorkspacePicker] 目录选择异常:', err);
    } finally {
      setIsBrowsing(false);
    }
  };

  const projectName = useMemo(() => getWorkspaceDirName(value), [value]);
  const compactPath = useMemo(() => formatCompactPath(value), [value]);

  // 当前实时全路径检查器显示的目标路径（优先鼠标悬停项，其次键盘高亮项，最后当前选中值）
  const activeInspectorPath = useMemo(() => {
    if (hoveredPath) return hoveredPath;
    if (
      highlightedIndex >= 0 &&
      highlightedIndex < filteredWorkspaces.length
    ) {
      return filteredWorkspaces[highlightedIndex];
    }
    return value || '';
  }, [hoveredPath, highlightedIndex, filteredWorkspaces, value]);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* 极简精致的单行输入/选择复合框 */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full h-[32px] px-2.5 rounded-[7px] border transition-all cursor-pointer flex items-center justify-between gap-1.5 select-none ${
          isOpen
            ? 'border-[#4f46e5] bg-white ring-1 ring-[#eeedfd] shadow-sm'
            : value
            ? 'border-[#d8d6fb] bg-[#f9f9fb] hover:bg-white hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.02)]'
            : 'border-[#e3e3e8] bg-[#f9f9fb] hover:bg-white hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.02)]'
        }`}
      >
        {/* 左侧图标与文本主体（全区域提供 title 提示） */}
        <div
          className="flex items-center gap-2 min-w-0 flex-1 pr-1"
          title={value || undefined}
        >
          <FolderGit2
            size={13.5}
            className={`shrink-0 transition-colors ${
              value ? 'text-[#4f46e5]' : 'text-[#85858d]'
            }`}
          />

          {value ? (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="font-medium text-[12px] text-[#1c1c21] shrink-0 truncate max-w-[130px]">
                {projectName}
              </span>
              <span className="text-[#c2c2c9] shrink-0 text-[10px]">·</span>
              <span className="text-[11px] font-mono text-[#85858d] truncate">
                {compactPath}
              </span>
            </div>
          ) : (
            <span className="text-[11.5px] text-[#85858d] truncate">
              {placeholder}
            </span>
          )}
        </div>

        {/* 右侧微件操作区 */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 清除按钮 */}
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="w-4 h-4 rounded flex items-center justify-center text-[#85858d] hover:text-[#d64545] hover:bg-[#fee2e2]/60 transition-colors"
              title="清除当前工作区"
            >
              <X size={11} />
            </button>
          )}

          {/* 下拉展开指示 */}
          <div
            className={`w-4 h-4 flex items-center justify-center text-[#85858d] transition-transform duration-150 ${
              isOpen ? 'rotate-180 text-[#4f46e5]' : ''
            }`}
          >
            <ChevronDown size={12} />
          </div>

          {/* 分隔线 */}
          <div className="w-[1px] h-3.5 bg-[#e3e3e8] mx-0.5" />

          {/* 浏览目录：桌面端是系统面板，浏览器调试是应用内面板 */}
          <button
            type="button"
            disabled={isBrowsing}
            onClick={handleBrowse}
            className="h-[22px] px-1.5 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50"
            title="浏览并选择目录..."
          >
            <FolderOpen size={12.5} className="text-[#4f46e5]" />
            <span className="text-[10.5px]">浏览</span>
          </button>
        </div>
      </div>

      {/* 下拉浮层：支持搜索、全路径即时巡视、键盘快捷操作与目录浏览 */}
      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-[#e3e3e8] rounded-[8px] shadow-[0_12px_30px_rgba(20,22,30,0.12)] z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100">
          {/* 顶部搜索框 */}
          <div className="p-1.5 border-b border-[#ececf0] bg-[#fafafc]">
            <div className="relative flex items-center">
              <Search
                size={12.5}
                className="absolute left-2 text-[#85858d] pointer-events-none"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="搜索项目名称或路径 (支持多词)..."
                className="w-full h-[26px] pl-6 pr-6 bg-white hover:bg-white focus:bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[5px] text-[11.5px] text-[#1c1c21] placeholder:text-[#85858d] outline-none shadow-sm transition-all"
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

          {/* 分组与快捷提示标头 */}
          <div className="px-2.5 py-1 text-[10px] font-semibold text-[#85858d] uppercase tracking-wider flex items-center justify-between border-b border-[#ececf0] bg-white select-none">
            <span className="flex items-center gap-1 text-[#4f46e5]">
              {searchQuery.trim() ? <Search size={10} /> : <Clock size={10} />}
              <span>
                {searchQuery.trim()
                  ? `匹配结果 (${filteredWorkspaces.length})`
                  : '最近项目'}
              </span>
            </span>
            <span className="text-[9px] font-normal lowercase text-[#85858d]">
              {searchQuery.trim() ? '↑↓ 导航 · Enter 选中' : '历史记忆'}
            </span>
          </div>

          {/* 项目列表滚动区 */}
          <div
            ref={listContainerRef}
            className="max-h-[190px] overflow-y-auto px-1 py-0.5 space-y-0.5"
            onMouseLeave={() => setHoveredPath(null)}
          >
            {filteredWorkspaces.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-[#85858d]">
                {searchQuery.trim()
                  ? '未找到匹配的工程目录'
                  : '暂无历史记录，点击下方浏览目录'}
              </div>
            ) : (
              filteredWorkspaces.map((wsPath, idx) => {
                const isSelected = wsPath === value;
                const isHighlighted = idx === highlightedIndex;
                const name = getWorkspaceDirName(wsPath);
                const displayPath = formatCompactPath(wsPath);

                return (
                  <div
                    key={wsPath}
                    ref={(el) => (itemRefs.current[idx] = el)}
                    onClick={() => handleSelect(wsPath)}
                    onMouseEnter={() => {
                      setHoveredPath(wsPath);
                      setHighlightedIndex(idx);
                    }}
                    title={wsPath}
                    className={`px-2 py-1.5 rounded-[5px] cursor-pointer transition-colors flex items-center justify-between text-[11.5px] ${
                      isHighlighted || isSelected
                        ? 'bg-[#eeedfd] text-[#4f46e5]'
                        : 'hover:bg-[#f4f4f7] text-[#1c1c21]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                      <FolderGit2
                        size={12.5}
                        className={`shrink-0 ${
                          isSelected || isHighlighted
                            ? 'text-[#4f46e5]'
                            : 'text-[#85858d]'
                        }`}
                      />
                      <span className="font-medium truncate max-w-[130px]">
                        <HighlightMatch text={name} query={searchQuery} />
                      </span>
                      <span className="text-[#c2c2c9] text-[9.5px] shrink-0">·</span>
                      <span className="text-[10.5px] font-mono text-[#85858d] truncate flex-1">
                        <HighlightMatch text={displayPath} query={searchQuery} />
                      </span>
                    </div>

                    {isSelected && (
                      <Check
                        size={12}
                        className="text-[#4f46e5] shrink-0"
                        strokeWidth={2.5}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 实时全路径检查底栏 (Instant Full-Path Inspector)：
              鼠标悬停或键盘聚焦时 0ms 零延迟呈现完整路径，并支持一键复制绝对路径 */}
          <div className="px-2.5 py-1 bg-[#fafafc] border-t border-[#ececf0] flex items-center justify-between gap-1.5 text-[10px] text-[#71717a] select-none">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="shrink-0 text-[9.5px] font-medium text-[#85858d]">
                全路径:
              </span>
              <span
                className="font-mono text-[#1c1c21] text-[10px] truncate select-all"
                title={activeInspectorPath || undefined}
              >
                {activeInspectorPath || '未选定工作区'}
              </span>
            </div>

            {activeInspectorPath && (
              <button
                type="button"
                onClick={(e) => handleCopyPath(e, activeInspectorPath)}
                className="shrink-0 p-1 rounded hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] transition-colors"
                title="复制完整项目路径"
              >
                {copied ? (
                  <span className="text-[9.5px] text-[#059669] font-medium flex items-center gap-0.5">
                    <Check size={10} strokeWidth={2.5} />
                    <span>已复制</span>
                  </span>
                ) : (
                  <Copy size={10.5} />
                )}
              </button>
            )}
          </div>

          {/* 底部目录浏览入口 */}
          <div className="pt-1 border-t border-[#ececf0] px-1 pb-1 bg-white">
            <div
              onClick={handleBrowse}
              className="px-2 py-1.5 rounded-[5px] text-[11px] font-medium text-[#4f46e5] hover:bg-[#eeedfd] cursor-pointer flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <FolderOpen size={12} />
                <span>浏览并选择新的工程目录...</span>
              </span>
              <span className="text-[10px] text-[#85858d]">浏览</span>
            </div>
          </div>
        </div>
      )}

      {dialog}
    </div>
  );
};
