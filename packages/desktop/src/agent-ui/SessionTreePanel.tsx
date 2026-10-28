import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionTreeNode } from '@openloop/core/types';
import styles from './SessionTreePanel.module.css';

export interface SessionTreePanelProps {
  nodes: SessionTreeNode[];
  /** 当前活动分支（leaf → 根）的节点 id */
  activeIds: string[];
  leafId: string | null;
  loading?: boolean;
  /** 正在生成回答：pi 不允许此时切换分支 */
  busy?: boolean;
  onClose: () => void;
  /** 选中一条历史条目：用户消息会带回输入框，其余条目直接在其后继续 */
  onSelect: (node: SessionTreeNode) => void;
}

type TreeFilter = 'talk' | 'all' | 'user';

const FILTERS: Array<{ key: TreeFilter; label: string }> = [
  { key: 'talk', label: '对话' },
  { key: 'all', label: '全部' },
  { key: 'user', label: '仅提问' },
];

/** 固定行高：虚拟滚动只渲染视口内的行，长会话（数千条目）也不会卡 */
const ROW_HEIGHT = 28;
const OVERSCAN = 6;
const MAX_INDENT = 7;

interface TreeRow {
  node: SessionTreeNode;
  depth: number;
}

const pad2 = (value: number) => String(value).padStart(2, '0');

function timeLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 深度优先展开成行：子分支紧跟在父节点之后，缩进表达层级 */
function flattenNodes(nodes: SessionTreeNode[]): TreeRow[] {
  const childrenOf = new Map<string, SessionTreeNode[]>();
  const roots: SessionTreeNode[] = [];
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    if (!node.parentId || !ids.has(node.parentId)) {
      roots.push(node);
      continue;
    }
    const list = childrenOf.get(node.parentId);
    if (list) list.push(node);
    else childrenOf.set(node.parentId, [node]);
  }

  const rows: TreeRow[] = [];
  const walk = (list: SessionTreeNode[], depth: number) => {
    for (const node of list) {
      rows.push({ node, depth });
      const children = childrenOf.get(node.id);
      if (children) walk(children, depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

function nearestIndex(rows: TreeRow[], leafId: string | null): number {
  if (rows.length === 0) return 0;
  if (!leafId) return rows.length - 1;
  const index = rows.findIndex((row) => row.node.id === leafId);
  return index >= 0 ? index : rows.length - 1;
}

/** 会话树面板：把 pi 的 /tree 搬到面板里，键盘与鼠标都能定位 */
export const SessionTreePanel = memo(function SessionTreePanel({
  nodes,
  activeIds,
  leafId,
  loading,
  busy,
  onClose,
  onSelect,
}: SessionTreePanelProps) {
  const [filter, setFilter] = useState<TreeFilter>('talk');
  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(420);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const allRows = useMemo(() => flattenNodes(nodes), [nodes]);
  const rows = useMemo(() => {
    if (filter === 'all') return allRows;
    if (filter === 'user') return allRows.filter((row) => row.node.kind === 'user');
    return allRows.filter((row) => row.node.kind !== 'tool');
  }, [allRows, filter]);

  // 打开或切换过滤时，落点到当前分支末端附近
  useEffect(() => {
    setSelected(nearestIndex(rows, leafId));
  }, [rows, leafId]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewport(node.clientHeight));
    observer.observe(node);
    setViewport(node.clientHeight);
    return () => observer.disconnect();
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(rows.length, startIndex + Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2);
  const visible = rows.slice(startIndex, endIndex);

  const select = useCallback(
    (index: number) => {
      const bounded = Math.max(0, Math.min(rows.length - 1, index));
      setSelected(bounded);
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const top = bounded * ROW_HEIGHT;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + ROW_HEIGHT > scroller.scrollTop + scroller.clientHeight) {
        scroller.scrollTop = top + ROW_HEIGHT - scroller.clientHeight;
      }
    },
    [rows.length]
  );

  const commit = useCallback(
    (index: number) => {
      // 生成中切换分支会被 pi 拒绝，这里直接不响应，避免无谓的报错
      if (busy) return;
      const row = rows[index];
      if (row) onSelect(row.node);
    },
    [rows, onSelect, busy]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        select(selected + (event.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(selected);
      }
    },
    [select, selected, commit, onClose]
  );

  const jumpLatest = useCallback(() => {
    const index = rows.findIndex((row) => row.node.id === leafId);
    if (index >= 0) commit(index);
    else commit(rows.length - 1);
  }, [rows, leafId, commit]);

  return (
    <div className={styles.backdrop} onMouseDown={onClose} data-agent-transient>
      <div
        className={styles.card}
        role="dialog"
        aria-label="会话树"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        ref={cardRef}
      >
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.title}>会话树</span>
            <span className={styles.count}>{rows.length} 条</span>
          </div>
          <div className={styles.filters} role="tablist">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={filter === item.key}
                className={`${styles.filter} ${filter === item.key ? styles.filterActive : ''}`}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={scrollerRef}
          className={styles.scroller}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {loading ? (
            <div className={styles.empty}>正在读取会话树…</div>
          ) : rows.length === 0 ? (
            <div className={styles.empty}>这段会话还没有可定位的条目</div>
          ) : (
            <div className={styles.spacer} style={{ height: rows.length * ROW_HEIGHT }}>
              {visible.map((row, offset) => {
                const index = startIndex + offset;
                const onBranch = activeSet.has(row.node.id);
                return (
                  <button
                    key={row.node.id}
                    type="button"
                    className={[
                      styles.row,
                      index === selected ? styles.rowSelected : '',
                      onBranch ? styles.rowOnBranch : styles.rowOffBranch,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      top: index * ROW_HEIGHT,
                      paddingLeft: 10 + Math.min(row.depth, MAX_INDENT) * 13,
                    }}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => commit(index)}
                  >
                    <span className={`${styles.dot} ${styles[`dot_${row.node.kind}`]}`} aria-hidden />
                    <span className={styles.text}>
                      {row.node.kind === 'tool' ? `[${row.node.toolName || 'tool'}]` : row.node.text}
                    </span>
                    <span className={styles.time}>{timeLabel(row.node.timestamp)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>
            {busy ? '回答生成中，结束后可跳转' : '↑↓ 选择 · ↵ 从这里继续 · 选中提问会带回输入框'}
          </span>
          <button type="button" className={styles.latest} onClick={jumpLatest} disabled={busy}>
            回到最新
          </button>
        </div>
      </div>
    </div>
  );
});
