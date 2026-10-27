import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconFolderClose,
  IconMore,
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
  createdAt?: string;
  path?: string;
  archived?: boolean;
}

export interface SessionGroupItem {
  /** 项目键：工作目录 */
  key: string;
  label: string;
  cwd: string;
  sessions: SessionListItem[];
  createdAt?: string;
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
  /** 在系统文件管理器中打开目录 */
  onRevealPath?: (path: string) => void;
  /** 会话元数据操作 */
  onRenameSession?: (id: string) => void;
  onArchiveSession?: (id: string, archived: boolean) => void;
  onDeleteSession?: (id: string) => void;
  /** 工作区元数据操作 */
  onRenameProject?: (key: string) => void;
  onHideProject?: (key: string) => void;
  /** 工作区拖拽排序：返回新的键顺序 */
  onReorderProjects?: (keys: string[]) => void;
  /** 顶部的品牌标识插槽 */
  brandSlot?: React.ReactNode;
  /** 变化时展开并聚焦搜索（快捷键触发） */
  searchSignal?: number;
}

const SESSION_VISIBLE_COUNT = 5;
const HOME_PATTERN = /^\/Users\/[^/]+/;

interface HoverCardState {
  title: string;
  path: string;
  time: string;
  top: number;
  left: number;
}

interface MenuState {
  kind: 'project' | 'session';
  cwd: string;
  sessionId?: string;
  archived?: boolean;
  top: number;
  left: number;
}

function homeShortened(path: string): string {
  return path ? path.replace(HOME_PATTERN, '~') : '';
}

