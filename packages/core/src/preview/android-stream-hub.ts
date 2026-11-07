import type { WebSocket } from 'ws';
import { AndroidStreamSession } from './android-stream-session';
import { createLogger } from '../logger';

const logger = createLogger('AndroidStreamHub');

export class AndroidStreamHub {
  private static sessions = new Map<string, AndroidStreamSession>();

  /**
   * 将 WebSocket 客户端挂载到指定序列号设备的实时视频流上
   */
  static async attach(serial: string, ws: WebSocket): Promise<void> {
    const cleanSerial = serial.trim();
    if (!cleanSerial) {
      ws.close(1008, 'Missing device serial');
      return;
    }

    let session = this.sessions.get(cleanSerial);
    if (!session || session.isDestroyedState()) {
      logger.info(`创建新 Android 流会话: ${cleanSerial}`);
      session = new AndroidStreamSession(cleanSerial, () => {
        logger.info(`会话已释放，移出全局会话表: ${cleanSerial}`);
        this.sessions.delete(cleanSerial);
      });
      this.sessions.set(cleanSerial, session);
    }

    try {
      await session.subscribe(ws);
    } catch (err: any) {
      logger.error(`挂载流客户端失败 (${cleanSerial}): ${err.message}`);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      ws.close(1011, err.message);
    }
  }

  /**
   * 关闭并移除指定设备的会话（如设备断开时手动清理）
   */
  static async remove(serial: string): Promise<void> {
    const session = this.sessions.get(serial);
    if (session) {
      this.sessions.delete(serial);
      await session.destroy();
    }
  }

  /**
   * 停止所有流会话（服务重启/关闭时调用）
   */
  static async destroyAll(): Promise<void> {
    const list = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const s of list) {
      await s.destroy();
    }
  }
}
