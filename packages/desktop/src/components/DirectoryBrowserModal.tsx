import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, CornerLeftUp, EyeOff, Folder, FolderPlus, Loader2, Pencil, X } from 'lucide-react';
import { api } from '../services/api';
import { formatCompactPath, pathSegments } from './workspace-path';

interface BrowserEntry {
  name: string;
  path: string;
}

interface BrowserListing {
  path: string;
  parent: string | null;
  entries: BrowserEntry[];
}

export interface DirectoryBrowserModalProps {
  /** 首开目录：留空则从主目录开始 */
  defaultPath?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}

/**
 * 应用内工作区目录面板（对齐 DSH 的 browse 交互）：没有系统原生选择框时接管
 * 目录选择。头部是当前路径的面包屑，点铅笔切成可编辑路径；中间只列子目录，
 * 单击进入、`..` 上一级；底部可新建文件夹、显示隐藏项目。
 */
export const DirectoryBrowserModal: React.FC<DirectoryBrowserModalProps> = ({
  defaultPath,
  onPick,
  onClose,
}) => {
  const [listing, setListing] = useState<BrowserListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  /** 路径编辑态：null 表示面包屑态 */
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  /** 新建文件夹的输入草稿 */
  const [folderDraft, setFolderDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pathInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const load = useCallback(async (target: string) => {
    const request = ++seq.current;
    setLoading(true);
    try {
      const next = await api.listAgentFs(target);
      if (seq.current !== request) return;
      setListing({ path: next.path, parent: next.parent, entries: next.entries.filter((entry) => entry.isDir) });
      setError(null);
    } catch (err: any) {
      if (seq.current !== request) return;
      setError(err?.message || '无法读取该目录');
    } finally {
      if (seq.current === request) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (import.meta.env?.DEV) {
      console.log('[DirectoryBrowser] 打开应用内目录面板:', { defaultPath });
    }
    void load(defaultPath || '');
  }, [defaultPath, load]);

  useEffect(() => {
    if (pathDraft !== null) pathInputRef.current?.focus();
  }, [pathDraft]);

  useEffect(() => {
    if (folderDraft !== null) folderInputRef.current?.focus();
  }, [folderDraft]);

  const navigate = useCallback(
    (target: string) => {
      if (import.meta.env?.DEV) console.log('[DirectoryBrowser] 切换目录:', target);
      setPathDraft(null);
      setFolderDraft(null);
      void load(target);
    },
    [load]
  );

  const submitPath = useCallback(() => {
    if (pathDraft === null) return;
    const target = pathDraft.trim();
    if (!target) {
      setPathDraft(null);
      return;
    }
    navigate(target);
  }, [pathDraft, navigate]);

  const createFolder = useCallback(async () => {
    const name = (folderDraft || '').trim();
    if (!name || !listing || busy) return;
    setBusy(true);
    try {
      const created = await api.createAgentFsDir(listing.path, name);
      if (import.meta.env?.DEV) console.log('[DirectoryBrowser] 新建文件夹成功:', created.path);
      setFolderDraft(null);
      await load(created.path);
    } catch (err: any) {
      if (import.meta.env?.DEV) console.warn('[DirectoryBrowser] 新建文件夹失败:', err);
      setError(err?.message || '无法新建文件夹');
    } finally {
      setBusy(false);
    }
  }, [folderDraft, listing, busy, load]);

  // Esc 逐层退出：先收新建框，再收路径编辑，最后关面板
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (folderDraft !== null) {
        setFolderDraft(null);
        return;
      }
      if (pathDraft !== null) {
        setPathDraft(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [folderDraft, pathDraft, onClose]);

  const currentPath = listing?.path || '';
  const rows = (listing?.entries || []).filter((entry) => showHidden || !entry.name.startsWith('.'));

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[rgba(20,22,30,0.24)] backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="选择工作区目录"
        className="w-full max-w-[620px] h-[460px] bg-white rounded-[12px] border border-[#e3e3e8] shadow-[0_24px_60px_rgba(20,22,30,0.18)] flex flex-col overflow-hidden"
      >
        {/* 头部：标题与关闭 */}
        <div className="h-[42px] px-3.5 flex items-center justify-between border-b border-[#ececf0] shrink-0">
          <span className="text-[12.5px] font-semibold text-[#1c1c21] tracking-tight">选择工作区目录</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭 (Esc)"
            className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* 路径区：面包屑，点铅笔切成可直接编辑的路径 */}
        <div className="h-[34px] px-2 flex items-center gap-1 border-b border-[#f1f1f4] shrink-0">
          {pathDraft === null ? (
            <>
              <div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto">
                {pathSegments(currentPath).map((segment, index, all) => (
                  <React.Fragment key={segment.path}>
                    {index > 0 && <ChevronRight size={11} className="shrink-0 text-[#c2c2c9]" />}
                    <button
                      type="button"
                      onClick={() => navigate(segment.path)}
                      title={segment.path}
                      className={`shrink-0 h-[22px] px-1.5 rounded-[4px] text-[11.5px] max-w-[170px] truncate transition-colors hover:bg-[#f4f4f7] ${
                        index === all.length - 1 ? 'font-medium text-[#1c1c21]' : 'text-[#63636b]'
                      }`}
                    >
                      {segment.name}
                    </button>
                  </React.Fragment>
                ))}
                {!currentPath && <span className="text-[11.5px] text-[#85858d]">主目录</span>}
              </div>
              <button
                type="button"
                onClick={() => setPathDraft(currentPath ? `${formatCompactPath(currentPath)}/` : '')}
                aria-label="编辑路径"
                title="直接输入路径"
                className="shrink-0 w-5 h-5 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
              >
                <Pencil size={12} />
              </button>
            </>
          ) : (
            <input
              ref={pathInputRef}
              value={pathDraft}
              onChange={(event) => setPathDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitPath();
                }
              }}
              onBlur={() => setPathDraft(null)}
              spellCheck={false}
              className="w-full h-[24px] px-2 bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[5px] text-[11.5px] font-mono text-[#1c1c21] outline-none"
            />
          )}
        </div>

        {/* 目录列表：只列子目录，单击进入 */}
        <div className="flex-1 overflow-y-auto px-1.5 py-1">
          {folderDraft !== null && (
            <div className="flex items-center gap-2 h-[28px] px-1.5">
              <FolderPlus size={13} className="shrink-0 text-[#4f46e5]" />
              <input
                ref={folderInputRef}
                value={folderDraft}
                onChange={(event) => setFolderDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void createFolder();
                  }
                }}
                onBlur={() => setFolderDraft(null)}
                placeholder="新文件夹名称"
                spellCheck={false}
                className="flex-1 h-[24px] px-2 bg-white border border-[#4f46e5] rounded-[5px] text-[12px] text-[#1c1c21] outline-none"
              />
              {busy && <Loader2 size={12} className="animate-spin text-[#85858d]" />}
            </div>
          )}

          {listing?.parent && (
            <button
              type="button"
              onClick={() => navigate(listing.parent!)}
              title={listing.parent}
              className="w-full h-[28px] px-1.5 rounded-[5px] flex items-center gap-2 text-[12px] text-[#63636b] hover:bg-[#f4f4f7] transition-colors"
            >
              <CornerLeftUp size={13} className="shrink-0 text-[#85858d]" />
              <span>上一级</span>
            </button>
          )}

          {rows.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => navigate(entry.path)}
              title={entry.path}
              className="w-full h-[28px] px-1.5 rounded-[5px] flex items-center gap-2 text-[12px] text-[#1c1c21] hover:bg-[#f4f4f7] transition-colors"
            >
              <Folder size={13} className="shrink-0 text-[#85858d]" />
              <span className="truncate">{entry.name}</span>
            </button>
          ))}

          {loading && <div className="py-6 text-center text-[11.5px] text-[#85858d]">读取中…</div>}
          {!loading && error && <div className="py-6 text-center text-[11.5px] text-[#d64545]">{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="py-6 text-center text-[11.5px] text-[#85858d]">没有子目录</div>
          )}
        </div>

        {/* 底栏：左侧面板选项，右侧取消与选定 */}
        <div className="h-[44px] px-2.5 border-t border-[#ececf0] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!listing || busy}
              onClick={() => setFolderDraft('')}
              className="h-[24px] px-2 rounded-[5px] flex items-center gap-1.5 text-[11.5px] text-[#63636b] hover:bg-[#f4f4f7] hover:text-[#1c1c21] transition-colors disabled:opacity-50"
            >
              <FolderPlus size={12} />
              <span>新建文件夹</span>
            </button>
            <button
              type="button"
              aria-pressed={showHidden}
              onClick={() => setShowHidden((prev) => !prev)}
              className="h-[24px] px-2 rounded-[5px] flex items-center gap-1.5 text-[11.5px] text-[#63636b] hover:bg-[#f4f4f7] hover:text-[#1c1c21] transition-colors"
            >
              {showHidden ? <Check size={12} className="text-[#4f46e5]" /> : <EyeOff size={12} />}
              <span>显示隐藏项目</span>
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="h-[26px] px-3 rounded-[6px] text-[11.5px] text-[#4b4b53] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!listing || loading}
              onClick={() => listing && onPick(listing.path)}
              className="h-[26px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium transition-colors disabled:opacity-50"
            >
              选择此文件夹
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
