import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SessionChatMessage, SessionUsage } from '@openloop/core/types';
import { MessageRow } from './MessageRow';
import { TurnRail, type TurnRailItem } from './TurnRail';
import { TextShimmer } from './dsh/TextShimmer';
import { Tooltip } from './dsh/Tooltip';
import { IconChevronDown } from './icons';
import { splitPromptImages } from './local-image';
import styles from './AgentChatView.module.css';

export interface AgentChatViewProps {
  messages: SessionChatMessage[];
  isBusy?: boolean;
  /** 本轮开始时间（毫秒），运行中用于显示用时 */
  turnStartedAt?: number;
  /** 上一轮用时（毫秒），结束后显示固定用时 */
  lastTurnDurationMs?: number;
  emptyTitle?: string;
  emptyHint?: string;
  /** 内容列最大宽度，整页形态可以更宽 */
  contentWidth?: number;
  /** 重新生成最后一轮回答 */
  onRegenerate?: () => void;
  /** 从某一轮的用户消息分叉出新会话 */
  onFork?: (entryId: string) => void;
}

/** 距底部多少像素内仍视为「贴底」，超过则停止自动滚动 */
const STICK_THRESHOLD = 80;
/** 内容列窄于该宽度时不显示右侧轮次定位轨 */
const RAIL_MIN_WIDTH = 720;
const PREVIEW_PROMPT_CHARS = 80;
const PREVIEW_RESPONSE_CHARS = 160;

const pad2 = (value: number) => String(value).padStart(2, '0');

/** 日期分隔标签：今天 / 昨天 / 2026 年 10 月 26 日 */
function dayLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  const today = new Date();
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(date)) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function clockLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 用时读数：满 60 秒仍按秒展示，与运行行保持同一种量纲 */
function elapsedLabel(startedAt: number, now: number): string {
  const seconds = Math.max(1, Math.round((now - startedAt) / 1000));
  return `${seconds} 秒`;
}

/** 进行中状态行：DSH 的「用时 N 秒 ···」 */
const RunningStatus = React.memo(function RunningStatus({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={styles.running} role="status" data-chat-running>
      <span className={styles.runningDivider} aria-hidden />
      <span className={styles.runningContent}>
        <span className={styles.runningDot} aria-hidden />
        <TextShimmer active className={styles.runningText}>
          {`用时 ${elapsedLabel(startedAt, now)} ···`}
        </TextShimmer>
      </span>
    </div>
  );
});

/** 结束状态行：本轮结束后保留用时读数，避免运行行消失后读数也随之消失 */
const TurnDuration = React.memo(function TurnDuration({ durationMs }: { durationMs: number }) {
  return (
    <div className={`${styles.running} ${styles.duration}`} role="status" data-chat-duration>
      <span className={styles.runningContent}>
        <span className={styles.runningDot} aria-hidden />
        <span className={styles.runningText}>{`已完成，用时 ${Math.max(1, Math.round(durationMs / 1000))} 秒`}</span>
      </span>
    </div>
  );
});

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 从消息推导出的展示值（日期、定位轨预览）：按消息对象缓存，流式期间每帧都要用 */
interface DerivedRow {
  day: string;
  /** 用户消息的正文预览（图片段已剥离） */
  prompt: string;
  /** 助手消息的正文预览 */
  response: string;
}

const derivedCache = new WeakMap<SessionChatMessage, DerivedRow>();

function derivedRow(message: SessionChatMessage): DerivedRow {
  const cached = derivedCache.get(message);
  if (cached) return cached;
  const row: DerivedRow = {
    day: dayLabel(message.timestamp),
    prompt:
      message.role === 'user'
        ? clip(splitPromptImages(message.content).text || '图片', PREVIEW_PROMPT_CHARS)
        : '',
    response:
      message.role === 'assistant' && message.content.trim().length > 0
        ? clip(message.content, PREVIEW_RESPONSE_CHARS)
        : '',
  };
  derivedCache.set(message, row);
  return row;
}

/** 一轮渲染块：用户消息 + 按顺序平铺的思考/工具/回答 + 用量 */
interface TurnBlock {
  kind: 'turn';
  turn: number;
  day: string;
  user: number | null;
  /** 该轮全部助手消息，按出现顺序平铺渲染（不折叠） */
  steps: number[];
  /** 轮末操作条锚点：该轮最后一条助手消息 */
  tail: number | null;
  usage?: SessionUsage;
  model?: string;
}

