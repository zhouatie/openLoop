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

/**
 * 把字符串包成设备端 shell 的单引号参数，内部的单引号按 '\'' 断开转义
 */
function quoteForDeviceShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 把 am start / simctl 的多行报错压成一句可读提示
 */
function summarizeOpenUrlError(raw: string, platform: 'android' | 'ios'): string {
  const text = String(raw || '');
  if (/unable to resolve|No Activity found/i.test(text)) {
    return '设备上没有能打开该链接的 App';
  }
  if (platform === 'ios' && /LSApplicationWorkspaceErrorDomain|failed to open/i.test(text)) {
    return '模拟器上没有能打开该链接的 App';
  }
  const firstLine = text.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('Command failed:'));
  return firstLine || '打开链接失败';
}

export interface DeviceActionPayload {
  type: 'tap' | 'swipe' | 'text' | 'key' | 'launch' | 'openUrl';
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
  /** 目标链接：网页地址或应用深链（如 orpheus://…） */
  url?: string;
}

export interface DeviceActionResult {
  success: boolean;
  message?: string;
  busy?: boolean;
}

export class DeviceActionController {
  private static androidSizeCache = new Map<string, { width: number; height: number }>();
  /**
   * WDA 会话与窗口尺寸缓存。
   * 每次动作都重新探测会让一次点击白等两次往返（约 0.2s），是镜像「点了半天才动」的主因之一。
   */
  private static wdaSessions = new Map<string, { sessionId: string; at: number }>();
  private static wdaWindows = new Map<string, { width: number; height: number; at: number }>();
  private static readonly WDA_CACHE_TTL_MS = 60_000;

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

        case 'openUrl': {
          const url = (action.url || '').trim();
          if (!url) throw new Error('未提供链接');
          try {
            // 整条命令作为单一参数下发，避免链接里的 & 被设备端 shell 截断
            await execFileAsync(
              'adb',
              [...serialArgs, 'shell', `am start -a android.intent.action.VIEW -d ${quoteForDeviceShell(url)}`],
              { timeout: 8000 }
            );
            return { success: true };
          } catch (err: any) {
            throw new Error(summarizeOpenUrlError(err?.stderr || err?.message, 'android'));
          }
        }

