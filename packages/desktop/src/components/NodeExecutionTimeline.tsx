import React, { useState, useMemo } from 'react';
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
  Play,
  RotateCcw,
  CheckSquare,
} from 'lucide-react';
import type { Task, WorkflowDefinition, NodeRun, NodeStatus, WorkflowNode } from '@openloop/core';
import {
  resolveNodeMeta,
  formatDurationHuman,
  NODE_STATUS_DICT,
  NodeMeta,
} from '../utils/nodeMeta';

interface NodeExecutionTimelineProps {
  task: Task;
  workflow?: WorkflowDefinition | null;
  allWorkflows?: WorkflowDefinition[];
  onOpenTaskLogs: (taskId: string, nodeId?: string) => void;
  onOpenAgentSession?: (taskId: string, nodeId: string, nodeName: string) => void;
  onPreviewArtifact?: (artifact: { name: string; type: string; path: string }) => void;
  onApprove?: (taskId: string, approved: boolean, feedback?: string) => void;
  isApproving?: boolean;
  onSkipNode?: (taskId: string, nodeId: string) => void;
  onRetryNode?: (taskId: string, nodeId: string) => void;
  isSkipping?: boolean;
  isRetryingNode?: boolean;
}

interface TimelineItem {
  id: string;
  name: string;
  description: string;
  type: string;
  isGit?: boolean;
  isDeploy?: boolean;
  run?: NodeRun;
  status: NodeStatus;
  wfNode?: WorkflowNode;
  durationSec?: number;
  timeRangeStr?: string;
  order: number;
}

