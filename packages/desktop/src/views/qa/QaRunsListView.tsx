import React, { useState, useMemo } from 'react';
import {
  Play,
  CheckCircle2,
  XCircle,
  Search,
  ChevronRight,
  RefreshCw,
  Terminal,
  Activity,
  RotateCcw,
  Trash2,
  Smartphone,
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
  onDeleteRun?: (run: QaRunRecord) => void;
  onBatchDeleteRuns?: (runIds: string[]) => void;
}

export const QaRunsListView: React.FC<QaRunsListViewProps> = ({
  runs,
  suites,
  onSelectRun,
  onQuickRunSuite,
  onRefresh,
  isLoading,
  onDeleteRun,
  onBatchDeleteRuns,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'failed'>('all');
  const [isRunPickerOpen, setIsRunPickerOpen] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());

  // 建立 suiteId -> suite 快速映射
  const suiteMap = useMemo(() => {
    const map = new Map<string, QaSuite>();
    suites.forEach((s) => map.set(s.id, s));
    return map;
  }, [suites]);

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

  const isAllFilteredSelected =
    filteredRuns.length > 0 && filteredRuns.every((r) => selectedRunIds.has(r.id));

  const toggleSelectAll = () => {
    if (isAllFilteredSelected) {
      setSelectedRunIds(new Set());
    } else {
      const next = new Set(selectedRunIds);
      filteredRuns.forEach((r) => next.add(r.id));
      setSelectedRunIds(next);
    }
  };

  const toggleSelectRun = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = new Set(selectedRunIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedRunIds(next);
  };

  const passedCount = runs.filter((r) => r.status === 'passed').length;
  const failedCount = runs.filter((r) => r.status === 'failed').length;

  return (
    <div className="space-y-3 select-none">
      {/* 次级工具栏：搜索、状态切页、刷新、发起任务 */}
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
              className="w-full h-[28px] pl-7 pr-2.5 bg-white border border-[#e3e3e8] rounded-[6px] text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus:border-[#b9b9c2]"
            />
          </div>

          <div className="flex items-center gap-0.5 bg-[#ececf0] p-0.5 rounded-[6px]">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-white text-[#1c1c21] shadow-2xs'
                  : 'text-[#71717a] hover:text-[#1c1c21]'
              }`}
            >
              全部 ({runs.length})
            </button>
            <button
              onClick={() => setStatusFilter('passed')}
              className={`px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all cursor-pointer ${
                statusFilter === 'passed'
                  ? 'bg-white text-[#059669] shadow-2xs'
                  : 'text-[#71717a] hover:text-[#1c1c21]'
              }`}
            >
              成功 ({passedCount})
            </button>
            <button
              onClick={() => setStatusFilter('failed')}
              className={`px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all cursor-pointer ${
                statusFilter === 'failed'
                  ? 'bg-white text-[#dc2626] shadow-2xs'
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
            className="w-7 h-[28px] rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#4b4b53] flex items-center justify-center transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.03)] cursor-pointer"
            title="刷新记录"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin text-[#4f46e5]' : ''} />
          </button>

          <button
            onClick={() => setIsRunPickerOpen(!isRunPickerOpen)}
            className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs cursor-pointer"
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
                    className="w-full text-left px-2 py-1.5 rounded-[5px] hover:bg-[#f4f4f6] text-[12px] text-[#1c1c21] truncate flex items-center justify-between group cursor-pointer"
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

      {/* 批量操作浮条 */}
      {selectedRunIds.size > 0 && (
        <div className="bg-[#eeedfd] border border-[#c7d2fe] px-3.5 py-2 rounded-[7px] flex items-center justify-between text-[12px] text-[#4338ca] shadow-2xs animate-in fade-in duration-100 select-none">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#3730a3]">
              已勾选 {selectedRunIds.size} 项测试运行记录
            </span>
            <span className="text-[#a5b4fc]">|</span>
            <span className="text-[11px] text-[#4f46e5]">
              级联清理选中的数据库回放记录与磁盘截图产物
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedRunIds(new Set())}
              className="h-[24px] px-2 rounded text-[11px] text-[#6366f1] hover:text-[#3730a3] hover:bg-white/60 cursor-pointer transition-colors"
            >
              取消勾选
            </button>
            <button
              type="button"
              onClick={() => {
                onBatchDeleteRuns?.(Array.from(selectedRunIds));
                setSelectedRunIds(new Set());
              }}
              className="h-[26px] px-3 rounded-[5px] bg-[#dc2626] hover:bg-[#b91c1c] text-white text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
            >
              <Trash2 size={11.5} />
              <span>批量删除所选 ({selectedRunIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* 历史运行记录列表 (对齐流程编排与执行记录的极简高质感表格) */}
      {filteredRuns.length === 0 ? (
        <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-16 text-center shadow-sm select-none">
          <Terminal size={30} className="mx-auto text-[#b9b9c2] mb-2.5 stroke-[1.5]" />
          <div className="text-[13px] font-medium text-[#1c1c21]">暂无符合条件的自动化执行记录</div>
          <p className="text-[11.5px] text-[#85858d] mt-1 max-w-sm mx-auto">
            点击右上角“发起新自动化任务”触发 Midscene 视觉自动化测试，或在工作流编排中调度执行
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden flex flex-col">
          {/* 规范表头 */}
          <div className="h-[34px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center text-[11px] font-medium text-[#85858d] select-none">
            <div className="w-[30px] shrink-0 flex items-center">
              <input
                type="checkbox"
                checked={isAllFilteredSelected}
                onChange={toggleSelectAll}
                className="w-3.5 h-3.5 rounded border-[#c7c7cf] text-[#4f46e5] focus:ring-0 cursor-pointer"
              />
            </div>
            <div className="w-[200px] shrink-0">测试用例</div>
            <div className="w-[90px] shrink-0">任务 ID</div>
            <div className="w-[85px] shrink-0 text-center">验证结果</div>
            <div className="flex-1 min-w-0 px-3">步骤与验证说明</div>
            <div className="w-[85px] shrink-0 text-right">运行耗时</div>
            <div className="w-[95px] shrink-0 text-right">触发时间</div>
            <div className="w-[80px] shrink-0 text-center">操作</div>
          </div>

          {/* 表格行 */}
          <div className="divide-y divide-[#f1f1f4]">
            {filteredRuns.map((run) => {
              const isPass = run.status === 'passed';
              const isFail = run.status === 'failed';
              const timelineSteps = run.timeline || [];
              const latestPrompt = timelineSteps.length > 0 ? timelineSteps[timelineSteps.length - 1]?.prompt : '';
              const matchedSuite = run.suiteId ? suiteMap.get(run.suiteId) : undefined;
              const isSelected = selectedRunIds.has(run.id);

              return (
                <div
                  key={run.id}
                  onClick={() => onSelectRun(run.id)}
                  className={`group px-4 py-2.5 flex items-center text-[12px] transition-colors cursor-pointer ${
                    isSelected ? 'bg-[#f5f3ff] hover:bg-[#ede9fe]' : 'hover:bg-[#fafafc]'
                  }`}
                >
                  {/* 复选框 */}
                  <div
                    className="w-[30px] shrink-0 flex items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggleSelectRun(run.id, e as any)}
                      className="w-3.5 h-3.5 rounded border-[#c7c7cf] text-[#4f46e5] focus:ring-0 cursor-pointer"
                    />
                  </div>

                  {/* 测试用例名称 */}
                  <div className="w-[200px] shrink-0 flex items-center gap-2 pr-2">
                    <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] group-hover:bg-white flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60 transition-colors">
                      {run.platform === 'android' ? (
                        <Smartphone size={11} strokeWidth={2} className="text-[#4f46e5]" />
                      ) : (
                        <Activity size={11} strokeWidth={2} />
                      )}
                    </div>
                    <span
                      className="font-medium text-[#1c1c21] truncate hover:text-[#4f46e5] transition-colors"
                      title={run.suiteName}
                    >
                      {run.suiteName}
                    </span>
                    <span className="inline-flex items-center px-1.2 py-0.2 rounded-[3px] bg-[#f4f4f5] text-[#52525b] text-[9.5px] font-medium border border-[#e3e3e8] shrink-0">
                      {run.platform === 'android' ? 'Android' : 'Web'}
                    </span>
                  </div>

                  {/* 任务 ID */}
                  <div className="w-[90px] shrink-0">
                    <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-0.5 rounded border border-[#e3e3e8]/50">
                      #{run.id.slice(-8)}
                    </span>
                  </div>

                  {/* 验证结果状态胶囊 */}
                  <div className="w-[85px] shrink-0 text-center">
                    {isPass ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                        <CheckCircle2 size={10} strokeWidth={2.2} />
                        <span>PASSED</span>
                      </span>
                    ) : isFail ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60">
                        <XCircle size={10} strokeWidth={2.2} />
                        <span>FAILED</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10px] font-medium border border-[#bfdbfe]/60">
                        <span>RUNNING</span>
                      </span>
                    )}
                  </div>

                  {/* 步骤与验证说明 */}
                  <div className="flex-1 min-w-0 px-3 flex items-center gap-2 overflow-hidden font-sans">
                    <span className="text-[10px] font-mono text-[#63636b] bg-[#f4f4f6] px-1.5 py-0.5 rounded shrink-0">
                      {run.passedSteps}/{run.totalSteps} 步
                    </span>
                    {latestPrompt ? (
                      <span className="text-[11.5px] text-[#71717a] truncate" title={latestPrompt}>
                        {latestPrompt}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#a1a1aa] italic">
                        无详细指令
                      </span>
                    )}
                  </div>

                  {/* 运行耗时 */}
                  <div className="w-[85px] shrink-0 text-right text-[11px] font-mono text-[#71717a]">
                    {(run.durationMs / 1000).toFixed(2)}s
                  </div>

                  {/* 触发时间 */}
                  <div
                    className="w-[95px] shrink-0 text-right text-[11px] text-[#85858d]"
                    title={new Date(run.createdAt).toLocaleString()}
                  >
                    {formatTimeAgo(run.createdAt)}
                  </div>

                  {/* 操作区 */}
                  <div
                    className="w-[80px] shrink-0 flex items-center justify-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {matchedSuite && (
                      <button
                        type="button"
                        onClick={() => onQuickRunSuite(matchedSuite)}
                        title="再次执行该测试用例"
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-all cursor-pointer"
                      >
                        <RotateCcw size={11.5} />
                      </button>
                    )}

                    {onDeleteRun && (
                      <button
                        type="button"
                        onClick={() => onDeleteRun(run)}
                        title="删除该测试记录与截图产物"
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-all cursor-pointer"
                      >
                        <Trash2 size={11.5} />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectRun(run.id)}
                      title="查看逐帧视觉回放与执行详情"
                      className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-all cursor-pointer"
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
