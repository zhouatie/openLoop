import React, { memo, useState, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';
import { Check, Copy, ExternalLink, Terminal } from 'lucide-react';
import { SubtaskPlanCard } from './SubtaskPlanCard';
import { WorkflowDefinition } from '@openloop/core';

// 按需加载常用高亮语言
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

/**
 * 语言别名映射表
 */
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

/**
 * 字符转义工具，防范未识别语言时的 XSS 与 DOM 解析异常
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 独立记忆化代码块组件，避免流式输出时非活跃代码块重绘
 */
export const CodeBlock = memo(function CodeBlock({
  code,
  language = '',
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  // 语法高亮缓存
  const highlightedHtml = useMemo(() => {
    const rawLang = (language || '').toLowerCase().trim();
    const lang = LANG_MAP[rawLang] || rawLang;
    const grammar = Prism.languages[lang];
    if (grammar) {
      try {
        return Prism.highlight(code, grammar, lang);
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[AgentMarkdown:CodeBlock] 高亮解析异常，降级显示:', err);
        }
      }
    }
    return escapeHtml(code);
  }, [code, language]);

  // 复制代码到剪贴板
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[UI:AgentMarkdown] 代码已成功复制到剪贴板, 长度:', code.length);
      }
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[UI:AgentMarkdown] 复制剪贴板失败:', err);
    }
  }, [code]);

  return (
    <div className="openloop-code-dark group/code relative my-2.5 rounded-[8px] border border-[#27272a] bg-[#121214] overflow-hidden text-[11px] shadow-sm select-text">
      {/* 头部栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#18181b] border-b border-[#27272a] select-none">
        <div className="flex items-center gap-1.5 text-[#a1a1aa]">
          <Terminal size={11} className="text-[#818cf8]" />
          <span className="font-mono text-[10px] font-medium tracking-wider uppercase">
            {language || 'text'}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded-[4px] text-[10px] font-mono text-[#a1a1aa] hover:text-white hover:bg-[#27272a] transition-all cursor-pointer"
          title="复制代码"
        >
          {copied ? (
            <>
              <Check size={11} className="text-[#4ade80]" />
              <span className="text-[#4ade80] font-medium">已复制</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {/* 代码高亮主体内容 */}
      <div className="p-3 overflow-x-auto">
        <pre className="font-mono text-[11px] leading-relaxed text-[#e4e4e7] selection:bg-[#4f46e5]/40 m-0 p-0 bg-transparent">
          <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        </pre>
      </div>
    </div>
  );
});

export interface AgentMarkdownProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  taskId?: string;
  parentWorkspace?: string;
  workflows?: WorkflowDefinition[];
  onAppliedPlan?: () => void;
}

/**
 * 专为 Agent 对话流与紧凑侧边栏打造的高性能极简 Markdown 渲染器
 */
