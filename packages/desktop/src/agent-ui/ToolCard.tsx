import React, { memo, useMemo, useState } from 'react';
import type { ToolExecutionRecord } from '@openloop/core/types';
import { IconChevronDown } from './icons';
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

export const ToolCard = memo(function ToolCard({ tool }: { tool: ToolExecutionRecord }) {
  const [expanded, setExpanded] = useState(false);
  const kind = tool.kind || 'other';
  const summary = useMemo(() => summarize(tool), [tool.input, tool.name]);
  const output = useMemo(() => renderResult(tool.result), [tool.result]);
  const hasOutput = output.trim().length > 0;
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
        {summary !== tool.name && (
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
          {tool.input && Object.keys(tool.input).length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>入参</div>
              <pre className={styles.pre}>{JSON.stringify(tool.input, null, 2)}</pre>
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
