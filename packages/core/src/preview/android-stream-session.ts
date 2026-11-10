import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { WebSocket } from 'ws';
import { Adb, AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { AndroidScreenPowerMode } from '@yume-chan/scrcpy';
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

/**
 * 缓存给新订阅者的 GOP 字节上限。
 * 新订阅者只补关键帧、不补后续参考帧就会出现花屏，所以缓存从关键帧起的一整段；
 * 超过上限说明这一段太长（迟迟没有新关键帧），宁可丢弃等下一个关键帧，也不无限吃内存。
 */
const MAX_GOP_BYTES = 8 * 1024 * 1024;
/** 新订阅者补齐 GOP 的最长等待时间；超时就不阻塞，直接跟随实时帧 */
const GOP_WAIT_TIMEOUT_MS = 5000;

export interface StreamMetadata {
  codec: string;
  width: number;
  height: number;
}

export class AndroidStreamSession {
  readonly serial: string;
  private subscribers = new Set<WebSocket>();
  private scrcpyClient: any = null;
  private startingTask: Promise<void> | null = null;
  private isDestroyed = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private metadata: StreamMetadata | null = null;
  private lastConfigPacket: Buffer | null = null;
  /** 当前 GOP 的完整帧序列（从关键帧开始），供新订阅者补齐参考链 */
  private gopPackets: Buffer[] = [];
  private gopBytes = 0;
  private gopComplete = false;
  private gopWaiters = new Set<(ready: boolean) => void>();
  /** 镜像期间是否已关闭设备物理屏幕，用于离开时恢复 */
  private screenOff = false;
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

    // 监听断开（先挂监听，避免补齐 GOP 期间客户端离开漏掉清理）
    ws.once('close', () => {
      this.unsubscribe(ws);
    });

    // 流已经在跑：先补 metadata 与 configuration，再等 GOP 补齐后整段回放。
    // 只回放关键帧、不补后续参考帧会让浏览器解出花屏，所以这里回放从关键帧起的完整一段。
    if (this.metadata && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'metadata', ...this.metadata }));
      if (this.lastConfigPacket) {
        ws.send(this.lastConfigPacket);
      }
      // 补齐期间不挂进订阅表：实时帧插进回放序列里会让解码器参考链错乱
      await this.waitForGop();
      if (this.isDestroyed || ws.readyState !== ws.OPEN) return;
      for (const packet of this.gopPackets) {
        ws.send(packet, { binary: true });
      }
    }

    this.subscribers.add(ws);
    logger.info(`[${this.serial}] 新客户端接入实时流，当前订阅数: ${this.subscribers.size}`);

    // 确保 scrcpy 服务已拉起
    await this.ensureStarted();
  }

  /**
   * 退订
   */
  unsubscribe(ws: WebSocket): void {
    this.subscribers.delete(ws);
    logger.info(`[${this.serial}] 客户端断开实时流，剩余订阅数: ${this.subscribers.size}`);

    if (this.subscribers.size === 0 && !this.isDestroyed) {
      // 最后一个观看者离开：立刻把物理屏点亮，不让用户拿到一块黑屏
      void this.restoreScreen();
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
   * 共用一次启动：并发订阅或多个订阅者同时接入时只拉一次 scrcpy 服务
   */
  private async ensureStarted(): Promise<void> {
    if (this.scrcpyClient) return;
    if (!this.startingTask) {
      this.startingTask = this.startScrcpy().finally(() => {
        this.startingTask = null;
      });
    }
    await this.startingTask;
  }

  /**
   * 启动 scrcpy 服务并建立推流循环
   */
  private async startScrcpy(): Promise<void> {
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
        // 需要控制通道才能下发屏幕电源（镜像时熄灭物理屏）
        control: true,
        maxSize: 1080,
        sendFrameMeta: true,
        videoBitRate: 3000000,
        // 保持设备常亮：屏幕休眠会让编码器停摆，实时画面直接断流
        stayAwake: true,
      });

      logger.info(`[${this.serial}] 正在启动设备端 scrcpy 服务...`);
      const client = await AdbScrcpyClient.start(adb, SERVER_PATH, scrcpyOptions);

      // 启动期间用户可能已切走设备：晚到的 client 必须自己关掉，否则设备端进程会残留并占住编码器
      if (this.isDestroyed) {
        await client.close().catch(() => {});
        throw new Error('设备镜像会话已释放');
      }
      this.scrcpyClient = client;

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
      await this.releaseClient();
      throw err;
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
          // configuration 变化等同于新序列开始：旧 GOP 的参考链已失效
          this.resetGop();
        } else if (isKeyFrame) {
          this.gopPackets = [packetBuffer];
          this.gopBytes = packetBuffer.length;
          this.gopComplete = true;
          this.flushGopWaiters(true);
        } else if (this.gopComplete) {
          this.gopPackets.push(packetBuffer);
          this.gopBytes += packetBuffer.length;
          if (this.gopBytes > MAX_GOP_BYTES) this.resetGop();
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

  /**
   * 切换设备物理屏电源（镜像继续跑）：护屏与省电，离开镜像时必须恢复。
   * 下发后回读合成器电源状态：个别机型会忽略这条控制消息，界面需要知道真实结果。
   */
  async setScreenOff(off: boolean): Promise<{ off: boolean; effective: boolean | null }> {
    const controller = this.scrcpyClient?.controller;
    if (!controller) throw new Error('设备画面尚未建立，无法切换屏幕电源');
    await controller.setScreenPowerMode(off ? AndroidScreenPowerMode.Off : AndroidScreenPowerMode.Normal);
    const mode = await this.waitDisplayPowerMode(off);
    const effective = mode === 'unknown' ? null : (mode === 'off') === off;
    // 没真正熄屏就不记成已熄屏：否则离开镜像时无从恢复
    this.screenOff = effective === false ? false : off;
    logger.info(
      `[${this.serial}] 设备物理屏${off ? '熄灭' : '点亮'}指令已下发（合成器电源=${mode}，生效=${effective}）`
    );
    return { off: this.screenOff, effective };
  }

  /**
   * 短时轮询合成器电源状态，等到与期望一致再返回，避免把下发延迟误判成不支持
   */
  private async waitDisplayPowerMode(off: boolean): Promise<'on' | 'off' | 'unknown'> {
    const expect = off ? 'off' : 'on';
    let mode: 'on' | 'off' | 'unknown' = 'unknown';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      mode = await this.readDisplayPowerMode();
      if (mode === expect) return mode;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return mode;
  }

  /**
   * 读内置屏的合成器电源状态。
   * scrcpy 的熄屏走 SurfaceControl，只改合成器这一层，
   * DisplayManagerService 的 Display State 仍是 ON，所以不能拿 dumpsys display 判断。
   */
  private async readDisplayPowerMode(): Promise<'on' | 'off' | 'unknown'> {
    try {
      const { stdout } = await execFileAsync('adb', ['-s', this.serial, 'shell', 'dumpsys', 'SurfaceFlinger'], {
        timeout: 8000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const matched = String(stdout).match(/connectionType=Internal[\s\S]{0,800}?powerMode=(\w+)/);
      if (!matched) return 'unknown';
      return matched[1].toLowerCase() === 'off' ? 'off' : 'on';
    } catch (err: any) {
      logger.warn(`[${this.serial}] 读取合成器电源状态失败: ${err.message}`);
      return 'unknown';
    }
  }

  private async restoreScreen(): Promise<void> {
    if (!this.screenOff) return;
    try {
      await this.setScreenOff(false);
    } catch (err: any) {
      logger.warn(`[${this.serial}] 恢复设备物理屏失败（scrcpy 退出后设备会自行亮屏）: ${err.message}`);
      this.screenOff = false;
    }
  }

  private resetGop(): void {
    this.gopPackets = [];
    this.gopBytes = 0;
    this.gopComplete = false;
  }

  private flushGopWaiters(ready: boolean): void {
    for (const done of [...this.gopWaiters]) done(ready);
    this.gopWaiters.clear();
  }

  /** 等一个完整 GOP 就绪；超时返回 false，避免新订阅者长时间黑屏等待 */
  private waitForGop(timeoutMs = GOP_WAIT_TIMEOUT_MS): Promise<boolean> {
    if (this.gopComplete) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout;
      const finish = (ready: boolean) => {
        clearTimeout(timer);
        this.gopWaiters.delete(finish);
        resolve(ready);
      };
      timer = setTimeout(() => finish(false), timeoutMs);
      this.gopWaiters.add(finish);
    });
  }

  private async releaseClient(): Promise<void> {
    if (!this.scrcpyClient) return;
    try {
      logger.info(`[${this.serial}] 正在关闭 scrcpy client...`);
      await this.scrcpyClient.close();
    } catch (err: any) {
      logger.warn(`[${this.serial}] 关闭 scrcpy client 异常: ${err.message}`);
    }
    this.scrcpyClient = null;
    this.screenOff = false;
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

    // 启动中的会话要先落地，否则晚到的 scrcpy client 会绕过释放流程残留
    if (this.startingTask) {
      await this.startingTask.catch(() => {});
    }

    this.flushGopWaiters(false);
    this.resetGop();
    await this.restoreScreen();
    await this.releaseClient();

    for (const sub of this.subscribers) {
      try {
        sub.close(1000, 'Session Closed');
      } catch {}
    }
    this.subscribers.clear();
  }
}
