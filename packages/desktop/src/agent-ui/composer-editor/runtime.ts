/**
 * 输入框的编辑器内核：一个自持的 Lexical 实例。
 * 只保留纯文本 + 引用 chip：没有引号块、命令 chip、装饰词表，
 * 时间线外的东西一律不注册。
 */
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  HISTORY_MERGE_TAG,
} from 'lexical';
import type { LexicalEditor } from 'lexical';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerPlainText } from '@lexical/plain-text';
import { mergeRegister } from '@lexical/utils';
import { splitMentions } from '../mentions';
import type { DetectSpan } from './span-map';
import { $replaceDetectSpanWithNodes, $replaceDetectSpanWithText } from './span-map';
import type { EditorProjection } from './projection';
import { $composerLayout, $projectComposer } from './projection';
import type { ReferenceInsert } from './ReferenceChipNode';
import { $createReferenceChipNode, ReferenceChipNode } from './ReferenceChipNode';

/** 连续输入的撤销合并窗口，和 dsh 一致 */
const HISTORY_MERGE_DELAY_MS = 1000;

export interface ComposerEditorDeps {
  /** 每次编辑器提交后回调，调用方在这里取投影 */
  onUpdate: () => void;
}

/** 一个 Composer 一个实例，随组件卸载释放 */
export class ComposerEditorRuntime {
  readonly editor: LexicalEditor;
  private projected: EditorProjection = {
    detectText: '',
    clipboardText: '',
    selection: null,
    caret: null,
  };

  constructor(private readonly deps: ComposerEditorDeps) {
    this.editor = createEditor({
      namespace: 'openloop-composer',
      nodes: [ReferenceChipNode],
      onError: (error) => {
        throw error;
      },
    });
  }

  /** 安装编辑器行为，返回解绑函数 */
  register(): () => void {
    const unregister = mergeRegister(
      registerPlainText(this.editor),
      registerHistory(this.editor, createEmptyHistoryState(), HISTORY_MERGE_DELAY_MS),
      this.editor.registerUpdateListener(() => {
        this.refreshProjection();
        this.deps.onUpdate();
      })
    );
    return () => {
      unregister();
      this.editor.setRootElement(null);
    };
  }

  get projection(): EditorProjection {
    return this.projected;
  }

  refreshProjection(): void {
    this.projected = this.editor.getEditorState().read(() => $projectComposer());
  }

  /** 当前选区范围；没有选区时给文档末尾的空范围 */
  caretSpan(): DetectSpan {
    if (this.projected.selection !== null) return this.projected.selection;
    const at = this.projected.detectText.length;
    return { start: at, end: at };
  }

  /** 整体换掉草稿：`@path` 片段还原成 chip，光标落在末尾 */
  setDraft(text: string): void {
    if (text === this.projected.clipboardText) return;
    this.editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        let paragraph = $createParagraphNode();
        root.append(paragraph);
        for (const run of splitMentions(text)) {
          if (run.type === 'ref') {
            paragraph.append(
              $createReferenceChipNode({
                ref: run.ref.path,
                label: run.ref.label,
                appearance: run.ref.kind,
                clipboardText: run.ref.raw,
              })
            );
            continue;
          }
          const lines = run.text.split('\n');
          lines.forEach((line, index) => {
            if (index > 0) {
              paragraph = $createParagraphNode();
              root.append(paragraph);
            }
            if (line !== '') paragraph.append($createTextNode(line));
          });
        }
        root.selectEnd();
      },
      { discrete: true, tag: HISTORY_MERGE_TAG }
    );
  }

  /** 用文本替换一个 detect 范围 */
  replaceText(span: DetectSpan, text: string): boolean {
    let applied = false;
    this.editor.update(
      () => {
        applied = $replaceDetectSpanWithText(span, text);
      },
      { discrete: true }
    );
    return applied;
  }

  /**
   * 用 chip 替换一个 detect 范围。
   * 替换前紧跟范围的字符如果是空格就不再补尾随空格。
   * @param span 被替换的 token 范围
   * @param ref 引用信息
   */
  insertReference(span: DetectSpan, ref: ReferenceInsert): boolean {
    let applied = false;
    this.editor.update(
      () => {
        const tail = $composerLayout().detectText.charAt(span.end);
        const nodes =
          tail === ' '
            ? [$createReferenceChipNode(ref)]
            : [$createReferenceChipNode(ref), $createTextNode(' ')];
        applied = $replaceDetectSpanWithNodes(span, nodes);
      },
      { discrete: true }
    );
    return applied;
  }

  /** 清空草稿（发送之后） */
  clear(): void {
    this.editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.selectEnd();
      },
      { discrete: true }
    );
  }

  focus(): void {
    this.editor.getRootElement()?.focus({ preventScroll: true });
  }
}
