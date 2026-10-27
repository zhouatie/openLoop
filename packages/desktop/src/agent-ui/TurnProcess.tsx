import React, { memo, useState } from 'react';
import type { SessionChatMessage } from '@openloop/core/types';
import { MessageRow } from './MessageRow';
import { IconChevronDown } from './icons';
import styles from './TurnProcess.module.css';

export interface TurnProcessProps {
  steps: SessionChatMessage[];
  /** 当前轮仍在运行 */
  live?: boolean;
  busy?: boolean;
}

function countTools(steps: SessionChatMessage[]): number {
  return steps.reduce((total, step) => total + (step.tools?.length || 0), 0);
}

/** 一轮里的过程节点：思考与工具调用折叠成一行，点击展开 */
export const TurnProcess = memo(function TurnProcess({ steps, live, busy }: TurnProcessProps) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;

  const tools = countTools(steps);
  const label = busy && live ? '正在处理' : '处理过程';
  const detail = tools > 0 ? `${steps.length} 步 · ${tools} 次工具调用` : `${steps.length} 步`;

  return (
    <div className={styles.root} data-open={open || undefined}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={busy && live ? styles.dotBusy : styles.dot} aria-hidden />
        <span className={styles.label}>{label}</span>
        <span className={styles.detail}>{detail}</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden>
          <IconChevronDown size={12} />
        </span>
      </button>

      {open && (
        <div className={styles.body}>
          {steps.map((step) => (
            <MessageRow key={step.id} message={step} compact />
          ))}
        </div>
      )}
    </div>
  );
});
