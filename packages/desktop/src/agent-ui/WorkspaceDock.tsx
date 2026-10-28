import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../services/api';
import { AgentMarkdown } from './Markdown';
import { IconChevronDown, IconClose, IconFolderClose, IconFolderOpen, IconTriangleRight } from './icons';
import styles from './WorkspaceDock.module.css';

export type DockTab = 'files' | 'terminal' | 'preview';

interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const MARKDOWN_EXT = /\.(md|mdx)$/i;

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

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

/** 终端：xterm + 后端 shell 子进程 */
const TerminalView = memo(function TerminalView({ cwd }: { cwd?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontSize: 12,
      lineHeight: 1.4,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      convertEol: true,
      theme: {
        background: '#ffffff',
        foreground: '#24292f',
        cursor: '#4176e6',
        selectionBackground: 'rgba(65, 118, 230, 0.18)',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    let disposed = false;
    let terminalId: string | null = null;

    const timer = window.setTimeout(() => {
      try {
        fit.fit();
      } catch (_) {
        /* 容器尚未布局时忽略 */
      }
    }, 0);

    const unsubscribe = api.on('agent:terminal', (payload: any) => {
      if (!payload || payload.id !== terminalId) return;
      if (payload.exited) {
        term.write('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n');
        return;
      }
      if (typeof payload.data === 'string') term.write(payload.data);
    });

    api
      .openTerminal(cwd)
      .then(({ id, replay }) => {
        if (disposed) {
          void api.closeTerminal(id);
          return;
        }
        terminalId = id;
        if (replay) term.write(replay);
        term.write(`\r\n\x1b[90mopenLoop 终端 · ${cwd || '~'}\x1b[0m\r\n`);
      })
      .catch((err) => {
        term.write(`\r\n\x1b[31m无法启动终端: ${String(err?.message || err)}\x1b[0m\r\n`);
      });

    const dataSub = term.onData((data) => {
      if (terminalId) void api.writeTerminal(terminalId, data);
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch (_) {
        /* 忽略布局瞬间的尺寸异常 */
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      observer.disconnect();
      dataSub.dispose();
      unsubscribe();
      if (terminalId) void api.closeTerminal(terminalId);
      term.dispose();
    };
  }, [cwd]);

  return <div ref={hostRef} className={styles.terminalHost} />;
});

interface PreviewState {
  path: string;
  content?: string;
  error?: string;
  truncated?: boolean;
  image?: boolean;
}

/** 文档预览：图片走原始字节，Markdown 走渲染，其余按代码展示 */
const FilePreview = memo(function FilePreview({ target, cwd }: { target: PreviewState | null; cwd?: string }) {
  if (!target) return <div className={styles.dockEmpty}>在「文件」中选择一个文件即可预览</div>;
  if (target.image) {
    return (
      <div className={styles.imageWrap}>
        <img className={styles.image} src={api.agentFsRawUrl(target.path, cwd)} alt={target.path} />
      </div>
    );
  }
  if (target.error) return <div className={styles.dockEmpty}>{target.error}</div>;
  return (
    <div className={styles.preview}>
      {MARKDOWN_EXT.test(target.path) ? (
        <AgentMarkdown content={target.content || ''} />
      ) : (
        <pre className={styles.previewCode}>{target.content || ''}</pre>
      )}
      {target.truncated && <div className={styles.previewNote}>文件较大，仅显示前 512 KB</div>}
    </div>
  );
});

export interface DockTarget {
  path: string;
  /** 重复点同一个文件也要重新加载 */
  seq: number;
}

export interface WorkspaceDockProps {
  cwd?: string;
  activeTab: DockTab;
  onTabChange: (tab: DockTab) => void;
  onClose: () => void;
  /** 会话里点开的文件：切到预览页并加载该路径 */
  target?: DockTarget | null;
}

/** 右侧工作区面板：文件 / 终端 / 文档预览 */
export const WorkspaceDock = memo(function WorkspaceDock({
  cwd,
  activeTab,
  onTabChange,
  onClose,
  target,
}: WorkspaceDockProps) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  /** 终端首次打开后才挂载，之后切页签只隐藏不卸载：shell 与回滚不会丢 */
  const [terminalMounted, setTerminalMounted] = useState(activeTab === 'terminal');
  const root = cwd || '';

  useEffect(() => {
    if (activeTab === 'terminal') setTerminalMounted(true);
  }, [activeTab]);

  // 路径可能来自消息里的相对引用，统一交给后端按工作区解析
  const loadPath = useCallback(
    async (path: string) => {
      if (IMAGE_EXT.test(path)) {
        setPreview({ path, image: true });
        return;
      }
      setPreview({ path });
      try {
        const file = await api.readAgentFsFile(path, root);
        setPreview({ path: file.path, content: file.content, truncated: file.truncated });
      } catch (err: any) {
        setPreview({ path, error: err?.message || '无法读取文件' });
      }
    },
    [root]
  );

  useEffect(() => {
    if (target) void loadPath(target.path);
  }, [target, loadPath]);

  const openFile = useCallback(
    (entry: FsEntry) => {
      onTabChange('preview');
      void loadPath(entry.path);
    },
    [onTabChange, loadPath]
  );

  const tabs = useMemo(
    () => [
      { key: 'files' as DockTab, label: '文件' },
      { key: 'terminal' as DockTab, label: '终端' },
      { key: 'preview' as DockTab, label: '预览' },
    ],
    []
  );

  return (
    <aside className={styles.dock}>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <button type="button" className={styles.close} onClick={onClose} title="收起面板">
          <IconClose size={14} />
        </button>
      </div>

      <div className={styles.dockBody}>
        {activeTab === 'files' && <FileTree root={root} activePath={preview?.path} onPick={openFile} />}
        {terminalMounted && (
          <div className={`${styles.pane} ${activeTab === 'terminal' ? '' : styles.paneHidden}`}>
            <TerminalView cwd={root} />
          </div>
        )}
        {activeTab === 'preview' && <FilePreview target={preview} cwd={root} />}
      </div>
    </aside>
  );
});
