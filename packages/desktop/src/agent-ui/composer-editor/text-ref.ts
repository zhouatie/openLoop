/**
 * 草稿里的纯文本引用 token：保持普通文本语义，只套引用色。
 * 规则与 dsh 的 scanTextRefs 一致：
 * - `/name`：name 命中斜杠词表（指令 / 技能名），且 token 后面是空白或草稿结尾；
 * - `@dir/`：以斜杠结尾的 @ 路径，引号写法沿用 dsh 的 `@"dir/"`。
 * Tab 下钻后草稿里留下的正是 `@dir/`，这条文本实体就是它变蓝的来源；
 * 名字改到词表外或把结尾斜杠删掉后 token 不再成立，实体退回普通文本。
 */
import type { EditorConfig, LexicalEditor, SerializedTextNode } from 'lexical';
import { $createTextNode, $getRoot, HISTORY_MERGE_TAG, TextNode } from 'lexical';
import styles from './composer-editor.module.css';

/** `/name`：斜杠在行首或空白之后，名字是普通词字符 */
const NAMED_SLASH = /(^|\s)\/([\w-]+)/gu;
/** 以斜杠结尾的 @ 路径，不带前导空白 */
const FOLDER = /(^|\s)(@(?:"[^"\n]*\/|[^\s"]+\/))/gu;
/** `/name` 之后只能是空白或草稿结尾：`/plan/x` 是路径，`/plan。` 是正文 */
const TOKEN_END = /^(?:\s|$)/u;

/** token 在文本里的范围，不含前导空白 */
interface TextRefRange {
  start: number;
  end: number;
}

/** 一段文本里最靠前的引用 token：词表与文本每次编辑后重算 */
function firstTextRef(text: string, names: ReadonlySet<string>): TextRefRange | null {
  const ranges: TextRefRange[] = [];
  for (const match of text.matchAll(NAMED_SLASH)) {
    const name = match[2] ?? '';
    const start = (match.index ?? 0) + match[1].length;
    const end = start + 1 + name.length;
    if (!names.has(name) || !TOKEN_END.test(text.slice(end))) continue;
    ranges.push({ start, end });
  }
  for (const match of text.matchAll(FOLDER)) {
    const token = match[2] ?? '';
    const start = (match.index ?? 0) + match[1].length;
    const end = start + token.length;
    if (ranges.some((range) => range.start < end && range.end > start)) continue;
    ranges.push({ start, end });
  }
  return ranges.sort((left, right) => left.start - right.start)[0] ?? null;
}

/** 引用 token 的文本实体：样式与引用 chip 同色 */
export class TextRefNode extends TextNode {
  static override getType(): string {
    return 'composer-text-ref';
  }

  static override clone(node: TextRefNode): TextRefNode {
    return new TextRefNode(node.__text, node.__key);
  }

  static override importJSON(json: SerializedTextNode): TextRefNode {
    const node = new TextRefNode(json.text);
    node.setFormat(json.format);
    node.setDetail(json.detail);
    node.setMode(json.mode);
    node.setStyle(json.style);
    return node;
  }

  override exportJSON(): SerializedTextNode {
    return { ...super.exportJSON(), type: 'composer-text-ref' };
  }

  override createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.classList.add(styles.textRef);
    return element;
  }

  /** 编辑继续在 token 里进行，变换按最新文本重新判断 */
  override isTextEntity(): true {
    return true;
  }
}

function $createTextRefNode(text: string): TextRefNode {
  return new TextRefNode(text);
}

/**
 * 把普通文本里的第一个引用 token 拆成文本实体；token 失效时整块退回普通文本。
 * @param editor - 输入框编辑器
 * @param names - 斜杠词表的实时读取（词表后到，所以取函数而不是快照）
 */
export function registerTextRefs(
  editor: LexicalEditor,
  names: () => ReadonlySet<string>
): () => void {
  const unregisterText = editor.registerNodeTransform(TextNode, (node) => {
    if (!node.isSimpleText()) return;
    const match = firstTextRef(node.getTextContent(), names());
    if (match === null) return;
    // splitText 会同步选区，token 两侧的文字各留在一个节点里
    const parts =
      match.start === 0 ? node.splitText(match.end) : node.splitText(match.start, match.end);
    const token = parts[match.start === 0 ? 0 : 1];
    if (token === undefined) return;
    token.replace($createTextRefNode(token.getTextContent()));
  });

  const unregisterRef = editor.registerNodeTransform(TextRefNode, (node) => {
    const text = node.getTextContent();
    const match = firstTextRef(text, names());
    if (match !== null && match.start === 0 && match.end === text.length) return;
    // 例如在结尾继续输入把名字改坏：退回普通文本后，剩下的 token 前缀会被重新识别
    node.replace($createTextNode(text));
  });

  return () => {
    unregisterText();
    unregisterRef();
  };
}

/** 词表变化后重扫全文：节点变换只访问脏节点，词表本身不弄脏任何节点 */
export function rescanTextRefs(editor: LexicalEditor): void {
  editor.update(
    () => {
      for (const node of $getRoot().getAllTextNodes()) node.markDirty();
    },
    { tag: HISTORY_MERGE_TAG }
  );
}
