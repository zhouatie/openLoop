import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { IosDeviceManager } from '../qa/ios-device-manager';
import { createLogger } from '../logger';

const logger = createLogger('IosStreamProxy');
const execFileAsync = promisify(execFile);

/** 截图轮询的目标帧间隔（WDA 与 simctl 两条降级通路共用） */
const POLL_FRAME_DELAY_MS = 180;
/** 单帧抓取超时 */
const FRAME_TIMEOUT_MS = 6000;
/** simctl 原始截图的最大边；镜像面板只有 300px 宽，无需设备原分辨率 */
const SIMCTL_MAX_EDGE = 900;
/** 缩放后的 JPEG 质量 */
const SIMCTL_JPEG_QUALITY = 80;

/**
 * 解析 WDA MJPEG 串流的目标 URL
 */
export function resolveIosMjpegUrl(rawWdaEndpoint?: string, rawMjpegUrl?: string): string {
  if (rawMjpegUrl && rawMjpegUrl.trim()) {
    return rawMjpegUrl.trim();
  }

  const endpoint = IosDeviceManager.resolveEndpoint(rawWdaEndpoint);
  try {
    const u = new URL(endpoint);
    // WDA 约定：HTTP 控制端口通常为 8100，MJPEG 端口通常为 9100
    const mjpegPort = u.port === '8100' ? '9100' : (parseInt(u.port, 10) + 1000).toString();
    u.port = mjpegPort;
    u.pathname = '';
    u.search = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return 'http://127.0.0.1:9100';
  }
}

/** 通过 WDA 的 /screenshot 接口取一帧 */
async function captureWdaScreenshot(wdaEndpoint: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch(`${wdaEndpoint}/screenshot`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const json: any = await resp.json();
    const base64Data = json?.value;
    if (!base64Data || typeof base64Data !== 'string') return null;
    return Buffer.from(base64Data, 'base64');
  } catch {
    return null;
  }
}

/**
 * 通过 xcrun simctl 直接抓模拟器画面：WebDriverAgent 未启动时的降级通路
 * 单帧约 0.5-0.7 秒，实际帧率约 1.5-2 fps，仅用于「能看见画面」。
 */
async function captureSimulatorScreenshot(udid: string): Promise<Buffer | null> {
  const target = udid && udid.trim() ? udid.trim() : 'booted';
  const tag = `${target.replace(/[^\w-]/g, '')}-${process.pid}`;
  const shotPath = path.join(os.tmpdir(), `openloop-ios-${tag}.jpg`);
  const scaledPath = path.join(os.tmpdir(), `openloop-ios-${tag}-s.jpg`);
  try {
    await execFileAsync(
      'xcrun',
      ['simctl', 'io', target, 'screenshot', '--type=jpeg', shotPath],
      { timeout: FRAME_TIMEOUT_MS }
    );

    // 缩到面板够用的尺寸：设备原图约 570KB，缩放后约 40-60KB
    try {
      await execFileAsync(
        'sips',
        ['-Z', String(SIMCTL_MAX_EDGE), '-s', 'formatOptions', String(SIMCTL_JPEG_QUALITY), shotPath, '--out', scaledPath],
        { timeout: FRAME_TIMEOUT_MS }
      );
      return await fs.readFile(scaledPath);
    } catch {
      return await fs.readFile(shotPath);
    }
  } catch (err: any) {
    logger.debug(`[IosStreamProxy] simctl 截图失败 (${target}): ${err?.message}`);
    return null;
  } finally {
    void fs.unlink(shotPath).catch(() => {});
    void fs.unlink(scaledPath).catch(() => {});
  }
}

/**
 * 将 iOS 画面代理给浏览器，按可用性依次尝试：
 * 1. WDA 原生 MJPEG 串流（最流畅）
 * 2. WDA /screenshot 轮询（WDA 在但无 MJPEG）
 * 3. xcrun simctl 截图轮询（仅模拟器，无需 WDA，约 1.5-2 fps）
 */
