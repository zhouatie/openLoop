import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionChatMessage } from '@openloop/core/types';
import { MessageRow } from './MessageRow';
import styles from './AgentChatView.module.css';

export interface AgentChatViewProps {
  messages: SessionChatMessage[];
  isBusy?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  /** 内容列最大宽度，整页形态可以更宽 */
  contentWidth?: number;
}

/** 距底部多少像素内仍视为「贴底」，超过则停止自动滚动 */
const STICK_THRESHOLD = 80;

export const AgentChatView = React.memo(function AgentChatView({
  messages,
  isBusy,
  emptyTitle,
  emptyHint,
  contentWidth,
}: AgentChatViewProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const handleScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const stick = distance <= STICK_THRESHOLD;
    stickRef.current = stick;
    setShowJump(!stick);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    stickRef.current = true;
    setShowJump(false);
  }, []);

  const lastMessage = messages[messages.length - 1];
  const lastLength = lastMessage ? lastMessage.content.length + (lastMessage.thinking?.length || 0) : 0;

  // 新消息或流式增量到达时，仅在用户贴底时保持滚动
  useEffect(() => {
    if (!stickRef.current) return;
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length, lastLength]);

  // 首次挂载时直接落到最新位置
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  const contentStyle = useMemo(
    () => (contentWidth ? ({ '--agent-content-width': `${contentWidth}px` } as React.CSSProperties) : undefined),
    [contentWidth]
  );

  const isEmpty = messages.length === 0;

  return (
    <div className={styles.wrap}>
      <div ref={scrollerRef} className={styles.scroller} onScroll={handleScroll}>
        {isEmpty ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>{emptyTitle || '开始一段新的会话'}</div>
            <div className={styles.emptyHint}>
              {emptyHint || '描述目标即可，Agent 会在当前工作区里读写代码、执行命令。'}
            </div>
          </div>
        ) : (
          <div className={styles.content} style={contentStyle}>
            {messages.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
            {isBusy && <div className={styles.busyTail} aria-hidden />}
          </div>
        )}
      </div>

      {showJump && (
        <button type="button" className={styles.jump} onClick={() => scrollToBottom('smooth')}>
          回到最新
        </button>
      )}
    </div>
  );
});
