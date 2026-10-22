import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, X } from 'lucide-react';

export type ConfirmVariant = 'danger' | 'warning' | 'info' | 'primary';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description?: React.ReactNode;
  targetName?: string;
  targetTag?: string;
  targetDescription?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  targetName,
  targetTag,
  targetDescription,
  confirmText = '确认',
  cancelText = '取消',
  loading = false,
  onConfirm,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // 日志：弹窗展示
  useEffect(() => {
    if (isOpen && import.meta.env?.DEV) {
      console.log('[ConfirmModal] 打开确认对话框:', {
        title,
        targetName,
        targetTag,
      });
    }
  }, [isOpen, title, targetName, targetTag]);

  // 监听 Escape 快捷键退出
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        if (import.meta.env?.DEV) {
          console.log('[ConfirmModal] 用户按 Escape 关闭对话框');
        }
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  const handleCancelClick = () => {
    if (import.meta.env?.DEV) {
      console.log('[ConfirmModal] 用户点击取消');
    }
    onClose();
  };

  const handleConfirmClick = async () => {
    if (import.meta.env?.DEV) {
      console.log('[ConfirmModal] 用户点击确认执行操作:', title);
    }
    await onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/35 backdrop-blur-[2px] openloop-modal-backdrop select-none"
      onClick={() => {
        if (!loading) handleCancelClick();
      }}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] bg-white rounded-[12px] border border-[#e3e3e8] shadow-[0_20px_48px_rgba(20,22,30,0.16)] p-5 openloop-modal-content -mt-12"
      >
        {/* 顶部标题栏：统一应用主题排版 + 右侧轻量关闭按钮 */}
        <div className="flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-[#1c1c21] tracking-tight leading-snug">
            {title}
          </h3>
          <button
            type="button"
            disabled={loading}
            onClick={handleCancelClick}
            className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors -mr-1 -mt-0.5"
            title="关闭 (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* 目标对象展示卡片：极简纯粹，完整展示内容，优雅自适应折行 */}
        {(targetName || targetTag || targetDescription) && (
          <div className="mt-3.5 px-3.5 py-2.5 rounded-[8px] bg-[#f9f9fb] border border-[#ececf0] text-left">
            {targetName && (
              <div
                className="text-[12.5px] font-medium text-[#1c1c21] leading-relaxed break-words select-text max-h-[140px] overflow-y-auto"
                title={typeof targetName === 'string' ? targetName : undefined}
              >
                {targetName}
              </div>
            )}
            {targetDescription && (
              <div className="text-[11.5px] text-[#63636b] mt-1 leading-relaxed break-words select-text">
                {targetDescription}
              </div>
            )}
            {targetTag && (
              <div className="text-[10px] font-mono text-[#85858d] mt-1 select-all">
                {targetTag}
              </div>
            )}
          </div>
        )}

        {/* 辅助说明描述 */}
        {description && (
          <div className="text-[12px] text-[#63636b] mt-3 leading-relaxed break-words">
            {description}
          </div>
        )}

        {/* 底部按钮栏：严格统一当前应用主题色 (#1c1c21) */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={handleCancelClick}
            className="h-[28px] px-3.5 rounded-[6px] text-[#4b4b53] hover:bg-[#f1f1f4] hover:text-[#1c1c21] text-[12px] transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleConfirmClick}
            className="h-[28px] px-4 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium flex items-center gap-1.5 active:scale-95 disabled:opacity-50 transition-all shadow-sm"
          >
            {loading && <Loader2 size={12} className="animate-spin" />}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  targetName?: string;
  targetTag?: string;
  targetDescription?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

/**
 * 通用 Hook，支持以 Promise 或函数回调方式唤起优雅确认对话框
 */
export function useConfirmModal() {
  const [state, setState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve?: (value: boolean) => void;
    loading: boolean;
  }>({
    isOpen: false,
    options: { title: '' },
    loading: false,
  });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        options,
        resolve,
        loading: false,
      });
    });
  }, []);

  const handleClose = useCallback(() => {
    if (state.resolve) {
      state.resolve(false);
    }
    setState((prev) => ({ ...prev, isOpen: false }));
  }, [state.resolve]);

  const handleConfirm = useCallback(() => {
    if (state.resolve) {
      state.resolve(true);
    }
    setState((prev) => ({ ...prev, isOpen: false }));
  }, [state.resolve]);

  const confirmModalElement = (
    <ConfirmModal
      isOpen={state.isOpen}
      title={state.options.title}
      description={state.options.description}
      targetName={state.options.targetName}
      targetTag={state.options.targetTag}
      targetDescription={state.options.targetDescription}
      confirmText={state.options.confirmText}
      cancelText={state.options.cancelText}
      variant={state.options.variant}
      loading={state.loading}
      onConfirm={handleConfirm}
      onClose={handleClose}
    />
  );

  return {
    confirm,
    confirmModalElement,
  };
}
