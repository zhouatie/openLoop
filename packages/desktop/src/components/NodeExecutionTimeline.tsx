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
  Play,
  RotateCcw,
  CheckSquare,
  SlidersHorizontal,
  Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  onCustomRetry?: (taskId: string, payload: { selectedNodeIds: string[]; fromNodeId?: string }) => void;
  isCustomRetrying?: boolean;
  /** 任务级节点覆盖：仅当前任务生效，不写回流水线模板 */
  onNodeOverride?: (
    taskId: string,
    payload: {
      nodeId: string;
      params?: Record<string, string> | null;
      config?: Record<string, any> | null;
      reset?: boolean;
    }
  ) => Promise<unknown> | void;
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

// 节点类型标识：中性灰文字 + 语义微图标着色，替代高饱和彩色胶囊
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
  onCustomRetry,
  isCustomRetrying = false,
  onNodeOverride,
}) => {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 节点参数微调编辑器状态（单开，保证内存占用与视觉噪音最小）
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftParams, setDraftParams] = useState<Record<string, string>>({});
  const [draftContent, setDraftContent] = useState<string>('');
  const [contentField, setContentField] = useState<'command' | 'prompt'>('command');
  const [showContentEditor, setShowContentEditor] = useState<boolean>(false);
  const [overrideSaveState, setOverrideSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const overrideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOverrideRef = useRef<{
    nodeId: string;
    params?: Record<string, string>;
    config?: Record<string, any>;
    reset?: boolean;
  } | null>(null);
  const savedTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 定制重试模式与勾选节点集合
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());

  const handleEnterCustomMode = () => {
    setIsCustomMode(true);
    const nextSet = new Set<string>();
    timelineItems.forEach((it) => nextSet.add(it.id));
    setSelectedNodes(nextSet);
  };

  const handleToggleNodeSelection = (nodeId: string) => {
    setSelectedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleRunFromHere = (targetIdx: number) => {
    const next = new Set<string>();
    for (let i = 0; i < timelineItems.length; i++) {
      if (i >= targetIdx) {
        next.add(timelineItems[i].id);
      }
    }
    setSelectedNodes(next);
  };

  // 直接从指定节点起跑：保留前序成功成果，只重跑本节点及其后续全部节点
  const handleRerunFromNode = (targetIdx: number) => {
    if (!onCustomRetry || isCustomRetrying) return;
    const ids: string[] = [];
    for (let i = targetIdx; i < timelineItems.length; i++) {
      ids.push(timelineItems[i].id);
    }
    if (ids.length === 0) return;
    if (import.meta.env?.DEV) {
      console.log(`[NodeExecutionTimeline] 从节点 [${ids[0]}] 起重跑, 共 ${ids.length} 个节点`, ids);
    }
    onCustomRetry(task.id, { selectedNodeIds: ids, fromNodeId: ids[0] });
  };

  const handleSelectAll = () => {
    const next = new Set<string>();
    timelineItems.forEach((it) => next.add(it.id));
    setSelectedNodes(next);
  };

  const handleSelectNone = () => {
    setSelectedNodes(new Set());
  };

  const handleExecuteCustomRetry = () => {
    if (!onCustomRetry) return;
    const selectedList = Array.from(selectedNodes);
    if (selectedList.length === 0) return;
    // 以时间线中最早被勾选的节点作为起点，未勾选的前序节点保留既有成果
    const firstSelected = timelineItems.find((it) => selectedNodes.has(it.id));
    onCustomRetry(task.id, {
      selectedNodeIds: selectedList,
      fromNodeId: firstSelected?.id,
    });
    setIsCustomMode(false);
  };

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

      const baseMeta = resolveNodeMeta(nid, workflow, allWorkflows);
      // 流水线步骤自报名字与类型，直接用步骤记录里的元信息覆盖推断结果
      const stepOutput = run?.output && typeof run.output === 'object' ? (run.output as any) : null;
      const meta = stepOutput?.stepName
        ? { ...baseMeta, name: stepOutput.stepName, type: (stepOutput.stepType as any) || baseMeta.type }
        : baseMeta;
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

  // ===== 任务级节点覆盖：失焦或停输 600ms 自动落盘，无需保存按钮 =====
  const flushOverride = useCallback(() => {
    if (overrideTimerRef.current) {
      clearTimeout(overrideTimerRef.current);
      overrideTimerRef.current = null;
    }
    const pending = pendingOverrideRef.current;
    pendingOverrideRef.current = null;
    if (!pending || !onNodeOverride) return;
    if (import.meta.env?.DEV) {
      console.log('[NodeExecutionTimeline] 落盘任务级节点覆盖:', pending);
    }
    setOverrideSaveState('saving');
    Promise.resolve(onNodeOverride(task.id, pending))
      .then(() => {
        setOverrideSaveState('saved');
        if (savedTipTimerRef.current) clearTimeout(savedTipTimerRef.current);
        savedTipTimerRef.current = setTimeout(() => setOverrideSaveState('idle'), 1600);
      })
      .catch(() => setOverrideSaveState('idle'));
  }, [onNodeOverride, task.id]);

  const queueOverride = useCallback(
    (payload: { nodeId: string; params?: Record<string, string>; config?: Record<string, any> }) => {
      pendingOverrideRef.current = payload;
      if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current);
      overrideTimerRef.current = setTimeout(() => flushOverride(), 600);
    },
    [flushOverride]
  );

  // 卸载时只清理定时器，不向已卸载组件回写状态
  useEffect(
    () => () => {
      if (overrideTimerRef.current) clearTimeout(overrideTimerRef.current);
      if (savedTipTimerRef.current) clearTimeout(savedTipTimerRef.current);
    },
    []
  );

  // 参数的模板原值：上游微调值 > 任务上下文 > 流水线变量，用于展示当前生效值与还原
  const resolveTemplateParamValue = (key: string): string => {
    if (task.context?.nodeOverrides && typeof task.context.nodeOverrides === 'object') {
      for (const ov of Object.values(task.context.nodeOverrides) as any[]) {
        if (ov?.params?.[key] !== undefined && ov?.params?.[key] !== '') {
          return String(ov.params[key]);
        }
      }
    }
    const raw = task.context?.[key] ?? workflow?.variables?.[key] ?? '';
    return raw === undefined || raw === null ? '' : String(raw);
  };

  const openParamEditor = (item: TimelineItem) => {
    if (editingNodeId === item.id) {
      flushOverride();
      setEditingNodeId(null);
      return;
    }
    flushOverride();
    const cfg: any = item.wfNode?.config || {};
    const override: any = task.context?.nodeOverrides?.[item.id] || {};
    const decls: any[] = Array.isArray(cfg.editableParams) ? cfg.editableParams : [];
    const nextParams: Record<string, string> = {};
    decls.forEach((d) => {
      if (!d?.key) return;
      nextParams[d.key] = override?.params?.[d.key] ?? resolveTemplateParamValue(d.key);
    });
    const field: 'command' | 'prompt' = cfg.command ? 'command' : 'prompt';
    setDraftParams(nextParams);
    setContentField(field);
    setDraftContent(String(override?.config?.[field] ?? cfg[field] ?? ''));
    setShowContentEditor(false);
    setEditingNodeId(item.id);
    if (import.meta.env?.DEV) {
      console.log('[NodeExecutionTimeline] 打开节点参数微调:', item.id, nextParams);
    }
  };

  const handleParamInput = (nodeId: string, key: string, value: string) => {
    const nextParams = { ...draftParams, [key]: value };
    setDraftParams(nextParams);
    queueOverride({ nodeId, params: nextParams });
  };

  const handleContentInput = (nodeId: string, value: string) => {
    setDraftContent(value);
    queueOverride({ nodeId, config: { [contentField]: value } });
  };

  const handleResetOverride = (item: TimelineItem) => {
    if (overrideTimerRef.current) {
      clearTimeout(overrideTimerRef.current);
      overrideTimerRef.current = null;
    }
    pendingOverrideRef.current = null;
    const cfg: any = item.wfNode?.config || {};
    const decls: any[] = Array.isArray(cfg.editableParams) ? cfg.editableParams : [];
    const nextParams: Record<string, string> = {};
    decls.forEach((d) => {
      if (d?.key) nextParams[d.key] = resolveTemplateParamValue(d.key);
    });
    setDraftParams(nextParams);
    setDraftContent(String(cfg[contentField] ?? ''));
    if (import.meta.env?.DEV) {
      console.log('[NodeExecutionTimeline] 还原节点模板:', item.id);
    }
    if (onNodeOverride) {
      Promise.resolve(onNodeOverride(task.id, { nodeId: item.id, reset: true })).catch(() => {});
    }
  };

  const renderTypeBadge = (item: TimelineItem) => {
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
          : '任务尚未关联工作流或未触发执行，暂无节点时序数据'}
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

        {/* 状态指示简报与定制重试入口 */}
        <div className="flex items-center gap-1.5">
          {onCustomRetry && !isCustomMode && (
            <button
              type="button"
              onClick={handleEnterCustomMode}
              className="h-[22px] px-2 rounded-[5px] bg-white hover:bg-[#fafafc] text-[#1c1c21] border border-[#e3e3e8] hover:border-[#b9b9c2] text-[10.5px] font-medium flex items-center gap-1 transition-all shadow-xs active:scale-95 cursor-pointer mr-1"
              title="自由勾选/取消流水线节点，支持按需跳过或从特定节点重跑"
            >
              <RotateCcw size={10} className="text-[#63636b]" />
              <span>定制重试</span>
            </button>
          )}

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

      {/* 定制重试悬浮控制抽屉条 */}
      {isCustomMode && (
        <div className="p-2.5 rounded-[8px] bg-[#1c1c21] text-white flex items-center justify-between text-[11px] shadow-sm animate-in fade-in slide-in-from-top-1 duration-150 select-none">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white/95 flex items-center gap-1.5">
              <CheckSquare size={12} className="text-[#818cf8]" />
              <span>定制重试流水线</span>
            </span>
            <span className="text-white/60 font-mono text-[10px]">
              (已选 {selectedNodes.size}/{timelineItems.length} 个节点执行)
            </span>
            <div className="h-3 w-[1px] bg-white/20 mx-0.5" />
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-[10px] text-white/70 hover:text-white underline cursor-pointer"
            >
              全选
            </button>
            <button
              type="button"
              onClick={handleSelectNone}
              className="text-[10px] text-white/70 hover:text-white underline cursor-pointer"
            >
              清空
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsCustomMode(false)}
              className="h-[24px] px-2 rounded-[5px] bg-white/10 hover:bg-white/20 text-white/90 text-[10.5px] font-medium transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={selectedNodes.size === 0 || isCustomRetrying}
              onClick={handleExecuteCustomRetry}
              className="h-[24px] px-2.5 rounded-[5px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[10.5px] font-medium flex items-center gap-1 transition-all shadow-xs cursor-pointer disabled:opacity-50 active:scale-95"
            >
              {isCustomRetrying ? (
                <Loader2 size={11} className="animate-spin text-white" />
              ) : (
                <Play size={10} className="fill-current text-white" />
              )}
              <span>立即执行 ({selectedNodes.size} 步)</span>
            </button>
          </div>
        </div>
      )}

      {/* 垂直时间线卡片流 */}
      <div className="relative pl-6 space-y-3 before:absolute before:top-2 before:bottom-3 before:left-[9px] before:w-[2px] before:bg-[#ececf0]">
        {timelineItems.map((item, index) => {
          const isExpanded = !!expandedNodes[item.id];
          const hasArtifacts = item.run?.artifacts && item.run.artifacts.length > 0;
          const hasError = !!item.run?.error;
          const nodeOverride: any = task.context?.nodeOverrides?.[item.id];
          const hasOverride = !!nodeOverride;
          const editableParams: any[] = Array.isArray(item.wfNode?.config?.editableParams)
            ? item.wfNode!.config.editableParams!
            : [];
          const isEditingParams = editingNodeId === item.id;
          const isCurrentApprovalNode =
            item.status === 'waiting_approval' && task.status === 'waiting_approval';
          // 人工卡点清单：流水线写在步骤输出的 checklist，节点配置写在 wfNode.config
          const renderChecklist = (): any[] | null => {
            const fromNode = item.wfNode?.config?.checklist;
            if (Array.isArray(fromNode) && fromNode.length > 0) return fromNode;
            const fromStep = (item.run?.output as any)?.checklist;
            return Array.isArray(fromStep) && fromStep.length > 0 ? fromStep : null;
          };

          return (
            <div key={item.id} className="relative group">
              {/* 时间线轴节点指示器 */}
              <div className="absolute -left-6 top-2.5 z-10">
                {renderTimelineIcon(item.status, item.order)}
              </div>

              {/* 卡片主体 */}
              <div
                className={`rounded-[8px] border transition-all ${
                  isCustomMode && !selectedNodes.has(item.id)
                    ? 'opacity-65 border-dashed border-[#d4d4d8] bg-[#fbfbfd]'
                    : isEditingParams
                    ? 'border-[#d8d6fb] bg-white shadow-[0_2px_8px_rgba(79,70,229,0.08)]'
                    : item.status === 'running'
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
                      {isCustomMode && (
                        <input
                          type="checkbox"
                          checked={selectedNodes.has(item.id)}
                          onChange={() => handleToggleNodeSelection(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-3.5 h-3.5 rounded border-[#d4d4d8] text-[#4f46e5] focus:ring-0 cursor-pointer shrink-0"
                          title={selectedNodes.has(item.id) ? '已勾选：执行此节点' : '未勾选：跳过此节点'}
                        />
                      )}
                      <span className="text-[10px] font-mono text-[#85858d] shrink-0 font-medium">
                        #{String(item.order).padStart(2, '0')}
                      </span>
                      {/* 中文名称醒目突出 */}
                      <span className="text-[12.5px] font-semibold text-[#1c1c21] truncate">
                        {item.name}
                      </span>
                      {renderTypeBadge(item)}
                      {hasOverride && (
                        <span
                          className="inline-flex items-center gap-1 text-[9.5px] font-medium text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-1 py-[0.5px] rounded-[3px] shrink-0"
                          title={`本任务已覆盖该节点 ${Object.keys(nodeOverride.params || {}).length} 个参数 / ${Object.keys(nodeOverride.config || {}).length} 项配置，流水线模板未改动`}
                        >
                          <span className="w-1 h-1 rounded-full bg-[#4f46e5]" />
                          <span>本任务覆盖</span>
                        </span>
                      )}
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

                    {/* 操作区：默认只留展开箭头，次级动作在悬浮/聚焦时以微图标淡入，避免按钮堆满卡片 */}
                    <div
                      className="flex items-center gap-0.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 定制重试模式下的专属微动作（常驻） */}
                      {isCustomMode && (
                        <div className="flex items-center gap-1">
                          {!selectedNodes.has(item.id) && (
                            <span className="text-[9.5px] font-mono text-[#a1a1aa] bg-[#f4f4f6] px-1 py-[0.5px] rounded border border-[#e4e4e7]">
                              将跳过
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRunFromHere(index)}
                            className="h-[21px] px-1.5 rounded-[4px] bg-[#eff6ff] hover:bg-[#dbeafe] text-[#2563eb] border border-[#bfdbfe] text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer"
                            title="以此节点为起点，向下执行后续所有节点，跳过前序步骤"
                          >
                            <Play size={8} className="fill-current" />
                            <span>从此执行</span>
                          </button>
                        </div>
                      )}

                      {/* 次级动作：悬浮卡片或键盘聚焦时浮现，非悬浮态只留展开箭头 */}
                      {!isCustomMode && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                          {/* 仅重试此节点（失败节点优先，语义红） */}
                          {item.status === 'failed' && onRetryNode && (
                            <button
                              type="button"
                              disabled={isRetryingNode}
                              onClick={() => onRetryNode(task.id, item.id)}
                              className={`${MICRO_BTN} text-[#d64545] hover:bg-[#fbe9e9]`}
                              title="仅重试此节点"
                            >
                              <RotateCcw size={11} className={isRetryingNode ? 'animate-spin' : ''} />
                            </button>
                          )}

                          {/* 以本节点为起点重跑后续流程（之前成功的节点保留成果） */}
                          {item.status !== 'running' && onCustomRetry && (
                            <button
                              type="button"
                              disabled={isCustomRetrying || metrics.running > 0}
                              onClick={() => handleRerunFromNode(index)}
                              className={`${MICRO_BTN} text-[#85858d] hover:text-[#4f46e5] hover:bg-[#eeedfd]`}
                              title="从此重跑：本节点及其后续节点全部重跑"
                            >
                              <Play size={10} className="fill-current" />
                            </button>
                          )}

                          {/* 查看 Agent 交互会话 */}
                          {item.type === 'agent' && onOpenAgentSession && (
                            <button
                              type="button"
                              onClick={() => onOpenAgentSession(task.id, item.id, item.name)}
                              className={`${MICRO_BTN} text-[#85858d] hover:text-[#7c3aed] hover:bg-[#eeedfd]`}
                              title="查看该 Agent 节点的交互会话"
                            >
                              <Bot size={11} />
                            </button>
                          )}

                          {/* 任务级节点参数微调：仅本任务生效 */}
                          {onNodeOverride && (
                            <button
                              type="button"
                              onClick={() => openParamEditor(item)}
                              className={`${MICRO_BTN} ${
                                hasOverride || isEditingParams
                                  ? 'text-[#4f46e5] bg-[#eeedfd]'
                                  : 'text-[#85858d] hover:text-[#4f46e5] hover:bg-[#eeedfd]'
                              }`}
                              title="微调该节点参数（仅本任务生效，流水线模板不变）"
                            >
                              <SlidersHorizontal size={11} />
                            </button>
                          )}

                          {/* 查看节点日志 */}
                          <button
                            type="button"
                            onClick={() => {
                              if (process.env.NODE_ENV !== 'production') {
                                console.log('[NodeExecutionTimeline] openNodeLogs:', task.id, item.id);
                              }
                              onOpenTaskLogs(task.id, item.id);
                            }}
                            className={`${MICRO_BTN} text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0]`}
                            title="查看该节点日志（终端已按节点过滤）"
                          >
                            <Terminal size={11} />
                          </button>

                          {/* 查看节点产物 */}
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

                          {/* 跳过失败节点 */}
                          {item.status === 'failed' && onSkipNode && (
                            <button
                              type="button"
                              disabled={isSkipping}
                              onClick={() => onSkipNode(task.id, item.id)}
                              className={`${MICRO_BTN} text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0]`}
                              title="跳过此节点，继续后续流程"
                            >
                              <SkipForward size={11} />
                            </button>
                          )}
                        </div>
                      )}

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

                {/* 节点参数微调编辑器：内联展开，不影响抽屉高度基准 */}
                {isEditingParams && onNodeOverride && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        flushOverride();
                        setEditingNodeId(null);
                      }
                    }}
                    className="border-t border-[#ececf0] bg-white p-2.5 rounded-b-[8px] space-y-2 animate-in fade-in-50 duration-150 select-none"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <SlidersHorizontal size={11} className="text-[#4f46e5] shrink-0" />
                        <span className="text-[10.5px] font-medium text-[#1c1c21] shrink-0">节点参数微调</span>
                        <span className="text-[10px] text-[#85858d] truncate">仅本任务生效，模板不变</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {overrideSaveState === 'saving' && (
                          <span className="text-[10px] text-[#85858d] flex items-center gap-1">
                            <Loader2 size={9} className="animate-spin" />
                            <span>保存中</span>
                          </span>
                        )}
                        {overrideSaveState === 'saved' && (
                          <span className="text-[10px] text-[#059669] flex items-center gap-1">
                            <Check size={9} />
                            <span>已保存</span>
                          </span>
                        )}
                        {hasOverride && (
                          <button
                            type="button"
                            onClick={() => handleResetOverride(item)}
                            className="text-[10px] text-[#85858d] hover:text-[#1c1c21] flex items-center gap-1 cursor-pointer transition-colors"
                            title="清除本任务覆盖，回落到流水线模板原值"
                          >
                            <Undo2 size={10} />
                            <span>还原模板</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            flushOverride();
                            setEditingNodeId(null);
                          }}
                          className="h-[21px] px-2 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#f1f1f4] text-[10.5px] font-medium cursor-pointer transition-colors"
                        >
                          完成
                        </button>
                      </div>
                    </div>

                    {/* 节点声明的可调参数：自动渲染为一行一参 */}
                    {editableParams.map((p) => (
                      <div key={p.key} className="flex items-center gap-2">
                        <label
                          className="w-[76px] shrink-0 text-[10.5px] text-[#63636b] truncate"
                          title={`{{${p.key}}}${p.hint ? ` · ${p.hint}` : ''}`}
                        >
                          {p.label || p.key}
                        </label>
                        <input
                          type="text"
                          value={draftParams[p.key] ?? ''}
                          placeholder={p.placeholder || `{{${p.key}}}`}
                          spellCheck={false}
                          onChange={(e) => handleParamInput(item.id, p.key, e.target.value)}
                          onBlur={() => flushOverride()}
                          className="flex-1 min-w-0 h-[26px] px-2 rounded-[5px] border border-[#e3e3e8] hover:border-[#d4d4d8] focus:border-[#a5a5b0] bg-white font-mono text-[10.5px] text-[#1c1c21] outline-none transition-colors"
                        />
                      </div>
                    ))}

                    {editableParams.length === 0 && !showContentEditor && (
                      <div className="text-[10.5px] text-[#85858d] leading-relaxed">
                        该节点未声明可调参数。可展开「调整执行指令」临时改写整段命令或 Prompt。
                      </div>
                    )}

                    {/* 高级入口：直接改写节点命令 / Prompt */}
                    <button
                      type="button"
                      onClick={() => setShowContentEditor((v) => !v)}
                      className="text-[10.5px] text-[#63636b] hover:text-[#4f46e5] flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <ChevronDown
                        size={11}
                        className={`transform transition-transform duration-200 ${
                          showContentEditor ? 'rotate-180' : ''
                        }`}
                      />
                      <span>{showContentEditor ? '收起执行指令' : '调整执行指令 (高级)'}</span>
                    </button>

                    {showContentEditor && (
                      <textarea
                        value={draftContent}
                        spellCheck={false}
                        onChange={(e) => handleContentInput(item.id, e.target.value)}
                        onBlur={() => flushOverride()}
                        className="w-full min-h-[88px] max-h-[320px] p-2 rounded-[5px] border border-[#e3e3e8] hover:border-[#d4d4d8] focus:border-[#a5a5b0] bg-[#fafafc] font-mono text-[10px] leading-[1.55] text-[#1c1c21] outline-none resize-y transition-colors"
                        placeholder="留空则回落到模板原命令"
                      />
                    )}
                  </div>
                )}

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

                    {/* 配置与指令信息（优先展示本任务生效的覆盖值） */}
                    {item.wfNode?.config?.command && (
                      <div>
                        <div className="text-[10px] text-[#85858d] mb-1 font-medium flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <span>{nodeOverride?.config?.command ? '执行 Shell 指令 (本任务覆盖):' : '执行 Shell 指令:'}</span>
                            {nodeOverride?.config?.command && (
                              <span className="text-[9px] text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-1 rounded-[3px]">
                                已覆盖
                              </span>
                            )}
                          </span>
                          <button
                            onClick={() =>
                              copyText(
                                `cmd-${item.id}`,
                                String(nodeOverride?.config?.command ?? item.wfNode!.config.command ?? '')
                              )
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
                          {nodeOverride?.config?.command ?? item.wfNode.config.command}
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
