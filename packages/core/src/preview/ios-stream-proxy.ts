import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { IosDeviceManager, DEFAULT_WDA_ENDPOINT } from '../qa/ios-device-manager';
import { createLogger } from '../logger';

const logger = createLogger('IosStreamProxy');

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

/**
 * 将 WDA 的 MJPEG 流或轮询截图代理给客户端浏览器
 */
export async function proxyIosStream(
  req: IncomingMessage,
  res: ServerResponse,
  options: { wdaEndpoint?: string; mjpegUrl?: string }
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

  // 2. 降级：通过 /screenshot 接口轮询生成 MJPEG 流
  logger.info(`[IosStreamProxy] 启动 WDA 截图轮询管道 (${wdaEndpoint}/screenshot)`);
  const boundary = '--openloop-ios-mjpeg-boundary';
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Connection: 'close',
  });

  let active = true;
  req.on('close', () => {
    active = false;
  });

  const fetchScreenshot = async (): Promise<Buffer | null> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
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
  };

  const pollLoop = async () => {
    while (active) {
      const start = Date.now();
      const imageBuf = await fetchScreenshot();
      if (!active) break;

      if (imageBuf) {
        try {
          const header = Buffer.from(
            `\r\n${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${imageBuf.length}\r\n\r\n`
          );
          res.write(header);
          res.write(imageBuf);
        } catch {
          break;
        }
      }

      const elapsed = Date.now() - start;
      const delay = Math.max(80, 250 - elapsed);
      await new Promise((r) => setTimeout(r, delay));
    }
  };

  pollLoop().catch(() => {});
}
