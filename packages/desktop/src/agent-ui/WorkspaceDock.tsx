import React, { Fragment, Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { AgentMarkdown } from './Markdown';
import { DiffPane } from './DiffPane';
import { CodeBlock } from './dsh/CodeBlock';
import { languageForPath } from './dsh/code-language';
import { ImageLightbox } from './dsh/ImageLightbox';
import { useDismissOnOutsidePointer } from './dsh/useDismissOnOutsidePointer';
import {
  IconCheck,
  IconClose,
  IconFolderClose,
  IconFolderOpen,
  IconPanelRight,
  IconPlus,
  IconRefresh,
} from './icons';
import styles from './WorkspaceDock.module.css';

/** 终端页签首次被选中才加载 xterm：不进首屏包 */
const TerminalPane = lazy(() => import('./dsh/TerminalPane').then((module) => ({ default: module.TerminalPane })));

export type DockTab = 'files' | 'terminal' | 'preview' | 'diff';

/** 上层发起的页签请求：同一个请求重复触发也要生效，所以带序号 */
export interface DockRequest {
  kind: DockTab;
  /** 预览页签的文件路径 */
  path?: string;
  /** diff 页签的改动标识 */
  changeId?: string;
  seq: number;
}

interface DockPane {
  key: string;
  kind: DockTab;
  title: string;
  /** 预览页签的文件路径 */
  path?: string;
  /** diff 页签的改动标识 */
  changeId?: string;
  /** 重复打开同一个文件时递增，用来重新加载 */
  seq: number;
}

interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const MARKDOWN_EXT = /\.(md|mdx)$/i;

/** 面板固定页签：文件与终端，预览页签由打开的文件生成 */
const PINNED_PANES: DockPane[] = [
  { key: 'files', kind: 'files', title: '文件', seq: 0 },
  { key: 'terminal', kind: 'terminal', title: '终端', seq: 0 },
];

/** 「+」菜单里能重新打开的页签 */
const ADDABLE_KINDS: Array<{ kind: DockTab; title: string }> = [
  { kind: 'files', title: '文件' },
  { kind: 'terminal', title: '终端' },
];

/** 面板宽度：拖动左缘调整，双击复位，按工作区无关的界面偏好持久化 */
const DOCK_WIDTH_KEY = 'openloop.agent.dockWidth';
const DOCK_MIN_WIDTH = 300;
const DOCK_MAX_WIDTH = 760;
/** 首次打开宽度：对齐 DSH 右侧边栏的首开比例（帧宽的 45%） */
const DOCK_DEFAULT_RATIO = 0.45;

function clampDockWidth(width: number): number {
  const viewport = typeof window === 'undefined' ? DOCK_MAX_WIDTH : window.innerWidth * 0.7;
  const max = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(viewport)));
  return Math.min(Math.max(Math.round(width), DOCK_MIN_WIDTH), max);
}

function defaultDockWidth(): number {
  const viewport = typeof window === 'undefined' ? DOCK_MAX_WIDTH : window.innerWidth;
  return clampDockWidth(viewport * DOCK_DEFAULT_RATIO);
}

