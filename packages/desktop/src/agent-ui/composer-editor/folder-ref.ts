/**
 * 草稿里的目录 token：`@dir/` 保持普通文本语义，但按 dsh 的样式显示成引用色。
 * Tab 下钻后草稿里留下的正是 `@dir/`，这条文本实体就是它变蓝的来源；
 * 把结尾斜杠删掉后 token 不再成立，实体退回普通文本。
 */
import type { EditorConfig, LexicalEditor, SerializedTextNode } from 'lexical';
import { $createTextNode, TextNode } from 'lexical';
import styles from './composer-editor.module.css';

/** 行首或空白之后、以斜杠结尾的 @ 路径；引号写法沿用 dsh 的 `@"dir/"` */
const FOLDER_TOKEN = /(^|\s)(@"[^"\n]*\/|[^\s"]+\/)/u;

/** token 在文本里的范围，不含前导空白 */
interface FolderMatch {
  start: number;
  end: number;
}

function folderToken(text: string): FolderMatch | null {
  const match = FOLDER_TOKEN.exec(text);
  if (match === null) return null;
  const start = match.index + match[1].length;
  return { start, end: start + match[2].length };
}

/** 目录 token 的文本实体：样式与引用 chip 同色 */
export class FolderRefNode extends TextNode {
  static override getType(): string {
    return 'composer-folder-ref';
  }

  static override clone(node: FolderRefNode): FolderRefNode {
    return new FolderRefNode(node.__text, node.__key);
  }

  static override importJSON(json: SerializedTextNode): FolderRefNode {
    const node = new FolderRefNode(json.text);
    node.setFormat(json.format);
    node.setDetail(json.detail);
    node.setMode(json.mode);
    node.setStyle(json.style);
    return node;
  }

  override exportJSON(): SerializedTextNode {
    return { ...super.exportJSON(), type: 'composer-folder-ref' };
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

function $createFolderRefNode(text: string): FolderRefNode {
  return new FolderRefNode(text);
}

/** 把普通文本里的第一个目录 token 拆成文本实体；token 失效时整块退回普通文本 */
export function registerFolderRef(editor: LexicalEditor): () => void {
  const unregisterText = editor.registerNodeTransform(TextNode, (node) => {
    if (!node.isSimpleText()) return;
    const match = folderToken(node.getTextContent());
    if (match === null) return;
    // splitText 会同步选区，token 两侧的文字各留在一个节点里
    const parts =
      match.start === 0 ? node.splitText(match.end) : node.splitText(match.start, match.end);
    const token = parts[match.start === 0 ? 0 : 1];
    if (token === undefined) return;
    token.replace($createFolderRefNode(token.getTextContent()));
  });

  const unregisterFolder = editor.registerNodeTransform(FolderRefNode, (node) => {
    const text = node.getTextContent();
    const match = folderToken(text);
    if (match !== null && match.start === 0 && match.end === text.length) return;
    // 例如在结尾继续输入把斜杠挤掉：退回普通文本后，剩下的 token 前缀会被重新识别
    node.replace($createTextNode(text));
  });

  return () => {
    unregisterText();
    unregisterFolder();
  };
}
