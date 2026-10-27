/* 取自 deepseek-harness packages/client/ui-primitives/src/ImageLightbox.tsx（MIT）：
   body portal、Esc/背景关闭、焦点还原、Tab 锁在关闭按钮；图标换成本地 IconClose。 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from '../icons';
import css from './ImageLightbox.module.css';

export interface ImageLightboxLabels {
  /** 预览对话框的无障碍名称 */
  dialog: string;
  /** 关闭按钮的无障碍名称 */
  close: string;
}

/** 点击缩略图打开的原图预览层 */
export function ImageLightbox({
  src,
  alt,
  labels,
  onClose,
}: {
  src: string;
  alt: string;
  labels: ImageLightboxLabels;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      restoreRef.current?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className={`agent-scope ${css.backdrop}`} role="dialog" aria-modal="true" aria-label={labels.dialog}>
      <div className={css.stage}>
        <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
        <img className={css.image} src={src} alt={alt} />
        <button ref={closeRef} type="button" className={css.close} aria-label={labels.close} onClick={onClose}>
          <IconClose size={16} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
