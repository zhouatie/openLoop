import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Search,
  Plus,
  Link2,
  Check,
  Loader2,
  FolderGit2,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Task, WorkflowDefinition } from '@openloop/core';
import { api } from '../services/api';
import { toast } from './Toast';
import { formatShortTaskId } from '../utils/taskId';

interface LinkExistingTasksModalProps {
  isOpen: boolean;
  onClose: () => void;
  parentTask: Task | null;
  allTasks: Task[];
  workflows: WorkflowDefinition[];
  onSuccess?: () => void;
}

export const LinkExistingTasksModal: React.FC<LinkExistingTasksModalProps> = ({
  isOpen,
  onClose,
  parentTask,
  allTasks,
  workflows,
  onSuccess,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 初始化
  useEffect(() => {
    if (isOpen) {
      setSelectedIds([]);
      setSearchTerm('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

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

  // 候选任务过滤
  const candidateTasks = useMemo(() => {
    if (!parentTask) return [];
    const currentSubIds = new Set(parentTask.subTaskIds || []);
    const term = searchTerm.toLowerCase().trim();

    return allTasks
      .filter((t) => {
        // 1. 不能是自身
        if (t.id === parentTask.id) return false;
        // 2. 不能已经是本任务组的子任务
        if (currentSubIds.has(t.id) || t.parentTaskId === parentTask.id) return false;
        // 3. 不能是拥有子工序的任务组 (防止多层树嵌套)
        if (t.kind === 'group' && Array.isArray(t.subTaskIds) && t.subTaskIds.length > 0) return false;
        // 4. 排除快捷方式与调试临时任务
        if (t.triggerSource === 'shortcut' || t.triggerSource === 'debug') return false;
        // 5. 排除正在运行中的任务
        if (t.status === 'running') return false;

        // 6. 搜索词匹配
        if (!term) return true;
        return (
          t.title.toLowerCase().includes(term) ||
          t.id.toLowerCase().includes(term) ||
          (t.workspace && t.workspace.toLowerCase().includes(term))
        );
      })
      .sort((a, b) => {
        // 同工作区的优先排在前面
        const aSameWorkspace = a.workspace && a.workspace === parentTask.workspace ? 1 : 0;
        const bSameWorkspace = b.workspace && b.workspace === parentTask.workspace ? 1 : 0;
        if (aSameWorkspace !== bSameWorkspace) {
          return bSameWorkspace - aSameWorkspace;
        }
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
  }, [allTasks, parentTask, searchTerm]);

  if (!isOpen || !parentTask) return null;

  // 切换单个选择
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // 全选/反选
  const handleSelectAll = () => {
    if (selectedIds.length === candidateTasks.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(candidateTasks.map((t) => t.id));
    }
  };

  // 提交关联
  const handleConfirm = async () => {
    if (selectedIds.length === 0) return;
    try {
      setLoading(true);
      if (import.meta.env?.DEV) {
        console.log(`[LinkExistingTasksModal] 提交吸纳已有任务至任务组: 父任务 ${parentTask.id}, 子任务:`, selectedIds);
      }
      await api.linkSubtasks(parentTask.id, selectedIds);
      toast.success(`已成功吸纳并关联 ${selectedIds.length} 个子工序`);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(`关联失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-100">
      <div
        className="w-[560px] max-w-full bg-white rounded-[10px] border border-[#e3e3e8] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#ececf0] flex items-center justify-between bg-[#fafafc]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[6px] bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center border border-[#d8d6fb]/60">
              <Link2 size={14} />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-[#1c1c21] leading-tight">
                关联已有任务为子工序
              </h3>
              <p className="text-[11px] text-[#71717a] mt-0.5 truncate max-w-[380px]" title={parentTask.title}>
                目标需求容器: <span className="font-medium text-[#1c1c21]">{parentTask.title}</span>
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

        {/* 搜索与全选工具栏 */}
        <div className="p-3.5 pb-2 border-b border-[#f1f1f4] flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-2.5 text-[#85858d]" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="搜索看板中现有的未完成任务或标题..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-[32px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] pl-8 pr-3 text-[12px] text-[#1c1c21] outline-none focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all placeholder:text-[#a1a1aa]"
            />
          </div>
          {candidateTasks.length > 0 && (
            <button
              type="button"
              onClick={handleSelectAll}
              className="px-2.5 h-[32px] rounded-[6px] border border-[#e3e3e8] hover:bg-[#f4f4f6] text-[#63636b] hover:text-[#1c1c21] text-[11px] font-medium transition-colors cursor-pointer shrink-0"
            >
              {selectedIds.length === candidateTasks.length ? '取消全选' : '全部勾选'}
            </button>
          )}
        </div>

        {/* 候选任务列表 */}
        <div className="flex-1 max-h-[320px] overflow-y-auto divide-y divide-[#f4f4f7] p-2 space-y-1">
          {candidateTasks.length === 0 ? (
            <div className="py-10 text-center text-[#85858d] text-[11.5px]">
              看板中暂无可吸纳的独立任务
            </div>
          ) : (
            candidateTasks.map((candidate) => {
              const isChecked = selectedIds.includes(candidate.id);
              const isSameWorkspace = Boolean(candidate.workspace && candidate.workspace === parentTask.workspace);
              const candidateWf = workflows.find((w) => w.id === candidate.workflowId);

              return (
                <div
                  key={candidate.id}
                  onClick={() => toggleSelect(candidate.id)}
                  className={`px-3 py-2 rounded-[6px] flex items-center justify-between gap-2.5 transition-all cursor-pointer select-none ${
                    isChecked
                      ? 'bg-[#eeedfd] border border-[#d8d6fb] shadow-3xs'
                      : 'hover:bg-[#fafafc] border border-transparent hover:border-[#ececf0]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}} // 由父 div 点击处理
                      className="w-3.5 h-3.5 rounded text-[#4f46e5] focus:ring-[#4f46e5] border-[#d1d1d8] cursor-pointer"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12px] font-medium text-[#1c1c21] truncate max-w-[300px]">
                          {candidate.title}
                        </span>
                        {isSameWorkspace && (
                          <span className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#ecfdf5] text-[#059669] text-[9.5px] font-medium border border-[#a7f3d0]/60">
                            同工作区
                          </span>
                        )}
                        {candidate.parentTaskId && (
                          <span className="inline-flex items-center gap-0.5 px-1 py-[0.5px] rounded bg-[#fffbeb] text-[#b45309] text-[9.5px] font-medium border border-[#fde68a]">
                            已属其他组(将被移入)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[#85858d]">
                        <span className="font-mono text-[#71717a]">{formatShortTaskId(candidate.id)}</span>
                        <span>·</span>
                        <span className="truncate max-w-[130px]">{candidateWf?.name || candidate.workflowId}</span>
                        {candidate.workspace && (
                          <>
                            <span>·</span>
                            <span className="truncate max-w-[150px] font-mono">
                              {candidate.workspace.replace(/[/\\]+$/, '').split(/[/\\]/).pop()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 状态微徽章 */}
                  <div className="shrink-0 flex items-center gap-1">
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
            已勾选 <span className="font-medium text-[#4f46e5]">{selectedIds.length}</span> 项任务
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
              disabled={selectedIds.length === 0 || loading}
              onClick={handleConfirm}
              className="px-3.5 h-[28px] rounded-[5px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              <span>{loading ? '正在吸纳...' : `吸纳为子工序 (${selectedIds.length})`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
