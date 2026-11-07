import React, { memo, useState, useEffect, useMemo, useRef } from 'react';
import {
  Check,
  Copy,
  Terminal,
  Sparkles,
  Trash2,
  Play,
  RotateCcw,
  SkipForward,
  ArrowRight,
  Edit3,
  AlertCircle,
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
  Plus,
  X,
  Workflow,
  UserCheck,
  ScanLine,
  Archive,
  ScrollText,
} from 'lucide-react';
import { Task, KanbanColumn, TaskAttachment, WorkflowDefinition } from '@openloop/core';
import { parseMarkdownSteps } from '@openloop/core/markdown-format';
import { api } from '../services/api';
import { toast } from './Toast';
import { openInDefaultBrowser } from '../utils/openExternalBrowser';
import { resolveNodeMeta } from '../utils/nodeMeta';
import { formatShortTaskId, copyToClipboard } from '../utils/taskId';
import { orderSubTasksForDisplay } from '../utils/subtaskOrder';
import { readTaskQaSteps } from '../utils/taskQa';
import { KanbanCardQuickView } from './KanbanCardQuickView';
import { ScanPreviewModal } from './qa/ScanPreviewModal';

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
  isApproving?: boolean;
  isSkipping?: boolean;
  onSelect: (task: Task) => void;
  onCancel: (taskId: string) => void;
  onMoveColumn: (taskId: string, targetCol: KanbanColumn) => void;
  onEdit: (task: Task) => void;
  onOpenLogs: (taskId: string, nodeId?: string) => void;
  /** 直达该任务的 Agent 对话，无需先打开任务详情 */
  onOpenAgentChat?: (task: Task) => void;
  onDelete: (task: Task) => void;
  onRun: (taskId: string) => void;
  onSkipStep: (taskId: string) => void;
  onArchive?: (taskId: string) => void;
  onVisualAcceptance: (task: Task) => void;
  onApprove: (taskId: string, approved: boolean, feedback?: string) => void;
  onSetParent?: (task: Task) => void;
  onAddSubtask?: (
    parentId: string,
    params: { title: string; workflowId?: string; attachments?: TaskAttachment[] }
  ) => Promise<void>;
  onAddSubtasks?: (
    parentId: string,
    items: Array<{ title: string; workflowId?: string; attachments?: TaskAttachment[] }>
  ) => Promise<void>;
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
  isApproving,
  isSkipping,
  onSelect,
  onCancel,
  onMoveColumn,
  onEdit,
  onOpenLogs,
  onOpenAgentChat,
  onDelete,
  onRun,
  onSkipStep,
  onArchive,
  onVisualAcceptance,
  onApprove,
  onSetParent,
  onAddSubtask,
  onAddSubtasks,
}) => {
  const [sandboxStatus, setSandboxStatus] = useState<'checking' | 'running' | 'stopped' | 'starting'>('checking');
  const [isScanOpen, setIsScanOpen] = useState(false);
  // 卡片速览：把详情页里的档案信息收进卡片，默认收起以保持列表密度
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);
  // 任务组里展开哪一条子工序的速览（同一条再点即收起）
  const [subQuickViewId, setSubQuickViewId] = useState<string | null>(null);
  // 空任务组默认展开，让「添加子工序」入口一眼可见
  const [isExpanded, setIsExpanded] = useState<boolean>(() => task.kind === 'group' && !(task.subTaskIds || []).length);
  const [idCopied, setIdCopied] = useState<boolean>(false);
  const [subDraft, setSubDraft] = useState<string>('');
  const [subWorkflowId, setSubWorkflowId] = useState<string>('');
  const [subAttachments, setSubAttachments] = useState<TaskAttachment[]>([]);
  const [subUploadingCount, setSubUploadingCount] = useState<number>(0);
  const [isSubtaskSubmitting, setIsSubtaskSubmitting] = useState<boolean>(false);
  const subInputRef = useRef<HTMLTextAreaElement>(null);
  const focusComposerRef = useRef<boolean>(false);

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
  const canAddSubtask = !!onAddSubtask && task.status !== 'running';
  const childSubtasks = useMemo(() => {
    if (!isGroup || !Array.isArray(task.subTaskIds) || !allTasks) return [];
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    return task.subTaskIds.map((id) => taskMap.get(id)).filter(Boolean) as Task[];
  }, [isGroup, task.subTaskIds, allTasks]);

  // 输入条随内容自增高度（上限 3 行），避免长文本把卡片撑高
  useEffect(() => {
    const el = subInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 56)}px`;
  }, [subDraft, isExpanded]);

  useEffect(() => {
    if (!isExpanded || !focusComposerRef.current) return;
    focusComposerRef.current = false;
    subInputRef.current?.focus();
  }, [isExpanded]);

  // 展开并聚焦输入条：一步直达，不再需要「先点 + 再输入」
  const focusComposer = () => {
    if (isExpanded) {
      subInputRef.current?.focus();
      return;
    }
    focusComposerRef.current = true;
    setIsExpanded(true);
  };

  // 粘贴截图即上传，附件随工序一起落库
  const handleSubPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length === 0) return;
    e.preventDefault();
    setSubUploadingCount((n) => n + files.length);
    for (const file of files) {
      try {
        const attachment = await api.uploadAttachment(file);
        setSubAttachments((prev) => [...prev, attachment]);
      } catch (err: any) {
        if (import.meta.env?.DEV) {
          console.error('[KanbanCard] 工序截图上传失败:', err);
        }
        toast.error(`截图上传失败: ${err?.message || '未知错误'}`);
      } finally {
        setSubUploadingCount((n) => n - 1);
      }
    }
  };

  // 回车提交并保留焦点支持连续录入；多行文本（含粘贴）自动拆条，一次批量提交
  const handleQuickAddSubtask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!onAddSubtask || isSubtaskSubmitting || subUploadingCount > 0) return;
    const workflowId = subWorkflowId || task.workflowId;
    const hasAttachments = subAttachments.length > 0;
    const text = subDraft.trim();
    const titles = hasAttachments
      ? [text.replace(/\s*\n\s*/g, ' ').trim()]
      : text.split('\n').map((line) => line.trim()).filter(Boolean);
    if (titles.length === 0) return;

    setIsSubtaskSubmitting(true);
    if (import.meta.env?.DEV) {
      console.log('[KanbanCard] 任务组内追加工序:', {
        parentId: task.id,
        titles,
        workflowId,
        attachments: subAttachments.length,
      });
    }
    try {
      if (titles.length > 1 && onAddSubtasks) {
        await onAddSubtasks(task.id, titles.map((title) => ({ title, workflowId })));
      } else {
        await onAddSubtask(task.id, {
          title: titles[0],
          workflowId,
          attachments: hasAttachments ? subAttachments : undefined,
        });
      }
      setSubDraft('');
      setSubAttachments([]);
      subInputRef.current?.focus();
    } catch {
      // 错误提示统一由上层 toast 呈现，草稿保留便于重试
    } finally {
      setIsSubtaskSubmitting(false);
    }
  };

  const displaySubtasks = useMemo(() => orderSubTasksForDisplay(childSubtasks), [childSubtasks]);

  const groupCompletedCount = childSubtasks.filter((s) => s.status === 'completed').length;
  const groupTotalCount = childSubtasks.length || task.subTaskIds?.length || 0;
  const allSubtasksCompleted = groupTotalCount > 0 && groupCompletedCount === groupTotalCount;
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
  const currentNodeMeta = task.currentNodeId
    ? resolveNodeMeta(task.currentNodeId, task.nodeRuns?.[task.currentNodeId])
    : null;
  const nodeRuns = Object.values(task.nodeRuns || {});
  const isCompleted = task.status === 'completed';
  const completedCount = nodeRuns.filter((r) => r.status === 'success' || r.status === 'skipped').length;
  // 总数按流程文档声明的全部步骤算，未执行到的步骤也计入
  const declaredStepCount = parseMarkdownSteps(workflow?.markdown || '').length;
  const displayTotal = Math.max(completedCount, nodeRuns.length, declaredStepCount, 1);
  const displayCompleted = isCompleted ? displayTotal : completedCount;
  const progressPct = isCompleted ? 100 : Math.round((displayCompleted / displayTotal) * 100);
  const lastFailedRun = nodeRuns.slice().reverse().find((r) => r.status === 'failed');
  const failReason = lastFailedRun?.error || '执行中断或驳回';
  // 已有 Agent 会话才露出直达入口：任务组根节点常驻架构师会话，Agent 节点执行中会话已在线
  const isAgentNodeRunning = task.status === 'running' && currentNodeMeta?.type === 'agent';
  const hasAgentChat = Boolean(
    task.context?.sessionId ||
      task.context?.piSessionId ||
      task.context?.awaitingInput ||
      isGroup ||
      isAgentNodeRunning
  );
  const isAwaitingReply = !!task.context?.awaitingInput;
  // 有档案信息才露出速览入口，避免出现空面板；任务组自身是容器，速览放在子工序行上
  const hasQuickViewFor = (target: Task) =>
    Boolean(
      target.description?.trim() ||
        (target.attachments?.length || 0) > 0 ||
        Object.keys(target.nodeRuns || {}).length > 0 ||
        readTaskQaSteps(target).length > 0
    );
  const hasQuickViewContent = !isGroup && hasQuickViewFor(task);

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

      <h4
        className="text-[12.5px] font-medium text-[#1c1c21] leading-snug line-clamp-2 mb-1"
        title={task.title}
      >
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
        {hasAgentChat && onOpenAgentChat && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (import.meta.env?.DEV) {
                console.log('[KanbanCard] 直达 Agent 对话:', task.id);
              }
              onOpenAgentChat(task);
            }}
            className={`ml-auto shrink-0 inline-flex items-center gap-1 h-[17px] pl-1 pr-1.5 rounded-[4px] border text-[10px] font-medium transition-all cursor-pointer select-none active:scale-95 ${
              isAwaitingReply
                ? 'border-[#ddd6fe] bg-[#f5f3ff] text-[#4f46e5] hover:bg-[#eeedfd]'
                : 'border-[#ececf0] bg-[#f6f6f9] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] hover:border-[#ddd6fe]'
            }`}
            title={
              isAwaitingReply
                ? 'Agent 正在等待你的回复，点击直达对话'
                : '直达 Agent 对话（无需打开任务详情）'
            }
          >
            <MessageSquare size={9.5} strokeWidth={2.2} className="shrink-0" />
            <span>对话</span>
            {isAwaitingReply && <span className="w-1 h-1 rounded-full bg-[#4f46e5] animate-pulse" />}
          </button>
        )}
      </div>

      {/* 任务组：正在执行中的子工序呼吸态通知 */}
      {isGroup && runningSub && (
        <div className="flex items-center gap-1.5 py-1 px-2 rounded-[5px] bg-[#eff6ff] border border-[#bfdbfe]/60 text-[#1d4ed8] text-[10.5px] font-medium my-1.5 animate-fadeIn">
          <Loader2 size={10.5} className="animate-spin text-[#2563eb] shrink-0" />
          <span className="shrink-0 font-mono text-[#2563eb]">#{runningSubIndex + 1}</span>
          <span className="truncate flex-1 font-normal text-[#1e40af]" title={runningSub.title}>
            {runningSub.title}
          </span>
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
          <span className="truncate flex-1 font-normal text-[#92400e]" title={waitingSub.title}>
            {waitingSub.title}
          </span>
          <span
            className="shrink min-w-0 max-w-[45%] truncate font-mono text-[9px] bg-[#fef3c7] text-[#b45309] px-1 py-[0.5px] rounded border border-[#fde68a]"
            title={waitingSubWorkflowName}
          >
            待验收
          </span>
        </div>
      )}

      {/* 任务组子工序卡片式折叠列表 */}
      {isGroup && (
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
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-[#4f46e5] font-medium">
                {groupProgressPct}%
              </span>
              {canAddSubtask && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (import.meta.env?.DEV) console.log('[KanbanCard] 定位到任务组工序输入条:', task.id);
                    focusComposer();
                  }}
                  className="w-5 h-5 rounded-[4px] text-[#85858d] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-colors"
                  title="添加子工序"
                >
                  <Plus size={11} strokeWidth={2.4} />
                </button>
              )}
              <span className="text-[10px] text-[#85858d]">
                {isExpanded ? '收起' : '展开'}
              </span>
            </div>
          </div>

          {/* 工序输入条：常驻在滚动列表之上，工序再多也不必滚动 */}
          {isExpanded && canAddSubtask && (
            <div onClick={(e) => e.stopPropagation()} className="px-1.5 pt-1.5 pb-1 border-t border-[#ececf0] bg-white">
              <div className="flex items-start gap-1 rounded-[5px] border border-[#ececf0] bg-[#fafafc] px-1.5 py-1 focus-within:border-[#4f46e5] focus-within:bg-white transition-colors">
                <Plus size={10} strokeWidth={2.6} className="mt-[2.5px] shrink-0 text-[#4f46e5]" />
                <textarea
                  ref={subInputRef}
                  rows={1}
                  value={subDraft}
                  onChange={(e) => setSubDraft(e.target.value)}
                  onPaste={handleSubPaste}
                  onKeyDown={(e) => {
                    // 拼音等输入法的回车只用于上屏候选词，不触发录入
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleQuickAddSubtask();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setSubDraft('');
                      setSubAttachments([]);
                      e.currentTarget.blur();
                    }
                  }}
                  readOnly={isSubtaskSubmitting}
                  placeholder="添加工序，回车录入，可粘贴截图"
                  className="flex-1 min-w-0 resize-none overflow-y-auto bg-transparent text-[11px] leading-[15px] text-[#1c1c21] placeholder:text-[#a1a1aa] outline-none read-only:opacity-60"
                />
                {isSubtaskSubmitting || subUploadingCount > 0 ? (
                  <Loader2 size={10} className="mt-[2.5px] shrink-0 animate-spin text-[#4f46e5]" />
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleQuickAddSubtask()}
                    disabled={(!subDraft.trim() && subAttachments.length === 0) || isSubtaskSubmitting}
                    className="mt-[1px] shrink-0 h-[15px] px-1.5 rounded-[3px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[9.5px] font-medium transition-colors disabled:opacity-30"
                    title="添加工序 (Enter)"
                  >
                    添加
                  </button>
                )}
              </div>

              {/* 粘贴的截图：即时上传并随工序一起落库 */}
              {(subAttachments.length > 0 || subUploadingCount > 0) && (
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  {subAttachments.map((att) => (
                    <div key={att.id} className="relative group/att">
                      <img
                        src={api.getAttachmentUrl(att.url)}
                        alt={att.name}
                        className="w-6 h-6 rounded-[3px] object-cover border border-[#ececf0]"
                      />
                      <button
                        type="button"
                        onClick={() => setSubAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                        className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#1c1c21] text-white items-center justify-center hidden group-hover/att:flex"
                        title="移除截图"
                      >
                        <X size={7} />
                      </button>
                    </div>
                  ))}
                  {subUploadingCount > 0 && (
                    <div className="w-6 h-6 rounded-[3px] border border-dashed border-[#c7c3f8] bg-[#f4f4f6] flex items-center justify-center">
                      <Loader2 size={9} className="animate-spin text-[#4f46e5]" />
                    </div>
                  )}
                </div>
              )}

              {workflows.length > 0 && (
                <div className="flex items-center gap-1 mt-1 min-w-0">
                  <Workflow size={9.5} className="shrink-0 text-[#a1a1aa]" />
                  <select
                    value={subWorkflowId || task.workflowId}
                    onChange={(e) => setSubWorkflowId(e.target.value)}
                    disabled={isSubtaskSubmitting}
                    className="flex-1 min-w-0 h-[16px] bg-transparent text-[9.5px] font-medium text-[#63636b] outline-none cursor-pointer truncate hover:text-[#4f46e5] disabled:opacity-60"
                    title="选择该工序的执行流水线"
                  >
                    {workflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name}
                      </option>
                    ))}
                  </select>
                  <span className="shrink-0 text-[9px] text-[#b9b9c2]">↵ 添加 · ⇧↵ 换行</span>
                </div>
              )}
            </div>
          )}

          {isExpanded && displaySubtasks.length > 0 && (
            <div
              className={`p-1.5 space-y-1 border-t border-[#ececf0] bg-[#fafafc] overflow-y-auto ${
                subQuickViewId ? 'max-h-[420px]' : 'max-h-[200px]'
              }`}
            >

              {displaySubtasks.map(({ st, orderNo }) => {
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
                    className={`flex flex-wrap items-center justify-between gap-1.5 px-1.5 py-1 rounded-[5px] bg-white border transition-all cursor-pointer group/sub ${
                      st.status === 'waiting_approval'
                        ? 'border-[#fde68a] bg-[#fffdfa] hover:border-[#f59e0b]'
                        : 'border-[#ececf0] hover:border-[#d8d6fb]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="font-mono text-[9.5px] text-[#85858d] shrink-0">
                        #{orderNo}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-[11px] text-[#1c1c21] truncate font-medium group-hover/sub:text-[#4f46e5]"
                          title={st.title}
                        >
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
                      {st.status !== 'running' && task.status !== 'running' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRun(st.id);
                          }}
                          className="w-5 h-5 rounded hover:bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center transition-colors"
                          title="启动该工序"
                        >
                          <Play size={10} strokeWidth={2.4} />
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
                      {hasQuickViewFor(st) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (import.meta.env?.DEV) {
                              console.log('[KanbanCard] 切换子工序速览:', { parentId: task.id, subtaskId: st.id });
                            }
                            setSubQuickViewId((prev) => (prev === st.id ? null : st.id));
                          }}
                          className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                            subQuickViewId === st.id
                              ? 'bg-[#eeedfd] text-[#4f46e5]'
                              : 'text-[#85858d] hover:text-[#4f46e5] hover:bg-[#eeedfd]'
                          }`}
                          title={subQuickViewId === st.id ? '收起该工序速览' : '展开该工序速览'}
                        >
                          <ScrollText size={10} />
                        </button>
                      )}
                    </div>
                  {/* 子工序速览：展开在该行内，任务组本身不再提供速览 */}
                  {subQuickViewId === st.id && (
                    <div className="w-full" onClick={(e) => e.stopPropagation()}>
                      <KanbanCardQuickView
                        task={st}
                        allTasks={allTasks}
                        workflow={workflows.find((w) => w.id === st.workflowId)}
                        onOpenLogs={onOpenLogs}
                        onEdit={onEdit}
                        onSelect={onSelect}
                      />
                    </div>
                  )}
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
              {allSubtasksCompleted && onArchive ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (import.meta.env?.DEV) {
                      console.log('[KanbanCard] 归档已完成的子工序任务组:', task.id);
                    }
                    onArchive(task.id);
                  }}
                  className="flex-1 h-[24px] rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 shadow-sm"
                  title="工序已全部完成，归档此任务组到「已完成」泳道"
                >
                  <Archive size={10} strokeWidth={2.4} />
                  <span>归档已完成</span>
                </button>
              ) : (
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
              )}
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
                disabled={isRunning || isSkipping}
                onClick={(e) => {
                  e.stopPropagation();
                  onSkipStep(task.id);
                }}
                className="h-[20px] px-2 rounded-[4px] bg-white hover:bg-[#f7f7fa] text-[#52525b] text-[10px] font-medium flex items-center gap-1 transition-all active:scale-95 border border-[#e3e3e8] disabled:opacity-50 cursor-pointer"
                title="跳过失败的步骤，从流程文档里它之后的步骤续跑"
              >
                <SkipForward size={9.5} />
                <span>{isSkipping ? '跳过中' : '跳过这步'}</span>
              </button>
              <button
                disabled={isRunning}
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

      {/* 自动化运行中卡片：高亮当前步骤展示 */}
      {task.status === 'running' && currentNodeMeta && (() => {
        const activeType = currentNodeMeta.type;
        const visual = getRunningNodeVisual(activeType);
        const IconComp = visual.icon;
        const activeName = currentNodeMeta.name;
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
                    <span>{hasCodeChanges ? '待确认放行' : '等待回复'}</span>
                  </span>
                ) : (
                  <span className={`text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-white/90 border ${visual.badgeBorder} ${visual.badgeText} flex items-center gap-1 shrink-0`}>
                    <IconComp size={9.5} />
                    <span>{visual.label}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {task.context?.worktree && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsScanOpen(true);
                    }}
                    className="h-[19px] px-1.5 rounded-[4px] bg-white/90 hover:bg-white text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[9.5px] font-medium flex items-center gap-1 transition-all shadow-xs"
                    title="扫码在手机上打开靶机页面"
                  >
                    <ScanLine size={8.5} className="text-[#85858d]" />
                    <span>扫码</span>
                  </button>
                )}
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
                  {hasCodeChanges ? '(待确认放行)' : '(等待回复)'}
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* 待人工验收门禁卡片 */}
      {task.status === 'waiting_approval' && (() => {
        const isManualQaMode =
          (!task.context?.qaInstructions || task.context.qaInstructions.length === 0) &&
          !nodeRuns.some((r) => r.artifacts && r.artifacts.length > 0);

        return (
          <div className="my-2 p-2 rounded-[7px] bg-[#f9f9fb] border border-[#e3e3e8] space-y-1.5">
            <div className="text-[11px] font-medium text-[#1c1c21] flex items-center justify-between">
              <span className="flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1c1c21] animate-pulse shrink-0" />
                <span className="truncate">
                  {isManualQaMode
                    ? '现场就绪 · 人工自测'
                    : `${currentNodeMeta?.name || 'QA 验收门禁'} · 待确认`}
                </span>
              </span>
              {task.context?.worktree && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIsScanOpen(true);
                    }}
                    className="w-[20px] h-[19px] rounded-[4px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer"
                    title="扫码在手机上打开靶机页面"
                  >
                    <ScanLine size={10} />
                  </button>
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
                </div>
              )}
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onVisualAcceptance(task);
              }}
              className="w-full h-[24px] rounded-[5px] bg-[#4f46e5]/10 hover:bg-[#4f46e5]/20 text-[#4338ca] text-[11px] font-medium flex items-center justify-center gap-1.5 border border-[#c7d2fe] transition-all cursor-pointer"
            >
              {isManualQaMode ? (
                <>
                  <UserCheck size={11} />
                  <span>人工自测核验与代码 Diff</span>
                </>
              ) : (
                <>
                  <Play size={10} className="fill-current" />
                  <span>查看截帧回放与验收</span>
                </>
              )}
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
        );
      })()}

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

      {/* 卡片速览：需求说明、参考图、验收用例与步骤轨迹都在卡片内看完 */}
      {isQuickViewOpen && hasQuickViewContent && (
        <KanbanCardQuickView
          task={task}
          allTasks={allTasks}
          workflow={workflow}
          onOpenLogs={onOpenLogs}
          onEdit={onEdit}
          onSelect={onSelect}
        />
      )}

      {/* 卡片底栏：进度与附件 */}
      <div className="pt-1.5 border-t border-[#ececf0] flex items-center justify-between text-[10.5px] text-[#85858d]">
        <div className="flex items-center gap-1.5">
          <span>
            {isGroup ? `工序 ${groupCompletedCount}/${groupTotalCount}` : `步骤 ${displayCompleted}/${displayTotal}`}
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
          {hasQuickViewContent && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (import.meta.env?.DEV) {
                  console.log('[KanbanCard] 切换卡片速览:', { taskId: task.id, next: !isQuickViewOpen });
                }
                setIsQuickViewOpen((v) => !v);
              }}
              className={`inline-flex items-center gap-0.5 h-[16px] pl-1 pr-1 rounded-[4px] border text-[9.5px] font-medium transition-all cursor-pointer select-none active:scale-95 ${
                isQuickViewOpen
                  ? 'bg-[#eeedfd] text-[#4f46e5] border-[#d8d6fb]'
                  : 'bg-[#f4f4f7] text-[#63636b] border-[#ececf0] hover:text-[#4f46e5] hover:border-[#d8d6fb]'
              }`}
              title={isQuickViewOpen ? '收起卡片速览' : '在卡片内查看需求说明、参考图、验收用例与步骤轨迹'}
            >
              <ScrollText size={9} />
              <span>速览</span>
              <ChevronDown
                size={8}
                className={`transition-transform duration-150 ${isQuickViewOpen ? 'rotate-180' : ''}`}
              />
            </button>
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
      {isScanOpen && <ScanPreviewModal task={task} onClose={() => setIsScanOpen(false)} />}
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
    prev.isApproving === next.isApproving &&
    prev.isSkipping === next.isSkipping &&
    prev.onOpenAgentChat === next.onOpenAgentChat
  );
});
