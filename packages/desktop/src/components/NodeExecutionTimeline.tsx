import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  SkipForward,
  CircleDot,
  Bot,
  Terminal,
  GitCommit,
  Rocket,
  ShieldCheck,
  Target,
  FileVideo,
  Zap,
  Sparkles,
  ChevronDown,
  Copy,
  Check,
  FileImage,
  ExternalLink,
  AlertTriangle,
  CheckSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Task, WorkflowDefinition, NodeStatus } from '@openloop/core';
import { parseMarkdownSteps } from '@openloop/core/markdown-format';
import { formatDurationHuman, NODE_STATUS_DICT, NodeMeta } from '../utils/nodeMeta';
import { buildTimelineItems, TimelineItem } from '../utils/timelineSteps';

interface NodeExecutionTimelineProps {
  task: Task;
  workflow?: WorkflowDefinition | null;
  onOpenTaskLogs: (taskId: string, nodeId?: string) => void;
  onOpenAgentSession?: (taskId: string, nodeId: string, nodeName: string) => void;
  onPreviewArtifact?: (artifact: { name: string; type: string; path: string }) => void;
  onApprove?: (taskId: string, approved: boolean, feedback?: string) => void;
  isApproving?: boolean;
}

// 步骤类型标识：中性灰文字 + 语义微图标着色，替代高饱和彩色胶囊
const NODE_TYPE_LABELS: Record<string, { label: string; Icon: LucideIcon; tint: string }> = {
  agent: { label: 'AI Agent', Icon: Bot, tint: 'text-[#7c3aed]' },
  'qa-approval': { label: '人工门禁', Icon: ShieldCheck, tint: 'text-[#b45309]' },
  midscene: { label: '智能 UI', Icon: Target, tint: 'text-[#0f766e]' },
  'stitch-image': { label: '动图生成', Icon: FileVideo, tint: 'text-[#2563eb]' },
  hook: { label: 'Hook 触发', Icon: Zap, tint: 'text-[#c2410c]' },
  custom: { label: '扩展插件', Icon: Sparkles, tint: 'text-[#db2777]' },
  cli: { label: 'CLI 脚本', Icon: Terminal, tint: 'text-[#71717a]' },
};

// 卡片行级微图标按钮：方形无边框，悬浮才着色，避免长文字按钮铺满卡片
const MICRO_BTN =
  'w-[22px] h-[22px] rounded-[4px] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