function createdLabel(iso?: string): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `创建于 ${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

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
  onRevealPath,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
  onRenameProject,
  onHideProject,
  onReorderProjects,
  brandSlot,
  searchSignal,
}: SessionListProps) {
  const searching = query.trim().length > 0;
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [sortDesc, setSortDesc] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);

  // 外部触发（Super + K）：展开搜索并聚焦输入框
  useEffect(() => {
    if (!searchSignal) return;
    setSearchOpen(true);
  }, [searchSignal]);

  const toggleGroupSessions = (key: string) => {
    setExpandedGroups((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const orderedGroups = sortDesc ? groups : [...groups].reverse();

  const searchHits = useMemo(() => {
    if (!searching) return [];
    const keyword = query.trim().toLowerCase();
    const hits: Array<{ id: string; title: string; project: string; modifiedAt: string; archived?: boolean }> = [];
    for (const group of groups) {
      for (const session of group.sessions) {
        const title = session.title || '未命名会话';
        if (!title.toLowerCase().includes(keyword) && !group.label.toLowerCase().includes(keyword)) continue;
        hits.push({
          id: session.id,
          title,
          project: group.label,
          modifiedAt: session.modifiedAt,
          archived: session.archived,
        });
      }
    }
    return hits.sort((a, b) => (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0)).slice(0, 30);
  }, [searching, groups, query]);

  const [card, setCard] = useState<HoverCardState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 搜索展开后聚焦输入框（点击与快捷键共用）
  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchSignal]);

  // 菜单打开后聚焦首项，便于 ↑↓ / Enter 操作
  useEffect(() => {
    if (!menu) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    first?.focus();
  }, [menu]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || []
    );
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? items[(index + 1 + items.length) % items.length]
        : items[(index - 1 + items.length) % items.length];
    next?.focus();
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  /** 悬浮卡：贴住行右侧，跟随行的垂直位置 */
  const showCard = (element: HTMLElement, title: string, path: string, time: string) => {
    const rect = element.getBoundingClientRect();
    setCard({
      title,
      path: homeShortened(path),
      time,
      top: Math.min(Math.max(12, rect.top - 4), window.innerHeight - 150),
      left: rect.right + 10,
    });
  };

  const openMenu = (event: React.MouseEvent<HTMLElement>, next: Omit<MenuState, 'top' | 'left'>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ ...next, top: rect.bottom + 4, left: Math.max(12, rect.left - 120) });
  };

  const reveal = (target: string) => {
    onRevealPath?.(target);
    setMenu(null);
  };

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setMenu(null);
  };

  return (
    <aside className={styles.root}>
      {brandSlot}

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
              ref={searchInputRef}
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

      {searching && (
        <div className={styles.searchPanel} data-agent-transient>
          <div className={styles.searchPanelHead}>
            {searchHits.length > 0 ? `${searchHits.length} 个匹配会话` : '没有匹配的会话'}
          </div>
          <div className={styles.searchPanelList}>
            {searchHits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                className={`${styles.searchHit} ${hit.id === activeId ? styles.searchHitActive : ''}`}
                onClick={() => onSelectSession(hit.id)}
              >
                <span className={styles.searchHitTitle}>{hit.title}</span>
                <span className={styles.searchHitMeta}>{hit.project}</span>
                <span className={styles.searchHitTime}>{relativeTime(hit.modifiedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
                draggable={Boolean(onReorderProjects)}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/openloop-project', group.key);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  if (!onReorderProjects) return;
                  if (!event.dataTransfer.types.includes('text/openloop-project')) return;
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  const source = event.dataTransfer.getData('text/openloop-project');
                  if (!onReorderProjects || !source || source === group.key) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const keys = orderedGroups.map((item) => item.key).filter((key) => key !== source);
                  const targetIndex = keys.indexOf(group.key);
                  keys.splice(targetIndex < 0 ? keys.length : targetIndex, 0, source);
                  onReorderProjects(keys);
                }}
                onClick={() => onToggleGroup(group.key)}
                onMouseEnter={(event) =>
                  showCard(event.currentTarget, group.label, group.cwd, createdLabel(group.createdAt))
                }
                onMouseLeave={() => setCard(null)}
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
                  <span
                    className={`${styles.folder} ${
                      group.sessions.some((item) => item.id === activeId) ? styles.folderActive : ''
                    }`}
                  >
                    {isCollapsed ? <IconFolderClose size={16} /> : <IconFolderOpen size={16} />}
                  </span>
                  <span className={`${styles.chevron} ${isCollapsed ? '' : styles.chevronOpen}`}>
                    <IconTriangleRight size={14} />
                  </span>
                </span>
                <span className={styles.projectTitle}>{group.label}</span>
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.rowIcon}
                    aria-label="更多操作"
                    onClick={(event) => openMenu(event, { kind: 'project', cwd: group.cwd })}
                  >
                    <IconMore size={16} />
                  </button>
                  <button
                    type="button"
                    className={styles.rowIcon}
                    aria-label="在此工作区新建会话"
                    onClick={(event) => {
                      event.stopPropagation();
                      onNewInGroup(group.cwd);
                    }}
                  >
                    <IconNewChat size={16} />
                  </button>
                </span>
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
                      } ${session.archived ? styles.sessionArchived : ''}`}
                      onClick={() => onSelectSession(session.id)}
                      role="treeitem"
                      aria-selected={session.id === activeId}
                      tabIndex={0}
                      onMouseEnter={(event) =>
                        showCard(
                          event.currentTarget,
                          session.title || '未命名会话',
                          session.cwd,
                          createdLabel(session.createdAt)
                        )
                      }
                      onMouseLeave={() => setCard(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') onSelectSession(session.id);
                      }}
                    >
                      {session.live && <span className={styles.liveSpinner} aria-label="进行中" />}
                      <span className={styles.sessionTitle}>{session.title || '未命名会话'}</span>
                      <span className={styles.time}>{relativeTime(session.modifiedAt)}</span>
                      <span className={styles.rowActions}>
                        <button
                          type="button"
                          className={styles.rowIcon}
                          aria-label="会话操作"
                          onClick={(event) =>
                            openMenu(event, {
                              kind: 'session',
                              cwd: session.cwd,
                              sessionId: session.id,
                              archived: session.archived,
                            })
                          }
                        >
                          <IconMore size={16} />
                        </button>
                      </span>
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

      {card && (
        <div
          className={styles.hoverCard}
          style={{ top: card.top, left: card.left }}
          role="presentation"
          data-agent-transient
        >
          <div className={styles.hoverTitle}>{card.title}</div>
          {card.path && <div className={styles.hoverPath}>{card.path}</div>}
          {card.time && <div className={styles.hoverTime}>{card.time}</div>}
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className={styles.menu}
          style={{ top: menu.top, left: menu.left }}
          role="menu"
          data-agent-transient
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
        >
          {menu.kind === 'project' && (
            <>
              <button type="button" className={styles.menuItem} onClick={() => onNewInGroup(menu.cwd)}>
                新建会话
              </button>
              {onRenameProject && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    onRenameProject(menu.cwd);
                    setMenu(null);
                  }}
                >
                  重命名工作区
                </button>
              )}
              {onHideProject && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    onHideProject(menu.cwd);
                    setMenu(null);
                  }}
                >
                  隐藏工作区
                </button>
              )}
            </>
          )}
          {menu.kind === 'session' && (
            <>
              {onRenameSession && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    onRenameSession(menu.sessionId || '');
                    setMenu(null);
                  }}
                >
                  重命名会话
                </button>
              )}
              {onArchiveSession && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    onArchiveSession(menu.sessionId || '', !menu.archived);
                    setMenu(null);
                  }}
                >
                  {menu.archived ? '取消归档' : '归档会话'}
                </button>
              )}
              {onDeleteSession && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    onDeleteSession(menu.sessionId || '');
                    setMenu(null);
                  }}
                >
                  删除会话
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => reveal(menu.cwd || '.')}
            disabled={!menu.cwd}
          >
            在访达中打开
          </button>
          {menu.kind === 'project' ? (
            <button type="button" className={styles.menuItem} onClick={() => copyText(menu.cwd)}>
              复制路径
            </button>
          ) : (
            <button type="button" className={styles.menuItem} onClick={() => copyText(menu.sessionId || '')}>
              复制会话 ID
            </button>
          )}
        </div>
      )}
    </aside>
  );
});
