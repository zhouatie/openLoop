import { IosDeviceInfo } from '@openloop/core';

/**
 * 同名模拟器只保留一台（已启动优先，其次系统版本更高的），并让已启动的排在前面
 */
export const dedupeSimulators = (list: IosDeviceInfo[]): IosDeviceInfo[] => {
  const byName = new Map<string, IosDeviceInfo>();
  for (const device of list) {
    const existing = byName.get(device.name);
    if (!existing) {
      byName.set(device.name, device);
      continue;
    }
    if (existing.state !== 'booted' && device.state === 'booted') {
      byName.set(device.name, device);
      continue;
    }
    if (existing.state === device.state) {
      const a = Number((existing.version || '0').split('.').slice(0, 2).join('') || 0);
      const b = Number((device.version || '0').split('.').slice(0, 2).join('') || 0);
      if (b > a) byName.set(device.name, device);
    }
  }
  return [...byName.values()].sort((a, b) => {
    // 机型档位：iPhone 优先，其次 iPad，其余（TV/Watch）最后
    const rank = (name: string) => (/iphone/i.test(name) ? 0 : /ipad/i.test(name) ? 1 : 2);
    const rankDiff = rank(a.name) - rank(b.name);
    if (rankDiff !== 0) return rankDiff;
    if (a.state !== b.state) return a.state === 'booted' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
};
