/* 取自 deepseek-harness packages/client/ui-chat/src/client/chat/TurnUsagePanel.tsx（MIT）：
   去掉 t() 词典，改成本项目中文文案；数据字段对齐 SessionUsage（input /
   output / cacheRead / cacheWrite / totalTokens / cost）。 */
import { createPortal } from 'react-dom';
import { IconDatabase } from '../icons';
import type { SessionUsage } from '@openloop/core/types';
import { formatTokens } from './MessageActions';
import { MEASURE_STYLE, useStatDialog } from './stat-dialog';
import css from './TurnUsagePanel.module.css';
import dialogCss from './stat-dialog.module.css';

/** 精确计数：带千分位，不缩写 */
function exact(value: number): string {
  return value.toLocaleString('en-US');
}

/** 缓存命中率：命中 token / 输入侧总量 */
function cacheHitPercent(cacheRead: number, inputTotal: number): number | null {
  if (!inputTotal || inputTotal <= 0) return null;
  return Math.round((cacheRead / inputTotal) * 1000) / 10;
}

export interface TurnUsagePanelProps {
  usage: SessionUsage;
  model?: string;
}

/** 本轮用量药丸：点击展开用量明细对话框 */
export function TurnUsagePanel({ usage, model }: TurnUsagePanelProps) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog();

  const total = usage.totalTokens || 0;
  const output = usage.output || 0;
  const cacheRead = usage.cacheRead || 0;
  const cacheWrite = usage.cacheWrite || 0;
  const inputTotal = Math.max(0, total - output);
  const cacheHit = cacheRead > 0 ? cacheHitPercent(cacheRead, inputTotal) : null;
  const uncachedInput = Math.max(0, inputTotal - cacheRead);

  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <IconDatabase />
        <span className={css.label}>{`用量 ${formatTokens(total)} tok`}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={`agent-scope ${dialogCss.panel}`}
            role="dialog"
            aria-label="用量明细"
            data-agent-transient
            style={pos ?? MEASURE_STYLE}
          >
            <div className={dialogCss.title}>
              <span className={dialogCss.titleLabel}>
                <IconDatabase size={14} />
                用量明细
              </span>
              <span className={dialogCss.titleValue}>{exact(total)}</span>
            </div>
            <div className={dialogCss.titleRule} aria-hidden />
            <dl className={dialogCss.details} data-turn-usage-details>
              {model && (
                <>
                  <dt>模型</dt>
                  <dd className={dialogCss.route}>{model}</dd>
                </>
              )}
              {cacheHit !== null && (
                <>
                  <dt>缓存命中</dt>
                  <dd>{`${cacheHit}%`}</dd>
                </>
              )}
              <dt>输入</dt>
              <dd>{exact(uncachedInput)}</dd>
              {cacheRead > 0 && (
                <>
                  <dt>缓存读取</dt>
                  <dd>{exact(cacheRead)}</dd>
                </>
              )}
              {cacheWrite > 0 && (
                <>
                  <dt>缓存写入</dt>
                  <dd>{exact(cacheWrite)}</dd>
                </>
              )}
              <dt>输出</dt>
              <dd>{exact(output)}</dd>
              {usage.cost ? (
                <>
                  <dt>费用</dt>
                  <dd>{`$${usage.cost.toFixed(4)}`}</dd>
                </>
              ) : null}
            </dl>
          </div>,
          document.body
        )}
    </span>
  );
}
