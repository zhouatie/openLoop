import React, { memo, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import type { ToolExecutionRecord } from '@openloop/core/types';
import { IconChevronDown } from './icons';
import { ImageThumb } from './ImageLightbox';
import styles from './ToolCard.module.css';

const KIND_LABEL: Record<string, string> = {
  execute: '命令',
  read: '读取',
  write: '写入',
  search: '检索',
  browse: '网络',
  agent: '子代理',
  media: '媒体',
  other: '工具',
};

function pickString(input: Record<string, any> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/** 工具卡摘要：按工具形态挑选一行最能说明意图的文本 */
function summarize(tool: ToolExecutionRecord): string {
  const input = tool.input;
  const name = tool.name || '';
  const command = pickString(input, ['command', 'cmd', 'script']);
  if (command) {
    // 多行脚本只展示首行，完整内容在展开后的入参里
    const firstLine = command.split('\n').find((line) => line.trim()) || '';
    const flat = firstLine.replace(/\s+/g, ' ').trim();
    return flat.length > 100 ? `${flat.slice(0, 100)}…` : flat;
  }
  const path = pickString(input, ['path', 'file', 'filePath', 'file_path', 'target']);
  const pattern = pickString(input, ['pattern', 'query', 'q', 'regex', 'search']);
  if (pattern && path) return `${pattern} · ${path}`;
  if (pattern) return pattern;
  if (path) return path;
  if (input && typeof input === 'object') {
    const first = Object.values(input).find((value) => typeof value === 'string' && value.trim());
    if (typeof first === 'string') return first;
  }
  return name;
}

/** pi 内置工具的 id 本身没有信息量（读取 / read），只保留种类标签和摘要 */
const GENERIC_TOOL_NAMES = new Set([
  'read',
  'bash',
  'write',
  'edit',
  'grep',
  'find',
  'ls',
  'glob',
  'view',
  'cat',
  'patch',
  'apply_patch',
  'multiedit',
  'search',
  'fetch',
  'task',
  'subagent',
  'todo',
  'todoread',
  'todowrite',
]);

function renderResult(result: any): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const withContent = result.content ?? result.output ?? result.text;
    if (typeof withContent === 'string') return withContent;
    try {
      return JSON.stringify(result, null, 2);
    } catch (_) {
      return '[无法序列化的结果]';
    }
  }
  return String(result);
}

interface DiffRow {
  sign: '+' | '-' | ' ';
  text: string;
}

function buildDiffRows(before: string | undefined, after: string): DiffRow[] {
  const parts = (
    before === undefined ? [{ added: true, value: after }] : diffLines(before, after)
  ) as Array<{ added?: boolean; removed?: boolean; value: string }>;
  const rows: DiffRow[] = [];
  for (const part of parts) {
    const sign: DiffRow['sign'] = part.added ? '+' : part.removed ? '-' : ' ';
    for (const line of String(part.value).split('\n')) {
      if (line === '' && part.value.endsWith('\n')) continue;
      rows.push({ sign, text: line });
    }
  }
  return rows;
}

function pickStringOf(source: any, keys: string[]): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/**
 * 写入类工具的差分分组：pi 的 edit 工具把改动放在 edits[] 里，
 * write 工具则是整份 content，两种形态都要能画出来。
 */
function diffGroupsOfInput(tool: ToolExecutionRecord): DiffRow[][] | null {
  const input = tool.input || {};
  const groups: DiffRow[][] = [];
  const edits = Array.isArray(input.edits) ? input.edits : [];
  for (const edit of edits) {
    const before = pickStringOf(edit, ['oldText', 'oldString', 'old_text']);
    const after = pickStringOf(edit, ['newText', 'newString', 'new_text']);
    if (after === undefined) continue;
    const rows = buildDiffRows(before, after);
    if (rows.length > 0) groups.push(rows);
  }
  if (groups.length === 0) {
    const before = pickStringOf(input, ['oldString', 'oldText', 'before']);
    const after = pickStringOf(input, ['content', 'newString', 'newText', 'after', 'text']);
    if (after !== undefined) {
      const rows = buildDiffRows(before, after);
      if (rows.length > 0) groups.push(rows);
    }
  }
  return groups.length > 0 ? groups : null;
}

