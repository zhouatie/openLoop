import React, { memo, useCallback, useMemo, useState } from 'react';
import type { SessionChatMessage } from '@openloop/core/types';
import { AgentMarkdown } from './Markdown';
import { ToolCard } from './ToolCard';
import { ImageThumb } from './ImageLightbox';
import { imageSrc, isImagePath, splitPromptImages } from './local-image';
import { ReasoningRow } from './dsh/ReasoningRow';
import { MessageActions, formatTokens } from './dsh/MessageActions';
import { Tooltip } from './dsh/Tooltip';
import { writeClipboard } from './dsh/clipboard';
import { IconCopy } from './icons';
import styles from './MessageRow.module.css';

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
    return <UserMessageRow message={message} compact={compact} />;
  }

  const tools = message.tools || [];
  const hasError = Boolean(message.errorMessage);

  return (
    <div className={`${styles.assistantRow} ${compact ? styles.compact : ''}`}>
      {(message.thinking || message.isThinking) && (
        <ReasoningRow text={message.thinking || ''} running={message.isThinking} />
      )}

      {message.content.trim().length > 0 && (
        <div className={styles.content}>
          <AgentMarkdown content={message.content} streaming={message.isStreaming} />
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
          usage={message.usage}
          model={message.model}
          streaming={message.isStreaming}
          onFork={onFork}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  );
});

/** 用户消息：正文在上，随附图片缩略图贴在气泡底部（点击放大） */
const UserMessageRow = memo(function UserMessageRow({
  message,
  compact,
}: {
  message: SessionChatMessage;
  compact?: boolean;
}) {
  const { text, images: promptImages } = useMemo(() => splitPromptImages(message.content), [message.content]);
  const attachments = message.attachments || [];
  const images = useMemo(
    () => [
      ...attachments
        .filter((item) => Boolean(item.url))
        .map((item) => ({ key: item.id || item.url, url: item.url, name: item.name })),
      ...promptImages.map((item) => ({ key: item.path, url: imageSrc(item.path), name: item.name })),
    ],
    [message.attachments, promptImages]
  );
  const files = attachments.filter((item) => !item.url && !isImagePath(item.path));

  return (
    <div className={styles.userRow}>
      <div className={styles.userBubble}>
        {text.trim().length > 0 && <div className={styles.userText}>{text}</div>}
        {images.length > 0 && (
          <div className={styles.imageGrid}>
            {images.map((item) => (
              <ImageThumb
                key={item.key}
                image={{ url: item.url, name: item.name }}
                size={images.length > 1 ? 96 : 220}
              />
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
      </div>
      {!compact && (text.trim().length > 0 || attachments.length > 0) && (
        <UserActions text={text} timestamp={message.timestamp} />
      )}
    </div>
  );
});

/** 用户消息操作条：复制（与 DSH 一致，不提供编辑） */
const UserActions = memo(function UserActions({ text, timestamp }: { text: string; timestamp?: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void writeClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }, [text]);

  return (
    <div className={styles.userActions}>
      {timestamp ? <span className={styles.userClock}>{clockLabel(timestamp)}</span> : null}
      <Tooltip label={copied ? '已复制' : '复制'} side="bottom">
        <button
          type="button"
          className={`${styles.iconAction} ${copied ? styles.iconActionDone : ''}`}
          onClick={handleCopy}
          aria-label="复制消息"
        >
          {copied ? <span className={styles.copiedMark}>✓</span> : <IconCopy size={14} />}
        </button>
      </Tooltip>
    </div>
  );
});

/** 用户消息时间标签（DSH 的 clock='start'） */
function clockLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export { formatTokens };
