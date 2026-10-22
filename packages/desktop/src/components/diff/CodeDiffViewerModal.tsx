import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  FileCode2,
  GitBranch,
  Copy,
  Check,
  Search,
  Plus,
  Minus,
  Maximize2,
  Layers,
  FileText,
  CornerDownRight,
  GitCommitHorizontal,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { TaskWorktreeDiffResult, FileDiffItem } from '@openloop/core';

interface CodeDiffViewerModalProps {
  diffResult?: TaskWorktreeDiffResult | null;
  taskTitle?: string;
  initialFile?: string;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onClose: () => void;
}

interface ParsedDiffLine {
  type: 'chunk-header' | 'add' | 'delete' | 'context' | 'meta';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

function parseFileDiff(diffText: string): ParsedDiffLine[] {
  if (!diffText) return [];
  const rawLines = diffText.split('\n');
  const result: ParsedDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({
        type: 'chunk-header',
        content: line,
      });
    } else if (
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to')
    ) {
      // 元数据行，略过展示以保持视觉极简专注
      continue;
    } else if (line.startsWith('+')) {
      result.push({
        type: 'add',
        newLineNumber: newLine,
        content: line.slice(1),
      });
      newLine++;
    } else if (line.startsWith('-')) {
      result.push({
        type: 'delete',
        oldLineNumber: oldLine,
        content: line.slice(1),
      });
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      result.push({
        type: 'context',
        oldLineNumber: oldLine,
        newLineNumber: newLine,
        content: line.startsWith(' ') ? line.slice(1) : line,
      });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

function splitPath(filePath: string): { dir: string; name: string } {
  const parts = filePath.split('/');
  if (parts.length === 1) {
    return { dir: '', name: parts[0] };
  }
  const name = parts.pop() || '';
  return { dir: parts.join('/') + '/', name };
}

export const CodeDiffViewerModal: React.FC<CodeDiffViewerModalProps> = ({
  diffResult,
  taskTitle,
  initialFile,
  isLoading,
  error,
  onRetry,
  onClose,
}) => {
  const files = useMemo(() => diffResult?.files || [], [diffResult]);
  const [selectedFile, setSelectedFile] = useState<string>(() => {
    if (initialFile && files.some((f) => f.file === initialFile)) {
      return initialFile;
    }
    return files.length > 0 ? files[0].file : 'all';
  });
  const [filterQuery, setFilterQuery] = useState('');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  // 监听 ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        if (import.meta.env?.DEV) console.log('[DiffReviewModal] 按 ESC 关闭弹窗');
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // 过滤后的文件列表
  const filteredFiles = useMemo(() => {
    if (!filterQuery.trim()) return files;
    const q = filterQuery.toLowerCase();
    return files.filter((f) => f.file.toLowerCase().includes(q));
  }, [files, filterQuery]);

  // 待显示的文件列表
  const displayFiles = useMemo(() => {
    if (selectedFile === 'all') {
      return filteredFiles;
    }
    const target = files.find((f) => f.file === selectedFile);
    return target ? [target] : filteredFiles;
  }, [selectedFile, filteredFiles, files]);

  const handleCopyPath = (filePath: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(filePath);
    setCopiedFile(filePath);
    if (import.meta.env?.DEV) console.log(`[DiffReviewModal] 已复制文件路径: ${filePath}`);
    setTimeout(() => {
      setCopiedFile((prev) => (prev === filePath ? null : prev));
    }, 1500);
  };

  const totalAdditions = diffResult?.summary?.insertions ?? files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = diffResult?.summary?.deletions ?? files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div
      className="fixed inset-0 z-[70] bg-[#1c1c21]/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-150 select-text"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl h-[88vh] bg-white border border-[#e3e3e8] rounded-[10px] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 Header: 严谨规范对齐 */}
        <div className="h-[46px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded-[5px] bg-white border border-[#e3e3e8] flex items-center justify-center text-[#4f46e5] shadow-3xs shrink-0">
              <FileCode2 size={13} strokeWidth={2.2} />
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-[13px] font-semibold text-[#1c1c21] shrink-0">代码变更审查</h2>
              {taskTitle && (
                <span className="text-[11.5px] text-[#71717a] truncate max-w-[280px]" title={taskTitle}>
                  · {taskTitle}
                </span>
              )}
              {diffResult?.branchName && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#52525b] text-[10px] font-mono border border-[#e3e3e8]">
                  <GitBranch size={10} className="text-[#71717a]" />
                  <span>{diffResult.branchName}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 总体统计徽章 */}
            <div className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className="text-[#71717a] text-[10.5px] font-sans font-medium">
                {files.length} 个文件变动
              </span>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10.5px] font-medium border border-[#a7f3d0]/60">
                <Plus size={10} strokeWidth={2.4} />
                <span>{totalAdditions}</span>
              </span>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10.5px] font-medium border border-[#fecaca]/60">
                <Minus size={10} strokeWidth={2.4} />
                <span>{totalDeletions}</span>
              </span>
            </div>

            <div className="h-4 w-[1px] bg-[#e3e3e8]" />

            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-[4px] text-[#71717a] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer"
              title="关闭 (Esc)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 主体双栏区域 */}
        <div className="flex-1 flex min-h-0 divide-x divide-[#e3e3e8]">
          {/* 左侧文件导航列表（当有文件时展示） */}
          <div className="w-[280px] bg-[#fafafc] flex flex-col shrink-0 min-h-0 select-none">
            {/* 文件搜索栏 */}
            <div className="p-2.5 border-b border-[#e3e3e8] bg-white shrink-0">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#85858d]" />
                <input
                  type="text"
                  placeholder="过滤文件..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="w-full h-[28px] pl-7 pr-2.5 rounded-[5px] bg-[#f4f4f6] border border-[#e3e3e8] text-[11px] text-[#1c1c21] placeholder-[#85858d] focus:outline-none focus:border-[#4f46e5] focus:bg-white transition-all font-mono"
                />
              </div>
            </div>

            {/* 文件列表项 */}
            <div className="flex-1 overflow-y-auto divide-y divide-[#f1f1f4] p-1.5 space-y-0.5">
              {files.length > 1 && (
                <div
                  onClick={() => {
                    if (import.meta.env?.DEV) console.log('[DiffReviewModal] 切换为查看全部文件');
                    setSelectedFile('all');
                  }}
                  className={`px-2.5 py-1.5 rounded-[5px] flex items-center justify-between text-[11px] cursor-pointer transition-colors ${
                    selectedFile === 'all'
                      ? 'bg-white text-[#4f46e5] font-semibold shadow-3xs border border-[#e3e3e8]'
                      : 'text-[#63636b] hover:bg-white hover:text-[#1c1c21]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Layers size={11} className={selectedFile === 'all' ? 'text-[#4f46e5]' : 'text-[#85858d]'} />
                    <span>全部变更文件</span>
                  </div>
                  <span className="font-mono text-[10px] px-1 py-0.2 rounded bg-[#f4f4f6] text-[#71717a]">
                    {files.length}
                  </span>
                </div>
              )}

              {filteredFiles.map((f) => {
                const isSelected = selectedFile === f.file;
                const { dir, name } = splitPath(f.file);
                return (
                  <div
                    key={f.file}
                    onClick={() => {
                      if (import.meta.env?.DEV) console.log(`[DiffReviewModal] 切换查看文件: ${f.file}`);
                      setSelectedFile(f.file);
                    }}
                    className={`group px-2.5 py-1.5 rounded-[5px] flex items-center justify-between text-[11px] cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-white text-[#1c1c21] font-medium shadow-3xs border border-[#e3e3e8]'
                        : 'text-[#63636b] hover:bg-white hover:text-[#1c1c21]'
                    }`}
                    title={f.file}
                  >
                    <div className="flex items-center gap-1.5 truncate min-w-0 pr-1">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          f.status === 'added'
                            ? 'bg-[#10b981]'
                            : f.status === 'deleted'
                            ? 'bg-[#ef4444]'
                            : 'bg-[#4f46e5]'
                        }`}
                      />
                      <div className="truncate flex items-baseline gap-1">
                        <span className="font-medium text-[#1c1c21] truncate">{name}</span>
                        {dir && <span className="font-mono text-[9.5px] text-[#85858d] truncate">{dir}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 font-mono text-[9.5px]">
                      {f.additions > 0 && <span className="text-[#059669]">+{f.additions}</span>}
                      {f.deletions > 0 && <span className="text-[#dc2626]">-{f.deletions}</span>}
                    </div>
                  </div>
                );
              })}

              {filteredFiles.length === 0 && (
                <div className="text-center py-6 text-[11px] text-[#85858d]">无匹配文件</div>
              )}
            </div>
          </div>

          {/* 右侧 Diff 代码主阅读区 */}
          <div className="flex-1 bg-[#f4f4f6] overflow-y-auto p-4 space-y-4">
            {isLoading ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <Loader2 size={24} className="animate-spin text-[#4f46e5] mb-2.5" />
                <p className="text-[12.5px] font-medium text-[#1c1c21]">正在解析代码变更 Diff...</p>
                <p className="text-[11px] text-[#85858d] mt-1 font-mono">
                  提取 Worktree Git Unified Diff 与增删行数
                </p>
              </div>
            ) : error ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
                <div className="w-10 h-10 rounded-full bg-[#fef2f2] border border-[#fecaca]/80 flex items-center justify-center text-[#dc2626] mb-3 shadow-3xs">
                  <AlertCircle size={20} />
                </div>
                <p className="text-[13px] font-semibold text-[#1c1c21]">无法获取代码 Diff 详情</p>
                <p className="text-[11.5px] text-[#71717a] mt-1.5 leading-relaxed">
                  当前后台调度服务未能提供 Diff 接口数据（HTTP 404 或网络未响应）。
                  若本地 Core 服务是在代码更新前启动的，请重启 Core 服务后点击下方重试。
                </p>
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="mt-4 flex items-center gap-1.5 h-[28px] px-3.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium transition-all active:scale-95 cursor-pointer shadow-3xs"
                  >
                    <RefreshCw size={11} />
                    <span>重新拉取 Diff</span>
                  </button>
                )}
              </div>
            ) : displayFiles.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-10 h-10 rounded-full bg-white border border-[#e3e3e8] flex items-center justify-center text-[#85858d] mb-2 shadow-sm">
                  <FileCode2 size={18} />
                </div>
                <p className="text-[13px] font-medium text-[#1c1c21]">暂无代码改动</p>
                <p className="text-[11.5px] text-[#85858d] mt-1">
                  当前工作区与基线分支保持一致，未检测到任何代码变更。
                </p>
              </div>
            ) : (
              displayFiles.map((fileItem) => {
                const parsedLines = parseFileDiff(fileItem.diff);
                const { dir, name } = splitPath(fileItem.file);

                return (
                  <div
                    key={fileItem.file}
                    className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-3xs overflow-hidden flex flex-col"
                  >
                    {/* 文件头部 Bar */}
                    <div className="h-[36px] bg-[#fafafc] border-b border-[#e3e3e8] px-3.5 flex items-center justify-between shrink-0 select-none">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode2 size={13} className="text-[#63636b] shrink-0" />
                        <div className="flex items-baseline gap-1 truncate font-mono text-[11.5px]">
                          {dir && <span className="text-[#85858d] truncate">{dir}</span>}
                          <span className="font-semibold text-[#1c1c21]">{name}</span>
                        </div>

                        {/* 状态微徽章 */}
                        <span
                          className={`inline-flex items-center px-1.5 py-0.2 rounded-[3px] text-[9.5px] font-mono font-medium uppercase border ${
                            fileItem.status === 'added'
                              ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/60'
                              : fileItem.status === 'deleted'
                              ? 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]/60'
                              : fileItem.status === 'renamed'
                              ? 'bg-[#faf5ff] text-[#9333ea] border-[#e9d5ff]/60'
                              : 'bg-[#eff6ff] text-[#2563eb] border-[#bfdbfe]/60'
                          }`}
                        >
                          {fileItem.status}
                        </span>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1 font-mono text-[10.5px]">
                          <span className="text-[#059669] font-medium">+{fileItem.additions}</span>
                          <span className="text-[#85858d]">/</span>
                          <span className="text-[#dc2626] font-medium">-{fileItem.deletions}</span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => handleCopyPath(fileItem.file, e)}
                          className="w-6 h-6 rounded-[4px] text-[#71717a] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer"
                          title="复制相对路径"
                        >
                          {copiedFile === fileItem.file ? (
                            <Check size={11} className="text-[#059669]" />
                          ) : (
                            <Copy size={11} />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* 代码内容区域 */}
                    {fileItem.isBinary ? (
                      <div className="py-8 text-center text-[11.5px] text-[#85858d] bg-[#fafafc]">
                        该文件为二进制文件，已检测到修改但暂不支持文本差异渲染。
                      </div>
                    ) : !fileItem.diff ? (
                      <div className="py-8 px-6 text-center text-[11.5px] bg-[#fafafc] flex flex-col items-center justify-center">
                        <div className="flex items-center gap-2 mb-2 font-mono text-[11px]">
                          {fileItem.additions > 0 && <span className="text-[#059669] font-medium">+{fileItem.additions} 行新增</span>}
                          {fileItem.deletions > 0 && <span className="text-[#dc2626] font-medium">-{fileItem.deletions} 行删除</span>}
                        </div>
                        <p className="font-medium text-[#71717a]">未获取到该文件的 Unified Diff 细节文本</p>
                        <p className="text-[10.5px] text-[#a1a1aa] mt-1 max-w-sm">
                          当前后台 Core 服务尚未加载实时 Diff 路由接口（HTTP 404）。请按指引在当前任务目录运行或重启 Core 服务。
                        </p>
                      </div>
                    ) : parsedLines.length === 0 ? (
                      <div className="py-8 text-center text-[11.5px] text-[#85858d] bg-[#fafafc]">
                        空文件或仅文件权限模式发生变更。
                      </div>
                    ) : (
                      <div className="overflow-x-auto text-[11.5px] font-mono leading-[20px]">
                        <table className="w-full border-collapse">
                          <tbody>
                            {parsedLines.map((line, idx) => {
                              if (line.type === 'chunk-header') {
                                return (
                                  <tr
                                    key={idx}
                                    className="bg-[#f4f4f6]/80 text-[#71717a] select-none border-y border-[#e3e3e8]/60"
                                  >
                                    <td
                                      colSpan={4}
                                      className="px-3 py-1 font-mono text-[10.5px] italic text-[#63636b]"
                                    >
                                      {line.content}
                                    </td>
                                  </tr>
                                );
                              }

                              const isAdd = line.type === 'add';
                              const isDel = line.type === 'delete';

                              return (
                                <tr
                                  key={idx}
                                  className={`group transition-colors ${
                                    isAdd
                                      ? 'bg-[#ecfdf5]/70 hover:bg-[#ecfdf5]'
                                      : isDel
                                      ? 'bg-[#fef2f2]/70 hover:bg-[#fef2f2]'
                                      : 'hover:bg-[#fafafc]'
                                  }`}
                                >
                                  {/* 旧行号 */}
                                  <td className="w-11 px-1.5 py-0 text-right select-none text-[10.5px] text-[#a1a1aa] bg-[#fafafc]/50 border-r border-[#f1f1f4]">
                                    {line.oldLineNumber ?? ''}
                                  </td>
                                  {/* 新行号 */}
                                  <td className="w-11 px-1.5 py-0 text-right select-none text-[10.5px] text-[#a1a1aa] bg-[#fafafc]/50 border-r border-[#e3e3e8]">
                                    {line.newLineNumber ?? ''}
                                  </td>
                                  {/* 符号列 */}
                                  <td
                                    className={`w-5 px-1 py-0 text-center select-none font-bold text-[11px] ${
                                      isAdd ? 'text-[#059669]' : isDel ? 'text-[#dc2626]' : 'text-[#a1a1aa]'
                                    }`}
                                  >
                                    {isAdd ? '+' : isDel ? '-' : ' '}
                                  </td>
                                  {/* 代码内容列 */}
                                  <td
                                    className={`px-2 py-0 whitespace-pre overflow-x-visible break-all ${
                                      isAdd ? 'text-[#065f46]' : isDel ? 'text-[#991b1b]' : 'text-[#27272a]'
                                    }`}
                                  >
                                    {line.content || ' '}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
