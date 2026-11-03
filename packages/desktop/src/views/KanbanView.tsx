import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import {
  Check,
  Copy,
  X,
  FileImage,
  Terminal,
  Search,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Trash2,
  Play,
  RotateCcw,
  CheckCircle2,
  Layers,
  ArrowRight,
  ExternalLink,
  Edit3,
  Clock,
  AlertCircle,
  SkipForward,
  FileText,
  RefreshCw,
  GitBranch,
  ArrowUpDown,
  Square,
  MessageSquare,
  Send,
  Pause,
  Cpu,
  Wrench,
  Bot,
  User,
  Inbox,
  Plus,
  FolderGit2,
  FolderOpen,
  Folder,
  Image as ImageIcon,
  Loader2,
  ZoomIn,
  FlaskConical,
  ClipboardCheck,
  Activity,
  Columns3,
  Workflow,
  AlignLeft,
  GitCommit,
  Eye,
  GitMerge,
  Unlink,
  Link2,
  PanelRight,
  Maximize2,
  Archive,
} from 'lucide-react';
import type {
  Task,
  KanbanColumn,
  WorkflowDefinition,
  NodeRun,
  TaskSessionState,
  SessionChatMessage,
  TaskAttachment,
  SelectedQaArtifacts,
} from '@openloop/core';
import {
  extractToolResultText,
  formatToolArgs,
  sanitizeChatMessages,
} from '@openloop/core/agent-format';
import { guessImageMimeType } from '@openloop/core/media-mime';
import { getAgentProviderMeta } from '@openloop/agent-providers';
import { TaskAgentPanel } from '../agent-ui';
import { api } from '../services/api';
import { EditTaskModal } from '../components/EditTaskModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { KanbanColumnSortDropdown } from '../components/KanbanColumnSortDropdown';
import { NodeExecutionTimeline } from '../components/NodeExecutionTimeline';
import { ImageLightboxModal } from '../components/ImageLightboxModal';
import { TaskPromptArea } from '../components/TaskPromptArea';
import { WorkspacePicker } from '../components/WorkspacePicker';
import { WorkflowPicker } from '../components/WorkflowPicker';
import { AgentMarkdown } from '../components/AgentMarkdown';
import { ChatScrollToLatestButton } from '../components/ChatScrollToLatestButton';
import { AgentAwaitingInputBar } from '../components/AgentAwaitingInputBar';
import { AgentChatChangedFiles } from '../components/AgentChatChangedFiles';
import { AgentAutocompletePopover, AgentAutocompletePopoverHandle } from '../components/AgentAutocompletePopover';
import { VisualAcceptanceModal } from '../components/qa/VisualAcceptanceModal';
import { QaArtifactSelectorModal } from '../components/qa/QaArtifactSelectorModal';
import { TaskQaInstructionsCard } from '../components/qa/TaskQaInstructionsCard';
import { TaskDescriptionCard } from '../components/TaskDescriptionCard';
import { KanbanLaneList } from '../components/KanbanLaneList';
import { SelectParentTaskModal } from '../components/SelectParentTaskModal';
import { InboxQuickAdd } from '../components/InboxQuickAdd';
import { LinkExistingTasksModal } from '../components/LinkExistingTasksModal';
import { toast } from '../components/Toast';
import { resolveNodeMeta, resolveQaTestNodeId } from '../utils/nodeMeta';
import { formatShortTaskId, copyToClipboard } from '../utils/taskId';
import { orderSubTasksForDisplay } from '../utils/subtaskOrder';
import {
  DEFAULT_DETAIL_WIDTH,
  clampDetailWidth,
  readAgentPaneOpen,
  readDetailWidth,
  saveAgentPaneOpen,
  saveDetailWidth,
} from '../utils/taskWorkbench';
import { useChatAutoScroll } from '../hooks/useChatAutoScroll';
import {
  ColumnSortRule,
  ColumnSortConfigMap,
  SORT_OPTIONS,
  DEFAULT_SORT_RULE,
  loadColumnSortConfig,
  saveColumnSortConfig,
  sortTasks,
  findSortOption,
} from '../utils/kanbanSort';

interface KanbanViewProps {
  tasks: Task[];
  workflows: WorkflowDefinition[];
  onOpenTaskLogs: (taskId: string, nodeId?: string) => void;
  onRefresh: () => void | Promise<void>;
  onTaskUpdate?: (task: Task) => void;
  selectedWorkspaceFilter?: string;
  onWorkspaceFilterChange?: (workspace: string) => void;
  /** 打开某条智能体会话（全局智能体浮层），可选携带任务上下文 */
  onOpenAgentSession: (
    sessionId: string,
    context?: { taskId?: string; taskTitle?: string; cwd?: string }
  ) => void;
}

interface ColumnDef {
  key: KanbanColumn;
  title: string;
  dotColor: string;
}

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
        icon: Layers,
      };
  }
};

const COLUMNS: ColumnDef[] = [
  { key: 'inbox', title: 'Inbox', dotColor: 'bg-[#6366f1]' },
  { key: 'backlog', title: '待处理', dotColor: 'bg-[#85858d]' },
  { key: 'in_progress', title: '执行中', dotColor: 'bg-[#7c3aed]' },
  { key: 'qa_review', title: '待验收', dotColor: 'bg-[#b45309]' },
  { key: 'done', title: '已完成', dotColor: 'bg-[#189a58]' },
];

const COLUMN_NAMES: Record<KanbanColumn, string> = {
  inbox: 'Inbox 收集箱',
  backlog: '待处理',
  in_progress: '执行中',
  agent_executing: '执行中',
  qa_review: '待验收',
  done: '已完成',
};

interface PendingChatAttachment {
  tempId: string;
  file: File;
  name: string;
  size: number;
  previewUrl: string;
  status: 'uploading' | 'error';
  errorMessage?: string;
}

/** 会话消息首屏渲染窗口：长会话只渲染最新若干条，避免一次挂载上百条 Markdown 阻塞首帧 */
const CHAT_WINDOW_SIZE = 30;

/** 会话状态 SWR 缓存：再次打开同一任务时立即呈现对话，避免整包重拉与空白等待 */
const sessionStateCache = new Map<string, TaskSessionState>();
const SESSION_CACHE_MAX = 3;

const cacheSessionState = (taskId: string, state: TaskSessionState) => {
  sessionStateCache.delete(taskId);
  sessionStateCache.set(taskId, state);
  while (sessionStateCache.size > SESSION_CACHE_MAX) {
    sessionStateCache.delete(sessionStateCache.keys().next().value as string);
  }
};

