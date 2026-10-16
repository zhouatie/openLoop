import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { WorkflowNode, Task, LogEntry, NodeRun } from '../types';

export interface ExecutionContext {
  task: Task;
  node: WorkflowNode;
  variables: Record<string, any>;
  emitLog: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
}

export interface ExecutionResult {
  status: 'success' | 'failed' | 'waiting_approval' | 'skipped';
  exitCode?: number;
  output?: any;
  error?: string;
  artifacts?: Array<{
    name: string;
    type: 'image' | 'video' | 'log' | 'json';
    path: string;
  }>;
}

export interface NodeExecutor {
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
}

// 变量插值助手函数，例如将 {{inputs.title}} 或 {{context.outputPath}} 替换为实际值
export function interpolateString(template: string, context: Record<string, any>): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const parts = key.split('.');
    let val: any = context;
    for (const part of parts) {
      if (val === undefined || val === null) break;
      val = val[part];
    }
    return val !== undefined ? String(val) : '';
  });
}

// 通用子进程命令行执行器（真实执行子进程，不含任何 Mock）
export class CliCommandExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, variables, emitLog } = ctx;
    const rawCommand = node.config.command;

    if (!rawCommand || !rawCommand.trim()) {
      const err = `[CLI 节点 ${node.id}] 未配置可执行的 command 脚本`;
      emitLog('stderr', err);
      return {
        status: 'failed',
        exitCode: 1,
        error: err,
      };
    }

    const command = interpolateString(rawCommand, variables);
    emitLog('system', `[执行进程] 启动命令: ${command}`);

    return new Promise((resolve) => {
      const child = spawn(command, {
        shell: true,
        cwd: node.config.cwd || process.cwd(),
        env: {
          ...process.env,
          ...node.config.env,
          TASK_ID: ctx.task.id,
          NODE_ID: node.id,
        },
      });

      child.stdout.on('data', (chunk) => {
        emitLog('stdout', chunk.toString().trimEnd());
      });

      child.stderr.on('data', (chunk) => {
        emitLog('stderr', chunk.toString().trimEnd());
      });

      child.on('error', (err) => {
        emitLog('stderr', `[进程执行错误]: ${err.message}`);
        resolve({
          status: 'failed',
          error: err.message,
          exitCode: 1,
        });
      });

      child.on('close', (code) => {
        if (code === 0) {
          emitLog('system', `[执行完成] 退出码: 0`);
          resolve({
            status: 'success',
            exitCode: 0,
            output: { command, executedAt: Date.now() },
          });
        } else {
          emitLog('stderr', `[执行失败] 异常退出码: ${code}`);
          resolve({
            status: 'failed',
            exitCode: code ?? 1,
            error: `Process exited with code ${code}`,
          });
        }
      });
    });
  }
}

// 真实 AI Agent 节点执行器（移除所有模拟 delay 与 fake 输出）
export class AgentExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    const agentName = node.config.agentName || 'OpenLoop Agent';

    emitLog('system', `[Agent 节点] 激活: ${agentName}`);

    if (!node.config.command) {
      const err = `[Agent 节点 ${node.id}] 未配置 Agent 执行 CLI 命令 (例如 openloop-agent, pi 或自定义脚本)`;
      emitLog('stderr', err);
      return {
        status: 'failed',
        exitCode: 1,
        error: err,
      };
    }

    return this.cliExecutor.execute(ctx);
  }
}

// 真实 Hook 节点执行器
export class HookExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    emitLog('system', `[Hook 节点] 触发流转事件: ${node.name}`);

    if (!node.config.command) {
      const err = `[Hook 节点 ${node.id}] 未配置 Hook 触发脚本`;
      emitLog('stderr', err);
      return {
        status: 'failed',
        exitCode: 1,
        error: err,
      };
    }

    return this.cliExecutor.execute(ctx);
  }
}

