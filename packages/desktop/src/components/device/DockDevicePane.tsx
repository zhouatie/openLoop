import React, { useEffect, useState, useCallback } from 'react';
import { Smartphone, Apple, RefreshCw, AlertCircle, Plus } from 'lucide-react';
import { api } from '../../services/api';
import { DeviceMirror } from './DeviceMirror';
import { AndroidDeviceInfo, IosDeviceInfo, DeviceLeaseSnapshot } from '@openloop/core';

interface DockDevicePaneProps {
  active?: boolean;
}

export const DockDevicePane: React.FC<DockDevicePaneProps> = ({ active = true }) => {
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

      // 默认选中第一个可用设备
      setSelectedDevice((curr) => {
        if (curr) {
          // 检查当前选中的设备是否仍然在线
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
    if (active) {
      fetchDevices();
      const interval = setInterval(fetchDevices, 10000);
      return () => clearInterval(interval);
    }
  }, [active, fetchDevices]);

  // 全部在线设备列表
  const allDevices = [
    ...androidDevices.map((d) => ({
      platform: 'android' as const,
      serial: d.serial,
      name: d.model || 'Android 设备',
      sub: d.isEmulator ? '模拟器' : '真机',
    })),
    ...iosDevices.map((d) => ({
      platform: 'ios' as const,
      serial: d.udid,
      name: d.name || 'iOS 设备',
      sub: 'iOS 模拟器',
    })),
  ];

  if (allDevices.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center text-[#71717a] bg-[#fafafc]">
        <div className="w-10 h-10 rounded-full bg-[#f4f4f6] flex items-center justify-center mb-3">
          <Smartphone size={20} className="text-[#a1a1aa]" />
        </div>
        <div className="text-[13px] font-medium text-[#27272a] mb-1">未检测到已连接设备</div>
        <p className="text-[11.5px] text-[#71717a] max-w-[240px] leading-relaxed mb-4">
          请开启 Android 真机 USB 调试并连接电脑，或启动 iOS 模拟器/真机 WDA 服务。
        </p>
        <button
          type="button"
          onClick={fetchDevices}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#e3e3e8] hover:bg-[#f4f4f6] rounded-[6px] text-[11.5px] font-medium text-[#27272a] shadow-2xs transition-colors cursor-pointer"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          <span>重新检测设备</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#1c1c1f] overflow-hidden">
      {/* 顶部设备切换条 (多设备时展示) */}
      {allDevices.length > 1 && (
        <div className="h-[32px] bg-[#27272a] px-2.5 flex items-center justify-between border-b border-[#3f3f46]/40 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {allDevices.map((d) => {
              const isSelected = selectedDevice?.serial === d.serial;
              return (
                <button
                  key={d.serial}
                  type="button"
                  onClick={() => setSelectedDevice(d)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#3f3f46] text-white shadow-2xs'
                      : 'text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#3f3f46]/40'
                  }`}
                >
                  {d.platform === 'ios' ? <Apple size={11} /> : <Smartphone size={11} />}
                  <span className="truncate max-w-[100px]">{d.name}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            title="刷新设备列表"
            onClick={fetchDevices}
            className="p-1 rounded text-[#a1a1aa] hover:text-white hover:bg-[#3f3f46] transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

      {/* 设备镜像区域 */}
      <div className="flex-1 w-full min-h-0 flex items-center justify-center">
        {selectedDevice ? (
          <DeviceMirror
            key={`${selectedDevice.platform}-${selectedDevice.serial}`}
            platform={selectedDevice.platform}
            serial={selectedDevice.serial}
            name={selectedDevice.name}
            leases={leases}
            variant="dock"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[12px] text-[#71717a]">
            正在准备设备画面...
          </div>
        )}
      </div>
    </div>
  );
};
