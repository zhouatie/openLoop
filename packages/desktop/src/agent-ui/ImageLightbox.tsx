import { memo, useCallback, useState } from 'react';
import { ImageLightbox as DshImageLightbox } from './dsh/ImageLightbox';
import styles from './ImageLightbox.module.css';

export interface LightboxImage {
  url: string;
  name?: string;
}

export const LIGHTBOX_LABELS = { dialog: '图片预览', close: '关闭' };

/** 对话里的图片缩略图：点击由 DSH ImageLightbox 原语放大（body portal、焦点还原） */
export const ImageThumb = memo(function ImageThumb({
  image,
  size = 96,
  square = false,
  className,
}: {
  image: LightboxImage;
  /** 长边像素：单图按原图比例缩放，方形模式用作边长 */
  size?: number;
  /** 多图缩略图：固定方形，溢出裁切（极宽截图不会缩成一条） */
  square?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState(0);
  const close = useCallback(() => setOpen(false), []);

  if (!image.url) {
    return <span className={`${styles.missing} ${className || ''}`}>图片未内联</span>;
  }

  const box = square ? { width: size, height: size } : thumbBox(size, ratio);

  return (
    <>
      <button
        type="button"
        className={`${styles.thumb} ${className || ''}`}
        style={{ width: box.width, height: box.height }}
        onClick={() => setOpen(true)}
        title={image.name || '查看大图'}
        aria-label={`预览 ${image.name || '图片'}`}
      >
        <img
          src={image.url}
          alt={image.name || '图片'}
          loading="lazy"
          style={square ? undefined : { objectPosition: anchorOf(ratio) }}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
          }}
        />
      </button>
      {open && (
        <DshImageLightbox src={image.url} alt={image.name || '图片'} labels={LIGHTBOX_LABELS} onClose={close} />
      )}
    </>
  );
});

/** 裁切锚点：极宽图看左半、极高图看顶部，比居中更能露出信息起点 */
function anchorOf(ratio: number): string {
  if (!ratio) return 'center';
  if (ratio > 4) return 'left center';
  if (ratio < 0.25) return 'center top';
  return 'center';
}

/** 缩略图尺寸：长边固定，短边按原图比例收缩（极宽/极高截图也不会被裁成方块） */
function thumbBox(longEdge: number, ratio: number): { width: number; height: number } {
  if (!ratio) return { width: longEdge, height: longEdge };
  const clamped = Math.min(4, Math.max(0.25, ratio));
  return clamped >= 1
    ? { width: longEdge, height: Math.round(longEdge / clamped) }
    : { width: Math.round(longEdge * clamped), height: longEdge };
}
