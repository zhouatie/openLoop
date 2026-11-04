import { app, BrowserWindow, ipcMain, dialog, shell, Notification } from 'electron';
import path from 'path';
import os from 'os';
import http from 'http';
import fs from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let coreProcess: ChildProcess | null = null;
let embeddedServer: any = null;

// Core 服务日志落盘：打包应用从 Finder 启动时 fd 指向 /dev/null，必须显式重定向才能事后排查
const CORE_LOG_MAX_BYTES = 5 * 1024 * 1024;
let coreLogFd: number | null = null;

// 用同步 fd 而非 WriteStream：spawn 的 stdio 只接受已打开的文件描述符
function getCoreLogFd(storeDir: string): number {
  if (coreLogFd !== null) return coreLogFd;
  const logPath = path.join(storeDir, 'logs', 'core.log');
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > CORE_LOG_MAX_BYTES) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch {}
  coreLogFd = fs.openSync(logPath, 'a');
  return coreLogFd;
}

// 主进程关键事件同时写入同一日志文件，保证中断现场可追溯
function logMain(message: string): void {
  console.log(`[Desktop Main] ${message}`);
  if (coreLogFd === null) return;
  try {
    fs.writeSync(coreLogFd, `${new Date().toISOString()} [Desktop Main] ${message}\n`);
  } catch {}
}

// 全面同步用户 macOS 登录 Shell 环境变量（彻底解决 GUI 启动时 command not found 问题）
function syncSystemShellEnv() {
  if (process.platform !== 'darwin') return;
  try {
    const userShell = process.env.SHELL || '/bin/zsh';
    const output = execSync(`${userShell} -lc "env"`, { encoding: 'utf-8', timeout: 3000 });
    const lines = output.split('\n');
    for (const line of lines) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1);
        if (key && (key === 'PATH' || !process.env[key])) {
          process.env[key] = val;
        }
      }
    }
    console.log('[Desktop Main] Successfully synchronized shell environment. PATH count:', (process.env.PATH || '').split(':').length);
  } catch (err: any) {
    console.warn('[Desktop Main] Notice: Fallback on shell env sync:', err.message);
  }
}

syncSystemShellEnv();

// Windows 的系统通知按 AppUserModelID 归因，须与 electron-builder 的 appId 对齐
app.setAppUserModelId('com.openloop.desktop');

// 开发态隔离 UserData，避免与稳定生产版 Electron 共享 LocalStorage/IndexedDB/Cookies
if (!app.isPackaged) {
  const devUserData = path.join(app.getPath('appData'), 'openLoop-dev');
  app.setPath('userData', devUserData);
  console.log('[Desktop Main] Dev mode: Isolated userData directory set to:', devUserData);
}

