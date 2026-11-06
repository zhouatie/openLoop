import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Trash2, ArrowDown, Copy, Check, Terminal, Search, RotateCcw, Clock } from 'lucide-react';
import { LogEntry, NodeRun } from '@openloop/core';
import { resolveNodeMeta } from '../utils/nodeMeta';

interface LogTerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogEntry[];
  onClearLogs: () => void;
  /** 当前任务的步骤记录：用于把步骤 id 显示成步骤名 */
  nodeRuns?: Record<string, NodeRun>;
  /** 日志作用域：无 taskId 为全局日志，有 taskId 为任务日志，nodeId 再聚焦到步骤 */
  scope?: LogScope;
}

export interface LogScope {
  taskId?: string;
  nodeId?: string;
}

const formatClock = (value: number): string =>
  new Date(value).toLocaleTimeString('zh-CN', { hour12: false });

/** 实时时钟：面板打开时每秒刷新当前时间，便于对照日志里「等待 20s」这类描述判断还要多久 */
const LiveClock: React.FC = () => {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    if (import.meta.env.DEV) {
      console.log('[LogTerminalDrawer] 实时时钟已启动，每秒刷新当前时间');
    }
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="flex items-center gap-1 font-mono text-[10.5px] text-[#85858d] select-none" title="当前时间（每秒刷新）">
      <Clock size={11} />
      <span>{formatClock(now)}</span>
    </span>
  );
};

/** 最新一条日志距今的秒数：等待类日志不再需要自己心算 */
const ElapsedSince: React.FC<{ timestamp: number }> = ({ timestamp }) => {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 3) return null;
  return (
    <span className="text-[#71717a] text-[10.5px] shrink-0 select-none" title="最新日志距今已过去的时间">
      +{seconds}s
    </span>
  );
};

// 关键词高亮辅助函数
const highlightMatch = (text: string, query: string): React.ReactNode => {
  if (!query || typeof text !== 'string') return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return text;

  const parts: React.ReactNode[] = [];
  let startIndex = 0;
  let curIndex = index;
  let key = 0;

  while (curIndex !== -1) {
    if (curIndex > startIndex) {
      parts.push(text.substring(startIndex, curIndex));
    }
    parts.push(
      <mark
        key={key++}
        className="bg-[#4f46e5]/40 text-[#ffffff] rounded-[2px] px-0.5 not-italic font-medium"
      >
        {text.substring(curIndex, curIndex + query.length)}
      </mark>
    );
    startIndex = curIndex + query.length;
    curIndex = lowerText.indexOf(lowerQuery, startIndex);
  }

  if (startIndex < text.length) {
    parts.push(text.substring(startIndex));
  }

  return parts;
};

