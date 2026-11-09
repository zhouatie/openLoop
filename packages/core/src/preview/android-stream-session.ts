import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { WebSocket } from 'ws';
import { Adb, AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
// 独立服务端路径：与 Midscene 内置会话的 DefaultServerPath 隔离，避免互相覆盖推送
const SERVER_PATH = '/data/local/tmp/openloop-scrcpy-server.jar';
import { createLogger } from '../logger';
import { resolveScrcpyServerBinaryPath } from './scrcpy-binary';

const execFileAsync = promisify(execFile);
const logger = createLogger('AndroidStreamSession');

/** 空闲释放延迟：当所有订阅者离开后，保持会话的最长毫秒数 */
const IDLE_TEARDOWN_MS = 20000;

/**
 * 单个订阅者的发送积压上限。
 * 超过说明浏览器已消费不过来，再灌帧只会让画面越拖越晚（越操作越卡），
 * 此时丢掉普通帧、保留关键帧，用帧率换实时性。
 */
const MAX_SUBSCRIBER_BACKLOG_BYTES = 1024 * 1024;

export interface StreamMetadata {
  codec: string;
  width: number;
  height: number;
}

export class AndroidStreamSession {
  readonly serial: string;
  private subscribers = new Set<WebSocket>();
  private scrcpyClient: any = null;
  private isStarting = false;
  private isDestroyed = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private metadata: StreamMetadata | null = null;
  private lastConfigPacket: Buffer | null = null;
  private lastIFramePacket: Buffer | null = null;
  private onDestroyCallback?: () => void;

  constructor(serial: string, onDestroy?: () => void) {
    this.serial = serial;
    this.onDestroyCallback = onDestroy;
  }

  isDestroyedState(): boolean {
    return this.isDestroyed;
  }

  /**
   * 订阅该设备的实时视频流
   */
  async subscribe(ws: WebSocket): Promise<void> {
    if (this.isDestroyed) {
      throw new Error(`会话已销毁: ${this.serial}`);
    }

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    this.subscribers.add(ws);
    logger.info(`[${this.serial}] 新客户端接入实时流，当前订阅数: ${this.subscribers.size}`);

    // 如果流已经在跑，立刻向新客户端发送 metadata 与缓存的 configuration 帧与首个 I-Frame 关键帧
    if (this.metadata && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'metadata', ...this.metadata }));
      if (this.lastConfigPacket) {
        ws.send(this.lastConfigPacket);
      }
      if (this.lastIFramePacket) {
        ws.send(this.lastIFramePacket);
      }
    }

    // 监听断开
    ws.once('close', () => {
      this.unsubscribe(ws);
    });

    // 确保 scrcpy 服务已拉起
    if (!this.scrcpyClient && !this.isStarting) {
      await this.startScrcpy();
    }
  }

  /**
   * 退订
   */
  unsubscribe(ws: WebSocket): void {
    this.subscribers.delete(ws);
    logger.info(`[${this.serial}] 客户端断开实时流，剩余订阅数: ${this.subscribers.size}`);

    if (this.subscribers.size === 0 && !this.isDestroyed) {
      // 启动空闲倒计时
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        logger.info(`[${this.serial}] 订阅者已全部离线超过 ${IDLE_TEARDOWN_MS / 1000}s，自动销毁流会话`);
        this.destroy().catch((err) => {
          logger.warn(`[${this.serial}] 销毁会话异常: ${err.message}`);
        });
      }, IDLE_TEARDOWN_MS);
    }
  }

  /**
   * 启动 scrcpy 服务并建立推流循环
   */
  private async startScrcpy(): Promise<void> {
    this.isStarting = true;
    try {
      const serverBin = resolveScrcpyServerBinaryPath();
      if (!serverBin) {
        throw new Error('未在系统或包资源中找到 scrcpy-server 二进制文件');
      }

      logger.info(`[${this.serial}] 正在推送 scrcpy-server (${serverBin}) -> ${SERVER_PATH}...`);
      await execFileAsync('adb', ['-s', this.serial, 'push', serverBin, SERVER_PATH], { timeout: 10000 });

      // 通过 TCP 连接本地 ADB 服务
      const adbConnector = new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 });
      const adbServer = new AdbServerClient(adbConnector);
      const devices = await adbServer.getDevices();
      const targetDevice = devices.find((d) => d.serial === this.serial);
      if (!targetDevice) {
        throw new Error(`ADB 服务中未检测到设备: ${this.serial}`);
      }

      const adbTransport = await adbServer.createTransport(targetDevice);
      const adb = new Adb(adbTransport);

      const scrcpyOptions = new AdbScrcpyOptions3_3_3({
        audio: false,
        control: false,
        maxSize: 1080,
        sendFrameMeta: true,
        videoBitRate: 3000000,
        // 保持设备常亮：屏幕休眠会让编码器停摆，实时画面直接断流
        stayAwake: true,
      });

      logger.info(`[${this.serial}] 正在启动设备端 scrcpy 服务...`);
      this.scrcpyClient = await AdbScrcpyClient.start(adb, SERVER_PATH, scrcpyOptions);

      const videoStream = await this.scrcpyClient.videoStream;
      const meta = videoStream.metadata || {};
      const rawCodec = meta.codec;
      const isH265 = rawCodec === 1748121141 || String(rawCodec).toLowerCase().includes('h265');
      this.metadata = {
        codec: isH265 ? 'h265' : 'h264',
        width: meta.width || 1080,
        height: meta.height || 1920,
      };

      logger.info(`[${this.serial}] scrcpy 视频流已就绪: ${this.metadata.width}x${this.metadata.height} (${this.metadata.codec})`);

      // 向现有客户端广播 metadata
      const metaMsg = JSON.stringify({ type: 'metadata', ...this.metadata });
      for (const sub of this.subscribers) {
        if (sub.readyState === sub.OPEN) {
          sub.send(metaMsg);
        }
      }

      // 开始消费视频帧
      this.consumeFrames(videoStream.stream).catch((err) => {
        logger.warn(`[${this.serial}] 视频帧读取流终止: ${err.message}`);
        this.broadcastError(err.message);
      });
    } catch (err: any) {
      logger.error(`[${this.serial}] 启动 scrcpy 流会话失败: ${err.message}`);
      this.broadcastError(err.message);
      await this.destroy();
      throw err;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * 消费视频包并二进制广播给订阅者
   */
  private async consumeFrames(stream: any): Promise<void> {
    const reader = stream.getReader();
    try {
      while (!this.isDestroyed) {
        const { done, value } = await reader.read();
        if (done) {
          // 服务端流结束意味着底层 scrcpy 已退出：必须销毁会话，
          // 否则后续重连会命中这个没有画面的僵尸会话，表现为黑屏
          logger.info(`[${this.serial}] 视频流正常结束，销毁会话以便重连时重新拉起`);
          this.broadcastMessage({ type: 'end', message: '设备视频流已中断，请重新连接' });
          break;
        }

        if (!value) continue;

        // 二进制封包协议：
        // Byte 0: 标志位 (bit 0: isConfiguration, bit 1: isKeyFrame)
        // Byte 1..N: NAL / Packet 载荷
        const isConfig = value.type === 'configuration';
        const isKeyFrame = Boolean(value.keyframe);
        const flag = (isConfig ? 0x01 : 0x00) | (isKeyFrame ? 0x02 : 0x00);

        const payload = Buffer.from(value.data.buffer, value.data.byteOffset, value.data.byteLength);
        const packetBuffer = Buffer.allocUnsafe(1 + payload.length);
        packetBuffer[0] = flag;
        payload.copy(packetBuffer, 1);

        if (isConfig) {
          this.lastConfigPacket = packetBuffer;
        }
        if (isKeyFrame) {
          this.lastIFramePacket = packetBuffer;
        }

        // 推送给所有活跃订阅客户端
        for (const sub of this.subscribers) {
          if (sub.readyState !== sub.OPEN) continue;
          if (!isKeyFrame && sub.bufferedAmount > MAX_SUBSCRIBER_BACKLOG_BYTES) continue;
          sub.send(packetBuffer, { binary: true });
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
      if (!this.isDestroyed) {
        // 帧读取循环退出后不留活体会话：让 Hub 摘掉它，下一次订阅重新开流
        this.destroy().catch((err) => {
          logger.warn(`[${this.serial}] 销毁已结束的流会话异常: ${err.message}`);
        });
      }
    }
  }

  private broadcastMessage(message: Record<string, unknown>): void {
    const payload = JSON.stringify(message);
    for (const sub of this.subscribers) {
      if (sub.readyState === sub.OPEN) {
        sub.send(payload);
      }
    }
  }

  private broadcastError(message: string): void {
    this.broadcastMessage({ type: 'error', message });
  }

  /**
   * 销毁并释放 scrcpy 进程
   */
  async destroy(): Promise<void> {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    try {
      this.onDestroyCallback?.();
    } catch {}

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.scrcpyClient) {
      try {
        logger.info(`[${this.serial}] 正在关闭 scrcpy client...`);
        await this.scrcpyClient.close();
      } catch (err: any) {
        logger.warn(`[${this.serial}] 关闭 scrcpy client 异常: ${err.message}`);
      }
      this.scrcpyClient = null;
    }

    for (const sub of this.subscribers) {
      try {
        sub.close(1000, 'Session Closed');
      } catch {}
    }
    this.subscribers.clear();
  }
}
