import type { ToolExecutionRecord } from '@openloop/core/types';
import type { DiffHunk } from './dsh/DiffBlock';

/** 本轮改动的一个文件 */
export interface ChangedFile {
  path: string;
  added: number;
  deleted: number;
  /** 服务端的改动标识：取得到时点行打开 diff 页签 */
  changeId?: string;
}

/** 一轮的改动汇总：卡片直接渲染 */
export interface TurnChanges {
  files: ChangedFile[];
  added: number;
  deleted: number;
}

/** 单工具的改动（与工具卡共用）：edit 的 edits[] 与 write 的整份 content */
export type MutationHunk = DiffHunk;

/** 从工具入参里按优先级取第一个非空字符串 */
function pickStringOf(source: any, keys: string[]): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/**
 * 写入类工具的逐处改动。
 * pi 的 edit 工具把改动放在 edits[] 里，write 工具则是整份 content。
 * 取原始入参：实时事件的 input 会被截断到 500 字符，args 才是完整内容。
 */
export function mutationHunks(tool: ToolExecutionRecord): MutationHunk[] | null {
  const input = tool.args ?? tool.input ?? {};
  const path = pickStringOf(input, ['path', 'file_path', 'filePath', 'target']) || '';
  const hunks: MutationHunk[] = [];
  const edits = Array.isArray(input.edits) ? input.edits : [];
  for (const edit of edits) {
    const after = pickStringOf(edit, ['newText', 'newString', 'new_text']);
    if (after === undefined) continue;
    const before = pickStringOf(edit, ['oldText', 'oldString', 'old_text']);
    hunks.push({ path, oldText: before ?? null, newText: after });
  }
  if (hunks.length === 0) {
    const after = pickStringOf(input, ['content', 'newString', 'newText', 'after', 'text']);
    if (after !== undefined) {
      const before = pickStringOf(input, ['oldString', 'oldText', 'before']);
      hunks.push({ path, oldText: before ?? null, newText: after });
    }
  }
  return hunks.length > 0 ? hunks : null;
}

/** 文本行数：末尾换行不额外算一行，空文本为 0 行 */
function lineCount(text: string | null | undefined): number {
  if (!text) return 0;
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body === '' ? 0 : body.split('\n').length;
}

/**
 * 单次工具调用给本轮带来的改动。
 * 只认成功写入的文件工具；命令创建的、或整份覆盖已有文件的增删无法从入参还原，按 write 的语义记为新增。
 * 每个工具对象只算一次：流式期间消息对象每帧都换，工具对象只在结果落地时换。
 */
const cache = new WeakMap<ToolExecutionRecord, ChangedFile | null>();

export function toolChange(tool: ToolExecutionRecord): ChangedFile | null {
  const cached = cache.get(tool);
  if (cached !== undefined) return cached;
  const change = computeChange(tool);
  cache.set(tool, change);
  return change;
}

function computeChange(tool: ToolExecutionRecord): ChangedFile | null {
  if (tool.kind !== 'write' || tool.status !== 'success') return null;
  const hunks = mutationHunks(tool);
  if (!hunks) return null;
  const path = hunks[0].path.replace(/^\.\//, '');
  if (!path) return null;
  let added = 0;
  let deleted = 0;
  for (const hunk of hunks) {
    added += lineCount(hunk.newText);
    deleted += lineCount(hunk.oldText);
  }
  return added === 0 && deleted === 0 ? null : { path, added, deleted, changeId: tool.changeId };
}
