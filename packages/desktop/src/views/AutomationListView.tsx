import React, { useState, useEffect, useMemo } from 'react';
import {
  Timer,
  Plus,
  Play,
  Edit3,
  Trash2,
  Terminal,
  Workflow,
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Layers,
  Sparkles,
  Zap,
} from 'lucide-react';

const GithubIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const TwitterIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
  </svg>
);
import {
  AutomationTask,
  AutomationSourceType,
  WorkflowDefinition,
  Task,
} from '@openloop/core';
import { api } from '../services/api';
import { EditAutomationModal } from '../components/automation/EditAutomationModal';
import { AutomationLogsDrawer } from '../components/automation/AutomationLogsDrawer';
import { ConfirmModal } from '../components/ConfirmModal';
import { toast } from '../components/Toast';

interface AutomationListViewProps {
  workflows: WorkflowDefinition[];
  tasks?: Task[];
  onOpenTaskLogs?: (taskId: string) => void;
  onRefreshAll?: () => void;
}

export const AutomationListView: React.FC<AutomationListViewProps> = ({
  workflows,
  tasks = [],
  onOpenTaskLogs,
  onRefreshAll,
}) => {
  const [automations, setAutomations] = useState<AutomationTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'enabled' | 'disabled'>('all');

  // 弹窗与抽屉状态
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AutomationTask | null>(null);
  const [deleteTargetTask, setDeleteTargetTask] = useState<AutomationTask | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [logsDrawerTask, setLogsDrawerTask] = useState<AutomationTask | null>(null);

  // 正在手动触发的任务 ID 集合
  const [triggeringIds, setTriggeringIds] = useState<Set<string>>(new Set());

  const loadAutomations = async () => {
    setIsLoading(true);
    if (import.meta.env?.DEV) {
      console.log('[AutomationListView] 正在拉取自动化任务配置...');
    }
    try {
      const data = await api.getAutomations();
      setAutomations(Array.isArray(data) ? data : []);
      if (import.meta.env?.DEV) {
        console.log('[AutomationListView] 拉取到自动化任务:', Array.isArray(data) ? data.length : 0);
      }
    } catch (err: any) {
      setAutomations([]);
      toast.error(`获取自动化任务失败: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAutomations();

    // 监听 WebSocket 推送的自动化更新与新任务
    const unsubUpdate = api.on('automation:update', (updated: AutomationTask) => {
      if (!updated || !updated.id) return;
      setAutomations((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const idx = list.findIndex((t) => t.id === updated.id);
        if (idx >= 0) {
          const next = [...list];
          next[idx] = updated;
          return next;
        }
        return [updated, ...list];
      });
    });

    const unsubDelete = api.on('automation:delete', ({ id }: { id: string }) => {
      if (!id) return;
      setAutomations((prev) => (Array.isArray(prev) ? prev.filter((t) => t.id !== id) : []));
    });

    return () => {
      unsubUpdate();
      unsubDelete();
    };
  }, []);

  // 稳健的数据列表
  const safeAutomations = useMemo(() => {
    return Array.isArray(automations) ? automations : [];
  }, [automations]);

  // 过滤后的列表
  const filteredAutomations = useMemo(() => {
    return safeAutomations.filter((task) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = task.name.toLowerCase().includes(q);
        const matchesDesc = task.description?.toLowerCase().includes(q);
        const matchesCmd = task.sourceConfig?.command?.toLowerCase().includes(q);
        const matchesRepo = task.sourceConfig?.repo?.toLowerCase().includes(q);
        if (!matchesName && !matchesDesc && !matchesCmd && !matchesRepo) return false;
      }
      if (filterSource !== 'all' && task.sourceType !== filterSource) {
        return false;
      }
      if (filterStatus === 'enabled' && !task.enabled) return false;
      if (filterStatus === 'disabled' && task.enabled) return false;
      return true;
    });
  }, [safeAutomations, searchQuery, filterSource, filterStatus]);

  // 统计指标
  const stats = useMemo(() => {
    const total = safeAutomations.length;
    const enabledCount = safeAutomations.filter((t) => t.enabled).length;
    let totalRuns = 0;
    let successRuns = 0;
    let totalCreatedTasks = 0;

    for (const t of safeAutomations) {
      totalRuns += t.totalRuns || 0;
      successRuns += t.successRuns || 0;
      totalCreatedTasks += t.createdTaskIds?.length || 0;
    }

    const rate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 100;

    return {
      total,
      enabledCount,
      totalRuns,
      rate,
      totalCreatedTasks,
    };
  }, [safeAutomations]);

  // 保存新建/编辑
  const handleSaveAutomation = async (taskData: Partial<AutomationTask> & { name: string }) => {
    try {
      const saved = await api.saveAutomation(taskData);
      setAutomations((prev) => {
        const idx = prev.findIndex((t) => t.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [saved, ...prev];
      });
      toast.success(taskData.id ? '自动化任务已更新' : '自动化任务创建成功');
    } catch (err: any) {
      toast.error(`保存失败: ${err.message}`);
      throw err;
    }
  };

  // 切换启停状态
  const handleToggleEnable = async (task: AutomationTask) => {
    try {
      const updated = await api.toggleAutomation(task.id, !task.enabled);
      setAutomations((prev) => {
        const idx = prev.findIndex((t) => t.id === updated.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return prev;
      });
      toast.success(updated.enabled ? `已启用「${task.name}」定时轮询` : `已暂停「${task.name}」定时轮询`);
    } catch (err: any) {
      toast.error(`切换状态失败: ${err.message}`);
    }
  };

  // 手动立即触发执行
  const handleTriggerNow = async (task: AutomationTask) => {
    if (triggeringIds.has(task.id)) return;
    setTriggeringIds((prev) => new Set(prev).add(task.id));
    toast.info(`正在执行自动化任务「${task.name}」...`);

    try {
      const res = await api.triggerAutomation(task.id);
      if (res.success) {
        toast.success(res.message || '自动化任务执行成功');
        if (res.createdTaskId && onRefreshAll) {
          onRefreshAll();
        }
      } else {
        toast.warning(res.message || '自动化任务未能拉取到新数据');
      }
    } catch (err: any) {
      toast.error(`触发执行失败: ${err.message}`);
    } finally {
      setTriggeringIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      loadAutomations();
    }
  };

  // 确认删除
  const handleDeleteConfirm = async () => {
    if (!deleteTargetTask) return;
    setIsDeleting(true);
    try {
      await api.deleteAutomation(deleteTargetTask.id);
      setAutomations((prev) => prev.filter((t) => t.id !== deleteTargetTask.id));
      toast.success('自动化任务已删除');
      setDeleteTargetTask(null);
    } catch (err: any) {
      toast.error(`删除失败: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const getSourceIcon = (sourceType: AutomationSourceType) => {
    switch (sourceType) {
      case 'github_issues':
        return <GithubIcon size={12} className="text-[#24292e]" />;
      case 'twitter_query':
        return <TwitterIcon size={12} className="text-[#1da1f2]" />;
      case 'cli_script':
      default:
        return <Terminal size={12} strokeWidth={2} className="text-[#63636b]" />;
    }
  };

  const getWorkflowName = (wfId?: string) => {
    if (!wfId) return null;
    const found = workflows.find((w) => w.id === wfId);
    return found ? found.name : wfId;
  };

  const formatRelativeTime = (timestamp?: number) => {
    if (!timestamp) return '尚未运行';
    const diff = Math.max(0, Date.now() - timestamp);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec} 秒前`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} 分钟前`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour} 小时前`;
    return `${Math.floor(hour / 24)} 天前`;
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-[#f4f4f6] overflow-hidden select-none">
      {/* 1. 固定顶部 Header: 白底、细下边框、微弱弥散投影 */}
      <div className="bg-white border-b border-[#e3e3e8] px-6 py-3.5 flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-[14px] font-semibold text-[#1c1c21] tracking-tight">自动化任务</h1>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#71717a] text-[10.5px] font-medium border border-[#e3e3e8]">
              {automations.length} 个任务
            </span>
            {stats.enabledCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                <span>{stats.enabledCount} 运行中</span>
              </span>
            )}
          </div>
          <span className="text-[11.5px] text-[#85858d] hidden md:inline">
            定时轮询 CLI 工具、GitHub Issue 与社交媒体消息，自动化驱动流水线
          </span>
        </div>

        {/* 右侧动作区 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              loadAutomations();
              if (onRefreshAll) onRefreshAll();
            }}
            disabled={isLoading}
            title="刷新自动化任务"
            className="w-[28px] h-[28px] rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#63636b] hover:text-[#1c1c21] flex items-center justify-center transition-all cursor-pointer shadow-2xs"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => {
              setEditingTask(null);
              setIsEditModalOpen(true);
            }}
            className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs cursor-pointer"
          >
            <Plus size={12} strokeWidth={2.4} />
            <span>新建自动化任务</span>
          </button>
        </div>
      </div>

      {/* 2. 独立内容滚动区 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-3.5 space-y-3">
        {/* 统计指标卡片组 */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-3 shadow-2xs">
            <div className="text-[11px] text-[#85858d] font-medium">活跃轮询调度</div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-[18px] font-semibold text-[#1c1c21] font-mono">{stats.enabledCount}</span>
              <span className="text-[11px] text-[#85858d] font-mono">/ {stats.total} 启用</span>
            </div>
          </div>

          <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-3 shadow-2xs">
            <div className="text-[11px] text-[#85858d] font-medium">累计执行轮询</div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-[18px] font-semibold text-[#1c1c21] font-mono">{stats.totalRuns}</span>
              <span className="text-[11px] text-[#85858d]">次触发</span>
            </div>
          </div>

          <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-3 shadow-2xs">
            <div className="text-[11px] text-[#85858d] font-medium">执行成功率</div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-[18px] font-semibold text-[#059669] font-mono">{stats.rate}%</span>
              <span className="text-[10px] text-[#71717a]">调度稳定</span>
            </div>
          </div>

          <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-3 shadow-2xs">
            <div className="text-[11px] text-[#85858d] font-medium">自动派生任务</div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-[18px] font-semibold text-[#4f46e5] font-mono">{stats.totalCreatedTasks}</span>
              <span className="text-[11px] text-[#85858d]">个看板卡片</span>
            </div>
          </div>
        </div>

        {/* 次级工具栏 (搜索框、过滤器) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-[420px]">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a1a1aa]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索任务名称、脚本命令或仓库..."
                className="w-full h-[30px] pl-8 pr-3 rounded-[6px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[11.5px] focus:outline-hidden focus:border-[#4f46e5] shadow-2xs transition-colors"
              />
            </div>

            {/* 数据源筛选 */}
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value)}
              className="h-[30px] px-2 rounded-[6px] border border-[#e3e3e8] bg-white text-[#52525b] text-[11.5px] focus:outline-hidden focus:border-[#4f46e5] shadow-2xs cursor-pointer"
            >
              <option value="all">全部数据源</option>
              <option value="cli_script">CLI 脚本轮询</option>
              <option value="github_issues">GitHub Issues</option>
              <option value="twitter_query">推特 / 社媒消息</option>
            </select>
          </div>

          {/* 状态筛选 Segmented Control */}
          <div className="flex items-center bg-[#ececf0] p-0.5 rounded-[6px] text-[11px] font-medium text-[#71717a]">
            <button
              onClick={() => setFilterStatus('all')}
              className={`h-[24px] px-2.5 rounded-[5px] transition-all cursor-pointer ${
                filterStatus === 'all' ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold' : 'hover:text-[#1c1c21]'
              }`}
            >
              全部
            </button>
            <button
              onClick={() => setFilterStatus('enabled')}
              className={`h-[24px] px-2.5 rounded-[5px] transition-all cursor-pointer ${
                filterStatus === 'enabled' ? 'bg-white text-[#059669] shadow-2xs font-semibold' : 'hover:text-[#1c1c21]'
              }`}
            >
              已启用
            </button>
            <button
              onClick={() => setFilterStatus('disabled')}
              className={`h-[24px] px-2.5 rounded-[5px] transition-all cursor-pointer ${
                filterStatus === 'disabled' ? 'bg-white text-[#71717a] shadow-2xs font-semibold' : 'hover:text-[#1c1c21]'
              }`}
            >
              已停用
            </button>
          </div>
        </div>

        {/* 核心表格卡片容器 */}
        <div className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden flex flex-col">
          {/* 表格表头: 34px 高度浅灰底微边框 */}
          <div className="h-[34px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center text-[11px] font-medium text-[#85858d] select-none">
            <div className="w-[38%] min-w-0 pr-3">任务名称与触发源</div>
            <div className="w-[14%] pr-2">轮询周期</div>
            <div className="w-[20%] pr-2">下游联动与流水线</div>
            <div className="w-[18%] pr-2">最近轮询状态</div>
            <div className="w-[10%] text-right">开关与操作</div>
          </div>

          {/* 表格行列表 */}
          <div className="divide-y divide-[#f1f1f4]">
            {filteredAutomations.length === 0 ? (
              <div className="py-14 text-center text-[#85858d] space-y-2">
                <Timer size={24} className="mx-auto text-[#d4d4d8] mb-1" />
                <div className="text-[12.5px] font-medium text-[#1c1c21]">暂无符合条件的自动化任务</div>
                <div className="text-[11px] text-[#85858d]">
                  点击右上角「新建自动化任务」或调整检索过滤条件
                </div>
              </div>
            ) : (
              filteredAutomations.map((task) => {
                const isTriggering = triggeringIds.has(task.id);
                const isRunning = task.lastRunStatus === 'running' || isTriggering;
                const wfName = getWorkflowName(task.actionConfig?.workflowId);

                return (
                  <div
                    key={task.id}
                    className="group hover:bg-[#fafafc] transition-colors flex items-center px-4 py-2.5 text-[12px]"
                  >
                    {/* 1. 任务名称与触发源 */}
                    <div className="w-[38%] min-w-0 flex items-center gap-2.5 pr-3">
                      <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] group-hover:bg-white flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60 transition-colors">
                        {getSourceIcon(task.sourceType)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            onClick={() => {
                              setEditingTask(task);
                              setIsEditModalOpen(true);
                            }}
                            className="font-medium text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors truncate cursor-pointer text-[12.5px]"
                            title={task.name}
                          >
                            {task.name}
                          </span>

                          <span className="shrink-0 text-[9.5px] px-1 py-0.2 rounded bg-[#f4f4f5] text-[#52525b] border border-[#e4e4e7] font-mono">
                            {task.sourceType === 'github_issues'
                              ? 'GitHub'
                              : task.sourceType === 'twitter_query'
                              ? 'Twitter'
                              : 'CLI'}
                          </span>
                        </div>

                        <div className="text-[11px] text-[#85858d] truncate mt-0.5">
                          {task.sourceType === 'github_issues' && (
                            <span className="font-mono">repo: {task.sourceConfig?.repo || '未知'}</span>
                          )}
                          {task.sourceType === 'twitter_query' && (
                            <span>query: "{task.sourceConfig?.twitterQuery}"</span>
                          )}
                          {task.sourceType === 'cli_script' && (
                            <span className="font-mono">{task.sourceConfig?.command || task.description || '无执行命令'}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 2. 轮询周期 */}
                    <div className="w-[14%] pr-2">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#52525b] text-[10.5px] font-mono border border-[#e3e3e8]">
                        <Clock size={10} className="text-[#85858d]" />
                        <span>每 {task.intervalSec} 秒</span>
                      </span>
                    </div>

                    {/* 3. 下游联动与流水线 */}
                    <div className="w-[20%] pr-2 min-w-0">
                      {task.actionType === 'create_task' && (
                        <div className="flex items-center gap-1.5 text-[11px] text-[#52525b] truncate">
                          <Layers size={11} className="text-[#71717a] shrink-0" />
                          <span className="truncate">创建任务 → {task.actionConfig?.kanbanColumn || 'inbox'}</span>
                        </div>
                      )}
                      {task.actionType === 'run_workflow' && (
                        <div className="flex items-center gap-1.5 text-[11px] text-[#4f46e5] truncate">
                          <Workflow size={11} className="text-[#4f46e5] shrink-0" />
                          <span className="truncate font-medium">{wfName || '默认流水线'}</span>
                        </div>
                      )}
                      {task.actionType === 'notify_only' && (
                        <span className="text-[11px] text-[#85858d]">仅记录日志</span>
                      )}
                    </div>

                    {/* 4. 最近轮询状态 */}
                    <div className="w-[18%] pr-2 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isRunning ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10px] font-medium border border-[#bfdbfe]/60">
                            <Loader2 size={10} className="animate-spin" />
                            <span>RUNNING</span>
                          </span>
                        ) : task.lastRunStatus === 'success' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                            <CheckCircle2 size={10} strokeWidth={2.2} />
                            <span>PASSED</span>
                          </span>
                        ) : task.lastRunStatus === 'failed' ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60">
                            <XCircle size={10} strokeWidth={2.2} />
                            <span>FAILED</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#71717a] text-[10px] font-medium border border-[#e3e3e8]">
                            <Clock size={10} />
                            <span>UNTESTED</span>
                          </span>
                        )}

                        <span className="text-[10.5px] text-[#85858d] truncate">
                          {formatRelativeTime(task.lastRunAt)}
                        </span>
                      </div>

                      {task.lastRunMessage && (
                        <div className="text-[10px] text-[#71717a] truncate mt-0.5" title={task.lastRunMessage}>
                          {task.lastRunMessage}
                        </div>
                      )}
                    </div>

                    {/* 5. 开关与行操作 */}
                    <div className="w-[10%] flex items-center justify-end gap-1.5">
                      {/* 极简 Switch 开关 */}
                      <label className="relative inline-flex items-center cursor-pointer mr-1" title={task.enabled ? '点击停用' : '点击启用'}>
                        <input
                          type="checkbox"
                          checked={task.enabled}
                          onChange={() => handleToggleEnable(task)}
                          className="sr-only peer"
                        />
                        <div className="w-7 h-4 bg-[#e4e4e7] peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#d4d4d8] after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#059669]" />
                      </label>

                      {/* 立即手动运行 */}
                      <button
                        onClick={() => handleTriggerNow(task)}
                        disabled={isRunning}
                        title="立即测试执行一次"
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-all cursor-pointer disabled:opacity-40"
                      >
                        {isTriggering ? <Loader2 size={12} className="animate-spin text-[#4f46e5]" /> : <Play size={11} />}
                      </button>

                      {/* 查看执行日志 */}
                      <button
                        onClick={() => setLogsDrawerTask(task)}
                        title="查看执行历史日志"
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
                      >
                        <Terminal size={11} />
                      </button>

                      {/* 编辑 */}
                      <button
                        onClick={() => {
                          setEditingTask(task);
                          setIsEditModalOpen(true);
                        }}
                        title="编辑配置"
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
                      >
                        <Edit3 size={11} />
                      </button>

                      {/* 删除 */}
                      <button
                        onClick={() => setDeleteTargetTask(task)}
                        title="删除任务"
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-all cursor-pointer"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 创建 / 编辑模态框 */}
      <EditAutomationModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingTask(null);
        }}
        automation={editingTask}
        workflows={workflows}
        onSave={handleSaveAutomation}
      />

      {/* 日志抽屉 */}
      <AutomationLogsDrawer
        isOpen={Boolean(logsDrawerTask)}
        onClose={() => setLogsDrawerTask(null)}
        automation={logsDrawerTask}
        onOpenTaskLogs={onOpenTaskLogs}
      />

      {/* 删除确认对话框 */}
      <ConfirmModal
        isOpen={Boolean(deleteTargetTask)}
        onClose={() => setDeleteTargetTask(null)}
        onConfirm={handleDeleteConfirm}
        title="确认删除自动化任务"
        message={`确定要删除自动化任务「${deleteTargetTask?.name}」吗？删除后将停止定时轮询调度且不可恢复。`}
        confirmText="确认删除"
        danger
        loading={isDeleting}
      />
    </div>
  );
};
