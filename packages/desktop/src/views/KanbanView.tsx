import React, { useState, useEffect, useRef } from 'react';
import {
  Check,
  X,
  FileImage,
  Terminal,
  Search,
  Sparkles,
  LayoutGrid,
  List,
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
  FileText,
  RefreshCw,
  GitBranch,
} from 'lucide-react';
import { Task, KanbanColumn, WorkflowDefinition, NodeRun } from '@openloop/core';
import { api } from '../services/api';
import { EditTaskModal } from '../components/EditTaskModal';
import { ConfirmModal } from '../components/ConfirmModal';

interface KanbanViewProps {
  tasks: Task[];
  workflows: WorkflowDefinition[];
  onOpenTaskLogs: (taskId: string) => void;
  onRefresh: () => void;
}

interface ColumnDef {
  key: KanbanColumn;
  title: string;
  dotColor: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'backlog', title: '待处理', dotColor: 'bg-[#85858d]' },
  { key: 'agent_executing', title: 'Agent 编码中', dotColor: 'bg-[#7c3aed]' },
  { key: 'in_progress', title: '自动化流水线', dotColor: 'bg-[#1d4ed8]' },
  { key: 'qa_review', title: 'QA 待验收', dotColor: 'bg-[#b45309]' },
  { key: 'done', title: '已完成', dotColor: 'bg-[#189a58]' },
];

