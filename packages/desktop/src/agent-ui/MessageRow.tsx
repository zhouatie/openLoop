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
  /** 本地回显：尚未被 Agent 采纳，用略低不透明度表示未送达 */
  pending?: boolean;
  /** 该轮还在运行：操作条等轮次结束后再出现（与 DSH 一致） */
  running?: boolean;
  /** 重新生成该轮回答（后端支持时由挂载方注入） */
  onRegenerate?: () => void;
  /** 从该轮回答分叉出新会话（新会话保留到这条为止） */
  onFork?: () => void;
  /** 分叉入口可见但当前不可用：轮次运行中，或这条还没有落盘条目 */
  forkUnavailable?: boolean;
  /** 正在为这条消息创建分支 */
  forkPending?: boolean;
}

export const MessageRow = memo(function MessageRow({
  message,
  compact,
  pending,
  running,
  onRegenerate,
  onFork,
  forkUnavailable,
  forkPending,
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
    return <UserMessageRow message={message} compact={compact} pending={pending} />;
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

      {!compact && !running && (message.content.trim().length > 0 || onFork || forkUnavailable) && (
        <MessageActions
          text={message.content}
          timestamp={message.timestamp}
          usage={message.usage}
          model={message.model}
          onFork={onFork}
          forkUnavailable={forkUnavailable}
          forkPending={forkPending}
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
  pending,
}: {
  message: SessionChatMessage;
  compact?: boolean;
  pending?: boolean;
}) {
  const { text, images: promptImages } = useMemo(() => splitPromptImages(message.content), [message.content]);
  const attachments = message.attachments || [];
  const images = useMemo(() => {
    const attached = attachments.filter((item) => Boolean(item.url));
    const attachedPaths = new Set(attached.map((item) => item.path));
    return [
      ...attached.map((item) => ({ key: item.id || item.url, url: imageSrc(item.url), name: item.name })),
      // 正文里的图片块只补附件缺失的：两者同时命中就是同一张图被渲染两次
      ...promptImages
        .filter((item) => !attachedPaths.has(item.path))
        .map((item) => ({ key: item.path, url: imageSrc(item.path), name: item.name })),
    ];
  }, [message.attachments, promptImages]);
  const files = attachments.filter((item) => !item.url && !isImagePath(item.path));

  return (
    <div className={styles.userRow}>
      <div className={`${styles.userBubble} ${pending ? styles.userBubblePending : ''}`}>
        {text.trim().length > 0 && <div className={styles.userText}>{text}</div>}
        {images.length > 0 && (
          <div className={styles.imageGrid}>
            {images.map((item) => (
              <ImageThumb
                key={item.key}
                image={{ url: item.url, name: item.name }}
                size={64}
                square
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
      {!compact &&
        (text.trim().length > 0 || attachments.length > 0) && (
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

/** 用户消息时间标签（DSH formatMessageClock）：今天只给 HH:mm，更早的补上日期 */
function clockLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return clock;
  const monthDay = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return sameYear ? `${monthDay} ${clock}` : `${date.getFullYear()} 年 ${monthDay} ${clock}`;
}

export { formatTokens };