interface RowBlock {
  kind: 'row';
  turn: number;
  day: string;
  index: number;
}

type Block = TurnBlock | RowBlock;

/**
 * 把消息流切成「轮」。
 * 用户消息开新一轮；轮内助手消息按顺序平铺，只有轮末那条挂操作条。
 * 与 DSH 一致：思考行和工具行都是流内单行，不做二级折叠。
 * 历史会话没有 turn 字段，轮次由视图层推导。
 */
function buildBlocks(messages: SessionChatMessage[]): { blocks: Block[]; railItems: TurnRailItem[] } {
  const blocks: Block[] = [];
  const railItems: TurnRailItem[] = [];
  let current: TurnBlock | null = null;

  messages.forEach((message, index) => {
    const derived = derivedRow(message);

    if (message.role === 'user') {
      const turn = (current?.turn ?? 0) + 1;
      current = {
        kind: 'turn',
        turn,
        day: derived.day,
        user: index,
        steps: [],
        tail: null,
      };
      blocks.push(current);
      railItems.push({ turn, prompt: derived.prompt, response: '' });
      return;
    }

    if (message.role === 'system') {
      blocks.push({ kind: 'row', turn: current?.turn ?? 0, day: derived.day, index });
      return;
    }

    if (!current) {
      current = {
        kind: 'turn',
        turn: 0,
        day: derived.day,
        user: null,
        steps: [],
        tail: null,
      };
      blocks.push(current);
    }
    const turn = current as TurnBlock;

    turn.steps.push(index);
    turn.tail = index;

    if (derived.response) {
      const rail = railItems[railItems.length - 1];
      if (rail) rail.response = derived.response;
    }
    if (message.usage) turn.usage = message.usage;
    if (message.model) turn.model = message.model;
  });

  return { blocks, railItems };
}

