import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Kanban,
  Workflow,
  Boxes,
  Settings,
  Plus,
  Terminal,
  RefreshCw,
  CornerDownLeft,
} from 'lucide-react';
import { Kbd } from './Kbd';
import { useShortcuts } from '../context/ShortcutContext';

export interface CommandItem {
  id: string;
  category: '导航' | '操作';
  title: string;
  description: string;
  icon: React.ReactNode;
  shortcutKeys?: (string | 'super')[];
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (pluginId: string) => void;
  onOpenCreateTask: () => void;
  onToggleLogs: () => void;
  onRefresh: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onOpenCreateTask,
  onToggleLogs,
  onRefresh,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { superKeyLabel } = useShortcuts();

  const commands = useMemo<CommandItem[]>(() => {
    return [
      {
        id: 'nav-kanban',
        category: '导航',
        title: '任务看板',
        description: '查看进行中任务与流水线执行状态',
        icon: <Kanban size={16} strokeWidth={1.8} className="text-[#4f46e5]" />,
        shortcutKeys: ['super', '1'],
        action: () => {
          onNavigate('kanban');
          onClose();
        },
      },
      {
        id: 'nav-workflows',
        category: '导航',
        title: '流程编排',
        description: '查看与编辑 DAG 自动化工作流',
        icon: <Workflow size={16} strokeWidth={1.8} className="text-[#0284c7]" />,
        shortcutKeys: ['super', '2'],
        action: () => {
          onNavigate('workflow-editor');
          onClose();
        },
      },
      {
        id: 'nav-plugins',
        category: '导航',
        title: '扩展插件',
        description: '管理已安装与内置扩展插件',
        icon: <Boxes size={16} strokeWidth={1.8} className="text-[#059669]" />,
        shortcutKeys: ['super', '3'],
        action: () => {
          onNavigate('plugin-manager');
          onClose();
        },
      },
      {
        id: 'nav-settings',
        category: '导航',
        title: '系统设置',
        description: '配置代码智能体驱动与工作区环境变量',
        icon: <Settings size={16} strokeWidth={1.8} className="text-[#d97706]" />,
        shortcutKeys: ['super', ','],
        action: () => {
          onNavigate('settings-agent');
          onClose();
        },
      },
      {
        id: 'action-create-task',
        category: '操作',
        title: '新建任务',
        description: '选择工作流并创建新的执行任务',
        icon: <Plus size={16} strokeWidth={2.2} className="text-[#1c1c21]" />,
        shortcutKeys: ['super', 'N'],
        action: () => {
          onClose();
          onOpenCreateTask();
        },
      },
      {
        id: 'action-toggle-logs',
        category: '操作',
        title: '切换运行日志',
        description: '展开或折叠底部实时终端日志抽屉',
        icon: <Terminal size={16} strokeWidth={1.8} className="text-[#4b4b53]" />,
        action: () => {
          onClose();
          onToggleLogs();
        },
      },
      {
        id: 'action-refresh',
        category: '操作',
        title: '刷新系统数据',
        description: '重新获取任务列表、工作流定义与插件元数据',
        icon: <RefreshCw size={16} strokeWidth={1.8} className="text-[#4b4b53]" />,
        action: () => {
          onClose();
          onRefresh();
        },
      },
    ];
  }, [onNavigate, onOpenCreateTask, onToggleLogs, onRefresh, onClose]);

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // 打开时重置状态并聚焦输入框
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      if (import.meta.env?.DEV) {
        console.log('[CommandPalette] 命令面板已唤起');
      }
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // 搜索关键字变化时重置聚焦索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // 键盘操作响应
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev - 1 < 0 ? Math.max(0, filteredCommands.length - 1) : prev - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = filteredCommands[selectedIndex];
      if (current) {
        if (import.meta.env?.DEV) {
          console.log('[CommandPalette] 执行命令:', current.id, current.title);
        }
        current.action();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[13vh] bg-black/35 backdrop-blur-[4px] animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] bg-white rounded-[14px] shadow-[0_20px_60px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.06)] overflow-hidden flex flex-col border border-[#e3e3e8] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部搜索框 */}
        <div className="h-[48px] px-3.5 border-b border-[#e3e3e8] flex items-center gap-2.5 bg-[#fafafc]">
          <Search size={16} className="text-[#85858d] shrink-0" strokeWidth={2} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索页面、执行操作或输入关键词..."
            className="flex-1 bg-transparent text-[13.5px] text-[#1c1c21] placeholder-[#85858d] outline-none font-normal"
          />
          <Kbd variant="light" size="xs">
            Esc
          </Kbd>
        </div>

        {/* 候选列表 */}
        <div
          ref={listRef}
          className="max-h-[340px] overflow-y-auto p-1.5 space-y-0.5 min-h-[160px]"
        >
          {filteredCommands.length === 0 ? (
            <div className="py-10 text-center text-[#85858d] text-[12.5px]">
              未找到匹配的操作或命令
            </div>
          ) : (
            filteredCommands.map((cmd, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  onClick={() => {
                    if (import.meta.env?.DEV) {
                      console.log('[CommandPalette] 执行命令:', cmd.id, cmd.title);
                    }
                    cmd.action();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center justify-between px-3 py-2 rounded-[8px] cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#f1f1f4] text-[#1c1c21]'
                      : 'text-[#4b4b53] hover:bg-[#f8f8fa]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-[7px] bg-white border border-[#e3e3e8] flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                      {cmd.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-[#1c1c21] flex items-center gap-2">
                        <span>{cmd.title}</span>
                        <span className="text-[10.5px] font-normal text-[#85858d] bg-[#f4f4f6] px-1.5 py-0.5 rounded-[4px]">
                          {cmd.category}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#85858d] truncate mt-0.5">
                        {cmd.description}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {cmd.shortcutKeys && (
                      <Kbd keys={cmd.shortcutKeys} size="xs" variant="light" />
                    )}
                    {isSelected && (
                      <CornerDownLeft size={12} className="text-[#85858d]" strokeWidth={2} />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部按键提示 */}
        <div className="h-[34px] px-3.5 bg-[#f8f8fa] border-t border-[#ececf0] flex items-center justify-between text-[11px] text-[#85858d]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd size="xs">↑</Kbd>
              <Kbd size="xs">↓</Kbd>
              <span>导航</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd size="xs">↵</Kbd>
              <span>选择</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd size="xs">Esc</Kbd>
              <span>退出</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-[10.5px]">
            <span>当前 Super 键:</span>
            <span className="font-semibold text-[#1c1c21]">{superKeyLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
