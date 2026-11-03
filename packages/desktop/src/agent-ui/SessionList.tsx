import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskSessionRef } from '@openloop/core';
import {
  IconFolderClose,
  IconMore,
  IconFolderOpen,
  IconNewChat,
  IconPanelLeft,
  IconPin,
  IconProjectAdd,
  IconSearch,
  IconSliders,
  IconSort,
  IconClock,
  IconFlatList,
  IconArchiveCheck,
  IconArchiveOff,
  IconQueue,
  IconTriangleRight,
} from './icons';
import styles from './SessionList.module.css';

export interface SessionListItem {
  id: string;
  title: string;
  cwd: string;
  modifiedAt: string;
  /** 毫秒时间戳缓存，避免在排序中反复 Date.parse */
  modifiedMs?: number;
  messageCount: number;
  live?: boolean;
  /** 正在跑一轮回复，用于运行指示 */
  running?: boolean;
  createdAt?: string;
  path?: string;
  /** 会话最后一次使用的模型：离线会话靠它显示输入框的模型标签 */
  lastModel?: string;
  archived?: boolean;
  pinned?: boolean;
  /** 未落盘的新会话占位行（对齐 DSH blank session）：只显示标题，不显示时间与操作 */
  draft?: boolean;
  /** 该会话所属的看板任务：任务会话才有，用于标注归属 */
  task?: TaskSessionRef;
}

export interface SessionGroupItem {
  /** 项目键：工作目录 */
  key: string;
  label: string;
  cwd: string;
  sessions: SessionListItem[];
  createdAt?: string;
  pinned?: boolean;
  /** 只读组（已删除工作区落到这里）：没有新建、改名、置顶与排序 */
  readonly?: boolean;
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
  /** 删除工作区：只从列表移除，文件夹与会话都保留 */
  onDeleteProject?: (key: string) => void;
  onPinProject?: (key: string, pinned: boolean) => void;
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
  /** 当前打开会话所属工作区的 cwd：左上角新会话默认建在这里 */
  activeCwd?: string;
  /** 收起侧边栏：图标入口交给主列顶栏（对齐 DSH 折叠后不留图标轨道） */
  onCollapse?: () => void;
}

/** 某条命中会话的展示行：本地元数据命中与正文命中合并后共用 */
interface SearchRow {
  id: string;
  title: string;
  workspace: string;
  running?: boolean;
  snippet?: string;
  task?: TaskSessionRef;
}

const SESSION_VISIBLE_COUNT = 5;
/** 工作区分组单次展开步长，防止一次性挂载过多 DOM 阻塞主线程 */
const GROUP_WATERMARK_STEP = 30;
/** 悬浮卡停留时长：对齐 DSH HoverCard 的 openDelayMs={800} */
const HOVER_CARD_DELAY_MS = 800;
const HOME_PATTERN = /^\/Users\/[^/]+/;

/** 视图选项：对齐 DSH WorkspaceBrowser 的 ViewOptionsMenu（分组方式 / 排序方式 / 筛选会话） */
type GroupBy = 'workspace' | 'flat';
type OrderBy = 'manual' | 'updated';
type ArchivedFilter = 'hide' | 'show' | 'only';

const ORDER_BY_LABEL: Record<OrderBy, string> = { manual: '手动排序', updated: '最近更新' };
const ARCHIVED_LABEL: Record<ArchivedFilter, string> = {
  hide: '隐藏已归档',
  show: '全部对话（显示已归档）',
  only: '仅显示已归档',
};
/** 搜索请求与合并结果的条数上限（对齐 DSH SESSION_SEARCH_RESULT_LIMIT） */
const SEARCH_RESULT_LIMIT = 20;
/** 搜索输入与请求的 UTF-16 长度上限（对齐 DSH session.search 契约） */
const SEARCH_QUERY_MAX_CHARS = 500;
/** 输入停顿后请求正文搜索（对齐 DSH SEARCH_DEBOUNCE_MS） */
const SEARCH_DEBOUNCE_MS = 250;
/** 单列表模式每页渲染的会话数 */
const FLAT_PAGE_SIZE = 120;

