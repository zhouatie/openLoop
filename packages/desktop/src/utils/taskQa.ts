import type { Task } from '@openloop/core';

/** 读取任务当前生效的验收用例（人工预设优先，其次 AI 规划结果） */
export function readTaskQaSteps(task: Task): string[] {
  const preset = task.context?.qaInstructions;
  if (Array.isArray(preset) && preset.length > 0) return preset.map((s) => String(s));
  const planned = task.context?.qaPlan?.steps;
  if (Array.isArray(planned) && planned.length > 0) return planned.map((s) => String(s));
  return [];
}
