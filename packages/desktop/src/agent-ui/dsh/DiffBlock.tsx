/* 取自 deepseek-harness packages/client/ui-primitives/src/DiffBlock.tsx（MIT）：
   语言查询换成本地的 languageForPath，其余（structurePatch 折叠、头尾切片、
   复制全文、路径/缺口行）原样保留。 */
import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { structuredPatch } from 'diff';
import { FoldToggle } from './FoldToggle';
import { writeClipboard } from './clipboard';
import { CodeToolbar, type CodeToolbarLabels } from './CodeToolbar';
import { languageForPath } from './code-language';
import cardCss from './CodeCard.module.css';
import css from './DiffBlock.module.css';

/** 折叠前显示的正文行数 */
export const DEFAULT_DIFF_MAX_LINES = 16;

/** 一个文件改动：旧内容为 null 表示新建 */
export interface DiffHunk {
  path: string;
  oldText: string | null;
  newText: string;
}

export interface DiffBlockProps {
  diffs: DiffHunk[];
  labels: DiffBlockLabels;
  maxLines?: number | undefined;
  className?: string | undefined;
}

/** 差分卡文案 */
export interface DiffBlockLabels extends CodeToolbarLabels {
  copy: string;
  copied: string;
  collapseAria: string;
  expandAria: (hidden: number) => string;
  collapse: string;
  expand: (hidden: number) => string;
}

interface DiffRow {
  kind: 'path' | 'del' | 'add' | 'context' | 'gap';
  text: string;
}

function assertNever(value: never): never {
  throw new Error(`unreachable diff row kind: ${String(value)}`);
}

const ROW_CLASS: Record<DiffRow['kind'], string | undefined> = {
  path: css.path,
  del: css.del,
  add: css.add,
  context: css.context,
  gap: css.gap,
};

/** 同步编辑图搜索的上限，超过则整段按替换处理 */
const MAX_DIFF_EDIT_LENGTH = 256;

function localHunks(diff: DiffHunk) {
  const oldLines = contentLines(diff.oldText ?? '');
  const newLines = contentLines(diff.newText);
  const normalize = (lines: string[]): string => lines.map((line) => `${line}\n`).join('');
  return (
    structuredPatch('', '', normalize(oldLines), normalize(newLines), undefined, undefined, {
      context: 3,
      maxEditLength: MAX_DIFF_EDIT_LENGTH,
    })?.hunks ?? [
      { lines: [...oldLines.map((line) => `-${line}`), ...newLines.map((line) => `+${line}`)] },
    ]
  );
}

/** 统计 +/- 行数，供工具行摘要使用 */
export function diffTotals(diffs: DiffHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const diff of diffs) {
    for (const hunk of localHunks(diff)) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) added++;
        if (line.startsWith('-')) removed++;
      }
    }
  }
  return { added, removed };
}

function buildRows(diffs: DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let prevPath: string | undefined;
  for (const diff of diffs) {
    if (diff.path !== prevPath) rows.push({ kind: 'path', text: diff.path });
    else rows.push({ kind: 'gap', text: '⋯' });
    prevPath = diff.path;
    for (const [index, hunk] of localHunks(diff).entries()) {
      if (index > 0) rows.push({ kind: 'gap', text: '⋯' });
      for (const line of hunk.lines) {
        const kind = line.startsWith('-') ? 'del' : line.startsWith('+') ? 'add' : 'context';
        rows.push({ kind, text: line.slice(1) });
      }
    }
  }
  return rows;
}

/** 单行结尾视为行终止符，而不是多一个空行 */
function contentLines(text: string): string[] {
  if (text === '') return [];
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n');
}

function copyText(rows: DiffRow[]): string {
  return rows
    .map((row) => {
      switch (row.kind) {
        case 'del':
          return `- ${row.text}`;
        case 'add':
          return `+ ${row.text}`;
        case 'context':
          return `  ${row.text}`;
        case 'path':
          return row.text;
        case 'gap':
          return row.text;
        default:
          return assertNever(row.kind);
      }
    })
    .join('\n');
}

/** 把文件改动渲染成内联差分卡 */
export function DiffBlock({ diffs, labels, maxLines = DEFAULT_DIFF_MAX_LINES, className }: DiffBlockProps) {
  const rows = useMemo(() => buildRows(diffs), [diffs]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const firstLanguage = diffs[0] === undefined ? undefined : languageForPath(diffs[0].path);
  const language = diffs.every((diff) => languageForPath(diff.path) === firstLanguage) ? firstLanguage : undefined;

  const onCopy = useCallback(() => {
    if (copied) return;
    void writeClipboard(copyText(rows)).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1000);
    });
  }, [copied, rows]);

  const onToggle = useCallback(() => {
    setExpanded((value) => !value);
  }, []);

  if (rows.length === 0) return null;

  const hidden = rows.length - maxLines;
  const capped = hidden > 0 && !expanded;
  const headLines = Math.ceil(maxLines / 2);
  const tailLines = maxLines - headLines;
  const head = capped ? rows.slice(0, headLines) : rows;
  const tail = capped ? rows.slice(rows.length - tailLines) : [];

  return (
    <div className={clsx(cardCss.card, css.block, className)} data-diff="" data-code-wrap={wrapped}>
      <CodeToolbar
        lang={language}
        labels={labels}
        copyLabel={labels.copy}
        copiedLabel={labels.copied}
        copied={copied}
        wrapped={wrapped}
        onCopy={onCopy}
        onWrap={() => {
          setWrapped((value) => !value);
        }}
      />
      <div className={css.body}>
        {head.map((row, index) => (
          <div key={index} className={clsx(css.line, ROW_CLASS[row.kind])}>
            {row.text}
          </div>
        ))}
        {hidden > 0 && (
          <FoldToggle className={css.expand} expanded={expanded} hidden={hidden} labels={labels} onToggle={onToggle} />
        )}
        {tail.map((row, index) => (
          <div key={index} className={clsx(css.line, ROW_CLASS[row.kind])}>
            {row.text}
          </div>
        ))}
      </div>
    </div>
  );
}
