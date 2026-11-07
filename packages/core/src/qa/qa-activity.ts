import { createLogger } from '../logger';

const logger = createLogger('QaActivity');

export type QaActivityState = 'started' | 'step' | 'finished';

export interface QaActivityEvent {
  runId: string;
  platform: 'web' | 'android' | 'ios';
  state: QaActivityState;
  suiteId?: string;
  suiteName?: string;
  /** 本次执行实际驱动的设备标识（Android 序列号 / iOS WDA 地址） */
  deviceSerial?: string;
  stepIndex?: number;
  totalSteps?: number;
  stepTitle?: string;
  status?: 'passed' | 'failed';
  at: number;
}

type Listener = (event: QaActivityEvent) => void;

/**
 * QA 执行活动广播
 * 目的：让实时镜像、任务面板等界面感知「哪个设备正在跑哪个用例的哪一步」。
 * 只做单向通知，不参与执行逻辑，任何订阅者异常都不会影响自动化流程。
 */
class QaActivityBus {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: QaActivityEvent): void {
    const payload: QaActivityEvent = { ...event, at: event.at || Date.now() };
    logger.info('[QA 活动]', {
      runId: payload.runId,
      state: payload.state,
      serial: payload.deviceSerial,
      step: payload.stepIndex,
    });

    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (err: any) {
        logger.warn(`[QA 活动] 订阅者处理失败: ${err.message}`);
      }
    }
  }
}

export const QaActivity = new QaActivityBus();
