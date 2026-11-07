import { exec, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { AndroidDeviceInfo, RunningEmulatorInfo } from '../types';
import { createLogger } from '../logger';

const execAsync = promisify(exec);
const logger = createLogger('AndroidDeviceManager');

export class AndroidDeviceManager {
  /**
   * 检查系统 ADB 工具是否可用
   */
  static async isAdbAvailable(): Promise<boolean> {
    try {
      await execAsync('adb version', { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取所有已连接的 Android 设备与模拟器列表
   */
  static async getDevices(): Promise<AndroidDeviceInfo[]> {
    const devices = new Map<string, AndroidDeviceInfo>();

    // 优先使用 @midscene/android 的设备探针（内置 ANDROID_HOME 与 adb 路径解析）
    try {
      const midsceneAndroid = await import('@midscene/android');
      const midDevices = await midsceneAndroid.getConnectedDevicesWithDetails();
      for (const d of midDevices || []) {
        const serial = (d as any).udid || (d as any).serial;
        if (!serial) continue;
        const isEmulator = isEmulatorSerial(serial);
        devices.set(serial, {
          serial,
          model: (d as any).model || (isEmulator ? 'Android 模拟器' : 'Android 设备'),
          version: (d as any).osVersion || (d as any).platformVersion,
          status: (d as any).status === 'unauthorized' ? 'unauthorized' : 'device',
          isEmulator,
        });
      }
    } catch (err: any) {
      logger.info(`[@midscene/android] 原生设备探针跳过，转入 ADB 探针: ${err.message}`);
    }

    // 用 adb devices -l 补齐未授权、离线设备与设备型号信息
    try {
      const { stdout } = await execAsync('adb devices -l', { timeout: 5000 });
      const lines = stdout.split('\n').filter((l) => l.trim() && !l.startsWith('List'));

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        const serial = parts[0];
        const statusRaw = parts[1];
        const status: AndroidDeviceInfo['status'] =
          statusRaw === 'device' ? 'device' : statusRaw === 'unauthorized' ? 'unauthorized' : 'offline';
        const isEmulator = isEmulatorSerial(serial);
        const modelMatch = line.match(/model:([^\s]+)/);
        const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : undefined;

        const existing = devices.get(serial);
        if (existing) {
          existing.status = status;
          if (model) existing.model = model;
        } else {
          devices.set(serial, {
            serial,
            model: model || (isEmulator ? 'Android 模拟器' : 'Android 设备'),
            status,
            isEmulator,
          });
        }
      }
    } catch (err: any) {
      logger.warn(`[AndroidDeviceManager] 执行 adb devices -l 失败: ${err.message}`);
    }

    return Array.from(devices.values());
  }

  /**
   * 打开设备镜像窗口 (scrcpy)，用于本地直接观看靶机实机画面
   */
  static async openMirror(serial?: string): Promise<{ success: boolean; message: string }> {
    const args = [
      ...(serial ? ['--serial', serial] : []),
      '--max-size=1024',
      '--window-title=openLoop 验收设备',
    ];

    return new Promise((resolve) => {
      let settled = false;
      const done = (payload: { success: boolean; message: string }) => {
        if (settled) return;
        settled = true;
        resolve(payload);
      };

      try {
        const child = spawn('scrcpy', args, { detached: true, stdio: 'ignore' });
        child.once('error', (err: any) => {
          if (err?.code === 'ENOENT') {
            logger.warn('[AndroidDeviceManager] 未检测到 scrcpy，无法打开设备镜像');
            done({ success: false, message: '未检测到 scrcpy，请先安装: brew install scrcpy' });
            return;
          }
          logger.warn(`[AndroidDeviceManager] 打开设备镜像失败: ${err?.message}`);
          done({ success: false, message: `打开设备镜像失败: ${err?.message || '未知异常'}` });
        });
        child.once('spawn', () => {
          child.unref();
          logger.info(`[AndroidDeviceManager] 已打开设备镜像窗口 (设备: ${serial || '首个在线设备'})`);
          done({ success: true, message: '已打开设备镜像窗口' });
        });
      } catch (err: any) {
        done({ success: false, message: `打开设备镜像失败: ${err?.message || '未知异常'}` });
      }
    });
  }

  /**
   * 获取指定设备当前处于前台焦点的应用包名与 Activity
   */
  static async getCurrentForegroundApp(serial?: string): Promise<{ packageName: string; activityName?: string } | null> {
    const targetFlag = serial ? `-s ${serial}` : '';
    try {
      // 通过 dumpsys window 匹配 mCurrentFocus / mFocusedApp / mTopActivity
      const { stdout } = await execAsync(
        `adb ${targetFlag} shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp|mTopActivity'"`,
        { timeout: 3000 }
      );
      // 匹配形如 com.android.chrome/com.google.android.apps.chrome.Main 或 com.example.app/.MainActivity
      const match = stdout.match(/([a-zA-Z0-9._]+)\/([a-zA-Z0-9._]+)/);
      if (match) {
        const packageName = match[1];
        let activityName = match[2];
        if (activityName.startsWith('.')) {
          activityName = `${packageName}${activityName}`;
        }
        return { packageName, activityName };
      }
    } catch (err: any) {
      logger.debug(`[AndroidDeviceManager] 获取前台 App 失败: ${err.message}`);
    }
    return null;
  }

  /**
   * 列出本机正在运行的模拟器进程（在开机中的也会列出）
   */
  static async getRunningEmulators(): Promise<RunningEmulatorInfo[]> {
    let processes: { pid: number; uptimeSeconds: number; avd: string }[] = [];
    try {
      const { stdout } = await execAsync('ps -ax -o pid=,etime=,command=', { timeout: 5000 });
      for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line.includes('-avd ')) continue;
        if (!line.includes('qemu-system') && !line.includes('/emulator/')) continue;
        const match = line.match(/^(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) continue;
        const avd = match[3].match(/-avd\s+(\S+)/)?.[1];
        if (!avd) continue;
        processes.push({
          pid: Number(match[1]),
          uptimeSeconds: parseElapsedSeconds(match[2]),
          avd,
        });
      }
    } catch (err: any) {
      logger.warn(`[AndroidDeviceManager] 读取模拟器进程失败: ${err?.message}`);
      return [];
    }

    if (processes.length === 0) return [];

    // 已开机的模拟器通过 AVD 名称与 adb 串号对齐
    const serialByAvd = new Map<string, string>();
    try {
      const { stdout } = await execAsync('adb devices', { timeout: 5000 });
      const serials = stdout
        .split('\n')
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((serial) => serial && serial.startsWith('emulator-'));
      for (const serial of serials) {
        try {
          const { stdout: avdName } = await execAsync(
            `adb -s ${serial} shell getprop ro.boot.qemu.avd_name`,
            { timeout: 4000 }
          );
          const name = avdName.trim();
          if (name && !serialByAvd.has(name)) serialByAvd.set(name, serial);
        } catch {
          /* 仍在开机中，取不到属性属正常 */
        }
      }
    } catch (err: any) {
      logger.debug(`[AndroidDeviceManager] 对齐模拟器串号失败: ${err?.message}`);
    }

    return processes
      .map((item) => {
        const serial = serialByAvd.get(item.avd);
        return {
          platform: 'android' as const,
          key: `android-${item.pid}`,
          name: item.avd,
          pid: item.pid,
          serial,
          uptimeSeconds: item.uptimeSeconds,
          state: serial ? ('booted' as const) : ('starting' as const),
        };
      })
      .sort((a, b) => (a.pid || 0) - (b.pid || 0));
  }

  /**
   * 停止本机模拟器：已就绪走 adb emu kill，其余直接结束进程
   */
  static async stopEmulator(target: {
    pid?: number;
    serial?: string;
  }): Promise<{ success: boolean; message: string }> {
    if (target?.serial) {
      try {
        const { stdout } = await execAsync(`adb -s ${target.serial} emu kill`, { timeout: 8000 });
        return { success: true, message: stdout.trim() || `已请求关闭 ${target.serial}` };
      } catch (err: any) {
        logger.warn(`[AndroidDeviceManager] adb emu kill 失败: ${err?.message}`);
        if (!target?.pid) {
          return { success: false, message: err?.message || '关闭模拟器失败' };
        }
      }
    }

    if (!target?.pid) {
      return { success: false, message: '缺少模拟器进程号' };
    }

    try {
      process.kill(target.pid, 'SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try {
        process.kill(target.pid, 0);
        process.kill(target.pid, 'SIGKILL');
      } catch {
        /* 已退出 */
      }
      logger.info(`[AndroidDeviceManager] 已停止模拟器进程: ${target.pid}`);
      return { success: true, message: '模拟器已停止' };
    } catch (err: any) {
      return { success: false, message: err?.message || '停止模拟器失败' };
    }
  }

  /**
   * 通过 WiFi ADB 连接远程设备 (如 192.168.1.100:5555)
   */
  static async connectWifiDevice(ipPort: string): Promise<{ success: boolean; message: string }> {
    const cleanAddress = ipPort.trim();
    if (!cleanAddress) {
      return { success: false, message: '设备地址不能为空' };
    }
    const finalAddress = cleanAddress.includes(':') ? cleanAddress : `${cleanAddress}:5555`;

    try {
      logger.info(`[AndroidDeviceManager] 尝试 WiFi ADB 连接: ${finalAddress}`);
      const { stdout } = await execAsync(`adb connect ${finalAddress}`, { timeout: 10000 });
      const output = stdout.trim();
      const success = output.includes('connected to') && !output.includes('unable to connect') && !output.includes('failed to connect');
      return { success, message: output || '连接超时或被拒绝' };
    } catch (err: any) {
      return { success: false, message: err.message || 'ADB 连接异常' };
    }
  }

  /**
   * 解析本地 Android SDK 中的 emulator 可执行文件路径
   */
  static resolveEmulatorBinary(): string | null {
    const candidates: string[] = [];
    for (const envKey of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
      const root = process.env[envKey];
      if (root) candidates.push(path.join(root, 'emulator', 'emulator'));
    }
    const home = os.homedir();
    candidates.push(
      path.join(home, 'Library/Android/sdk/emulator/emulator'),
      path.join(home, 'Android/Sdk/emulator/emulator'),
      '/usr/local/share/android-sdk/emulator/emulator',
      '/opt/homebrew/share/android-sdk/emulator/emulator'
    );
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  /**
   * 列出本机已创建的 Android 虚拟设备（AVD）
   */
  static async listAvds(): Promise<{ available: boolean; avds: string[]; message?: string }> {
    const binary = AndroidDeviceManager.resolveEmulatorBinary();
    if (!binary) {
      return {
        available: false,
        avds: [],
        message: '未找到 Android emulator，请先安装 Android Studio 或命令行 SDK 工具',
      };
    }
    try {
      const { stdout } = await execAsync(`"${binary}" -list-avds`, { timeout: 8000 });
      const avds = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('INFO'));
      return { available: true, avds };
    } catch (err: any) {
      logger.warn(`[AndroidDeviceManager] 读取 AVD 列表失败: ${err?.message}`);
      return { available: false, avds: [], message: err?.message || '读取 AVD 列表失败' };
    }
  }

  /**
   * 启动本地 Android 模拟器（后台脱离父进程，启动后由设备轮询自动发现）
   */
  static async launchEmulator(
    avdName: string,
    options: { showWindow?: boolean } = {}
  ): Promise<{ success: boolean; message: string }> {
    const name = avdName.trim();
    if (!name) {
      return { success: false, message: '模拟器名称不能为空' };
    }

    const binary = AndroidDeviceManager.resolveEmulatorBinary();
    if (!binary) {
      return { success: false, message: '未找到 Android emulator，请先安装 Android Studio 或命令行 SDK 工具' };
    }

    const existing = (await AndroidDeviceManager.getDevices()).find((d) => d.isEmulator && d.status === 'device');
    if (existing) {
      return { success: true, message: `已有模拟器在线 (${existing.serial})，无需重复启动` };
    }

    return new Promise((resolve) => {
      let settled = false;
      const done = (payload: { success: boolean; message: string }) => {
        if (settled) return;
        settled = true;
        resolve(payload);
      };

      try {
        // 默认无窗口：画面通过 openLoop 镜像观看，避免出现第二个画面窗口
        const args = ['-avd', name, '-netdelay', 'none', '-netspeed', 'full'];
        if (!options.showWindow) args.push('-no-window');
        const child = spawn(binary, args, {
          detached: true,
          stdio: 'ignore',
        });
        child.once('error', (err: any) => {
          logger.warn(`[AndroidDeviceManager] 启动模拟器失败: ${err?.message}`);
          done({ success: false, message: `启动模拟器失败: ${err?.message || '未知异常'}` });
        });
        child.once('spawn', () => {
          child.unref();
          logger.info(`[AndroidDeviceManager] 已启动模拟器: ${name} (${options.showWindow ? '带窗口' : '无窗口'})`);
          done({ success: true, message: `正在启动 ${name}，首次开机约需 20-60 秒` });
        });
      } catch (err: any) {
        done({ success: false, message: `启动模拟器失败: ${err?.message || '未知异常'}` });
      }
    });
  }

  /**
   * 断开 WiFi ADB 远程设备
   */
  static async disconnectWifiDevice(ipPort: string): Promise<{ success: boolean; message: string }> {
    try {
      const { stdout } = await execAsync(`adb disconnect ${ipPort.trim()}`, { timeout: 5000 });
      return { success: true, message: stdout.trim() };
    } catch (err: any) {
      return { success: false, message: err.message || '断开连接异常' };
    }
  }
}

/** 把 ps 的 etime（MM:SS / HH:MM:SS / D-HH:MM:SS）换算成秒 */
function parseElapsedSeconds(etime: string): number {
  const [daysPart, clockPart] = etime.includes('-') ? etime.split('-') : ['0', etime];
  const days = Number(daysPart) || 0;
  const segments = clockPart.split(':').map((seg) => Number(seg) || 0);
  while (segments.length < 3) segments.unshift(0);
  const [hours, minutes, seconds] = segments.slice(-3);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function isEmulatorSerial(serial: string): boolean {
  return serial.startsWith('emulator-') || serial.includes('127.0.0.1') || serial.includes('localhost');
}
