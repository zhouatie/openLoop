import React, { memo, useCallback, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import styles from './Markdown.module.css';

import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-diff';

const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlight(code: string, language: string): string {
  const key = LANG_MAP[language] || language;
  const grammar = key && Prism.languages[key];
  if (grammar) {
    try {
      return Prism.highlight(code, grammar, key);
    } catch (_) {
      /* 回退到纯文本 */
    }
  }
  return escapeHtml(code);
}

/** 把高亮后的 HTML 按行切开，未闭合的行内标签在行尾闭合、行首重开，保证行号与内容对齐 */
function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  let index = 0;
  const tagName = (tag: string) => (/^<\/?([a-zA-Z0-9]+)/.exec(tag)?.[1] || '').toLowerCase();

  while (index < html.length) {
    const char = html[index];
    if (char === '<') {
      const end = html.indexOf('>', index);
      if (end === -1) {
        current += html.slice(index);
        break;
      }
      const tag = html.slice(index, end + 1);
      current += tag;
      if (tag.startsWith('</')) open.pop();
      else if (!tag.endsWith('/>')) open.push(tag);
      index = end + 1;
      continue;
    }
    if (char === '\n') {
      lines.push(current + open.slice().reverse().map((tag) => `</${tagName(tag)}>`).join(''));
      current = open.join('');
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  lines.push(current);
  return lines;
}

const MAX_NUMBERED_LINES = 800;

const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => undefined
    );
  }, [code]);

  const highlighted = React.useMemo(() => highlight(code, language), [code, language]);
  const lines = React.useMemo(
    () => (code.split('\n').length > MAX_NUMBERED_LINES ? null : splitHighlightedLines(highlighted)),
    [highlighted, code]
  );

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{language || 'text'}</span>
        <span className={styles.codeActions}>
          <button
            type="button"
            className={styles.codeCopy}
            onClick={() => setWrap((value) => !value)}
            title={wrap ? '关闭自动折行' : '按面板宽度自动折行'}
          >
            {wrap ? '不折行' : '折行'}
          </button>
          <button type="button" className={styles.codeCopy} onClick={handleCopy}>
            {copied ? '已复制' : '复制'}
          </button>
        </span>
      </div>
      <pre className={`${styles.codePre} ${wrap ? styles.codePreWrap : ''}`}>
        {lines ? (
          <code className={`${styles.codeLines} language-${language || 'text'}`}>
            {lines.map((line, index) => (
              <span key={index} className={styles.codeLine}>
                <span className={styles.codeLineNo} aria-hidden>
                  {index + 1}
                </span>
                <span className={styles.codeLineText} dangerouslySetInnerHTML={{ __html: line || ' ' }} />
              </span>
            ))}
          </code>
        ) : (
          <code
            className={`language-${language || 'text'}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        )}
      </pre>
    </div>
  );
});

/** 会话内的 Markdown 渲染：样式全部走 DSH 令牌，不依赖 openLoop 的 Tailwind 主题 */
export const AgentMarkdown = memo(function AgentMarkdown({ content }: { content: string }) {
  return (
    <div className={styles.root}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" className={styles.link}>
              {children}
            </a>
          ),
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
            return <CodeBlock code={text.replace(/\n$/, '')} language={match?.[1] || ''} />;
          },
          table: ({ children }) => (
            <div className={styles.tableWrap}>
              <table className={styles.table}>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
});
