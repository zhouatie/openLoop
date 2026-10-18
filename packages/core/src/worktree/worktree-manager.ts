import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';
import { spawn, execSync, ChildProcess } from 'child_process';
import { WorktreeContextInfo } from '../types';
import { createLogger } from '../logger';

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
      fs.existsSync(path.join(cur, 'package.json')) ||
      fs.existsSync(path.join(cur, '.git'))
    ) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return process.cwd();
}

/**
 * 通用任务后台进程生命周期管理器
 * 负责统一管理流水线执行过程中启动的任意后台守护进程（如开发服务、靶机进程等）
 * 支持按任务 ID 隔离注册、探活与一键级联销毁
 */
export class TaskProcessManager {
  private static instance: TaskProcessManager;
  private processes: Map<string, Array<{ id: string; proc: ChildProcess; name?: string; port?: number }>> = new Map();

  public static getInstance(): TaskProcessManager {
    if (!TaskProcessManager.instance) {
      TaskProcessManager.instance = new TaskProcessManager();
    }
    return TaskProcessManager.instance;
  }

  public register(taskId: string, proc: ChildProcess, meta?: { name?: string; port?: number }) {
    const list = this.processes.get(taskId) || [];
    list.push({
      id: Math.random().toString(36).substring(2),
      proc,
      name: meta?.name,
      port: meta?.port,
    });
    this.processes.set(taskId, list);
    logger.info(`[TaskProcess] 已注册后台进程 (Task: ${taskId}, PID: ${proc.pid}, Name: ${meta?.name || 'anonymous'})`);
  }

  public stopAll(taskId: string) {
    const list = this.processes.get(taskId);
    if (!list || list.length === 0) return;

    for (const item of list) {
      if (item.proc && item.proc.pid) {
        try {
          if (process.platform !== 'win32') {
            process.kill(-item.proc.pid, 'SIGKILL');
          } else {
            item.proc.kill('SIGKILL');
          }
          logger.info(`[TaskProcess] 已安全终止后台进程 PID: ${item.proc.pid} (${item.name || ''})`);
        } catch {}
      }
      if (item.port) {
        WorktreeManager.getInstance().killPortIfBusy(item.port);
      }
    }
    this.processes.delete(taskId);
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
}

export class WorktreeManager {
  private static instance: WorktreeManager;

  public static getInstance(): WorktreeManager {
    if (!WorktreeManager.instance) {
      WorktreeManager.instance = new WorktreeManager();
    }
    return WorktreeManager.instance;
  }

