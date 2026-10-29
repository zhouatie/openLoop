/* 改动对比渲染：取自 deepseek-harness packages/client/ui-deliverables 的 FileDiff（MIT）。
   数据源换成 openLoop 自己算出的 hunk（diff 包的 structuredPatch），
   高亮换成本地 highlightLines，文案直接写中文，其余（统一/分栏、行号、切片）原样保留。 */
import { useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode, UIEvent } from 'react';
import { languageForPath } from './code-language';
import { highlightLines, type HighlightSpan } from './highlight';
import css from './FileDiff.module.css';

/** 一份对比最多渲染的行数 */
export const MAX_RENDERED_LINES = 5000;

/** 一个 hunk：行号从两侧的起点各自推进，lines 已带 + - 空 前缀 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/** 统一视图的一行 */
export interface DiffRow {
  kind: 'add' | 'del' | 'context';
  old: number | undefined;
  new: number | undefined;
  text: string;
}

/** 分栏视图的一行：左侧旧文、右侧新文，可能只有一侧 */
export interface SplitRow {
  left?: { no: number; text: string; kind: 'del' | 'context' };
  right?: { no: number; text: string; kind: 'add' | 'context' };
}

interface HunkHighlights {
  old: ReadonlyMap<number, readonly HighlightSpan[]> | undefined;
  new: ReadonlyMap<number, readonly HighlightSpan[]> | undefined;
}

/** 一侧的行按行号高亮：一次把整侧喂给 shiki，再按行号对回去 */
function highlightedSide(
  rows: readonly DiffRow[],
  side: 'old' | 'new',
  lang: string | undefined
): HunkHighlights['old'] {
  const source = rows.flatMap((row) => {
    const no = row[side];
    return no === undefined ? [] : [{ no, text: row.text }];
  });
  if (source.length === 0) return new Map();
  const lines = highlightLines(source.map((line) => line.text).join('\n'), lang);
  if (lines === undefined) return undefined;
  return new Map(source.map((line, index) => [line.no, lines[index] ?? []]));
}

function hunkHighlights(hunk: DiffHunk, lang: string | undefined): HunkHighlights {
  const rows = hunkRows(hunk);
  return { old: highlightedSide(rows, 'old', lang), new: highlightedSide(rows, 'new', lang) };
}

function DiffText({ text, spans }: { text: string; spans: readonly HighlightSpan[] | undefined }): ReactNode {
  if (spans === undefined) return <span className={css.text}>{text}</span>;
  return (
    <span className={css.text} data-diff-code="">
      {spans.map((span, index) => (
        <span key={index} style={span.style as CSSProperties}>
          {span.text}
        </span>
      ))}
    </span>
  );
}

/** 给一个 hunk 的行编号：上下文两侧都算，删除只算旧侧，新增只算新侧 */
export function hunkRows(hunk: DiffHunk): DiffRow[] {
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  return hunk.lines.map((line) => {
    const text = line.slice(1);
    const sign = line[0];
    if (sign === '+') return { kind: 'add' as const, old: undefined, new: newNo++, text };
    if (sign === '-') return { kind: 'del' as const, old: oldNo++, new: undefined, text };
    return { kind: 'context' as const, old: oldNo++, new: newNo++, text };
  });
}

/** 分栏配对：一段删除与紧随其后的新增逐行对齐，上下文两侧都有 */
export function splitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: NonNullable<SplitRow['left']>[] = [];
  let adds: NonNullable<SplitRow['right']>[] = [];
  const flush = (): void => {
    for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
      const left = dels[at];
      const right = adds[at];
      rows.push({ ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }) });
    }
    dels = [];
    adds = [];
  };
  for (const row of hunkRows(hunk)) {
    if (row.kind === 'del') dels.push({ no: row.old as number, text: row.text, kind: 'del' });
    else if (row.kind === 'add') adds.push({ no: row.new as number, text: row.text, kind: 'add' });
    else {
      flush();
      rows.push({
        left: { no: row.old as number, text: row.text, kind: 'context' },
        right: { no: row.new as number, text: row.text, kind: 'context' },
      });
    }
  }
  flush();
  return rows;
}

/** 按总行数上限切片，最后一段 hunk 可能被截短 */
export function renderedHunks(hunks: readonly DiffHunk[]): { hunks: DiffHunk[]; truncated: boolean } {
  let budget = MAX_RENDERED_LINES;
  const kept: DiffHunk[] = [];
  for (const hunk of hunks) {
    if (budget === 0) return { hunks: kept, truncated: true };
    kept.push(hunk.lines.length <= budget ? hunk : { ...hunk, lines: hunk.lines.slice(0, budget) });
    budget -= Math.min(budget, hunk.lines.length);
  }
  return { hunks: kept, truncated: hunks.some((hunk, at) => kept[at] !== hunk) };
}

function splitRowKind(row: SplitRow): DiffRow['kind'] {
  return row.left?.kind === 'del' ? 'del' : row.right?.kind === 'add' ? 'add' : 'context';
}