export const NodeExecutionTimeline: React.FC<NodeExecutionTimelineProps> = ({
  task,
  workflow,
  onOpenTaskLogs,
  onOpenAgentSession,
  onPreviewArtifact,
  onApprove,
  isApproving = false,
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 流程文档声明的全部步骤：二级标题即一个步骤
  const declaredSteps = useMemo(
    () => parseMarkdownSteps(workflow?.markdown || ''),
    [workflow?.markdown]
  );

  // 时间线全部步骤：文档顺序为主，执行记录按步骤名对齐，未执行到的补待执行占位
  const timelineItems: TimelineItem[] = useMemo(
    () => buildTimelineItems(task, declaredSteps),
    [task, declaredSteps]
  );

  // 统计概览指标
  const metrics = useMemo(() => {
    const total = timelineItems.length;
    const completed = timelineItems.filter((i) => i.status === 'success').length;
    const running = timelineItems.filter((i) => i.status === 'running').length;
    const waiting = timelineItems.filter((i) => i.status === 'waiting_approval').length;
    const failed = timelineItems.filter((i) => i.status === 'failed').length;

    let totalDurationSec = 0;
    timelineItems.forEach((item) => {
      if (item.durationSec && item.durationSec > 0) {
        totalDurationSec += item.durationSec;
      }
    });

    return {
      total,
      completed,
      running,
      waiting,
      failed,
      totalDurationSec,
    };
  }, [timelineItems]);

  const toggleExpand = (id: string) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[NodeExecutionTimeline] toggleExpand:', id);
    }
    setExpandedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const renderTypeBadge = (item: TimelineItem) => {
    // 未执行到的步骤还不知道执行类型，不猜类型
    if (item.planned) return null;

    const { label, Icon, tint } = item.isGit
      ? { label: 'Git 提交', Icon: GitCommit, tint: 'text-[#52525b]' }
      : item.isDeploy
      ? { label: '应用部署', Icon: Rocket, tint: 'text-[#0284c7]' }
      : NODE_TYPE_LABELS[item.type] || NODE_TYPE_LABELS.cli;

    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#9c9ca4] shrink-0">
        <Icon size={10} className={tint} />
        <span>{label}</span>
      </span>
    );
  };

  // 成功与静默态仅用微图标文字，异常与停留态才使用低饱和浅底徽章
  const renderStatusBadge = (status: NodeStatus) => {
    const config = NODE_STATUS_DICT[status] || NODE_STATUS_DICT.pending;

    if (status === 'success' || status === 'skipped' || status === 'pending') {
      const Icon = status === 'success' ? CheckCircle2 : status === 'skipped' ? SkipForward : CircleDot;
      return (
        <span
          className={`inline-flex items-center gap-1 text-[10.5px] font-medium ${
            status === 'success' ? 'text-[#3f8f65]' : 'text-[#a5a5b0]'
          }`}
        >
          <Icon size={11} />
          <span>{config.label}</span>
        </span>
      );
    }

    const Icon = status === 'running' ? Loader2 : status === 'waiting_approval' ? Clock : XCircle;
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded-[4px] text-[10px] font-medium ${config.badgeClass}`}
      >
        <Icon
          size={10}
          className={
            status === 'running' ? 'animate-spin' : status === 'waiting_approval' ? 'animate-pulse' : ''
          }
        />
        <span>{config.label}</span>
      </span>
    );
  };

  // 时间线轴点：浅底微边框 + 语义色图标，克制不抢画面
  const renderTimelineIcon = (status: NodeStatus, order: number) => {
    const base =
      'w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 ring-4 ring-white transition-colors';

    if (status === 'success') {
      return (
        <div className={`${base} bg-[#ecfdf5] border border-[#a7f3d0] text-[#059669]`}>
          <CheckCircle2 size={11} strokeWidth={2.6} />
        </div>
      );
    }
    if (status === 'running') {
      return (
        <div className={`${base} bg-[#eeedfd] border border-[#d8d6fb] text-[#4f46e5]`}>
          <Loader2 size={11} strokeWidth={2.6} className="animate-spin" />
        </div>
      );
    }
    if (status === 'waiting_approval') {
      return (
        <div className={`${base} bg-[#fbf0df] border border-[#f4dcba] text-[#b45309]`}>
          <Clock size={11} strokeWidth={2.6} className="animate-pulse" />
        </div>
      );
    }
    if (status === 'failed') {
      return (
        <div className={`${base} bg-[#fbe9e9] border border-[#f6c6c6] text-[#d64545]`}>
          <XCircle size={11} strokeWidth={2.6} />
        </div>
      );
    }
    return (
      <div
        className={`${base} bg-white border border-[#e3e3e8] text-[#a5a5b0] text-[9.5px] font-mono font-medium`}
      >
        {order}
      </div>
    );
  };

  if (timelineItems.length === 0) {
    return (
      <div className="p-4 rounded-[7px] border border-dashed border-[#e3e3e8] text-center text-[#85858d] text-[11.5px]">
        {workflow
          ? `流水线「${workflow.name}」已关联，尚未产生步骤执行记录`
          : '任务尚未关联流水线或未触发执行，暂无步骤时序数据'}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* 时序统计概要栏 */}
      <div className="px-3 py-2 rounded-[7px] bg-[#f8f8fb] border border-[#ececf0] flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2 text-[#4b4b53]">
          <span className="font-medium text-[#1c1c21]">
            流水线进度: {metrics.completed}/{metrics.total} 步完成
          </span>
          {metrics.totalDurationSec > 0 && (
            <>
              <span className="text-[#c4c4cc]">·</span>
              <span className="text-[#85858d]">
                总耗时 {formatDurationHuman(metrics.totalDurationSec)}
              </span>
            </>
          )}
        </div>

        {/* 状态指示简报 */}
        <div className="flex items-center gap-1.5">
          {metrics.running > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[9.5px] font-medium bg-[#eeedfd] text-[#4f46e5]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] animate-ping" />
              正在执行
            </span>
          )}
          {metrics.waiting > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[9.5px] font-medium bg-[#fbf0df] text-[#b45309]">
              待人工验收
            </span>
          )}
          {metrics.failed > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[9.5px] font-medium bg-[#fbe9e9] text-[#d64545]">
              已中断
            </span>
          )}
        </div>
      </div>

      {/* 垂直时间线卡片流 */}
      <div className="relative pl-6 space-y-3 before:absolute before:top-2 before:bottom-3 before:left-[9px] before:w-[2px] before:bg-[#ececf0]">
        {timelineItems.map((item) => {
          const isExpanded = !!expandedNodes[item.id];
          const hasArtifacts = item.run?.artifacts && item.run.artifacts.length > 0;
          const hasError = !!item.run?.error;
          const isCurrentApprovalNode =
            item.status === 'waiting_approval' && task.status === 'waiting_approval';
          // 人工卡点清单：由 ask_human 步骤写进步骤输出
          const renderChecklist = (): any[] | null => {
            const fromStep = (item.run?.output as any)?.checklist;
            return Array.isArray(fromStep) && fromStep.length > 0 ? fromStep : null;
          };

          return (
            <div key={item.id} className="relative group">
              {/* 时间线轴步骤指示器 */}
              <div className="absolute -left-6 top-2.5 z-10">
                {renderTimelineIcon(item.status, item.order)}
              </div>

              {/* 卡片主体 */}
              <div
                className={`rounded-[8px] border transition-all ${
                  item.status === 'running'
                    ? 'border-[#c7d2fe] bg-[#fafaff] shadow-[0_2px_8px_rgba(79,70,229,0.06)]'
                    : item.status === 'waiting_approval'
                    ? 'border-[#fed7aa] bg-[#fffdfa] shadow-[0_2px_8px_rgba(245,158,11,0.06)]'
                    : item.status === 'failed'
                    ? 'border-[#fecaca] bg-[#fffafa] shadow-[0_2px_8px_rgba(214,69,69,0.06)]'
                    : 'border-[#ececf0] bg-[#fcfcfd] hover:bg-white hover:border-[#d9d9df] shadow-none'
                }`}
              >
                {/* 卡片头部概要区 */}
                <div
                  onClick={() => {
                    if (item.planned) return;
                    toggleExpand(item.id);
                  }}
                  className={`p-2.5 select-none space-y-1.5 ${item.planned ? '' : 'cursor-pointer'}`}
                >
                  {/* 第一行：序号、中文主标题、类型胶囊与状态徽标 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-[#85858d] shrink-0 font-medium">
                        #{String(item.order).padStart(2, '0')}
                      </span>
                      {/* 中文名称醒目突出 */}
                      <span className="text-[12.5px] font-semibold text-[#1c1c21] truncate">
                        {item.name}
                      </span>
                      {renderTypeBadge(item)}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {renderStatusBadge(item.status)}
                    </div>
                  </div>

                  {/* 第二行：一句话中文功能释义 */}
                  {item.description && (
                    <div className="text-[11px] text-[#63636b] leading-tight">
                      {item.description}
                    </div>
                  )}

                  {/* 第三行：底层英文字符标识、耗时统计与快速动作区 */}
                  <div className="pt-0.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      {/* 英文标识采用浅色等宽字体显示，便于对账但不干扰中文理解 */}
                      {!item.planned && (
                        <span
                          className="font-mono text-[9.5px] text-[#85858d] bg-white px-1.5 py-[0.5px] rounded border border-[#e3e3e8] shrink-0"
                          title="底层步骤标识 (Step ID)"
                        >
                          {item.id}
                        </span>
                      )}

                      {/* 耗时与时刻 */}
                      {item.durationSec !== undefined ? (
                        <span className="text-[10.5px] font-medium text-[#4b4b53]">
                          耗时: {formatDurationHuman(item.durationSec)}
                        </span>
                      ) : item.status === 'running' ? (
                        <span className="text-[10.5px] font-medium text-[#4f46e5]">
                          正在执行中...
                        </span>
                      ) : item.planned ? null : (
                        <span className="text-[10.5px] text-[#a5a5b0]">未启动</span>
                      )}

                      {item.timeRangeStr && (
                        <span className="text-[10px] text-[#85858d] hidden sm:inline">
                          ({item.timeRangeStr})
                        </span>
                      )}
                    </div>

                    {/* 操作区：默认只留展开箭头，次级动作在悬浮/聚焦时以微图标淡入，避免按钮堆满卡片 */}
                    <div
                      className={`flex items-center gap-0.5 shrink-0 ${item.planned ? 'hidden' : ''}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 次级动作：悬浮卡片或键盘聚焦时浮现，非悬浮态只留展开箭头 */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                        {/* 查看 Agent 交互会话 */}
                        {item.type === 'agent' && onOpenAgentSession && (
                          <button
                            type="button"
                            onClick={() => onOpenAgentSession(task.id, item.id, item.name)}
                            className={`${MICRO_BTN} text-[#85858d] hover:text-[#7c3aed] hover:bg-[#eeedfd]`}
                            title="查看该 Agent 步骤的交互会话"
                          >
                            <Bot size={11} />
                          </button>
                        )}

                        {/* 查看步骤日志 */}
                        <button
                          type="button"
                          onClick={() => {
                            if (process.env.NODE_ENV !== 'production') {
                              console.log('[NodeExecutionTimeline] openNodeLogs:', task.id, item.id);
                            }
                            onOpenTaskLogs(task.id, item.id);
                          }}
                          className={`${MICRO_BTN} text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0]`}
                          title="查看该步骤日志（终端已按步骤过滤）"
                        >
                          <Terminal size={11} />
                        </button>

                        {/* 查看步骤产物 */}
                        {hasArtifacts && (
                          <button
                            type="button"
                            onClick={() => {
                              if (item.run?.artifacts?.[0] && onPreviewArtifact) {
                                onPreviewArtifact(item.run.artifacts[0]);
                              }
                            }}
                            className={`${MICRO_BTN} text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0]`}
                            title={`查看产物（${item.run!.artifacts!.length} 个）`}
                          >
                            <FileImage size={11} />
                          </button>
                        )}

                      </div>

                      {/* 展开收起详情 */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(item.id)}
                        className={`${MICRO_BTN} text-[#85858d] group-hover:text-[#1c1c21] group-hover:bg-[#ececf0]`}
                        title={isExpanded ? '收起详情' : '展开详情'}
                      >
                        <ChevronDown
                          size={12}
                          className={`transform transition-transform duration-200 ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 展开的详情面板 */}
                {isExpanded && !item.planned && (
                  <div className="border-t border-[#ececf0] bg-white p-2.5 rounded-b-[8px] space-y-2 text-[11px] animate-in fade-in-50 duration-150">
                    {/* 错误提示卡片 */}
                    {hasError && (
                      <div className="p-2 rounded-[6px] bg-[#fff5f5] border border-[#fecaca] space-y-1">
                        <div className="flex items-center justify-between text-[#d64545] font-semibold text-[11px]">
                          <span className="flex items-center gap-1">
                            <AlertTriangle size={11} />
                            <span>执行报错中断</span>
                          </span>
                          {item.run?.exitCode !== undefined && (
                            <span className="font-mono text-[10px] bg-white px-1 rounded border border-[#fecaca]">
                              退出码: {item.run.exitCode}
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-[#b91c1c] whitespace-pre-wrap break-all bg-white/70 p-1.5 rounded border border-[#fed7d7]">
                          {item.run!.error}
                        </div>
                        <div className="flex justify-end gap-1.5 pt-0.5">
                          <button
                            onClick={() => copyText(`err-${item.id}`, item.run!.error || '')}
                            className="h-[20px] px-2 rounded-[4px] bg-white text-[#d64545] border border-[#fecaca] text-[10px] flex items-center gap-1"
                          >
                            {copiedKey === `err-${item.id}` ? (
                              <Check size={10} className="text-[#189a58]" />
                            ) : (
                              <Copy size={10} />
                            )}
                            <span>{copiedKey === `err-${item.id}` ? '已复制' : '复制报错'}</span>
                          </button>
                          <button
                            onClick={() => onOpenTaskLogs(task.id, item.id)}
                            className="h-[20px] px-2 rounded-[4px] bg-[#d64545] text-white text-[10px] flex items-center gap-1 shadow-sm"
                          >
                            <Terminal size={10} />
                            <span>查看报错终端</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* QA Checklist 核验清单 */}
                    {renderChecklist() && (
                      <div>
                        <div className="text-[10px] text-[#85858d] mb-1 font-medium">
                          QA 验收检查项 Checklist:
                        </div>
                        <div className="space-y-1 bg-[#fbfbfd] p-2 rounded-[5px] border border-[#ececf0]">
                          {renderChecklist()!.map((chk, cIdx) => (
                            <div key={cIdx} className="flex items-start gap-1.5 text-[11px] text-[#4b4b53]">
                              <CheckSquare size={12} className="text-[#189a58] shrink-0 mt-0.5" />
                              <span>{chk}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 步骤生成产物预览 */}
                    {hasArtifacts && (
                      <div>
                        <div className="text-[10px] text-[#85858d] mb-1 font-medium">
                          生成的产物制品:
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.run!.artifacts!.map((art, aIdx) => (
                            <button
                              key={aIdx}
                              onClick={() => onPreviewArtifact && onPreviewArtifact(art)}
                              className="px-2 py-1 rounded-[5px] bg-[#f4f4f7] hover:bg-[#eaeaea] border border-[#e3e3e8] text-[10.5px] text-[#1c1c21] flex items-center gap-1.5 transition-colors"
                            >
                              <FileImage size={11} className="text-[#4f46e5]" />
                              <span>{art.name}</span>
                              <ExternalLink size={10} className="text-[#85858d]" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 当前待人工审批步骤内嵌操作条 */}
                    {isCurrentApprovalNode && onApprove && (
                      <div className="p-2.5 rounded-[6px] bg-[#fffbeb] border border-[#fde68a] space-y-2 mt-2">
                        <div className="text-[11px] text-[#92400e] font-medium flex items-center gap-1">
                          <Clock size={12} />
                          <span>此步骤正等待人工验收放行。确认指标是否符合要求？</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            disabled={isApproving}
                            onClick={() => onApprove(task.id, true)}
                            className="flex-1 h-[26px] rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all disabled:opacity-50 shadow-sm"
                          >
                            <CheckCircle2 size={12} />
                            <span>确认通过 (继续执行)</span>
                          </button>
                          <button
                            disabled={isApproving}
                            onClick={() => onApprove(task.id, false, '人工验收未通过指标')}
                            className="flex-1 h-[26px] rounded-[5px] bg-white hover:bg-[#fee2e2] text-[#d64545] border border-[#fca5a5] text-[11px] font-medium flex items-center justify-center gap-1 transition-all disabled:opacity-50"
                          >
                            <XCircle size={12} />
                            <span>驳回流水线</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