export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks,
  workflows,
  onOpenTaskLogs,
  onRefresh,
}) => {
  // 默认使用看板泳道，同时支持无缝切会话列表
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('kanban');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<{ name: string; path: string } | null>(null);
  const [selectedWorkflowFilter, setSelectedWorkflowFilter] = useState<string>('all');
  const [isWfDropdownOpen, setIsWfDropdownOpen] = useState(false);
  const wfDropdownRef = useRef<HTMLDivElement>(null);
  const [isGroupOpen, setIsGroupOpen] = useState(true);

  const wfMap = new Map(workflows.map((w) => [w.id, w]));

  const filteredTasks = tasks.filter((t) => {
    if (selectedWorkflowFilter !== 'all' && t.workflowId !== selectedWorkflowFilter) {
      return false;
    }
    if (!searchTerm) return true;
    return (
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.id.toLowerCase().includes(searchTerm.toLowerCase())
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
          label: '待 QA 验收',
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
    try {
      await api.runTask(taskId);
      onRefresh();
    } catch (e: any) {
      alert(`启动任务失败: ${e.message}`);
    } finally {
      setRunningTaskId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!taskToDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteTask(taskToDelete.id);
      if (selectedTask?.id === taskToDelete.id) {
        setSelectedTask(null);
      }
      setTaskToDelete(null);
      onRefresh();
    } catch (e: any) {
      alert(`删除任务失败: ${e.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveEditedTask = async (params: {
    title: string;
    description: string;
    workflowId: string;
  }) => {
    if (!editingTask) return;
    try {
      const updated = await api.updateTask(editingTask.id, params);
      if (selectedTask?.id === editingTask.id) {
        setSelectedTask(updated);
      }
      onRefresh();
    } catch (e: any) {
      alert(`保存修改失败: ${e.message}`);
    }
  };

  const handleApprove = async (taskId: string, approved: boolean) => {
    setApprovingId(taskId);
    try {
      await api.resumeTask(taskId, approved, approved ? 'QA 查验通过' : '验收驳回');
      onRefresh();
    } catch (e: any) {
      alert(`审批失败: ${e.message}`);
    } finally {
      setApprovingId(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isWfDropdownOpen) {
          setIsWfDropdownOpen(false);
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
  }, [isWfDropdownOpen, editingTask, previewArtifact, selectedTask]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wfDropdownRef.current && !wfDropdownRef.current.contains(e.target as Node)) {
        setIsWfDropdownOpen(false);
      }
    };
    if (isWfDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isWfDropdownOpen]);

  const currentWf = workflows.find((w) => w.id === selectedWorkflowFilter);
  const currentWfLabel = selectedWorkflowFilter === 'all' ? '全部工作流' : (currentWf?.name || selectedWorkflowFilter);
  const currentWfTaskCount = selectedWorkflowFilter === 'all'
    ? tasks.length
    : tasks.filter((t) => t.workflowId === selectedWorkflowFilter).length;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-hidden select-none">
      {/* 1:1 magpie 风格次级工具栏 (Sub-header) */}
      <div className="px-6 py-2 bg-transparent flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
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

          {/* 搜索框 (如截图中的搜索会话) */}
          <div className="relative w-56 ml-1">
            <input
              type="text"
              placeholder="搜索任务或会话..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-[28px] bg-white border border-[#e3e3e8] rounded-[6px] px-2.5 text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#b9b9c2]"
            />
          </div>
        </div>

        {/* 右侧：视图切换与回收站 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-[#e6e6eb] p-[2px] rounded-[6px]">
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1 px-2.5 h-[24px] rounded-[4px] text-[11.5px] transition-all ${
                viewMode === 'kanban'
                  ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <LayoutGrid size={12} />
              <span>看板泳道</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-2.5 h-[24px] rounded-[4px] text-[11.5px] transition-all ${
                viewMode === 'list'
                  ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <List size={12} />
              <span>会话列表</span>
            </button>
          </div>

          <button
            onClick={() => onRefresh()}
            className="flex items-center gap-1 text-[11.5px] text-[#85858d] hover:text-[#1c1c21] transition-colors"
          >
            <RefreshCw size={12} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* 视图模式 1：看板泳道 (默认满高沉浸设计) */}
      {viewMode === 'kanban' && (
        <div className="flex-1 min-h-0 px-6 pb-5 pt-1 flex flex-col overflow-hidden">
          {/* 精致紧凑的状态说明 */}
          <div className="flex items-center justify-between pb-2.5 shrink-0 text-[11.5px] text-[#85858d]">
            <div className="flex items-center gap-2">
              <span className="font-medium text-[#1c1c21]">全自动化流水线看板</span>
              <span>·</span>
              <span>共 {filteredTasks.length} 个任务流转中</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[#85858d]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#189a58] inline-block animate-pulse" />
              <span>Core 守护流水线运行中</span>
            </div>
          </div>

          {/* 满高泳道水平容器 */}
          <div className="flex-1 min-h-0 flex gap-3.5 overflow-x-auto pb-1 items-stretch">
            {COLUMNS.map((col) => {
              const colTasks = filteredTasks.filter((t) => t.kanbanColumn === col.key);

              return (
                <div
                  key={col.key}
                  className="w-[280px] shrink-0 h-full bg-[#ebebef] border border-[#e3e3e8] rounded-[10px] flex flex-col min-h-0 shadow-[0_1px_3px_rgba(0,0,0,0.03)]"
                >
                  {/* 泳道头 */}
                  <div className="h-[36px] px-3 flex items-center justify-between border-b border-[#e3e3e8] shrink-0 bg-[#ebebef] rounded-t-[10px]">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                      <span className="text-[12px] font-medium text-[#1c1c21]">{col.title}</span>
                    </div>
                    <span className="h-[18px] px-1.5 rounded-[4px] bg-white border border-[#e3e3e8] text-[11px] font-mono text-[#85858d] flex items-center">
                      {colTasks.length}
                    </span>
                  </div>

                  {/* 泳道卡片列表：独立纵向滚动，撑满泳道全高 */}
                  <div className="flex-1 min-h-0 p-2.5 overflow-y-auto space-y-2">
                    {colTasks.length === 0 ? (
                      <div className="h-28 border border-dashed border-[#d1d1d8] rounded-[8px] flex items-center justify-center text-[11px] text-[#85858d]">
                        暂无任务
                      </div>
                    ) : (
                      colTasks.map((task) => {
                        const wf = wfMap.get(task.workflowId);
                        const currentNode = wf?.nodes.find((n) => n.id === task.currentNodeId);
                        const nodeRuns = Object.values(task.nodeRuns || {});
                        const completedCount = nodeRuns.filter((r) => r.status === 'success').length;
                        const totalNodes = wf?.nodes.length || 1;
                        const progressPct = Math.round((completedCount / totalNodes) * 100);

                        return (
                          <div
                            key={task.id}
                            onClick={() => setSelectedTask(task)}
                            className={`group bg-white border rounded-[8px] p-3 transition-all cursor-pointer ${
                              task.status === 'waiting_approval'
                                ? 'border-[#b45309] shadow-sm'
                                : 'border-[#e3e3e8] hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10.5px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                                {task.id}
                              </span>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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

                            <div className="text-[11px] text-[#85858d] mb-2 truncate">
                              {wf?.name || task.workflowId}
                            </div>

                            {/* 未启动任务：卡片内一键启动按钮 */}
                            {task.status === 'pending' && (
                              <div className="my-2">
                                <button
                                  disabled={runningTaskId === task.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRunTask(task.id);
                                  }}
                                  className="w-full h-[24px] rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 shadow-sm"
                                >
                                  <Play size={10} strokeWidth={2.4} />
                                  <span>{runningTaskId === task.id ? '启动中...' : '启动流水线'}</span>
                                </button>
                              </div>
                            )}

                            {task.status === 'running' && currentNode && (
                              <div className="mb-2 px-2 py-1 rounded-[6px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] animate-ping inline-block" />
                                <span className="text-[10.5px] text-[#4f46e5] font-medium truncate">
                                  正在执行: {currentNode.name}
                                </span>
                              </div>
                            )}

                            {task.status === 'waiting_approval' && (
                              <div className="my-2 p-2 rounded-[6px] bg-[#fbf0df] border border-[#f3d0a1]">
                                <div className="text-[11px] font-medium text-[#b45309] mb-1.5">
                                  Midscene 动图已就绪，等待验收
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    disabled={approvingId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleApprove(task.id, true);
                                    }}
                                    className="flex-1 h-[22px] rounded-[5px] bg-[#189a58] hover:bg-[#147e48] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-50"
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
                                    className="h-[22px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[#d64545] hover:bg-[#fbe9e9] text-[11px] font-medium transition-all"
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
                                        setPreviewArtifact(art);
                                      }}
                                      className="flex items-center gap-1 px-1.5 h-[20px] rounded-[4px] bg-[#f1f1f4] border border-[#e3e3e8] text-[10.5px] text-[#4b4b53] hover:bg-[#e9e9ee]"
                                    >
                                      <FileImage size={10} className="text-[#4f46e5]" />
                                      <span>{art.name}</span>
                                    </button>
                                  ))}
                              </div>
                            )}

                            <div className="pt-1.5 border-t border-[#ececf0] flex items-center justify-between text-[10.5px] text-[#85858d]">
                              <span>
                                节点 {completedCount}/{totalNodes}
                              </span>
                              <div className="w-16 bg-[#e6e6eb] rounded-full h-[3px] overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    task.status === 'completed'
                                      ? 'bg-[#189a58]'
                                      : task.status === 'failed'
                                      ? 'bg-[#d64545]'
                                      : 'bg-[#4f46e5]'
                                  }`}
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                              <span className="font-mono">{progressPct}%</span>
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
      )}

      {/* 视图模式 2：会话列表 */}
      {viewMode === 'list' && (
        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
          {/* 横幅卡片 (1:1 还原参考图中的“记录网关对话”卡片) */}
          <div className="bg-white border border-[#e3e3e8] rounded-[10px] p-3.5 flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-3">
              {/* 黑色 macOS 胶囊 Switch 开关 (开启态) */}
              <div className="w-[34px] h-[20px] rounded-full bg-[#1c1c21] flex items-center px-[2px] cursor-pointer shadow-inner">
                <div className="w-[16px] h-[16px] rounded-full bg-white ml-auto shadow-sm" />
              </div>

              <div>
                <div className="text-[13px] font-medium text-[#1c1c21]">
                  全自动流水线状态机
                </div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5">
                  已开启：CLI 触发 → AI Agent 接入 → 完成 Hook → Midscene 自动化 UI 测试 → 截图拼接动图 → QA 人工/用例验收。
                </div>
              </div>
            </div>

            <button
              onClick={() => onRefresh()}
              className="flex items-center gap-1 text-[11.5px] text-[#85858d] hover:text-[#4f46e5] transition-colors"
            >
              <RefreshCw size={12} />
              <span>同步状态</span>
            </button>
          </div>

          {/* 说明副文 (参考图中的浅灰说明) */}
          <div className="text-[11px] text-[#85858d] px-1 leading-relaxed">
            「自动化调度」下的任务由 openLoop Core 守护进程执行。每个流程节点的流转条件与 CLI 工具均可在流程编排中自由编辑；支持随时审批恢复与任务配置修改。
          </div>

          {/* 任务计数 */}
          <div className="flex items-center justify-between px-1 pt-1 text-[11.5px] text-[#85858d]">
            <div className="flex items-center gap-2">
              <span>共 {filteredTasks.length} 个任务记录</span>
            </div>
          </div>

          <div className="space-y-2">
            {/* 目录分组行 */}
            <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div
                onClick={() => setIsGroupOpen(!isGroupOpen)}
                className="h-[34px] px-3 flex items-center justify-between bg-[#fbfbfd] border-b border-[#ececf0] cursor-pointer hover:bg-[#f4f4f7] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[#85858d]">
                    {isGroupOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </span>
                  <span className="text-[12px] font-medium text-[#1c1c21] truncate">
                    全自动化研发与 QA 测试工作流
                  </span>
                  <span className="text-[11px] font-mono text-[#b9b9c2] truncate">
                    /Users/zhoushitie/My/openLoop
                  </span>
                </div>
                <span className="text-[11px] font-mono text-[#85858d]">
                  {filteredTasks.length} 个会话任务
                </span>
              </div>

              {/* 会话列表行 */}
              {isGroupOpen && (
                <div className="divide-y divide-[#ececf0]">
                  {filteredTasks.length === 0 ? (
                    <div className="p-8 text-center text-[12px] text-[#85858d]">
                      暂无任务。点击右上角【+ 新建任务】或在终端使用 openloop task create 发起流程。
                    </div>
                  ) : (
                    filteredTasks.map((task) => {
                      const wf = wfMap.get(task.workflowId);
                      const currentNode = wf?.nodes.find((n) => n.id === task.currentNodeId);
                      const statusInfo = getTaskStatusInfo(task);
                      const nodeRuns = Object.values(task.nodeRuns || {});
                      const isPending = task.status === 'pending';
                      const isWaiting = task.status === 'waiting_approval';
                      const isRunning = task.status === 'running';

                      return (
                        <div
                          key={task.id}
                          onClick={() => setSelectedTask(task)}
                          className="min-h-[50px] px-3 py-2 flex items-center gap-3 hover:bg-[#f9f9fb] transition-colors cursor-pointer group"
                        >
                          {/* 标题与副信息 */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[#1c1c21] truncate">
                                {task.title}
                              </span>
                              <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                                {task.id}
                              </span>
                              {task.description && (
                                <span className="text-[11px] text-[#85858d] truncate max-w-[200px]">
                                  - {task.description}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#85858d] flex items-center gap-2 mt-0.5 truncate">
                              <span>
                                {new Date(task.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              <span>·</span>
                              <span>Agent: {currentNode?.name || 'OpenLoop Agent'}</span>
                              <span>·</span>
                              <span>流程: {wf?.name || task.workflowId}</span>
                              {nodeRuns.some((r) => r.artifacts && r.artifacts.length > 0) && (
                                <>
                                  <span>·</span>
                                  <span className="text-[#4f46e5] font-medium flex items-center gap-1">
                                    <FileImage size={11} />
                                    <span>含 Midscene 动图产物</span>
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* 统计指标与状态展示 (修复此前未启动却显示运行中的严重 bug) */}
                          <div className="text-right shrink-0">
                            <div className="text-[12px] font-mono font-medium text-[#1c1c21]">
                              {nodeRuns.length} 节点
                            </div>
                            <div className={`text-[11px] font-mono font-medium inline-block ${statusInfo.color}`}>
                              {statusInfo.label}
                            </div>
                          </div>

                          {/* 状态操作胶囊按钮组 */}
                          <div
                            className="flex items-center gap-1.5 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* 未启动任务：优先展示 [启动任务] 与 [编辑] */}
                            {isPending && (
                              <>
                                <button
                                  disabled={runningTaskId === task.id}
                                  onClick={() => handleRunTask(task.id)}
                                  className="h-[24px] px-2.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                                >
                                  <Play size={11} strokeWidth={2.4} />
                                  <span>{runningTaskId === task.id ? '启动中...' : '启动任务'}</span>
                                </button>
                                <button
                                  onClick={() => setEditingTask(task)}
                                  className="h-[24px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[#4b4b53] hover:bg-[#f1f1f4] hover:text-[#1c1c21] text-[11.5px] flex items-center gap-1 transition-all shadow-sm"
                                  title="编辑任务"
                                >
                                  <Edit3 size={11} />
                                  <span>编辑</span>
                                </button>
                              </>
                            )}

                            {/* 待 QA 验收任务：展示 [验收通过] 与 [驳回] */}
                            {isWaiting && (
                              <>
                                <button
                                  onClick={() => handleApprove(task.id, true)}
                                  className="h-[24px] px-2.5 rounded-[5px] bg-[#189a58] hover:bg-[#147e48] text-white text-[11.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                                >
                                  <Check size={11} strokeWidth={2.4} />
                                  <span>验收通过</span>
                                </button>
                                <button
                                  onClick={() => handleApprove(task.id, false)}
                                  className="h-[24px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[#d64545] hover:bg-[#fbe9e9] text-[11.5px] font-medium transition-all"
                                  >
                                  驳回
                                </button>
                              </>
                            )}

                            {/* 失败任务：展示 [重试] */}
                            {task.status === 'failed' && (
                              <button
                                disabled={runningTaskId === task.id}
                                onClick={() => handleRunTask(task.id)}
                                className="h-[24px] px-2.5 rounded-[5px] bg-[#e5484d] hover:bg-[#c93b40] text-white text-[11.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                              >
                                <RotateCcw size={11} strokeWidth={2.4} />
                                <span>重试</span>
                              </button>
                            )}

                            {/* 详情或运行中：可随时查看日志 */}
                            <button
                              onClick={() => onOpenTaskLogs(task.id)}
                              className="h-[24px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] hover:bg-[#f1f1f4] text-[11.5px] font-medium transition-all shadow-sm"
                            >
                              <span>查看日志</span>
                            </button>

                            {/* 如果已启动过，支持在非 pending 时编辑补充说明 */}
                            {!isPending && (
                              <button
                                onClick={() => setEditingTask(task)}
                                className="w-[24px] h-[24px] rounded-[5px] border border-[#e3e3e8] bg-white text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] flex items-center justify-center transition-all shadow-sm"
                                title="编辑说明"
                              >
                                <Edit3 size={11} />
                              </button>
                            )}

                            {/* 删除按钮 */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setTaskToDelete(task);
                              }}
                              className="w-[24px] h-[24px] rounded-[5px] border border-[#e3e3e8] bg-white text-[#85858d] hover:text-[#e5484d] hover:bg-[#fbe9e9] flex items-center justify-center transition-all shadow-sm"
                              title="删除此任务"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

            <div className="my-4 p-5 border border-dashed border-[#e3e3e8] rounded-[8px] bg-[#f9f9fb] flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-[10px] bg-white border border-[#e3e3e8] flex items-center justify-center mb-2.5 shadow-sm">
                <Sparkles className="text-[#4f46e5] w-7 h-7" />
              </div>
              <p className="text-[12.5px] font-medium text-[#1c1c21]">Midscene 自动化 UI 测试已合成</p>
              <p className="text-[11px] text-[#85858d] font-mono mt-0.5">{previewArtifact.path}</p>
              <div className="mt-3 px-2.5 py-0.5 rounded bg-[#e4f6ec] text-[#189a58] text-[11px] font-medium">
                包含步骤截图及交互操作动画帧
              </div>
            </div>

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
            className="w-[420px] h-full bg-white border-l border-[#e3e3e8] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.22)] flex flex-col animate-in slide-in-from-right duration-150 relative z-10"
          >
            <div className="flex items-center justify-between pb-3.5 border-b border-[#ececf0]">
              <div>
                <div className="text-[10.5px] font-mono text-[#85858d]">{selectedTask.id}</div>
                <h3 className="text-[13.5px] font-semibold text-[#1c1c21] mt-0.5">{selectedTask.title}</h3>
              </div>
              <div className="flex items-center gap-1">
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
                <span className="font-medium text-[#1c1c21] inline-block mt-1">
                  {selectedTask.kanbanColumn}
                </span>
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

            {/* 任务说明与提示词 */}
            <div>
              <div className="font-medium text-[#1c1c21] mb-1.5">任务说明与提示词</div>
              <div className="p-2.5 rounded-[7px] border border-[#ececf0] bg-[#f9f9fb] text-[#4b4b53] leading-relaxed whitespace-pre-wrap">
                {selectedTask.description || (
                  <span className="text-[#85858d] italic">未设置说明与 Prompt 提示词</span>
                )}
              </div>
            </div>

            {/* 节点执行时序 */}
            <div>
              <div className="font-medium text-[#1c1c21] mb-2">节点执行时序</div>
              {Object.keys(selectedTask.nodeRuns).length === 0 ? (
                <div className="p-4 rounded-[7px] border border-dashed border-[#e3e3e8] text-center text-[#85858d] text-[11.5px]">
                  任务尚未触发执行，暂无节点时序数据
                </div>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(selectedTask.nodeRuns).map(([nid, run]) => (
                    <div
                      key={nid}
                      className="p-2.5 rounded-[7px] border border-[#ececf0] bg-[#f9f9fb] flex items-center justify-between"
                    >
                      <div>
                        <div className="font-mono text-[#1c1c21] text-[12px] font-medium">{nid}</div>
                        {run.finishedAt && run.startedAt && (
                          <div className="text-[10.5px] text-[#85858d]">
                            耗时: {((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s
                          </div>
                        )}
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10.5px] font-medium ${
                          run.status === 'success'
                            ? 'bg-[#e4f6ec] text-[#189a58]'
                            : run.status === 'waiting_approval'
                            ? 'bg-[#fbf0df] text-[#b45309]'
                            : run.status === 'running'
                            ? 'bg-[#eeedfd] text-[#4f46e5]'
                            : 'bg-[#fbe9e9] text-[#d64545]'
                        }`}
                      >
                        {run.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 抽屉底部操作区 */}
          <div className="pt-3.5 border-t border-[#ececf0] space-y-2">
            {selectedTask.status === 'pending' && (
              <button
                disabled={runningTaskId === selectedTask.id}
                onClick={() => handleRunTask(selectedTask.id)}
                className="w-full h-[32px] rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <Play size={13} strokeWidth={2.4} />
                <span>{runningTaskId === selectedTask.id ? '正在启动...' : '立即启动此任务'}</span>
              </button>
            )}

            {selectedTask.status === 'waiting_approval' && (
              <div className="flex gap-2">
                <button
                  disabled={approvingId === selectedTask.id}
                  onClick={() => handleApprove(selectedTask.id, true)}
                  className="flex-1 h-[32px] rounded-[7px] bg-[#189a58] hover:bg-[#147e48] text-white text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all shadow-sm"
                >
                  <Check size={13} strokeWidth={2.4} />
                  <span>验收通过</span>
                </button>
                <button
                  disabled={approvingId === selectedTask.id}
                  onClick={() => handleApprove(selectedTask.id, false)}
                  className="h-[32px] px-3.5 rounded-[7px] border border-[#e3e3e8] bg-white text-[#d64545] hover:bg-[#fbe9e9] text-[12px] font-medium transition-all"
                >
                  驳回
                </button>
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

      {/* 通用删除确认弹窗 */}
      <ConfirmModal
        isOpen={!!taskToDelete}
        title="删除任务"
        targetName={taskToDelete?.title}
        targetTag={taskToDelete?.id}
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
    </div>
  );
};
