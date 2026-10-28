import React, { useMemo, useRef, useState } from 'react';
import { Layers, Lightbulb, Loader2, Plus, X } from 'lucide-react';
import { Task } from '@openloop/core';
import { api } from '../services/api';
import { toast } from './Toast';

export interface InboxQuickAddProps {
  tasks: Task[];
  defaultWorkflowId: string;
  targetWorkspace?: string;
  workspaceLabel?: string;
  onClose: () => void;
  onCreated: (result: { task?: Task; subtask?: Task; parent?: Task }) => void;
}

/**
 * Inbox 一行快捕：输入即录，可选「挂到任务组」变成子工序。
 * 全部状态收敛在组件内部，输入过程不会触发看板重渲染。
 */
export const InboxQuickAdd: React.FC<InboxQuickAddProps> = ({
  tasks,
  defaultWorkflowId,
  targetWorkspace,
  workspaceLabel,
  onClose,
  onCreated,
}) => {
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [parent, setParent] = useState<{ id: string; title: string } | null>(null);
  const [isPickingParent, setIsPickingParent] = useState(false);
  const [parentQuery, setParentQuery] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);

  // 可作为父工序的候选：已有工序的任务组
  const parentCandidates = useMemo(() => {
    const keyword = parentQuery.trim().toLowerCase();
    return tasks
      .filter((t) => t.kind === 'group' || (t.subTaskIds && t.subTaskIds.length > 0))
      .filter((t) => !keyword || t.title.toLowerCase().includes(keyword))
      .slice(0, 6);
  }, [tasks, parentQuery]);

  const pickParent = (task: Task) => {
    setParent({ id: task.id, title: task.title });
    setParentQuery('');
    setIsPickingParent(false);
    if (import.meta.env?.DEV) {
      console.log('[InboxQuickAdd] 选中父工序:', task.id, task.title);
    }
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = title.trim();
    if (!text || isSubmitting) return;

    setIsSubmitting(true);
    if (import.meta.env?.DEV) {
      console.log('[InboxQuickAdd] 快捷录入:', {
        title: text,
        parentId: parent?.id || '(独立想法)',
        workspace: targetWorkspace || '未指定',
      });
    }
    try {
      if (parent) {
        const res = await api.addSubTask(parent.id, { title: text });
        onCreated({ subtask: res.subtask, parent: res.parent });
        toast.success(`已挂载为「${parent.title}」的子工序`);
      } else {
        const task = await api.createTask({
          title: text,
          workflowId: defaultWorkflowId,
          description: '来自 Inbox 快捷想法收集',
          kanbanColumn: 'inbox',
          autoRun: false,
          workspace: targetWorkspace,
        });
        onCreated({ task });
        toast.success('想法已记录至 Inbox');
      }
      setTitle('');
      setParent(null);
      titleRef.current?.focus();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[InboxQuickAdd] 快捷录入失败:', err);
      }
      toast.error(`${parent ? '挂载子工序' : '创建想法'}失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-[#6366f1]/40 rounded-[8px] p-2.5 shadow-[0_4px_12px_rgba(99,102,241,0.08)] space-y-2 animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="flex items-center justify-between text-[11px] font-medium text-[#6366f1]">
        <span className="flex items-center gap-1.5 min-w-0">
          <Lightbulb size={12} className="shrink-0" />
          <span className="shrink-0">{parent ? '追加子工序' : '随手记想法'}</span>
          {workspaceLabel && (
            <span className="text-[9.5px] font-normal text-[#85858d] bg-[#f4f4f6] px-1 py-[0.5px] rounded border border-[#ececf0] truncate max-w-[110px]">
              {workspaceLabel}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-4 h-4 rounded-[3px] text-[#a1a1aa] hover:text-[#1c1c21] hover:bg-[#f1f1f4] flex items-center justify-center shrink-0 transition-colors"
          title="关闭 (Esc)"
        >
          <X size={9.5} />
        </button>
      </div>

      <input
        ref={titleRef}
        type="text"
        autoFocus
        placeholder={parent ? '输入工序标题，Enter 挂为子工序' : '输入突发奇想，按 Enter 存入 Inbox'}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full h-[28px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none focus:bg-white focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]/20 transition-all"
      />

      {/* 归属：默认存为独立想法，亦可一键挂到既有任务组成为子工序 */}
      {isPickingParent && !parent && (
        <div className="rounded-[5px] border border-[#e3e3e8] bg-white overflow-hidden">
          <input
            ref={queryRef}
            value={parentQuery}
            onChange={(e) => setParentQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (parentCandidates[0]) pickParent(parentCandidates[0]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setIsPickingParent(false);
              }
            }}
            placeholder="搜索任务组…"
            className="w-full h-[24px] px-2 text-[10.5px] text-[#1c1c21] placeholder-[#a1a1aa] bg-[#fafafc] border-b border-[#f1f1f4] outline-none focus:bg-white transition-colors"
          />
          <div className="max-h-[120px] overflow-y-auto py-0.5">
            {parentCandidates.length === 0 ? (
              <div className="px-2 py-1.5 text-[10px] text-[#a1a1aa]">没有匹配的任务组</div>
            ) : (
              parentCandidates.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => pickParent(task)}
                  className="w-full flex items-center justify-between gap-1.5 px-2 py-1 text-left text-[10.5px] text-[#1c1c21] hover:bg-[#f4f4f6] transition-colors"
                >
                  <span className="truncate">{task.title}</span>
                  <span className="shrink-0 font-mono text-[9px] text-[#a1a1aa]">
                    {task.subTaskIds?.length || 0} 工序
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1 min-w-0">
          <Layers size={9} className="shrink-0 text-[#a1a1aa]" />
          {parent ? (
            <span className="inline-flex items-center gap-1 h-[18px] pl-1.5 pr-1 rounded-[4px] bg-[#eeedfd] border border-[#d8d6fb] text-[10px] font-medium text-[#4f46e5] max-w-full min-w-0">
              <span className="truncate max-w-[128px]" title={parent.title}>
                子工序 · {parent.title}
              </span>
              <button
                type="button"
                onClick={() => setParent(null)}
                className="shrink-0 text-[#8b87e8] hover:text-[#312e81]"
                title="改为独立想法"
              >
                <X size={8} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsPickingParent((v) => !v);
                requestAnimationFrame(() => queryRef.current?.focus());
              }}
              className="inline-flex items-center gap-0.5 h-[18px] px-1.5 rounded-[4px] border border-dashed border-[#dcdce2] text-[10px] text-[#85858d] hover:text-[#4f46e5] hover:border-[#c7c3f8] hover:bg-[#fafaff] transition-colors"
              title="把这条记录挂到某个任务组，成为它的子工序"
            >
              <Plus size={8} />
              <span>挂到任务组</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-[22px] px-2 rounded-[4px] text-[10.5px] text-[#85858d] hover:bg-[#f1f1f4]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!title.trim() || isSubmitting}
            className="h-[22px] px-2.5 rounded-[4px] bg-[#6366f1] hover:bg-[#4f46e5] text-white text-[10.5px] font-medium disabled:opacity-40 transition-colors shadow-sm flex items-center gap-1"
          >
            {isSubmitting && <Loader2 size={9} className="animate-spin" />}
            <span>{isSubmitting ? '保存中...' : parent ? '挂为子工序' : '存入 Inbox'}</span>
          </button>
        </div>
      </div>
    </form>
  );
};
