import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import Database from 'better-sqlite3';
import http from 'http';
import { spawn, execSync, ChildProcess } from 'child_process';
import { WorktreeContextInfo, FileDiffItem, TaskWorktreeDiffResult, Task, TaskBackgroundProcess } from '../types';
import { createLogger } from '../logger';
import { PiSessionManager } from '../agent/pi-session';
import { getEffectivePrompt, renderPromptTemplate } from '../constants/prompts';
import { devServerProcessKey } from '../dev-server/keys';

const logger = createLogger('WorktreeManager');

export function findRepoRoot(startDir?: string): string {
  let cur = startDir ? path.resolve(startDir) : process.cwd();
  const wtMarker = `${path.sep}.worktrees`;
  const wtIndex = cur.indexOf(wtMarker);
  if (wtIndex !== -1) {
    cur = cur.slice(0, wtIndex);
  }
  while (cur !== path.dirname(cur)) {
    if (
      fs.existsSync(path.join(cur, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(cur, '.git'))
    ) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return process.cwd();
}

/** 进程组内部记录：proc 句柄只在本进程内存里存在，不外发 */
interface TaskProcessEntry {
  id: string;
  proc: ChildProcess;
  name?: string;
  port?: number;
  startedAt: number;
}

/**
 * 通用任务后台进程生命周期管理器
 * 负责统一管理流水线执行过程中启动的任意后台守护进程（如开发服务、靶机进程等）
 * 支持按任务 ID 隔离注册、探活与一键级联销毁
 */
export class TaskProcessManager {
  private static instance: TaskProcessManager;
  private processes: Map<string, TaskProcessEntry[]> = new Map();
  private listeners = new Set<(taskId: string) => void>();

  public static getInstance(): TaskProcessManager {
    if (!TaskProcessManager.instance) {
      TaskProcessManager.instance = new TaskProcessManager();
    }
    return TaskProcessManager.instance;
  }

  public static stopAll(taskId: string) {
    TaskProcessManager.getInstance().stopAll(taskId);
  }

  /** 订阅进程组变化（注册 / 退出 / 终止）；回调只带任务 ID，调用方按需重取名册 */
  public onProcessesChange(listener: (taskId: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 任务当前在跑的后台进程快照 */
  public list(taskId: string): TaskBackgroundProcess[] {
    const list = this.processes.get(taskId);
    if (!list) return [];
    return list.map((item) => ({
      id: item.id,
      name: item.name || 'background-process',
      pid: item.proc.pid,
      ...(item.port !== undefined ? { port: item.port } : {}),
      startedAt: item.startedAt,
    }));
  }

  /** 终止任务下的单个进程；进程已退出或不存在时返回 false */
  public stop(taskId: string, processId: string): boolean {
    const list = this.processes.get(taskId);
    const item = list?.find((entry) => entry.id === processId);
    if (!list || !item) return false;
    this.killEntry(item);
    const remain = list.filter((entry) => entry !== item);
    if (remain.length > 0) {
      this.processes.set(taskId, remain);
    } else {
      this.processes.delete(taskId);
    }
    this.emitChange(taskId);
    return true;
  }

  public register(taskId: string, proc: ChildProcess, meta?: { name?: string; port?: number }) {
    const list = this.processes.get(taskId) || [];
    const item: TaskProcessEntry = {
      id: Math.random().toString(36).substring(2),
      proc,
      name: meta?.name,
      port: meta?.port,
      startedAt: Date.now(),
    };
    list.push(item);
    this.processes.set(taskId, list);
    this.emitChange(taskId);

    proc.once('exit', () => {
      const currentList = this.processes.get(taskId);
      if (!currentList) return;
      const filtered = currentList.filter((p) => p.proc !== proc);
      // 主动 stop 过的条目已被移除，退出事件不再重复推名册
      if (filtered.length === currentList.length) return;
      if (filtered.length > 0) {
        this.processes.set(taskId, filtered);
      } else {
        this.processes.delete(taskId);
      }
      this.emitChange(taskId);
    });

    logger.info(`[TaskProcess] 已注册后台进程 (Task: ${taskId}, PID: ${proc.pid}, Name: ${meta?.name || 'anonymous'})`);
  }

  public stopAll(taskId: string) {
    const list = this.processes.get(taskId);
    if (!list || list.length === 0) return;

    for (const item of list) {
      this.killEntry(item);
    }
    this.processes.delete(taskId);
    this.emitChange(taskId);
  }

  /** 终止单个进程：先整组杀（沙箱里常带子进程），失败再退回单进程信号 */
  private killEntry(item: TaskProcessEntry) {
    const { proc, port, name } = item;
    if (proc && proc.pid) {
      try {
        if (process.platform !== 'win32') {
          process.kill(-proc.pid, 'SIGKILL');
        } else {
          execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
        }
        logger.info(`[TaskProcess] 已安全终止后台进程 PID: ${proc.pid} (${name || ''})`);
      } catch {
        try {
          proc.kill('SIGKILL');
        } catch {}
      }
    }
    if (port) {
      WorktreeManager.getInstance().killPortIfBusy(port);
    }
  }

  private emitChange(taskId: string) {
    for (const listener of this.listeners) {
      try {
        listener(taskId);
      } catch {}
    }
  }

  public hasRunningProcesses(taskId: string): boolean {
    const list = this.processes.get(taskId);
    return Boolean(list && list.length > 0);
  }
}

export interface CreateWorktreeOptions {
  baseBranch?: string;
  sharedPaths?: string[]; // 相对路径列表，例如 ['node_modules']
  portKeys?: string[];    // 需要动态分配的端口变量键名，如 ['webPort', 'corePort']
  basePort?: number;      // 动态分配起始基准端口（例如 3000, 8080 等）
  portBases?: Record<string, number>; // 针对具体端口变量名的起始基准端口字典，如 { webPort: 3000, corePort: 19890 }
}

export class WorktreeManager {
  private static instance: WorktreeManager;
  // 维护全局已分配但可能尚未监听的端口映射，杜绝并行任务端口时间差冲突
  private static allocatedPorts: Map<string, number[]> = new Map();
  // 串行化端口分配流程，杜绝并发创建 Worktree 时「探测-登记」之间的竞态
  private static allocationLock: Promise<unknown> = Promise.resolve();

  public static getInstance(): WorktreeManager {
    if (!WorktreeManager.instance) {
      WorktreeManager.instance = new WorktreeManager();
    }
    return WorktreeManager.instance;
  }

  public static unregisterTaskPorts(taskId: string) {
    WorktreeManager.getInstance().unregisterTaskPorts(taskId);
  }

  /**
   * 注册指定任务预占的端口列表
   */
  public registerTaskPorts(taskId: string, ports: number[]) {
    WorktreeManager.allocatedPorts.set(taskId, ports);
    logger.info(`[Worktree:PortRegistry] 任务 ${taskId} 已登记占用端口: ${JSON.stringify(ports)}`);
  }

  /**
   * 释放指定任务登记占用的端口
   */
  public unregisterTaskPorts(taskId: string) {
    WorktreeManager.allocatedPorts.delete(taskId);
    logger.info(`[Worktree:PortRegistry] 任务 ${taskId} 已注销预占端口`);
  }

  /**
   * 进程重启后从持久化任务恢复端口预占，避免内存注册表丢失导致并行任务靶机端口重复
   */
  public restoreReservedPorts(tasks: Task[]) {
    const releasedStatus = new Set(['completed', 'failed', 'cancelled']);
    let restored = 0;
    for (const task of tasks) {
      const ports = task.context?.worktree?.ports;
      if (!ports || releasedStatus.has(task.status)) continue;
      const list = Object.values(ports).filter((p): p is number => typeof p === 'number');
      if (list.length === 0) continue;
      WorktreeManager.allocatedPorts.set(task.id, list);
      restored++;
    }
    logger.info(`[Worktree:PortRegistry] 已从持久化任务恢复 ${restored} 个任务的端口预占`);
  }

  /**
   * 串行执行端口分配，保证「探测空闲」与「登记预占」原子完成
   */
  private withAllocationLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = WorktreeManager.allocationLock.then(fn, fn);
    WorktreeManager.allocationLock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * 获取当前所有活跃任务已登记的端口集合
   */
  public getBusyOrReservedPorts(): Set<number> {
    const set = new Set<number>();
    for (const portList of WorktreeManager.allocatedPorts.values()) {
      portList.forEach((p) => set.add(p));
    }
    return set;
  }

  /**
   * 动态探测本地空闲端口（双栈 0.0.0.0 与 127.0.0.1 交叉验证，排查通配符冲突，并跳过全局预占端口）
   */
  public async getAvailablePort(startPort: number, excludePorts?: Set<number>): Promise<number> {
    if (excludePorts && excludePorts.has(startPort)) {
      return this.getAvailablePort(startPort + 1, excludePorts);
    }

    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(startPort, '0.0.0.0', () => {
        const port = (server.address() as net.AddressInfo).port;
        server.close(() => {
          const s2 = net.createServer();
          s2.listen(port, '127.0.0.1', () => {
            s2.close(() => resolve(port));
          });
          s2.on('error', () => {
            resolve(this.getAvailablePort(startPort + 1, excludePorts));
          });
        });
      });
      server.on('error', () => {
        resolve(this.getAvailablePort(startPort + 1, excludePorts));
      });
    });
  }

  /**
   * 安全清理指定端口上的僵尸进程
   * 深度校验进程 CWD 与工作区归属，严禁误杀其他并行且在验收中的任务靶机
   */
  public killPortIfBusy(port: number, options?: { allowWorktreeDir?: string; forTaskId?: string }) {
    // 保护系统核心端口，严禁杀灭（19888 稳定版端口，19889 开发沙箱端口，5173 前端主端口）
    const protectedPorts = [19888, 19889, 5173];
    if (process.env.OPENLOOP_PORT) {
      const customPort = parseInt(process.env.OPENLOOP_PORT, 10);
      if (!isNaN(customPort)) protectedPorts.push(customPort);
    }
    if (protectedPorts.includes(port)) {
      logger.info(`[Worktree] 端口 ${port} 为系统核心保护端口，跳过清理`);
      return;
    }

    try {
      if (process.platform === 'win32') {
        const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' }).trim();
        const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s+/);
          const pidStr = parts[parts.length - 1];
          const pid = parseInt(pidStr, 10);
          if (!isNaN(pid) && pid !== process.pid && pid !== process.ppid) {
            try {
              execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
              logger.info(`[Worktree] (Win) 自动清理占用端口 ${port} 的僵尸进程 PID: ${pid}`);
            } catch {}
          }
        }
      } else {
        const out = execSync(`lsof -t -i :${port}`, { encoding: 'utf-8' }).trim();
        if (out) {
          const pids = out.split('\n').map((p) => p.trim()).filter(Boolean);
          for (const pidStr of pids) {
            const pid = parseInt(pidStr, 10);
            if (isNaN(pid) || pid === process.pid || pid === process.ppid) {
              logger.warn(`[Worktree] 端口 ${port} 关联 PID ${pid} 为当前服务自身或父进程，跳过自杀`);
              continue;
            }

            // 深度进程工作区归属校验：防止误杀并行运行/待验收的其他任务靶机
            try {
              const cwdOut = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, { encoding: 'utf-8' }).trim();
              const cwdLine = cwdOut.split('\n').find((l) => l.startsWith('n'));
              const procCwd = cwdLine ? cwdLine.slice(1).trim() : '';

              if (procCwd) {
                // 如果该进程在 .worktrees 下运行，但所属 worktree 并非当前任务的 worktreeDir，则判定为并行任务保护对象
                if (options?.allowWorktreeDir) {
                  const normalizedAllow = path.resolve(options.allowWorktreeDir);
                  const normalizedProc = path.resolve(procCwd);
                  if (normalizedProc.includes('.worktrees') && normalizedProc !== normalizedAllow) {
                    logger.warn(
                      `[Worktree:Guard] 端口 ${port} 占用进程 (PID: ${pid}, CWD: ${procCwd}) 属于其他并行任务工作区，严禁清理！`
                    );
                    continue;
                  }
                }
              }
            } catch {}

            try {
              process.kill(pid, 'SIGKILL');
              logger.info(`[Worktree] 自动安全清理占用端口 ${port} 的孤儿/自身残留进程 PID: ${pid}`);
            } catch {}
          }
        }
      }
    } catch {}
  }

  /**
   * 秒级创建并初始化通用的 Git Worktree 隔离工作区
   */
  public async createWorktree(
    repoRoot: string,
    taskId: string,
    taskTitle: string,
    options: CreateWorktreeOptions = {}
  ): Promise<WorktreeContextInfo> {
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branchName = `feat/task-${safeTaskId}`;
    const worktreeDir = path.join(repoRoot, '.worktrees', `task-${safeTaskId}`);

    // 自动探测宿主仓库当前检出分支与基线 commit，避免退化为 HEAD 导致后续 Diff 错误对比 master
    let detectedBaseBranch = options.baseBranch;
    if (!detectedBaseBranch || detectedBaseBranch === 'HEAD') {
      try {
        const repoBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim();
        if (repoBranch && repoBranch !== 'HEAD') {
          detectedBaseBranch = repoBranch;
        }
      } catch {}
    }
    const baseBranch = detectedBaseBranch || 'HEAD';
    let baseCommit = '';
    try {
      baseCommit = execSync(`git rev-parse "${options.baseBranch || 'HEAD'}"`, { cwd: repoRoot, encoding: 'utf-8' }).trim();
    } catch {}

    logger.info(`[Worktree:Create] 准备创建隔离开发工作区: ${worktreeDir} (分支: ${branchName}, 基线: ${baseBranch})`);

    // 0. 清理 Git 孤儿 worktree 记录与既有后台进程
    try {
      execSync('git worktree prune', { cwd: repoRoot, stdio: 'ignore' });
    } catch {}
    TaskProcessManager.getInstance().stopAll(taskId);

    // 1. 若旧目录存在，安全移除
    if (fs.existsSync(worktreeDir)) {
      try {
        execSync(`git worktree remove --force "${worktreeDir}"`, { cwd: repoRoot, stdio: 'ignore' });
      } catch {
        try {
          fs.rmSync(worktreeDir, { recursive: true, force: true });
        } catch {}
      }
    }
    try {
      execSync('git worktree prune', { cwd: repoRoot, stdio: 'ignore' });
    } catch {}

    // 2. 检查并清理同名分支残留
    try {
      execSync(`git branch -D "${branchName}"`, { cwd: repoRoot, stdio: 'ignore' });
    } catch {}

    // 3. 执行 git worktree add
    fs.mkdirSync(path.join(repoRoot, '.worktrees'), { recursive: true });
    execSync(`git worktree add -b "${branchName}" "${worktreeDir}" ${baseBranch}`, {
      cwd: repoRoot,
      stdio: 'pipe',
    });

    // 4. 通用依赖与共享路径软链接（如 node_modules，零拷贝提速）
    const sharedPaths = options.sharedPaths && options.sharedPaths.length > 0
      ? options.sharedPaths
      : ['node_modules'];
    this.symlinkSharedPaths(repoRoot, worktreeDir, sharedPaths);

    // 5. 通用动态端口分配（结合编排配置的 basePort / portBases 与全局活跃端口注册表）
    const hasCorePackage =
      fs.existsSync(path.join(repoRoot, 'packages/core')) ||
      fs.existsSync(path.join(worktreeDir, 'packages/core'));
    const portKeys = options.portKeys && options.portKeys.length > 0
      ? [...options.portKeys]
      : ['webPort', 'corePort'];

    if (hasCorePackage && !portKeys.includes('corePort')) {
      portKeys.push('corePort');
    }

    const defaultBase = options.basePort || 5175;

    const ports = await this.withAllocationLock(async () => {
      const reservedPorts = this.getBusyOrReservedPorts();
      const allocated: Record<string, number> = {};
      for (const key of portKeys) {
        // corePort 严格从 19890 开始动态分配，绝对保护 19888 (生产) 与 19889 (开发沙箱)
        const startPortForKey = options.portBases?.[key] || (key === 'corePort' ? 19890 : defaultBase);
        const p = await this.getAvailablePort(startPortForKey, reservedPorts);
        allocated[key] = p;
        reservedPorts.add(p);
      }
      // 先登记预占再释放分配锁，下一个任务必须避开本次分配结果
      this.registerTaskPorts(taskId, Object.values(allocated));
      return allocated;
    });

    // 绝对禁止回退到生产端口 19888，未显式指定时分配独立沙箱端口 (从 19890 起)
    const assignedCorePort = ports.corePort || 19890;
    const primaryPort = ports.webPort || ports.port || ports.PORT || Object.values(ports)[0] || defaultBase;
    const targetUrl = `http://localhost:${primaryPort}?corePort=${assignedCorePort}`;

    // 6. 独立沙箱数据底座隔离（保障全栈应用数据 100% 独立，脱离代码仓库彻底杜绝 Git 冲突）
    this.gcSandboxStores(3);
    const storeDir = this.initTaskSandboxStore(taskId);

    logger.info(`[Worktree:Ready] 隔离工作区就绪，分配端口: ${JSON.stringify(ports)}, 靶机通信 Core: ${assignedCorePort}, 数据目录: ${storeDir}`);

    return {
      worktreeDir,
      branchName,
      baseBranch,
      baseCommit,
      ports,
      corePort: assignedCorePort,
      webPort: primaryPort,
      targetUrl,
      storeDir,
    };
  }

  /**
   * 为包含服务端的全栈沙箱项目启动独立的 Core 调度服务与数据底座
   * 严格杜绝连接稳定版 (19888) 与污染稳定版数据 (~/.openloop)
   */
  public async ensureSandboxCoreServer(
    taskId: string,
    worktree: WorktreeContextInfo,
    onLog?: (msg: string) => void
  ): Promise<number> {
    const worktreeDir = worktree.worktreeDir;
    const hasCorePackage =
      fs.existsSync(path.join(worktreeDir, 'packages/core')) &&
      fs.existsSync(path.join(worktreeDir, 'packages/core/package.json'));

    // 如果不是包含 Core 服务端的项目，返回已分配的 corePort 或默认安全端口
    if (!hasCorePackage) {
      return worktree.corePort || 19890;
    }

    // 1. 严格阻断生产端口 19888：若未分配或属于 19888，立即动态分配 19890+ 的独立沙箱核心端口
    let corePort = worktree.corePort;
    if (!corePort || corePort === 19888) {
      const reservedPorts = this.getBusyOrReservedPorts();
      corePort = await this.getAvailablePort(19890, reservedPorts);
      worktree.corePort = corePort;
      if (!worktree.ports) worktree.ports = {};
      worktree.ports.corePort = corePort;
      const primaryPort = worktree.webPort || worktree.ports.webPort || 5175;
      worktree.targetUrl = `http://localhost:${primaryPort}?corePort=${corePort}`;
      this.registerTaskPorts(taskId, [corePort]);
      onLog?.(`[沙箱隔离] 生产端口阻断保护生效：已为沙箱分配独立核心端口 ${corePort}`);
    }

    // 2. 独立数据目录检查与单向 COW 瞬时快照初始化
    const storeDir = worktree.storeDir || this.initTaskSandboxStore(taskId, onLog);
    worktree.storeDir = storeDir;

    // 3. 探活已有沙箱 Core 进程，若已就绪直接复用
    const isAlreadyAlive = await this.waitForHttpReady(`http://127.0.0.1:${corePort}/api/status`, 500);
    if (isAlreadyAlive) {
      onLog?.(`[沙箱 Core] 独立调度服务此前已就绪 (端口: ${corePort})`);
      return corePort;
    }

    // 4. 清理残留并拉起
    this.killPortIfBusy(corePort, { allowWorktreeDir: worktreeDir, forTaskId: taskId });

    const coreScriptPath = path.join(worktreeDir, 'packages/core/dist/server-cli.js');
    if (!fs.existsSync(coreScriptPath)) {
      onLog?.(`[沙箱 Core] 首次启动编译 core 模块...`);
      try {
        execSync('pnpm --filter @openloop/core build', { cwd: worktreeDir, stdio: 'pipe' });
      } catch (buildErr: any) {
        onLog?.(`[沙箱 Core] 编译警告: ${buildErr.message}`);
      }
    }

    onLog?.(`[沙箱 Core] 启动独立调度服务 (端口: ${corePort}, 数据目录: ${storeDir})`);
    const isUnix = process.platform !== 'win32';
    const coreChild = spawn(`node packages/core/dist/server-cli.js`, {
      cwd: worktreeDir,
      shell: true,
      detached: isUnix,
      env: {
        ...process.env,
        PORT: String(corePort),
        OPENLOOP_PORT: String(corePort),
        OPENLOOP_STORE_DIR: storeDir,
      },
      stdio: 'pipe',
    });

    TaskProcessManager.getInstance().register(taskId, coreChild, {
      name: 'sandbox-core-server',
      port: corePort,
    });

    coreChild.stdout?.on('data', (d) => onLog?.(`[Core] ${d.toString().trimEnd()}`));
    coreChild.stderr?.on('data', (d) => onLog?.(`[Core:err] ${d.toString().trimEnd()}`));

    const isReady = await this.waitForHttpReady(`http://127.0.0.1:${corePort}/api/status`, 15000);
    if (isReady) {
      onLog?.(`[沙箱 Core] ✔ 独立调度服务已成功就绪 (端口: ${corePort})`);
    } else {
      onLog?.(`[沙箱 Core 警告] 独立调度服务启动等待超时，请检查控制台输出`);
    }

    return corePort;
  }

  /**
   * 通用建立宿主与沙箱 worktree 的共享路径软链
   * 彻底解耦项目结构：支持精确相对路径与通配模式（如 node_modules, packages/*\/node_modules, **\/node_modules）
   */
  private symlinkSharedPaths(repoRoot: string, worktreeDir: string, relativePatterns: string[]) {
    const matchedRelPaths = new Set<string>();

    for (const pattern of relativePatterns) {
      if (pattern.includes('*')) {
        this.resolveGlobPaths(repoRoot, pattern, matchedRelPaths);
      } else {
        matchedRelPaths.add(pattern);
      }
    }

    for (const rel of matchedRelPaths) {
      const src = path.join(repoRoot, rel);
      const dest = path.join(worktreeDir, rel);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.symlinkSync(src, dest, 'dir');
          logger.info(`[Worktree:Symlink] 共享依赖软链就绪: ${rel}`);
        } catch (err: any) {
          logger.warn(`[Worktree:Symlink] 软链创建告警: ${dest} -> ${err.message}`);
        }
      }
    }
  }

  private resolveGlobPaths(baseDir: string, pattern: string, results: Set<string>) {
    const parts = pattern.split(/[\\/]/).filter(Boolean);
    const search = (dir: string, depth: number) => {
      if (depth >= parts.length || !fs.existsSync(dir)) return;
      const part = parts[depth];

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name === '.git' || entry.name === '.worktrees') continue;

          if (part === '**') {
            search(path.join(dir, entry.name), depth);
            search(path.join(dir, entry.name), depth + 1);
            if (depth + 1 < parts.length && entry.name === parts[parts.length - 1]) {
              results.add(path.relative(baseDir, path.join(dir, entry.name)));
            }
          } else if (part === '*' || part === entry.name) {
            if (depth === parts.length - 1) {
              results.add(path.relative(baseDir, path.join(dir, entry.name)));
            } else {
              search(path.join(dir, entry.name), depth + 1);
            }
          }
        }
      } catch {}
    };

    search(baseDir, 0);
  }

  /**
   * 轮询 HTTP 服务是否就绪（严格校验 2xx/3xx，排斥 404 与 500）
   */
  public async waitForHttpReady(url: string, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const ok = await new Promise<boolean>((resolve) => {
          const req = http.get(url, (res) => {
            resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400);
          });
          req.on('error', () => resolve(false));
          req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
          });
        });
        if (ok) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 600));
    }
    return false;
  }

  /**
   * 结构化获取 Worktree 相比主分支的代码修改详情与完整 Diff
   */
  public getWorktreeDiffDetail(
    worktreeDir: string,
    baseBranch?: string,
    baseCommitParam?: string
  ): TaskWorktreeDiffResult {
    if (!fs.existsSync(worktreeDir)) {
      return {
        hasWorktree: false,
        summary: { filesChanged: 0, insertions: 0, deletions: 0, rawStat: '' },
        files: [],
      };
    }

    try {
      // 1. 获取当前分支名
      let branchName = '';
      try {
        branchName = execSync('git rev-parse --abbrev-ref HEAD', { cwd: worktreeDir, encoding: 'utf-8' }).trim();
      } catch {}

      // 2. 确定比较基线祖先 commit
      let baseCommit = baseCommitParam || '';
      // 2.1 若显式指定了基线分支名（且非当前分支自身及 HEAD）
      if (!baseCommit && baseBranch && baseBranch !== 'HEAD' && baseBranch !== branchName) {
        try {
          baseCommit = execSync(`git merge-base HEAD "${baseBranch}"`, { cwd: worktreeDir, encoding: 'utf-8' }).trim();
        } catch {}
      }
      // 2.2 若未指定或为 HEAD，优先推导直接父级宿主仓库的当前分支
      if (!baseCommit) {
        try {
          const directParentRepo = path.dirname(path.dirname(worktreeDir));
          if (fs.existsSync(directParentRepo)) {
            const hostBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: directParentRepo, encoding: 'utf-8' }).trim();
            if (hostBranch && hostBranch !== 'HEAD' && hostBranch !== branchName) {
              baseCommit = execSync(`git merge-base HEAD "${hostBranch}"`, { cwd: worktreeDir, encoding: 'utf-8' }).trim();
            }
          }
        } catch {}
      }
      // 2.3 分支创建后未产生新提交时，reflog 唯一一条记录即为创建基线（多条记录严禁回溯，否则会退化为全历史对比）
      if (!baseCommit && branchName) {
        try {
          const reflogLines = execSync(`git reflog show "${branchName}"`, { cwd: worktreeDir, encoding: 'utf-8' })
            .split('\n')
            .filter(Boolean);
          if (reflogLines.length === 1) {
            const match = reflogLines[0].match(/^([a-f0-9]{7,40})\b/);
            if (match) {
              baseCommit = match[1];
            }
          }
        } catch {}
      }
      // 2.4 通用主干分支兜底
      if (!baseCommit) {
        for (const candidate of ['main', 'master', 'origin/main', 'origin/master', 'HEAD~1']) {
          try {
            baseCommit = execSync(`git merge-base HEAD "${candidate}"`, { cwd: worktreeDir, encoding: 'utf-8' }).trim();
            if (baseCommit) break;
          } catch {}
        }
      }
      if (!baseCommit) {
        baseCommit = 'HEAD';
      }

      // 3. 临时对未跟踪文件添加 intent-to-add 以便在 diff 中识别新文件
      let addedIntent = false;
      try {
        const untrackedStatus = execSync('git status --porcelain', { cwd: worktreeDir, encoding: 'utf-8' });
        if (untrackedStatus.includes('??')) {
          execSync('git add -N .', { cwd: worktreeDir, stdio: 'ignore' });
          addedIntent = true;
        }
      } catch {}

      const excludeArgs = [
        `":(exclude)*node_modules*"`,
        `":(exclude)*.worktrees*"`,
        `":(exclude)*.openloop*"`,
        `":(exclude)*.openloop-store*"`,
        `":(exclude)*dist*"`,
        `":(exclude)*dist-electron*"`,
      ].join(' ');

      try {
        // 4. 读取 numstat 获取每个文件的修改统计
        const numstatMap = new Map<string, { additions: number; deletions: number; isBinary: boolean }>();
        try {
          const numstatOut = execSync(`git diff --numstat ${baseCommit} -- . ${excludeArgs}`, {
            cwd: worktreeDir,
            encoding: 'utf-8',
          });
          const numstatLines = numstatOut.split('\n').filter((l) => Boolean(l.trim()));
          for (const line of numstatLines) {
            const parts = line.split('\t');
            if (parts.length >= 3) {
              const addStr = parts[0].trim();
              const delStr = parts[1].trim();
              const rawFilePath = parts.slice(2).join('\t').trim();
              // 兼容重命名语法 {old => new}
              let targetPath = rawFilePath;
              if (rawFilePath.includes(' => ')) {
                const renameMatch = rawFilePath.match(/(?:\{.*? => (.*?)\}|.*? => (.*))/);
                if (renameMatch) {
                  targetPath = (renameMatch[1] || renameMatch[2] || rawFilePath).replace(/[{}]/g, '');
                }
              }
              const isBinary = addStr === '-' || delStr === '-';
              numstatMap.set(targetPath, {
                additions: isBinary ? 0 : parseInt(addStr, 10) || 0,
                deletions: isBinary ? 0 : parseInt(delStr, 10) || 0,
                isBinary,
              });
            }
          }
        } catch (e: any) {
          logger.warn(`[getWorktreeDiffDetail] 读取 numstat 告警: ${e.message}`);
        }

        // 5. 读取 raw diff stat
        let rawStat = '';
        try {
          rawStat = execSync(`git diff --stat ${baseCommit} -- . ${excludeArgs}`, {
            cwd: worktreeDir,
            encoding: 'utf-8',
          }).trim();
        } catch {}

        // 6. 读取完整 unified diff 并按文件切分
        let fullDiff = '';
        try {
          fullDiff = execSync(`git diff -U3 ${baseCommit} -- . ${excludeArgs}`, {
            cwd: worktreeDir,
            encoding: 'utf-8',
            maxBuffer: 15 * 1024 * 1024,
          });
        } catch (e: any) {
          logger.warn(`[getWorktreeDiffDetail] 读取完整 diff 告警: ${e.message}`);
        }

        const files: FileDiffItem[] = [];
        const processedFiles = new Set<string>();

        if (fullDiff.trim()) {
          const chunks = fullDiff.split(/^diff --git /m);
          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            const fullChunk = 'diff --git ' + chunk;
            const headerMatch = chunk.match(/^a\/(.+?)\s+b\/(.+?)(?:\r?\n|$)/);
            if (!headerMatch) continue;

            const oldPath = headerMatch[1];
            const newPath = headerMatch[2];
            const file = newPath || oldPath;

            // 过滤忽略目录
            if (
              file.includes('node_modules') ||
              file.startsWith('.worktrees') ||
              file.startsWith('.openloop') ||
              file.includes('.openloop-store') ||
              file.includes('/dist/') ||
              file.includes('/dist-electron/')
            ) {
              continue;
            }

            let status: FileDiffItem['status'] = 'modified';
            if (chunk.includes('new file mode')) {
              status = 'added';
            } else if (chunk.includes('deleted file mode')) {
              status = 'deleted';
            } else if (chunk.includes('similarity index') || chunk.includes('rename from')) {
              status = 'renamed';
            }

            const stat = numstatMap.get(file) || { additions: 0, deletions: 0, isBinary: false };
            let additions = stat.additions;
            let deletions = stat.deletions;

            // 如果 numstat 没匹配上，从 chunk 中手动计算
            if (additions === 0 && deletions === 0 && !stat.isBinary) {
              const lines = chunk.split('\n');
              for (const l of lines) {
                if (l.startsWith('+') && !l.startsWith('+++')) additions++;
                else if (l.startsWith('-') && !l.startsWith('---')) deletions++;
              }
            }

            files.push({
              file,
              oldPath: status === 'renamed' ? oldPath : undefined,
              status,
              additions,
              deletions,
              diff: fullChunk,
              isBinary: stat.isBinary,
            });
            processedFiles.add(file);
          }
        }

        // 7. 处理二进制或未在 unified diff 包含但存在改动的文件
        numstatMap.forEach((stat, file) => {
          if (!processedFiles.has(file)) {
            if (
              file.includes('node_modules') ||
              file.startsWith('.worktrees') ||
              file.startsWith('.openloop') ||
              file.includes('.openloop-store') ||
              file.includes('/dist/') ||
              file.includes('/dist-electron/')
            ) {
              return;
            }
            files.push({
              file,
              status: stat.additions > 0 && stat.deletions === 0 ? 'added' : 'modified',
              additions: stat.additions,
              deletions: stat.deletions,
              diff: stat.isBinary ? `[二进制文件变更: ${file}]` : '',
              isBinary: stat.isBinary,
            });
            processedFiles.add(file);
          }
        });

        const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
        const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);

        return {
          hasWorktree: true,
          worktreeDir,
          branchName,
          baseBranch,
          summary: {
            filesChanged: files.length,
            insertions: totalAdditions,
            deletions: totalDeletions,
            rawStat,
          },
          files,
        };
      } finally {
        if (addedIntent) {
          try {
            execSync('git reset', { cwd: worktreeDir, stdio: 'ignore' });
          } catch {}
        }
      }
    } catch (err: any) {
      logger.error(`[getWorktreeDiffDetail] 获取 diff 失败: ${err.message}`, err);
      return {
        hasWorktree: true,
        worktreeDir,
        summary: { filesChanged: 0, insertions: 0, deletions: 0, rawStat: '' },
        files: [],
      };
    }
  }

  /**
   * 获取 Worktree 相比主分支的代码修改与统计（通用 git diff 审计）
   */
  public getWorktreeDiff(
    worktreeDir: string,
    baseBranch?: string,
    baseCommit?: string
  ): { changedFiles: string[]; diffSummary: string; diffResult?: TaskWorktreeDiffResult } {
    if (!fs.existsSync(worktreeDir)) {
      return { changedFiles: [], diffSummary: '0 files' };
    }
    try {
      const detail = this.getWorktreeDiffDetail(worktreeDir, baseBranch, baseCommit);
      const changedFiles = detail.files.map((f) => f.file);
      
      // 生成优雅紧凑的单行统计，严禁包含多行或复杂管道破坏 UI 布局
      let diffSummary = '';
      if (detail.files.length > 0) {
        const ins = detail.summary.insertions;
        const dels = detail.summary.deletions;
        const count = detail.files.length;
        diffSummary = `+${ins} / -${dels} (${count} 个文件)`;
      } else {
        diffSummary = '无文件变更';
      }

      return {
        changedFiles,
        diffSummary,
        diffResult: detail,
      };
    } catch {
      return { changedFiles: [], diffSummary: '' };
    }
  }

  /**
   * 停止沙箱关联的所有后台进程
   */
  public stopEphemeralServers(worktreeDirOrTaskId: string) {
    TaskProcessManager.getInstance().stopAll(worktreeDirOrTaskId);
  }

  /**
   * 任务驳回时的安全清理
   */
  public rejectAndCleanup(
    repoRoot: string,
    taskId: string,
    keepWorktree = true,
    onLog?: (msg: string) => void
  ) {
    onLog?.(`[驳回清理] 正在释放任务 ${taskId} 关联的后台服务进程...`);
    TaskProcessManager.getInstance().stopAll(taskId);
    this.unregisterTaskPorts(taskId);
    if (!keepWorktree) {
      this.cleanupTaskWorktree(repoRoot, taskId, onLog);
    }
  }

  /**
   * 验收通过并自动合并代码至宿主开发分支，并安全清理现场
   */
  public async approveAndMerge(
    repoRoot: string,
    taskId: string,
    commitTitle: string,
    onLog?: (msg: string) => void
  ): Promise<{ success: boolean; message: string }> {
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branchName = `feat/task-${safeTaskId}`;
    const worktreeDir = path.join(repoRoot, '.worktrees', `task-${safeTaskId}`);

    onLog?.(`[合并与清理] 准备合并分支 ${branchName} 并清理沙箱现场...`);

    // 1. 停止该任务的所有后台进程
    TaskProcessManager.getInstance().stopAll(taskId);

    if (!fs.existsSync(worktreeDir)) {
      // 幂等自愈检查：若该任务代码此前已成功合入宿主当前分支，自动视为合并就绪
      try {
        const mergedCheck = execSync(`git log -n 50 --grep="${taskId}" --oneline`, {
          cwd: repoRoot,
          encoding: 'utf-8',
        }).trim();
        if (mergedCheck) {
          onLog?.(`[合并与清理] ✔ 检测到该任务代码此前已合入主分支 (${mergedCheck.split('\n')[0]})，沙箱已清理完成`);
          return {
            success: true,
            message: `任务变更此前已成功合入主分支，自动判定合并就绪`,
          };
        }
      } catch {}

      return { success: false, message: `工作区目录不存在: ${worktreeDir}` };
    }

    try {
      // 2. 提交沙箱内的代码改动
      try {
        execSync('git add -A', { cwd: worktreeDir, stdio: 'ignore' });
        const hasChanges = execSync('git status --porcelain', { cwd: worktreeDir, encoding: 'utf-8' }).trim();
        if (hasChanges) {
          const safeMsg = commitTitle.replace(/"/g, '\\"') || `feat: 自动化任务验收合并 (${taskId})`;
          execSync(`git commit -m "${safeMsg}"`, { cwd: worktreeDir, stdio: 'pipe' });
          onLog?.(`[合并与清理] 已提交沙箱内代码变更`);
        }
      } catch (err: any) {
        onLog?.(`[合并与清理 Warning] 沙箱提交提示: ${err.message}`);
      }

      // 3. 检查宿主工作区是否有未提交修改，若有则自动 stash 暂存保护，避免阻塞自动化合并
      let hasStashed = false;
      try {
        const dirty = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf-8' }).trim();
        if (dirty) {
          onLog?.(`[合并保护] 检测到宿主本地存在未提交改动，自动暂存 (git stash) 以免中断合并...`);
          execSync(`git stash push -u -m "openloop-auto-stash-${taskId}"`, { cwd: repoRoot, stdio: 'pipe' });
          hasStashed = true;
        }
      } catch (stashErr: any) {
        onLog?.(`[合并保护 提示] 暂存本地改动跳过: ${stashErr.message}`);
      }

      try {
        // 4. 在宿主主分支执行合并
        onLog?.(`[合并与清理] 正在将 ${branchName} 合并至本地宿主当前分支...`);
        try {
          execSync(`git merge "${branchName}" --no-ff -m "Merge branch '${branchName}' (Task: ${taskId})"`, {
            cwd: repoRoot,
            stdio: 'pipe',
          });
          onLog?.(`[合并与清理] ✔ 分支合并成功！`);
        } catch (mergeErr: any) {
          // 宿主立即回滚未决合并，确保主开发分支绝对不被污染
          try {
            execSync('git merge --abort', { cwd: repoRoot, stdio: 'ignore' });
          } catch {}

          onLog?.(`[合并与清理 告警] 分支合并产生冲突，保留 Worktree 供排查: ${mergeErr.message}`);
          return {
            success: false,
            message: `代码合并发生冲突，请手动检查: ${mergeErr.message}`,
          };
        }

        // 5. 清理 Worktree 目录与分支
        this.cleanupTaskWorktree(repoRoot, taskId, onLog);

        return {
          success: true,
          message: `分支 ${branchName} 已成功合并至主分支，沙箱环境已安全清理`,
        };
      } finally {
        if (hasStashed) {
          try {
            onLog?.(`[合并保护] 正在恢复宿主本地此前暂存的改动 (git stash pop)...`);
            execSync('git stash pop', { cwd: repoRoot, stdio: 'pipe' });
            onLog?.(`[合并保护] ✔ 本地临时改动已安全恢复！`);
          } catch (popErr: any) {
            onLog?.(`[合并保护 告警] 恢复本地暂存改动遇到冲突，已保留在 git stash list 中供随时恢复`);
          }
        }
      }
    } catch (err: any) {
      onLog?.(`[合并与清理 Error] 流程异常: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  /**
   * 在沙箱隔离区内，唤醒 Agent 协调并消解与主分支的代码合并冲突
   */
  public async resolveConflictWithAgent(
    repoRoot: string,
    taskId: string,
    taskTitle: string,
    sessionId: string | undefined,
    onLog?: (msg: string) => void,
    onSessionUpdate?: (state: any) => void,
    options?: { customPrompt?: string }
  ): Promise<{ resolved: boolean; conflictFiles: string[]; summary?: string; error?: string }> {
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const worktreeDir = path.join(repoRoot, '.worktrees', `task-${safeTaskId}`);

    if (!fs.existsSync(worktreeDir)) {
      return { resolved: false, conflictFiles: [], error: `沙箱工作区不存在: ${worktreeDir}` };
    }

    // 1. 获取宿主基线分支名
    let baseBranch = 'main';
    try {
      baseBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim() || 'main';
      if (baseBranch === 'HEAD') {
        baseBranch = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim();
      }
    } catch {}

    // 2. 宿主立即回滚未决合并，确保主开发分支绝对不被污染
    try {
      execSync('git merge --abort', { cwd: repoRoot, stdio: 'ignore' });
    } catch {}

    // 3. 在沙箱工作区中执行 git merge <baseBranch>，将基线分支反向合入以暴露冲突文件
    onLog?.(`[代码冲突自愈] 正在将基线分支「${baseBranch}」合入沙箱以暴露冲突细节...`);
    try {
      execSync(`git merge "${baseBranch}" --no-commit --no-ff`, {
        cwd: worktreeDir,
        stdio: 'pipe',
      });
      // 若无报错直接合并成功，说明并无实质冲突（仅需提交）
      execSync(`git commit -m "chore(conflict): 同步基线分支 ${baseBranch} 最新变更"`, {
        cwd: worktreeDir,
        stdio: 'pipe',
      });
      onLog?.(`[代码冲突自愈] ✔ 基线分支已成功无冲突同步至沙箱`);
      return { resolved: true, conflictFiles: [], summary: `已成功同步基线分支 ${baseBranch} 最新变更` };
    } catch {
      // 产生冲突，继续向下提取冲突文件
    }

    // 4. 提取沙箱中的冲突文件列表
    let conflictFiles: string[] = [];
    try {
      const conflictOut = execSync('git diff --name-only --diff-filter=U', { cwd: worktreeDir, encoding: 'utf-8' });
      conflictFiles = conflictOut
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => Boolean(s) && !s.includes('node_modules') && !s.includes('.worktrees'));
    } catch {}

    if (conflictFiles.length === 0) {
      onLog?.(`[代码冲突自愈] 未检测到具体的冲突代码文件，尝试清理未决状态...`);
      try {
        execSync('git merge --abort', { cwd: worktreeDir, stdio: 'ignore' });
      } catch {}
      return { resolved: false, conflictFiles: [], error: '未检测到具体的代码冲突文件，可能由未提交改动导致' };
    }

    onLog?.(`[代码冲突自愈] 检测到代码冲突文件 (${conflictFiles.length} 个): ${conflictFiles.join(', ')}`);
    onLog?.(`[代码冲突自愈] 正在唤醒沙箱 Agent 会话协调解决冲突...`);

    const conflictTemplate = options?.customPrompt?.trim() || getEffectivePrompt('conflictResolution');
    const conflictPrompt = renderPromptTemplate(conflictTemplate, {
      baseBranch,
      conflictFiles: conflictFiles.map((f) => `- ${f}`).join('\n'),
    });

    const effectiveSessionId = sessionId || `session_${taskId}`;

    // 5. 唤醒/创建沙箱 RPC Agent 会话
    return new Promise((resolve) => {
      let settled = false;
      const finish = (res: { resolved: boolean; conflictFiles: string[]; summary?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        if (!res.resolved) {
          try {
            execSync('git merge --abort', { cwd: worktreeDir, stdio: 'ignore' });
            onLog?.(`[代码冲突自愈] 已安全回滚沙箱未决合并状态，保持工作区纯净`);
          } catch {}
        }
        resolve(res);
      };

      try {
        const session = PiSessionManager.getInstance().createSession({
          taskId,
          taskTitle: `[冲突协调] ${taskTitle}`,
          sessionId: effectiveSessionId,
          cwd: worktreeDir,
          initialPrompt: conflictPrompt,
          onLog: (type, text) => {
            onLog?.(`[Agent 冲突协调] ${text}`);
          },
          onUpdate: onSessionUpdate,
          onFinished: (error) => {
            if (error) {
              onLog?.(`[代码冲突自愈 失败] Agent 执行异常: ${error}`);
              finish({ resolved: false, conflictFiles, error });
              return;
            }

            // 6. 验证沙箱冲突是否彻底消除
            try {
              const remainingOutput = execSync('git diff --name-only --diff-filter=U', { cwd: worktreeDir, encoding: 'utf-8' });
              const remaining = remainingOutput.split('\n').map((s) => s.trim()).filter(Boolean);

              if (remaining.length > 0) {
                const errMsg = `仍有未消解的冲突文件: ${remaining.join(', ')}`;
                onLog?.(`[代码冲突自愈 失败] ${errMsg}`);
                finish({ resolved: false, conflictFiles: remaining, error: errMsg });
                return;
              }

              // 检查文件中是否还残留冲突标记 <<<<<<<
              let hasConflictMarkers = false;
              for (const f of conflictFiles) {
                const fullPath = path.join(worktreeDir, f);
                if (fs.existsSync(fullPath)) {
                  const content = fs.readFileSync(fullPath, 'utf-8');
                  if (content.includes('<<<<<<<') || content.includes('>>>>>>>')) {
                    hasConflictMarkers = true;
                    break;
                  }
                }
              }

              if (hasConflictMarkers) {
                const errMsg = `代码中仍残留 Git 冲突标记 (<<<<<<< 或 >>>>>>>)`;
                onLog?.(`[代码冲突自愈 失败] ${errMsg}`);
                finish({ resolved: false, conflictFiles, error: errMsg });
                return;
              }

              // 7. 提交消解后的代码至沙箱分支
              execSync('git add -A', { cwd: worktreeDir, stdio: 'pipe' });
              execSync(`git commit -m "chore(conflict): 自动消解与基线分支 ${baseBranch} 的合并冲突"`, {
                cwd: worktreeDir,
                stdio: 'pipe',
              });

              let diffStat = '';
              try {
                diffStat = execSync('git show --stat HEAD', { cwd: worktreeDir, encoding: 'utf-8' }).trim();
              } catch {}

              onLog?.(`[代码冲突自愈] ✔ 冲突已成功消解并提交到沙箱特性分支！`);
              finish({
                resolved: true,
                conflictFiles,
                summary: diffStat || `已成功消解 ${conflictFiles.length} 个冲突文件`,
              });
            } catch (checkErr: any) {
              finish({ resolved: false, conflictFiles, error: checkErr.message });
            }
          },
        });
      } catch (spawnErr: any) {
        finish({ resolved: false, conflictFiles, error: spawnErr.message });
      }
    });
  }

  /**
   * 彻底清理指定任务的 Worktree 目录、分支及后台进程
   */
  public cleanupTaskWorktree(
    repoRoot: string,
    taskId: string,
    onLog?: (msg: string) => void
  ) {
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branchName = `feat/task-${safeTaskId}`;
    const worktreeDir = path.join(repoRoot, '.worktrees', `task-${safeTaskId}`);

    // 1. 停止该任务的所有后台进程并注销端口
    TaskProcessManager.getInstance().stopAll(taskId);
    // 会话内启动的开发服务不在任务名册里，按工作区键一并回收，避免 worktree 删了 Metro 还占端口
    TaskProcessManager.getInstance().stopAll(devServerProcessKey(worktreeDir));
    this.unregisterTaskPorts(taskId);

    // 2. 移除 git worktree 关联
    try {
      execSync(`git worktree remove --force "${worktreeDir}"`, { cwd: repoRoot, stdio: 'ignore' });
    } catch {
      if (fs.existsSync(worktreeDir)) {
        try {
          fs.rmSync(worktreeDir, { recursive: true, force: true });
        } catch {}
      }
    }

    try {
      execSync('git worktree prune', { cwd: repoRoot, stdio: 'ignore' });
    } catch {}

    // 3. 删除任务特性分支
    try {
      execSync(`git branch -D "${branchName}"`, { cwd: repoRoot, stdio: 'ignore' });
      onLog?.(`[合并与清理] 已删除临时特性分支: ${branchName}`);
    } catch {}

    // 4. 清理该任务的沙箱专属数据库目录
    this.cleanupTaskSandboxStore(taskId, onLog);
  }

  /**
   * 获取所有沙箱数据底座的统一根目录
   * 严格置于代码仓库外（宿主数据目录/sandboxes），彻底杜绝仓库污染与 Git 冲突
   */
  public getSandboxBaseDir(): string {
    const hostBaseDir = process.env.OPENLOOP_STORE_DIR
      || path.join(os.homedir(), process.env.NODE_ENV === 'development' || !process.env.NODE_ENV ? '.openloop-dev' : '.openloop');
    return path.join(hostBaseDir, 'sandboxes');
  }

  /**
   * 获取指定任务的沙箱数据目录
   */
  public getTaskSandboxStoreDir(taskId: string): string {
    const safeTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.getSandboxBaseDir(), safeTaskId);
  }

  /**
   * 使用 SQLite 官方快照语义克隆数据库（VACUUM INTO）
   * 严禁直接拷贝文件：WAL 模式下单独复制 .db 与 -wal / -shm 会产出页账目不匹配的残库
   */
  private snapshotDatabase(src: string, dst: string): void {
    const db = new Database(src, { readonly: true, fileMustExist: true });
    try {
      db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
  }

  /**
   * 为任务初始化沙箱数据底座（使用 SQLite 快照克隆宿主数据库，数据保真且写隔离）
   */
  public initTaskSandboxStore(taskId: string, onLog?: (msg: string) => void): string {
    const storeDir = this.getTaskSandboxStoreDir(taskId);
    if (!fs.existsSync(storeDir)) {
      try {
        fs.mkdirSync(storeDir, { recursive: true });
      } catch (err: any) {
        logger.warn(`[Worktree:Store] 创建沙箱数据目录失败: ${err.message}`);
      }
    }

    const targetDb = path.join(storeDir, 'openloop.db');
    if (!fs.existsSync(targetDb)) {
      const hostDbCandidate = process.env.OPENLOOP_STORE_DIR
        ? path.join(process.env.OPENLOOP_STORE_DIR, 'openloop.db')
        : path.join(os.homedir(), '.openloop', 'openloop.db');

      if (fs.existsSync(hostDbCandidate)) {
        try {
          this.snapshotDatabase(hostDbCandidate, targetDb);
          const msg = `[沙箱隔离] 已使用 SQLite 快照 (VACUUM INTO) 克隆宿主数据底座至 ${targetDb}`;
          logger.info(`[Worktree:Store] ${msg}`);
          onLog?.(msg);
        } catch (err: any) {
          const warnMsg = `[沙箱隔离] 克隆数据快照提示: ${err.message}`;
          logger.warn(`[Worktree:Store] ${warnMsg}`);
          onLog?.(warnMsg);
        }
      }
    }

    return storeDir;
  }

  /**
   * 自动回收指定任务的沙箱数据目录
   */
  public cleanupTaskSandboxStore(taskId: string, onLog?: (msg: string) => void): void {
    try {
      const storeDir = this.getTaskSandboxStoreDir(taskId);
      if (fs.existsSync(storeDir)) {
        fs.rmSync(storeDir, { recursive: true, force: true });
        const msg = `[沙箱清理] 已自动回收沙箱专属存储目录: ${storeDir}`;
        logger.info(`[Worktree:Store] ${msg}`);
        onLog?.(msg);
      }
    } catch (err: any) {
      logger.warn(`[Worktree:Store] 回收沙箱存储目录异常: ${err.message}`);
    }
  }

  /**
   * 沙箱存储自愈与 LRU 垃圾回收（最多保留 maxKeep 个最近活跃沙箱，防止磁盘无序增长）
   */
  public gcSandboxStores(maxKeep: number = 3): void {
    try {
      const baseDir = this.getSandboxBaseDir();
      if (!fs.existsSync(baseDir)) return;

      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      const dirStats: { name: string; fullPath: string; mtime: number }[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(baseDir, entry.name);
          try {
            const stat = fs.statSync(fullPath);
            dirStats.push({ name: entry.name, fullPath, mtime: stat.mtimeMs });
          } catch {}
        }
      }

      // 按最后修改时间倒序排列（最近的排最前）
      dirStats.sort((a, b) => b.mtime - a.mtime);

      if (dirStats.length > maxKeep) {
        const toRemove = dirStats.slice(maxKeep);
        for (const item of toRemove) {
          try {
            fs.rmSync(item.fullPath, { recursive: true, force: true });
            logger.info(`[Worktree:GC] LRU 回收过期沙箱存储: ${item.name}`);
          } catch {}
        }
      }
    } catch (err: any) {
      logger.warn(`[Worktree:GC] 扫描清理沙箱存储异常: ${err.message}`);
    }
  }
}
