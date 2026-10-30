/**
 * 装饰节点渲染循环：把每个 chip 的 React 面挂进它的宿主元素。
 * 等价于 @lexical/react 在 composer 内部做的事，但只服务本输入框。
 * DOM 身份跟着 NodeKey，chip 前后的文字编辑不会让端口重挂。
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import type { LexicalEditor, NodeKey } from 'lexical';

export interface DecoratorPortalsProps {
  editor: LexicalEditor | null;
}

/** 渲染全部装饰节点的 React 面 */
export function DecoratorPortals({ editor }: DecoratorPortalsProps) {
  const [decorators, setDecorators] = React.useState<Record<NodeKey, React.JSX.Element>>(() =>
    editor === null ? {} : editor.getDecorators<React.JSX.Element>()
  );

  React.useLayoutEffect(() => {
    if (editor === null) return;
    setDecorators(editor.getDecorators<React.JSX.Element>());
    return editor.registerDecoratorListener<React.JSX.Element>((next) => {
      setDecorators(next);
    });
  }, [editor]);

  if (editor === null) return null;
  return (
    <>
      {Object.entries(decorators).map(([key, jsx]) => {
        const element = editor.getElementByKey(key);
        return element === null ? null : createPortal(jsx, element, key);
      })}
    </>
  );
}
