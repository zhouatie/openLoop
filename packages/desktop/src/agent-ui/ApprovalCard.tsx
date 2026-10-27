import React, { memo } from 'react';
import styles from './ApprovalCard.module.css';

export interface AgentUiRequest {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor';
  sessionId: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  timeout?: number;
}

export interface ApprovalCardProps {
  request: AgentUiRequest;
  onRespond: (payload: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}

/** 审批卡：pi 扩展 UI 请求的确认 / 选择交互 */
export const ApprovalCard = memo(function ApprovalCard({ request, onRespond }: ApprovalCardProps) {
  const options = request.options && request.options.length > 0 ? request.options : ['允许', '拒绝'];

  return (
    <div className={styles.card} role="dialog" aria-label={request.title || '需要确认'}>
      <div className={styles.head}>
        <span className={styles.badge}>需要确认</span>
        <span className={styles.title}>{request.title || 'Agent 请求继续'}</span>
      </div>
      {request.message && <div className={styles.message}>{request.message}</div>}
      <div className={styles.actions}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={styles.action}
            onClick={() =>
              request.method === 'confirm'
                ? onRespond({ confirmed: /^(允许|Allow|Yes|确认)/i.test(option) })
                : onRespond({ value: option })
            }
          >
            {option}
          </button>
        ))}
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => onRespond({ cancelled: true })}
          title="忽略该请求"
        >
          忽略
        </button>
      </div>
    </div>
  );
});
