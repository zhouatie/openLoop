import { Buffer } from 'node:buffer';
import { QaPlatform } from '../types';
export type { QaPlatform };

/** 已实现驱动实现的测试平台白名单 */
export const QA_PLATFORMS = ['web', 'android'] as const;

export function isQaPlatform(value: unknown): value is QaPlatform {
  return typeof value === 'string' && (QA_PLATFORMS as readonly string[]).includes(value);
}

export interface QaDriverOptions {
  targetUrl?: string;
  appPackage?: string;
  deviceSerial?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  timeoutMs?: number;
}

export interface QaStepExecutionResult {
  passed: boolean;
  thought: string;
  screenshotBuffer?: Buffer;
  targetBox?: { x: number; y: number; width: number; height: number };
  errorMessage?: string;
}

export interface QaDriver {
  readonly platform: QaPlatform;
  /**
   * 初始化驱动并连接目标设备或启动浏览器
   */
  initialize(options: QaDriverOptions): Promise<void>;
  /**
   * 导航至指定 URL 或拉起目标 App
   */
  navigateOrLaunch(target: string): Promise<void>;
  /**
   * 执行操作步骤（如点击、输入、滚动等）
   */
  executeAction(prompt: string): Promise<QaStepExecutionResult>;
  /**
   * 执行断言步骤（如校验文本、校验无错误覆盖等）
   */
  executeAssert(prompt: string): Promise<QaStepExecutionResult>;
  /**
   * 执行智能等待步骤（仅支持多模态推理的驱动实现）
   */
  executeWaitFor?(prompt: string): Promise<QaStepExecutionResult>;
  /**
   * 返回驱动实际绑定的目标设备标识（如 Android 设备序列号）
   */
  getActiveDeviceSerial?(): string;
  /**
   * 截取当前设备/视口屏幕
   */
  captureScreenshot(): Promise<Buffer>;
  /**
   * 安全关闭与清理会话
   */
  close(): Promise<void>;
}
