import { Buffer } from 'node:buffer';

export type QaPlatform = 'web' | 'android' | 'ios' | 'desktop';

export interface QaDriverOptions {
  targetUrl?: string;
  appPackage?: string;
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
   * 截取当前设备/视口屏幕
   */
  captureScreenshot(): Promise<Buffer>;
  /**
   * 安全关闭与清理会话
   */
  close(): Promise<void>;
}
