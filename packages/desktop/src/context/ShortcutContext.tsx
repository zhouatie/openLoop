import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ShortcutSuperKey } from '@openloop/core';
import { api } from '../services/api';

const STORAGE_KEY = 'openloop_shortcut_super_key';
const DEFAULT_SUPER_KEY: ShortcutSuperKey = 'Control';

interface ShortcutContextValue {
  superKey: ShortcutSuperKey;
  setSuperKey: (key: ShortcutSuperKey) => Promise<void>;
  superKeyLabel: string;
  superKeySymbol: string;
  formatCombo: (key: string) => string;
}

const ShortcutContext = createContext<ShortcutContextValue>({
  superKey: DEFAULT_SUPER_KEY,
  setSuperKey: async () => {},
  superKeyLabel: 'Ctrl',
  superKeySymbol: 'Ctrl',
  formatCombo: (k) => `Ctrl+${k}`,
});

export const ShortcutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [superKey, setSuperKeyState] = useState<ShortcutSuperKey>(() => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY) as ShortcutSuperKey | null;
      if (cached === 'Control' || cached === 'Meta' || cached === 'Alt') {
        return cached;
      }
    } catch {}
    return DEFAULT_SUPER_KEY;
  });

  // 初始化时尝试与后端持久化设置同步
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const settings = await api.getSettings();
        if (
          isMounted &&
          settings?.shortcutSuperKey &&
          (settings.shortcutSuperKey === 'Control' ||
            settings.shortcutSuperKey === 'Meta' ||
            settings.shortcutSuperKey === 'Alt')
        ) {
          setSuperKeyState(settings.shortcutSuperKey);
          try {
            localStorage.setItem(STORAGE_KEY, settings.shortcutSuperKey);
          } catch {}
          if (import.meta.env?.DEV) {
            console.log('[ShortcutContext] 从服务端加载 Super 键设置:', settings.shortcutSuperKey);
          }
        }
      } catch (err) {
        if (import.meta.env?.DEV) {
          console.warn('[ShortcutContext] 初始拉取设置失败，使用本地缓存:', err);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const setSuperKey = useCallback(async (newKey: ShortcutSuperKey) => {
    setSuperKeyState(newKey);
    try {
      localStorage.setItem(STORAGE_KEY, newKey);
    } catch {}

    if (import.meta.env?.DEV) {
      console.log('[ShortcutContext] 更新 Super 键位为:', newKey);
    }

    try {
      await api.updateSettings({ shortcutSuperKey: newKey });
    } catch (err) {
      console.error('[ShortcutContext] 持久化 Super 键位到服务端失败:', err);
    }
  }, []);

  const superKeyLabel = superKey === 'Meta' ? 'Cmd' : superKey === 'Alt' ? 'Alt' : 'Ctrl';
  const superKeySymbol = superKey === 'Meta' ? '⌘' : superKey === 'Alt' ? '⌥' : 'Ctrl';

  const formatCombo = useCallback(
    (key: string) => {
      if (superKey === 'Meta') {
        return `⌘${key.toUpperCase()}`;
      }
      if (superKey === 'Alt') {
        return `⌥${key.toUpperCase()}`;
      }
      return `Ctrl+${key.toUpperCase()}`;
    },
    [superKey]
  );

  return (
    <ShortcutContext.Provider
      value={{
        superKey,
        setSuperKey,
        superKeyLabel,
        superKeySymbol,
        formatCombo,
      }}
    >
      {children}
    </ShortcutContext.Provider>
  );
};

export const useShortcuts = () => useContext(ShortcutContext);
