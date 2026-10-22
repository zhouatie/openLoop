import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Search,
  Layers,
  FolderGit2,
  Check,
  Loader2,
  Unlink,
  AlertCircle,
  GitMerge,
  Workflow,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Task, WorkflowDefinition } from '@openloop/core';
import { api } from '../services/api';
import { toast } from './Toast';
import { formatShortTaskId } from '../utils/taskId';

interface SelectParentTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  allTasks: Task[];
  workflows: WorkflowDefinition[];
  onSuccess?: () => void;
}

export const SelectParentTaskModal: React.FC<SelectParentTaskModalProps> = ({
  isOpen,
  onClose,
  task,
  allTasks,
  workflows,
  onSuccess,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 初始化已选择的父任务与搜索框
  useEffect(() => {
    if (isOpen && task) {
      setSelectedParentId(task.parentTaskId || null);
      setSearchTerm('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, task]);

  // Esc 键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // 目标父任务候选列表过滤与排序
  const candidateParents = useMemo(() => {
    if (!task) return [];
    const term = searchTerm.toLowerCase().trim();

    return allTasks
      .filter((t) => {
        // 1. 不能是自身
        if (t.id === task.id) return false;
        // 2. 目标任务不能已经是子任务 (保持单层任务组拓扑)
        if (t.kind === 'subtask' || Boolean(t.parentTaskId)) return false;
        // 3. 排除快捷方式与调试临时任务
        if (t.triggerSource === 'shortcut' || t.triggerSource === 'debug') return false;

        // 4. 检索词匹配
        if (!term) return true;
        return (
          t.title.toLowerCase().includes(term) ||
          t.id.toLowerCase().includes(term) ||
          (t.workspace && t.workspace.toLowerCase().includes(term))
        );
      })
      .sort((a, b) => {
        // 同工作区的优先排在前面
        const aSameWorkspace = a.workspace && a.workspace === task.workspace ? 1 : 0;
        const bSameWorkspace = b.workspace && b.workspace === task.workspace ? 1 : 0;
        if (aSameWorkspace !== bSameWorkspace) {
          return bSameWorkspace - aSameWorkspace;
        }
        // 之后按创建时间倒序
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
  }, [allTasks, task, searchTerm]);

  if (!isOpen || !task) return null;

  // 任务自身是否已经是包含子任务的任务组
  const isTaskAlreadyGroupWithSubs =
    task.kind === 'group' && Array.isArray(task.subTaskIds) && task.subTaskIds.length > 0;

  // 获取当前所属父任务详情
  const currentParentTask = task.parentTaskId
    ? allTasks.find((t) => t.id === task.parentTaskId)
    : null;

  // 提交绑定
  const handleConfirm = async () => {
    if (!selectedParentId) return;
    try {
      setLoading(true);
      if (import.meta.env?.DEV) {
        console.log(`[SelectParentTaskModal] 提交设置父任务: 任务 ${task.id} -> 父任务 ${selectedParentId}`);
      }
      await api.setTaskParent(task.id, selectedParentId);
      toast.success('已成功归入目标任务组');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(`操作失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 解绑恢复为独立任务
  const handleUnlink = async () => {
    try {
      setLoading(true);
      if (import.meta.env?.DEV) {
        console.log(`[SelectParentTaskModal] 提交解绑任务: 任务 ${task.id} 脱离父任务`);
      }
      await api.setTaskParent(task.id, null);
      toast.success('已恢复为独立单任务');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(`解绑失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-100">
      <div
        className="w-[520px] max-w-full bg-white rounded-[10px] border border-[#e3e3e8] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#ececf0] flex items-center justify-between bg-[#fafafc]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[6px] bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center border border-[#d8d6fb]/60">
              <GitMerge size={14} />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-[#1c1c21] leading-tight">
                设置所属父任务
              </h3>
              <p className="text-[11px] text-[#71717a] mt-0.5 truncate max-w-[360px]" title={task.title}>
                当前任务: <span className="font-medium text-[#1c1c21]">{task.title}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-[4px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* 当前归属状态与解绑横条 */}
        {task.parentTaskId && (
          <div className="px-5 py-2.5 bg-[#f4f4f7] border-b border-[#ececf0] flex items-center justify-between gap-3 text-[11.5px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[#71717a] shrink-0">当前已归属于:</span>
              <span className="font-medium text-[#4f46e5] truncate" title={currentParentTask?.title || task.parentTaskId}>
                {currentParentTask?.title || task.parentTaskId}
              </span>
            </div>
            <button
              type="button"
              disabled={loading || task.status === 'running'}
              onClick={handleUnlink}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-[5px] bg-white border border-[#e3e3e8] hover:border-[#d1d1d8] hover:bg-[#fafafc] text-[#e5484d] text-[11px] font-medium transition-colors shadow-3xs cursor-pointer disabled:opacity-50"
              title="脱离当前父任务，恢复为看板独立顶层任务"
            >
              <Unlink size={11} />
              <span>解绑恢复为独立任务</span>
            </button>
          </div>
        )}

        {/* 若当前任务自身已有子任务的警示 */}
        {isTaskAlreadyGroupWithSubs ? (
          <div className="p-6 text-center space-y-2">
            <div className="w-9 h-9 rounded-full bg-[#fef2f2] text-[#dc2626] flex items-center justify-center mx-auto">
              <AlertCircle size={18} />
            </div>
            <h4 className="text-[12.5px] font-medium text-[#1c1c21]">
              无法成为其他任务的子任务
            </h4>
            <p className="text-[11px] text-[#71717a] max-w-[340px] mx-auto leading-relaxed">
              当前任务已包含 {task.subTaskIds?.length || 0} 个子工序（本身为任务组容器）。openLoop 遵循极简扁平拓扑，不支持多层级任务树嵌套。
            </p>
          </div>
        ) : (
          <>
            {/* 搜索框 */}
            <div className="p-3.5 pb-2 border-b border-[#f1f1f4]">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5 text-[#85858d]" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="搜索目标父需求标题、ID 或工程工作区..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full h-[32px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] pl-8 pr-3 text-[12px] text-[#1c1c21] outline-none focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all placeholder:text-[#a1a1aa]"
                />
              </div>
            </div>

            {/* 候选任务列表 */}
            <div className="flex-1 max-h-[300px] overflow-y-auto divide-y divide-[#f4f4f7] p-2 space-y-1">
              {candidateParents.length === 0 ? (
                <div className="py-10 text-center text-[#85858d] text-[11.5px]">
                  未找到可选的目标父需求
                </div>
              ) : (
                candidateParents.map((candidate) => {
                  const isSelected = selectedParentId === candidate.id;
                  const isSameWorkspace = Boolean(candidate.workspace && candidate.workspace === task.workspace);
                  const isRunning = candidate.status === 'running';
                  const candidateWf = workflows.find((w) => w.id === candidate.workflowId);
                  const subCount = candidate.subTaskIds?.length || 0;

                  return (
                    <div
                      key={candidate.id}
                      onClick={() => {
                        if (isRunning) {
                          toast.info('目标任务正在执行中，无法动态添加子工序');
                          return;
                        }
                        setSelectedParentId(candidate.id);
                      }}
                      className={`px-3 py-2 rounded-[6px] flex items-center justify-between gap-2.5 transition-all cursor-pointer select-none ${
                        isSelected
                          ? 'bg-[#eeedfd] border border-[#d8d6fb] shadow-3xs'
                          : isRunning
                          ? 'opacity-60 bg-[#fafafc] cursor-not-allowed border border-transparent'
                          : 'hover:bg-[#fafafc] border border-transparent hover:border-[#ececf0]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'border-[#4f46e5] bg-[#4f46e5] text-white'
                              : 'border-[#d1d1d8] bg-white'
                          }`}
                        >
                          {isSelected && <Check size={10} strokeWidth={2.8} />}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[12px] font-medium text-[#1c1c21] truncate max-w-[280px]">
                              {candidate.title}
                            </span>
                            {subCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#f4f4f6] text-[#71717a] text-[9.5px] font-mono border border-[#e3e3e8]">
                                <Layers size={8.5} />
                                <span>{subCount} 工序</span>
                              </span>
                            )}
                            {isSameWorkspace && (
                              <span className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#ecfdf5] text-[#059669] text-[9.5px] font-medium border border-[#a7f3d0]/60">
                                同工作区
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[#85858d]">
                            <span className="font-mono text-[#71717a]">{formatShortTaskId(candidate.id)}</span>
                            <span>·</span>
                            <span className="truncate max-w-[120px]">{candidateWf?.name || candidate.workflowId}</span>
                            {candidate.workspace && (
                              <>
                                <span>·</span>
                                <span className="truncate max-w-[140px] font-mono">
                                  {candidate.workspace.replace(/[/\\]+$/, '').split(/[/\\]/).pop()}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 状态徽章 */}
                      <div className="shrink-0 flex items-center gap-1">
                        {candidate.status === 'running' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10px] font-medium border border-[#bfdbfe]/60">
                            <Loader2 size={9} className="animate-spin" />
                            <span>RUNNING</span>
                          </span>
                        )}
                        {candidate.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                            <CheckCircle2 size={9} />
                            <span>DONE</span>
                          </span>
                        )}
                        {candidate.status === 'failed' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60">
                            <AlertCircle size={9} />
                            <span>FAILED</span>
                          </span>
                        )}
                        {candidate.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#71717a] text-[10px] font-medium border border-[#e3e3e8]">
                            <Clock size={9} />
                            <span>PENDING</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-[#ececf0] bg-[#fafafc] flex items-center justify-between">
              <span className="text-[11px] text-[#85858d]">
                {selectedParentId
                  ? `已选父需求: ${allTasks.find((t) => t.id === selectedParentId)?.title || selectedParentId}`
                  : '请在上方列表中选择目标父需求'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 h-[28px] rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#63636b] text-[11.5px] font-medium transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!selectedParentId || selectedParentId === task.parentTaskId || loading}
                  onClick={handleConfirm}
                  className="px-3.5 h-[28px] rounded-[5px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                  <span>{loading ? '正在归入...' : '确认设为子工序'}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