export const LogTerminalDrawer: React.FC<LogTerminalDrawerProps> = ({
  isOpen,
  onClose,
  logs,
  onClearLogs,
  nodeRuns,
  scope,
}) => {
  const [selectedNodeFilter, setSelectedNodeFilter] = useState<string>(scope?.nodeId || 'all');
  const [selectedStreamFilter, setSelectedStreamFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);

  // 滚动至底部的辅助函数
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // 作用域变化（全局 / 任务 / 步骤切换）时重置过滤与搜索，并定位到最新日志
  useEffect(() => {
    setSelectedNodeFilter(scope?.nodeId || 'all');
    setSelectedStreamFilter('all');
    setSearchQuery('');
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    scrollToBottom();
  }, [scope?.taskId, scope?.nodeId, isOpen, scrollToBottom]);

  // 打开抽屉时初始化定位到底部
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollToBottom();
      const raf = requestAnimationFrame(scrollToBottom);
      return () => cancelAnimationFrame(raf);
    }
  }, [isOpen, scrollToBottom]);

  // 作用域内的日志集合：任务作用域仅保留该任务的日志（可再在步骤下拉内收窄）
  const scopedLogs = useMemo(
    () => (scope?.taskId ? logs.filter((l) => l.taskId === scope.taskId) : logs),
    [logs, scope?.taskId]
  );

  const scopeLabel = scope?.taskId ? (scope.nodeId ? '步骤日志' : '任务日志') : '全局日志';

  const nodeIds = useMemo(
    () => Array.from(new Set(scopedLogs.map((l) => l.nodeId).filter(Boolean))),
    [scopedLogs]
  );

  const filteredLogs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return scopedLogs.filter((log) => {
      if (selectedNodeFilter !== 'all' && log.nodeId !== selectedNodeFilter) {
        return false;
      }
      if (selectedStreamFilter !== 'all' && log.stream !== selectedStreamFilter) {
        return false;
      }
      if (query) {
        const meta = resolveNodeMeta(log.nodeId, nodeRuns?.[log.nodeId]);
        const matchMessage = typeof log.message === 'string' && log.message.toLowerCase().includes(query);
        const matchNodeId = typeof log.nodeId === 'string' && log.nodeId.toLowerCase().includes(query);
        const matchNodeName = typeof meta.name === 'string' && meta.name.toLowerCase().includes(query);
        if (!matchMessage && !matchNodeId && !matchNodeName) {
          return false;
        }
      }
      return true;
    });
  }, [scopedLogs, selectedNodeFilter, selectedStreamFilter, searchQuery, nodeRuns]);

  const isFiltered =
    selectedNodeFilter !== 'all' || selectedStreamFilter !== 'all' || !!searchQuery.trim();

  // 仅当用户处于最底端且开启自动滚动且未处于主动搜索状态时，新日志到达才自动滚到底部
  useEffect(() => {
    if (autoScroll && isAtBottomRef.current && scrollRef.current && !searchQuery.trim()) {
      scrollToBottom();
      if (import.meta.env.DEV) {
        console.log('[LogTerminalDrawer] 新日志到达，自动滚动至底部');
      }
    }
  }, [filteredLogs, autoScroll, scrollToBottom, searchQuery]);

  // 监听容器滚动，精确区分「查看历史日志」与「处于底部跟随」状态
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 距离底部 30px 内视为处于底端
    const atBottom = distanceFromBottom <= 30;

    if (atBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);

      if (import.meta.env.DEV) {
        if (atBottom) {
          console.log('[LogTerminalDrawer] 用户回到最底端，恢复自动跟滚');
        } else {
          console.log('[LogTerminalDrawer] 用户查看历史日志，暂停自动跟滚，距离底部:', Math.round(distanceFromBottom));
        }
      }
    }
  }, []);

  // 向上滚轮微调：即时取消底部锁定，避免新日志瞬时推送造成视口抖动
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0 && isAtBottomRef.current) {
      isAtBottomRef.current = false;
      setIsAtBottom(false);
      if (import.meta.env.DEV) {
        console.log('[LogTerminalDrawer] 监测到向上滚轮动作，立即锁定当前查看视口');
      }
    }
  }, []);

  // 手动切换滚动状态或回到底部
  const handleToggleScroll = () => {
    if (!isAtBottom || !autoScroll) {
      // 处于上方查看历史日志或之前已关闭滚动时，点击立即回到底部并恢复跟随
      setAutoScroll(true);
      setIsAtBottom(true);
      isAtBottomRef.current = true;
      scrollToBottom();
      if (import.meta.env.DEV) {
        console.log('[LogTerminalDrawer] 用户点击回到底部');
      }
    } else {
      // 处于底部且正在自动滚动时，点击主动暂停
      setAutoScroll(false);
      if (import.meta.env.DEV) {
        console.log('[LogTerminalDrawer] 用户手动暂停自动滚动');
      }
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim()) {
      // 搜索时若视口在底部，定位到顶部方便用户查看首条匹配项
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      setIsAtBottom(false);
      isAtBottomRef.current = false;
    }
    if (import.meta.env.DEV) {
      console.log('[LogTerminalDrawer] 搜索关键词变更:', value);
    }
  };

  const handleStreamFilterChange = (value: string) => {
    setSelectedStreamFilter(value);
    if (import.meta.env.DEV) {
      console.log('[LogTerminalDrawer] 日志流筛选变更:', value);
    }
  };

  const handleNodeFilterChange = (value: string) => {
    setSelectedNodeFilter(value);
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    scrollToBottom();
    if (import.meta.env.DEV) {
      console.log('[LogTerminalDrawer] 步骤筛选变更:', value);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedStreamFilter('all');
    setSelectedNodeFilter('all');
    if (import.meta.env.DEV) {
      console.log('[LogTerminalDrawer] 重置所有筛选与搜索条件');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const copyAll = () => {
    const text = filteredLogs
      .map((l) => {
        const meta = resolveNodeMeta(l.nodeId, nodeRuns?.[l.nodeId]);
        return `[${formatClock(l.timestamp)}] [${meta.name} (${l.nodeId})] ${l.message}`;
      })
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 点击蒙层关闭日志面板 */}
      <div
        className="fixed inset-0 z-[60] bg-black/25 openloop-modal-backdrop"
        onClick={onClose}
      />
      <div className="fixed bottom-0 left-[212px] right-0 h-[280px] bg-[#1c1c21] border-t border-[#383842] z-[60] flex flex-col shadow-[0_-8px_24px_rgba(0,0,0,0.18)] animate-in slide-in-from-bottom-2 duration-150">
        {/* 终端头部 */}
        <div className="h-[34px] bg-[#16161a] border-b border-[#2e2e36] px-3.5 flex items-center justify-between select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5 text-[11.5px] font-mono text-[#e3e3e8] shrink-0">
              <Terminal size={13} className="text-[#818cf8]" />
              <span>
                {scopeLabel} ({isFiltered ? `${filteredLogs.length}/${scopedLogs.length}` : `${scopedLogs.length}`} 条)
              </span>
            </div>

            <div className="flex items-center gap-1.5 ml-2">
              {/* 搜索框 */}
              <div className="relative flex items-center">
                <Search size={11} className="absolute left-2 text-[#85858d] pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation();
                      if (searchQuery) {
                        handleSearchChange('');
                      } else {
                        (e.target as HTMLInputElement).blur();
                      }
                    }
                  }}
                  placeholder="搜索日志..."
                  className="w-[120px] focus:w-[170px] transition-all h-[22px] bg-[#24242c] border border-[#383842] focus:border-[#818cf8] text-[#e3e3e8] placeholder-[#71717a] text-[11px] rounded-[4px] pl-5 pr-5 outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => handleSearchChange('')}
                    className="absolute right-1 text-[#85858d] hover:text-[#e3e3e8] p-0.5 transition-colors"
                    title="清除搜索"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>

              {/* 日志流类型过滤 */}
              <select
                value={selectedStreamFilter}
                onChange={(e) => handleStreamFilterChange(e.target.value)}
                className="bg-[#24242c] border border-[#383842] text-[#e3e3e8] text-[11px] rounded-[4px] px-1.5 py-[1px] h-[22px] outline-none"
                title="按日志流过滤"
              >
                <option value="all">所有流</option>
                <option value="stdout">stdout (输出)</option>
                <option value="stderr">stderr (错误)</option>
                <option value="system">system (系统)</option>
              </select>

              {/* 步骤过滤 */}
              <select
                value={selectedNodeFilter}
                onChange={(e) => handleNodeFilterChange(e.target.value)}
                className="bg-[#24242c] border border-[#383842] text-[#e3e3e8] text-[11px] rounded-[4px] px-1.5 py-[1px] h-[22px] outline-none max-w-[160px] truncate"
                title="按步骤过滤"
              >
                <option value="all">所有步骤</option>
                {nodeIds.map((nid) => {
                  const meta = resolveNodeMeta(nid, nodeRuns?.[nid]);
                  return (
                    <option key={nid} value={nid}>
                      {meta.name} ({nid})
                    </option>
                  );
                })}
              </select>

              {/* 重置筛选条件按钮 */}
              {isFiltered && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="h-[22px] px-1.5 rounded-[4px] text-[10.5px] text-[#85858d] hover:text-[#f87171] hover:bg-[#282830] transition-colors flex items-center gap-1"
                  title="重置所有搜索和过滤条件"
                >
                  <RotateCcw size={10} />
                  <span>重置</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <LiveClock />

            <button
              onClick={handleToggleScroll}
              className={`px-2 h-[22px] rounded-[4px] text-[10.5px] flex items-center gap-1 transition-all ${
                autoScroll && isAtBottom ? 'bg-[#312e81] text-[#c7d2fe]' : 'text-[#85858d] hover:text-white'
              }`}
              title={
                !isAtBottom
                  ? '查看历史日志中，点击回到底部'
                  : autoScroll
                  ? '自动滚动已开启 (点击暂停)'
                  : '自动滚动已暂停 (点击开启)'
              }
            >
              <ArrowDown size={11} className={!isAtBottom ? 'text-[#818cf8]' : ''} />
              <span>{isAtBottom ? '滚动' : '回到底部'}</span>
            </button>

            <button
              onClick={copyAll}
              className="w-[22px] h-[22px] rounded-[4px] text-[#85858d] hover:text-white hover:bg-[#282830] flex items-center justify-center transition-colors"
              title="复制当前过滤日志"
            >
              {copied ? <Check size={12} className="text-[#10b981]" /> : <Copy size={12} />}
            </button>

            <button
              onClick={() => {
                onClearLogs();
                setIsAtBottom(true);
                isAtBottomRef.current = true;
              }}
              className="w-[22px] h-[22px] rounded-[4px] text-[#85858d] hover:text-[#f87171] hover:bg-[#282830] flex items-center justify-center transition-colors"
              title="清空日志"
            >
              <Trash2 size={12} />
            </button>

            <button
              onClick={onClose}
              className="w-[22px] h-[22px] rounded-[4px] text-[#85858d] hover:text-white hover:bg-[#282830] flex items-center justify-center transition-colors ml-1"
              title="收起终端"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* 终端内容区 */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onWheel={handleWheel}
          className="flex-1 p-3.5 font-mono text-[11.5px] overflow-y-auto space-y-1 select-text bg-[#18181c]"
        >
          {filteredLogs.length === 0 ? (
            scopedLogs.length === 0 ? (
              <div className="text-[#63636b] italic py-6 text-center">
                {scope?.taskId ? '该任务暂无日志输出' : '暂无日志流'}
              </div>
            ) : (
              <div className="text-[#85858d] py-8 text-center text-[11.5px] flex flex-col items-center justify-center gap-2 select-none">
                <Search size={18} className="text-[#4b4b53]" />
                <span className="text-[#a1a1aa]">未找到与搜索或过滤条件匹配的日志</span>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#24242c] hover:bg-[#2e2e38] text-[#818cf8] text-[11px] border border-[#383842] transition-colors cursor-pointer"
                >
                  <RotateCcw size={10} />
                  <span>清除所有过滤</span>
                </button>
              </div>
            )
          ) : (
            filteredLogs.map((log, index) => {
              const timeStr = formatClock(log.timestamp);
              let color = 'text-[#e4e4e7]';
              if (log.stream === 'stderr') color = 'text-[#f87171] font-semibold';
              if (log.stream === 'system') color = 'text-[#38bdf8]';
              const meta = resolveNodeMeta(log.nodeId, nodeRuns?.[log.nodeId]);
              const trimmedQuery = searchQuery.trim();

              return (
                <div key={log.id} className="flex items-start gap-2 leading-relaxed px-1 py-0.5 rounded hover:bg-[#222228]">
                  <span className="text-[#71717a] shrink-0 select-none">[{timeStr}]</span>
                  <span
                    className="text-[#a5b4fc] shrink-0 font-medium cursor-help"
                    title={`底层标识: ${log.nodeId}\n说明: ${meta.description}`}
                  >
                    [{highlightMatch(meta.name, trimmedQuery)}]
                  </span>
                  <span className={`${color} whitespace-pre-wrap break-all`}>
                    {highlightMatch(log.message, trimmedQuery)}
                  </span>
                  {index === filteredLogs.length - 1 && <ElapsedSince timestamp={log.timestamp} />}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};
