/**
 * openLoop 开发服务桥
 *
 * 把「按工作目录拉起 RN Metro」做成 agent 可调用的工具：改完代码就地启动、探活、停止，
 * 不必先建任务或跑流水线。命令与端口来自工作区已保存的配置，缺省用工程自动探测值。
 */

import {
  getDevServerConfig,
  getDevServerManager,
} from '../../dev-server/dev-server-manager';
import type { DevServerSnapshot } from '../../dev-server/types';

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
  execute: (toolCallId: string, params: any, signal?: AbortSignal) => Promise<ToolResult>;
}

interface DevServerExtensionApi {
  registerTool: (definition: ToolDefinitionLike) => unknown;
}

/** 会话等待服务就绪的上限：Metro 首包编译慢，但不必让一轮对话久等到无反馈 */
const READY_TIMEOUT_MS = 90_000;

/** 开发环境把工具调用写进 stderr，跟会话日志一起看 */
function debug(message: string): void {
  if (process.env.NODE_ENV !== 'production') {
    process.stderr.write(`[openloop-dev-server] ${message}\n`);
  }
}

function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function failure(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }], isError: true };
}

/** 快照转成模型可读的一段话：状态、地址、命令与失败原因一次说完 */
function describeSnapshot(snapshot: DevServerSnapshot): string {
  if (!snapshot.root) {
    return '未找到可启动的工程：当前会话目录及其上级都没有 package.json。';
  }

  const lines: string[] = [];
  const state = snapshot.running
    ? '运行中'
    : snapshot.starting
      ? '启动中（端口尚未监听）'
      : snapshot.error
        ? '启动失败'
        : '已停止';
  lines.push(`开发服务：${state}`);
  lines.push(`工程目录：${snapshot.root}`);
  lines.push(`启动命令：${snapshot.command}`);
  lines.push(`端口：${snapshot.port}`);
  if (snapshot.url) lines.push(`本机地址：${snapshot.url}`);
  if (snapshot.lanUrl) lines.push(`局域网地址（真机可用）：${snapshot.lanUrl}`);
  if (snapshot.pid) lines.push(`进程 PID：${snapshot.pid}`);
  if (snapshot.error) lines.push(`失败原因：${snapshot.error}`);
  if (snapshot.logs.length > 0) {
    lines.push('最近输出：');
    lines.push(...snapshot.logs.slice(-12));
  }
  return lines.join('\n');
}

/** 扩展工厂：cwd 由 openLoop 建会话时注入，同一进程里的多个会话互不影响 */
export default function devServerExtension(options: { cwd: string }) {
  return (pi: DevServerExtensionApi) => {
    const resolveCwd = (raw: unknown): string => {
      const value = typeof raw === 'string' ? raw.trim() : '';
      return value || options.cwd;
    };

    pi.registerTool({
      name: 'dev_server',
      label: 'RN 开发服务',
      description:
        '启动、探活或停止当前工作区的 RN 开发服务（Metro）。改完 RN 代码需要真机或模拟器加载最新 bundle 时使用。服务在后台常驻，不受本轮对话结束影响。',
      promptSnippet: '启动/停止工作区 RN 开发服务（Metro）',
      promptGuidelines: [
        '改完 RN 代码后，用 dev_server 的 start 让 Metro 生效，再用界面或真机验证。',
        'start 会等到端口就绪或超时才返回；返回文本里的局域网地址可直接给真机使用。',
      ],
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'start', 'stop'],
            description: 'status 读取状态；start 拉起服务并等待就绪；stop 停止服务',
          },
          cwd: {
            type: 'string',
            description: '要操作的工作区目录；省略时用当前会话目录',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async execute(_toolCallId, params, signal) {
        const action = String(params?.action || '');
        const cwd = resolveCwd(params?.cwd);
        const saved = getDevServerConfig(cwd);
        const manager = getDevServerManager();

        if (action === 'status') {
          return text(describeSnapshot(await manager.status(cwd, saved)));
        }

        if (action === 'start') {
          if (signal?.aborted) return failure('已取消。');
          debug(`启动开发服务: ${cwd}`);
          const started = await manager.start(cwd, saved);
          if (started.error && !started.starting) return failure(describeSnapshot(started));
          const ready = started.running ? started : await manager.waitReady(cwd, READY_TIMEOUT_MS, saved);
          const result = text(describeSnapshot(ready));
          return { ...result, details: { port: ready.port, url: ready.url, running: ready.running } };
        }

        if (action === 'stop') {
          debug(`停止开发服务: ${cwd}`);
          return text(describeSnapshot(await manager.stop(cwd, saved)));
        }

        return failure(`不支持的动作: ${action || '(空)'}`);
      },
    });
  };
}
