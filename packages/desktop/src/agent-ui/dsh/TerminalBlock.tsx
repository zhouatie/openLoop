/* 取自 deepseek-harness packages/client/ui-primitives/src/TerminalBlock.tsx（MIT）：
   命令卡（提示行 + 运行态圆点 + 退出码胶囊 + 复制 + 固定高度滚动的 ANSI 着色输出）。
   仅去掉 locale 注入、行数折叠与 background/signal 分支，文案直接写在组件内。 */
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { parseAnsiLines, type AnsiLine } from './ansi';
import { writeClipboard } from './clipboard';
import css from './TerminalBlock.module.css';

const COPY_LABELS = { copy: '复制', copied: '已复制' };

export interface TerminalBlockProps {
  /** 模型执行的命令原文，多行命令每行一个提示行 */
  command: string;
  /** 命令的工作目录；有值时首行提示符换成目录名，后续行仍用 `$` */
  cwd?: string | undefined;
  /** 命令输出，可能带 ANSI 转义 */
  output?: string | undefined;
  /** 已知的退出码；null 表示结算但没有退出码，undefined 表示未知 */
  exitCode?: number | null | undefined;
  /** 命令仍在运行 */
  running?: boolean | undefined;
  className?: string | undefined;
}

/** 提示符标签：取工作目录最后一段，根目录等无段路径原样显示 */
function promptLabel(cwd: string): string {
  const trimmed = cwd.replace(/[/\\]+$/, '');
  const segment = trimmed.split(/[/\\]/).pop();
  return segment === undefined || segment === '' ? cwd : segment;
}

/** 结算命令的状态胶囊文案，退出 0 不显示胶囊 */
function statusOf(exitCode: number | null | undefined): string | undefined {
  if (exitCode === null) return '无退出码';
  if (exitCode !== undefined && exitCode !== 0) return `退出码 ${exitCode}`;
  return undefined;
}

/** 渲染一行着色文本 */
function renderLine(line: AnsiLine) {
  return line.map((span, index) =>
    span.style === undefined ? span.text : (
      <span key={index} style={span.style}>
        {span.text}
      </span>
    )
  );
}

/** 运行态圆点：运行中为呼吸环，结算后按退出状态取绿 / 红 */
function StateDot({ state }: { state: 'ongoing' | 'done' | 'error' }) {
  if (state !== 'ongoing') return <span className={css.dot} data-state={state} aria-hidden />;
  return (
    <svg className={css.spinner} data-state="ongoing" width={14} height={14} viewBox="0 0 24 24" aria-hidden>
      <g className={css.spinnerMotion}>
        <circle className={css.spinnerTrack} cx="12" cy="12" r="9.5" />
        <circle className={css.spinnerArc} cx="12" cy="12" r="9.5" />
      </g>
    </svg>
  );
}

export function TerminalBlock({
  command,
  cwd,
  output,
  exitCode,
  running = false,
  className,
}: TerminalBlockProps) {
  const text = output ?? '';
  // 输出末尾的换行只是终止符，不算多出来的一行空白
  const lines = useMemo(() => {
    const parsed = parseAnsiLines(text);
    const last = parsed[parsed.length - 1];
    return parsed.length > 1 && last?.every((span) => span.text === '') ? parsed.slice(0, -1) : parsed;
  }, [text]);
  const [copied, setCopied] = useState(false);
  const commandLines = useMemo(() => {
    const body = command.endsWith('\n') ? command.slice(0, -1) : command;
    return body.split('\n');
  }, [command]);

  const status = running ? undefined : statusOf(exitCode);
  const failed = !running && (exitCode === null || (exitCode !== undefined && exitCode !== 0));
  const state = running ? 'ongoing' : failed ? 'error' : 'done';
  const stateLabel = running ? '运行中' : failed ? '失败' : '完成';
  const empty = lines.every((line) => line.every((span) => span.text.trim() === ''));
  // 运行中没有输出时只留提示行；结算后即使没有输出也给出占位
  const body = !running || !empty;

  const onCopy = (): void => {
    void writeClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    });
  };

  return (
    <div className={clsx(css.block, className)} data-terminal="" data-running={running || undefined} data-body={body || undefined}>
      <div className={css.header}>
        <div className={css.prompt}>
          <span className={css.runStateLabel}>{stateLabel}</span>
          {commandLines.map((line, index) => (
            <div key={index} className={css.promptLine}>
              {index === 0 && (
                <span className={css.runState}>
                  <StateDot state={state} />
                </span>
              )}
              <span className={css.cwd}>{index > 0 || cwd === undefined ? '$' : promptLabel(cwd)}</span>
              <span className={css.command}>{line}</span>
            </div>
          ))}
        </div>
        {status !== undefined && <span className={css.status}>{status}</span>}
        {!running && !empty && (
          <button type="button" className={css.copyButton} onClick={onCopy}>
            {copied ? COPY_LABELS.copied : COPY_LABELS.copy}
          </button>
        )}
      </div>
      {body &&
        (empty ? (
          <div className={css.empty}>（没有输出）</div>
        ) : (
          // 行数不折叠：卡片用固定高度滚动，与 DSH 的命令卡一致
          <div className={css.output}>
            {lines.map((line, index) => (
              <div key={index} className={css.line}>
                {renderLine(line)}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