export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks,
  workflows,
  onOpenTaskLogs,
  onRefresh,
  onTaskUpdate,
  selectedWorkspaceFilter,
  onWorkspaceFilterChange,
  onOpenAgentSession,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [visualAcceptanceTask, setVisualAcceptanceTask] = useState<Task | null>(null);

  // 设为子任务 / 变更所属父需求弹窗状态
  const [parentSelectTask, setParentSelectTask] = useState<Task | null>(null);
  // 需求容器吸纳关联已有任务弹窗状态（存储当前操作的容器父任务）
  const [linkExistingParentTask, setLinkExistingParentTask] = useState<Task | null>(null);

  // 项目工程级别筛选
  const [internalWorkspaceFilter, setInternalWorkspaceFilter] = useState<string>('all');
  const activeWorkspaceFilter = selectedWorkspaceFilter !== undefined ? selectedWorkspaceFilter : internalWorkspaceFilter;
  const [isWsDropdownOpen, setIsWsDropdownOpen] = useState(false);
  const wsDropdownRef = useRef<HTMLDivElement>(null);

  const handleSelectWorkspaceFilter = (ws: string) => {
    if (onWorkspaceFilterChange) {
      onWorkspaceFilterChange(ws);
    } else {
      setInternalWorkspaceFilter(ws);
    }
    if (import.meta.env?.DEV) {
      console.log('[KanbanView] 切换工程项目过滤:', { from: activeWorkspaceFilter, to: ws });
    }
  };

  const handleSelectCustomDirectoryForFilter = async () => {
    try {
      setIsWsDropdownOpen(false);
      if (import.meta.env?.DEV) {
        console.log('[KanbanView] 调起原生文件管理器选择待过滤工程...');
      }
      const chosen = await api.selectDirectory();
      if (chosen) {
        handleSelectWorkspaceFilter(chosen);
      }
    } catch (err) {
      console.error('[KanbanView] 选择工程筛选失败:', err);
    }
  };

  // 任务详情工作台：宽度拖拽（双击复位）与 Agent 协作流常驻开关，均本地记忆
  const [detailWidth, setDetailWidth] = useState<number>(() => readDetailWidth());
  const [isAgentPaneOpen, setIsAgentPaneOpen] = useState<boolean>(() => readAgentPaneOpen());
  const [isResizingDetail, setIsResizingDetail] = useState(false);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const detailDragWidthRef = useRef<number>(DEFAULT_DETAIL_WIDTH);

  const applyDetailWidth = (width: number) => {
    // 通过 CSS 变量直接下发宽度，拖拽过程零 React 重渲染
    detailPanelRef.current?.style.setProperty('--openloop-workbench-width', `${width}px`);
  };

  const handleDetailResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    detailDragWidthRef.current = detailWidth;
    setIsResizingDetail(true);
  };

  useEffect(() => {
    if (!isResizingDetail) return;
    const handleMove = (event: MouseEvent) => {
      const next = clampDetailWidth(window.innerWidth - event.clientX);
      detailDragWidthRef.current = next;
      applyDetailWidth(next);
    };
    const handleUp = () => {
      const next = detailDragWidthRef.current;
      setIsResizingDetail(false);
      setDetailWidth(next);
      saveDetailWidth(next);
      if (import.meta.env?.DEV) console.log('[KanbanView:Workbench] 拖拽调整工作台宽度:', next);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isResizingDetail]);

  const handleResetDetailWidth = () => {
    const next = clampDetailWidth(DEFAULT_DETAIL_WIDTH);
    applyDetailWidth(next);
    setDetailWidth(next);
    saveDetailWidth(next);
    if (import.meta.env?.DEV) console.log('[KanbanView:Workbench] 双击复位工作台宽度:', next);
  };

  const handleToggleAgentPane = () => {
    setIsAgentPaneOpen((prev) => {
      const next = !prev;
      saveAgentPaneOpen(next);
      if (import.meta.env?.DEV) console.log('[KanbanView:Workbench] 切换 Agent 协作流常驻栏:', next);
      return next;
    });
  };

  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [skippingTaskId, setSkippingTaskId] = useState<string | null>(null);
  const [retryingNodeKey, setRetryingNodeKey] = useState<string | null>(null);
  const [isCustomRetrying, setIsCustomRetrying] = useState<boolean>(false);
  const [cancellingTaskId, setCancellingTaskId] = useState<string | null>(null);

  const handleCancelTask = async (taskId: string) => {
    setCancellingTaskId(taskId);
    try {
      await api.cancelTask(taskId);
      toast.info('任务已终止');
      onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 终止任务失败:', e);
      }
      toast.error(`终止任务失败: ${e?.message || '未知错误'}`);
    } finally {
      setCancellingTaskId(null);
    }
  };
  const [previewArtifact, setPreviewArtifact] = useState<{ name: string; path: string } | null>(null);
  const [activeDetailImage, setActiveDetailImage] = useState<TaskAttachment | null>(null);
  const [activeDetailImageList, setActiveDetailImageList] = useState<TaskAttachment[]>([]);
  const [selectedWorkflowFilter, setSelectedWorkflowFilter] = useState<string>('all');
  const [isWfDropdownOpen, setIsWfDropdownOpen] = useState(false);
  const wfDropdownRef = useRef<HTMLDivElement>(null);

  // Inbox 列快速添加想法状态
  const [isQuickAddingIdea, setIsQuickAddingIdea] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);

  // 任务详情工作台：左侧档案视图（懒加载 + 常驻缓存）与右侧 Agent 协作流同屏
  const [drawerTab, setDrawerTab] = useState<'overview' | 'timeline' | 'subtasks'>('overview');
  const [visitedPanes, setVisitedPanes] = useState<Record<string, boolean>>({ overview: true });
  const [drawerIdCopied, setDrawerIdCopied] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  
  // 需求工序裂变与 AI 协同规划状态
  const [isPlanningAi, setIsPlanningAi] = useState(false);
  const [aiPlanPreview, setAiPlanPreview] = useState<Array<{
    title: string;
    workflowId: string;
    workspace?: string;
    dependencies?: string[];
  }> | null>(null);
  const [isAddingManualSubtask, setIsAddingManualSubtask] = useState(false);
  const [manualSubtaskTitle, setManualSubtaskTitle] = useState('');
  const [manualSubtaskDesc, setManualSubtaskDesc] = useState('');
  const [manualSubtaskAttachments, setManualSubtaskAttachments] = useState<TaskAttachment[]>([]);
  const [manualSubtaskWorkflowId, setManualSubtaskWorkflowId] = useState('');
  const [manualSubtaskDep, setManualSubtaskDep] = useState('');
  const [manualSubtaskWorkspace, setManualSubtaskWorkspace] = useState('');

  const [sessionState, setSessionState] = useState<TaskSessionState | null>(null);
  const [chatWindowSize, setChatWindowSize] = useState(CHAT_WINDOW_SIZE);
  const chatScrollAnchorRef = useRef<number | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isPausingSession, setIsPausingSession] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const chatAutocompleteRef = useRef<AgentAutocompletePopoverHandle>(null);

  const {
    containerRef: chatScrollContainerRef,
    bottomRef: chatMessagesEndRef,
    isAtBottom: isChatAtBottom,
    hasNewOutput: hasNewChatOutput,
    handleScroll: handleChatScroll,
    handleWheel: handleChatWheel,
    scrollToBottom: scrollChatToBottom,
  } = useChatAutoScroll({
    dataKey: sessionState,
    isActive: !!selectedTask && isAgentPaneOpen,
    resetKey: selectedTask?.id,
  });

  // 展开更早消息后按距底距离回正滚动位置，避免长历史插入导致视觉跳动
  useLayoutEffect(() => {
    const scroller = chatScrollContainerRef.current;
    if (!scroller || chatScrollAnchorRef.current === null) return;
    scroller.scrollTop = scroller.scrollHeight - chatScrollAnchorRef.current;
    chatScrollAnchorRef.current = null;
  }, [chatWindowSize]);

  // 打开任务抽屉时同步获取最新 Session 状态
  useEffect(() => {
    setExpandedThinking({});
    setExpandedTools({});
    setChatWindowSize(CHAT_WINDOW_SIZE);
    if (selectedTask) {
      // 命中缓存先即时上屏，再静默拉取最新状态校准
      const cached = sessionStateCache.get(selectedTask.id);
      if (cached) {
        if (import.meta.env?.DEV) {
          console.log('[KanbanView:Drawer] 命中会话缓存，秒开历史对话:', {
            taskId: selectedTask.id,
            messages: cached.messages.length,
          });
        }
        setSessionState(cached);
      }
      api.getTaskSession(selectedTask.id)
        .then((state) => {
          if (import.meta.env?.DEV) {
            console.log('[KanbanView:Drawer] 拉取会话状态:', {
              taskId: selectedTask.id,
              isBusy: state.isBusy,
              messages: state.messages.length,
            });
          }
          const next = state ? { ...state, messages: sanitizeChatMessages(state.messages) } : null;
          if (next) cacheSessionState(selectedTask.id, next);
          setSessionState(next);
          // 若任务正在执行中且处于 agent 状态，或已有历史消息，可智能保留或建议查看
        })
        .catch(() => {});
      setIncludeQaArtifacts(false);
    } else {
      setSessionState(null);
      setDrawerTab('overview');
      setChatInput('');
      setChatAttachments([]);
      setPendingChatUploads([]);
      setIncludeQaArtifacts(false);
      setAiPlanPreview(null);
      setIsAddingManualSubtask(false);
      setManualSubtaskTitle('');
      setManualSubtaskDesc('');
      setManualSubtaskAttachments([]);
      setManualSubtaskWorkflowId('');
      setManualSubtaskDep('');
      setManualSubtaskWorkspace('');
    }
  }, [selectedTask?.id]);

  // 实时订阅 WebSocket 推送的 agent:chat_update 事件
  useEffect(() => {
    const unsub = api.on('agent:chat_update', (data: TaskSessionState) => {
      if (selectedTask && data.taskId === selectedTask.id) {
        const next = { ...data, messages: sanitizeChatMessages(data.messages) };
        cacheSessionState(data.taskId, next);
        setSessionState(next);
      }
    });
    return () => unsub();
  }, [selectedTask?.id]);


  // 侧边栏 Agent 会话图片上传状态
  const [chatAttachments, setChatAttachments] = useState<TaskAttachment[]>([]);
  const [pendingChatUploads, setPendingChatUploads] = useState<PendingChatAttachment[]>([]);
  const [isChatDragging, setIsChatDragging] = useState(false);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // 是否主动在本次对话中附带最新自动化测试产物
  const [includeQaArtifacts, setIncludeQaArtifacts] = useState(false);
  const [expandedQaAttachments, setExpandedQaAttachments] = useState<Record<string, boolean>>({});

  // 精细选择 QA 自动化测试产物状态
  const [isQaSelectorOpen, setIsQaSelectorOpen] = useState(false);
  const [selectedQaArtifacts, setSelectedQaArtifacts] = useState<SelectedQaArtifacts | null>(null);

  // 懒加载 + 常驻缓存：档案视图首次访问后即保留 DOM，后续切换零重渲染抖动
  useEffect(() => {
    if (!selectedTask) return;
    setVisitedPanes((prev) => (prev[drawerTab] ? prev : { ...prev, [drawerTab]: true }));
  }, [drawerTab, selectedTask?.id]);

  // Esc 关闭工作台；输入中或叠加弹窗时让行，避免误关
  useEffect(() => {
    if (!selectedTask) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        editingTask ||
        taskToDelete ||
        visualAcceptanceTask ||
        parentSelectTask ||
        linkExistingParentTask ||
        activeDetailImage ||
        isQaSelectorOpen
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
      if (import.meta.env?.DEV) console.log('[KanbanView:Workbench] Esc 关闭任务工作台:', selectedTask.id);
      setSelectedTask(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedTask?.id,
    editingTask,
    taskToDelete,
    visualAcceptanceTask,
    parentSelectTask,
    linkExistingParentTask,
    activeDetailImage,
    isQaSelectorOpen,
  ]);

  // 结合全局 tasks 获取最新任务上下文信息
  const activeTask = selectedTask ? (tasks.find((t) => t.id === selectedTask.id) || selectedTask) : null;
  const currentQaRunId = activeTask?.context?.qaRunId || (activeTask?.context?.worktree as any)?.qaRunId;
  const hasQaArtifacts = Boolean(currentQaRunId);

  // 系统默认模型与当前 Agent 会话生效模型
  const [defaultModel, setDefaultModel] = useState<string>('');

  useEffect(() => {
    api.getSettings()
      .then((s) => {
        if (s?.defaultModel) {
          setDefaultModel(s.defaultModel);
          if (import.meta.env?.DEV) {
            console.log('[UI:AgentChat] 加载系统默认模型配置:', s.defaultModel);
          }
        }
      })
      .catch((err) => {
        if (import.meta.env?.DEV) {
          console.warn('[UI:AgentChat] 获取系统设置模型失败:', err);
        }
      });

    const unsub = api.on('settings:update', (updated: any) => {
      if (updated?.defaultModel !== undefined) {
        setDefaultModel(updated.defaultModel);
        if (import.meta.env?.DEV) {
          console.log('[UI:AgentChat] 实时更新默认模型配置:', updated.defaultModel);
        }
      }
    });
    return () => unsub();
  }, []);

  const effectiveChatModel = useMemo(() => {
    const raw = (
      sessionState?.model?.trim() ||
      (activeTask?.context?.model as string)?.trim() ||
      defaultModel?.trim() ||
      '默认模型'
    );
    if (defaultModel?.trim() && raw && defaultModel.trim().endsWith(`/${raw}`)) {
      return defaultModel.trim();
    }
    return raw;
  }, [sessionState?.model, activeTask?.context?.model, defaultModel]);

  const uploadChatFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    if (import.meta.env?.DEV) {
      console.log('[UI:AgentChat] 开始上传待发图片附件:', imageFiles.map((f) => f.name));
    }

    const newPendingItems: PendingChatAttachment[] = imageFiles.map((f) => ({
      tempId: `pending_chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      file: f,
      name: f.name || 'image.png',
      size: f.size,
      previewUrl: URL.createObjectURL(f),
      status: 'uploading',
    }));

    setPendingChatUploads((prev) => [...prev, ...newPendingItems]);

    for (const item of newPendingItems) {
      try {
        const uploaded = await api.uploadAttachment(item.file);
        setChatAttachments((prev) => [...prev, uploaded]);
        URL.revokeObjectURL(item.previewUrl);
        setPendingChatUploads((prev) => prev.filter((p) => p.tempId !== item.tempId));
      } catch (err: any) {
        setPendingChatUploads((prev) =>
          prev.map((p) =>
            p.tempId === item.tempId
              ? { ...p, status: 'error', errorMessage: err.message || '上传失败' }
              : p
          )
        );
      }
    }
  };

  const handleChatPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      uploadChatFiles(imageFiles);
    }
  };

  const handleChatDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isChatDragging) setIsChatDragging(true);
  };

  const handleChatDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsChatDragging(false);
    }
  };

  const handleChatDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsChatDragging(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      uploadChatFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleRemoveChatAttachment = (id: string) => {
    setChatAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleRemovePendingChat = (tempId: string) => {
    const item = pendingChatUploads.find((p) => p.tempId === tempId);
    if (item) {
      URL.revokeObjectURL(item.previewUrl);
    }
    setPendingChatUploads((prev) => prev.filter((p) => p.tempId !== tempId));
  };

  const handleRetryChatUpload = async (item: PendingChatAttachment) => {
    setPendingChatUploads((prev) =>
      prev.map((p) =>
        p.tempId === item.tempId ? { ...p, status: 'uploading', errorMessage: undefined } : p
      )
    );
    try {
      const uploaded = await api.uploadAttachment(item.file);
      setChatAttachments((prev) => [...prev, uploaded]);
      URL.revokeObjectURL(item.previewUrl);
      setPendingChatUploads((prev) => prev.filter((p) => p.tempId !== item.tempId));
    } catch (err: any) {
      setPendingChatUploads((prev) =>
        prev.map((p) =>
          p.tempId === item.tempId
            ? { ...p, status: 'error', errorMessage: err.message || '上传失败' }
            : p
        )
      );
    }
  };

  // 右栏新面板：测试产物计数与随消息发送的额外参数
  const selectedQaTotalCount = useMemo(
    () =>
      (selectedQaArtifacts?.steps?.length || 0) + (selectedQaArtifacts?.screenshots?.length || 0),
    [selectedQaArtifacts]
  );

  const buildChatSendExtra = useCallback(() => {
    const hasSelected =
      !!selectedQaArtifacts &&
      ((Array.isArray(selectedQaArtifacts.steps) && selectedQaArtifacts.steps.length > 0) ||
        (Array.isArray(selectedQaArtifacts.screenshots) &&
          selectedQaArtifacts.screenshots.length > 0));
    return {
      includeQaArtifacts,
      selectedQaArtifacts: hasSelected ? selectedQaArtifacts || undefined : undefined,
    };
  }, [includeQaArtifacts, selectedQaArtifacts]);

  // 发送消息（支持运行中无缝插话 Steer 与空闲时发起交互）
  const handleSendChat = async () => {
    if (!selectedTask || isSendingChat) return;
    const msg = chatInput.trim();
    const toSendAttachments = [...chatAttachments];
    const willIncludeQa = includeQaArtifacts;

    const hasSelectedArtifacts = Boolean(
      selectedQaArtifacts &&
      ((Array.isArray(selectedQaArtifacts.steps) && selectedQaArtifacts.steps.length > 0) ||
       (Array.isArray(selectedQaArtifacts.screenshots) && selectedQaArtifacts.screenshots.length > 0))
    );

    if (!msg && toSendAttachments.length === 0 && !willIncludeQa && !hasSelectedArtifacts) return;
    if (pendingChatUploads.some((p) => p.status === 'uploading')) {
      toast.warning('请等待图片附件上传完成后再发送');
      return;
    }

    // 将精选的 QA 截图注入附件列表
    if (hasSelectedArtifacts && selectedQaArtifacts?.screenshots) {
      selectedQaArtifacts.screenshots.forEach((sc) => {
        toSendAttachments.push({
          id: `att_qa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: sc.name,
          mimeType: guessImageMimeType(sc.name),
          path: sc.path,
          url: sc.url,
          createdAt: Date.now(),
        });
      });
    }

    setChatInput('');
    setChatAttachments([]);
    setIncludeQaArtifacts(false);
    const sentSelection = selectedQaArtifacts;
    setSelectedQaArtifacts(null);
    setIsSendingChat(true);
    scrollChatToBottom(true);

    const userDisplayMsg = msg || (hasSelectedArtifacts
      ? '请查看我选中的 UI 自动化测试产物与操作流程，并分析修改代码。'
      : (willIncludeQa ? '请查看最新 UI 自动化测试产物并分析修复。' : ''));

    if (import.meta.env?.DEV) {
      console.log('[UI:AgentChat] 用户向 Agent 发送对话:', {
        taskId: selectedTask.id,
        content: userDisplayMsg,
        attachmentsCount: toSendAttachments.length,
        includeQaArtifacts: willIncludeQa,
        hasSelectedQa: hasSelectedArtifacts,
      });
    }

    // 乐观更新界面
    if (sessionState) {
      setSessionState({
        ...sessionState,
        isBusy: true,
        awaitingInput: false,
        messages: [
          ...sessionState.messages,
          {
            id: `opt_${Date.now()}`,
            role: 'user',
            content: userDisplayMsg,
            attachments: toSendAttachments.length > 0 ? toSendAttachments : undefined,
            timestamp: Date.now(),
          },
        ],
      });
    }

    try {
      await api.sendTaskChatMessage(selectedTask.id, userDisplayMsg, toSendAttachments, {
        includeQaArtifacts: willIncludeQa,
        selectedQaArtifacts: hasSelectedArtifacts ? (sentSelection || undefined) : undefined,
      });
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 发送消息失败:', e);
      }
      toast.error(`发送消息失败: ${e?.message || '未知错误'}`);
    } finally {
      setIsSendingChat(false);
      // 重置 textarea 高度
      if (chatTextareaRef.current) {
        chatTextareaRef.current.style.height = 'auto';
      }
    }
  };

  // 任务会话就是同一条 pi 会话：交给上层在全局智能体里打开它
  const handleOpenAgentSession = (
    sessionId: string,
    context?: { taskId?: string; taskTitle?: string; cwd?: string }
  ) => {
    if (!onOpenAgentSession) return;
    if (import.meta.env?.DEV) {
      console.log('[KanbanView] 在全局智能体中打开会话:', sessionId, context);
    }
    onOpenAgentSession(sessionId, context);
  };

  // 暂停 / 恢复当前智能体会话
  const handleTogglePauseSession = async () => {
    if (!selectedTask || isPausingSession) return;
    setIsPausingSession(true);
    try {
      if (sessionState?.isPaused) {
        await api.resumeTaskSession(selectedTask.id);
        toast.info('智能体会话已恢复');
      } else {
        await api.pauseTaskSession(selectedTask.id);
        toast.info('智能体会话已暂停');
      }
      const updated = await api.getTaskSession(selectedTask.id);
      setSessionState(updated);
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 会话控制失败:', e);
      }
      toast.error(`会话控制失败: ${e?.message || '未知错误'}`);
    } finally {
      setIsPausingSession(false);
    }
  };

  // 向当前 Agent 会话发送快捷规划指令
  const handleSendSuggestedPrompt = async (text: string) => {
    if (!selectedTask || isSendingChat) return;
    setIsSendingChat(true);
    if (sessionState) {
      setSessionState({
        ...sessionState,
        isBusy: true,
        awaitingInput: false,
        messages: [
          ...sessionState.messages,
          {
            id: `opt_${Date.now()}`,
            role: 'user',
            content: text,
            timestamp: Date.now(),
          },
        ],
      });
    }
    try {
      await api.sendTaskChatMessage(selectedTask.id, text, []);
    } catch (e: any) {
      if (import.meta.env?.DEV) console.error('[KanbanView] 发送快捷指令失败:', e);
      toast.error(`发送失败: ${e?.message || '未知错误'}`);
    } finally {
      setIsSendingChat(false);
    }
  };

  // 确认当前节点已完成，手动放行流水线（兜底跳过）
  const handleConfirmCompleteNode = async () => {
    if (!selectedTask) return;
    if (import.meta.env?.DEV) {
      console.log('[UI:AgentChat] 请求跳过节点并放行流水线:', {
        taskId: selectedTask.id,
        nodeId: selectedTask.currentNodeId,
      });
    }
    try {
      // 乐观更新：提示条立即消失，无需等待下游节点调度完成
      setSessionState((prev) =>
        prev ? { ...prev, awaitingInput: false, isBusy: true } : prev
      );
      const updated = await api.completeNode(selectedTask.id, selectedTask.currentNodeId);
      setSelectedTask(updated);
      toast.info('已跳过当前节点，流水线继续推进');
      const latestSession = await api.getTaskSession(selectedTask.id);
      setSessionState(latestSession);
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[UI:AgentChat] 确认节点完成失败:', e);
      }
      toast.error(`放行失败: ${e?.message || '未知错误'}`);
    }
  };

  // 看板列排序规则状态 (持久化存取与各列独立/全局联动)
  const [columnSortConfig, setColumnSortConfig] = useState<ColumnSortConfigMap>(() =>
    loadColumnSortConfig(COLUMNS.map((c) => c.key))
  );
  const [openSortDropdownCol, setOpenSortDropdownCol] = useState<KanbanColumn | null>(null);
  const [isBoardSortOpen, setIsBoardSortOpen] = useState(false);
  const boardSortDropdownRef = useRef<HTMLDivElement>(null);

  const handleSetColumnSort = (colKey: KanbanColumn, rule: ColumnSortRule) => {
    console.log(`[KanbanView] 更新看板列 "${colKey}" 排序规则:`, rule);
    setColumnSortConfig((prev) => {
      const next = { ...prev, [colKey]: rule };
      saveColumnSortConfig(next);
      return next;
    });
  };

  const handleApplySortToAll = (rule: ColumnSortRule) => {
    console.log('[KanbanView] 应用排序规则至全看板所有列:', rule);
    const next = {} as ColumnSortConfigMap;
    for (const col of COLUMNS) {
      next[col.key] = { ...rule };
    }
    saveColumnSortConfig(next);
    setColumnSortConfig(next);
  };

  const handleResetColumnSort = (colKey: KanbanColumn) => {
    console.log(`[KanbanView] 重置看板列 "${colKey}" 排序规则为默认`);
    handleSetColumnSort(colKey, { ...DEFAULT_SORT_RULE });
  };

  const handleResetAllSorts = () => {
    console.log('[KanbanView] 重置所有看板列排序规则为默认');
    handleApplySortToAll({ ...DEFAULT_SORT_RULE });
  };

  const firstRule = columnSortConfig[COLUMNS[0].key] || DEFAULT_SORT_RULE;
  const isUnifiedSort = COLUMNS.every((c) => {
    const rule = columnSortConfig[c.key] || DEFAULT_SORT_RULE;
    return rule.field === firstRule.field && rule.direction === firstRule.direction;
  });
  const unifiedOption = isUnifiedSort ? findSortOption(firstRule) : null;
  const unifiedSortLabel = unifiedOption ? unifiedOption.shortLabel : '自定义';

  const wfMap = useMemo(() => new Map(workflows.map((w) => [w.id, w])), [workflows]);

  const getDirectoryName = (dirPath: string) => {
    if (!dirPath) return '';
    const trimmed = dirPath.replace(/[/\\]+$/, '');
    const parts = trimmed.split(/[/\\]/);
    return parts[parts.length - 1] || dirPath;
  };

  const compactPath = (fullPath: string) => {
    if (!fullPath) return '';
    return fullPath.replace(/^\/Users\/[^/]+/, '~');
  };

  // 聚合所有已知工程目录（任务已有 + 本地最近使用）并按活跃度排序
  const availableWorkspaces = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.triggerSource === 'shortcut' || t.triggerSource === 'debug') return;
      if (t.workspace && t.workspace.trim()) {
        set.add(t.workspace.trim());
      }
    });
    try {
      const raw = localStorage.getItem('openloop_recent_workspaces');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((ws) => {
            if (typeof ws === 'string' && ws.trim()) {
              set.add(ws.trim());
            }
          });
        }
      }
    } catch {}

    const list = Array.from(set);
    list.sort((a, b) => {
      const countA = tasks.filter((t) => t.workspace === a).length;
      const countB = tasks.filter((t) => t.workspace === b).length;
      if (countB !== countA) return countB - countA;
      return a.localeCompare(b);
    });
    return list;
  }, [tasks]);

  // 先对项目工作区进行过滤，供工作流计数联动使用
  const workspaceFilteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.triggerSource === 'shortcut' || t.triggerSource === 'debug') return false;
      if (activeWorkspaceFilter === 'none') {
        return !t.workspace || !t.workspace.trim();
      }
      if (activeWorkspaceFilter !== 'all') {
        return t.workspace === activeWorkspaceFilter;
      }
      return true;
    });
  }, [tasks, activeWorkspaceFilter]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      // 排除非看板任务（快捷运行 shortcut 与流程调试 debug 等流水线即时执行实例，仅在调用记录中呈现）
      if (t.triggerSource === 'shortcut' || t.triggerSource === 'debug') {
        return false;
      }

      // 0. 子工序默认收纳在所属任务组卡片内展示，不作为独立顶级卡片铺满泳道 (除非输入搜索词搜索命中)
      if (t.parentTaskId && !searchTerm) {
        return false;
      }

      // 1. 工程项目过滤
      if (activeWorkspaceFilter === 'none') {
        if (t.workspace && t.workspace.trim()) return false;
      } else if (activeWorkspaceFilter !== 'all') {
        if (t.workspace !== activeWorkspaceFilter) return false;
      }

      // 2. 自动化工作流过滤
      if (selectedWorkflowFilter !== 'all' && t.workflowId !== selectedWorkflowFilter) {
        return false;
      }

      // 3. 搜索词检索 (标题、ID、以及项目路径)
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        t.title.toLowerCase().includes(term) ||
        t.id.toLowerCase().includes(term) ||
        (t.workspace && t.workspace.toLowerCase().includes(term))
      );
    });
  }, [tasks, activeWorkspaceFilter, selectedWorkflowFilter, searchTerm]);

  // 缓存上一轮各泳道结果，以便未发生变化的泳道复用原数组引用，触发 KanbanLaneList 的 React.memo 跳过
  const prevTasksByColumnRef = useRef<Record<string, Task[]>>({});

  // 按泳道分流并排序（单次分流 + 各列独立排序缓存）
  const tasksByColumn = useMemo(() => {
    if (import.meta.env?.DEV) {
      console.log('[KanbanView] 重新分流并计算各泳道任务, 任务总数:', filteredTasks.length);
    }
    const grouped: Record<KanbanColumn, Task[]> = {
      inbox: [],
      backlog: [],
      in_progress: [],
      qa_review: [],
      done: [],
      agent_executing: [],
    };

    for (const t of filteredTasks) {
      const colKey =
        t.kanbanColumn === 'in_progress' || (t.kanbanColumn as string) === 'agent_executing'
          ? 'in_progress'
          : t.kanbanColumn;
      if (grouped[colKey]) {
        grouped[colKey].push(t);
      }
    }

    const prevResult = prevTasksByColumnRef.current;
    const result: Record<string, Task[]> = {};
    for (const col of COLUMNS) {
      const rule = columnSortConfig[col.key] || DEFAULT_SORT_RULE;
      const sorted = sortTasks(grouped[col.key] || [], rule);
      const prevList = prevResult[col.key];

      if (
        prevList &&
        prevList.length === sorted.length &&
        prevList.every((item, idx) => item === sorted[idx])
      ) {
        result[col.key] = prevList;
      } else {
        result[col.key] = sorted;
      }
    }

    prevTasksByColumnRef.current = result;
    return result;
  }, [filteredTasks, columnSortConfig]);

  const getTaskStatusInfo = (task: Task) => {
    switch (task.status) {
      case 'pending':
        return {
          label: '未启动',
          color: 'text-[#85858d]',
          badgeClass: 'bg-[#f1f1f4] text-[#63636b] border border-[#e3e3e8]',
          dotClass: 'bg-[#a1a1aa]',
        };
      case 'running':
        return {
          label: '自动化运行中',
          color: 'text-[#4f46e5]',
          badgeClass: 'bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb]',
          dotClass: 'bg-[#4f46e5] animate-ping',
        };
      case 'waiting_approval':
        return {
          label: '待验收',
          color: 'text-[#b45309]',
          badgeClass: 'bg-[#fef3c7] text-[#b45309] border border-[#fde68a]',
          dotClass: 'bg-[#f59e0b]',
        };
      case 'completed':
        return {
          label: '已完成',
          color: 'text-[#189a58]',
          badgeClass: 'bg-[#e4f6ec] text-[#189a58] border border-[#c3eed7]',
          dotClass: 'bg-[#189a58]',
        };
      case 'failed':
        return {
          label: '执行失败',
          color: 'text-[#e5484d]',
          badgeClass: 'bg-[#fee2e2] text-[#e5484d] border border-[#fecaca]',
          dotClass: 'bg-[#e5484d]',
        };
      case 'cancelled':
        return {
          label: '已取消',
          color: 'text-[#85858d]',
          badgeClass: 'bg-[#f1f1f4] text-[#85858d] border border-[#e3e3e8]',
          dotClass: 'bg-[#85858d]',
        };
      default:
        return {
          label: task.status,
          color: 'text-[#85858d]',
          badgeClass: 'bg-[#f1f1f4] text-[#85858d] border border-[#e3e3e8]',
          dotClass: 'bg-[#85858d]',
        };
    }
  };

  const handleRunTask = async (taskId: string) => {
    setRunningTaskId(taskId);
    if (import.meta.env?.DEV) {
      console.log('[KanbanView] 手动启动流水线调度:', taskId);
    }
    try {
      await api.runTask(taskId);
      toast.success('任务已启动执行');
      onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 启动任务失败:', e);
      }
      toast.error(`启动任务失败: ${e?.message || '未知错误'}`);
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleSkipNode = async (taskId: string, nodeId?: string) => {
    setSkippingTaskId(taskId);
    if (import.meta.env?.DEV) {
      console.log('[KanbanView] 手动跳过节点:', { taskId, nodeId });
    }
    try {
      const updated = await api.skipNode(taskId, nodeId);
      if (updated && onTaskUpdate) {
        onTaskUpdate(updated);
      }
      if (selectedTask?.id === taskId && updated) {
        setSelectedTask(updated);
      }
      toast.info('节点已跳过');
      await onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 跳过节点失败:', e);
      }
      toast.error(`跳过节点失败: ${e?.message || '未知错误'}`);
    } finally {
      setSkippingTaskId(null);
    }
  };

  const handleRetryNode = async (taskId: string, nodeId?: string) => {
    const key = `${taskId}:${nodeId || ''}`;
    setRetryingNodeKey(key);
    if (import.meta.env?.DEV) {
      console.log('[KanbanView] 仅重试单节点:', { taskId, nodeId });
    }
    try {
      const updated = await api.retryNode(taskId, nodeId);
      if (updated && onTaskUpdate) {
        onTaskUpdate(updated);
      }
      if (selectedTask?.id === taskId && updated) {
        setSelectedTask(updated);
      }
      toast.info('已触发节点重试');
      await onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 重试节点失败:', e);
      }
      toast.error(`重试节点失败: ${e?.message || '未知错误'}`);
    } finally {
      setRetryingNodeKey(null);
    }
  };

  const handleCustomRetry = async (taskId: string, payload: { selectedNodeIds: string[]; fromNodeId?: string }) => {
    setIsCustomRetrying(true);
    if (import.meta.env?.DEV) {
      console.log(`[KanbanView] 触发任务 [${taskId}] 定制重试:`, payload);
    }
    try {
      const updated = await api.customRetryTask(taskId, payload);
      if (updated && onTaskUpdate) {
        onTaskUpdate(updated);
      }
      if (selectedTask?.id === taskId && updated) {
        setSelectedTask(updated);
      }
      toast.info(`已按定制勾选启动 ${payload.selectedNodeIds.length} 个节点重试`);
      await onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 定制重试失败:', e);
      }
      toast.error(`定制重试失败: ${e?.message || '未知错误'}`);
    } finally {
      setIsCustomRetrying(false);
    }
  };

  // 任务级节点覆盖：仅改变本任务下次执行的节点参数，流水线模板保持不变
  const handleNodeOverride = async (
    taskId: string,
    payload: {
      nodeId: string;
      params?: Record<string, string> | null;
      config?: Record<string, any> | null;
      reset?: boolean;
    }
  ) => {
    if (import.meta.env?.DEV) {
      console.log(`[KanbanView] 更新任务 [${taskId}] 节点级覆盖:`, payload);
    }
    try {
      const updated = await api.setTaskNodeOverride(taskId, payload);
      if (updated) {
        onTaskUpdate?.(updated);
        if (selectedTask?.id === taskId) setSelectedTask(updated);
      }
      return updated;
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 节点级覆盖保存失败:', e);
      }
      toast.error(`参数保存失败: ${e?.message || '未知错误'}`);
      throw e;
    }
  };

  const handleMoveTaskColumn = async (taskId: string, targetCol: KanbanColumn) => {
    const currentTask = tasks.find((t) => t.id === taskId);
    if (!currentTask) return;

    setMovingTaskId(taskId);
    if (import.meta.env?.DEV) {
      console.log(`[KanbanView] 流转任务 [${taskId}] 到泳道: ${targetCol}`);
    }

    // 1. 立即乐观更新，卡片瞬间移入目标泳道，提供零延迟交互体验
    const optimisticTask: Task = { ...currentTask, kanbanColumn: targetCol };
    onTaskUpdate?.(optimisticTask);
    if (selectedTask?.id === taskId) {
      setSelectedTask(optimisticTask);
    }

    try {
      const updated = await api.moveTaskColumn(taskId, targetCol);
      if (updated && onTaskUpdate) {
        onTaskUpdate(updated);
      }
      if (selectedTask?.id === taskId && updated) {
        setSelectedTask(updated);
      }
      await onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 流转泳道失败:', e);
      }
      // 失败回滚
      onTaskUpdate?.(currentTask);
      if (selectedTask?.id === taskId) {
        setSelectedTask(currentTask);
      }
      toast.error(`移动泳道失败: ${e?.message || '未知错误'}`);
    } finally {
      setMovingTaskId(null);
    }
  };

  // 归档任务：子工序已全部完成时，将其标记为已完成并归入「已完成」泳道
  const handleArchiveTask = async (taskId: string) => {
    const currentTask = tasks.find((t) => t.id === taskId);
    if (!currentTask) return;
    if (import.meta.env?.DEV) {
      console.log(`[KanbanView] 归档任务 [${taskId}] 至已完成状态`);
    }

    const optimisticTask: Task = { ...currentTask, status: 'completed', kanbanColumn: 'done' };
    onTaskUpdate?.(optimisticTask);
    if (selectedTask?.id === taskId) setSelectedTask(optimisticTask);

    try {
      const updated = await api.archiveTask(taskId);
      if (updated) {
        onTaskUpdate?.(updated);
        if (selectedTask?.id === taskId) setSelectedTask(updated);
      }
      toast.success('已归档至已完成');
      await onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 归档任务失败:', e);
      }
      onTaskUpdate?.(currentTask);
      if (selectedTask?.id === taskId) setSelectedTask(currentTask);
      toast.error(`归档失败: ${e?.message || '未知错误'}`);
    }
  };

  // Inbox 快捕回包就地合并：新建任务或子工序都不重拉整块看板
  const handleIdeaCreated = ({ task, subtask, parent }: { task?: Task; subtask?: Task; parent?: Task }) => {
    if (import.meta.env?.DEV) {
      console.log('[KanbanView:InboxQuickAdd] 快捕回包合并:', {
        task: task?.id,
        subtask: subtask?.id,
        parent: parent?.id,
      });
    }
    if (task) onTaskUpdate?.(task);
    if (subtask) onTaskUpdate?.(subtask);
    if (parent) onTaskUpdate?.(parent);
  };

  const handleConfirmDelete = async () => {
    if (!taskToDelete) return;
    if (import.meta.env?.DEV) {
      console.log('[Kanban:TaskDelete] 确认删除任务:', taskToDelete.id, taskToDelete.title);
    }
    setIsDeleting(true);
    try {
      await api.deleteTask(taskToDelete.id);
      if (selectedTask?.id === taskToDelete.id) {
        setSelectedTask(null);
      }
      setTaskToDelete(null);
      toast.success('任务已成功删除');
      onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[Kanban:TaskDelete] 删除任务失败:', e);
      }
      toast.error(`删除任务失败: ${e?.message || '未知错误'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveEditedTask = async (params: {
    title: string;
    description: string;
    workflowId: string;
    kanbanColumn?: KanbanColumn;
    workspace?: string;
    attachments?: TaskAttachment[];
    parentTaskId?: string | null;
  }) => {
    if (!editingTask) return;
    if (import.meta.env?.DEV) {
      console.log('[Kanban:TaskEdit] 发起任务更新:', editingTask.id, params);
    }
    try {
      const updated = await api.updateTask(editingTask.id, params);
      if (selectedTask?.id === editingTask.id) {
        setSelectedTask(updated);
      }
      onTaskUpdate?.(updated);
      if (import.meta.env?.DEV) {
        console.log('[Kanban:TaskEdit] 任务更新成功:', updated.id);
      }
      await onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[Kanban:TaskEdit] 任务更新异常:', e);
      }
      throw e;
    }
  };

  // 任务组卡片内直接追加工序：接口回包就地合并，避免整块看板重拉
  const handleAddSubtask = async (
    parentId: string,
    params: { title: string; workflowId?: string; attachments?: TaskAttachment[] }
  ) => {
    try {
      if (import.meta.env?.DEV) {
        console.log('[KanbanView:SubtaskQuickAdd] 追加工序:', { parentId, ...params });
      }
      const res = await api.addSubTask(parentId, params);
      onTaskUpdate?.(res.subtask);
      onTaskUpdate?.(res.parent);
      setSelectedTask((prev) => (prev && prev.id === parentId ? res.parent : prev));
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView:SubtaskQuickAdd] 追加工序失败:', err);
      }
      toast.error(`添加工序失败: ${err?.message || '未知错误'}`);
      throw err;
    }
  };

  // 多行批量追加：一次请求提交多条工序，回包同样就地合并
  const handleAddSubtasks = async (
    parentId: string,
    items: Array<{ title: string; workflowId?: string; attachments?: TaskAttachment[] }>
  ) => {
    try {
      if (import.meta.env?.DEV) {
        console.log('[KanbanView:SubtaskBatchAdd] 批量追加工序:', { parentId, count: items.length, items });
      }
      const res = await api.batchAddSubTasks(parentId, { subtasks: items });
      for (const subtask of res.subtasks) {
        onTaskUpdate?.(subtask);
      }
      onTaskUpdate?.(res.parent);
      setSelectedTask((prev) => (prev && prev.id === parentId ? res.parent : prev));
      toast.success(`已批量追加 ${res.subtasks.length} 条工序`);
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView:SubtaskBatchAdd] 批量追加工序失败:', err);
      }
      toast.error(`批量添加工序失败: ${err?.message || '未知错误'}`);
      throw err;
    }
  };

  const handleUnlinkSubtask = async (parentId: string, subtaskId: string) => {
    try {
      if (import.meta.env?.DEV) {
        console.log(`[KanbanView] 解绑子工序: 任务组 ${parentId}, 子工序 ${subtaskId}`);
      }
      await api.unlinkSubTask(parentId, subtaskId);
      toast.success('已将工序脱离任务组，恢复为独立任务');
      await onRefresh();
    } catch (err: any) {
      toast.error(`解绑失败: ${err.message}`);
    }
  };

  const handleApprove = async (taskId: string, approved: boolean, feedback?: string) => {
    const currentTask = tasks.find((t) => t.id === taskId);
    if (!currentTask) return;

    setApprovingId(taskId);
    if (import.meta.env?.DEV) {
      console.log(`[KanbanView] 触发任务验收决策 [${taskId}]:`, { approved, feedback });
    }

    // 1. 立即乐观更新，卡片平滑流转，彻底避免全看板重置与数据空闪
    const wf = wfMap.get(currentTask.workflowId);
    const nextEdges = wf?.edges.filter((e) => e.source === currentTask.currentNodeId) || [];
    const nextCol: KanbanColumn = approved ? (nextEdges.length > 0 ? 'in_progress' : 'done') : 'backlog';
    const nextStatus = approved ? (nextEdges.length > 0 ? 'running' : 'completed') : 'failed';
    const optimisticTask: Task = {
      ...currentTask,
      kanbanColumn: nextCol,
      status: nextStatus,
    };
    onTaskUpdate?.(optimisticTask);
    if (selectedTask?.id === taskId) {
      setSelectedTask(optimisticTask);
    }

    try {
      const updated = await api.resumeTask(taskId, approved, feedback || (approved ? 'QA 查验通过' : '验收驳回'));
      if (updated && onTaskUpdate) {
        onTaskUpdate(updated);
      }
      if (selectedTask?.id === taskId && updated) {
        setSelectedTask(updated);
      }
      toast.success(approved ? 'QA 验收已通过' : '已驳回验收');
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 审批失败:', e);
      }
      // 失败回滚
      onTaskUpdate?.(currentTask);
      if (selectedTask?.id === taskId) {
        setSelectedTask(currentTask);
      }
      toast.error(`审批失败: ${e?.message || '未知错误'}`);
    } finally {
      setApprovingId(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isWsDropdownOpen) {
          setIsWsDropdownOpen(false);
        } else if (isWfDropdownOpen) {
          setIsWfDropdownOpen(false);
        } else if (isBoardSortOpen) {
          setIsBoardSortOpen(false);
        } else if (openSortDropdownCol) {
          setOpenSortDropdownCol(null);
        } else if (editingTask) {
          setEditingTask(null);
        } else if (previewArtifact) {
          setPreviewArtifact(null);
        } else if (visualAcceptanceTask) {
          setVisualAcceptanceTask(null);
        } else if (isQaSelectorOpen) {
          setIsQaSelectorOpen(false);
        } else if (taskToDelete) {
          if (!isDeleting) setTaskToDelete(null);
        } else if (selectedTask) {
          setSelectedTask(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isWsDropdownOpen,
    isWfDropdownOpen,
    isBoardSortOpen,
    openSortDropdownCol,
    editingTask,
    previewArtifact,
    visualAcceptanceTask,
    isQaSelectorOpen,
    taskToDelete,
    isDeleting,
    selectedTask,
  ]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target as Node)) {
        setIsWsDropdownOpen(false);
      }
      if (wfDropdownRef.current && !wfDropdownRef.current.contains(e.target as Node)) {
        setIsWfDropdownOpen(false);
      }
      if (boardSortDropdownRef.current && !boardSortDropdownRef.current.contains(e.target as Node)) {
        setIsBoardSortOpen(false);
      }
    };
    if (isWsDropdownOpen || isWfDropdownOpen || isBoardSortOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isWsDropdownOpen, isWfDropdownOpen, isBoardSortOpen]);

  let currentWsLabel = '全部项目';
  let currentWsTaskCount = tasks.length;

  if (activeWorkspaceFilter === 'none') {
    currentWsLabel = '未关联工程';
    currentWsTaskCount = tasks.filter((t) => !t.workspace || !t.workspace.trim()).length;
  } else if (activeWorkspaceFilter !== 'all') {
    currentWsLabel = getDirectoryName(activeWorkspaceFilter);
    currentWsTaskCount = tasks.filter((t) => t.workspace === activeWorkspaceFilter).length;
  }

  const currentWf = workflows.find((w) => w.id === selectedWorkflowFilter);
  const currentWfLabel = selectedWorkflowFilter === 'all' ? '全部工作流' : (currentWf?.name || selectedWorkflowFilter);
  const currentWfTaskCount = selectedWorkflowFilter === 'all'
    ? workspaceFilteredTasks.length
    : workspaceFilteredTasks.filter((t) => t.workflowId === selectedWorkflowFilter).length;

  // 会话消息流单独缓存：输入框逐键输入不触发历史消息与 Markdown 重渲染
  const chatMessageList = useMemo(() => {
    const curTask = activeTask || selectedTask;
    if (!sessionState) {
      return (
        <div className="h-full min-h-[220px] flex items-center justify-center gap-1.5 text-[11.5px] text-[#85858d]">
          <Loader2 size={12} className="animate-spin text-[#4f46e5]" />
          <span>正在载入会话记录...</span>
        </div>
      );
    }
    if (sessionState.messages.length === 0) {
      if (curTask?.kind === 'group') {
        return (
          <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center p-6 text-[#85858d]">
            <div className="w-11 h-11 rounded-[10px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center justify-center mb-2.5 text-[#4f46e5] shadow-xs">
              <Layers size={20} />
            </div>
            <div className="text-[13px] font-semibold text-[#1c1c21] mb-1">
              任务组架构师 (Task Group Architect)
            </div>
            <div className="text-[11px] text-[#71717a] leading-relaxed max-w-[320px] mb-4">
              我是当前任务组的规划架构师。我不直接修改工程代码，专注于探查工作区目录、与您沟通需求、拆解独立工序并规划执行方案。
            </div>
            <div className="flex flex-col gap-1.5 w-full max-w-[320px]">
              <button
                type="button"
                onClick={() =>
                  handleSendSuggestedPrompt(
                    '请分析当前需求与工作区目录结构，帮我规划并拆解为可独立闭环执行的子任务。'
                  )
                }
                className="w-full text-left px-2.5 py-1.5 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#fafafc] hover:border-[#c7d2fe] text-[11px] text-[#4b4b53] hover:text-[#4f46e5] flex items-center justify-between transition-all shadow-2xs cursor-pointer group"
              >
                <span>🔍 分析需求与工作区目录并拆解</span>
                <ArrowRight
                  size={11}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[#4f46e5]"
                />
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSendSuggestedPrompt(
                    '请帮我梳理当前任务的工序拆解方案并生成执行规划。'
                  )
                }
                className="w-full text-left px-2.5 py-1.5 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#fafafc] hover:border-[#c7d2fe] text-[11px] text-[#4b4b53] hover:text-[#4f46e5] flex items-center justify-between transition-all shadow-2xs cursor-pointer group"
              >
                <span>📋 梳理拆解方案与执行工序</span>
                <ArrowRight
                  size={11}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[#4f46e5]"
                />
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-6 text-[#85858d]">
          <div className="w-11 h-11 rounded-[10px] bg-[#f4f4f6] border border-[#e3e3e8] flex items-center justify-center mb-2.5">
            <Bot size={20} className="text-[#85858d]" />
          </div>
          <div className="text-[12.5px] font-medium text-[#1c1c21] mb-1">Agent 实时交互会话</div>
          <div className="text-[11px] text-[#85858d] leading-relaxed max-w-[280px]">
            启动任务后，智能体的深度思考、工具调用与代码生成将在此毫秒级流式展现；您亦可在下方随时插话或纠偏。
          </div>
        </div>
      );
    }
    // 长会话只渲染最新窗口，余下由顶部入口按需展开，保证首帧与流式刷新都轻量
    const hiddenCount = Math.max(0, sessionState.messages.length - chatWindowSize);
    return (
      <>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => {
              if (import.meta.env.DEV) {
                console.log('[KanbanView:AgentChat] 展开更早的会话消息:', { hiddenCount });
              }
              const scroller = chatScrollContainerRef.current;
              // 记录距底距离，展开后保持视觉不跳动
              if (scroller) chatScrollAnchorRef.current = scroller.scrollHeight - scroller.scrollTop;
              setChatWindowSize((size) => size + CHAT_WINDOW_SIZE * 2);
            }}
            className="w-full py-1.5 text-[11px] text-[#85858d] hover:text-[#4f46e5] transition-colors cursor-pointer"
          >
            展开更早的 {hiddenCount} 条会话消息
          </button>
        )}
        {sessionState.messages.slice(hiddenCount).map((msg, localIdx) => {
        const msgIdx = hiddenCount + localIdx;
        if (msg.role === 'user') {
          // 检测是否包含 UI 自动化测试产物附加块
          const qaMarkerMatch = msg.content?.match(/\[(?:系统自动附加|用户主动附带|附带)：?(?:最新 UI 自动化测试产物|UI 自动化测试验收产物.*?)\]/);
          const qaMarkerIndex = qaMarkerMatch ? msg.content.indexOf(qaMarkerMatch[0]) : -1;
          const userText = qaMarkerIndex !== -1 ? msg.content.slice(0, qaMarkerIndex).trim() : msg.content;
          const qaText = qaMarkerIndex !== -1 ? msg.content.slice(qaMarkerIndex).trim() : '';

          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-[9px] px-3.5 py-2.5 bg-[#f4f4f6] border border-[#e3e3e8] text-[#1c1c21] text-[12px] leading-relaxed shadow-sm">
                <div className="text-[9.5px] font-mono text-[#85858d] mb-1 text-right">YOU</div>
                {userText && <div className="whitespace-pre-wrap">{userText}</div>}

                {/* 自动化测试产物折叠卡片 */}
                {qaText && (
                  <div className={`${userText ? 'mt-2 pt-2 border-t border-[#e6e6ec]' : ''}`}>
                    <button
                      type="button"
                      onClick={() => setExpandedQaAttachments((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] bg-[#eeedfd] border border-[#c7d2fe] text-[#4f46e5] text-[10.5px] font-medium hover:bg-[#e0e0fc] transition-colors cursor-pointer"
                    >
                      <FlaskConical size={10.5} />
                      <span>随附 UI 自动化测试产物</span>
                      {expandedQaAttachments[msg.id] ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    </button>
                    {expandedQaAttachments[msg.id] && (
                      <div className="mt-1.5 p-2 rounded-[5px] bg-white border border-[#e3e3e8] font-mono text-[10px] text-[#63636b] leading-relaxed whitespace-pre-wrap max-h-[160px] overflow-y-auto">
                        {qaText}
                      </div>
                    )}
                  </div>
                )}

                {/* 用户随附图片缩略图画廊 */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className={`flex flex-wrap gap-1.5 ${msg.content ? 'mt-2 pt-2 border-t border-[#e6e6ec]' : ''}`}>
                    {msg.attachments.map((att) => {
                      const displayUrl = api.getAttachmentUrl(att.url || att.path || '');
                      return (
                        <div
                          key={att.id}
                          onClick={() => {
                            if (import.meta.env?.DEV) console.log('[KanbanView:Chat] 预览消息附件图片:', att.name);
                            setActiveDetailImageList(msg.attachments || []);
                            setActiveDetailImage(att);
                          }}
                          className="group relative w-[60px] h-[60px] rounded-[6px] border border-[#d8d8de] bg-white overflow-hidden shadow-xs hover:border-[#4f46e5] cursor-pointer transition-all"
                          title={`${att.name}\n${(att.size / 1024).toFixed(0)} KB\n点击放大查看`}
                        >
                          <img
                            src={displayUrl}
                            alt={att.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <ZoomIn size={12} className="text-white" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        }

        return (
          <div key={msg.id} className="space-y-2">
            {/* 深度思考模块 Thinking */}
            {msg.thinking && (
              <div className="rounded-[7px] border border-[#e8e8ed] bg-[#fafafc] overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    if (import.meta.env.DEV) {
                      console.log('[KanbanView:AgentChat] 切换思考过程展开:', { msgId: msg.id, current: !!expandedThinking[msg.id] });
                    }
                    setExpandedThinking((p) => ({ ...p, [msg.id]: !p[msg.id] }));
                  }}
                  className="w-full px-2.5 py-1.5 flex items-center justify-between text-[#63636b] hover:bg-[#f1f1f4] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={11} className={msg.isThinking ? 'text-[#7c3aed] animate-spin' : 'text-[#7c3aed]'} />
                    <span className="font-medium text-[11px]">
                      {msg.isThinking ? '智能体深度思考中...' : '深度思考过程'}
                    </span>
                    {msg.isThinking && <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-pulse" />}
                  </div>
                  {expandedThinking[msg.id] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
                {expandedThinking[msg.id] && (
                  <div className="p-2.5 border-t border-[#e8e8ed] bg-[#f5f5f8] font-mono text-[10.5px] text-[#63636b] leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                    {msg.thinking}
                  </div>
                )}
              </div>
            )}

            {/* 工具调用卡片 Tools */}
            {msg.tools && msg.tools.length > 0 && (
              <div className="space-y-1.5">
                {msg.tools.map((tool) => (
                  <div key={tool.id} className="rounded-[6px] border border-[#e3e3e8] bg-white overflow-hidden text-[11px]">
                    <div
                      onClick={() => {
                        if (import.meta.env.DEV) {
                          console.log('[KanbanView:AgentChat] 切换工具输出展开:', { toolId: tool.id, toolName: tool.name });
                        }
                        setExpandedTools((p) => ({ ...p, [tool.id]: !p[tool.id] }));
                      }}
                      className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#f9f9fb] transition-colors"
                    >
                      <div className="flex items-center gap-1.5 truncate mr-2 flex-1 min-w-0">
                        <Terminal size={11} className="text-[#4f46e5] shrink-0" />
                        <span className="font-mono font-semibold text-[#1c1c21] shrink-0">{tool.name}</span>
                        {tool.args && (
                          <span
                            className="font-mono text-[#85858d] truncate flex-1 min-w-0"
                            title={formatToolArgs(tool.name, tool.args)}
                          >
                            {formatToolArgs(tool.name, tool.args)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {tool.status === 'running' ? (
                          <span className="text-[#4f46e5] flex items-center gap-1 text-[10px]">
                            <Loader2 size={10} className="animate-spin text-[#4f46e5]" />
                            执行中
                          </span>
                        ) : tool.status === 'success' ? (
                          <span className="text-[#189a58] flex items-center gap-0.5 text-[10px]">
                            <Check size={10.5} />
                            {tool.durationMs ? `${(tool.durationMs / 1000).toFixed(1)}s` : '完成'}
                          </span>
                        ) : (
                          <span className="text-[#d64545] flex items-center gap-0.5 text-[10px]">
                            <AlertCircle size={10.5} />
                            失败
                          </span>
                        )}
                        {expandedTools[tool.id] ? <ChevronDown size={11} className="text-[#85858d]" /> : <ChevronRight size={11} className="text-[#85858d]" />}
                      </div>
                    </div>
                    {expandedTools[tool.id] && (
                      <div className="p-2 border-t border-[#ececf0] bg-[#1c1c21] text-[#e3e3e8] font-mono text-[10px] leading-relaxed max-h-[220px] overflow-y-auto">
                        {tool.result ? (
                          <pre className="whitespace-pre-wrap break-all select-text font-mono">
                            {extractToolResultText(tool.result)}
                          </pre>
                        ) : (
                          <span className="text-[#85858d]">暂无输出内容</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Assistant 回复正文 */}
            {msg.content && (
              <div className="p-3 rounded-[9px] bg-white border border-[#e3e3e8] shadow-sm select-text">
                <AgentMarkdown
                  content={msg.content}
                  isStreaming={!!sessionState?.isBusy && msgIdx === sessionState.messages.length - 1}
                  taskId={curTask?.id}
                  parentWorkspace={curTask?.workspace}
                  workflows={workflows}
                  onAppliedPlan={onRefresh}
                />
              </div>
            )}

            {/* 报错提示 */}
            {msg.errorMessage && (
              <div className="p-3 rounded-[9px] bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-[12px] flex items-start gap-2 shadow-2xs">
                <AlertCircle size={15} className="shrink-0 mt-0.5 text-[#dc2626]" />
                <div className="flex-1 min-w-0 break-words">
                  <div className="font-medium text-[11.5px] text-[#991b1b] mb-0.5">模型接口异常</div>
                  <div className="font-mono text-[11px] text-[#dc2626] whitespace-pre-wrap">{msg.errorMessage}</div>
                </div>
              </div>
            )}
          </div>
        );
                    })}
      </>
    );
  }, [
    sessionState,
    chatWindowSize,
    expandedThinking,
    expandedTools,
    expandedQaAttachments,
    activeTask,
    selectedTask,
    workflows,
    onRefresh,
  ]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-hidden select-none">
      {/* 1:1 magpie 风格次级工具栏 (Sub-header) */}
      <div className="px-6 py-2 bg-transparent flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {/* 项目工程筛选器下拉选择器 */}
          <div className="relative" ref={wsDropdownRef}>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setIsWsDropdownOpen(!isWsDropdownOpen)}
                className={`flex items-center gap-1.5 px-2.5 h-[28px] rounded-[6px] border transition-all shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-[12px] font-medium cursor-pointer ${
                  isWsDropdownOpen
                    ? 'border-[#4f46e5] bg-white ring-2 ring-[#4f46e5]/10 text-[#1c1c21]'
                    : activeWorkspaceFilter !== 'all'
                    ? 'border-[#d8d6fb] bg-[#f5f5ff]/70 text-[#4f46e5] hover:bg-[#eeedfd]'
                    : 'border-[#e3e3e8] bg-white text-[#1c1c21] hover:bg-[#f9f9fb]'
                }`}
                title={
                  activeWorkspaceFilter !== 'all' && activeWorkspaceFilter !== 'none'
                    ? `当前聚焦工程: ${activeWorkspaceFilter}`
                    : '按工程项目筛选任务'
                }
              >
                <FolderGit2
                  size={12}
                  className={activeWorkspaceFilter !== 'all' ? 'text-[#4f46e5]' : 'text-[#85858d]'}
                />
                <span className="font-semibold max-w-[140px] truncate">{currentWsLabel}</span>
                <span
                  className={`font-mono text-[11px] px-1.5 py-[1px] rounded border ${
                    activeWorkspaceFilter !== 'all'
                      ? 'bg-[#eeedfd] text-[#4f46e5] border-[#d8d6fb]'
                      : 'text-[#85858d] bg-[#f4f4f6] border-[#ececf0]'
                  }`}
                >
                  {currentWsTaskCount}
                </span>
                <ChevronDown
                  size={12}
                  className={`text-[#85858d] transition-transform duration-150 ${
                    isWsDropdownOpen ? 'rotate-180 text-[#4f46e5]' : ''
                  }`}
                />
              </button>

              {/* 激活非全部状态时提供快速清除按钮 */}
              {activeWorkspaceFilter !== 'all' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectWorkspaceFilter('all');
                  }}
                  className="ml-1 w-5 h-5 rounded-[4px] flex items-center justify-center text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] transition-colors"
                  title="清除项目筛选，查看全部任务"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* 下拉浮层 */}
            {isWsDropdownOpen && (
              <div className="absolute top-[34px] left-0 w-[300px] bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_10px_26px_rgba(20,22,30,0.12)] py-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1 text-[10.5px] font-semibold text-[#85858d] uppercase tracking-wider flex items-center justify-between border-b border-[#ececf0] pb-1.5 mb-1">
                  <span>工程项目筛选</span>
                  {activeWorkspaceFilter !== 'all' && (
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectWorkspaceFilter('all');
                        setIsWsDropdownOpen(false);
                      }}
                      className="text-[10px] text-[#4f46e5] hover:underline font-normal cursor-pointer"
                    >
                      重置为全部
                    </button>
                  )}
                </div>

                {/* 全部项目 */}
                <button
                  type="button"
                  onClick={() => {
                    handleSelectWorkspaceFilter('all');
                    setIsWsDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between text-[12px] hover:bg-[#f4f4f6] transition-colors ${
                    activeWorkspaceFilter === 'all'
                      ? 'text-[#1c1c21] font-medium bg-[#f9f9fb]'
                      : 'text-[#4b4b53]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-[4px] bg-[#f1f1f4] flex items-center justify-center text-[#85858d]">
                      <Folder size={12} />
                    </div>
                    <span>全部项目 (所有工程)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                      {tasks.length}
                    </span>
                    {activeWorkspaceFilter === 'all' && (
                      <Check size={13} className="text-[#1c1c21]" />
                    )}
                  </div>
                </button>

                {/* 未关联独立工程 */}
                <button
                  type="button"
                  onClick={() => {
                    handleSelectWorkspaceFilter('none');
                    setIsWsDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between text-[12px] hover:bg-[#f4f4f6] transition-colors ${
                    activeWorkspaceFilter === 'none'
                      ? 'text-[#1c1c21] font-medium bg-[#f9f9fb]'
                      : 'text-[#4b4b53]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-[4px] bg-[#f1f1f4] flex items-center justify-center text-[#85858d]">
                      <FolderOpen size={12} />
                    </div>
                    <span className="text-[11.5px]">未关联工程 (默认目录)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                      {tasks.filter((t) => !t.workspace || !t.workspace.trim()).length}
                    </span>
                    {activeWorkspaceFilter === 'none' && (
                      <Check size={13} className="text-[#1c1c21]" />
                    )}
                  </div>
                </button>

                <div className="my-1 border-t border-[#ececf0]" />

                {/* 具体项目列表 */}
                <div className="max-h-[220px] overflow-y-auto space-y-0.5 px-1">
                  {availableWorkspaces.length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-[#85858d] text-center">
                      暂无已绑定的工程项目
                    </div>
                  ) : (
                    availableWorkspaces.map((ws) => {
                      const count = tasks.filter((t) => t.workspace === ws).length;
                      const isSelected = activeWorkspaceFilter === ws;
                      const dirName = getDirectoryName(ws);
                      const pathDisplay = compactPath(ws);

                      return (
                        <button
                          key={ws}
                          type="button"
                          onClick={() => {
                            handleSelectWorkspaceFilter(ws);
                            setIsWsDropdownOpen(false);
                          }}
                          className={`w-full px-2.5 py-1.5 text-left rounded-[6px] flex items-center justify-between text-[12px] transition-colors cursor-pointer ${
                            isSelected
                              ? 'text-[#4f46e5] font-medium bg-[#eeedfd]/60'
                              : 'text-[#4b4b53] hover:text-[#1c1c21] hover:bg-[#f9f9fb]'
                          }`}
                          title={ws}
                        >
                          <div className="flex items-center gap-2 min-w-0 pr-2">
                            <div
                              className={`w-5 h-5 rounded-[4px] flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? 'bg-[#4f46e5] text-white shadow-sm'
                                  : 'bg-[#f1f1f4] text-[#63636b]'
                              }`}
                            >
                              <FolderGit2 size={11} />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-[12px] font-medium leading-tight">
                                {dirName}
                              </div>
                              <div className="text-[10px] font-mono text-[#85858d] truncate mt-0.5">
                                {pathDisplay}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`font-mono text-[11px] px-1.5 py-[0.5px] rounded border ${
                                isSelected
                                  ? 'bg-white text-[#4f46e5] border-[#d8d6fb]'
                                  : 'text-[#85858d] bg-[#f4f4f6] border-[#ececf0]'
                              }`}
                            >
                              {count}
                            </span>
                            {isSelected && <Check size={13} className="text-[#4f46e5]" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* 底部原生访达选择新目录快速聚焦 */}
                <div className="mt-1 pt-1 border-t border-[#ececf0] px-1">
                  <button
                    type="button"
                    onClick={handleSelectCustomDirectoryForFilter}
                    className="w-full px-2.5 py-1.5 text-left rounded-[6px] text-[11px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#f9f9fb] flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <ExternalLink size={11} />
                      <span>选择本地其他工程筛选...</span>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 工作流筛选器下拉选择器 */}
          <div className="relative" ref={wfDropdownRef}>
            <button
              type="button"
              onClick={() => setIsWfDropdownOpen(!isWfDropdownOpen)}
              className={`flex items-center gap-1.5 px-2.5 h-[28px] rounded-[6px] bg-white border transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-[12px] font-medium text-[#1c1c21] cursor-pointer hover:bg-[#f9f9fb] ${
                isWfDropdownOpen ? 'border-[#b9b9c2] ring-2 ring-[#1c1c21]/5' : 'border-[#e3e3e8]'
              }`}
            >
              <GitBranch size={12} className="text-[#85858d]" />
              <span className="font-semibold max-w-[150px] truncate">{currentWfLabel}</span>
              <span className="text-[#85858d] font-mono text-[11px] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                {currentWfTaskCount}
              </span>
              <ChevronDown
                size={12}
                className={`text-[#85858d] transition-transform duration-150 ${isWfDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {/* 下拉浮层 */}
            {isWfDropdownOpen && (
              <div className="absolute top-[34px] left-0 w-[280px] bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_10px_26px_rgba(20,22,30,0.12)] py-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1 text-[10.5px] font-medium text-[#85858d] uppercase tracking-wider">
                  工作流筛选
                </div>

                {/* 全部工作流 */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWorkflowFilter('all');
                    setIsWfDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between text-[12px] hover:bg-[#f4f4f6] transition-colors ${
                    selectedWorkflowFilter === 'all' ? 'text-[#1c1c21] font-medium bg-[#f9f9fb]' : 'text-[#4b4b53]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-[4px] bg-[#f1f1f4] flex items-center justify-center text-[#85858d]">
                      <Layers size={12} />
                    </div>
                    <span>全部工作流</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-[#85858d]">{tasks.length}</span>
                    {selectedWorkflowFilter === 'all' && <Check size={13} className="text-[#1c1c21]" />}
                  </div>
                </button>

                <div className="my-1 border-t border-[#ececf0]" />

                {/* 各种工作流列表 */}
                <div className="max-h-[220px] overflow-y-auto divide-y divide-[#ececf0]/50">
                  {workflows.length === 0 ? (
                    <div className="px-3 py-2 text-[11.5px] text-[#85858d]">暂无已注册工作流</div>
                  ) : (
                    workflows.map((wf) => {
                      const count = tasks.filter((t) => t.workflowId === wf.id).length;
                      const isSelected = selectedWorkflowFilter === wf.id;

                      return (
                        <button
                          key={wf.id}
                          type="button"
                          onClick={() => {
                            setSelectedWorkflowFilter(wf.id);
                            setIsWfDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left flex items-center justify-between text-[12px] hover:bg-[#f4f4f6] transition-colors ${
                            isSelected ? 'text-[#1c1c21] font-medium bg-[#f9f9fb]' : 'text-[#4b4b53]'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="truncate text-[12px] font-medium text-[#1c1c21]">{wf.name}</div>
                            <div className="text-[10.5px] font-mono text-[#85858d] truncate mt-0.5">{wf.id}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-[11px] text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                              {count}
                            </span>
                            {isSelected && <Check size={13} className="text-[#1c1c21]" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 搜索框 */}
          <div className="relative w-56 ml-1">
            <input
              type="text"
              placeholder="搜索任务..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-[28px] bg-white border border-[#e3e3e8] rounded-[6px] px-2.5 text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#b9b9c2]"
            />
          </div>

          {/* 全看板列统一排序下拉选择器 */}
          <div className="relative" ref={boardSortDropdownRef}>
            <button
              type="button"
              onClick={() => setIsBoardSortOpen(!isBoardSortOpen)}
              className={`flex items-center gap-1.5 px-2.5 h-[28px] rounded-[6px] bg-white border transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-[12px] font-medium text-[#1c1c21] cursor-pointer hover:bg-[#f9f9fb] ${
                isBoardSortOpen ? 'border-[#b9b9c2] ring-2 ring-[#1c1c21]/5' : 'border-[#e3e3e8]'
              }`}
              title="全看板列统一排序设置"
            >
              <ArrowUpDown size={12} className="text-[#85858d]" />
              <span>排序</span>
              <span className="text-[#85858d] font-mono text-[11px] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                {unifiedSortLabel}
              </span>
              <ChevronDown
                size={12}
                className={`text-[#85858d] transition-transform duration-150 ${isBoardSortOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isBoardSortOpen && (
              <div className="absolute top-[34px] left-0 w-[240px] bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_10px_26px_rgba(20,22,30,0.12)] p-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-2.5 py-1 text-[10.5px] font-semibold text-[#85858d] uppercase tracking-wider flex items-center justify-between border-b border-[#ececf0] pb-1.5 mb-1">
                  <span>全看板列排序</span>
                  <span className="text-[10px] font-mono text-[#85858d]">{unifiedSortLabel}</span>
                </div>

                <div className="max-h-[260px] overflow-y-auto space-y-0.5 pr-0.5">
                  {SORT_OPTIONS.map((opt) => {
                    const isSelected =
                      isUnifiedSort &&
                      opt.field === firstRule.field &&
                      opt.direction === firstRule.direction;

                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          handleApplySortToAll({ field: opt.field, direction: opt.direction });
                          setIsBoardSortOpen(false);
                        }}
                        className={`w-full px-2 py-1.5 text-left flex items-center justify-between rounded-[6px] text-[11.5px] transition-colors cursor-pointer ${
                          isSelected
                            ? 'text-[#1c1c21] font-medium bg-[#f4f4f7]'
                            : 'text-[#4b4b53] hover:text-[#1c1c21] hover:bg-[#f9f9fb]'
                        }`}
                      >
                        <span className="truncate">{opt.label}</span>
                        {isSelected && <Check size={12} className="text-[#1c1c21] shrink-0 ml-1.5" />}
                      </button>
                    );
                  })}
                </div>

                {!isUnifiedSort && (
                  <div className="mt-1 pt-1 border-t border-[#ececf0] px-2 py-1 text-[10.5px] text-[#85858d]">
                    部分列当前配置了独立排序规则
                  </div>
                )}

                <div className="my-1 border-t border-[#ececf0]" />
                <button
                  type="button"
                  onClick={() => {
                    handleResetAllSorts();
                    setIsBoardSortOpen(false);
                  }}
                  className="w-full px-2 py-1 text-left text-[10.5px] text-[#85858d] hover:text-[#d64545] hover:bg-[#fdf2f2] rounded-[5px] flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw size={10} />
                  <span>恢复全列默认排序</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 看板泳道 (满高沉浸设计) */}
      <div className="flex-1 min-h-0 px-6 pb-5 pt-1.5 flex flex-col overflow-hidden">
        {/* 满高泳道水平容器 */}
        <div className="flex-1 min-h-0 flex gap-3.5 overflow-x-auto pb-1 items-stretch">
            {COLUMNS.map((col) => {
              const colRule = columnSortConfig[col.key] || DEFAULT_SORT_RULE;
              const colTasks = tasksByColumn[col.key] || [];

              return (
                <div
                  key={col.key}
                  className="w-[290px] shrink-0 h-full bg-[#ebebef] border border-[#e3e3e8] rounded-[10px] flex flex-col min-h-0 shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
                >
                  {/* 泳道头 */}
                  <div className="h-[36px] px-3 flex items-center justify-between border-b border-[#e3e3e8] shrink-0 bg-[#ebebef] rounded-t-[10px] relative z-20">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${col.dotColor}`} />
                      <span className="text-[12px] font-medium text-[#1c1c21] truncate">{col.title}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Inbox 专属快速添加想法按钮 */}
                      {col.key === 'inbox' && (
                        <button
                          onClick={() => {
                            setIsQuickAddingIdea((v) => !v);
                            if (import.meta.env?.DEV) {
                              console.log('[KanbanView] 切换 Inbox 快速录入状态');
                            }
                          }}
                          className={`w-[20px] h-[20px] rounded-[4px] border flex items-center justify-center transition-colors shadow-sm ${
                            isQuickAddingIdea
                              ? 'bg-[#6366f1] text-white border-[#6366f1]'
                              : 'bg-white border-[#e3e3e8] text-[#6366f1] hover:bg-[#eeedfd]'
                          }`}
                          title="快速添加想法到 Inbox"
                        >
                          <Plus size={11} strokeWidth={2.4} />
                        </button>
                      )}

                      {/* 列独立排序规则设置控件 */}
                      <KanbanColumnSortDropdown
                        columnKey={col.key}
                        columnTitle={col.title}
                        currentRule={colRule}
                        isOpen={openSortDropdownCol === col.key}
                        onToggle={() =>
                          setOpenSortDropdownCol(openSortDropdownCol === col.key ? null : col.key)
                        }
                        onClose={() => setOpenSortDropdownCol(null)}
                        onSelectRule={(rule) => handleSetColumnSort(col.key, rule)}
                        onApplyToAll={handleApplySortToAll}
                        onReset={() => handleResetColumnSort(col.key)}
                      />

                      <span className="h-[18px] px-1.5 rounded-[4px] bg-white border border-[#e3e3e8] text-[11px] font-mono text-[#85858d] flex items-center">
                        {colTasks.length}
                      </span>
                    </div>
                  </div>

                  {/* 泳道卡片列表：独立纵向滚动，撑满泳道全高 */}
                  <div className="flex-1 min-h-0 p-2.5 overflow-y-auto space-y-2">
                    {/* Inbox 一行快捕：默认存为独立想法，也可一键挂为某任务组的子工序 */}
                    {col.key === 'inbox' && isQuickAddingIdea && (
                      <InboxQuickAdd
                        tasks={tasks}
                        defaultWorkflowId={workflows[0]?.id || ''}
                        targetWorkspace={
                          activeWorkspaceFilter !== 'all' && activeWorkspaceFilter !== 'none'
                            ? activeWorkspaceFilter
                            : undefined
                        }
                        workspaceLabel={
                          activeWorkspaceFilter !== 'all' && activeWorkspaceFilter !== 'none'
                            ? getDirectoryName(activeWorkspaceFilter)
                            : undefined
                        }
                        onClose={() => setIsQuickAddingIdea(false)}
                        onCreated={handleIdeaCreated}
                      />
                    )}

                    {colTasks.length === 0 && (!isQuickAddingIdea || col.key !== 'inbox') ? (
                      <div className="h-28 border border-dashed border-[#d1d1d8] rounded-[8px] flex flex-col items-center justify-center gap-1 text-[11px] text-[#85858d]">
                        <span>暂无任务</span>
                        {col.key === 'inbox' && (
                          <button
                            onClick={() => setIsQuickAddingIdea(true)}
                            className="text-[10.5px] text-[#6366f1] hover:underline"
                          >
                            + 记录第一个想法
                          </button>
                        )}
                      </div>
                    ) : (
                      <KanbanLaneList
                        tasks={colTasks}
                        allTasks={tasks}
                        workflows={workflows}
                        wfMap={wfMap}
                        selectedTaskId={selectedTask?.id}
                        cancellingTaskId={cancellingTaskId}
                        movingTaskId={movingTaskId}
                        runningTaskId={runningTaskId}
                        skippingTaskId={skippingTaskId}
                        approvingId={approvingId}
                        onSelectTask={setSelectedTask}
                        onCancelTask={handleCancelTask}
                        onMoveTaskColumn={handleMoveTaskColumn}
                        onEditTask={setEditingTask}
                        onOpenTaskLogs={onOpenTaskLogs}
                        onDeleteTask={setTaskToDelete}
                        onRunTask={handleRunTask}
                        onArchiveTask={handleArchiveTask}
                        onSkipNode={handleSkipNode}
                        onVisualAcceptance={setVisualAcceptanceTask}
                        onApprove={handleApprove}
                        onSetParentTask={(t) => setParentSelectTask(t)}
                        onAddSubtask={handleAddSubtask}
                        onAddSubtasks={handleAddSubtasks}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      {/* 产物预览弹窗 */}
      {previewArtifact && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100"
          onClick={() => {
            if (import.meta.env?.DEV) {
              console.log('[KanbanView] 点击蒙层关闭产物预览弹窗');
            }
            setPreviewArtifact(null);
          }}
        >
          <div
            className="w-[480px] bg-white border border-[#e3e3e8] rounded-[12px] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.16)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#ececf0]">
              <div className="flex items-center gap-2">
                <FileImage className="text-[#4f46e5]" size={16} />
                <span className="font-medium text-[13px] text-[#1c1c21]">{previewArtifact.name}</span>
              </div>
              <button
                onClick={() => setPreviewArtifact(null)}
                className="w-6 h-6 rounded flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21]"
              >
                <X size={15} />
              </button>
            </div>

            {/\.(png|jpe?g|webp|svg)$/i.test(previewArtifact.name) ? (
              <div className="my-3 flex items-center justify-center bg-[#09090b] rounded-[8px] overflow-hidden max-h-[380px] p-2 border border-[#27272a]">
                <img
                  src={api.getArtifactUrl(previewArtifact.path)}
                  alt={previewArtifact.name}
                  className="max-h-[360px] max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="my-4 p-4 border border-[#e3e3e8] rounded-[8px] bg-[#f9f9fb] font-mono text-[11px] text-[#4b4b53] break-all">
                {previewArtifact.path}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setPreviewArtifact(null)}
                className="h-[28px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 任务详情工作台：左侧任务档案与右侧 Agent 协作流同屏并置 */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/25 backdrop-blur-[2px] animate-in fade-in duration-100"
          onClick={() => setSelectedTask(null)}
        >
          {(() => {
            const curTask = activeTask || selectedTask;
            // 任务会话就是同一条 pi 会话：没有会话就不露出入口
            const curTaskSessionId =
              (sessionState?.taskId === curTask.id ? sessionState?.sessionId : undefined) ||
              curTask.context?.sessionId ||
              curTask.context?.piSessionId;
            const statusInfo = getTaskStatusInfo(curTask);
            const wfDef = wfMap.get(curTask.workflowId);
            const recordedNodeCount = Object.keys(curTask.nodeRuns || {}).length;
            const hasVisualAcceptance = Boolean(
              curTask.context?.worktree ||
              Object.values(curTask.nodeRuns || {}).some((r) => r.artifacts && r.artifacts.length > 0)
            );
            // 档案视图切换：懒加载首帧 + 常驻隐藏，切换不丢失滚动位置与展开状态
            const paneClass = (active: boolean) =>
              `flex-1 min-h-0 p-5 overflow-y-auto space-y-3.5 text-[12px]${active ? '' : ' hidden'}`;
            const wfNodes = wfDef?.nodes || [];
            const finishedNodeCount = wfNodes.filter((node) => {
              const run = curTask.nodeRuns?.[node.id];
              return run?.status === 'success' || run?.status === 'skipped';
            }).length;
            const nodePercent = wfNodes.length > 0 ? Math.round((finishedNodeCount / wfNodes.length) * 100) : 0;
            const currentNodeMeta = curTask.currentNodeId
              ? resolveNodeMeta(curTask.currentNodeId, wfDef, workflows)
              : null;

            return (
              <div
                ref={(node) => {
                  detailPanelRef.current = node;
                  if (node) node.style.setProperty('--openloop-workbench-width', `${detailWidth}px`);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 'var(--openloop-workbench-width, 1180px)' }}
                className={`relative z-10 flex h-full max-w-[calc(100vw-24px)] flex-col border-l border-[#e3e3e8] bg-[#f8f8fa] shadow-[0_20px_50px_rgba(15,23,42,0.18)] animate-in slide-in-from-right duration-150 ${
                  isResizingDetail ? 'select-none' : ''
                }`}
              >
                {/* 左边缘拖拽调宽热区：拖拽即时跟手，双击复位 */}
                <div
                  onMouseDown={handleDetailResizeStart}
                  onDoubleClick={handleResetDetailWidth}
                  className="group absolute left-0 top-0 z-20 flex h-full w-2 cursor-col-resize items-center justify-center"
                  title="拖拽调整工作台宽度 · 双击复位"
                >
                  <span
                    className={`h-12 w-[2px] rounded-full transition-colors ${
                      isResizingDetail ? 'bg-[#4f46e5]' : 'bg-[#dcdce2] group-hover:bg-[#4f46e5]'
                    }`}
                  />
                </div>

                {/* 顶栏：编号 · 状态 · 标题 · 主操作横向平铺，随工作台宽度自适应 */}
                <div className="px-4 pt-3 pb-2.5 pl-5 border-b border-[#ececf0] bg-white shrink-0 space-y-2">
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2 min-w-0 shrink-0 max-w-[52%]">
                      <button
                        type="button"
                        onClick={async () => {
                          if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 点击复制完整任务 ID:', curTask.id);
                          const success = await copyToClipboard(curTask.id);
                          if (success) {
                            setDrawerIdCopied(true);
                            toast.success('任务 ID 已复制到剪贴板');
                            setTimeout(() => setDrawerIdCopied(false), 1500);
                          }
                        }}
                        className={`group/drawer-id inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-0.5 rounded-[5px] border transition-all cursor-pointer min-w-0 select-none active:scale-95 ${
                          drawerIdCopied
                            ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/80'
                            : 'bg-[#f4f4f6] hover:bg-[#ececf0] text-[#52525b] hover:text-[#1c1c21] border-[#e3e3e8] hover:border-[#d4d4d8]'
                        }`}
                        title={`任务编号: ${formatShortTaskId(curTask.id)}\n完整任务 ID: ${curTask.id} (点击复制)`}
                      >
                        <span className="font-semibold text-[#4f46e5] text-[10.5px] shrink-0">
                          {formatShortTaskId(curTask.id)}
                        </span>
                        <span className="text-[#c2c2c9] shrink-0">·</span>
                        <span className="select-all tracking-tight font-medium text-[#1c1c21] truncate min-w-0 max-w-[240px]">
                          {curTask.id}
                        </span>
                        {drawerIdCopied ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-[#059669] font-sans font-medium ml-0.5 shrink-0">
                            <Check size={11} className="text-[#059669] shrink-0" />
                            <span>已复制</span>
                          </span>
                        ) : (
                          <Copy size={10.5} className="text-[#85858d] group-hover/drawer-id:text-[#1c1c21] shrink-0 transition-colors ml-0.5" />
                        )}
                      </button>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10.5px] font-medium border shrink-0 ${statusInfo.badgeClass}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotClass}`} />
                        <span>{statusInfo.label}</span>
                      </span>
                    </div>

                    {/* 任务标题：铺满中段，超长自动省略并悬浮呈现全文 */}
                    <h3
                      className="flex-1 min-w-0 truncate text-[13.5px] font-semibold text-[#1c1c21] tracking-tight select-text"
                      title={curTask.title}
                    >
                      {curTask.title}
                    </h3>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {curTask.status !== 'running' && !(curTask.kind === 'group' && Array.isArray(curTask.subTaskIds) && curTask.subTaskIds.length > 0) && (
                        <button
                          onClick={() => {
                            if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 点击设为子任务/变更归属:', curTask.id);
                            setParentSelectTask(curTask);
                          }}
                          className="h-[26px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#eeedfd] text-[#4b4b53] hover:text-[#4f46e5] hover:border-[#d8d6fb] text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-sm shrink-0"
                          title={curTask.parentTaskId ? '变更所属需求 / 解绑...' : '设为子工序...'}
                        >
                          <GitMerge size={11} />
                          <span>{curTask.parentTaskId ? '变更归属' : '设为子任务'}</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 点击编辑任务:', curTask.id);
                          setEditingTask(curTask);
                        }}
                        className="h-[26px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#4b4b53] hover:text-[#1c1c21] text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-sm shrink-0"
                        title={curTask.kind === 'group' ? '编辑此任务组' : '编辑此任务'}
                      >
                        <Edit3 size={11} />
                        <span>编辑</span>
                      </button>
                      <button
                        onClick={() => {
                          if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 点击删除任务:', curTask.id);
                          setTaskToDelete(curTask);
                        }}
                        className="h-[26px] w-[26px] rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#fef2f2] text-[#85858d] hover:text-[#dc2626] hover:border-[#fecaca] flex items-center justify-center transition-all cursor-pointer shadow-sm shrink-0"
                        title="删除任务"
                      >
                        <Trash2 size={12} />
                      </button>
                      <button
                        onClick={handleToggleAgentPane}
                        className={`h-[26px] px-2 rounded-[5px] border text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-sm shrink-0 ${
                          isAgentPaneOpen
                            ? 'border-[#d8d6fb] bg-[#eeedfd] text-[#4f46e5]'
                            : 'border-[#e3e3e8] bg-white text-[#4b4b53] hover:text-[#1c1c21] hover:bg-[#f4f4f6]'
                        }`}
                        title={isAgentPaneOpen ? '收起 Agent 协作流，专注任务档案' : '展开 Agent 协作流，与任务同屏对话'}
                      >
                        <PanelRight size={11} />
                        <span>Agent</span>
                      </button>
                      <button
                        onClick={() => {
                          if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 点击关闭工作台:', curTask.id);
                          setSelectedTask(null);
                        }}
                        className="h-[26px] w-[26px] rounded-[5px] hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title="关闭工作台 (Esc)"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>

                  {/* 如果是子工序，显示父需求溯源与跳回链接 */}
                  {curTask.kind === 'subtask' && curTask.parentTaskId && (
                    <div className="flex items-center justify-between gap-1.5 text-[11px] text-[#71717a] bg-[#f4f4f6] px-2 py-1 rounded-[5px] border border-[#ececf0] mb-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="shrink-0">所属父需求:</span>
                        <button
                          type="button"
                          onClick={() => {
                            const parentObj = tasks.find((t) => t.id === curTask.parentTaskId);
                            if (parentObj) {
                              setSelectedTask(parentObj);
                              setDrawerTab('subtasks');
                            }
                          }}
                          className="font-medium text-[#4f46e5] hover:underline truncate min-w-0 flex-1 text-left cursor-pointer"
                          title="点击跳回父需求卡片"
                        >
                          {tasks.find((t) => t.id === curTask.parentTaskId)?.title || curTask.parentTaskId}
                        </button>
                      </div>
                      {curTask.status !== 'running' && (
                        <button
                          type="button"
                          onClick={() => setParentSelectTask(curTask)}
                          className="px-1.5 py-0.5 rounded bg-white border border-[#e3e3e8] hover:bg-[#eeedfd] text-[#63636b] hover:text-[#4f46e5] text-[10px] font-medium transition-colors cursor-pointer shrink-0"
                          title="更换或解除父需求归属"
                        >
                          变更归属
                        </button>
                      )}
                    </div>
                  )}

                </div>

                {/* 主体：左侧任务档案（常驻不卸载） + 右侧 Agent 协作流（全程同屏） */}
                <div className="flex-1 flex min-h-0">
                  <main className="flex-1 min-w-0 flex flex-col">
                    {/* 档案视图切换：切换不卸载、不丢滚动位置 */}
                    <div className="h-[40px] pl-4 pr-3 flex items-center justify-between gap-2 shrink-0 bg-white border-b border-[#ececf0]">
                      <div className="flex items-center p-0.5 rounded-[6px] bg-[#f1f1f4] border border-[#e3e3e8]">
                        <button
                          onClick={() => setDrawerTab('overview')}
                          className={`h-[26px] px-2.5 rounded-[4px] text-[11.5px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                            drawerTab === 'overview' ? 'bg-white text-[#1c1c21] shadow-sm font-semibold' : 'text-[#63636b] hover:text-[#1c1c21]'
                          }`}
                        >
                          <Layers size={12} />
                          <span>任务概览</span>
                        </button>
                        <button
                          onClick={() => setDrawerTab('timeline')}
                          className={`h-[26px] px-2.5 rounded-[4px] text-[11.5px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                            drawerTab === 'timeline' ? 'bg-white text-[#1c1c21] shadow-sm font-semibold' : 'text-[#63636b] hover:text-[#1c1c21]'
                          }`}
                          title="查看流水线各节点的执行时序、参数与产物"
                        >
                          <GitCommit size={12} />
                          <span>执行轨迹</span>
                          {recordedNodeCount > 0 && (
                            <span className="text-[10px] font-mono px-1.5 py-[0.5px] rounded-full bg-[#ececf0] text-[#63636b]">
                              {recordedNodeCount}
                            </span>
                          )}
                        </button>
                        {curTask.kind !== 'subtask' && (
                          <button
                            onClick={() => setDrawerTab('subtasks')}
                            className={`h-[26px] px-2.5 rounded-[4px] text-[11.5px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                              drawerTab === 'subtasks' ? 'bg-white text-[#4f46e5] shadow-sm font-semibold' : 'text-[#63636b] hover:text-[#1c1c21]'
                            }`}
                          >
                            <Layers size={12} className={drawerTab === 'subtasks' ? 'text-[#4f46e5]' : 'text-[#71717a]'} />
                            <span>工序演进</span>
                            {(curTask.subTaskIds || []).length > 0 ? (
                              <span className="text-[10px] font-mono px-1.5 py-[0.5px] rounded-full bg-[#eeedfd] text-[#4f46e5] font-semibold">
                                {(curTask.subTaskIds || []).length}
                              </span>
                            ) : (
                              <span className="text-[9.5px] text-[#85858d] bg-[#ececf0] px-1 py-[0.5px] rounded font-normal">裂变</span>
                            )}
                          </button>
                        )}
                      </div>

                      {/* 当前节点焦点与整条流水线进度微带 */}
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="flex items-center gap-1.5 min-w-0"
                          title={`当前节点：${currentNodeMeta?.name || '流水线就绪'} · 已完成 ${finishedNodeCount}/${wfNodes.length} 个节点`}
                        >
                          <span className="text-[10px] font-mono text-[#85858d] shrink-0">
                            {finishedNodeCount}/{wfNodes.length}
                          </span>
                          <span className="text-[10.5px] text-[#52525b] truncate max-w-[160px]">
                            {currentNodeMeta?.name || '流水线就绪'}
                          </span>
                          <div className="w-[44px] h-[3px] rounded-full bg-[#ececf0] overflow-hidden shrink-0">
                            <div
                              className="h-full rounded-full bg-[#4f46e5] transition-[width] duration-300"
                              style={{ width: `${nodePercent}%` }}
                            />
                          </div>
                        </div>
                        {!isAgentPaneOpen && (
                          <button
                            type="button"
                            onClick={handleToggleAgentPane}
                            className="h-[24px] px-2 rounded-[5px] border border-[#d8d6fb] bg-[#f5f5ff] hover:bg-[#eceaff] text-[#4f46e5] text-[10.5px] font-medium flex items-center gap-1 transition-all cursor-pointer shrink-0"
                            title="展开 Agent 协作流"
                          >
                            <Bot size={11} />
                            <span>Agent</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* TAB 1: 任务概览 */}
                    {visitedPanes.overview && (
                      <div className={paneClass(drawerTab === 'overview')}>
                    {/* 模块 1: 核心属性与规格面板 */}
                    <div className="rounded-[8px] border border-[#e3e3e8] bg-white p-3.5 shadow-sm space-y-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {/* 运行状态 */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-[#71717a] mb-1">
                            <Activity size={12} className="text-[#a1a1aa]" />
                            <span>运行状态</span>
                          </div>
                          <div>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10.5px] font-medium border ${statusInfo.badgeClass}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotClass}`} />
                              <span>{statusInfo.label}</span>
                            </span>
                          </div>
                        </div>

                        {/* 所属泳道 */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-[#71717a] mb-1">
                            <Columns3 size={12} className="text-[#a1a1aa]" />
                            <span>所属泳道</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-[#1c1c21] text-[11.5px]">
                              {COLUMN_NAMES[curTask.kanbanColumn] || curTask.kanbanColumn}
                            </span>
                            {curTask.status === 'pending' && curTask.kanbanColumn === 'inbox' && (
                              <button
                                disabled={movingTaskId === curTask.id}
                                onClick={() => handleMoveTaskColumn(curTask.id, 'backlog')}
                                className="px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] hover:bg-[#eeedfd] text-[#4f46e5] text-[10px] font-medium border border-[#e3e3e8] hover:border-[#c7d2fe] transition-colors cursor-pointer"
                                title="移入待处理泳道准备执行"
                              >
                                {movingTaskId === curTask.id ? '移动中' : '移入待处理 →'}
                              </button>
                            )}
                            {curTask.status === 'pending' && curTask.kanbanColumn === 'backlog' && (
                              <button
                                disabled={movingTaskId === curTask.id}
                                onClick={() => handleMoveTaskColumn(curTask.id, 'inbox')}
                                className="px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] hover:bg-[#eeedfd] text-[#6366f1] text-[10px] font-medium border border-[#e3e3e8] hover:border-[#c7d2fe] transition-colors cursor-pointer"
                                title="退回 Inbox 收集箱"
                              >
                                {movingTaskId === curTask.id ? '移动中' : '← 移至 Inbox'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 工作流程 */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-[#71717a] mb-1">
                            <Workflow size={12} className="text-[#a1a1aa]" />
                            <span>工作流程</span>
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="font-medium text-[#1c1c21] text-[11.5px] truncate"
                              title={wfDef?.name || curTask.workflowId}
                            >
                              {wfDef?.name || curTask.workflowId}
                            </span>
                            <span className="shrink-0 px-1 py-[0.5px] rounded-[3px] bg-[#f4f4f6] border border-[#e3e3e8] text-[9.5px] font-mono text-[#71717a]">
                              {wfDef?.nodes.length || 0} 节点
                            </span>
                          </div>
                        </div>

                        {/* 工程工作区 */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-[#71717a] mb-1">
                            <FolderGit2 size={12} className="text-[#a1a1aa]" />
                            <span>工程目录</span>
                          </div>
                          {curTask.workspace ? (
                            <div className="flex items-center gap-1 min-w-0">
                              <span
                                className="text-[11.5px] font-medium text-[#1c1c21] truncate cursor-help"
                                title={curTask.workspace}
                              >
                                {curTask.workspace.replace(/[/\\]+$/, '').split(/[/\\]/).pop()}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 打开工作区目录:', curTask.workspace);
                                  api.openPath(curTask.workspace!);
                                }}
                                className="w-5 h-5 rounded-[4px] hover:bg-[#f4f4f6] text-[#71717a] hover:text-[#4f46e5] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                                title="在系统文件访达中打开"
                              >
                                <FolderOpen size={11} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-[#a1a1aa] italic">默认运行时目录</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 模块 2: 任务需求与说明 */}
                    <TaskDescriptionCard
                      task={curTask}
                      allTasks={tasks}
                      onTaskUpdated={(updated) => {
                        setSelectedTask(updated);
                        onTaskUpdate?.(updated);
                      }}
                      onPreviewImage={(att, imageList) => {
                        setActiveDetailImageList(imageList);
                        setActiveDetailImage(att);
                      }}
                    />

                    {/* 模块 3: 验收用例 (随时可查看与修改) */}
                    <TaskQaInstructionsCard
                      task={curTask}
                      onTaskUpdated={(updated) => {
                        setSelectedTask(updated);
                        onTaskUpdate?.(updated);
                      }}
                    />
                      </div>
                    )}

                    {/* TAB 2: 节点执行轨迹 */}
                    {visitedPanes.timeline && (
                      <div className={paneClass(drawerTab === 'timeline')}>
                    <NodeExecutionTimeline
                      task={curTask}
                      workflow={wfDef}
                      allWorkflows={workflows}
                      onOpenTaskLogs={onOpenTaskLogs}
                      onPreviewArtifact={(art) => setPreviewArtifact(art)}
                      onApprove={(taskId, approved, feedback) => handleApprove(taskId, approved, feedback)}
                      isApproving={approvingId === curTask.id}
                      onSkipNode={(taskId, nodeId) => handleSkipNode(taskId, nodeId)}
                      onRetryNode={(taskId, nodeId) => handleRetryNode(taskId, nodeId)}
                      isSkipping={skippingTaskId === curTask.id}
                      isRetryingNode={retryingNodeKey?.startsWith(curTask.id)}
                      onCustomRetry={handleCustomRetry}
                      isCustomRetrying={isCustomRetrying}
                      onNodeOverride={handleNodeOverride}
                    />
                      </div>
                    )}

                    {/* 底部操作区：任务档案视图共用 */}
                    {drawerTab !== 'subtasks' && (
                  <div className="min-h-[52px] px-4 py-1.5 border-t border-[#e3e3e8] bg-[#fafafc] flex flex-wrap items-center justify-between gap-y-1 shrink-0 select-none">
                    {/* 左侧辅助入口：实时控制台日志 */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 打开控制台日志:', curTask.id);
                          onOpenTaskLogs(curTask.id);
                          setSelectedTask(null);
                        }}
                        className={`h-[28px] px-2.5 rounded-[5px] text-[11.5px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                          curTask.status === 'running'
                            ? 'bg-[#eeedfd] text-[#4f46e5] hover:bg-[#e0e0fc]'
                            : 'text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0]'
                        }`}
                        title="查看此任务实时控制台日志与输出"
                      >
                        <Terminal size={12} className={curTask.status === 'running' ? 'text-[#4f46e5]' : 'text-[#71717a]'} />
                        <span>控制台日志</span>
                        {curTask.status === 'running' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] animate-pulse" />
                        )}
                      </button>
                    </div>

                    {/* 右侧核心动作组 */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* 状态 1: Pending 待处理 */}
                      {curTask.status === 'pending' && (
                        <>
                          {curTask.kanbanColumn === 'inbox' ? (
                            <button
                              type="button"
                              disabled={movingTaskId === curTask.id}
                              onClick={() => handleMoveTaskColumn(curTask.id, 'backlog')}
                              className="h-[28px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#4b4b53] hover:text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                              title="移入 Backlog 待处理泳道"
                            >
                              <ArrowRight size={11.5} />
                              <span>{movingTaskId === curTask.id ? '移动中...' : '移入待处理'}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={movingTaskId === curTask.id}
                              onClick={() => handleMoveTaskColumn(curTask.id, 'inbox')}
                              className="h-[28px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#4b4b53] hover:text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                              title="退回 Inbox 收集箱暂缓"
                            >
                              <Inbox size={11.5} />
                              <span>{movingTaskId === curTask.id ? '移动中...' : '退回收集箱'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={runningTaskId === curTask.id}
                            onClick={() => handleRunTask(curTask.id)}
                            className="h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[11.5px] font-medium text-white flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                          >
                            <Play size={11} strokeWidth={2.4} />
                            <span>{runningTaskId === curTask.id ? '启动中...' : '立即启动'}</span>
                          </button>
                        </>
                      )}

                      {/* 状态 2: Running 执行中 */}
                      {curTask.status === 'running' && (
                        <button
                          type="button"
                          disabled={cancellingTaskId === curTask.id}
                          onClick={() => handleCancelTask(curTask.id)}
                          className="h-[28px] px-3 rounded-[6px] border border-[#fecaca] bg-white hover:bg-[#fef2f2] text-[#dc2626] text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                          title="终止正在运行的自动化流水线"
                        >
                          <Square size={10.5} className="fill-current" />
                          <span>{cancellingTaskId === curTask.id ? '正在终止...' : '终止流水线'}</span>
                        </button>
                      )}

                      {/* 状态 3: Waiting Approval 待人工验收 */}
                      {curTask.status === 'waiting_approval' && (
                        <>
                          {hasVisualAcceptance && (
                            <button
                              type="button"
                              onClick={() => {
                                if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 打开验收面板:', curTask.id);
                                setVisualAcceptanceTask(curTask);
                              }}
                              className="h-[28px] px-2.5 rounded-[6px] border border-[#d8d6fb] bg-[#f5f5ff] hover:bg-[#eceaff] text-[#4f46e5] text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.98] cursor-pointer"
                              title="查看截帧回放与验收面板"
                            >
                              <Eye size={12} />
                              <span>截帧回放</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={approvingId === curTask.id}
                            onClick={() => handleApprove(curTask.id, false)}
                            className="h-[28px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#63636b] hover:text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                          >
                            <X size={11.5} />
                            <span>驳回</span>
                          </button>
                          <button
                            type="button"
                            disabled={approvingId === curTask.id}
                            onClick={() => handleApprove(curTask.id, true)}
                            className="h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                          >
                            <Check size={12} strokeWidth={2.4} />
                            <span>验收通过</span>
                          </button>
                        </>
                      )}

                      {/* 状态 4: Failed 执行失败 */}
                      {curTask.status === 'failed' && (
                        <>
                          {hasVisualAcceptance && (
                            <button
                              type="button"
                              onClick={() => {
                                if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 查看现场回放:', curTask.id);
                                setVisualAcceptanceTask(curTask);
                              }}
                              className="h-[28px] px-2.5 rounded-[6px] border border-[#d8d6fb] bg-[#f5f5ff] hover:bg-[#eceaff] text-[#4f46e5] text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.98] cursor-pointer"
                              title="查看报错现场截帧回放"
                            >
                              <Eye size={12} />
                              <span>现场回放</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={skippingTaskId === curTask.id}
                            onClick={() => handleSkipNode(curTask.id)}
                            className="h-[28px] px-2 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#4b4b53] hover:text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                            title="跳过当前报错节点继续后续链路"
                          >
                            <SkipForward size={11} />
                            <span>跳过</span>
                          </button>
                          <button
                            type="button"
                            disabled={runningTaskId === curTask.id}
                            onClick={() => handleRunTask(curTask.id)}
                            className="h-[28px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#4b4b53] hover:text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                            title="重新从头执行整条流水线"
                          >
                            <Play size={10.5} />
                            <span>整单重跑</span>
                          </button>
                          <button
                            type="button"
                            disabled={retryingNodeKey === `${curTask.id}:`}
                            onClick={() => handleRetryNode(curTask.id)}
                            className="h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                            title="仅重新执行发生报错的节点"
                          >
                            <RotateCcw size={11} strokeWidth={2.4} />
                            <span>重试节点</span>
                          </button>
                        </>
                      )}

                      {/* 状态 5: Cancelled 已取消 */}
                      {curTask.status === 'cancelled' && (
                        <button
                          type="button"
                          disabled={runningTaskId === curTask.id}
                          onClick={() => handleRunTask(curTask.id)}
                          className="h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[11.5px] font-medium text-white flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw size={11} strokeWidth={2.4} />
                          <span>{runningTaskId === curTask.id ? '重新启动中...' : '重新启动'}</span>
                        </button>
                      )}

                      {/* 状态 6: Completed 已完成 */}
                      {curTask.status === 'completed' && (
                        <>
                          {hasVisualAcceptance && (
                            <button
                              type="button"
                              onClick={() => {
                                if (import.meta.env?.DEV) console.log('[KanbanView:Drawer] 查看完成产物与回放:', curTask.id);
                                setVisualAcceptanceTask(curTask);
                              }}
                              className="h-[28px] px-2.5 rounded-[6px] border border-[#d8d6fb] bg-[#f5f5ff] hover:bg-[#eceaff] text-[#4f46e5] text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs active:scale-[0.98] cursor-pointer"
                              title="查看交付产物与截帧回放"
                            >
                              <Eye size={12} />
                              <span>交付截帧</span>
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={runningTaskId === curTask.id}
                            onClick={() => handleRunTask(curTask.id)}
                            className="h-[28px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#4b4b53] hover:text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1 transition-all shadow-xs active:scale-[0.98] cursor-pointer disabled:opacity-50"
                            title="再次重新执行此任务"
                          >
                            <RotateCcw size={11} />
                            <span>再次执行</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                    )}

                    {/* TAB 3: 任务组与工序自然生长演进 */}
                    {visitedPanes.subtasks && (
                      <div className={paneClass(drawerTab === 'subtasks')}>
                    {(() => {
                      const groupSubtasks = (curTask.subTaskIds || [])
                        .map((id) => tasks.find((t) => t.id === id))
                        .filter(Boolean) as Task[];
                      const displayGroupSubtasks = orderSubTasksForDisplay(groupSubtasks);
                      const groupPassed = groupSubtasks.filter((s) => s.status === 'completed').length;
                      const groupTotal = groupSubtasks.length;
                      const groupAllPassed = groupTotal > 0 && groupPassed === groupTotal;
                      const groupPct = groupTotal > 0 ? Math.round((groupPassed / groupTotal) * 100) : 0;
                      const modeLabel =
                        curTask.executionMode === 'parallel'
                          ? '全并行并发执行'
                          : curTask.executionMode === 'dag'
                          ? 'DAG 自定义依赖拓扑'
                          : '串行顺序执行 (A -> B -> C)';

                      return (
                        <>
                          {/* 1. 若当前尚未裂变任何工序：呈现优雅的渐进式升格引导 */}
                          {groupSubtasks.length === 0 && !aiPlanPreview && !isAddingManualSubtask && (
                            <div className="rounded-[10px] border border-dashed border-[#d8d6fb] bg-[#fafafc] p-5 text-center space-y-3 shadow-2xs">
                              <div className="w-10 h-10 rounded-full bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center mx-auto shadow-xs">
                                <Sparkles size={18} />
                              </div>
                              <div>
                                <h4 className="text-[13px] font-semibold text-[#1c1c21]">
                                  当前为独立单任务
                                </h4>
                                <p className="text-[11px] text-[#71717a] mt-1 max-w-[340px] mx-auto leading-relaxed">
                                  若该需求规模较大、跨前后端或需分阶段推进，可随时在此将其裂变为多工序协同执行。各工序可独立选择不同的流水线（如后端开发、UI 还原、QA 自动化验收）。
                                </p>
                              </div>

                              <div className="flex items-center justify-center gap-2.5 pt-1">
                                <button
                                  type="button"
                                  disabled={isPlanningAi}
                                  onClick={async () => {
                                    try {
                                      setIsPlanningAi(true);
                                      if (import.meta.env?.DEV) {
                                        console.log('[KanbanView:Subtasks] 请求 AI 规划工序:', curTask.id);
                                      }
                                      const res = await api.planSubtasks(curTask.id);
                                      if (res.plan?.subtasks && res.plan.subtasks.length > 0) {
                                        setAiPlanPreview(
                                          res.plan.subtasks.map((s: any) => ({
                                            title: s.title,
                                            workflowId: s.workflowId || curTask.workflowId,
                                            workspace: s.workspace || '',
                                            dependencies: s.dependencies || [],
                                          }))
                                        );
                                        toast.success(`AI 已规划 ${res.plan.subtasks.length} 道异构工序，请确认`);
                                      } else {
                                        toast.info('未识别到明显分工，建议手动添加工序');
                                      }
                                    } catch (err: any) {
                                      toast.error(`规划失败: ${err.message}`);
                                    } finally {
                                      setIsPlanningAi(false);
                                    }
                                  }}
                                  className="px-3.5 h-[30px] rounded-[6px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[11.5px] font-medium flex items-center gap-1.5 shadow-sm cursor-pointer transition-all disabled:opacity-50"
                                >
                                  {isPlanningAi ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Sparkles size={12} />
                                  )}
                                  <span>{isPlanningAi ? 'AI 正在规划方案...' : '✨ AI 智能规划工序'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsAgentPaneOpen(true);
                                    handleSendSuggestedPrompt(
                                      '请分析当前需求与工作区目录结构，帮我规划并拆解为可独立闭环执行的子任务。'
                                    );
                                  }}
                                  className="px-3.5 h-[30px] rounded-[6px] bg-[#eeedfd] hover:bg-[#e0e0fc] text-[#4f46e5] border border-[#d8d6fb] text-[11.5px] font-medium flex items-center gap-1.5 shadow-2xs cursor-pointer transition-all"
                                  title="打开架构师会话面板，通过多轮对话深入沟通并拆解工序"
                                >
                                  <Bot size={12} />
                                  <span>💬 召唤架构 Agent 规划</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setManualSubtaskWorkflowId(curTask.workflowId);
                                    setManualSubtaskTitle('');
                                    setManualSubtaskDesc('');
                                    setManualSubtaskAttachments([]);
                                    setManualSubtaskDep('');
                                    setManualSubtaskWorkspace(curTask.workspace || '');
                                    setIsAddingManualSubtask(true);
                                  }}
                                  className="px-3.5 h-[30px] rounded-[6px] bg-white border border-[#e3e3e8] hover:bg-[#f4f4f6] text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
                                >
                                  <Plus size={12} />
                                  <span>手动添加工序</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLinkExistingParentTask(curTask)}
                                  className="px-3.5 h-[30px] rounded-[6px] bg-white border border-[#e3e3e8] hover:bg-[#f4f4f6] text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1.5 cursor-pointer transition-all shadow-xs"
                                  title="吸纳看板中现有的独立任务成为本需求容器的子工序"
                                >
                                  <Link2 size={12} />
                                  <span>关联已有任务</span>
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 2. AI 规划工序蓝图预览卡片 */}
                          {aiPlanPreview && (
                            <div className="rounded-[10px] border border-[#d8d6fb] bg-[#fbfbfe] p-3.5 shadow-sm space-y-3 animate-in fade-in duration-150">
                              <div className="flex items-center justify-between pb-1.5 border-b border-[#ececf0]">
                                <div className="flex items-center gap-1.5">
                                  <Sparkles size={13} className="text-[#4f46e5]" />
                                  <span className="font-semibold text-[12px] text-[#1c1c21]">
                                    AI 工序拆解蓝图 (共 {aiPlanPreview.length} 项异构工序)
                                  </span>
                                </div>
                                <span className="text-[10px] text-[#71717a]">
                                  各工序已匹配最佳流水线，确认后一键升格
                                </span>
                              </div>

                              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                                {aiPlanPreview.map((item, index) => (
                                  <div
                                    key={index}
                                    className="bg-white border border-[#e3e3e8] rounded-[7px] p-2.5 shadow-2xs space-y-1.5"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[9.5px] font-semibold text-[#4f46e5] bg-[#eeedfd] px-1.5 py-0.5 rounded shrink-0">
                                        #{index + 1}
                                      </span>
                                      <input
                                        type="text"
                                        value={item.title}
                                        onChange={(e) => {
                                          const next = [...aiPlanPreview];
                                          next[index].title = e.target.value;
                                          setAiPlanPreview(next);
                                        }}
                                        className="flex-1 h-[26px] bg-transparent text-[11.5px] font-medium text-[#1c1c21] outline-none border-b border-transparent focus:border-[#4f46e5]"
                                      />
                                    </div>

                                    <div className="flex items-center justify-between text-[10.5px] text-[#71717a] pt-0.5">
                                      <div className="flex items-center gap-1 min-w-0 flex-1">
                                        <span className="shrink-0 text-[#85858d]">执行流水线:</span>
                                        <select
                                          value={item.workflowId}
                                          onChange={(e) => {
                                            const next = [...aiPlanPreview];
                                            next[index].workflowId = e.target.value;
                                            setAiPlanPreview(next);
                                          }}
                                          className="h-[22px] px-1 text-[10.5px] bg-[#f4f4f6] text-[#1c1c21] border border-[#e3e3e8] rounded outline-none max-w-[200px] truncate"
                                        >
                                          {workflows.map((wf) => (
                                            <option key={wf.id} value={wf.id}>
                                              {wf.name} ({wf.id})
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      {index > 0 && (
                                        <span className="text-[9.5px] font-mono text-[#85858d] shrink-0">
                                          依赖 #{index}
                                        </span>
                                      )}
                                    </div>

                                    {/* 目标工作区子路径 */}
                                    <div className="flex items-center gap-1 text-[10.5px] text-[#71717a] pt-1">
                                      <FolderGit2 size={10.5} className="text-[#85858d] shrink-0" />
                                      <span className="shrink-0 text-[#85858d]">目标工作区:</span>
                                      <input
                                        type="text"
                                        placeholder="子工程路径 (相对路径或绝对路径，默认继承父工作区)"
                                        value={item.workspace || ''}
                                        onChange={(e) => {
                                          const next = [...aiPlanPreview];
                                          next[index].workspace = e.target.value;
                                          setAiPlanPreview(next);
                                        }}
                                        className="flex-1 h-[22px] px-1.5 text-[10px] font-mono bg-[#f4f4f6] text-[#1c1c21] border border-[#e3e3e8] rounded outline-none focus:border-[#4f46e5]"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <div className="flex items-center justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setAiPlanPreview(null)}
                                  className="px-2.5 h-[26px] rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#63636b] text-[11px] font-medium cursor-pointer transition-colors"
                                >
                                  取消
                                </button>
                                <button
                                  type="button"
                                  disabled={isAddingSubtask}
                                  onClick={async () => {
                                    try {
                                      setIsAddingSubtask(true);
                                      if (import.meta.env?.DEV) {
                                        console.log('[KanbanView:Subtasks] 一键采纳 AI 规划工序:', aiPlanPreview);
                                      }
                                      await api.batchAddSubTasks(curTask.id, {
                                        subtasks: aiPlanPreview,
                                        executionMode: 'serial',
                                      });
                                      setAiPlanPreview(null);
                                      toast.success('已就地升格为需求容器并挂载工序');
                                      onRefresh();
                                    } catch (err: any) {
                                      toast.error(`采纳失败: ${err.message}`);
                                    } finally {
                                      setIsAddingSubtask(false);
                                    }
                                  }}
                                  className="px-3.5 h-[26px] rounded-[5px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-all shadow-xs disabled:opacity-50"
                                >
                                  <Check size={11} />
                                  <span>{isAddingSubtask ? '正在挂载...' : '一键采纳并升格需求容器'}</span>
                                </button>
                              </div>
                            </div>
                          )}

                          {/* 3. 手动添加/追加工序卡片 */}
                          {isAddingManualSubtask && (() => {
                            const manualTargetWfId = manualSubtaskWorkflowId || curTask.workflowId;
                            const selectedManualSubtaskWf = workflows.find((wf) => wf.id === manualTargetWfId);

                            const handleCancelManualSubtask = () => {
                              setIsAddingManualSubtask(false);
                              setManualSubtaskTitle('');
                              setManualSubtaskDesc('');
                              setManualSubtaskAttachments([]);
                              setManualSubtaskDep('');
                              setManualSubtaskWorkspace('');
                            };

                            return (
                              <div className="rounded-[10px] border border-[#e3e3e8] bg-white p-3.5 shadow-sm space-y-2.5 animate-in fade-in duration-100">
                                <div className="flex items-center justify-between pb-1 border-b border-[#ececf0]">
                                  <span className="font-semibold text-[11.5px] text-[#1c1c21] flex items-center gap-1">
                                    <Plus size={12} className="text-[#4f46e5]" />
                                    <span>{groupSubtasks.length === 0 ? '添加首个拆解工序' : '追加新工序'}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={handleCancelManualSubtask}
                                    className="text-[#85858d] hover:text-[#1c1c21] cursor-pointer"
                                  >
                                    <X size={13} />
                                  </button>
                                </div>

                                <div className="space-y-2">
                                  <div>
                                    <label className="block text-[10.5px] font-medium text-[#71717a] mb-0.5">工序目标与标题</label>
                                    <input
                                      type="text"
                                      placeholder="例如: 后端鉴权接口实现与单元测试用例编写..."
                                      value={manualSubtaskTitle}
                                      onChange={(e) => setManualSubtaskTitle(e.target.value)}
                                      className="w-full h-[28px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[5px] px-2 text-[11.5px] text-[#1c1c21] outline-none focus:bg-white focus:border-[#4f46e5]"
                                    />
                                  </div>

                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[10.5px] font-medium text-[#71717a] mb-0.5">执行流水线 (支持异构)</label>
                                      <WorkflowPicker
                                        value={manualTargetWfId}
                                        onChange={setManualSubtaskWorkflowId}
                                        workflows={workflows}
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-[10.5px] font-medium text-[#71717a] mb-0.5">前置依赖工序</label>
                                      <select
                                        value={manualSubtaskDep}
                                        onChange={(e) => setManualSubtaskDep(e.target.value)}
                                        className="w-full h-[26px] px-1.5 text-[11px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[5px] text-[#1c1c21] outline-none focus:bg-white focus:border-[#4f46e5]"
                                      >
                                        <option value="">(无前置依赖 · 并行拉起)</option>
                                        {groupSubtasks.map((prev, pIdx) => (
                                          <option key={prev.id} value={prev.id}>
                                            依赖 #{pIdx + 1} ({prev.title.slice(0, 18)}...)
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>

                                  <div>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <label className="block text-[10.5px] font-medium text-[#71717a]">
                                        工程工作区
                                      </label>
                                      <span className="text-[10px] text-[#85858d]">
                                        {manualSubtaskWorkspace.trim()
                                          ? '已指定独立工程目录'
                                          : '留空则继承任务组工程目录'}
                                      </span>
                                    </div>
                                    <WorkspacePicker
                                      value={manualSubtaskWorkspace}
                                      onChange={setManualSubtaskWorkspace}
                                      placeholder="选择工序执行所需的代码工程根目录 (留空继承任务组)..."
                                    />
                                  </div>

                                  <div>
                                    <div className="flex items-center justify-between mb-0.5">
                                      <label className="block text-[10.5px] font-medium text-[#71717a]">
                                        工序说明与提示词 (支持粘贴图片)
                                      </label>
                                      {selectedManualSubtaskWf?.taskTemplate?.descriptionTemplate &&
                                        manualSubtaskDesc.trim() !== selectedManualSubtaskWf.taskTemplate.descriptionTemplate.trim() && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setManualSubtaskDesc(selectedManualSubtaskWf.taskTemplate!.descriptionTemplate!);
                                              if (import.meta.env?.DEV) {
                                                console.log('[KanbanView:Subtasks] 手动套用工序流水线模板:', selectedManualSubtaskWf.name);
                                              }
                                              toast.success(`已套用「${selectedManualSubtaskWf.name}」专属模板`);
                                            }}
                                            className="text-[10px] text-[#4f46e5] hover:text-[#4338ca] hover:underline flex items-center gap-1 cursor-pointer font-medium"
                                            title="将说明框重置为此工序流水线的专属模板"
                                          >
                                            <Sparkles size={10} />
                                            <span>套用流程模板</span>
                                          </button>
                                        )}
                                    </div>
                                    <TaskPromptArea
                                      value={manualSubtaskDesc}
                                      onChange={setManualSubtaskDesc}
                                      attachments={manualSubtaskAttachments}
                                      onAttachmentsChange={setManualSubtaskAttachments}
                                      placeholder="工序具体背景、要求说明或传给 Agent 的 Prompt 提示词..."
                                      rows={3}
                                      disabled={isAddingSubtask}
                                    />
                                  </div>
                                </div>

                                <div className="flex items-center justify-end gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={handleCancelManualSubtask}
                                    className="px-2.5 h-[26px] rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#63636b] text-[11px] font-medium cursor-pointer"
                                  >
                                    取消
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!manualSubtaskTitle.trim() || isAddingSubtask}
                                    onClick={async () => {
                                      if (!manualSubtaskTitle.trim() || isAddingSubtask) return;
                                      try {
                                        setIsAddingSubtask(true);
                                        const targetWfId = manualSubtaskWorkflowId || curTask.workflowId;
                                        if (import.meta.env?.DEV) {
                                          console.log('[KanbanView:Subtasks] 手动添加子工序:', {
                                            parentId: curTask.id,
                                            title: manualSubtaskTitle.trim(),
                                            description: manualSubtaskDesc.trim() || undefined,
                                            attachmentsCount: manualSubtaskAttachments.length,
                                            workflowId: targetWfId,
                                            dependencies: manualSubtaskDep ? [manualSubtaskDep] : undefined,
                                            workspace: manualSubtaskWorkspace.trim() || '(继承父任务)',
                                          });
                                        }
                                        await api.addSubTask(curTask.id, {
                                          title: manualSubtaskTitle.trim(),
                                          description: manualSubtaskDesc.trim() || undefined,
                                          attachments: manualSubtaskAttachments.length > 0 ? manualSubtaskAttachments : undefined,
                                          workflowId: targetWfId,
                                          dependencies: manualSubtaskDep ? [manualSubtaskDep] : undefined,
                                          workspace: manualSubtaskWorkspace.trim() || undefined,
                                        });
                                        handleCancelManualSubtask();
                                        toast.success('已成功挂载工序并就地升格');
                                        onRefresh();
                                      } catch (err: any) {
                                        toast.error(`添加工序失败: ${err.message}`);
                                      } finally {
                                        setIsAddingSubtask(false);
                                      }
                                    }}
                                    className="px-3 h-[26px] rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer shadow-xs disabled:opacity-40"
                                  >
                                    <Plus size={11} />
                                    <span>{isAddingSubtask ? '添加中...' : '确认添加'}</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })()}

                          {/* 4. 已有工序的概览卡片与流转链路列表 */}
                          {groupSubtasks.length > 0 && (
                            <>
                              {/* 编排概览规格卡片 */}
                              <div className="rounded-[8px] border border-[#e3e3e8] bg-white p-3.5 shadow-sm space-y-2.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-medium text-[#71717a] flex items-center gap-1.5">
                                    <Layers size={12} className="text-[#4f46e5]" />
                                    <span>需求容器 · 编排模式</span>
                                  </span>
                                  <span className="text-[10.5px] font-medium text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-2 py-0.5 rounded-[4px]">
                                    {modeLabel}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between text-[11px] text-[#63636b] pt-0.5">
                                  <span>工序完成度: {groupPassed} / {groupTotal} ({groupPct}%)</span>
                                  <span className="font-mono text-[10px] text-[#85858d]">
                                    并发上限: {curTask.concurrencyLimit || (curTask.executionMode === 'serial' ? 1 : 3)}
                                  </span>
                                </div>

                                <div className="w-full bg-[#f4f4f6] rounded-full h-[4px] overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-[#4f46e5] transition-all duration-300"
                                    style={{ width: `${groupPct}%` }}
                                  />
                                </div>
                              </div>

                              {/* 顶部快速追加与规划动作栏（置于列表上方，避免工序过多时需滚动查找） */}
                              <div className="flex items-center justify-between gap-2 pb-0.5">
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setManualSubtaskWorkflowId(curTask.workflowId);
                                      setManualSubtaskTitle('');
                                      setManualSubtaskDesc('');
                                      setManualSubtaskAttachments([]);
                                      setManualSubtaskDep('');
                                      setManualSubtaskWorkspace(curTask.workspace || '');
                                      setIsAddingManualSubtask(true);
                                    }}
                                    className="flex items-center gap-1 text-[11px] text-[#4f46e5] hover:text-[#4338ca] font-medium cursor-pointer"
                                  >
                                    <Plus size={11} />
                                    <span>追加新工序</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setLinkExistingParentTask(curTask)}
                                    className="flex items-center gap-1 text-[11px] text-[#4f46e5] hover:text-[#4338ca] font-medium cursor-pointer"
                                    title="吸纳看板中现存的独立任务成为本容器的子工序"
                                  >
                                    <Link2 size={11} />
                                    <span>关联已有任务</span>
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  disabled={isPlanningAi}
                                  onClick={async () => {
                                    try {
                                      setIsPlanningAi(true);
                                      if (import.meta.env?.DEV) {
                                        console.log('[KanbanView:Subtasks] 请求 AI 继续规划工序:', curTask.id);
                                      }
                                      const res = await api.planSubtasks(curTask.id);
                                      if (res.plan?.subtasks && res.plan.subtasks.length > 0) {
                                        setAiPlanPreview(
                                          res.plan.subtasks.map((s: any) => ({
                                            title: s.title,
                                            workflowId: s.workflowId || curTask.workflowId,
                                            dependencies: s.dependencies || [],
                                          }))
                                        );
                                      }
                                    } catch (err: any) {
                                      toast.error(`规划失败: ${err.message}`);
                                    } finally {
                                      setIsPlanningAi(false);
                                    }
                                  }}
                                  className="text-[10.5px] text-[#85858d] hover:text-[#1c1c21] flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                                >
                                  <Sparkles size={10} />
                                  <span>让 AI 继续规划后续工序</span>
                                </button>
                              </div>

                              {/* 子工序流转链路列表 */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between px-0.5">
                                  <h4 className="text-[11px] font-semibold text-[#1c1c21] tracking-tight">
                                    工序流转链路 ({groupSubtasks.length})
                                  </h4>
                                  <div className="flex items-center gap-2.5">
                                    {groupAllPassed && curTask.status !== 'completed' && curTask.status !== 'running' && (
                                      <button
                                        type="button"
                                        onClick={() => handleArchiveTask(curTask.id)}
                                        className="flex items-center gap-1 text-[11px] text-[#4f46e5] hover:underline font-medium cursor-pointer"
                                        title="工序已全部完成，归档此任务组到「已完成」泳道"
                                      >
                                        <Archive size={10} />
                                        <span>归档到已完成</span>
                                      </button>
                                    )}
                                    {curTask.status === 'pending' && !groupAllPassed && (
                                      <button
                                        type="button"
                                        onClick={() => handleRunTask(curTask.id)}
                                        className="flex items-center gap-1 text-[11px] text-[#4f46e5] hover:underline font-medium cursor-pointer"
                                      >
                                        <Play size={10} className="fill-current" />
                                        <span>启动整组流水线</span>
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <div className="space-y-1.5">
                                  {displayGroupSubtasks.map(({ st, orderNo }) => {
                                    const stStatus = getTaskStatusInfo(st);
                                    const stWf = wfMap.get(st.workflowId);

                                    return (
                                      <div
                                        key={st.id}
                                        className="bg-white border border-[#e3e3e8] rounded-[7px] p-2.5 shadow-2xs hover:border-[#b9b9c2] transition-all flex items-center justify-between gap-2"
                                      >
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                          <span className="font-mono text-[10px] font-medium text-[#85858d] bg-[#f4f4f6] px-1.5 py-0.5 rounded shrink-0">
                                            #{orderNo}
                                          </span>
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span
                                                className="text-[12px] font-medium text-[#1c1c21] truncate max-w-[280px]"
                                                title={st.title}
                                              >
                                                {st.title}
                                              </span>
                                              {st.dependencies && st.dependencies.length > 0 && (
                                                <span className="text-[9px] font-mono text-[#63636b] bg-[#f4f4f7] px-1 py-[0.5px] rounded border border-[#ececf0] shrink-0">
                                                  依赖 #{groupSubtasks.findIndex((p) => p.id === st.dependencies![0]) + 1 || 1}
                                                </span>
                                              )}
                                            </div>
                                            {/* 异构流水线微标签与说明/附件微徽章 */}
                                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                              <span className="text-[9.5px] font-medium text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb]/70 px-1.5 py-[0.5px] rounded truncate max-w-[200px]">
                                                ⚡ {stWf?.name || st.workflowId}
                                              </span>
                                              {st.attachments && st.attachments.length > 0 && (
                                                <span className="inline-flex items-center gap-0.5 text-[9.5px] font-medium text-[#63636b] bg-[#f4f4f6] border border-[#e3e3e8] px-1 py-[0.5px] rounded" title={`${st.attachments.length} 张图片附件`}>
                                                  <ImageIcon size={9} />
                                                  <span>{st.attachments.length} 图</span>
                                                </span>
                                              )}
                                              {st.description && (
                                                <span className="text-[10px] text-[#85858d] truncate max-w-[240px]" title={st.description}>
                                                  {st.description}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <span
                                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium border ${stStatus.badgeClass}`}
                                          >
                                            <span className={`w-1.5 h-1.5 rounded-full ${stStatus.dotClass}`} />
                                            <span>{stStatus.label}</span>
                                          </span>

                                          {/* 点击直接在当前抽屉聚焦切换到此子工序 */}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedTask(st);
                                              setDrawerTab('overview');
                                            }}
                                            className="h-[24px] px-1.5 rounded-[4px] border border-[#e3e3e8] hover:bg-[#f4f4f6] text-[#63636b] hover:text-[#1c1c21] flex items-center gap-0.5 text-[10px] transition-colors cursor-pointer"
                                            title="聚焦并打开此子工序的独立节点运行图与上下文"
                                          >
                                            <Eye size={10.5} />
                                            <span>查看</span>
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => onOpenTaskLogs(st.id)}
                                            className="h-[24px] w-[24px] rounded-[4px] border border-[#e3e3e8] hover:bg-[#f4f4f6] text-[#63636b] hover:text-[#1c1c21] flex items-center justify-center transition-colors cursor-pointer"
                                            title="查看工序运行日志"
                                          >
                                            <Terminal size={11} />
                                          </button>

                                          {st.status !== 'running' && (
                                            <button
                                              type="button"
                                              disabled={runningTaskId === st.id}
                                              onClick={() => handleRunTask(st.id)}
                                              className="h-[24px] px-2 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10.5px] font-medium flex items-center gap-1 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                                              title="单独运行此工序"
                                            >
                                              <Play size={9} strokeWidth={2.4} />
                                              <span>单跑</span>
                                            </button>
                                          )}

                                          {/* 解绑脱离为独立任务 */}
                                          {st.status !== 'running' && curTask.status !== 'running' && (
                                            <button
                                              type="button"
                                              onClick={() => handleUnlinkSubtask(curTask.id, st.id)}
                                              className="h-[24px] w-[24px] rounded-[4px] hover:bg-[#fafafc] text-[#85858d] hover:text-[#4f46e5] hover:border hover:border-[#d8d6fb] flex items-center justify-center transition-colors cursor-pointer"
                                              title="脱离任务组，恢复为独立看板任务"
                                            >
                                              <Unlink size={11} />
                                            </button>
                                          )}

                                          {/* 删除未运行的子工序 */}
                                          {st.status !== 'running' && curTask.status !== 'running' && (
                                            <button
                                              type="button"
                                              onClick={async () => {
                                                try {
                                                  await api.deleteSubTask(curTask.id, st.id);
                                                  toast.success('已移除该工序');
                                                  onRefresh();
                                                } catch (err: any) {
                                                  toast.error(`移除工序失败: ${err.message}`);
                                                }
                                              }}
                                              className="h-[24px] w-[24px] rounded-[4px] hover:bg-[#fef2f2] text-[#85858d] hover:text-[#dc2626] flex items-center justify-center transition-colors cursor-pointer"
                                              title="移除此工序"
                                            >
                                              <Trash2 size={11} />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </>
                          )}
                        </>
                      );
                    })()}
                      </div>
                    )}
                  </main>

                  {/* 右栏：Agent 协作流，任务详情内常驻同屏 */}
                  {isAgentPaneOpen && (
                    <>
                      <div className="w-px shrink-0 bg-[#ececf0]" />
                      <aside className="w-[clamp(360px,42%,640px)] shrink-0 flex flex-col min-h-0 overflow-hidden">
                        <TaskAgentPanel
                          taskId={curTask.id}
                          taskTitle={curTask.kind === 'group' ? '任务组架构师' : curTask.title}
                          mode="inline"
                          model={sessionState?.model}
                          cwd={curTask.workspace}
                          sendExtra={buildChatSendExtra}
                          headerExtra={
                            <div className="flex items-center gap-1.5">
                              <AgentChatChangedFiles
                                taskId={curTask.id}
                                taskTitle={curTask.title}
                                isBusy={sessionState?.isBusy}
                                sessionMessagesCount={sessionState?.messages?.length || 0}
                              />
                              <button
                                type="button"
                                onClick={() => setIsQaSelectorOpen(true)}
                                className="h-[22px] px-2 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f7] hover:border-[#d4d4d8] text-[10.5px] font-medium text-[#4b4b53] transition-colors cursor-pointer select-none"
                                title="选择要随消息发送的 QA 测试产物"
                              >
                                {selectedQaTotalCount > 0
                                  ? `测试产物 · ${selectedQaTotalCount}`
                                  : '测试产物'}
                              </button>
                              {sessionState?.isPaused && (
                                <button
                                  type="button"
                                  disabled={isPausingSession}
                                  onClick={handleTogglePauseSession}
                                  className="h-[22px] px-2 rounded-[4px] bg-[#1c1c21] text-white text-[10.5px] font-medium hover:bg-[#2e2f36] transition-colors cursor-pointer select-none"
                                >
                                  {isPausingSession ? '恢复中' : '继续'}
                                </button>
                              )}

                              <div className="h-3.5 w-px bg-[#e3e3e8] mx-0.5 shrink-0" />

                              {/* 视窗模式：展开至全局工作台（沉浸全屏） */}
                              <button
                                type="button"
                                onClick={() => {
                                  const targetSessionId =
                                    curTaskSessionId ||
                                    `session_${curTask.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                                  handleOpenAgentSession(targetSessionId, {
                                    taskId: curTask.id,
                                    taskTitle: curTask.kind === 'group' ? '任务组架构师' : curTask.title,
                                    cwd: curTask.workspace,
                                  });
                                }}
                                className="h-[22px] w-[22px] rounded-[4px] border border-[#e3e3e8] bg-white hover:border-[#d8d6fb] hover:bg-[#eeedfd] text-[#63636b] hover:text-[#4f46e5] flex items-center justify-center transition-all shadow-2xs cursor-pointer select-none shrink-0"
                                title="展开至全局工作台（沉浸模式：全屏视窗、多终端与完整 Diff）"
                                aria-label="展开至全局工作台"
                              >
                                <Maximize2 size={11} strokeWidth={2.2} />
                              </button>
                            </div>
                          }
                        />
                      </aside>
                    </>
                  )}
                </div>
              </div>
        );
      })()}
    </div>
  )}

      {/* 编辑任务弹窗 */}
      <EditTaskModal
        isOpen={!!editingTask}
        onClose={() => setEditingTask(null)}
        task={editingTask}
        workflows={workflows}
        allTasks={tasks}
        onSave={handleSaveEditedTask}
      />

      {/* 沉浸式图片灯箱大图预览 */}
      <ImageLightboxModal
        isOpen={!!activeDetailImage}
        attachment={activeDetailImage}
        images={activeDetailImageList.length > 0 ? activeDetailImageList : (activeDetailImage ? [activeDetailImage] : [])}
        onIndexChange={(newIdx) => {
          if (activeDetailImageList[newIdx]) {
            setActiveDetailImage(activeDetailImageList[newIdx]);
          }
        }}
        onClose={() => {
          setActiveDetailImage(null);
          setActiveDetailImageList([]);
        }}
      />

      {/* 通用删除确认弹窗 */}
      <ConfirmModal
        isOpen={!!taskToDelete}
        title="删除任务"
        targetName={taskToDelete?.title}
        description="删除后此任务的所有执行日志与节点时序历史将被彻底清除，此操作不可恢复。"
        confirmText="彻底删除"
        cancelText="取消"
        variant="danger"
        loading={isDeleting}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          if (!isDeleting) setTaskToDelete(null);
        }}
      />

      {/* 视觉验收与时间轴截帧回放弹窗 */}
      {visualAcceptanceTask && (
        <VisualAcceptanceModal
          task={visualAcceptanceTask}
          workflow={wfMap.get(visualAcceptanceTask.workflowId)}
          onClose={() => setVisualAcceptanceTask(null)}
          onTaskUpdated={(updated) => {
            setVisualAcceptanceTask(updated);
            onTaskUpdate?.(updated);
          }}
          onApproved={(updated) => {
            if (updated && onTaskUpdate) {
              onTaskUpdate(updated);
            }
            setVisualAcceptanceTask(null);
            setSelectedTask(null);
          }}
          onRejected={(updated) => {
            if (updated && onTaskUpdate) {
              onTaskUpdate(updated);
            }
            setVisualAcceptanceTask(null);
            setSelectedTask(null);
          }}
        />
      )}

      {/* 精细选择 QA 自动化测试产物弹窗 */}
      <QaArtifactSelectorModal
        isOpen={isQaSelectorOpen}
        onClose={() => setIsQaSelectorOpen(false)}
        taskId={activeTask?.id || selectedTask?.id}
        initialSelection={selectedQaArtifacts}
        onConfirm={(selection) => {
          setSelectedQaArtifacts(selection);
          setIncludeQaArtifacts(false);
          if (import.meta.env?.DEV) {
            console.log('[KanbanView] 用户精选 QA 自动化测试产物:', selection);
          }
        }}
      />

      {/* 设置所属父任务弹窗 */}
      <SelectParentTaskModal
        isOpen={!!parentSelectTask}
        onClose={() => setParentSelectTask(null)}
        task={parentSelectTask}
        allTasks={tasks}
        workflows={workflows}
        onSuccess={() => {
          onRefresh();
        }}
      />

      {/* 需求容器关联已有子工序弹窗 */}
      <LinkExistingTasksModal
        isOpen={!!linkExistingParentTask}
        onClose={() => setLinkExistingParentTask(null)}
        parentTask={linkExistingParentTask ? (tasks.find((t) => t.id === linkExistingParentTask.id) || linkExistingParentTask) : undefined}
        allTasks={tasks}
        workflows={workflows}
        onSuccess={() => {
          onRefresh();
        }}
      />
    </div>
  );
};
