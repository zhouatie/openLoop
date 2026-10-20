import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { AndroidDeviceInfo } from '../types';
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

function isEmulatorSerial(serial: string): boolean {
  return serial.startsWith('emulator-') || serial.includes('127.0.0.1') || serial.includes('localhost');
}
