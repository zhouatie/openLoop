import { spawn, execSync, ChildProcess } from 'child_process';
import http from 'http';
import net from 'net';
import path from 'path';
import os from 'os';
import { PiWebStatus } from '../types';
import { createLogger } from '../logger';

const logger = createLogger('PiWebManager');

export class PiWebManager {
  private static instance: PiWebManager | null = null;

  private child: ChildProcess | null = null;
  private currentStatus: 'stopped' | 'starting' | 'running' | 'error' = 'stopped';
  private port: number = 30141;
  private lastError?: string;
  private isCleanupRegistered: boolean = false;
  private startPromise: Promise<PiWebStatus> | null = null;

  private constructor() {
    this.initPort();
    this.registerProcessCleanup();
  }

  public static getInstance(): PiWebManager {
    if (!PiWebManager.instance) {
      PiWebManager.instance = new PiWebManager();
    }
    return PiWebManager.instance;
  }

  private initPort() {
    if (process.env.OPENLOOP_PI_WEB_PORT) {
      const parsed = parseInt(process.env.OPENLOOP_PI_WEB_PORT, 10);
      if (!isNaN(parsed) && parsed > 0) {
        this.port = parsed;
        return;
      }
    }
    // 开发沙箱环境默认避开生产端口 30141，使用 30142
    if (process.env.NODE_ENV === 'development' || process.env.VITE_CORE_PORT === '19889') {
      this.port = 30142;
    } else {
      this.port = 30141;
    }
  }

