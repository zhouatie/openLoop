import React, { memo, useMemo, useState } from 'react';
import { DiffBlock, type DiffBlockLabels } from './dsh/DiffBlock';
import type { ToolExecutionRecord } from '@openloop/core/types';
import { mutationHunks } from './changed-files';
import { IconCode, IconCommand, IconGlobe, IconSearch, IconThink } from './icons';
import { ImageThumb, LIGHTBOX_LABELS } from './ImageLightbox';
import { ImageLightbox } from './dsh/ImageLightbox';
import { imageSrc, isImagePath } from './local-image';
import { useOpenFile } from './open-file';
import { DisclosureRow } from './dsh/DisclosureRow';
import { TextShimmer } from './dsh/TextShimmer';
import { TerminalBlock } from './dsh/TerminalBlock';
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
  execute: '运行命令',
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
    // pi 的实时结果是内容块数组（[{type:'text', text}]），历史回放已拍平成字符串
    const blocks = Array.isArray(result.content) ? result.content : [];
    const text = blocks
      .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n');
    if (text) return text;
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

/**
 * 命令的退出码：pi 只在失败时把退出码写进正文（`Command exited with code N`），
 * 结构化字段存在时优先取结构化字段。取不到就当作未知，命令卡不显示胶囊。
 */
function exitCodeOf(tool: ToolExecutionRecord, output: string): number | null | undefined {
  if (tool.status === 'running') return undefined;
  const structured = tool.result?.structuredContent ?? tool.result?.details;
  const code = structured?.exit_code ?? structured?.exitCode;
  if (typeof code === 'number') return code;
  const matched = /Command exited with code (\d+)/.exec(output);
  return matched ? Number(matched[1]) : undefined;
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
  const [preview, setPreview] = useState<string | null>(null);
  const kind = tool.kind || 'other';
  const summary = useMemo(() => summarize(tool), [tool.input, tool.name]);
  const output = useMemo(() => renderResult(tool.result), [tool.result]);
  const hasOutput = output.trim().length > 0;
  const diffHunks = useMemo(
    () => (kind === 'write' ? mutationHunks(tool) : null),
    [kind, tool]
  );
  // 命令类工具：展开后是 DSH 的终端卡（提示行 + 输出），不再铺原始入参 JSON
  const command = useMemo(() => pickString(tool.input, ['command', 'cmd', 'script']), [tool.input]);
  const exitCode = useMemo(() => (command ? exitCodeOf(tool, output) : undefined), [command, tool.status, tool.result, output]);
  const exitLabel = exitCode !== undefined && exitCode !== null && exitCode !== 0 ? `退出码 ${exitCode}` : undefined;
  const images = tool.imageUrls || [];
  const isRunning = tool.status === 'running';
  const failed = tool.status === 'error';
  const openFile = useOpenFile();
  // 文件类工具行（读取 / 写入）：点路径在右侧工作台预览；图片路径仍然弹灯箱
  const targetPath = useMemo(() => {
    if (kind !== 'read' && kind !== 'write') return undefined;
    const target = pickString(tool.input, ['path', 'file', 'filePath', 'file_path', 'target']);
    return target && !isImagePath(target) ? target : undefined;
  }, [kind, tool.input]);
  const imagePath = useMemo(() => {
    const target = pickString(tool.input, ['path', 'file', 'filePath', 'file_path', 'target']);
    return isImagePath(target) ? target! : undefined;
  }, [tool.input]);
  const linkPath = targetPath && openFile ? targetPath : imagePath;

  // 输出图片在两类展开体里都要出现，抽出来只写一次
  const imagesSection =
    images.length > 0 ? (
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
    ) : null;

  const title = KIND_LABEL[kind] || KIND_LABEL.other;

  // 折叠态摘要：分隔点 + 摘要 + 耗时；文件路径可点击预览
  const collapsed = useMemo(
    () => (
      <>
        <span className={styles.separator} data-shimmer-decoration aria-hidden />
        {linkPath ? (
          <button
            type="button"
            className={`${styles.summary} ${styles.fileLink}`}
            title={linkPath}
            onClick={(event) => {
              event.stopPropagation();
              if (targetPath && openFile) openFile(targetPath);
              else setPreview(imageSrc(linkPath));
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <TextShimmer>{summary}</TextShimmer>
          </button>
        ) : (
          <span className={styles.summary} data-error={failed || undefined}>
            <TextShimmer>{summary}</TextShimmer>
          </span>
        )}
        {exitLabel && (
          <span className={styles.exitBadge}>
            <span className={styles.exitDot} aria-hidden />
            {exitLabel}
          </span>
        )}
        {tool.durationMs !== undefined && (
          <span className={styles.duration}>{formatDuration(tool.durationMs)}</span>
        )}
      </>
    ),
    [failed, linkPath, targetPath, openFile, summary, exitLabel, tool.durationMs]
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
        {command ? (
          <div className={styles.body}>
            <TerminalBlock
              className={styles.terminal}
              command={command}
              cwd={tool.cwd}
              output={output}
              exitCode={exitCode}
              running={isRunning}
            />
            {imagesSection}
          </div>
        ) : (
          <div className={styles.body}>
            {diffHunks && <DiffBlock diffs={diffHunks} labels={DIFF_LABELS} />}
            {!diffHunks && tool.input && Object.keys(tool.input).length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>入参</div>
                <pre className={styles.pre}>{JSON.stringify(tool.input, null, 2)}</pre>
              </div>
            )}
            {imagesSection}
            {hasOutput && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>{failed ? '错误输出' : '输出'}</div>
                <pre className={`${styles.pre} ${failed ? styles.preError : ''}`}>{output}</pre>
              </div>
            )}
            {!hasOutput && !isRunning && <div className={styles.empty}>本次调用没有输出</div>}
            {isRunning && <div className={styles.empty}>执行中…</div>}
          </div>
        )}
      </DisclosureRow>
      {preview && (
        <ImageLightbox
          src={preview}
          alt={imagePath || '图片预览'}
          labels={LIGHTBOX_LABELS}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
});

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}