const MAX_DIFF_ROWS = 120;

const DiffBlock = memo(function DiffBlock({ rows, label = '改动' }: { rows: DiffRow[]; label?: string }) {
  const [showAll, setShowAll] = useState(false);
  const added = rows.filter((row) => row.sign === '+').length;
  const removed = rows.filter((row) => row.sign === '-').length;
  const visible = showAll ? rows : rows.slice(0, MAX_DIFF_ROWS);
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>
        {label}
        <span className={styles.diffStat}>
          <span className={styles.diffAdd}>+{added}</span>
          <span className={styles.diffRemove}>-{removed}</span>
        </span>
      </div>
      <div className={styles.diff}>
        {visible.map((row, index) => (
          <div
            key={`${index}-${row.sign}`}
            className={`${styles.diffRow} ${
              row.sign === '+' ? styles.diffRowAdd : row.sign === '-' ? styles.diffRowRemove : ''
            }`}
          >
            <span className={styles.diffSign}>{row.sign}</span>
            <span className={styles.diffText}>{row.text}</span>
          </div>
        ))}
      </div>
      {rows.length > MAX_DIFF_ROWS && (
        <button type="button" className={styles.more} onClick={() => setShowAll((value) => !value)}>
          {showAll ? '收起' : `展开其余 ${rows.length - MAX_DIFF_ROWS} 行`}
        </button>
      )}
    </div>
  );
});

export const ToolCard = memo(function ToolCard({ tool }: { tool: ToolExecutionRecord }) {
  const [expanded, setExpanded] = useState(false);
  const kind = tool.kind || 'other';
  const summary = useMemo(() => summarize(tool), [tool.input, tool.name]);
  const output = useMemo(() => renderResult(tool.result), [tool.result]);
  const hasOutput = output.trim().length > 0;
  const diffGroups = useMemo(
    () => (kind === 'write' ? diffGroupsOfInput(tool) : null),
    [kind, tool.input]
  );
  const images = tool.imageUrls || [];
  const isRunning = tool.status === 'running';

  const statusClass = isRunning
    ? styles.statusRunning
    : tool.status === 'error'
      ? styles.statusError
      : styles.statusSuccess;

  return (
    <div className={`${styles.card} ${expanded ? styles.cardExpanded : ''}`}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className={`${styles.dot} ${statusClass}`} aria-hidden />
        <span className={styles.kind}>{KIND_LABEL[kind] || KIND_LABEL.other}</span>
        {summary !== tool.name && !GENERIC_TOOL_NAMES.has((tool.name || '').toLowerCase()) && (
          <>
            <span className={styles.name}>{tool.name}</span>
            <span className={styles.separator} aria-hidden />
          </>
        )}
        <span className={styles.summary}>{summary}</span>
        {tool.durationMs !== undefined && (
          <span className={styles.duration}>{formatDuration(tool.durationMs)}</span>
        )}
        <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`} aria-hidden>
          <IconChevronDown size={12} />
        </span>
      </button>

      {expanded && (
        <div className={styles.body}>
          {diffGroups &&
            diffGroups.map((rows, index) => (
              <DiffBlock
                key={index}
                rows={rows}
                label={diffGroups.length > 1 ? `改动 ${index + 1}` : '改动'}
              />
            ))}
          {!diffGroups && tool.input && Object.keys(tool.input).length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>入参</div>
              <pre className={styles.pre}>{JSON.stringify(tool.input, null, 2)}</pre>
            </div>
          )}
          {images.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>输出图片</div>
              <div className={styles.images}>
                {images.map((url, index) => (
                  <ImageThumb key={`${index}-${url.slice(-12)}`} image={{ url, name: `输出图片 ${index + 1}` }} size={120} />
                ))}
              </div>
            </div>
          )}
          {hasOutput && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>{tool.status === 'error' ? '错误输出' : '输出'}</div>
              <pre className={`${styles.pre} ${tool.status === 'error' ? styles.preError : ''}`}>{output}</pre>
            </div>
          )}
          {!hasOutput && !isRunning && <div className={styles.empty}>本次调用没有输出</div>}
          {isRunning && <div className={styles.empty}>执行中…</div>}
        </div>
      )}
    </div>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}
