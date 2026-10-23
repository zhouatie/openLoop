import { createLogger } from '../logger';

const logger = createLogger('DeviceLeasePool');

/** 设备租约默认等待上限：排队过久直接失败，避免任务无限挂起 */
const DEFAULT_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

export interface DeviceLeaseWaitInfo {
  /** 队列位次，从 1 开始 */
  position: number;
  /** 前方任务数 */
  ahead: number;
  /** 按该设备近期平均占用时长推算的等待毫秒数，样本不足时为空 */
  estimatedWaitMs?: number;
}

export interface DeviceLeaseOptions {
  /** 日志与界面展示名称（任务名 / 用例名） */
  label: string;
  /** 归属标识（任务 ID / 用例 ID），便于界面定位自己的排队项 */
  ownerId?: string;
  /** 排队取消信号 */
  signal?: AbortSignal;
  /** 最长等待时间，默认 30 分钟 */
  timeoutMs?: number;
  /** 位次变化回调，用于把排队进度写进运行日志 */
  onWait?: (info: DeviceLeaseWaitInfo) => void;
}

export interface DeviceLease {
  key: string;
  /** 释放设备并让位给下一个排队任务（幂等） */
  release: () => void;
}

export interface DeviceLeaseSnapshot {
  key: string;
  holder?: { label: string; ownerId?: string; since: number };
  waiting: Array<{ label: string; ownerId?: string; since: number }>;
  averageRunMs?: number;
}

interface Waiter {
  label: string;
  ownerId?: string;
  since: number;
  settled: boolean;
  signal?: AbortSignal;
  onWait?: (info: DeviceLeaseWaitInfo) => void;
  resolve: (lease: DeviceLease) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  notifiedPosition?: number;
}

/**
 * 设备租约池
 * 一台物理设备同一时刻只能被一个执行流驱动，因此按设备键做进程内 FIFO 串行。
 * 空闲时直接授予（零等待），释放时立即移交队首，无轮询开销；不同设备键互不阻塞。
 */
export class DeviceLeasePool {
  private static holders = new Map<string, { label: string; ownerId?: string; since: number }>();
  private static queues = new Map<string, Waiter[]>();
  private static durations = new Map<string, { average: number }>();
  private static listeners = new Set<() => void>();

  static acquire(key: string, options: DeviceLeaseOptions): Promise<DeviceLease> {
    const id = key.trim();
    if (options.signal?.aborted) {
      return Promise.reject(new Error(`等待设备 ${id} 已取消`));
    }

    if (!this.holders.has(id)) {
      this.holders.set(id, { label: options.label, ownerId: options.ownerId, since: Date.now() });
      logger.debug(`[DeviceLeasePool] 设备空闲，直接授予: ${id} -> ${options.label}`);
      this.emit();
      return Promise.resolve(this.createLease(id));
    }

    return new Promise<DeviceLease>((resolve, reject) => {
      const waiter: Waiter = {
        label: options.label,
        ownerId: options.ownerId,
        since: Date.now(),
        settled: false,
        signal: options.signal,
        onWait: options.onWait,
        resolve,
        reject,
      };

      const queue = this.queues.get(id) || [];
      queue.push(waiter);
      this.queues.set(id, queue);

      const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      waiter.timer = setTimeout(() => {
        this.discard(id, waiter, new Error(`等待设备 ${id} 超时（${Math.round(timeoutMs / 60000)} 分钟），请稍后重试`));
      }, timeoutMs);
      if (options.signal) {
        waiter.onAbort = () => this.discard(id, waiter, new Error(`等待设备 ${id} 已取消`));
        options.signal.addEventListener('abort', waiter.onAbort, { once: true });
      }

      logger.info(`[DeviceLeasePool] 设备被占用，${options.label} 进入队列: ${id} (第 ${queue.length} 位)`);
      this.emit();
      this.notifyWaiters(id);
    });
  }

  static getSnapshots(): DeviceLeaseSnapshot[] {
    const keys = new Set([...this.holders.keys(), ...this.queues.keys()]);
    return [...keys].map((key) => {
      const holder = this.holders.get(key);
      const waiting = (this.queues.get(key) || [])
        .filter((waiter) => !waiter.settled)
        .map(({ label, ownerId, since }) => ({ label, ownerId, since }));
      const average = this.durations.get(key)?.average;
      return {
        key,
        ...(holder ? { holder } : {}),
        waiting,
        ...(average ? { averageRunMs: Math.round(average) } : {}),
      };
    });
  }

  /** 订阅队列变化，返回取消订阅函数 */
  static subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private static createLease(id: string): DeviceLease {
    const acquiredAt = Date.now();
    let released = false;
    return {
      key: id,
      release: () => {
        if (released) return;
        released = true;
        this.release(id, acquiredAt);
      },
    };
  }

  private static release(id: string, acquiredAt: number): void {
    if (!this.holders.has(id)) return;
    const elapsed = Date.now() - acquiredAt;
    if (elapsed >= 1000) {
      const previous = this.durations.get(id)?.average;
      // 指数滑动平均：近几次执行时长更能反映当前排队等待
      this.durations.set(id, { average: previous ? previous * 0.7 + elapsed * 0.3 : elapsed });
    }
    this.holders.delete(id);

    const queue = this.queues.get(id);
    let next = queue?.shift();
    while (next?.settled) next = queue?.shift();
    if (queue && queue.length === 0) this.queues.delete(id);

    if (next) {
      logger.info(`[DeviceLeasePool] 设备移交: ${id} -> ${next.label}`);
      this.grant(id, next);
    } else {
      logger.debug(`[DeviceLeasePool] 设备释放并进入空闲: ${id}`);
    }

    this.emit();
    this.notifyWaiters(id);
  }

  private static grant(id: string, waiter: Waiter): void {
    waiter.settled = true;
    this.detach(waiter);
    this.holders.set(id, { label: waiter.label, ownerId: waiter.ownerId, since: Date.now() });
    waiter.resolve(this.createLease(id));
  }

  /** 放弃排队（超时或取消） */
  private static discard(id: string, waiter: Waiter, error: Error): void {
    if (waiter.settled) return;
    waiter.settled = true;
    this.detach(waiter);

    const queue = this.queues.get(id);
    const index = queue?.indexOf(waiter) ?? -1;
    if (queue && index >= 0) {
      queue.splice(index, 1);
      if (queue.length === 0) this.queues.delete(id);
    }

    logger.warn(`[DeviceLeasePool] 退出设备队列: ${id} (${waiter.label}) - ${error.message}`);
    waiter.reject(error);
    this.emit();
    this.notifyWaiters(id);
  }

  private static detach(waiter: Waiter): void {
    if (waiter.timer) clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
  }

  private static notifyWaiters(id: string): void {
    const queue = this.queues.get(id);
    if (!queue || queue.length === 0) return;
    const average = this.durations.get(id)?.average;
    queue.forEach((waiter, index) => {
      if (waiter.settled || waiter.notifiedPosition === index + 1) return;
      waiter.notifiedPosition = index + 1;
      try {
        waiter.onWait?.({
          position: index + 1,
          ahead: index,
          ...(average ? { estimatedWaitMs: Math.round(average * index) } : {}),
        });
      } catch (err: any) {
        logger.warn(`[DeviceLeasePool] 排队回调异常: ${err.message}`);
      }
    });
  }

  private static emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err: any) {
        logger.warn(`[DeviceLeasePool] 队列监听异常: ${err.message}`);
      }
    }
  }
}
