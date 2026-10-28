import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FileCode2,
  RefreshCw,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Search,
  Copy,
  Check,
  Plus,
  Minus,
  FileCheck2,
  X,
  ExternalLink,
} from 'lucide-react';
import { TaskWorktreeDiffResult, FileDiffItem } from '@openloop/core';
import { api } from '../services/api';
import { toast } from './Toast';
import { CodeDiffViewerModal } from './diff/CodeDiffViewerModal';
import { useAnchoredPosition } from '../agent-ui/dsh/useAnchoredPosition';

export interface AgentChatChangedFilesProps {
  taskId: string;
  taskTitle?: string;
  isBusy?: boolean;
  /** 会话消息数量或更新标记，用于防抖触发静默比对更新 */
  sessionMessagesCount?: number;
  className?: string;
}

// 模块级轻量 LRU/SWR 缓存，避免频繁跨组件切换时出现空闪
const diffResultCache = new Map<string, { data: TaskWorktreeDiffResult; timestamp: number }>();
const CACHE_TTL_MS = 2500;

function splitPath(filePath: string): { dir: string; name: string } {
  const parts = filePath.split('/');
  if (parts.length === 1) {
    return { dir: '', name: parts[0] };
  }
  const name = parts.pop() || '';
  return { dir: parts.join('/') + '/', name };
}