  /**
   * 动态探测本地空闲端口（双栈 0.0.0.0 与 127.0.0.1 交叉验证，排查通配符冲突）
   */
  public async getAvailablePort(startPort: number): Promise<number> {
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
            resolve(this.getAvailablePort(startPort + 1));
          });
        });
      });
      server.on('error', () => {
        resolve(this.getAvailablePort(startPort + 1));
      });
    });
  }

  /**
   * 强力清理指定端口上的孤儿/僵尸进程
   */
  public killPortIfBusy(port: number) {
    try {
      const out = execSync(`lsof -t -i :${port}`, { encoding: 'utf-8' }).trim();
      if (out) {
        const pids = out.split('\n').map((p) => p.trim()).filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(parseInt(pid, 10), 'SIGKILL');
            logger.info(`[Worktree] 自动清理占用端口 ${port} 的僵尸进程 PID: ${pid}`);
          } catch {}
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
    const baseBranch = options.baseBranch || 'HEAD';

    logger.info(`[Worktree:Create] 准备创建隔离开发工作区: ${worktreeDir} (分支: ${branchName})`);

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

    // 5. 通用动态端口分配
    const portKeys = options.portKeys && options.portKeys.length > 0
      ? options.portKeys
      : ['webPort', 'corePort'];

    const ports: Record<string, number> = {};
    let startScanPort = 5175;
    for (const key of portKeys) {
      const p = await this.getAvailablePort(startScanPort);
      ports[key] = p;
      startScanPort = p + 1;
    }

    const primaryPort = ports.webPort || ports.port || ports.PORT || Object.values(ports)[0] || 5173;
    const targetUrl = `http://localhost:${primaryPort}`;

    logger.info(`[Worktree:Ready] 隔离工作区就绪，分配端口: ${JSON.stringify(ports)}`);

    return {
      worktreeDir,
      branchName,
      baseBranch,
      ports,
      corePort: ports.corePort || 19888,
      webPort: primaryPort,
      targetUrl,
    };
  }

  /**
   * 通用建立宿主与沙箱 worktree 的共享路径软链
   * 自动按相对路径建立软链，彻底解耦具体项目目录层级
   */
  private symlinkSharedPaths(repoRoot: string, worktreeDir: string, relativePaths: string[]) {
    for (const rel of relativePaths) {
      const src = path.join(repoRoot, rel);
      const dest = path.join(worktreeDir, rel);
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.symlinkSync(src, dest, 'dir');
        } catch (err: any) {
          logger.warn(`[Worktree:Symlink] 软链创建告警: ${dest} -> ${err.message}`);
        }
      }
    }
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
   * 获取 Worktree 相比主分支的代码修改与统计（通用 git diff 审计）
   */
  public getWorktreeDiff(worktreeDir: string): { changedFiles: string[]; diffSummary: string } {
    if (!fs.existsSync(worktreeDir)) {
      return { changedFiles: [], diffSummary: '0 files' };
    }
    try {
      const statusOut = execSync('git status --porcelain', { cwd: worktreeDir, encoding: 'utf-8' });
      const changedFiles = statusOut
        .split('\n')
        .filter((l) => Boolean(l.trim()))
        .map((l) => {
          const m = l.match(/^.{2}\s+(.*)$/);
          return m ? m[1].trim() : l.slice(3).trim();
        })
        .filter((file) => {
          // 严格排除软链、依赖目录与系统临时产物
          if (
            file.includes('node_modules') ||
            file.startsWith('.worktrees') ||
            file.startsWith('.openloop') ||
            file.includes('.openloop-store') ||
            file.endsWith('/dist')
          ) {
            return false;
          }
          return true;
        });

      let diffSummary = '';
      try {
        diffSummary = execSync('git diff --stat HEAD -- . ":(exclude)*node_modules*"', { cwd: worktreeDir, encoding: 'utf-8' }).trim();
      } catch {
        diffSummary = `${changedFiles.length} files changed`;
      }

      return { changedFiles, diffSummary };
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

      // 3. 在宿主主分支执行合并
      onLog?.(`[合并与清理] 正在将 ${branchName} 合并至本地宿主当前分支...`);
      try {
        execSync(`git merge "${branchName}" --no-ff -m "Merge branch '${branchName}' (Task: ${taskId})"`, {
          cwd: repoRoot,
          stdio: 'pipe',
        });
        onLog?.(`[合并与清理] ✔ 分支合并成功！`);
      } catch (mergeErr: any) {
        onLog?.(`[合并与清理 告警] 分支合并产生冲突，保留 Worktree 供排查: ${mergeErr.message}`);
        return {
          success: false,
          message: `代码合并发生冲突，请手动检查: ${mergeErr.message}`,
        };
      }

      // 4. 清理 Worktree 目录与分支
      this.cleanupTaskWorktree(repoRoot, taskId, onLog);

      return {
        success: true,
        message: `分支 ${branchName} 已成功合并至主分支，沙箱环境已安全清理`,
      };
    } catch (err: any) {
      onLog?.(`[合并与清理 Error] 流程异常: ${err.message}`);
      return { success: false, message: err.message };
    }
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

    // 1. 停止该任务的所有后台进程
    TaskProcessManager.getInstance().stopAll(taskId);

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
  }
}
