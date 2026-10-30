/**
 * detect 坐标 → Lexical 点位 → 就地替换。
 * 所有 token 替换（选候选、下钻、面包屑）都走这里，调用方不必知道节点结构。
 * 必须在 `editor.update()` 内执行。
 */
import type { LexicalNode, RangeSelection } from 'lexical';
import { $createRangeSelection, $getRoot, $setSelection } from 'lexical';
import type { ComposerLayout } from './projection';
import { $composerLayout } from './projection';

/** detect 坐标下的半开区间 [start, end) */
export interface DetectSpan {
  start: number;
  end: number;
}

interface ResolvedPoint {
  key: string;
  offset: number;
  type: 'text' | 'element';
}

/**
 * 把 detect 偏移解析成选区端点。
 * 原子片段（chip、换行）解析到它旁边的元素点位，所以范围只能整块覆盖 chip；
 * 文档末尾落到最后一个块。
 */
function resolvePoint(layout: ComposerLayout, offset: number): ResolvedPoint | null {
  if (offset < 0 || offset > layout.detectLength) return null;
  for (const segment of layout.segments) {
    if (offset >= segment.detectStart + segment.detectLength) continue;
    if (segment.kind === 'text' && segment.node !== null) {
      return { key: segment.node.getKey(), offset: offset - segment.detectStart, type: 'text' };
    }
    if (segment.kind === 'gap' && segment.gapBetween !== undefined) {
      const before = segment.gapBetween.before;
      return { key: before, offset: layout.children.get(before)?.length ?? 0, type: 'element' };
    }
    if (segment.node === null) return null;
    const element = segment.node.getParent();
    if (element === null) return null;
    return {
      key: element.getKey(),
      offset: segment.node.getIndexWithinParent(),
      type: 'element',
    };
  }
  const blocks = $getRoot().getChildren();
  const last = blocks[blocks.length - 1];
  if (last === undefined) return { key: $getRoot().getKey(), offset: 0, type: 'element' };
  return { key: last.getKey(), offset: layout.children.get(last.getKey())?.length ?? 0, type: 'element' };
}

function selectSpan(layout: ComposerLayout, span: DetectSpan): RangeSelection | null {
  if (span.start < 0 || span.start > span.end || span.end > layout.detectLength) return null;
  const anchor = resolvePoint(layout, span.start);
  const focus = resolvePoint(layout, span.end);
  if (anchor === null || focus === null) return null;
  const selection = $createRangeSelection();
  selection.anchor.set(anchor.key, anchor.offset, anchor.type);
  selection.focus.set(focus.key, focus.offset, focus.type);
  $setSelection(selection);
  return selection;
}

/** 选中一个 detect 范围（空范围即定位光标） */
export function $selectDetectSpan(span: DetectSpan): boolean {
  return selectSpan($composerLayout(), span) !== null;
}

/** 用纯文本替换一个 detect 范围，光标落在插入内容之后 */
export function $replaceDetectSpanWithText(span: DetectSpan, text: string): boolean {
  const selection = selectSpan($composerLayout(), span);
  if (selection === null) return false;
  if (text === '' && !selection.isCollapsed()) selection.removeText();
  else selection.insertText(text);
  return true;
}

/** 用节点替换一个 detect 范围（chip 插入路径） */
export function $replaceDetectSpanWithNodes(
  span: DetectSpan,
  nodes: readonly LexicalNode[]
): boolean {
  const selection = selectSpan($composerLayout(), span);
  if (selection === null) return false;
  selection.insertNodes([...nodes]);
  return true;
}
