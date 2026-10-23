import type { SessionChatMessage, Task } from '../types';

/**
 * 任务摘要投影
 *
 * 看板初始化与实时推送只需要「任务摘要」，而 `context.chatMessages`（Agent 全量会话）
 * 与 `context.worktree.diffResult`（逐文件 Diff 明细）体积可达数十 MB，看板并不需要：
 * 会话按需从 /api/tasks/:id/session 拉取，Diff 由验收弹窗即时查询。
 *
 * 因此读写两侧统一走投影：
 * - 列表查询在 SQLite 侧剔除（见 SqliteStore.getTaskSummaries）
 * - 实时事件与接口回包在 JS 侧剔除（见 toTaskSummary），并顺带派生卡片所需的轻量标记
 */

// 会写入文件的 Agent 工具（命中即视为已产生代码改动）
const CODE_EDIT_TOOL_NAMES = ['edit', 'write', 'patch'];

/** 会话中是否已产生代码改动：执行中卡片据此提示「待确认放行」 */
export function hasCodeChange(messages?: SessionChatMessage[]): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some(
    (msg) =>
      Array.isArray(msg.tools) &&
      msg.tools.some((tool) => CODE_EDIT_TOOL_NAMES.includes(tool.name) && tool.status !== 'error')
  );
}

/** 最后一条 Agent 回复内容：快捷运行弹窗据此展示中止原因 */
export function lastAssistantContent(messages?: SessionChatMessage[]): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  const last = messages.filter((msg) => msg.role === 'assistant' && (msg.content || msg.errorMessage)).pop();
  return last?.content || last?.errorMessage;
}

/**
 * 剔除体积巨大的会话与 Diff 明细，派生看板所需的轻量标记。
 * 幂等：对已投影的摘要重复调用不会丢失派生标记。
 */
export function toTaskSummary(task: Task): Task {
  if (!task.context) return task; // 删除等轻量事件本身已是摘要

  const { chatMessages, worktree, ...restContext } = task.context as Record<string, any>;
  const context: Record<string, any> = { ...restContext };

  if (worktree && typeof worktree === 'object') {
    const { diffResult, ...worktreeSummary } = worktree;
    context.worktree = worktreeSummary;
  }

  if (task.status === 'running' && context.hasCodeChanges === undefined) {
    context.hasCodeChanges = hasCodeChange(chatMessages);
  }
  if (task.status === 'failed' || task.status === 'cancelled') {
    context.lastAssistantMessage = lastAssistantContent(chatMessages) ?? context.lastAssistantMessage;
  }

  return { ...task, context };
}
