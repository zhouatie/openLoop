/* 结构取自 deepseek-harness packages/client/ui-chat/src/client/chat/MessageIconActions.tsx（MIT）：
   图标操作行（复制 / 分支）+ 时间；DSH 用 Tooltip 原语包住每个按钮，这里一致。
   额外补充本项目的「重新生成」与用量读数。 */
import { memo, useCallback, useId, useState } from 'react';
import type { SessionUsage } from '@openloop/core/types';
import { IconCopy, IconFork, IconRefresh } from '../icons';
import { TurnUsagePanel } from './TurnUsagePanel';
import { Tooltip } from './Tooltip';
import { writeClipboard } from './clipboard';
import css from './MessageActions.module.css';

/** 与 DSH 同名文案：分叉只对已完成轮次的最后一条消息开放 */
const FORK_UNAVAILABLE = '仅可从已完成轮次的最后一条消息分支';

function clock(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export interface MessageActionsProps {
  text: string;
  timestamp?: number;
  usage?: SessionUsage;
  model?: string;
  onFork?: (() => void) | undefined;
  /** 分叉入口存在但当前不可用（这条还没有落盘条目） */
  forkUnavailable?: boolean;
  /** 正在为这条消息创建分支：图标换成转圈，点击不再触发 */
  forkPending?: boolean;
  onRegenerate?: (() => void) | undefined;
}

/** 回答操作行：左侧图标动作，右侧用量与时间（与 DSH 的顺序一致） */
export const MessageActions = memo(function MessageActions({
  text,
  timestamp,
  usage,
  model,
  onFork,
  forkUnavailable = false,
  forkPending = false,
  onRegenerate,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const forkReasonId = useId();

  const handleCopy = useCallback(() => {
    if (!text.trim()) return;
    void writeClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }, [text]);

  const time = timestamp ? clock(timestamp) : '';
  const showFork = onFork !== undefined || forkUnavailable;

  return (
    <div className={css.actions}>
      <Tooltip label={copied ? '已复制' : '复制'} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={copied ? '已复制' : '复制'}
          onClick={handleCopy}
        >
          {copied ? <span className={css.copied}>✓</span> : <IconCopy size={14} />}
        </button>
      </Tooltip>
      {showFork && (
        <Tooltip
          label={forkPending ? '正在创建分支…' : forkUnavailable ? FORK_UNAVAILABLE : '在新对话中分支'}
          side="bottom"
          openOnClick={forkUnavailable}
        >
          {/* 原生 disabled 按钮收不到 Tooltip 依赖的 hover / focus 事件，因此只置 aria-disabled */}
          <button
            type="button"
            className={css.action}
            aria-label="分叉会话"
            aria-disabled={forkUnavailable || forkPending || undefined}
            aria-describedby={forkUnavailable ? forkReasonId : undefined}
            data-unavailable={forkUnavailable || undefined}
            data-pending={forkPending || undefined}
            onClick={forkUnavailable || forkPending ? undefined : onFork}
          >
            {forkPending ? <span className={css.forkSpin} aria-hidden /> : <IconFork size={14} />}
          </button>
        </Tooltip>
      )}
      {showFork && forkUnavailable && (
        <span id={forkReasonId} className={css.visuallyHidden}>{FORK_UNAVAILABLE}</span>
      )}
      {onRegenerate && (
        <Tooltip label="重新生成" side="bottom">
          <button type="button" className={css.action} aria-label="重新生成" onClick={onRegenerate}>
            <IconRefresh size={14} />
          </button>
        </Tooltip>
      )}
      <span className={css.end}>
        {usage && (usage.totalTokens || 0) > 0 && <TurnUsagePanel usage={usage} model={model} />}
        {time && <span className={css.time}>{time}</span>}
      </span>
    </div>
  );
});

export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
