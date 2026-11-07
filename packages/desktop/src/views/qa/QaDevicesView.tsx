import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Smartphone,
  Apple,
  RefreshCw,
  Plus,
  Radio,
  CheckCircle2,
  Lock,
  ExternalLink,
  ChevronRight,
  Info,
} from 'lucide-react';
import { api } from '../../services/api';
import { DeviceMirror } from '../../components/device/DeviceMirror';
import { AndroidDeviceInfo, IosDeviceInfo, DeviceLeaseSnapshot } from '@openloop/core';

export const QaDevicesView: React.FC = () => {
  const [androidDevices, setAndroidDevices] = useState<AndroidDeviceInfo[]>([]);
  const [iosDevices, setIosDevices] = useState<IosDeviceInfo[]>([]);
  const [leases, setLeases] = useState<DeviceLeaseSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<{
    platform: 'android' | 'ios';
    serial: string;
    name?: string;
  } | null>(null);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const [androidList, iosSnapshot, leaseList] = await Promise.all([
        api.getAndroidDevices().catch(() => []),
        api.getIosDevices().catch(() => null),
        api.getDeviceLeases().catch(() => []),
      ]);

      const onlineAndroid = (androidList || []).filter((d) => d.status === 'device');
      setAndroidDevices(onlineAndroid);

      const bootedIos = (iosSnapshot?.simulators || []).filter((d) => d.state === 'booted');
      setIosDevices(bootedIos);

      setLeases(leaseList || []);

      setSelectedDevice((curr) => {
        if (curr) {
          const exists =
            (curr.platform === 'android' && onlineAndroid.some((d) => d.serial === curr.serial)) ||
            (curr.platform === 'ios' && bootedIos.some((d) => d.udid === curr.serial));
          if (exists) return curr;
        }

        if (onlineAndroid.length > 0) {
          return { platform: 'android', serial: onlineAndroid[0].serial, name: onlineAndroid[0].model };
        }
        if (bootedIos.length > 0) {
          return { platform: 'ios', serial: bootedIos[0].udid, name: bootedIos[0].name };
        }
        return null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 10000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  // 合并设备列表
  const deviceList = useMemo(() => {
    return [
      ...androidDevices.map((d) => {
        const lease = leases.find((l) => l.key === d.serial);
        return {
          platform: 'android' as const,
          serial: d.serial,
          name: d.model || 'Android 设备',
          version: d.version ? `Android ${d.version}` : 'Android',
          typeLabel: d.isEmulator ? '模拟器' : '真机',
          isBusy: Boolean(lease?.holder),
          holderLabel: lease?.holder?.label,
        };
      }),
      ...iosDevices.map((d) => {
        const lease = leases.find((l) => l.key === d.udid);
        return {
          platform: 'ios' as const,
          serial: d.udid,
          name: d.name || 'iOS 设备',
          version: d.version ? `iOS ${d.version}` : 'iOS',
          typeLabel: '模拟器',
          isBusy: Boolean(lease?.holder),
          holderLabel: lease?.holder?.label,
        };
      }),
    ];
  }, [androidDevices, iosDevices, leases]);

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-[#f4f4f6] overflow-hidden p-6 gap-5 select-none">
      {/* 顶部概览指标与工具条 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#e3e3e8] rounded-[8px] p-4 shadow-xs">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[11.5px] text-[#71717a]">已连通真机/模拟器</span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-[20px] font-semibold text-[#1c1c21]">{deviceList.length}</span>
              <span className="text-[11px] text-[#85858d]">
                ({androidDevices.length} Android, {iosDevices.length} iOS)
              </span>
            </div>
          </div>

          <div className="h-8 w-[1px] bg-[#e3e3e8]" />

          <div className="flex flex-col">
            <span className="text-[11.5px] text-[#71717a]">当前占用中</span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-[20px] font-semibold text-[#2563eb]">
                {deviceList.filter((d) => d.isBusy).length}
              </span>
              <span className="text-[11px] text-[#85858d]">自动化互斥锁定</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchDevices}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e3e3e8] hover:bg-[#fafafc] text-[#27272a] rounded-[6px] text-[12px] font-medium shadow-2xs transition-colors cursor-pointer"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>刷新列表</span>
          </button>
        </div>
      </div>

      {/* 设备列表与实时投屏工作区 */}
      <div className="flex-1 flex gap-5 min-h-0">
        {/* 左侧设备选择列 */}
        <div className="w-[300px] bg-white border border-[#e3e3e8] rounded-[8px] flex flex-col overflow-hidden shrink-0 shadow-xs">
          <div className="h-[36px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center justify-between text-[11px] font-medium text-[#85858d] select-none">
            <span>在线设备 ({deviceList.length})</span>
            <span>状态</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#f1f1f4]">
            {deviceList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center text-[#71717a]">
                <Smartphone size={24} className="text-[#a1a1aa] mb-2" />
                <span className="text-[12px] font-medium text-[#27272a]">暂无在线设备</span>
                <span className="text-[11px] text-[#85858d] mt-1">连接真机或启动模拟器即可自动识别</span>
              </div>
            ) : (
              deviceList.map((d) => {
                const isSelected = selectedDevice?.serial === d.serial;
                return (
                  <div
                    key={d.serial}
                    onClick={() => setSelectedDevice({ platform: d.platform, serial: d.serial, name: d.name })}
                    className={`px-4 py-3 flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#f4f4f6]' : 'hover:bg-[#fafafc]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-[6px] bg-[#f4f4f5] flex items-center justify-center shrink-0">
                        {d.platform === 'ios' ? (
                          <Apple size={14} className="text-[#52525b]" />
                        ) : (
                          <Smartphone size={14} className="text-[#059669]" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[12.5px] font-medium text-[#1c1c21] truncate">{d.name}</span>
                        <span className="text-[11px] text-[#85858d] truncate">
                          {d.version} · {d.typeLabel}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {d.isBusy ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10px] font-medium border border-[#bfdbfe]/60">
                          <Lock size={10} />
                          <span>锁定</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                          <span>空闲</span>
                        </span>
                      )}
                      <ChevronRight size={14} className={`text-[#a1a1aa] ${isSelected ? 'text-[#4f46e5]' : ''}`} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧实时投屏与交互控制区 */}
        <div className="flex-1 bg-white border border-[#e3e3e8] rounded-[8px] flex flex-col overflow-hidden shadow-xs min-h-0">
          {selectedDevice ? (
            <div className="flex-1 p-4 flex flex-col min-h-0 bg-[#f4f4f6]">
              <div className="h-full w-full flex items-center justify-center min-h-0">
                <DeviceMirror
                  key={`${selectedDevice.platform}-${selectedDevice.serial}`}
                  platform={selectedDevice.platform}
                  serial={selectedDevice.serial}
                  name={selectedDevice.name}
                  leases={leases}
                  variant="standalone"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#71717a]">
              <div className="w-12 h-12 rounded-full bg-[#f4f4f6] flex items-center justify-center mb-3">
                <Smartphone size={24} className="text-[#a1a1aa]" />
              </div>
              <span className="text-[13px] font-medium text-[#27272a]">请选择左侧设备以开始监视</span>
              <p className="text-[11.5px] text-[#71717a] mt-1 max-w-[280px]">
                支持 WebCodecs 高清 60 帧实时投屏与反向触控、滑动、文本输入。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
