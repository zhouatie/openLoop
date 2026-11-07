import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

  /** 解析实际生效的 WDA 地址（用例配置 > 环境变量 > 默认端点） */
  static resolveEndpoint(endpoint?: string): string {
    return this.normalizeEndpoint(endpoint || process.env.MIDSCENE_IOS_WDA_URL);
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

  /** 列出本机全部模拟器（含未启动） */
  static async listSimulators(): Promise<IosDeviceInfo[]> {
    try {
      const { stdout } = await execAsync('xcrun simctl list devices -j', {
        timeout: 8000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout);
      const devices: IosDeviceInfo[] = [];
      for (const [runtime, list] of Object.entries<any[]>(parsed.devices || {})) {
        if (!/iOS/i.test(runtime)) continue;
        const version = runtime.match(/iOS[- ](\d+(?:[-.]\d+)*)/)?.[1]?.replace(/-/g, '.');
        for (const d of list || []) {
          if (!d?.udid) continue;
          const state: IosDeviceInfo['state'] =
            d.state === 'Booted' ? 'booted' : d.state === 'Shutdown' ? 'shutdown' : 'unknown';
          devices.push({
            udid: d.udid,
            name: d.name,
            model: d.name,
            version,
            state,
            isSimulator: true,
          });
        }
      }
      return devices.sort((a, b) => {
        if (a.state !== b.state) return a.state === 'booted' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch (err: any) {
      logger.info(`[IosDeviceManager] 读取全部模拟器失败: ${err.message}`);
      return [];
    }
  }

  /** 启动指定模拟器（已启动时直接返回成功） */
  static async bootSimulator(udid: string): Promise<{ success: boolean; message: string }> {
    const target = (udid || '').trim();
    if (!target) return { success: false, message: '缺少模拟器 UDID' };
    try {
      const { stdout } = await execAsync(`xcrun simctl boot ${target}`, { timeout: 60000 });
      logger.info(`[IosDeviceManager] 已启动模拟器: ${target} ${stdout.trim()}`);
      return { success: true, message: '模拟器正在启动，首次启动约需 20-60 秒' };
    } catch (err: any) {
      const message = String(err?.stderr || err?.message || '启动模拟器失败');
      if (/current state: Booted|already booted|Unable to boot device in current state/i.test(message)) {
        return { success: true, message: '模拟器已在运行' };
      }
      logger.warn(`[IosDeviceManager] 启动模拟器失败: ${message}`);
      return { success: false, message };
    }
  }

  /** 关闭指定模拟器 */
  static async shutdownSimulator(udid: string): Promise<{ success: boolean; message: string }> {
    const target = (udid || '').trim();
    if (!target) return { success: false, message: '缺少模拟器 UDID' };
    try {
      await execAsync(`xcrun simctl shutdown ${target}`, { timeout: 30000 });
      logger.info(`[IosDeviceManager] 已关闭模拟器: ${target}`);
      return { success: true, message: '模拟器已关闭' };
    } catch (err: any) {
      const message = String(err?.stderr || err?.message || '关闭模拟器失败');
      if (/current state: Shutdown|Unable to shutdown device in current state/i.test(message)) {
        return { success: true, message: '模拟器已处于关闭状态' };
      }
      return { success: false, message };
    }
  }

  /** 查找本机的 WebDriverAgent 工程；找不到时返回 null */
  static resolveWdaProject(): string | null {
    const candidates = [
      process.env.OPENLOOP_WDA_PROJECT,
      path.join(os.homedir(), 'WebDriverAgent', 'WebDriverAgent.xcodeproj'),
      path.join(os.homedir(), '.openloop', 'webdriveragent', 'WebDriverAgent.xcodeproj'),
      path.join(os.homedir(), 'appium-webdriveragent', 'WebDriverAgent.xcodeproj'),
    ];
    for (const candidate of candidates) {
      if (candidate && existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** 是否有针对该设备的 xcodebuild WDA 进程在跑 */
  private static async hasRunningWda(udid: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('ps -ax -o command=', { timeout: 5000 });
      return stdout
        .split('\n')
        .some((line) => line.includes('WebDriverAgentRunner') && line.includes(udid));
    } catch {
      return false;
    }
  }

  /**
   * 构建并启动 WebDriverAgentRunner（后台运行，日志写入 ~/.openloop/logs）
   * 首次需要 clone 工程并编译，通常 1-3 分钟；启动后 WDA 监听 8100，MJPEG 9100。
   */
  static async launchWebDriverAgent(udid: string): Promise<{ success: boolean; message: string }> {
    if (process.platform !== 'darwin') {
      return { success: false, message: 'WebDriverAgent 只能在 macOS 上运行' };
    }
    const target = (udid || '').trim();
    if (!target) return { success: false, message: '缺少模拟器 UDID' };

    if (await this.hasRunningWda(target)) {
      return { success: true, message: 'WebDriverAgent 正在启动中，请稍候' };
    }

    let project = this.resolveWdaProject();
    if (!project) {
      const cloneDir = path.join(os.homedir(), '.openloop', 'webdriveragent');
      try {
        mkdirSync(path.dirname(cloneDir), { recursive: true });
        logger.info(`[IosDeviceManager] 未找到 WebDriverAgent 工程，克隆到 ${cloneDir}`);
        await execAsync(
          `git clone --depth 1 https://github.com/appium/WebDriverAgent.git "${cloneDir}"`,
          { timeout: 180000 }
        );
        project = this.resolveWdaProject();
      } catch (err: any) {
        return {
          success: false,
          message: `自动获取 WebDriverAgent 失败：${err?.message || '未知错误'}。可手动执行 git clone https://github.com/appium/WebDriverAgent.git ~/.openloop/webdriveragent`,
        };
      }
    }
    if (!project) {
      return { success: false, message: '未找到 WebDriverAgent.xcodeproj' };
    }

    try {
      const logDir = path.join(os.homedir(), '.openloop', 'logs');
      mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, `wda-${target}.log`);
      const logFd = openSync(logPath, 'a');
      const child = spawn(
        'xcodebuild',
        [
          '-project',
          project,
          '-scheme',
          'WebDriverAgentRunner',
          '-destination',
          `platform=iOS Simulator,id=${target}`,
          'test',
        ],
        { detached: true, stdio: ['ignore', logFd, logFd] }
      );
      child.unref();
      logger.info(`[IosDeviceManager] 已启动 WebDriverAgent 构建: ${target} 日志 ${logPath}`);
      return {
        success: true,
        message: '正在构建并启动 WebDriverAgent，首次约 1-3 分钟，就绪后画面会自动切到流畅串流',
      };
    } catch (err: any) {
      return { success: false, message: err?.message || '启动 WebDriverAgent 失败' };
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
    const allSimulators = await this.listSimulators();
    return { environment, wda, simulators, allSimulators };
  }
}
