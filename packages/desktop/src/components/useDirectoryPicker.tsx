import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DirectoryBrowserModal } from './DirectoryBrowserModal';

interface PendingPick {
  defaultPath?: string;
  resolve: (value: string | null) => void;
}

/**
 * 目录选择入口：有 Electron 原生桥接时直接用系统面板，否则退回应用内目录面板
 * （浏览器调试、远程访问都走这条路，与 DSH 的自适应选择一致）。
 * 返回的 `dialog` 挂在调用方任意位置即可，弹层走 body portal。
 */
export function useDirectoryPicker(): {
  pick: (defaultPath?: string) => Promise<string | null>;
  dialog: React.ReactNode;
} {
  const [pending, setPending] = useState<{ defaultPath?: string } | null>(null);
  const pendingRef = useRef<PendingPick | null>(null);

  const settle = useCallback((value: string | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value);
  }, []);

  // 调用方先卸载（弹层被带着关掉）时把等待中的 Promise 收尾，不留悬空调用
  useEffect(
    () => () => {
      pendingRef.current?.resolve(null);
      pendingRef.current = null;
    },
    []
  );

  const pick = useCallback(
    async (defaultPath?: string): Promise<string | null> => {
      const native = window.electronAPI?.openDirectory;
      if (native) {
        try {
          const chosen = await native({ defaultPath });
          if (import.meta.env?.DEV) console.log('[DirectoryPicker] 系统原生面板返回:', chosen);
          return chosen || null;
        } catch (err) {
          if (import.meta.env?.DEV) console.warn('[DirectoryPicker] 系统原生面板调用失败，改用应用内面板:', err);
        }
      }
      if (import.meta.env?.DEV) {
        console.log('[DirectoryPicker] 打开应用内目录面板:', { defaultPath });
      }
      // 一次只允许一个面板：重复调用先收掉上一个
      pendingRef.current?.resolve(null);
      return new Promise<string | null>((resolve) => {
        pendingRef.current = { defaultPath, resolve };
        setPending({ defaultPath });
      });
    },
    []
  );

  const dialog = pending ? (
    <DirectoryBrowserModal
      defaultPath={pending.defaultPath}
      onPick={(path) => {
        if (import.meta.env?.DEV) console.log('[DirectoryPicker] 应用内面板选定目录:', path);
        settle(path);
      }}
      onClose={() => settle(null)}
    />
  ) : null;

  return { pick, dialog };
}
