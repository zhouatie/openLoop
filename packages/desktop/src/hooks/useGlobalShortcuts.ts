import { useEffect, useRef } from 'react';
import { useShortcuts } from '../context/ShortcutContext';

export interface ShortcutActions {
  onNavigateKanban: () => void;
  onNavigateWorkflows: () => void;
  onNavigateQa?: () => void;
  onNavigateSettings: () => void;
  onOpenCreateTask: () => void;
  onQuickRunWorkflow?: () => void;
  onToggleCommandPalette: () => void;
  onToggleSidebar?: () => void;
  onEscape?: () => void;
}

export const useGlobalShortcuts = (actions: ShortcutActions) => {
  const { superKey } = useShortcuts();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const superKeyRef = useRef(superKey);
  superKeyRef.current = superKey;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeSuper = superKeyRef.current;

      // 验证修饰键是否匹配当前 Super 键设置
      let isSuperPressed = false;
      if (activeSuper === 'Control') {
        isSuperPressed = e.ctrlKey && !e.metaKey && !e.altKey;
      } else if (activeSuper === 'Meta') {
        isSuperPressed = e.metaKey && !e.ctrlKey && !e.altKey;
      } else if (activeSuper === 'Alt') {
        isSuperPressed = e.altKey && !e.ctrlKey && !e.metaKey;
      }

      // 检查当前焦点是否在表单输入控件中
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // 处理 Escape 键
      if (e.key === 'Escape' || e.code === 'Escape') {
        if (actionsRef.current.onEscape) {
          if (import.meta.env?.DEV) {
            console.log('[Shortcut] 触发快捷键: Escape');
          }
          actionsRef.current.onEscape();
        }
        return;
      }

      // 未按下 Super 修饰键时，不拦截任何单键（保证常规打字与交互）
      if (!isSuperPressed) {
        return;
      }

      const key = e.key?.toLowerCase();
      const code = e.code;

      // 1. Super + 1: 导航至任务看板
      if (key === '1' || code === 'Digit1' || code === 'Numpad1') {
        e.preventDefault();
        e.stopPropagation();
        if (import.meta.env?.DEV) {
          console.log('[Shortcut] 触发快捷键: Super + 1 -> 任务看板', { superKey: activeSuper });
        }
        actionsRef.current.onNavigateKanban();
        return;
      }

      // 2. Super + 2: 导航至流程编排
      if (key === '2' || code === 'Digit2' || code === 'Numpad2') {
        e.preventDefault();
        e.stopPropagation();
        if (import.meta.env?.DEV) {
          console.log('[Shortcut] 触发快捷键: Super + 2 -> 流程编排', { superKey: activeSuper });
        }
        actionsRef.current.onNavigateWorkflows();
        return;
      }

      // 3. Super + 3: 导航至 QA 自动化
      if ((key === '3' || code === 'Digit3' || code === 'Numpad3') && actionsRef.current.onNavigateQa) {
        e.preventDefault();
        e.stopPropagation();
        if (import.meta.env?.DEV) {
          console.log('[Shortcut] 触发快捷键: Super + 3 -> QA 自动化', { superKey: activeSuper });
        }
        actionsRef.current.onNavigateQa();
        return;
      }

      // 3. Super + ,: 打开系统设置
      if (key === ',' || code === 'Comma') {
        e.preventDefault();
        e.stopPropagation();
        if (import.meta.env?.DEV) {
          console.log('[Shortcut] 触发快捷键: Super + , -> 系统设置', { superKey: activeSuper });
        }
        actionsRef.current.onNavigateSettings();
        return;
      }

      // 4. Super + N: 新建任务
      if (key === 'n' || code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        if (import.meta.env?.DEV) {
          console.log('[Shortcut] 触发快捷键: Super + N -> 新建任务', { superKey: activeSuper });
        }
        actionsRef.current.onOpenCreateTask();
        return;
      }

      // 5. Super + K: 唤起/切换命令面板
      if (key === 'k' || code === 'KeyK') {
        e.preventDefault();
        e.stopPropagation();
        if (import.meta.env?.DEV) {
          console.log('[Shortcut] 触发快捷键: Super + K -> 命令面板', { superKey: activeSuper });
        }
        actionsRef.current.onToggleCommandPalette();
        return;
      }

      // 6. Super + B: 切换侧边栏展开/收起
      if (key === 'b' || code === 'KeyB') {
        e.preventDefault();
        e.stopPropagation();
        if (import.meta.env?.DEV) {
          console.log('[Shortcut] 触发快捷键: Super + B -> 切换侧边栏', { superKey: activeSuper });
        }
        actionsRef.current.onToggleSidebar?.();
        return;
      }

      // 7. Super + R: 唤起快捷工作流执行弹窗
      if (key === 'r' || code === 'KeyR') {
        e.preventDefault();
        e.stopPropagation();
        if (import.meta.env?.DEV) {
          console.log('[Shortcut] 触发快捷键: Super + R -> 快捷工作流执行', { superKey: activeSuper });
        }
        actionsRef.current.onQuickRunWorkflow?.();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);
};