export async function proxyIosStream(
  req: IncomingMessage,
  res: ServerResponse,
  options: { wdaEndpoint?: string; mjpegUrl?: string; udid?: string }
): Promise<void> {
  const mjpegUrl = resolveIosMjpegUrl(options.wdaEndpoint, options.mjpegUrl);
  const wdaEndpoint = IosDeviceManager.resolveEndpoint(options.wdaEndpoint);

  logger.info(`[IosStreamProxy] 尝试直连 WDA MJPEG 串流: ${mjpegUrl}`);

  // 1. 尝试以原生 MJPEG 管道接入
  const nativeSuccess = await new Promise<boolean>((resolve) => {
    try {
      const client = mjpegUrl.startsWith('https://') ? https : http;
      const proxyReq = client.get(mjpegUrl, { timeout: 3000 }, (proxyRes) => {
        if (proxyRes.statusCode && proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
          const contentType = proxyRes.headers['content-type'] || 'multipart/x-mixed-replace; boundary=--BoundaryString';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
            Connection: 'close',
            'X-OpenLoop-Stream-Mode': 'wda-mjpeg',
          });

          proxyRes.pipe(res);

          req.on('close', () => {
            proxyReq.destroy();
          });

          resolve(true);
        } else {
          proxyReq.destroy();
          resolve(false);
        }
      });

      proxyReq.on('error', (err) => {
        logger.debug(`[IosStreamProxy] 直连 MJPEG 失败 (${err.message})，转入截图轮询降级`);
        resolve(false);
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });

  if (nativeSuccess) return;

  // 2/3. 截图轮询：先 WDA，再本地模拟器
  const sources: { mode: string; grab: () => Promise<Buffer | null> }[] = [
    { mode: 'wda-screenshot', grab: () => captureWdaScreenshot(wdaEndpoint) },
    { mode: 'simctl', grab: () => captureSimulatorScreenshot(options.udid || 'booted') },
  ];

  const working = await pickWorkingSource(req, res, sources);
  if (!working) return;

  const boundary = '--openloop-ios-mjpeg-boundary';
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Connection: 'close',
    'X-OpenLoop-Stream-Mode': working.mode,
  });
  logger.info(`[IosStreamProxy] 使用截图轮询管道: ${working.mode}`);

  let active = true;
  req.on('close', () => {
    active = false;
  });

  const writeFrame = (imageBuf: Buffer): boolean => {
    try {
      const header = Buffer.from(
        `\r\n${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${imageBuf.length}\r\n\r\n`
      );
      res.write(header);
      res.write(imageBuf);
      return true;
    } catch {
      return false;
    }
  };

  if (!writeFrame(working.firstFrame)) {
    res.end();
    return;
  }

  while (active) {
    const start = Date.now();
    const imageBuf = await working.grab();
    if (!active) break;
    if (imageBuf && !writeFrame(imageBuf)) break;
    const delay = Math.max(60, POLL_FRAME_DELAY_MS - (Date.now() - start));
    await new Promise((r) => setTimeout(r, delay));
  }
  try {
    res.end();
  } catch {
    /* 连接已关闭 */
  }
}

/**
 * 依次探测降级来源，返回首个能取到画面的来源与它的首帧
 */
async function pickWorkingSource(
  req: IncomingMessage,
  res: ServerResponse,
  sources: { mode: string; grab: () => Promise<Buffer | null> }[]
): Promise<{ mode: string; grab: () => Promise<Buffer | null>; firstFrame: Buffer } | null> {
  for (const source of sources) {
    if (req.destroyed) return null;
    const firstFrame = await source.grab();
    if (firstFrame) return { ...source, firstFrame };
  }

  logger.info('[IosStreamProxy] 无可用画面来源：WDA 不可达且本机没有可截图的模拟器');
  if (!res.headersSent) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error:
          '无法获取 iOS 画面：WebDriverAgent 未启动，且没有找到已启动的模拟器。请先启动模拟器，或用 Xcode 运行 WebDriverAgentRunner 以获得流畅串流。',
      })
    );
  }
  return null;
}
