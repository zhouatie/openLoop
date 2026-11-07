import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone, RefreshCw, Play, Apple, Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { DeviceMirror, SwitchableDevice } from './DeviceMirror';
import { dedupeSimulators } from '../../utils/simulatorList';
import { AndroidDeviceInfo, IosDeviceInfo, IosDevicesSnapshot, DeviceLeaseSnapshot } from '@openloop/core';

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
  /** 由顶栏「设备」面板指定的目标设备；seq 变化即表示一次新的指定 */
  focus?: { platform: 'android' | 'ios'; serial: string; name?: string; seq: number } | null;
}

interface MirrorTarget {
  platform: 'android' | 'ios';
  serial: string;
  name?: string;
}

/** 记住上一次手动选择的设备，下次打开沿用（设备离线则回退自动选择） */
const PREFERRED_DEVICE_KEY = 'openloop.mirror.device';

const readPreferredDevice = (): MirrorTarget | null => {
  try {
    const raw = window.localStorage.getItem(PREFERRED_DEVICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.platform !== 'android' && parsed?.platform !== 'ios') return null;
    if (typeof parsed?.serial !== 'string' || !parsed.serial) return null;
    return { platform: parsed.platform, serial: parsed.serial, name: parsed.name };
  } catch {
    return null;
  }
};

const writePreferredDevice = (target: MirrorTarget) => {
  try {
    window.localStorage.setItem(PREFERRED_DEVICE_KEY, JSON.stringify(target));
  } catch {
    /* 隐私模式等场景忽略 */
  }
};

/**
 * 右侧贴边屏幕镜像浮层（Super + M 唤起）。
 * 只保留实时画面与操作按键，自动选中首个在线设备，便于边写代码边看真机效果。
 */
