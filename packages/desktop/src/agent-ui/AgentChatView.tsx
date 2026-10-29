import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PendingUserInput, SessionChatMessage, SessionUsage } from '@openloop/core/types';
import { MessageRow } from './MessageRow';
import { TurnRail, type TurnRailItem } from './TurnRail';
import { TextShimmer } from './dsh/TextShimmer';
import { Tooltip } from './dsh/Tooltip';
import { IconChevronDown } from './icons';
import { splitPromptImages } from './local-image';
import styles from './AgentChatView.module.css';

export interface AgentChatViewProps {
  messages: SessionChatMessage[];
  /** 已提交、等待 Agent 采纳的用户输入：只有起新一轮的条目在流尾部显示，插话走输入卡上方的排队条 */
  pendingInputs?: PendingUserInput[];
  isBusy?: boolean;
  /** 会话标识：切换会话时落回最新消息（DSH 打开会话即 followTail） */
  sessionKey?: string;
  /** 该会话的历史还在加载：先保留上一段内容，等新内容就绪后一次性贴底替换 */
  loading?: boolean;
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
  /** 从某一轮回答分叉出新会话（新会话保留到这条为止） */
  onFork?: (entryId: string) => void;
  /** 正在创建分支的条目 id：该行的分叉图标显示转圈 */
  forkPendingEntryId?: string | null;
}

/** 距底部多少像素内仍视为「贴底」，超过则停止自动滚动 */
const STICK_THRESHOLD = 80;
/** 内容列窄于该宽度时不显示右侧轮次定位轨 */
const RAIL_MIN_WIDTH = 720;
const PREVIEW_PROMPT_CHARS = 80;
const PREVIEW_RESPONSE_CHARS = 160;
/**
 * 首屏只挂最近这些消息行：会话切换时不必等整段历史都进 DOM。
 * 更早的消息留在数据里，由顶部「更早的消息」按页挂回来。
 */
const INITIAL_ROWS = 40;
const ROWS_PER_PAGE = 80;

/** 默认空回显列表：避免每次渲染新建数组，让 memo 不失效 */
const EMPTY_PENDING: PendingUserInput[] = [];

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

