import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { IosDeviceInfo, IosDevicesSnapshot, IosWdaStatus } from '../types';
import { createLogger } from '../logger';

const execAsync = promisify(exec);
const logger = createLogger('IosDeviceManager');

/** WebDriverAgent 默认监听地址 */
export const DEFAULT_WDA_ENDPOINT = 'http://localhost:8100';

/**
 * iOS 设备与 WebDriverAgent 管理器
 * iOS 自动化通过 WebDriverAgent（WDA）驱动，一个 WDA 端点对应一台设备。
 */
export class IosDeviceManager {
  /** 规范化用户填写的 WDA 地址，缺省协议与端口时自动补齐 */
  static normalizeEndpoint(endpoint?: string): string {
    const raw = (endpoint || '').trim().replace(/\/+$/, '');
    if (!raw) return DEFAULT_WDA_ENDPOINT;
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    try {
      const url = new URL(withProtocol);
      if (!url.port) url.port = '8100';
      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch {
      return DEFAULT_WDA_ENDPOINT;
    }
  }

  /** 检查 iOS 自动化运行环境（仅 macOS + Xcode 可用） */
  static async checkEnvironment(): Promise<{ available: boolean; message?: string }> {
    if (process.platform !== 'darwin') {
      return { available: false, message: 'iOS 自动化仅支持 macOS（需 Xcode 与 WebDriverAgent）' };
    }
    try {
      await execAsync('xcrun simctl list devices -j', { timeout: 8000 });
      return { available: true };
    } catch (err: any) {
      logger.info(`[IosDeviceManager] Xcode 命令行工具不可用: ${err.message}`);
      return { available: false, message: '未检测到 Xcode 命令行工具，请执行 xcode-select --install' };
    }
  }

  /** 列出已启动的 iOS 模拟器 */
  static async getBootedSimulators(): Promise<IosDeviceInfo[]> {
    try {
      const { stdout } = await execAsync('xcrun simctl list devices booted -j', {
        timeout: 8000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout);
      const devices: IosDeviceInfo[] = [];
      for (const [runtime, list] of Object.entries<any[]>(parsed.devices || {})) {
        const version = runtime.match(/iOS[- ](\d+(?:[-.]\d+)*)/)?.[1]?.replace(/-/g, '.');
        for (const d of list || []) {
          if (d.state !== 'Booted') continue;
          devices.push({
            udid: d.udid,
            name: d.name,
            model: d.name,
            version,
            state: 'booted',
            isSimulator: true,
          });
        }
      }
      return devices;
    } catch (err: any) {
      logger.info(`[IosDeviceManager] 读取模拟器列表失败: ${err.message}`);
      return [];
    }
  }

  /** 探测 WDA 端点连通性与对应设备信息 */
  static async probeWda(endpoint?: string, bootedSimulators?: IosDeviceInfo[]): Promise<IosWdaStatus> {
    const target = this.normalizeEndpoint(endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(`${target}/status`, { signal: controller.signal });
      if (!res.ok) {
        return { reachable: false, endpoint: target, message: `WebDriverAgent 返回 HTTP ${res.status}` };
      }
      const payload: any = await res.json();
      const value = payload?.value || {};
      const deviceName: string | undefined = value.device;
      const isSimulator = Boolean(value.ios?.simulator);
      // WDA /status 不含 UDID，用同名的已启动模拟器补齐设备标识
      const simulators = isSimulator ? bootedSimulators || (await this.getBootedSimulators()) : [];
      const matched = simulators.find((s) => s.name === deviceName) || simulators[0];
      return {
        reachable: true,
        endpoint: target,
        udid: matched?.udid,
        deviceName: deviceName || matched?.name,
        isSimulator,
      };
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? '连接超时' : err?.message || '连接失败';
      logger.info(`[IosDeviceManager] WDA 端不可达 (${target}): ${reason}`);
      return {
        reachable: false,
        endpoint: target,
        message: `${reason}，请先启动 WebDriverAgent（iOS 模拟器可用 Xcode 运行 WebDriverAgentRunner）`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 汇总 iOS 现场快照：环境、WDA 连接、已启动模拟器 */
  static async getSnapshot(endpoint?: string): Promise<IosDevicesSnapshot> {
    const simulators = await this.getBootedSimulators();
    const [environment, wda] = await Promise.all([
      this.checkEnvironment(),
      this.probeWda(endpoint, simulators),
    ]);
    return { environment, wda, simulators };
  }
}
