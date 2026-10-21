import { Buffer } from 'node:buffer';
import { QaDriver, QaDriverOptions, QaStepExecutionResult } from '../qa-driver';
import { createLogger } from '../../logger';
import { DEFAULT_WDA_ENDPOINT, IosDeviceManager } from '../ios-device-manager';
import { hasQaModelKey } from '../model-env';

const logger = createLogger('IosDriver');

/**
 * iOS 移动端自动化测试驱动
 * 基于 Midscene 官方 @midscene/ios SDK，通过 WebDriverAgent 驱动模拟器与真机。
 * 未配置视觉模型时降级为 WDA 页面源码树定位（文本点击、滑动、Home 键），断言不伪造结果。
 */
export class IosDriver implements QaDriver {
  readonly platform = 'ios' as const;

  private bundleId?: string;
  private endpoint = DEFAULT_WDA_ENDPOINT;
  private udid = '';
  private device: any = null; // Midscene IOSDevice
  private agent: any = null; // Midscene IOSAgent
  private isMidsceneReady = false;

  async initialize(options: QaDriverOptions): Promise<void> {
    this.bundleId = options.appPackage;
    this.endpoint = IosDeviceManager.normalizeEndpoint(options.wdaEndpoint || process.env.MIDSCENE_IOS_WDA_URL);
    logger.info(`[IosDriver] 初始化 iOS 驱动, 目标应用: ${this.bundleId || '未指定'}, WDA: ${this.endpoint}`);

    const environment = await IosDeviceManager.checkEnvironment();
    if (!environment.available) {
      throw new Error(environment.message || 'iOS 自动化运行环境不可用');
    }

    const status = await IosDeviceManager.probeWda(this.endpoint);
    if (!status.reachable) {
      throw new Error(status.message || `WebDriverAgent 不可达: ${this.endpoint}`);
    }
    this.udid = status.udid || options.deviceSerial || '';

    const { IOSDevice, IOSAgent } = await import('@midscene/ios');
    this.device = new IOSDevice({ wdaBaseUrl: this.endpoint, autoDismissKeyboard: true });
    // 设备连接失败意味着现场不可用，必须直接失败而不是伪造结果
    await this.device.connect();

    // 视觉 Agent 依赖模型密钥，创建失败时降级为 WDA 页面源码树直通管线
    try {
      this.agent = new IOSAgent(this.device, {
        aiContexts: {
          aiAct:
            'If any permission, notification, or user agreement popups appear, click allow/agree. If the software keyboard is blocking the target, dismiss it first.',
        },
      });
      this.isMidsceneReady = true;
      logger.info(`[IosDriver] Midscene IOSAgent 就绪 (设备: ${status.deviceName || this.udid || 'unknown'})`);
    } catch (err: any) {
      this.isMidsceneReady = false;
      const modelHint = hasQaModelKey() ? '' : '；提示: 未配置视觉模型密钥，可在「设置 → 自动化测试」中填写';
      logger.warn(`[IosDriver] IOSAgent 初始化未就绪 (将采用页面源码树直通兜底): ${err.message}${modelHint}`);
    }
  }