function hunkHeader(hunk: DiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

/**
 * 不折行的分栏视图：两列各自横向滚动但同步滚动位置，每行固定高度，两侧永远对齐。
 */
function SplitColumns({
  hunks,
  highlights,
}: {
  hunks: readonly DiffHunk[];
  highlights: readonly HunkHighlights[];
}): ReactNode {
  const paired = useMemo(() => hunks.map((hunk) => ({ header: hunkHeader(hunk), rows: splitRows(hunk) })), [hunks]);
  const columns = useRef<Record<'left' | 'right', HTMLDivElement | null>>({ left: null, right: null });
  const offsets = useRef({
    left: { scrollLeft: 0, scrollTop: 0 },
    right: { scrollLeft: 0, scrollTop: 0 },
  });
  const follow = (side: 'left' | 'right') => (event: UIEvent<HTMLDivElement>): void => {
    const peer = side === 'left' ? 'right' : 'left';
    const other = columns.current[peer];
    if (other === null) return;
    for (const axis of ['scrollLeft', 'scrollTop'] as const) {
      const value = event.currentTarget[axis];
      if (offsets.current[side][axis] === value) continue;
      offsets.current[side][axis] = value;
      other[axis] = value;
      // 记下浏览器夹紧后的值，避免对侧的回滚事件把源侧拉回去
      offsets.current[peer][axis] = other[axis];
    }
  };
  return (
    <div className={css.columns}>
      {(['left', 'right'] as const).map((side) => (
        <div
          key={side}
          className={css.column}
          data-diff-side={side}
          ref={(element) => {
            columns.current[side] = element;
          }}
          onScroll={follow(side)}
        >
          {paired.map((hunk, position) => (
            <section key={position} className={css.hunk}>
              <div className={css.hunkHeader} data-diff-hunk-header="">
                {hunk.header}
              </div>
              {hunk.rows.map((row, at) => {
                const cell = row[side];
                const spans = cell === undefined ? undefined : highlights[position]?.[side === 'left' ? 'old' : 'new']?.get(cell.no);
                return (
                  <div
                    key={at}
                    className={`${css.sideLine} ${cell === undefined ? css.empty : css[cell.kind]}`}
                    data-diff-line={splitRowKind(row)}
                  >
                    <span className={css.number}>{cell?.no ?? ''}</span>
                    <DiffText text={cell?.text ?? ''} spans={spans} />
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 一份文件对比：统一视图给旧/新两列行号，分栏视图左右对照；两者都可折行。
 * 只有新增或只有删除时强制单列，分栏没有意义。
 */
export function FileDiff({
  hunks,
  path,
  split,
  wrap,
}: {
  hunks: readonly DiffHunk[];
  path: string;
  split: boolean;
  wrap: boolean;
}): ReactNode {
  const { hunks: kept, truncated } = useMemo(() => renderedHunks(hunks), [hunks]);
  const lang = languageForPath(path);
  const highlights = useMemo(() => kept.map((hunk) => hunkHighlights(hunk, lang)), [kept, lang]);
  const oneSided = useMemo(() => {
    const hasAdd = kept.some((hunk) => hunk.lines.some((line) => line[0] === '+'));
    const hasDel = kept.some((hunk) => hunk.lines.some((line) => line[0] === '-'));
    return hasAdd !== hasDel;
  }, [kept]);
  const sideBySide = split && !oneSided;

  return (
    <div className={css.body} data-review-view={sideBySide ? 'split' : 'unified'} data-review-wrap={wrap || undefined}>
      {truncated && (
        <p className={css.note} data-diff-truncated="">
          改动过大，仅渲染前 {MAX_RENDERED_LINES} 行
        </p>
      )}
      {sideBySide && !wrap ? (
        <SplitColumns hunks={kept} highlights={highlights} />
      ) : (
        kept.map((hunk, position) => {
          const highlighted = highlights[position];
          return (
            <section key={position} className={css.hunk}>
              <div className={css.hunkHeader} data-diff-hunk-header="">
                {hunkHeader(hunk)}
              </div>
              {sideBySide
                ? splitRows(hunk).map((row, at) => (
                    <div key={at} className={css.splitLine} data-diff-line={splitRowKind(row)}>
                      <span className={`${css.cell} ${row.left === undefined ? css.empty : css[row.left.kind]}`}>
                        <span className={css.number}>{row.left?.no ?? ''}</span>
                        <DiffText
                          text={row.left?.text ?? ''}
                          spans={row.left === undefined ? undefined : highlighted?.old?.get(row.left.no)}
                        />
                      </span>
                      <span className={`${css.cell} ${row.right === undefined ? css.empty : css[row.right.kind]}`}>
                        <span className={css.number}>{row.right?.no ?? ''}</span>
                        <DiffText
                          text={row.right?.text ?? ''}
                          spans={row.right === undefined ? undefined : highlighted?.new?.get(row.right.no)}
                        />
                      </span>
                    </div>
                  ))
                : hunkRows(hunk).map((row, at) => (
                    <div key={at} className={`${css.line} ${css[row.kind]}`} data-diff-line={row.kind}>
                      <span className={css.number}>{row.old ?? ''}</span>
                      <span className={css.number}>{row.new ?? ''}</span>
                      <span className={css.sign}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>
                      <DiffText
                        text={row.text}
                        spans={row.kind === 'add' ? highlighted?.new?.get(row.new as number) : highlighted?.old?.get(row.old as number)}
                      />
                    </div>
                  ))}
            </section>
          );
        })
      )}
    </div>
  );
}
