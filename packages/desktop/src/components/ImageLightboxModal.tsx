import React, { useEffect } from 'react';
import { X, Download, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { TaskAttachment } from '@openloop/core';
import { api } from '../services/api';

interface ImageLightboxModalProps {
  isOpen: boolean;
  attachment: TaskAttachment | { name: string; url: string; size?: number; path?: string } | null;
  onClose: () => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  isOpen,
  attachment,
  onClose,
}) => {
  // 灯箱永远位于最上层：捕获阶段消费 Esc 并中断传播，避免同时关闭底层抽屉/弹窗
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (import.meta.env?.DEV) {
        console.log('[ImageLightboxModal] 按 Escape 关闭大图预览，并阻断底层浮层响应');
      }
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen || !attachment) return null;

  const imageUrl = api.getAttachmentUrl(attachment.url);

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleOpenExternal = () => {
    if (attachment.path && (window as any).electronAPI?.openPath) {
      (window as any).electronAPI.openPath(attachment.path);
    } else {
      window.open(imageUrl, '_blank');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 backdrop-blur-[6px] animate-in fade-in duration-150 p-4 select-none"
      onClick={onClose}
    >
      {/* 顶部控制栏 */}
      <div
        className="w-full max-w-4xl flex items-center justify-between text-white/90 pb-3 px-2 border-b border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-white/80 shrink-0">
            <ImageIcon size={14} />
          </div>
          <span className="text-[13px] font-medium truncate text-white" title={attachment.name}>
            {attachment.name}
          </span>
          {attachment.size && (
            <span className="text-[11px] font-mono text-white/50 bg-white/10 px-1.5 py-[1px] rounded shrink-0">
              {formatFileSize(attachment.size)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleOpenExternal}
            title={attachment.path ? '在访达/资源管理器中查看' : '新标签页打开'}
            className="h-[28px] px-2.5 rounded-[5px] bg-white/10 hover:bg-white/20 text-white/90 hover:text-white text-[11px] font-medium flex items-center gap-1.5 transition-colors"
          >
            <ExternalLink size={12} />
            <span>{attachment.path ? '在访达中查看' : '打开原图'}</span>
          </button>

          <a
            href={imageUrl}
            download={attachment.name}
            target="_blank"
            rel="noreferrer"
            className="h-[28px] px-2.5 rounded-[5px] bg-white/10 hover:bg-white/20 text-white/90 hover:text-white text-[11px] font-medium flex items-center gap-1.5 transition-colors"
          >
            <Download size={12} />
            <span>下载</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            className="w-[28px] h-[28px] rounded-[5px] bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-colors"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 主视图展示区域：点击图片以外区域透传到蒙层关闭 */}
      <div className="flex-1 w-full max-w-4xl flex items-center justify-center p-4 min-h-0">
        <img
          src={imageUrl}
          alt={attachment.name}
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-[calc(100vh-140px)] object-contain rounded-[6px] shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10"
        />
      </div>

      {/* 底部微小快捷键提示 */}
      <div className="text-[11px] text-white/40 pt-1">
        按 <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono text-[10px]">Esc</kbd> 或点击任意背景关闭大图预览
      </div>
    </div>
  );
};
