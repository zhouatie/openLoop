import React, { memo, useState } from 'react';
import {
  IconFolderClose,
  IconFolderOpen,
  IconNewChat,
  IconProjectAdd,
  IconSearch,
  IconSort,
  IconTriangleRight,
} from './icons';
import styles from './SessionList.module.css';

export interface SessionListItem {
  id: string;
  title: string;
  cwd: string;
  modifiedAt: string;
  messageCount: number;
  live?: boolean;
}

export interface SessionGroupItem {
  /** 项目键：工作目录 */
  key: string;
  label: string;
  cwd: string;
  sessions: SessionListItem[];
}

export interface SessionListProps {
  groups: SessionGroupItem[];
  activeId?: string | null;
  loading?: boolean;
  query: string;
  collapsed: string[];
  onQueryChange: (value: string) => void;
  onToggleGroup: (key: string) => void;
  onSelectSession: (id: string) => void;
  onNewInGroup: (cwd: string) => void;
  onAddProject: () => void;
  onRefresh: () => void;
}

const SESSION_VISIBLE_COUNT = 5;

function relativeTime(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const diff = Date.now() - time;
  const minute = 60 * 1000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 30 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  return `${Math.floor(diff / (30 * 24 * 60 * minute))} 个月前`;
}

/** 项目列：新会话入口、工作区分组、组内会话与「展开其余 N 个会话」 */
export const SessionList = memo(function SessionList({
  groups,
  activeId,
  loading,
  query,
  collapsed,
  onQueryChange,
  onToggleGroup,
  onSelectSession,
  onNewInGroup,
  onAddProject,
  onRefresh,
}: SessionListProps) {
  const searching = query.trim().length > 0;
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [sortDesc, setSortDesc] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);

  const toggleGroupSessions = (key: string) => {
    setExpandedGroups((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const orderedGroups = sortDesc ? groups : [...groups].reverse();

  return (
    <aside className={styles.root}>
      <button
        type="button"
        className={styles.newSession}
        onClick={() => onNewInGroup(groups[0]?.cwd || '')}
      >
        <IconNewChat size={14} />
        <span className={styles.newSessionLabel}>新会话</span>
      </button>

      <div className={styles.sectionHeader}>
        {searchOpen ? (
          <label className={styles.searchPill}>
            <IconSearch size={14} className={styles.searchIcon} />
            <input
              className={styles.search}
              value={query}
              placeholder="搜索会话"
              autoFocus
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  onQueryChange('');
                  setSearchOpen(false);
                }
              }}
            />
            <button
              type="button"
              className={styles.clearButton}
              onClick={() => {
                onQueryChange('');
                setSearchOpen(false);
              }}
              title="关闭搜索"
            >
              取消
            </button>
          </label>
        ) : (
          <>
            <span className={styles.sectionTitle}>工作区</span>
            <span className={styles.sectionActions}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setSearchOpen(true)}
                title="搜索会话"
              >
                <IconSearch size={16} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setSortDesc((prev) => !prev)}
                title={sortDesc ? '按最近活跃排序' : '按最早活跃排序'}
              >
                <IconSort size={16} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={onAddProject}
                title="新建工作区"
              >
                <IconProjectAdd size={16} />
              </button>
            </span>
          </>
        )}
      </div>

      <div className={styles.list}>
        {loading && groups.length === 0 && <div className={styles.placeholder}>正在扫描会话…</div>}
        {!loading && groups.length === 0 && (
          <div className={styles.placeholder}>还没有工作区。点右上角图标选择一个目录。</div>
        )}

        {orderedGroups.map((group) => {
          const isCollapsed = !searching && collapsed.includes(group.key);
          const isExpanded = searching || expandedGroups.includes(group.key);
          const visibleSessions = isExpanded
            ? group.sessions
            : group.sessions.slice(0, SESSION_VISIBLE_COUNT);
          const hiddenCount = group.sessions.length - visibleSessions.length;

          return (
            <div key={group.key} className={styles.group}>
              <div
                className={styles.projectRow}
                onClick={() => onToggleGroup(group.key)}
                title={group.cwd || '临时目录'}
                role="treeitem"
                aria-expanded={!isCollapsed}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onToggleGroup(group.key);
                  }
                }}
              >
                <span className={styles.slot}>
                  <span className={styles.folder}>
                    {isCollapsed ? <IconFolderClose size={16} /> : <IconFolderOpen size={16} />}
                  </span>
                  <span className={`${styles.chevron} ${isCollapsed ? '' : styles.chevronOpen}`}>
                    <IconTriangleRight size={14} />
                  </span>
                </span>
                <span className={styles.projectTitle}>{group.label}</span>
              </div>

              {!isCollapsed && (
                <div className={styles.groupBody}>
                  {group.sessions.length === 0 && (
                    <button
                      type="button"
                      className={styles.sessionRow}
                      onClick={() => onNewInGroup(group.cwd)}
                    >
                      <span className={styles.sessionTitle}>新会话</span>
                    </button>
                  )}

                  {visibleSessions.map((session) => (
                    <div
                      key={session.id}
                      className={`${styles.sessionRow} ${
                        session.id === activeId ? styles.sessionSelected : ''
                      }`}
                      onClick={() => onSelectSession(session.id)}
                      role="treeitem"
                      aria-selected={session.id === activeId}
                      tabIndex={0}
                      title={session.title}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') onSelectSession(session.id);
                      }}
                    >
                      <span className={styles.sessionTitle}>{session.title || '未命名会话'}</span>
                      {session.live && <span className={styles.liveDot} aria-label="进行中" />}
                      <span className={styles.time}>{relativeTime(session.modifiedAt)}</span>
                    </div>
                  ))}

                  {(hiddenCount > 0 || (isExpanded && group.sessions.length > SESSION_VISIBLE_COUNT)) && (
                    <button
                      type="button"
                      className={styles.overflowButton}
                      onClick={() => toggleGroupSessions(group.key)}
                    >
                      {hiddenCount > 0 ? `展开其余 ${hiddenCount} 个会话` : '收起会话'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
});