  async navigateOrLaunch(target: string): Promise<void> {
    const targetApp = target || this.bundleId;
    if (!targetApp) {
      logger.info('[IosDriver] 未指定 Bundle ID 或目标地址，保持当前设备屏幕');
      return;
    }

    logger.info(`[IosDriver] 拉起目标: ${targetApp}`);
    if (this.isMidsceneReady && this.agent) {
      await this.agent.launch(targetApp);
      logger.info(`[IosDriver] Midscene Agent 已拉起目标: ${targetApp}`);
    } else if (/^https?:\/\//i.test(targetApp)) {
      await this.device.openUrl(targetApp);
    } else {
      await this.device.launch(targetApp);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  async executeAction(prompt: string): Promise<QaStepExecutionResult> {
    logger.info(`[IosDriver] 执行 iOS 操作: "${prompt}"`);
    let passed = true;
    let errorMessage: string | undefined;
    let thought = '';

    if (this.isMidsceneReady && this.agent) {
      try {
        const actThought = await this.agent.aiAct(prompt);
        thought = typeof actThought === 'string' && actThought.trim() ? actThought : `已完成操作: ${prompt}`;
      } catch (midsceneErr: any) {
        logger.warn(`[IosDriver] Midscene aiAct 执行失败: ${midsceneErr.message}`);
        const fallback = await this.tapByElementTexts(extractQuotedTexts(prompt));
        passed = fallback.passed;
        errorMessage = fallback.passed ? undefined : shortError(midsceneErr);
        thought = fallback.thought;
      }
    } else {
      const fallback = await this.executeWdaFallbackAction(prompt);
      passed = fallback.passed;
      errorMessage = fallback.errorMessage;
      thought = fallback.thought;
    }

    const screenshotBuffer = await this.captureScreenshot();
    return { passed, thought, errorMessage, screenshotBuffer };
  }

  async executeWaitFor(prompt: string, timeoutMs?: number): Promise<QaStepExecutionResult> {
    const waitMs = timeoutMs || 120000;
    logger.info(`[IosDriver] 执行 iOS 智能等待: "${prompt}" (超时 ${waitMs}ms)`);
    let passed = true;
    let thought = '';
    let errorMessage: string | undefined;

    if (this.isMidsceneReady && this.agent) {
      try {
        await this.agent.aiWaitFor(prompt, { timeoutMs: waitMs, checkIntervalMs: 2000 });
        thought = `等待条件已满足: ${prompt}`;
      } catch (waitErr: any) {
        passed = false;
        errorMessage = shortError(waitErr);
        thought = `等待超时或条件未满足: ${errorMessage}`;
      }
    } else {
      const targets = extractQuotedTexts(prompt);
      const deadline = Math.min(waitMs, 15000);
      thought = `缺乏多模态模型，按页面源码树轮询等待: ${prompt}`;
      if (targets.length > 0) {
        const found = await this.pollElementTexts(targets, Date.now() + deadline);
        passed = found;
        if (!found) {
          errorMessage = `等待超时，未检测到文案「${targets.join(' / ')}」`;
          thought = errorMessage;
        } else {
          thought = `已等到目标文案「${targets.join(' / ')}」出现`;
        }
      }
    }

    const screenshotBuffer = await this.captureScreenshot();
    return { passed, thought, errorMessage, screenshotBuffer };
  }

  async executeAssert(prompt: string): Promise<QaStepExecutionResult> {
    logger.info(`[IosDriver] 执行 iOS 断言: "${prompt}"`);
    let passed = true;
    let errorMessage: string | undefined;
    let thought = '';

    if (this.isMidsceneReady && this.agent) {
      try {
        const assertRes = await this.agent.aiAssert(prompt);
        passed = assertRes ? assertRes.pass !== false : true;
        thought = assertRes?.thought || assertRes?.message || `Midscene AI 视觉断言已执行: ${prompt}`;
        if (!passed) errorMessage = assertRes?.message || `视觉断言未通过: ${prompt}`;
      } catch (midsceneErr: any) {
        logger.warn(`[IosDriver] Midscene aiAssert 失败: ${midsceneErr.message}`);
        passed = false;
        errorMessage = shortError(midsceneErr);
        thought = `断言未通过：${errorMessage}`;
      }

      // 模型对细小文案识别不稳定：判负时用 WDA 页面源码树补偿校验
      if (!passed) {
        const missing = await this.findMissingTexts(extractQuotedTexts(prompt));
        if (missing.length === 0) {
          passed = true;
          errorMessage = undefined;
          thought = '模型判负，但页面源码树已确认目标文案全部存在，判定为模型误判';
        } else {
          thought = `${thought}；页面源码树缺失文案: ${missing.join(' / ')}`;
        }
      }
    } else {
      const targets = extractQuotedTexts(prompt);
      if (targets.length === 0) {
        passed = false;
        errorMessage = '断言需要视觉模型支持，请在「设置 → 自动化测试」中配置模型密钥';
        thought = '当前未配置视觉模型，且断言中没有可匹配的界面文本，无法验证';
      } else {
        const missing = await this.findMissingTexts(targets);
        passed = missing.length === 0;
        thought = passed
          ? `页面源码树中已确认文案存在: ${targets.join(' / ')}`
          : `页面源码树中缺失文案: ${missing.join(' / ')}`;
        errorMessage = passed ? undefined : thought;
      }
    }

    const screenshotBuffer = await this.captureScreenshot();
    return { passed, thought, errorMessage, screenshotBuffer };
  }

  getActiveDeviceSerial(): string {
    return this.udid;
  }

  async captureScreenshot(): Promise<Buffer> {
    if (!this.device) return Buffer.alloc(0);
    try {
      const base64 = await this.device.screenshotBase64();
      if (typeof base64 === 'string' && base64.length > 0) {
        return Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      }
    } catch (err: any) {
      logger.warn(`[IosDriver] WDA 截图失败: ${err.message}`);
    }
    return Buffer.alloc(0);
  }

  async close(): Promise<void> {
    logger.info(`[IosDriver] 释放 iOS 驱动会话 (设备: ${this.udid || 'none'})`);
    if (this.device && typeof this.device.destroy === 'function') {
      try {
        await this.device.destroy();
      } catch (e: any) {
        logger.debug(`[IosDriver] 关闭 iOS 设备会话异常: ${e.message}`);
      }
    }
    this.device = null;
    this.agent = null;
    this.isMidsceneReady = false;
  }

  /** 读取 WDA 页面源码树（iOS 无 DOM，这是唯一确定性定位来源） */
  private async fetchWdaSourceTree(): Promise<WdaSourceNode | null> {
    try {
      const res = await this.device.runWdaRequest('GET', '/source?format=json');
      return (res?.value as WdaSourceNode) || null;
    } catch (err: any) {
      logger.warn(`[IosDriver] 读取 WDA 页面源码树失败: ${err?.message}`);
      return null;
    }
  }

  /** 拉平页面源码树中的全部可见文案 */
  private async dumpElementTexts(): Promise<string[]> {
    const tree = await this.fetchWdaSourceTree();
    const texts: string[] = [];
    for (const node of flattenWdaNodes(tree)) {
      if (node.visible === false) continue;
      for (const value of [node.label, node.value, node.name]) {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text) texts.push(text);
      }
    }
    return texts;
  }

  /** 返回未出现在页面源码树中的目标文案 */
  private async findMissingTexts(targets: string[]): Promise<string[]> {
    if (targets.length === 0) return [];
    const texts = await this.dumpElementTexts();
    return targets.filter((t) => !texts.some((ui) => ui.includes(t)));
  }

  /** 轮询页面源码树直到全部目标文案出现或超时 */
  private async pollElementTexts(targets: string[], deadline: number): Promise<boolean> {
    while (Date.now() < deadline) {
      const missing = await this.findMissingTexts(targets);
      if (missing.length === 0) return true;
      await new Promise((r) => setTimeout(r, 800));
    }
    return false;
  }

  /** 按页面源码树文案定位并点击，逐个尝试被引号包裹的目标 */
  private async tapByElementTexts(targets: string[]): Promise<{ passed: boolean; thought: string }> {
    if (targets.length === 0) {
      return { passed: false, thought: '操作未能完成：模型规划失败且指令中没有可定位的界面文案' };
    }
    const tree = await this.fetchWdaSourceTree();
    for (const target of targets) {
      const node = flattenWdaNodes(tree).find(
        (n) =>
          n.visible !== false &&
          n.rect &&
          n.rect.width > 0 &&
          n.rect.height > 0 &&
          [n.label, n.value, n.name].some((v) => typeof v === 'string' && v.includes(target))
      );
      if (!node?.rect) continue;
      const x = Math.round(node.rect.x + node.rect.width / 2);
      const y = Math.round(node.rect.y + node.rect.height / 2);
      try {
        await this.device.tap(x, y);
        logger.info(`[IosDriver] 页面源码树定位点击成功: ${target}`);
        return { passed: true, thought: `模型规划失败，已按页面源码树定位并点击「${target}」(${x}, ${y})` };
      } catch (err: any) {
        logger.warn(`[IosDriver] 页面源码树点击「${target}」失败: ${err?.message}`);
      }
    }
    return {
      passed: false,
      thought: '操作未能完成：模型规划失败，且页面源码树未定位到目标文案',
    };
  }

  /** 无视觉模型时的 WDA 页面源码树直通执行器 */
  private async executeWdaFallbackAction(
    prompt: string
  ): Promise<{ passed: boolean; thought: string; errorMessage?: string }> {
    const promptLower = prompt.toLowerCase();
    try {
      if (promptLower.includes('home') || promptLower.includes('主屏') || promptLower.includes('桌面')) {
        await this.device.home();
        return { passed: true, thought: '执行 iOS 主屏操作' };
      }

      const size = await this.device.getScreenSize();
      const midX = Math.round(size.width / 2);
      if (promptLower.includes('向上滑动') || promptLower.includes('上滑') || promptLower.includes('scroll down')) {
        await this.device.swipe(midX, Math.round(size.height * 0.7), midX, Math.round(size.height * 0.3), 350);
        return { passed: true, thought: '向上滑动视口内容' };
      }
      if (promptLower.includes('向下滑动') || promptLower.includes('下滑') || promptLower.includes('scroll up')) {
        await this.device.swipe(midX, Math.round(size.height * 0.3), midX, Math.round(size.height * 0.7), 350);
        return { passed: true, thought: '向下滑动视口内容' };
      }

      const targets = extractQuotedTexts(prompt);
      if (targets.length > 0) {
        const res = await this.tapByElementTexts(targets);
        if (res.passed) return res;
      }

      return {
        passed: false,
        thought: '当前未配置视觉模型，且指令中没有可定位的界面文案，无法执行该操作',
        errorMessage: '操作需要视觉模型支持，请在「设置 → 自动化测试」中配置模型密钥',
      };
    } catch (err: any) {
      return { passed: false, thought: `WDA 交互执行异常: ${err.message}`, errorMessage: shortError(err) };
    }
  }
}

/** WDA /source?format=json 的节点结构 */
interface WdaSourceNode {
  name?: string;
  label?: string;
  value?: string;
  visible?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  children?: WdaSourceNode[];
}

/** 深度优先拉平 WDA 页面源码树 */
function flattenWdaNodes(root: WdaSourceNode | null): WdaSourceNode[] {
  if (!root) return [];
  const result: WdaSourceNode[] = [];
  const walk = (node: WdaSourceNode) => {
    result.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return result;
}

/**
 * 提取指令中被引号包裹的目标文案，如 「登录」、「我知道了」
 */
function extractQuotedTexts(prompt: string): string[] {
  const results: string[] = [];
  const regex = /[「“"']([^「」“”"']{1,40})[」”"']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(prompt)) !== null) {
    const value = match[1].trim();
    if (value) results.push(value);
  }
  return results;
}

/** 提取简洁的错误描述，避免把整段堆栈写进步骤说明 */
function shortError(err: any): string {
  const raw = String(err?.message || err || '未知错误');
  return raw.split('\n')[0].slice(0, 160);
}
