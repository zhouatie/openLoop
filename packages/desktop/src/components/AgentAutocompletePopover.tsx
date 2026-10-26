import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import {
  FileCode,
  FileText,
  FileJson,
  File,
  ImageIcon,
  Terminal,
  Sparkles,
  CornerDownLeft,
  Loader2,
  Folder,
} from 'lucide-react';
import { api } from '../services/api';
import { Kbd } from './Kbd';
import { toast } from './Toast';

export interface AutocompleteItem {
  id: string;
  name: string;
  label?: string;
  description?: string;
  type: 'file' | 'command' | 'skill';
  action?: 'clear' | 'pause' | 'resume';
  template?: string;
  filePath?: string;
}

export interface AgentAutocompletePopoverHandle {
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

export interface AgentAutocompletePopoverProps {
  taskId?: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  onClearSession?: () => void;
  onPauseSession?: () => void;
  onResumeSession?: () => void;
}

// 内存缓存提升重复检索性能，避免打字卡顿
const taskFilesCache = new Map<string, { files: string[]; timestamp: number }>();
let globalCommandsSkillsCache: { commands: any[]; skills: any[]; timestamp: number } | null = null;

const renderFileIcon = (filePath: string) => {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'vue':
    case 'svelte':
      return <FileCode size={13} className="text-[#3b82f6] shrink-0" />;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return <FileJson size={13} className="text-[#f59e0b] shrink-0" />;
    case 'md':
    case 'markdown':
    case 'txt':
    case 'doc':
      return <FileText size={13} className="text-[#10b981] shrink-0" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'svg':
    case 'gif':
    case 'webp':
      return <ImageIcon size={13} className="text-[#ec4899] shrink-0" />;
    default:
      return <File size={13} className="text-[#85858d] shrink-0" />;
  }
};

export const AgentAutocompletePopover = forwardRef<
  AgentAutocompletePopoverHandle,
  AgentAutocompletePopoverProps
