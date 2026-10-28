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
const OVERSCAN = 8;
const INDENT = 12;
const MAX_INDENT = 8;

interface TreeRow {
  node: SessionTreeNode;
  /** 缩进层级：分叉子节点 +1，分叉后的第一代再 +1 圈住整组，线性长链不再叠加 */
  depth: number;
  /** 每一层的分支点标记：为真就画一条盖住整组子分支的竖线 */
  rails: boolean[];
  /** 搜索时仅作为祖先上下文出现，本身不命中 */
  context?: boolean;
  /** 这里是新的兄弟分支起点：上方画一条弱分割线 */
  branchStart?: boolean;
}

/** 待展开的行：多带一个「父节点是否分叉」，决定下一层要不要再缩进 */
interface PendingRow extends TreeRow {
  justBranched: boolean;
}

const pad2 = (value: number) => String(value).padStart(2, '0');

function timeLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 当前分支所在的那一支排最前：与 pi 的 /tree 一致，当前对话永远第一眼可见 */
function activeFirst(children: SessionTreeNode[], active: Set<string>): SessionTreeNode[] {
  if (children.length < 2) return children;
  const onBranch: SessionTreeNode[] = [];
  const rest: SessionTreeNode[] = [];
  for (const child of children) (active.has(child.id) ? onBranch : rest).push(child);
  return onBranch.concat(rest);
}

/** 深度优先展开成行：子分支紧跟在父节点之后，缩进表达层级 */
function flattenNodes(
  nodes: SessionTreeNode[],
  active: Set<string>
): { rows: TreeRow[]; parentOf: Map<string, string> } {
  const childrenOf = new Map<string, SessionTreeNode[]>();
  const parentOf = new Map<string, string>();
  const roots: SessionTreeNode[] = [];
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    if (!node.parentId || !ids.has(node.parentId)) {
      roots.push(node);
      continue;
    }
    parentOf.set(node.id, node.parentId);
    const list = childrenOf.get(node.parentId);
    if (list) list.push(node);
    else childrenOf.set(node.parentId, [node]);
  }

  const rows: TreeRow[] = [];
  const stack: PendingRow[] = [];
  const orderedRoots = activeFirst(roots, active);
  for (let index = orderedRoots.length - 1; index >= 0; index -= 1) {
    stack.push({ node: orderedRoots[index], depth: 0, rails: [false], justBranched: false });
  }
  while (stack.length > 0) {
    const row = stack.pop() as PendingRow;
    const children = childrenOf.get(row.node.id);
    const fork = !!children && children.length > 1;
    // 本列是不是分叉点：子行靠它画出一条盖住整组的竖线
    row.rails[row.depth] = fork;
    rows.push({ node: row.node, depth: row.depth, rails: row.rails, branchStart: row.branchStart });
    if (!children) continue;
    // 与 pi 的 /tree 一致：分叉子节点缩进一层，分叉后的第一代再缩进一层
    const depth = fork || (row.justBranched && row.depth > 0) ? row.depth + 1 : row.depth;
    const ordered = activeFirst(children, active);
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: ordered[index],
        depth,
        rails: [...row.rails],
        justBranched: fork,
        branchStart: fork && index > 0,
      });
    }
  }
  return { rows, parentOf };
}

function haystackOf(node: SessionTreeNode): string {
  return `${node.toolName || ''} ${node.text}`.toLowerCase();
}

