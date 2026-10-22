import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Trash2, ArrowDown, Filter, Copy, Check, Terminal } from 'lucide-react';
import { LogEntry, WorkflowDefinition } from '@openloop/core';
import { resolveNodeMeta } from '../utils/nodeMeta';

interface LogTerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogEntry[];
  onClearLogs: () => void;
  workflows?: WorkflowDefinition[];
  activeNodeFilter?: string;
  onFilterChange?: (nodeId: string) => void;
}

export const LogTerminalDrawer: React.FC<LogTerminalDrawerProps> = ({
  isOpen,
  onClose,
  logs,
  onClearLogs,
  workflows,
  activeNodeFilter,
  onFilterChange,
}) => {
  const [selectedNodeFilter, setSelectedNodeFilter] = useState<string>('all');
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

  useEffect(() => {
    if (activeNodeFilter) {
      setSelectedNodeFilter(activeNodeFilter);
      setIsAtBottom(true);
      isAtBottomRef.current = true;
      scrollToBottom();
    }
  }, [activeNodeFilter, isOpen, scrollToBottom]);

  // 打开抽屉时初始化定位到底部
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollToBottom();
      const raf = requestAnimationFrame(scrollToBottom);
      return () => cancelAnimationFrame(raf);
    }
  }, [isOpen, scrollToBottom]);

  const nodeIds = Array.from(new Set(logs.map((l) => l.nodeId)));

  const filteredLogs = logs.filter((log) => {
    if (selectedNodeFilter !== 'all' && log.nodeId !== selectedNodeFilter) {
      return false;
    }
    return true;
  });

  // 仅当用户处于最底端且开启自动滚动时，新日志到达才自动滚到底部
  useEffect(() => {
    if (autoScroll && isAtBottomRef.current && scrollRef.current) {
      scrollToBottom();
      if (import.meta.env.DEV) {
        console.log('[LogTerminalDrawer] 新日志到达，自动滚动至底部');
      }
    }
  }, [filteredLogs, autoScroll, scrollToBottom]);

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
        const meta = resolveNodeMeta(l.nodeId, undefined, workflows);
        return `[${new Date(l.timestamp).toLocaleTimeString()}] [${meta.name} (${l.nodeId})] ${l.message}`;
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
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-[11.5px] font-mono text-[#e3e3e8]">
              <Terminal size={13} className="text-[#818cf8]" />
              <span>实时执行终端 ({filteredLogs.length} 条)</span>
            </div>

            <div className="flex items-center gap-1 ml-3 text-[11px]">
              <span className="text-[#85858d]">过滤:</span>
              <select
                value={selectedNodeFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedNodeFilter(val);
                  onFilterChange?.(val);
                  setIsAtBottom(true);
                  isAtBottomRef.current = true;
                  scrollToBottom();
                }}
                className="bg-[#24242c] border border-[#383842] text-[#e3e3e8] text-[11px] rounded-[4px] px-1.5 py-[1px] outline-none max-w-[200px]"
              >
                <option value="all">所有节点</option>
                {nodeIds.map((nid) => {
                  const meta = resolveNodeMeta(nid, undefined, workflows);
                  return (
                    <option key={nid} value={nid}>
                      {meta.name} ({nid})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
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
              title="复制日志"
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
            <div className="text-[#63636b] italic py-6 text-center">暂无日志流</div>
          ) : (
            filteredLogs.map((log) => {
              const timeStr = new Date(log.timestamp).toLocaleTimeString();
              let color = 'text-[#e4e4e7]';
              if (log.stream === 'stderr') color = 'text-[#f87171] font-semibold';
              if (log.stream === 'system') color = 'text-[#38bdf8]';
              const meta = resolveNodeMeta(log.nodeId, undefined, workflows);

              return (
                <div key={log.id} className="flex items-start gap-2 leading-relaxed px-1 py-0.5 rounded hover:bg-[#222228]">
                  <span className="text-[#71717a] shrink-0 select-none">[{timeStr}]</span>
                  <span
                    className="text-[#a5b4fc] shrink-0 font-medium cursor-help"
                    title={`底层标识: ${log.nodeId}\n说明: ${meta.description}`}
                  >
                    [{meta.name}]
                  </span>
                  <span className={`${color} whitespace-pre-wrap break-all`}>{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};