// 真实 Midscene 智能测试执行器（真实执行测试并从磁盘提取产物）
export class MidsceneExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    const testUrl = node.config.testUrl;

    emitLog('system', `[Midscene UI 测试] 目标地址: ${testUrl || '未指定'}`);

    if (!node.config.command) {
      const err = `[Midscene 节点 ${node.id}] 未配置真实测试命令 (如 npx midscene run ...)`;
      emitLog('stderr', err);
      return {
        status: 'failed',
        exitCode: 1,
        error: err,
      };
    }

    const res = await this.cliExecutor.execute(ctx);
    if (res.status !== 'success') {
      return res;
    }

    // 检查是否有真实产物输出在指定目录
    const artifacts: Array<{ name: string; type: 'image' | 'video' | 'log' | 'json'; path: string }> = [];
    const reportDir = node.config.screenshotPath;
    if (reportDir && fs.existsSync(reportDir)) {
      try {
        const files = fs.readdirSync(reportDir);
        for (const file of files) {
          if (/\.(png|jpe?g|webp)$/i.test(file)) {
            artifacts.push({
              name: file,
              type: 'image',
              path: path.join(reportDir, file),
            });
          }
        }
      } catch {
        // ignore
      }
    }

    return {
      ...res,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    };
  }
}

// 真实拼接截图与动图生成执行器
export class StitchImageExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    const outputFile = node.config.outputFile;

    emitLog('system', `[动图拼接节点] 目标输出: ${outputFile || '未指定'}`);

    if (!node.config.command) {
      const err = `[动图拼接节点 ${node.id}] 未配置合成脚本 (如 ffmpeg 或 gifski)`;
      emitLog('stderr', err);
      return {
        status: 'failed',
        exitCode: 1,
        error: err,
      };
    }

    const res = await this.cliExecutor.execute(ctx);
    if (res.status !== 'success') {
      return res;
    }

    // 仅当真实产物生成在磁盘时收集
    const artifacts: Array<{ name: string; type: 'image' | 'video' | 'log' | 'json'; path: string }> = [];
    if (outputFile && fs.existsSync(outputFile)) {
      artifacts.push({
        name: path.basename(outputFile),
        type: outputFile.endsWith('.gif') ? 'image' : 'video',
        path: outputFile,
      });
    }

    return {
      ...res,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    };
  }
}

// QA 人工审核与验证挂起执行器（状态机断点机制，等待人工批准或驳回）
export class QaApprovalExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    emitLog('system', `=====================================================`);
    emitLog('system', `[QA 验收拦截] 工作流进入人工/测试用例验收阶段`);
    emitLog('system', `[提示]: ${node.config.approvalPrompt || '等待 QA 人工确认测试产物'}`);
    if (node.config.checklist && node.config.checklist.length > 0) {
      emitLog('system', `[核查清单]:`);
      node.config.checklist.forEach((item, idx) => {
        emitLog('system', `  ${idx + 1}. [ ] ${item}`);
      });
    }
    emitLog('system', `任务已挂起，可通过桌面端看板点击【验收通过】或命令行 openloop task approve 恢复。`);
    emitLog('system', `=====================================================`);

    return {
      status: 'waiting_approval',
    };
  }
}

export class ExecutorRegistry {
  private executors: Map<string, NodeExecutor> = new Map();

  constructor() {
    this.register('cli', new CliCommandExecutor());
    this.register('agent', new AgentExecutor());
    this.register('hook', new HookExecutor());
    this.register('midscene', new MidsceneExecutor());
    this.register('stitch-image', new StitchImageExecutor());
    this.register('qa-approval', new QaApprovalExecutor());
  }

  register(type: string, executor: NodeExecutor) {
    this.executors.set(type, executor);
  }

  get(type: string): NodeExecutor {
    const exec = this.executors.get(type);
    if (!exec) {
      return this.executors.get('cli')!;
    }
    return exec;
  }
}
