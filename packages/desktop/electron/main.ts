import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import os from 'os';
import { OpenLoopServer } from '@openloop/core';

let mainWindow: BrowserWindow | null = null;
let server: OpenLoopServer | null = null;

async function startServer() {
  try {
    server = new OpenLoopServer({ port: 19888, host: '127.0.0.1' });
    await server.start();
    console.log('[Desktop Main] Embedded Core Server started on 19888');
  } catch (err: any) {
    console.log('[Desktop Main] Server start note:', err.message);
  }
}

function createWindow() {
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

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
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
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    if (server) await server.stop();
    app.quit();
  }
});

app.on('will-quit', async () => {
  if (server) await server.stop();
});
