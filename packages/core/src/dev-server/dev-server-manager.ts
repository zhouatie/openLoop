/**
 * 工作区开发服务（RN Metro）生命周期管理
 *
 * 流水线里的 env-prepare 节点只为任务服务；写代码的 Agent 会话常常没有任务上下文，
 * 这里把「按工作目录拉起开发服务」抽成与任务、流水线无关的能力：会话工具与界面共用同一份实现。
 *
 * 进程始终 detach：工具调用结束或界面关闭都不会带走 Metro，只能由 stop 或进程退出结束。
 */

import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { getLanIpv4 } from '../system/net';
import type {
  DevServerConfig,
  DevServerProcessRegistry,
  DevServerProject,
  DevServerSnapshot,
} from './types';
import { createLogger } from '../logger';
import { devServerProcessKey } from './keys';

const logger = createLogger('DevServer');

/** 服务探测超时：只关心端口是否在听，不等业务响应 */
const PROBE_TIMEOUT_MS = 250;
/** 启动失败与日志留存的环形缓冲长度：够看红屏原因即可 */
const LOG_LINES = 60;
/** 启动后多久内仍视为「正在拉起」 */
const STARTING_WINDOW_MS = 180_000;
/** 向上查找工程根的层数 */
const ROOT_SEARCH_DEPTH = 4;
/** RN Metro 默认端口 */
const DEFAULT_PORT = 8081;
/** 工程探测缓存时长：同一目录的扫盘结果短期复用 */
const DETECT_CACHE_MS = 2_000;
/** 子目录搜索深度与目录数上限：只在仓库根做一次浅扫 */
const SUBPROJECT_DEPTH = 2;
const SUBPROJECT_SCAN_LIMIT = 120;
/** 明显不含工程的重目录：扫盘直接跳过 */
const SKIP_DIRS = new Set(['node_modules', 'Pods', 'build', 'dist', 'vendor', 'ios', 'android']);
/** 选择面板最多列出的工程数；下探比自动探测深一层 */
const MAX_PROJECTS = 20;
const PICK_DEPTH = 3;

/** 一个在跑的服务：进程句柄只在内存里，重启核心服务后由端口探测兜底 */
interface DevServerEntry {
  key: string;
  child: ChildProcess;
  port: number;
  startedAt: number;
  logs: string[];
  exited: boolean;
  exitError?: string;
}

/** 工程根与启动默认值：只描述「这个目录能怎么启动」，不含用户覆盖 */
interface ProjectInfo {
  root: string | null;
  /** 配置归属键：worktree 回落到主仓库，配置一次全部分支共用 */
  configKey: string;
  detected: boolean;
  command: string;
  port: number;
}

/** 解析后的最终启动配置 */
interface ResolvedConfig extends ProjectInfo {
  key: string;
  command: string;
  port: number;
  nodeBinPath?: string;
}

/** 去掉终端颜色控制符，日志直接进界面 */
function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

