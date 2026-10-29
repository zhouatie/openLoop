/* 取自 deepseek-harness packages/client/ui-sidebar-terminal/src/client/terminal.tsx（MIT）：
   右侧边栏的 xterm 屏幕（主题、光标、尺寸自适应与状态条）。
   dsh 的 Remote 帧协议 / 多端跟随 / 只读接管没有搬：这里改接 openLoop 的
   /api/agent/terminal（REST 开、写、改尺寸、关）与 WS 的 agent:terminal 输出事件。 */
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../../services/api';
import { TerminalTheme } from './terminal-theme';
import { observeTerminalCursor } from './terminal-cursor';
import css from './TerminalPane.module.css';

/** 等宽字体栈：界面字体之外的终端专用回退 */
const TERMINAL_FONTS = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const DEFAULT_SIZE = { cols: 80, rows: 24 };
/** REST 还没拿到 id 时先攒住输出，超过这个量就不再攒 */
const EARLY_BUFFER_CHARS = 64_000;

type Status =
  | { phase: 'connecting' }
  | { phase: 'ready' }
  | { phase: 'exited'; code: number }
  | { phase: 'failed'; message: string };

interface TerminalPaneProps {
  /** 终端进程的工作目录 */
  cwd?: string;
  /** 页签是否在前面：切回来时把焦点还给终端 */
  active: boolean;
}

/**
 * 工作台里的终端页签：一个 PTY 进程对应一块 xterm 屏幕。
 * 页签只隐藏不卸载，所以进程、回滚与输入焦点在切页签后都还在。
 */
export function TerminalPane({ cwd, active }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState<Status>({ phase: 'connecting' });
  /** 重试用：加一就重建屏幕与进程 */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let terminalId: string | null = null;
    const early = new Map<string, string[]>();
    let earlyChars = 0;

    const term = new Terminal({
      // 浅色底上的 ANSI 色按 WCAG 提对比度，避免暗色系输出糊在背景里
      minimumContrastRatio: 4.5,
      cursorBlink: true,
      fontSize: 12,
      lineHeight: 1.35,
      fontFamily: TERMINAL_FONTS,
      scrollback: 4000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.textarea?.setAttribute('aria-label', '终端');
    termRef.current = term;

    const palette = new TerminalTheme(term);
    const cursor = observeTerminalCursor(term, host, () => palette.cursor);

    /** 底色与前景色跟着界面主题走：颜色取自面板实际计算值 */
    const syncTheme = (): void => {
      const style = getComputedStyle(host);
      palette.update(style.backgroundColor, style.color);
    };
    syncTheme();
    // 深色主题挂在 .agent-scope 的 data-ds-dark-theme 上，属性一变就重新取色
    const scope = host.closest('.agent-scope');
    const themeObserver = new MutationObserver(syncTheme);
    if (scope) themeObserver.observe(scope, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });

    /** 可见时的目标格子尺寸；面板隐藏（宽高为 0）时给默认值 */
    const measure = (): { cols: number; rows: number } => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return DEFAULT_SIZE;
      const dims = fit.proposeDimensions();
      if (dims === undefined || dims.cols < 2 || dims.rows < 1) return DEFAULT_SIZE;
      return { cols: dims.cols, rows: dims.rows };
    };

    const initial = measure();
    term.resize(initial.cols, initial.rows);

    const write = (data: string): void => {
      term.write(data);
    };

    const unsubscribe = api.on('agent:terminal', (payload: any) => {
      if (!payload || typeof payload.id !== 'string') return;
      const data = typeof payload.data === 'string' ? payload.data : '';
      // 进程比 REST 响应先出声（首屏提示符就是这种情况），先攒着，拿到 id 再放
      if (terminalId === null) {
        if (earlyChars >= EARLY_BUFFER_CHARS) return;
        const buffered = early.get(payload.id) ?? [];
        buffered.push(data);
        early.set(payload.id, buffered);
        earlyChars += data.length;
        return;
      }
      if (payload.id !== terminalId) return;
      if (payload.exited) {
        setStatus({ phase: 'exited', code: typeof payload.code === 'number' ? payload.code : -1 });
        return;
      }
      write(data);
    });

    api
      .openTerminal(cwd, initial.cols, initial.rows)
      .then((session) => {
        if (disposed) {
          void api.closeTerminal(session.id);
          return;
        }
        terminalId = session.id;
        if (session.replay) write(session.replay);
        const pending = early.get(session.id);
        if (pending) {
          for (const chunk of pending) write(chunk);
          early.delete(session.id);
        }
        early.clear();
        setStatus({ phase: 'ready' });
        if (import.meta.env?.DEV) {
          console.log('[TerminalPane] 终端就绪:', session.id, cwd || '~', initial);
        }
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ phase: 'failed', message });
        write(`\r\n\x1b[31m终端启动失败：${message}\x1b[0m\r\n`);
        if (import.meta.env?.DEV) console.log('[TerminalPane] 终端启动失败:', message);
      });

    const input = term.onData((data) => {
      if (terminalId) void api.writeTerminal(terminalId, data);
    });

    // 面板拖动与窗口缩放都会连着触发，逐帧合并成一次 fit
    let pendingFit = 0;
    const observer = new ResizeObserver(() => {
      if (pendingFit) return;
      pendingFit = window.requestAnimationFrame(() => {
        pendingFit = 0;
        if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return;
        const dims = fit.proposeDimensions();
        if (dims === undefined || dims.cols < 2 || dims.rows < 1) return;
        term.resize(dims.cols, dims.rows);
        if (terminalId) void api.resizeTerminal(terminalId, dims.cols, dims.rows);
      });
    });
    observer.observe(host);

    return () => {
      disposed = true;
      if (pendingFit) window.cancelAnimationFrame(pendingFit);
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      cursor.dispose();
      palette.dispose();
      term.dispose();
      termRef.current = null;
      if (terminalId) void api.closeTerminal(terminalId);
    };
  }, [cwd, attempt]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return (
    <div className={css.root}>
      <div ref={hostRef} className={css.screen} />
      {status.phase !== 'ready' && (
        <div className={css.status} role="status">
          <span>
            {status.phase === 'connecting' && '正在启动终端…'}
            {status.phase === 'exited' && `终端已退出（退出码 ${status.code}）`}
            {status.phase === 'failed' && `终端不可用：${status.message}`}
          </span>
          {status.phase !== 'connecting' && (
            <button type="button" className={css.action} onClick={() => setAttempt((value) => value + 1)}>
              重新打开
            </button>
          )}
        </div>
      )}
    </div>
  );
}