// 探测指定 URL / 端口是否存活
function checkUrlAlive(urlStr: string, defaultPath = '/api/status'): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const reqPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : defaultPath;
      const req = http.get(
        {
          hostname: parsed.hostname || '127.0.0.1',
          port: parsed.port,
          path: reqPath,
        },
        (res) => {
          resolve(res.statusCode !== undefined && res.statusCode < 500);
        }
      );
      req.on('error', () => resolve(false));
      req.setTimeout(800, () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

// pi SDK 跑在核心进程内，要求宿主 Node >= 22.19（require(esm) 与 node:fs 新 API）
const MIN_NODE_VERSION = '22.19.0';

function parseNodeVersion(raw: string | null): number[] | null {
  if (!raw) return null;
  const nums = raw
    .replace(/^v/, '')
    .split('.')
    .slice(0, 3)
    .map((n) => parseInt(n, 10));
  return nums.some(Number.isNaN) ? null : nums;
}

function compareNodeVersion(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface NodeRuntime {
  path: string;
  version: string | null;
  required: string;
  supported: boolean;
}

/** 读取某个 node 可执行文件的真实版本，读不到说明路径不可用 */
function probeNodeVersion(bin: string): string | null {
  try {
    const out = execSync(`"${bin}" -p process.versions.node`, { encoding: 'utf-8', timeout: 1500 }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function isNodeSupported(version: string | null): boolean {
  const parsed = parseNodeVersion(version);
  const floor = parseNodeVersion(MIN_NODE_VERSION);
  if (!parsed || !floor) return false;
  return compareNodeVersion(parsed, floor) >= 0;
}

/** 按优先级列出候选 node：nvm 默认版本优先，其次 nvm 里的其他版本，再退到各包管理器 */
function listNodeCandidates(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];

  const nvmDir = path.join(home, '.nvm/versions/node');
  if (fs.existsSync(nvmDir)) {
    try {
      const aliasFile = path.join(home, '.nvm/alias/default');
      const targetPrefix = fs.existsSync(aliasFile) ? fs.readFileSync(aliasFile, 'utf-8').trim() : '';
      const versions = fs
        .readdirSync(nvmDir)
        .filter((v) => v.startsWith('v'))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      const preferred = targetPrefix
        ? versions.filter((v) => v.startsWith(`v${targetPrefix}`) || v === targetPrefix)
        : [];
      for (const v of [...preferred, ...versions.filter((v) => !preferred.includes(v))]) {
        candidates.push(path.join(nvmDir, v, 'bin/node'));
      }
    } catch {}
  }

  candidates.push('/opt/homebrew/bin/node');
  candidates.push(path.join(home, '.local/share/fnm/current/bin/node'));
  candidates.push(path.join(home, '.volta/bin/node'));
  candidates.push('/usr/local/bin/node');
  candidates.push('/usr/bin/node');
  candidates.push('node');
  return candidates;
}

let cachedNodeRuntime: NodeRuntime | null = null;

/**
 * 选出真正能承载 pi SDK 的宿主 Node。
 * 只判断文件存在是不够的：低版本 Node 能启动核心服务，但会话一建立就失败，
 * 所以这里逐个探测真实版本，优先返回满足下限的第一个，都不满足时回落首个可用版本并标记 supported=false。
 */
function resolveNodeRuntime(force = false): NodeRuntime {
  if (cachedNodeRuntime && !force) return cachedNodeRuntime;
  let fallback: NodeRuntime | null = null;
  for (const bin of listNodeCandidates()) {
    const version = probeNodeVersion(bin);
    if (!version) continue;
    const supported = isNodeSupported(version);
    const runtime: NodeRuntime = { path: bin, version, required: MIN_NODE_VERSION, supported };
    if (supported) {
      cachedNodeRuntime = runtime;
      return runtime;
    }
    if (!fallback) fallback = runtime;
  }
  cachedNodeRuntime = fallback || { path: 'node', version: null, required: MIN_NODE_VERSION, supported: false };
  return cachedNodeRuntime;
}

// 智能探测 Core CLI 入口路径（必须是真实的操作系统文件，严禁指向 .asar 虚拟归档）
function resolveCoreCliPath(): string | null {
  const home = os.homedir();
  const candidates = [
    process.env.OPENLOOP_CORE_CLI,
    process.env.OPENLOOP_PROJECT_ROOT
      ? path.join(process.env.OPENLOOP_PROJECT_ROOT, 'packages/core/dist/server-cli.js')
      : null,
    // 解压目录资源（物理目录）
    path.join(process.resourcesPath, 'app.asar.unpacked/packages/core/dist/server-cli.js'),
    path.join(process.resourcesPath, 'core/dist/server-cli.js'),
    // 本地工程生产构建产物
    path.join(home, 'My/openLoop/packages/core/dist/server-cli.js'),
    // 开发态未打包源码路径
    !app.isPackaged ? path.resolve(__dirname, '../../core/dist/server-cli.js') : null,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (!c.includes('.asar') && fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

// Core 异常退出自动拉起（原生崩溃无法被 JS 捕获，只能由父进程兜底）
const CORE_RESTART_WINDOW_MS = 10 * 60 * 1000;
const CORE_RESTART_LIMIT = 3;
let coreRestartTimestamps: number[] = [];

function watchCoreExit(child: ChildProcess): void {
  child.on('exit', (code, signal) => {
    logMain(`Core Server exited (${signal ? `signal=${signal}` : `code=${code}`})`);

    // 主动停止或被新实例替换时不再拉起
    if (coreProcess !== child) return;
    coreProcess = null;

    const now = Date.now();
    coreRestartTimestamps = coreRestartTimestamps.filter((t) => now - t < CORE_RESTART_WINDOW_MS);
    if (coreRestartTimestamps.length >= CORE_RESTART_LIMIT) {
      logMain('Core Server 10 分钟内连续退出 3 次，停止自动重启');
      return;
    }

    coreRestartTimestamps.push(now);
    logMain('Core Server 异常退出，1 秒后自动重启');
    setTimeout(() => {
      ensureCoreServer().catch((err) => logMain(`Core Server 自动重启失败: ${err.message}`));
    }, 1000);
  });
}

// 解析 Core 数据目录（打包版锁定 ~/.openloop，开发版使用隔离目录）
function resolveCoreStoreDir(): string {
  return app.isPackaged
    ? path.join(os.homedir(), '.openloop')
    : (process.env.OPENLOOP_STORE_DIR || path.join(os.homedir(), '.openloop-dev'));
}

// 确保 Core 调度服务运行（环境隔离：打包版锁定 19888，开发版使用 19889）
async function ensureCoreServer() {
  const targetPort = app.isPackaged ? '19888' : (process.env.OPENLOOP_PORT || '19889');
  const targetStoreDir = resolveCoreStoreDir();

  const isCoreAlive = await checkUrlAlive(`http://127.0.0.1:${targetPort}`);
  if (isCoreAlive) {
    console.log(`[Desktop Main] Core Server already active on ${targetPort}, connecting directly.`);
    return;
  }

  // 1. 优先使用宿主系统的原生 Node 独立进程启动 Core CLI（消除原生 ABI 冲突并具备完整依赖）
  const nodeRuntime = resolveNodeRuntime();
  const nodeBinary = nodeRuntime.path;
  if (!nodeRuntime.supported) {
    console.warn(
      `[Desktop Main] 宿主 Node 版本不满足要求: ${nodeRuntime.version || '未知'} (${nodeRuntime.path}, 需要 >= ${nodeRuntime.required})，任务会话将无法建立`
    );
  }
  const coreCli = resolveCoreCliPath();

  if (coreCli) {
    console.log(
      `[Desktop Main] Spawning Core Server via Node (${nodeBinary}): ${coreCli} (Port: ${targetPort}, Store: ${targetStoreDir})`
    );

    const nodeBinDir = path.dirname(nodeBinary);
    const customPath = `${nodeBinDir}:${process.env.PATH || ''}`;
    // 设置合理的 cwd 确保 Node 能顺畅向上解析 monorepo node_modules
    const coreCwd = path.dirname(path.dirname(coreCli));

    const coreLogFd = getCoreLogFd(targetStoreDir);
    coreProcess = spawn(nodeBinary, [coreCli], {
      cwd: coreCwd,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PATH: customPath,
        PORT: targetPort,
        OPENLOOP_PORT: targetPort,
        OPENLOOP_STORE_DIR: targetStoreDir,
      },
      stdio: ['ignore', coreLogFd, coreLogFd],
    });

    coreProcess.on('error', (err) => {
      console.warn('[Desktop Main] Core Server process notice:', err.message);
    });
    watchCoreExit(coreProcess);

    // 轮询等待服务就绪（最多 3 秒），确保窗口打开时接口已准备好
    for (let i = 0; i < 30; i++) {
      if (await checkUrlAlive(`http://127.0.0.1:${targetPort}`)) {
        console.log(`[Desktop Main] Core Server successfully ready on port ${targetPort}.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return;
  }

  // 2. 备用方式：尝试在主进程启动内嵌的 Core Server 服务
  try {
    console.log(`[Desktop Main] Starting embedded OpenLoop Core Server (Port: ${targetPort}, Store: ${targetStoreDir})...`);
    let OpenLoopServerClass: any = null;
    const moduleCandidates = [
      path.resolve(__dirname, '../../core/dist/server/index.js'),
      path.join(app.getAppPath(), 'packages/core/dist/server/index.js'),
    ];
    for (const modPath of moduleCandidates) {
      if (fs.existsSync(modPath)) {
        OpenLoopServerClass = require(modPath).OpenLoopServer;
        break;
      }
    }
    if (!OpenLoopServerClass) {
      try {
        OpenLoopServerClass = require('@openloop/core').OpenLoopServer;
      } catch {}
    }

    if (OpenLoopServerClass) {
      embeddedServer = new OpenLoopServerClass({
        port: parseInt(targetPort, 10),
        host: '127.0.0.1',
        storeDir: targetStoreDir,
      });
      await embeddedServer.start();
      console.log(`[Desktop Main] Embedded OpenLoop Core Server started successfully on port ${targetPort}.`);
      return;
    }
  } catch (err: any) {
    console.warn('[Desktop Main] Failed to start embedded Core Server, trying process fallback:', err.message);
  }

  // 3. 回退子进程方式：使用 Electron 自身作为 Node.js 运行时启动 server-cli.js
  try {
    const cliCandidates = [
      path.resolve(__dirname, '../../core/dist/server-cli.js'),
      path.join(app.getAppPath(), 'packages/core/dist/server-cli.js'),
    ];
    const targetCli = cliCandidates.find((p) => fs.existsSync(p));
    if (targetCli) {
      console.log('[Desktop Main] Spawning Core Server via Electron runtime:', targetCli);
      const coreLogFd = getCoreLogFd(targetStoreDir);
      coreProcess = spawn(process.execPath, [targetCli], {
        env: {
          ...process.env,
          PORT: targetPort,
          OPENLOOP_PORT: targetPort,
          OPENLOOP_STORE_DIR: targetStoreDir,
          ELECTRON_RUN_AS_NODE: '1',
        },
        stdio: ['ignore', coreLogFd, coreLogFd],
      });
      coreProcess.on('error', (err) => {
        console.warn('[Desktop Main] Core process fallback error:', err.message);
      });
      watchCoreExit(coreProcess);
    }
  } catch (err: any) {
    console.error('[Desktop Main] All Core Server launch strategies failed:', err.message);
  }
}

// 优雅清理释放后台核心服务
async function cleanupServer() {
  if (coreProcess) {
    try {
      const pid = coreProcess.pid;
      if (pid) {
        if (process.platform === 'win32') {
          try {
            execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
          } catch {}
        } else {
          try {
            // 向独立进程组发送终止信号，清理全部子孙进程
            process.kill(-pid, 'SIGTERM');
          } catch {
            coreProcess.kill('SIGTERM');
          }
        }
      }
    } catch {}
    coreProcess = null;
  }
  if (embeddedServer) {
    try {
      await embeddedServer.stop();
    } catch {}
    embeddedServer = null;
  }
}

// 一键重启后台核心调度引擎（安全清理残留、平滑拉起新实例）
async function restartCoreServer(): Promise<{ success: boolean; port: string; message?: string }> {
  const targetPort = app.isPackaged ? '19888' : (process.env.OPENLOOP_PORT || '19889');
  logMain(`Restarting Core Server on port ${targetPort}...`);

  // 1. 先优雅停止当前托管的子进程与嵌入式服务
  await cleanupServer();

  // 2. 检查端口是否有残留孤儿进程（非主进程本身），如果有则定向释放
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${targetPort}`, { encoding: 'utf-8' });
      for (const line of out.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      }
    } else {
      const pids = execSync(`lsof -t -i :${targetPort}`, { encoding: 'utf-8' }).trim().split('\n');
      for (const pidStr of pids) {
        const p = parseInt(pidStr, 10);
        if (p && p !== process.pid) {
          try {
            process.kill(p, 'SIGTERM');
          } catch {}
        }
      }
    }
  } catch {}

  // 3. 等待端口释放（最多 500ms）
  for (let i = 0; i < 5; i++) {
    const alive = await checkUrlAlive(`http://127.0.0.1:${targetPort}/api/status`);
    if (!alive) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // 4. 重新拉起
  await ensureCoreServer();

  // 5. 探活验证
  const aliveAfter = await checkUrlAlive(`http://127.0.0.1:${targetPort}/api/status`);
  return {
    success: aliveAfter,
    port: targetPort,
    message: aliveAfter ? '核心调度引擎已成功重启' : '核心调度引擎启动中，正在等待就绪',
  };
}

function resolveRendererHtmlPath(): string {
  const candidates = [
    path.join(__dirname, '../dist/index.html'),
    path.join(__dirname, '../../packages/desktop/dist/index.html'),
    path.join(app.getAppPath(), 'packages/desktop/dist/index.html'),
    path.join(app.getAppPath(), 'dist/index.html'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(__dirname, '../dist/index.html');
}

function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.js'),
    path.join(app.getAppPath(), 'packages/desktop/dist-electron/preload.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(__dirname, 'preload.js');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f4f4f6',
    titleBarStyle: 'hiddenInset',
    // 红黄绿按钮与侧边栏顶部 Logo 行垂直居中对齐
    trafficLightPosition: { x: 12, y: 17 },
    webPreferences: {
      preload: resolvePreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 拦截应用内所有新窗口打开请求，统一调用 macOS 系统默认外部浏览器（Chrome/Safari）打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 生产打包环境：永久只加载内置静态打包产物，绝不被本地 Vite 5173 串门劫持
  if (app.isPackaged) {
    const distHtml = resolveRendererHtmlPath();
    console.log(`[Desktop Main] Production packaged app: Loading local bundle ${distHtml}`);
    mainWindow.loadFile(distHtml);
  } else {
    // 仅在未打包的本地开发模式下探测 Vite 开发服务器
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    const isDevRunning = await checkUrlAlive(devServerUrl);

    if (isDevRunning) {
      console.log(`[Desktop Main] Connected to Frontend Dev Server: ${devServerUrl}`);
      mainWindow.loadURL(devServerUrl);
      mainWindow.setTitle('openLoop [DEV Sandbox : 19889]');
    } else {
      const distHtml = resolveRendererHtmlPath();
      console.log(`[Desktop Main] Dev fallback: Loading local bundle ${distHtml}`);
      mainWindow.loadFile(distHtml);
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 注册系统级 IPC：原生文件管理器（访达/资源管理器）目录选择
ipcMain.handle('dialog:openDirectory', async (_event, options?: { defaultPath?: string }) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择工程工作区目录',
    defaultPath: options?.defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// 注册系统级 IPC：在访达/资源管理器中查看定位目录
ipcMain.handle('shell:openPath', async (_event, dirPath: string) => {
  if (!dirPath) return false;
  let targetPath = dirPath.trim();
  if (targetPath === '~') {
    targetPath = os.homedir();
  } else if (targetPath.startsWith('~/') || targetPath.startsWith('~\\')) {
    targetPath = path.join(os.homedir(), targetPath.slice(2));
  }
  await shell.openPath(targetPath);
  return true;
});

// 注册系统级 IPC：在系统默认外部浏览器中打开链接
ipcMain.handle('shell:openExternal', async (_event, targetUrl: string) => {
  if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
    await shell.openExternal(targetUrl);
    return true;
  }
  return false;
});

// 注册系统级 IPC：一键打开 macOS 权限偏好设置
ipcMain.handle('system:openPrivacySetting', async (_event, type = 'all-files') => {
  try {
    if (process.platform === 'darwin') {
      const pane = type === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_AllFiles';
      await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
      return true;
    }
  } catch (err: any) {
    console.warn('[Desktop Main] Failed to open privacy settings:', err.message);
  }
  return false;
});

// 注册系统级 IPC：环境与权限自诊断
ipcMain.handle('system:checkSystemStatus', async () => {
  // 仅列出硬性依赖：Node.js 驱动服务与构建，Git 驱动 Worktree 隔离
  const tools = [
    { name: 'Node.js', command: 'node' },
    { name: 'Git', command: 'git' },
  ];

  const toolStatuses = tools.map((t) => {
    try {
      const whichOut = execSync(`which ${t.command}`, { encoding: 'utf-8', timeout: 1000 }).trim();
      return { ...t, available: !!whichOut && fs.existsSync(whichOut), path: whichOut };
    } catch {
      return { ...t, available: false };
    }
  });

  let hasFullDiskAccess = false;
  try {
    // 探测受 kTCCServiceSystemPolicyAllFiles 严格保护的系统目录
    // 只有在系统设置中授予了「完全磁盘访问权限」的进程才能成功列出目录
    const probeDirs = [
      path.join(os.homedir(), 'Library/Safari'),
      path.join(os.homedir(), 'Library/Suggestions'),
    ];
    for (const dir of probeDirs) {
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir);
        hasFullDiskAccess = true;
        break;
      }
    }
  } catch {
    hasFullDiskAccess = false;
  }

  return {
    platform: process.platform,
    nodeVersion: process.version,
    // 真正驱动核心服务的宿主 Node（可能与 Electron 自带版本不同），依赖审核界面以此为准
    // 依赖审核界面点刷新时重新探测，避免缓存挡住刚升级的 Node
    nodeRuntime: resolveNodeRuntime(true),
    hasFullDiskAccess,
    tools: toolStatuses,
  };
});

// 待点击的桌面通知：主进程必须持有引用，否则对象被回收后点击事件不会再回到应用
const pendingNotifications = new Set<Notification>();

/**
 * 通知点击后把主窗口提到最前。
 * macOS 只调窗口 focus 不足以越过其他前台应用，必须用 app.focus({ steal: true })；
 * 不用 app.dock.show()——应用常驻 Dock，该调用只会让 Dock 重排并卡在异常磁贴状态。
 */
async function activateMainWindow(sessionId?: string): Promise<void> {
  if (!mainWindow) await createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  if (process.platform === 'darwin') app.focus({ steal: true });
  mainWindow.focus();
  if (!sessionId) return;
  // 窗口刚创建时渲染进程仍在加载，等首帧就绪再派发，避免会话标识丢失
  const contents = mainWindow.webContents;
  const send = () => contents.send('notification:activate', { sessionId });
  if (contents.isLoading()) contents.once('did-finish-load', send);
  else send();
}

// 注册系统级 IPC：桌面通知（任务待验收 / 执行失败、Agent 一轮回复结束等需要人工介入的时机）
ipcMain.handle('notification:show', (_event, payload: { title: string; body: string; sessionId?: string }) => {
  if (!payload?.title || !Notification.isSupported()) return false;
  if (!app.isPackaged) {
    console.log('[Desktop Main] Showing desktop notification:', payload);
  }
  const notification = new Notification({ title: payload.title, body: payload.body });
  pendingNotifications.add(notification);
  // 点击通知唤起主窗口直达待处理现场；点击或关闭后立即释放引用，历史条目不留常驻内存
  const release = () => {
    pendingNotifications.delete(notification);
    notification.removeAllListeners();
  };
  notification.once('click', () => {
    if (!app.isPackaged) console.log('[Desktop Main] Notification clicked:', payload);
    release();
    void activateMainWindow(payload.sessionId);
  });
  notification.once('close', release);
  notification.show();
  return true;
});

// 注册系统级 IPC：一键重启核心调度引擎
ipcMain.handle('system:restartCoreServer', async () => {
  if (!app.isPackaged) {
    console.log('[Desktop Main] IPC: system:restartCoreServer received');
  }
  return await restartCoreServer();
});

// 注册系统级 IPC：获取核心调度引擎状态
ipcMain.handle('system:getCoreServerStatus', async () => {
  const targetPort = app.isPackaged ? '19888' : (process.env.OPENLOOP_PORT || '19889');
  const alive = await checkUrlAlive(`http://127.0.0.1:${targetPort}/api/status`);
  return {
    alive,
    port: targetPort,
    pid: coreProcess?.pid,
  };
});

app.whenReady().then(async () => {
  await ensureCoreServer();
  await createWindow();

  app.on('activate', async () => {
    // macOS 特性：点击 Dock 唤醒时，若后台核心调度引擎未存活，自动触发自愈拉起
    try {
      const targetPort = app.isPackaged ? '19888' : (process.env.OPENLOOP_PORT || '19889');
      const alive = await checkUrlAlive(`http://127.0.0.1:${targetPort}/api/status`);
      if (!alive) {
        console.log('[Desktop Main] Core Server inactive on macOS activate, auto-healing...');
        await ensureCoreServer();
      }
    } catch (err: any) {
      console.warn('[Desktop Main] Auto-heal Core Server notice:', err.message);
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    await cleanupServer();
    app.quit();
  }
});

app.on('before-quit', async () => {
  await cleanupServer();
});

app.on('will-quit', async () => {
  await cleanupServer();
});
