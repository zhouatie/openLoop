import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, Play, ScanLine, X } from 'lucide-react';
import { Task } from '@openloop/core';
import { api } from '../../services/api';
import { qrSvgMarkup } from '../../utils/qr';
import { toast } from '../Toast';

interface ScanPreviewModalProps {
  task: Task;
  onClose: () => void;
}

/** 手机扫码预览：把开发服务靶机的局域网地址渲染为二维码，供真机扫码直达 */
export const ScanPreviewModal: React.FC<ScanPreviewModalProps> = ({ task, onClose }) => {
  const [status, setStatus] = useState<'loading' | 'running' | 'stopped'>('loading');
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const port = task.context?.worktree?.webPort;

  const loadScanTarget = useCallback(async () => {
    try {
      const res = await api.getTaskSandboxStatus(task.id);
      if (import.meta.env?.DEV) {
        console.log('[ScanPreviewModal] 靶机扫码地址:', { status: res.status, scanUrl: res.scanUrl, lanIp: res.lanIp });
      }
      setScanUrl(res.scanUrl || null);
      setStatus(res.status === 'running' ? 'running' : 'stopped');
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[ScanPreviewModal] 获取扫码地址失败:', err);
      setStatus('stopped');
    }
  }, [task.id]);

  useEffect(() => {
    loadScanTarget();
  }, [loadScanTarget]);

  // Escape 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const qrSvg = useMemo(() => (scanUrl ? qrSvgMarkup(scanUrl) : null), [scanUrl]);

  const handleCopy = async () => {
    if (!scanUrl) return;
    try {
      await navigator.clipboard.writeText(scanUrl);
      setIsCopied(true);
      toast.success('扫码地址已复制');
      setTimeout(() => setIsCopied(false), 1500);
    } catch {
      toast.error('复制失败，请手动选择地址');
    }
  };

  const handleStartService = async () => {
    setIsStarting(true);
    if (import.meta.env?.DEV) console.log(`[ScanPreviewModal] 唤醒任务 ${task.id} 靶机服务以生成二维码`);
    try {
      const res = await api.startTaskSandbox(task.id);
      if (res.success || res.status === 'running') {
        toast.success('靶机服务已就绪');
        await loadScanTarget();
      } else {
        toast.warning(res.message || '靶机服务启动超时');
      }
    } catch (err: any) {
      toast.error(`启动靶机失败: ${err.message || '未知异常'}`);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 backdrop-blur-[2px] animate-in fade-in duration-100 select-none"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[302px] bg-white rounded-[10px] border border-[#e3e3e8] shadow-[0_18px_48px_rgba(16,17,26,0.16)] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[42px] px-3.5 flex items-center justify-between border-b border-[#f1f1f4]">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] border border-[#e3e3e8]/60 flex items-center justify-center text-[#63636b] shrink-0">
              <ScanLine size={11} strokeWidth={2} />
            </div>
            <span className="text-[12px] font-medium text-[#1c1c21] truncate">手机扫码预览</span>
            {port && <span className="text-[9.5px] font-mono text-[#85858d] shrink-0">:{port}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-[4px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer"
            title="关闭 (Esc)"
          >
            <X size={13} />
          </button>
        </div>

        <div className="px-4 pt-4 pb-3.5 flex flex-col items-center gap-3">
          <div className="relative w-[196px] h-[196px] p-2 rounded-[8px] bg-white border border-[#e3e3e8] shadow-[0_1px_3px_rgba(16,17,26,0.04)]">
            {qrSvg ? (
              <div
                className={`w-full h-full transition-opacity duration-150 ${status === 'running' ? 'opacity-100' : 'opacity-25'}`}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#c7c7cf]">
                {status === 'loading' ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : scanUrl ? (
                  <span className="text-[10px] text-[#a1a1aa] text-center px-3 leading-relaxed">地址过长，无法生成二维码</span>
                ) : (
                  <ScanLine size={20} />
                )}
              </div>
            )}

            {status === 'stopped' && (
              <button
                type="button"
                disabled={isStarting}
                onClick={handleStartService}
                className="absolute inset-0 m-auto w-[116px] h-[26px] rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center justify-center gap-1 shadow-sm transition-all active:scale-95 disabled:opacity-70 cursor-pointer"
              >
                {isStarting ? <Loader2 size={11} className="animate-spin" /> : <Play size={9} className="fill-current" />}
                <span>{isStarting ? '正在拉起服务' : '启动靶机服务'}</span>
              </button>
            )}
          </div>

          {scanUrl && (
            <div className="w-full flex items-center gap-1 h-[26px] pl-2 pr-1 rounded-[5px] bg-[#f9f9fb] border border-[#f1f1f4]">
              <span className="flex-1 min-w-0 text-[10px] font-mono text-[#4b4b53] truncate" title={scanUrl}>
                {scanUrl}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="w-5 h-5 rounded-[4px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors shrink-0 cursor-pointer"
                title="复制扫码地址"
              >
                {isCopied ? <Check size={10} className="text-[#059669]" /> : <Copy size={10} />}
              </button>
            </div>
          )}

          <p className="text-[10.5px] text-[#85858d] leading-relaxed text-center">
            {status === 'stopped'
              ? '靶机服务未运行，启动后即可扫码。'
              : '手机与电脑接入同一局域网，用系统相机或 App 扫一扫打开。'}
          </p>
        </div>
      </div>
    </div>
  );
};
