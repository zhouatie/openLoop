/**
 * QA 能力的 agent 入口
 *
 * 会话里的工具（openloop-qa 扩展）跑在 agent 进程内，QA 引擎与运行记录归服务器实例所有。
 * 两侧相隔很远，用一个运行期注册的桥接对象连接：服务器构造时注册实现，
 * 工具只在被调用时读取。未注册时明确报错，不做静默降级。
 */

import type { AndroidDeviceInfo, IosDevicesSnapshot, QaPlatform, QaRunRecord, QaStepType } from '../types';
import type { DeviceLeaseSnapshot } from './device-lease-pool';

/** 设备快照：在线设备 + 当前租约占用的合并视图 */
export interface QaAgentDeviceSnapshot {
  android: AndroidDeviceInfo[];
  ios: IosDevicesSnapshot;
  leases: DeviceLeaseSnapshot[];
}

export interface QaAgentStepInput {
  type: QaStepType;
  prompt: string;
}

export interface QaAgentRunInput {
  name: string;
  platform: QaPlatform;
  /** Android 包名 / iOS Bundle ID / Web 地址 */
  target: string;
  deviceSerial?: string;
  wdaEndpoint?: string;
  steps: QaAgentStepInput[];
  /** 归属标识：设备租约与排队日志据此区分调用方 */
  ownerId?: string;
}

export interface QaAgentBridge {
  listDevices(): Promise<QaAgentDeviceSnapshot>;
  runSuite(input: QaAgentRunInput): Promise<QaRunRecord>;
}

let bridge: QaAgentBridge | null = null;

export function registerQaAgentBridge(next: QaAgentBridge): void {
  bridge = next;
}

export function getQaAgentBridge(): QaAgentBridge | null {
  return bridge;
}
