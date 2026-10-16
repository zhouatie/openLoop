import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

export type ConfirmVariant = 'danger' | 'warning' | 'info' | 'primary';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description?: React.ReactNode;
  targetName?: string;
  targetTag?: string;
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
  confirmText = '确认',
  cancelText = '取消',
  variant = 'danger',
  loading = false,
  onConfirm,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);

  // 监听 Escape 快捷键退出
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100 select-none"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] bg-white rounded-[12px] border border-[#e3e3e8] shadow-[0_20px_48px_rgba(20,22,30,0.16)] p-5 animate-in zoom-in-95 duration-150 -mt-12"
      >
        {/* 对话框标题 */}
        <h3 className="text-[14px] font-semibold text-[#1c1c21] tracking-tight leading-snug">
          {title}
        </h3>

        {/* 目标对象展示胶囊卡片（如有） */}
        {targetName && (
          <div className="mt-3 px-3 py-2 rounded-[7px] bg-[#f9f9fb] border border-[#ececf0] flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-[#1c1c21] truncate min-w-0">
              {targetName}
            </span>
            {targetTag && (
              <span className="text-[10px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1.5 py-[0.5px] rounded shrink-0">
                {targetTag}
              </span>
            )}
          </div>
        )}

        {/* 辅助说明描述 */}
        {description && (
          <div className="text-[12px] text-[#63636b] mt-2.5 leading-relaxed break-words">
            {description}
          </div>
        )}

        {/* 底部按钮栏：100% 统一主题色，无生硬分割线 */}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="h-[28px] px-3.5 rounded-[6px] text-[#4b4b53] hover:bg-[#f1f1f4] hover:text-[#1c1c21] text-[12px] transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
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
