/* 轮末改动卡：取自 deepseek-harness ui-deliverables 的 ChangedFiles（MIT）。
   保留标题、文件列表与折叠；行点击打开这次改动的 diff 页签（review tab 与悬浮预览仍不在本移植范围）。 */
import React, { memo, useState } from 'react';
import type { ChangedFile, TurnChanges } from './changed-files';
import { IconChevronDown, IconChevronUp, IconFileCode } from './icons';
import { useOpenDiff, useOpenFile } from './open-file';
import styles from './ChangedFilesCard.module.css';

/** 折叠前显示的行数 */
const FOLD_ROWS = 4;

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

/** 展示用路径：工作区内的文件去掉工作区前缀，工作区外保持绝对路径 */
function displayPath(path: string, cwd?: string): string {
  if (!cwd) return path;
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(root) ? path.slice(root.length) : path;
}

function Counts({ added, deleted }: { added: number; deleted: number }) {
  return (
    <span className={styles.counts}>
      <span className={styles.added}>{`+${added}`}</span>
      <span className={styles.deleted}>{`-${deleted}`}</span>
    </span>
  );
}

/** 一行文件：点击优先在右侧工作台看这次改动的 diff，拿不到时退回源码预览 */
const FileRow = memo(function FileRow({
  file,
  cwd,
  open,
  openDiff,
}: {
  file: ChangedFile;
  cwd?: string;
  open?: (path: string) => void;
  openDiff?: (target: { changeId: string; path: string }) => void;
}) {
  const shown = displayPath(file.path, cwd);
  const body = (
    <>
      <span className={styles.path}>{shown}</span>
      <Counts added={file.added} deleted={file.deleted} />
    </>
  );
  const diffTarget = file.changeId && openDiff ? { changeId: file.changeId, path: file.path } : undefined;
  if (!open && !diffTarget) {
    return (
      <li className={styles.row} title={shown}>
        {body}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        className={styles.row}
        title={shown}
        aria-label={diffTarget ? `查看 ${shown} 的改动` : `在预览中打开 ${shown}`}
        onClick={() => (diffTarget ? openDiff?.(diffTarget) : open?.(file.path))}
      >
        {body}
      </button>
    </li>
  );
});

/**
 * 一轮结束后的改动文件卡。
 * dsh 的标题在单文件时直接给文件名，多文件时给总数与合计增删行数。
 */
export const ChangedFilesCard = memo(function ChangedFilesCard({
  changes,
  cwd,
}: {
  changes: TurnChanges;
  /** 会话工作目录：列表按工作区相对路径展示 */
  cwd?: string;
}) {
  const openFile = useOpenFile();
  const openDiff = useOpenDiff();
  const [expanded, setExpanded] = useState(false);
  const single = changes.files.length === 1 ? changes.files[0] : undefined;
  const singlePath = single ? displayPath(single.path, cwd) : undefined;
  const singleDiff = single?.changeId && openDiff ? { changeId: single.changeId, path: single.path } : undefined;
  const foldable = changes.files.length > FOLD_ROWS;
  const rows = foldable && !expanded ? changes.files.slice(0, FOLD_ROWS) : changes.files;

  const titles = (
    <>
      <span className={styles.title}>
        {single ? `已编辑 ${basename(single.path)}` : `已编辑 ${changes.files.length} 个文件`}
      </span>
      <Counts added={changes.added} deleted={changes.deleted} />
    </>
  );

  return (
    <div className={styles.card} data-changed-files>
      {single && (singleDiff || openFile) ? (
        <button
          type="button"
          className={styles.header}
          title={singlePath}
          aria-label={singleDiff ? `查看 ${singlePath} 的改动` : `在预览中打开 ${singlePath}`}
          onClick={() => (singleDiff ? openDiff?.(singleDiff) : single && openFile?.(single.path))}
        >
          <span className={styles.tile}>
            <IconFileCode size={20} />
          </span>
          <span className={styles.titles}>{titles}</span>
        </button>
      ) : (
        <div className={styles.header} title={singlePath}>
          <span className={styles.tile}>
            <IconFileCode size={20} />
          </span>
          <span className={styles.titles}>{titles}</span>
        </div>
      )}
      {!single && (
        <ul className={styles.list}>
          {rows.map((file) => (
            <FileRow key={file.path} file={file} cwd={cwd} open={openFile} openDiff={openDiff} />
          ))}
        </ul>
      )}
      {foldable && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>{expanded ? '收起' : `全部 ${changes.files.length} 个文件`}</span>
          {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      )}
    </div>
  );
});
