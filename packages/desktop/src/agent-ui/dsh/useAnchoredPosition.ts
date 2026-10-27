/* 取自 deepseek-harness packages/client/ui-primitives/src/useAnchoredPosition.ts（MIT）：
   去掉 overlayTopMargin 依赖，只按 margin 夹取；其余测量/监听逻辑保持一致。 */
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export interface AnchoredPositionOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  gap: number;
  margin: number;
}

/** 让 fixed 定位的浮层跟随锚点：滚动、窗口尺寸、浮层自身尺寸变化都重新测量 */
export function useAnchoredPosition(options: AnchoredPositionOptions): CSSProperties | null {
  const { open, anchorRef, panelRef, side = 'bottom', align = 'start', gap, margin } = options;
  const [position, setPosition] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      const panel = panelRef.current;
      const width = panel?.offsetWidth ?? 0;
      const height = panel?.offsetHeight ?? 0;
      let left = align === 'end' ? rect.right - width : rect.left;
      let top = side === 'top' ? rect.top - gap - height : rect.bottom + gap;
      if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
      if (height > 0) top = Math.min(Math.max(top, margin), window.innerHeight - height - margin);
      setPosition({ left, top });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const panel = panelRef.current;
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && panel !== null) {
      observer = new ResizeObserver(place);
      observer.observe(panel);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchorRef, panelRef, side, align, gap, margin]);

  return position;
}
