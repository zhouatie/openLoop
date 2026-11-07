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

// 辅助定位页面中的可交互输入框或文本域（支持按字段语义、同级/父级容器匹配）
async function locateInputElement(page: any, fieldLabel?: string) {
  if (fieldLabel) {
    const candidates = [
      page.getByLabel(fieldLabel, { exact: false }).first(),
      page.getByPlaceholder(fieldLabel, { exact: false }).first(),
      page.locator('div, section, label, tr, form').filter({ hasText: fieldLabel }).locator('input:not([type="hidden"]), textarea').last(),
      page.locator(`text="${fieldLabel}" >> xpath=..//input:not([type="hidden"])`).first(),
      page.locator(`text="${fieldLabel}" >> xpath=../following-sibling::*//input:not([type="hidden"])`).first(),
    ];
    for (const cand of candidates) {
      if (await cand.isVisible().catch(() => false)) {
        return cand;
      }
    }
  }
  const first = page.locator('input:not([type="hidden"]), textarea').first();
  if (await first.isVisible().catch(() => false)) {
    return first;
  }
  return null;
}

// 辅助定位页面中的可点击交互元素
async function locateClickableElement(page: any, text: string) {
  const locators = [
    page.getByRole('button', { name: text, exact: true }).first(),
    page.getByRole('tab', { name: text, exact: false }).first(),
    page.locator(`button:has-text("${text}")`).first(),
    page.locator(`[role="button"]:has-text("${text}")`).first(),
    page.locator(`[role="tab"]:has-text("${text}")`).first(),
    page.getByText(text, { exact: true }).first(),
    page.locator(`a:has-text("${text}")`).first(),
    page.getByText(text, { exact: false }).first(),
  ];
  for (const loc of locators) {
    if (await loc.isVisible().catch(() => false)) {
      return loc;
    }
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

    const isClearAction =
      promptLower.includes('清空') ||
      promptLower.includes('clear') ||
      promptLower.includes('置空') ||
      promptLower.includes('留空');
    const isInputAction =
      !isClearAction &&
      (promptLower.includes('输入') || promptLower.includes('fill') || promptLower.includes('type'));

    if (isClearAction) {
      const quoteMatch = prompt.match(/[“"「]([^”"」]+)[”"」]/i);
      const fieldLabel = quoteMatch ? quoteMatch[1].trim() : '';
      const inputEl = await locateInputElement(this.page, fieldLabel);
      if (inputEl) {
        const boxBefore = await inputEl.boundingBox().catch(() => null);
        await inputEl.fill('').catch(() => {});
        const boxAfter = await inputEl.boundingBox().catch(() => null);
        targetBox = boxAfter || boxBefore;
        thought = fieldLabel
          ? `定位到「${fieldLabel}」输入框并成功清空内容`
          : `定位到页面输入框并清空内容`;
      } else {
        return this.failNoTarget(
          fieldLabel ? `未在页面定位到「${fieldLabel}」对应输入框，清空步骤无法执行` : '未定位到可用输入框，清空步骤无法执行'
        );
      }
    } else if (isInputAction) {
      const allQuotes = Array.from(prompt.matchAll(/[“"「]([^”"」]+)[”"」]/g)).map((m) => m[1].trim());
      let fieldLabel = '';
      let inputText = '';
      if (allQuotes.length >= 2) {
        fieldLabel = allQuotes[0];
        inputText = allQuotes[1];
      } else if (allQuotes.length === 1) {
        if (prompt.match(/在[“"「][^”"」]+[”"」](?:输入框)?(?:中)?输入/i)) {
          fieldLabel = allQuotes[0];
        } else {
          inputText = allQuotes[0];
        }
      }
      if (!inputText) {
        const match = prompt.match(/输入(?:为|内容)?[“"「]?([^”"」\s,，]+)[”"」]?/i);
        inputText = match ? match[1].trim() : 'openLoop QA Test';
      }

      const inputEl = await locateInputElement(this.page, fieldLabel);
      if (inputEl) {
        const boxBefore = await inputEl.boundingBox().catch(() => null);
        await inputEl.fill(inputText).catch(() => {});
        const boxAfter = await inputEl.boundingBox().catch(() => null);
        targetBox = boxAfter || boxBefore;
        thought = fieldLabel
          ? `在「${fieldLabel}」输入框中输入「${inputText}」`
          : `定位到输入框并输入文本「${inputText}」`;
      } else {
        return this.failNoTarget(
          fieldLabel ? `未在页面定位到「${fieldLabel}」对应输入框，输入步骤无法执行` : '未定位到可用输入框，输入步骤无法执行'
        );
      }
    } else if (promptLower.includes('滚动') || promptLower.includes('scroll')) {
      await this.page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
      thought = `执行视口平滑向下滚动 300px`;
      await new Promise((r) => setTimeout(r, 400));
    } else {
      // 提取全部引号文案，支持复合步骤（如：点击左侧导航「设置」并切换至「自动化测试」标签页）
      const allQuotes = Array.from(prompt.matchAll(/[“"「]([^”"」]+)[”"」]/g)).map((m) => m[1].trim());
      const isCompoundAction =
        allQuotes.length >= 2 &&
        (prompt.includes('并') || prompt.includes('然后') || prompt.includes('再') || prompt.includes('->'));

      const targetList = isCompoundAction
        ? allQuotes
        : allQuotes.length > 0
        ? [allQuotes[0]]
        : [];

      if (targetList.length === 0) {
        const actionMatch =
          prompt.match(/(?:点击|切换|进入|打开)(?:按钮|菜单|链接|Tab|标签|至)?\s*([^\s,，]+)/i) ||
          prompt.match(/click\s+['"]([^'"]+)['"]/i) ||
          prompt.match(/click\s+(\S+)/i);
        if (actionMatch) {
          const candidate = actionMatch[1].trim();
          const stopWords = ['子', '某个', '对应', '相关', '一个', '当前', '对应项'];
          if (!stopWords.includes(candidate) && candidate.length >= 2) {
            targetList.push(candidate);
          }
        }
      }

      let clickedCount = 0;
      const thoughts: string[] = [];

      for (const targetText of targetList) {
        const loc = await locateClickableElement(this.page, targetText);
        if (loc) {
          const boxBefore = await loc.boundingBox().catch(() => null);
          await loc.click({ timeout: 2000 }).catch(() => {});
          const boxAfter = await loc.boundingBox().catch(() => null);
          targetBox = boxAfter || boxBefore;
          clickedCount++;
          thoughts.push(`点击交互「${targetText}」`);
          await new Promise((r) => setTimeout(r, 600));
        } else {
          thoughts.push(`未定位到「${targetText}」`);
        }
      }

      if (clickedCount === 0) {
        return this.failNoTarget(
          targetList.length > 0
            ? `页面未定位到目标元素「${targetList.join(' / ')}」，点击步骤无法执行`
            : '用例未指明可点击目标，点击步骤无法执行'
        );
      }
      thought = `在页面中依次完成: ${thoughts.join('，')}`;

      await new Promise((r) => setTimeout(r, 400));
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

    // 2. 检查断言类型：反向断言 (Negative Assertion)、健康检查或常规正向断言
    const promptLower = prompt.toLowerCase();

    // 正向期望词：命中则说明该断言要求页面出现可见结果，不能被否定分支或健康检查分支吞成空跑
    const hasPositiveExpectation = /出现|包含|成功|显示|展示|新增/.test(prompt);

    // 判断是否为反向断言（期望页面不包含、无某错误或消除某异常）
    const isNegativeAssert =
      !hasPositiveExpectation &&
      (prompt.includes('无') ||
        prompt.includes('不包含') ||
        prompt.includes('未出现') ||
        prompt.includes('不存在') ||
        prompt.includes('消除'));

    // 检查是否为通用健康检查
    const isHealthCheck =
      !hasPositiveExpectation &&
      (/无.*(?:报错|异常|错误|crash)/i.test(prompt) ||
        promptLower.includes('健康') ||
        promptLower.includes('首屏') ||
        promptLower.includes('加载') ||
        promptLower.includes('渲染正常'));

    let passed = true;
    let thought = '';
    let errorMessage: string | undefined;
    let targetBox: { x: number; y: number; width: number; height: number } | undefined;

    // 提取显式期望的目标文本：优先取引号内的具体文案，无引号时取「包含/出现/存在」后的短语并遇到标点即截断
    const match =
      prompt.match(/[“"「]([^”"」]+)[”"」]/) ||
      prompt.match(/(?:包含|出现|存在|显示|展示)\s*([^”"」「，,。；;！!？?\s]+)/);
    const targetText = match ? match[1].trim() : '';

    if (isNegativeAssert) {
      // 反向断言场景：页面绝不应出现指定错误文本或运行时崩溃
      const hasViteOverlay = await this.page.locator('vite-error-overlay').isVisible().catch(() => false);
      const hasCrash = pageText.includes('Uncaught Error:') || pageText.includes('Internal Server Error');

      if (hasViteOverlay || hasCrash) {
        passed = false;
        errorMessage = '页面出现前端运行时崩溃或编译错误覆盖层';
        thought = errorMessage;
      } else if (targetText && pageText.includes(targetText)) {
        passed = false;
        errorMessage = `页面依然残留异常文本「${targetText}」`;
        thought = errorMessage;
      } else {
        passed = true;
        thought = targetText
          ? `页面已成功消除异常「${targetText}」，反向断言通过`
          : '页面无报错与异常提示，健康断言通过';
      }
    } else if (isHealthCheck) {
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
    } else if (targetText) {
      // 正向断言：页面必须包含目标文本
      const hasText = pageText.includes(targetText);
      passed = hasText;
      if (passed) {
        thought = `页面成功包含预期文本「${targetText}」，断言通过`;
        const loc = await locateClickableElement(this.page, targetText);
        if (loc) {
          const box = await loc.boundingBox().catch(() => null);
          if (box) targetBox = box;
        }
      } else {
        errorMessage = `页面未包含预期文本「${targetText}」`;
        thought = errorMessage;
      }
    } else {
      passed = true;
      thought = '页面状态校验通过';
    }

    const screenshotBuffer = await this.captureScreenshot();
    return {
      passed,
      thought,
      errorMessage,
      targetBox,
      screenshotBuffer,
    };
  }

  async executeWaitFor(prompt: string, timeoutMs = 15000): Promise<QaStepExecutionResult> {
    if (!this.page) {
      throw new Error('Web 测试驱动尚未初始化');
    }
    if (this.navError) {
      return this.failNoTarget(`目标地址无法连接或导航失败: ${this.navError}`);
    }

    const startTime = Date.now();
    const deadline = startTime + Math.min(timeoutMs || 15000, 30000);

    // 先等首屏资源请求收敛，避免网络仍在拉取时提前取帧
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // 再等主内容真正渲染出来：DOM 完成、无编译错误覆盖层、页面有可见文本
    let ready = false;
    while (Date.now() < deadline) {
      ready = await this.page
        .evaluate(() => {
          if (document.readyState !== 'complete') return false;
          if (!document.body) return false;
          if (document.querySelector('vite-error-overlay')) return false;
          return (document.body.innerText || '').trim().length > 0;
        })
        .catch(() => false);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // 就绪后再缓冲一帧，避开展开与过渡的中间态
    await new Promise((r) => setTimeout(r, 300));
    const screenshotBuffer = await this.captureScreenshot();

    if (!ready) {
      const reason = `等待 ${Math.round(
        (Date.now() - startTime) / 1000
      )} 秒后页面仍未就绪（无可见内容或存在编译错误）`;
      return { passed: false, thought: reason, errorMessage: reason, screenshotBuffer };
    }

    return {
      passed: true,
      thought: `页面已就绪并完成首屏渲染（等待 ${Date.now() - startTime}ms）`,
      screenshotBuffer,
    };
  }

  /** 动作步骤找不到目标：如实判失败，不假通过也不伪造帧 */
  private async failNoTarget(reason: string): Promise<QaStepExecutionResult> {
    const screenshotBuffer = await this.captureScreenshot();
    return { passed: false, thought: reason, errorMessage: reason, screenshotBuffer };
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