  /**
   * 注册主进程退出钩子，保证 openLoop 关闭时子进程被正确回收
   */
  private registerProcessCleanup() {
    if (this.isCleanupRegistered) return;
    this.isCleanupRegistered = true;

    const cleanup = () => {
      if (this.child) {
        logger.info('openLoop 进程退出，正在清理 Pi Web 子进程...', { pid: this.child.pid });
        try {
          this.child.kill('SIGTERM');
        } catch {}
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  /**
   * 检查端口是否被监听
   */
  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            resolve(true);
          } else {
            resolve(false);
          }
        })
        .once('listening', () => {
          tester.once('close', () => resolve(false)).close();
        })
        .listen(port, '127.0.0.1');
    });
  }

  /**
   * 健康检查：向 Pi Web 发送 HTTP GET 请求
   */
  private async checkHealth(port: number, timeoutMs = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/',
          timeout: timeoutMs,
        },
        (res) => {
          res.resume(); // 消费响应流
          if (res.statusCode && res.statusCode < 500) {
            resolve(true);
          } else {
            resolve(false);
          }
        }
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 检查本地是否已安装 pi-web CLI
   */
  public isInstalled(): boolean {
    try {
      execSync('which pi-web', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前状态
   */
  public async getStatus(): Promise<PiWebStatus> {
    // 若标记为 running，二次健康检查确认是否意外崩溃
    if (this.currentStatus === 'running') {
      const healthy = await this.checkHealth(this.port, 1000);
      if (!healthy) {
        logger.warn('健康检查失败，Pi Web 服务似乎已停止', { port: this.port });
        this.currentStatus = 'stopped';
        this.child = null;
      }
    } else if (this.currentStatus === 'stopped') {
      // 检查当前端口是否已有外部常驻的 pi-web 实例可复用
      const inUse = await this.isPortInUse(this.port);
      if (inUse) {
        const healthy = await this.checkHealth(this.port, 1000);
        if (healthy) {
          logger.info('检测到当前端口已有健康的 Pi Web 运行，自动复用', { port: this.port });
          this.currentStatus = 'running';
        }
      }
    }

    return {
      running: this.currentStatus === 'running',
      status: this.currentStatus,
      port: this.port,
      url: `http://127.0.0.1:${this.port}`,
      pid: this.child?.pid,
      error: this.lastError,
      installed: this.isInstalled(),
    };
  }

  /**
   * 启动 Pi Web 托管进程
   */
  public async start(customPort?: number): Promise<PiWebStatus> {
    if (customPort && customPort > 0) {
      this.port = customPort;
    }

    // 防止并发重复触发启动
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.doStart();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async doStart(): Promise<PiWebStatus> {
    // 1. 如果已在运行且健康，直接返回
    if (this.currentStatus === 'running') {
      const healthy = await this.checkHealth(this.port, 1000);
      if (healthy) {
        logger.info('Pi Web 已经在运行中', { port: this.port, pid: this.child?.pid });
        return this.getStatus();
      }
    }

    // 2. 检查端口是否被已有健康的 Pi Web 占用
    const inUse = await this.isPortInUse(this.port);
    if (inUse) {
      const healthy = await this.checkHealth(this.port, 1500);
      if (healthy) {
        logger.info('端口已被现有 Pi Web 占用且状态健康，直接接入', { port: this.port });
        this.currentStatus = 'running';
        this.lastError = undefined;
        return this.getStatus();
      } else {
        logger.warn('端口已被非健康或未知服务占用，尝试使用备选端口', { port: this.port });
        this.port = this.port + 1;
      }
    }

    this.currentStatus = 'starting';
    this.lastError = undefined;

    // 3. 构建启动命令与参数
    const hasGlobal = this.isInstalled();
    const command = hasGlobal ? 'pi-web' : 'npx';
    const args: string[] = hasGlobal
      ? ['--port', String(this.port), '--hostname', '127.0.0.1', '--no-open']
      : ['@agegr/pi-web@latest', '--port', String(this.port), '--hostname', '127.0.0.1', '--no-open'];

    const nodeBinDir = path.dirname(process.execPath);
    const extraPath = [
      nodeBinDir,
      path.join(os.homedir(), '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ].join(':');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${extraPath}:${process.env.PATH || ''}`,
      PI_WEB_NO_OPEN: '1',
      PI_WEB_APP_NAME: 'openLoop Agent Studio',
      PI_WEB_ALLOWED_HOSTS: '127.0.0.1,localhost',
    };

    logger.info('正在启动 Pi Web 子进程...', {
      command,
      args,
      port: this.port,
    });

    try {
      this.child = spawn(command, args, {
        cwd: os.homedir(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        logger.debug(`[PiWeb:stdout] ${text.trim()}`);
      });

      this.child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        logger.debug(`[PiWeb:stderr] ${text.trim()}`);
      });

      this.child.on('error', (err) => {
        logger.error('Pi Web 进程启动出错:', err);
        this.currentStatus = 'error';
        this.lastError = err.message;
        this.child = null;
      });

      this.child.on('exit', (code, signal) => {
        logger.info(`Pi Web 进程已退出 (code: ${code}, signal: ${signal})`);
        if (this.currentStatus !== 'stopped') {
          this.currentStatus = 'stopped';
        }
        this.child = null;
      });

      // 4. 轮询健康状态（最多等待 30 秒，Next.js 冷启动约需 3-8 秒）
      const maxAttempts = 60;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 500));

        if (!this.child && this.currentStatus !== 'starting') {
          break;
        }

        const healthy = await this.checkHealth(this.port, 1000);
        if (healthy) {
          logger.info(`Pi Web 服务启动成功并已就绪 (第 ${attempt} 次探测成功)`, {
            port: this.port,
            pid: this.child?.pid,
          });
          this.currentStatus = 'running';
          this.lastError = undefined;
          return this.getStatus();
        }
      }

      // 超时判定
      if ((this.currentStatus as string) !== 'running') {
        throw new Error(`Pi Web 服务在 30 秒内未能响应就绪探测 (端口: ${this.port})`);
      }
    } catch (err: any) {
      logger.error('启动 Pi Web 失败:', err);
      this.currentStatus = 'error';
      this.lastError = err.message || String(err);
      if (this.child) {
        try {
          this.child.kill('SIGTERM');
        } catch {}
        this.child = null;
      }
    }

    return this.getStatus();
  }

  /**
   * 停止 Pi Web 托管进程
   */
  public async stop(): Promise<PiWebStatus> {
    logger.info('正在请求停止 Pi Web 服务...', { port: this.port, pid: this.child?.pid });
    this.currentStatus = 'stopped';
    this.lastError = undefined;

    if (this.child) {
      try {
        this.child.kill('SIGTERM');
        // 等待进程退出
        let waited = 0;
        while (this.child && waited < 3000) {
          await new Promise((r) => setTimeout(r, 200));
          waited += 200;
        }
        if (this.child) {
          this.child.kill('SIGKILL');
          this.child = null;
        }
      } catch (err) {
        logger.warn('终止 Pi Web 进程异常:', err);
      }
    }

    // 备用兜底：尝试执行 pi-web stop --port <port>
    try {
      const hasGlobal = this.isInstalled();
      if (hasGlobal) {
        execSync(`pi-web stop --port ${this.port}`, { stdio: 'ignore' });
      }
    } catch {}

    return this.getStatus();
  }

  /**
   * 重启 Pi Web 服务
   */
  public async restart(): Promise<PiWebStatus> {
    await this.stop();
    await new Promise((r) => setTimeout(r, 500));
    return this.start();
  }
}
