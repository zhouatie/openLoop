import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ShortcutSuperKey } from '@openloop/core';
import { api } from '../services/api';
import {
  DEFAULT_SHORTCUT_BINDINGS,
  bindingFromEvent,
  describeBinding,
  matchesBinding,
} from '../constants/agentShortcuts';

const STORAGE_KEY = 'openloop_shortcut_super_key';
const BINDINGS_STORAGE_KEY = 'openloop_shortcut_bindings';
const DEFAULT_SUPER_KEY: ShortcutSuperKey = 'Control';

interface ShortcutContextValue {
  superKey: ShortcutSuperKey;
  setSuperKey: (key: ShortcutSuperKey) => Promise<void>;
  superKeyLabel: string;
  superKeySymbol: string;
  formatCombo: (key: string) => string;
  /** 命令 id -> 绑定字符串 */
  bindings: Record<string, string>;
  setBinding: (id: string, binding: string) => Promise<void>;
  resetBindings: () => Promise<void>;
  /** 键盘事件是否命中该命令 */
  matchShortcut: (event: KeyboardEvent, id: string) => boolean;
  /** 绑定字符串转展示片段 */
  describeShortcut: (id: string) => string[];
  /** 把键盘事件转换为绑定字符串（设置页录制用） */
  captureBinding: (event: KeyboardEvent) => string | null;
}

const readBindings = (): Record<string, string> => {
  const merged = { ...DEFAULT_SHORTCUT_BINDINGS };
  try {
    const cached = localStorage.getItem(BINDINGS_STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Record<string, string>;
      for (const [id, binding] of Object.entries(parsed)) {
        if (typeof binding === 'string' && id in merged) merged[id] = binding;
      }
    }
  } catch {}
  return merged;
};

const ShortcutContext = createContext<ShortcutContextValue>({
  superKey: DEFAULT_SUPER_KEY,
  setSuperKey: async () => {},
  superKeyLabel: 'Ctrl',
  superKeySymbol: 'Ctrl',
  formatCombo: (k) => `Ctrl+${k}`,
  bindings: DEFAULT_SHORTCUT_BINDINGS,
  setBinding: async () => {},
  resetBindings: async () => {},
  matchShortcut: () => false,
  describeShortcut: () => [],
  captureBinding: () => null,
});

export const ShortcutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [bindings, setBindingsState] = useState<Record<string, string>>(readBindings);

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
        const serverBindings = settings?.shortcutBindings as Record<string, string> | undefined;
        if (isMounted && serverBindings && typeof serverBindings === 'object') {
          setBindingsState((prev) => {
            const next = { ...prev };
            for (const [id, binding] of Object.entries(serverBindings)) {
              if (typeof binding === 'string' && id in next) next[id] = binding;
            }
            return next;
          });
        }
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

  const setBinding = useCallback(
    async (id: string, binding: string) => {
      const next = { ...bindings, [id]: binding };
      setBindingsState(next);
      try {
        localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      if (import.meta.env?.DEV) {
        console.log('[ShortcutContext] 更新快捷键绑定:', { id, binding });
      }
      try {
        await api.updateSettings({ shortcutBindings: next } as any);
      } catch (err) {
        console.error('[ShortcutContext] 持久化快捷键绑定失败:', err);
      }
    },
    [bindings]
  );

  const resetBindings = useCallback(async () => {
    const next = { ...DEFAULT_SHORTCUT_BINDINGS };
    setBindingsState(next);
    try {
      localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {}
    if (import.meta.env?.DEV) {
      console.log('[ShortcutContext] 重置全部快捷键绑定');
    }
    try {
      await api.updateSettings({ shortcutBindings: next } as any);
    } catch (err) {
      console.error('[ShortcutContext] 重置快捷键绑定失败:', err);
    }
  }, []);

  const matchShortcut = useCallback(
    (event: KeyboardEvent, id: string) => {
      const binding = bindings[id];
      if (!binding) return false;
      return matchesBinding(event, binding, superKey);
    },
    [bindings, superKey]
  );

  const describeShortcut = useCallback(
    (id: string) => describeBinding(bindings[id] || '', superKey),
    [bindings, superKey]
  );

  const captureBinding = useCallback(
    (event: KeyboardEvent) => bindingFromEvent(event, superKey),
    [superKey]
  );

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
        bindings,
        setBinding,
        resetBindings,
        matchShortcut,
        describeShortcut,
        captureBinding,
      }}
    >
      {children}
    </ShortcutContext.Provider>
  );
};

export const useShortcuts = () => useContext(ShortcutContext);
