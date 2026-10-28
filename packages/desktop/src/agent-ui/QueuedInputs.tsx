import React from 'react';
import type { PendingUserInput } from '@openloop/core/types';
import { Tooltip } from './dsh/Tooltip';
import { IconEdit, IconQueue, IconTrash } from './icons';
import styles from './QueuedInputs.module.css';

export interface QueuedInputsProps {
  /** 已提交、等待 Agent 采纳的插话：贴在输入卡上方，不混进会话流 */
  items: PendingUserInput[];
  onEdit?: (item: PendingUserInput) => void;
  onWithdraw?: (item: PendingUserInput) => void;
}

/**
 * 排队消息条（对齐 DSH 的 QueueDock）
 *
 * 会话运行中发出的消息先在 pi 的队列里等这一步结束，
 * 放在输入卡上方与消息区分开，避免同一句话在会话流里出现两次。
 * 只有 pi 已确认收进队列的条目才可编辑或撤回。
 */
export const QueuedInputs = React.memo(function QueuedInputs({
  items,
  onEdit,
  onWithdraw,
}: QueuedInputsProps) {
  if (items.length === 0) return null;

  return (
    <div className={styles.dock} data-agent-queued>
      <div className={styles.panel} role="list" aria-label="排队中的消息">
        {items.map((item) => {
          const ready = item.queued === true;
          const text = item.content.replace(/\s+/g, ' ').trim();
          return (
            <div key={item.id} className={styles.row} role="listitem">
              <span className={styles.lead} aria-hidden>
                <IconQueue size={14} />
              </span>
              <span className={styles.preview} title={text}>
                {text}
              </span>
              {ready ? (
                <div className={styles.actions}>
                  <Tooltip label="编辑后重发" side="top">
                    <button
                      type="button"
                      className={styles.action}
                      onClick={() => onEdit?.(item)}
                      aria-label="编辑这条排队消息"
                    >
                      <IconEdit size={14} />
                    </button>
                  </Tooltip>
                  <Tooltip label="撤回" side="top">
                    <button
                      type="button"
                      className={styles.action}
                      onClick={() => onWithdraw?.(item)}
                      aria-label="撤回这条排队消息"
                    >
                      <IconTrash size={14} />
                    </button>
                  </Tooltip>
                </div>
              ) : (
                <>
                  <span className={styles.status} role="status">
                    发送中
                  </span>
                  <div className={styles.actions}>
                    <button type="button" className={styles.action} disabled aria-label="编辑这条排队消息">
                      <IconEdit size={14} />
                    </button>
                    <button type="button" className={styles.action} disabled aria-label="撤回这条排队消息">
                      <IconTrash size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
