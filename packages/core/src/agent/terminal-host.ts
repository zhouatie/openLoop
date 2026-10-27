import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';
import { logger } from '../logger';

export interface TerminalSession {
  id: string;
  cwd: string;
  createdAt: number;
}

interface TerminalEntry extends TerminalSession {
  child: ChildProcess;
  buffer: string[];
}

const MAX_REPLAY_CHARS = 200_000;
const MAX_CHUNK_CHARS = 8_000;

function resolveShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe';
  return process.env.SHELL || '/bin/zsh';
}

/**
 * 轻量终端宿主：每个终端一个 shell 子进程，输出经 EventEmitter 推给 WebSocket。
 * 说明：使用管道而非 PTY，TUI 全屏程序不可用，但命令执行、颜色输出与交互式输入可用。
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

  public open(cwd?: string): TerminalSession {
    const id = `term_${++this.seq}_${Date.now().toString(36)}`;
    const shell = resolveShell();
    const dir = cwd && cwd.trim() ? cwd : os.homedir();

    const child = spawn(shell, process.platform === 'win32' ? [] : ['-il'], {
      cwd: dir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        FORCE_COLOR: '1',
        CLICOLOR_FORCE: '1',
        LANG: process.env.LANG || 'en_US.UTF-8',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const entry: TerminalEntry = { id, cwd: dir, createdAt: Date.now(), child, buffer: [] };
    this.entries.set(id, entry);

    const push = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!text) return;
      entry.buffer.push(text);
      // 回放缓存：新挂载的终端可以补上历史输出
      let total = entry.buffer.reduce((sum, part) => sum + part.length, 0);
      while (total > MAX_REPLAY_CHARS && entry.buffer.length > 1) {
        total -= entry.buffer.shift()!.length;
      }
      this.emit('data', { id, data: text.slice(0, MAX_CHUNK_CHARS) });
    };

    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('exit', (code) => {
      this.emit('exit', { id, code });
      this.entries.delete(id);
    });
    child.on('error', (err) => {
      logger.warn('[Terminal] 子进程异常', undefined, { id, error: String(err) });
      this.emit('data', { id, data: `\r\n[openLoop] 终端进程异常: ${String(err)}\r\n` });
    });

    logger.info(`[Terminal] 打开终端 ${id} (CWD: ${dir})`);
    return { id, cwd: dir, createdAt: entry.createdAt };
  }

  public write(id: string, data: string): boolean {
    const entry = this.entries.get(id);
    if (!entry?.child.stdin) return false;
    entry.child.stdin.write(data);
    return true;
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
    try {
      entry.child.kill('SIGHUP');
    } catch (_) {
      /* 进程可能已退出 */
    }
    this.entries.delete(id);
    return true;
  }

  public closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id);
  }
}

export const terminalHost = TerminalHost.getInstance();
