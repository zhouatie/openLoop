/* 结构取自 deepseek-harness packages/client/ui-chat/src/client/chat/ReasoningRow.tsx（MIT）：
   24px 单行披露 + 首行摘要 + 展开后 Markdown 正文。DSH 原实现依赖 slot 注入的
   Disclosure/词典，这里改为组件内自持状态，正文用本项目的 AgentMarkdown。 */
import { memo, useMemo, useState } from 'react';
import { AgentMarkdown } from '../Markdown';
import { IconThink } from '../icons';
import { DisclosureRow } from './DisclosureRow';
import { TextShimmer } from './TextShimmer';
import css from './ReasoningRow.module.css';

const THINK_ICON = <IconThink size={14} />;

function firstLine(text: string): string {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
}

/** 流式时用最近一段完整段落的首行，避免摘要随每个 token 抖动 */
function latestCompletedParagraphFirstLine(text: string): string {
  let summary = '';
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  for (;;) {
    const nextParagraph = separator.exec(text);
    const paragraphEnd = nextParagraph === null ? text.length : nextParagraph.index + nextParagraph[0].indexOf('\n');
    const newline = text.indexOf('\n', paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== '') summary = candidate;
    }
    if (nextParagraph === null) return summary;
    paragraphStart = nextParagraph.index + nextParagraph[0].length;
  }
}

export interface ReasoningRowProps {
  text: string;
  running?: boolean;
}

/** 助手思考行：折叠态只给「思考 · 首行摘要」，展开显示完整思考正文 */
export const ReasoningRow = memo(function ReasoningRow({ text, running = false }: ReasoningRowProps) {
  const [expanded, setExpanded] = useState(false);
  const summaryText = running ? latestCompletedParagraphFirstLine(text) : firstLine(text);
  const summary = useMemo(() => summaryText.split('**').join(''), [summaryText]);
  const preview = !expanded && summary !== '';

  const collapsedContent = useMemo(
    () => (
      <>
        <span className={css.separator} data-shimmer-decoration aria-hidden />
        <span className={css.summary} data-streaming={running || undefined}>
          <span className={css.summaryText}>
            <TextShimmer>{summary}</TextShimmer>
          </span>
        </span>
      </>
    ),
    [running, summary]
  );

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
      data-preview={preview || undefined}
    >
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        icon={THINK_ICON}
        title="思考"
        running={running}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => setExpanded((value) => !value)}
        collapsedContent={collapsedContent}
      >
        <div className={css.thinkBody}>
          <AgentMarkdown content={text} compact />
        </div>
      </DisclosureRow>
    </div>
  );
});
