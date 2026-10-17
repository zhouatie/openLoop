import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  id?: string;
  type?: ToastType;
  title: React.ReactNode;
  description?: React.ReactNode;
  duration?: number; // 毫秒，0 或负数表示不自动关闭，默认 3600ms
  action?: ToastAction;
}

interface InternalToastItem extends ToastOptions {
  id: string;
  type: ToastType;
  isLeaving?: boolean;
}

interface ToastContextType {
  toast: (options: ToastOptions) => string;
  success: (title: React.ReactNode, options?: Omit<ToastOptions, 'type' | 'title'>) => string;
  error: (title: React.ReactNode, options?: Omit<ToastOptions, 'type' | 'title'>) => string;
  warning: (title: React.ReactNode, options?: Omit<ToastOptions, 'type' | 'title'>) => string;
  info: (title: React.ReactNode, options?: Omit<ToastOptions, 'type' | 'title'>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

// 全局单例派发器，支持非组件内或不便使用 hook 的位置直接 import { toast } from '...'
type ToastListener = (toasts: (prev: InternalToastItem[]) => InternalToastItem[]) => void;
let globalListener: ToastListener | null = null;

function generateId(): string {
  return `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function dispatchToast(options: ToastOptions): string {
  const id = options.id || generateId();
  const type = options.type || 'info';

  if (import.meta.env?.DEV) {
    const textTitle = typeof options.title === 'string' ? options.title : '[ReactNode]';
    console.log(`[Toast] [${type}] ${textTitle}`, options.description || '');
  }

  if (globalListener) {
    globalListener((prev) => {
      // 避免重复叠加同 ID toast
      const filtered = prev.filter((t) => t.id !== id);
      return [...filtered, { ...options, id, type }];
    });
  }
  return id;
}

function dismissToast(id: string) {
  if (globalListener) {
    globalListener((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isLeaving: true } : t))
    );
    // 延迟 200ms 后真正移除节点（对应离开动画时长）
    setTimeout(() => {
      if (globalListener) {
        globalListener((prev) => prev.filter((t) => t.id !== id));
      }
    }, 200);
  }
}

function clearAllToasts() {
  if (globalListener) {
    globalListener(() => []);
  }
}

/**
 * 全局开箱即用的 toast API 对象
 */
export const toast = {
  show: (options: ToastOptions) => dispatchToast(options),
  success: (title: React.ReactNode, options?: Omit<ToastOptions, 'type' | 'title'>) =>
    dispatchToast({ ...options, title, type: 'success' }),
  error: (title: React.ReactNode, options?: Omit<ToastOptions, 'type' | 'title'>) =>
    dispatchToast({ ...options, title, type: 'error' }),
  warning: (title: React.ReactNode, options?: Omit<ToastOptions, 'type' | 'title'>) =>
    dispatchToast({ ...options, title, type: 'warning' }),
  info: (title: React.ReactNode, options?: Omit<ToastOptions, 'type' | 'title'>) =>
    dispatchToast({ ...options, title, type: 'info' }),
  dismiss: (id: string) => dismissToast(id),
  clear: () => clearAllToasts(),
};

/**
 * 单个 Toast 卡片项渲染
 */
const ToastCard: React.FC<{
  item: InternalToastItem;
  onDismiss: (id: string) => void;
}> = ({ item, onDismiss }) => {
  const [isHovered, setIsHovered] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const remainingTimeRef = useRef<number>(item.duration ?? 3600);
  const startTimeRef = useRef<number>(Date.now());

  const handleStartTimer = useCallback(() => {
    const duration = remainingTimeRef.current;
    if (duration <= 0) return; // 永久常驻

    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss(item.id);
    }, duration);
  }, [item.id, onDismiss]);

  const handlePauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const elapsed = Date.now() - startTimeRef.current;
      remainingTimeRef.current = Math.max(0, remainingTimeRef.current - elapsed);
    }
  }, []);

  useEffect(() => {
    if (!isHovered && !item.isLeaving) {
      handleStartTimer();
    } else {
      handlePauseTimer();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isHovered, item.isLeaving, handleStartTimer, handlePauseTimer]);

  const renderIcon = () => {
    switch (item.type) {
      case 'success':
        return (
          <div className="w-5 h-5 rounded-full bg-[#e4f6ec] text-[#189a58] flex items-center justify-center shrink-0 mt-0.5">
            <CheckCircle2 size={13} strokeWidth={2.4} />
          </div>
        );
      case 'error':
        return (
          <div className="w-5 h-5 rounded-full bg-[#fbe9e9] text-[#d64545] flex items-center justify-center shrink-0 mt-0.5">
            <AlertCircle size={13} strokeWidth={2.4} />
          </div>
        );
      case 'warning':
        return (
          <div className="w-5 h-5 rounded-full bg-[#fbf0df] text-[#b45309] flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle size={13} strokeWidth={2.4} />
          </div>
        );
      case 'info':
      default:
        return (
          <div className="w-5 h-5 rounded-full bg-[#f1f1f4] text-[#1c1c21] flex items-center justify-center shrink-0 mt-0.5">
            <Info size={13} strokeWidth={2.4} />
          </div>
        );
    }
  };

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-[10px] bg-white/95 backdrop-blur-md border border-[#e3e3e8] shadow-[0_12px_32px_rgba(20,22,30,0.12),0_2px_8px_rgba(20,22,30,0.04)] min-w-[300px] max-w-[460px] text-left transition-all ${
        item.isLeaving ? 'openloop-toast-leave' : 'openloop-toast-enter'
      }`}
    >
      {renderIcon()}

      <div className="flex-1 min-w-0 pr-1">
        <div className="text-[12.5px] font-medium text-[#1c1c21] leading-snug break-words">
          {item.title}
        </div>
        {item.description && (
          <div className="text-[11.5px] text-[#63636b] mt-0.5 leading-relaxed break-words">
            {item.description}
          </div>
        )}
        {item.action && (
          <div className="mt-2 flex items-center">
            <button
              type="button"
              onClick={() => {
                item.action?.onClick();
                onDismiss(item.id);
              }}
              className="h-[22px] px-2.5 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center gap-1 active:scale-95 transition-all shadow-xs"
            >
              {item.action.label}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors -mr-1 -mt-0.5 shrink-0"
        title="关闭通知"
      >
        <X size={13} />
      </button>
    </div>
  );
};

/**
 * Toast 容器，挂载于 App 顶层
 */
export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<InternalToastItem[]>([]);

  useEffect(() => {
    globalListener = (updater) => {
      setToasts(updater);
    };
    return () => {
      globalListener = null;
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none select-none"
    >
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={dismissToast} />
      ))}
    </div>
  );
};

/**
 * React Context 提供者
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value: ToastContextType = {
    toast: (opts) => toast.show(opts),
    success: (title, opts) => toast.success(title, opts),
    error: (title, opts) => toast.error(title, opts),
    warning: (title, opts) => toast.warning(title, opts),
    info: (title, opts) => toast.info(title, opts),
    dismiss: (id) => toast.dismiss(id),
    clear: () => toast.clear(),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 降级使用全局 toast 对象
    return {
      toast: (opts) => toast.show(opts),
      success: (title, opts) => toast.success(title, opts),
      error: (title, opts) => toast.error(title, opts),
      warning: (title, opts) => toast.warning(title, opts),
      info: (title, opts) => toast.info(title, opts),
      dismiss: (id) => toast.dismiss(id),
      clear: () => toast.clear(),
    };
  }
  return ctx;
}
