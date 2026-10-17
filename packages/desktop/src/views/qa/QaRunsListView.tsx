import React, { useState, useMemo } from 'react';
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  ChevronRight,
  RefreshCw,
  Terminal,
  Activity,
  Globe,
} from 'lucide-react';
import { QaRunRecord, QaSuite } from '@openloop/core';

interface QaRunsListViewProps {
  runs: QaRunRecord[];
  suites: QaSuite[];
  onSelectRun: (runId: string) => void;
  onQuickRunSuite: (suite: QaSuite) => void;
  onNewSuite: () => void;
  onRefresh: () => void;
  isLoading: boolean;
}

export const QaRunsListView: React.FC<QaRunsListViewProps> = ({
  runs,
  suites,
  onSelectRun,
  onQuickRunSuite,
  onRefresh,
  isLoading,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [isRunPickerOpen, setIsRunPickerOpen] = useState(false);

  // 格式化友好相对时间
  const formatTimeAgo = (timestamp?: number) => {
    if (!timestamp) return '未知时间';
    const diff = Date.now() - timestamp;
    const min = 60 * 1000;
    const hr = 60 * min;
    const day = 24 * hr;

    if (diff < min) return '刚刚';
    if (diff < hr) return `${Math.floor(diff / min)} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hr)} 小时前`;
    return new Date(timestamp).toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 过滤后的列表
  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      const matchText =
        run.suiteName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        run.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (run.suiteId && run.suiteId.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchText) return false;
      if (statusFilter === 'all') return true;
      return run.status === statusFilter;
    });
  }, [runs, searchQuery, statusFilter]);

  const passedCount = runs.filter((r) => r.status === 'passed').length;
  const failedCount = runs.filter((r) => r.status === 'failed').length;

  return (
    <div className="space-y-3.5 select-none">
      {/* 工具栏：搜索、状态切页、刷新、发起任务 */}
      <div className="flex items-center justify-between gap-3">
        {/* 左侧搜索与状态过滤 */}
        <div className="flex items-center gap-2.5">
          <div className="relative w-64">
            <Search size={12} className="absolute left-2.5 top-2.5 text-[#85858d]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索任务名称、ID..."
              className="w-full h-[28px] pl-7 pr-2.5 bg-white border border-[#e3e3e8] rounded-[6px] text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#b9b9c2]"
            />
          </div>

          <div className="flex items-center gap-0.5 bg-[#ececf0] p-0.5 rounded-[6px]">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all ${
                statusFilter === 'all'
                  ? 'bg-white text-[#1c1c21] shadow-2xs'
                  : 'text-[#71717a] hover:text-[#1c1c21]'
              }`}
            >
              全部 ({runs.length})
            </button>
            <button
              onClick={() => setStatusFilter('passed')}
              className={`px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all ${
                statusFilter === 'passed'
                  ? 'bg-white text-emerald-700 shadow-2xs'
                  : 'text-[#71717a] hover:text-[#1c1c21]'
              }`}
            >
              成功 ({passedCount})
            </button>
            <button
              onClick={() => setStatusFilter('failed')}
              className={`px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all ${
                statusFilter === 'failed'
                  ? 'bg-white text-red-700 shadow-2xs'
                  : 'text-[#71717a] hover:text-[#1c1c21]'
              }`}
            >
              失败 ({failedCount})
            </button>
          </div>
        </div>

        {/* 右侧动作按钮 */}
        <div className="flex items-center gap-2 relative">
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="w-7 h-[28px] rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#4b4b53] flex items-center justify-center transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            title="刷新记录"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin text-[#4f46e5]' : ''} />
          </button>

          <button
            onClick={() => setIsRunPickerOpen(!isRunPickerOpen)}
            className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs"
          >
            <Play size={11} strokeWidth={2.4} />
            <span>发起新自动化任务</span>
          </button>

          {/* 触发运行选择用例下拉 */}
          {isRunPickerOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] w-64 bg-white border border-[#e3e3e8] rounded-[8px] p-1 shadow-[0_8px_20px_rgba(0,0,0,0.08)] z-30 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-2 py-1 text-[11px] font-medium text-[#85858d] border-b border-[#ececf0] mb-1">
                选择要执行的用例:
              </div>
              {suites.length === 0 ? (
                <div className="px-2 py-3 text-[11.5px] text-[#85858d] text-center">
                  暂无已保存用例
                </div>
              ) : (
                suites.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setIsRunPickerOpen(false);
                      onQuickRunSuite(s);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-[5px] hover:bg-[#f4f4f6] text-[12px] text-[#1c1c21] truncate flex items-center justify-between group"
                  >
                    <span className="truncate">{s.name}</span>
                    <Play size={10} className="text-[#85858d] group-hover:text-[#1c1c21] shrink-0 ml-1" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* 历史运行记录列表 */}
      {filteredRuns.length === 0 ? (
        <div className="bg-white border border-[#e3e3e8] rounded-[10px] p-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <Terminal size={26} className="mx-auto text-[#b9b9c2] mb-2" />
          <div className="text-[13px] font-medium text-[#1c1c21]">暂无自动化执行记录</div>
          <p className="text-[11.5px] text-[#85858d] mt-1 max-w-sm mx-auto">
            点击右上角“发起新自动化任务”触发 Midscene 视觉自动化测试，或在工作流编排中调度执行
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#e3e3e8] rounded-[10px] divide-y divide-[#ececf0] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {filteredRuns.map((run) => {
            const isPass = run.status === 'passed';
            const timelineSteps = run.timeline || [];

            return (
              <div
                key={run.id}
                onClick={() => onSelectRun(run.id)}
                className="px-4 py-3 min-h-[56px] flex items-center justify-between hover:bg-[#f9f9fb] transition-colors cursor-pointer group select-none"
              >
                {/* 左侧：微图标 + 用例名称与状态 + 步骤进度 */}
                <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-6">
                  {/* 小图标容器 */}
                  <div className="w-8 h-8 rounded-[7px] bg-[#f4f4f7] border border-[#ececf0] flex items-center justify-center text-[#1c1c21] group-hover:border-[#b9b9c2] transition-colors shrink-0">
                    <Activity size={15} strokeWidth={1.8} className={isPass ? 'text-emerald-600' : 'text-red-500'} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-semibold text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors truncate">
                        {run.suiteName}
                      </span>

                      <span
                        className={`flex items-center gap-0.5 text-[9.5px] px-1.5 py-[1px] rounded font-medium border ${
                          isPass
                            ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]'
                            : 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]'
                        }`}
                      >
                        {isPass ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                        <span>{isPass ? 'PASSED' : 'FAILED'}</span>
                      </span>

                      <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                        #{run.id.slice(-8)}
                      </span>
                    </div>

                    {/* 第二行：步骤通过数、微型步骤圆点、耗时、时间 */}
                    <div className="flex items-center gap-3.5 text-[11px] text-[#85858d]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-[#52525b]">
                          步骤 {run.passedSteps}/{run.totalSteps}
                        </span>
                        <div className="flex items-center gap-1">
                          {timelineSteps.map((st, sIdx) => (
                            <span
                              key={sIdx}
                              className={`w-1.5 h-1.5 rounded-full ${
                                st.status === 'passed' ? 'bg-[#10b981]' : 'bg-[#ef4444]'
                              }`}
                              title={`步骤 ${sIdx + 1}: ${st.prompt}`}
                            />
                          ))}
                        </div>
                      </div>

                      <span className="font-mono text-[#71717a]">
                        耗时: {(run.durationMs / 1000).toFixed(2)}s
                      </span>

                      <span>{formatTimeAgo(run.createdAt)}</span>
                    </div>
                  </div>
                </div>

                {/* 右侧：进入详情按钮 */}
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[11.5px] text-[#85858d] group-hover:text-[#1c1c21] transition-colors flex items-center gap-0.5">
                    <span>查看回放</span>
                    <ChevronRight size={13} className="text-[#a1a1aa] group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
