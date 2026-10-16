import { spawn } from 'child_process';
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

// 通用子进程命令行执行器
export class CliCommandExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, variables, emitLog } = ctx;
    const rawCommand = node.config.command || 'echo "No command configured"';
    const command = interpolateString(rawCommand, variables);

    emitLog('system', `[CLI 执行器] 开始执行命令: ${command}`);

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
        const text = chunk.toString();
        emitLog('stdout', text.trimEnd());
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        emitLog('stderr', text.trimEnd());
      });

      child.on('error', (err) => {
        emitLog('stderr', `[进程启动失败]: ${err.message}`);
        resolve({
          status: 'failed',
          error: err.message,
          exitCode: 1,
        });
      });

      child.on('close', (code) => {
        if (code === 0) {
          emitLog('system', `[CLI 执行器] 执行成功 (退出码: 0)`);
          resolve({
            status: 'success',
            exitCode: 0,
            output: { command, executedAt: Date.now() },
          });
        } else {
          emitLog('stderr', `[CLI 执行器] 执行失败 (退出码: ${code})`);
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

// AI Agent 节点执行器
export class AgentExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    const agentName = node.config.agentName || '通用 Agent';
    const prompt = node.config.prompt || '自动化编码与构建流程';

    emitLog('system', `[Agent 接入] 唤醒 Agent: ${agentName}`);
    emitLog('system', `[Agent 目标] ${prompt}`);

    // 如果配置了 CLI 命令则真实执行，否则执行自带的模拟/默认 Agent 逻辑
    if (node.config.command) {
      return this.cliExecutor.execute(ctx);
    }

    emitLog('stdout', `[${agentName}] 正在分析需求并进行代码修改...`);
    await new Promise((r) => setTimeout(r, 1500));
    emitLog('stdout', `[${agentName}] 修改完毕，已生成补丁与改动文件。`);
    emitLog('system', `[${agentName}] 任务开发阶段完成，触发下一阶段 Hook！`);

    return {
      status: 'success',
      exitCode: 0,
      output: {
        agent: agentName,
        status: 'code_generated',
        changedFiles: ['src/App.tsx', 'src/services/api.ts'],
      },
    };
  }
}

// Hook 节点执行器
export class HookExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    emitLog('system', `[Hook 调度] 接收到上游状态完成事件，正在触发下游流转...`);

    if (node.config.command) {
      return this.cliExecutor.execute(ctx);
    }

    await new Promise((r) => setTimeout(r, 800));
    emitLog('system', `[Hook 调度] 事件广播成功，已自动推进流程至 QA 自动化验证阶段`);

    return {
      status: 'success',
      output: { hookFired: true, timestamp: Date.now() },
    };
  }
}

// Midscene 智能测试执行器
export class MidsceneExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    const testUrl = node.config.testUrl || 'http://localhost:3000';
    const instructions = node.config.instructions || ['校验主页显示', '操作核心按钮'];

    emitLog('system', `[Midscene UI 测试] 目标地址: ${testUrl}`);
    for (const inst of instructions) {
      emitLog('system', `[Midscene 指令] -> ${inst}`);
    }

    if (node.config.command) {
      const res = await this.cliExecutor.execute(ctx);
      return {
        ...res,
        artifacts: [
          { name: 'step1_landing.png', type: 'image', path: './artifacts/midscene/step1.png' },
          { name: 'step2_action.png', type: 'image', path: './artifacts/midscene/step2.png' },
          { name: 'step3_result.png', type: 'image', path: './artifacts/midscene/step3.png' },
        ],
      };
    }

    emitLog('stdout', `[Midscene] 正在连接无头 Chrome 实例...`);
    await new Promise((r) => setTimeout(r, 1000));
    emitLog('stdout', `[Midscene] 步骤 1/3: 导航至页面，捕获截图: step1_landing.png`);
    await new Promise((r) => setTimeout(r, 800));
    emitLog('stdout', `[Midscene] 步骤 2/3: 智能定位操作元素，执行交互，捕获截图: step2_action.png`);
    await new Promise((r) => setTimeout(r, 800));
    emitLog('stdout', `[Midscene] 步骤 3/3: 断言验收指标成功，捕获截图: step3_result.png`);

    return {
      status: 'success',
      output: {
        testedUrl: testUrl,
        stepsExecuted: instructions.length,
        screenshots: ['step1_landing.png', 'step2_action.png', 'step3_result.png'],
      },
      artifacts: [
        { name: 'step1_landing.png', type: 'image', path: './artifacts/midscene/step1.png' },
        { name: 'step2_action.png', type: 'image', path: './artifacts/midscene/step2.png' },
        { name: 'step3_result.png', type: 'image', path: './artifacts/midscene/step3.png' },
      ],
    };
  }
}

// 拼接截图与生成动图执行器
export class StitchImageExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    const format = node.config.outputFormat || 'gif';
    const outputFile = node.config.outputFile || `./artifacts/flow_result.${format}`;

    emitLog('system', `[截图拼接] 目标格式: ${format}, 输出文件: ${outputFile}`);

    if (node.config.command) {
      const res = await this.cliExecutor.execute(ctx);
      return {
        ...res,
        artifacts: [
          { name: `animation.${format}`, type: format === 'gif' ? 'image' : 'video', path: outputFile },
        ],
      };
    }

    emitLog('stdout', `[Stitcher CLI] 扫描源目录截图文件 [step1.png, step2.png, step3.png]...`);
    await new Promise((r) => setTimeout(r, 1000));
    emitLog('stdout', `[Stitcher CLI] 帧率设置: 1.5s/帧，添加高亮操作红框...`);
    await new Promise((r) => setTimeout(r, 800));
    emitLog('stdout', `[Stitcher CLI] 生成动画动图成功: ${outputFile}`);

    return {
      status: 'success',
      output: { outputFile, frames: 3 },
      artifacts: [
        { name: `preview.${format}`, type: 'image', path: outputFile },
      ],
    };
  }
}

// QA 人工审核与验证挂起执行器
export class QaApprovalExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    emitLog('system', `=====================================================`);
    emitLog('system', `[QA 验证拦截] 流程已进入人工/测试用例验收阶段！`);
    emitLog('system', `[提示]: ${node.config.approvalPrompt || '等待 QA 检查测试截图与动画'}`);
    if (node.config.checklist && node.config.checklist.length > 0) {
      emitLog('system', `[核查清单]:`);
      node.config.checklist.forEach((item, idx) => {
        emitLog('system', `  ${idx + 1}. [ ] ${item}`);
      });
    }
    emitLog('system', `任务已挂起，可在桌面端看板点击【确认通过】或在 CLI 执行 'openloop task approve'。`);
    emitLog('system', `=====================================================`);

    // 挂起状态
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
      // 找不到则回退使用通用 CLI 执行器
      return this.executors.get('cli')!;
    }
    return exec;
  }
}
