import React, { useState, useMemo } from 'react';
import {
  Target,
  Plus,
  Play,
  Edit3,
  Trash2,
  Search,
  Globe,
  Clock,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Smartphone,
  Apple,
} from 'lucide-react';
import { QaSuite } from '@openloop/core';

interface QaSuitesListViewProps {
  suites: QaSuite[];
  onNewSuite: () => void;
  onEditSuite: (suite: QaSuite) => void;
  onDeleteSuite: (suite: QaSuite) => void;
  onRunSuite: (suite: QaSuite) => void;
}

export const QaSuitesListView: React.FC<QaSuitesListViewProps> = ({
  suites,
  onNewSuite,
  onEditSuite,
  onDeleteSuite,
  onRunSuite,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    return suites.filter((s) => {
      const match =
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        s.targetUrl.toLowerCase().includes(searchQuery.toLowerCase());
      return match;
    });
  }, [suites, searchQuery]);

  return (
    <div className="space-y-3 select-none">
      {/* 搜索与次级工具栏 */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-72">
          <Search size={12} className="absolute left-2.5 top-2.5 text-[#85858d]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索用例名称、URL、说明..."
            className="w-full h-[28px] pl-7 pr-2.5 bg-white border border-[#e3e3e8] rounded-[6px] text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus:border-[#b9b9c2]"
          />
        </div>
      </div>

      {/* 用例列表 (同款规范表格) */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-16 text-center shadow-sm select-none">
          <Target size={30} className="mx-auto text-[#b9b9c2] mb-2.5 stroke-[1.5]" />
          <div className="text-[13px] font-medium text-[#1c1c21]">暂无测试用例</div>
          <p className="text-[11.5px] text-[#85858d] mt-1 mb-3">
            点击右上角“新建用例”配置 Midscene 视觉自动化指令
          </p>
          <button
            onClick={onNewSuite}
            className="inline-flex items-center gap-1.5 h-[28px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs cursor-pointer"
          >
            <Plus size={12} strokeWidth={2.4} />
            <span>创建第一个测试用例</span>
          </button>
        </div>
      ) : (
        <div className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden flex flex-col">
          {/* 表头 */}
          <div className="h-[34px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center text-[11px] font-medium text-[#85858d] select-none">
            <div className="w-[220px] shrink-0">用例名称</div>
            <div className="flex-1 min-w-0 px-3">目标地址与说明</div>
            <div className="w-[80px] shrink-0 text-center">步骤数</div>
            <div className="w-[85px] shrink-0 text-center">最新状态</div>
            <div className="w-[80px] shrink-0 text-right">最近耗时</div>
            <div className="w-[100px] shrink-0 text-center">操作</div>
          </div>

          {/* 表格行 */}
          <div className="divide-y divide-[#f1f1f4]">
            {filtered.map((suite) => {
              const isPass = suite.lastRunStatus === 'passed';
              const isFail = suite.lastRunStatus === 'failed';

              return (
                <div
                  key={suite.id}
                  onClick={() => onEditSuite(suite)}
                  className="group px-4 py-2.5 flex items-center text-[12px] transition-colors cursor-pointer hover:bg-[#fafafc]"
                >
                  {/* 用例名称 */}
                  <div className="w-[220px] shrink-0 flex items-center gap-2 pr-2">
                    <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] group-hover:bg-white flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60 transition-colors">
                      {suite.platform === 'android' ? (
                        <Smartphone size={11} strokeWidth={2} className="text-[#4f46e5]" />
                      ) : suite.platform === 'ios' ? (
                        <Apple size={11} strokeWidth={2} className="text-[#4f46e5]" />
                      ) : (
                        <Target size={11} strokeWidth={2} />
                      )}
                    </div>
                    <span
                      className="font-medium text-[#1c1c21] truncate hover:text-[#4f46e5] transition-colors"
                      title={suite.name}
                    >
                      {suite.name}
                    </span>
                    <span className="inline-flex items-center px-1.2 py-0.2 rounded-[3px] bg-[#f4f4f5] text-[#52525b] text-[9.5px] font-medium border border-[#e3e3e8] shrink-0">
                      {suite.platform === 'android' ? 'Android' : suite.platform === 'ios' ? 'iOS' : 'Web'}
                    </span>
                  </div>

                  {/* 目标地址与说明 */}
                  <div className="flex-1 min-w-0 px-3 flex items-center gap-2 overflow-hidden font-sans">
                    <div className="flex items-center gap-1 font-mono text-[11px] text-[#63636b] truncate shrink-0 max-w-[200px]" title={suite.targetUrl}>
                      <Globe size={11} className="text-[#a1a1aa] shrink-0" />
                      <span className="truncate">{suite.targetUrl}</span>
                    </div>
                    {suite.description && <span className="text-[#d4d4d8] shrink-0">·</span>}
                    {suite.description && (
                      <span className="text-[11.5px] text-[#85858d] truncate" title={suite.description}>
                        {suite.description}
                      </span>
                    )}
                  </div>

                  {/* 步骤数 */}
                  <div className="w-[80px] shrink-0 text-center">
                    <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-0.5 rounded shrink-0">
                      {suite.steps.length} 步骤
                    </span>
                  </div>

                  {/* 最新状态 */}
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
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#71717a] text-[10px] font-medium border border-[#e3e3e8]">
                        <Clock size={10} />
                        <span>UNTESTED</span>
                      </span>
                    )}
                  </div>

                  {/* 最近耗时 */}
                  <div className="w-[80px] shrink-0 text-right text-[11px] font-mono text-[#71717a]">
                    {suite.lastRunDurationMs ? `${(suite.lastRunDurationMs / 1000).toFixed(2)}s` : '-'}
                  </div>

                  {/* 操作区 */}
                  <div
                    className="w-[100px] shrink-0 flex items-center justify-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onRunSuite(suite)}
                      className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-all cursor-pointer"
                      title="立即执行此用例"
                    >
                      <Play size={11} className="fill-current text-[#4f46e5]" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onEditSuite(suite)}
                      className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
                      title="编辑用例配置"
                    >
                      <Edit3 size={11.5} />
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteSuite(suite)}
                      className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-all cursor-pointer"
                      title="删除此用例"
                    >
                      <Trash2 size={11.5} />
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
