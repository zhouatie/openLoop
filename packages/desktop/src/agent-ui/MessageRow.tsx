import React, { memo, useCallback, useState } from 'react';
import type { SessionChatMessage } from '@openloop/core/types';
import { AgentMarkdown } from './Markdown';
import { ToolCard } from './ToolCard';
import styles from './MessageRow.module.css';

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

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
  /** 过程折叠内的紧凑形态：隐藏模型与时间行 */
  compact?: boolean;
  /** 重新生成该轮回答（后端支持时由挂载方注入） */
  onRegenerate?: () => void;
}

export const MessageRow = memo(function MessageRow({ message, compact, onRegenerate }: MessageRowProps) {
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
      {!compact && (
        <div className={styles.assistantMeta}>
          <span className={styles.author}>{message.model || 'Agent'}</span>
          <span className={styles.time}>{formatTime(message.timestamp)}</span>
          {message.isStreaming && <span className={styles.streamingDot} aria-label="正在输出" />}
          {message.content.trim().length > 0 && <CopyAction text={message.content} />}
          {onRegenerate && !message.isStreaming && (
            <button type="button" className={styles.action} onClick={onRegenerate} title="重新生成">
              重新生成
            </button>
          )}
        </div>
      )}

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

    </div>
  );
});

/** 消息操作：复制 Markdown 原文 */
function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }, [text]);

  return (
    <button type="button" className={styles.action} onClick={handleCopy} title="复制内容">
      {copied ? '已复制' : '复制'}
    </button>
  );
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `${(tokens / 1000).toFixed(1)}k`;
}
