import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  FolderGit2,
  FolderOpen,
  ChevronDown,
  Check,
  X,
  Clock,
  ExternalLink,
  Plus,
} from 'lucide-react';
import { api } from '../services/api';

export const STORAGE_KEY_LAST_WORKSPACE = 'openloop_last_used_workspace';
export const STORAGE_KEY_RECENT_WORKSPACES = 'openloop_recent_workspaces';
const MAX_RECENT_COUNT = 5;

/**
 * 格式化精炼路径，例如将 /Users/username/My/project 显示为 ~/My/project
 */
export function formatCompactPath(fullPath: string): string {
  if (!fullPath) return '';
  // 替换 macOS / Linux 用户主目录前缀
  const macHomeMatch = fullPath.match(/^\/Users\/[^/]+(\/.*)$/);
  if (macHomeMatch) {
    return `~${macHomeMatch[1]}`;
  }
  const linuxHomeMatch = fullPath.match(/^\/home\/[^/]+(\/.*)$/);
  if (linuxHomeMatch) {
    return `~${linuxHomeMatch[1]}`;
  }
  return fullPath;
}

/**
 * 获取路径最后一级目录名作为项目名
 */
export function getWorkspaceDirName(fullPath: string): string {
  if (!fullPath) return '';
  const trimmed = fullPath.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || fullPath;
}

interface WorkspacePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const WorkspacePicker: React.FC<WorkspacePickerProps> = ({
  value,
  onChange,
  placeholder = '选择工程工作区 (点击下拉或右侧打开访达)...',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RECENT_WORKSPACES);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const containerRef = useRef<HTMLDivElement>(null);

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

  // Esc 键关闭下拉
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // 记录并置顶最近项目历史 (LRU)
  const recordRecentWorkspace = (pathToAdd: string) => {
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
  };

  const handleSelect = (wsPath: string) => {
    onChange(wsPath);
    recordRecentWorkspace(wsPath);
    setIsOpen(false);
    if (import.meta.env?.DEV) {
      console.log('[WorkspacePicker] 用户在下拉中选定项目工作区:', wsPath);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    if (import.meta.env?.DEV) {
      console.log('[WorkspacePicker] 用户清空了工作区关联');
    }
  };

  // 唤起系统访达 / 文件管理器目录选择对话框
  const handleBrowseNative = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (isBrowsing) return;

    setIsBrowsing(true);
    setIsOpen(false);
    if (import.meta.env?.DEV) {
      console.log('[WorkspacePicker] 准备唤起系统文件管理器 (访达) 选择目录...');
    }

    try {
      const chosen = await api.selectDirectory({ defaultPath: value || undefined });
      if (chosen) {
        onChange(chosen);
        recordRecentWorkspace(chosen);
        if (import.meta.env?.DEV) {
          console.log('[WorkspacePicker] 访达选择成功并关联:', chosen);
        }
      } else {
        if (import.meta.env?.DEV) {
          console.log('[WorkspacePicker] 用户取消了访达目录选择');
        }
      }
    } catch (err) {
      console.error('[WorkspacePicker] 唤起系统访达异常:', err);
    } finally {
      setIsBrowsing(false);
    }
  };

  const projectName = useMemo(() => getWorkspaceDirName(value), [value]);
  const compactPath = useMemo(() => formatCompactPath(value), [value]);

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
        {/* 左侧图标与文本主体 */}
        <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
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
              <span
                className="text-[11px] font-mono text-[#85858d] truncate"
                title={value}
              >
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

          {/* 打开访达原生文件管理器 */}
          <button
            type="button"
            disabled={isBrowsing}
            onClick={handleBrowseNative}
            className="h-[22px] px-1.5 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center gap-1 text-[11px] font-medium transition-colors disabled:opacity-50"
            title="打开系统访达选择目录..."
          >
            <FolderOpen size={12.5} className="text-[#4f46e5]" />
            <span className="text-[10.5px]">访达</span>
          </button>
        </div>
      </div>

      {/* 下拉浮层：最近使用过的工程列表与快捷操作 */}
      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-[#e3e3e8] rounded-[8px] shadow-[0_10px_26px_rgba(20,22,30,0.12)] z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-100">
          <div className="px-2.5 py-1 text-[10px] font-semibold text-[#85858d] uppercase tracking-wider flex items-center justify-between border-b border-[#ececf0] mb-1">
            <span className="flex items-center gap-1 text-[#4f46e5]">
              <Clock size={10} /> 最近项目
            </span>
            <span className="text-[9px] font-normal lowercase text-[#85858d]">
              历史记忆
            </span>
          </div>

          <div className="max-h-[190px] overflow-y-auto px-1 space-y-0.5">
            {recentWorkspaces.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-[#85858d]">
                暂无历史记录，点击下方从访达中选择
              </div>
            ) : (
              recentWorkspaces.map((wsPath) => {
                const isSelected = wsPath === value;
                const name = getWorkspaceDirName(wsPath);
                const displayPath = formatCompactPath(wsPath);

                return (
                  <div
                    key={wsPath}
                    onClick={() => handleSelect(wsPath)}
                    className={`px-2 py-1.5 rounded-[5px] cursor-pointer transition-colors flex items-center justify-between text-[11.5px] ${
                      isSelected
                        ? 'bg-[#eeedfd] text-[#4f46e5]'
                        : 'hover:bg-[#f4f4f7] text-[#1c1c21]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                      <FolderGit2
                        size={12.5}
                        className={isSelected ? 'text-[#4f46e5]' : 'text-[#85858d]'}
                      />
                      <span className="font-medium truncate max-w-[120px]">{name}</span>
                      <span className="text-[#c2c2c9] text-[9.5px]">·</span>
                      <span
                        className="text-[10.5px] font-mono text-[#85858d] truncate flex-1"
                        title={wsPath}
                      >
                        {displayPath}
                      </span>
                    </div>

                    {isSelected && (
                      <Check size={12} className="text-[#4f46e5] shrink-0" strokeWidth={2.5} />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* 底部操作行 */}
          <div className="pt-1 mt-1 border-t border-[#ececf0] px-1">
            <div
              onClick={handleBrowseNative}
              className="px-2 py-1.5 rounded-[5px] text-[11px] font-medium text-[#4f46e5] hover:bg-[#eeedfd] cursor-pointer flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <FolderOpen size={12} />
                <span>在系统访达中选择新工程目录...</span>
              </span>
              <span className="text-[10px] text-[#85858d]">浏览</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
