import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Check, Loader2, X } from 'lucide-react';
import { api, type DeviceScreenshotResult } from '../services/api';
import { imageSrc } from './local-image';
import { toast } from '../components/Toast';

/** 一次最多带几张：手机截图信息密度高，多了只会挤占模型上下文 */
const MAX_PICKS = 6;

interface Props {
  open: boolean;
  onClose: () => void;
  /** 选好的截图按文件形式交给上传管线，走既有附件链路 */
  onPick: (files: File[]) => void;
}

function baseName(filePath: string): string {
  return filePath.split('/').pop() || 'device-screenshot.png';
}

function mimeOf(filePath: string): string {
  return /\.jpe?g$/i.test(filePath) ? 'image/jpeg' : 'image/png';
}

/**
 * 设备截图选择器：把镜像里截下的画面直接当附件发给 agent。
 * 只做「挑哪几张 + 取回文件」，上传与随消息发送都由外层既有管线负责。
 */
export const DeviceScreenshotPicker: React.FC<Props> = ({ open, onClose, onPick }) => {
  const [shots, setShots] = useState<DeviceScreenshotResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked([]);
    setLoading(true);
    Promise.all([
      api.listDeviceScreenshots({ platform: 'android' }).catch(() => ({ items: [] })),
      api.listDeviceScreenshots({ platform: 'ios' }).catch(() => ({ items: [] })),
    ])
      .then(([android, ios]) => {
        const merged = [...(android.items || []), ...(ios.items || [])].sort(
          (a, b) => b.capturedAt - a.capturedAt
        );
        if (import.meta.env?.DEV) console.log('[AgentUI:DeviceShot] 可发送的设备截图:', merged.length);
        setShots(merged.slice(0, 24));
      })
      .finally(() => setLoading(false));
  }, [open]);

  const toggle = useCallback(
    (filePath: string) => {
      setPicked((prev) => {
        if (prev.includes(filePath)) return prev.filter((item) => item !== filePath);
        if (prev.length >= MAX_PICKS) {
          toast.info('最多选 6 张', { description: '先发一批，再选下一批' });
          return prev;
        }
        return [...prev, filePath];
      });
    },
    []
  );

  const confirm = useCallback(async () => {
    if (picked.length === 0 || confirming) return;
    setConfirming(true);
    try {
      const files = await Promise.all(
        picked.map(async (filePath) => {
          const resp = await fetch(imageSrc(filePath));
          if (!resp.ok) throw new Error(`读取截图失败：${baseName(filePath)}`);
          const blob = await resp.blob();
          return new File([blob], baseName(filePath), { type: mimeOf(filePath) });
        })
      );
      if (import.meta.env?.DEV) console.log('[AgentUI:DeviceShot] 已选截图转为附件:', files.map((f) => f.name));
      onPick(files);
      onClose();
    } catch (err: any) {
      toast.error('读取截图失败', { description: err?.message || '请重新截图后再试' });
    } finally {
      setConfirming(false);
    }
  }, [confirming, onClose, onPick, picked]);

  const pickedOrder = useMemo(() => new Map(picked.map((item, index) => [item, index + 1])), [picked]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-[#1c1c21]/25 backdrop-blur-[1px]"
      onClick={onClose}
      role="dialog"
      aria-label="选择设备截图"
    >
      <div
        className="w-[560px] max-w-[92vw] max-h-[76vh] flex flex-col bg-white rounded-[10px] border border-[#e3e3e8] shadow-[0_18px_48px_rgba(0,0,0,0.16)] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="h-[42px] px-3.5 flex items-center justify-between border-b border-[#f1f1f4] shrink-0">
          <div className="flex items-center gap-1.5">
            <Camera size={13} className="text-[#63636b]" />
            <span className="text-[12.5px] font-medium text-[#1c1c21]">选择设备截图</span>
            <span className="text-[11px] text-[#a1a1aa]">发给 agent 分析界面</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            className="w-6 h-6 rounded-[5px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3">
          {loading ? (
            <div className="h-[160px] flex items-center justify-center text-[#a1a1aa] text-[11.5px] gap-1.5">
              <Loader2 size={13} className="animate-spin" />
              正在读取设备截图...
            </div>
          ) : shots.length === 0 ? (
            <div className="h-[160px] flex flex-col items-center justify-center gap-1 text-center">
              <Camera size={18} className="text-[#c9c9d1]" />
              <p className="text-[12px] text-[#63636b]">还没有设备截图</p>
              <p className="text-[11px] text-[#a1a1aa]">打开设备镜像，点标题栏的相机按钮截一张</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {shots.map((shot) => {
                const order = pickedOrder.get(shot.path);
                return (
                  <button
                    key={shot.path}
                    type="button"
                    onClick={() => toggle(shot.path)}
                    title={`${shot.platform === 'ios' ? 'iOS' : 'Android'} · ${new Date(
                      shot.capturedAt
                    ).toLocaleTimeString()}`}
                    className={`relative h-[128px] rounded-[6px] overflow-hidden border bg-[#f9f9fb] transition-all cursor-pointer ${
                      order
                        ? 'border-[#4f46e5] ring-1 ring-[#4f46e5]/60'
                        : 'border-[#e3e3e8] hover:border-[#a1a1aa]'
                    }`}
                  >
                    <img
                      src={imageSrc(shot.path)}
                      alt="设备截图"
                      draggable={false}
                      className="h-full w-auto object-contain"
                    />
                    {order && (
                      <span className="absolute top-1 right-1 w-[16px] h-[16px] rounded-full bg-[#4f46e5] text-white text-[10px] font-medium flex items-center justify-center">
                        {order}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="h-[46px] px-3.5 flex items-center justify-between border-t border-[#f1f1f4] shrink-0">
          <span className="text-[11px] text-[#a1a1aa]">
            {picked.length > 0 ? `已选 ${picked.length} 张` : '点缩略图挑选，可多选'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[28px] px-3 rounded-[6px] border border-[#e3e3e8] text-[12px] text-[#63636b] hover:bg-[#f9f9fb] transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              disabled={picked.length === 0 || confirming}
              onClick={() => void confirm()}
              className="h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {confirming ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              添加 {picked.length > 0 ? picked.length : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
