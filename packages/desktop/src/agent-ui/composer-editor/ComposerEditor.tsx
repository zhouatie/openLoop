/**
 * 输入框的编辑区宿主：绑定 Lexical 编辑器，并把编辑操作暴露成命令式句柄。
 * 组件自身只管挂载与可编辑态，文本状态由调用方从投影里取。
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { EditorProjection } from './projection';
import type { DetectSpan } from './span-map';
import type { ReferenceInsert } from './ReferenceChipNode';
import { ComposerEditorRuntime } from './runtime';
import { DecoratorPortals } from './DecoratorPortals';
import styles from './composer-editor.module.css';

export interface ComposerEditorHandle {
  focus: () => void;
  setDraft: (text: string) => void;
  clear: () => void;
  caretSpan: () => DetectSpan;
  replaceText: (span: DetectSpan, text: string) => void;
  /** 用引用 chip 替换一段 token */
  insertReference: (span: DetectSpan, ref: ReferenceInsert) => void;
}

export interface ComposerEditorProps {
  /** 每次内容或光标变化后回调，参数是当前投影 */
  onUpdate: (projection: EditorProjection) => void;
  onKeyDownCapture?: React.KeyboardEventHandler<HTMLDivElement>;
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  placeholder?: string;
  disabled?: boolean;
}

/** 输入区：contentEditable 宿主 + 全屏宽度自适应高度 */
export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  function ComposerEditor({ onUpdate, onKeyDownCapture, onPaste, onFocus, placeholder, disabled }, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const updateRef = useRef(onUpdate);
    updateRef.current = onUpdate;
    const [empty, setEmpty] = useState(true);

    const runtimeRef = useRef<ComposerEditorRuntime | null>(null);
    if (runtimeRef.current === null) {
      runtimeRef.current = new ComposerEditorRuntime({
        onUpdate: () => {
          const runtime = runtimeRef.current;
          if (runtime === null) return;
          const projection = runtime.projection;
          setEmpty(projection.clipboardText.length === 0);
          updateRef.current(projection);
        },
      });
    }
    const runtime = runtimeRef.current;

    useLayoutEffect(() => {
      const element = rootRef.current;
      if (element === null) return;
      runtime.editor.setRootElement(element);
      const unregister = runtime.register();
      return () => {
        unregister();
      };
    }, [runtime]);

    useEffect(() => {
      runtime.editor.setEditable(!disabled);
    }, [runtime, disabled]);

    const focus = useCallback(() => {
      runtime.focus();
    }, [runtime]);

    useImperativeHandle(
      ref,
      () => ({
        focus,
        setDraft: (text: string) => runtime.setDraft(text),
        clear: () => runtime.clear(),
        caretSpan: () => runtime.caretSpan(),
        replaceText: (span: DetectSpan, text: string) => {
          runtime.replaceText(span, text);
          focus();
        },
        insertReference: (span: DetectSpan, reference: ReferenceInsert) => {
          runtime.insertReference(span, reference);
          focus();
        },
      }),
      [runtime, focus]
    );

    return (
      <>
        <div
          ref={rootRef}
          className={styles.editor}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          aria-disabled={disabled || undefined}
          data-empty={empty ? 'true' : 'false'}
          data-placeholder={placeholder || '描述你想要构建的内容，/ 调用指令，@ 引用文件'}
          spellCheck={false}
          onKeyDownCapture={onKeyDownCapture}
          onPaste={onPaste}
          onFocus={onFocus}
        />
        <DecoratorPortals editor={runtime.editor} />
      </>
    );
  }
);
