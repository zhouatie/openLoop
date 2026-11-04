import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { relativeTime, type SessionListItem } from './SessionList';
import { IconSearch } from './icons';
import styles from './SessionSwitcher.module.css';

export interface SessionSwitcherProps {
  /** 候选会话：调用方按最近更新排序，这里只做关键字过滤 */
  sessions: SessionListItem[];
  activeId?: string | null;
  /** 选中会话：切换后自动关闭 */
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** 结果条数上限：启动器只服务最近若干条，避免一次渲染上千行 */
const RESULT_LIMIT = 60;

function workspaceName(cwd: string): string {
  if (!cwd) return '临时目录';
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

/**
 * 会话启动器（对齐 Alfred）：唤起后直接打字过滤，↑↓ 移动，回车切到该会话。
 * 输入框聚焦时就能用，不需要先离开输入框去点鼠标。
 */
export const SessionSwitcher = memo(function SessionSwitcher({
  sessions,
  activeId,
  onSelect,
  onClose,
}: SessionSwitcherProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matched = tokens.length
      ? sessions.filter((item) => {
          const haystack = `${item.title} ${item.cwd} ${item.task?.title || ''}`.toLowerCase();
          return tokens.every((token) => haystack.includes(token));
        })
      : sessions;
    return matched.slice(0, RESULT_LIMIT);
  }, [sessions, query]);

  // 唤起即聚焦：快捷键按下后立刻可以打字
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  // 键盘移动时把选中行滚进视口，长列表也不会把选中项甩到视野外
  useEffect(() => {
    const row = listRef.current?.children[index] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'nearest' });
  }, [index, results]);

  const commit = (id: string) => {
    if (import.meta.env?.DEV) console.log('[SessionSwitcher] 切换会话:', id);
    onSelect(id);
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setIndex((prev) => (prev + step + results.length) % results.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[index];
      if (target) commit(target.id);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (import.meta.env?.DEV) console.log('[SessionSwitcher] 关闭会话启动器');
      onClose();
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label="快速切换会话"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.searchRow}>
          <IconSearch size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="切换会话：输入会话名或工作区…"
            spellCheck={false}
            autoComplete="off"
            aria-label="筛选会话"
          />
          <kbd className={styles.key}>Esc</kbd>
        </div>

        <div ref={listRef} className={styles.list} role="listbox">
          {results.length === 0 ? (
            <div className={styles.empty}>没有匹配的会话</div>
          ) : (
            results.map((item, rowIndex) => (
              <div
                key={item.id}
                className={styles.row}
                data-selected={rowIndex === index}
                role="option"
                aria-selected={rowIndex === index}
                onMouseEnter={() => setIndex(rowIndex)}
                onClick={() => commit(item.id)}
              >
                <span className={styles.rowMain}>
                  {item.running && <span className={styles.dot} aria-hidden="true" />}
                  <span className={styles.title}>{item.title}</span>
                  {item.id === activeId && <span className={styles.current}>当前</span>}
                </span>
                <span className={styles.meta}>
                  <span className={styles.workspace}>{workspaceName(item.cwd)}</span>
                  <span className={styles.time}>{relativeTime(item.modifiedAt, item.modifiedMs)}</span>
                </span>
              </div>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.hints}>
            <span className={styles.hint}>
              <kbd className={styles.key}>↑</kbd>
              <kbd className={styles.key}>↓</kbd>
              <span>切换</span>
            </span>
            <span className={styles.hint}>
              <kbd className={styles.key}>↵</kbd>
              <span>打开会话</span>
            </span>
            <span className={styles.hint}>
              <kbd className={styles.key}>Esc</kbd>
              <span>退出</span>
            </span>
          </div>
          <span>{results.length} 个会话</span>
        </div>
      </div>
    </div>
  );
});

SessionSwitcher.displayName = 'SessionSwitcher';