export const AgentMarkdown = memo(function AgentMarkdown({
  content,
  className = '',
  isStreaming = false,
  taskId,
  parentWorkspace,
  workflows = [],
  onAppliedPlan,
}: AgentMarkdownProps) {
  // 自定义组件映射
  const components = useMemo(
    () => ({
      pre({ children }: any) {
        return <>{children}</>;
      },
      code({ className: codeClass, children, ...props }: any) {
        const match = /language-(\w+)/.exec(codeClass || '');
        const lang = match ? match[1].toLowerCase() : '';
        const codeStr = String(children).replace(/\n$/, '');
        const isInline = !match && !String(children).includes('\n');

        if (isInline) {
          return (
            <code
              className="font-mono text-[11px] px-1.5 py-0.5 rounded-[4px] bg-[#f0f0f4] text-[#4f46e5] border border-[#e5e5ea] select-text break-all"
              {...props}
            >
              {children}
            </code>
          );
        }

        // 检测是否为工序拆解方案 JSON (如由任务组架构师产出的 subtask_plan)
        if (
          (lang === 'json' || lang === 'subtask_plan' || lang === 'subtasks' || !lang) &&
          codeStr.includes('"subtasks"')
        ) {
          try {
            const parsed = JSON.parse(codeStr);
            if (parsed && Array.isArray(parsed.subtasks) && parsed.subtasks.length > 0 && parsed.subtasks[0]?.title) {
              return (
                <SubtaskPlanCard
                  plan={parsed}
                  rawJson={codeStr}
                  taskId={taskId}
                  parentWorkspace={parentWorkspace}
                  workflows={workflows}
                  onApplied={onAppliedPlan}
                />
              );
            }
          } catch (_) {
            // 解析失败时优雅降级到默认代码块展示
          }
        }

        return (
          <CodeBlock
            code={codeStr}
            language={match ? match[1] : ''}
          />
        );
      },
      p({ children }: any) {
        return (
          <p className="my-1.5 text-[12px] text-[#1c1c21] leading-relaxed first:mt-0 last:mb-0 break-words select-text">
            {children}
          </p>
        );
      },
      h1({ children }: any) {
        return (
          <h1 className="text-[13.5px] font-bold text-[#1c1c21] mt-3 mb-1.5 pb-1 border-b border-[#ececf0] first:mt-0">
            {children}
          </h1>
        );
      },
      h2({ children }: any) {
        return (
          <h2 className="text-[12.5px] font-bold text-[#1c1c21] mt-2.5 mb-1 first:mt-0">
            {children}
          </h2>
        );
      },
      h3({ children }: any) {
        return (
          <h3 className="text-[12px] font-semibold text-[#1c1c21] mt-2 mb-0.5 first:mt-0">
            {children}
          </h3>
        );
      },
      h4({ children }: any) {
        return (
          <h4 className="text-[11.5px] font-semibold text-[#1c1c21] mt-1.5 mb-0.5 first:mt-0">
            {children}
          </h4>
        );
      },
      ul({ children }: any) {
        return (
          <ul className="list-disc list-outside pl-4 my-1.5 space-y-1 text-[12px] text-[#1c1c21]">
            {children}
          </ul>
        );
      },
      ol({ children }: any) {
        return (
          <ol className="list-decimal list-outside pl-4 my-1.5 space-y-1 text-[12px] text-[#1c1c21]">
            {children}
          </ol>
        );
      },
      li({ children }: any) {
        return <li className="leading-relaxed">{children}</li>;
      },
      blockquote({ children }: any) {
        return (
          <blockquote className="my-2 border-l-[3px] border-[#6366f1] bg-[#f8f9ff] px-2.5 py-1.5 rounded-r-[6px] text-[11.5px] text-[#4b4b53] leading-relaxed italic">
            {children}
          </blockquote>
        );
      },
      a({ href, children }: any) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (href) {
                if (process.env.NODE_ENV !== 'production') {
                  console.log('[UI:AgentMarkdown] 点击外部超链接:', href);
                }
                window.open(href, '_blank', 'noopener,noreferrer');
              }
            }}
            className="text-[#4f46e5] hover:text-[#4338ca] underline underline-offset-2 decoration-[#c7d2fe] hover:decoration-[#4f46e5] transition-colors inline-flex items-center gap-0.5 break-all"
            title={href}
          >
            <span>{children}</span>
            <ExternalLink size={10} className="inline-block opacity-70 shrink-0" />
          </a>
        );
      },
      table({ children }: any) {
        return (
          <div className="my-2 overflow-x-auto rounded-[6px] border border-[#e3e3e8]">
            <table className="w-full border-collapse text-[11px] text-left">
              {children}
            </table>
          </div>
        );
      },
      th({ children }: any) {
        return (
          <th className="bg-[#f5f5f8] px-2.5 py-1.5 font-semibold text-[#1c1c21] border-b border-[#e3e3e8] whitespace-nowrap">
            {children}
          </th>
        );
      },
      td({ children }: any) {
        return (
          <td className="px-2.5 py-1.5 border-b border-[#ececf0] text-[#4b4b53]">
            {children}
          </td>
        );
      },
      hr() {
        return <hr className="my-2.5 border-t border-[#ececf0]" />;
      },
      strong({ children }: any) {
        return <strong className="font-semibold text-[#1c1c21]">{children}</strong>;
      },
      em({ children }: any) {
        return <em className="italic text-[#4b4b53]">{children}</em>;
      },
    }),
    [taskId, parentWorkspace, workflows, onAppliedPlan]
  );

  return (
    <div className={`openloop-markdown ${className}`}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
      {isStreaming && (
        <span
          className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-[#7c3aed] rounded-[1px] animate-pulse"
          title="生成中..."
        />
      )}
    </div>
  );
});
