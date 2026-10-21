import { OpenLoopServer } from './server';
import { createLogger } from './logger';
import { execSync } from 'child_process';

// 确保进程具备完整的系统开发环境 PATH（解决非终端启动时 git/pnpm 等 command not found）
if (process.platform === 'darwin' && (!process.env.PATH?.includes('/.local/bin') || !process.env.PATH?.includes('/homebrew/'))) {
  try {
    const userShell = process.env.SHELL || '/bin/zsh';
    const output = execSync(`${userShell} -lc "env"`, { encoding: 'utf-8', timeout: 3000 });
    for (const line of output.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1);
        if (key && (key === 'PATH' || !process.env[key])) {
          process.env[key] = val;
        }
      }
    }
  } catch {}
}

const cliLogger = createLogger('ServerCLI');

const port = parseInt(process.env.OPENLOOP_PORT || process.env.PORT || '19888', 10);
const host = process.env.OPENLOOP_HOST || process.env.HOST || '127.0.0.1';
const storeDir = process.env.OPENLOOP_STORE_DIR || undefined;

// 捕获全局未捕获异常，确保排查错误时堆栈完全记录到日志中
process.on('uncaughtException', (err) => {
  cliLogger.error(`[CRITICAL] 未捕获异常 uncaughtException: ${err.message}`, err);
});

process.on('unhandledRejection', (reason) => {
  cliLogger.error(
    `[CRITICAL] 未处理 Promise 异常 unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`,
    reason instanceof Error ? reason : undefined
  );
});

cliLogger.info(
  `正在启动 openLoop Core (Node: ${process.version}, PID: ${process.pid}, Host: ${host}, Port: ${port}, StoreDir: ${storeDir || '~/.openloop'})`
);

const server = new OpenLoopServer({ port, host, storeDir });

server
  .start()
  .then(() => {
    console.log(`\x1b[32m✔\x1b[0m openLoop Core 服务已就绪: http://${host}:${port}`);
    console.log(`WebSocket 实时日志总线: ws://${host}:${port}`);
    cliLogger.info(`openLoop Core 服务就绪，日志管道持续监控中`);
  })
  .catch((err) => {
    cliLogger.error(`openLoop Core 启动失败: ${err.message}`, err);
    console.error(`\x1b[31m✖\x1b[0m openLoop Core 启动失败:`, err);
    process.exit(1);
  });

const shutdown = async (signal: string) => {
  cliLogger.info(`收到 ${signal} 信号，正在优雅关闭服务...`);
  try {
    await server.stop();
    cliLogger.info(`服务已安全关闭`);
  } catch (err: any) {
    cliLogger.error(`关闭服务时发生异常: ${err.message}`, err);
  }
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

