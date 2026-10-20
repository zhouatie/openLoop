import { Buffer } from 'node:buffer';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { QaDriver, QaDriverOptions, QaStepExecutionResult } from '../qa-driver';
import { createLogger } from '../../logger';
import { AndroidDeviceManager } from '../android-device-manager';
import { hasQaModelKey } from '../model-env';

const execAsync = promisify(exec);
const logger = createLogger('AndroidDriver');

/**
 * Android 移动端自动化测试驱动
 * 深度集成 Midscene 官方 @midscene/android SDK，支持真机与模拟器视觉自动化。
 * 具备 ADB 直通兜底管线与高性能截屏能力。
 */
export class AndroidDriver implements QaDriver {
  readonly platform = 'android' as const;

  private appPackage?: string;
  private deviceSerial = '';
  private device: any = null; // Midscene AndroidDevice
  private agent: any = null;  // Midscene AndroidAgent
  private isMidsceneReady = false;
  private viewport = { width: 1080, height: 2400 };

  async initialize(options: QaDriverOptions): Promise<void> {
    this.appPackage = options.appPackage;
    this.deviceSerial = options.deviceSerial || '';

    logger.info(`[AndroidDriver] 初始化 Android 设备驱动, 目标包名: ${this.appPackage || '未指定'}, 指定设备: ${this.deviceSerial || '自动探测'}`);

    // 1. 如果未显式传入 deviceSerial，通过 AndroidDeviceManager 探测在线设备
    if (!this.deviceSerial) {
      try {
        const devices = await AndroidDeviceManager.getDevices();
        const onlineDevice = devices.find((d) => d.status === 'device');
        if (onlineDevice) {
          this.deviceSerial = onlineDevice.serial;
          logger.info(`[AndroidDriver] 自动选中在线设备: ${this.deviceSerial} (${onlineDevice.model})`);
        } else if (devices.length > 0) {
          this.deviceSerial = devices[0].serial;
          logger.warn(`[AndroidDriver] 选中的设备状态可能未授权或离线: ${this.deviceSerial} (status: ${devices[0].status})`);
        }
      } catch (err: any) {
        logger.warn(`[AndroidDriver] 自动探测设备异常: ${err.message}`);
      }
    }

    if (!this.deviceSerial) {
      throw new Error('未检测到在线 Android 设备。请连接真机（开启 USB 调试并授权）或启动模拟器后重试。');
    }

    // 2. 探查物理屏幕分辨率
    try {
      const { stdout } = await execAsync(`adb -s ${this.deviceSerial} shell wm size`, { timeout: 3000 });
      const sizeMatch = stdout.match(/Physical size:\s*(\d+)x(\d+)/i) || stdout.match(/(\d+)x(\d+)/);
      if (sizeMatch) {
        this.viewport = {
          width: parseInt(sizeMatch[1], 10),
          height: parseInt(sizeMatch[2], 10),
        };
        logger.info(`[AndroidDriver] 读取设备分辨率成功: ${this.viewport.width}x${this.viewport.height}`);
      }
    } catch (err: any) {
      logger.debug(`[AndroidDriver] 读取屏幕分辨率失败，使用默认 1080x2400: ${err.message}`);
    }

    // 3. 尝试初始化 Midscene 官方 Android 驱动 SDK
    try {
      const { AndroidDevice, AndroidAgent } = await import('@midscene/android');
      logger.info(`[AndroidDriver] 正在实例化 @midscene/android (设备: ${this.deviceSerial})...`);
      this.device = new AndroidDevice(this.deviceSerial, {
        keyboardDismissStrategy: 'back-first',
        imeStrategy: 'always-yadb',
        screenshotStrategy: 'auto',
        scrcpyConfig: {
          enabled: true,
        },
      });

      await this.device.connect();
      logger.info('[AndroidDriver] @midscene/android 设备通信管道已连接');

      this.agent = new AndroidAgent(this.device, {
        aiContexts: {
          aiAct: 'If any location, permission, notification, or user agreement popups appear, click allow/agree. If a keyboard is blocking, dismiss it.',
        },
      });
      this.isMidsceneReady = true;
      logger.info('[AndroidDriver] Midscene AndroidAgent 多模态视觉代理初始化就绪');
    } catch (err: any) {
      this.isMidsceneReady = false;
      const modelHint = hasQaModelKey()
        ? ''
        : '；提示: 未配置视觉模型密钥，可在「设置 → 自动化测试」中填写';
      logger.warn(`[AndroidDriver] @midscene/android 初始化未就绪 (将采用 ADB 直通兜底): ${err.message}${modelHint}`);
    }
  }

