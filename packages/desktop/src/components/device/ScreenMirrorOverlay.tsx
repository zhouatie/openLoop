import React, { useCallback, useEffect, useState } from 'react';
import { Smartphone, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import { DeviceMirror } from './DeviceMirror';
import { AndroidDeviceInfo, IosDeviceInfo, DeviceLeaseSnapshot } from '@openloop/core';

export interface MirrorRunContext {
  runId: string;
  platform: 'android' | 'ios';
  serial?: string;
  suiteName?: string;
  stepIndex?: number;
  totalSteps?: number;
  stepTitle?: string;
  active: boolean;
}

interface ScreenMirrorOverlayProps {
  open: boolean;
  onClose: () => void;
  /** 当前 QA 执行上下文：有值时镜像锁定到该设备并展示步骤进度 */
  run?: MirrorRunContext | null;
}

interface MirrorTarget {
  platform: 'android' | 'ios';
  serial: string;
  name?: string;
}

/**
 * 右侧贴边屏幕镜像浮层（Super + M 唤起）。
 * 只保留实时画面与操作按键，自动选中首个在线设备，便于边写代码边看真机效果。
 */
export const ScreenMirrorOverlay: React.FC<ScreenMirrorOverlayProps> = ({ open, onClose, run }) => {
  const [target, setTarget] = useState<MirrorTarget | null>(null);
  const [rendered, setRendered] = useState(open);
  const [shown, setShown] = useState(false);
  const [leases, setLeases] = useState<DeviceLeaseSnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [androidList, iosSnapshot, leaseList] = await Promise.all([
        api.getAndroidDevices().catch(() => [] as AndroidDeviceInfo[]),
        api.getIosDevices().catch(() => null),
        api.getDeviceLeases().catch(() => [] as DeviceLeaseSnapshot[]),
      ]);

      const onlineAndroid = (androidList || []).filter((d) => d.status === 'device');
      const bootedIos = (iosSnapshot?.simulators || []).filter((d) => d.state === 'booted');
      setLeases(leaseList || []);

      const lockedSerial = run?.serial;
      const lockedPlatform = run?.platform;

      setTarget((curr) => {
        if (lockedSerial && lockedPlatform) {
          if (curr && curr.platform === lockedPlatform && curr.serial === lockedSerial) return curr;
          return { platform: lockedPlatform, serial: lockedSerial };
        }
        if (curr) {
          const alive =
            (curr.platform === 'android' && onlineAndroid.some((d) => d.serial === curr.serial)) ||
            (curr.platform === 'ios' && bootedIos.some((d) => d.udid === curr.serial));
          if (alive) return curr;
        }
        if (onlineAndroid.length > 0) {
          return {
            platform: 'android',
            serial: onlineAndroid[0].serial,
            name: onlineAndroid[0].model,
          };
        }
        if (bootedIos.length > 0) {
          return { platform: 'ios', serial: bootedIos[0].udid, name: bootedIos[0].name };
        }
        return null;
      });

      if (import.meta.env?.DEV) {
        console.log('[ScreenMirrorOverlay] 刷新镜像设备:', {
          android: onlineAndroid.length,
          ios: bootedIos.length,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [run?.serial, run?.platform]);

  // 打开时拉取设备，保持 8 秒轮询感知设备上下线
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  // Esc 关闭浮层
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (import.meta.env?.DEV) {
          console.log('[ScreenMirrorOverlay] Esc 关闭浮层');
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // 进入：先挂载再触发位移；离开：先播放退场动画再卸载
  useEffect(() => {
    if (open) {
      setRendered(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timer = window.setTimeout(() => setRendered(false), 220);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!rendered) return null;

  return (
    <div
      className={`fixed right-0 top-[52px] z-[900] w-[300px] h-[min(620px,calc(100vh-68px))] flex flex-col p-2 select-none pointer-events-none transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        shown ? 'translate-x-0' : 'translate-x-[105%]'
      }`}
    >
      {target ? (
        <div className={`flex-1 min-h-0 flex flex-col ${shown ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <DeviceMirror
          key={`${target.platform}-${target.serial}`}
          platform={target.platform}
          serial={target.serial}
          name={target.name}
          leases={leases}
          variant="standalone"
          run={run}
        />
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-center px-6">
          <div className="w-9 h-9 rounded-full bg-white border border-[#e3e3e8] flex items-center justify-center text-[#a1a1aa]">
            <Smartphone size={16} strokeWidth={1.8} />
          </div>
          <p className="text-[12px] font-medium text-[#1c1c21]">
            {loading ? '正在检测在线设备...' : '没有可用设备'}
          </p>
          <p className="text-[11px] text-[#85858d] leading-relaxed">
            {loading ? '请稍候' : '连接 Android 设备或启动 iOS 模拟器后重试'}
          </p>
          {!loading && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-1 inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px] bg-white border border-[#e3e3e8] text-[11px] text-[#4b4b53] hover:text-[#1c1c21] hover:border-[#d4d4d8] transition-colors cursor-pointer"
            >
              <RefreshCw size={11} />
              <span>重新检测</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
