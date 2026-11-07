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
/** 等待首帧的上限：超时即降级或明确报错，绝不让前端「200 却永远没有画面」 */
const FIRST_FRAME_TIMEOUT_MS = 8000;
/** 已在出画面后，帧间隔超过该值判定上游断流 */
const STREAM_IDLE_TIMEOUT_MS = 6000;
/** 送往前端的帧率上限：面板只有 300px 宽，全速推流只会白烧解码 */
const MAX_BROADCAST_FPS = 15;
/** 最后一路订阅者离开后保持上游的时间，避免界面重挂时整条管线重建 */
const IDLE_TEARDOWN_MS = 5000;
/** 单会话累计缓冲上限，防止异常上游撑爆内存 */
const MAX_PENDING_BYTES = 32 * 1024 * 1024;
/** 单个观众未写出的积压上限：超过说明浏览器已经不消费了，及时断开而不是无限攒内存 */
const MAX_VIEWER_BACKLOG_BYTES = 4 * 1024 * 1024;
/** 发给浏览器的 multipart 分隔符（WDA 的边界格式由上游自行解析） */
const BOUNDARY = 'openloop-ios-mjpeg-boundary';
/** 降级状态下探测 WDA 是否恢复的间隔 */
const UPGRADE_PROBE_INTERVAL_MS = 10000;

/**
 * 从缓冲区里取出一个完整帧（按 Content-Length）。
 * 返回值：
 * - { frame, rest } 已取到完整一帧
 * - { pendFrom } 帧还没收齐，保留 pendFrom 之后的数据等下次
 * - null 缓冲区里连分隔符都还没有
 * WDA(FBMjpegServer) 声明 boundary=--BoundaryString，实际分隔符就是它本身，不再补 --。
 */
function takeFrame(
  buffer: Buffer,
  delimiter: Buffer
): { frame: Buffer; rest: Buffer } | { pendFrom: number } | null {
  for (;;) {
    const boundaryIndex = buffer.indexOf(delimiter);
    if (boundaryIndex < 0) return null;
    const headerEnd = buffer.indexOf('\r\n\r\n', boundaryIndex);
    if (headerEnd < 0) return { pendFrom: boundaryIndex };
    const headerText = buffer.subarray(boundaryIndex, headerEnd).toString('latin1');
    const lengthMatch = headerText.match(/content-length:\s*(\d+)/i);
    const bodyStart = headerEnd + 4;
    if (!lengthMatch) {
      buffer = buffer.subarray(bodyStart);
      continue;
    }
    const length = parseInt(lengthMatch[1], 10);
    if (!Number.isFinite(length) || length <= 0) {
      buffer = buffer.subarray(bodyStart);
      continue;
    }
    // 一帧可能有上百 KB，必须等数据齐了再取，绝不能把半帧截掉
    if (buffer.length < bodyStart + length) return { pendFrom: boundaryIndex };
    return {
      frame: Buffer.from(buffer.subarray(bodyStart, bodyStart + length)),
      rest: buffer.subarray(bodyStart + length),
    };
  }
}

/** 按 Content-Type 里的 boundary 参数算出真正的分片分隔符 */
function resolveDelimiter(contentType: string): Buffer {
  const match = contentType.match(/boundary=("?)([^";]+)\1/i);
  const boundary = (match?.[2] || 'BoundaryString').trim();
  return Buffer.from(boundary.startsWith('--') ? boundary : `--${boundary}`);
}

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

/** 把任意图片数据缩到面板够用的尺寸，失败就返回原图 */
async function downscaleImage(data: Buffer, ext = 'png'): Promise<Buffer> {
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const src = path.join(os.tmpdir(), `openloop-shot-${unique}.${ext}`);
  const out = path.join(os.tmpdir(), `openloop-shot-${unique}-s.jpg`);
  try {
    await fs.writeFile(src, data);
    await execFileAsync(
      'sips',
      ['-Z', String(SIMCTL_MAX_EDGE), '-s', 'formatOptions', String(SIMCTL_JPEG_QUALITY), src, '--out', out],
      { timeout: FRAME_TIMEOUT_MS }
    );
    return await fs.readFile(out);
  } catch {
    return data;
  } finally {
    void fs.unlink(src).catch(() => {});
    void fs.unlink(out).catch(() => {});
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
    const raw = Buffer.from(base64Data, 'base64');
    // WDA 原图可达 3MB 以上（PNG），直接推给浏览器会拖垮渲染进程，先缩小
    return raw.length > 200 * 1024 ? await downscaleImage(raw) : raw;
  } catch {
    return null;
  }
}

