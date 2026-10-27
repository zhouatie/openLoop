import React, { memo, useMemo, useState } from 'react';
import { DiffBlock, type DiffBlockLabels, type DiffHunk } from './dsh/DiffBlock';
import type { ToolExecutionRecord } from '@openloop/core/types';
import { IconCode, IconCommand, IconGlobe, IconSearch, IconThink } from './icons';
import { ImageThumb } from './ImageLightbox';
import { DisclosureRow } from './dsh/DisclosureRow';
import { TextShimmer } from './dsh/TextShimmer';
import styles from './ToolCard.module.css';

/** 工具行图标：与 DSH 的 flow row 一致，16px 盒子里 14px 图形 */
function kindIcon(kind: string) {
  if (kind === 'browse') return <IconGlobe size={14} />;
  if (kind === 'search') return <IconSearch size={14} />;
  if (kind === 'read' || kind === 'write') return <IconCode size={14} />;
  if (kind === 'agent') return <IconThink size={14} />;
  return <IconCommand size={14} />;
}

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

function pickStringOf(source: any, keys: string[]): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

/**
 * 写入类工具的差分：pi 的 edit 工具把改动放在 edits[] 里，write 工具则是整份 content。
 * 转换成 DSH DiffBlock 需要的 {path, oldText, newText} 形状。
 */
function diffHunksOfInput(tool: ToolExecutionRecord): DiffHunk[] | null {
  const input = tool.input || {};
  const path = pickStringOf(input, ['path', 'file_path', 'filePath', 'target']) || '';
  const hunks: DiffHunk[] = [];
  const edits = Array.isArray(input.edits) ? input.edits : [];
  for (const edit of edits) {
    const after = pickStringOf(edit, ['newText', 'newString', 'new_text']);
    if (after === undefined) continue;
    const before = pickStringOf(edit, ['oldText', 'oldString', 'old_text']);
    hunks.push({ path, oldText: before ?? null, newText: after });
  }
  if (hunks.length === 0) {
    const after = pickStringOf(input, ['content', 'newString', 'newText', 'after', 'text']);
    if (after !== undefined) {
      const before = pickStringOf(input, ['oldString', 'oldText', 'before']);
      hunks.push({ path, oldText: before ?? null, newText: after });
    }
  }
  return hunks.length > 0 ? hunks : null;
}

const DIFF_LABELS: DiffBlockLabels = {
  codeLabel: '代码',
  wrapLabel: '关闭自动折行',
  unwrapLabel: '按面板宽度自动折行',
  copy: '复制改动',
  copied: '已复制',
  collapseAria: '收起改动',
  expandAria: (hidden) => `展开其余 ${hidden} 行改动`,
  collapse: '收起',
  expand: (hidden) => `展开其余 ${hidden} 行`,
};

export const ToolCard = memo(function ToolCard({ tool }: { tool: ToolExecutionRecord }) {
  const [expanded, setExpanded] = useState(false);
  const kind = tool.kind || 'other';
  const summary = useMemo(() => summarize(tool), [tool.input, tool.name]);
  const output = useMemo(() => renderResult(tool.result), [tool.result]);
  const hasOutput = output.trim().length > 0;
  const diffHunks = useMemo(
    () => (kind === 'write' ? diffHunksOfInput(tool) : null),
    [kind, tool.input]
  );
  const images = tool.imageUrls || [];
  const isRunning = tool.status === 'running';
  const failed = tool.status === 'error';

  const title = KIND_LABEL[kind] || KIND_LABEL.other;

  // 折叠态摘要：分隔点 + 摘要 + 耗时
  const collapsed = useMemo(
    () => (
      <>
        <span className={styles.separator} data-shimmer-decoration aria-hidden />
        <span className={styles.summary} data-error={failed || undefined}>
          <TextShimmer>{summary}</TextShimmer>
        </span>
        {tool.durationMs !== undefined && (
          <span className={styles.duration}>{formatDuration(tool.durationMs)}</span>
        )}
      </>
    ),
    [failed, summary, tool.durationMs]
  );

  const canExpand = Boolean(diffHunks) || hasOutput || images.length > 0 || Boolean(tool.input);
  const open = expanded && canExpand;

  return (
    <div className={styles.root} data-state={tool.status}>
      <DisclosureRow
        icon={kindIcon(kind)}
        title={title}
        running={isRunning}
        open={open}
        expandable={canExpand}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setExpanded((value) => !value)}
        collapsedContent={collapsed}
        titleClassName={styles.title}
      >
        <div className={styles.body}>
          {diffHunks && <DiffBlock diffs={diffHunks} labels={DIFF_LABELS} />}
          {!diffHunks && tool.input && Object.keys(tool.input).length > 0 && (
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
                  <ImageThumb
                    key={`${index}-${url.slice(-12)}`}
                    image={{ url, name: `输出图片 ${index + 1}` }}
                    size={120}
                  />
                ))}
              </div>
            </div>
          )}
          {hasOutput && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>{failed ? '错误输出' : '输出'}</div>
              <pre className={`${styles.pre} ${failed ? styles.preError : ''}`}>{output}</pre>
            </div>
          )}
          {!hasOutput && !isRunning && <div className={styles.empty}>本次调用没有输出</div>}
          {isRunning && <div className={styles.empty}>执行中…</div>}
        </div>
      </DisclosureRow>
    </div>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}
