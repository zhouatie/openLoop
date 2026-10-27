import React, { memo, useRef, useState } from 'react';
import styles from './TurnRail.module.css';

export interface TurnRailItem {
  turn: number;
  prompt: string;
  response: string;
}

export interface TurnRailProps {
  items: TurnRailItem[];
  activeTurn?: number | null;
  visible?: boolean;
  onJump: (turn: number) => void;
}

const TURN_SPACING_PX = 10;
const RAIL_INSET_PX = 6;
const PREVIEW_MAX_HEIGHT = 100;

/** 右侧轮次定位轨：每轮一根刻度，悬停出预览卡，点击定位 */
export const TurnRail = memo(function TurnRail({ items, activeTurn, visible, onJump }: TurnRailProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<{ turn: number; index: number; top: number } | null>(null);

  if (!visible || items.length === 0) return null;

  const activeIndex = activeTurn ? items.findIndex((item) => item.turn === activeTurn) : -1;
  const previewItem = preview ? items[preview.index] : undefined;

  const handleEnter = (index: number, element: HTMLButtonElement) => {
    const frame = frameRef.current;
    const height = frame?.clientHeight || items.length * TURN_SPACING_PX + RAIL_INSET_PX * 2;
    const center = element.offsetTop + 5;
    const top = Math.max(
      0,
      Math.min(center - PREVIEW_MAX_HEIGHT / 2, height - PREVIEW_MAX_HEIGHT)
    );
    setPreview({ turn: items[index].turn, index, top });
  };

  return (
    <div className={styles.slot}>
      <div ref={frameRef} className={styles.frame} onMouseLeave={() => setPreview(null)}>
        <div className={styles.scroller}>
          <div
            className={styles.marks}
            style={{ height: items.length * TURN_SPACING_PX + RAIL_INSET_PX * 2 }}
          >
            {items.map((item, index) => (
              <button
                key={item.turn}
                type="button"
                className={[
                  styles.mark,
                  item.turn === activeTurn ? styles.markActive : '',
                  preview?.turn === item.turn && item.turn !== activeTurn ? styles.markPreview : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ top: index * TURN_SPACING_PX + RAIL_INSET_PX }}
                aria-label={`跳转到第 ${item.turn} 轮`}
                aria-current={item.turn === activeTurn ? 'true' : undefined}
                onMouseEnter={(event) => handleEnter(index, event.currentTarget)}
                onFocus={(event) => handleEnter(index, event.currentTarget)}
                onBlur={() => setPreview(null)}
                onClick={() => onJump(item.turn)}
              />
            ))}
          </div>
        </div>

        {previewItem && (
          <div className={styles.preview} style={{ top: preview?.top }}>
            <div className={styles.previewPrompt}>{previewItem.prompt || `第 ${previewItem.turn} 轮`}</div>
            {previewItem.response && <div className={styles.previewResponse}>{previewItem.response}</div>}
          </div>
        )}
      </div>
    </div>
  );
});