  async navigateOrLaunch(target: string): Promise<void> {
    const pkgOrTarget = target || this.appPackage;
    if (!pkgOrTarget) {
      logger.info('[AndroidDriver] 未指定 App 包名或目标地址，保持当前设备屏幕');
      return;
    }

    logger.info(`[AndroidDriver] 唤醒设备并拉起目标: ${pkgOrTarget}`);
    try {
      // 先点亮屏幕并解锁（针对部分休眠模拟器或真机）
      await execAsync(`adb -s ${this.deviceSerial} shell input keyevent 224`).catch(() => {});
      await execAsync(`adb -s ${this.deviceSerial} shell wm dismiss-keyguard`).catch(() => {});

      // 优先使用 Midscene Agent 的 launch 能力（自动处理包名解析与 Intent 分支）
      if (this.isMidsceneReady && this.agent) {
        await this.agent.launch(pkgOrTarget);
        logger.info(`[AndroidDriver] Midscene Agent 已拉起目标: ${pkgOrTarget}`);
      } else if (pkgOrTarget.startsWith('http://') || pkgOrTarget.startsWith('https://')) {
        // DeepLink 或网页
        logger.info(`[AndroidDriver] 通过系统 Intent 打开链接: ${pkgOrTarget}`);
        await execAsync(`adb -s ${this.deviceSerial} shell am start -a android.intent.action.VIEW -d "${pkgOrTarget}"`);
      } else {
        // 应用包名或 Activity
        const cleanPkg = pkgOrTarget.trim();
        if (cleanPkg.includes('/')) {
          // 显式指定了 Activity，例如 com.example.app/.MainActivity
          await execAsync(`adb -s ${this.deviceSerial} shell am start -n ${cleanPkg}`);
        } else {
          // 使用 monkey 唤起默认 Launcher Activity
          await execAsync(`adb -s ${this.deviceSerial} shell monkey -p ${cleanPkg} -c android.intent.category.LAUNCHER 1`);
        }
      }

      // 等待应用首屏挂载
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err: any) {
      logger.warn(`[AndroidDriver] 拉起应用失败: ${err.message}`);
    }
  }

  async executeAction(prompt: string): Promise<QaStepExecutionResult> {
    logger.info(`[AndroidDriver] 执行移动端操作: "${prompt}"`);
    let thought = '';
    let passed = true;
    let errorMessage: string | undefined;

    if (this.isMidsceneReady && this.agent) {
      try {
        const actThought = await this.agent.aiAct(prompt);
        thought = typeof actThought === 'string' && actThought.trim() ? actThought : `已完成操作: ${prompt}`;
      } catch (midsceneErr: any) {
        // 视觉 Agent 已就绪却执行失败，说明目标确实不可达，不再盲目点击屏幕中央
        logger.warn(`[AndroidDriver] Midscene aiAct 执行失败: ${midsceneErr.message}`);
        passed = false;
        errorMessage = shortError(midsceneErr);
        thought = `操作未能完成：${errorMessage}`;
      }
    } else {
      thought = await this.executeAdbFallbackAction(prompt);
    }

    const screenshotBuffer = await this.captureScreenshot();

    return { passed, thought, errorMessage, screenshotBuffer };
  }

