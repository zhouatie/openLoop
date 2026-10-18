import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  History,
  Workflow,
  Search,
  RefreshCw,
  Zap,
  Play,
  LayoutGrid,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  RotateCcw,
  Square,
  Terminal,
  Filter,
  Check,
  ChevronDown,
  X,
  Copy,
  ChevronLeft,
  SlidersHorizontal,
} from 'lucide-react';
import type { Task, WorkflowDefinition, LogEntry, NodeStatus } from '@openloop/core';
import { api } from '../../services/api';
import { toast } from '../../components/Toast';
import { NodeExecutionTimeline } from '../../components/NodeExecutionTimeline';
import { resolveNodeMeta, formatDurationHuman } from '../../utils/nodeMeta';

export interface WorkflowExecutionHistoryViewProps {
  workflows: WorkflowDefinition[];
  tasks: Task[];
  onRefresh: () => void;
  onSelectWorkflow: (workflowId: string) => void;
  onOpenTaskLogs: (taskId: string, nodeId?: string) => void;
  selectedTaskId?: string | null;
  filterWorkflowId?: string | null;
  onClearSelectedTask?: () => void;
}

type StatusFilter = 'all' | 'running' | 'pending' | 'completed' | 'failed' | 'cancelled';
type TriggerFilter = 'all' | 'shortcut' | 'debug' | 'kanban';

const PAGE_SIZE = 20;