/** 搜索词清洗：去掉 NUL，并按 UTF-16 上限截断（不拆代理对） */
function sanitizeQuery(value: string): string {
  const text = value.replace(/\0/g, '');
  if (text.length <= SEARCH_QUERY_MAX_CHARS) return text;
  let end = SEARCH_QUERY_MAX_CHARS;
  const last = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1;
  return text.slice(0, end);
}

interface HoverCardState {
  title: string;
  path: string;
  time: string;
  task?: string;
  top: number;
  left: number;
  /** 侧栏有 backdrop-filter，会成为 fixed 子元素的包含块并裁切浮层；挂到 agent-scope 根节点 */
  host: HTMLElement;
}

interface MenuState {
  kind: 'project' | 'session';
  cwd: string;
  /** 项目键：临时工作区的键与 cwd 不同 */
  key?: string;
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

/** 行内相对时间：紧凑写法（对齐 DSH 的「5分钟 / 13天 / 6个月」） */
function relativeTime(iso: string, ms?: number): string {
  const time = ms !== undefined ? ms : Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟`;
  if (diff < day) return `${Math.floor(diff / hour)}小时`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}天`;
  return `${Math.floor(diff / (30 * day))}个月`;
}

interface SessionRowItemProps {
  session: SessionListItem;
  isActive: boolean;
  renaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onRenameChange: (val: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onSelectSession: (id: string) => void;
  onPinSession?: (id: string, pinned: boolean) => void;
  onOpenMenu: (
    event: React.MouseEvent,
    item: { kind: 'session'; cwd: string; sessionId: string; archived?: boolean; pinned?: boolean }
  ) => void;
  onShowCard: (target: HTMLElement, title: string, cwd: string, time: string, task?: string) => void;
  onHideCard: () => void;
}

const SessionRowItem = memo(function SessionRowItem({
  session,
  isActive,
  renaming,
  renameValue,
  renameInputRef,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onSelectSession,
  onPinSession,
  onOpenMenu,
  onShowCard,
  onHideCard,
}: SessionRowItemProps) {
  const draftRow = session.draft === true;
  return (
    <div
      key={session.id}
      className={`${styles.sessionRow} ${isActive ? styles.sessionSelected : ''} ${
        session.archived ? styles.sessionArchived : ''
      }`}
      onClick={() => {
        if (renaming || draftRow) return;
        onSelectSession(session.id);
      }}
      role="treeitem"
      aria-selected={isActive}
      tabIndex={0}
      onMouseEnter={(event) =>
        onShowCard(
          event.currentTarget,
          session.title || '未命名会话',
          session.cwd,
          createdLabel(session.createdAt),
          session.task?.title
        )
      }
      onMouseLeave={onHideCard}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !renaming && !draftRow) onSelectSession(session.id);
      }}
    >
      {/* 状态槽固定 16px（对齐 DSH）：运行指示在槽内显隐，标题位置不随之左右跳 */}
      <span className={styles.statusSlot}>
        {session.running && <span className={styles.liveSpinner} aria-label="进行中" />}
      </span>
      {renaming ? (
        <input
          ref={renameInputRef}
          className={styles.renameInput}
          value={renameValue}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onRenameChange(event.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onRenameCommit();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onRenameCancel();
            }
          }}
        />
      ) : (
        <span className={styles.sessionTitle}>{session.title || '未命名会话'}</span>
      )}
      {session.task && (
        <span className={styles.taskTag} title={`任务：${session.task.title}`}>
          任务
        </span>
      )}
      {session.pinned && (
        <span className={styles.pinMark} aria-label="已置顶">
          <IconPin size={13} />
        </span>
      )}
      {!draftRow && (
        <>
          <span className={styles.time}>{relativeTime(session.modifiedAt, session.modifiedMs)}</span>
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
                onOpenMenu(event, {
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
        </>
      )}
    </div>
  );
});

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
  onDeleteProject,
  onPinProject,
  onReorderProjects,
  brandSlot,
  searchSignal,
  onSearchContent,
  renameSignal,
  activeCwd,
  onCollapse,
}: SessionListProps) {
  const searching = query.trim().length > 0;
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('workspace');
  const [orderBy, setOrderBy] = useState<OrderBy>('updated');
  const [archivedFilter, setArchivedFilter] = useState<ArchivedFilter>('hide');
  /** 视图选项菜单的定位 */
  const [viewMenu, setViewMenu] = useState<{ top: number; left: number } | null>(null);
  /** 单列表一次渲染的会话数（逐步加载，避免一次性铺 2000+ 行） */
  const [flatLimit, setFlatLimit] = useState(FLAT_PAGE_SIZE);
  const [searchOpen, setSearchOpen] = useState(false);
  /** 已有搜索词时强制展开输入框（面板重挂载后也不会出现「有结果无输入框」） */
  const searchExpanded = searchOpen || searching;
  const [contentHits, setContentHits] = useState<SessionContentHit[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [hitIndex, setHitIndex] = useState(0);
  const [rename, setRename] = useState<RenameState | null>(null);
  /** 新会话的工作区：当前会话所在工作区优先（对齐 DSH），其次列表首个工作区 */
  const newSessionCwd = activeCwd || groups[0]?.cwd || '';
  /** 首次扫描未回：只有工作区壳子、会话还没到，先不渲染半成品列表，避免先出现空工作区再跳成真实会话 */
  const scanning = Boolean(loading) && groups.every((group) => group.sessions.length === 0);

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

  const [expandedWatermarks, setExpandedWatermarks] = useState<Record<string, number>>({});
  const toggleGroupSessions = (key: string) => {
    setExpandedGroups((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  /** 组排序：置顶优先，手动 = 沿用上层给出的顺序（工作区拖拽排序 / order 元数据），最近更新 = 按组内最新会话 */
  const orderedGroups = useMemo(() => {
    const list = [...groups];
    if (orderBy === 'updated') {
      const timeOf = (group: SessionGroupItem) =>
        Math.max(
          0,
          ...group.sessions.map((item) =>
            item.modifiedMs !== undefined ? item.modifiedMs : (Date.parse(item.modifiedAt) || 0)
          )
        );
      list.sort((a, b) => timeOf(b) - timeOf(a));
    }
    const pinned = list.filter((group) => group.pinned);
    const rest = list.filter((group) => !group.pinned);
    // 「未分组」是只读兜底组，固定落在末尾（对齐 DSH）
    return [...pinned, ...rest.filter((group) => !group.readonly), ...rest.filter((group) => group.readonly)];
  }, [groups, orderBy]);

  /** 会话排序：置顶优先，其次按当前排序方式（手动 = 沿用上层顺序） */
  const sortSessions = useCallback(
    (list: SessionListItem[]) => {
      const sorted =
        orderBy === 'updated'
          ? [...list].sort((a, b) => {
              const bTime = b.modifiedMs !== undefined ? b.modifiedMs : (Date.parse(b.modifiedAt) || 0);
              const aTime = a.modifiedMs !== undefined ? a.modifiedMs : (Date.parse(a.modifiedAt) || 0);
              return bTime - aTime;
            })
          : [...list];
      const pinned = sorted.filter((item) => item.pinned);
      return pinned.length > 0 ? [...pinned, ...sorted.filter((item) => !item.pinned)] : sorted;
    },
    [orderBy]
  );

  /** 归档过滤：默认隐藏已归档（对齐 DSH viewOptions） */
  const matchesArchive = useCallback(
    (item: SessionListItem) =>
      archivedFilter === 'show' ? true : archivedFilter === 'only' ? Boolean(item.archived) : !item.archived,
    [archivedFilter]
  );

  const filteredGroups = useMemo(
    () =>
      orderedGroups
        .map((group) => ({ ...group, sessions: group.sessions.filter(matchesArchive) }))
        // 真正没有会话的空工作区保留（新建后立刻可见）；只因归档过滤变空的组才收起
        .filter((group, index) => group.sessions.length > 0 || orderedGroups[index].sessions.length === 0),
    [orderedGroups, matchesArchive]
  );

  /** 单列表模式：把全部工作区的会话摊平成一条列表 */
  const flatSessions = useMemo(
    () => sortSessions(filteredGroups.flatMap((group) => group.sessions)),
    [filteredGroups, sortSessions]
  );

  // 正文全文搜索：输入停顿 250ms 再请求（对齐 DSH）
  useEffect(() => {
    if (!searching || !onSearchContent) {
      setContentHits([]);
      setContentLoading(false);
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
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searching, query, onSearchContent]);

  /** 本地命中：标题、工作区名、会话 ID（对齐 DSH deriveSearchResults） */
  const localHits = useMemo(() => {
    if (!searching) return [];
    const keyword = query.trim().toLowerCase();
    const hits: Array<{ row: SearchRow; updatedMs: number }> = [];
    const seen = new Set<string>();
    for (const group of groups) {
      const labelMatched = group.label.toLowerCase().includes(keyword);
      for (const session of group.sessions) {
        if (session.draft || !matchesArchive(session) || seen.has(session.id)) continue;
        const title = (session.title || '').toLowerCase();
        const taskTitle = (session.task?.title || '').toLowerCase();
        if (
          !title.includes(keyword) &&
          !taskTitle.includes(keyword) &&
          !labelMatched &&
          !session.id.toLowerCase().includes(keyword)
        ) {
          continue;
        }
        seen.add(session.id);
        hits.push({
          row: {
            id: session.id,
            title: session.title || '未命名会话',
            workspace: group.label,
            running: session.running,
            task: session.task,
          },
          updatedMs:
            session.modifiedMs !== undefined
              ? session.modifiedMs
              : Date.parse(session.modifiedAt) || 0,
        });
      }
    }
    return hits.sort((a, b) => b.updatedMs - a.updatedMs).map((item) => item.row);
  }, [searching, groups, matchesArchive, query]);

  /** 正文命中：只保留仍在列表中、且符合归档筛选的会话 */
  const contentRows = useMemo(() => {
    if (!searching) return [];
    const localIds = new Set(localHits.map((row) => row.id));
    const lookup = new Map<string, { session: SessionListItem; workspace: string }>();
    for (const group of groups) {
      for (const session of group.sessions) lookup.set(session.id, { session, workspace: group.label });
    }
    return contentHits.flatMap((hit): SearchRow[] => {
      if (localIds.has(hit.id)) return [];
      const found = lookup.get(hit.id);
      if (!found || found.session.draft || !matchesArchive(found.session)) return [];
      return [
        {
          id: hit.id,
          title: found.session.title || '未命名会话',
          workspace: found.workspace,
          running: found.session.running,
          snippet: hit.snippet,
          task: found.session.task,
        },
      ];
    });
  }, [searching, contentHits, groups, localHits, matchesArchive]);

  /** 合并结果：本地命中在前，正文命中在后；重复会话用正文片段补全（对齐 DSH） */
  const searchRows = useMemo(() => {
    const contentById = new Map(contentHits.map((hit) => [hit.id, hit]));
    return [
      ...localHits.map((row) => ({ ...row, snippet: contentById.get(row.id)?.snippet })),
      ...contentRows,
    ].slice(0, SEARCH_RESULT_LIMIT);
  }, [localHits, contentRows, contentHits]);

  const searchHasMore =
    localHits.length + contentRows.length > SEARCH_RESULT_LIMIT ||
    contentHits.length >= SEARCH_RESULT_LIMIT;

  const [card, setCard] = useState<HoverCardState | null>(null);
  /** 悬浮卡的停留计时器与「本列表已显示过」预热标记 */
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warm = useRef(false);
  // 卸载时清掉未到期的停留计时
  useEffect(
    () => () => {
      if (cardTimer.current !== null) clearTimeout(cardTimer.current);
    },
    []
  );
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** 待确认删除的工作区（对齐 DSH：删除只影响列表，不动文件夹与会话） */
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; title: string } | null>(null);
  const searchHeaderRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 搜索展开后聚焦输入框（点击与快捷键共用）
  useEffect(() => {
    if (!searchExpanded) return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [searchExpanded, searchSignal]);

  // 空搜索时点击区头外收起（对齐 DSH：有搜索词时保持展开）
  useEffect(() => {
    if (!searchExpanded || searching) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && searchHeaderRef.current?.contains(event.target)) return;
      setSearchOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [searchExpanded, searching]);

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

  // 删除工作区确认框：Esc 只关这一层，不再向外传递
  useEffect(() => {
    if (!deleteTarget) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setDeleteTarget(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [deleteTarget]);

  /** 悬浮卡：首次停留 800ms 才显示，同一列表内已显示过则立即跟随（对齐 DSH HoverCardGroup 的 grouped 预热） */
  const showCard = (
    element: HTMLElement,
    title: string,
    path: string,
    time: string,
    task?: string
  ) => {
    if (cardTimer.current !== null) clearTimeout(cardTimer.current);
    cardTimer.current = null;
    const open = () => {
      const rect = element.getBoundingClientRect();
      warm.current = true;
      setCard({
        title,
        path: homeShortened(path),
        time,
        task,
        top: Math.min(Math.max(12, rect.top - 4), window.innerHeight - 150),
        left: Math.min(rect.right + 10, window.innerWidth - 312),
        host: element.closest<HTMLElement>('.agent-scope') || document.body,
      });
    };
    if (warm.current) {
      open();
      return;
    }
    cardTimer.current = setTimeout(() => {
      cardTimer.current = null;
      open();
    }, HOVER_CARD_DELAY_MS);
  };

  /** 收起悬浮卡，并取消尚未到期的停留计时 */
  const hideCard = () => {
    if (cardTimer.current !== null) clearTimeout(cardTimer.current);
    cardTimer.current = null;
    setCard(null);
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

  /** 打开视图选项菜单（对齐 DSH 的 sliders 图标入口） */
  const openViewMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (viewMenu) {
      setViewMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setViewMenu({ top: rect.bottom + 4, left: Math.max(12, rect.right - 216) });
  };

  const viewOptionsActive =
    groupBy !== 'workspace' || orderBy !== 'updated' || archivedFilter !== 'hide';

  /** 搜索结果当前高亮项（结果变少时夹紧索引） */
  const searchActiveIndex = Math.min(hitIndex, Math.max(0, searchRows.length - 1));

  /** 打开搜索结果：清空搜索并收起（对齐 DSH openSearchResult） */
  const openSearchHit = (id: string) => {
    onSelectSession(id);
    onQueryChange('');
    setSearchOpen(false);
  };

  /** 搜索结果键盘导航：↑↓ 选择，Enter 打开（DSH 之外的增强） */
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      onQueryChange('');
      setSearchOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (searchRows.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHitIndex((prev) => (prev + step + searchRows.length) % searchRows.length);
      return;
    }
    if (event.key === 'Enter') {
      const hit = searchRows[searchActiveIndex];
      if (!hit) return;
      event.preventDefault();
      openSearchHit(hit.id);
    }
  };

  /** 搜索结果平铺在侧栏列表区（对齐 DSH：结果取代项目树，不是浮层） */
  const searchBody = (
    <div className={styles.searchResults} data-agent-transient>
      {searchRows.map((row, index) => (
        <button
          key={row.id}
          type="button"
          className={`${styles.searchHit} ${index === searchActiveIndex ? styles.searchHitActive : ''}`}
          onClick={() => openSearchHit(row.id)}
          onMouseEnter={() => setHitIndex(index)}
        >
          <span className={styles.searchHitHeading}>
            <span className={styles.statusSlot}>
              {row.running && <span className={styles.liveSpinner} aria-label="进行中" />}
            </span>
            <span className={styles.searchHitTitle}>{row.title}</span>
            {row.task && (
              <span className={styles.taskTag} title={`任务：${row.task.title}`}>
                任务
              </span>
            )}
          </span>
          <span className={styles.searchHitMeta}>
            <span className={styles.searchHitWorkspace}>{row.workspace}</span>
            {row.snippet && <span className={styles.searchHitSnippet}>{row.snippet}</span>}
          </span>
        </button>
      ))}
      {contentLoading && <div className={styles.searchStatus}>正在搜索会话历史…</div>}
      {!contentLoading && searchRows.length === 0 && (
        <div className={styles.searchStatus}>无匹配会话</div>
      )}
      {searchHasMore && (
        <div className={styles.searchPanelFoot}>
          仅显示前 {SEARCH_RESULT_LIMIT} 条结果，请缩小搜索范围。
        </div>
      )}
    </div>
  );

  /** 当前菜单指向的项目（项目菜单里重命名 / 置顶 / 隐藏共用） */
  const menuProject = useMemo(
    () =>
      menu?.kind === 'project'
        ? orderedGroups.find((item) => item.key === (menu.key || menu.cwd))
        : undefined,
    [menu, orderedGroups]
  );

  return (
    <aside
      className={styles.root}
      onMouseLeave={() => {
        warm.current = false;
        hideCard();
      }}
    >
      {/* 顶条与红黄绿同排：收起入口贴侧栏右上角（对齐 DSH topStrip） */}
      <div className={styles.topStrip}>
        {onCollapse && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onCollapse}
            title="收起侧边栏"
            aria-label="收起侧边栏"
          >
            <IconPanelLeft size={16} />
          </button>
        )}
      </div>

      {brandSlot}

      <button
        type="button"
        className={styles.newSession}
        onClick={() => onNewInGroup(newSessionCwd)}
      >
        <IconNewChat size={14} />
        <span className={styles.newSessionLabel}>新会话</span>
      </button>

      <div ref={searchHeaderRef} className={styles.sectionHeader}>
        {searchExpanded ? (
          <label className={styles.searchPill}>
            <IconSearch size={14} className={styles.searchIcon} />
            <input
              ref={searchInputRef}
              className={styles.search}
              value={query}
              placeholder="搜索会话与内容"
              maxLength={SEARCH_QUERY_MAX_CHARS}
              autoFocus
              onChange={(event) => onQueryChange(sanitizeQuery(event.target.value))}
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
            {/* 区头是纯标签（对齐 DSH）：单列表模式显示「会话」，否则「工作区」 */}
            <span className={styles.sectionTitle}>{groupBy === 'flat' ? '会话' : '工作区'}</span>
            <span className={styles.sectionActions}>
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
                className={`${styles.iconButton} ${viewOptionsActive ? styles.iconButtonActive : ''}`}
                onClick={openViewMenu}
                title="视图选项"
                aria-label="视图选项"
                aria-haspopup="menu"
                aria-expanded={Boolean(viewMenu)}
                data-agent-transient
              >
                <IconSliders size={16} />
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
        {searching && searchBody}
        {!searching && scanning && <div className={styles.placeholder}>正在扫描会话…</div>}
        {!searching && !loading && groups.length === 0 && (
          <div className={styles.placeholder}>还没有工作区。点右上角图标选择一个目录。</div>
        )}
        {!searching && !loading && groups.length > 0 && filteredGroups.length === 0 && (
          <div className={styles.placeholder}>
            {archivedFilter === 'only' ? '暂无已归档会话' : '暂无会话'}
          </div>
        )}

        {!searching && !scanning && groupBy === 'flat' && (
          <>
            {flatSessions.length === 0 ? (
              <div className={styles.placeholder}>
                {archivedFilter === 'only' ? '暂无已归档会话' : '暂无会话'}
              </div>
            ) : (
              flatSessions.slice(0, flatLimit).map((session) => (
                <SessionRowItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeId}
                  renaming={rename?.kind === 'session' && rename.key === session.id}
                  renameValue={rename?.key === session.id ? rename.value : ''}
                  renameInputRef={renameInputRef}
                  onRenameChange={(value) => setRename((prev) => (prev ? { ...prev, value } : null))}
                  onRenameCommit={commitRename}
                  onRenameCancel={() => setRename(null)}
                  onSelectSession={onSelectSession}
                  onPinSession={onPinSession}
                  onOpenMenu={openMenu}
                  onShowCard={showCard}
                  onHideCard={hideCard}
                />
              ))
            )}
            {flatSessions.length > flatLimit && (
              <button
                type="button"
                className={styles.overflowButton}
                onClick={() => setFlatLimit((prev) => prev + FLAT_PAGE_SIZE)}
              >
                显示其余 {flatSessions.length - flatLimit} 个会话
              </button>
            )}
          </>
        )}

        {!searching && !scanning && groupBy === 'workspace' && filteredGroups.map((group) => {
          const isCollapsed = collapsed.includes(group.key);
          const isExpanded = expandedGroups.includes(group.key);
          const sortedSessions = sortSessions(group.sessions);
          const watermark = expandedWatermarks[group.key] || SESSION_VISIBLE_COUNT;
          const visibleSessions = isExpanded
            ? sortedSessions.slice(0, watermark)
            : sortedSessions.slice(0, SESSION_VISIBLE_COUNT);
          const hiddenCount = sortedSessions.length - visibleSessions.length;
          /** 已展开过（分批中或全展开）：随时可一键收起，不必等全部展开 */
          const collapsible = !searching && isExpanded && sortedSessions.length > SESSION_VISIBLE_COUNT;
          const renamingProject = rename?.kind === 'project' && rename.key === group.key;

          return (
            <div key={group.key} className={styles.group}>
              <div
                className={styles.projectRow}
                draggable={Boolean(onReorderProjects) && !renamingProject && !group.readonly}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/openloop-project', group.key);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  if (!onReorderProjects || group.readonly) return;
                  if (!event.dataTransfer.types.includes('text/openloop-project')) return;
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  const source = event.dataTransfer.getData('text/openloop-project');
                  if (!onReorderProjects || group.readonly || !source || source === group.key) return;
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
                onMouseLeave={hideCard}
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
                {group.pinned && (
                  <span className={styles.pinMark} aria-label="已置顶">
                    <IconPin size={13} />
                  </span>
                )}
                {!group.readonly && (
                  <span className={styles.rowActions}>
                    {onPinProject && (
                      <button
                        type="button"
                        className={`${styles.rowIcon} ${group.pinned ? styles.rowIconActive : ''}`}
                        aria-label={group.pinned ? '取消置顶' : '置顶工作区'}
                        title={group.pinned ? '取消置顶' : '置顶工作区'}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPinProject(group.key, !group.pinned);
                        }}
                      >
                        <IconPin size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.rowIcon}
                      aria-label="更多操作"
                      onClick={(event) =>
                        openMenu(event, { kind: 'project', cwd: group.cwd, key: group.key })
                      }
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
                )}
              </div>

              {!isCollapsed && (
                <div className={styles.groupBody}>
                  {group.sessions.length === 0 && (
                    <button
                      type="button"
                      className={styles.sessionRow}
                      onClick={() => onNewInGroup(group.cwd)}
                    >
                      <span className={styles.statusSlot} />
                      <span className={styles.sessionTitle}>新会话</span>
                    </button>
                  )}

                  {visibleSessions.map((session) => (
                    <SessionRowItem
                      key={session.id}
                      session={session}
                      isActive={session.id === activeId}
                      renaming={rename?.kind === 'session' && rename.key === session.id}
                      renameValue={rename?.key === session.id ? rename.value : ''}
                      renameInputRef={renameInputRef}
                      onRenameChange={(value) => setRename((prev) => (prev ? { ...prev, value } : null))}
                      onRenameCommit={commitRename}
                      onRenameCancel={() => setRename(null)}
                      onSelectSession={onSelectSession}
                      onPinSession={onPinSession}
                      onOpenMenu={openMenu}
                      onShowCard={showCard}
                      onHideCard={hideCard}
                    />
                  ))}

                  {(hiddenCount > 0 || collapsible) && (
                    <div className={styles.overflowRow}>
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          className={styles.overflowButton}
                          onClick={() => {
                            setExpandedGroups((prev) =>
                              prev.includes(group.key) ? prev : [...prev, group.key]
                            );
                            setExpandedWatermarks((prev) => ({
                              ...prev,
                              [group.key]: (prev[group.key] || SESSION_VISIBLE_COUNT) + GROUP_WATERMARK_STEP,
                            }));
                          }}
                        >
                          展开其余 {hiddenCount} 个会话
                        </button>
                      )}
                      {collapsible && (
                        <button
                          type="button"
                          className={`${styles.overflowButton} ${styles.overflowCollapse}`}
                          onClick={() => {
                            toggleGroupSessions(group.key);
                            setExpandedWatermarks((prev) => {
                              const next = { ...prev };
                              delete next[group.key];
                              return next;
                            });
                          }}
                        >
                          收起
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {card &&
        createPortal(
          <div
            className={styles.hoverCard}
            style={{ top: card.top, left: card.left }}
            role="presentation"
            data-agent-transient
          >
            <div className={styles.hoverTitle}>{card.title}</div>
            {card.task && <div className={styles.hoverTask}>任务 · {card.task}</div>}
            {card.path && <div className={styles.hoverPath}>{card.path}</div>}
            {card.time && <div className={styles.hoverTime}>{card.time}</div>}
          </div>,
          card.host
        )}

      {deleteTarget &&
        createPortal(
          <div
            className={`agent-scope ${styles.dialogBackdrop}`}
            role="presentation"
            onMouseDown={() => setDeleteTarget(null)}
          >
            <div
              className={styles.dialog}
              role="alertdialog"
              aria-modal="true"
              aria-label="删除工作区"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className={styles.dialogTitle}>删除工作区</div>
              <div className={styles.dialogBody}>
                将把“{deleteTarget.title}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。
              </div>
              <div className={styles.dialogActions}>
                <button type="button" className={styles.dialogCancel} onClick={() => setDeleteTarget(null)}>
                  取消
                </button>
                <button
                  type="button"
                  autoFocus
                  className={styles.dialogDanger}
                  onClick={() => {
                    if (import.meta.env?.DEV) {
                      console.log('[SessionList] 删除工作区:', deleteTarget.key);
                    }
                    onDeleteProject?.(deleteTarget.key);
                    setDeleteTarget(null);
                  }}
                >
                  删除工作区
                </button>
              </div>
            </div>
          </div>,
          document.body
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
                    const group = orderedGroups.find((item) => item.key === menuProject?.key);
                    startRename('project', menuProject?.key || menu.cwd, group?.label || '');
                  }}
                >
                  重命名工作区
                </button>
              )}
              {onPinProject && menuProject && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    onPinProject(menuProject.key, !menuProject.pinned);
                    setMenu(null);
                  }}
                >
                  {menuProject.pinned ? '取消置顶' : '置顶工作区'}
                </button>
              )}
              {onDeleteProject && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    const group = orderedGroups.find((item) => item.key === menuProject?.key);
                    setDeleteTarget({
                      key: menuProject?.key || menu.cwd,
                      title: group?.label || menu.cwd,
                    });
                    setMenu(null);
                  }}
                >
                  删除工作区
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
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => reveal(menu.cwd || '.')}
            disabled={!menu.cwd}
          >
            在访达中打开
          </button>
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

      {viewMenu && (
        <div
          className={styles.menu}
          style={{ top: viewMenu.top, left: viewMenu.left, width: 216 }}
          role="menu"
          data-agent-transient
          onClick={(event) => event.stopPropagation()}
        >
          <div className={styles.menuLabel}>分组方式</div>
          <button
            type="button"
            className={`${styles.menuItem} ${groupBy === 'workspace' ? styles.menuItemActive : ''}`}
            onClick={() => {
              setGroupBy('workspace');
              setViewMenu(null);
            }}
          >
            <IconFolderClose size={14} />
            按工作区
          </button>
          <button
            type="button"
            className={`${styles.menuItem} ${groupBy === 'flat' ? styles.menuItemActive : ''}`}
            onClick={() => {
              setGroupBy('flat');
              setViewMenu(null);
            }}
          >
            <IconFlatList size={14} />
            单列表
          </button>

          <div className={styles.menuDivider} role="separator" />
          <div className={styles.menuLabel}>排序方式</div>
          {(['manual', 'updated'] as OrderBy[]).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${styles.menuItem} ${orderBy === mode ? styles.menuItemActive : ''}`}
              onClick={() => {
                setOrderBy(mode);
                setViewMenu(null);
              }}
            >
              {mode === 'manual' ? <IconSort size={14} /> : <IconClock size={14} />}
              {ORDER_BY_LABEL[mode]}
            </button>
          ))}

          <div className={styles.menuDivider} role="separator" />
          <div className={styles.menuLabel}>筛选会话</div>
          <button
            type="button"
            className={`${styles.menuItem} ${archivedFilter === 'hide' ? styles.menuItemActive : ''}`}
            onClick={() => {
              setArchivedFilter('hide');
              setViewMenu(null);
            }}
          >
            <IconArchiveOff size={14} />
            {ARCHIVED_LABEL.hide}
          </button>
          <button
            type="button"
            className={`${styles.menuItem} ${archivedFilter === 'show' ? styles.menuItemActive : ''}`}
            onClick={() => {
              setArchivedFilter('show');
              setViewMenu(null);
            }}
          >
            <IconQueue size={14} />
            {ARCHIVED_LABEL.show}
          </button>
          <button
            type="button"
            className={`${styles.menuItem} ${archivedFilter === 'only' ? styles.menuItemActive : ''}`}
            onClick={() => {
              setArchivedFilter('only');
              setViewMenu(null);
            }}
          >
            <IconArchiveCheck size={14} />
            {ARCHIVED_LABEL.only}
          </button>
        </div>
      )}
    </aside>
  );
});
