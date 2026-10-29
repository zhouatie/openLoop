/* 工作台的 diff 页签：取一次改动的前后原文，算成 hunk 后交给 FileDiff 渲染。
   数据只在打开时取一次；取不到（进程重启、会话已清理）就提示回退源码预览。 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { structuredPatch } from 'diff';
import { api } from '../services/api';
import { FileDiff, type DiffHunk } from './dsh/FileDiff';
import { IconCompareSplit, IconFile, IconNoWrap, IconRefresh, IconWrap } from './icons';
import styles from './DiffPane.module.css';

/** 服务端返回的一侧内容；binary / oversized 不带正文 */
interface ChangeDiff {
  path: string;
  kind: 'text' | 'binary' | 'oversized';
  before: string | null;
  after: string | null;
}

interface DiffState {
  loading?: boolean;
  error?: string;
  diff?: ChangeDiff;
  hunks?: DiffHunk[];
}

/**
 * 一律按「改前 → 改后」算 hunk。新建文件改前为空，删除文件改后为空，
 * 都退化成整份新增 / 整份删除，与 dsh 的口径一致。
 */
function computeHunks(path: string, before: string | null, after: string | null): DiffHunk[] {
  const patch = structuredPatch(path, path, before ?? '', after ?? '', '', '');
  return patch.hunks.map((hunk) => ({
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines,
  }));
}

export interface DiffPaneProps {
  /** 服务端的改动标识 */
  changeId: string;
  /** 文件绝对路径，只在页签标题与服务端返回失败时用 */
  path: string;
  /** 打开同文件的源码预览 */
  onOpenSource?: (path: string) => void;
}

export const DiffPane = memo(function DiffPane({ changeId, path, onOpenSource }: DiffPaneProps) {
  const [state, setState] = useState<DiffState>({ loading: true });
  const [split, setSplit] = useState(false);
  const [wrap, setWrap] = useState(false);

  const load = useCallback(async () => {
    if (import.meta.env?.DEV) console.log('[DiffPane] 读取改动:', changeId, path);
    setState({ loading: true });
    try {
      const diff = await api.getAgentChangeDiff(changeId);
      setState({
        diff,
        hunks: diff.kind === 'text' ? computeHunks(diff.path || path, diff.before, diff.after) : undefined,
      });
    } catch (err: any) {
      if (import.meta.env?.DEV) console.log('[DiffPane] 改动读取失败:', changeId, err?.message);
      setState({ error: err?.message || '改动内容已过期' });
    }
  }, [changeId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const hunks = state.hunks;
  const note = useMemo(() => {
    const diff = state.diff;
    if (!diff || diff.kind !== 'text') return undefined;
    if (diff.before === null) return '新建文件';
    if (diff.after === null) return '文件已删除';
    if ((hunks?.length ?? 0) === 0) return '内容无变化';
    return undefined;
  }, [state.diff, hunks]);

  const shown = state.diff?.path || path;
  const shownSlash = Math.max(shown.lastIndexOf('/'), shown.lastIndexOf('\\'));

  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <span className={styles.path} title={shown}>
          {shownSlash > 0 && <span className={styles.dir}>{shown.slice(0, shownSlash + 1)}</span>}
          <span className={styles.name}>{shown.slice(shownSlash + 1)}</span>
        </span>
        <button
          type="button"
          className={`${styles.tool} ${split ? styles.toolOn : ''}`}
          aria-pressed={split}
          title={split ? '切换为单列' : '切换为分栏'}
          aria-label={split ? '切换为单列' : '切换为分栏'}
          onClick={() => setSplit((value) => !value)}
        >
          <IconCompareSplit size={14} />
        </button>
        <button
          type="button"
          className={`${styles.tool} ${wrap ? styles.toolOn : ''}`}
          aria-pressed={wrap}
          title={wrap ? '关闭自动折行' : '按面板宽度自动折行'}
          aria-label={wrap ? '关闭自动折行' : '按面板宽度自动折行'}
          onClick={() => setWrap((value) => !value)}
        >
          {wrap ? <IconWrap size={14} /> : <IconNoWrap size={14} />}
        </button>
        {onOpenSource && (
          <button
            type="button"
            className={styles.tool}
            title="打开源码"
            aria-label="打开源码"
            onClick={() => onOpenSource(shown)}
          >
            <IconFile size={14} />
          </button>
        )}
        <button
          type="button"
          className={styles.tool}
          title="重新加载"
          aria-label="重新加载"
          onClick={() => void load()}
        >
          <IconRefresh size={14} />
        </button>
      </div>

      {state.loading ? (
        <div className={styles.status}>读取中…</div>
      ) : state.error ? (
        <div className={styles.status}>
          <span>{state.error}，只能查看源码</span>
          <button
            type="button"
            className={styles.statusAction}
            onClick={() => onOpenSource?.(shown)}
          >
            查看源码
          </button>
        </div>
      ) : state.diff?.kind === 'binary' ? (
        <div className={styles.status}>二进制文件不显示差异</div>
      ) : state.diff?.kind === 'oversized' ? (
        <div className={styles.status}>文件超过 2 MB，不显示差异</div>
      ) : (
        <>
          {note && <div className={styles.note}>{note}</div>}
          <FileDiff hunks={hunks ?? []} path={shown} split={split} wrap={wrap} />
        </>
      )}
    </div>
  );
});
