import { memo, useCallback, useState } from 'react';
import { ImageLightbox as DshImageLightbox } from './dsh/ImageLightbox';
import styles from './ImageLightbox.module.css';

export interface LightboxImage {
  url: string;
  name?: string;
}

const LIGHTBOX_LABELS = { dialog: '图片预览', close: '关闭' };

/** 对话里的图片缩略图：点击由 DSH ImageLightbox 原语放大（body portal、焦点还原） */
export const ImageThumb = memo(function ImageThumb({
  image,
  size = 96,
  className,
}: {
  image: LightboxImage;
  size?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (!image.url) {
    return <span className={`${styles.missing} ${className || ''}`}>图片未内联</span>;
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.thumb} ${className || ''}`}
        style={{ width: size, height: size }}
        onClick={() => setOpen(true)}
        title={image.name || '查看大图'}
        aria-label={`预览 ${image.name || '图片'}`}
      >
        <img src={image.url} alt={image.name || '图片'} loading="lazy" />
      </button>
      {open && (
        <DshImageLightbox src={image.url} alt={image.name || '图片'} labels={LIGHTBOX_LABELS} onClose={close} />
      )}
    </>
  );
});
