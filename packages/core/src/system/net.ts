/**
 * 本机网络地址探测：开发服务靶机需要把局域网地址交给手机端扫码访问。
 */
import os from 'node:os';

/** 链路本地地址（169.254.x.x）仅限同一链路，手机不可达 */
const isLinkLocal = (ip: string): boolean => ip.startsWith('169.254.');

/** 私有网段优先，公网网卡（如 VPN 出口）次之 */
const isPrivate = (ip: string): boolean =>
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/** 取本机首个可被同一局域网设备访问的 IPv4 地址，无可用网卡时返回 null */
export function getLanIpv4(): string | null {
  const candidates: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family !== 'IPv4' || info.internal || isLinkLocal(info.address)) continue;
      candidates.push(info.address);
    }
  }
  return candidates.find(isPrivate) ?? candidates[0] ?? null;
}
