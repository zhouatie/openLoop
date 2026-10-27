/* 结构取自 deepseek-harness packages/client/ui-chat/src/client/chat/MessageIconActions.tsx（MIT）：
   图标操作行（复制 / 分支）+ 时间；DSH 用 Tooltip 原语包住每个按钮，这里一致。
   额外补充本项目的「重新生成」与用量读数。 */
import { memo, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionUsage } from '@openloop/core/types';
import { IconCopy, IconFork, IconRefresh } from '../icons';
import { TextShimmer } from './TextShimmer';
import { TurnUsagePanel } from './TurnUsagePanel';
import { Tooltip } from './Tooltip';
import { writeClipboard } from './clipboard';
import css from './MessageActions.module.css';

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
  streaming?: boolean;
  onFork?: (() => void) | undefined;
  onRegenerate?: (() => void) | undefined;
}

/** 回答操作行：左侧图标动作，右侧用量与时间（与 DSH 的顺序一致） */
export const MessageActions = memo(function MessageActions({
  text,
  timestamp,
  usage,
  model,
  streaming,
  onFork,
  onRegenerate,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!text.trim()) return;
    void writeClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  }, [text]);

  const time = timestamp ? clock(timestamp) : '';

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
      {onFork && (
        <Tooltip label="在新对话中分支" side="bottom">
          <button type="button" className={css.action} aria-label="分叉会话" onClick={onFork}>
            <IconFork size={14} />
          </button>
        </Tooltip>
      )}
      {onRegenerate && !streaming && (
        <Tooltip label="重新生成" side="bottom">
          <button type="button" className={css.action} aria-label="重新生成" onClick={onRegenerate}>
            <IconRefresh size={14} />
          </button>
        </Tooltip>
      )}
      <span className={css.end}>
        {usage && (usage.totalTokens || 0) > 0 && <TurnUsagePanel usage={usage} model={model} />}
        {streaming && <TextShimmer active className={css.streaming}>生成中</TextShimmer>}
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
