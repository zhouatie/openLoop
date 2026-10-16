/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    platform: string;
    openDirectory: (options?: { defaultPath?: string }) => Promise<string | null>;
    openPath: (dirPath: string) => Promise<boolean>;
    send: (channel: string, data: any) => void;
    on: (channel: string, callback: (...args: any[]) => void) => () => void;
  };
}
