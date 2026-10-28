import { createContext, memo, useContext, useMemo } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './dsh/CodeBlock';
import { localFileTarget, useOpenFile } from './open-file';
import styles from './Markdown.module.css';

/** remark 插件表保持稳定，避免每个分片重建解析器配置 */
const REMARK_PLUGINS = [remarkGfm];

const CODE_LABELS = {
  codeLabel: '代码',
  wrapLabel: '关闭自动折行',
  unwrapLabel: '按面板宽度自动折行',
};

/** 流式标记：流式围栏走 DSH CodeBlock 的增量高亮臂，避免每个分片重排整段代码 */
const StreamingContext = createContext(false);

/** 围栏代码块：交给 DSH CodeBlock（shiki 高亮 + 行号槽 + 代码卡头部） */
const FenceCodeBlock = memo(function FenceCodeBlock({ code, language }: { code: string; language: string }) {
  const streaming = useContext(StreamingContext);
  return (
    <CodeBlock
      code={code}
      lang={language || undefined}
      streaming={streaming}
      lineNumbers
      copyLabel="复制代码"
      copiedLabel="已复制"
      toolbarLabels={CODE_LABELS}
    />
  );
});

export const AgentMarkdown = memo(function AgentMarkdown({
  content,
  streaming = false,
  compact = false,
}: {
  content: string;
  streaming?: boolean;
  /** 紧凑排版：思考正文等次级内容（对应 DSH MarkdownText 的 compact 变体） */
  compact?: boolean;
}) {
  const openFile = useOpenFile();

  // 组件表保持稳定：每次渲染新建对象会让 react-markdown 每个分片重建组件表
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        // 本地文件链接（如 [src/app.ts](src/app.ts)）：流式中不可点，点开进右侧预览
        const file = streaming ? undefined : localFileTarget(href);
        if (file && openFile) {
          return (
            <button
              type="button"
              className={styles.fileLink}
              title={file}
              onClick={() => openFile(file)}
            >
              {children}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer noopener" className={styles.link}>
            {children}
          </a>
        );
      },
      pre: ({ children }) => <>{children}</>,
      code: ({ className, children, ...props }) => {
        const match = /language-(\w+)/.exec(className || '');
        const text = String(children ?? '');
        const isInline = !match && !text.includes('\n');
        if (isInline) {
          return (
            <code className={styles.inlineCode} {...props}>
              {children}
            </code>
          );
        }
        return <FenceCodeBlock code={text} language={match?.[1] || ''} />;
      },
      table: ({ children }) => (
        <div className={styles.tableWrap}>
          <table className={styles.table}>{children}</table>
        </div>
      ),
    }),
    [streaming, openFile]
  );

  return (
    <StreamingContext.Provider value={streaming}>
      <div className={compact ? `${styles.root} ${styles.compact}` : styles.root}>
        <Markdown remarkPlugins={REMARK_PLUGINS} components={components}>
          {content}
        </Markdown>
      </div>
    </StreamingContext.Provider>
  );
});
