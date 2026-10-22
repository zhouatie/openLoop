import React, { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Layers,
  Trash2,
} from 'lucide-react';
import { AutomationTask, AutomationLogRecord } from '@openloop/core';
import { api } from '../../services/api';

export interface AutomationLogsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  automation: AutomationTask | null;
  onOpenTaskLogs?: (taskId: string) => void;
}

export const AutomationLogsDrawer: React.FC<AutomationLogsDrawerProps> = ({
  isOpen,
  onClose,
  automation,
  onOpenTaskLogs,
}) => {
  const [logs, setLogs] = useState<AutomationLogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchLogs = async () => {
    if (!automation) return;
    setLoading(true);
    try {
      const records = await api.getAutomationLogs(automation.id);
      setLogs(records || []);
      if (records && records.length > 0 && !expandedLogId) {
        setExpandedLogId(records[0].id);
      }
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[AutomationLogsDrawer] 获取自动化日志失败:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = async () => {
    if (!automation) return;
    try {
      setLoading(true);
      await api.clearAutomationLogs({ automationId: automation.id });
      setLogs([]);
      setExpandedLogId(null);
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[AutomationLogsDrawer] 清空自动化日志失败:', err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && automation) {
      fetchLogs();
    }
  }, [isOpen, automation]);

  if (!isOpen || !automation) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[1px] animate-fadeIn select-none"
      onClick={() => {
        if (import.meta.env?.DEV) {
          console.log('[AutomationLogsDrawer] 点击蒙层关闭抽屉');
        }
        onClose();
      }}
    >
      <div
        className="w-full max-w-[540px] h-full bg-white border-l border-[#e3e3e8] shadow-2xl flex flex-col overflow-hidden animate-slideInRight"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 Header */}
        <div className="h-[46px] px-4 border-b border-[#e3e3e8] bg-[#fafafc] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] border border-[#e3e3e8]/60 shrink-0">
              <Terminal size={11} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[12.5px] font-semibold text-[#1c1c21] truncate">
                {automation.name} · 执行日志
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {logs.length > 0 && (
              <button
                onClick={handleClearLogs}
                disabled={loading}
                title="清空此任务的历史日志"
                className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-all cursor-pointer disabled:opacity-50"
              >
                <Trash2 size={12} />
              </button>
            )}
            <button
              onClick={fetchLogs}
              disabled={loading}
              title="刷新日志"
              className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-[4px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 自动化配置小微摘要卡片 */}
        <div className="px-4 py-2.5 bg-[#fafafc] border-b border-[#e3e3e8] flex items-center justify-between text-[11px] text-[#71717a]">
          <div className="flex items-center gap-3">
            <span>
              轮询周期: <span className="font-mono text-[#1c1c21] font-medium">{automation.intervalSec}s</span>
            </span>
            <span>
              累计轮询: <span className="font-mono text-[#1c1c21] font-medium">{automation.totalRuns}</span> 次
            </span>
          </div>

          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium border ${
              automation.enabled
                ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/60'
                : 'bg-[#f4f4f6] text-[#71717a] border-[#e3e3e8]'
            }`}
          >
            {automation.enabled ? '调度运行中' : '已暂停'}
          </span>
        </div>

        {/* 日志记录列表 */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#f1f1f4] p-3 space-y-2">
          {logs.length === 0 ? (
            <div className="py-16 text-center text-[#85858d] space-y-1">
              <Clock size={20} className="mx-auto text-[#d4d4d8] mb-2" />
              <div className="text-[12px] font-medium">暂无执行历史日志</div>
              <div className="text-[11px]">任务尚未触发或首次轮询等待中</div>
            </div>
          ) : (
            logs.map((record) => {
              const isExpanded = expandedLogId === record.id;
              const isSuccess = record.status === 'success';

              return (
                <div
                  key={record.id}
                  className="rounded-[6px] border border-[#e3e3e8] bg-white overflow-hidden shadow-2xs transition-colors"
                >
                  <div
                    onClick={() => setExpandedLogId(isExpanded ? null : record.id)}
                    className="px-3 py-2 flex items-center justify-between hover:bg-[#fafafc] cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isExpanded ? (
                        <ChevronDown size={13} className="text-[#85858d] shrink-0" />
                      ) : (
                        <ChevronRight size={13} className="text-[#85858d] shrink-0" />
                      )}

                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[9.5px] font-medium border shrink-0 ${
                          isSuccess
                            ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/60'
                            : 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]/60'
                        }`}
                      >
                        {isSuccess ? (
                          <CheckCircle2 size={9.5} strokeWidth={2.4} />
                        ) : (
                          <XCircle size={9.5} strokeWidth={2.4} />
                        )}
                        <span>{isSuccess ? 'PASSED' : 'FAILED'}</span>
                      </span>

                      <span className="text-[11.5px] font-medium text-[#1c1c21] truncate">
                        {record.summary || (isSuccess ? '执行成功' : '执行失败')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 text-[10.5px] text-[#85858d] font-mono ml-2">
                      <span>{record.durationMs}ms</span>
                      <span>{new Date(record.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>

                  {/* 展开的详情输出 */}
                  {isExpanded && (
                    <div className="p-3 bg-[#1e1e24] border-t border-[#e3e3e8] text-white space-y-2">
                      {record.createdTaskId && (
                        <div className="flex items-center justify-between p-2 rounded bg-white/5 border border-white/10 text-[11px]">
                          <div className="flex items-center gap-1.5 text-white/90">
                            <Layers size={11} className="text-[#818cf8]" />
                            <span>生成看板任务 ID:</span>
                            <span className="font-mono text-[#a5b4fc]">{record.createdTaskId}</span>
                          </div>
                          {onOpenTaskLogs && (
                            <button
                              onClick={() => onOpenTaskLogs(record.createdTaskId!)}
                              className="text-[10px] text-[#818cf8] hover:text-[#c7d2fe] flex items-center gap-1 cursor-pointer"
                            >
                              <span>查看任务详情</span>
                              <ExternalLink size={9} />
                            </button>
                          )}
                        </div>
                      )}

                      <div className="space-y-1">
                        <div className="text-[10px] text-white/40 uppercase tracking-wider font-mono">
                          Output / Trace
                        </div>
                        <pre className="font-mono text-[10.5px] leading-relaxed text-[#e4e4e7] p-2 rounded bg-black/40 overflow-x-auto max-h-[220px] whitespace-pre-wrap select-text">
                          {record.output || record.error || '无标准输出'}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
