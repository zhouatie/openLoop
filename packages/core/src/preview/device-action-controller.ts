import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DeviceLeasePool } from '../qa/device-lease-pool';
import { IosDeviceManager } from '../qa/ios-device-manager';
import { createLogger } from '../logger';

const execFileAsync = promisify(execFile);
const logger = createLogger('DeviceActionController');

/**
 * 将文本转为 adb shell input text 可安全接收的参数（空格转 %s，关键符号转义）
 */
function toAdbInputText(text: string): string {
  return text.replace(/([\\"'$`&|;<>()\[\]{}*?!#~])|\s/g, (match, special) =>
    special ? `\\${special}` : '%s'
  );
}

export interface DeviceActionPayload {
  type: 'tap' | 'swipe' | 'text' | 'key' | 'launch';
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  ratioX?: number;
  ratioY?: number;
  ratioEndX?: number;
  ratioEndY?: number;
  duration?: number;
  key?: 'back' | 'home' | 'power' | 'enter' | string;
  text?: string;
  appPackage?: string;
}

export interface DeviceActionResult {
  success: boolean;
  message?: string;
  busy?: boolean;
}

export class DeviceActionController {
  private static androidSizeCache = new Map<string, { width: number; height: number }>();

  /**
   * 获取 Android 设备的真实物理屏幕分辨率 (带内存缓存)
   */
  static async getAndroidDeviceSize(serial: string): Promise<{ width: number; height: number }> {
    const key = (serial || '').trim();
    if (key && this.androidSizeCache.has(key)) {
      return this.androidSizeCache.get(key)!;
    }

    try {
      const serialArgs = key ? ['-s', key] : [];
      const { stdout } = await execFileAsync('adb', [...serialArgs, 'shell', 'wm', 'size'], {
        timeout: 3000,
      });
      const overrideMatch = stdout.match(/Override size:\s*(\d+)x(\d+)/i);
      const physicalMatch = stdout.match(/Physical size:\s*(\d+)x(\d+)/i);
      const match = overrideMatch || physicalMatch;
      if (match) {
        const size = { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
        if (key) this.androidSizeCache.set(key, size);
        return size;
      }
    } catch (err: any) {
      logger.warn(`获取 Android 真实物理尺寸失败 (${key}): ${err.message}`);
    }

    return { width: 1080, height: 2400 };
  }

  /**
   * 执行反向控制动作（自带运行态互斥保护）
   */
  static async executeAction(
    platform: 'android' | 'ios',
    targetId: string,
    action: DeviceActionPayload,
    extra?: { wdaEndpoint?: string }
  ): Promise<DeviceActionResult> {
    const cleanId = (targetId || '').trim();

    // 1. 运行态互斥检查：如果自动化任务正在驱动该设备，禁止手动反向操作
    if (cleanId && DeviceLeasePool.isDeviceBusy(cleanId)) {
      const holder = DeviceLeasePool.getHolder(cleanId);
      const holderDesc = holder ? ` (正在执行: ${holder.label})` : '';
      return {
        success: false,
        busy: true,
        message: `设备已被自动化任务锁定占用${holderDesc}，当前仅允许观看，禁止手动交互`,
      };
    }

    if (platform === 'android') {
      return this.executeAndroidAction(cleanId, action);
    } else {
      return this.executeIosAction(cleanId, action, extra?.wdaEndpoint);
    }
  }

  /**
   * Android 平台操作执行 (采用 execFile 隔离参数，防注入防断开)
   */
  private static async executeAndroidAction(
    serial: string,
    action: DeviceActionPayload
  ): Promise<DeviceActionResult> {
    const serialArgs = serial ? ['-s', serial] : [];
    try {
      switch (action.type) {
        case 'tap': {
          let x = Math.round(action.x ?? 0);
          let y = Math.round(action.y ?? 0);

          // 优先基于归一化百分比与物理屏幕分辨率换算，消除因推流降采样导致的触控偏移
          if (typeof action.ratioX === 'number' && typeof action.ratioY === 'number') {
            const realSize = await this.getAndroidDeviceSize(serial);
            x = Math.round(action.ratioX * realSize.width);
            y = Math.round(action.ratioY * realSize.height);
          }

          await execFileAsync('adb', [...serialArgs, 'shell', 'input', 'tap', String(x), String(y)], {
            timeout: 3000,
          });
          return { success: true };
        }

        case 'swipe': {
          let x1 = Math.round(action.x ?? 0);
          let y1 = Math.round(action.y ?? 0);
          let x2 = Math.round(action.endX ?? x1);
          let y2 = Math.round(action.endY ?? y1);

          if (
            typeof action.ratioX === 'number' &&
            typeof action.ratioY === 'number' &&
            typeof action.ratioEndX === 'number' &&
            typeof action.ratioEndY === 'number'
          ) {
            const realSize = await this.getAndroidDeviceSize(serial);
            x1 = Math.round(action.ratioX * realSize.width);
            y1 = Math.round(action.ratioY * realSize.height);
            x2 = Math.round(action.ratioEndX * realSize.width);
            y2 = Math.round(action.ratioEndY * realSize.height);
          }

          const duration = Math.max(100, Math.round(action.duration ?? 300));
          await execFileAsync(
            'adb',
            [...serialArgs, 'shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(duration)],
            { timeout: 4000 }
          );
          return { success: true };
        }

        case 'key': {
          const keyMap: Record<string, number> = {
            back: 4,
            home: 3,
            power: 26,
            enter: 66,
            menu: 82,
            volumeup: 24,
            volumedown: 25,
          };
          const rawKey = (action.key || '').toLowerCase();
          const code = keyMap[rawKey] || 4;
          await execFileAsync('adb', [...serialArgs, 'shell', 'input', 'keyevent', String(code)], {
            timeout: 3000,
          });
          return { success: true };
        }

        case 'text': {
          const text = (action.text || '').trim();
          if (!text) return { success: true };
          const encoded = toAdbInputText(text);
          await execFileAsync('adb', [...serialArgs, 'shell', 'input', 'text', encoded], {
            timeout: 4000,
          });
          return { success: true };
        }

        case 'launch': {
          const pkg = (action.appPackage || '').trim();
          if (!pkg) throw new Error('未提供应用包名');
          await execFileAsync(
            'adb',
            [...serialArgs, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'],
            { timeout: 5000 }
          );
          return { success: true };
        }

        default:
          return { success: false, message: `不支持的操作类型: ${(action as any).type}` };
      }
    } catch (err: any) {
      logger.warn(`[AndroidAction] 执行操作失败 (${serial}, ${action.type}): ${err.message}`);
      return { success: false, message: err.message || '操作执行失败' };
    }
  }

  /**
   * iOS 平台操作执行 (经 WebDriverAgent)
   */
  private static async executeIosAction(
    udid: string,
    action: DeviceActionPayload,
    rawWdaEndpoint?: string
  ): Promise<DeviceActionResult> {
    const endpoint = IosDeviceManager.resolveEndpoint(rawWdaEndpoint);
    try {
      // 1. 获取现有活跃 session
      let sessionId = '';
      const statusRes = await fetch(`${endpoint}/status`);
      if (statusRes.ok) {
        const json: any = await statusRes.json();
        sessionId = json.sessionId || '';
      }

      if (!sessionId) {
        // 请求一个新 session
        const sessionRes = await fetch(`${endpoint}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capabilities: {} }),
        });
        if (sessionRes.ok) {
          const json: any = await sessionRes.json();
          sessionId = json.sessionId || json.value?.sessionId || '';
        }
      }

      const prefix = sessionId ? `${endpoint}/session/${sessionId}` : endpoint;

      switch (action.type) {
        case 'tap': {
          let x = Math.round(action.x ?? 0);
          let y = Math.round(action.y ?? 0);

          if (typeof action.ratioX === 'number' && typeof action.ratioY === 'number') {
            try {
              const sizeRes = await fetch(`${prefix}/window/size`);
              if (sizeRes.ok) {
                const sJson: any = await sizeRes.json();
                const w = sJson.value?.width || 393;
                const h = sJson.value?.height || 852;
                x = Math.round(action.ratioX * w);
                y = Math.round(action.ratioY * h);
              }
            } catch {}
          }

          const res = await fetch(`${prefix}/wda/tap/nil`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x, y }),
          });
          return { success: res.ok };
        }

        case 'swipe': {
          let x1 = Math.round(action.x ?? 0);
          let y1 = Math.round(action.y ?? 0);
          let x2 = Math.round(action.endX ?? x1);
          let y2 = Math.round(action.endY ?? y1);

          if (
            typeof action.ratioX === 'number' &&
            typeof action.ratioY === 'number' &&
            typeof action.ratioEndX === 'number' &&
            typeof action.ratioEndY === 'number'
          ) {
            try {
              const sizeRes = await fetch(`${prefix}/window/size`);
              if (sizeRes.ok) {
                const sJson: any = await sizeRes.json();
                const w = sJson.value?.width || 393;
                const h = sJson.value?.height || 852;
                x1 = Math.round(action.ratioX * w);
                y1 = Math.round(action.ratioY * h);
                x2 = Math.round(action.ratioEndX * w);
                y2 = Math.round(action.ratioEndY * h);
              }
            } catch {}
          }

          const duration = ((action.duration ?? 300) / 1000).toFixed(2);
          const res = await fetch(`${prefix}/wda/dragfromtoforduration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromX: x1, fromY: y1, toX: x2, toY: y2, duration: parseFloat(duration) }),
          });
          return { success: res.ok };
        }

        case 'key': {
          const rawKey = (action.key || '').toLowerCase();
          if (rawKey === 'home') {
            const res = await fetch(`${endpoint}/wda/homescreen`, { method: 'POST' });
            return { success: res.ok };
          }
          // 其他键通过 keys 接口发送
          const res = await fetch(`${prefix}/wda/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: [rawKey] }),
          });
          return { success: res.ok };
        }

        case 'text': {
          const text = (action.text || '').trim();
          if (!text) return { success: true };
          const res = await fetch(`${prefix}/wda/keys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: text.split('') }),
          });
          return { success: res.ok };
        }

        case 'launch': {
          const bundleId = (action.appPackage || '').trim();
          if (!bundleId) throw new Error('未提供 iOS Bundle ID');
          const res = await fetch(`${prefix}/wda/apps/launch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bundleId }),
          });
          return { success: res.ok };
        }

        default:
          return { success: false, message: `不支持的操作类型: ${(action as any).type}` };
      }
    } catch (err: any) {
      logger.warn(`[IosAction] 执行操作失败 (${action.type}): ${err.message}`);
      return { success: false, message: err.message || '操作执行失败' };
    }
  }
}
