import { useEffect, useRef } from 'react';
import { useShortcuts } from '../context/ShortcutContext';
import { SHORTCUT_COMMAND_MAP } from '../constants/agentShortcuts';

export type ShortcutHandlers = Record<string, (() => void) | undefined>;

const isEditableTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  );
};

/**
 * 同时挂载的多个面板共用一张注册表：一次按键只交给优先级最高的面板。
 * 例如全局浮层盖住任务详情页时，详情页的 Agent 不再响应 Super + T。
 */
const surfaceLayers = new Map<number, number>();
let surfaceSeq = 0;

const hasHigherSurface = (priority: number) => {
  for (const level of surfaceLayers.values()) {
    if (level > priority) return true;
  }
  return false;
};

/**
 * 按命令表监听快捷键；只有命令表里声明 allowInInput 的命令会在输入框聚焦时触发。
 * 优先级更高的面板（如上层的智能体浮层）挂载时，优先级低的面板让位。
 */
export function useShortcutBindings(handlers: ShortcutHandlers, enabled = true, priority = 0) {
  const { matchShortcut } = useShortcuts();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const matchRef = useRef(matchShortcut);
  matchRef.current = matchShortcut;

  useEffect(() => {
    if (!enabled) return;
    const token = ++surfaceSeq;
    surfaceLayers.set(token, priority);
    const onKeyDown = (event: KeyboardEvent) => {
      if (hasHigherSurface(priority)) return;
      const editable = isEditableTarget(event.target);
      for (const [id, handler] of Object.entries(handlersRef.current)) {
        if (!handler) continue;
        const command = SHORTCUT_COMMAND_MAP[id];
        if (command?.fixed) continue;
        if (editable && !command?.allowInInput) continue;
        if (!matchRef.current(event, id)) continue;
        // 带修饰键的组合即使被目标元素消费（xterm 等）也要接管；无修饰手势尊重消费
        const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
        if (event.defaultPrevented && !hasModifier) continue;
        event.preventDefault();
        event.stopPropagation();
        if (import.meta.env?.DEV) {
          console.log('[Shortcut] 命中智能体快捷键:', { id, binding: command?.defaultBinding });
        }
        handler();
        return;
      }
    };
    // 捕获阶段注册：xterm 等控件会 stopPropagation，捕获阶段仍能接管带修饰键的组合
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      surfaceLayers.delete(token);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled, priority]);
}