/** 落点：优先当前叶子，其次当前分支末端，最后整棵树的末端 */
function focusIndex(rows: TreeRow[], leafId: string | null, activeSet: Set<string>): number {
  if (rows.length === 0) return 0;
  if (leafId) {
    const index = rows.findIndex((row) => row.node.id === leafId);
    if (index >= 0) return index;
  }
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (activeSet.has(rows[index].node.id)) return index;
  }
  return rows.length - 1;
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
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(420);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef(0);
  const activeSet = useMemo(() => new Set(activeIds), [activeIds]);
  const tree = useMemo(() => flattenNodes(nodes, activeSet), [nodes, activeSet]);

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    // 搜索时翻全量条目：过滤只是浏览方式，不该把命中藏起来
    const scoped = keyword
      ? tree.rows
      : filter === 'all'
        ? tree.rows
        : filter === 'user'
          ? tree.rows.filter((row) => row.node.kind === 'user')
          : tree.rows.filter((row) => !row.node.step);
    if (!keyword) return scoped;

    const hit = new Set<string>();
    for (const row of scoped) {
      if (haystackOf(row.node).includes(keyword)) hit.add(row.node.id);
    }
    // 命中项连同祖先一起保留，否则结果看不出在哪条分支上
    const keep = new Set(hit);
    for (const id of hit) {
      let parent = tree.parentOf.get(id);
      while (parent && !keep.has(parent)) {
        keep.add(parent);
        parent = tree.parentOf.get(parent);
      }
    }
    return scoped
      .filter((row) => keep.has(row.node.id))
      .map((row) => (hit.has(row.node.id) ? row : { ...row, context: true }));
  }, [tree, filter, query]);

  useEffect(() => {
    searchRef.current?.focus();
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  // 过滤、搜索、切叶子都重新落点，并把它挪到视口中央
  useEffect(() => {
    const index = query.trim()
      ? Math.max(0, rows.findIndex((row) => !row.context))
      : focusIndex(rows, leafId, activeSet);
    setSelected(index);
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.scrollTop = Math.max(
        0,
        index * ROW_HEIGHT - scroller.clientHeight / 2 + ROW_HEIGHT / 2
      );
    }
  }, [rows, leafId, activeSet, query]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewport(node.clientHeight));
    observer.observe(node);
    setViewport(node.clientHeight);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setScrollTop(scrollerRef.current?.scrollTop ?? 0);
    });
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(startIndex, endIndex);

  const reveal = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const top = index * ROW_HEIGHT;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_HEIGHT > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = top + ROW_HEIGHT - scroller.clientHeight;
    }
  }, []);

  const move = useCallback(
    (index: number) => {
      const bounded = Math.max(0, Math.min(rows.length - 1, index));
      setSelected(bounded);
      reveal(bounded);
    },
    [rows.length, reveal]
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
        event.preventDefault();
        if (query) setQuery('');
        else onClose();
        return;
      }
      const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 2);
      const target =
        event.key === 'ArrowDown'
          ? selected + 1
          : event.key === 'ArrowUp'
            ? selected - 1
            : event.key === 'PageDown'
              ? selected + page
              : event.key === 'PageUp'
                ? selected - page
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? rows.length - 1
                    : null;
      if (target !== null) {
        event.preventDefault();
        move(target);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(selected);
      }
    },
    [query, viewport, selected, rows.length, move, commit, onClose]
  );

  // 回到最新 = 整棵树的末端条目，不受当前过滤影响
  const jumpLatest = useCallback(() => {
    const tipId = nodes.length > 0 ? nodes[nodes.length - 1].id : null;
    const index = tipId ? rows.findIndex((row) => row.node.id === tipId) : -1;
    commit(index >= 0 ? index : rows.length - 1);
  }, [nodes, rows, commit]);

  return (
    <div className={styles.backdrop} onMouseDown={onClose} data-agent-transient>
      <div
        className={styles.card}
        role="dialog"
        aria-label="会话树"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
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

        <div className={styles.search}>
          <input
            ref={searchRef}
            className={styles.searchInput}
            value={query}
            placeholder="搜索内容或工具名"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className={styles.searchClear}
              aria-label="清空搜索"
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
            >
              ×
            </button>
          ) : null}
        </div>

        <div ref={scrollerRef} className={styles.scroller} onScroll={handleScroll}>
          {loading ? (
            <div className={styles.empty}>正在读取会话树…</div>
          ) : rows.length === 0 ? (
            <div className={styles.empty}>
              {query ? '没有匹配的条目' : '这段会话还没有可定位的条目'}
            </div>
          ) : (
            <div className={styles.spacer} style={{ height: rows.length * ROW_HEIGHT }}>
              {visible.map((row, offset) => {
                const index = startIndex + offset;
                const onBranch = activeSet.has(row.node.id);
                const indent = Math.min(row.depth, MAX_INDENT);
                const leaf = row.node.id === leafId;
                return (
                  <button
                    key={`${index}:${row.node.id}`}
                    type="button"
                    className={[
                      styles.row,
                      index === selected ? styles.rowSelected : '',
                      onBranch ? '' : styles.rowOffBranch,
                      row.context ? styles.rowContext : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ top: index * ROW_HEIGHT, paddingLeft: 10 + indent * INDENT }}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => commit(index)}
                  >
                    {row.branchStart ? (
                      <span
                        className={styles.branchStart}
                        style={{ left: 10 + Math.max(0, indent - 1) * INDENT }}
                        aria-hidden
                      />
                    ) : null}
                    {row.rails.map((drawn, level) =>
                      drawn && level < MAX_INDENT ? (
                        <span
                          key={level}
                          className={styles.guide}
                          style={{ left: 10 + level * INDENT }}
                          aria-hidden
                        />
                      ) : null
                    )}
                    <span
                      className={`${styles.dot} ${styles[row.node.step ? 'dot_step' : `dot_${row.node.kind}`]}`}
                      aria-hidden
                    />
                    {row.node.step ? (
                      <>
                        <span className={styles.tool}>{row.node.toolName}</span>
                        <span className={styles.args}>{row.node.text}</span>
                      </>
                    ) : (
                      <span className={styles.text}>{row.node.text}</span>
                    )}
                    {leaf ? <span className={styles.leaf}>当前</span> : null}
                    <span className={styles.time}>{timeLabel(row.node.timestamp)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>
            {busy ? '回答生成中，结束后可跳转' : '↑↓ 选择 · ↵ 从这里继续 · 输入即搜索 · Esc 关闭'}
          </span>
          <button type="button" className={styles.latest} onClick={jumpLatest} disabled={busy}>
            回到最新
          </button>
        </div>
      </div>
    </div>
  );
});