export const ScreenMirrorOverlay: React.FC<ScreenMirrorOverlayProps> = ({ open, onClose, run, focus }) => {
  const [target, setTarget] = useState<MirrorTarget | null>(null);
  const [rendered, setRendered] = useState(open);
  const [shown, setShown] = useState(false);
  const [leases, setLeases] = useState<DeviceLeaseSnapshot[]>([]);
  const [devices, setDevices] = useState<SwitchableDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [avds, setAvds] = useState<string[]>([]);
  const [emulatorHint, setEmulatorHint] = useState<string | null>(null);
  const [launchingAvd, setLaunchingAvd] = useState<string | null>(null);
  /** 已请求开机、等待上线后自动切换的 iOS 模拟器 */
  const [pendingIosUdid, setPendingIosUdid] = useState<string | null>(null);
  /** 已应用的顶栏指定设备序号，避免每轮刷新都覆盖手动切换 */
  const appliedFocusSeqRef = useRef(0);
  /** 上一轮成功拿到的原始设备数据：单次请求抖动时沿用，避免列表变空把选中设备踢掉 */
  const lastDataRef = useRef<{ android: AndroidDeviceInfo[]; ios: IosDevicesSnapshot | null }>({
    android: [],
    ios: null,
  });
  const leasesRef = useRef<DeviceLeaseSnapshot[]>([]);

  /** 空态可启动的模拟器：未启动的 Android AVD 与已关机的 iOS 模拟器 */
  const idleSimulators = [
    ...avds.map((name) => ({ key: `avd-${name}`, platform: 'android' as const, name, target: name, sub: '未启动 · 无窗口运行' })),
    ...devices
      .filter((device) => device.platform === 'ios' && device.hint === '已关机')
      .map((device) => ({ key: device.key, platform: 'ios' as const, name: device.name, target: device.serial, sub: '已关机' })),
  ];

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [androidRes, iosRes, leaseRes] = await Promise.allSettled([
        api.getAndroidDevices(),
        api.getIosDevices(),
        api.getDeviceLeases(),
      ]);

      if (androidRes.status === 'fulfilled') {
        lastDataRef.current.android = androidRes.value || [];
      }
      if (iosRes.status === 'fulfilled' && iosRes.value) {
        lastDataRef.current.ios = iosRes.value;
      }
      if (import.meta.env?.DEV && (androidRes.status === 'rejected' || iosRes.status === 'rejected')) {
        console.warn('[ScreenMirrorOverlay] 设备探测失败，沿用上一轮结果', {
          android: androidRes.status === 'rejected' ? androidRes.reason : null,
          ios: iosRes.status === 'rejected' ? iosRes.reason : null,
        });
      }

      const androidList = lastDataRef.current.android;
      const iosSnapshot = lastDataRef.current.ios;
      const leaseList = leaseRes.status === 'fulfilled' ? leaseRes.value || [] : leasesRef.current;

      const onlineAndroid = (androidList || []).filter((d) => d.status === 'device');
      const bootedIos = (iosSnapshot?.simulators || []).filter((d) => d.state === 'booted');
      // 下拉里同时列出未启动的模拟器，选中即开机
      const allIos = dedupeSimulators(
        iosSnapshot?.allSimulators?.length
          ? iosSnapshot.allSimulators.filter((d) => d.state !== 'unknown')
          : bootedIos
      );
      setLeases(leaseList || []);
      leasesRef.current = leaseList || [];
      setDevices([
        ...onlineAndroid.map((d) => ({
          key: `android-${d.serial}`,
          platform: 'android' as const,
          serial: d.serial,
          name: d.model || d.serial,
          hint: d.isEmulator ? '模拟器' : undefined,
        })),
        ...allIos.map((d) => ({
          key: `ios-${d.udid}`,
          platform: 'ios' as const,
          serial: d.udid,
          name: d.name || d.udid,
          hint: d.state === 'booted' ? '模拟器' : '已关机',
        })),
      ]);

      const lockedSerial = run?.serial;
      const lockedPlatform = run?.platform;

      // 已请求开机的模拟器上线后自动切过去
      if (pendingIosUdid) {
        const booted = bootedIos.find((d) => d.udid === pendingIosUdid);
        if (booted) {
          const ready: MirrorTarget = {
            platform: 'ios',
            serial: booted.udid,
            name: booted.name,
          };
          writePreferredDevice(ready);
          setTarget(ready);
          setPendingIosUdid(null);
          return;
        }
      }

      const applyFocus = Boolean(focus && focus.seq !== appliedFocusSeqRef.current);

      setTarget((curr) => {
        if (applyFocus && focus) {
          appliedFocusSeqRef.current = focus.seq;
          const next: MirrorTarget = {
            platform: focus.platform,
            serial: focus.serial,
            name: focus.name,
          };
          writePreferredDevice(next);
          return next;
        }
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
        // 手动选择过的设备仍在线时优先恢复
        const preferred = readPreferredDevice();
        if (preferred) {
          if (
            (preferred.platform === 'android' && onlineAndroid.some((d) => d.serial === preferred.serial)) ||
            (preferred.platform === 'ios' && bootedIos.some((d) => d.udid === preferred.serial))
          ) {
            return preferred;
          }
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
  }, [run?.serial, run?.platform, pendingIosUdid, focus?.seq, focus?.platform, focus?.serial, focus?.name]);

  // 打开时拉取设备，保持 8 秒轮询感知设备上下线
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  // 无可用设备时探测本机 AVD，支持一键启动模拟器
  useEffect(() => {
    if (!open || target) return;
    let cancelled = false;
    api
      .getAndroidEmulators()
      .then((res) => {
        if (cancelled) return;
        setAvds(res.available ? res.avds : []);
        setEmulatorHint(res.available ? null : res.message || null);
      })
      .catch(() => {
        /* 探测失败时保持空态，不影响其余功能 */
      });
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  const launchIdle = async (entry: { key: string; platform: 'android' | 'ios'; name: string; target: string }) => {
    setLaunchingAvd(entry.key);
    setEmulatorHint(null);
    try {
      const res =
        entry.platform === 'ios'
          ? await api.bootIosSimulator(entry.target)
          : await api.launchAndroidEmulator(entry.target);
      if (import.meta.env?.DEV) {
        console.log('[ScreenMirrorOverlay] 启动本地模拟器:', { entry, result: res });
      }
      setEmulatorHint(res.message || `正在启动 ${entry.name}，开机后自动显示画面`);
    } catch (err: any) {
      setEmulatorHint(err?.message || '启动模拟器失败');
    } finally {
      setLaunchingAvd(null);
    }
  };

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
      className={`fixed right-0 top-[52px] bottom-0 z-[900] w-[300px] flex flex-col justify-center p-2 select-none pointer-events-none transition-transform duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
          deviceSwitcher={{
            devices,
            activeKey: `${target.platform}-${target.serial}`,
            locked: Boolean(run?.active),
            onSelect: (device) => {
              const next = { platform: device.platform, serial: device.serial, name: device.name };
              if (import.meta.env?.DEV) {
                console.log('[ScreenMirrorOverlay] 手动切换镜像设备:', { ...next, hint: device.hint });
              }
              // 已关机的模拟器先开机，上线后由刷新逻辑自动切换
              if (device.hint === '已关机') {
                setPendingIosUdid(device.serial);
                void api
                  .bootIosSimulator(device.serial)
                  .then((res) => {
                    if (import.meta.env?.DEV) {
                      console.log('[ScreenMirrorOverlay] 启动 iOS 模拟器:', res);
                    }
                    if (!res.success) setPendingIosUdid(null);
                  })
                  .catch(() => setPendingIosUdid(null));
                return;
              }
              writePreferredDevice(next);
              setTarget(next);
            },
          }}
        />
        </div>
      ) : (
        <div className="pointer-events-auto mx-auto w-full flex flex-col items-center justify-center gap-2.5 text-center px-4 py-5 bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_10px_28px_rgba(0,0,0,0.10)] self-center">
          <div className="w-9 h-9 rounded-full bg-white border border-[#e3e3e8] flex items-center justify-center text-[#a1a1aa]">
            <Smartphone size={16} strokeWidth={1.8} />
          </div>
          <p className="text-[12px] font-medium text-[#1c1c21]">
            {loading ? '正在检测在线设备...' : '没有可用设备'}
          </p>
          <p className="text-[11px] text-[#85858d] leading-relaxed">
            {loading ? '请稍候' : '启动本机模拟器，或用 USB 连接 Android 真机'}
          </p>
          {!loading && idleSimulators.length > 0 && (
            <div className="w-full mt-0.5 max-h-[216px] overflow-y-auto rounded-[8px] border border-[#ececf0] divide-y divide-[#f4f4f6]">
              {idleSimulators.map((entry) => (
                <div key={entry.key} className="px-2 py-1.5 flex items-center gap-2">
                  {entry.platform === 'ios' ? (
                    <Apple size={11} className="shrink-0 text-[#a1a1aa]" />
                  ) : (
                    <Smartphone size={11} className="shrink-0 text-[#a1a1aa]" />
                  )}
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-[11.5px] text-[#1c1c21] truncate">{entry.name}</div>
                    <div className="text-[10px] text-[#a1a1aa] truncate">{entry.sub}</div>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(launchingAvd)}
                    onClick={() => void launchIdle(entry)}
                    className="shrink-0 inline-flex items-center gap-1 h-[22px] px-2 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {launchingAvd === entry.key ? (
                      <Loader2 size={9} className="animate-spin" />
                    ) : (
                      <Play size={9} />
                    )}
                    <span>{launchingAvd === entry.key ? '启动中' : '启动'}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
          {emulatorHint && (
            <p className="text-[10.5px] text-[#b45309] leading-relaxed max-w-[220px]">{emulatorHint}</p>
          )}
          {!loading && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-0.5 inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px] bg-white border border-[#e3e3e8] text-[11px] text-[#4b4b53] hover:text-[#1c1c21] hover:border-[#d4d4d8] transition-colors cursor-pointer"
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
