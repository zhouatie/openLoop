import React, { memo, useState, useEffect, useMemo } from 'react';
import {
  Check,
  Copy,
  Terminal,
  Sparkles,
  Trash2,
  Play,
  RotateCcw,
  ArrowRight,
  Edit3,
  AlertCircle,
  SkipForward,
  Square,
  Lightbulb,
  FolderGit2,
  Image as ImageIcon,
  Bot,
  FileImage,
  Cpu,
  ClipboardCheck,
  Layers,
  Loader2,
  Globe,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Clock,
  CheckCircle2,
  MessageSquare,
  Eye,
  XCircle,
  GitMerge,
  Unlink,
} from 'lucide-react';
import { Task, KanbanColumn, WorkflowDefinition } from '@openloop/core';
import { api } from '../services/api';
import { openInDefaultBrowser } from '../utils/openExternalBrowser';
import { resolveNodeMeta } from '../utils/nodeMeta';
import { formatShortTaskId, copyToClipboard } from '../utils/taskId';

interface RunningNodeVisual {
  label: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  pingColor: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
}

const getRunningNodeVisual = (type?: string): RunningNodeVisual => {
  switch (type) {
    case 'agent':
      return {
        label: 'Agent 编码',
        badgeBg: 'bg-[#f5f3ff]',
        badgeText: 'text-[#6d28d9]',
        badgeBorder: 'border-[#ddd6fe]',
        pingColor: 'bg-[#7c3aed]',
        icon: Bot,
      };
    case 'midscene':
      return {
        label: 'UI 自动化',
        badgeBg: 'bg-[#eff6ff]',
        badgeText: 'text-[#1d4ed8]',
        badgeBorder: 'border-[#bfdbfe]',
        pingColor: 'bg-[#2563eb]',
        icon: Sparkles,
      };
    case 'cli':
      return {
        label: 'CLI 脚本',
        badgeBg: 'bg-[#f4f4f6]',
        badgeText: 'text-[#4b4b53]',
        badgeBorder: 'border-[#e3e3e8]',
        pingColor: 'bg-[#63636b]',
        icon: Terminal,
      };
    case 'stitch-image':
      return {
        label: '产物合成',
        badgeBg: 'bg-[#fdf2f8]',
        badgeText: 'text-[#be185d]',
        badgeBorder: 'border-[#fbcfe8]',
        pingColor: 'bg-[#db2777]',
        icon: FileImage,
      };
    case 'hook':
      return {
        label: '事件触发',
        badgeBg: 'bg-[#fefce8]',
        badgeText: 'text-[#a16207]',
        badgeBorder: 'border-[#fef08a]',
        pingColor: 'bg-[#ca8a04]',
        icon: Cpu,
      };
    case 'qa-approval':
      return {
        label: '人工审批',
        badgeBg: 'bg-[#fff7ed]',
        badgeText: 'text-[#c2410c]',
        badgeBorder: 'border-[#ffedd5]',
        pingColor: 'bg-[#ea580c]',
        icon: Check,
      };
    case 'env-prepare':
      return {
        label: '现场准备',
        badgeBg: 'bg-[#ecfdf5]',
        badgeText: 'text-[#047857]',
        badgeBorder: 'border-[#a7f3d0]',
        pingColor: 'bg-[#10b981]',
        icon: Cpu,
      };
    case 'qa-planner':
      return {
        label: 'QA 用例设计',
        badgeBg: 'bg-[#fdf4ff]',
        badgeText: 'text-[#a21caf]',
        badgeBorder: 'border-[#f5d0fe]',
        pingColor: 'bg-[#c026d3]',
        icon: ClipboardCheck,
      };
    case 'worktree-setup':
      return {
        label: '沙箱隔离',
        badgeBg: 'bg-[#f0fdf4]',
        badgeText: 'text-[#15803d]',
        badgeBorder: 'border-[#bbf7d0]',
        pingColor: 'bg-[#16a34a]',
        icon: Layers,
      };
    case 'worktree-merge':
      return {
        label: '分支合并',
        badgeBg: 'bg-[#faf5ff]',
        badgeText: 'text-[#7e22ce]',
        badgeBorder: 'border-[#e9d5ff]',
        pingColor: 'bg-[#9333ea]',
        icon: Layers,
      };
    case 'worktree-cleanup':
      return {
        label: '环境清理',
        badgeBg: 'bg-[#f8fafc]',
        badgeText: 'text-[#475569]',
        badgeBorder: 'border-[#cbd5e1]',
        pingColor: 'bg-[#64748b]',
        icon: Layers,
      };
    default:
      return {
        label: '自动化工序',
        badgeBg: 'bg-[#f4f4f7]',
        badgeText: 'text-[#4f46e5]',
        badgeBorder: 'border-[#d8d6fb]',
        pingColor: 'bg-[#4f46e5]',
        icon: Cpu,
      };
  }
};

