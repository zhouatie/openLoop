import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone, Apple, Power, Loader2, ChevronDown, Play, RefreshCw, Wifi, Check, X, MonitorPlay } from 'lucide-react';
import { AndroidDeviceInfo, IosDeviceInfo, RunningEmulatorInfo } from '@openloop/core';
import { api } from '../services/api';
import { dedupeSimulators } from '../utils/simulatorList';

/** 面板展开时的对账间隔 */
const POLL_INTERVAL_MS = 5000;
/** 每个分区默认展示的条数，超出折叠 */
const SECTION_LIMIT = 2;

const formatUptime = (seconds?: number): string => {
  if (seconds === undefined) return '';
  if (seconds < 60) return '刚刚启动';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分 ${total % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
};

/** 面板里的一台已运行设备 */
interface RunningRow {
  key: string;
  platform: 'android' | 'ios';
  name: string;
  serial: string;
  state: 'booted' | 'starting';
  pid?: number;
  /** 真机 / 模拟器 */
  kind: string;
  detail: string;
  canStop: boolean;
}

interface DeviceStatusMenuProps {
  /** 在镜像里打开某台设备 */
  onOpenMirror: (device: { platform: 'android' | 'ios'; serial: string; name: string }) => void;
}

/**
 * 顶栏「设备」：列出运行中的模拟器与真机，并可直接启动本机 Android AVD / iOS 模拟器、配对无线 ADB。
 * 无设备时按钮保留灰态，点开即是设备入口，不必离开 openLoop。
 */
export const DeviceStatusMenu: React.FC<DeviceStatusMenuProps> = ({ onOpenMirror }) => {
  const [open, setOpen] = useState(false);
  /** 各分区是否已展开全部（默认每段最多 2 条） */
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState<RunningEmulatorInfo[]>([]);
  const [realDevices, setRealDevices] = useState<AndroidDeviceInfo[]>([]);
  const [avds, setAvds] = useState<string[]>([]);
  const [avdsAvailable, setAvdsAvailable] = useState(true);
  const [simulators, setSimulators] = useState<IosDeviceInfo[]>([]);
  const [stoppingKey, setStoppingKey] = useState<string | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [wifiAddress, setWifiAddress] = useState('');
  const [wifiLoading, setWifiLoading] = useState(false);
  const [wifiResult, setWifiResult] = useState<{ ok: boolean; text: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** 已发停止指令的设备在退出前仍会被后台列出，短时间内过滤掉避免闪回 */
  const stoppingUntilRef = useRef<Map<string, number>>(new Map());

  const reload = useCallback(async () => {
    // 部分接口失败时沿用上一轮结果：不能让一次抖动把整份设备列表清空
    const [runningRes, androidRes, emulatorRes, iosRes] = await Promise.allSettled([
      api.getRunningEmulators(),
      api.getAndroidDevices(),
      api.getAndroidEmulators(),
      api.getIosDevices(),
    ]);

    const now = Date.now();
    if (runningRes.status === 'fulfilled') {
      const visible = (runningRes.value.emulators || []).filter((item) => {
        const until = stoppingUntilRef.current.get(item.key);
        if (!until) return true;
        if (until > now) return false;
        stoppingUntilRef.current.delete(item.key);
        return true;
      });
      setRunning(visible);
    }

    if (androidRes.status === 'fulfilled') {
      setRealDevices((androidRes.value || []).filter((d) => d.status === 'device' && !d.isEmulator));
    }

    if (emulatorRes.status === 'fulfilled') {
      setAvds(emulatorRes.value.available ? emulatorRes.value.avds : []);
      setAvdsAvailable(Boolean(emulatorRes.value.available));
    }

    if (iosRes.status === 'fulfilled' && iosRes.value) {
      setSimulators(dedupeSimulators(iosRes.value.allSimulators || iosRes.value.simulators || []));
    }

    if (import.meta.env?.DEV) {
      const failed = [runningRes, androidRes, emulatorRes, iosRes].filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        console.warn('[DeviceStatusMenu] 部分设备探测失败，沿用上一轮结果:', failed.length);
      }
    }
  }, []);

  // 面板关闭时也低频对账，保证顶栏计数准确
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), open ? POLL_INTERVAL_MS : 15000);
    return () => window.clearInterval(timer);
  }, [reload, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const runningRows: RunningRow[] = [
    ...running.map((item) => ({
      key: item.key,
      platform: item.platform,
      name: item.name,
      serial: item.serial || '',
      state: item.state,
      pid: item.pid,
      kind: item.platform === 'ios' ? 'iOS 模拟器' : item.serial ? '模拟器' : '启动中',
      detail:
        item.platform === 'ios'
          ? item.version
            ? `iOS ${item.version}`
            : '模拟器'
          : item.state === 'booted'
          ? formatUptime(item.uptimeSeconds)
          : '开机中',
      canStop: true,
    })),
    ...realDevices.map((device) => ({
      key: `android-real-${device.serial}`,
      platform: 'android' as const,
      name: device.model || device.serial,
      serial: device.serial,
      state: 'booted' as const,
      kind: '真机',
      detail: device.serial,
      canStop: false,
    })),
  ];

  const sectionLimit = (key: string, list: unknown[]) =>
    expandedSections[key] ? list.length : Math.min(SECTION_LIMIT, list.length);
  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  const moreRow = (key: string, total: number, unit: string) =>
    total > SECTION_LIMIT ? (
      <button
        key={`more-${key}`}
        type="button"
        onClick={() => toggleSection(key)}
        className="w-full h-[24px] px-3 flex items-center gap-1 text-[10.5px] text-[#85858d] hover:text-[#4f46e5] hover:bg-[#fafafc] transition-colors cursor-pointer"
      >
        <span>{expandedSections[key] ? '收起' : `全部 ${total} ${unit}`}</span>
        <ChevronDown
          size={9}
          className={`transition-transform ${expandedSections[key] ? 'rotate-180' : ''}`}
        />
      </button>
    ) : null;

  const runningAvdNames = new Set(running.filter((item) => item.platform === 'android').map((item) => item.name));
  const pendingAvds = avds.filter((name) => !runningAvdNames.has(name));
  const bootedIosNames = new Set(running.filter((item) => item.platform === 'ios').map((item) => item.name));
  const pendingSimulators = simulators.filter((sim) => sim.state !== 'booted' && !bootedIosNames.has(sim.name));

  const count = runningRows.length;
  const startingCount = runningRows.filter((row) => row.state === 'starting').length;
  const hasContent = count > 0 || pendingAvds.length > 0 || pendingSimulators.length > 0;

  const handleStop = async (row: RunningRow) => {
    setStoppingKey(row.key);
    try {
      await api.stopEmulator({
        platform: row.platform,
        pid: row.pid,
        serial: row.serial,
        udid: row.platform === 'ios' ? row.serial : undefined,
      });
      if (import.meta.env?.DEV) {
        console.log('[DeviceStatusMenu] 已停止设备:', row.name);
      }
      stoppingUntilRef.current.set(row.key, Date.now() + 15000);
      setRunning((prev) => prev.filter((item) => item.key !== row.key));
      // 不阻塞等待对账：对账失败也不能让电源按钮一直转圈
      void reload();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[DeviceStatusMenu] 停止设备失败:', err?.message);
      }
      setWifiResult({ ok: false, text: `停止 ${row.name} 失败：${err?.message || '未知异常'}` });
    } finally {
      setStoppingKey(null);
    }
  };

  const handleLaunchAvd = async (name: string) => {
    setLaunching(`avd-${name}`);
    try {
      const res = await api.launchAndroidEmulator(name);
      if (import.meta.env?.DEV) {
        console.log('[DeviceStatusMenu] 启动 Android 模拟器:', { name, res });
      }
      if (!res.success) setWifiResult({ ok: false, text: res.message });
    } finally {
      setTimeout(() => setLaunching(null), 2500);
      await reload();
    }
  };

  const handleLaunchSimulator = async (sim: IosDeviceInfo) => {
    setLaunching(`ios-${sim.udid}`);
    try {
      const res = await api.bootIosSimulator(sim.udid);
      if (import.meta.env?.DEV) {
        console.log('[DeviceStatusMenu] 启动 iOS 模拟器:', { name: sim.name, res });
      }
      if (!res.success) setWifiResult({ ok: false, text: res.message });
    } finally {
      setTimeout(() => setLaunching(null), 2500);
      await reload();
    }
  };

  const handleConnectWifi = async () => {
    const address = wifiAddress.trim();
    if (!address || wifiLoading) return;
    setWifiLoading(true);
    setWifiResult(null);
    try {
      const res = await api.connectAndroidWifi(address);
      setWifiResult({ ok: Boolean(res.success), text: res.message });
      if (res.success) setWifiAddress('');
      await reload();
    } catch (err: any) {
      setWifiResult({ ok: false, text: err?.message || '连接失败' });
    } finally {
      setWifiLoading(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (import.meta.env?.DEV) {
            console.log('[DeviceStatusMenu] 切换设备面板:', !open);
          }
          setOpen((prev) => !prev);
        }}
        title={count > 0 ? `设备 · ${count} 台在线` : '设备 · 没有设备在线，点击启动模拟器'}
        className={`h-[22px] rounded-[5px] flex items-center justify-center gap-[3px] transition-colors cursor-pointer ${
          count > 0 ? 'px-[4px]' : 'w-[24px]'
        } ${
          open
            ? 'bg-[#eeedf2] text-[#1c1c21]'
            : count > 0
            ? 'text-[#4f46e5] hover:bg-[#f4f4f6]'
            : 'text-[#a1a1aa] hover:text-[#1c1c21] hover:bg-[#f4f4f6]'
        }`}
      >
        <Smartphone size={13} strokeWidth={1.9} />
        {count > 0 && (
          <span
            className={`text-[9.5px] font-medium leading-none ${
              startingCount > 0 ? 'animate-pulse text-[#4f46e5]' : 'text-[#4f46e5]'
            }`}
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[30px] z-[950] w-[288px] bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_12px_32px_rgba(0,0,0,0.12)] overflow-hidden">
          <div className="max-h-[420px] overflow-y-auto">
            {/* 运行中 */}
            <div className="h-[26px] px-3 flex items-center justify-between bg-[#fafafc] border-b border-[#f1f1f4]">
              <span className="text-[10.5px] text-[#85858d]">运行中</span>
              <span className="text-[10px] font-mono text-[#a1a1aa]">{count}</span>
            </div>
            {runningRows.length === 0 ? (
              <div className="px-3 py-2.5 text-[11px] text-[#a1a1aa]">没有设备在线</div>
            ) : (
              <div className="divide-y divide-[#f1f1f4]">
                {runningRows.slice(0, sectionLimit('running', runningRows)).map((row) => (
                  <div key={row.key} className="group px-3 py-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpenMirror({ platform: row.platform, serial: row.serial, name: row.name });
                      }}
                      title={`在镜像里打开 ${row.name}`}
                      className="min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {row.platform === 'ios' ? (
                          <Apple size={10} className="shrink-0 text-[#a1a1aa]" />
                        ) : (
                          <Smartphone size={10} className="shrink-0 text-[#10b981]" />
                        )}
                        <span className="text-[12px] font-medium text-[#1c1c21] truncate group-hover:text-[#4f46e5] transition-colors">
                          {row.name}
                        </span>
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 h-[16px] px-1.5 rounded-[4px] text-[10px] font-medium ${
                            row.state === 'booted'
                              ? 'bg-[#ecfdf5] text-[#059669]'
                              : 'bg-[#eff6ff] text-[#2563eb]'
                          }`}
                        >
                          {row.state !== 'booted' && <Loader2 size={8} className="animate-spin" />}
                          {row.state === 'booted' ? '已就绪' : '启动中'}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-[#85858d] truncate">
                        <span className="shrink-0">{row.kind}</span>
                        <span className="text-[#d4d4d8]">·</span>
                        <span className="font-mono truncate">{row.detail}</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenMirror({ platform: row.platform, serial: row.serial, name: row.name })}
                      title="打开镜像"
                      className="shrink-0 w-6 h-6 rounded-[4px] flex items-center justify-center text-[#a1a1aa] hover:text-[#4f46e5] hover:bg-[#f4f4f6] transition-colors cursor-pointer"
                    >
                      <MonitorPlay size={12} strokeWidth={1.8} />
                    </button>

                    {row.canStop && (
                      <button
                        type="button"
                        onClick={() => void handleStop(row)}
                        disabled={stoppingKey === row.key}
                        title="停止这台模拟器"
                        className="shrink-0 w-6 h-6 rounded-[4px] flex items-center justify-center text-[#a1a1aa] hover:text-[#dc2626] hover:bg-[#fef2f2] transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        {stoppingKey === row.key ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Power size={12} strokeWidth={2} />
                        )}
                      </button>
                    )}
                  </div>
                ))}
                {moreRow('running', runningRows.length, '台')}
              </div>
            )}

            {/* 可启动的 Android 模拟器 */}
            {avdsAvailable && pendingAvds.length > 0 && (
              <>
                <div className="h-[26px] px-3 flex items-center bg-[#fafafc] border-y border-[#f1f1f4]">
                  <span className="text-[10.5px] text-[#85858d]">Android 模拟器</span>
                </div>
                <div className="divide-y divide-[#f1f1f4]">
                  {pendingAvds.slice(0, sectionLimit('android', pendingAvds)).map((name) => (
                    <div key={name} className="px-3 py-1.5 flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-[#1c1c21] truncate">{name}</div>
                        <div className="mt-0.5 text-[10.5px] text-[#a1a1aa]">未启动 · 无窗口运行</div>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(launching)}
                        onClick={() => void handleLaunchAvd(name)}
                        className="shrink-0 inline-flex items-center gap-1 h-[22px] px-2 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {launching === `avd-${name}` ? (
                          <Loader2 size={9} className="animate-spin" />
                        ) : (
                          <Play size={9} />
                        )}
                        <span>{launching === `avd-${name}` ? '启动中' : '启动'}</span>
                      </button>
                    </div>
                  ))}
                  {moreRow('android', pendingAvds.length, '个')}
                </div>
              </>
            )}

            {/* 可启动的 iOS 模拟器 */}
            {pendingSimulators.length > 0 && (
              <>
                <div className="h-[26px] px-3 flex items-center bg-[#fafafc] border-y border-[#f1f1f4]">
                  <span className="text-[10.5px] text-[#85858d]">iOS 模拟器</span>
                </div>
                <div className="divide-y divide-[#f1f1f4]">
                  {pendingSimulators.slice(0, sectionLimit('ios', pendingSimulators)).map((sim) => (
                    <div key={sim.udid} className="px-3 py-1.5 flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-[#1c1c21] truncate">{sim.name}</div>
                        <div className="mt-0.5 text-[10.5px] text-[#a1a1aa]">
                          已关机{sim.version ? ` · iOS ${sim.version}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={Boolean(launching)}
                        onClick={() => void handleLaunchSimulator(sim)}
                        className="shrink-0 inline-flex items-center gap-1 h-[22px] px-2 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {launching === `ios-${sim.udid}` ? (
                          <Loader2 size={9} className="animate-spin" />
                        ) : (
                          <Play size={9} />
                        )}
                        <span>{launching === `ios-${sim.udid}` ? '启动中' : '启动'}</span>
                      </button>
                    </div>
                  ))}
                  {moreRow('ios', pendingSimulators.length, '台')}
                </div>
              </>
            )}

            {!hasContent && (
              <div className="px-3 py-4 text-center text-[11px] text-[#a1a1aa] leading-relaxed">
                没有可用模拟器
                <br />
                可连接无线 ADB 真机，或在设置页安装 AVD
              </div>
            )}
          </div>

          {/* 无线 ADB 配对 */}
          <div className="border-t border-[#f1f1f4] px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Wifi size={11} className="shrink-0 text-[#85858d]" />
              <input
                value={wifiAddress}
                onChange={(e) => setWifiAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleConnectWifi();
                }}
                placeholder="192.168.1.102:5555"
                className="flex-1 min-w-0 h-[24px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[11px] font-mono text-[#1c1c21] placeholder:text-[#c4c4cc] focus:outline-none focus:border-[#4f46e5]"
              />
              <button
                type="button"
                onClick={() => void handleConnectWifi()}
                disabled={!wifiAddress.trim() || wifiLoading}
                className="shrink-0 h-[24px] px-2 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10.5px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {wifiLoading ? '连接中' : '连接'}
              </button>
              <button
                type="button"
                onClick={() => void reload()}
                title="重新检测设备"
                className="shrink-0 w-6 h-[24px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f4f4f6] transition-colors cursor-pointer"
              >
                <RefreshCw size={11} />
              </button>
            </div>
            {wifiResult && (
              <div
                className={`mt-1 flex items-center gap-1 text-[10.5px] ${
                  wifiResult.ok ? 'text-[#059669]' : 'text-[#dc2626]'
                }`}
              >
                {wifiResult.ok ? <Check size={9} /> : <X size={9} />}
                <span className="truncate">{wifiResult.text}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
