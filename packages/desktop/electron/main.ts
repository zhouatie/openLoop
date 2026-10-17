import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import os from 'os';
import http from 'http';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let coreProcess: ChildProcess | null = null;

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

  try {
    const coreCliPath = path.resolve(__dirname, '../../core/dist/server-cli.js');
    console.log('[Desktop Main] Spawning standalone Core Server process:', coreCliPath);
    coreProcess = spawn('node', [coreCliPath], {
      env: { ...process.env, PORT: '19888' },
      stdio: 'inherit',
    });
    coreProcess.on('error', (err) => {
      console.warn('[Desktop Main] Core Server process notice:', err.message);
    });
  } catch (err: any) {
    console.warn('[Desktop Main] Server start notice:', err.message);
  }
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
      preload: path.join(__dirname, 'preload.js'),
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
    const distHtml = path.join(__dirname, '../dist/index.html');
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (coreProcess) {
      coreProcess.kill();
      coreProcess = null;
    }
    app.quit();
  }
});

app.on('will-quit', () => {
  if (coreProcess) {
    coreProcess.kill();
    coreProcess = null;
  }
});
