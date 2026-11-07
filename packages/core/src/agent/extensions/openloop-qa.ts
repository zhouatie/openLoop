/**
 * openLoop QA 桥
 *
 * 把「真机 / 网页验证」做成 agent 可调用的工具：设备清单、执行用例、读回结果。
 * 工具只是入口，真正的驱动、租约、截图与运行记录都在 QA 引擎里，
 * 因此一次工具调用就产出可回看的运行记录，镜像面板也会同步锁定设备。
 */

import { getQaAgentBridge, type QaAgentDeviceSnapshot } from '../../qa/qa-agent-bridge';
import type { QaPlatform, QaRunRecord, QaStepType } from '../../types';

interface ToolTextContent {
  type: 'text';
  text: string;
}

interface ToolResult {
  content: ToolTextContent[];
  details?: Record<string, unknown>;
  isError?: boolean;
}

interface ToolDefinitionLike {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: any,
    signal?: AbortSignal
  ) => Promise<ToolResult>;
}

interface QaExtensionApi {
  registerTool: (definition: ToolDefinitionLike) => unknown;
}

/** 开发环境把工具调用写进 stderr，跟会话日志一起看 */
function debug(message: string): void {
  if (process.env.NODE_ENV !== 'production') {
    process.stderr.write(`[openloop-qa] ${message}\n`);
  }
}

const PLATFORM_LABEL: Record<QaPlatform, string> = {
  android: 'Android',
  ios: 'iOS',
  web: '网页',
};

/** 步骤类型的中文别名：模型常写「断言: xxx」，这里一并认 */
const STEP_TYPE_ALIASES: Record<string, QaStepType> = {
  action: 'action',
  act: 'action',
  操作: 'action',
  assert: 'assert',
  断言: 'assert',
  waitfor: 'waitFor',
  wait: 'waitFor',
  等待: 'waitFor',
};

const STEP_PREFIX = /^\s*(action|act|assert|waitFor|wait|操作|断言|等待)\s*[:：]\s*/iu;

/** 步骤入参归一化：支持纯字符串，也支持 { type, prompt } 结构 */
function normalizeSteps(raw: unknown): Array<{ type: QaStepType; prompt: string }> {
  if (!Array.isArray(raw)) return [];
  const steps: Array<{ type: QaStepType; prompt: string }> = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const matched = STEP_PREFIX.exec(item);
      const type = matched ? STEP_TYPE_ALIASES[matched[1].toLowerCase()] || 'action' : 'action';
      const prompt = (matched ? item.slice(matched[0].length) : item).trim();
      if (prompt) steps.push({ type, prompt });
      continue;
    }
    if (item && typeof item === 'object') {
      const record = item as { type?: unknown; prompt?: unknown };
      const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
      if (!prompt) continue;
      const alias = typeof record.type === 'string' ? record.type : '';
      steps.push({ type: STEP_TYPE_ALIASES[alias.toLowerCase()] || 'action', prompt });
    }
  }
  return steps;
}

/** 设备清单渲染成可读文本：在线设备、模拟器状态与占用者一行一个 */
function describeDevices(snapshot: QaAgentDeviceSnapshot): string {
  const lines: string[] = [];
  const busyByKey = new Map<string, string>();
  for (const lease of snapshot.leases) {
    if (lease.holder) busyByKey.set(lease.key, lease.holder.label || '未知任务');
  }

  lines.push(`Android 设备 ${snapshot.android.length} 台`);
  for (const device of snapshot.android) {
    const holder = busyByKey.get(device.serial);
    const state = device.status === 'device' ? (holder ? `占用中：${holder}` : '空闲') : device.status;
    lines.push(`- ${device.serial}｜${device.model}${device.version ? `｜Android ${device.version}` : ''}｜${state}`);
  }

  const { ios } = snapshot;
  lines.push(
    `iOS：Xcode ${ios.environment.available ? '可用' : `不可用（${ios.environment.message || '未知原因'}）`}，WDA ${
      ios.wda.reachable ? `就绪（${ios.wda.endpoint}）` : `未连接（${ios.wda.endpoint}）`
    }`
  );
  for (const simulator of ios.simulators) {
    const holder = busyByKey.get(ios.wda.endpoint);
    const state = simulator.state === 'booted' ? (holder ? `占用中：${holder}` : '已启动') : '未启动';
    lines.push(`- ${simulator.name}｜${simulator.model}${simulator.version ? `｜iOS ${simulator.version}` : ''}｜${state}`);
  }

  if (snapshot.android.length === 0 && ios.simulators.length === 0) {
    lines.push('当前没有可用的设备：请先连接 Android 设备或启动 iOS 模拟器。');
  }
  return lines.join('\n');
}