/** worktree 的配置挂到主仓库：读 .git 文件比起 git 子进程快得多 */
function configKeyOf(root: string): string {
  let cursor = root;
  for (let depth = 0; depth <= ROOT_SEARCH_DEPTH; depth += 1) {
    const gitPath = path.join(cursor, '.git');
    try {
      if (fs.statSync(gitPath).isFile()) {
        const matched = fs.readFileSync(gitPath, 'utf8').match(/^gitdir:\s*(.+)$/m);
        const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
        const index = matched ? matched[1].indexOf(marker) : -1;
        // worktree 内的子目录也要保留相对路径，否则同仓库的多个 RN 应用会共用一份配置
        const repoRoot = matched && index > 0 ? matched[1].trim().slice(0, index) : cursor;
        return path.join(repoRoot, path.relative(cursor, root));
      }
      if (fs.existsSync(gitPath)) return path.join(cursor, path.relative(cursor, root));
    } catch {}
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return root;
}

/** 展开 ~ 前缀：配置里写成 ~/.nvm/... 时无需手写绝对路径 */
function expandHome(dir: string): string {
  return dir.startsWith('~/') ? path.join(process.env.HOME || '', dir.slice(2)) : dir;
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** RN 工程标记：appJson.json、原生 RN 依赖或 Metro 配置 */
function isRnProject(dir: string): boolean {
  if (fs.existsSync(path.join(dir, 'appJson.json'))) return true;
  if (fs.existsSync(path.join(dir, 'metro.config.js'))) return true;
  if (fs.existsSync(path.join(dir, 'react-native.config.js'))) return true;
  const pkg = readJson(path.join(dir, 'package.json'));
  if (!pkg) return false;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps['react-native'] || deps.chitu || deps['@chitu/core']) return true;
  return Object.values(pkg.scripts || {}).some((script) => String(script).includes('chitu'));
}

/** 端口是否有人监听：只看 TCP 握手，<300ms 返回 */
/** 终止整棵进程树：宿主没有进程登记表时直接兜底 */
function killTree(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function probePort(port: number): Promise<boolean> {
  const attempt = (): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = new net.Socket();
      const finish = (up: boolean) => {
        socket.destroy();
        resolve(up);
      };
      socket.setTimeout(PROBE_TIMEOUT_MS);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(port, '127.0.0.1');
    });
  // 单次握手偶尔会被系统回收队列拖慢：在听的服务不能因一次失败就显示成未就绪
  return attempt().then((up) => (up ? true : new Promise((resolve) => setTimeout(() => resolve(attempt()), 60))));
}

export class DevServerManager {
  private static instance: DevServerManager;
  private entries = new Map<string, DevServerEntry>();

  public static getInstance(): DevServerManager {
    if (!DevServerManager.instance) {
      DevServerManager.instance = new DevServerManager();
    }
    return DevServerManager.instance;
  }

  /** 探测缓存：界面 2.5s 一轮轮询，多次读同一目录不必反复扫盘 */
  private detectCache = new Map<string, { info: ProjectInfo; at: number }>();

  /** 从会话目录向上定位工程根：RN 工程优先，否则退回最近的 package.json */
  public detectProject(cwd: string): ProjectInfo {
    const start = path.resolve(cwd || process.cwd());
    const cached = this.detectCache.get(start);
    if (cached && Date.now() - cached.at < DETECT_CACHE_MS) return cached.info;

    const info = this.locate(start);
    this.detectCache.set(start, { info, at: Date.now() });
    return info;
  }

  private locate(start: string): ProjectInfo {
    let cursor = start;
    let nearestPkg: string | null = null;

    for (let depth = 0; depth <= ROOT_SEARCH_DEPTH; depth += 1) {
      if (isRnProject(cursor)) return this.describe(cursor);
      if (!nearestPkg && fs.existsSync(path.join(cursor, 'package.json'))) nearestPkg = cursor;
      if (!fs.existsSync(path.join(cursor, '.git'))) {
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
        continue;
      }
      break;
    }

    // monorepo 里 RN 应用常在子目录（例如 apps/mobile）：向上找不到时向下浅扫两层
    const base = nearestPkg || start;
    const sub = this.findRnSubproject(base);
    if (sub) return this.describe(sub);

    if (nearestPkg) return { ...this.describe(nearestPkg), detected: false };
    return {
      root: null,
      configKey: start,
      detected: false,
      command: 'npx react-native start',
      port: DEFAULT_PORT,
    };
  }

  /** 浅层广度搜索 RN 工程：限深度与目录数，避开 node_modules 等重目录 */
  private findRnSubproject(base: string): string | null {
    const queue: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0 && visited.size < SUBPROJECT_SCAN_LIMIT) {
      const current = queue.shift()!;
      if (visited.has(current.dir) || current.depth > SUBPROJECT_DEPTH) continue;
      visited.add(current.dir);
      if (current.depth > 0 && isRnProject(current.dir)) return current.dir;
      if (current.depth === PICK_DEPTH) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
    return null;
  }

  /** configKeyOf 复用了与 detectProject 同一套扫盘缓存 */
  public configKeyOf(cwd: string): string {
    return this.detectProject(cwd).configKey;
  }

