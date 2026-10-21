/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    platform: string;
    openDirectory: (options?: { defaultPath?: string }) => Promise<string | null>;
    openPath: (dirPath: string) => Promise<boolean>;
    openPrivacySetting?: (type?: 'all-files' | 'accessibility') => Promise<boolean>;
    checkSystemStatus?: () => Promise<{
      platform: string;
      nodeVersion: string;
      hasFullDiskAccess: boolean;
      tools: { name: string; command: string; available: boolean; path?: string }[];
    }>;
    send: (channel: string, data: any) => void;
    on: (channel: string, callback: (...args: any[]) => void) => () => void;
  };
}