/**
 * 通过 xcrun simctl 直接抓模拟器画面：WebDriverAgent 未启动时的降级通路
 * 单帧约 0.5-0.7 秒，实际帧率约 1.5-2 fps，仅用于「能看见画面」。
 * 临时文件路径按调用唯一，避免并发抓帧互相覆盖。
 */
async function captureSimulatorScreenshot(udid: string): Promise<Buffer | null> {
  const target = udid && udid.trim() ? udid.trim() : 'booted';
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const shotPath = path.join(os.tmpdir(), `openloop-ios-${unique}.jpg`);
  const scaledPath = path.join(os.tmpdir(), `openloop-ios-${unique}-s.jpg`);
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

function framePartHeader(length: number): Buffer {
  return Buffer.from(
    `\r\n--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${length}\r\n\r\n`
  );
}

export interface IosStreamOptions {
  wdaEndpoint?: string;
  mjpegUrl?: string;
  udid?: string;
}

/**
 * 单台 iOS 设备的画面会话：一条上游管线（WDA MJPEG / WDA 截图 / simctl 截图），
 * 任意多个 HTTP 观众共享同一帧序列。
 * 这样重复挂载镜像面板不会叠加 WDA 客户端，也不会并发抓帧互相删临时文件。
 */
class IosStreamSession {
  private viewers = new Set<ServerResponse>();
  private mode: 'wda-mjpeg' | 'wda-screenshot' | 'simctl' | null = null;
  private lastFrame: Buffer | null = null;
  private lastFrameAt = 0;
  private lastBroadcastAt = 0;
  private started = false;
  private starting = false;
  private polling = false;
  private recoveries = 0;
  private lastRestartAt = 0;
  private closed = false;
  private upstream: { destroy: () => void } | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private pending: Buffer = Buffer.alloc(0);
  private upgrading = false;
  private lastUpgradeAt = 0;
  /** 管线代号：重启后旧轮询循环不会复活 */
  private generation = 0;

  constructor(
    readonly key: string,
    private readonly options: { wdaEndpoint: string; mjpegUrl: string; udid?: string },
    private readonly onClosed: (key: string) => void
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  /** 挂载一路观众；返回的 Promise 在该观众的 HTTP 响应结束时兑现 */
  attach(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.closed) {
      // 会话刚被释放的竞态：明确告知重连，而不是留一个永不响应的请求
      try {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: '画面管线已释放，请重新连接。' }));
      } catch {
        /* 连接已断开 */
      }
      return Promise.resolve();
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.viewers.add(res);
    logger.info(`[IosStreamProxy] 观众接入 ${this.key}，当前 ${this.viewers.size} 路`);

    // 新观众先看到最近一帧，避免面板闪黑
    if (this.lastFrame && Date.now() - this.lastFrameAt < 3000) {
      this.writeFrame(res, this.lastFrame);
    }

    void this.ensureStarted();

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        res.off('close', done);
        res.off('finish', done);
        this.detach(res);
        resolve();
      };
      res.once('close', done);
      res.once('finish', done);
    });
  }

  private detach(res: ServerResponse): void {
    if (!this.viewers.delete(res)) return;
    logger.info(`[IosStreamProxy] 观众离开 ${this.key}，剩余 ${this.viewers.size} 路`);
    if (this.viewers.size === 0) {
      this.idleTimer = setTimeout(() => this.close('空闲释放'), IDLE_TEARDOWN_MS);
    }
  }

  /** 首帧到来前不写响应头，浏览器拿到的 200 一定伴随真实画面 */
  private writeFrame(res: ServerResponse, frame: Buffer): void {
    if (res.writableEnded || res.destroyed) {
      this.detach(res);
      return;
    }
    // 浏览器不再消费（卡死/后台休眠）时立即断开，避免服务端无上限攒帧
    if (res.writableLength > MAX_VIEWER_BACKLOG_BYTES) {
      logger.info(`[IosStreamProxy] 观众积压 ${res.writableLength}B，判定失联并断开 (${this.key})`);
      try {
        res.destroy();
      } catch {
        /* 已断开 */
      }
      this.detach(res);
      return;
    }
    try {
      if (!res.headersSent) {
        res.writeHead(200, {
          'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
          Connection: 'close',
          'X-OpenLoop-Stream-Mode': this.mode || 'unknown',
        });
      }
      res.write(framePartHeader(frame.length));
      res.write(frame);
    } catch {
      this.detach(res);
    }
  }

  private broadcast = (frame: Buffer): void => {
    if (this.closed || !frame.length) return;
    const now = Date.now();
    if (!this.lastFrameAt) {
      logger.info(`[IosStreamProxy] 首帧到达 ${this.key}，${frame.length}B，模式 ${this.mode || 'unknown'}`);
    }
    this.lastFrameAt = now;
    this.lastFrame = frame;

    // 超出帧率上限直接丢弃最新帧：宁可丢帧也不能让浏览器排队解码
    if (now - this.lastBroadcastAt < Math.floor(1000 / MAX_BROADCAST_FPS)) return;
    this.lastBroadcastAt = now;

    for (const res of Array.from(this.viewers)) {
      this.writeFrame(res, frame);
    }
  };

  private async ensureStarted(): Promise<void> {
    if (this.started || this.starting || this.closed) return;
    this.started = true;
    this.starting = true;
    try {
      this.startWatchdog();
      const native = await this.tryNativeMjpeg();
      if (this.closed || native) return;
      await this.startPolling();
    } catch (err: any) {
      logger.warn(`[IosStreamProxy] 画面管线启动异常 ${this.key}: ${err?.message}`);
      this.failAll('iOS 画面管线异常，请重新连接');
    } finally {
      this.starting = false;
    }
  }

  /** 接入 WDA 原生 MJPEG：一条上游连接，解析分片后广播给所有观众 */
  private tryNativeMjpeg(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      const client = this.options.mjpegUrl.startsWith('https://') ? https : http;
      let proxyReq: http.ClientRequest;
      try {
        proxyReq = client.get(this.options.mjpegUrl, { timeout: 3000 }, (proxyRes) => {
          const status = proxyRes.statusCode || 0;
          if (status < 200 || status >= 300) {
            proxyRes.destroy();
            proxyReq.destroy();
            settle(false);
            return;
          }

          this.mode = 'wda-mjpeg';
          const contentType = String(proxyRes.headers['content-type'] || '');
          const match = contentType.match(/boundary=("?)([^;"]+)\1/i);
          const upstreamBoundary = (match?.[2] || 'BoundaryString').trim();
          logger.info(
            `[IosStreamProxy] 已接入 WDA MJPEG ${this.key}: ${this.options.mjpegUrl} (boundary=${upstreamBoundary})`
          );

          this.upstream = {
            destroy: () => {
              try {
                proxyRes.destroy();
                proxyReq.destroy();
              } catch {
                /* 已断开 */
              }
            },
          };

          proxyRes.on('data', (chunk: Buffer) =>
            this.consumeMjpeg(
              chunk,
              Buffer.from(
                upstreamBoundary.startsWith('--') ? upstreamBoundary : `--${upstreamBoundary}`
              )
            )
          );
          proxyRes.on('end', () => this.onUpstreamLost('WDA 串流已结束'));
          proxyRes.on('error', () => this.onUpstreamLost('WDA 串流中断'));
          settle(true);
        });
      } catch (err: any) {
        logger.debug(`[IosStreamProxy] 直连 MJPEG 异常: ${err?.message}`);
        settle(false);
        return;
      }

      proxyReq.on('error', (err: any) => {
        logger.debug(`[IosStreamProxy] 直连 MJPEG 失败 (${err?.message})，转入截图轮询降级`);
        settle(false);
      });
      proxyReq.on('timeout', () => {
        logger.debug('[IosStreamProxy] 直连 MJPEG 超时，转入截图轮询降级');
        proxyReq.destroy();
        settle(false);
      });
    });
  }

  /** 按 Content-Length 解析上游 multipart/x-mixed-replace 分片 */
  private consumeMjpeg(chunk: Buffer, delimiter: Buffer): void {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    if (this.pending.length > MAX_PENDING_BYTES) {
      logger.warn(`[IosStreamProxy] 上游数据异常膨胀 ${this.key}，丢弃缓冲`);
      this.pending = Buffer.alloc(0);
      return;
    }

    for (;;) {
      const parsed = takeFrame(this.pending, delimiter);
      if (!parsed) {
        // 连分隔符都没有：只保留可能是分隔符前缀的尾部
        if (this.pending.length >= delimiter.length) {
          this.pending = this.pending.subarray(this.pending.length - (delimiter.length - 1));
        }
        return;
      }
      if ('pendFrom' in parsed) {
        // 帧还没收齐：保留整段半帧数据，等后续到达
        if (parsed.pendFrom > 0) this.pending = this.pending.subarray(parsed.pendFrom);
        return;
      }
      this.pending = parsed.rest;
      this.broadcast(parsed.frame);
    }
  }

  /**
   * 截图轮询阶段如果 WDA 恢复了，悄悄升回原生 MJPEG。
   * 只有真拿到一帧才切换，拿不到就继续用旧的截图管道，不让画面断掉。
   */
  private upgradeToMjpeg(): void {
    if (this.closed || this.upgrading || this.mode === 'wda-mjpeg' || !this.viewers.size) return;
    this.upgrading = true;
    this.lastUpgradeAt = Date.now();

    const client = this.options.mjpegUrl.startsWith('https://') ? https : http;
    let buffered: Buffer = Buffer.alloc(0);
    let adopted = false;
    let settled = false;
    let request: http.ClientRequest | null = null;

    const giveUp = (reason?: string) => {
      if (settled) return;
      settled = true;
      this.upgrading = false;
      try {
        request?.destroy();
      } catch {
        /* 已断开 */
      }
      if (reason) logger.debug(`[IosStreamProxy] 升级探测未成功 (${reason})，继续截图轮询`);
    };

    try {
      request = client.get(this.options.mjpegUrl, { timeout: 5000 }, (res) => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          res.destroy();
          giveUp(`status ${status}`);
          return;
        }
        const delimiter = resolveDelimiter(String(res.headers['content-type'] || ''));

        res.on('data', (chunk: Buffer) => {
          if (adopted) {
            this.consumeMjpeg(chunk, delimiter);
            return;
          }
          buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
          const parsed = takeFrame(buffered, delimiter);
          if (!parsed || 'pendFrom' in parsed) return;

          // 拿到第一帧，正式切换：停掉截图循环，接管这条上游
          adopted = true;
          settled = true;
          this.upgrading = false;
          this.stopSources();
          this.mode = 'wda-mjpeg';
          this.recoveries = 0;
          this.pending = parsed.rest;
          this.upstream = {
            destroy: () => {
              try {
                res.destroy();
                request?.destroy();
              } catch {
                /* 已断开 */
              }
            },
          };
          logger.info(`[IosStreamProxy] WDA 已恢复，升级为原生串流 ${this.key}`);
          this.broadcast(parsed.frame);
        });

        res.on('end', () => (adopted ? this.onUpstreamLost('WDA 串流已结束') : giveUp('串流结束')));
        res.on('error', () => (adopted ? this.onUpstreamLost('WDA 串流中断') : giveUp('串流异常')));
      });
    } catch (err: any) {
      giveUp(err?.message);
      return;
    }

    request.on('error', (err: any) => giveUp(err?.message));
    request.on('timeout', () => giveUp('连接超时'));
    // 兜底：迟迟拿不到帧就放弃这次升级
    setTimeout(() => giveUp('等待首帧超时'), 5000).unref();
  }

  /** WDA MJPEG 在出过画面后断开：重启管线（含降级）而不是让面板黑屏 */
  private onUpstreamLost(reason: string): void {
    if (this.closed) return;
    logger.info(`[IosStreamProxy] 上游中断 ${this.key}: ${reason}`);
    if (!this.viewers.size) {
      this.close(reason);
      return;
    }
    this.restartPipeline(reason);
  }

  /** 停掉当前上游（轮询或 MJPEG） */
  private stopSources(): void {
    this.generation += 1;
    this.lastUpgradeAt = Date.now();
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.upstream?.destroy();
    this.upstream = null;
    this.pending = Buffer.alloc(0);
  }

  /** 重新走一遍「MJPEG → WDA 截图 → simctl 截图」选择链，次数受限 */
  private restartPipeline(reason: string): void {
    if (this.closed) return;
    this.recoveries += 1;
    if (this.recoveries > 3) {
      this.failAll('iOS 画面已中断，请重新连接。');
      return;
    }
    logger.info(`[IosStreamProxy] 重启画面管线 ${this.key} (第 ${this.recoveries} 次): ${reason}`);
    this.lastRestartAt = Date.now();
    this.stopSources();
    this.started = false;
    this.starting = false;
    this.polling = false;
    this.mode = null;
    this.lastFrameAt = 0;
    this.lastBroadcastAt = 0;
    void this.ensureStarted();
  }

  /** 降级：先 WDA /screenshot，再本机模拟器截图 */
  private async startPolling(): Promise<void> {
    if (this.closed || this.polling) return;
    this.polling = true;

    const wdaFrame = await captureWdaScreenshot(this.options.wdaEndpoint);
    if (this.closed) return;
    if (wdaFrame) {
      this.mode = 'wda-screenshot';
      logger.info(`[IosStreamProxy] 使用截图轮询管道: wda-screenshot (${this.key})`);
      this.startPollLoop(() => captureWdaScreenshot(this.options.wdaEndpoint), wdaFrame);
      return;
    }

    const simFrame = await captureSimulatorScreenshot(this.options.udid || 'booted');
    if (this.closed) return;
    if (simFrame) {
      this.mode = 'simctl';
      logger.info(`[IosStreamProxy] 使用截图轮询管道: simctl (${this.key})`);
      this.startPollLoop(() => captureSimulatorScreenshot(this.options.udid || 'booted'), simFrame);
      return;
    }

    this.failAll(
      '无法获取 iOS 画面：WebDriverAgent 未启动，且没有找到已启动的模拟器。请先启动模拟器，或用 Xcode 运行 WebDriverAgentRunner 以获得流畅串流。'
    );
  }

  private startPollLoop(grab: () => Promise<Buffer | null>, firstFrame: Buffer): void {
    const currentGeneration = this.generation;
    this.broadcast(firstFrame);
    const tick = async (): Promise<void> => {
      if (this.closed || currentGeneration !== this.generation) return;
      const startedAt = Date.now();
      const frame = await grab();
      if (this.closed || currentGeneration !== this.generation) return;
      if (frame) this.broadcast(frame);
      const delay = Math.max(60, POLL_FRAME_DELAY_MS - (Date.now() - startedAt));
      this.pollTimer = setTimeout(() => void tick(), delay);
    };
    this.pollTimer = setTimeout(() => void tick(), POLL_FRAME_DELAY_MS);
  }

  /** 看门狗：首帧迟迟不到就降级，出画面后长时间没帧就重启或断开，前端因此能进失败态 */
  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    let phaseStartedAt = Date.now();
    this.watchdogTimer = setInterval(() => {
      if (this.closed) return;
      const now = Date.now();
      if (!this.lastFrameAt) {
        if (now - phaseStartedAt < FIRST_FRAME_TIMEOUT_MS) return;
        if (this.mode === 'wda-mjpeg') {
          logger.info(
            `[IosStreamProxy] WDA 串流 ${FIRST_FRAME_TIMEOUT_MS}ms 无首帧，降级截图轮询 (${this.key})`
          );
          this.stopSources();
          this.mode = null;
          phaseStartedAt = now;
          void this.startPolling();
          return;
        }
        this.failAll('iOS 画面无响应：上游既没有画面也没有报错，请重新连接。');
        return;
      }
      if (now - this.lastFrameAt > STREAM_IDLE_TIMEOUT_MS) {
        this.restartPipeline(`超过 ${STREAM_IDLE_TIMEOUT_MS}ms 无新帧`);
        phaseStartedAt = now;
        return;
      }
      // 稳定出画面 30 秒后，把重试额度还回去，避免长会话里一次抖动就永久失败
      if (this.recoveries > 0 && this.lastRestartAt && now - this.lastRestartAt > 30000) {
        this.recoveries = 0;
      }
      // 降级状态下定期探测 WDA 是否恢复，恢复就升回原生串流
      if (
        this.mode &&
        this.mode !== 'wda-mjpeg' &&
        !this.upgrading &&
        now - this.lastUpgradeAt > UPGRADE_PROBE_INTERVAL_MS
      ) {
        this.upgradeToMjpeg();
      }
    }, 1000);
  }

  /** 向所有还来得及的观众报告失败，并释放整条管线 */
  private failAll(message: string): void {
    if (this.closed) return;
    logger.info(`[IosStreamProxy] 画面来源失效 ${this.key}: ${message}`);
    const body = JSON.stringify({ error: message });
    for (const res of Array.from(this.viewers)) {
      try {
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(503, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(body);
        } else if (!res.writableEnded) {
          res.end();
        }
      } catch {
        /* 连接已断开 */
      }
    }
    this.viewers.clear();
    this.close(message);
  }

  private close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.polling = false;
    this.generation += 1;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.idleTimer = null;
    this.pollTimer = null;
    this.watchdogTimer = null;
    this.upstream?.destroy();
    this.upstream = null;
    this.pending = Buffer.alloc(0);
    logger.info(`[IosStreamProxy] 释放画面管线 ${this.key}: ${reason}`);
    this.onClosed(this.key);
  }

  /** 服务关闭时主动释放：结束所有观众的响应并停掉上游 */
  dispose(): void {
    for (const res of Array.from(this.viewers)) {
      try {
        if (!res.writableEnded) res.end();
      } catch {
        /* 连接已断开 */
      }
    }
    this.viewers.clear();
    this.close('服务关闭');
  }
}

