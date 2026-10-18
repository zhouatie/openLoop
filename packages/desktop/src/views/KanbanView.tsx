import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Check,
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
  Copy,
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
  Lightbulb,
  FolderGit2,
  FolderOpen,
  Folder,
  Image as ImageIcon,
  Loader2,
  ZoomIn,
} from 'lucide-react';
import { Task, KanbanColumn, WorkflowDefinition, NodeRun, TaskSessionState, SessionChatMessage, TaskAttachment } from '@openloop/core';
import { api } from '../services/api';
import { EditTaskModal } from '../components/EditTaskModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { KanbanColumnSortDropdown } from '../components/KanbanColumnSortDropdown';
import { NodeExecutionTimeline } from '../components/NodeExecutionTimeline';
import { ImageLightboxModal } from '../components/ImageLightboxModal';
import { AgentMarkdown } from '../components/AgentMarkdown';
import { ChatScrollToLatestButton } from '../components/ChatScrollToLatestButton';
import { VisualAcceptanceModal } from '../components/qa/VisualAcceptanceModal';
import { toast } from '../components/Toast';
import { resolveNodeMeta } from '../utils/nodeMeta';
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

export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks,
  workflows,
  onOpenTaskLogs,
  onRefresh,
  onTaskUpdate,
  selectedWorkspaceFilter,
  onWorkspaceFilterChange,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedSession, setCopiedSession] = useState(false);
  const [visualAcceptanceTask, setVisualAcceptanceTask] = useState<Task | null>(null);

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

  const handleResumeTerminal = async (taskId: string) => {
    try {
      await api.resumeTerminal(taskId);
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 拉起终端失败:', err);
      }
      toast.error(`拉起终端失败: ${err?.message || '未知错误'}`);
    }
  };
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [skippingTaskId, setSkippingTaskId] = useState<string | null>(null);
  const [retryingNodeKey, setRetryingNodeKey] = useState<string | null>(null);
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
  const [selectedWorkflowFilter, setSelectedWorkflowFilter] = useState<string>('all');
  const [isWfDropdownOpen, setIsWfDropdownOpen] = useState(false);
  const wfDropdownRef = useRef<HTMLDivElement>(null);

  // Inbox 列快速添加想法状态
  const [isQuickAddingIdea, setIsQuickAddingIdea] = useState(false);
  const [quickIdeaTitle, setQuickIdeaTitle] = useState('');
  const [isSubmittingQuickIdea, setIsSubmittingQuickIdea] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);

  // 任务侧边栏 Tab 与 Agent 会话实时交互状态
  const [drawerTab, setDrawerTab] = useState<'overview' | 'session'>('overview');
  const [sessionState, setSessionState] = useState<TaskSessionState | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isPausingSession, setIsPausingSession] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);

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
    isActive: drawerTab === 'session' && !!selectedTask,
    resetKey: selectedTask?.id,
  });

  // 打开任务抽屉时同步获取最新 Session 状态
  useEffect(() => {
    if (selectedTask) {
      api.getTaskSession(selectedTask.id)
        .then((state) => {
          setSessionState(state);
          // 若任务正在执行中且处于 agent 状态，或已有历史消息，可智能保留或建议查看
        })
        .catch(() => {});
    } else {
      setSessionState(null);
      setDrawerTab('overview');
      setChatInput('');
      setChatAttachments([]);
      setPendingChatUploads([]);
    }
  }, [selectedTask?.id]);

  // 实时订阅 WebSocket 推送的 agent:chat_update 事件
  useEffect(() => {
    const unsub = api.on('agent:chat_update', (data: TaskSessionState) => {
      if (selectedTask && data.taskId === selectedTask.id) {
        setSessionState(data);
      }
    });
    return () => unsub();
  }, [selectedTask?.id]);


  // 侧边栏 Agent 会话图片上传状态
  const [chatAttachments, setChatAttachments] = useState<TaskAttachment[]>([]);
  const [pendingChatUploads, setPendingChatUploads] = useState<PendingChatAttachment[]>([]);
  const [isChatDragging, setIsChatDragging] = useState(false);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

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

  // 发送消息（支持运行中无缝插话 Steer 与空闲时发起交互）
  const handleSendChat = async () => {
    if (!selectedTask || isSendingChat) return;
    const msg = chatInput.trim();
    const toSendAttachments = [...chatAttachments];
    if (!msg && toSendAttachments.length === 0) return;
    if (pendingChatUploads.some((p) => p.status === 'uploading')) {
      toast.warning('请等待图片附件上传完成后再发送');
      return;
    }

    setChatInput('');
    setChatAttachments([]);
    setIsSendingChat(true);
    scrollChatToBottom(true);

    if (import.meta.env?.DEV) {
      console.log('[UI:AgentChat] 用户向 Agent 发送对话:', {
        taskId: selectedTask.id,
        content: msg,
        attachmentsCount: toSendAttachments.length,
      });
    }

    // 乐观更新界面
    if (sessionState) {
      setSessionState({
        ...sessionState,
        isBusy: true,
        messages: [
          ...sessionState.messages,
          {
            id: `opt_${Date.now()}`,
            role: 'user',
            content: msg,
            attachments: toSendAttachments.length > 0 ? toSendAttachments : undefined,
            timestamp: Date.now(),
          },
        ],
      });
    }

    try {
      await api.sendTaskChatMessage(selectedTask.id, msg, toSendAttachments);
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

  const wfMap = new Map(workflows.map((w) => [w.id, w]));

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
      if (activeWorkspaceFilter === 'none') {
        return !t.workspace || !t.workspace.trim();
      }
      if (activeWorkspaceFilter !== 'all') {
        return t.workspace === activeWorkspaceFilter;
      }
      return true;
    });
  }, [tasks, activeWorkspaceFilter]);

  const filteredTasks = tasks.filter((t) => {
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

  const handleQuickAddIdea = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!quickIdeaTitle.trim() || isSubmittingQuickIdea) return;
    const defaultWfId = workflows[0]?.id || 'wf_auto_dev_qa';
    const targetWorkspace =
      activeWorkspaceFilter !== 'all' && activeWorkspaceFilter !== 'none'
        ? activeWorkspaceFilter
        : undefined;

    setIsSubmittingQuickIdea(true);
    if (import.meta.env?.DEV) {
      console.log('[KanbanView] 快捷录入 Inbox 想法任务:', {
        title: quickIdeaTitle.trim(),
        workflowId: defaultWfId,
        kanbanColumn: 'inbox',
        workspace: targetWorkspace || '未指定',
      });
    }
    try {
      await api.createTask({
        title: quickIdeaTitle.trim(),
        workflowId: defaultWfId,
        description: '来自 Inbox 快捷想法收集',
        kanbanColumn: 'inbox',
        autoRun: false,
        workspace: targetWorkspace,
      });
      setQuickIdeaTitle('');
      setIsQuickAddingIdea(false);
      toast.success('想法已记录至 Inbox');
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 快捷录入想法失败:', err);
      }
      toast.error(`创建想法失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsSubmittingQuickIdea(false);
    }
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

  const handleApprove = async (taskId: string, approved: boolean) => {
    setApprovingId(taskId);
    try {
      await api.resumeTask(taskId, approved, approved ? 'QA 查验通过' : '验收驳回');
      toast.success(approved ? 'QA 验收已通过' : '已驳回验收');
      onRefresh();
    } catch (e: any) {
      if (import.meta.env?.DEV) {
        console.error('[KanbanView] 审批失败:', e);
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
        } else if (selectedTask) {
          setSelectedTask(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isWsDropdownOpen, isWfDropdownOpen, isBoardSortOpen, openSortDropdownCol, editingTask, previewArtifact, selectedTask]);

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
              const rawTasks = filteredTasks.filter((t) => {
                if (col.key === 'in_progress') {
                  return t.kanbanColumn === 'in_progress' || (t.kanbanColumn as string) === 'agent_executing';
                }
                return t.kanbanColumn === col.key;
              });
              const colRule = columnSortConfig[col.key] || DEFAULT_SORT_RULE;
              const colTasks = sortTasks(rawTasks, colRule);

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
                    {/* Inbox 专属轻量快捷添加输入面板 */}
                    {col.key === 'inbox' && isQuickAddingIdea && (
                      <form
                        onSubmit={handleQuickAddIdea}
                        className="bg-white border border-[#6366f1]/40 rounded-[8px] p-2.5 shadow-[0_4px_12px_rgba(99,102,241,0.08)] space-y-2 animate-in fade-in zoom-in-95 duration-100"
                      >
                        <div className="flex items-center justify-between text-[11px] font-medium text-[#6366f1]">
                          <span className="flex items-center gap-1.5">
                            <Lightbulb size={12} />
                            <span>随手记想法</span>
                            {activeWorkspaceFilter !== 'all' && activeWorkspaceFilter !== 'none' && (
                              <span className="text-[9.5px] font-normal text-[#85858d] bg-[#f4f4f6] px-1 py-[0.5px] rounded border border-[#ececf0] truncate max-w-[120px]">
                                {getDirectoryName(activeWorkspaceFilter)}
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] text-[#85858d]">暂缓执行</span>
                        </div>
                        <input
                          type="text"
                          autoFocus
                          placeholder={
                            activeWorkspaceFilter !== 'all' && activeWorkspaceFilter !== 'none'
                              ? `输入突发奇想，按 Enter 存入 ${getDirectoryName(activeWorkspaceFilter)}...`
                              : '输入突发奇想，按 Enter 存入...'
                          }
                          value={quickIdeaTitle}
                          onChange={(e) => setQuickIdeaTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setIsQuickAddingIdea(false);
                            }
                          }}
                          className="w-full h-[28px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none focus:bg-white focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]/20 transition-all"
                        />
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setIsQuickAddingIdea(false)}
                            className="h-[22px] px-2 rounded-[4px] text-[10.5px] text-[#85858d] hover:bg-[#f1f1f4]"
                          >
                            取消
                          </button>
                          <button
                            type="submit"
                            disabled={!quickIdeaTitle.trim() || isSubmittingQuickIdea}
                            className="h-[22px] px-2.5 rounded-[4px] bg-[#6366f1] hover:bg-[#4f46e5] text-white text-[10.5px] font-medium disabled:opacity-40 transition-colors shadow-sm"
                          >
                            {isSubmittingQuickIdea ? '保存中...' : '存入 Inbox'}
                          </button>
                        </div>
                      </form>
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
                      colTasks.map((task) => {
                        const wf = wfMap.get(task.workflowId);
                        const currentNode = wf?.nodes.find((n) => n.id === task.currentNodeId);
                        const currentNodeMeta = task.currentNodeId
                          ? resolveNodeMeta(task.currentNodeId, wf, workflows)
                          : null;
                        const nodeRuns = Object.values(task.nodeRuns || {});
                        const isCompleted = task.status === 'completed';
                        const completedCount = nodeRuns.filter((r) => r.status === 'success').length;
                        const totalNodes = wf?.nodes.length || completedCount || 1;
                        const displayTotal = Math.max(totalNodes, completedCount);
                        const displayCompleted = isCompleted ? displayTotal : completedCount;
                        const progressPct = isCompleted ? 100 : Math.round((displayCompleted / displayTotal) * 100);
                        const lastFailedRun = nodeRuns.slice().reverse().find((r) => r.status === 'failed');
                        const failReason = lastFailedRun?.error || '执行中断或驳回';

                        return (
                          <div
                            key={task.id}
                            onClick={() => setSelectedTask(task)}
                            className={`group bg-white border rounded-[8px] p-3 transition-all cursor-pointer ${
                              task.status === 'waiting_approval'
                                ? 'border-[#1c1c21]/30 shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                                : task.status === 'failed'
                                ? 'border-[#d64545]/30 shadow-[0_1px_2px_rgba(214,69,69,0.06)]'
                                : 'border-[#e3e3e8] hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5 min-w-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="text-[10.5px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0] truncate max-w-[100px]"
                                  title={task.id}
                                >
                                  {task.id}
                                </span>
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
                                    disabled={cancellingTaskId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCancelTask(task.id);
                                    }}
                                    className="p-1 rounded text-[#85858d] hover:text-[#d64545] hover:bg-[#fbe9e9]"
                                    title="终止此任务"
                                  >
                                    <Square size={11} className="fill-current" />
                                  </button>
                                )}
                                {task.status === 'pending' && task.kanbanColumn === 'inbox' && (
                                  <button
                                    disabled={movingTaskId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMoveTaskColumn(task.id, 'backlog');
                                    }}
                                    className="p-1 rounded text-[#85858d] hover:text-[#4f46e5] hover:bg-[#eeedfd]"
                                    title="移入待处理泳道"
                                  >
                                    <ArrowRight size={11} />
                                  </button>
                                )}
                                {task.status === 'pending' && task.kanbanColumn === 'backlog' && (
                                  <button
                                    disabled={movingTaskId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMoveTaskColumn(task.id, 'inbox');
                                    }}
                                    className="p-1 rounded text-[#85858d] hover:text-[#6366f1] hover:bg-[#eeedfd]"
                                    title="移入 Inbox 想法收集"
                                  >
                                    <Inbox size={11} />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingTask(task);
                                  }}
                                  className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4]"
                                  title="编辑任务"
                                >
                                  <Edit3 size={11} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenTaskLogs(task.id);
                                  }}
                                  className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4]"
                                  title="查看实时终端"
                                >
                                  <Terminal size={11} strokeWidth={1.8} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTaskToDelete(task);
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
                              <span className="truncate">{wf?.name || task.workflowId}</span>
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

                            {/* 未启动任务：卡片内一键启动按钮 */}
                            {task.status === 'pending' && (
                              <div className="my-2">
                                {task.kanbanColumn === 'inbox' ? (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      disabled={movingTaskId === task.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleMoveTaskColumn(task.id, 'backlog');
                                      }}
                                      className="flex-1 h-[24px] rounded-[5px] bg-[#f1f1f4] hover:bg-[#e4e4e9] text-[#1c1c21] text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 border border-[#e3e3e8]"
                                      title="将此想法移入待处理准备执行"
                                    >
                                      <ArrowRight size={10} />
                                      <span>{movingTaskId === task.id ? '移动中...' : '移入待处理'}</span>
                                    </button>
                                    <button
                                      disabled={runningTaskId === task.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRunTask(task.id);
                                      }}
                                      className="h-[24px] px-2.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 shadow-sm"
                                      title="直接启动流水线"
                                    >
                                      <Play size={10} strokeWidth={2.4} />
                                      <span>{runningTaskId === task.id ? '启动中' : '启动'}</span>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      disabled={runningTaskId === task.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRunTask(task.id);
                                      }}
                                      className="flex-1 h-[24px] rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 shadow-sm"
                                    >
                                      <Play size={10} strokeWidth={2.4} />
                                      <span>{runningTaskId === task.id ? '启动中...' : '启动流水线'}</span>
                                    </button>
                                    <button
                                      disabled={movingTaskId === task.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleMoveTaskColumn(task.id, 'inbox');
                                      }}
                                      className="h-[24px] px-2 rounded-[5px] bg-[#f9f9fb] hover:bg-[#eeedfd] text-[#85858d] hover:text-[#6366f1] text-[10.5px] font-medium flex items-center justify-center gap-1 transition-all border border-[#e3e3e8]"
                                      title="退回 Inbox 想法收集"
                                    >
                                      <Inbox size={10} />
                                      <span>转想法</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 失败/驳回任务：克制优雅的错误状态与微型重试/跳过胶囊 */}
                            {task.status === 'failed' && (
                              <div className="my-2 p-1.5 rounded-[6px] bg-[#fdf2f2] border border-[#fbd5d5] flex items-center justify-between gap-1.5">
                                <div className="min-w-0 flex items-center gap-1 text-[10.5px] text-[#d64545] font-medium truncate">
                                  <AlertCircle size={11} className="shrink-0" />
                                  <span className="truncate" title={failReason}>
                                    {failReason}
                                  </span>
                                </div>
                                <div className="shrink-0 flex items-center gap-1">
                                  <button
                                    disabled={skippingTaskId === task.id || runningTaskId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSkipNode(task.id, lastFailedRun?.nodeId);
                                    }}
                                    className="h-[20px] px-1.5 rounded-[4px] bg-white hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[10px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm disabled:opacity-50"
                                    title="跳过当前报错节点，继续后续流程或标记完成"
                                  >
                                    <SkipForward size={9.5} className="text-[#85858d]" />
                                    <span>{skippingTaskId === task.id ? '跳过中' : '跳过'}</span>
                                  </button>
                                  <button
                                    disabled={runningTaskId === task.id || skippingTaskId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRunTask(task.id);
                                    }}
                                    className="h-[20px] px-2 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm disabled:opacity-50"
                                    title="重新运行整条流水线"
                                  >
                                    <RotateCcw size={9.5} />
                                    <span>重试</span>
                                  </button>
                                </div>
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
                                  disabled={runningTaskId === task.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRunTask(task.id);
                                  }}
                                  className="shrink-0 h-[20px] px-2 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm disabled:opacity-50"
                                >
                                  <RotateCcw size={9.5} />
                                  <span>重新执行</span>
                                </button>
                              </div>
                            )}

                            {task.status === 'running' && (currentNodeMeta || currentNode) && (() => {
                              const activeType = currentNode?.type || currentNodeMeta?.type;
                              const visual = getRunningNodeVisual(activeType);
                              const IconComp = visual.icon;
                              const activeName = currentNodeMeta?.name || currentNode?.name || '自动化工序执行中';

                              return (
                                <div className={`mb-2 p-2 rounded-[7px] border transition-all ${visual.badgeBg} ${visual.badgeBorder}`}>
                                  <div className="flex items-center justify-between gap-1.5 mb-1.5">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className="relative flex h-2 w-2 shrink-0">
                                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${visual.pingColor}`} />
                                        <span className={`relative inline-flex rounded-full h-2 w-2 ${visual.pingColor}`} />
                                      </span>
                                      <span className={`text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-white/90 border ${visual.badgeBorder} ${visual.badgeText} flex items-center gap-1 shrink-0`}>
                                        <IconComp size={9.5} />
                                        <span>{visual.label}</span>
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onOpenTaskLogs(task.id, task.currentNodeId);
                                        }}
                                        className="h-[19px] px-1.5 rounded-[4px] bg-white/90 hover:bg-white text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[9.5px] font-medium flex items-center gap-1 transition-all shadow-xs"
                                        title="查看实时运行终端"
                                      >
                                        <Terminal size={8.5} className="text-[#85858d]" />
                                        <span>终端</span>
                                      </button>
                                      <button
                                        disabled={cancellingTaskId === task.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCancelTask(task.id);
                                        }}
                                        className="h-[19px] px-1.5 rounded-[4px] bg-white/90 hover:bg-[#fee2e2] text-[#85858d] hover:text-[#d64545] border border-[#e3e3e8] hover:border-[#fecaca] text-[9.5px] font-medium flex items-center gap-1 transition-all shadow-xs"
                                        title="终止任务"
                                      >
                                        <Square size={8} className="fill-current" />
                                        <span>{cancellingTaskId === task.id ? '终止中' : '终止'}</span>
                                      </button>
                                    </div>
                                  </div>
                                  <div className="text-[11px] font-medium text-[#1c1c21] truncate flex items-center gap-1" title={activeName}>
                                    <span className="truncate">{activeName}</span>
                                  </div>
                                </div>
                              );
                            })()}

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
                                    <span className="text-[9.5px] font-mono bg-[#eff6ff] text-[#2563eb] px-1 rounded border border-[#bfdbfe]">
                                      靶机 :{task.context.worktree.webPort}
                                    </span>
                                  )}
                                </div>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setVisualAcceptanceTask(task);
                                  }}
                                  className="w-full h-[24px] rounded-[5px] bg-[#4f46e5]/10 hover:bg-[#4f46e5]/20 text-[#4338ca] text-[11px] font-medium flex items-center justify-center gap-1.5 border border-[#c7d2fe] transition-all cursor-pointer"
                                >
                                  <Play size={10} className="fill-current" />
                                  <span>查看截帧回放与验收</span>
                                </button>

                                <div className="flex items-center gap-1.5">
                                  <button
                                    disabled={approvingId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleApprove(task.id, true);
                                    }}
                                    className="flex-1 h-[24px] rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
                                  >
                                    <Check size={11} strokeWidth={2.4} />
                                    验收通过
                                  </button>
                                  <button
                                    disabled={approvingId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleApprove(task.id, false);
                                    }}
                                    className="h-[24px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#63636b] hover:text-[#1c1c21] hover:bg-[#f1f1f4] text-[11px] font-medium transition-all"
                                  >
                                    驳回
                                  </button>
                                </div>
                              </div>
                            )}

                            {nodeRuns.some((r) => r.artifacts && r.artifacts.length > 0) && (
                              <div className="mb-2 flex flex-wrap gap-1">
                                {nodeRuns
                                  .flatMap((r) => r.artifacts || [])
                                  .map((art, idx) => (
                                    <button
                                      key={idx}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const isImage = /\.(png|jpe?g|webp|svg)$/i.test(art.name);
                                        if (isImage) {
                                          setActiveDetailImage({
                                            id: `art_${idx}`,
                                            name: art.name,
                                            mimeType: 'image/png',
                                            path: art.path,
                                            url: art.path,
                                            size: 1024,
                                            createdAt: Date.now(),
                                          });
                                        } else {
                                          setPreviewArtifact(art);
                                        }
                                      }}
                                      className="flex items-center gap-1 px-1.5 h-[20px] rounded-[4px] bg-[#f1f1f4] border border-[#e3e3e8] text-[10.5px] text-[#4b4b53] hover:bg-[#e9e9ee]"
                                    >
                                      <FileImage size={10} className="text-[#4f46e5]" />
                                      <span>{art.name}</span>
                                    </button>
                                  ))}
                              </div>
                            )}

                            {task.context?.piSessionId && (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResumeTerminal(task.id);
                                }}
                                className="mb-1.5 flex items-center justify-between text-[10px] text-[#4b4b53] bg-[#f4f4f7] hover:bg-[#eaebee] px-2 py-[2.5px] rounded-[5px] border border-[#e3e3e8] cursor-pointer transition-colors"
                                title="点击调起终端恢复会话"
                              >
                                <span className="flex items-center gap-1.5 font-mono truncate">
                                  <Terminal size={9.5} className="text-[#85858d]" />
                                  <span>pi: {task.context.piSessionId.replace('session_', '')}</span>
                                </span>
                                <span className="text-[9.5px] text-[#85858d] flex items-center gap-0.5">
                                  恢复 <ExternalLink size={8.5} />
                                </span>
                              </div>
                            )}

                            <div className="pt-1.5 border-t border-[#ececf0] flex items-center justify-between text-[10.5px] text-[#85858d]">
                              <div className="flex items-center gap-1.5">
                                <span>
                                  节点 {displayCompleted}/{displayTotal}
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
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                                <span className="font-mono">{progressPct}%</span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      {/* 产物预览弹窗 */}
      {previewArtifact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100">
          <div className="w-[480px] bg-white border border-[#e3e3e8] rounded-[12px] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.16)]">
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

      {/* 任务详情侧抽屉与背景蒙层 */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100"
          onClick={() => setSelectedTask(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[520px] max-w-[90vw] h-full bg-white border-l border-[#e3e3e8] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.22)] flex flex-col animate-in slide-in-from-right duration-150 relative z-10"
          >
            {/* 抽屉顶部头部 */}
            <div className="pb-3 border-b border-[#ececf0]">
              <div className="flex items-center justify-between">
                <div className="min-w-0 mr-2">
                  <div className="text-[10.5px] font-mono text-[#85858d] truncate">{selectedTask.id}</div>
                  <h3 className="text-[13.5px] font-semibold text-[#1c1c21] mt-0.5 truncate">{selectedTask.title}</h3>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditingTask(selectedTask)}
                    className="h-[26px] px-2 rounded-[5px] border border-[#e3e3e8] text-[#4b4b53] hover:text-[#1c1c21] hover:bg-[#f1f1f4] text-[11.5px] flex items-center gap-1 transition-colors"
                    title="编辑此任务"
                  >
                    <Edit3 size={11} />
                    <span>编辑</span>
                  </button>
                  <button
                    onClick={() => setTaskToDelete(selectedTask)}
                    className="h-[26px] w-[26px] rounded-[5px] border border-[#e3e3e8] text-[#85858d] hover:text-[#e5484d] hover:bg-[#fbe9e9] flex items-center justify-center transition-colors"
                    title="删除任务"
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    onClick={() => setSelectedTask(null)}
                    className="w-6 h-6 rounded flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] ml-1"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* 抽屉 Segmented Control 双 Tab 切换 */}
              <div className="flex items-center gap-1 p-0.5 rounded-[7px] bg-[#f1f1f4] border border-[#e3e3e8] mt-3">
                <button
                  onClick={() => setDrawerTab('overview')}
                  className={`flex-1 h-[26px] rounded-[5px] text-[11.5px] font-medium flex items-center justify-center gap-1.5 transition-all ${
                    drawerTab === 'overview'
                      ? 'bg-white text-[#1c1c21] shadow-sm font-semibold'
                      : 'text-[#63636b] hover:text-[#1c1c21]'
                  }`}
                >
                  <Layers size={12} />
                  <span>任务概览</span>
                </button>
                <button
                  onClick={() => setDrawerTab('session')}
                  className={`flex-1 h-[26px] rounded-[5px] text-[11.5px] font-medium flex items-center justify-center gap-1.5 transition-all relative ${
                    drawerTab === 'session'
                      ? 'bg-white text-[#1c1c21] shadow-sm font-semibold'
                      : 'text-[#63636b] hover:text-[#1c1c21]'
                  }`}
                >
                  <Bot size={12} className={sessionState?.isBusy ? 'text-[#7c3aed]' : ''} />
                  <span>Agent 实时对话</span>
                  {(sessionState?.isBusy || selectedTask.status === 'running') && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-pulse" />
                  )}
                  {(sessionState?.messages?.length || 0) > 0 && (
                    <span className="text-[10px] font-mono px-1 rounded-full bg-[#ececf0] text-[#63636b]">
                      {sessionState?.messages.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* TAB 1: 任务概览 */}
            {drawerTab === 'overview' && (
              <>
                <div className="flex-1 py-4 overflow-y-auto space-y-4 text-[12px]">
                  {/* 状态与泳道指标 */}
                  <div className="grid grid-cols-2 gap-2.5 p-3 rounded-[8px] bg-[#f9f9fb] border border-[#ececf0]">
                    <div>
                      <span className="text-[#85858d] text-[11px] block">当前运行状态</span>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded-[4px] text-[11px] font-medium ${
                          getTaskStatusInfo(selectedTask).badgeClass
                        }`}
                      >
                        {getTaskStatusInfo(selectedTask).label}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#85858d] text-[11px] block">所在泳道</span>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="font-medium text-[#1c1c21]">
                          {COLUMN_NAMES[selectedTask.kanbanColumn] || selectedTask.kanbanColumn}
                        </span>
                        {selectedTask.status === 'pending' && selectedTask.kanbanColumn === 'inbox' && (
                          <button
                            disabled={movingTaskId === selectedTask.id}
                            onClick={() => handleMoveTaskColumn(selectedTask.id, 'backlog')}
                            className="px-1.5 py-0.5 rounded bg-[#f1f1f4] hover:bg-[#eeedfd] text-[#4f46e5] text-[10px] font-medium border border-[#e3e3e8] transition-colors"
                            title="移入待处理泳道准备执行"
                          >
                            {movingTaskId === selectedTask.id ? '移动中' : '移入待处理 →'}
                          </button>
                        )}
                        {selectedTask.status === 'pending' && selectedTask.kanbanColumn === 'backlog' && (
                          <button
                            disabled={movingTaskId === selectedTask.id}
                            onClick={() => handleMoveTaskColumn(selectedTask.id, 'inbox')}
                            className="px-1.5 py-0.5 rounded bg-[#f1f1f4] hover:bg-[#eeedfd] text-[#6366f1] text-[10px] font-medium border border-[#e3e3e8] transition-colors"
                            title="移至 Inbox 收集箱"
                          >
                            {movingTaskId === selectedTask.id ? '移动中' : '← 移至 Inbox'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 关联工作流 */}
                  <div>
                    <div className="font-medium text-[#1c1c21] mb-1.5">关联自动化流程</div>
                    <div className="p-2.5 rounded-[7px] border border-[#ececf0] bg-[#f9f9fb] flex items-center justify-between">
                      <div>
                        <div className="font-medium text-[#1c1c21]">
                          {wfMap.get(selectedTask.workflowId)?.name || selectedTask.workflowId}
                        </div>
                        <div className="text-[11px] font-mono text-[#85858d] mt-0.5">
                          {selectedTask.workflowId}
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-[#85858d]">
                        {wfMap.get(selectedTask.workflowId)?.nodes.length || 0} 节点
                      </span>
                    </div>
                  </div>

                  {/* 关联工程工作区 */}
                  <div>
                    <div className="font-medium text-[#1c1c21] mb-1.5 flex items-center justify-between">
                      <span>关联工程工作区</span>
                      {selectedTask.workspace && (
                        <button
                          type="button"
                          onClick={() => api.openPath(selectedTask.workspace!)}
                          className="text-[11px] text-[#4f46e5] hover:underline flex items-center gap-1 font-normal transition-colors"
                          title="在系统原生文件管理器中打开"
                        >
                          <FolderOpen size={11} /> 在访达中打开
                        </button>
                      )}
                    </div>
                    <div className="p-2.5 rounded-[7px] border border-[#ececf0] bg-[#f9f9fb] flex items-center justify-between">
                      {selectedTask.workspace ? (
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="flex items-center gap-1.5 font-medium text-[#1c1c21]">
                            <FolderGit2 size={13} className="text-[#4f46e5] shrink-0" />
                            <span className="truncate">
                              {selectedTask.workspace.replace(/[/\\]+$/, '').split(/[/\\]/).pop()}
                            </span>
                            <span className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1 py-[0.5px] rounded">
                              Workspace
                            </span>
                          </div>
                          <div
                            className="text-[11px] font-mono text-[#63636b] mt-0.5 truncate select-all"
                            title={selectedTask.workspace}
                          >
                            {selectedTask.workspace}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[#85858d] text-[11.5px] italic">未关联独立工程工作区 (默认运行时目录)</div>
                      )}
                    </div>
                  </div>

                  {/* 任务说明与提示词 */}
                  <div>
                    <div className="font-medium text-[#1c1c21] mb-1.5 flex items-center justify-between">
                      <span>任务说明与提示词</span>
                      {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                        <span className="text-[10px] text-[#85858d] font-mono">
                          {selectedTask.attachments.length} 张参考图片
                        </span>
                      )}
                    </div>
                    <div className="p-2.5 rounded-[7px] border border-[#ececf0] bg-[#f9f9fb] text-[#4b4b53] leading-relaxed whitespace-pre-wrap">
                      {selectedTask.description || (
                        <span className="text-[#85858d] italic">未设置说明与 Prompt 提示词</span>
                      )}
                    </div>

                    {/* 任务图片附件画廊 */}
                    {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                      <div className="mt-2 flex items-center gap-2 overflow-x-auto py-1 scrollbar-thin">
                        {selectedTask.attachments.map((att) => {
                          const displayUrl = api.getAttachmentUrl(att.url);
                          return (
                            <div
                              key={att.id}
                              onClick={() => setActiveDetailImage(att)}
                              className="group relative w-[56px] h-[56px] shrink-0 rounded-[7px] border border-[#e3e3e8] bg-white overflow-hidden shadow-xs hover:border-[#4f46e5] cursor-pointer transition-all"
                              title={`${att.name}\n${(att.size / 1024).toFixed(0)} KB\n点击大图预览`}
                            >
                              <img
                                src={displayUrl}
                                alt={att.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <ZoomIn size={13} className="text-white" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Pi Agent 会话凭证与终端恢复 */}
                  {selectedTask.context?.piSessionId && (
                    <div className="p-3 rounded-[9px] border border-[#e0e0ea] bg-[#fafaff] space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#1c1c21]">
                          <Terminal size={13} className="text-[#4f46e5]" />
                          <span>Pi Agent 会话凭证</span>
                        </div>
                        <span className="text-[10px] font-mono text-[#4f46e5] bg-[#eeedfd] px-1.5 py-[1px] rounded font-medium">
                          可终端接管
                        </span>
                      </div>

                      <div className="bg-[#1c1c21] text-white rounded-[6px] px-2.5 py-1.5 text-[11px] font-mono flex items-center justify-between select-all">
                        <span className="truncate mr-2">pi --session {selectedTask.context.piSessionId}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`pi --session ${selectedTask.context.piSessionId}`);
                            setCopiedSession(true);
                            setTimeout(() => setCopiedSession(false), 2000);
                          }}
                          className="shrink-0 text-[10.5px] text-[#a5a5b0] hover:text-white flex items-center gap-1 transition-colors"
                        >
                          {copiedSession ? <Check size={11} className="text-[#189a58]" /> : <Copy size={11} />}
                          <span>{copiedSession ? '已复制' : '复制'}</span>
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-0.5">
                        <span className="text-[11px] text-[#85858d]">
                          任务独立会话，历史与上下文完整保留
                        </span>
                        <button
                          onClick={() => handleResumeTerminal(selectedTask.id)}
                          className="h-[24px] px-2.5 rounded-[5px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[11px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                        >
                          <ExternalLink size={11} />
                          <span>在终端打开</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 节点执行时序 */}
                  <div>
                    <div className="font-medium text-[#1c1c21] mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>节点执行时序</span>
                        <span className="text-[11px] font-normal text-[#85858d]">
                          (工作流时序轨迹)
                        </span>
                      </div>
                      <span className="text-[10.5px] font-mono text-[#85858d]">
                        {Object.keys(selectedTask.nodeRuns).length} 个已记录节点
                      </span>
                    </div>

                    <NodeExecutionTimeline
                      task={selectedTask}
                      workflow={wfMap.get(selectedTask.workflowId)}
                      allWorkflows={workflows}
                      onOpenTaskLogs={onOpenTaskLogs}
                      onPreviewArtifact={(art) => setPreviewArtifact(art)}
                      onApprove={(taskId, approved, feedback) => handleApprove(taskId, approved, feedback)}
                      isApproving={approvingId === selectedTask.id}
                      onSkipNode={(taskId, nodeId) => handleSkipNode(taskId, nodeId)}
                      onRetryNode={(taskId, nodeId) => handleRetryNode(taskId, nodeId)}
                      isSkipping={skippingTaskId === selectedTask.id}
                      isRetryingNode={retryingNodeKey?.startsWith(selectedTask.id)}
                    />
                  </div>
                </div>

                {/* 抽屉底部操作区 */}
                <div className="pt-3.5 border-t border-[#ececf0] space-y-2">
                  {selectedTask.status === 'pending' && (
                    selectedTask.kanbanColumn === 'inbox' ? (
                      <div className="flex gap-2">
                        <button
                          disabled={movingTaskId === selectedTask.id}
                          onClick={() => handleMoveTaskColumn(selectedTask.id, 'backlog')}
                          className="flex-1 h-[32px] rounded-[7px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[#1c1c21] text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm"
                        >
                          <ArrowRight size={13} />
                          <span>{movingTaskId === selectedTask.id ? '移动中...' : '移入待处理'}</span>
                        </button>
                        <button
                          disabled={runningTaskId === selectedTask.id}
                          onClick={() => handleRunTask(selectedTask.id)}
                          className="flex-1 h-[32px] rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white flex items-center justify-center gap-1.5 transition-all shadow-sm"
                        >
                          <Play size={13} strokeWidth={2.4} />
                          <span>{runningTaskId === selectedTask.id ? '正在启动...' : '立即启动执行'}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <button
                          disabled={runningTaskId === selectedTask.id}
                          onClick={() => handleRunTask(selectedTask.id)}
                          className="w-full h-[32px] rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white flex items-center justify-center gap-1.5 transition-all shadow-sm"
                        >
                          <Play size={13} strokeWidth={2.4} />
                          <span>{runningTaskId === selectedTask.id ? '正在启动...' : '立即启动此任务'}</span>
                        </button>
                        <button
                          disabled={movingTaskId === selectedTask.id}
                          onClick={() => handleMoveTaskColumn(selectedTask.id, 'inbox')}
                          className="w-full h-[26px] rounded-[6px] border border-[#e3e3e8] bg-transparent hover:bg-[#f1f1f4] text-[#85858d] hover:text-[#6366f1] text-[11px] font-medium flex items-center justify-center gap-1 transition-all"
                        >
                          <Inbox size={11} />
                          <span>{movingTaskId === selectedTask.id ? '移动中...' : '退回 Inbox 收集箱 (暂缓)'}</span>
                        </button>
                      </div>
                    )
                  )}

                  {selectedTask.status === 'failed' && (
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <button
                          disabled={skippingTaskId === selectedTask.id}
                          onClick={() => handleSkipNode(selectedTask.id)}
                          className="flex-1 h-[32px] rounded-[7px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[#1c1c21] text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
                        >
                          <SkipForward size={13} strokeWidth={2} className="text-[#85858d]" />
                          <span>{skippingTaskId === selectedTask.id ? '正在跳过...' : '跳过此失败节点'}</span>
                        </button>
                        <button
                          disabled={retryingNodeKey === `${selectedTask.id}:`}
                          onClick={() => handleRetryNode(selectedTask.id)}
                          className="flex-1 h-[32px] rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
                        >
                          <RotateCcw size={13} strokeWidth={2.4} />
                          <span>仅重试此节点</span>
                        </button>
                      </div>
                      <button
                        disabled={runningTaskId === selectedTask.id}
                        onClick={() => handleRunTask(selectedTask.id)}
                        className="w-full h-[26px] rounded-[6px] border border-[#e3e3e8] bg-transparent hover:bg-[#f1f1f4] text-[#85858d] hover:text-[#1c1c21] text-[11px] font-medium flex items-center justify-center gap-1 transition-all"
                      >
                        <Play size={11} />
                        <span>重新执行整条流水线</span>
                      </button>
                    </div>
                  )}

                  {selectedTask.status === 'cancelled' && (
                    <button
                      disabled={runningTaskId === selectedTask.id}
                      onClick={() => handleRunTask(selectedTask.id)}
                      className="w-full h-[32px] rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white flex items-center justify-center gap-1.5 transition-all shadow-sm"
                    >
                      <RotateCcw size={13} strokeWidth={2.4} />
                      <span>{runningTaskId === selectedTask.id ? '正在重新启动...' : '重新执行此任务'}</span>
                    </button>
                  )}

                  {selectedTask.status === 'running' && (
                    <button
                      disabled={cancellingTaskId === selectedTask.id}
                      onClick={() => handleCancelTask(selectedTask.id)}
                      className="w-full h-[32px] rounded-[7px] border border-[#fbd5d5] bg-[#fdf2f2] hover:bg-[#fee2e2] text-[#d64545] text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm"
                    >
                      <Square size={12} className="fill-current" />
                      <span>{cancellingTaskId === selectedTask.id ? '正在终止任务...' : '终止正在执行的任务'}</span>
                    </button>
                  )}

                  {selectedTask.status === 'waiting_approval' && (
                    <div className="space-y-2">
                      <button
                        onClick={() => setVisualAcceptanceTask(selectedTask)}
                        className="w-full h-[34px] rounded-[7px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
                      >
                        <Play size={13} className="fill-current" />
                        <span>打开截帧回放与验收面板</span>
                      </button>
                      <div className="flex gap-2">
                        <button
                          disabled={approvingId === selectedTask.id}
                          onClick={() => handleApprove(selectedTask.id, true)}
                          className="flex-1 h-[32px] rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
                        >
                          <Check size={13} strokeWidth={2.4} />
                          <span>验收通过并合并</span>
                        </button>
                        <button
                          disabled={approvingId === selectedTask.id}
                          onClick={() => handleApprove(selectedTask.id, false)}
                          className="h-[32px] px-4 rounded-[7px] border border-[#e3e3e8] bg-white text-[#63636b] hover:text-[#1c1c21] hover:bg-[#f1f1f4] text-[12px] font-medium transition-all"
                        >
                          驳回
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      onOpenTaskLogs(selectedTask.id);
                      setSelectedTask(null);
                    }}
                    className="w-full h-[32px] rounded-[7px] border border-[#e3e3e8] bg-[#f9f9fb] hover:bg-[#f1f1f4] text-[#1c1c21] text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Terminal size={13} />
                    <span>查看此任务实时日志</span>
                  </button>
                </div>
              </>
            )}

            {/* TAB 2: Agent 实时会话与双向交互 */}
            {drawerTab === 'session' && (
              <div className="flex-1 flex flex-col min-h-0 pt-3">
                {/* 顶部感知与控制条 */}
                <div className="mb-2 px-3 py-2 rounded-[8px] bg-[#f9f9fb] border border-[#ececf0] flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-[#7c3aed] inline-block shrink-0" />
                    <span className="text-[11.5px] font-semibold text-[#1c1c21] truncate">
                      {sessionState?.agentName || 'Pi Coding Agent'}
                    </span>
                    {selectedTask.context?.piSessionId && (
                      <span
                        className="text-[10px] font-mono text-[#85858d] bg-white px-1.5 py-0.5 rounded border border-[#e3e3e8] truncate max-w-[130px]"
                        title={selectedTask.context.piSessionId}
                      >
                        {selectedTask.context.piSessionId}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* 运行中：显示暂停按钮 */}
                    {sessionState?.isBusy && (
                      <button
                        disabled={isPausingSession}
                        onClick={handleTogglePauseSession}
                        className="h-[22px] px-2 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#fee2e2] text-[#4b4b53] hover:text-[#d64545] text-[10.5px] font-medium flex items-center gap-1 transition-all shadow-sm"
                        title="暂停智能体当前思考与执行"
                      >
                        <Pause size={10} />
                        <span>{isPausingSession ? '暂停中' : '暂停'}</span>
                      </button>
                    )}

                    {/* 已暂停：显示继续恢复按钮 */}
                    {sessionState?.isPaused && (
                      <button
                        disabled={isPausingSession}
                        onClick={handleTogglePauseSession}
                        className="h-[22px] px-2 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10.5px] font-medium flex items-center gap-1 transition-all shadow-sm"
                        title="恢复智能体会话继续推进"
                      >
                        <Play size={10} strokeWidth={2.4} />
                        <span>{isPausingSession ? '恢复中' : '继续'}</span>
                      </button>
                    )}

                    {/* 在系统终端拉起接管 */}
                    <button
                      onClick={() => handleResumeTerminal(selectedTask.id)}
                      className="h-[22px] px-1.5 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[#85858d] hover:text-[#1c1c21] text-[10.5px] flex items-center gap-1 transition-all"
                      title="在 macOS 终端中接管此会话"
                    >
                      <ExternalLink size={10.5} />
                      <span>终端</span>
                    </button>
                  </div>
                </div>

                {/* 消息滚动流与浮动查看最新指示器 */}
                <div className="relative flex-1 min-h-0 flex flex-col">
                  <div
                    ref={chatScrollContainerRef}
                    onScroll={handleChatScroll}
                    onWheel={handleChatWheel}
                    className="flex-1 overflow-y-auto pr-1 space-y-3 min-h-0 text-[12px]"
                  >
                  {(!sessionState?.messages || sessionState.messages.length === 0) ? (
                    <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-6 text-[#85858d]">
                      <div className="w-11 h-11 rounded-[10px] bg-[#f4f4f6] border border-[#e3e3e8] flex items-center justify-center mb-2.5">
                        <Bot size={20} className="text-[#85858d]" />
                      </div>
                      <div className="text-[12.5px] font-medium text-[#1c1c21] mb-1">Agent 实时交互会话</div>
                      <div className="text-[11px] text-[#85858d] leading-relaxed max-w-[280px]">
                        启动任务后，智能体的深度思考、工具调用与代码生成将在此毫秒级流式展现；您亦可在下方随时插话或纠偏。
                      </div>
                    </div>
                  ) : (
                    sessionState.messages.map((msg, msgIdx) => {
                      if (msg.role === 'user') {
                        return (
                          <div key={msg.id} className="flex justify-end">
                            <div className="max-w-[85%] rounded-[9px] px-3.5 py-2.5 bg-[#f4f4f6] border border-[#e3e3e8] text-[#1c1c21] text-[12px] leading-relaxed shadow-sm">
                              <div className="text-[9.5px] font-mono text-[#85858d] mb-1 text-right">YOU</div>
                              {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}

                              {/* 用户随附图片缩略图画廊 */}
                              {msg.attachments && msg.attachments.length > 0 && (
                                <div className={`flex flex-wrap gap-1.5 ${msg.content ? 'mt-2 pt-2 border-t border-[#e6e6ec]' : ''}`}>
                                  {msg.attachments.map((att) => {
                                    const displayUrl = api.getAttachmentUrl(att.url);
                                    return (
                                      <div
                                        key={att.id}
                                        onClick={() => setActiveDetailImage(att)}
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
                                onClick={() => setExpandedThinking((p) => ({ ...p, [msg.id]: !p[msg.id] }))}
                                className="w-full px-2.5 py-1.5 flex items-center justify-between text-[#63636b] hover:bg-[#f1f1f4] transition-colors"
                              >
                                <div className="flex items-center gap-1.5">
                                  <Sparkles size={11} className={msg.isThinking ? 'text-[#7c3aed] animate-spin' : 'text-[#7c3aed]'} />
                                  <span className="font-medium text-[11px]">
                                    {msg.isThinking ? '智能体深度思考中...' : '深度思考过程'}
                                  </span>
                                  {msg.isThinking && <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-ping" />}
                                </div>
                                {expandedThinking[msg.id] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                              </button>
                              {(expandedThinking[msg.id] || msg.isThinking) && (
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
                                    onClick={() => setExpandedTools((p) => ({ ...p, [tool.id]: !p[tool.id] }))}
                                    className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#f9f9fb] transition-colors"
                                  >
                                    <div className="flex items-center gap-1.5 truncate mr-2">
                                      <Terminal size={11} className="text-[#4f46e5] shrink-0" />
                                      <span className="font-mono font-semibold text-[#1c1c21]">{tool.name}</span>
                                      {tool.args && (
                                        <span className="font-mono text-[#85858d] truncate max-w-[200px]">
                                          {typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args)}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      {tool.status === 'running' ? (
                                        <span className="text-[#4f46e5] flex items-center gap-1 text-[10px]">
                                          <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] animate-ping" />
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
                                    <div className="p-2 border-t border-[#ececf0] bg-[#1c1c21] text-[#e3e3e8] font-mono text-[10px] leading-relaxed max-h-[160px] overflow-y-auto">
                                      {tool.result ? (
                                        <pre className="whitespace-pre-wrap">{typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}</pre>
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
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={chatMessagesEndRef} />
                </div>

                {/* 离开底部后的浮动「查看最新」胶囊按钮 */}
                <ChatScrollToLatestButton
                  visible={!isChatAtBottom}
                  hasNewOutput={hasNewChatOutput}
                  onClick={() => scrollChatToBottom(true)}
                />
              </div>

                {/* 贴底悬浮输入框区 */}
                <div className="pt-2.5 border-t border-[#ececf0] bg-white shrink-0">
                  {/* 状态轻量提示 */}
                  <div className="flex items-center justify-between text-[10.5px] text-[#85858d] mb-1.5 px-0.5">
                    <span className="flex items-center gap-1">
                      {sessionState?.isBusy ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-ping" />
                          <span className="text-[#7c3aed] font-medium">运行中：发送将无缝插话 (Steer)</span>
                        </>
                      ) : sessionState?.isPaused ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-[#b45309]" />
                          <span className="text-[#b45309] font-medium">已暂停：发送新指令将继续推进</span>
                        </>
                      ) : (
                        <span>可向当前智能体会话追问或补充指令</span>
                      )}
                    </span>
                    <span className="font-mono text-[#a5a5b0] text-[10px]">⌘ + Enter 发送</span>
                  </div>

                  {/* 隐藏的图片选择器 */}
                  <input
                    type="file"
                    ref={chatFileInputRef}
                    onChange={(e) => {
                      if (e.target.files) {
                        uploadChatFiles(Array.from(e.target.files));
                        e.target.value = '';
                      }
                    }}
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    multiple
                    className="hidden"
                  />

                  {/* 极简精致输入卡片 */}
                  <div
                    onDragOver={handleChatDragOver}
                    onDragLeave={handleChatDragLeave}
                    onDrop={handleChatDrop}
                    className={`relative rounded-[8px] border transition-all ${
                      isChatDragging
                        ? 'border-[#4f46e5] ring-2 ring-[#4f46e5]/20 bg-[#f5f4ff]'
                        : 'border-[#e3e3e8] focus-within:border-[#1c1c21]/40 focus-within:shadow-[0_2px_8px_rgba(0,0,0,0.06)] bg-white'
                    } p-2`}
                  >
                    {/* 拖拽释放遮罩 */}
                    {isChatDragging && (
                      <div className="absolute inset-0 z-20 rounded-[7px] bg-[#4f46e5]/10 border-2 border-dashed border-[#4f46e5] flex items-center justify-center pointer-events-none backdrop-blur-[0.5px]">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#4f46e5]">
                          <ImageIcon size={14} />
                          <span>松开鼠标添加图片到 Agent 对话</span>
                        </div>
                      </div>
                    )}

                    {/* 待发送图片缩略图条带 */}
                    {(chatAttachments.length > 0 || pendingChatUploads.length > 0) && (
                      <div className="mb-2 pb-1.5 border-b border-[#f0f0f4] flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
                        {chatAttachments.map((att) => {
                          const displayUrl = api.getAttachmentUrl(att.url);
                          return (
                            <div
                              key={att.id}
                              className="group relative w-[46px] h-[46px] shrink-0 rounded-[6px] border border-[#e3e3e8] bg-white overflow-hidden shadow-xs hover:border-[#4f46e5] transition-all cursor-pointer select-none"
                              onClick={() => setActiveDetailImage(att)}
                              title={`${att.name}\n${(att.size / 1024).toFixed(0)} KB\n点击放大查看`}
                            >
                              <img src={displayUrl} alt={att.name} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1 transition-opacity">
                                <div className="p-0.5 rounded bg-white/20 text-white" title="放大">
                                  <ZoomIn size={10} />
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveChatAttachment(att.id);
                                  }}
                                  className="p-0.5 rounded bg-white/20 hover:bg-red-500/80 text-white"
                                  title="移除"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {pendingChatUploads.map((pending) => (
                          <div
                            key={pending.tempId}
                            className={`group relative w-[46px] h-[46px] shrink-0 rounded-[6px] border overflow-hidden shadow-xs transition-all cursor-pointer ${
                              pending.status === 'error' ? 'border-red-300 bg-red-50/50' : 'border-[#4f46e5]/40 bg-[#f4f4f6]'
                            }`}
                            title={
                              pending.status === 'error'
                                ? `${pending.name}\n上传失败: ${pending.errorMessage || '异常'}\n点击重新上传`
                                : pending.name
                            }
                            onClick={() => {
                              if (pending.status === 'error') {
                                handleRetryChatUpload(pending);
                              } else {
                                setActiveDetailImage({
                                  name: pending.name,
                                  url: pending.previewUrl,
                                  size: pending.size,
                                  id: pending.tempId,
                                  mimeType: pending.file.type,
                                  path: '',
                                  createdAt: Date.now(),
                                });
                              }
                            }}
                          >
                            <img
                              src={pending.previewUrl}
                              alt={pending.name}
                              className={`w-full h-full object-cover ${pending.status === 'uploading' ? 'opacity-60 blur-[0.5px]' : ''}`}
                            />
                            {pending.status === 'uploading' ? (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 text-white">
                                <Loader2 size={11} className="animate-spin text-white mb-0.5" />
                                <span className="text-[7px] font-mono">上传中</span>
                              </div>
                            ) : (
                              <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/60 text-white p-0.5 text-center">
                                <AlertCircle size={10} className="text-red-300 mb-0.5" />
                                <span className="text-[6.5px] truncate max-w-full text-red-200">重试</span>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemovePendingChat(pending.tempId);
                              }}
                              className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-black/60 hover:bg-black text-white flex items-center justify-center text-[8px]"
                              title="取消"
                            >
                              <X size={8} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <textarea
                      ref={chatTextareaRef}
                      value={chatInput}
                      onChange={(e) => {
                        setChatInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                      }}
                      onPaste={handleChatPaste}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          handleSendChat();
                        }
                      }}
                      placeholder="给 Agent 发送指令或反馈... 支持粘贴截图 ⌘V 或拖拽图片"
                      rows={2}
                      className="w-full resize-none border-none outline-none text-[12px] text-[#1c1c21] placeholder:text-[#a5a5b0] bg-transparent leading-relaxed"
                    />

                    {/* 底部工具条：添加图片 + 字数 + 发送按钮 */}
                    <div className="flex items-center justify-between pt-1.5 border-t border-[#f4f4f6]">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => chatFileInputRef.current?.click()}
                          className="h-[22px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f7] hover:border-[#1c1c21]/30 text-[#63636b] hover:text-[#1c1c21] text-[10.5px] font-medium flex items-center gap-1 transition-all"
                          title="选择本地图片发送给 Agent"
                        >
                          <Plus size={10.5} strokeWidth={2.5} />
                          <ImageIcon size={10.5} />
                          <span>图片</span>
                        </button>
                        {selectedTask.context?.qaRunId && (
                          <button
                            type="button"
                            onClick={() => handleRetryNode(selectedTask.id, 'node_qa_test')}
                            disabled={retryingNodeKey?.startsWith(selectedTask.id)}
                            className="h-[22px] px-2 rounded-[5px] border border-[#d8d6fb] bg-[#f5f5ff] hover:bg-[#eceaff] text-[#4f46e5] text-[10.5px] font-medium flex items-center gap-1 transition-all"
                            title="修改代码后直接重新跑 QA 自动化测试与截帧"
                          >
                            <RotateCcw size={10} className={retryingNodeKey?.startsWith(selectedTask.id) ? 'animate-spin' : ''} />
                            <span>重测 QA</span>
                          </button>
                        )}
                        {chatAttachments.length > 0 && (
                          <span className="text-[10px] font-mono text-[#85858d]">
                            已选 {chatAttachments.length} 张
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {chatInput.length > 0 && (
                          <span className="text-[10px] text-[#85858d] font-mono">
                            {chatInput.length} 字
                          </span>
                        )}
                        <button
                          disabled={(!chatInput.trim() && chatAttachments.length === 0) || isSendingChat}
                          onClick={handleSendChat}
                          className={`h-[24px] px-3 rounded-[5px] text-[11px] font-medium flex items-center gap-1 transition-all ${
                            (chatInput.trim() || chatAttachments.length > 0) && !isSendingChat
                              ? 'bg-[#1c1c21] hover:bg-[#2e2f36] text-white shadow-sm active:scale-95'
                              : 'bg-[#f4f4f6] text-[#a5a5b0] cursor-not-allowed'
                          }`}
                        >
                          {isSendingChat ? <Loader2 size={10.5} className="animate-spin" /> : <Send size={10.5} />}
                          <span>发送</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 编辑任务弹窗 */}
      <EditTaskModal
        isOpen={!!editingTask}
        onClose={() => setEditingTask(null)}
        task={editingTask}
        workflows={workflows}
        onSave={handleSaveEditedTask}
      />

      {/* 沉浸式图片灯箱大图预览 */}
      <ImageLightboxModal
        isOpen={!!activeDetailImage}
        attachment={activeDetailImage}
        onClose={() => setActiveDetailImage(null)}
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
          onClose={() => setVisualAcceptanceTask(null)}
          onApproved={async () => {
            await onRefresh();
            setVisualAcceptanceTask(null);
            setSelectedTask(null);
          }}
          onRejected={async () => {
            await onRefresh();
            setVisualAcceptanceTask(null);
            setSelectedTask(null);
          }}
        />
      )}
    </div>
  );
};
