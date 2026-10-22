import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Save,
  Workflow,
  ChevronDown,
  Check,
  Copy,
  Lock,
  AlertCircle,
  Inbox,
  ListTodo,
  Sparkles,
} from 'lucide-react';
import { Task, WorkflowDefinition, KanbanColumn, TaskAttachment } from '@openloop/core';
import { WorkspacePicker } from './WorkspacePicker';
import { TaskPromptArea } from './TaskPromptArea';
import { toast } from './Toast';
import { formatShortTaskId, copyToClipboard } from '../utils/taskId';

interface EditTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  workflows: WorkflowDefinition[];
  onSave: (params: {
    title: string;
    description: string;
    workflowId: string;
    kanbanColumn?: KanbanColumn;
    workspace?: string;
    attachments?: TaskAttachment[];
  }) => Promise<void>;
}

export const EditTaskModal: React.FC<EditTaskModalProps> = ({
  isOpen,
  onClose,
  task,
  workflows,
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [kanbanColumn, setKanbanColumn] = useState<KanbanColumn>('backlog');
  const [workspace, setWorkspace] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [idCopied, setIdCopied] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // 初始化或当 task 改变时同步表单
  useEffect(() => {
    if (task) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setAttachments(task.attachments || []);
      setWorkflowId(task.workflowId || workflows[0]?.id || '');
      setKanbanColumn(task.kanbanColumn || 'backlog');
      setWorkspace(task.workspace || '');
      setErrorMsg(null);
    }
  }, [task, workflows]);

  // 按 Esc 键优先关闭下拉，再关闭弹窗
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDropdownOpen) {
          setIsDropdownOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDropdownOpen, onClose]);

  // 点击外部收起下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  if (!isOpen || !task) return null;

  const isPending = task.status === 'pending';
  const currentWf = workflows.find((w) => w.id === workflowId) || workflows[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    setErrorMsg(null);
    const trimmedWorkspace = workspace.trim();
    if (import.meta.env?.DEV) {
      console.log('[TaskEdit] 开始提交任务更新:', {
        taskId: task.id,
        title: title.trim(),
        workflowId,
        description: description.trim(),
        kanbanColumn,
        workspace: trimmedWorkspace || '未指定',
      });
    }
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        workflowId,
        kanbanColumn,
        workspace: trimmedWorkspace || undefined,
        attachments,
      });
      if (import.meta.env?.DEV) {
        console.log('[TaskEdit] 任务更新保存成功:', task.id);
      }
      setIsDropdownOpen(false);
      onClose();
    } catch (err: any) {
      const msg = err?.message || '未知错误，请检查调度服务连接状态';
      if (import.meta.env?.DEV) {
        console.error('[TaskEdit] 任务更新保存失败:', err);
      }
      setErrorMsg(`保存修改失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100"
      onClick={() => {
        if (!loading) {
          if (import.meta.env?.DEV) {
            console.log('[EditTaskModal] 点击蒙层关闭弹窗');
          }
          onClose();
        }
      }}
    >
      <div
        className="w-[440px] bg-white border border-[#e3e3e8] rounded-[10px] p-4 shadow-[0_16px_40px_rgba(20,22,30,0.14)] text-[#1c1c21]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-2.5 border-b border-[#ececf0]">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-semibold text-[13px] text-[#1c1c21] shrink-0">编辑任务信息</h3>
            <button
              type="button"
              onClick={async () => {
                if (import.meta.env?.DEV) console.log('[EditTaskModal] 点击复制任务 ID:', task.id);
                const ok = await copyToClipboard(task.id);
                if (ok) {
                  setIdCopied(true);
                  toast.success('任务 ID 已复制');
                  setTimeout(() => setIdCopied(false), 1500);
                }
              }}
              className={`group/id inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-[0.5px] rounded border transition-all cursor-pointer shrink-0 select-none active:scale-95 ${
                idCopied
                  ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/80'
                  : 'bg-[#f4f4f6] hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] border-[#ececf0]'
              }`}
              title={`任务编号: ${formatShortTaskId(task.id)}\n完整任务 ID: ${task.id} (点击复制)`}
            >
              <span>{formatShortTaskId(task.id)}</span>
              {idCopied ? (
                <Check size={9} className="text-[#059669]" />
              ) : (
                <Copy size={8.5} className="text-[#a1a1aa] group-hover/id:text-[#71717a] opacity-0 group-hover/id:opacity-100 transition-opacity" />
              )}
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* 内联错误通知横幅 */}
        {errorMsg && (
          <div className="mt-2.5 p-2 rounded-[6px] bg-[#fef2f2] border border-[#fecaca] flex items-center justify-between gap-2 text-[#b91c1c] text-[11px] animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertCircle size={13} className="text-[#dc2626] shrink-0" />
              <span className="truncate font-medium">{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-[#dc2626] hover:opacity-75 p-0.5 rounded transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-3 space-y-2.5 text-[11.5px]">
          {/* 任务名称 */}
          <div>
            <label className="block text-[11px] font-medium text-[#63636b] mb-1">任务名称</label>
            <input
              type="text"
              required
              placeholder={currentWf?.taskTemplate?.titlePlaceholder || '请输入任务名称'}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all"
            />
          </div>

          {/* 关联工程工作区 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-[#63636b]">工程工作区</label>
              <span className="text-[10px] text-[#85858d]">
                {workspace ? '已关联独立工程' : '可留空使用默认目录'}
              </span>
            </div>
            <WorkspacePicker
              value={workspace}
              onChange={setWorkspace}
              placeholder="选择工程工作区 (点击下拉或右侧打开访达)..."
            />
          </div>

          {/* 关联工作流 */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] font-medium text-[#63636b]">关联自动化流程</label>
                {!isPending && (
                  <span className="flex items-center gap-0.5 text-[9.5px] text-[#85858d] bg-[#f4f4f6] px-1 py-[0.5px] rounded">
                    <Lock size={9.5} /> 流程已锁定
                  </span>
                )}
              </div>
              {currentWf && (
                <span className="text-[10px] font-mono text-[#85858d]">
                  {currentWf.nodes.length} 节点 · {currentWf.edges.length} 连线
                </span>
              )}
            </div>

            {/* 触发单行控件 */}
            <div
              onClick={() => {
                if (isPending) {
                  setIsDropdownOpen(!isDropdownOpen);
                }
              }}
              className={`w-full h-[30px] px-2.5 rounded-[6px] border transition-all flex items-center justify-between select-none ${
                !isPending
                  ? 'bg-[#f4f4f6] border-[#ececf0] text-[#85858d] cursor-not-allowed'
                  : isDropdownOpen
                  ? 'border-[#4f46e5] bg-white ring-1 ring-[#eeedfd] shadow-sm cursor-pointer'
                  : 'border-[#e3e3e8] bg-[#f9f9fb] hover:bg-white hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.02)] cursor-pointer'
              }`}
            >
              {currentWf ? (
                <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
                  <Workflow size={13} className={isPending ? 'text-[#4f46e5]' : 'text-[#85858d]'} />
                  <span className="font-medium text-[12px] text-[#1c1c21] truncate max-w-[200px]">
                    {currentWf.name}
                  </span>
                  <span className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1 py-[0.5px] rounded shrink-0">
                    {currentWf.id}
                  </span>
                </div>
              ) : (
                <span className="text-[#85858d] text-[11.5px]">请选择工作流</span>
              )}

              {isPending && (
                <ChevronDown
                  size={12}
                  className={`text-[#85858d] shrink-0 transition-transform duration-150 ${
                    isDropdownOpen ? 'rotate-180 text-[#4f46e5]' : ''
                  }`}
                />
              )}
            </div>

            {/* 下拉弹出浮层 Popover */}
            {isPending && isDropdownOpen && (
              <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-[#e3e3e8] rounded-[8px] shadow-[0_10px_26px_rgba(20,22,30,0.12)] z-50 max-h-[220px] overflow-y-auto p-1 space-y-0.5 animate-in fade-in zoom-in-95 duration-100">
                {workflows.map((wf) => {
                  const isSelected = wf.id === currentWf?.id;

                  return (
                    <div
                      key={wf.id}
                      onClick={() => {
                        setWorkflowId(wf.id);
                        setIsDropdownOpen(false);
                      }}
                      className={`p-2 rounded-[5px] cursor-pointer transition-all flex items-start justify-between ${
                        isSelected
                          ? 'bg-[#eeedfd]/50 border border-[#d8d6fb]'
                          : 'hover:bg-[#f9f9fb] border border-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-2 min-w-0 flex-1 pr-2">
                        <div
                          className={`w-5 h-5 rounded-[4px] flex items-center justify-center shrink-0 mt-0.5 ${
                            isSelected
                              ? 'bg-[#4f46e5] text-white shadow-sm'
                              : 'bg-[#f1f1f4] text-[#63636b]'
                          }`}
                        >
                          <Workflow size={11} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-[12px] text-[#1c1c21] truncate">
                              {wf.name}
                            </span>
                            <span className="text-[9px] font-mono text-[#85858d] bg-[#f4f4f6] px-1 py-[0.5px] rounded">
                              {wf.id}
                            </span>
                          </div>

                          <div className="text-[10.5px] text-[#85858d] truncate mt-0.5">
                            {wf.description || '无附加描述'}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0">
                        <span className="text-[10px] font-mono text-[#85858d]">
                          {wf.nodes.length} 节点
                        </span>
                        {isSelected && (
                          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-[#4f46e5] font-medium">
                            <Check size={11} strokeWidth={2.4} />
                            已选
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 任务描述与上下文 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-[#63636b]">
                任务说明与提示词 (可选)
              </label>
              {currentWf?.taskTemplate?.descriptionTemplate &&
                description.trim() !== currentWf.taskTemplate.descriptionTemplate.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setDescription(currentWf.taskTemplate!.descriptionTemplate!);
                      if (import.meta.env?.DEV) {
                        console.log('[EditTaskModal] 用户套用流程专属模板:', currentWf.name);
                      }
                      toast.success(`已套用「${currentWf.name}」专属模板`);
                    }}
                    className="text-[10px] text-[#4f46e5] hover:text-[#4338ca] hover:underline flex items-center gap-1 cursor-pointer font-medium"
                    title="将说明框重置为当前流水线的专属结构化模板"
                  >
                    <Sparkles size={10} />
                    <span>套用流程模板</span>
                  </button>
                )}
            </div>
            <TaskPromptArea
              value={description}
              onChange={setDescription}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              disabled={loading}
              rows={3}
            />
          </div>

          {/* 未运行任务允许调整看板泳道 (Segmented Control) */}
          {isPending && (
            <div className="flex items-center justify-between gap-2 pt-1 pb-0.5">
              <span className="text-[11px] font-medium text-[#63636b] shrink-0">归属泳道:</span>
              <div className="flex items-center p-0.5 rounded-[5px] bg-[#f1f1f4] border border-[#e3e3e8]">
                <button
                  type="button"
                  onClick={() => setKanbanColumn('inbox')}
                  className={`px-2.5 h-[22px] rounded-[4px] text-[10.5px] transition-all flex items-center gap-1 ${
                    kanbanColumn === 'inbox'
                      ? 'bg-white text-[#4f46e5] font-medium shadow-sm'
                      : 'text-[#63636b] hover:text-[#1c1c21]'
                  }`}
                >
                  <Inbox size={11} />
                  <span>Inbox 收集箱</span>
                </button>
                <button
                  type="button"
                  onClick={() => setKanbanColumn('backlog')}
                  className={`px-2.5 h-[22px] rounded-[4px] text-[10.5px] transition-all flex items-center gap-1 ${
                    kanbanColumn === 'backlog'
                      ? 'bg-white text-[#1c1c21] font-medium shadow-sm'
                      : 'text-[#63636b] hover:text-[#1c1c21]'
                  }`}
                >
                  <ListTodo size={11} />
                  <span>待处理队列</span>
                </button>
              </div>
            </div>
          )}

          {/* 底部按钮栏 */}
          <div className="pt-2 flex items-center justify-end gap-1.5 border-t border-[#ececf0]">
            <button
              type="button"
              onClick={onClose}
              className="h-[26px] px-3 rounded-[5px] text-[#63636b] hover:bg-[#f1f1f4] hover:text-[#1c1c21] text-[11.5px] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="h-[26px] px-3.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
            >
              <Save size={11} strokeWidth={2.4} />
              <span>{loading ? '保存中...' : '保存修改'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