export interface KanbanCardProps {
  task: Task;
  workflow?: WorkflowDefinition;
  workflows: WorkflowDefinition[];
  allTasks?: Task[];
  isSelected?: boolean;
  isCancelling?: boolean;
  isMoving?: boolean;
  isRunning?: boolean;
  isSkipping?: boolean;
  isApproving?: boolean;
  onSelect: (task: Task) => void;
  onCancel: (taskId: string) => void;
  onMoveColumn: (taskId: string, targetCol: KanbanColumn) => void;
  onEdit: (task: Task) => void;
  onOpenLogs: (taskId: string, nodeId?: string) => void;
  onDelete: (task: Task) => void;
  onRun: (taskId: string) => void;
  onSkipNode: (taskId: string, nodeId?: string) => void;
  onVisualAcceptance: (task: Task) => void;
  onApprove: (taskId: string, approved: boolean, feedback?: string) => void;
  onSetParent?: (task: Task) => void;
  onUnlinkSubtask?: (parentId: string, subtaskId: string) => void;
}

const KanbanCardComponent: React.FC<KanbanCardProps> = ({
  task,
  workflow,
  workflows,
  allTasks,
  isSelected,
  isCancelling,
  isMoving,
  isRunning,
  isSkipping,
  isApproving,
  onSelect,
  onCancel,
  onMoveColumn,
  onEdit,
  onOpenLogs,
  onDelete,
  onRun,
  onSkipNode,
  onVisualAcceptance,
  onApprove,
  onSetParent,
  onUnlinkSubtask,
}) => {
  const [sandboxStatus, setSandboxStatus] = useState<'checking' | 'running' | 'stopped' | 'starting'>('checking');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [idCopied, setIdCopied] = useState<boolean>(false);

  const shortTaskId = useMemo(() => formatShortTaskId(task.id), [task.id]);

  const handleCopyTaskId = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (import.meta.env?.DEV) {
      console.log('[KanbanCard] 点击复制任务完整 ID:', task.id);
    }
    const success = await copyToClipboard(task.id);
    if (success) {
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 1500);
    }
  };

  const isGroup = task.kind === 'group';
  const childSubtasks = useMemo(() => {
    if (!isGroup || !Array.isArray(task.subTaskIds) || !allTasks) return [];
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    return task.subTaskIds.map((id) => taskMap.get(id)).filter(Boolean) as Task[];
  }, [isGroup, task.subTaskIds, allTasks]);

  const groupCompletedCount = childSubtasks.filter((s) => s.status === 'completed').length;
  const groupTotalCount = childSubtasks.length || task.subTaskIds?.length || 0;
  const groupProgressPct = groupTotalCount > 0 ? Math.round((groupCompletedCount / groupTotalCount) * 100) : (task.status === 'completed' ? 100 : 0);

  const runningSub = useMemo(() => {
    return childSubtasks.find((s) => s.status === 'running');
  }, [childSubtasks]);
  const runningSubIndex = runningSub ? childSubtasks.findIndex((s) => s.id === runningSub.id) : -1;
  const runningSubWorkflowName = useMemo(() => {
    if (!runningSub) return '';
    return workflows.find((w) => w.id === runningSub.workflowId)?.name || runningSub.workflowId;
  }, [workflows, runningSub]);

  const waitingSub = useMemo(() => {
    return childSubtasks.find((s) => s.status === 'waiting_approval');
  }, [childSubtasks]);
  const waitingSubIndex = waitingSub ? childSubtasks.findIndex((s) => s.id === waitingSub.id) : -1;
  const waitingSubWorkflowName = useMemo(() => {
    if (!waitingSub) return '';
    return workflows.find((w) => w.id === waitingSub.workflowId)?.name || waitingSub.workflowId;
  }, [workflows, waitingSub]);

  // 当任务处于待人工门禁时，按需探活沙箱靶机状态
  useEffect(() => {
    let active = true;
    if (task.status === 'waiting_approval' && task.context?.worktree) {
      if (import.meta.env?.DEV) {
        console.log(`[KanbanCard:Sandbox] 探活任务 ${task.id} 靶机端口: ${task.context.worktree.webPort}`);
      }
      api.getTaskSandboxStatus(task.id)
        .then((res) => {
          if (active) {
            setSandboxStatus(res.status === 'running' ? 'running' : 'stopped');
          }
        })
        .catch(() => {
          if (active) setSandboxStatus('stopped');
        });
    }
    return () => {
      active = false;
    };
  }, [task.id, task.status, task.context?.worktree?.webPort]);

  const handleOpenOrStartSandbox = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const wt = task.context?.worktree;
    if (!wt) return;
    const targetUrl = wt.targetUrl || (wt.webPort ? `http://localhost:${wt.webPort}` : 'http://localhost');

    if (sandboxStatus === 'running') {
      if (import.meta.env?.DEV) console.log(`[KanbanCard:Sandbox] 打开靶机: ${targetUrl}`);
      openInDefaultBrowser(targetUrl);
      return;
    }

    // 离线态，触发一键唤醒
    try {
      setSandboxStatus('starting');
      if (import.meta.env?.DEV) console.log(`[KanbanCard:Sandbox] 触发一键唤醒任务 ${task.id} 靶机...`);
      const res = await api.startTaskSandbox(task.id);
      if (res.success || res.status === 'running') {
        setSandboxStatus('running');
        openInDefaultBrowser(res.targetUrl || targetUrl);
      } else {
        setSandboxStatus('stopped');
      }
    } catch (err) {
      if (import.meta.env?.DEV) console.error(`[KanbanCard:Sandbox] 唤醒靶机失败:`, err);
      setSandboxStatus('stopped');
    }
  };
  const currentNode = workflow?.nodes.find((n) => n.id === task.currentNodeId);
  const currentNodeMeta = task.currentNodeId
    ? resolveNodeMeta(task.currentNodeId, workflow, workflows)
    : null;
  const nodeRuns = Object.values(task.nodeRuns || {});
  const isCompleted = task.status === 'completed';
  const completedCount = nodeRuns.filter((r) => r.status === 'success' || r.status === 'skipped').length;
  const totalNodes = workflow?.nodes.length || completedCount || 1;
  const displayTotal = Math.max(totalNodes, completedCount);
  const displayCompleted = isCompleted ? displayTotal : completedCount;
  const progressPct = isCompleted ? 100 : Math.round((displayCompleted / displayTotal) * 100);
  const lastFailedRun = nodeRuns.slice().reverse().find((r) => r.status === 'failed');
  const failReason = lastFailedRun?.error || '执行中断或驳回';

  return (
    <div
      onClick={() => onSelect(task)}
      className={`group bg-white border rounded-[8px] p-3 transition-all cursor-pointer ${
        isSelected
          ? 'ring-2 ring-[#4f46e5] border-transparent shadow-[0_2px_10px_rgba(79,70,229,0.15)]'
          : task.status === 'waiting_approval'
          ? 'border-[#1c1c21]/30 shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
          : task.status === 'failed'
          ? 'border-[#d64545]/30 shadow-[0_1px_2px_rgba(214,69,69,0.06)]'
          : 'border-[#e3e3e8] hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={handleCopyTaskId}
            className={`group/id inline-flex items-center gap-1 text-[10.5px] font-mono px-1.5 py-[1px] rounded border transition-all cursor-pointer shrink-0 select-none active:scale-95 ${
              idCopied
                ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/80'
                : 'bg-[#f4f4f6] hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] border-[#ececf0] hover:border-[#d4d4d8]'
            }`}
            title={`任务编号: ${shortTaskId}\n完整 ID: ${task.id} (点击复制)`}
          >
            {idCopied ? (
              <>
                <Check size={9.5} className="text-[#059669]" />
                <span className="text-[#059669] text-[9.5px] font-sans font-medium">已复制</span>
              </>
            ) : (
              <>
                <span>{shortTaskId}</span>
                <Copy size={8.5} className="text-[#a1a1aa] group-hover/id:text-[#71717a] opacity-0 group-hover/id:opacity-100 transition-opacity" />
              </>
            )}
          </button>
          {isGroup && (
            <span className="flex items-center gap-1 text-[9.5px] font-medium text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-1.5 py-[0.5px] rounded shrink-0">
              <Layers size={9.5} />
              <span>
                任务组 · {task.executionMode === 'parallel' ? '并行' : task.executionMode === 'dag' ? '拓扑' : '串行'}
              </span>
            </span>
          )}
          {task.kanbanColumn === 'inbox' && (
            <span className="flex items-center gap-1 text-[9.5px] font-medium text-[#6366f1] bg-[#f5f5ff] border border-[#d8d6fb] px-1.5 py-[0.5px] rounded shrink-0">
              <Lightbulb size={9.5} />
              <span>想法</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
          {task.status === 'running' && (
            <button
              disabled={isCancelling}
              onClick={(e) => {
                e.stopPropagation();
                if (import.meta.env?.DEV) {
                  console.log('[KanbanCard] 点击终止任务:', task.id);
                }
                onCancel(task.id);
              }}
              className="p-1 rounded text-[#85858d] hover:text-[#d64545] hover:bg-[#fbe9e9]"
              title="终止此任务"
            >
              <Square size={11} className="fill-current" />
            </button>
          )}
          {task.status === 'pending' && task.kanbanColumn === 'inbox' && (
            <button
              disabled={isMoving}
              onClick={(e) => {
                e.stopPropagation();
                if (import.meta.env?.DEV) {
                  console.log('[KanbanCard] 移动任务到 backlog:', task.id);
                }
                onMoveColumn(task.id, 'backlog');
              }}
              className="p-1 rounded text-[#85858d] hover:text-[#4f46e5] hover:bg-[#eeedfd]"
              title="移入待处理泳道"
            >
              <ArrowRight size={11} />
            </button>
          )}
          {task.status === 'pending' && task.kanbanColumn === 'backlog' && (
            <button
              disabled={isMoving}
              onClick={(e) => {
                e.stopPropagation();
                if (import.meta.env?.DEV) {
                  console.log('[KanbanCard] 移动任务到 inbox:', task.id);
                }
                onMoveColumn(task.id, 'inbox');
              }}
              className="p-1 rounded text-[#85858d] hover:text-[#6366f1] hover:bg-[#eeedfd]"
              title="移入 Inbox 想法收集"
            >
              <ArrowRight size={11} className="rotate-180" />
            </button>
          )}
          {onSetParent && task.status !== 'running' && !(isGroup && childSubtasks.length > 0) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSetParent(task);
              }}
              className="p-1 rounded text-[#85858d] hover:text-[#4f46e5] hover:bg-[#eeedfd]"
              title={task.parentTaskId ? '变更所属需求 / 解绑...' : '设为子工序...'}
            >
              <GitMerge size={11} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(task);
            }}
            className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4]"
            title={isGroup ? '编辑任务组' : '编辑任务'}
          >
            <Edit3 size={11} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenLogs(task.id);
            }}
            className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4]"
            title="查看实时终端"
          >
            <Terminal size={11} strokeWidth={1.8} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task);
            }}
            className="p-1 rounded text-[#85858d] hover:text-[#e5484d] hover:bg-[#fbe9e9]"
            title="删除此任务"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      <h4 className="text-[12.5px] font-medium text-[#1c1c21] leading-snug line-clamp-2 mb-1">
        {task.title}
      </h4>

      <div className="flex items-center gap-1.5 text-[11px] text-[#85858d] mb-2 min-w-0">
        <span className="truncate">{workflow?.name || task.workflowId}</span>
        {task.workspace && (
          <>
            <span className="shrink-0 text-[#c2c2c9]">·</span>
            <span
              className="flex items-center gap-1 text-[10px] font-mono text-[#63636b] bg-[#f4f4f7] px-1.5 py-[0.5px] rounded border border-[#ececf0] truncate max-w-[120px] shrink-0 hover:text-[#4f46e5] hover:border-[#d8d6fb] transition-colors"
              title={`工程工作区: ${task.workspace} (点击在访达中打开)`}
              onClick={(e) => {
                e.stopPropagation();
                api.openPath(task.workspace!);
              }}
            >
              <FolderGit2 size={10} className="shrink-0 text-[#85858d]" />
              <span className="truncate">
                {task.workspace.replace(/[/\\]+$/, '').split(/[/\\]/).pop()}
              </span>
            </span>
          </>
        )}
      </div>

      {/* 任务组：正在执行中的子工序呼吸态通知 */}
      {isGroup && runningSub && (
        <div className="flex items-center gap-1.5 py-1 px-2 rounded-[5px] bg-[#eff6ff] border border-[#bfdbfe]/60 text-[#1d4ed8] text-[10.5px] font-medium my-1.5 animate-fadeIn">
          <Loader2 size={10.5} className="animate-spin text-[#2563eb] shrink-0" />
          <span className="shrink-0 font-mono text-[#2563eb]">#{runningSubIndex + 1}</span>
          <span className="truncate flex-1 font-normal text-[#1e40af]">{runningSub.title}</span>
          <span
            className="shrink min-w-0 max-w-[45%] truncate font-mono text-[9px] bg-[#dbeafe] text-[#1e40af] px-1 py-[0.5px] rounded border border-[#bfdbfe]"
            title={runningSubWorkflowName}
          >
            {runningSubWorkflowName}
          </span>
        </div>
      )}

      {/* 任务组：存在待人工验收的子工序通知 */}
      {isGroup && !runningSub && waitingSub && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onSelect(waitingSub);
          }}
          className="flex items-center gap-1.5 py-1 px-2 rounded-[5px] bg-[#fffbeb] border border-[#fde68a] text-[#b45309] text-[10.5px] font-medium my-1.5 animate-fadeIn cursor-pointer hover:bg-[#fef3c7] transition-colors"
          title="点击查看并验收此子工序"
        >
          <Clock size={10.5} className="animate-pulse text-[#b45309] shrink-0" />
          <span className="shrink-0 font-mono text-[#b45309]">#{waitingSubIndex + 1}</span>
          <span className="truncate flex-1 font-normal text-[#92400e]">{waitingSub.title}</span>
          <span
            className="shrink min-w-0 max-w-[45%] truncate font-mono text-[9px] bg-[#fef3c7] text-[#b45309] px-1 py-[0.5px] rounded border border-[#fde68a]"
            title={waitingSubWorkflowName}
          >
            待验收
          </span>
        </div>
      )}

      {/* 任务组子工序卡片式折叠列表 */}
      {isGroup && childSubtasks.length > 0 && (
        <div className="my-2 border border-[#ececf0] rounded-[6px] bg-[#fafafc] overflow-hidden">
          <div
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="px-2 py-1.5 flex items-center justify-between text-[11px] text-[#63636b] hover:text-[#1c1c21] cursor-pointer bg-white transition-colors select-none"
          >
            <div className="flex items-center gap-1.5">
              <ChevronRight
                size={11.5}
                className={`transition-transform duration-150 text-[#85858d] ${isExpanded ? 'rotate-90' : ''}`}
              />
              <span className="font-medium text-[11px] text-[#1c1c21]">
                子工序进度 ({groupCompletedCount}/{groupTotalCount})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-[#4f46e5] font-medium">
                {groupProgressPct}%
              </span>
              <span className="text-[10px] text-[#85858d]">
                {isExpanded ? '收起' : '展开'}
              </span>
            </div>
          </div>

          {isExpanded && (
            <div className="p-1.5 space-y-1 border-t border-[#ececf0] bg-[#fafafc]">
              {childSubtasks.map((st, idx) => {
                let statusBadge = (
                  <span className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#f4f4f6] text-[#71717a] text-[9.5px] font-medium border border-[#e3e3e8]">
                    <Clock size={8.5} />
                    <span>PENDING</span>
                  </span>
                );
                if (st.status === 'running') {
                  statusBadge = (
                    <span className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#eff6ff] text-[#2563eb] text-[9.5px] font-medium border border-[#bfdbfe]/60">
                      <Loader2 size={8.5} className="animate-spin" />
                      <span>RUNNING</span>
                    </span>
                  );
                } else if (st.status === 'waiting_approval') {
                  statusBadge = (
                    <span
                      className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#fffbeb] text-[#b45309] text-[9.5px] font-medium border border-[#fde68a]"
                      title="待人工验收门禁"
                    >
                      <Clock size={8.5} className="animate-pulse" />
                      <span>REVIEW</span>
                    </span>
                  );
                } else if (st.status === 'completed') {
                  statusBadge = (
                    <span className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#ecfdf5] text-[#059669] text-[9.5px] font-medium border border-[#a7f3d0]/60">
                      <CheckCircle2 size={8.5} />
                      <span>PASSED</span>
                    </span>
                  );
                } else if (st.status === 'failed') {
                  statusBadge = (
                    <span className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#fef2f2] text-[#dc2626] text-[9.5px] font-medium border border-[#fecaca]/60">
                      <AlertCircle size={8.5} />
                      <span>FAILED</span>
                    </span>
                  );
                } else if (st.status === 'cancelled') {
                  statusBadge = (
                    <span
                      className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#f4f4f6] text-[#71717a] text-[9.5px] font-medium border border-[#e3e3e8]"
                      title="已取消"
                    >
                      <XCircle size={8.5} />
                      <span>CANCELLED</span>
                    </span>
                  );
                }

                return (
                  <div
                    key={st.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(st);
                    }}
                    className={`flex items-center justify-between gap-1.5 px-1.5 py-1 rounded-[5px] bg-white border transition-all cursor-pointer group/sub ${
                      st.status === 'waiting_approval'
                        ? 'border-[#fde68a] bg-[#fffdfa] hover:border-[#f59e0b]'
                        : 'border-[#ececf0] hover:border-[#d8d6fb]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="font-mono text-[9.5px] text-[#85858d] shrink-0">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-[#1c1c21] truncate font-medium group-hover/sub:text-[#4f46e5]">
                          {st.title}
                        </div>
                        <div className="text-[9.5px] text-[#85858d] truncate mt-0.5">
                          ⚡ {workflows.find((w) => w.id === st.workflowId)?.name || st.workflowId}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {statusBadge}
                      {st.status === 'waiting_approval' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(st);
                          }}
                          className="w-5 h-5 rounded hover:bg-[#fef3c7] text-[#b45309] flex items-center justify-center transition-colors"
                          title="查看并处理验收门禁"
                        >
                          <Eye size={10} />
                        </button>
                      )}
                      {onUnlinkSubtask && st.status !== 'running' && task.status !== 'running' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUnlinkSubtask(task.id, st.id);
                          }}
                          className="w-5 h-5 rounded hover:bg-[#fef2f2] text-[#85858d] hover:text-[#dc2626] flex items-center justify-center transition-colors"
                          title="脱离任务组，恢复为独立任务"
                        >
                          <Unlink size={10} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenLogs(st.id);
                        }}
                        className="w-5 h-5 rounded hover:bg-[#f1f1f4] text-[#85858d] hover:text-[#1c1c21] flex items-center justify-center transition-colors"
                        title="查看子工序实时日志"
                      >
                        <Terminal size={10} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 未启动任务：卡片内一键启动按钮 */}
      {task.status === 'pending' && (
        <div className="my-2">
          {task.kanbanColumn === 'inbox' ? (
            <div className="flex items-center gap-1.5">
              <button
                disabled={isMoving}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveColumn(task.id, 'backlog');
                }}
                className="flex-1 h-[24px] rounded-[5px] bg-[#f1f1f4] hover:bg-[#e4e4e9] text-[#1c1c21] text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 border border-[#e3e3e8]"
                title="将此想法移入待处理准备执行"
              >
                <ArrowRight size={10} />
                <span>{isMoving ? '移动中...' : '移入待处理'}</span>
              </button>
              <button
                disabled={isRunning}
                onClick={(e) => {
                  e.stopPropagation();
                  onRun(task.id);
                }}
                className="h-[24px] px-2.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 shadow-sm"
                title="直接启动流水线"
              >
                <Play size={10} strokeWidth={2.4} />
                <span>{isRunning ? '启动中' : '启动'}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                disabled={isRunning}
                onClick={(e) => {
                  e.stopPropagation();
                  onRun(task.id);
                }}
                className="flex-1 h-[24px] rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 shadow-sm"
              >
                <Play size={10} strokeWidth={2.4} />
                <span>{isRunning ? '启动中...' : (isGroup && groupCompletedCount > 0 ? '推进流水线' : '启动流水线')}</span>
              </button>
              {!(isGroup && groupCompletedCount > 0) && (
                <button
                  disabled={isMoving}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveColumn(task.id, 'inbox');
                  }}
                  className="h-[24px] px-2 rounded-[5px] bg-[#f9f9fb] hover:bg-[#eeedfd] text-[#85858d] hover:text-[#6366f1] text-[10.5px] font-medium flex items-center justify-center gap-1 transition-all border border-[#e3e3e8]"
                  title="退回 Inbox 想法收集"
                >
                  <ArrowRight size={10} className="rotate-180" />
                  <span>转想法</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 失败/驳回任务：克制优雅的错误状态与微型重试/跳过胶囊 */}
      {task.status === 'failed' && (
        <div className="my-2 space-y-1.5">
          <div className="p-1.5 rounded-[6px] bg-[#fdf2f2] border border-[#fbd5d5] flex items-center justify-between gap-1.5">
            <div className="min-w-0 flex items-center gap-1 text-[10.5px] text-[#d64545] font-medium truncate">
              <AlertCircle size={11} className="shrink-0" />
              <span className="truncate" title={failReason}>
                {failReason}
              </span>
            </div>
            <div className="shrink-0 flex items-center gap-1">
              <button
                disabled={isSkipping || isRunning}
                onClick={(e) => {
                  e.stopPropagation();
                  onSkipNode(task.id, lastFailedRun?.nodeId);
                }}
                className="h-[20px] px-1.5 rounded-[4px] bg-white hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[10px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm disabled:opacity-50 cursor-pointer"
                title="跳过当前报错节点，继续后续流程或标记完成"
              >
                <SkipForward size={9.5} className="text-[#85858d]" />
                <span>{isSkipping ? '跳过中' : '跳过'}</span>
              </button>
              <button
                disabled={isRunning || isSkipping}
                onClick={(e) => {
                  e.stopPropagation();
                  onRun(task.id);
                }}
                className="h-[20px] px-2 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm disabled:opacity-50 cursor-pointer"
                title="重新运行整条流水线"
              >
                <RotateCcw size={9.5} />
                <span>重试</span>
              </button>
            </div>
          </div>

          {(task.context?.worktree || nodeRuns.some((r) => r.artifacts && r.artifacts.length > 0)) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVisualAcceptance(task);
              }}
              className="w-full h-[24px] rounded-[5px] bg-[#4f46e5]/10 hover:bg-[#4f46e5]/20 text-[#4338ca] text-[11px] font-medium flex items-center justify-center gap-1.5 border border-[#c7d2fe] transition-all cursor-pointer"
            >
              <Play size={10} className="fill-current" />
              <span>查看截帧回放与靶机</span>
              {task.context?.worktree?.webPort && (
                <span className="text-[9.5px] font-mono opacity-80">(:{task.context.worktree.webPort})</span>
              )}
            </button>
          )}
        </div>
      )}

      {/* 手动终止任务：克制微型状态与重新执行胶囊 */}
      {task.status === 'cancelled' && (
        <div className="my-2 p-1.5 rounded-[6px] bg-[#f4f4f6] border border-[#e3e3e8] flex items-center justify-between gap-1.5">
          <div className="min-w-0 flex items-center gap-1.5 text-[10.5px] text-[#63636b] font-medium truncate">
            <Square size={9.5} className="fill-current text-[#85858d] shrink-0" />
            <span className="truncate">已手动终止</span>
          </div>
          <button
            disabled={isRunning}
            onClick={(e) => {
              e.stopPropagation();
              onRun(task.id);
            }}
            className="shrink-0 h-[20px] px-2 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm disabled:opacity-50"
          >
            <RotateCcw size={9.5} />
            <span>重新执行</span>
          </button>
        </div>
      )}

      {/* 自动化运行中卡片：高亮工序节点展示 */}
      {task.status === 'running' && (currentNodeMeta || currentNode) && (() => {
        const activeType = currentNode?.type || currentNodeMeta?.type;
        const visual = getRunningNodeVisual(activeType);
        const IconComp = visual.icon;
        const activeName = currentNodeMeta?.name || currentNode?.name || '自动化工序执行中';
        const isCurrentNodeAgent = activeType === 'agent';
        const isAwaitingInput = !!task.context?.awaitingInput && isCurrentNodeAgent;
        // 看板只接收任务摘要，是否已产生代码改动由服务端派生（避免前端全量扫描会话）
        const hasCodeChanges = !!task.context?.hasCodeChanges;

        return (
          <div
            className={`mb-2 p-2 rounded-[7px] border transition-all ${
              isAwaitingInput ? 'bg-[#fcfbff] border-[#dcdbf8]' : `${visual.badgeBg} ${visual.badgeBorder}`
            }`}
          >
            <div className="flex items-center justify-between gap-1.5 mb-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      isAwaitingInput ? 'bg-[#6366f1]' : visual.pingColor
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      isAwaitingInput ? 'bg-[#4f46e5]' : visual.pingColor
                    }`}
                  />
                </span>
                {isAwaitingInput ? (
                  <span className="text-[9.5px] font-semibold tracking-wider px-1.5 py-[1px] rounded bg-white/90 border border-[#c7d2fe] text-[#4338ca] flex items-center gap-1 shrink-0">
                    <MessageSquare size={9.5} />
                    <span>{hasCodeChanges ? '待确认放行' : '等待确认'}</span>
                  </span>
                ) : (
                  <span className={`text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-white/90 border ${visual.badgeBorder} ${visual.badgeText} flex items-center gap-1 shrink-0`}>
                    <IconComp size={9.5} />
                    <span>{visual.label}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenLogs(task.id, task.currentNodeId);
                  }}
                  className="h-[19px] px-1.5 rounded-[4px] bg-white/90 hover:bg-white text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[9.5px] font-medium flex items-center gap-1 transition-all shadow-xs"
                  title="查看实时运行终端"
                >
                  <Terminal size={8.5} className="text-[#85858d]" />
                  <span>终端</span>
                </button>
                <button
                  disabled={isCancelling}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel(task.id);
                  }}
                  className="h-[19px] px-1.5 rounded-[4px] bg-white/90 hover:bg-[#fee2e2] text-[#85858d] hover:text-[#d64545] border border-[#e3e3e8] hover:border-[#fecaca] text-[9.5px] font-medium flex items-center gap-1 transition-all shadow-xs"
                  title="终止任务"
                >
                  <Square size={8} className="fill-current" />
                  <span>{isCancelling ? '终止中' : '终止'}</span>
                </button>
              </div>
            </div>
            <div className="text-[11px] font-medium text-[#1c1c21] truncate flex items-center gap-1" title={activeName}>
              <span className="truncate">{activeName}</span>
              {isAwaitingInput && (
                <span className="text-[10px] text-[#4f46e5] font-normal shrink-0">
                  {hasCodeChanges ? '(待确认放行)' : '(需确认方案)'}
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* 待人工验收门禁卡片 */}
      {task.status === 'waiting_approval' && (
        <div className="my-2 p-2 rounded-[7px] bg-[#f9f9fb] border border-[#e3e3e8] space-y-1.5">
          <div className="text-[11px] font-medium text-[#1c1c21] flex items-center justify-between">
            <span className="flex items-center gap-1.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-[#1c1c21] animate-pulse shrink-0" />
              <span className="truncate">
                {currentNodeMeta?.name || currentNode?.name || 'QA 验收门禁'} · 待确认
              </span>
            </span>
            {task.context?.worktree && (
              <button
                type="button"
                onClick={handleOpenOrStartSandbox}
                className={`text-[9.5px] font-mono px-1.5 py-[1.5px] rounded border flex items-center gap-1 transition-all cursor-pointer ${
                  sandboxStatus === 'running'
                    ? 'bg-[#eff6ff] hover:bg-[#dbeafe] text-[#2563eb] border-[#bfdbfe]'
                    : sandboxStatus === 'starting'
                    ? 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]'
                    : 'bg-[#f4f4f6] hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] border-[#e3e3e8]'
                }`}
                title={
                  sandboxStatus === 'running'
                    ? '沙箱靶机在线运行中，点击在新标签页打开'
                    : sandboxStatus === 'starting'
                    ? '正在拉起沙箱靶机服务...'
                    : '沙箱靶机离线，点击一键唤醒'
                }
              >
                {sandboxStatus === 'starting' ? (
                  <Loader2 size={9} className="animate-spin text-[#b45309]" />
                ) : sandboxStatus === 'running' ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#059669] shrink-0" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#a1a1aa] shrink-0" />
                )}
                <span>靶机 :{task.context.worktree.webPort}</span>
                {sandboxStatus === 'running' ? (
                  <ExternalLink size={8} className="opacity-70" />
                ) : sandboxStatus === 'stopped' ? (
                  <Play size={7} className="fill-current opacity-70" />
                ) : null}
              </button>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onVisualAcceptance(task);
            }}
            className="w-full h-[24px] rounded-[5px] bg-[#4f46e5]/10 hover:bg-[#4f46e5]/20 text-[#4338ca] text-[11px] font-medium flex items-center justify-center gap-1.5 border border-[#c7d2fe] transition-all cursor-pointer"
          >
            <Play size={10} className="fill-current" />
            <span>查看截帧回放与验收</span>
          </button>

          <div className="flex items-center gap-1.5">
            <button
              disabled={isApproving}
              onClick={(e) => {
                e.stopPropagation();
                onApprove(task.id, true);
              }}
              className="flex-1 h-[24px] rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
            >
              <Check size={11} strokeWidth={2.4} />
              验收通过
            </button>
            <button
              disabled={isApproving}
              onClick={(e) => {
                e.stopPropagation();
                onApprove(task.id, false);
              }}
              className="h-[24px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#63636b] hover:text-[#1c1c21] hover:bg-[#f1f1f4] text-[11px] font-medium transition-all"
            >
              驳回
            </button>
          </div>
        </div>
      )}

      {/* 冲突自愈提示 */}
      {task.context?.worktree?.conflictResolution && (
        <div className="mb-1.5 flex items-center justify-between text-[10px] text-[#059669] bg-[#ecfdf5] px-2 py-[2.5px] rounded-[5px] border border-[#a7f3d0]">
          <span className="flex items-center gap-1 font-medium truncate">
            <Sparkles size={9.5} className="text-[#059669]" />
            <span>Agent 冲突自愈 ({task.context.worktree.conflictResolution.conflictFiles.length} 个文件)</span>
          </span>
          <span className="text-[9px] font-mono text-[#059669] opacity-80">已自动消解</span>
        </div>
      )}

      {/* 卡片底栏：进度与附件 */}
      <div className="pt-1.5 border-t border-[#ececf0] flex items-center justify-between text-[10.5px] text-[#85858d]">
        <div className="flex items-center gap-1.5">
          <span>
            {isGroup ? `工序 ${groupCompletedCount}/${groupTotalCount}` : `节点 ${displayCompleted}/${displayTotal}`}
          </span>
          {task.attachments && task.attachments.length > 0 && (
            <span
              className="flex items-center gap-0.5 text-[9.5px] font-mono text-[#63636b] bg-[#f4f4f7] px-1 py-[0.5px] rounded border border-[#ececf0]"
              title={`${task.attachments.length} 张参考图片`}
            >
              <ImageIcon size={9} className="text-[#85858d]" />
              <span>{task.attachments.length}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-14 bg-[#e6e6eb] rounded-full h-[3px] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                task.status === 'completed'
                  ? 'bg-[#189a58]'
                  : task.status === 'failed'
                  ? 'bg-[#d64545]'
                  : 'bg-[#1c1c21]'
              }`}
              style={{ width: `${isGroup ? groupProgressPct : progressPct}%` }}
            />
          </div>
          <span className="font-mono">{isGroup ? groupProgressPct : progressPct}%</span>
        </div>
      </div>
    </div>
  );
};

// 使用 React.memo 精准隔离非必要重渲染
export const KanbanCard = memo(KanbanCardComponent, (prev, next) => {
  return (
    prev.task === next.task &&
    (prev.task.kind !== 'group' || prev.allTasks === next.allTasks) &&
    prev.workflow === next.workflow &&
    prev.isSelected === next.isSelected &&
    prev.isCancelling === next.isCancelling &&
    prev.isMoving === next.isMoving &&
    prev.isRunning === next.isRunning &&
    prev.isSkipping === next.isSkipping &&
    prev.isApproving === next.isApproving
  );
});
