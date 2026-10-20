import type { WorkflowTaskTemplate } from '@openloop/core';

/**
 * 清理与归一化工作流关联的任务模板，去除纯空字段；全空时返回 undefined
 */
export function cleanTaskTemplate(tpl?: WorkflowTaskTemplate): WorkflowTaskTemplate | undefined {
  if (!tpl) return undefined;
  const titlePlaceholder = tpl.titlePlaceholder?.trim() || undefined;
  const descriptionTemplate = tpl.descriptionTemplate?.trim() ? tpl.descriptionTemplate : undefined;
  const acceptanceTemplate = tpl.acceptanceTemplate?.trim() ? tpl.acceptanceTemplate : undefined;
  if (!titlePlaceholder && !descriptionTemplate && !acceptanceTemplate) {
    return undefined;
  }
  return {
    ...(titlePlaceholder ? { titlePlaceholder } : {}),
    ...(descriptionTemplate ? { descriptionTemplate } : {}),
    ...(acceptanceTemplate ? { acceptanceTemplate } : {}),
  };
}
