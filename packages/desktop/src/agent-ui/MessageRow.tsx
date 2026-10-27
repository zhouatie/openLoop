import React, { memo, useCallback, useState } from 'react';
import type { SessionChatMessage } from '@openloop/core/types';
import { AgentMarkdown } from './Markdown';
import { ToolCard } from './ToolCard';
import { IconCopy, IconFork, IconRefresh, IconThumbDown, IconThumbUp } from './icons';
import styles from './MessageRow.module.css';

const ThinkingBlock = memo(function ThinkingBlock({
  thinking,
  active,
}: {
  thinking: string;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!thinking.trim() && !active) return null;
  return (
    <div className={styles.thinking}>
      <button type="button" className={styles.thinkingToggle} onClick={() => setOpen((value) => !value)}>
        <span className={active ? styles.thinkingPulse : styles.thinkingDot} aria-hidden />
        思考过程
        {thinking.length > 0 && <span className={styles.thinkingCount}>{thinking.length} 字</span>}
        <span className={styles.thinkingChevron}>{open ? '收起' : '展开'}</span>
      </button>
      {open && <div className={styles.thinkingBody}>{thinking}</div>}
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

export const MessageRow = memo(function MessageRow({ message, compact, onRegenerate, onFork }: MessageRowProps) {
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
    return (
      <div className={styles.userRow}>
        <div className={styles.userBubble}>
          {message.attachments && message.attachments.length > 0 && (
            <div className={styles.attachments}>
              {message.attachments.map((attachment) => (
                <span key={attachment.id || attachment.path} className={styles.attachment}>
                  {attachment.name || '附件'}
                </span>
              ))}
            </div>
          )}
          <div className={styles.userText}>{message.content}</div>
        </div>
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

/** 回答操作条：复制 / 反馈 / 分叉 / 重新生成，右侧是用量与时间 */
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
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

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
        <button
          type="button"
          className={`${styles.iconAction} ${feedback === 'up' ? styles.iconActionActive : ''}`}
          onClick={() => setFeedback((prev) => (prev === 'up' ? null : 'up'))}
          title="有帮助"
          aria-label="有帮助"
          aria-pressed={feedback === 'up'}
        >
          <IconThumbUp size={15} />
        </button>
        <button
          type="button"
          className={`${styles.iconAction} ${feedback === 'down' ? styles.iconActionActive : ''}`}
          onClick={() => setFeedback((prev) => (prev === 'down' ? null : 'down'))}
          title="没帮助"
          aria-label="没帮助"
          aria-pressed={feedback === 'down'}
        >
          <IconThumbDown size={15} />
        </button>
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