export const NodeExecutionTimeline: React.FC<NodeExecutionTimelineProps> = ({
  task,
  workflow,
  allWorkflows,
  onOpenTaskLogs,
  onOpenAgentSession,
  onPreviewArtifact,
  onApprove,
  isApproving = false,
  onSkipNode,
  onRetryNode,
  isSkipping = false,
  isRetryingNode = false,
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 整理时间线全部节点（结合工作流定义与实际运行记录）
  const timelineItems: TimelineItem[] = useMemo(() => {
    const runs = task.nodeRuns || {};
    const items: TimelineItem[] = [];
    const visitedNodeIds = new Set<string>();

    const formatTime = (ts?: number) => {
      if (!ts) return '';
      const d = new Date(ts);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      return `${h}:${m}:${s}`;
    };

    // 1. 如果有工作流定义，按工作流编排次序遍历
    if (workflow?.nodes && workflow.nodes.length > 0) {
      workflow.nodes.forEach((wn, idx) => {
        visitedNodeIds.add(wn.id);
        const meta = resolveNodeMeta(wn.id, workflow, allWorkflows);
        const run = runs[wn.id];

        let status: NodeStatus = 'pending';
        if (run) {
          status = run.status;
        } else if (task.status === 'running' && task.currentNodeId === wn.id) {
          status = 'running';
        } else if (task.status === 'waiting_approval' && task.currentNodeId === wn.id) {
          status = 'waiting_approval';
        }

        let durationSec: number | undefined;
        let timeRangeStr: string | undefined;

        if (run?.startedAt && run?.finishedAt) {
          durationSec = (run.finishedAt - run.startedAt) / 1000;
          timeRangeStr = `${formatTime(run.startedAt)} ~ ${formatTime(run.finishedAt)}`;
        } else if (run?.startedAt) {
          timeRangeStr = `${formatTime(run.startedAt)} 开始`;
        }

        items.push({
          id: wn.id,
          name: meta.name,
          description: meta.description,
          type: meta.type,
          isGit: meta.isGit,
          isDeploy: meta.isDeploy,
          run,
          status,
          wfNode: wn,
          durationSec,
          timeRangeStr,
          order: idx + 1,
        });
      });
    }

    // 2. 补充在 nodeRuns 中存在但未在 workflow.nodes 出现的动态节点（如重试或动态注入）
    Object.entries(runs).forEach(([nid, run]) => {
      if (visitedNodeIds.has(nid)) return;
      visitedNodeIds.add(nid);

      const meta = resolveNodeMeta(nid, workflow, allWorkflows);
      let durationSec: number | undefined;
      let timeRangeStr: string | undefined;

      if (run.startedAt && run.finishedAt) {
        durationSec = (run.finishedAt - run.startedAt) / 1000;
        timeRangeStr = `${formatTime(run.startedAt)} ~ ${formatTime(run.finishedAt)}`;
      } else if (run.startedAt) {
        timeRangeStr = `${formatTime(run.startedAt)} 开始`;
      }

      items.push({
        id: nid,
        name: meta.name,
        description: meta.description,
        type: meta.type,
        isGit: meta.isGit,
        isDeploy: meta.isDeploy,
        run,
        status: run.status,
        durationSec,
        timeRangeStr,
        order: items.length + 1,
      });
    });

    // 若无工作流定义，按启动时序升序排序
    if (!workflow?.nodes || workflow.nodes.length === 0) {
      items.sort((a, b) => {
        const tA = a.run?.startedAt || 0;
        const tB = b.run?.startedAt || 0;
        return tA - tB;
      });
      items.forEach((item, idx) => {
        item.order = idx + 1;
      });
    }

    return items;
  }, [task, workflow, allWorkflows]);

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
    if (item.isGit) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#1c1c21] text-white">
          <GitCommit size={10} />
          <span>Git 提交</span>
        </span>
      );
    }
    if (item.isDeploy) {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#f0f9ff] text-[#0284c7] border border-[#bae6fd]">
          <Rocket size={10} />
          <span>应用部署</span>
        </span>
      );
    }
    switch (item.type) {
      case 'agent':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb]">
            <Bot size={10} />
            <span>AI Agent</span>
          </span>
        );
      case 'qa-approval':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#fffbeb] text-[#b45309] border border-[#fde68a]">
            <ShieldCheck size={10} />
            <span>人工门禁</span>
          </span>
        );
      case 'midscene':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#f0fdf4] text-[#15803d] border border-[#bbf7d0]">
            <Target size={10} />
            <span>智能 UI</span>
          </span>
        );
      case 'stitch-image':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#eff6ff] text-[#1d4ed8] border border-[#bfdbfe]">
            <FileVideo size={10} />
            <span>动图生成</span>
          </span>
        );
      case 'hook':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#fff7ed] text-[#c2410c] border border-[#fed7aa]">
            <Zap size={10} />
            <span>Hook 触发</span>
          </span>
        );
      case 'custom':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#fdf2f8] text-[#db2777] border border-[#fbcfe8]">
            <Sparkles size={10} />
            <span>扩展插件</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#f4f4f6] text-[#4b4b53] border border-[#ececf0]">
            <Terminal size={10} />
            <span>CLI 脚本</span>
          </span>
        );
    }
  };

  const renderStatusBadge = (status: NodeStatus) => {
    const config = NODE_STATUS_DICT[status] || NODE_STATUS_DICT.pending;
    let icon = <CircleDot size={11} />;
    if (status === 'success') icon = <CheckCircle2 size={11} />;
    if (status === 'running') icon = <Loader2 size={11} className="animate-spin" />;
    if (status === 'waiting_approval') icon = <Clock size={11} className="animate-pulse" />;
    if (status === 'failed') icon = <XCircle size={11} />;
    if (status === 'skipped') icon = <SkipForward size={11} />;

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium shadow-none transition-colors ${config.badgeClass}`}
      >
        {icon}
        <span>{config.label}</span>
      </span>
    );
  };

  const renderTimelineIcon = (status: NodeStatus, order: number) => {
    if (status === 'success') {
      return (
        <div className="w-5 h-5 rounded-full bg-[#189a58] text-white flex items-center justify-center shrink-0 shadow-sm ring-4 ring-white">
          <CheckCircle2 size={12} strokeWidth={2.6} />
        </div>
      );
    }
    if (status === 'running') {
      return (
        <div className="w-5 h-5 rounded-full bg-[#4f46e5] text-white flex items-center justify-center shrink-0 shadow-sm ring-4 ring-[#eeedfd]">
          <Loader2 size={12} className="animate-spin" strokeWidth={2.6} />
        </div>
      );
    }
    if (status === 'waiting_approval') {
      return (
        <div className="w-5 h-5 rounded-full bg-[#f59e0b] text-white flex items-center justify-center shrink-0 shadow-sm ring-4 ring-[#fef3c7]">
          <Clock size={12} className="animate-pulse" strokeWidth={2.6} />
        </div>
      );
    }
    if (status === 'failed') {
      return (
        <div className="w-5 h-5 rounded-full bg-[#d64545] text-white flex items-center justify-center shrink-0 shadow-sm ring-4 ring-[#fee2e2]">
          <XCircle size={12} strokeWidth={2.6} />
        </div>
      );
    }
    return (
      <div className="w-5 h-5 rounded-full bg-[#f1f1f4] text-[#85858d] border border-[#e3e3e8] flex items-center justify-center text-[10px] font-mono font-medium shrink-0 ring-4 ring-white">
        {order}
      </div>
    );
  };

  if (timelineItems.length === 0) {
    return (
      <div className="p-4 rounded-[7px] border border-dashed border-[#e3e3e8] text-center text-[#85858d] text-[11.5px]">
        任务尚未关联工作流或未触发执行，暂无节点时序数据
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
        {timelineItems.map((item, index) => {
          const isExpanded = !!expandedNodes[item.id];
          const hasArtifacts = item.run?.artifacts && item.run.artifacts.length > 0;
          const hasError = !!item.run?.error;
          const isCurrentApprovalNode =
            item.status === 'waiting_approval' && task.status === 'waiting_approval';

          return (
            <div key={item.id} className="relative group">
              {/* 时间线轴节点指示器 */}
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
                  onClick={() => toggleExpand(item.id)}
                  className="p-2.5 cursor-pointer select-none space-y-1.5"
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
                  <div className="text-[11px] text-[#63636b] leading-tight">
                    {item.description}
                  </div>

                  {/* 第三行：底层英文字符标识、耗时统计与快速动作区 */}
                  <div className="pt-0.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      {/* 英文标识采用浅色等宽字体显示，便于对账但不干扰中文理解 */}
                      <span
                        className="font-mono text-[9.5px] text-[#85858d] bg-white px-1.5 py-[0.5px] rounded border border-[#e3e3e8] shrink-0"
                        title="底层节点标识 (Node ID)"
                      >
                        {item.id}
                      </span>

                      {/* 耗时与时刻 */}
                      {item.durationSec !== undefined ? (
                        <span className="text-[10.5px] font-medium text-[#4b4b53]">
                          耗时: {formatDurationHuman(item.durationSec)}
                        </span>
                      ) : item.status === 'running' ? (
                        <span className="text-[10.5px] font-medium text-[#4f46e5]">
                          正在执行中...
                        </span>
                      ) : (
                        <span className="text-[10.5px] text-[#a5a5b0]">未启动</span>
                      )}

                      {item.timeRangeStr && (
                        <span className="text-[10px] text-[#85858d] hidden sm:inline">
                          ({item.timeRangeStr})
                        </span>
                      )}
                    </div>

                    {/* 操作按钮组 */}
                    <div
                      className="flex items-center gap-1 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 失败节点微型快捷操作 */}
                      {item.status === 'failed' && onSkipNode && (
                        <button
                          disabled={isSkipping}
                          onClick={() => onSkipNode(task.id, item.id)}
                          className="h-[21px] px-1.5 rounded-[4px] bg-white hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[10px] font-medium flex items-center gap-1 transition-colors shadow-none disabled:opacity-50"
                          title="跳过此节点继续后续流程或标记完成"
                        >
                          <SkipForward size={10} className="text-[#85858d]" />
                          <span>跳过</span>
                        </button>
                      )}
                      {item.status === 'failed' && onRetryNode && (
                        <button
                          disabled={isRetryingNode}
                          onClick={() => onRetryNode(task.id, item.id)}
                          className="h-[21px] px-1.5 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10px] font-medium flex items-center gap-1 transition-colors shadow-none active:scale-95 disabled:opacity-50"
                          title="仅单独重试此节点"
                        >
                          <RotateCcw size={10} />
                          <span>重试</span>
                        </button>
                      )}

                      {/* 查看 Agent 交互会话 */}
                      {item.type === 'agent' && onOpenAgentSession && (
                        <button
                          type="button"
                          onClick={() => onOpenAgentSession(task.id, item.id, item.name)}
                          className="h-[21px] px-1.5 rounded-[4px] bg-[#eeedfd] hover:bg-[#e0e7ff] text-[#7c3aed] border border-[#d8d6fb] text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer shadow-none"
                          title="查看该 Agent 节点的交互会话、深度思考与工具调用"
                        >
                          <Bot size={10} className="text-[#7c3aed]" />
                          <span>会话</span>
                        </button>
                      )}

                      {/* 查看节点日志 */}
                      <button
                        onClick={() => {
                          if (process.env.NODE_ENV !== 'production') {
                            console.log('[NodeExecutionTimeline] openNodeLogs:', task.id, item.id);
                          }
                          onOpenTaskLogs(task.id, item.id);
                        }}
                        className="h-[21px] px-1.5 rounded-[4px] bg-white hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[10px] font-medium flex items-center gap-1 transition-colors shadow-none"
                        title="打开终端并仅过滤此节点的日志流"
                      >
                        <Terminal size={10} className="text-[#818cf8]" />
                        <span>日志</span>
                      </button>

                      {/* 产物胶囊按钮 */}
                      {hasArtifacts && (
                        <button
                          onClick={() => {
                            if (item.run?.artifacts?.[0] && onPreviewArtifact) {
                              onPreviewArtifact(item.run.artifacts[0]);
                            }
                          }}
                          className="h-[21px] px-1.5 rounded-[4px] bg-[#eff6ff] hover:bg-[#dbeafe] text-[#1d4ed8] border border-[#bfdbfe] text-[10px] font-medium flex items-center gap-1 transition-colors"
                          title="查看该节点生成的产物"
                        >
                          <FileImage size={10} />
                          <span>产物 ({item.run!.artifacts!.length})</span>
                        </button>
                      )}

                      {/* 展开收起图标 */}
                      <button
                        onClick={() => toggleExpand(item.id)}
                        className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] transition-colors"
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
                {isExpanded && (
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
                          {onSkipNode && (
                            <button
                              disabled={isSkipping}
                              onClick={() => onSkipNode(task.id, item.id)}
                              className="h-[20px] px-2 rounded-[4px] bg-white text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] hover:bg-[#f1f1f4] text-[10px] font-medium flex items-center gap-1 shadow-sm transition-all disabled:opacity-50"
                              title="跳过此节点继续后续流程"
                            >
                              <SkipForward size={10} />
                              <span>{isSkipping ? '跳过中...' : '跳过此步'}</span>
                            </button>
                          )}
                          {onRetryNode && (
                            <button
                              disabled={isRetryingNode}
                              onClick={() => onRetryNode(task.id, item.id)}
                              className="h-[20px] px-2 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10px] font-medium flex items-center gap-1 shadow-sm transition-all active:scale-95 disabled:opacity-50"
                              title="仅重新执行此节点"
                            >
                              <RotateCcw size={10} />
                              <span>{isRetryingNode ? '重试中...' : '仅重试此步'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 配置与指令信息 */}
                    {item.wfNode?.config?.command && (
                      <div>
                        <div className="text-[10px] text-[#85858d] mb-1 font-medium flex items-center justify-between">
                          <span>执行 Shell 指令:</span>
                          <button
                            onClick={() =>
                              copyText(`cmd-${item.id}`, item.wfNode!.config.command || '')
                            }
                            className="text-[#85858d] hover:text-[#1c1c21] flex items-center gap-0.5"
                          >
                            {copiedKey === `cmd-${item.id}` ? (
                              <Check size={10} className="text-[#189a58]" />
                            ) : (
                              <Copy size={10} />
                            )}
                            <span>{copiedKey === `cmd-${item.id}` ? '已复制' : '复制命令'}</span>
                          </button>
                        </div>
                        <div className="font-mono text-[10px] text-[#1c1c21] bg-[#f8f8fa] p-2 rounded-[5px] border border-[#ececf0] whitespace-pre-wrap break-all select-all">
                          {item.wfNode.config.command}
                        </div>
                      </div>
                    )}

                    {/* Agent Prompt 提示词 */}
                    {item.wfNode?.config?.prompt && (
                      <div>
                        <div className="text-[10px] text-[#85858d] mb-1 font-medium">
                          Agent 提示词 / 意图指令:
                        </div>
                        <div className="text-[11px] text-[#4b4b53] bg-[#f8f8fa] p-2 rounded-[5px] border border-[#ececf0] whitespace-pre-wrap leading-relaxed">
                          {item.wfNode.config.prompt}
                        </div>
                      </div>
                    )}

                    {/* QA Checklist 核验清单 */}
                    {item.wfNode?.config?.checklist && item.wfNode.config.checklist.length > 0 && (
                      <div>
                        <div className="text-[10px] text-[#85858d] mb-1 font-medium">
                          QA 验收检查项 Checklist:
                        </div>
                        <div className="space-y-1 bg-[#fbfbfd] p-2 rounded-[5px] border border-[#ececf0]">
                          {item.wfNode.config.checklist.map((chk, cIdx) => (
                            <div key={cIdx} className="flex items-start gap-1.5 text-[11px] text-[#4b4b53]">
                              <CheckSquare size={12} className="text-[#189a58] shrink-0 mt-0.5" />
                              <span>{chk}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 节点生成产物预览 */}
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

                    {/* 当前待人工审批节点内嵌操作条 */}
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
                            <span>确认通过 (放行下游)</span>
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