>(({ taskId, textareaRef, value, onChange, onClearSession, onPauseSession, onResumeSession }, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [triggerType, setTriggerType] = useState<'file' | 'command_or_skill' | null>(null);
  const [query, setQuery] = useState('');
  const [matchStartIndex, setMatchStartIndex] = useState<number>(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [commands, setCommands] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const dismissedMatchPosRef = useRef<number>(-1);

  const listRef = useRef<HTMLDivElement>(null);

  // 1. 加载文件列表（带内存缓存与秒级刷新）
  const loadFiles = async (targetTaskId: string, force = false) => {
    const cached = taskFilesCache.get(targetTaskId);
    const now = Date.now();
    if (!force && cached && now - cached.timestamp < 30000) {
      setAllFiles(cached.files);
      return;
    }

    try {
      setIsLoading(true);
      const res = await api.getTaskWorkspaceFiles(targetTaskId, undefined, 2000);
      if (res && Array.isArray(res.files)) {
        taskFilesCache.set(targetTaskId, { files: res.files, timestamp: now });
        setAllFiles(res.files);
      }
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.warn('[AgentAutocomplete] 加载工作区文件列表失败:', err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 2. 加载命令与技能列表
  const loadCommandsAndSkills = async (targetTaskId?: string, force = false) => {
    const now = Date.now();
    if (!force && globalCommandsSkillsCache && now - globalCommandsSkillsCache.timestamp < 60000) {
      setCommands(globalCommandsSkillsCache.commands);
      setSkills(globalCommandsSkillsCache.skills);
      return;
    }

    try {
      setIsLoading(true);
      const res = await api.getAgentCommandsAndSkills(targetTaskId);
      if (res) {
        const comms = res.commands || [];
        const sks = res.skills || [];
        globalCommandsSkillsCache = { commands: comms, skills: sks, timestamp: now };
        setCommands(comms);
        setSkills(sks);
      }
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.warn('[AgentAutocomplete] 加载命令与技能列表失败:', err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 任务切换时预取
  useEffect(() => {
    if (taskId) {
      loadFiles(taskId);
      loadCommandsAndSkills(taskId);
    }
  }, [taskId]);

  // 3. 实时分析输入框文本中的光标位置与触发符
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selStart = textarea.selectionStart;
    const textBefore = value.slice(0, selStart);

    // 检测 @ 符号：光标在 @ 后面，并且 @ 之后没有空格或换行
    const atMatch = textBefore.match(/(?:^|[\s\n])@([^\s\n]*)$/);
    if (atMatch) {
      const q = atMatch[1];
      const matchPos = textBefore.lastIndexOf('@');
      if (dismissedMatchPosRef.current === matchPos) {
        return;
      }
      setTriggerType('file');
      setQuery(q);
      setMatchStartIndex(matchPos);
      setSelectedIndex(0);
      setIsOpen(true);
      if (taskId && allFiles.length === 0) {
        loadFiles(taskId);
      }
      return;
    }

    // 检测 / 符号：光标在 / 后面（必须位于行首或空格后）
    const slashMatch = textBefore.match(/(?:^|[\s\n])\/([^\s\n]*)$/);
    if (slashMatch) {
      const q = slashMatch[1];
      const matchPos = textBefore.lastIndexOf('/');
      if (dismissedMatchPosRef.current === matchPos) {
        return;
      }
      setTriggerType('command_or_skill');
      setQuery(q);
      setMatchStartIndex(matchPos);
      setSelectedIndex(0);
      setIsOpen(true);
      if (commands.length === 0) {
        loadCommandsAndSkills(taskId);
      }
      return;
    }

    // 无触发符则关闭，并重置主动关闭标记
    dismissedMatchPosRef.current = -1;
    setIsOpen(false);
    setTriggerType(null);
    setQuery('');
    setMatchStartIndex(-1);
  }, [value, taskId]);

  // 4. 根据当前模式与搜索词生成过滤后的结果列表
  const filteredItems = useMemo<AutocompleteItem[]>(() => {
    if (!isOpen || !triggerType) return [];
    const q = query.trim().toLowerCase();

    if (triggerType === 'file') {
      let matched = allFiles;
      if (q) {
        matched = allFiles
          .filter((f) => f.toLowerCase().includes(q))
          .sort((a, b) => {
            const aLower = a.toLowerCase();
            const bLower = b.toLowerCase();
            const aName = aLower.split('/').pop() || '';
            const bName = bLower.split('/').pop() || '';
            const aStarts = aName.startsWith(q) ? 2 : aName.includes(q) ? 1 : 0;
            const bStarts = bName.startsWith(q) ? 2 : bName.includes(q) ? 1 : 0;
            if (aStarts !== bStarts) return bStarts - aStarts;
            return a.length - b.length;
          });
      }

      return matched.slice(0, 30).map((f) => ({
        id: `file_${f}`,
        name: f.split('/').pop() || f,
        label: f,
        filePath: f,
        type: 'file',
      }));
    }

    if (triggerType === 'command_or_skill') {
      const commItems: AutocompleteItem[] = commands
        .filter((c) => {
          if (!q) return true;
          const cleanName = c.name.toLowerCase().replace(/^\//, '');
          return (
            cleanName.includes(q) ||
            c.label?.toLowerCase().includes(q) ||
            c.description?.toLowerCase().includes(q)
          );
        })
        .map((c) => ({
          id: `cmd_${c.name}`,
          name: c.name,
          label: c.label || c.name,
          description: c.description,
          type: 'command',
          action: c.action,
          template: c.template,
        }));

      const skillItems: AutocompleteItem[] = skills
        .filter((s) => {
          if (!q) return true;
          const cleanName = s.name.toLowerCase().replace(/^\//, '');
          return (
            cleanName.includes(q) ||
            s.label?.toLowerCase().includes(q) ||
            s.description?.toLowerCase().includes(q)
          );
        })
        .map((s) => ({
          id: `skill_${s.name}`,
          name: s.name,
          label: s.label || s.name,
          description: s.description,
          type: 'skill',
          template: s.template,
        }));

      return [...commItems, ...skillItems].slice(0, 35);
    }

    return [];
  }, [isOpen, triggerType, query, allFiles, commands, skills]);

  // 5. 选中某一项的采纳处理逻辑
  const selectItem = (item: AutocompleteItem) => {
    const textarea = textareaRef.current;
    if (!textarea || matchStartIndex < 0) return;

    const selStart = textarea.selectionStart;
    const beforeMatch = value.slice(0, matchStartIndex);
    const afterCursor = value.slice(selStart);

    if (item.type === 'file' && item.filePath) {
      // 替换 @... 为 @filePath 并追加空格
      const insertText = `@${item.filePath} `;
      const nextValue = beforeMatch + insertText + afterCursor;
      onChange(nextValue);

      if (import.meta.env?.DEV) {
        console.log('[AgentAutocomplete] 采纳工作区文件引用:', item.filePath);
      }

      setTimeout(() => {
        if (textareaRef.current) {
          const newCursorPos = beforeMatch.length + insertText.length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
        }
      }, 0);

      setIsOpen(false);
      return;
    }

    if (item.type === 'command' || item.type === 'skill') {
      if (import.meta.env?.DEV) {
        console.log('[AgentAutocomplete] 执行指令/技能:', item.name, item);
      }

      // 特殊指令快捷动作
      if (item.action === 'clear') {
        if (taskId) {
          api.clearTaskSession(taskId).then(() => {
            onClearSession?.();
            toast.success('已清空当前智能体会话记录');
          }).catch((err) => {
            toast.error(`清空会话失败: ${err.message}`);
          });
        }
        onChange(beforeMatch + afterCursor);
        setIsOpen(false);
        return;
      }

      if (item.action === 'pause') {
        onPauseSession?.();
        onChange(beforeMatch + afterCursor);
        setIsOpen(false);
        return;
      }

      if (item.action === 'resume') {
        onResumeSession?.();
        onChange(beforeMatch + afterCursor);
        setIsOpen(false);
        return;
      }

      // 普通模板命令或 Skill 指令替换
      const insertText = item.template ? `${item.template} ` : `${item.name} `;
      const nextValue = beforeMatch + insertText + afterCursor;
      onChange(nextValue);

      setTimeout(() => {
        if (textareaRef.current) {
          const newCursorPos = beforeMatch.length + insertText.length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
        }
      }, 0);

      setIsOpen(false);
    }
  };

  // 6. 暴露键盘拦截事件给宿主 Textarea
  useImperativeHandle(ref, () => ({
    handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isOpen || filteredItems.length === 0) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
        return true;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
        return true;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = filteredItems[selectedIndex] || filteredItems[0];
        if (selected) {
          selectItem(selected);
        }
        return true;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        dismissedMatchPosRef.current = matchStartIndex;
        setIsOpen(false);
        return true;
      }

      return false;
    },
  }));

  // 键盘移动联动滚动条可视区域
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.children[selectedIndex] as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1.5 bg-white/95 backdrop-blur-md border border-[#e3e3e8] rounded-[8px] shadow-[0_8px_24px_rgba(0,0,0,0.08)] overflow-hidden z-50 flex flex-col max-h-[280px] animate-in fade-in slide-in-from-bottom-1 duration-150 select-none">
      {/* 顶部表头 */}
      <div className="h-[28px] bg-[#fafafc] border-b border-[#e3e3e8] px-2.5 flex items-center justify-between text-[10.5px] font-medium text-[#71717a] shrink-0">
        <div className="flex items-center gap-1.5">
          {triggerType === 'file' ? (
            <>
              <Folder size={11.5} className="text-[#4f46e5]" />
              <span>工作区文件引用 (@)</span>
            </>
          ) : (
            <>
              <Terminal size={11.5} className="text-[#4f46e5]" />
              <span>快捷指令与技能扩展 (/)</span>
            </>
          )}
          {isLoading && <Loader2 size={10} className="animate-spin text-[#85858d]" />}
        </div>
        <div className="flex items-center gap-1.5 text-[9.5px] text-[#85858d]">
          <span>
            <Kbd size="xs">↑</Kbd> <Kbd size="xs">↓</Kbd> 选择
          </span>
          <span>
            <Kbd size="xs">↵</Kbd> 采纳
          </span>
          <span>
            <Kbd size="xs">Esc</Kbd> 关闭
          </span>
        </div>
      </div>

      {/* 列表主体 */}
      <div ref={listRef} className="overflow-y-auto divide-y divide-[#f4f4f7] py-0.5">
        {filteredItems.length === 0 ? (
          <div className="px-3 py-3 text-center text-[11px] text-[#85858d] select-none">
            {isLoading ? '正在检索...' : `未找到匹配的${triggerType === 'file' ? '文件' : '命令或技能'}`}
          </div>
        ) : (
          filteredItems.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          if (item.type === 'file') {
            const parts = (item.filePath || item.label || '').split('/');
            const fileName = parts.pop() || '';
            const dirPath = parts.join('/');

            return (
              <div
                key={item.id}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => selectItem(item)}
                className={`px-2.5 py-1.5 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                  isSelected ? 'bg-[#f4f4f7]' : 'hover:bg-[#fafafc]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {renderFileIcon(item.filePath || fileName)}
                  <span className="text-[11.5px] font-medium text-[#1c1c21] truncate">{fileName}</span>
                  {dirPath && (
                    <span className="text-[10px] text-[#85858d] font-mono truncate max-w-[240px]">
                      {dirPath}
                    </span>
                  )}
                </div>
                <CornerDownLeft
                  size={10.5}
                  className={`shrink-0 ${isSelected ? 'text-[#4f46e5] opacity-100' : 'opacity-0'}`}
                />
              </div>
            );
          }

          // Command & Skill 渲染
          return (
            <div
              key={item.id}
              onMouseEnter={() => setSelectedIndex(idx)}
              onClick={() => selectItem(item)}
              className={`px-2.5 py-1.5 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                isSelected ? 'bg-[#f4f4f7]' : 'hover:bg-[#fafafc]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-5 h-5 rounded-[4px] flex items-center justify-center shrink-0 border ${
                    item.type === 'command'
                      ? 'bg-[#eef2ff] text-[#4f46e5] border-[#c7d2fe]'
                      : 'bg-[#faf5ff] text-[#9333ea] border-[#e9d5ff]'
                  }`}
                >
                  {item.type === 'command' ? (
                    <Terminal size={11} strokeWidth={2.2} />
                  ) : (
                    <Sparkles size={11} strokeWidth={2.2} />
                  )}
                </div>
                <div className="flex items-baseline gap-1.5 truncate">
                  <span className="text-[11.5px] font-mono font-semibold text-[#1c1c21]">
                    {item.name}
                  </span>
                  {item.label && item.label !== item.name && (
                    <span className="text-[10.5px] font-medium text-[#52525b] truncate">
                      {item.label}
                    </span>
                  )}
                  {item.description && (
                    <span className="text-[10px] text-[#85858d] truncate max-w-[200px]">
                      - {item.description}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`text-[9.5px] font-medium px-1.5 py-0.5 rounded-[3px] border ${
                    item.type === 'command'
                      ? 'bg-[#f4f4f6] text-[#63636b] border-[#e3e3e8]'
                      : 'bg-[#faf5ff] text-[#9333ea] border-[#e9d5ff]'
                  }`}
                >
                  {item.type === 'command' ? '命令' : '技能'}
                </span>
                <CornerDownLeft
                  size={10.5}
                  className={isSelected ? 'text-[#4f46e5] opacity-100' : 'opacity-0'}
                />
              </div>
            </div>
          );
        })
        )}
      </div>
    </div>
  );
});

AgentAutocompletePopover.displayName = 'AgentAutocompletePopover';
