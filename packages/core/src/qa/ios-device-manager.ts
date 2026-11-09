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
  /** simctl 列表缓存：多个面板并发轮询时只跑一次 xcrun */
  private static simctlCache: { at: number; booted: IosDeviceInfo[]; all: IosDeviceInfo[] } | null = null;
  private static simctlInflight: Promise<{ ok: boolean; booted: IosDeviceInfo[]; all: IosDeviceInfo[] }> | null =
    null;
  /** 快照缓存：5s/8s/20s 三个轮询源合并成一次真实探测 */
  private static snapshotCache: { at: number; endpoint: string; value: IosDevicesSnapshot } | null = null;
  private static snapshotInflight: Promise<IosDevicesSnapshot> | null = null;
  private static readonly SIMCTL_TTL_MS = 1200;
  private static readonly SNAPSHOT_TTL_MS = 1200;

  /** 启停模拟器后主动失效，避免读到旧状态 */
  static invalidateCache(): void {
    this.simctlCache = null;
    this.snapshotCache = null;
  }
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

  /** 单次取回全部模拟器（booted + all），带 1.2s 缓存与单飞行合并 */
  private static async loadSimulators(): Promise<{
    ok: boolean;
    booted: IosDeviceInfo[];
    all: IosDeviceInfo[];
  }> {
    const cached = this.simctlCache;
    if (cached && Date.now() - cached.at < this.SIMCTL_TTL_MS) {
      return { ok: true, booted: cached.booted, all: cached.all };
    }
    if (this.simctlInflight) return this.simctlInflight;

    this.simctlInflight = (async () => {
      try {
        const { stdout } = await execAsync('xcrun simctl list devices -j', {
          timeout: 8000,
          maxBuffer: 8 * 1024 * 1024,
        });
        const { booted, all } = this.parseSimulators(JSON.parse(stdout));
        this.simctlCache = { at: Date.now(), booted, all };
        return { ok: true, booted, all };
      } catch (err: any) {
        logger.info(`[IosDeviceManager] 读取模拟器列表失败: ${err.message}`);
        return { ok: false, booted: [], all: [] };
      } finally {
        this.simctlInflight = null;
      }
    })();
    return this.simctlInflight;
  }

  private static parseSimulators(parsed: any): { booted: IosDeviceInfo[]; all: IosDeviceInfo[] } {
    const booted: IosDeviceInfo[] = [];
    const all: IosDeviceInfo[] = [];
    for (const [runtime, list] of Object.entries<any[]>(parsed?.devices || {})) {
      const version = runtime.match(/iOS[- ](\d+(?:[-.]\d+)*)/)?.[1]?.replace(/-/g, '.');
      const isIos = /iOS/i.test(runtime);
      for (const d of list || []) {
        if (!d?.udid) continue;
        if (d.state === 'Booted') {
          booted.push({
            udid: d.udid,
            name: d.name,
            model: d.name,
            version,
            state: 'booted',
            isSimulator: true,
          });
        }
        if (!isIos) continue;
        const state: IosDeviceInfo['state'] =
          d.state === 'Booted' ? 'booted' : d.state === 'Shutdown' ? 'shutdown' : 'unknown';
        all.push({
          udid: d.udid,
          name: d.name,
          model: d.name,
          version,
          state,
          isSimulator: true,
        });
      }
    }
    all.sort((a, b) => {
      if (a.state !== b.state) return a.state === 'booted' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { booted, all };
  }

  /** 检查 iOS 自动化运行环境（仅 macOS + Xcode 可用） */
  static async checkEnvironment(): Promise<{ available: boolean; message?: string }> {
    if (process.platform !== 'darwin') {
      return { available: false, message: 'iOS 自动化仅支持 macOS（需 Xcode 与 WebDriverAgent）' };
    }
    const result = await this.loadSimulators();
    if (result.ok) return { available: true };
    return { available: false, message: '未检测到 Xcode 命令行工具，请执行 xcode-select --install' };
  }

  /** 列出已启动的 iOS 模拟器 */
  static async getBootedSimulators(): Promise<IosDeviceInfo[]> {
    return (await this.loadSimulators()).booted;
  }

  /** 列出本机全部模拟器（含未启动） */
  static async listSimulators(): Promise<IosDeviceInfo[]> {
    return (await this.loadSimulators()).all;
  }

  /** 启动指定模拟器（已启动时直接返回成功） */
  static async bootSimulator(udid: string): Promise<{ success: boolean; message: string }> {
    const target = (udid || '').trim();
    if (!target) return { success: false, message: '缺少模拟器 UDID' };
    try {
      const { stdout } = await execAsync(`xcrun simctl boot ${target}`, { timeout: 60000 });
      logger.info(`[IosDeviceManager] 已启动模拟器: ${target} ${stdout.trim()}`);
      this.invalidateCache();
      return { success: true, message: '模拟器正在启动，首次启动约需 20-60 秒' };
    } catch (err: any) {
      const message = String(err?.stderr || err?.message || '启动模拟器失败');
      if (/current state: Booted|already booted|Unable to boot device in current state/i.test(message)) {
        this.invalidateCache();
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
      this.invalidateCache();
      return { success: true, message: '模拟器已关闭' };
    } catch (err: any) {
      const message = String(err?.stderr || err?.message || '关闭模拟器失败');
      if (/current state: Shutdown|Unable to shutdown device in current state/i.test(message)) {
        this.invalidateCache();
        return { success: true, message: '模拟器已处于关闭状态' };
      }
      return { success: false, message };
    }
  }

  /** 在模拟器原生窗口打开并聚焦指定模拟器 */
  static async openSimulatorWindow(udid: string): Promise<{ success: boolean; message: string }> {
    const target = (udid || '').trim();
    if (!target) return { success: false, message: '缺少模拟器 UDID' };
    const boot = await this.bootSimulator(target);
    if (!boot.success) return boot;
    const appPath = await this.resolveSimulatorApp();
    try {
      // open -a 走 LaunchServices，索引缺失时会报找不到应用；拿到绝对路径后按路径打开更稳
      await execAsync(appPath ? `open -a "${appPath}"` : 'open -a "Device Hub" || open -a Simulator', {
        timeout: 15000,
      });
      logger.info(`[IosDeviceManager] 已打开模拟器窗口: ${target} (${appPath || 'LaunchServices'})`);
      return { success: true, message: '已在模拟器窗口中打开' };
    } catch (err: any) {
      const message = String(err?.stderr || err?.message || '打开模拟器窗口失败').trim();
      logger.warn(`[IosDeviceManager] 打开模拟器窗口失败: ${message}`);
      return { success: false, message };
    }
  }

  /** 解析本机模拟器 UI 应用路径：Xcode 27 起为 Device Hub，早期版本为 Simulator.app */
  private static async resolveSimulatorApp(): Promise<string | null> {
    let developerDir = '';
    try {
      const { stdout } = await execAsync('xcode-select -p', { timeout: 5000 });
      developerDir = stdout.trim();
    } catch {
      /* 未安装命令行工具时按默认路径兜底 */
    }
    const candidates = [
      developerDir && path.join(developerDir, 'Applications/Simulator.app'),
      developerDir && path.join(developerDir, 'Applications/DeviceHub.app'),
      '/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app',
      '/Applications/Xcode.app/Contents/Applications/Simulator.app',
      '/Applications/Xcode.app/Contents/Applications/DeviceHub.app',
    ].filter(Boolean) as string[];
    return candidates.find((candidate) => existsSync(candidate)) || null;
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

  /** 汇总 iOS 现场快照：环境、WDA 连接、已启动模拟器（缓存 + 单飞行合并并发轮询） */
  static async getSnapshot(endpoint?: string): Promise<IosDevicesSnapshot> {
    const key = this.normalizeEndpoint(endpoint);
    const cached = this.snapshotCache;
    if (cached && cached.endpoint === key && Date.now() - cached.at < this.SNAPSHOT_TTL_MS) {
      return cached.value;
    }
    if (this.snapshotInflight) return this.snapshotInflight;

    this.snapshotInflight = (async () => {
      try {
        const simulators = await this.getBootedSimulators();
        const [environment, wda] = await Promise.all([
          this.checkEnvironment(),
          this.probeWda(endpoint, simulators),
        ]);
        const allSimulators = await this.listSimulators();
        const value: IosDevicesSnapshot = { environment, wda, simulators, allSimulators };
        this.snapshotCache = { at: Date.now(), endpoint: key, value };
        return value;
      } finally {
        this.snapshotInflight = null;
      }
    })();
    return this.snapshotInflight;
  }
}
