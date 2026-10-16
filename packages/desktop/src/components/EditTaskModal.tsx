import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Save,
  Workflow,
  ChevronDown,
  Check,
  Bot,
  Target,
  Sparkles,
  Layers,
  ArrowRight,
  Lock,
  AlertCircle,
  Inbox,
  ListTodo,
} from 'lucide-react';
import { Task, WorkflowDefinition, KanbanColumn } from '@openloop/core';

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
  const [workflowId, setWorkflowId] = useState('');
  const [kanbanColumn, setKanbanColumn] = useState<KanbanColumn>('backlog');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // 初始化或当 task 改变时同步表单
  useEffect(() => {
    if (task) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setWorkflowId(task.workflowId || workflows[0]?.id || '');
      setKanbanColumn(task.kanbanColumn || 'backlog');
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
    if (import.meta.env?.DEV) {
      console.log('[TaskEdit] 开始提交任务更新:', {
        taskId: task.id,
        title: title.trim(),
        workflowId,
        description: description.trim(),
        kanbanColumn,
      });
    }
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        workflowId,
        kanbanColumn,
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

  const getNodeSummaryBadges = (wf: WorkflowDefinition) => {
    const types = Array.from(new Set(wf.nodes.map((n) => n.type)));
    return (
      <div className="flex items-center gap-1 mt-1">
        {types.slice(0, 4).map((t) => {
          let label = t;
          let color = 'bg-[#f1f1f4] text-[#4b4b53]';
          if (t === 'agent') {
            label = 'Agent';
            color = 'bg-[#eeedfd] text-[#4f46e5]';
          } else if (t === 'midscene') {
            label = 'Midscene';
            color = 'bg-[#e4f6ec] text-[#189a58]';
          } else if (t === 'qa-approval') {
            label = 'QA验收';
            color = 'bg-[#fbf0df] text-[#b45309]';
          }
          return (
            <span
              key={t}
              className={`px-1.5 py-[1px] rounded-[3px] text-[9.5px] font-medium ${color}`}
            >
              {label}
            </span>
          );
        })}
        {types.length > 4 && (
          <span className="text-[9.5px] text-[#85858d]">+{types.length - 4}</span>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100">
      <div className="w-[500px] bg-white border border-[#e3e3e8] rounded-[12px] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.16)] text-[#1c1c21]">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-3.5 border-b border-[#ececf0]">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-[14px] text-[#1c1c21]">编辑任务信息</h3>
              <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-0.5 rounded">
                {task.id}
              </span>
            </div>
            <p className="text-[11.5px] text-[#85858d] mt-0.5">
              修改任务标题、补充业务上下文与调整执行配置
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-[6px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* 内联错误通知横幅 */}
        {errorMsg && (
          <div className="mt-3.5 p-2.5 rounded-[8px] bg-[#fef2f2] border border-[#fecaca] flex items-center justify-between gap-2 text-[#b91c1c] text-[11.5px] animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle size={14} className="text-[#dc2626] shrink-0" />
              <span className="truncate font-medium">{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-[#dc2626] hover:opacity-75 p-0.5 rounded transition-opacity"
            >
              <X size={13} />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-[12px]">
          {/* 任务名称 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1.5">任务名称</label>
            <input
              type="text"
              required
              placeholder="请输入任务名称"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-[32px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[7px] px-3 text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all"
            />
          </div>

          {/* 关联工作流 */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <label className="block font-medium text-[#4b4b53]">关联自动化流程</label>
                {!isPending && (
                  <span className="flex items-center gap-0.5 text-[10.5px] text-[#85858d] bg-[#f4f4f6] px-1 py-0.5 rounded">
                    <Lock size={10} /> 任务已启动，流程已锁定
                  </span>
                )}
              </div>
              {currentWf && (
                <span className="text-[11px] font-mono text-[#85858d]">
                  {currentWf.nodes.length} 节点 · {currentWf.edges.length} 连线
                </span>
              )}
            </div>

            {/* 触发主卡片 */}
            <div
              onClick={() => {
                if (isPending) {
                  setIsDropdownOpen(!isDropdownOpen);
                }
              }}
              className={`w-full min-h-[46px] px-3 py-2 rounded-[8px] border transition-all ${
                !isPending
                  ? 'bg-[#f4f4f6]/60 border-[#ececf0] cursor-not-allowed opacity-80'
                  : isDropdownOpen
                  ? 'border-[#4f46e5] bg-white ring-2 ring-[#eeedfd] shadow-sm cursor-pointer'
                  : 'border-[#e3e3e8] bg-[#f9f9fb] hover:bg-white hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.03)] cursor-pointer'
              } flex items-center justify-between`}
            >
              {currentWf ? (
                <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                  <div className="w-7 h-7 rounded-[6px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center justify-center text-[#4f46e5] shrink-0">
                    <Workflow size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[12.5px] text-[#1c1c21] truncate">
                        {currentWf.name}
                      </span>
                      <span className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1 py-[0.5px] rounded">
                        {currentWf.id}
                      </span>
                    </div>
                    {currentWf.description && (
                      <p className="text-[11px] text-[#85858d] truncate mt-0.5">
                        {currentWf.description}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <span className="text-[#85858d]">请选择工作流</span>
              )}

              {isPending && (
                <ChevronDown
                  size={14}
                  className={`text-[#85858d] shrink-0 transition-transform duration-200 ${
                    isDropdownOpen ? 'rotate-180 text-[#4f46e5]' : ''
                  }`}
                />
              )}
            </div>

            {/* 下拉弹出浮层 Popover */}
            {isPending && isDropdownOpen && (
              <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_12px_32px_rgba(0,0,0,0.12)] z-50 max-h-[240px] overflow-y-auto p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-100">
                {workflows.map((wf) => {
                  const isSelected = wf.id === currentWf?.id;

                  return (
                    <div
                      key={wf.id}
                      onClick={() => {
                        setWorkflowId(wf.id);
                        setIsDropdownOpen(false);
                      }}
                      className={`p-2.5 rounded-[7px] cursor-pointer transition-all flex items-start justify-between ${
                        isSelected
                          ? 'bg-[#eeedfd]/50 border border-[#d8d6fb]'
                          : 'hover:bg-[#f9f9fb] border border-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1 pr-3">
                        <div
                          className={`w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0 mt-0.5 ${
                            isSelected
                              ? 'bg-[#4f46e5] text-white shadow-sm'
                              : 'bg-[#f1f1f4] text-[#63636b]'
                          }`}
                        >
                          <Workflow size={12} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-[12.5px] text-[#1c1c21] truncate">
                              {wf.name}
                            </span>
                            <span className="text-[9.5px] font-mono text-[#85858d] bg-[#f4f4f6] px-1 py-[0.5px] rounded">
                              {wf.id}
                            </span>
                          </div>

                          <div className="text-[11px] text-[#85858d] truncate mt-0.5">
                            {wf.description || '无附加描述'}
                          </div>

                          {getNodeSummaryBadges(wf)}
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0 pt-0.5">
                        <span className="text-[10.5px] font-mono text-[#85858d]">
                          {wf.nodes.length} 节点
                        </span>
                        {isSelected && (
                          <span className="mt-1 flex items-center gap-1 text-[10.5px] text-[#4f46e5] font-medium">
                            <Check size={12} strokeWidth={2.4} />
                            已选中
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
            <label className="block font-medium text-[#4b4b53] mb-1.5">任务说明与提示词 (可选)</label>
            <textarea
              rows={3}
              placeholder="输入任务背景、特定需求描述或传给 Agent 的 Prompt 覆盖项..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[7px] p-2.5 text-[#1c1c21] placeholder-[#85858d] outline-none resize-none focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all"
            />
          </div>

          {/* 未运行任务允许调整看板泳道 */}
          {isPending && (
            <div>
              <label className="block font-medium text-[#4b4b53] mb-1.5">所在看板泳道</label>
              <div className="grid grid-cols-2 gap-2">
                <div
                  onClick={() => setKanbanColumn('inbox')}
                  className={`p-2 rounded-[8px] border cursor-pointer transition-all flex items-center gap-2 ${
                    kanbanColumn === 'inbox'
                      ? 'bg-[#f5f5ff] border-[#6366f1] ring-1 ring-[#6366f1]/20'
                      : 'bg-[#f9f9fb] border-[#e3e3e8] hover:bg-white'
                  }`}
                >
                  <Inbox size={13} className={kanbanColumn === 'inbox' ? 'text-[#6366f1]' : 'text-[#85858d]'} />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11.5px] font-medium text-[#1c1c21]">Inbox 收集箱</span>
                  </div>
                  {kanbanColumn === 'inbox' && <Check size={12} className="text-[#6366f1]" />}
                </div>

                <div
                  onClick={() => setKanbanColumn('backlog')}
                  className={`p-2 rounded-[8px] border cursor-pointer transition-all flex items-center gap-2 ${
                    kanbanColumn === 'backlog'
                      ? 'bg-[#f5f5ff] border-[#4f46e5] ring-1 ring-[#4f46e5]/20'
                      : 'bg-[#f9f9fb] border-[#e3e3e8] hover:bg-white'
                  }`}
                >
                  <ListTodo size={13} className={kanbanColumn === 'backlog' ? 'text-[#4f46e5]' : 'text-[#85858d]'} />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11.5px] font-medium text-[#1c1c21]">待处理队列</span>
                  </div>
                  {kanbanColumn === 'backlog' && <Check size={12} className="text-[#4f46e5]" />}
                </div>
              </div>
            </div>
          )}

          {/* 底部按钮栏 */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#ececf0]">
            <button
              type="button"
              onClick={onClose}
              className="h-[28px] px-3.5 rounded-[6px] text-[#4b4b53] hover:bg-[#f1f1f4] hover:text-[#1c1c21] text-[12px] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="h-[28px] px-4 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white font-medium flex items-center gap-1.5 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
            >
              <Save size={12} strokeWidth={2.4} />
              <span>{loading ? '保存中...' : '保存修改'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
