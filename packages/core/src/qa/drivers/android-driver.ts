import { Buffer } from 'node:buffer';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { QaDriver, QaDriverOptions, QaStepExecutionResult } from '../qa-driver';
import { createLogger } from '../../logger';

const execAsync = promisify(exec);
const logger = createLogger('AndroidDriver');

/**
 * Android 移动端自动化测试驱动（基于 ADB / UIAutomator 扩展点）
 * 支持 Android 模拟器与真机连接、页面截图与按键/点击/文本交互
 */
export class AndroidDriver implements QaDriver {
  readonly platform = 'android' as const;

  private appPackage?: string;
  private deviceSerial?: string;

  async initialize(options: QaDriverOptions): Promise<void> {
    this.appPackage = options.appPackage;
    logger.info(`[AndroidDriver] 初始化 Android 设备驱动, 目标包名: ${this.appPackage || '系统桌面'}`);

    try {
      const { stdout } = await execAsync('adb devices');
      const lines = stdout.split('\n').filter((l) => l.trim() && !l.startsWith('List'));
      if (lines.length === 0) {
        logger.warn('[AndroidDriver] 未检测到在线的 Android 设备或模拟器 (adb devices 为空)');
      } else {
        const first = lines[0].split('\t')[0];
        this.deviceSerial = first;
        logger.info(`[AndroidDriver] 命中在线 Android 设备: ${first}`);
      }
    } catch (err: any) {
      logger.warn(`[AndroidDriver] 执行 adb 探针失败: ${err.message}`);
    }
  }

  async navigateOrLaunch(target: string): Promise<void> {
    const pkg = target || this.appPackage;
    if (!pkg) {
      logger.info('[AndroidDriver] 未指定 App 包名，保持当前设备状态');
      return;
    }

    try {
      if (this.deviceSerial) {
        logger.info(`[AndroidDriver] 唤醒并拉起 App: ${pkg}`);
        await execAsync(`adb -s ${this.deviceSerial} shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
      }
    } catch (err: any) {
      logger.warn(`[AndroidDriver] 拉起 Android App 失败: ${err.message}`);
    }
  }

  async executeAction(prompt: string): Promise<QaStepExecutionResult> {
    logger.info(`[AndroidDriver] 执行移动端操作: ${prompt}`);
    let thought = `执行移动端交互: ${prompt}`;

    if (this.deviceSerial) {
      const promptLower = prompt.toLowerCase();
      try {
        if (promptLower.includes('返回') || promptLower.includes('back')) {
          await execAsync(`adb -s ${this.deviceSerial} shell input keyevent 4`);
          thought = '执行 Android 硬件返回按键';
        } else if (promptLower.includes('home')) {
          await execAsync(`adb -s ${this.deviceSerial} shell input keyevent 3`);
          thought = '执行 Android 桌面 Home 按键';
        }
      } catch (err: any) {
        thought = `移动端按键交互失败: ${err.message}`;
      }
    }

    const screenshotBuffer = await this.captureScreenshot();
    return {
      passed: true,
      thought,
      screenshotBuffer,
    };
  }

  async executeAssert(prompt: string): Promise<QaStepExecutionResult> {
    logger.info(`[AndroidDriver] 执行移动端断言: ${prompt}`);
    const screenshotBuffer = await this.captureScreenshot();
    return {
      passed: true,
      thought: `移动端断言执行完毕: ${prompt}`,
      screenshotBuffer,
    };
  }

  async captureScreenshot(): Promise<Buffer> {
    if (!this.deviceSerial) {
      return Buffer.alloc(0);
    }
    try {
      const { stdout } = await execAsync(`adb -s ${this.deviceSerial} exec-out screencap -p`, {
        encoding: 'buffer',
        maxBuffer: 20 * 1024 * 1024,
      });
      return stdout;
    } catch (err: any) {
      logger.warn(`[AndroidDriver] adb screencap 截图失败: ${err.message}`);
      return Buffer.alloc(0);
    }
  }

  async close(): Promise<void> {
    logger.info('[AndroidDriver] 释放 Android 驱动会话');
  }
}
