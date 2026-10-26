import React, { useEffect, useState } from 'react';
import {
  Target,
  Edit3,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Check,
  X,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { Task } from '@openloop/core';
import { api } from '../../services/api';
import { toast } from '../Toast';

interface TaskQaInstructionsCardProps {
  task: Task;
  onTaskUpdated?: (task: Task) => void;
}

/** 读取任务当前生效的验收用例（人工预设优先，其次 AI 规划结果） */
function readSteps(task: Task): string[] {
  const preset = task.context?.qaInstructions;
  if (Array.isArray(preset) && preset.length > 0) return preset.map((s) => String(s));
  const planned = task.context?.qaPlan?.steps;
  if (Array.isArray(planned) && planned.length > 0) return planned.map((s) => String(s));
  return [];
}

export const TaskQaInstructionsCard: React.FC<TaskQaInstructionsCardProps> = ({
  task,
  onTaskUpdated,
}) => {
  const [steps, setSteps] = useState<string[]>(() => readSteps(task));
  const [draft, setDraft] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // 任务在外部被刷新时同步只读列表（编辑中不打断用户输入）
  useEffect(() => {
    if (isEditing) return;
    setSteps(readSteps(task));
  }, [task, isEditing]);

  const startEditing = () => {
    setDraft(steps.length > 0 ? [...steps] : ['']);
    setIsEditing(true);
    if (import.meta.env?.DEV) {
      console.log('[TaskQaInstructionsCard] 开始编辑验收用例:', { taskId: task.id, steps });
    }
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setDraft([]);
    if (import.meta.env?.DEV) {
      console.log('[TaskQaInstructionsCard] 放弃编辑验收用例:', task.id);
    }
  };

  const handleUpdateStep = (index: number, text: string) => {
    setDraft((prev) => prev.map((s, i) => (i === index ? text : s)));
  };

  const handleAddStep = () => {
    setDraft((prev) => [...prev, '']);
    if (import.meta.env?.DEV) {
      console.log('[TaskQaInstructionsCard] 新增一条验收用例:', task.id);
    }
  };

  const handleRemoveStep = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
    if (import.meta.env?.DEV) {
      console.log('[TaskQaInstructionsCard] 删除验收用例:', { taskId: task.id, index });
    }
  };

  const handleMoveStep = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= draft.length) return;
    setDraft((prev) => {
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
    if (import.meta.env?.DEV) {
      console.log('[TaskQaInstructionsCard] 调整验收用例顺序:', { taskId: task.id, from: index, to: targetIndex });
    }
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    if (import.meta.env?.DEV) {
      console.log('[TaskQaInstructionsCard:AI] 重新规划验收用例:', { taskId: task.id, title: task.title });
    }
    try {
      const res = await api.generateQaPlan({
        title: task.title,
        description: task.description || undefined,
        workspace: task.workspace || undefined,
      });
      const nextSteps = (res?.steps || []).map((s) => s.trim()).filter(Boolean);
      if (nextSteps.length > 0) {
        setDraft(nextSteps);
        toast.success(`AI 已重新规划 ${nextSteps.length} 项验收用例，请确认后保存`);
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[TaskQaInstructionsCard:AI] 规划用例异常:', err);
      }
      toast.error('AI 规划用例失败，请稍后重试');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    const cleanList = draft.map((s) => s.trim()).filter(Boolean);
    setIsSaving(true);
    if (import.meta.env?.DEV) {
      console.log('[TaskQaInstructionsCard] 保存验收用例:', { taskId: task.id, steps: cleanList });
    }
    try {
      const updated = await api.updateTask(task.id, {
        qaInstructions: cleanList,
        context: {
          qaInstructions: cleanList,
          qaPlan: {
            role: '用户定制验收用例',
            createdAt: Date.now(),
            steps: cleanList,
          },
        },
      });
      setSteps(cleanList);
      setIsEditing(false);
      setDraft([]);
      onTaskUpdated?.(updated);
      toast.success(cleanList.length > 0 ? '验收用例已更新' : '验收用例已清空');
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[TaskQaInstructionsCard] 保存验收用例失败:', err);
      }
      toast.error(`保存用例失败: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-[8px] border border-[#e3e3e8] bg-white p-3.5 shadow-sm space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#1c1c21] min-w-0">
          <Target size={12} className="text-[#71717a] shrink-0" />
          <span className="shrink-0">验收用例</span>
          {steps.length > 0 && (
            <span className="px-1.5 py-[0.5px] rounded-[3px] bg-[#eeedfd] text-[#4f46e5] text-[9.5px] font-mono font-medium border border-[#d8d6fb] shrink-0">
              {steps.length} 步
            </span>
          )}
        </div>
        {!isEditing && (
          <button
            type="button"
            onClick={startEditing}
            className="h-[22px] px-2 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#eeedfd] text-[#63636b] hover:text-[#4f46e5] hover:border-[#d8d6fb] text-[10.5px] font-medium flex items-center gap-1 transition-all shadow-2xs active:scale-95 cursor-pointer shrink-0"
            title="修改该任务的验收用例，后续执行将按新用例验收"
          >
            <Edit3 size={10.5} />
            <span>{steps.length > 0 ? '编辑用例' : '添加用例'}</span>
          </button>
        )}
      </div>

      {!isEditing ? (
        steps.length > 0 ? (
          <div className="space-y-1">
            {steps.map((step, index) => (
              <div
                key={index}
                className="flex items-start gap-2 px-2 py-1.5 rounded-[6px] border border-[#f1f1f4] bg-[#fafafc]"
              >
                <span className="w-4 h-4 rounded-[3px] bg-[#ececf0] text-[#71717a] text-[9.5px] font-mono font-medium flex items-center justify-center shrink-0 mt-[1px] select-none">
                  {index + 1}
                </span>
                <span className="text-[11.5px] text-[#3f3f46] leading-relaxed break-words select-text">
                  {step}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-2.5 px-3 rounded-[6px] bg-[#fafafc] border border-dashed border-[#e3e3e8] text-center">
            <p className="text-[10.5px] text-[#85858d] leading-relaxed">
              暂无用例；留空将跳过 AI 自动化验证，直接保留现场由人工自测
            </p>
          </div>
        )
      ) : (
        <div className="space-y-1.5">
          {draft.length > 0 ? (
            draft.map((step, index) => (
              <div
                key={index}
                className="flex items-center gap-1.5 group/step bg-[#fafafc] hover:bg-[#f5f5f7] border border-[#e3e3e8] hover:border-[#d1d1d8] rounded-[5px] p-1 pl-1.5 transition-all shadow-3xs"
              >
                <span className="w-4 h-4 rounded-[3px] bg-[#ececf0] text-[#71717a] text-[9.5px] font-mono font-medium flex items-center justify-center shrink-0 select-none">
                  {index + 1}
                </span>
                <input
                  type="text"
                  value={step}
                  onChange={(e) => handleUpdateStep(index, e.target.value)}
                  placeholder={
                    index === 0
                      ? '例如：打开主页面并校验核心指标渲染正常'
                      : '例如：点击提交按钮，校验页面无报错提示'
                  }
                  className="flex-1 h-[25px] bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[4px] px-2 text-[11px] text-[#1c1c21] placeholder-[#85858d] outline-none transition-all shadow-3xs"
                />
                <div className="flex items-center gap-0.5 opacity-60 group-hover/step:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => handleMoveStep(index, -1)}
                    className="w-5 h-5 rounded hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                    title="上移此步"
                  >
                    <ArrowUp size={10.5} />
                  </button>
                  <button
                    type="button"
                    disabled={index === draft.length - 1}
                    onClick={() => handleMoveStep(index, 1)}
                    className="w-5 h-5 rounded hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
                    title="下移此步"
                  >
                    <ArrowDown size={10.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveStep(index)}
                    className="w-5 h-5 rounded hover:bg-[#fee2e2] text-[#85858d] hover:text-[#dc2626] flex items-center justify-center transition-colors cursor-pointer"
                    title="删除此步"
                  >
                    <Trash2 size={10.5} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-2.5 px-3 rounded-[5px] bg-[#fafafc] border border-dashed border-[#e3e3e8] text-center">
              <p className="text-[10.5px] text-[#85858d]">暂无用例；留空保存后运行期由 AI 自动规划</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleAddStep}
            className="w-full h-[26px] rounded-[5px] border border-dashed border-[#d1d1d8] hover:border-[#4f46e5] hover:bg-[#eeedfd]/30 text-[#63636b] hover:text-[#4f46e5] text-[11px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer select-none active:scale-[0.99]"
          >
            <Plus size={11} strokeWidth={2.4} />
            <span>添加验收用例</span>
          </button>

          <div className="flex items-center justify-between gap-1.5 pt-0.5">
            <button
              type="button"
              disabled={isGenerating || !task.title.trim()}
              onClick={handleGenerate}
              className="h-[24px] px-2 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#eeedfd] text-[#63636b] hover:text-[#4f46e5] text-[10.5px] font-medium flex items-center gap-1 transition-all shadow-2xs active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="根据任务标题与说明重新生成用例，替换当前草稿"
            >
              {isGenerating ? (
                <Loader2 size={10} className="animate-spin text-[#4f46e5]" />
              ) : (
                <Sparkles size={10} className="text-[#4f46e5]" />
              )}
              <span>{isGenerating ? 'AI 规划中...' : 'AI 重新规划'}</span>
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isSaving}
                onClick={cancelEditing}
                className="h-[24px] px-2.5 rounded-[4px] text-[#63636b] hover:bg-[#f1f1f4] hover:text-[#1c1c21] text-[11px] transition-colors cursor-pointer disabled:opacity-40"
              >
                <X size={11} className="inline -mt-[1px] mr-0.5" />
                取消
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="h-[24px] px-2.5 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center gap-1 transition-all shadow-2xs active:scale-95 cursor-pointer disabled:opacity-40"
              >
                <Check size={11} strokeWidth={2.4} />
                <span>{isSaving ? '保存中...' : '保存用例'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
