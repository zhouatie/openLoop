import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import os from 'os';
import http from 'http';
import fs from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let coreProcess: ChildProcess | null = null;
let embeddedServer: any = null;

// 开发态隔离 UserData，避免与稳定生产版 Electron 共享 LocalStorage/IndexedDB/Cookies
if (!app.isPackaged) {
  const devUserData = path.join(app.getPath('appData'), 'openLoop-dev');
  app.setPath('userData', devUserData);
  console.log('[Desktop Main] Dev mode: Isolated userData directory set to:', devUserData);
}

// 探测指定 URL / 端口是否存活
function checkUrlAlive(urlStr: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const req = http.get(
        {
          hostname: parsed.hostname || '127.0.0.1',
          port: parsed.port,
          path: '/',
        },
        (res) => {
          resolve(res.statusCode !== undefined);
        }
      );
      req.on('error', () => resolve(false));
      req.setTimeout(600, () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

// 极速定位宿主 Node.js 运行时，彻底规避原生 C++ 模块 (better-sqlite3) 与 Electron ABI 冲突
function findSystemNode(): string {
  try {
    const whichNode = execSync('which node', { encoding: 'utf-8' }).trim();
    if (whichNode && fs.existsSync(whichNode)) return whichNode;
  } catch {}

  const home = os.homedir();
  const nvmDir = path.join(home, '.nvm/versions/node');
  if (fs.existsSync(nvmDir)) {
    try {
      const versions = fs.readdirSync(nvmDir).sort().reverse();
      for (const v of versions) {
        const fullNode = path.join(nvmDir, v, 'bin/node');
        if (fs.existsSync(fullNode)) return fullNode;
      }
    } catch {}
  }

  const staticCandidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    path.join(home, '.local/share/fnm/current/bin/node'),
    path.join(home, '.volta/bin/node'),
    '/usr/bin/node',
  ];
  for (const c of staticCandidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'node';
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

// 确保 Core 调度服务运行（环境隔离：打包版锁定 19888，开发版使用 19889）
async function ensureCoreServer() {
  const targetPort = app.isPackaged ? '19888' : (process.env.OPENLOOP_PORT || '19889');
  const targetStoreDir = app.isPackaged
    ? path.join(os.homedir(), '.openloop')
    : (process.env.OPENLOOP_STORE_DIR || path.join(os.homedir(), '.openloop-dev'));

  const isCoreAlive = await checkUrlAlive(`http://127.0.0.1:${targetPort}`);
  if (isCoreAlive) {
    console.log(`[Desktop Main] Core Server already active on ${targetPort}, connecting directly.`);
    return;
  }

  // 1. 优先使用宿主系统的原生 Node 独立进程启动 Core CLI（消除原生 ABI 冲突并具备完整依赖）
  const nodeBinary = findSystemNode();
  const coreCli = resolveCoreCliPath();

  if (coreCli) {
    console.log(
      `[Desktop Main] Spawning Core Server via Node (${nodeBinary}): ${coreCli} (Port: ${targetPort}, Store: ${targetStoreDir})`
    );

    const nodeBinDir = path.dirname(nodeBinary);
    const customPath = `${nodeBinDir}:${process.env.PATH || ''}`;
    // 设置合理的 cwd 确保 Node 能顺畅向上解析 monorepo node_modules
    const coreCwd = path.dirname(path.dirname(coreCli));

    coreProcess = spawn(nodeBinary, [coreCli], {
      cwd: coreCwd,
      env: {
        ...process.env,
        PATH: customPath,
        PORT: targetPort,
        OPENLOOP_PORT: targetPort,
        OPENLOOP_STORE_DIR: targetStoreDir,
      },
      stdio: 'inherit',
    });

    coreProcess.on('error', (err) => {
      console.warn('[Desktop Main] Core Server process notice:', err.message);
    });

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
      coreProcess = spawn(process.execPath, [targetCli], {
        env: {
          ...process.env,
          PORT: targetPort,
          OPENLOOP_PORT: targetPort,
          OPENLOOP_STORE_DIR: targetStoreDir,
          ELECTRON_RUN_AS_NODE: '1',
        },
        stdio: 'inherit',
      });
      coreProcess.on('error', (err) => {
        console.warn('[Desktop Main] Core process fallback error:', err.message);
      });
    }
  } catch (err: any) {
    console.error('[Desktop Main] All Core Server launch strategies failed:', err.message);
  }
}

// 优雅清理释放后台核心服务
async function cleanupServer() {
  if (coreProcess) {
    try {
      coreProcess.kill();
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
    backgroundColor: '#0b0f17',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: resolvePreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
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

app.whenReady().then(async () => {
  await ensureCoreServer();
  await createWindow();

  app.on('activate', () => {
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

app.on('will-quit', async () => {
  await cleanupServer();
});
