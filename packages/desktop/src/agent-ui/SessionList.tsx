import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconFolderClose,
  IconMore,
  IconFolderOpen,
  IconNewChat,
  IconPanelLeft,
  IconPin,
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
  /** 正在跑一轮回复，用于运行指示 */
  running?: boolean;
  createdAt?: string;
  path?: string;
  archived?: boolean;
  pinned?: boolean;
}

export interface SessionGroupItem {
  /** 项目键：工作目录 */
  key: string;
  label: string;
  cwd: string;
  sessions: SessionListItem[];
  createdAt?: string;
}

/** 全文搜索命中的会话 */
export interface SessionContentHit {
  id: string;
  snippet: string;
  matches: number;
  modifiedAt: string;
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
  onRenameSession?: (id: string, title: string) => void;
  onArchiveSession?: (id: string, archived: boolean) => void;
  onPinSession?: (id: string, pinned: boolean) => void;
  onDeleteSession?: (id: string) => void;
  /** 工作区元数据操作 */
  onRenameProject?: (key: string, title: string) => void;
  onHideProject?: (key: string) => void;
  /** 工作区拖拽排序：返回新的键顺序 */
  onReorderProjects?: (keys: string[]) => void;
  /** 顶部品牌插槽 */
  brandSlot?: React.ReactNode;
  /** 变化时展开并聚焦搜索（快捷键触发） */
  searchSignal?: number;
  /** 会话正文搜索（服务端全文检索） */
  onSearchContent?: (query: string) => Promise<SessionContentHit[]>;
  /** 变化时对当前会话进入行内重命名 */
  renameSignal?: number;
  /** 折叠成 56px 图标轨道 */
  rail?: boolean;
  onToggleRail?: () => void;
}

const SESSION_VISIBLE_COUNT = 5;
const HOME_PATTERN = /^\/Users\/[^/]+/;

type SortMode = 'recent' | 'oldest' | 'name';

const SORT_LABEL: Record<SortMode, string> = {
  recent: '最近活跃优先',
  oldest: '最早活跃优先',
  name: '按名称排序',
};

const SORT_ORDER: SortMode[] = ['recent', 'oldest', 'name'];

interface HoverCardState {
  title: string;
  path: string;
  time: string;
  top: number;
  left: number;
}

interface MenuState {
  kind: 'project' | 'session' | 'workspace';
  cwd: string;
  sessionId?: string;
  archived?: boolean;
  pinned?: boolean;
  top: number;
  left: number;
}

