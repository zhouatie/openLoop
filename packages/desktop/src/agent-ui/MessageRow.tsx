import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { SessionChatMessage } from '@openloop/core/types';
import { AgentMarkdown } from './Markdown';
import { ToolCard } from './ToolCard';
import { ImageThumb } from './ImageLightbox';
import { IconCopy, IconFork, IconRefresh, IconThink } from './icons';
import styles from './MessageRow.module.css';

/** 首行摘要：DSH 折叠态只显示第一行；流式时用最近一段完整段落的首行 */
function firstLineOf(text: string): string {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
}

function latestParagraphFirstLine(text: string): string {
  let summary = '';
  let cursor = 0;
  while (cursor < text.length) {
    const nextBreak = text.indexOf('\n\n', cursor);
    const chunk = text.slice(cursor, nextBreak === -1 ? text.length : nextBreak);
    const line = firstLineOf(chunk).trim();
    if (line) summary = line;
    if (nextBreak === -1) break;
    cursor = nextBreak + 2;
  }
  return summary;
}

/** 思考行：与 DSH 一致的单行披露，折叠态只给「思考 · 首行摘要」 */
const ThinkingBlock = memo(function ThinkingBlock({
  thinking,
  active,
}: {
  thinking: string;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const startedRef = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);

  // 思考耗时：流式开始打点，结束时结算，展开后可见
  useEffect(() => {
    if (active) {
      startedRef.current = Date.now();
      setSeconds(null);
      return;
    }
    const started = startedRef.current;
    if (!started) return;
    startedRef.current = null;
    setSeconds(Math.max(1, Math.round((Date.now() - started) / 1000)));
  }, [active]);

  if (!thinking.trim() && !active) return null;

  const summary = (active ? latestParagraphFirstLine(thinking) : firstLineOf(thinking)).split('**').join('');

  return (
    <div className={styles.think}>
      <button
        type="button"
        className={styles.thinkToggle}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? '收起思考' : '展开思考'}
      >
        <span className={styles.thinkIcon} aria-hidden>
          <IconThink size={14} />
        </span>
        <span className={styles.thinkTitle}>思考</span>
        <span className={styles.thinkDot} aria-hidden />
        <span className={styles.thinkSummary} data-streaming={active || undefined}>
          <span className={styles.thinkSummaryText}>{summary || (active ? '正在思考' : '无摘要')}</span>
        </span>
      </button>
      {open && (
        <div className={styles.thinkBody}>
          {seconds !== null && <div className={styles.thinkMeta}>本次思考 {seconds} 秒</div>}
          <div className={styles.thinkText}>{thinking}</div>
        </div>
      )}
    </div>
  );
});

export interface MessageRowProps {
  message: SessionChatMessage;
  /** 过程折叠内的紧凑形态：隐藏操作条 */
  compact?: boolean;
  /** 重新生成该轮回答（后端支持时由挂载方注入） */
  onRegenerate?: () => void;
  /** 从该轮用户消息分叉出新会话 */
  onFork?: () => void;
}

export const MessageRow = memo(function MessageRow({
  message,
  compact,
  onRegenerate,
  onFork,
}: MessageRowProps) {
  if (message.role === 'system') {
    return (
      <div className={styles.systemRow}>
        <span className={styles.systemLine} />
        <span className={styles.systemText}>{message.content}</span>
        <span className={styles.systemLine} />
      </div>
    );
  }

  if (message.role === 'user') {
    const attachments = message.attachments || [];
    const images = attachments.filter((item) => Boolean(item.url));
    const files = attachments.filter((item) => !item.url);
    return (
      <div className={styles.userRow}>
        <div className={styles.userBubble}>
          {images.length > 0 && (
            <div className={styles.imageGrid}>
              {images.map((item) => (
                <ImageThumb key={item.id || item.url} image={{ url: item.url, name: item.name }} size={96} />
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className={styles.attachments}>
              {files.map((attachment) => (
                <span key={attachment.id || attachment.path} className={styles.attachment}>
                  {attachment.name || '附件'}
                </span>
              ))}
            </div>
          )}
          {message.content.trim().length > 0 && <div className={styles.userText}>{message.content}</div>}
        </div>
        {!compact && message.content.trim().length > 0 && (
          <UserActions text={message.content} />
        )}
      </div>
    );
  }

  const tools = message.tools || [];
  const hasError = Boolean(message.errorMessage);

  return (
    <div className={`${styles.assistantRow} ${compact ? styles.compact : ''}`}>
      {(message.thinking || message.isThinking) && (
        <ThinkingBlock thinking={message.thinking || ''} active={message.isThinking} />
      )}

      {message.content.trim().length > 0 && (
        <div className={styles.content}>
          <AgentMarkdown content={message.content} />
          {message.isStreaming && <span className={styles.caret} aria-hidden />}
        </div>
      )}

      {tools.length > 0 && (
        <div className={styles.tools}>
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {hasError && <div className={styles.error}>{message.errorMessage}</div>}

      {!compact && (message.content.trim().length > 0 || onFork) && (
        <MessageActions
          text={message.content}
          timestamp={message.timestamp}
          tokens={message.usage?.totalTokens}
          loading={message.isStreaming}
          onRegenerate={onRegenerate}
          onFork={onFork}
        />
      )}
    </div>
  );
});

function formatClock(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 用户消息操作条：复制（与 DSH 一致，不提供编辑） */
const UserActions = memo(function UserActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }, [text]);

  return (
    <div className={styles.userActions}>
      <button
        type="button"
        className={`${styles.iconAction} ${copied ? styles.iconActionDone : ''}`}
        onClick={handleCopy}
        title={copied ? '已复制' : '复制'}
        aria-label="复制消息"
      >
        <IconCopy size={15} />
      </button>
    </div>
  );
});

/** 回答操作条：复制 / 分叉 / 重新生成，右侧是用量与时间 */
const MessageActions = memo(function MessageActions({
  text,
  timestamp,
  tokens,
  loading,
  onRegenerate,
  onFork,
}: {
  text: string;
  timestamp: number;
  tokens?: number;
  loading?: boolean;
  onRegenerate?: () => void;
  onFork?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!text.trim()) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }, [text]);

  return (
    <div className={styles.assistantActions}>
      <div className={styles.actionGroup}>
        {text.trim().length > 0 && (
          <button
            type="button"
            className={`${styles.iconAction} ${copied ? styles.iconActionDone : ''}`}
            onClick={handleCopy}
            title={copied ? '已复制' : '复制'}
            aria-label="复制"
          >
            <IconCopy size={15} />
          </button>
        )}
        {onFork && (
          <button
            type="button"
            className={styles.iconAction}
            onClick={onFork}
            title="从这条消息分叉"
            aria-label="分叉会话"
          >
            <IconFork size={15} />
          </button>
        )}
        {onRegenerate && !loading && (
          <button
            type="button"
            className={styles.iconAction}
            onClick={onRegenerate}
            title="重新生成"
            aria-label="重新生成"
          >
            <IconRefresh size={15} />
          </button>
        )}
      </div>

      <div className={styles.actionMeta}>
        {typeof tokens === 'number' && tokens > 0 && (
          <span className={styles.usage}>{`用量 ${formatTokens(tokens)} tok`}</span>
        )}
        <span className={styles.metaTime}>{formatClock(timestamp)}</span>
      </div>
    </div>
  );
});

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}
