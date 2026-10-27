import React, { memo, useEffect } from 'react';
import { useShortcuts } from '../context/ShortcutContext';
import { SHORTCUT_COMMANDS } from '../constants/agentShortcuts';
import styles from './ShortcutSheet.module.css';

interface ShortcutSheetProps {
  onClose: () => void;
}

const GROUP_LABEL: Record<string, string> = {
  chat: '对话',
  panel: '面板与工作区',
};

const FIXED_ROWS: Array<{ label: string; keys: string[] }> = [
  { label: '发送消息', keys: ['Enter'] },
  { label: '换行', keys: ['Shift', 'Enter'] },
  { label: '关闭菜单 / 面板', keys: ['Esc'] },
  { label: '指令菜单', keys: ['/'] },
  { label: '引用文件', keys: ['@'] },
  { label: '菜单导航', keys: ['↑', '↓'] },
  { label: '审批卡：允许 / 拒绝', keys: ['Enter', 'Esc'] },
];

/** 面板内快捷键速查弹层，数据来自命令表与当前绑定 */
export const ShortcutSheet = memo(({ onClose }: ShortcutSheetProps) => {
  const { describeShortcut, superKeySymbol } = useShortcuts();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = ['chat', 'panel'] as const;

  return (
    <div className={styles.backdrop} data-agent-transient onClick={onClose}>
      <div className={styles.card} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>快捷键</span>
          <span className={styles.hint}>Super 键当前为 {superKeySymbol}</span>
        </div>

        <div className={styles.body}>
          {groups.map((group) => (
            <section key={group} className={styles.section}>
              <div className={styles.sectionTitle}>{GROUP_LABEL[group]}</div>
              {SHORTCUT_COMMANDS.filter((command) => command.group === group).map((command) => (
                <div key={command.id} className={styles.row}>
                  <span className={styles.rowLabel}>{command.label}</span>
                  <span className={styles.keys}>
                    {describeShortcut(command.id).map((token, index) => (
                      <kbd key={index} className={styles.key}>
                        {token}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}

          <section className={styles.section}>
            <div className={styles.sectionTitle}>输入与菜单</div>
            {FIXED_ROWS.map((row) => (
              <div key={row.label} className={styles.row}>
                <span className={styles.rowLabel}>{row.label}</span>
                <span className={styles.keys}>
                  {row.keys.map((token) => (
                    <kbd key={token} className={styles.key}>
                      {token}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </section>
        </div>

        <div className={styles.footer}>可在 设置 · 快捷键 中修改绑定</div>
      </div>
    </div>
  );
});

ShortcutSheet.displayName = 'ShortcutSheet';
