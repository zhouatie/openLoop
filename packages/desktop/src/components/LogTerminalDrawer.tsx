import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2, ArrowDown, Filter, Copy, Check, Terminal } from 'lucide-react';
import { LogEntry } from '@openloop/core';

interface LogTerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogEntry[];
  onClearLogs: () => void;
}

export const LogTerminalDrawer: React.FC<LogTerminalDrawerProps> = ({
  isOpen,
  onClose,
  logs,
  onClearLogs,
}) => {
  const [selectedNodeFilter, setSelectedNodeFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const nodeIds = Array.from(new Set(logs.map((l) => l.nodeId)));

  const filteredLogs = logs.filter((log) => {
    if (selectedNodeFilter !== 'all' && log.nodeId !== selectedNodeFilter) {
      return false;
    }
    return true;
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

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
      .map((l) => `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.nodeId}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-0 left-[212px] right-0 h-[280px] bg-[#1c1c21] border-t border-[#383842] z-40 flex flex-col shadow-[0_-8px_24px_rgba(0,0,0,0.18)] animate-in slide-in-from-bottom-2 duration-150">
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
              onChange={(e) => setSelectedNodeFilter(e.target.value)}
              className="bg-[#24242c] border border-[#383842] text-[#e3e3e8] text-[11px] rounded-[4px] px-1.5 py-[1px] outline-none"
            >
              <option value="all">所有节点</option>
              {nodeIds.map((nid) => (
                <option key={nid} value={nid}>
                  {nid}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2 h-[22px] rounded-[4px] text-[10.5px] flex items-center gap-1 transition-all ${
              autoScroll ? 'bg-[#312e81] text-[#c7d2fe]' : 'text-[#85858d] hover:text-white'
            }`}
          >
            <ArrowDown size={11} />
            <span>滚动</span>
          </button>

          <button
            onClick={copyAll}
            className="w-[22px] h-[22px] rounded-[4px] text-[#85858d] hover:text-white hover:bg-[#282830] flex items-center justify-center transition-colors"
            title="复制日志"
          >
            {copied ? <Check size={12} className="text-[#10b981]" /> : <Copy size={12} />}
          </button>

          <button
            onClick={onClearLogs}
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

            return (
              <div key={log.id} className="flex items-start gap-2 leading-relaxed px-1 py-0.5 rounded hover:bg-[#222228]">
                <span className="text-[#71717a] shrink-0 select-none">[{timeStr}]</span>
                <span className="text-[#a5b4fc] shrink-0 font-medium">[{log.nodeId}]</span>
                <span className={`${color} whitespace-pre-wrap break-all`}>{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
