/**
 * @ 引用 chip：编辑器里的原子节点。
 * 节点自身携带展示用的 label 与剪贴板投影 clipboardText，
 * 所以原生复制、草稿持久化都不需要额外展开代码。
 */
import React from 'react';
import { DecoratorNode } from 'lexical';
import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import { IconFile, IconFolderClose, IconNewChat } from '../icons';
import styles from './composer-editor.module.css';

export type ReferenceAppearance = 'file' | 'folder' | 'session';

/** 一次引用插入的完整信息 */
export interface ReferenceInsert {
  /** 文件/目录的工作区相对路径（目录带结尾斜杠），会话的会话 id */
  ref: string;
  /** 行内展示的名字 */
  label: string;
  appearance: ReferenceAppearance;
  /** 剪贴板与草稿里的文本形式：文件目录是 `@path`，会话是 `@[标题](openloop-session:<id>)` */
  clipboardText: string;
}

export type SerializedReferenceChipNode = Spread<
  {
    ref: string;
    label: string;
    appearance: ReferenceAppearance;
    clipboardText: string;
  },
  SerializedLexicalNode
>;

/** 一个内联引用：整体可删、不可被光标切进内部 */
export class ReferenceChipNode extends DecoratorNode<React.JSX.Element> {
  __ref: string;
  __label: string;
  __appearance: ReferenceAppearance;
  __clipboardText: string;

  static override getType(): string {
    return 'reference-chip';
  }

  static override clone(node: ReferenceChipNode): ReferenceChipNode {
    return new ReferenceChipNode(
      {
        ref: node.__ref,
        label: node.__label,
        appearance: node.__appearance,
        clipboardText: node.__clipboardText,
      },
      node.__key
    );
  }

  static override importJSON(json: SerializedReferenceChipNode): ReferenceChipNode {
    return new ReferenceChipNode({
      ref: json.ref,
      label: json.label,
      appearance: json.appearance,
      clipboardText: json.clipboardText,
    });
  }

  constructor(insert: ReferenceInsert, key?: NodeKey) {
    super(key);
    this.__ref = insert.ref;
    this.__label = insert.label;
    this.__appearance = insert.appearance;
    this.__clipboardText = insert.clipboardText;
  }

  override exportJSON(): SerializedReferenceChipNode {
    return {
      ...super.exportJSON(),
      type: 'reference-chip',
      version: 1,
      ref: this.__ref,
      label: this.__label,
      appearance: this.__appearance,
      clipboardText: this.__clipboardText,
    };
  }

  /** 挂载不可编辑的宿主 span，React 面渲染进这里 */
  override createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span');
    element.setAttribute('data-composer-chip', 'reference');
    element.setAttribute('contenteditable', 'false');
    return element;
  }

  override updateDOM(): boolean {
    return false;
  }

  override isInline(): boolean {
    return true;
  }

  /** 光标一步跨过 chip，退格整块删除，不出现中间的节点选中态 */
  override isKeyboardSelectable(): boolean {
    return false;
  }

  /** 剪贴板 / 草稿投影 */
  override getTextContent(): string {
    return this.__clipboardText;
  }

  override decorate(): React.JSX.Element {
    return <ReferenceChip label={this.__label} appearance={this.__appearance} />;
  }
}

export function $createReferenceChipNode(insert: ReferenceInsert): ReferenceChipNode {
  return new ReferenceChipNode(insert);
}

export function $isReferenceChipNode(node: LexicalNode | null | undefined): node is ReferenceChipNode {
  return node instanceof ReferenceChipNode;
}

/** chip 的视觉本体：图标 + 名字，跟随正文基线 */
function ReferenceChip({ label, appearance }: { label: string; appearance: ReferenceAppearance }) {
  const Icon =
    appearance === 'session' ? IconNewChat : appearance === 'folder' ? IconFolderClose : IconFile;
  return (
    <span className={styles.chip} title={label}>
      <Icon size={14} className={styles.chipIcon} />
      <span className={styles.chipLabel}>{label}</span>
    </span>
  );
}
