import fs from 'fs';
import path from 'path';
import { QaSuite, QaStep, QaRunRecord, StepTimelineRecord } from '../types';
import { createLogger } from '../logger';
import { QaDriver, QaPlatform, QaStepExecutionResult } from './qa-driver';
import { QaDriverFactory } from './qa-driver-factory';
import { DeviceLease, DeviceLeasePool } from './device-lease-pool';
import { IosDeviceManager } from './ios-device-manager';
import { AndroidDeviceManager } from './android-device-manager';
import { QaActivity } from './qa-activity';

const qaLogger = createLogger('QAMidsceneRunner');

export interface RunnerOptions {
  artifactBaseDir: string;
  serverBaseUrl?: string;
  platform?: QaPlatform;
  /** 本次执行归属标识，用于精确定位设备排队项 */
  ownerId?: string;
  signal?: AbortSignal;
  /** 复用已由前置节点拉起的页面，不再自行拉起应用 */
  skipLaunch?: boolean;
  onStepStart?: (stepIndex: number, step: QaStep) => void;
  onStepFinish?: (stepIndex: number, record: StepTimelineRecord) => void;
  onLog?: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/**
 * 降级模式下的 SVG 可视化快照生成器
 */
function generateStepVisualSnapshot(
  url: string,
  totalSteps: number,
  stepIndex: number,
  step: QaStep,
  status: 'passed' | 'failed' | 'skipped',
  width = 1280,
  height = 800,
  targetBox?: { x: number; y: number; width: number; height: number },
  thought?: string
): string {
  const isFailed = status === 'failed';
  const box = targetBox || { x: 420, y: 260 + stepIndex * 70, width: 440, height: 48 };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#f1f5f9"/>
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.08"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <rect width="${width}" height="44" fill="#f4f4f6"/>
  <line x1="0" y1="44" x2="${width}" y2="44" stroke="#e2e8f0" stroke-width="1"/>
  
  <circle cx="24" cy="22" r="6" fill="#ff5f56"/>
  <circle cx="44" cy="22" r="6" fill="#ffbd2e"/>
  <circle cx="64" cy="22" r="6" fill="#27c93f"/>

  <rect x="110" y="8" width="${width - 260}" height="28" rx="6" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"/>
  <text x="125" y="27" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="#475569">${url}</text>

  <rect y="44" width="${width}" height="${height - 44}" fill="url(#bgGrad)"/>

  <rect x="40" y="64" width="${width - 80}" height="56" rx="8" fill="#ffffff" filter="url(#shadow)"/>
  <rect x="64" y="80" width="24" height="24" rx="6" fill="#4f46e5"/>
  <text x="100" y="97" font-family="-apple-system, sans-serif" font-size="15" font-weight="600" fill="#0f172a">openLoop 视觉自动化工作区 (降级视图)</text>

  <g filter="url(#shadow)">
    <rect x="40" y="140" width="${width - 80}" height="${height - 200}" rx="10" fill="#ffffff"/>
    <text x="70" y="185" font-family="-apple-system, sans-serif" font-size="18" font-weight="700" fill="#1e293b">UI 自动化测试视口 (Step ${stepIndex + 1}/${totalSteps})</text>
    <text x="70" y="210" font-family="-apple-system, sans-serif" font-size="13" fill="#64748b">指令: ${step.prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>

    <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="6" fill="${isFailed ? '#fef2f2' : '#eff6ff'}" stroke="${isFailed ? '#ef4444' : '#3b82f6'}" stroke-width="2" stroke-dasharray="4,2"/>
    <rect x="${box.x}" y="${box.y - 20}" width="160" height="20" rx="3" fill="${isFailed ? '#ef4444' : '#3b82f6'}"/>
    <text x="${box.x + 8}" y="${box.y - 6}" font-family="-apple-system, sans-serif" font-size="11" font-weight="600" fill="#ffffff">Target (${step.type})</text>
    <text x="${box.x + 16}" y="${box.y + 30}" font-family="-apple-system, sans-serif" font-size="14" fill="${isFailed ? '#991b1b' : '#1e3a8a'}">${step.prompt.slice(0, 32)}</text>
  </g>

  <rect x="60" y="${height - 70}" width="${width - 120}" height="42" rx="8" fill="#0f172a" opacity="0.9"/>
  <circle cx="85" cy="${height - 49}" r="7" fill="${status === 'skipped' ? '#a1a1aa' : isFailed ? '#ef4444' : '#22c55e'}"/>
  <text x="105" y="${height - 44}" font-family="-apple-system, sans-serif" font-size="12" font-weight="500" fill="#f8fafc">
    ${status === 'passed' ? '✔ 步骤通过' : status === 'skipped' ? '⏭ 步骤跳过（未验证）' : '✖ 步骤未通过'}: ${thought ? thought.slice(0, 70) : ''}
  </text>
</svg>`;
}

/**
 * 通用多端自动化测试运行器（委托 QaDriver 跨端驱动实现）
 */
export class MidsceneRunner {
  private options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.options = options;
  }

  /** iOS 一台设备只能被一个执行流驱动，执行前先取得设备租约，其余任务按 FIFO 排队 */
  private async acquireIosLease(suite: QaSuite): Promise<DeviceLease | null> {
    if ((this.options.platform || suite.platform) !== 'ios') return null;
    const endpoint = IosDeviceManager.resolveEndpoint(suite.wdaEndpoint);
    let lastPosition = 0;

    const lease = await DeviceLeasePool.acquire(endpoint, {
      label: suite.name || suite.id,
      ownerId: this.options.ownerId || suite.id,
      signal: this.options.signal,
      onWait: (info) => {
        if (info.position === lastPosition) return;
        lastPosition = info.position;
        const eta = info.estimatedWaitMs ? `，预计等待约 ${Math.ceil(info.estimatedWaitMs / 1000)}s` : '';
        this.options.onLog?.(
          `[QA 设备] iOS 设备 ${endpoint} 使用中，排队第 ${info.position} 位（前方 ${info.ahead} 个任务${eta}）`,
          'warn'
        );
      },
    });
    this.options.onLog?.(`[QA 设备] 已获得 iOS 设备租约: ${endpoint}`);
    return lease;
  }

  /** 解析 Android 目标序列号：用例显式指定优先，否则取首个在线设备（与驱动探测逻辑一致） */
  private async resolveAndroidSerial(suite: QaSuite): Promise<string | undefined> {
    if (suite.deviceSerial) return suite.deviceSerial;
    try {
      const devices = await AndroidDeviceManager.getDevices();
      const online = devices.find((d) => d.status === 'device');
      return online?.serial;
    } catch (err: any) {
      qaLogger.warn(`[MidsceneRunner] 解析 Android 序列号失败: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Android 设备租约：同一台设备同时只允许一个执行流驱动。
   * 租约同时是镜像界面的「自动化中·仅观看」信号源。
   */
  private async acquireAndroidLease(suite: QaSuite, serial: string): Promise<DeviceLease> {
    return DeviceLeasePool.acquire(serial, {
      label: suite.name || suite.id,
      ownerId: this.options.ownerId || suite.id,
      signal: this.options.signal,
      onWait: (info) => {
        const eta = info.estimatedWaitMs ? `，预计等待约 ${Math.ceil(info.estimatedWaitMs / 1000)}s` : '';
        this.options.onLog?.(
          `[QA 设备] Android 设备 ${serial} 使用中，排队第 ${info.position} 位（前方 ${info.ahead} 个任务${eta}）`,
          'warn'
        );
      },
    });
  }

  public async runSuite(suite: QaSuite, taskId?: string): Promise<QaRunRecord> {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const runDir = path.join(this.options.artifactBaseDir, runId);

    if (!fs.existsSync(runDir)) {
      fs.mkdirSync(runDir, { recursive: true });
    }

    const platform = this.options.platform || suite.platform || 'web';
    qaLogger.info(`[MidsceneRunner] 开始执行自动化测试套件: ${suite.name} (ID: ${suite.id}, 平台: ${platform})`, {
      runId,
      suiteId: suite.id,
      stepsCount: suite.steps.length,
      targetUrl: suite.targetUrl,
      appPackage: suite.appPackage,
      deviceSerial: suite.deviceSerial,
      taskId,
    });

    const startTime = Date.now();
    const timeline: StepTimelineRecord[] = [];
    let passedSteps = 0;
    let runStatus: 'passed' | 'failed' = 'passed';
    let errorMessage: string | undefined;

    const width = suite.viewport?.width || 1280;
    const height = suite.viewport?.height || 800;

    let driver: QaDriver | null = null;
    let driverReady = false;
    let driverInitError: string | undefined;
    let lease: DeviceLease | null = null;
    let activeSerial: string | undefined;

    try {
      if (this.options.signal?.aborted) {
        throw new Error('测试执行已提前中止 (Task cancelled)');
      }

      lease = await this.acquireIosLease(suite);
      if (platform === 'android') {
        const androidSerial = await this.resolveAndroidSerial(suite);
        if (androidSerial) {
          lease = await this.acquireAndroidLease(suite, androidSerial);
          this.options.onLog?.(`[QA 设备] 已获得 Android 设备租约: ${androidSerial}`);
        }
      }
      driver = QaDriverFactory.createDriver(platform);

      if (this.options.signal) {
        this.options.signal.addEventListener(
          'abort',
          () => {
            try {
              driver?.close();
            } catch {}
          },
          { once: true }
        );
      }

      await driver.initialize({
        targetUrl: suite.targetUrl,
        appPackage: suite.appPackage,
        deviceSerial: suite.deviceSerial || (platform === 'android' ? lease?.key : undefined),
        wdaEndpoint: suite.wdaEndpoint,
        viewport: { width, height },
        headless: true,
      });
      driverReady = true;
      activeSerial = driver.getActiveDeviceSerial?.() || lease?.key || suite.deviceSerial || undefined;
      this.options.onLog?.(`[QA 引擎] ${platform.toUpperCase()} 测试驱动初始化就绪`);

      // 广播执行开始：镜像与任务面板据此自动聚焦到该设备
      QaActivity.publish({
        runId,
        platform,
        state: 'started',
        suiteId: suite.id,
        suiteName: suite.name,
        deviceSerial: activeSerial,
        totalSteps: suite.steps.length,
        at: Date.now(),
      });

      // Web 端导航到目标地址，移动端（Android/iOS）拉起目标应用
      const target = platform === 'web' ? suite.targetUrl : suite.appPackage || suite.targetUrl;
      if (this.options.skipLaunch) {
        this.options.onLog?.('[QA 引擎] 复用当前已打开页面，跳过应用拉起');
      } else if (target) {
        this.options.onLog?.(`[QA 引擎] ${platform === 'web' ? '导航到目标环境' : '拉起目标应用'}: ${target}`);
        await driver.navigateOrLaunch(target);
      }
    } catch (err: any) {
      driverInitError = err.message || '测试驱动初始化失败';
      driverReady = false;
      runStatus = 'failed';
      errorMessage = driverInitError;
      qaLogger.error(`[MidsceneRunner] 驱动启动失败，测试标记为失败: ${driverInitError}`, { platform });
      this.options.onLog?.(`[QA 引擎 Error] 测试驱动启动失败: ${driverInitError}`, 'error');
    }

    try {
      for (let i = 0; i < suite.steps.length; i++) {
        if (this.options.signal?.aborted) {
          throw new Error('测试执行已被手动终止 (Task cancelled)');
        }

        const step = suite.steps[i];
        const stepStartTime = Date.now();
        this.options.onStepStart?.(i, step);
        QaActivity.publish({
          runId,
          platform,
          state: 'step',
          suiteId: suite.id,
          suiteName: suite.name,
          deviceSerial: activeSerial,
          stepIndex: i,
          totalSteps: suite.steps.length,
          stepTitle: step.prompt,
          at: Date.now(),
        });

        let stepResult: QaStepExecutionResult = {
          passed: true,
          thought: '',
        };

        if (driverReady && driver) {
          try {
            if (step.type === 'action') {
              stepResult = await driver.executeAction(step.prompt);
            } else if (step.type === 'waitFor') {
              // 驱动未实现轮询等待时降级为断言，保证跨平台行为不退步
              stepResult = driver.executeWaitFor
                ? await driver.executeWaitFor(step.prompt, step.timeoutMs)
                : await driver.executeAssert(step.prompt);
            } else {
              stepResult = await driver.executeAssert(step.prompt);
            }
          } catch (execErr: any) {
            stepResult = {
              passed: false,
              thought: execErr.message,
              errorMessage: execErr.message,
            };
          }
        } else {
          // 驱动未就绪：不做任何伪造结果，直接标记失败并附上启动错误
          stepResult = {
            passed: false,
            thought: `测试驱动不可用，未执行该步骤: ${step.prompt}`,
            errorMessage: driverInitError,
          };
        }

        const shotFilename = `step_${i}_${Date.now()}.png`;
        const shotPath = path.join(runDir, shotFilename);

        if (stepResult.screenshotBuffer && stepResult.screenshotBuffer.length > 0) {
          fs.writeFileSync(shotPath, stepResult.screenshotBuffer);
        } else {
          // 兜底生成 SVG 快照
          const svgContent = generateStepVisualSnapshot(
            suite.targetUrl || 'about:blank',
            suite.steps.length,
            i,
            step,
            stepResult.passed ? 'passed' : stepResult.skipped ? 'skipped' : 'failed',
            width,
            height,
            stepResult.targetBox,
            stepResult.thought
          );
          fs.writeFileSync(shotPath, svgContent, 'utf-8');
        }

        const serverUrl = this.options.serverBaseUrl || '';
        const screenshotRelPath = `artifacts/${runId}/${shotFilename}`;
        const screenshotUrl = `${serverUrl}/${screenshotRelPath}`;
        const stepDuration = Date.now() - stepStartTime;

        const stepStatus: StepTimelineRecord['status'] = stepResult.passed
          ? 'passed'
          : stepResult.skipped
          ? 'skipped'
          : 'failed';

        const timelineItem: StepTimelineRecord = {
          stepIndex: i,
          stepId: step.id,
          type: step.type,
          prompt: step.prompt,
          status: stepStatus,
          durationMs: stepDuration,
          screenshotRelPath,
          screenshotUrl,
          boundingBox: stepResult.targetBox,
          thought: stepResult.thought,
          error: stepResult.errorMessage,
        };

        timeline.push(timelineItem);
        this.options.onStepFinish?.(i, timelineItem);

        // 始终执行完全部步骤并留存截图，但任一步骤失败都会让套件判定失败
        if (stepResult.passed) {
          passedSteps++;
        }
      }
    } finally {
      if (driver) {
        await driver.close().catch(() => {});
      }
      lease?.release();
      QaActivity.publish({
        runId,
        platform,
        state: 'finished',
        suiteId: suite.id,
        suiteName: suite.name,
        deviceSerial: activeSerial,
        totalSteps: suite.steps.length,
        at: Date.now(),
      });
    }

    // 任一步骤未通过即判定套件失败，避免全部步骤失败时节点仍显示成功
    const failedStep = timeline.find((item) => item.status === 'failed');
    if (failedStep && runStatus !== 'failed') {
      runStatus = 'failed';
      errorMessage = `步骤 ${failedStep.stepIndex + 1} 未通过: ${failedStep.error || failedStep.thought || 'AI 视觉判断未通过'}`;
    }

    const totalDuration = Date.now() - startTime;
    const reportHtml = this.generateHtmlReport(suite, runId, runStatus, passedSteps, totalDuration, timeline);
    fs.writeFileSync(path.join(runDir, 'report.html'), reportHtml, 'utf-8');
    fs.writeFileSync(path.join(runDir, 'timeline.json'), JSON.stringify(timeline, null, 2), 'utf-8');

    const serverUrl = this.options.serverBaseUrl || '';
    const activeDeviceSerial = driverReady ? driver?.getActiveDeviceSerial?.() || undefined : undefined;
    const record: QaRunRecord = {
      id: runId,
      suiteId: suite.id,
      suiteName: suite.name,
      taskId,
      status: runStatus,
      durationMs: totalDuration,
      passedSteps,
      totalSteps: suite.steps.length,
      platform,
      deviceSerial: suite.deviceSerial || activeDeviceSerial,
      createdAt: startTime,
      finishedAt: Date.now(),
      reportUrl: `${serverUrl}/artifacts/${runId}/report.html`,
      timeline,
      error: errorMessage,
    };

    qaLogger.info(`[MidsceneRunner] 套件执行完毕: ${runStatus.toUpperCase()} (${passedSteps}/${suite.steps.length})`, {
      runId,
      durationMs: totalDuration,
    });

    return record;
  }

  private generateHtmlReport(
    suite: QaSuite,
    runId: string,
    status: 'passed' | 'failed',
    passedSteps: number,
    durationMs: number,
    timeline: StepTimelineRecord[]
  ): string {
    const isPassed = status === 'passed';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>openLoop QA 自动化测试报告 - ${suite.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f8fafc; color: #1e293b; }
    .header { background: #ffffff; border-bottom: 1px solid #e2e8f0; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 600; }
    .badge-passed { background: #dcfce7; color: #15803d; }
    .badge-failed { background: #fee2e2; color: #b91c1c; }
    .container { max-width: 1200px; margin: 32px auto; padding: 0 24px; }
    .timeline { display: flex; flex-direction: column; gap: 24px; }
    .step-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .step-header { padding: 16px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .step-body { padding: 20px; display: flex; gap: 24px; }
    .step-screenshot { width: 60%; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .step-info { width: 40%; font-size: 13px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 style="margin: 0; font-size: 20px;">${suite.name}</h1>
      <p style="margin: 6px 0 0 0; color: #64748b; font-size: 13px;">运行编号: ${runId} | 耗时: ${(durationMs / 1000).toFixed(1)}s</p>
    </div>
    <div>
      <span class="badge ${isPassed ? 'badge-passed' : 'badge-failed'}">
        ${isPassed ? '✔ 全部步骤通过' : '✖ 未通过'} (${timeline.length}/${suite.steps.length} 步已执行 · ${passedSteps} 步通过)
      </span>
    </div>
  </div>
  <div class="container">
    <div class="timeline">
      ${timeline
        .map(
          (t) => `
        <div class="step-card">
          <div class="step-header">
            <strong>步骤 ${t.stepIndex + 1}: [${t.type.toUpperCase()}] ${t.prompt}</strong>
            <span style="color: ${t.status === 'passed' ? '#16a34a' : t.status === 'skipped' ? '#71717a' : '#dc2626'}; font-weight: 600;">
              ${t.status === 'passed' ? '✔ 完成' : t.status === 'skipped' ? '⏭ 跳过（用例未指明可定位目标，未验证）' : '✖ 未通过'} (${t.durationMs}ms)
            </span>
          </div>
          <div class="step-body">
            <img class="step-screenshot" src="${path.basename(t.screenshotRelPath || '')}" alt="Step ${t.stepIndex + 1}" />
            <div class="step-info">
              <p><strong>执行说明:</strong> ${t.thought || '无'}</p>
              ${t.error ? `<p style="color: #dc2626;"><strong>失败原因:</strong> ${t.error}</p>` : ''}
            </div>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  </div>
</body>
</html>`;
  }
}