function readDockWidth(): number {
  try {
    const stored = Number(localStorage.getItem(DOCK_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampDockWidth(stored) : defaultDockWidth();
  } catch (_) {
    return defaultDockWidth();
  }
}

function writeDockWidth(width: number): void {
  try {
    localStorage.setItem(DOCK_WIDTH_KEY, String(width));
  } catch (_) {
    /* 隐私模式下无法持久化，宽度只在本次会话生效 */
  }
}

function baseName(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return path.slice(slash + 1) || path;
}

function previewKey(path: string): string {
  return `preview:${path}`;
}

/** diff 页签按改动标识区分：同一个文件在不同轮次是两个页签 */
function diffKey(changeId: string): string {
  return `diff:${changeId}`;
}

function pinnedPane(kind: DockTab): DockPane {
  return PINNED_PANES.find((pane) => pane.kind === kind) || PINNED_PANES[0];
}

/** 一个会话的工作台：开合状态与它自己的一套页签 */
interface DockSurface {
  open: boolean;
  panes: DockPane[];
  activeKey: string;
  /** 最近一次页签请求：同样归会话所有，切回来不会落到别的会话上 */
  request: DockRequest | null;
}

const INITIAL_SURFACE: DockSurface = {
  open: false,
  panes: PINNED_PANES,
  activeKey: PINNED_PANES[0].key,
  request: null,
};

/** 上层持有的工作台状态与入口，交给 WorkspaceDock 渲染 */
export interface AgentDock {
  /** 当前会话的工作台是否展开 */
  open: boolean;
  /** 当前会话的页签与激活项 */
  panes: DockPane[];
  activeKey: string;
  /** 最近一次页签请求 */
  request: DockRequest | null;
  /** 打开工作台并切到某个页签；带路径就是把该文件作为预览页签打开 */
  openTab: (kind: DockTab, path?: string, changeId?: string) => void;
  /** 收起 / 展开工作台 */
  toggle: () => void;
  /** 收起工作台 */
  close: () => void;
  /** 面板内部改页签：切页签、关页签、重开固定页签 */
  setPanes: (panes: DockPane[], activeKey: string) => void;
}

/**
 * 工作台的会话状态：开合与页签都按会话各存一份，切会话换一套，切回来还在。
 * 与 DSH 的停靠面板一致 —— 面板属于会话，开关与页签都跟着会话走。
 */
export function useAgentDock(sessionKey: string): AgentDock {
  const [surfaces, setSurfaces] = useState<Record<string, DockSurface>>({});
  const seq = useRef(0);
  const session = sessionKey || '';
  const surface = surfaces[session] ?? INITIAL_SURFACE;

  const patch = useCallback(
    (next: (surface: DockSurface) => DockSurface) => {
      setSurfaces((prev) => {
        const current = prev[session] ?? INITIAL_SURFACE;
        const updated = next(current);
        return updated === current ? prev : { ...prev, [session]: updated };
      });
    },
    [session]
  );

  const openTab = useCallback(
    (kind: DockTab, path?: string, changeId?: string) => {
      if (import.meta.env?.DEV) console.log('[AgentDock] 打开页签:', { session, kind, path, changeId });
      const request: DockRequest = { kind, path, changeId, seq: ++seq.current };
      patch((current) => ({ ...current, open: true, request }));
    },
    [patch, session]
  );

  const toggle = useCallback(() => patch((current) => ({ ...current, open: !current.open })), [patch]);
  const close = useCallback(() => patch((current) => ({ ...current, open: false })), [patch]);
  const setPanes = useCallback(
    (panes: DockPane[], activeKey: string) => patch((current) => ({ ...current, panes, activeKey })),
    [patch]
  );

  return {
    open: surface.open,
    panes: surface.panes,
    activeKey: surface.activeKey,
    request: surface.request,
    openTab,
    toggle,
    close,
    setPanes,
  };
}

/** 文本预览的代码卡文案，与 Markdown 里的围栏代码块一致 */
const PREVIEW_TOOLBAR_LABELS = {
  codeLabel: '文本',
  wrapLabel: '关闭自动折行',
  unwrapLabel: '按面板宽度自动折行',
};

const PREVIEW_LABELS = { dialog: '图片预览', close: '关闭' };

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 页签条：DSH 停靠面板的一行（28px 胶囊页签、页签之间的发丝槽、末尾的操作位）。
 * 页签自己不带边框，激活项是填充的胶囊，关闭按钮压住标题尾部，悬停与激活时才出现。
 */
const TabStrip = memo(function TabStrip({
  panes,
  activeKey,
  onSelect,
  onClose,
  onAdd,
  addOpen,
  onAddOpenChange,
  onClosePanel,
}: {
  panes: DockPane[];
  activeKey: string;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onAdd: (kind: DockTab) => void;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
  onClosePanel: () => void;
}) {
  const addRef = useRef<HTMLDivElement | null>(null);
  const chips = useRef(new Map<string, HTMLDivElement>());
  useDismissOnOutsidePointer(addRef, addOpen, onAddOpenChange);

  // 菜单开着时 Esc 只关菜单：外层面板靠 data-agent-transient 让位
  useEffect(() => {
    if (!addOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onAddOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [addOpen, onAddOpenChange]);

  /** 左右方向键在页签间移动焦点，Enter / 空格选中：与 DSH 的手动激活一致 */
  const handleChipKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, key: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(key);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = panes.findIndex((pane) => pane.key === key);
    const next = panes[(index + (event.key === 'ArrowRight' ? 1 : -1) + panes.length) % panes.length];
    if (next) chips.current.get(next.key)?.focus();
  };

  return (
    <div className={styles.strip} role="tablist" aria-label="工作台页签">
      <div className={styles.stripTabs}>
        {panes.map((pane, index) => {
          const active = pane.key === activeKey;
          return (
            <Fragment key={pane.key}>
              {index > 0 && <span className={styles.slot} aria-hidden="true" />}
              <div
                ref={(element) => {
                  if (element) chips.current.set(pane.key, element);
                  else chips.current.delete(pane.key);
                }}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={pane.path || pane.title}
                className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                onClick={() => onSelect(pane.key)}
                onKeyDown={(event) => handleChipKeyDown(event, pane.key)}
                onAuxClick={(event) => {
                  // 中键关闭：与点关闭按钮同一条路径，且不切换页签
                  if (event.button !== 1) return;
                  event.preventDefault();
                  onClose(pane.key);
                }}
              >
                <span className={styles.chipTitle}>{pane.title}</span>
                <button
                  type="button"
                  className={styles.chipClose}
                  aria-label={`关闭 ${pane.title}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(pane.key);
                  }}
                >
                  <IconClose size={14} />
                </button>
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className={styles.stripFill} />

      <div ref={addRef} className={styles.addWrap} data-agent-transient={addOpen ? '' : undefined}>
        <button
          type="button"
          className={styles.stripButton}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          aria-label="打开页签"
          title="打开页签"
          onClick={() => onAddOpenChange(!addOpen)}
        >
          <IconPlus size={16} />
        </button>
        {addOpen && (
          <div className={styles.addMenu} role="menu">
            {ADDABLE_KINDS.map((item) => {
              const open = panes.some((pane) => pane.key === item.kind);
              return (
                <button
                  key={item.kind}
                  type="button"
                  role="menuitem"
                  className={styles.addMenuItem}
                  onClick={() => onAdd(item.kind)}
                >
                  <span className={styles.addMenuLabel}>{item.title}</span>
                  {open && <IconCheck size={14} className={styles.addMenuCheck} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        className={styles.stripButton}
        aria-label="收起工作台"
        title="收起工作台"
        onClick={onClosePanel}
      >
        <IconPanelRight size={16} />
      </button>
    </div>
  );
});

/** 文件树：按需展开目录 */
const FileTree = memo(function FileTree({
  root,
  activePath,
  onPick,
}: {
  root: string;
  activePath?: string;
  onPick: (entry: FsEntry) => void;
}) {
  const [children, setChildren] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (dir: string) => {
    try {
      const listing = await api.listAgentFs(dir);
      setChildren((prev) => ({ ...prev, [dir]: listing.entries }));
      setError(null);
    } catch (err: any) {
      setError(err?.message || '无法读取目录');
    }
  }, []);

  useEffect(() => {
    if (!root) return;
    setChildren({});
    setExpanded([root]);
    void load(root);
  }, [root, load]);

  const toggle = useCallback(
    (entry: FsEntry) => {
      setExpanded((prev) => {
        if (prev.includes(entry.path)) return prev.filter((item) => item !== entry.path);
        void load(entry.path);
        return [...prev, entry.path];
      });
    },
    [load]
  );

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const entries = children[dir];
    if (!entries) return <div className={styles.treeLoading} style={{ paddingLeft: 12 + depth * 12 }}>读取中…</div>;
    if (entries.length === 0) {
      return (
        <div className={styles.treeEmpty} style={{ paddingLeft: 12 + depth * 12 }}>
          空目录
        </div>
      );
    }
    return entries.map((entry) => (
      <div key={entry.path}>
        <button
          type="button"
          className={`${styles.treeRow} ${entry.path === activePath ? styles.treeRowActive : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => (entry.isDir ? toggle(entry) : onPick(entry))}
          title={entry.path}
        >
          {entry.isDir ? (
            <span className={styles.treeIcon}>
              {expanded.includes(entry.path) ? <IconFolderOpen size={14} /> : <IconFolderClose size={14} />}
            </span>
          ) : (
            <span className={styles.treeIconGhost} />
          )}
          <span className={styles.treeName}>{entry.name}</span>
          {!entry.isDir && <span className={styles.treeSize}>{formatSize(entry.size)}</span>}
        </button>
        {entry.isDir && expanded.includes(entry.path) && renderDir(entry.path, depth + 1)}
      </div>
    ));
  };

  if (error) return <div className={styles.dockEmpty}>{error}</div>;
  return <div className={styles.tree}>{root ? renderDir(root, 0) : null}</div>;
});

interface PreviewState {
  path: string;
  content?: string;
  error?: string;
  truncated?: boolean;
  image?: boolean;
  loading?: boolean;
  /** 每次加载递增：图片靠它重新取字节 */
  seq: number;
}

/** 预览头：目录淡出、文件名常驻，末尾是重新加载（对齐 DSH 文档预览的一行头） */
const PreviewHeader = memo(function PreviewHeader({ path, onReload }: { path: string; onReload: () => void }) {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return (
    <div className={styles.previewHeader}>
      <span className={styles.previewPath} title={path}>
        {slash > 0 && <span className={styles.previewDir}>{path.slice(0, slash + 1)}</span>}
        <span className={styles.previewName}>{path.slice(slash + 1)}</span>
      </span>
      <button type="button" className={styles.previewTool} onClick={onReload} title="重新加载" aria-label="重新加载">
        <IconRefresh size={14} />
      </button>
    </div>
  );
});

/** 文档预览：图片走原始字节，Markdown 走路渲染，其余交给 DSH 的 CodeBlock（高亮 + 行号 + 折行 + 复制） */
const FilePreview = memo(function FilePreview({
  path,
  seq: requestSeq,
  cwd,
}: {
  path: string;
  seq: number;
  cwd?: string;
}) {
  const [target, setTarget] = useState<PreviewState>(() => ({
    path,
    image: IMAGE_EXT.test(path),
    loading: !IMAGE_EXT.test(path),
    seq: 0,
  }));
  const [zoomed, setZoomed] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const next = ++seq.current;
    if (IMAGE_EXT.test(path)) {
      setTarget({ path, image: true, seq: next });
      return;
    }
    setTarget({ path, loading: true, seq: next });
    try {
      const file = await api.readAgentFsFile(path, cwd || '');
      if (seq.current !== next) return;
      setTarget({ path: file.path, content: file.content, truncated: file.truncated, seq: next });
    } catch (err: any) {
      if (seq.current !== next) return;
      setTarget({ path, error: err?.message || '无法读取文件', seq: next });
    }
  }, [path, cwd]);

  // 同一个文件重复打开时 requestSeq 变化，重新读一次
  useEffect(() => {
    void load();
  }, [load, requestSeq]);

  const source = target.image ? api.agentFsRawUrl(target.path, cwd) : '';

  return (
    <div className={styles.preview}>
      <PreviewHeader path={target.path} onReload={() => void load()} />
      {target.image ? (
        <div className={styles.imageWrap}>
          <img
            key={target.seq}
            className={styles.image}
            src={source}
            alt={target.path}
            onClick={() => setZoomed(true)}
          />
        </div>
      ) : target.error ? (
        <div className={styles.previewError}>{target.error}</div>
      ) : target.loading ? (
        <div className={styles.previewLoading}>读取中…</div>
      ) : MARKDOWN_EXT.test(target.path) ? (
        <div className={styles.previewMarkdown}>
          <AgentMarkdown content={target.content || ''} />
        </div>
      ) : (
        <CodeBlock
          className={styles.docCode}
          code={target.content || ''}
          lang={languageForPath(target.path)}
          lineNumbers
          copyLabel="复制"
          copiedLabel="已复制"
          toolbarLabels={PREVIEW_TOOLBAR_LABELS}
        />
      )}
      {target.truncated && <div className={styles.previewNote}>文件较大，仅显示前 512 KB</div>}
      {zoomed && target.image && (
        <ImageLightbox src={source} alt={target.path} labels={PREVIEW_LABELS} onClose={() => setZoomed(false)} />
      )}
    </div>
  );
});

export interface WorkspaceDockProps {
  cwd?: string;
  /** 本会话的页签与激活项，由上层按会话持有 */
  panes: DockPane[];
  activeKey: string;
  /** 上层发起的页签请求：文件、终端，或某个文件的预览 */
  request?: DockRequest | null;
  /** 展开状态：面板常驻，靠盒宽过渡滑入滑出 */
  open: boolean;
  /** 页签变化回写上层：切页签、关页签、打开新页签 */
  onPanesChange: (panes: DockPane[], activeKey: string) => void;
  onClose: () => void;
}

/**
 * 右侧工作台：文件 / 终端 / 预览。页签容器对齐 DSH 停靠面板 —— 一行胶囊页签、
 * 每个页签可单独关闭、「+」重开固定页签，左缘可拖动改变宽度。
 * 页签本身归上层按会话保存，这里只负责画和报手势。
 */
export const WorkspaceDock = memo(function WorkspaceDock({
  cwd,
  panes,
  activeKey,
  request,
  open,
  onPanesChange,
  onClose,
}: WorkspaceDockProps) {
  const root = cwd || '';
  const [width, setWidth] = useState(readDockWidth);
  const [addOpen, setAddOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  /** 面板常驻：收起时内容还留着，滑出动画才有东西可滑；首次打开前不挂内容，避免空跑一次目录请求 */
  const [everOpened, setEverOpened] = useState(open);
  /** 终端首次被看到后才挂载：没点过终端页签就不提前起 shell 进程 */
  const [terminalMounted, setTerminalMounted] = useState(false);

  useEffect(() => {
    if (open) setEverOpened(true);
    if (import.meta.env?.DEV) console.log('[WorkspaceDock] 开合:', open ? '展开' : '收起');
  }, [open]);

  useEffect(() => {
    if (activeKey === 'terminal' && !terminalMounted) {
      setTerminalMounted(true);
      if (import.meta.env?.DEV) console.log('[WorkspaceDock] 首次挂载终端');
    }
  }, [activeKey, terminalMounted]);

  /** 面板最多占主行的 60%：窗口变窄时把持久化的大宽度收回，给会话列留位置 */
  useEffect(() => {
    if (!open) return;
    const clampToRoom = () => {
      const room = asideRef.current?.parentElement?.clientWidth;
      if (!room) return;
      const limit = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(room * 0.6)));
      setWidth((prev) => (prev > limit ? limit : prev));
    };
    clampToRoom();
    window.addEventListener('resize', clampToRoom);
    return () => window.removeEventListener('resize', clampToRoom);
  }, [open]);

  /** 已经放行过的请求：切会话或重开面板时同一份请求不再重复落页签 */
  const appliedRequest = useRef(0);

  const openPreview = useCallback(
    (path: string) => {
      if (import.meta.env?.DEV) console.log('[WorkspaceDock] 预览文件:', path);
      const key = previewKey(path);
      const seq = Date.now();
      onPanesChange(
        panes.some((pane) => pane.key === key)
          ? panes.map((pane) => (pane.key === key ? { ...pane, seq } : pane))
          : [...panes, { key, kind: 'preview' as const, title: baseName(path), path, seq }],
        key
      );
    },
    [panes, onPanesChange]
  );

  /** 一次改动的 diff 页签：按 changeId 去重，重复点同一个改动只重新激活 */
  const openDiff = useCallback(
    (changeId: string, path: string) => {
      if (import.meta.env?.DEV) console.log('[WorkspaceDock] 改动对比:', path, changeId);
      const key = diffKey(changeId);
      onPanesChange(
        panes.some((pane) => pane.key === key)
          ? panes
          : [...panes, { key, kind: 'diff' as const, title: baseName(path), path, changeId, seq: Date.now() }],
        key
      );
    },
    [panes, onPanesChange]
  );

  /** 固定页签：「+」菜单与 files 请求都走这里 */
  const addPane = useCallback(
    (kind: DockTab) => {
      setAddOpen(false);
      onPanesChange(panes.some((pane) => pane.key === kind) ? panes : [...panes, pinnedPane(kind)], kind);
    },
    [panes, onPanesChange]
  );

  // 上层请求：打开文件页签，或把某个文件作为预览 / diff 页签打开
  useEffect(() => {
    if (!request || request.seq === appliedRequest.current) return;
    appliedRequest.current = request.seq;
    if (import.meta.env?.DEV) console.log('[WorkspaceDock] 页签请求:', request);
    if (request.kind === 'preview') {
      if (request.path) openPreview(request.path);
      return;
    }
    if (request.kind === 'diff') {
      if (request.changeId && request.path) openDiff(request.changeId, request.path);
      return;
    }
    addPane(request.kind);
  }, [request, openPreview, openDiff, addPane]);

  const closePane = useCallback(
    (key: string) => {
      const index = panes.findIndex((pane) => pane.key === key);
      if (index < 0) return;
      if (import.meta.env?.DEV) console.log('[WorkspaceDock] 关闭页签:', key);
      const next = panes.filter((pane) => pane.key !== key);
      // 页签全关掉就收起工作台，与 DSH 合并掉空面板一致；再打开时回到固定的文件页签
      if (next.length === 0) {
        onPanesChange(PINNED_PANES, PINNED_PANES[0].key);
        onClose();
        return;
      }
      onPanesChange(next, activeKey === key ? next[Math.min(index, next.length - 1)].key : activeKey);
    },
    [panes, activeKey, onPanesChange, onClose]
  );

  /** 拖动左缘改宽度：窗口监听，指针离开面板也跟手 */
  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startWidth = width;
      // 与样式里的 60% 上限对齐：拖到会话列还有位置为止（resize → 内层 → 面板 → 主行）
      const room = handle.parentElement?.parentElement?.parentElement?.clientWidth || window.innerWidth;
      const limit = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(room * 0.6)));
      let latest = startWidth;
      handle.setPointerCapture(event.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = (moveEvent: PointerEvent) => {
        latest = Math.min(clampDockWidth(startWidth - (moveEvent.clientX - startX)), limit);
        setWidth(latest);
      };
      const onEnd = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch (_) {
          /* 指针已释放时忽略 */
        }
        writeDockWidth(latest);
        if (import.meta.env?.DEV) console.log('[WorkspaceDock] 面板宽度:', latest);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    },
    [width]
  );

  const resetWidth = useCallback(() => {
    const next = defaultDockWidth();
    setWidth(next);
    writeDockWidth(next);
  }, []);

  const nudgeWidth = useCallback(
    (delta: number) => {
      const next = clampDockWidth(width + delta);
      setWidth(next);
      writeDockWidth(next);
    },
    [width]
  );

  const selectPane = useCallback(
    (key: string) => {
      if (key !== activeKey) onPanesChange(panes, key);
    },
    [panes, activeKey, onPanesChange]
  );

  // 文件树的高亮跟着最近打开的那份预览，切到别的页签也不丢
  let previewPath: string | undefined;
  for (const pane of panes) {
    if (pane.kind === 'preview') previewPath = pane.path;
  }

  return (
    <aside
      ref={asideRef}
      className={styles.dock}
      style={{ width: open ? width : 0 }}
      data-open={open}
      aria-label="工作台"
      aria-hidden={!open}
    >
      {(open || everOpened) && (
        <div className={styles.dockInner} style={{ width }}>
          <div
            className={styles.resize}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整工作台宽度"
            tabIndex={0}
            onPointerDown={startResize}
            onDoubleClick={resetWidth}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                nudgeWidth(24);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                nudgeWidth(-24);
              }
            }}
          />

          <TabStrip
            panes={panes}
            activeKey={activeKey}
            onSelect={selectPane}
            onClose={closePane}
            onAdd={addPane}
            addOpen={addOpen}
            onAddOpenChange={setAddOpen}
            onClosePanel={onClose}
          />

          <div className={styles.dockBody}>
            {/* 页签内容常驻：切页签不重挂，终端 shell、文件预览与滚动位置都留着 */}
            {panes.map((pane) => (
              <div key={pane.key} className={styles.pane} hidden={pane.key !== activeKey}>
                {pane.kind === 'files' &&
                  (root ? (
                    <FileTree root={root} activePath={previewPath} onPick={(entry) => openPreview(entry.path)} />
                  ) : (
                    <div className={styles.dockEmpty}>选一个工作区后，这里显示它的文件。</div>
                  ))}
                {pane.kind === 'terminal' && terminalMounted && (
                  <Suspense fallback={null}>
                    <TerminalPane cwd={root} active={pane.key === activeKey} />
                  </Suspense>
                )}
                {pane.kind === 'preview' && pane.path && (
                  <FilePreview path={pane.path} seq={pane.seq} cwd={root} />
                )}
                {pane.kind === 'diff' && pane.changeId && pane.path && (
                  <DiffPane changeId={pane.changeId} path={pane.path} onOpenSource={openPreview} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
});
