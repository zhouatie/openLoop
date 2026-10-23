import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { X, Download, ExternalLink, Image as ImageIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { TaskAttachment } from '@openloop/core';
import { api } from '../services/api';

export type LightboxImageItem =
  | TaskAttachment
  | { name: string; url: string; size?: number; path?: string; id?: string };

export interface ImageLightboxModalProps {
  isOpen: boolean;
  attachment?: LightboxImageItem | null;
  images?: LightboxImageItem[];
  initialIndex?: number;
  currentIndex?: number;
  onIndexChange?: (index: number) => void;
  onClose: () => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  isOpen,
  attachment,
  images,
  initialIndex,
  currentIndex: controlledIndex,
  onIndexChange,
  onClose,
}) => {
  // 标准化图片列表
  const imageList = useMemo<LightboxImageItem[]>(() => {
    if (images && images.length > 0) return images;
    if (attachment) return [attachment];
    return [];
  }, [images, attachment]);

  // 内部维护当前索引
  const [internalIndex, setInternalIndex] = useState<number>(0);

  // 当弹窗打开、attachment 或 images 变动时，同步正确的起始 index
  useEffect(() => {
    if (!isOpen || imageList.length === 0) return;

    if (typeof initialIndex === 'number' && initialIndex >= 0 && initialIndex < imageList.length) {
      setInternalIndex(initialIndex);
      return;
    }

    if (attachment) {
      const targetId = 'id' in attachment ? attachment.id : undefined;
      const foundIdx = imageList.findIndex((item) => {
        if (targetId && 'id' in item && item.id === targetId) return true;
        return item.url === attachment.url && item.name === attachment.name;
      });
      if (foundIdx !== -1) {
        setInternalIndex(foundIdx);
        return;
      }
    }

    setInternalIndex(0);
  }, [isOpen, attachment, images, initialIndex, imageList]);

  // 确定最终激活的索引（优先受控属性，其次内部状态）
  const activeIndex = useMemo(() => {
    if (typeof controlledIndex === 'number' && controlledIndex >= 0 && controlledIndex < imageList.length) {
      return controlledIndex;
    }
    if (internalIndex >= 0 && internalIndex < imageList.length) {
      return internalIndex;
    }
    return 0;
  }, [controlledIndex, internalIndex, imageList.length]);

  const currentImage = imageList[activeIndex] || attachment;

  const hasMultiple = imageList.length > 1;
  const hasPrev = hasMultiple && activeIndex > 0;
  const hasNext = hasMultiple && activeIndex < imageList.length - 1;

  const handlePrev = useCallback(() => {
    if (!hasPrev) return;
    const nextIdx = activeIndex - 1;
    setInternalIndex(nextIdx);
    onIndexChange?.(nextIdx);
    if (import.meta.env?.DEV) {
      console.log('[ImageLightboxModal] 切换至上一张图片:', {
        from: activeIndex,
        to: nextIdx,
        total: imageList.length,
        name: imageList[nextIdx]?.name,
      });
    }
  }, [hasPrev, activeIndex, imageList, onIndexChange]);

  const handleNext = useCallback(() => {
    if (!hasNext) return;
    const nextIdx = activeIndex + 1;
    setInternalIndex(nextIdx);
    onIndexChange?.(nextIdx);
    if (import.meta.env?.DEV) {
      console.log('[ImageLightboxModal] 切换至下一张图片:', {
        from: activeIndex,
        to: nextIdx,
        total: imageList.length,
        name: imageList[nextIdx]?.name,
      });
    }
  }, [hasNext, activeIndex, imageList, onIndexChange]);

  // 灯箱位于最上层：捕获阶段消费 Esc 和左右箭头快捷键，避免同时关闭底层抽屉/弹窗或产生页面冲突
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (import.meta.env?.DEV) {
          console.log('[ImageLightboxModal] 按 Escape 关闭大图预览，并阻断底层浮层响应');
        }
        onClose();
        return;
      }

      if (e.key === 'ArrowLeft') {
        if (hasPrev) {
          e.preventDefault();
          e.stopImmediatePropagation();
          handlePrev();
        }
        return;
      }

      if (e.key === 'ArrowRight') {
        if (hasNext) {
          e.preventDefault();
          e.stopImmediatePropagation();
          handleNext();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, hasPrev, hasNext, handlePrev, handleNext]);

  if (!isOpen || !currentImage) return null;

  const imageUrl = api.getAttachmentUrl(currentImage.url || currentImage.path || '');

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleOpenExternal = () => {
    if (currentImage.path && (window as any).electronAPI?.openPath) {
      (window as any).electronAPI.openPath(currentImage.path);
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
        className="w-full max-w-5xl flex items-center justify-between text-white/90 pb-3 px-2 border-b border-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-white/80 shrink-0">
            <ImageIcon size={14} />
          </div>
          <span className="text-[13px] font-medium truncate text-white max-w-[360px]" title={currentImage.name}>
            {currentImage.name}
          </span>
          {hasMultiple && (
            <span className="text-[11px] font-mono text-white/70 bg-white/10 px-2 py-[1px] rounded shrink-0 border border-white/10">
              {activeIndex + 1} / {imageList.length}
            </span>
          )}
          {currentImage.size && (
            <span className="text-[11px] font-mono text-white/50 bg-white/10 px-1.5 py-[1px] rounded shrink-0">
              {formatFileSize(currentImage.size)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleOpenExternal}
            title={currentImage.path ? '在访达/资源管理器中查看' : '新标签页打开'}
            className="h-[28px] px-2.5 rounded-[5px] bg-white/10 hover:bg-white/20 text-white/90 hover:text-white text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ExternalLink size={12} />
            <span>{currentImage.path ? '在访达中查看' : '打开原图'}</span>
          </button>

          <a
            href={imageUrl}
            download={currentImage.name}
            target="_blank"
            rel="noreferrer"
            className="h-[28px] px-2.5 rounded-[5px] bg-white/10 hover:bg-white/20 text-white/90 hover:text-white text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download size={12} />
            <span>下载</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            className="w-[28px] h-[28px] rounded-[5px] bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 主视图展示区域：包含左右切换按钮与大图 */}
      <div className="relative flex-1 w-full max-w-5xl flex items-center justify-center p-4 min-h-0">
        {/* 左切换按钮 */}
        {hasMultiple && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            disabled={!hasPrev}
            title={hasPrev ? '上一张 (方向键 ←)' : '已是第一张'}
            className="absolute left-2 sm:left-4 z-10 w-10 h-10 rounded-full bg-black/45 hover:bg-black/75 text-white/85 hover:text-white border border-white/15 flex items-center justify-center transition-all backdrop-blur-[6px] shadow-lg disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-black/45 cursor-pointer select-none active:scale-95"
          >
            <ChevronLeft size={22} />
          </button>
        )}

        <img
          key={imageUrl}
          src={imageUrl}
          alt={currentImage.name}
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-[calc(100vh-140px)] object-contain rounded-[6px] shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 animate-in fade-in duration-150"
        />

        {/* 右切换按钮 */}
        {hasMultiple && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            disabled={!hasNext}
            title={hasNext ? '下一张 (方向键 →)' : '已是最后一张'}
            className="absolute right-2 sm:right-4 z-10 w-10 h-10 rounded-full bg-black/45 hover:bg-black/75 text-white/85 hover:text-white border border-white/15 flex items-center justify-center transition-all backdrop-blur-[6px] shadow-lg disabled:opacity-20 disabled:cursor-not-allowed disabled:hover:bg-black/45 cursor-pointer select-none active:scale-95"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      {/* 底部微小快捷键提示 */}
      <div className="text-[11px] text-white/40 pt-1 select-none">
        {hasMultiple ? (
          <>
            按 <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono text-[10px]">←</kbd>{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono text-[10px]">→</kbd> 切换图片，按{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono text-[10px]">Esc</kbd> 或点击任意背景关闭预览
          </>
        ) : (
          <>
            按 <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono text-[10px]">Esc</kbd> 或点击任意背景关闭大图预览
          </>
        )}
      </div>
    </div>
  );
};