export const AgentChatChangedFiles: React.FC<AgentChatChangedFilesProps> = ({
  taskId,
  taskTitle,
  isBusy = false,
  sessionMessagesCount = 0,
  className = '',
}) => {
  const [diffResult, setDiffResult] = useState<TaskWorktreeDiffResult | null>(() => {
    const cached = diffResultCache.get(taskId);
    return cached ? cached.data : null;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeModalFile, setActiveModalFile] = useState<string | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const prevIsBusyRef = useRef(isBusy);
  const fetchDebounceTimerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 面板挂到 body 上做 fixed 定位：任务详情右栏是 overflow-hidden，内联浮层会被裁掉左半边
  const panelPos = useAnchoredPosition({
    open: isPanelOpen,
    anchorRef: containerRef,
    panelRef,
    side: 'bottom',
    align: 'end',
    gap: 6,
    margin: 8,
  });

  // 获取最新代码变更 Diff
  const fetchDiff = useCallback(
    async (silent = false) => {
      if (!taskId) return;
      if (!silent) setIsLoading(true);

      if (import.meta.env?.DEV) {
        console.log('[AgentChatChangedFiles] 开始拉取代码变更统计与 Diff:', { taskId, silent });
      }

      try {
        const res = await api.getTaskWorktreeDiff(taskId);
        if (import.meta.env?.DEV) {
          console.log('[AgentChatChangedFiles] 成功获取变更结果:', {
            taskId,
            filesCount: res?.summary?.filesChanged || 0,
            insertions: res?.summary?.insertions || 0,
            deletions: res?.summary?.deletions || 0,
          });
        }
        setDiffResult(res);
        diffResultCache.set(taskId, { data: res, timestamp: Date.now() });
      } catch (err: any) {
        if (import.meta.env?.DEV) {
          console.warn('[AgentChatChangedFiles] 拉取变更详情失败:', err);
        }
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [taskId]
  );

  // 首次挂载或 taskId 变更时加载（带 SWR 策略）
  useEffect(() => {
    if (!taskId) return;
    const cached = diffResultCache.get(taskId);
    if (cached) {
      setDiffResult(cached.data);
      if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
        fetchDiff(true);
      }
    } else {
      fetchDiff(false);
    }
  }, [taskId, fetchDiff]);

  // 监听智能体繁忙状态结束（isBusy: true -> false）时立即刷新，此时通常产出了修改
  useEffect(() => {
    if (prevIsBusyRef.current && !isBusy) {
      if (import.meta.env?.DEV) {
        console.log('[AgentChatChangedFiles] 检测到智能体执行完毕，静默触发变更刷新:', { taskId });
      }
      fetchDiff(true);
    }
    prevIsBusyRef.current = isBusy;
  }, [isBusy, taskId, fetchDiff]);

  // 消息条数变化时，使用防抖刷新（避免打字流频繁触发 git 进程）
  useEffect(() => {
    if (fetchDebounceTimerRef.current) {
      clearTimeout(fetchDebounceTimerRef.current);
    }
    fetchDebounceTimerRef.current = setTimeout(() => {
      if (taskId) {
        fetchDiff(true);
      }
    }, 1200);

    return () => {
      if (fetchDebounceTimerRef.current) {
        clearTimeout(fetchDebounceTimerRef.current);
      }
    };
  }, [sessionMessagesCount, taskId, fetchDiff]);

  // 监听点击外部或 ESC 自动收起面板
  useEffect(() => {
    if (!isPanelOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = containerRef.current?.contains(target) ?? false;
      const insidePanel = panelRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insidePanel) {
        if (import.meta.env?.DEV) {
          console.log('[AgentChatChangedFiles] 点击外部区域，收起改动文件面板');
        }
        setIsPanelOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (import.meta.env?.DEV) {
          console.log('[AgentChatChangedFiles] 按 ESC 收起改动文件面板');
        }
        setIsPanelOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPanelOpen]);

  // 提取统计与文件列表
  const files = useMemo(() => diffResult?.files || [], [diffResult]);
  const filesCount = diffResult?.summary?.filesChanged ?? files.length;
  const insertions = diffResult?.summary?.insertions ?? 0;
  const deletions = diffResult?.summary?.deletions ?? 0;

  // 过滤后的文件列表
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase().trim();
    return files.filter(
      (f) => f.file.toLowerCase().includes(q) || (f.oldPath && f.oldPath.toLowerCase().includes(q))
    );
  }, [files, searchQuery]);

  // 复制文件相对路径
  const handleCopyPath = (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(filePath);
    setCopiedFile(filePath);
    toast.success('已复制文件相对路径');
    if (import.meta.env?.DEV) {
      console.log('[AgentChatChangedFiles] 复制文件路径:', filePath);
    }
    setTimeout(() => {
      setCopiedFile((curr) => (curr === filePath ? null : curr));
    }, 1500);
  };

  // 打开全功能 Diff 查看模态框
  const handleOpenDiffModal = (e?: React.MouseEvent, targetFile?: string) => {
    if (e) e.stopPropagation();
    if (import.meta.env?.DEV) {
      console.log('[AgentChatChangedFiles] 打开完整 Diff 对比弹窗:', { taskId, targetFile });
    }
    setActiveModalFile(targetFile);
    setIsModalOpen(true);
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* 顶部控制胶囊触发按钮 */}
      <button
        type="button"
        onClick={() => {
          const nextState = !isPanelOpen;
          setIsPanelOpen(nextState);
          if (import.meta.env?.DEV) {
            console.log('[AgentChatChangedFiles] 切换改动文件面板展开状态:', nextState);
          }
          if (nextState) {
            fetchDiff(true);
          }
        }}
        className={`h-[22px] px-2 rounded-[4px] border text-[10.5px] font-medium flex items-center gap-1.5 transition-all cursor-pointer select-none active:scale-[0.98] ${
          isPanelOpen
            ? 'bg-[#eeedfd] border-[#c7d2fe] text-[#4f46e5] shadow-2xs font-semibold'
            : filesCount > 0
              ? 'bg-white border-[#d8d6fb] text-[#4f46e5] hover:bg-[#f5f5ff] hover:border-[#b8b5fa] shadow-2xs'
              : 'bg-white border-[#e3e3e8] hover:border-[#d4d4d8] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#f1f1f4]'
        }`}
        title={
          filesCount > 0
            ? `工作区共 ${filesCount} 个文件改动 (+${insertions} / -${deletions}) · 点击${isPanelOpen ? '收起' : '展开'}查看清单`
            : '当前暂无代码改动 · 点击查看详情'
        }
      >
        <FileCode2 size={11} className={filesCount > 0 ? 'text-[#4f46e5]' : 'text-[#85858d]'} />
        <span>改动文件</span>
        {filesCount > 0 ? (
          <span className="font-mono text-[9.5px] px-1 py-[0.5px] rounded bg-[#eeedfd] text-[#4f46e5] font-semibold border border-[#d8d6fb]/60">
            {filesCount}
          </span>
        ) : (
          <span className="font-mono text-[9.5px] text-[#a1a1aa]">0</span>
        )}
        {isPanelOpen ? (
          <ChevronUp size={10} className="text-[#71717a] ml-0.5" />
        ) : (
          <ChevronDown size={10} className="text-[#71717a] ml-0.5" />
        )}
      </button>

      {/* 悬浮弹出式改动文件卡片面板 */}
      {isPanelOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={panelPos ?? { visibility: 'hidden', left: 0, top: 0 }}
            className="fixed z-50 w-[440px] max-w-[calc(100vw-16px)] rounded-[8px] border border-[#e3e3e8] bg-white shadow-[0_12px_36px_rgba(0,0,0,0.14)] overflow-hidden flex flex-col"
          >
            {/* 表头区 (严格遵循设计系统规范：34px 浅灰微边框表头) */}
            <div className="h-[34px] bg-[#fafafc] border-b border-[#e3e3e8] px-3 flex items-center justify-between text-[11px] font-medium text-[#85858d] select-none">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-[#1c1c21]">代码改动文件</span>
                <span className="text-[10px] font-mono px-1.5 py-[0.5px] rounded bg-[#f4f4f6] text-[#52525b] border border-[#e3e3e8]">
                  {filesCount} 个文件
                </span>
                {(insertions > 0 || deletions > 0) && (
                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                    {insertions > 0 && (
                      <span className="text-[#059669] flex items-center">
                        <Plus size={9} strokeWidth={2.4} />
                        {insertions}
                      </span>
                    )}
                    {deletions > 0 && (
                      <span className="text-[#dc2626] flex items-center">
                        <Minus size={9} strokeWidth={2.4} />
                        {deletions}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* 手动刷新 */}
                <button
                  type="button"
                  onClick={() => fetchDiff(false)}
                  disabled={isLoading}
                  className="w-5 h-5 rounded-[4px] hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] flex items-center justify-center transition-colors cursor-pointer"
                  title="重新扫描工作区 Git 代码差异"
                >
                  <RefreshCw size={11} className={isLoading ? 'animate-spin text-[#4f46e5]' : ''} />
                </button>

                {/* 呼出全屏/大窗 Diff 对比 */}
                {filesCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => handleOpenDiffModal(e)}
                    className="h-[22px] px-1.5 rounded-[4px] bg-white hover:bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb] text-[10.5px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                    title="在新窗口查看全部改动的逐行统一 Diff"
                  >
                    <Maximize2 size={10} />
                    <span>完整 Diff</span>
                  </button>
                )}

                {/* 收起面板 */}
                <button
                  type="button"
                  onClick={() => setIsPanelOpen(false)}
                  className="w-5 h-5 rounded-[4px] hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] flex items-center justify-center transition-colors cursor-pointer ml-0.5"
                  title="收起改动文件面板"
                >
                  <X size={11} />
                </button>
              </div>
            </div>

            {/* 当文件数较多时提供紧凑搜索过滤条 */}
            {files.length >= 3 && (
              <div className="px-2.5 py-1.5 bg-[#fcfcfd] border-b border-[#f1f1f4] flex items-center gap-1.5">
                <Search size={11} className="text-[#a1a1aa] shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="按文件名快速过滤..."
                  className="w-full text-[11px] bg-transparent outline-none placeholder:text-[#a1a1aa] text-[#1c1c21]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="w-4 h-4 rounded hover:bg-[#ececf0] text-[#85858d] flex items-center justify-center cursor-pointer"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            )}

            {/* 紧凑文件列表 (遵循设计系统单行高密度规范：38px~42px 行高，px-3 py-2) */}
            <div className="max-h-[260px] overflow-y-auto divide-y divide-[#f1f1f4] select-none">
              {files.length === 0 ? (
                <div className="py-7 px-4 flex flex-col items-center justify-center text-center text-[#85858d]">
                  <FileCheck2 size={22} className="text-[#a1a1aa] mb-1.5 opacity-80" />
                  <div className="text-[11.5px] font-medium text-[#1c1c21] mb-0.5">当前工作区暂无代码变更</div>
                  <div className="text-[10px] text-[#a1a1aa] max-w-[260px] leading-relaxed">
                    智能体执行写文件 (write) 或编辑 (edit) 后，变更列表将在此自动呈现。
                  </div>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="py-5 text-center text-[11px] text-[#85858d]">
                  未匹配到包含 “{searchQuery}” 的文件
                </div>
              ) : (
                filteredFiles.map((fileItem) => {
                  const { dir, name } = splitPath(fileItem.file);
                  const isCopied = copiedFile === fileItem.file;

                  return (
                    <div
                      key={fileItem.file}
                      onClick={() => handleOpenDiffModal(undefined, fileItem.file)}
                      className="group flex items-center justify-between px-3 py-2 hover:bg-[#fafafc] transition-colors cursor-pointer"
                      title={`点击查看代码 Diff: ${fileItem.file}`}
                    >
                      {/* 左侧：文件状态微徽章 + 文件路径 */}
                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                        {/* 状态微徽章 (Subtle Status Badges) */}
                        {fileItem.status === 'added' ? (
                          <span className="w-4 h-4 rounded-[3px] bg-[#ecfdf5] text-[#059669] text-[9.5px] font-mono font-bold flex items-center justify-center border border-[#a7f3d0]/60 shrink-0" title="新增文件">
                            A
                          </span>
                        ) : fileItem.status === 'deleted' ? (
                          <span className="w-4 h-4 rounded-[3px] bg-[#fef2f2] text-[#dc2626] text-[9.5px] font-mono font-bold flex items-center justify-center border border-[#fecaca]/60 shrink-0" title="删除文件">
                            D
                          </span>
                        ) : fileItem.status === 'renamed' ? (
                          <span className="w-4 h-4 rounded-[3px] bg-[#f5f3ff] text-[#7c3aed] text-[9.5px] font-mono font-bold flex items-center justify-center border border-[#ddd6fe]/60 shrink-0" title="重命名文件">
                            R
                          </span>
                        ) : (
                          <span className="w-4 h-4 rounded-[3px] bg-[#eff6ff] text-[#2563eb] text-[9.5px] font-mono font-bold flex items-center justify-center border border-[#bfdbfe]/60 shrink-0" title="修改文件">
                            M
                          </span>
                        )}

                        {/* 文件名高亮与路径降权 */}
                        <div className="min-w-0 flex items-center truncate">
                          <span className="text-[12px] font-medium text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors shrink-0">
                            {name}
                          </span>
                          {dir && (
                            <span className="text-[10.5px] text-[#85858d] font-mono ml-1.5 truncate">
                              {dir}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 右侧：增删量统计 + 快捷复制 + 查看按钮 */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* 行级加减量 */}
                        <div className="flex items-center gap-1 font-mono text-[10.5px] select-none">
                          {fileItem.additions > 0 && (
                            <span className="text-[#059669]">+{fileItem.additions}</span>
                          )}
                          {fileItem.deletions > 0 && (
                            <span className="text-[#dc2626]">-{fileItem.deletions}</span>
                          )}
                          {fileItem.additions === 0 && fileItem.deletions === 0 && (
                            <span className="text-[#a1a1aa]">-</span>
                          )}
                        </div>

                        {/* 复制相对路径按钮 */}
                        <button
                          type="button"
                          onClick={(e) => handleCopyPath(e, fileItem.file)}
                          className={`w-5 h-5 rounded-[4px] flex items-center justify-center transition-all cursor-pointer ${
                            isCopied
                              ? 'bg-[#ecfdf5] text-[#059669] opacity-100'
                              : 'opacity-0 group-hover:opacity-100 hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21]'
                          }`}
                          title="复制文件相对路径"
                        >
                          {isCopied ? <Check size={10} /> : <Copy size={10} />}
                        </button>

                        {/* 查看 Diff 微图标 */}
                        <div className="text-[#a1a1aa] group-hover:text-[#4f46e5] transition-colors">
                          <ExternalLink size={11} />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>,
        document.body
        )}

      {/* 呼出全屏代码变更对比审查模态框 (复用系统核心 CodeDiffViewerModal) */}
      {isModalOpen && (
        <CodeDiffViewerModal
          diffResult={diffResult}
          taskTitle={taskTitle ? `${taskTitle} (代码变更)` : `任务 [${taskId}] 代码变更`}
          initialFile={activeModalFile}
          isLoading={isLoading}
          onRetry={() => fetchDiff(false)}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
};