  /**
   * 工作区里的可启动工程：根目录自身与向下浅扫到的 RN 工程，附带实时状态。
   * 「启动服务」面板据此让用户挑选要跑哪个工程，不依赖会话绑定的目录。
   */
  public async scan(cwd: string): Promise<{ root: string; projects: DevServerProject[] }> {
    const base = path.resolve(cwd || process.cwd());
    const projects = await Promise.all(
      this.collectProjects(base).map(async (root): Promise<DevServerProject> => {
        const saved = getDevServerConfig(root);
        const snapshot = await this.status(root, saved);
        // 端口在听不代表这个工程在跑：只有占用者属于本工程（自己拉起的或同目录手动启动的）才算
        const sameProject = snapshot.owned || (snapshot.running && this.listenerInRoot(root, snapshot.port));
        return {
          path: root,
          name: path.basename(root),
          relative: path.relative(base, root) || '.',
          command: snapshot.command,
          port: snapshot.port,
          nodeBinPath: snapshot.nodeBinPath,
          running: snapshot.running && sameProject,
          owned: snapshot.owned,
          starting: snapshot.starting,
          portBusy: snapshot.running && !sameProject,
          error: snapshot.error,
        };
      })
    );
    return { root: base, projects };
  }

  /** 端口占用者是否在本工程目录内：手动启动的 Metro 也带着工程的 cwd */
  private listenerInRoot(root: string, port: number): boolean {
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    return this.portOccupants(port).some((item) => item.cwd === root || item.cwd.startsWith(prefix));
  }

  /** 根目录优先：根自己就是 RN 工程时不再列子目录，避免同名工程互相干扰 */
  private collectProjects(base: string): string[] {
    if (isRnProject(base)) return [base];
    const found: string[] = [];
    const queue: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0 && visited.size < SUBPROJECT_SCAN_LIMIT && found.length < MAX_PROJECTS) {
      const current = queue.shift()!;
      if (visited.has(current.dir) || current.depth > PICK_DEPTH) continue;
      visited.add(current.dir);

      if (current.depth > 0 && isRnProject(current.dir)) {
        found.push(current.dir);
        // 工程内部不再下钻：ios / node_modules 之类的目录只会制造噪声
        continue;
      }
      if (current.depth === PICK_DEPTH) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
    return found;
  }

  /** 合并用户配置：端口从命令里解析，命令按用户原样执行 */
  public resolve(cwd: string, saved?: DevServerConfig): ResolvedConfig {
    const info = this.detectProject(cwd);
    const root = info.root || path.resolve(cwd || process.cwd());
    const command = saved?.command?.trim() || info.command;
    return {
      ...info,
      root,
      key: devServerProcessKey(root),
      command,
      port: parsePort(command) ?? info.port,
      nodeBinPath: saved?.nodeBinPath?.trim() ? expandHome(saved.nodeBinPath.trim()) : undefined,
    };
  }

  /** 服务快照：状态、地址与最近日志，界面按 1.5s~15s 轮询即可 */
  public async status(cwd: string, saved?: DevServerConfig): Promise<DevServerSnapshot> {
    const config = this.resolve(cwd, saved);
    const entry = this.entries.get(config.key);
    const port = entry?.port || config.port;
    const listening = await probePort(port);
    const alive = Boolean(entry && !entry.exited);
    const starting = alive && !listening && Date.now() - (entry?.startedAt || 0) < STARTING_WINDOW_MS;
    const lanIp = getLanIpv4();

    return {
      cwd: path.resolve(cwd || process.cwd()),
      root: config.root,
      detected: config.detected,
      running: listening,
      owned: alive,
      starting,
      port,
      command: config.command,
      nodeBinPath: config.nodeBinPath,
      url: listening ? `http://localhost:${port}` : null,
      lanUrl: listening && lanIp ? `http://${lanIp}:${port}` : null,
      startedAt: alive ? entry!.startedAt : undefined,
      pid: alive ? entry!.child.pid : undefined,
      error: alive ? undefined : entry?.exitError,
      logs: entry ? [...entry.logs] : [],
    };
  }