interface RenameState {
  kind: 'project' | 'session';
  key: string;
  value: string;
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
  onPinSession,
  onDeleteSession,
  onRenameProject,
  onHideProject,
  onReorderProjects,
  brandSlot,
  searchSignal,
  onSearchContent,
  renameSignal,
  rail,
  onToggleRail,
}: SessionListProps) {
  const searching = query.trim().length > 0;
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [searchOpen, setSearchOpen] = useState(false);
  const [contentHits, setContentHits] = useState<SessionContentHit[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [hitIndex, setHitIndex] = useState(0);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);

  // 外部触发（session.rename 快捷键）：进入当前会话的行内重命名
  useEffect(() => {
    if (!renameSignal || !activeId) return;
    const session = groups.flatMap((group) => group.sessions).find((item) => item.id === activeId);
    setRename({ kind: 'session', key: activeId, value: session?.title || '' });
  }, [renameSignal, activeId, groups]);

  // 外部触发（Super + K）：展开搜索并聚焦输入框
  useEffect(() => {
    if (!searchSignal) return;
    setSearchOpen(true);
  }, [searchSignal]);

  const toggleGroupSessions = (key: string) => {
    setExpandedGroups((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  /** 组排序：最近 / 最早 / 名称；手动排序（order）由上层决定初始顺序 */
  const orderedGroups = useMemo(() => {
    const list = [...groups];
    if (sortMode === 'name') {
      list.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
      return list;
    }
    if (sortMode === 'oldest') {
      const timeOf = (group: SessionGroupItem) =>
        Math.min(...group.sessions.map((item) => Date.parse(item.modifiedAt) || 0), Number.MAX_SAFE_INTEGER);
      list.sort((a, b) => timeOf(a) - timeOf(b));
      return list;
    }
    const timeOf = (group: SessionGroupItem) =>
      Math.max(...group.sessions.map((item) => Date.parse(item.modifiedAt) || 0), 0);
    list.sort((a, b) => timeOf(b) - timeOf(a));
    return list;
  }, [groups, sortMode]);

  const filteredGroups = useMemo(
    () => (projectFilter ? orderedGroups.filter((group) => group.key === projectFilter) : orderedGroups),
    [orderedGroups, projectFilter]
  );

  /** 组内会话排序：置顶优先，其次按当前排序模式 */
  const sortSessions = useCallback(
    (list: SessionListItem[]) => {
      const sorted = [...list].sort((a, b) => {
        if (sortMode === 'name') return (a.title || '').localeCompare(b.title || '', 'zh-CN');
        const left = Date.parse(a.modifiedAt) || 0;
        const right = Date.parse(b.modifiedAt) || 0;
        return sortMode === 'oldest' ? left - right : right - left;
      });
      const pinned = sorted.filter((item) => item.pinned);
      return pinned.length > 0 ? [...pinned, ...sorted.filter((item) => !item.pinned)] : sorted;
    },
    [sortMode]
  );

  // 正文全文搜索：输入停顿 260ms 再请求
  useEffect(() => {
    if (!searching || !onSearchContent) {
      setContentHits([]);
      return;
    }
    const keyword = query.trim();
    let cancelled = false;
    setContentLoading(true);
    const timer = window.setTimeout(() => {
      void onSearchContent(keyword)
        .then((hits) => {
          if (cancelled) return;
          setContentHits(hits);
          setHitIndex(0);
        })
        .catch(() => {
          if (!cancelled) setContentHits([]);
        })
        .finally(() => {
          if (!cancelled) setContentLoading(false);
        });
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searching, query, onSearchContent]);

  const titleHits = useMemo(() => {
    if (!searching) return [];
    const keyword = query.trim().toLowerCase();
    const hits: SessionListItem[] = [];
    const seen = new Set<string>();
    for (const group of orderedGroups) {
      for (const session of group.sessions) {
        const title = session.title || '未命名会话';
        if (!title.toLowerCase().includes(keyword) && !group.label.toLowerCase().includes(keyword)) continue;
        if (seen.has(session.id)) continue;
        seen.add(session.id);
        hits.push(session);
      }
    }
    return hits
      .sort((a, b) => (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0))
      .slice(0, 20);
  }, [searching, orderedGroups, query]);

  const contentRows = useMemo(() => {
    const lookup = new Map<string, SessionListItem>();
    for (const group of groups) for (const session of group.sessions) lookup.set(session.id, session);
    return contentHits
      .filter((hit) => !titleHits.some((item) => item.id === hit.id))
      .map((hit) => ({ hit, session: lookup.get(hit.id) }))
      .slice(0, 20);
  }, [contentHits, groups, titleHits]);

  const [card, setCard] = useState<HoverCardState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 搜索展开后聚焦输入框（点击与快捷键共用）
  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchSignal]);

  // 重命名时聚焦并全选
  useEffect(() => {
    if (!rename) return;
    const timer = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rename]);

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

  const startRename = (kind: 'project' | 'session', key: string, value: string) => {
    setRename({ kind, key, value });
    setMenu(null);
  };

  const commitRename = () => {
    if (!rename) return;
    const value = rename.value.trim();
    if (rename.kind === 'project') onRenameProject?.(rename.key, value);
    else onRenameSession?.(rename.key, value);
    setRename(null);
  };

  const cycleSort = () => {
    setSortMode((prev) => SORT_ORDER[(SORT_ORDER.indexOf(prev) + 1) % SORT_ORDER.length]);
  };

  const contentHitRows = contentRows.length;
  const flatHits = useMemo(
    () => [
      ...titleHits.map((item) => ({ kind: 'title' as const, id: item.id })),
      ...contentRows.map((row) => ({ kind: 'content' as const, id: row.hit.id })),
    ],
    [titleHits, contentRows]
  );

  /** 搜索结果键盘导航：↑↓ 选择，Enter 打开 */
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      onQueryChange('');
      setSearchOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (flatHits.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHitIndex((prev) => (prev + step + flatHits.length) % flatHits.length);
      return;
    }
    if (event.key === 'Enter') {
      const hit = flatHits[hitIndex];
      if (!hit) return;
      event.preventDefault();
      onSelectSession(hit.id);
      setSearchOpen(false);
    }
  };

  // 折叠成图标轨道
  if (rail) {
    return (
      <aside className={`${styles.root} ${styles.rootRail}`}>
        <div className={styles.railTop}>
          {onToggleRail && (
            <button
              type="button"
              className={styles.railButton}
              onClick={onToggleRail}
              title="展开侧边栏"
              aria-label="展开侧边栏"
            >
              <IconPanelLeft size={18} />
            </button>
          )}
          <button
            type="button"
            className={styles.railButton}
            onClick={() => onNewInGroup(groups[0]?.cwd || '')}
            title="新会话"
            aria-label="新会话"
          >
            <IconNewChat size={18} />
          </button>
          <button
            type="button"
            className={styles.railButton}
            onClick={() => {
              onToggleRail?.();
              setSearchOpen(true);
            }}
            title="搜索会话"
            aria-label="搜索会话"
          >
            <IconSearch size={18} />
          </button>
          <button
            type="button"
            className={styles.railButton}
            onClick={onAddProject}
            title="新建工作区"
            aria-label="新建工作区"
          >
            <IconProjectAdd size={18} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.root}>
      {brandSlot}

      <button
        type="button"
        className={styles.newSession}
        onClick={() => onNewInGroup(projectFilter || groups[0]?.cwd || '')}
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
              placeholder="搜索会话与内容"
              autoFocus
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
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
            <button
              type="button"
              className={styles.sectionTitleButton}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({ kind: 'workspace', cwd: '', top: rect.bottom + 4, left: rect.left });
              }}
              title="切换工作区"
            >
              {projectFilter
                ? orderedGroups.find((group) => group.key === projectFilter)?.label || '工作区'
                : '工作区'}
              <IconTriangleRight size={12} className={styles.sectionChevron} />
            </button>
            <span className={styles.sectionActions}>
              {onToggleRail && (
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={onToggleRail}
                  title="收起侧边栏"
                >
                  <IconPanelLeft size={16} />
                </button>
              )}
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setSearchOpen(true)}
                title="搜索会话与内容"
              >
                <IconSearch size={16} />
              </button>
              <button
                type="button"
                className={`${styles.iconButton} ${sortMode !== 'recent' ? styles.iconButtonActive : ''}`}
                onClick={cycleSort}
                title={`排序：${SORT_LABEL[sortMode]}（点击切换）`}
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
            {flatHits.length > 0
              ? `${flatHits.length} 个匹配会话${contentLoading ? ' · 正在检索正文…' : ''}`
              : contentLoading
                ? '正在检索正文…'
                : '没有匹配的会话'}
          </div>
          <div className={styles.searchPanelList}>
            {titleHits.map((hit, index) => (
              <button
                key={`title-${hit.id}`}
                type="button"
                className={`${styles.searchHit} ${hitIndex === index ? styles.searchHitActive : ''}`}
                onClick={() => onSelectSession(hit.id)}
              >
                <span className={styles.searchHitTitle}>{hit.title || '未命名会话'}</span>
                <span className={styles.searchHitTime}>{relativeTime(hit.modifiedAt)}</span>
              </button>
            ))}
            {contentRows.map((row, index) => (
              <button
                key={`content-${row.hit.id}`}
                type="button"
                className={`${styles.searchHit} ${styles.searchHitContent} ${
                  hitIndex === titleHits.length + index ? styles.searchHitActive : ''
                }`}
                onClick={() => onSelectSession(row.hit.id)}
              >
                <span className={styles.searchHitTitle}>
                  {row.session?.title || '未命名会话'}
                  <span className={styles.searchHitBadge}>{row.hit.matches} 处正文</span>
                </span>
                <span className={styles.searchHitSnippet}>{row.hit.snippet}</span>
              </button>
            ))}
          </div>
          {contentHitRows === 0 && titleHits.length === 0 && !contentLoading && (
            <div className={styles.searchPanelFoot}>正文检索覆盖最近会话的最新内容</div>
          )}
        </div>
      )}

      <div className={styles.list}>
        {loading && groups.length === 0 && <div className={styles.placeholder}>正在扫描会话…</div>}
        {!loading && filteredGroups.length === 0 && (
          <div className={styles.placeholder}>还没有工作区。点右上角图标选择一个目录。</div>
        )}

        {filteredGroups.map((group) => {
          const isCollapsed = !searching && collapsed.includes(group.key);
          const isExpanded = searching || expandedGroups.includes(group.key);
          const sortedSessions = sortSessions(group.sessions);
          const visibleSessions = isExpanded
            ? sortedSessions
            : sortedSessions.slice(0, SESSION_VISIBLE_COUNT);
          const hiddenCount = sortedSessions.length - visibleSessions.length;
          const renamingProject = rename?.kind === 'project' && rename.key === group.key;

          return (
            <div key={group.key} className={styles.group}>
              <div
                className={styles.projectRow}
                draggable={Boolean(onReorderProjects) && !renamingProject}
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
                {renamingProject ? (
                  <input
                    ref={renameInputRef}
                    className={styles.renameInput}
                    value={rename.value}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setRename({ ...rename, value: event.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitRename();
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setRename(null);
                      }
                    }}
                  />
                ) : (
                  <span className={styles.projectTitle}>{group.label}</span>
                )}
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

                  {visibleSessions.map((session) => {
                    const renamingSession = rename?.kind === 'session' && rename.key === session.id;
                    return (
                      <div
                        key={session.id}
                        className={`${styles.sessionRow} ${
                          session.id === activeId ? styles.sessionSelected : ''
                        } ${session.archived ? styles.sessionArchived : ''}`}
                        onClick={() => {
                          if (renamingSession) return;
                          onSelectSession(session.id);
                        }}
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
                          if (event.key === 'Enter' && !renamingSession) onSelectSession(session.id);
                        }}
                      >
                        {session.running && <span className={styles.liveSpinner} aria-label="进行中" />}
                        {renamingSession ? (
                          <input
                            ref={renameInputRef}
                            className={styles.renameInput}
                            value={rename.value}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setRename({ ...rename, value: event.target.value })}
                            onBlur={commitRename}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitRename();
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                event.stopPropagation();
                                setRename(null);
                              }
                            }}
                          />
                        ) : (
                          <span className={styles.sessionTitle}>{session.title || '未命名会话'}</span>
                        )}
                        {session.pinned && (
                          <span className={styles.pinMark} aria-label="已置顶">
                            <IconPin size={13} />
                          </span>
                        )}
                        <span className={styles.time}>{relativeTime(session.modifiedAt)}</span>
                        <span className={styles.rowActions}>
                          {onPinSession && (
                            <button
                              type="button"
                              className={`${styles.rowIcon} ${session.pinned ? styles.rowIconActive : ''}`}
                              aria-label={session.pinned ? '取消置顶' : '置顶会话'}
                              title={session.pinned ? '取消置顶' : '置顶会话'}
                              onClick={(event) => {
                                event.stopPropagation();
                                onPinSession(session.id, !session.pinned);
                              }}
                            >
                              <IconPin size={14} />
                            </button>
                          )}
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
                                pinned: session.pinned,
                              })
                            }
                          >
                            <IconMore size={16} />
                          </button>
                        </span>
                      </div>
                    );
                  })}

                  {(hiddenCount > 0 || (isExpanded && sortedSessions.length > SESSION_VISIBLE_COUNT)) && (
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
          {menu.kind === 'workspace' && (
            <>
              <button
                type="button"
                className={`${styles.menuItem} ${projectFilter === null ? styles.menuItemActive : ''}`}
                onClick={() => {
                  setProjectFilter(null);
                  setMenu(null);
                }}
              >
                全部工作区
              </button>
              {orderedGroups.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  className={`${styles.menuItem} ${
                    projectFilter === group.key ? styles.menuItemActive : ''
                  }`}
                  onClick={() => {
                    setProjectFilter(group.key);
                    setExpandedGroups((prev) =>
                      prev.includes(group.key) ? prev : [...prev, group.key]
                    );
                    setMenu(null);
                  }}
                >
                  {group.label}
                  <span className={styles.menuCount}>{group.sessions.length}</span>
                </button>
              ))}
            </>
          )}
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
                    const group = orderedGroups.find((item) => item.key === menu.cwd);
                    startRename('project', menu.cwd, group?.label || '');
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
                    const session = groups
                      .flatMap((group) => group.sessions)
                      .find((item) => item.id === menu.sessionId);
                    startRename('session', menu.sessionId || '', session?.title || '');
                  }}
                >
                  重命名会话
                </button>
              )}
              {onPinSession && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    onPinSession(menu.sessionId || '', !menu.pinned);
                    setMenu(null);
                  }}
                >
                  {menu.pinned ? '取消置顶' : '置顶会话'}
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
          {menu.kind !== 'workspace' && (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => reveal(menu.cwd || '.')}
              disabled={!menu.cwd}
            >
              在访达中打开
            </button>
          )}
          {menu.kind === 'project' && (
            <button type="button" className={styles.menuItem} onClick={() => copyText(menu.cwd)}>
              复制路径
            </button>
          )}
          {menu.kind === 'session' && (
            <button type="button" className={styles.menuItem} onClick={() => copyText(menu.sessionId || '')}>
              复制会话 ID
            </button>
          )}
        </div>
      )}
    </aside>
  );
});