export const WorkflowExecutionHistoryView: React.FC<WorkflowExecutionHistoryViewProps> = ({
  workflows,
  tasks,
  onRefresh,
  onSelectWorkflow,
  onOpenTaskLogs,
  selectedTaskId: initialSelectedTaskId,
  filterWorkflowId: initialFilterWorkflowId,
  onClearSelectedTask,
}) => {
  // 过滤与检索状态
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(initialFilterWorkflowId || 'all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 详情抽屉状态
  const [activeTaskId, setActiveTaskId] = useState<string | null>(initialSelectedTaskId || null);
  const [activeTaskDetail, setActiveTaskDetail] = useState<Task | null>(null);
  const [taskLogs, setTaskLogs] = useState<LogEntry[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [logFilterNode, setLogFilterNode] = useState<string>('all');
  const [copiedLog, setCopiedLog] = useState(false);
  const [isRerunningId, setIsRerunningId] = useState<string | null>(null);
  const [isCancellingId, setIsCancellingId] = useState<string | null>(null);

  // 流水线筛选下拉展开控制
  const [isWfDropdownOpen, setIsWfDropdownOpen] = useState(false);
  const [wfSearchText, setWfSearchText] = useState('');
  const wfDropdownRef = useRef<HTMLDivElement>(null);
  const logTerminalEndRef = useRef<HTMLDivElement>(null);

  // 响应外部传入的过滤条件变化
  useEffect(() => {
    if (initialFilterWorkflowId) {
      setSelectedWorkflowId(initialFilterWorkflowId);
    }
  }, [initialFilterWorkflowId]);

  useEffect(() => {
    if (initialSelectedTaskId) {
      setActiveTaskId(initialSelectedTaskId);
    }
  }, [initialSelectedTaskId]);

  // 点击外部关闭流水线下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wfDropdownRef.current && !wfDropdownRef.current.contains(e.target as Node)) {
        setIsWfDropdownOpen(false);
      }
    };
    if (isWfDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isWfDropdownOpen]);

  // 当任务列表 tasks 发生实时变化（如 WebSocket 推送），同步刷新详情中的活跃任务
  useEffect(() => {
    if (!activeTaskId) return;
    const latest = tasks.find((t) => t.id === activeTaskId);
    if (latest) {
      setActiveTaskDetail((prev) => {
        if (!prev) return latest;
        return {
          ...latest,
          nodeRuns: latest.nodeRuns || prev.nodeRuns,
        };
      });
    }
  }, [tasks, activeTaskId]);

  // 监听日志实时推流
  useEffect(() => {
    if (!activeTaskId) return;

    const unsubLog = api.on('log:new', (newLog: LogEntry) => {
      if (newLog.taskId === activeTaskId) {
        setTaskLogs((prev) => [...prev, newLog]);
      }
    });

    return () => {
      unsubLog();
    };
  }, [activeTaskId]);

  // 加载当前选中任务的详情与日志
  const loadTaskDetail = useCallback(
    async (taskId: string) => {
      setIsLoadingDetail(true);
      if (import.meta.env?.DEV) {
        console.log('[WorkflowExecutionHistory] 读取任务详情与日志:', taskId);
      }
      try {
        const [taskRes, logsRes] = await Promise.all([
          api.getTask(taskId),
          api.getTaskLogs(taskId),
        ]);
        setActiveTaskDetail(taskRes);
        setTaskLogs(logsRes || []);
      } catch (err: any) {
        if (import.meta.env?.DEV) {
          console.error('[WorkflowExecutionHistory] 读取任务详情失败:', err);
        }
        toast.error(`读取执行记录失败: ${err?.message || '未知错误'}`);
      } finally {
        setIsLoadingDetail(false);
      }
    },
    []
  );

  // 点击选中任务行
  const handleSelectTask = (task: Task) => {
    if (import.meta.env?.DEV) {
      console.log('[WorkflowExecutionHistory] 选择执行记录:', task.id);
    }
    setActiveTaskId(task.id);
    setActiveTaskDetail(task);
    setLogFilterNode('all');
    loadTaskDetail(task.id);
  };

  // 关闭详情抽屉
  const handleCloseDetail = () => {
    setActiveTaskId(null);
    setActiveTaskDetail(null);
    setTaskLogs([]);
    onClearSelectedTask?.();
  };

  // 快捷键 ESC 关闭详情
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeTaskId) {
        handleCloseDetail();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTaskId]);

  // 手动刷新
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowExecutionHistory] 手动刷新执行记录...');
    }
    try {
      await onRefresh();
      if (activeTaskId) {
        await loadTaskDetail(activeTaskId);
      }
      toast.success('执行记录已刷新');
    } finally {
      setIsRefreshing(false);
    }
  };

  // 重新执行相同任务
  const handleRerun = async (task: Task, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsRerunningId(task.id);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowExecutionHistory] 触发重新执行任务:', task.id);
    }
    try {
      const newTask = await api.createTask({
        workflowId: task.workflowId,
        title: `${task.title.replace(/\s*\(重跑\)$/, '')} (重跑)`,
        description: task.description,
        workspace: task.workspace,
        context: task.context,
        autoRun: true,
        triggerSource: task.triggerSource || 'debug',
      });
      toast.success(`任务重新触发成功: ${newTask.id}`);
      await onRefresh();
      handleSelectTask(newTask);
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowExecutionHistory] 重跑任务失败:', err);
      }
      toast.error(`重跑失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsRerunningId(null);
    }
  };

  // 中止任务
  const handleCancelTask = async (task: Task, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsCancellingId(task.id);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowExecutionHistory] 触发终止任务:', task.id);
    }
    try {
      await api.cancelTask(task.id);
      toast.success(`任务「${task.title}」已终止`);
      await onRefresh();
      if (activeTaskId === task.id) {
        await loadTaskDetail(task.id);
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowExecutionHistory] 终止任务失败:', err);
      }
      toast.error(`终止失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsCancellingId(null);
    }
  };

  // 格式化相对时间
  const formatTimeAgo = (timestamp?: number) => {
    if (!timestamp) return '未知时间';
    const diff = Date.now() - timestamp;
    const min = 60 * 1000;
    const hr = 60 * min;
    const day = 24 * hr;

    if (diff < min) return '刚刚';
    if (diff < hr) return `${Math.floor(diff / min)} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hr)} 小时前`;
    return new Date(timestamp).toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 计算任务耗时 (精确回溯实际节点运行时段，避免待办卡片或静止任务虚增耗时)
  const getTaskDurationStr = (task: Task) => {
    if (task.status === 'pending') return '-';
    if (!task.createdAt) return '-';

    // 优先基于节点实际运行起止时间
    if (task.nodeRuns && Object.keys(task.nodeRuns).length > 0) {
      const runs = Object.values(task.nodeRuns);
      const startedTimes = runs.map((r) => r.startedAt).filter(Boolean) as number[];
      const finishedTimes = runs.map((r) => r.finishedAt).filter(Boolean) as number[];
      if (startedTimes.length > 0) {
        const earliest = Math.min(...startedTimes);
        const latest =
          task.status === 'running'
            ? Date.now()
            : finishedTimes.length > 0
            ? Math.max(...finishedTimes)
            : task.updatedAt || Date.now();
        const diffSec = Math.max(1, Math.round((latest - earliest) / 1000));
        return formatDurationHuman(diffSec);
      }
    }

    if (task.status === 'running') {
      const diffSec = Math.max(1, Math.round((Date.now() - (task.updatedAt || task.createdAt)) / 1000));
      return formatDurationHuman(diffSec);
    }

    const end = task.updatedAt || task.createdAt;
    const diffSec = Math.max(1, Math.round((end - task.createdAt) / 1000));
    return formatDurationHuman(diffSec);
  };

  // 过滤出真正的执行调用记录：
  // 排除仅留在看板收集箱(Inbox)等泳道、从未触发执行过(无 nodeRuns 且处于 pending)的纯待办卡片
  const executionTasks = useMemo(() => {
    return tasks.filter((task) => {
      const hasNodeRuns = task.nodeRuns && Object.keys(task.nodeRuns).length > 0;
      if (hasNodeRuns) return true;
      if (
        task.status === 'running' ||
        task.status === 'completed' ||
        task.status === 'failed' ||
        task.status === 'cancelled'
      ) {
        return true;
      }
      // 如果仍处于 pending：仅当来自快捷键触发、手动调试运行或外部 API 调度时才计入流水线记录
      if (
        task.triggerSource === 'shortcut' ||
        task.triggerSource === 'debug' ||
        task.triggerSource === 'api'
      ) {
        return true;
      }
      return false;
    });
  }, [tasks]);

  // 统计指标汇总 (仅基于真实流水线执行实例)
  const stats = useMemo(() => {
    const total = executionTasks.length;
    const running = executionTasks.filter((t) => t.status === 'running').length;
    const pending = executionTasks.filter((t) => t.status === 'pending').length;
    const completed = executionTasks.filter((t) => t.status === 'completed').length;
    const failed = executionTasks.filter((t) => t.status === 'failed' || t.status === 'cancelled').length;
    const shortcut = executionTasks.filter((t) => t.triggerSource === 'shortcut').length;
    const successRate = total > 0 ? Math.round((completed / (completed + failed || 1)) * 100) : 100;

    return { total, running, pending, completed, failed, shortcut, successRate };
  }, [executionTasks]);

  // 高性能多维过滤与排序
  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return executionTasks.filter((task) => {
      // 1. 流水线过滤
      if (selectedWorkflowId !== 'all' && task.workflowId !== selectedWorkflowId) {
        return false;
      }

      // 2. 状态过滤
      if (statusFilter !== 'all') {
        if (task.status !== statusFilter) {
          return false;
        }
      }

      // 3. 触发源过滤
      if (triggerFilter !== 'all') {
        const source = task.triggerSource || 'kanban';
        if (source !== triggerFilter) return false;
      }

      // 4. 文本检索
      if (q) {
        const matchTitle = task.title.toLowerCase().includes(q);
        const matchDesc = task.description?.toLowerCase().includes(q);
        const matchId = task.id.toLowerCase().includes(q);
        const targetWf = workflows.find((w) => w.id === task.workflowId);
        const matchWfName = targetWf?.name.toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchId && !matchWfName) {
          return false;
        }
      }

      return true;
    });
  }, [tasks, selectedWorkflowId, statusFilter, triggerFilter, searchQuery, workflows]);

  // 分页切片（保证无论上千条调用历史，DOM 渲染速度恒定在 60 FPS）
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredTasks.slice(start, start + PAGE_SIZE);
  }, [filteredTasks, currentPage]);

  // 切换筛选条件时重置页码
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedWorkflowId, statusFilter, triggerFilter, searchQuery]);

  // 获取工作流名称工具函数
  const getWorkflowInfo = (wfId: string) => {
    const wf = workflows.find((w) => w.id === wfId);
    return {
      name: wf?.name || '未知工作流',
      description: wf?.description || '',
      nodesCount: wf?.nodes?.length || 0,
      workflow: wf,
    };
  };

  // 触发源徽标渲染
  const renderTriggerBadge = (source?: string) => {
    switch (source) {
      case 'shortcut':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef3c7] text-[#92400e] text-[10px] font-medium border border-[#fde68a] shrink-0">
            <Zap size={10} className="fill-current text-[#d97706]" />
            <span>快捷键</span>
          </span>
        );
      case 'debug':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#e0e7ff] text-[#3730a3] text-[10px] font-medium border border-[#c7d2fe] shrink-0">
            <Play size={9} className="fill-current text-[#4f46e5]" />
            <span>手动调试</span>
          </span>
        );
      case 'kanban':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f1f1f4] text-[#4b4b53] text-[10px] font-medium border border-[#e3e3e8] shrink-0">
            <LayoutGrid size={9} />
            <span>看板任务</span>
          </span>
        );
    }
  };

  // 状态徽标渲染
  const renderStatusBadge = (status: Task['status']) => {
    switch (status) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#eff6ff] text-[#1d4ed8] text-[11px] font-medium border border-[#bfdbfe]">
            <Loader2 size={11} className="animate-spin text-[#2563eb]" />
            <span>执行中</span>
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#f4f4f6] text-[#71717a] text-[11px] font-medium border border-[#e3e3e8]">
            <Clock size={10} className="text-[#85858d]" />
            <span>待执行</span>
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#f0fdf4] text-[#15803d] text-[11px] font-medium border border-[#bbf7d0]">
            <CheckCircle2 size={11} className="text-[#16a34a]" />
            <span>成功</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#fef2f2] text-[#b91c1c] text-[11px] font-medium border border-[#fecaca]">
            <XCircle size={11} className="text-[#dc2626]" />
            <span>失败</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#fffbeb] text-[#b45309] text-[11px] font-medium border border-[#fde68a]">
            <AlertCircle size={11} className="text-[#d97706]" />
            <span>已中止</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#f4f4f6] text-[#71717a] text-[11px] font-medium">
            <span>{status}</span>
          </span>
        );
    }
  };

  // 复制日志
  const handleCopyLogs = () => {
    const text = filteredTaskLogs.map((l) => `[${l.stream}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
    toast.success('已复制当前日志');
  };

  // 详情页过滤日志
  const filteredTaskLogs = useMemo(() => {
    if (logFilterNode === 'all') return taskLogs;
    return taskLogs.filter((l) => l.nodeId === logFilterNode);
  }, [taskLogs, logFilterNode]);

  // 当前选中流水线信息
  const activeWfInfo = activeTaskDetail
    ? getWorkflowInfo(activeTaskDetail.workflowId)
    : null;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-hidden select-none">
      {/* 顶部指标概览栏 (轻量高质感卡片) */}
      <div className="px-6 pt-3 pb-2 shrink-0">
        <div className="grid grid-cols-4 gap-3">
          {/* 总调用 */}
          <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-[6px] bg-[#f4f4f6] flex items-center justify-center text-[#1c1c21]">
                <History size={14} />
              </div>
              <div>
                <span className="text-[11px] text-[#85858d] font-medium block">总调用次数</span>
                <span className="text-[15px] font-bold text-[#1c1c21] tracking-tight">{stats.total}</span>
              </div>
            </div>
          </div>

          {/* 活跃执行 */}
          <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-[6px] flex items-center justify-center ${
                stats.running > 0 ? 'bg-[#eff6ff] text-[#2563eb]' : 'bg-[#f4f4f6] text-[#85858d]'
              }`}>
                {stats.running > 0 ? (
                  <Loader2 size={14} className="animate-spin text-[#2563eb]" />
                ) : (
                  <Clock size={14} />
                )}
              </div>
              <div>
                <span className="text-[11px] text-[#85858d] font-medium block">执行中</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[15px] font-bold text-[#1c1c21] tracking-tight">{stats.running}</span>
                  {stats.running > 0 && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 成功率 */}
          <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-[6px] bg-[#f0fdf4] text-[#16a34a] flex items-center justify-center">
                <CheckCircle2 size={14} />
              </div>
              <div>
                <span className="text-[11px] text-[#85858d] font-medium block">执行成功率</span>
                <span className="text-[15px] font-bold text-[#16a34a] tracking-tight">{stats.successRate}%</span>
              </div>
            </div>
          </div>

          {/* 快捷键触发数 */}
          <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-[6px] bg-[#fffbeb] text-[#d97706] flex items-center justify-center">
                <Zap size={14} className="fill-current text-[#d97706]" />
              </div>
              <div>
                <span className="text-[11px] text-[#85858d] font-medium block">快捷键触发</span>
                <span className="text-[15px] font-bold text-[#1c1c21] tracking-tight">{stats.shortcut}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 多维筛选与操作栏 */}
      <div className="px-6 py-2.5 flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap flex-1">
          {/* 流水线专属下拉过滤器 */}
          <div className="relative" ref={wfDropdownRef}>
            <button
              type="button"
              onClick={() => setIsWfDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1.5 h-[28px] px-2.5 rounded-[6px] bg-white border border-[#e3e3e8] hover:border-[#b9b9c2] text-[11.5px] font-medium text-[#1c1c21] shadow-2xs transition-all cursor-pointer"
            >
              <Workflow size={12} className="text-[#85858d]" />
              <span className="max-w-[140px] truncate">
                {selectedWorkflowId === 'all'
                  ? '全部工作流'
                  : getWorkflowInfo(selectedWorkflowId).name}
              </span>
              <ChevronDown size={11} className="text-[#85858d]" />
            </button>

            {isWfDropdownOpen && (
              <div className="absolute left-0 top-[32px] w-64 bg-white border border-[#e3e3e8] rounded-[8px] shadow-lg p-1.5 z-30 animate-in fade-in zoom-in-95 duration-100">
                <div className="p-1 mb-1 border-b border-[#f1f1f4]">
                  <input
                    type="text"
                    autoFocus
                    placeholder="过滤工作流..."
                    value={wfSearchText}
                    onChange={(e) => setWfSearchText(e.target.value)}
                    className="w-full h-[24px] px-2 bg-[#f4f4f6] rounded-[5px] text-[11px] text-[#1c1c21] outline-none"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  <div
                    onClick={() => {
                      setSelectedWorkflowId('all');
                      setIsWfDropdownOpen(false);
                    }}
                    className={`px-2 py-1.5 rounded-[5px] text-[11.5px] flex items-center justify-between cursor-pointer ${
                      selectedWorkflowId === 'all'
                        ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                        : 'text-[#1c1c21] hover:bg-[#f4f4f6]'
                    }`}
                  >
                    <span>全部工作流 ({tasks.length})</span>
                    {selectedWorkflowId === 'all' && <Check size={12} />}
                  </div>

                  {workflows
                    .filter((w) => !wfSearchText.trim() || w.name.toLowerCase().includes(wfSearchText.toLowerCase()))
                    .map((wf) => {
                      const count = tasks.filter((t) => t.workflowId === wf.id).length;
                      const isSelected = selectedWorkflowId === wf.id;
                      return (
                        <div
                          key={wf.id}
                          onClick={() => {
                            setSelectedWorkflowId(wf.id);
                            setIsWfDropdownOpen(false);
                          }}
                          className={`px-2 py-1.5 rounded-[5px] text-[11.5px] flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                              : 'text-[#1c1c21] hover:bg-[#f4f4f6]'
                          }`}
                        >
                          <span className="truncate pr-2">{wf.name}</span>
                          <span className="text-[10px] font-mono text-[#85858d] shrink-0">
                            {count} 次
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* 触发来源筛选 */}
          <div className="flex items-center bg-[#ececf0] p-0.5 rounded-[6px] border border-[#e3e3e8]/70 text-[11px]">
            <button
              onClick={() => setTriggerFilter('all')}
              className={`px-2 py-0.5 rounded-[4px] font-medium transition-all ${
                triggerFilter === 'all'
                  ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              全部来源
            </button>
            <button
              onClick={() => setTriggerFilter('shortcut')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-[4px] font-medium transition-all ${
                triggerFilter === 'shortcut'
                  ? 'bg-white text-[#b45309] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <Zap size={9.5} className="fill-current text-[#d97706]" />
              快捷键 ({stats.shortcut})
            </button>
            <button
              onClick={() => setTriggerFilter('debug')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-[4px] font-medium transition-all ${
                triggerFilter === 'debug'
                  ? 'bg-white text-[#4f46e5] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <Play size={8.5} className="fill-current" />
              手动调试
            </button>
            <button
              onClick={() => setTriggerFilter('kanban')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-[4px] font-medium transition-all ${
                triggerFilter === 'kanban'
                  ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <LayoutGrid size={9} />
              看板流转
            </button>
          </div>

          {/* 状态过滤胶囊 */}
          <div className="flex items-center bg-[#ececf0] p-0.5 rounded-[6px] border border-[#e3e3e8]/70 text-[11px]">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2 py-0.5 rounded-[4px] font-medium transition-all ${
                statusFilter === 'all'
                  ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              全部状态
            </button>
            <button
              onClick={() => setStatusFilter('running')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-[4px] font-medium transition-all ${
                statusFilter === 'running'
                  ? 'bg-white text-[#2563eb] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              {stats.running > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb]" />}
              执行中 ({stats.running})
            </button>
            {stats.pending > 0 && (
              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-2 py-0.5 rounded-[4px] font-medium transition-all ${
                  statusFilter === 'pending'
                    ? 'bg-white text-[#71717a] shadow-2xs font-semibold'
                    : 'text-[#63636b] hover:text-[#1c1c21]'
                }`}
              >
                待执行 ({stats.pending})
              </button>
            )}
            <button
              onClick={() => setStatusFilter('completed')}
              className={`px-2 py-0.5 rounded-[4px] font-medium transition-all ${
                statusFilter === 'completed'
                  ? 'bg-white text-[#16a34a] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              成功 ({stats.completed})
            </button>
            <button
              onClick={() => setStatusFilter('failed')}
              className={`px-2 py-0.5 rounded-[4px] font-medium transition-all ${
                statusFilter === 'failed'
                  ? 'bg-white text-[#dc2626] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              失败 ({stats.failed})
            </button>
          </div>
        </div>

        {/* 右侧：搜索框与刷新 */}
        <div className="flex items-center gap-2">
          <div className="relative w-56">
            <Search size={12} className="absolute left-2.5 top-2 text-[#85858d]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索 Prompt、任务标题、ID..."
              className="w-full h-[28px] pl-7 pr-2.5 bg-white border border-[#e3e3e8] rounded-[6px] text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-2xs focus:border-[#4f46e5] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-[#85858d] hover:text-[#1c1c21]"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="w-[28px] h-[28px] rounded-[6px] bg-white border border-[#e3e3e8] hover:bg-[#f4f4f6] text-[#63636b] hover:text-[#1c1c21] flex items-center justify-center transition-all shadow-2xs cursor-pointer disabled:opacity-50"
            title="刷新执行记录"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 主体列表区域 */}
      <div className="flex-1 px-6 pb-4 overflow-y-auto">
        <div className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden flex flex-col">
          {/* 表头 */}
          <div className="h-[34px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center text-[11px] font-medium text-[#85858d]">
            <div className="w-[180px] shrink-0">所属流水线</div>
            <div className="w-[85px] shrink-0">触发来源</div>
            <div className="flex-1 min-w-0 px-2">Prompt / 需求说明</div>
            <div className="w-[100px] shrink-0 text-center">状态</div>
            <div className="w-[90px] shrink-0 text-right">运行时长</div>
            <div className="w-[100px] shrink-0 text-right">触发时间</div>
            <div className="w-[90px] shrink-0 text-center">操作</div>
          </div>

          {/* 列表行 */}
          {paginatedTasks.length === 0 ? (
            <div className="py-16 text-center space-y-2 select-none">
              <History size={32} className="mx-auto text-[#b9b9c2] stroke-[1.5]" />
              <p className="text-[13px] font-medium text-[#63636b]">暂无符合条件的流水线执行记录</p>
              <p className="text-[11.5px] text-[#85858d]">
                可通过快捷键唤起快速执行，或在流程编排卡片中发起调试运行。
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#f1f1f4]">
              {paginatedTasks.map((task) => {
                const wfInfo = getWorkflowInfo(task.workflowId);
                const isSelected = activeTaskId === task.id;
                const isRunning = task.status === 'running';
                const nodeRunsCount = Object.keys(task.nodeRuns || {}).length;

                return (
                  <div
                    key={task.id}
                    onClick={() => handleSelectTask(task)}
                    className={`group px-4 py-2.5 flex items-center text-[12px] transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#f5f4fe]'
                        : isRunning
                        ? 'bg-[#fbfdff] hover:bg-[#f4f8fe]'
                        : 'hover:bg-[#fafafc]'
                    }`}
                  >
                    {/* 流水线名 */}
                    <div className="w-[180px] shrink-0 flex items-center gap-1.5 pr-2">
                      <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] group-hover:bg-white flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60">
                        <Workflow size={11} />
                      </div>
                      <span
                        className="font-medium text-[#1c1c21] truncate hover:text-[#4f46e5]"
                        title={wfInfo.name}
                      >
                        {wfInfo.name}
                      </span>
                    </div>

                    {/* 触发来源 */}
                    <div className="w-[85px] shrink-0">
                      {renderTriggerBadge(task.triggerSource)}
                    </div>

                    {/* Prompt 需求 */}
                    <div className="flex-1 min-w-0 px-2 flex items-center gap-2">
                      <span className="text-[#1c1c21] font-mono text-[11.5px] truncate" title={task.title}>
                        {task.title}
                      </span>
                      {nodeRunsCount > 0 && (
                        <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-0.5 rounded shrink-0">
                          {nodeRunsCount} 节点
                        </span>
                      )}
                    </div>

                    {/* 状态 Badge */}
                    <div className="w-[100px] shrink-0 flex justify-center">
                      {renderStatusBadge(task.status)}
                    </div>

                    {/* 耗时 */}
                    <div className="w-[90px] shrink-0 text-right font-mono text-[11.5px] text-[#63636b]">
                      {getTaskDurationStr(task)}
                    </div>

                    {/* 时间 */}
                    <div
                      className="w-[100px] shrink-0 text-right text-[11px] text-[#85858d]"
                      title={new Date(task.createdAt).toLocaleString()}
                    >
                      {formatTimeAgo(task.createdAt)}
                    </div>

                    {/* 操作按钮区 */}
                    <div
                      className="w-[90px] shrink-0 flex items-center justify-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 重跑 */}
                      <button
                        type="button"
                        onClick={(e) => handleRerun(task, e)}
                        disabled={isRerunningId === task.id || isRunning}
                        title="重新执行此任务"
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer disabled:opacity-40"
                      >
                        <RotateCcw size={11.5} className={isRerunningId === task.id ? 'animate-spin' : ''} />
                      </button>

                      {/* 终止 */}
                      {isRunning ? (
                        <button
                          type="button"
                          onClick={(e) => handleCancelTask(task, e)}
                          disabled={isCancellingId === task.id}
                          title="强制终止流水线"
                          className="w-6 h-6 rounded-[4px] text-[#dc2626] hover:bg-[#fee2e2] flex items-center justify-center transition-all cursor-pointer"
                        >
                          <Square size={11} className="fill-current" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelectTask(task)}
                          title="查看详情与节点日志"
                          className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-all cursor-pointer"
                        >
                          <ChevronRight size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 底部分页器 */}
          {filteredTasks.length > PAGE_SIZE && (
            <div className="h-[36px] bg-[#fafafc] border-t border-[#e3e3e8] px-4 flex items-center justify-between text-[11.5px] text-[#85858d]">
              <div>
                共 {filteredTasks.length} 条记录，第 {currentPage} / {totalPages} 页
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2 py-0.5 rounded border border-[#e3e3e8] bg-white text-[#1c1c21] disabled:opacity-40 hover:bg-[#f4f4f6] cursor-pointer"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2 py-0.5 rounded border border-[#e3e3e8] bg-white text-[#1c1c21] disabled:opacity-40 hover:bg-[#f4f4f6] cursor-pointer"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧滑出式执行详情与实时观测抽屉 (Detail Drawer) */}
      {activeTaskId && activeTaskDetail && (
        <div className="fixed inset-y-0 right-0 w-[540px] bg-white border-l border-[#e3e3e8] shadow-2xl z-40 flex flex-col animate-in slide-in-from-right-4 duration-150 select-text">
          {/* 抽屉头部 */}
          <div className="h-[48px] border-b border-[#e3e3e8] px-4 bg-[#fafafc] flex items-center justify-between shrink-0 select-none">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-[5px] bg-[#1c1c21] flex items-center justify-center text-white shrink-0">
                <History size={12.5} />
              </div>
              <div className="truncate">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12.5px] font-semibold text-[#1c1c21] truncate">
                    {activeWfInfo?.name || '工作流执行详情'}
                  </span>
                  {renderStatusBadge(activeTaskDetail.status)}
                </div>
                <span className="text-[10px] font-mono text-[#85858d] block truncate">
                  ID: {activeTaskDetail.id}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* 跳转至流程画布 */}
              {activeWfInfo?.workflow && (
                <button
                  type="button"
                  onClick={() => onSelectWorkflow(activeWfInfo.workflow!.id)}
                  className="flex items-center gap-1 h-[26px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[11px] text-[#4b4b53] hover:text-[#1c1c21] transition-all cursor-pointer"
                  title="在编排画布中打开该工作流"
                >
                  <Workflow size={11} />
                  <span>打开流程画布</span>
                </button>
              )}

              {/* 关闭按钮 */}
              <button
                type="button"
                onClick={handleCloseDetail}
                className="w-[26px] h-[26px] rounded-[5px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
                title="关闭抽屉 (Escape)"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* 抽屉快捷操作与状态摘要栏 */}
          <div className="px-4 py-2.5 bg-[#f9f9fb] border-b border-[#e3e3e8] flex items-center justify-between text-[11px] select-none">
            <div className="flex items-center gap-2">
              {renderTriggerBadge(activeTaskDetail.triggerSource)}
              <span className="text-[#85858d]">
                耗时 <span className="font-mono text-[#1c1c21] font-medium">{getTaskDurationStr(activeTaskDetail)}</span>
              </span>
              <span className="text-[#85858d]">·</span>
              <span className="text-[#85858d]">{new Date(activeTaskDetail.createdAt).toLocaleTimeString()}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleRerun(activeTaskDetail)}
                disabled={isRerunningId === activeTaskDetail.id || activeTaskDetail.status === 'running'}
                className="flex items-center gap-1 h-[24px] px-2 rounded-[4px] bg-white border border-[#e3e3e8] hover:bg-[#f1f1f4] text-[10.5px] font-medium text-[#1c1c21] transition-all cursor-pointer disabled:opacity-40 shadow-2xs"
              >
                <RotateCcw size={10.5} className={isRerunningId === activeTaskDetail.id ? 'animate-spin' : ''} />
                <span>再次运行</span>
              </button>

              {(activeTaskDetail.status === 'running' || activeTaskDetail.status === 'pending') && (
                <button
                  type="button"
                  onClick={() => handleCancelTask(activeTaskDetail)}
                  disabled={isCancellingId === activeTaskDetail.id}
                  className="flex items-center gap-1 h-[24px] px-2 rounded-[4px] bg-[#fef2f2] border border-[#fecaca] hover:bg-[#fee2e2] text-[10.5px] font-medium text-[#dc2626] transition-all cursor-pointer"
                >
                  <Square size={10} className="fill-current" />
                  <span>终止执行</span>
                </button>
              )}
            </div>
          </div>

          {/* 抽屉主滚动内容 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 需求 Prompt 与输入描述 */}
            <div className="bg-[#fafafc] border border-[#e3e3e8] rounded-[6px] p-3 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-medium text-[#63636b]">
                <span>调用需求 / Prompt</span>
                {activeTaskDetail.workspace && (
                  <span className="text-[10px] font-mono text-[#85858d]">
                    工程: {activeTaskDetail.workspace}
                  </span>
                )}
              </div>
              <p className="text-[12px] font-mono text-[#1c1c21] whitespace-pre-wrap leading-relaxed">
                {activeTaskDetail.description || activeTaskDetail.title}
              </p>
            </div>

            {/* 节点执行时间线 (Node Execution Timeline) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-[12px] font-semibold text-[#1c1c21] flex items-center gap-1.5">
                  <Workflow size={13} className="text-[#4f46e5]" />
                  <span>节点执行流转</span>
                </h4>
                <span className="text-[10px] font-mono text-[#85858d]">
                  {Object.keys(activeTaskDetail.nodeRuns || {}).length} 个节点执行记录
                </span>
              </div>

              <div className="bg-white border border-[#e3e3e8] rounded-[6px] p-3">
                <NodeExecutionTimeline
                  task={activeTaskDetail}
                  workflow={activeWfInfo?.workflow}
                  allWorkflows={workflows}
                  onOpenTaskLogs={(taskId, nodeId) => {
                    if (nodeId) setLogFilterNode(nodeId);
                  }}
                />
              </div>
            </div>

            {/* 实时执行终端与流式日志 (Live Console) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Terminal size={13} className="text-[#1c1c21]" />
                  <h4 className="text-[12px] font-semibold text-[#1c1c21]">执行控制台输出</h4>
                  <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-0.5 rounded">
                    {filteredTaskLogs.length} 行
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {/* 按节点过滤 */}
                  {Object.keys(activeTaskDetail.nodeRuns || {}).length > 0 && (
                    <select
                      value={logFilterNode}
                      onChange={(e) => setLogFilterNode(e.target.value)}
                      className="h-[22px] px-1.5 bg-[#f4f4f6] border border-[#e3e3e8] rounded-[4px] text-[10.5px] text-[#4b4b53] outline-none"
                    >
                      <option value="all">全部节点日志</option>
                      {Object.keys(activeTaskDetail.nodeRuns || {}).map((nId) => (
                        <option key={nId} value={nId}>
                          节点: {nId}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={handleCopyLogs}
                    className="flex items-center gap-1 h-[22px] px-2 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[10px] text-[#4b4b53] transition-all cursor-pointer"
                  >
                    {copiedLog ? <Check size={10} className="text-[#16a34a]" /> : <Copy size={10} />}
                    <span>{copiedLog ? '已复制' : '复制日志'}</span>
                  </button>
                </div>
              </div>

              {/* 终端黑底视口 */}
              <div className="rounded-[6px] bg-[#16161a] border border-[#2e2e36] p-3 max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed text-[#d4d4d8] space-y-1 shadow-inner">
                {filteredTaskLogs.length === 0 ? (
                  <div className="text-[#71717a] py-4 text-center">暂无控制台日志输出</div>
                ) : (
                  filteredTaskLogs.map((log) => {
                    const isErr = log.stream === 'stderr';
                    const isSys = log.stream === 'system';
                    return (
                      <div
                        key={log.id}
                        className={`break-all ${
                          isErr ? 'text-[#f87171]' : isSys ? 'text-[#818cf8]' : 'text-[#e4e4e7]'
                        }`}
                      >
                        <span className="text-[#52525b] select-none mr-2">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        {log.nodeId && (
                          <span className="text-[#a1a1aa] bg-white/5 px-1 py-0.2 rounded mr-1.5 select-none">
                            [{log.nodeId}]
                          </span>
                        )}
                        <span>{log.message}</span>
                      </div>
                    );
                  })
                )}
                <div ref={logTerminalEndRef} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
