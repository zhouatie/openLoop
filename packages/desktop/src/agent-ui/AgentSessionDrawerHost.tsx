import React from 'react';
import { TaskAgentPanel } from './AgentPanel';
import styles from './AgentSessionDrawerHost.module.css';

export interface AgentSessionDrawerHostProps {
  isOpen: boolean;
  onClose: () => void;
  taskId?: string | null;
  taskTitle?: string;
}

/** 抽屉外壳：只负责遮罩、宽度与进出场，内容仍是同一个 AgentPanel */
export function AgentSessionDrawerHost({
  isOpen,
  onClose,
  taskId,
  taskTitle,
}: AgentSessionDrawerHostProps) {
  if (!isOpen || !taskId) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.panel}>
        <TaskAgentPanel
          taskId={taskId}
          taskTitle={taskTitle || 'Agent 会话'}
          mode="drawer"
          onClose={onClose}
        />
      </aside>
    </div>
  );
}