/** 从消息推导出的展示值（定位轨预览）：按消息对象缓存，流式期间每帧都要用 */
interface DerivedRow {
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
        user: index,
        steps: [],
        tail: null,
      };
      blocks.push(current);
      railItems.push({ turn, prompt: derived.prompt, response: '' });
      return;
    }

    if (message.role === 'system') {
      blocks.push({ kind: 'row', turn: current?.turn ?? 0, index });
      return;
    }

    if (!current) {
      current = {
        kind: 'turn',
        turn: 0,
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

/** 取窗口内的块：窗口永远是消息流的后缀，轮块只保留窗口内的步骤 */
function sliceBlocks(blocks: Block[], fromIndex: number): Block[] {
  if (fromIndex <= 0) return blocks;
  const visible: Block[] = [];
  for (const block of blocks) {
    if (block.kind === 'row') {
      if (block.index >= fromIndex) visible.push(block);
      continue;
    }
    const user = block.user !== null && block.user >= fromIndex ? block.user : null;
    const steps = block.steps.filter((index) => index >= fromIndex);
    if (user === null && steps.length === 0) continue;
    visible.push({ ...block, user, steps });
  }
  return visible;
}

export const AgentChatView = React.memo(function AgentChatView({
  messages,
  isBusy,
  sessionKey,
  loading,
  turnStartedAt,
  lastTurnDurationMs,
  emptyTitle,
  emptyHint,
  contentWidth,
  onRegenerate,
  onFork,
  forkPendingEntryId = null,
  pendingInputs = EMPTY_PENDING,
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

  /**
   * 切换会话时历史是异步加载的：加载期间继续显示上一段内容（冻结），新会话就绪后一次性替换。
   * 既不留空白帧，也不会把半截新内容按旧的滚动位置先画出来。
   */
  const frozenRef = useRef(messages);
  if (!loading) frozenRef.current = messages;
  const shown = loading ? frozenRef.current : messages;

  const { blocks, railItems } = useMemo(() => buildBlocks(shown), [shown]);

  /** 已向前展开的消息条数：切换会话时归零，回到「只看最新一屏」 */
  const [revealCount, setRevealCount] = useState(0);
  const [revealKey, setRevealKey] = useState(sessionKey);
  if (revealKey !== sessionKey) {
    setRevealKey(sessionKey);
    if (revealCount !== 0) setRevealCount(0);
  }
  const fromIndex = Math.max(0, shown.length - INITIAL_ROWS - revealCount);
  const visibleBlocks = useMemo(() => sliceBlocks(blocks, fromIndex), [blocks, fromIndex]);

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

  /**
   * 会话就绪即落到最新消息。
   * 历史是异步到达的，贴底必须在新内容进入 DOM 的这一帧、绘制前完成；
   * 早于内容到达（上一段内容还在）或晚于绘制（先画顶部再跳尾部）都会闪一下。
   */
  const followedUserIdRef = useRef<string | null>(null);
  const landedKeyRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (loading || landedKeyRef.current === sessionKey) return;
    landedKeyRef.current = sessionKey;
    followedUserIdRef.current = null;
    if (import.meta.env.DEV) console.log('[AgentChatView] 会话就绪，落到最新消息:', sessionKey);
    scrollToBottom();
  }, [loading, sessionKey, shown, scrollToBottom]);

  const lastMessage = shown[shown.length - 1];
  const lastLength = lastMessage ? lastMessage.content.length + (lastMessage.thinking?.length || 0) : 0;
  const lastUserId = lastMessage?.role === 'user' ? lastMessage.id : null;

  /**
   * 本地回显刚出现时必须可见（DSH 的 ownInput → followTail）。
   * 只跟随新增，回显被采纳消失时不动滚动位置，避免内容上移。
   */
  const followedPendingRef = useRef<string | null>(null);
  const lastPendingId = pendingInputs.length > 0 ? pendingInputs[pendingInputs.length - 1].id : null;
  useLayoutEffect(() => {
    if (!lastPendingId || lastPendingId === followedPendingRef.current) return;
    followedPendingRef.current = lastPendingId;
    scrollToBottom();
  }, [lastPendingId, scrollToBottom]);

  /**
   * 自己刚发出的消息必须立刻可见（DSH 的 ownInput → followTail）。
   * 用户此前在翻历史、或输入卡变高把视口顶离底部时，贴底标记会是 false，
   * 新消息就会停在输入卡后面看不见；这里在绘制前无条件贴底。
   */
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
  }, [shown.length, lastLength]);

  // 首次挂载时直接落到最新位置
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  // 内容高度变化（工具输出、图片、代码高亮等不改变正文字数的异步布局）同样保持贴底，
  // 否则只在 messages.length/lastLength 变化时贴底会让最新内容被输入卡切掉一截。
  // 视口高度变化（切换会话恢复草稿、输入卡变高）也要补一次贴底，否则末尾会被切掉。
  useEffect(() => {
    const node = scrollerRef.current;
    const content = contentRef.current;
    if (!node || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!stickRef.current) return;
      node.scrollTop = node.scrollHeight;
    });
    observer.observe(content);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /** 展开更早的消息：新内容插在上方，展开后把视口留在原处 */
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const revealOlder = useCallback((count: number) => {
    const node = scrollerRef.current;
    anchorRef.current = node ? { height: node.scrollHeight, top: node.scrollTop } : null;
    stickRef.current = false;
    setRevealCount((prev) => prev + count);
  }, []);

  /** 定位轨点到的轮次可能还在窗口外：先展开，等渲染完再滚过去 */
  const pendingTurnRef = useRef<number | null>(null);
  const jumpToTurn = useCallback(
    (turn: number) => {
      const target = blocks.find((block) => block.turn === turn);
      const first =
        target === undefined
          ? undefined
          : target.kind === 'row'
            ? target.index
            : target.user ?? target.steps[0];
      if (first !== undefined && first < fromIndex) {
        pendingTurnRef.current = turn;
        setRevealCount((prev) => prev + (fromIndex - first));
        return;
      }
      const node = scrollerRef.current;
      if (!node) return;
      const row = node.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
      if (!row) return;
      stickRef.current = false;
      node.scrollTo({ top: row.offsetTop - 20, behavior: 'smooth' });
    },
    [blocks, fromIndex]
  );

  // 窗口变化后收尾：优先落到待定位的轮次，否则把视口留在展开前看到的内容上
  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const turn = pendingTurnRef.current;
    if (turn !== null) {
      pendingTurnRef.current = null;
      anchorRef.current = null;
      const row = node.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
      if (!row) return;
      stickRef.current = false;
      node.scrollTo({ top: row.offsetTop - 20, behavior: 'smooth' });
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    node.scrollTop = anchor.top + (node.scrollHeight - anchor.height);
  }, [fromIndex]);

  const contentStyle = useMemo(
    () => (contentWidth ? ({ '--agent-content-width': `${contentWidth}px` } as React.CSSProperties) : undefined),
    [contentWidth]
  );

  const isEmpty = shown.length === 0;
  const lastTurn = visibleBlocks.length > 0 ? visibleBlocks[visibleBlocks.length - 1] : undefined;

  // 本轮开始时间：优先用服务端记录的轮次起点，其次退回最后一条用户消息的时间
  const lastUserAt = useMemo(() => {
    for (let index = shown.length - 1; index >= 0; index -= 1) {
      if (shown[index].role === 'user' && shown[index].timestamp > 0) return shown[index].timestamp;
    }
    return undefined;
  }, [shown]);
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
        {isEmpty && !isBusy && !loading ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>{emptyTitle || '开始一段新的会话'}</div>
            <div className={styles.emptyHint}>
              {emptyHint || '描述目标即可，Agent 会在当前工作区里读写代码、执行命令。'}
            </div>
          </div>
        ) : (
          <div ref={contentRef} className={styles.content} style={contentStyle}>
            {fromIndex > 0 && (
              <button
                type="button"
                className={styles.more}
                onClick={() => revealOlder(Math.min(ROWS_PER_PAGE, fromIndex))}
              >
                {`显示更早的 ${Math.min(ROWS_PER_PAGE, fromIndex)} 条消息`}
              </button>
            )}
            {visibleBlocks.map((block) => {
              if (block.kind === 'row') {
                return (
                  <React.Fragment key={`row-${block.index}`}>
                    <div data-turn={block.turn || undefined}>
                      <MessageRow message={shown[block.index]} />
                    </div>
                  </React.Fragment>
                );
              }

              const isLiveTurn = block === lastTurn;
              return (
                <React.Fragment key={`turn-${block.turn}`}>
                <div className={styles.turn} data-turn={block.turn || undefined}>
                  {block.user !== null && (
                    <MessageRow message={shown[block.user]} />
                  )}
                  {block.steps.map((index) => {
                    const isTail = index === block.tail;
                    // 分叉锚点是这条回答本身：新会话保留到这条为止，源会话不动。
                    // 该行还没有落盘条目时不隐藏按钮，只置灰并说明原因（与 DSH 一致）。
                    const forkEntryId = isTail ? shown[index]?.entryId : undefined;
                    // 运行中整行操作条不出现（DSH 的轮末操作条只在轮次收尾后渲染）
                    const canFork = Boolean(forkEntryId) && Boolean(onFork);
                    return (
                      <MessageRow
                        key={`m-${index}`}
                        message={shown[index]}
                        compact={!isTail}
                        running={isBusy && isLiveTurn && isTail}
                        onRegenerate={isTail && isLiveTurn && onRegenerate ? onRegenerate : undefined}
                        onFork={
                          isTail && canFork && forkEntryId && onFork
                            ? () => onFork(forkEntryId)
                            : undefined
                        }
                        forkUnavailable={isTail && Boolean(onFork) && !canFork}
                        forkPending={isTail && Boolean(forkEntryId) && forkPendingEntryId === forkEntryId}
                      />
                    );
                  })}
                </div>
                </React.Fragment>
              );
            })}
            {/* 本地回显：本次提交已起新一轮，按普通消息直接插入，pi 采纳后由会话流接管 */}
            {pendingInputs.map((input) =>
              input.placement === 'steering' ? null : (
                <MessageRow
                  key={input.id}
                  message={{
                    id: input.id,
                    role: 'user',
                    content: input.content,
                    attachments: input.attachments,
                    timestamp: input.createdAt,
                  }}
                  pending
                />
              )
            )}
            {/* 状态行固定在流转尾部，与最后一块是会话轮还是系统行无关；切换会话加载期间不追加到上一段内容下 */}
            {loading ? null : isBusy ? (
              <RunningStatus startedAt={runningStartedAt} />
            ) : showDuration && lastTurnDurationMs !== undefined ? (
              <TurnDuration durationMs={lastTurnDurationMs} />
            ) : null}
            {isBusy && !loading && <div className={styles.busyTail} aria-hidden />}
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
