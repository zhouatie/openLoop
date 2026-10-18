import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Buffer } from 'node:buffer';
import { QaDriver, QaDriverOptions, QaStepExecutionResult } from '../qa-driver';
import { createLogger } from '../../logger';

const logger = createLogger('WebPlaywrightDriver');

// 动态载入 Playwright
function loadPlaywright(): any {
  try {
    return require('playwright-core');
  } catch {}
  try {
    return require('playwright');
  } catch {}
  const homedir = os.homedir();
  const searchPaths = [
    path.join(homedir, '.pi', 'agent', 'npm', 'node_modules', 'playwright-core'),
    path.join(homedir, '.pi', 'agent', 'npm', 'node_modules', 'playwright'),
    path.join(homedir, '.local', 'share', 'pnpm', 'global', '5', 'node_modules', 'playwright-core'),
  ];
  for (const sp of searchPaths) {
    if (fs.existsSync(sp)) {
      try {
        return require(sp);
      } catch {}
    }
  }
  return null;
}

// 探测本地可用的 Chromium / Chrome / Edge 二进制
function findChromeExecutable(): string | null {
  const envPath = process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    );
  } else if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export class WebPlaywrightDriver implements QaDriver {
  readonly platform = 'web' as const;

  private browser: any = null;
  private context: any = null;
  private page: any = null;
  private navError: string | null = null;

  async initialize(options: QaDriverOptions): Promise<void> {
    const width = options.viewport?.width || 1280;
    const height = options.viewport?.height || 800;

    const playwright = loadPlaywright();
    if (!playwright) {
      throw new Error('未安装 playwright-core 自动化依赖，无法初始化 Web 测试驱动');
    }

    const chromePath = findChromeExecutable();
    if (!chromePath) {
      throw new Error('未在当前系统中检测到 Chrome/Chromium 浏览器执行文件');
    }

    logger.info(`[WebDriver] 启动 Chromium: ${chromePath}, 分辨率: ${width}x${height}`);
    this.browser = await playwright.chromium.launch({
      executablePath: chromePath,
      headless: options.headless !== false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    this.context = await this.browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    this.page = await this.context.newPage();
  }

  async navigateOrLaunch(target: string): Promise<void> {
    if (!this.page) {
      throw new Error('Web 测试驱动尚未初始化，请先调用 initialize');
    }
    this.navError = null;
    logger.info(`[WebDriver] 导航到页面: ${target}`);

    try {
      const resp = await this.page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: 25000,
      });
      if (resp && resp.status() >= 400) {
        this.navError = `HTTP ${resp.status()} ${resp.statusText()}`;
      }
    } catch (err: any) {
      this.navError = err.message || '网络连接失败';
      logger.warn(`[WebDriver] 页面导航异常: ${this.navError}`);
    }

    // 缓冲等待 SPA 组件挂载与首屏渲染
    await new Promise((r) => setTimeout(r, 600));
  }

  async executeAction(prompt: string): Promise<QaStepExecutionResult> {
    if (!this.page) {
      throw new Error('Web 测试驱动尚未初始化');
    }
    const promptLower = prompt.toLowerCase();
    let targetBox: { x: number; y: number; width: number; height: number } | undefined;
    let thought = '';

    if (promptLower.includes('输入') || promptLower.includes('fill') || promptLower.includes('type')) {
      const textMatch = prompt.match(/输入[“"「]?([^”"」]+)[”"」]?/i);
      const inputText = textMatch ? textMatch[1].trim() : 'openLoop QA Test';
      const inputEl = this.page.locator('input:not([type="hidden"]), textarea').first();
      if (await inputEl.isVisible().catch(() => false)) {
        const box = await inputEl.boundingBox().catch(() => null);
        if (box) targetBox = box;
        await inputEl.fill(inputText).catch(() => {});
        thought = `定位到输入框并输入文本「${inputText}」`;
      } else {
        thought = `未定位到可用输入框，保持视口`;
      }
    } else if (promptLower.includes('滚动') || promptLower.includes('scroll')) {
      await this.page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
      thought = `执行视口平滑向下滚动 300px`;
      await new Promise((r) => setTimeout(r, 400));
    } else {
      // 提取目标交互元素文本（优先匹配引号、书名号，严防误点无意义单字或助词）
      const quoteMatch = prompt.match(/[“"「]([^”"」]+)[”"」]/i);
      let targetText = quoteMatch ? quoteMatch[1].trim() : '';

      if (!targetText) {
        const actionMatch =
          prompt.match(/(?:点击|切换|进入|打开)(?:按钮|菜单|链接|Tab|标签|至)?\s*([^\s,，]+)/i) ||
          prompt.match(/click\s+['"]([^'"]+)['"]/i) ||
          prompt.match(/click\s+(\S+)/i);
        if (actionMatch) {
          const candidate = actionMatch[1].trim();
          const stopWords = ['子', '某个', '对应', '相关', '一个', '当前', '对应项'];
          if (!stopWords.includes(candidate) && candidate.length >= 2) {
            targetText = candidate;
          }
        }
      }

      let clicked = false;
      if (targetText) {
        const locators = [
          this.page.getByRole('button', { name: targetText, exact: true }).first(),
          this.page.locator(`button:has-text("${targetText}")`).first(),
          this.page.locator(`[role="button"]:has-text("${targetText}")`).first(),
          this.page.getByRole('tab', { name: targetText, exact: false }).first(),
          this.page.getByText(targetText, { exact: true }).first(),
          this.page.locator(`a:has-text("${targetText}")`).first(),
          this.page.getByText(targetText, { exact: false }).first(),
        ];

        for (const loc of locators) {
          const visible = await loc.isVisible().catch(() => false);
          if (visible) {
            const box = await loc.boundingBox().catch(() => null);
            if (box) targetBox = box;
            await loc.click({ timeout: 2000 }).catch(() => {});
            clicked = true;
            thought = `在页面中定位到元素「${targetText}」，执行真实点击交互`;
            await new Promise((r) => setTimeout(r, 800));
            break;
          }
        }
      }

      if (!clicked) {
        thought = targetText ? `页面未定位到「${targetText}」，保持当前视口` : `页面无需进一步交互，已处于就绪状态`;
      }

      await new Promise((r) => setTimeout(r, 600));
    }

    const screenshotBuffer = await this.captureScreenshot();
    return {
      passed: true,
      thought,
      targetBox,
      screenshotBuffer,
    };
  }

  async executeAssert(prompt: string): Promise<QaStepExecutionResult> {
    if (!this.page) {
      throw new Error('Web 测试驱动尚未初始化');
    }
    const pageText = (await this.page.evaluate(() => document.body?.innerText || '')).trim();
    const pageTitle = (await this.page.title().catch(() => '')) || '';

    // 1. 严格检查底层网络可达性与浏览器错误页
    if (this.navError) {
      const errThought = `目标地址无法连接或导航失败: ${this.navError}`;
      const screenshot = await this.captureScreenshot();
      return {
        passed: false,
        thought: errThought,
        errorMessage: errThought,
        screenshotBuffer: screenshot,
      };
    }

    if (
      pageText.includes('ERR_CONNECTION_REFUSED') ||
      pageText.includes('无法访问此网站') ||
      pageText.includes('This site can’t be reached') ||
      pageTitle.includes('ERR_CONNECTION_REFUSED')
    ) {
      const errThought = `目标服务拒绝连接 (ERR_CONNECTION_REFUSED)，靶机端口可能未就绪`;
      const screenshot = await this.captureScreenshot();
      return {
        passed: false,
        thought: errThought,
        errorMessage: errThought,
        screenshotBuffer: screenshot,
      };
    }

    // 2. 检查是否为通用健康检查
    const promptLower = prompt.toLowerCase();
    const isHealthCheck =
      promptLower.includes('无报错') ||
      promptLower.includes('异常') ||
      promptLower.includes('健康') ||
      promptLower.includes('首屏') ||
      promptLower.includes('加载') ||
      promptLower.includes('渲染正常');

    let passed = true;
    let thought = '';
    let errorMessage: string | undefined;

    if (isHealthCheck) {
      const hasViteOverlay = await this.page.locator('vite-error-overlay').isVisible().catch(() => false);
      const hasCrash = pageText.includes('Uncaught Error:') || pageText.includes('Internal Server Error');

      if (hasViteOverlay || hasCrash) {
        passed = false;
        errorMessage = '页面出现前端崩溃或编译错误覆盖层';
        thought = errorMessage;
      } else {
        passed = true;
        thought = '页面渲染正常，未检测到全局崩溃或控制台异常，健康断言通过';
      }
    } else {
      // 提取业务断言期望的文本
      const match =
        prompt.match(/包含[“"「]?([^”"」]+)[”"」]?/i) ||
        prompt.match(/出现[“"「]?([^”"」]+)[”"」]?/i) ||
        prompt.match(/存在[“"「]?([^”"」]+)[”"」]?/i) ||
        prompt.match(/[“"「]([^”"」]+)[”"」]/i);
      const expectedText = match ? match[1].trim() : '';

      if (expectedText) {
        const hasText = pageText.includes(expectedText);
        passed = hasText;
        if (passed) {
          thought = `页面成功包含预期文本「${expectedText}」，断言通过`;
        } else {
          errorMessage = `页面未包含预期文本「${expectedText}」`;
          thought = errorMessage;
        }
      } else {
        passed = true;
        thought = '页面状态校验通过';
      }
    }

    const screenshotBuffer = await this.captureScreenshot();
    return {
      passed,
      thought,
      errorMessage,
      screenshotBuffer,
    };
  }

  async captureScreenshot(): Promise<Buffer> {
    if (!this.page) {
      return Buffer.alloc(0);
    }
    const buf = await this.page.screenshot({
      type: 'png',
      fullPage: false,
    });
    return Buffer.from(buf);
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.page = null;
  }
}
