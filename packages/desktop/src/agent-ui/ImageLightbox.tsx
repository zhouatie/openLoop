import React, { memo, useCallback, useEffect, useState } from 'react';
import styles from './ImageLightbox.module.css';

export interface LightboxImage {
  url: string;
  name?: string;
}

/**
 * 对话里的图片缩略图：点击在面板内放大到全屏浮层。
 * 全屏层带 data-agent-transient，并用捕获阶段的 Esc 吞掉事件，避免顺带关掉面板。
 */
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

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
        <div
          className={styles.backdrop}
          role="dialog"
          aria-label="图片预览"
          data-agent-transient
          onClick={(event) => {
            event.stopPropagation();
            close();
          }}
        >
          <img
            className={styles.image}
            src={image.url}
            alt={image.name || '图片'}
            onClick={(event) => event.stopPropagation()}
          />
          <div className={styles.bar}>
            <span className={styles.name}>{image.name || '图片'}</span>
            <button type="button" className={styles.close} onClick={close}>
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
});
