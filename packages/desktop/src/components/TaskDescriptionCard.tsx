import React, { useState, useEffect, useRef } from 'react';
import { AlignLeft, Edit3, Check, X, Loader2, ZoomIn, Layers } from 'lucide-react';
import { Task, TaskAttachment } from '@openloop/core';
import { api } from '../services/api';
import { toast } from './Toast';

export interface TaskDescriptionCardProps {
  task: Task;
  allTasks?: Task[];
  onTaskUpdated?: (task: Task) => void;
  onPreviewImage?: (att: TaskAttachment, imageList: TaskAttachment[]) => void;
}

export const TaskDescriptionCard: React.FC<TaskDescriptionCardProps> = ({
  task,
  allTasks = [],
  onTaskUpdated,
  onPreviewImage,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(task.description || '');
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 外部任务数据刷新时同步（仅在非编辑状态下同步）
  useEffect(() => {
    if (!isEditing) {
      setDraft(task.description || '');
    }
  }, [task.id, task.description, isEditing]);

  // 进入编辑状态时自动聚焦并将光标移至末尾
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [isEditing]);

  const isSubtask = task.kind === 'subtask' && Boolean(task.parentTaskId);
  const parentTaskObj = isSubtask
    ? allTasks.find((t) => t.id === task.parentTaskId)
    : undefined;
  const parentGroupSnapshot = task.context?.parentGroupSnapshot;
  const parentGroupTitle = parentTaskObj?.title || parentGroupSnapshot?.title;
  const parentGroupDescription = parentTaskObj?.description || parentGroupSnapshot?.description;
  const parentGroupAttachments: TaskAttachment[] =
    parentTaskObj?.attachments || parentGroupSnapshot?.attachments || [];

  const startEditing = () => {
    setDraft(task.description || '');
    setIsEditing(true);
    if (import.meta.env?.DEV) {
      console.log('[TaskDescriptionCard] 开始编辑任务描述:', { taskId: task.id });
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setDraft(task.description || '');
    if (import.meta.env?.DEV) {
      console.log('[TaskDescriptionCard] 放弃编辑任务描述:', { taskId: task.id });
    }
  };

  const handleSave = async () => {
    if (isSaving) return;

    const trimmed = draft.trim();
    // 内容未变更时直接退出编辑态，避免冗余请求
    if (trimmed === (task.description || '').trim()) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    if (import.meta.env?.DEV) {
      console.log('[TaskDescriptionCard] 正在保存任务描述:', {
        taskId: task.id,
        prevLength: (task.description || '').length,
        newLength: trimmed.length,
      });
    }

    try {
      const updated = await api.updateTask(task.id, {
        description: trimmed,
      });
      setIsEditing(false);
      onTaskUpdated?.(updated);
      toast.success('任务需求描述已更新');
      if (import.meta.env?.DEV) {
        console.log('[TaskDescriptionCard] 任务描述保存成功:', { taskId: task.id });
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[TaskDescriptionCard] 保存任务描述失败:', err);
      }
      toast.error(`保存失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  };

  return (
    <div className="rounded-[8px] border border-[#e3e3e8] bg-white p-3.5 shadow-sm space-y-2.5">
      {/* 如果是子工序且存在父任务组公共信息，展示全局公共背景与共享参考图 */}
      {isSubtask && (parentGroupDescription || parentGroupAttachments.length > 0) && (
        <div className="rounded-[6px] border border-[#d8d6fb] bg-[#f8f8ff] p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#4f46e5]">
              <Layers size={11.5} />
              <span className="truncate max-w-[280px]">
                任务组公共背景: {parentGroupTitle || '所属任务组'}
              </span>
            </div>
            <span className="text-[9.5px] font-mono text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-1.5 py-[0.5px] rounded shrink-0">
              全工序共享
            </span>
          </div>

          {parentGroupDescription && (
            <div className="text-[11px] text-[#4338ca] leading-relaxed whitespace-pre-wrap select-text max-h-[110px] overflow-y-auto bg-white/75 p-2 rounded-[5px] border border-[#e0defc]">
              {parentGroupDescription}
            </div>
          )}

          {parentGroupAttachments.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-[#6366f1] font-medium flex items-center gap-1">
                <span>任务组共享参考图 ({parentGroupAttachments.length})</span>
              </span>
              <div className="flex items-center gap-2 overflow-x-auto py-0.5 scrollbar-thin">
                {parentGroupAttachments.map((att) => {
                  const displayUrl = api.getAttachmentUrl(att.url);
                  return (
                    <div
                      key={att.id}
                      onClick={() => {
                        if (import.meta.env?.DEV) {
                          console.log('[TaskDescriptionCard] 预览任务组公共附件图片:', att.name);
                        }
                        onPreviewImage?.(att, parentGroupAttachments);
                      }}
                      className="group relative w-[46px] h-[46px] shrink-0 rounded-[5px] border border-[#d8d6fb] bg-white overflow-hidden shadow-2xs hover:border-[#4f46e5] cursor-pointer transition-all"
                      title={`${att.name} (任务组公共图片)\n${(att.size / 1024).toFixed(0)} KB\n点击大图预览`}
                    >
                      <img
                        src={displayUrl}
                        alt={att.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <ZoomIn size={11} className="text-white" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 头部标题与操作区 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#1c1c21] min-w-0">
          <AlignLeft size={12} className="text-[#71717a] shrink-0" />
          <span className="truncate">
            {isSubtask ? '本工序专属需求与提示词' : '任务需求与提示词'}
          </span>
          {task.attachments && task.attachments.length > 0 && (
            <span className="text-[10px] text-[#71717a] font-mono bg-[#f4f4f6] px-1.5 py-0.5 rounded-[4px] border border-[#e3e3e8] shrink-0">
              {task.attachments.length} 张参考图
            </span>
          )}
        </div>

        {/* 右侧操作按钮 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {!isEditing ? (
            <button
              type="button"
              onClick={startEditing}
              className="h-[22px] px-2 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#eeedfd] text-[#63636b] hover:text-[#4f46e5] hover:border-[#d8d6fb] text-[10.5px] font-medium flex items-center gap-1 transition-all shadow-2xs active:scale-95 cursor-pointer shrink-0"
              title="直接编辑任务需求与说明内容"
            >
              <Edit3 size={10.5} />
              <span>{task.description ? '编辑内容' : '添加说明'}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={cancelEditing}
                disabled={isSaving}
                className="h-[22px] px-2 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#71717a] hover:text-[#1c1c21] text-[10.5px] font-medium flex items-center gap-1 transition-all shadow-2xs active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <X size={10.5} />
                <span>取消</span>
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="h-[22px] px-2.5 rounded-[4px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[10.5px] font-medium flex items-center gap-1 shadow-xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={10.5} className="animate-spin" />
                    <span>保存中...</span>
                  </>
                ) : (
                  <>
                    <Check size={10.5} strokeWidth={2.5} />
                    <span>保存</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 内容展示区 / 编辑区 */}
      {!isEditing ? (
        <div
          onClick={startEditing}
          title="点击可直接编辑内容"
          className="group/desc relative p-3 rounded-[6px] border border-[#ececf0] bg-[#fafafc] hover:bg-[#f8f8fb] hover:border-[#d8d6fb] transition-all text-[#374151] text-[12px] leading-relaxed whitespace-pre-wrap select-text max-h-[220px] overflow-y-auto cursor-pointer"
        >
          {task.description ? (
            task.description
          ) : (
            <span className="text-[#a1a1aa] italic">
              {isSubtask
                ? '未设置专属说明（继承任务组公共描述），点击即可添加专属说明...'
                : '暂无任务需求描述，点击即可添加...'}
            </span>
          )}
          <span className="opacity-0 group-hover/desc:opacity-100 transition-opacity absolute top-2 right-2 flex items-center gap-1 text-[10px] text-[#71717a] bg-white/90 px-1.5 py-0.5 rounded border border-[#e3e3e8] shadow-3xs pointer-events-none select-none">
            <Edit3 size={9.5} />
            <span>点击编辑</span>
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
            rows={5}
            placeholder={
              isSubtask
                ? '输入本工序专属需求与提示词（如留空则继承任务组公共描述）...'
                : '输入任务详细需求背景、提示词或规格说明...'
            }
            className="w-full p-2.5 rounded-[6px] border border-[#4f46e5] ring-2 ring-[#4f46e5]/10 bg-white text-[#1c1c21] text-[12px] leading-relaxed resize-y min-h-[110px] max-h-[300px] font-normal focus:outline-none transition-all"
          />
          <div className="flex items-center justify-between text-[10.5px] text-[#85858d] px-0.5 select-none">
            <span className="flex items-center gap-1 text-[#85858d]">
              <span>快捷键：</span>
              <kbd className="font-mono bg-[#f4f4f6] px-1 py-0.5 rounded border border-[#e3e3e8] text-[9.5px]">
                ⌘ + Enter
              </kbd>
              <span>保存</span>
              <span className="mx-0.5">·</span>
              <kbd className="font-mono bg-[#f4f4f6] px-1 py-0.5 rounded border border-[#e3e3e8] text-[9.5px]">
                Esc
              </kbd>
              <span>取消</span>
            </span>
            <span className="font-mono text-[#a1a1aa]">{draft.length} 字符</span>
          </div>
        </div>
      )}

      {/* 图片附件画廊 */}
      {task.attachments && task.attachments.length > 0 && (
        <div className="pt-1 flex items-center gap-2 overflow-x-auto py-1 scrollbar-thin">
          {task.attachments.map((att) => {
            const displayUrl = api.getAttachmentUrl(att.url);
            return (
              <div
                key={att.id}
                onClick={() => {
                  if (import.meta.env?.DEV) {
                    console.log('[TaskDescriptionCard] 预览附件图片:', att.name);
                  }
                  onPreviewImage?.(att, task.attachments || []);
                }}
                className="group relative w-[52px] h-[52px] shrink-0 rounded-[6px] border border-[#e3e3e8] bg-white overflow-hidden shadow-sm hover:border-[#4f46e5] cursor-pointer transition-all"
                title={`${att.name}\n${(att.size / 1024).toFixed(0)} KB\n点击大图预览`}
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
  );
};
