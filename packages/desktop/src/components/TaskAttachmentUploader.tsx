import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, X, ZoomIn, Loader2, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { TaskAttachment } from '@openloop/core';
import { api } from '../services/api';
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

export interface TaskAttachmentUploaderProps {
  attachments: TaskAttachment[];
  onChange: (attachments: TaskAttachment[]) => void;
  disabled?: boolean;
  maxCount?: number;
  maxSizeBytes?: number; // 默认 20MB
}

export const TaskAttachmentUploader: React.FC<TaskAttachmentUploaderProps> = ({
  attachments,
  onChange,
  disabled = false,
  maxCount = 10,
  maxSizeBytes = 20 * 1024 * 1024,
}) => {
  const [pendingUploads, setPendingUploads] = useState<PendingUploadItem[]>([]);
  const [activeLightbox, setActiveLightbox] = useState<TaskAttachment | { name: string; url: string; size?: number; path?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 释放 ObjectURL 避免内存泄漏
  const cleanupPendingItem = useCallback((item: PendingUploadItem) => {
    if (item.previewUrl && item.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }, []);

  // 组件卸载时释放所有未完成的 blob URLs
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

  const processFiles = async (files: File[]) => {
    if (disabled || !files || files.length === 0) return;

    // 过滤出图片类型
    const imageFiles = Array.from(files).filter((f) => {
      const isImg = f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name);
      if (!isImg && import.meta.env?.DEV) {
        console.warn('[TaskAttachment] 忽略非图片文件:', f.name, f.type);
      }
      return isImg;
    });

    if (imageFiles.length === 0) return;

    const currentTotal = attachments.length + pendingUploads.length;
    const availableSlots = Math.max(0, maxCount - currentTotal);
    if (availableSlots <= 0) {
      if (import.meta.env?.DEV) {
        console.warn(`[TaskAttachment] 已达到最大附件上限 (${maxCount})`);
      }
      return;
    }

    const filesToUpload = imageFiles.slice(0, availableSlots);

    // 1. 毫秒级生成本地 Blob 预览，零延迟反馈至 UI
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
      console.log(`[TaskAttachment] 即刻渲染 ${newPendingItems.length} 张本地图片预览:`, {
        files: newPendingItems.map((p) => ({ name: p.name, size: p.size })),
      });
    }

    setPendingUploads((prev) => [...prev, ...newPendingItems]);

    // 2. 异步并行流式上传至核心调度后端
    for (const pending of newPendingItems) {
      if (pending.size > maxSizeBytes) {
        setPendingUploads((prev) =>
          prev.map((item) =>
            item.tempId === pending.tempId
              ? { ...item, status: 'error', errorMessage: '图片超过 20MB 限制' }
              : item
          )
        );
        continue;
      }

      try {
        const uploaded = await api.uploadAttachment(pending.file);
        if (import.meta.env?.DEV) {
          console.log('[TaskAttachment] 后端落盘完毕，成功绑定附件:', uploaded);
        }

        // 成功：更新全局 attachments 列表并移除 pending
        onChange([...attachments, uploaded]);
        cleanupPendingItem(pending);
        setPendingUploads((prev) => prev.filter((item) => item.tempId !== pending.tempId));
      } catch (err: any) {
        if (import.meta.env?.DEV) {
          console.error('[TaskAttachment] 上传失败:', err);
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

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(Array.from(e.target.files));
      // 重置 input 允许选择相同文件
      e.target.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    const target = attachments.find((a) => a.id === id);
    if (import.meta.env?.DEV) {
      console.log('[TaskAttachment] 用户移除已上传附件:', target || id);
    }
    onChange(attachments.filter((a) => a.id !== id));
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
      console.log('[TaskAttachment:Retry] 重试上传图片:', item.name);
    }
    setPendingUploads((prev) =>
      prev.map((p) =>
        p.tempId === item.tempId ? { ...p, status: 'uploading', errorMessage: undefined } : p
      )
    );
    try {
      const uploaded = await api.uploadAttachment(item.file);
      onChange([...attachments, uploaded]);
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

  const hasItems = attachments.length > 0 || pendingUploads.length > 0;

  return (
    <div className="space-y-1.5">
      {/* 隐藏的原生文件上传控件 */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        multiple
        className="hidden"
      />

      {/* 附件操作条与触发按钮 (提供优雅的 + 按钮与即时提示) */}
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={disabled || attachments.length + pendingUploads.length >= maxCount}
            onClick={() => fileInputRef.current?.click()}
            className="group flex items-center gap-1 h-[24px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f7] hover:border-[#cfcfd8] text-[#4b4b53] hover:text-[#1c1c21] transition-all disabled:opacity-40 active:scale-95 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
            title="选择本地图片文件"
          >
            <Plus size={12} className="text-[#63636b] group-hover:text-[#4f46e5] transition-colors" />
            <span className="font-medium text-[10.5px]">添加图片</span>
          </button>

          <span className="text-[10px] text-[#85858d]">
            支持点击 <span className="font-mono text-[#4f46e5]">+</span> 号、拖拽或剪贴板直接 <kbd className="px-1 py-[0.5px] rounded bg-[#f1f1f4] border border-[#e3e3e8] text-[9.5px] text-[#4b4b53] font-mono">⌘V</kbd> 粘贴截图
          </span>
        </div>

        {hasItems && (
          <span className="text-[10px] font-mono text-[#85858d]">
            {attachments.length + pendingUploads.length}/{maxCount}
          </span>
        )}
      </div>

      {/* 缩略图画廊横栏 (Thumbnail Strip) */}
      {hasItems && (
        <div className="flex items-center gap-2 overflow-x-auto py-1 px-0.5 scrollbar-thin">
          {/* 已成功上传的附件 */}
          {attachments.map((att) => {
            const displayUrl = api.getAttachmentUrl(att.url);
            return (
              <div
                key={att.id}
                className="group relative w-[54px] h-[54px] shrink-0 rounded-[6px] border border-[#e3e3e8] bg-[#f9f9fb] overflow-hidden shadow-xs hover:border-[#4f46e5] transition-all cursor-pointer select-none"
                onClick={() => setActiveLightbox(att)}
                title={`${att.name} (${formatFileSize(att.size)})\n点击放大预览`}
              >
                <img
                  src={displayUrl}
                  alt={att.name}
                  className="w-full h-full object-cover"
                />

                {/* 悬浮遮罩及操作图标 */}
                <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1.5 transition-opacity duration-150">
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

                {/* 底部文件名悬浮胶囊 */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-[1px] text-[8px] font-mono text-white/90 truncate pointer-events-none group-hover:opacity-0 transition-opacity">
                  {formatFileSize(att.size)}
                </div>
              </div>
            );
          })}

          {/* 正在上传或出错的文件 */}
          {pendingUploads.map((pending) => (
            <div
              key={pending.tempId}
              className={`group relative w-[54px] h-[54px] shrink-0 rounded-[6px] border overflow-hidden shadow-xs transition-all cursor-pointer ${
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
                  <Loader2 size={13} className="animate-spin text-white mb-0.5" />
                  <span className="text-[8px] font-mono">上传中</span>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/60 text-white p-1 text-center">
                  <AlertCircle size={12} className="text-red-300 mb-0.5" />
                  <span className="text-[7.5px] truncate max-w-full text-red-200">
                    {pending.errorMessage || '失败'}
                  </span>
                </div>
              )}

              {/* 取消 / 删除按钮 */}
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

      {/* 大图灯箱弹窗 */}
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
};
