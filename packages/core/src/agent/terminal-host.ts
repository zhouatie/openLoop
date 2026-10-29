import { EventEmitter } from 'events';
import os from 'os';
import { spawn, type IPty } from 'node-pty';
import { logger } from '../logger';

export interface TerminalSession {
  id: string;
  cwd: string;
  createdAt: number;
}

interface TerminalEntry extends TerminalSession {
  pty: IPty;
  buffer: string[];
}

/** 回放缓存：新挂载的终端补上历史输出，超上限就丢最早的块 */
const MAX_REPLAY_CHARS = 200_000;
const MIN_COLS = 2;
const MAX_COLS = 500;
const MIN_ROWS = 1;
const MAX_ROWS = 300;

function clampSize(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

/** Windows 用 COMSPEC，类 Unix 用登录 shell */
function resolveShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.COMSPEC || 'powershell.exe', args: [] };
  }
  return { file: process.env.SHELL || '/bin/zsh', args: ['-il'] };
}

/**
 * 终端宿主：一个终端一个 PTY 进程，输出经 EventEmitter 推给 WebSocket。
 * 用真 PTY（node-pty）而不是管道：输入回显、行编辑、Ctrl-C 与窗口尺寸都跟着走。
 */
export class TerminalHost extends EventEmitter {
  private static instance: TerminalHost | null = null;
  private entries = new Map<string, TerminalEntry>();
  private seq = 0;

  static getInstance(): TerminalHost {
    if (!TerminalHost.instance) {
      TerminalHost.instance = new TerminalHost();
    }
    return TerminalHost.instance;
  }

  public open(cwd?: string, cols?: number, rows?: number): TerminalSession {
    const id = `term_${++this.seq}_${Date.now().toString(36)}`;
    const { file, args } = resolveShell();
    const dir = cwd && cwd.trim() ? cwd : os.homedir();
    const size = {
      cols: clampSize(cols, MIN_COLS, MAX_COLS, 80),
      rows: clampSize(rows, MIN_ROWS, MAX_ROWS, 24),
    };

    const pty = spawn(file, args, {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: dir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: process.env.LANG || 'en_US.UTF-8',
      } as Record<string, string>,
    });

    const entry: TerminalEntry = { id, cwd: dir, createdAt: Date.now(), pty, buffer: [] };
    this.entries.set(id, entry);

    pty.onData((data) => {
      if (!data) return;
      entry.buffer.push(data);
      let total = entry.buffer.reduce((sum, part) => sum + part.length, 0);
      while (total > MAX_REPLAY_CHARS && entry.buffer.length > 1) {
        total -= entry.buffer.shift()!.length;
      }
      this.emit('data', { id, data });
    });

    pty.onExit(({ exitCode }) => {
      this.emit('exit', { id, code: exitCode });
      this.entries.delete(id);
    });

    logger.info(`[Terminal] 打开终端 ${id} (CWD: ${dir}, ${size.cols}x${size.rows})`);
    return { id, cwd: dir, createdAt: entry.createdAt };
  }

  public write(id: string, data: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.pty.write(data);
    return true;
  }

  /** 面板尺寸变化时同步 PTY 窗口大小，换行与全屏程序都按新尺寸排版 */
  public resize(id: string, cols?: number, rows?: number): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const width = clampSize(cols, MIN_COLS, MAX_COLS, 80);
    const height = clampSize(rows, MIN_ROWS, MAX_ROWS, 24);
    try {
      entry.pty.resize(width, height);
      return true;
    } catch (err) {
      logger.warn('[Terminal] 调整尺寸失败', undefined, { id, error: String(err) });
      return false;
    }
  }

  public replay(id: string): string {
    return this.entries.get(id)?.buffer.join('') || '';
  }

  public list(): TerminalSession[] {
    return [...this.entries.values()].map(({ id, cwd, createdAt }) => ({ id, cwd, createdAt }));
  }

  public close(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    try {
      entry.pty.kill();
    } catch (_) {
      /* 进程可能已退出 */
    }
    return true;
  }

  public closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id);
  }
}

export const terminalHost = TerminalHost.getInstance();