export const AgentChatView = React.memo(function AgentChatView({
  messages,
  isBusy,
  turnStartedAt,
  lastTurnDurationMs,
  emptyTitle,
  emptyHint,
  contentWidth,
  onRegenerate,
  onFork,
}: AgentChatViewProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  /** 未拿到本轮开始时间时的兜底起点（如接入已有进程） */
  const mountAtRef = useRef(Date.now());
  const [showJump, setShowJump] = useState(false);
  const [activeTurn, setActiveTurn] = useState<number>(0);
  const [railVisible, setRailVisible] = useState(false);

  const { blocks, railItems } = useMemo(() => buildBlocks(messages), [messages]);

  const railFrameRef = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const stick = distance <= STICK_THRESHOLD;
    stickRef.current = stick;
    setShowJump((prev) => (prev === !stick ? prev : !stick));

    // 定位轨要读布局（querySelectorAll + offsetTop）：一帧最多算一次，滚动事件再多也不卡
    if (railFrameRef.current !== null) return;
    railFrameRef.current = requestAnimationFrame(() => {
      railFrameRef.current = null;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      // 视口顶部第一个可见轮次即当前轮
      const rows = scroller.querySelectorAll<HTMLElement>('[data-turn]');
      const edge = scroller.scrollTop + 80;
      let current = 0;
      for (const row of rows) {
        if (row.offsetTop <= edge) current = Number(row.dataset.turn) || current;
        else break;
      }
      setActiveTurn((prev) => (prev === current ? prev : current));
    });
  }, []);

  useEffect(
    () => () => {
      if (railFrameRef.current !== null) cancelAnimationFrame(railFrameRef.current);
    },
    []
  );

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
  const lastUserId = lastMessage?.role === 'user' ? lastMessage.id : null;

  /**
   * 自己刚发出的消息必须立刻可见（DSH 的 ownInput → followTail）。
   * 用户此前在翻历史、或输入卡变高把视口顶离底部时，贴底标记会是 false，
   * 新消息就会停在输入卡后面看不见；这里在绘制前无条件贴底。
   */
  const followedUserIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!lastUserId || lastUserId === followedUserIdRef.current) return;
    followedUserIdRef.current = lastUserId;
    scrollToBottom();
  }, [lastUserId, scrollToBottom]);

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

  // 内容高度变化（工具输出、图片、代码高亮等不改变正文字数的异步布局）同样保持贴底，
  // 否则只在 messages.length/lastLength 变化时贴底会让最新内容被输入卡切掉一截。
  useEffect(() => {
    const node = scrollerRef.current;
    const content = contentRef.current;
    if (!node || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!stickRef.current) return;
      node.scrollTop = node.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
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

  // 分叉锚点是该轮用户消息的 pi 条目 id
  const forkEntryIdOf = useCallback(
    (block: TurnBlock): string | undefined => {
      if (block.user === null) return undefined;
      return messages[block.user]?.entryId;
    },
    [messages]
  );

  const isEmpty = messages.length === 0;
  const lastTurn = blocks.length > 0 ? blocks[blocks.length - 1] : undefined;

  // 本轮开始时间：优先用服务端记录的轮次起点，其次退回最后一条用户消息的时间
  const lastUserAt = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user' && messages[index].timestamp > 0) return messages[index].timestamp;
    }
    return undefined;
  }, [messages]);
  const runningStartedAt = turnStartedAt ?? lastUserAt ?? mountAtRef.current;
  /** 已结束且本轮出过回答时显示固定用时；用户消息刚发出但未出结果时不显示旧读数 */
  const showDuration =
    !isBusy &&
    typeof lastTurnDurationMs === 'number' &&
    lastTurnDurationMs > 0 &&
    lastTurn?.kind === 'turn' &&
    lastTurn.tail !== null;

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <div
        ref={scrollerRef}
        className={`${styles.scroller} ${isEmpty && isBusy ? styles.awaitingFirst : ''}`}
        onScroll={handleScroll}
      >
        {isEmpty && !isBusy ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>{emptyTitle || '开始一段新的会话'}</div>
            <div className={styles.emptyHint}>
              {emptyHint || '描述目标即可，Agent 会在当前工作区里读写代码、执行命令。'}
            </div>
          </div>
        ) : (
          <div ref={contentRef} className={styles.content} style={contentStyle}>
            {blocks.map((block, blockIndex) => {
              const previousDay = blockIndex > 0 ? blocks[blockIndex - 1].day : '';
              const separator =
                block.day && block.day !== previousDay ? (
                  <div className={styles.daySeparator} key={`day-${block.day}-${blockIndex}`}>
                    <span className={styles.dayLine} />
                    <span className={styles.dayText}>{block.day}</span>
                    <span className={styles.dayLine} />
                  </div>
                ) : null;

              if (block.kind === 'row') {
                return (
                  <React.Fragment key={`row-${block.index}`}>
                    {separator}
                    <div data-turn={block.turn || undefined}>
                      <MessageRow message={messages[block.index]} />
                    </div>
                  </React.Fragment>
                );
              }

              const isLiveTurn = block === lastTurn;
              const forkEntryId = forkEntryIdOf(block);
              return (
                <React.Fragment key={`turn-${block.turn}-${blockIndex}`}>
                {separator}
                <div className={styles.turn} data-turn={block.turn || undefined}>
                  {block.user !== null && (
                    <MessageRow message={messages[block.user]} />
                  )}
                  {block.steps.map((index) => {
                    const isTail = index === block.tail;
                    return (
                      <MessageRow
                        key={`m-${index}`}
                        message={messages[index]}
                        compact={!isTail}
                        onRegenerate={isTail && isLiveTurn && onRegenerate ? onRegenerate : undefined}
                        onFork={isTail && forkEntryId && onFork ? () => onFork(forkEntryId) : undefined}
                      />
                    );
                  })}
                </div>
                </React.Fragment>
              );
            })}
            {/* 状态行固定在流转尾部：与最后一块是会话轮还是系统行无关 */}
            {isBusy ? (
              <RunningStatus startedAt={runningStartedAt} />
            ) : showDuration && lastTurnDurationMs !== undefined ? (
              <TurnDuration durationMs={lastTurnDurationMs} />
            ) : null}
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
        <div className={styles.jumpSlot}>
          <Tooltip label="回到底部" side="top">
            <button
              type="button"
              className={styles.jump}
              aria-label="回到底部"
              onClick={() => scrollToBottom('smooth')}
            >
              <IconChevronDown size={14} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
});
