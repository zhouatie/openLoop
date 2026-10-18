import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import os from 'os';
import http from 'http';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let coreProcess: ChildProcess | null = null;
let embeddedServer: any = null;

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

// 确保 Core 调度服务运行（优先连接已有 19888 实例，避免重复启动及原生 ABI 冲突）
async function ensureCoreServer() {
  const isCoreAlive = await checkUrlAlive('http://127.0.0.1:19888');
  if (isCoreAlive) {
    console.log('[Desktop Main] Core Server already active on 19888, connecting directly.');
    return;
  }

  // 1. 开发环境下，若本地外部环境存在且 core cli 存在，使用系统 node 启动外部独立进程
  if (!app.isPackaged) {
    try {
      const devCoreCli = path.resolve(__dirname, '../../core/dist/server-cli.js');
      if (fs.existsSync(devCoreCli)) {
        console.log('[Desktop Main] Spawning standalone Core Server process (dev mode):', devCoreCli);
        coreProcess = spawn('node', [devCoreCli], {
          env: { ...process.env, PORT: '19888' },
          stdio: 'inherit',
        });
        coreProcess.on('error', (err) => {
          console.warn('[Desktop Main] Core Server process notice:', err.message);
        });
        return;
      }
    } catch (err: any) {
      console.warn('[Desktop Main] Dev core spawn notice:', err.message);
    }
  }

  // 2. 生产打包环境或自包含模式：在主进程启动内嵌的 Core Server 服务
  try {
    console.log('[Desktop Main] Starting embedded OpenLoop Core Server...');
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
      embeddedServer = new OpenLoopServerClass({ port: 19888, host: '127.0.0.1' });
      await embeddedServer.start();
      console.log('[Desktop Main] Embedded OpenLoop Core Server started successfully on port 19888.');
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
        env: { ...process.env, PORT: '19888', ELECTRON_RUN_AS_NODE: '1' },
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

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const isDevRunning = await checkUrlAlive(devServerUrl);

  if (isDevRunning) {
    console.log(`[Desktop Main] Connected to Frontend Dev Server: ${devServerUrl}`);
    mainWindow.loadURL(devServerUrl);
  } else {
    const distHtml = resolveRendererHtmlPath();
    console.log(`[Desktop Main] Loading local bundle: ${distHtml}`);
    mainWindow.loadFile(distHtml);
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