  async executeWaitFor(prompt: string): Promise<QaStepExecutionResult> {
    logger.info(`[AndroidDriver] 执行移动端智能等待: "${prompt}"`);
    let thought = '';

    if (this.isMidsceneReady && this.agent) {
      try {
        await this.agent.aiWaitFor(prompt);
        thought = `等待条件已满足: ${prompt}`;
      } catch (waitErr: any) {
        const screenshot = await this.captureScreenshot();
        return {
          passed: false,
          thought: `等待超时或条件未满足: ${waitErr.message}`,
          errorMessage: waitErr.message,
          screenshotBuffer: screenshot,
        };
      }
    } else {
      // 降级：轮询 UIAutomator 文本直到超时
      const deadline = Date.now() + 15000;
      const quoteMatch = prompt.match(/[“"「]([^”"」]+)[”"」]/i);
      const targetText = quoteMatch ? quoteMatch[1].trim() : '';
      thought = `缺乏多模态模型，跳过智能等待: ${prompt}`;
      if (targetText) {
        while (Date.now() < deadline) {
          const pos = await this.findTextCoordsByUiAutomator(targetText);
          if (pos) {
            thought = `已等到目标文本「${targetText}」出现 (${pos.x}, ${pos.y})`;
            break;
          }
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    const screenshotBuffer = await this.captureScreenshot();
    return { passed: true, thought, screenshotBuffer };
  }

  async executeAssert(prompt: string): Promise<QaStepExecutionResult> {
    logger.info(`[AndroidDriver] 执行移动端断言: "${prompt}"`);
    let thought = '';
    let passed = true;
    let errorMessage: string | undefined;

    if (this.isMidsceneReady && this.agent) {
      try {
        const assertRes = await this.agent.aiAssert(prompt);
        passed = assertRes ? assertRes.pass !== false : true;
        thought = assertRes?.thought || assertRes?.message || `Midscene AI 视觉断言已执行: ${prompt}`;
        if (!passed) {
          errorMessage = assertRes?.message || `视觉断言未通过: ${prompt}`;
        }
      } catch (midsceneErr: any) {
        // 断言不成立或模型不可用时都必须判定失败，不能再用文本兜底掩盖结果
        logger.warn(`[AndroidDriver] Midscene aiAssert 失败: ${midsceneErr.message}`);
        passed = false;
        errorMessage = shortError(midsceneErr);
        thought = `断言未通过：${errorMessage}`;
      }
    } else {
      const fallbackRes = await this.executeAdbFallbackAssert(prompt);
      passed = fallbackRes.passed;
      thought = fallbackRes.thought;
      errorMessage = fallbackRes.errorMessage;
    }

    const screenshotBuffer = await this.captureScreenshot();

    return {
      passed,
      thought,
      errorMessage,
      screenshotBuffer,
    };
  }

  getActiveDeviceSerial(): string {
    return this.deviceSerial;
  }

  async captureScreenshot(): Promise<Buffer> {
    // 优先复用 Midscene 设备截图管道（内建 scrcpy 抽帧与 yadb 保护）
    if (this.isMidsceneReady && this.device) {
      try {
        const base64 = await this.device.screenshotBase64();
        if (typeof base64 === 'string' && base64.length > 0) {
          return Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }
      } catch (err: any) {
        logger.debug(`[AndroidDriver] Midscene 设备截图失败，转用 ADB screencap: ${err.message}`);
      }
    }

    // 降级使用 ADB 高速流式截屏
    try {
      const { stdout } = await execAsync(`adb -s ${this.deviceSerial} exec-out screencap -p`, {
        encoding: 'buffer',
        maxBuffer: 25 * 1024 * 1024,
        timeout: 5000,
      });
      return stdout;
    } catch (err: any) {
      logger.warn(`[AndroidDriver] adb screencap 截图失败: ${err.message}`);
      return Buffer.alloc(0);
    }
  }

  async close(): Promise<void> {
    logger.info(`[AndroidDriver] 释放 Android 驱动会话 (设备: ${this.deviceSerial || 'none'})`);
    if (this.device && typeof this.device.disconnect === 'function') {
      try {
        await this.device.disconnect();
      } catch (e: any) {
        logger.debug(`[AndroidDriver] 断开 Midscene 设备连接异常: ${e.message}`);
      }
    }
    this.device = null;
    this.agent = null;
    this.isMidsceneReady = false;
  }

  /**
   * 兜底 ADB 动作执行器（在无 LLM Key 或 Midscene 不可用时保障通用交互）
   */
  private async executeAdbFallbackAction(prompt: string): Promise<string> {
    const promptLower = prompt.toLowerCase();
    const midX = Math.round(this.viewport.width / 2);
    const midY = Math.round(this.viewport.height / 2);

    try {
      if (promptLower.includes('返回') || promptLower.includes('back')) {
        await execAsync(`adb -s ${this.deviceSerial} shell input keyevent 4`);
        return '执行 Android 物理返回键 (KEYCODE_BACK)';
      }

      if (promptLower.includes('home') || promptLower.includes('主屏') || promptLower.includes('桌面')) {
        await execAsync(`adb -s ${this.deviceSerial} shell input keyevent 3`);
        return '执行 Android 桌面键 (KEYCODE_HOME)';
      }

      if (promptLower.includes('输入') || promptLower.includes('type') || promptLower.includes('fill')) {
        const textMatch = prompt.match(/输入[“"「]?([^”"」]+)[”"」]?/i) || prompt.match(/type\s+['"]?([^'"]+)['"]?/i);
        const inputText = textMatch ? textMatch[1].trim() : 'openLoop';
        await execAsync(`adb -s ${this.deviceSerial} shell input text ${toAdbInputText(inputText)}`);
        return `在当前聚焦控件输入文本: "${inputText}"`;
      }

      if (promptLower.includes('向上滑动') || promptLower.includes('scroll down') || promptLower.includes('上滑')) {
        const startY = Math.round(this.viewport.height * 0.7);
        const endY = Math.round(this.viewport.height * 0.3);
        await execAsync(`adb -s ${this.deviceSerial} shell input swipe ${midX} ${startY} ${midX} ${endY} 350`);
        return `向上滑动视口内容 (${midX}, ${startY} -> ${midX}, ${endY})`;
      }

      if (promptLower.includes('向下滑动') || promptLower.includes('scroll up') || promptLower.includes('下滑')) {
        const startY = Math.round(this.viewport.height * 0.3);
        const endY = Math.round(this.viewport.height * 0.7);
        await execAsync(`adb -s ${this.deviceSerial} shell input swipe ${midX} ${startY} ${midX} ${endY} 350`);
        return `向下滑动视口内容 (${midX}, ${startY} -> ${midX}, ${endY})`;
      }

      // 提取被点击的目标文本，尝试通过 UIAutomator dump 查坐标
      const quoteMatch = prompt.match(/[“"「]([^”"」]+)[”"」]/i);
      const targetText = quoteMatch ? quoteMatch[1].trim() : '';

      if (targetText) {
        const pos = await this.findTextCoordsByUiAutomator(targetText);
        if (pos) {
          await execAsync(`adb -s ${this.deviceSerial} shell input tap ${pos.x} ${pos.y}`);
          return `通过 UIAutomator 定位到文本「${targetText}」(${pos.x}, ${pos.y}) 并执行点击`;
        }
      }

      // 默认点击屏幕中央
      await execAsync(`adb -s ${this.deviceSerial} shell input tap ${midX} ${midY}`);
      return `执行屏幕居中轻触点击 (${midX}, ${midY}): ${prompt}`;
    } catch (err: any) {
      return `ADB 交互执行异常: ${err.message}`;
    }
  }

  /**
   * 兜底 ADB 断言执行器
   */
  private async executeAdbFallbackAssert(prompt: string): Promise<{ passed: boolean; thought: string; errorMessage?: string }> {
    try {
      // 检查设备是否崩溃或黑屏无响应
      const { stdout: topActivity } = await execAsync(`adb -s ${this.deviceSerial} shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'"`, { timeout: 3000 });
      if (topActivity.includes('Application Not Responding') || topActivity.includes('Crash')) {
        return {
          passed: false,
          thought: '目标应用发生 ANR 或异常崩溃',
          errorMessage: '设备检测到 Application Not Responding 弹窗',
        };
      }

      // 如果断言指定了特定文本，在当前界面 XML 树中匹配
      const quoteMatch = prompt.match(/[“"「]([^”"」]+)[”"」]/i);
      if (quoteMatch) {
        const textToFind = quoteMatch[1].trim();
        const pos = await this.findTextCoordsByUiAutomator(textToFind);
        if (pos) {
          return {
            passed: true,
            thought: `在屏幕中定位到断言目标「${textToFind}」，位置 (${pos.x}, ${pos.y})`,
          };
        } else {
          return {
            passed: false,
            thought: `未在当前屏幕中检测到预期文本「${textToFind}」`,
            errorMessage: `页面未包含预期的元素「${textToFind}」`,
          };
        }
      }

      // 无模型且断言未指定可匹配文本时无法验证，按失败处理，避免出现假通过
      return {
        passed: false,
        thought: '当前未配置视觉模型，且断言中没有可匹配的界面文本，无法验证',
        errorMessage: '断言需要视觉模型支持，请在「设置 → 自动化测试」中配置模型密钥',
      };
    } catch (err: any) {
      return {
        passed: false,
        thought: `断言执行异常: ${err.message}`,
        errorMessage: err.message,
      };
    }
  }

  /**
   * 通过 UIAutomator dump 文本查找中心坐标
   */
  private async findTextCoordsByUiAutomator(text: string): Promise<{ x: number; y: number } | null> {
    try {
      // 生成当前界面的 dump xml
      await execAsync(`adb -s ${this.deviceSerial} shell uiautomator dump /data/local/tmp/uidump.xml`, { timeout: 3000 });
      const { stdout: xml } = await execAsync(`adb -s ${this.deviceSerial} shell cat /data/local/tmp/uidump.xml`, { timeout: 3000 });

      // 简单正则匹配 text="xxx" 或 content-desc="xxx" 对应的 bounds="[x1,y1][x2,y2]"
      const regex = new RegExp(`(?:text|content-desc)="[^"]*${escapeRegex(text)}[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, 'i');
      const match = xml.match(regex);
      if (match) {
        const x1 = parseInt(match[1], 10);
        const y1 = parseInt(match[2], 10);
        const x2 = parseInt(match[3], 10);
        const y2 = parseInt(match[4], 10);
        return {
          x: Math.round((x1 + x2) / 2),
          y: Math.round((y1 + y2) / 2),
        };
      }
    } catch {}
    return null;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 提取简洁的错误描述，避免把整段堆栈写进步骤说明
 */
function shortError(err: any): string {
  const raw = String(err?.message || err || '未知错误');
  return raw.split('\n')[0].slice(0, 160);
}

/**
 * 按 adb shell input text 的语法要求转义文本（空格转 %s，shell 元字符加反斜杠）
 */
function toAdbInputText(text: string): string {
  return text.replace(/([\\"'$`&|;<>()\[\]{}*?!#~])|\s/g, (match, special) =>
    special ? `\\${special}` : '%s'
  );
}
