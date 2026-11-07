import React, { useEffect, useRef } from 'react';
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
  const panelRef = useRef<HTMLElement>(null);

  // Esc 关闭抽屉：焦点不在面板内时（刚打开、点了遮罩以外）同样生效；
  // 焦点在面板内时让面板自己的分层 Esc 先处理（双击停止生成、先收瞬时层）
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (panelRef.current?.contains(event.target as Node)) return;
      if (import.meta.env?.DEV) console.log('[AgentSessionDrawerHost] Esc 关闭抽屉:', taskId);
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, taskId]);

  if (!isOpen || !taskId) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={onClose} />
      <aside ref={panelRef} className={styles.panel}>
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
