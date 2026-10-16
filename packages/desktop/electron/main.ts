import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
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
