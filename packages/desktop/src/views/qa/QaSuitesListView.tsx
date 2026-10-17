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
    <div className="space-y-4">
      {/* 搜索与新建栏 */}
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

        <button
          onClick={onNewSuite}
          className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs"
        >
          <Plus size={12} strokeWidth={2.4} />
          <span>新建测试用例</span>
        </button>
      </div>

      {/* 用例列表 */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-[#e3e3e8] rounded-[10px] p-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <Target size={28} className="mx-auto text-[#b9b9c2] mb-2" />
          <div className="text-[13px] font-medium text-[#1c1c21]">暂无测试用例</div>
          <p className="text-[11.5px] text-[#85858d] mt-1">
            点击右上角“新建测试用例”配置 Midscene 视觉自动化指令
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#e3e3e8] rounded-[10px] divide-y divide-[#ececf0] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          {filtered.map((suite) => {
            const isPass = suite.lastRunStatus === 'passed';
            const isFail = suite.lastRunStatus === 'failed';

            return (
              <div
                key={suite.id}
                className="px-4 py-3 min-h-[58px] flex items-center justify-between hover:bg-[#f9f9fb] transition-colors group select-none"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-4">
                  <div className="w-8 h-8 rounded-[7px] bg-[#f4f4f7] border border-[#ececf0] flex items-center justify-center text-[#1c1c21] group-hover:border-[#b9b9c2] transition-colors shrink-0">
                    <Target size={15} strokeWidth={2} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-semibold text-[#1c1c21] truncate">
                        {suite.name}
                      </span>

                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          isPass
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : isFail
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-[#f4f4f6] text-[#71717a] border border-[#e3e3e8]'
                        }`}
                      >
                        {isPass ? (
                          <CheckCircle2 size={11} />
                        ) : isFail ? (
                          <XCircle size={11} />
                        ) : (
                          <Clock size={11} />
                        )}
                        <span>{isPass ? 'PASSED' : isFail ? 'FAILED' : 'UNTESTED'}</span>
                      </span>

                      <span className="text-[10.5px] font-mono text-[#85858d] bg-[#f4f4f7] px-1.5 py-0.2 rounded border border-[#ececf0]">
                        {suite.steps.length} 步骤
                      </span>
                    </div>

                    <div className="flex items-center gap-3.5 text-[11px] text-[#85858d]">
                      {suite.description && (
                        <span className="truncate max-w-sm text-[#71717a]">{suite.description}</span>
                      )}

                      <div className="flex items-center gap-1 font-mono text-[11px] text-[#52525b] truncate max-w-xs">
                        <Globe size={11} className="text-[#a1a1aa] shrink-0" />
                        <span className="truncate">{suite.targetUrl}</span>
                      </div>

                      {suite.lastRunDurationMs && (
                        <span className="font-mono text-[10.5px]">
                          耗时: {(suite.lastRunDurationMs / 1000).toFixed(2)}s
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => onRunSuite(suite)}
                    className="h-[26px] px-2.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1 shadow-xs transition-all active:scale-95"
                    title="立即执行此用例"
                  >
                    <Play size={11} />
                    <span>执行</span>
                  </button>

                  <button
                    onClick={() => onEditSuite(suite)}
                    className="w-6 h-[26px] rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#71717a] hover:text-[#1c1c21] flex items-center justify-center transition-colors shadow-2xs"
                    title="编辑用例"
                  >
                    <Edit3 size={11} />
                  </button>

                  <button
                    onClick={() => onDeleteSuite(suite)}
                    className="w-6 h-[26px] rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-red-50 text-[#71717a] hover:text-red-600 flex items-center justify-center transition-colors shadow-2xs"
                    title="删除用例"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