  /** 拉起服务：立即返回快照，界面看 starting，Agent 工具用 waitReady 等待就绪 */
  public async start(cwd: string, saved?: DevServerConfig): Promise<DevServerSnapshot> {
    const config = this.resolve(cwd, saved);
    if (!config.root) {
      return { ...(await this.status(cwd, saved)), error: '未找到可启动的工程目录（缺少 package.json）' };
    }

    if (this.entries.has(config.key)) this.stopByKey(config.key);

    // 端口被占：只接管本工程目录下的残留进程；别人的服务一律不动，直接报错让用户换端口
    if (await probePort(config.port)) {
      const foreign = this.foreignOccupants(config.port, config.root);
      if (foreign.length > 0) {
        const detail = foreign.map((item) => `PID ${item.pid} (${item.cwd || '未知目录'})`).join('、');
        return {
          ...(await this.status(cwd, saved)),
          error: `端口 ${config.port} 已被其它进程占用：${detail}。请在启动配置里换一个端口，或先停止该进程`,
        };
      }
      this.killPortOccupants(config.port);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(config.port),
      WEB_PORT: String(config.port),
      RCT_METRO_PORT: String(config.port),
    };
    if (config.nodeBinPath) {
      env.PATH = `${config.nodeBinPath}:${env.PATH || ''}`;
    }

    logger.info(`[DevServer] 启动开发服务: ${config.command} (目录: ${config.root}, 端口: ${config.port})`);

    const child = spawn(config.command, {
      cwd: config.root,
      shell: true,
      detached: process.platform !== 'win32',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const entry: DevServerEntry = {
      key: config.key,
      child,
      port: config.port,
      startedAt: Date.now(),
      logs: [],
      exited: false,
    };
    this.entries.set(config.key, entry);
    this.captureLogs(entry);

    processRegistry?.register(config.key, child, { name: 'rn-dev-server', port: config.port });

    child.once('exit', (code, signal) => {
      entry.exited = true;
      // 主动 stop 已从名册移除，退出事件不再当成失败原因
      if (!this.entries.has(entry.key)) return;
      entry.exitError = describeExit(entry.logs, signal || code);
      logger.warn(`[DevServer] 开发服务退出: ${entry.exitError}`);
    });

    return this.status(cwd, saved);
  }

  /** 等待端口就绪：Agent 工具与界面「启动」都可以等这一份结果 */
  public async waitReady(cwd: string, timeoutMs: number, saved?: DevServerConfig): Promise<DevServerSnapshot> {
    const deadline = Date.now() + timeoutMs;
    let snapshot = await this.status(cwd, saved);
    while (!snapshot.running && !snapshot.error && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      snapshot = await this.status(cwd, saved);
    }
    return snapshot;
  }

  public async stop(cwd: string, saved?: DevServerConfig): Promise<DevServerSnapshot> {
    this.stopByKey(this.resolve(cwd, saved).key);
    return this.status(cwd, saved);
  }

  /** 进程组整体终止：shell 拉起的子进程一并回收 */
  private stopByKey(key: string) {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    if (processRegistry) {
      processRegistry.stopAll(key);
    } else if (entry) {
      killTree(entry.child);
    }
    if (entry) logger.info(`[DevServer] 已停止开发服务 (${key})`);
  }

  /** 端口占用进程的 PID 与工作目录：用于区分「自己的残留监听」与「别人的服务」 */
  private portOccupants(port: number): Array<{ pid: number; cwd: string }> {
    if (process.platform === 'win32') return [];
    let pids: number[] = [];
    try {
      const out = execSync(`lsof -t -i :${port} 2>/dev/null`, { encoding: 'utf8' }).trim();
      pids = out.split('\n').map((line) => parseInt(line.trim(), 10)).filter((pid) => Number.isInteger(pid));
    } catch {
      return [];
    }
    return pids.map((pid) => {
      let cwd = '';
      try {
        const out = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, { encoding: 'utf8' }).trim();
        cwd = out.split('\n').find((line) => line.startsWith('n'))?.slice(1).trim() || '';
      } catch {}
      return { pid, cwd };
    });
  }

  /** 不属于本工程目录的占用者：绝不清理，避免误杀并行任务或用户自己的 Metro */
  private foreignOccupants(port: number, root: string): Array<{ pid: number; cwd: string }> {
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    return this.portOccupants(port).filter((item) => {
      if (item.pid === process.pid || item.pid === process.ppid) return true;
      if (!item.cwd) return true;
      return !(item.cwd === root || item.cwd.startsWith(prefix));
    });
  }

  private killPortOccupants(port: number) {
    for (const { pid } of this.portOccupants(port)) {
      if (pid === process.pid || pid === process.ppid) continue;
      try {
        process.kill(pid, 'SIGKILL');
        logger.info(`[DevServer] 已清理本工程目录下的残留监听 PID: ${pid} (端口 ${port})`);
      } catch {}
    }
  }

  private captureLogs(entry: DevServerEntry) {
    const push = (chunk: Buffer) => {
      const lines = stripAnsi(chunk.toString()).split(/\r?\n/);
      for (const line of lines) {
        const text = line.trimEnd();
        if (!text) continue;
        entry.logs.push(text);
      }
      if (entry.logs.length > LOG_LINES) entry.logs.splice(0, entry.logs.length - LOG_LINES);
    };
    entry.child.stdout?.on('data', push);
    entry.child.stderr?.on('data', push);
  }

  /** 工程根的启动默认值：优先沿用工程自己的脚本，缺省回落到标准启动命令 */
  private describe(root: string): ProjectInfo {
    const pkg = readJson(path.join(root, 'package.json'));
    const scripts: Record<string, string> = pkg?.scripts || {};
    const detected = isRnProject(root);
    let command = 'npx react-native start';

    if (scripts.dev) {
      command = 'npm run dev';
    } else if (fs.existsSync(path.join(root, 'appJson.json'))) {
      command = 'npx chitu dev';
    } else if (scripts.start) {
      command = 'npm start';
    }

    return { root, configKey: configKeyOf(root), detected, command, port: DEFAULT_PORT };
  }
}

/** 端口取自命令里的 --port：不向命令尾部追加参数，避免破坏 tee / 重定向等管道写法 */
function parsePort(command: string): number | null {
  const matched = command.match(/\s--port(?:=|\s+)(\d{2,5})(?!\d)/);
  const port = matched ? Number(matched[1]) : 0;
  return port > 0 && port < 65536 ? port : null;
}

/** 退出原因：优先挑出报错行，挑不到再退回末尾几行，避免只给模型看堆栈尾巴 */
function describeExit(logs: string[], reason: string | number | null): string {
  const head = `开发服务已退出（${reason}）`;
  if (logs.length === 0) return head;
  const hits = logs.filter((line) => /error|cannot find|not found|failed|enoent|eaddrinuse/i.test(line));
  const picked = hits.length > 0 ? hits.slice(0, 4) : logs.slice(-6);
  return `${head}\n${picked.join('\n')}`;
}

export function getDevServerManager(): DevServerManager {
  return DevServerManager.getInstance();
}

/**
 * 用户保存的开发服务配置由核心服务落库；会话工具与界面走同一份读取口径。
 * 没有注册时一切按工程自动探测值启动。
 */
/** 宿主的后台进程登记表；未注入时直接操作子进程，模块可独立使用 */
let processRegistry: DevServerProcessRegistry | null = null;

export function setDevServerProcessRegistry(registry: DevServerProcessRegistry | null): void {
  processRegistry = registry;
}

let configProvider: (cwd: string) => DevServerConfig = () => ({});

export function setDevServerConfigProvider(provider: (cwd: string) => DevServerConfig): void {
  configProvider = provider;
}

/** 读取工作区保存的开发服务配置 */
export function getDevServerConfig(cwd: string): DevServerConfig {
  try {
    return configProvider(cwd) || {};
  } catch {
    return {};
  }
}
