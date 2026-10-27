import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionChatMessage, SessionUsage } from '@openloop/core/types';
import { MessageRow, formatTokens } from './MessageRow';
import { TurnProcess } from './TurnProcess';
import { TurnRail, type TurnRailItem } from './TurnRail';
import styles from './AgentChatView.module.css';

export interface AgentChatViewProps {
  messages: SessionChatMessage[];
  isBusy?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  /** 内容列最大宽度，整页形态可以更宽 */
  contentWidth?: number;
  /** 重新生成最后一轮回答 */
  onRegenerate?: () => void;
}

/** 距底部多少像素内仍视为「贴底」，超过则停止自动滚动 */
const STICK_THRESHOLD = 80;
/** 内容列窄于该宽度时不显示右侧轮次定位轨 */
const RAIL_MIN_WIDTH = 720;
const PREVIEW_PROMPT_CHARS = 80;
const PREVIEW_RESPONSE_CHARS = 160;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 一轮渲染块：用户消息 + 过程折叠 + 最终回答 + 用量 */
interface TurnBlock {
  kind: 'turn';
  turn: number;
  user: number | null;
  steps: number[];
  answer: number | null;
  usage?: SessionUsage;
  model?: string;
}

interface RowBlock {
  kind: 'row';
  turn: number;
  index: number;
}

type Block = TurnBlock | RowBlock;

/**
 * 把消息流切成「轮」。
 * 用户消息开新一轮；同轮中除最后一条有正文的助手消息外，其余都归入过程折叠。
 * 历史会话没有 turn 字段，轮次由视图层推导。
 */
function buildBlocks(messages: SessionChatMessage[]): { blocks: Block[]; railItems: TurnRailItem[] } {
  const blocks: Block[] = [];
  const railItems: TurnRailItem[] = [];
  let current: TurnBlock | null = null;

  messages.forEach((message, index) => {
    if (message.role === 'user') {
      const turn = (current?.turn ?? 0) + 1;
      current = { kind: 'turn', turn, user: index, steps: [], answer: null };
      blocks.push(current);
      railItems.push({ turn, prompt: clip(message.content, PREVIEW_PROMPT_CHARS), response: '' });
      return;
    }

    if (message.role === 'system') {
      blocks.push({ kind: 'row', turn: current?.turn ?? 0, index });
      return;
    }

    if (!current) {
      current = { kind: 'turn', turn: 0, user: null, steps: [], answer: null };
      blocks.push(current);
    }
    const turn = current as TurnBlock;

    if (message.content.trim()) {
      if (turn.answer !== null) turn.steps.push(turn.answer);
      turn.answer = index;
      const rail = railItems[railItems.length - 1];
      if (rail) rail.response = clip(message.content, PREVIEW_RESPONSE_CHARS);
    } else {
      turn.steps.push(index);
    }
    if (message.usage) turn.usage = message.usage;
    if (message.model) turn.model = message.model;
  });

  return { blocks, railItems };
}

export const AgentChatView = React.memo(function AgentChatView({
  messages,
  isBusy,
  emptyTitle,
  emptyHint,
  contentWidth,
  onRegenerate,
}: AgentChatViewProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [activeTurn, setActiveTurn] = useState<number>(0);
  const [railVisible, setRailVisible] = useState(false);

  const { blocks, railItems } = useMemo(() => buildBlocks(messages), [messages]);

  const handleScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const stick = distance <= STICK_THRESHOLD;
    stickRef.current = stick;
    setShowJump(!stick);

    // 视口顶部第一个可见轮次即当前轮
    const rows = node.querySelectorAll<HTMLElement>('[data-turn]');
    const edge = node.scrollTop + 80;
    let current = 0;
    for (const row of rows) {
      if (row.offsetTop <= edge) current = Number(row.dataset.turn) || current;
      else break;
    }
    setActiveTurn((prev) => (prev === current ? prev : current));
  }, []);

  // 面板宽度不足时收起定位轨
  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width || 0;
      setRailVisible(width >= RAIL_MIN_WIDTH);
    });
    observer.observe(node);
    return () => observer.disconnect();
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

  const jumpToTurn = useCallback((turn: number) => {
    const node = scrollerRef.current;
    if (!node) return;
    const row = node.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
    if (!row) return;
    stickRef.current = false;
    node.scrollTo({ top: row.offsetTop - 20, behavior: 'smooth' });
  }, []);

  const contentStyle = useMemo(
    () => (contentWidth ? ({ '--agent-content-width': `${contentWidth}px` } as React.CSSProperties) : undefined),
    [contentWidth]
  );

  const isEmpty = messages.length === 0;
  const lastTurn = blocks.length > 0 ? blocks[blocks.length - 1] : undefined;

  return (
    <div ref={wrapRef} className={styles.wrap}>
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
            {blocks.map((block, blockIndex) => {
              if (block.kind === 'row') {
                return (
                  <div key={`row-${block.index}`} data-turn={block.turn || undefined}>
                    <MessageRow message={messages[block.index]} />
                  </div>
                );
              }

              const isLiveTurn = block === lastTurn;
              return (
                <div
                  key={`turn-${block.turn}-${blockIndex}`}
                  className={styles.turn}
                  data-turn={block.turn || undefined}
                >
                  {block.user !== null && <MessageRow message={messages[block.user]} />}
                  <TurnProcess
                    steps={block.steps.map((index) => messages[index])}
                    live={isLiveTurn}
                    busy={isBusy}
                  />
                  {block.answer !== null && (
                    <MessageRow
                      message={messages[block.answer]}
                      onRegenerate={isLiveTurn && onRegenerate ? onRegenerate : undefined}
                    />
                  )}
                  {isLiveTurn && isBusy && block.answer === null && block.steps.length === 0 && (
                    <div className={styles.waiting}>
                      <span className={styles.waitingDot} aria-hidden />
                      正在处理…
                    </div>
                  )}
                  {block.usage && (
                    <div className={styles.turnFooter}>
                      {block.usage.totalTokens ? `${formatTokens(block.usage.totalTokens)} tokens` : ''}
                      {block.usage.cost ? ` · $${block.usage.cost.toFixed(4)}` : ''}
                    </div>
                  )}
                </div>
              );
            })}
            {isBusy && <div className={styles.busyTail} aria-hidden />}
          </div>
        )}
      </div>

      <TurnRail
        items={railItems}
        activeTurn={activeTurn}
        visible={railVisible && !isEmpty}
        onJump={jumpToTurn}
      />

      {showJump && (
        <button type="button" className={styles.jump} onClick={() => scrollToBottom('smooth')}>
          回到最新
        </button>
      )}
    </div>
  );
});
