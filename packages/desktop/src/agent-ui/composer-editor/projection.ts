/**
 * 编辑器文档 → 文本投影。
 * detect 文本是菜单检测与 token 范围使用的坐标：每个 chip 只占一个 U+FFFC，
 * 这样光标位置与文本下标一一对应；clipboard 文本是草稿与发送使用的形式，
 * chip 展开成 `@path`。
 */
import type { ElementNode, LexicalNode, NodeKey, Point } from 'lexical';
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
} from 'lexical';
import { $isReferenceChipNode } from './ReferenceChipNode';

/** chip 在 detect 投影里的替身字符 */
export const ATOMIC_CHAR = '\uFFFC';

export interface ComposerSegment {
  kind: 'text' | 'chip' | 'linebreak' | 'gap';
  node: LexicalNode | null;
  detectStart: number;
  detectLength: number;
  clipboardStart: number;
  clipboardLength: number;
  /** gap 专用：被换行分开的两个块 */
  gapBetween?: { before: NodeKey; after: NodeKey };
}

export interface ComposerLayout {
  segments: ComposerSegment[];
  detectLength: number;
  detectText: string;
  clipboardText: string;
  byKey: Map<NodeKey, ComposerSegment>;
  children: Map<NodeKey, NodeKey[]>;
  bounds: Map<NodeKey, { start: number; end: number }>;
}

export interface EditorProjection {
  /** 菜单检测与 token 坐标使用的文本（chip = U+FFFC） */
  detectText: string;
  /** 草稿与发送使用的文本（chip = `@path`） */
  clipboardText: string;
  /** detect 坐标下的选区 */
  selection: { start: number; end: number } | null;
  /** detect 坐标下的光标位置；有选区范围时为 null */
  caret: number | null;
}

/**
 * 按文档顺序走一遍，产出三种文本视图与坐标映射。
 * 块之间贡献一个换行，和纯文本编辑器的行语义一致。
 */
export function $composerLayout(): ComposerLayout {
  const segments: ComposerSegment[] = [];
  const byKey = new Map<NodeKey, ComposerSegment>();
  const children = new Map<NodeKey, NodeKey[]>();
  const bounds = new Map<NodeKey, { start: number; end: number }>();
  let detect = '';
  let clipboard = '';

  const pushLeaf = (
    kind: 'text' | 'chip' | 'linebreak',
    node: LexicalNode,
    detectPiece: string,
    clipboardPiece: string
  ): void => {
    const segment: ComposerSegment = {
      kind,
      node,
      detectStart: detect.length,
      detectLength: detectPiece.length,
      clipboardStart: clipboard.length,
      clipboardLength: clipboardPiece.length,
    };
    segments.push(segment);
    byKey.set(node.getKey(), segment);
    detect += detectPiece;
    clipboard += clipboardPiece;
  };

  const walkElement = (element: ElementNode): void => {
    const start = detect.length;
    const kids = element.getChildren();
    children.set(
      element.getKey(),
      kids.map((kid) => kid.getKey())
    );
    for (const kid of kids) {
      if ($isReferenceChipNode(kid)) {
        pushLeaf('chip', kid, ATOMIC_CHAR, kid.getTextContent());
      } else if ($isTextNode(kid)) {
        const text = kid.getTextContent();
        pushLeaf('text', kid, text, text);
      } else if ($isLineBreakNode(kid)) {
        pushLeaf('linebreak', kid, '\n', '\n');
      } else if ($isElementNode(kid)) {
        walkElement(kid);
      }
    }
    bounds.set(element.getKey(), { start, end: detect.length });
  };

  const root = $getRoot();
  const blocks = root.getChildren();
  children.set(
    root.getKey(),
    blocks.map((block) => block.getKey())
  );
  const rootStart = detect.length;
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    if (index > 0 && previous !== undefined) {
      segments.push({
        kind: 'gap',
        node: null,
        detectStart: detect.length,
        detectLength: 1,
        clipboardStart: clipboard.length,
        clipboardLength: 1,
        gapBetween: { before: previous.getKey(), after: block.getKey() },
      });
      detect += '\n';
      clipboard += '\n';
    }
    if ($isElementNode(block)) walkElement(block);
  });
  bounds.set(root.getKey(), { start: rootStart, end: detect.length });

  return {
    segments,
    detectLength: detect.length,
    detectText: detect,
    clipboardText: clipboard,
    byKey,
    children,
    bounds,
  };
}

/** 把一个选区端点折成 detect 坐标 */
export function $detectOffsetOfPoint(layout: ComposerLayout, point: Point): number | null {
  if (point.type === 'text') {
    const segment = layout.byKey.get(point.key);
    return segment === undefined ? null : segment.detectStart + Math.min(point.offset, segment.detectLength);
  }
  const kids = layout.children.get(point.key);
  const elementBounds = layout.bounds.get(point.key);
  if (kids === undefined || elementBounds === undefined) return null;
  if (point.offset >= kids.length) return elementBounds.end;
  const childKey = kids[point.offset];
  if (childKey === undefined) return elementBounds.end;
  const childSegment = layout.byKey.get(childKey);
  if (childSegment !== undefined) return childSegment.detectStart;
  const childBounds = layout.bounds.get(childKey);
  return childBounds === undefined ? null : childBounds.start;
}

/** 投影当前文档与光标 */
export function $projectComposer(): EditorProjection {
  const layout = $composerLayout();
  const selection = $getSelection();
  let range: { start: number; end: number } | null = null;
  if ($isRangeSelection(selection)) {
    const anchor = $detectOffsetOfPoint(layout, selection.anchor);
    const focus = $detectOffsetOfPoint(layout, selection.focus);
    if (anchor !== null && focus !== null) {
      range = { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
    }
  }
  return {
    detectText: layout.detectText,
    clipboardText: layout.clipboardText,
    selection: range,
    caret: range !== null && range.start === range.end ? range.start : null,
  };
}
