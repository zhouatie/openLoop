import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  openDirectory: (options?: { defaultPath?: string }) =>
    ipcRenderer.invoke('dialog:openDirectory', options),
  openPath: (dirPath: string) =>
    ipcRenderer.invoke('shell:openPath', dirPath),
  send: (channel: string, data: any) => ipcRenderer.send(channel, data),
  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});