        default:
          return { success: false, message: `不支持的操作类型: ${(action as any).type}` };
      }
    } catch (err: any) {
      logger.warn(`[AndroidAction] 执行操作失败 (${serial}, ${action.type}): ${err.message}`);
      return { success: false, message: err.message || '操作执行失败' };
    }
  }

  /** 取 WDA 会话 id：命中缓存直接用，过期才探测一次 */
  private static async resolveWdaSession(endpoint: string): Promise<string> {
    const cached = this.wdaSessions.get(endpoint);
    if (cached && Date.now() - cached.at < this.WDA_CACHE_TTL_MS) return cached.sessionId;

    let sessionId = '';
    try {
      const statusRes = await fetch(`${endpoint}/status`);
      if (statusRes.ok) {
        const json: any = await statusRes.json();
        sessionId = json.sessionId || '';
      }
    } catch (err: any) {
      logger.warn(`[IosAction] 读取 WDA 状态失败 (${endpoint}): ${err?.message}`);
    }

    if (!sessionId) {
      // 没有活跃会话时请求一个
      try {
        const sessionRes = await fetch(`${endpoint}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capabilities: {} }),
        });
        if (sessionRes.ok) {
          const json: any = await sessionRes.json();
          sessionId = json.sessionId || json.value?.sessionId || '';
        }
      } catch (err: any) {
        logger.warn(`[IosAction] 创建 WDA 会话失败 (${endpoint}): ${err?.message}`);
      }
    }

    if (sessionId) this.wdaSessions.set(endpoint, { sessionId, at: Date.now() });
    return sessionId;
  }

  /** 取 WDA 窗口尺寸（比例换算用）：同一台设备尺寸不变，缓存即可 */
  private static async resolveWdaWindow(
    endpoint: string,
    prefix: string
  ): Promise<{ width: number; height: number }> {
    const cached = this.wdaWindows.get(endpoint);
    if (cached && Date.now() - cached.at < this.WDA_CACHE_TTL_MS) {
      return { width: cached.width, height: cached.height };
    }

    const fallback = { width: 393, height: 852 };
    try {
      const sizeRes = await fetch(`${prefix}/window/size`);
      if (sizeRes.ok) {
        const json: any = await sizeRes.json();
        const size = {
          width: json.value?.width || fallback.width,
          height: json.value?.height || fallback.height,
        };
        this.wdaWindows.set(endpoint, { ...size, at: Date.now() });
        return size;
      }
    } catch {
      /* 尺寸拿不到时用默认值，不阻塞动作 */
    }
    return fallback;
  }

  /**
   * 点按：优先 W3C actions（比 /wda/tap 少约 0.13s 合成开销），老版本 WDA 不支持时回落到 /wda/tap。
   */
  private static async tapWda(prefix: string, x: number, y: number): Promise<Response> {
    const actionsRes = await fetch(`${prefix}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actions: [
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x, y },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      }),
    });
    if (actionsRes.ok) return actionsRes;

    return fetch(`${prefix}/wda/tap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y }),
    });
  }

  /** 会话或窗口尺寸可能已失效（WDA 重启、横竖屏切换）：清缓存，下一次动作重新解析 */
  private static invalidateWdaCache(endpoint: string): void {
    this.wdaSessions.delete(endpoint);
    this.wdaWindows.delete(endpoint);
  }

  /**
   * iOS 平台操作执行 (经 WebDriverAgent)
   */
  private static async executeIosAction(
    udid: string,
    action: DeviceActionPayload,
    rawWdaEndpoint?: string
  ): Promise<DeviceActionResult> {
    // 打开链接不依赖 WebDriverAgent：网页与深链直接交给模拟器转发
    if (action.type === 'openUrl') {
      const url = (action.url || '').trim();
      if (!url) return { success: false, message: '未提供链接' };
      if (!udid) return { success: false, message: '缺少模拟器 UDID，无法打开链接' };
      try {
        await execFileAsync('xcrun', ['simctl', 'openurl', udid, url], { timeout: 10000 });
        return { success: true };
      } catch (err: any) {
        const message = summarizeOpenUrlError(err?.stderr || err?.message, 'ios');
        logger.warn(`[IosAction] 打开链接失败 (${url}): ${message}`);
        return { success: false, message };
      }
    }

    const endpoint = IosDeviceManager.resolveEndpoint(rawWdaEndpoint);
    try {
      const sessionId = await this.resolveWdaSession(endpoint);
      const prefix = sessionId ? `${endpoint}/session/${sessionId}` : endpoint;

      switch (action.type) {
        case 'tap': {
          let x = Math.round(action.x ?? 0);
          let y = Math.round(action.y ?? 0);

          if (typeof action.ratioX === 'number' && typeof action.ratioY === 'number') {
            const size = await this.resolveWdaWindow(endpoint, prefix);
            x = Math.round(action.ratioX * size.width);
            y = Math.round(action.ratioY * size.height);
          }

          const res = await this.tapWda(prefix, x, y);
          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            logger.warn(`[IosAction] 点按失败 (${x},${y}): ${res.status} ${detail.slice(0, 200)}`);
            this.invalidateWdaCache(endpoint);
          }
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
            const size = await this.resolveWdaWindow(endpoint, prefix);
            x1 = Math.round(action.ratioX * size.width);
            y1 = Math.round(action.ratioY * size.height);
            x2 = Math.round(action.ratioEndX * size.width);
            y2 = Math.round(action.ratioEndY * size.height);
          }

          const duration = ((action.duration ?? 300) / 1000).toFixed(2);
          const res = await fetch(`${prefix}/wda/dragfromtoforduration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromX: x1, fromY: y1, toX: x2, toY: y2, duration: parseFloat(duration) }),
          });
          if (!res.ok) this.invalidateWdaCache(endpoint);
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
