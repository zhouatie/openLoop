import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus,
  X,
  ZoomIn,
  Loader2,
  Image as ImageIcon,
  AlertCircle,
  UploadCloud,
  FileImage,
} from 'lucide-react';
import { TaskAttachment } from '@openloop/core';
import { api } from '../services/api';
import { clipboardImageFiles } from '../agent-ui/clipboard-images';
import { ImageLightboxModal } from './ImageLightboxModal';

interface PendingUploadItem {
  tempId: string;
  name: string;
  previewUrl: string;
  size: number;
  status: 'uploading' | 'error';
  errorMessage?: string;
  file: File;
}

export interface TaskPromptAreaProps {
  value: string;
  onChange: (value: string) => void;
  attachments: TaskAttachment[];
  onAttachmentsChange: (attachments: TaskAttachment[]) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  maxAttachmentCount?: number;
  id?: string;
}

export const TaskPromptArea = React.forwardRef<HTMLTextAreaElement, TaskPromptAreaProps>(
  (
    {
      value,
      onChange,
      attachments,
      onAttachmentsChange,
      placeholder = '任务背景、特定需求描述或传给 Agent 的 Prompt 覆盖项...',
      rows = 3,
      disabled = false,
      maxAttachmentCount = 8,
      id,
    },
    ref
  ) => {
  const [isDragging, setIsDragging] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUploadItem[]>([]);
  const [activeLightbox, setActiveLightbox] = useState<
    TaskAttachment | { name: string; url: string; size?: number; path?: string } | null
  >(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 清理临时 ObjectURL
  const cleanupPendingItem = useCallback((item: PendingUploadItem) => {
    if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }, []);

  useEffect(() => {
    return () => {
      pendingUploads.forEach((item) => {
        if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 处理文件上传的核心逻辑
  const uploadFiles = async (files: File[]) => {
    if (disabled || !files || files.length === 0) return;

    // 过滤出图片
    const imageFiles = files.filter((f) => {
      const isImg = f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name);
      return isImg;
    });

    if (imageFiles.length === 0) {
      if (import.meta.env?.DEV) {
        console.warn('[TaskPromptArea] 没有检测到有效的图片文件');
      }
      return;
    }

    const currentTotal = attachments.length + pendingUploads.length;
    const availableSlots = Math.max(0, maxAttachmentCount - currentTotal);
    if (availableSlots <= 0) {
      if (import.meta.env?.DEV) {
        console.warn(`[TaskPromptArea] 已达图片附件上限 (${maxAttachmentCount} 张)`);
      }
      return;
    }

    const filesToUpload = imageFiles.slice(0, availableSlots);

    // 1. 本地生成即时 Blob 预览 (0ms 延迟展示缩略图卡片)
    const newPendingItems: PendingUploadItem[] = filesToUpload.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      return {
        tempId: `pending_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: file.name,
        previewUrl,
        size: file.size,
        status: 'uploading',
        file,
      };
    });

    if (import.meta.env?.DEV) {
      console.log(`[TaskPromptArea:Upload] 立即渲染 ${newPendingItems.length} 张本地图片预览:`, {
        files: newPendingItems.map((p) => ({ name: p.name, size: p.size })),
      });
    }

    setPendingUploads((prev) => [...prev, ...newPendingItems]);

    // 2. 异步流式上传到核心调度后端落盘
    for (const pending of newPendingItems) {
      try {
        const uploaded = await api.uploadAttachment(pending.file);
        if (import.meta.env?.DEV) {
          console.log('[TaskPromptArea:Upload] 后端物理落盘完成:', uploaded);
        }

        onAttachmentsChange([...attachments, uploaded]);
        cleanupPendingItem(pending);
        setPendingUploads((prev) => prev.filter((item) => item.tempId !== pending.tempId));
      } catch (err: any) {
        if (import.meta.env?.DEV) {
          console.error('[TaskPromptArea:Upload] 上传出错:', err);
        }
        setPendingUploads((prev) =>
          prev.map((item) =>
            item.tempId === pending.tempId
              ? { ...item, status: 'error', errorMessage: err.message || '上传失败' }
              : item
          )
        );
      }
    }
  };

  // 剪贴板监听 (粘贴截图 ⌘V / Ctrl+V)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = clipboardImageFiles(e.clipboardData);
    if (files.length === 0) return;
    if (import.meta.env?.DEV) {
      console.log('[TaskPromptArea:Paste] 识别到剪贴板包含截图，触发上传:', files);
    }
    uploadFiles(files);
  };

  // 拖拽监听
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging && !disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;

    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      if (import.meta.env?.DEV) {
        console.log('[TaskPromptArea:Drop] 识别到拖拽投递文件:', files);
      }
      uploadFiles(files);
    }
  };

  const handleRemoveAttachment = (id: string) => {
    const target = attachments.find((a) => a.id === id);
    if (import.meta.env?.DEV) {
      console.log('[TaskPromptArea:Remove] 移除图片附件:', target || id);
    }
    onAttachmentsChange(attachments.filter((a) => a.id !== id));
    if (target?.url) {
      api.deleteAttachment(target.url).catch(() => {});
    }
  };

  const handleRemovePending = (tempId: string) => {
    const item = pendingUploads.find((p) => p.tempId === tempId);
    if (item) {
      cleanupPendingItem(item);
    }
    setPendingUploads((prev) => prev.filter((p) => p.tempId !== tempId));
  };

  const handleRetryUpload = async (item: PendingUploadItem) => {
    if (import.meta.env?.DEV) {
      console.log('[TaskPromptArea:Retry] 用户重试上传:', item.name);
    }
    setPendingUploads((prev) =>
      prev.map((p) =>
        p.tempId === item.tempId ? { ...p, status: 'uploading', errorMessage: undefined } : p
      )
    );
    try {
      const uploaded = await api.uploadAttachment(item.file);
      onAttachmentsChange([...attachments, uploaded]);
      cleanupPendingItem(item);
      setPendingUploads((prev) => prev.filter((p) => p.tempId !== item.tempId));
    } catch (err: any) {
      setPendingUploads((prev) =>
        prev.map((p) =>
          p.tempId === item.tempId
            ? { ...p, status: 'error', errorMessage: err.message || '上传失败' }
            : p
        )
      );
    }
  };

  const totalAttachments = attachments.length + pendingUploads.length;

  return (
    <div className="relative">
      {/* 隐藏原生文件上传 Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          if (e.target.files) {
            uploadFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        multiple
        className="hidden"
      />

      {/* 外层优雅卡片容器 */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex flex-col bg-[#f9f9fb] border rounded-[8px] transition-all overflow-hidden ${
          isDragging
            ? 'border-[#4f46e5] ring-2 ring-[#4f46e5]/20 bg-[#f5f4ff]'
            : 'border-[#e3e3e8] focus-within:border-[#4f46e5] focus-within:bg-white focus-within:ring-1 focus-within:ring-[#4f46e5]/20 shadow-[0_1px_2px_rgba(0,0,0,0.02)]'
        }`}
      >
        {/* 拖拽悬浮提示遮罩 */}
        {isDragging && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#fbfbfe]/90 backdrop-blur-[1px] border-2 border-dashed border-[#4f46e5] rounded-[8px] pointer-events-none animate-in fade-in duration-100">
            <UploadCloud size={24} className="text-[#4f46e5] mb-1 animate-bounce" />
            <span className="text-[12px] font-medium text-[#4f46e5]">松开鼠标立即添加图片附件</span>
            <span className="text-[10px] text-[#85858d] mt-0.5">支持 PNG, JPG, WEBP, GIF, SVG</span>
          </div>
        )}

        {/* 文本输入框 */}
        <textarea
          ref={(node) => {
            (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
            if (typeof ref === 'function') {
              ref(node);
            } else if (ref) {
              (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
            }
          }}
          id={id}
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          disabled={disabled}
          className="w-full bg-transparent p-2.5 text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none resize-none leading-relaxed border-none"
        />

        {/* 缩略图画廊栏 (有图片时平滑展开) */}
        {totalAttachments > 0 && (
          <div className="px-2.5 pb-2 pt-0.5 border-t border-[#f0f0f4] flex items-center gap-2 overflow-x-auto scrollbar-thin">
            {/* 已上传成功的图片 */}
            {attachments.map((att) => {
              const displayUrl = api.getAttachmentUrl(att.url);
              return (
                <div
                  key={att.id}
                  className="group relative w-[50px] h-[50px] shrink-0 rounded-[6px] border border-[#e3e3e8] bg-white overflow-hidden shadow-xs hover:border-[#4f46e5] transition-all cursor-pointer select-none"
                  onClick={() => setActiveLightbox(att)}
                  title={`${att.name}\n${formatFileSize(att.size)}\n点击放大查看`}
                >
                  <img
                    src={displayUrl}
                    alt={att.name}
                    className="w-full h-full object-cover"
                  />

                  {/* 悬浮操作图标 */}
                  <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1 transition-opacity duration-150">
                    <div
                      className="p-1 rounded bg-white/20 hover:bg-white/40 text-white transition-colors"
                      title="放大查看"
                    >
                      <ZoomIn size={11} />
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveAttachment(att.id);
                      }}
                      className="p-1 rounded bg-white/20 hover:bg-red-500/80 text-white transition-colors"
                      title="移除图片"
                    >
                      <X size={11} />
                    </button>
                  </div>

                  {/* 底部大小标签 */}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-0.5 py-[0.5px] text-[7.5px] font-mono text-center text-white/90 truncate pointer-events-none group-hover:opacity-0 transition-opacity">
                    {formatFileSize(att.size)}
                  </div>
                </div>
              );
            })}

            {/* 正在上传的文件 */}
            {pendingUploads.map((pending) => (
              <div
                key={pending.tempId}
                className={`group relative w-[50px] h-[50px] shrink-0 rounded-[6px] border overflow-hidden shadow-xs transition-all cursor-pointer ${
                  pending.status === 'error'
                    ? 'border-red-300 bg-red-50/50'
                    : 'border-[#4f46e5]/40 bg-[#f4f4f6]'
                }`}
                title={
                  pending.status === 'error'
                    ? `${pending.name}\n上传失败: ${pending.errorMessage || '网络异常'}\n点击重新上传`
                    : pending.name
                }
                onClick={() => {
                  if (pending.status === 'error') {
                    handleRetryUpload(pending);
                  } else {
                    setActiveLightbox({ name: pending.name, url: pending.previewUrl, size: pending.size });
                  }
                }}
              >
                <img
                  src={pending.previewUrl}
                  alt={pending.name}
                  className={`w-full h-full object-cover ${pending.status === 'uploading' ? 'opacity-60 blur-[0.5px]' : ''}`}
                />

                {pending.status === 'uploading' ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 text-white">
                    <Loader2 size={12} className="animate-spin text-white mb-0.5" />
                    <span className="text-[7.5px] font-mono">上传中</span>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/60 text-white p-1 text-center">
                    <AlertCircle size={11} className="text-red-300 mb-0.5" />
                    <span className="text-[7px] truncate max-w-full text-red-200">
                      {pending.errorMessage || '失败'}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemovePending(pending.tempId);
                  }}
                  className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-black/60 hover:bg-black text-white flex items-center justify-center text-[9px] transition-colors"
                  title="取消"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 底部动作工具条 (比 DeepSeek 更精致、功能更丰富) */}
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#f6f6f9] border-t border-[#ececf0] text-[11px] select-none">
          <div className="flex items-center gap-1.5">
            {/* + 号快捷按钮 (类似 DeepSeek，但更轻盈利落) */}
            <button
              type="button"
              disabled={disabled || totalAttachments >= maxAttachmentCount}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 h-[22px] px-2 rounded-[4px] border border-[#dcdcde] bg-white hover:bg-[#ededf2] hover:border-[#bcbcc6] text-[#4b4b53] hover:text-[#1c1c21] transition-all disabled:opacity-40 active:scale-95 shadow-xs"
              title="上传图片附件 (支持多选)"
            >
              <Plus size={11.5} className="text-[#63636b]" />
              <span className="text-[10px] font-medium">添加图片</span>
            </button>

            {/* 极简辅助提示 */}
            <span className="text-[9.5px] text-[#85858d] hidden sm:inline-block">
              支持直接拖拽或 <kbd className="px-1 py-[0.5px] rounded bg-white border border-[#e3e3e8] text-[9px] text-[#4b4b53] font-mono">⌘V</kbd> 粘贴截图
            </span>
          </div>

          <div className="flex items-center gap-2">
            {totalAttachments > 0 && (
              <span className="text-[9.5px] font-mono text-[#63636b] bg-[#ececf0] px-1.5 py-[0.5px] rounded">
                {totalAttachments}/{maxAttachmentCount} 张图片
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 沉浸式灯箱模态 */}
      <ImageLightboxModal
        isOpen={!!activeLightbox}
        attachment={activeLightbox}
        images={attachments}
        onIndexChange={(newIdx) => {
          if (attachments[newIdx]) {
            setActiveLightbox(attachments[newIdx]);
          }
        }}
        onClose={() => setActiveLightbox(null)}
      />
    </div>
  );
});

TaskPromptArea.displayName = 'TaskPromptArea';
