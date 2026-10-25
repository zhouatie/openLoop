import React, { useState, useMemo } from 'react';
import {
  Layers,
  Check,
  Sparkles,
  FolderGit2,
  Workflow,
  ChevronDown,
  ChevronRight,
  Code2,
  Loader2,
  ArrowRight,
  CheckCircle2,
  Shuffle,
} from 'lucide-react';
import { toast } from './Toast';
import { WorkflowDefinition } from '@openloop/core';
import { api } from '../services/api';

export interface SubtaskPlanItem {
  title: string;
  workspace?: string;
  workflowId?: string;
  description?: string;
  dependencies?: string[];
}

export interface SubtaskPlanData {
  type?: string;
  executionMode?: 'serial' | 'parallel' | 'dag';
  concurrencyLimit?: number;
  subtasks: SubtaskPlanItem[];
}

export interface SubtaskPlanCardProps {
  plan: SubtaskPlanData;
  rawJson?: string;
  taskId?: string;
  parentWorkspace?: string;
  workflows?: WorkflowDefinition[];
  onApplied?: () => void;
}

export const SubtaskPlanCard: React.FC<SubtaskPlanCardProps> = ({
  plan,
  rawJson,
  taskId,
  parentWorkspace,
  workflows = [],
  onApplied,
}) => {
  const [isApplying, setIsApplying] = useState(false);
  const [isApplied, setIsApplied] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [expandedDescIndex, setExpandedDescIndex] = useState<number | null>(null);

  const subtasks = Array.isArray(plan?.subtasks) ? plan.subtasks : [];
  const executionMode = plan?.executionMode || 'serial';

  // 映射流水线友好名称与标签
  const workflowMap = useMemo(() => {
    const map = new Map<string, WorkflowDefinition>();
    for (const wf of workflows) {
      map.set(wf.id, wf);
    }
    return map;
  }, [workflows]);

  const modeBadge = useMemo(() => {
    switch (executionMode) {
      case 'parallel':
        return {
          label: `全并行 (${plan.concurrencyLimit || 3} 并发)`,
          badgeClass: 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/60',
        };
      case 'dag':
        return {
          label: 'DAG 自定义依赖拓扑',
          badgeClass: 'bg-[#f5f3ff] text-[#7c3aed] border-[#ddd6fe]',
        };
      case 'serial':
      default:
        return {
          label: '串行顺序执行 (推荐真机验收)',
          badgeClass: 'bg-[#eeedfd] text-[#4f46e5] border-[#d8d6fb]',
        };
    }
  }, [executionMode, plan.concurrencyLimit]);

  // 一键应用并挂载子工序到当前任务组
  const handleApplyPlan = async () => {
    if (!taskId) {
      toast.error('未关联当前任务，无法自动挂载工序');
      return;
    }
    if (subtasks.length === 0) {
      toast.error('方案中未包含任何可执行子工序');
      return;
    }

    try {
      setIsApplying(true);
      if (import.meta.env?.DEV) {
        console.log('[SubtaskPlanCard] 一键采纳工序规划方案:', {
          taskId,
          subtasksCount: subtasks.length,
          executionMode,
        });
      }

      await api.batchAddSubTasks(taskId, {
        subtasks: subtasks.map((s) => ({
          title: s.title,
          workflowId: s.workflowId,
          workspace: s.workspace,
          description: s.description,
          dependencies: s.dependencies,
        })),
        executionMode,
        concurrencyLimit: plan.concurrencyLimit,
      });

      setIsApplied(true);
      toast.success(`已成功为任务组挂载 ${subtasks.length} 道独立子工序！`);
      onApplied?.();
    } catch (err: any) {
      console.error('[SubtaskPlanCard] 采纳工序规划方案失败:', err);
      toast.error(`采纳工序方案失败: ${err.message || '网络或接口异常'}`);
    } finally {
      setIsApplying(false);
    }
  };

  if (subtasks.length === 0) return null;

  return (
    <div className="my-2.5 rounded-[9px] border border-[#d8d6fb] bg-[#fbfbfe] overflow-hidden shadow-xs transition-all">
      {/* 头部：规划蓝图标题与调度模式 */}
      <div className="px-3.5 py-2.5 bg-gradient-to-r from-[#f5f5ff] to-[#fbfbfe] border-b border-[#ececf0] flex flex-wrap items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-[5px] bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center shrink-0 shadow-2xs">
            <Sparkles size={11} />
          </div>
          <span className="font-semibold text-[12px] text-[#1c1c21] tracking-tight">
            任务组工序拆解方案
          </span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-white border border-[#e3e3e8] text-[#71717a]">
            共 {subtasks.length} 道工序
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] font-medium border ${modeBadge.badgeClass}`}
          >
            <Shuffle size={10} />
            <span>{modeBadge.label}</span>
          </span>

          {rawJson && (
            <button
              type="button"
              onClick={() => setShowRawJson(!showRawJson)}
              className="h-[22px] px-1.5 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#71717a] hover:text-[#1c1c21] text-[10px] font-mono flex items-center gap-1 transition-colors cursor-pointer"
              title="切换显示原始 JSON 代码"
            >
              <Code2 size={10} />
              <span>{showRawJson ? '收起' : 'JSON'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 工序详细列表 */}
      <div className="p-3 space-y-2">
        {subtasks.map((sub, index) => {
          const matchedWf = sub.workflowId ? workflowMap.get(sub.workflowId) : undefined;
          const wfDisplayName = matchedWf?.name || sub.workflowId || '默认流水线';
          const isDescExpanded = expandedDescIndex === index;

          return (
            <div
              key={index}
              className="rounded-[7px] border border-[#e3e3e8] bg-white p-2.5 shadow-2xs space-y-1.5 transition-colors hover:border-[#c7d2fe]"
            >
              {/* 工序标题行 */}
              <div className="flex items-start gap-2 min-w-0">
                <span className="font-mono text-[9.5px] font-bold text-[#4f46e5] bg-[#eeedfd] px-1.5 py-0.5 rounded-[4px] shrink-0 mt-0.5">
                  #{index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[12px] text-[#1c1c21] leading-snug">
                    {sub.title}
                  </div>
                </div>
              </div>

              {/* 核心元信息：工作区工程与流水线绑定 */}
              <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] pt-0.5">
                {/* 绑定的工程工作区路径 */}
                {sub.workspace && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] border border-[#e3e3e8] text-[#4b4b53] font-mono text-[10px] max-w-[220px] truncate"
                    title={`目标工程工作区: ${sub.workspace}`}
                  >
                    <FolderGit2 size={10.5} className="text-[#85858d] shrink-0" />
                    <span className="truncate">{sub.workspace}</span>
                  </span>
                )}

                {/* 绑定的流水线 */}
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f9f9fb] border border-[#e3e3e8] text-[#4f46e5] font-medium text-[10px] max-w-[260px] truncate"
                  title={`执行流水线: ${wfDisplayName} (${sub.workflowId || ''})`}
                >
                  <Workflow size={10.5} className="shrink-0 text-[#6366f1]" />
                  <span className="truncate">{wfDisplayName}</span>
                </span>

                {/* 前序依赖 */}
                {Array.isArray(sub.dependencies) && sub.dependencies.length > 0 && (
                  <span className="font-mono text-[9.5px] text-[#85858d] bg-[#f4f4f6] px-1.5 py-0.5 rounded border border-[#e3e3e8]">
                    依赖 {sub.dependencies.join(', ')}
                  </span>
                )}
              </div>

              {/* 工序详细交付说明 */}
              {sub.description && (
                <div className="pt-1">
                  <div
                    onClick={() => setExpandedDescIndex(isDescExpanded ? null : index)}
                    className="text-[11px] text-[#63636b] leading-relaxed cursor-pointer hover:text-[#1c1c21] transition-colors"
                  >
                    <p className={isDescExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}>
                      {sub.description}
                    </p>
                    {sub.description.length > 90 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-[#4f46e5] mt-0.5 font-medium">
                        {isDescExpanded ? '收起详情' : '展开详情'}
                        {isDescExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 原始 JSON 折叠面板 */}
      {showRawJson && rawJson && (
        <div className="px-3 pb-3">
          <div className="p-2.5 rounded-[6px] bg-[#121214] border border-[#27272a] text-[#e3e3e8] font-mono text-[10px] leading-relaxed max-h-[180px] overflow-y-auto">
            <pre className="whitespace-pre-wrap break-all select-text">{rawJson}</pre>
          </div>
        </div>
      )}

      {/* 底部采纳与操作栏 */}
      <div className="px-3.5 py-2.5 bg-white border-t border-[#ececf0] flex items-center justify-between gap-3">
        <div className="text-[10.5px] text-[#71717a] min-w-0 truncate">
          {isApplied ? (
            <span className="inline-flex items-center gap-1 text-[#059669] font-medium">
              <CheckCircle2 size={12} />
              <span>已成功采纳并挂载至本任务组</span>
            </span>
          ) : (
            <span>采纳后将就地升格为任务组并创建独立子任务</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={isApplying || isApplied || !taskId}
            onClick={handleApplyPlan}
            className={`h-[28px] px-3.5 rounded-[5px] text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
              isApplied
                ? 'bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0]/60 cursor-default'
                : 'bg-[#4f46e5] hover:bg-[#4338ca] text-white disabled:opacity-50'
            }`}
          >
            {isApplying ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>挂载中...</span>
              </>
            ) : isApplied ? (
              <>
                <Check size={12} strokeWidth={2.4} />
                <span>已采纳</span>
              </>
            ) : (
              <>
                <Check size={12} strokeWidth={2.2} />
                <span>一键采纳并挂载子工序</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