/** 进程内单例会话表：同一台设备只有一条上游管线 */
const sessions = new Map<string, IosStreamSession>();

/**
 * 将 iOS 画面代理给浏览器，按可用性依次尝试：
 * 1. WDA 原生 MJPEG 串流（最流畅，多个观众共享一条上游连接）
 * 2. WDA /screenshot 轮询（WDA 在但无 MJPEG）
 * 3. xcrun simctl 截图轮询（仅模拟器，无需 WDA，约 1.5-2 fps）
 */
export function proxyIosStream(
  req: IncomingMessage,
  res: ServerResponse,
  options: IosStreamOptions
): Promise<void> {
  const key = `ios:${(options.udid || 'booted').trim() || 'booted'}`;
  let session = sessions.get(key);
  if (!session || session.isClosed) {
    session = new IosStreamSession(
      key,
      {
        mjpegUrl: resolveIosMjpegUrl(options.wdaEndpoint, options.mjpegUrl),
        wdaEndpoint: IosDeviceManager.resolveEndpoint(options.wdaEndpoint),
        udid: options.udid,
      },
      (closedKey) => {
        if (sessions.get(closedKey) === session) sessions.delete(closedKey);
      }
    );
    sessions.set(key, session);
  }
  return session.attach(req, res);
}

/** 服务关闭时释放全部画面管线 */
export function closeAllIosStreams(): void {
  for (const session of Array.from(sessions.values())) {
    session.dispose();
  }
  sessions.clear();
}
