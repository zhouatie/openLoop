/* 取自 deepseek-harness packages/client/ui-primitives/src/CodeToolbar.tsx（MIT）：
   语言标签 + 折行/复制图标按钮（Tooltip 包住）。语言标签沿用 DSH 规则：能高亮的
   hint 原样显示，否则回落到「代码」。 */
import { IconCheck, IconCopy, IconNoWrap, IconWrap } from '../icons';
import { supportsHighlighting } from './highlight';
import { Tooltip } from './Tooltip';
import css from './CodeCard.module.css';

/** 卡片宿主提供的中文文案 */
export interface CodeToolbarLabels {
  /** 未知语言时的标题 */
  codeLabel: string;
  /** 开启折行的按钮文案 */
  wrapLabel: string;
  /** 关闭折行的按钮文案 */
  unwrapLabel: string;
}

interface CodeToolbarProps {
  lang?: string | undefined;
  title?: string | undefined;
  status?: string | undefined;
  labels: CodeToolbarLabels;
  copyLabel: string;
  copiedLabel: string;
  copied: boolean;
  wrapped: boolean;
  onCopy?: (() => void) | undefined;
  onWrap?: (() => void) | undefined;
}

/** 代码卡头部：语言标签 + 折行、复制图标操作 */
export function CodeToolbar({
  lang,
  title,
  status,
  labels,
  copyLabel,
  copiedLabel,
  copied,
  wrapped,
  onCopy,
  onWrap,
}: CodeToolbarProps) {
  const wrapLabel = wrapped ? labels.unwrapLabel : labels.wrapLabel;
  const clipboardLabel = copied ? copiedLabel : copyLabel;
  return (
    <div className={css.header} data-code-block-banner>
      <div className={css.heading}>
        <span className={css.language}>{supportsHighlighting(lang) ? lang : labels.codeLabel}</span>
        {title !== undefined && (
          <span className={css.title} title={title}>
            {title}
          </span>
        )}
      </div>
      <div className={css.actions}>
        {status !== undefined && <span className={css.status}>{status}</span>}
        {onWrap !== undefined && (
          <Tooltip label={wrapLabel} side="top" portal>
            <button
              type="button"
              className={css.action}
              aria-label={labels.wrapLabel}
              aria-pressed={wrapped}
              onClick={onWrap}
            >
              {wrapped ? <IconNoWrap size={14} /> : <IconWrap size={14} />}
            </button>
          </Tooltip>
        )}
        {onCopy !== undefined && (
          <Tooltip label={clipboardLabel} side="top" portal>
            <button
              type="button"
              className={css.action}
              aria-label={clipboardLabel}
              onClick={onCopy}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