/** 运行结果渲染成可读文本：结论、设备、报告地址与逐步骤明细 */
function describeRun(record: QaRunRecord): string {
  const lines: string[] = [];
  const verdict = record.status === 'passed' ? '通过' : '未通过';
  lines.push(`结论：${verdict}（${record.passedSteps}/${record.totalSteps} 步通过，耗时 ${(record.durationMs / 1000).toFixed(1)}s）`);
  lines.push(`运行 ID：${record.id}`);
  if (record.deviceSerial) lines.push(`设备：${record.deviceSerial}`);
  if (record.reportUrl) lines.push(`报告：${record.reportUrl}`);
  if (record.error) lines.push(`失败原因：${record.error}`);
  lines.push('步骤明细：');
  for (const item of record.timeline) {
    const status = item.status === 'passed' ? '通过' : item.status === 'skipped' ? '跳过' : '失败';
    const shot = item.screenshotRelPath ? ` 截图: ${item.screenshotRelPath}` : '';
    const reason = item.error || item.thought;
    lines.push(`${item.stepIndex + 1}. [${status}] ${item.prompt}${reason && item.status !== 'passed' ? ` — ${reason}` : ''}${shot}`);
  }
  return lines.join('\n');
}

/** 工具错误统一成工具结果：告诉模型失败原因，让它自行决定重试还是汇报 */
function failure(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export default function qaExtension() {
  return function factory(raw: unknown) {
    const pi = raw as QaExtensionApi;
    pi.registerTool({
      name: 'qa_device_status',
      label: 'QA 设备状态',
      description:
        '列出可用于自动化验证的 Android 设备与 iOS 模拟器，以及当前被自动化任务占用的设备。执行验证前先调用它选择目标设备。',
      promptSnippet: '查询可用于自动化验证的设备与占用状态',
      promptGuidelines: [
        '调用 qa_run_suite 前先用 qa_device_status 确认目标设备在线且未被占用。',
      ],
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_toolCallId, _params, signal) {
        const bridge = getQaAgentBridge();
        if (!bridge) return failure('QA 服务尚未就绪：当前进程没有注册 QA 能力，请改用其他方式验证。');
        if (signal?.aborted) return failure('设备查询已取消。');
        const snapshot = await bridge.listDevices();
        debug(`设备状态: android=${snapshot.android.length}, ios=${snapshot.ios.simulators.length}`);
        return {
          content: [{ type: 'text', text: describeDevices(snapshot) }],
          details: { android: snapshot.android, ios: snapshot.ios, leases: snapshot.leases },
        };
      },
    });

    pi.registerTool({
      name: 'qa_run_suite',
      label: '执行 QA 验证',
      description:
        '在真机或网页上执行一组自动化验证步骤并返回逐步骤结论与截图路径。步骤按顺序执行，任一步失败用例即判为未通过，但后续步骤仍会继续执行以留全证据。',
      promptSnippet: '在真机或网页上执行自动化验证用例，返回步骤截图与结论',
      promptGuidelines: [
        '用 qa_run_suite 验证界面改动时，把期望结果写成 assert 步骤，不要只写操作步骤。',
        'qa_run_suite 返回失败时，先看截图与失败原因再决定是修复代码还是调整用例，不要盲目重跑。',
      ],
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '用例名称，会显示在运行记录与设备占用状态里，例如「登录流程验证」',
          },
          platform: { type: 'string', enum: ['android', 'ios', 'web'], description: '执行平台' },
          target: {
            type: 'string',
            description:
              'Android 包名（如 com.example.app）、iOS Bundle ID 或网页 URL。省略时在当前屏幕继续操作，不再拉起应用',
          },
          deviceSerial: {
            type: 'string',
            description: 'Android 设备序列号；不传则使用首个在线设备',
          },
          wdaEndpoint: {
            type: 'string',
            description: 'iOS 的 WebDriverAgent 地址，例如 http://localhost:8100；不传使用默认地址',
          },
          steps: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: { type: { type: 'string' }, prompt: { type: 'string' } },
                  required: ['prompt'],
                  additionalProperties: false,
                },
              ],
            },
            description:
              '步骤列表，按顺序执行。纯文本视为操作步骤；以「断言:」「等待:」开头分别表示断言与轮询等待，例如「断言: 页面显示登录成功」',
          },
        },
        required: ['name', 'platform', 'steps'],
        additionalProperties: false,
      },
      async execute(_toolCallId, params, signal) {
        const bridge = getQaAgentBridge();
        if (!bridge) return failure('QA 服务尚未就绪：当前进程没有注册 QA 能力，请改用其他方式验证。');

        const name = typeof params?.name === 'string' && params.name.trim() ? params.name.trim() : '验证用例';
        const platform = params?.platform as QaPlatform;
        const target = typeof params?.target === 'string' ? params.target.trim() : '';
        const steps = normalizeSteps(params?.steps);

        if (!PLATFORM_LABEL[platform]) return failure(`不支持的平台: ${String(params?.platform)}`);
        if (!target && platform === 'web') return failure('网页验证必须传 target：填写要打开的 URL。');
        if (steps.length === 0) return failure('缺少 steps：至少需要一条操作或断言步骤。');
        if (signal?.aborted) return failure('验证已取消。');

        debug(`执行验证: ${name} ${platform} ${target} steps=${steps.length}`);
        const record = await bridge.runSuite({
          name,
          platform,
          target,
          deviceSerial: typeof params?.deviceSerial === 'string' ? params.deviceSerial.trim() || undefined : undefined,
          wdaEndpoint: typeof params?.wdaEndpoint === 'string' ? params.wdaEndpoint.trim() || undefined : undefined,
          steps,
          ownerId: 'qa-agent',
        });
        return {
          content: [{ type: 'text', text: describeRun(record) }],
          details: { runId: record.id, status: record.status, timeline: record.timeline },
        };
      },
    });
  };
}
