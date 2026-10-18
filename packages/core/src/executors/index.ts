import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkflowNode, Task, LogEntry, NodeRun, TaskSessionState, QaSuite, QaStep } from '../types';
import { createLogger } from '../logger';
import { PiRpcSessionManager } from '../agent/pi-rpc-session';
import { MidsceneRunner } from '../qa/midscene-runner';

const executorLogger = createLogger('Executor');

function resolveWorkingDir(rawPath?: string): string | undefined {
  if (!rawPath || typeof rawPath !== 'string') return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export interface ExecutionContext {
  task: Task;
  node: WorkflowNode;
  variables: Record<string, any>;
  emitLog: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
  settings?: Record<string, any>;
  registerChildProcess?: (child: ChildProcess) => void;
  abortSignal?: AbortSignal;
  onSessionUpdate?: (state: TaskSessionState) => void;
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

// 通用子进程命令行执行器（真实执行子进程，具备超时保护、标准输入关闭与进程组清理机制）
export class CliCommandExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, variables, emitLog, settings = {} } = ctx;
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

    const isWsRequired = Boolean(node.config?.requireWorkspace);
    if (isWsRequired && !node.config.cwd && !ctx.task.workspace) {
      const err = `[工作区未指定] 节点 [${node.name || node.id}] 要求必须指定工程工作区目录，但当前任务未关联任何工作区。已终止执行。`;
      emitLog('stderr', err);
      return {
        status: 'failed',
        exitCode: 1,
        error: err,
      };
    }

    const resolvedCwd = resolveWorkingDir(node.config.cwd || ctx.task.workspace);
    const isSandbox = !resolvedCwd;
    const cwd = resolvedCwd || os.tmpdir();

    emitLog('system', `[执行进程] 启动命令: ${command}`);
    if (isSandbox) {
      emitLog('system', `[执行沙箱] 任务未关联本地工程代码目录，在安全独立沙箱 (${cwd}) 下执行`);
    } else {
      emitLog('system', `[工作区目录] ${cwd}`);
    }

    const timeoutMs = node.config.timeoutSec
      ? Number(node.config.timeoutSec) * 1000
      : 600000; // 默认 10 分钟超时

    executorLogger.info(
      `[CLI:Spawn] 准备启动进程，工作区 (CWD): "${cwd}", 超时设定: ${timeoutMs / 1000}s`,
      { command: command.length > 300 ? command.slice(0, 300) + '...' : command, workspace: ctx.task.workspace },
      { taskId: ctx.task.id, nodeId: node.id }
    );

    const startTime = Date.now();

    return new Promise((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const isUnix = process.platform !== 'win32';

      const child = spawn(command, {
        shell: true,
        cwd,
        detached: isUnix, // Unix 下独立进程组，便于杀掉包括孙进程在内的整棵树
        env: {
          ...process.env,
          ...node.config.env,
          TASK_ID: ctx.task.id,
          NODE_ID: node.id,
          TASK_WORKSPACE: ctx.task.workspace || cwd,
        },
      });

      executorLogger.debug(
        `[CLI:Spawned] 进程已创建，PID: ${child.pid}`,
        undefined,
        { taskId: ctx.task.id, nodeId: node.id }
      );

      // 注册活跃子进程以便外部实时监控或强制终止
      if (ctx.registerChildProcess) {
        ctx.registerChildProcess(child);
      }

      // 杀死子进程组的辅助函数
      const killProcessTree = (signal: NodeJS.Signals = 'SIGKILL') => {
        try {
          if (child.pid) {
            if (isUnix) {
              process.kill(-child.pid, signal);
            } else {
              child.kill(signal);
            }
          }
        } catch (_) {}
      };

      // 关键修复 1：非交互式执行立即关闭标准输入，防止 CLI 进程因等待 stdin 阻塞
      if (child.stdin && !child.stdin.destroyed) {
        try {
          child.stdin.end();
        } catch (_) {}
      }

      const finish = (result: ExecutionResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        // 确保清理残留的孙子进程（例如 MCP 服务器等）
        killProcessTree();
        resolve(result);
      };

      // 监听外部中断信号
      if (ctx.abortSignal) {
        if (ctx.abortSignal.aborted) {
          killProcessTree('SIGKILL');
          finish({
            status: 'failed',
            exitCode: -1,
            error: '任务已被用户手动终止',
          });
          return;
        }
        ctx.abortSignal.addEventListener('abort', () => {
          executorLogger.warn(`[CLI] 收到终止信号，强杀子进程树 PID: ${child.pid}`, undefined, {
            taskId: ctx.task.id,
            nodeId: node.id,
          });
          killProcessTree('SIGKILL');
          finish({
            status: 'failed',
            exitCode: -1,
            error: '任务已被用户手动终止',
          });
        });
      }

      // 关键修复 2：设置超时安全保护，防止自动化任务无限挂起
      timer = setTimeout(() => {
        const cost = Date.now() - startTime;
        executorLogger.error(
          `[CLI:Timeout] 节点进程执行超过 ${timeoutMs / 1000} 秒上限，强制杀死进程组 (PID: ${child.pid})`,
          undefined,
          { taskId: ctx.task.id, nodeId: node.id }
        );
        emitLog('stderr', `[执行超时] 节点执行超过 ${timeoutMs / 1000} 秒上限，系统已强制终止`);
        finish({
          status: 'failed',
          exitCode: 124,
          error: `Execution timed out after ${timeoutMs}ms (elapsed: ${cost}ms)`,
        });
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString().trimEnd();
        emitLog('stdout', text);
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString().trimEnd();
        emitLog('stderr', text);
      });

      child.on('error', (err) => {
        executorLogger.error(
          `[CLI:Error] 子进程产生错误: ${err.message}`,
          err,
          { taskId: ctx.task.id, nodeId: node.id }
        );
        emitLog('stderr', `[进程执行错误]: ${err.message}`);
        finish({
          status: 'failed',
          error: err.message,
          exitCode: 1,
        });
      });

      // 关键修复 3：exit 事件即刻捕获退出码；若孙进程泄露 stdio 管道导致 close 事件延迟，超时 1s 兜底自动完成
      let exitCode: number | null = null;
      child.on('exit', (code) => {
        exitCode = code;
        setTimeout(() => {
          if (!settled) {
            handleExit(exitCode);
          }
        }, 1000);
      });

      child.on('close', (code) => {
        handleExit(code ?? exitCode);
      });

      const handleExit = (code: number | null) => {
        const duration = Date.now() - startTime;
        if (code === 0) {
          executorLogger.info(
            `[CLI:Exit] 进程执行成功，退出码: 0 (耗时: ${duration}ms)`,
            undefined,
            { taskId: ctx.task.id, nodeId: node.id }
          );
          emitLog('system', `[执行完成] 退出码: 0`);
          finish({
            status: 'success',
            exitCode: 0,
            output: { command, executedAt: Date.now() },
          });
        } else {
          executorLogger.error(
            `[CLI:Exit] 进程非正常退出，退出码: ${code} (耗时: ${duration}ms)`,
            undefined,
            { taskId: ctx.task.id, nodeId: node.id }
          );
          emitLog('stderr', `[执行失败] 异常退出码: ${code}`);
          finish({
            status: 'failed',
            exitCode: code ?? 1,
            error: `Process exited with code ${code}`,
          });
        }
      };
    });
  }
}

// 真实 AI Agent 节点执行器，支持通过 pi agent 或自定义 CLI 驱动
export class AgentExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, task, emitLog, settings = {} } = ctx;
    const agentName = node.config.agentName || 'OpenLoop Agent';
    const agentProvider = settings.agentProvider || 'pi';

    executorLogger.info(
      `[Agent] 激活 Agent [${agentName}] (驱动: ${agentProvider})`,
      { agentConfig: node.config },
      { taskId: task.id, nodeId: node.id }
    );
    emitLog('system', `[Agent 节点] 激活: ${agentName} (驱动模式: ${agentProvider})`);

    // 若配置了 pi agent 驱动
    if (agentProvider === 'pi') {
      // 1. 获取或生成唯一的持久化会话标识
      const sessionId =
        task.context?.piSessionId ||
        `session_${task.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      if (!task.context) task.context = {};
      task.context.piSessionId = sessionId;

      // 2. 提取并组装 Prompt (多重变量兜底与需求注入)
      const rawPrompt =
        node.config.prompt ||
        task.description ||
        node.config.command ||
        `请完成任务 [${task.title}] 的代码实现并进行必要验证。`;
      
      let prompt = interpolateString(rawPrompt, {
        task: {
          id: task.id,
          title: task.title,
          description: task.description || '',
          workflowId: task.workflowId,
        },
        ...ctx.variables,
      });

      // 兜底保障：确保 Prompt 中始终包含具体的任务标题与详细说明，防止模板插值留白
      if (!prompt.includes(task.title)) {
        prompt = `任务需求: ${task.title}\n详细说明: ${task.description || '无详细说明'}\n\n执行要求:\n${prompt}`;
      }

      // 若任务附带图片附件，注入本地物理文件路径提示，使 Agent 能够直接通过文件工具进行多模态视觉感知
      if (task.attachments && task.attachments.length > 0) {
        const attList = task.attachments
          .map((att, i) => `  ${i + 1}. [${att.name}] (大小: ${(att.size / 1024).toFixed(1)} KB, 本地绝对路径: "${att.path}")`)
          .join('\n');
        prompt += `\n\n【任务关联参考截图/附件】\n用户为此任务附带了以下图片资源，你可以直接通过本地工具读取这些路径以分析 UI 或报错：\n${attList}`;
      }

      // 3. 构建 pi CLI 执行命令
      const args: string[] = [
        `--session-id "${sessionId}"`,
        `--name "openLoop: ${task.title.replace(/"/g, '\\"')}"`,
      ];

      if (settings.piModel && String(settings.piModel).trim()) {
        args.push(`--model "${String(settings.piModel).trim()}"`);
      }
      if (settings.piThinking && settings.piThinking !== 'off') {
        args.push(`--thinking ${settings.piThinking}`);
      }
      if (settings.piTools && String(settings.piTools).trim()) {
        args.push(`--tools "${String(settings.piTools).trim()}"`);
      }

      const isWsRequired = Boolean(node.config?.requireWorkspace);
      if (isWsRequired && !node.config.cwd && !task.workspace) {
        const err = `[工作区未指定] Agent 节点 [${node.name || node.id}] 要求必须指定工程工作区目录，但当前任务未关联任何工作区。已终止执行。`;
        emitLog('stderr', err);
        return {
          status: 'failed',
          exitCode: 1,
          error: err,
        };
      }

      const resolvedCwd = resolveWorkingDir(node.config.cwd || task.workspace);
      const isSandbox = !resolvedCwd;
      const cwd = resolvedCwd || os.tmpdir();

      executorLogger.info(
        `[Agent:Pi] 建立 Pi Agent RPC 会话，Session ID: ${sessionId} (工作区 CWD: ${cwd})`,
        { promptPreview: prompt.length > 200 ? prompt.slice(0, 200) + '...' : prompt, workspace: task.workspace },
        { taskId: task.id, nodeId: node.id }
      );
      emitLog('system', `[Pi Agent 会话] Session ID: ${sessionId}`);
      if (isSandbox) {
        emitLog('system', `[执行沙箱] 任务未关联本地代码工作区，在安全独立沙箱 (${cwd}) 下执行`);
      } else {
        emitLog('system', `[工作区 CWD] ${cwd}`);
      }
      emitLog('system', `[终端恢复提示] 如需在终端中交互式接管，可执行: pi --session ${sessionId}`);

      return new Promise<ExecutionResult>((resolve) => {
        let settled = false;
        const finish = (result: ExecutionResult) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        const session = PiRpcSessionManager.getInstance().createSession({
          taskId: task.id,
          taskTitle: task.title,
          taskDescription: task.description,
          sessionId,
          agentName,
          model: settings.piModel,
          thinking: settings.piThinking,
          tools: settings.piTools,
          cwd,
          initialPrompt: prompt,
          onLog: emitLog,
          onUpdate: (state) => {
            if (ctx.onSessionUpdate) {
              ctx.onSessionUpdate(state);
            }
          },
          onFinished: (error) => {
            const abortFile = path.join(os.tmpdir(), `openloop_abort_${task.id}`);
            let abortReason: string | undefined;
            if (fs.existsSync(abortFile)) {
              try {
                abortReason = fs.readFileSync(abortFile, 'utf-8').trim();
                fs.unlinkSync(abortFile);
              } catch {}
            }

            const finalError = error || abortReason;
            if (finalError) {
              finish({
                status: 'failed',
                exitCode: 1,
                error: finalError,
              });
            } else {
              finish({
                status: 'success',
                exitCode: 0,
                output: {
                  agentProvider: 'pi',
                  piSessionId: sessionId,
                  resumeCommand: `pi --session ${sessionId}`,
                },
              });
            }
          },
        });

        if (ctx.abortSignal) {
          if (ctx.abortSignal.aborted) {
            session.terminate();
            finish({
              status: 'failed',
              exitCode: -1,
              error: '任务已被用户手动终止',
            });
            return;
          }
          ctx.abortSignal.addEventListener('abort', () => {
            session.terminate();
            finish({
              status: 'failed',
              exitCode: -1,
              error: '任务已被用户手动终止',
            });
          });
        }
      });
    }

    if (!node.config.command) {
      const err = `[Agent 节点 ${node.id}] 未配置 Agent 执行 CLI 命令 (例如 openloop-agent, pi 或自定义脚本)`;
      executorLogger.error(`[Agent] 未配置执行 CLI 命令`, undefined, { taskId: task.id, nodeId: node.id });
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
    executorLogger.info(`[Hook] 触发流转事件节点: [${node.name}]`, undefined, { taskId: ctx.task.id, nodeId: node.id });
    emitLog('system', `[Hook 节点] 触发流转事件: ${node.name}`);

    if (!node.config.command) {
      const err = `[Hook 节点 ${node.id}] 未配置 Hook 触发脚本`;
      executorLogger.error(`[Hook] 未配置脚本`, undefined, { taskId: ctx.task.id, nodeId: node.id });
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

// 真实 Midscene 智能测试执行器（支持内置 Runner 与外部 CLI 执行）
export class MidsceneExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog, variables, task } = ctx;
    const rawTestUrl = node.config.testUrl || 'http://localhost:3000';
    const testUrl = interpolateString(rawTestUrl, variables);

    executorLogger.info(`[Midscene] 准备执行 UI 自动化测试, Target: ${testUrl}`, undefined, { taskId: task.id, nodeId: node.id });
    emitLog('system', `[Midscene UI 测试] 启动自动化测试, 目标地址: ${testUrl}`);

    // 分支 1: 如果显式配置了自定义 CLI 命令行，则保持兼容优先执行 CLI
    if (node.config.command && node.config.command.trim()) {
      const res = await this.cliExecutor.execute(ctx);
      if (res.status !== 'success') {
        return res;
      }
      const artifacts: Array<{ name: string; type: 'image' | 'video' | 'log' | 'json'; path: string }> = [];
      const reportDir = node.config.screenshotPath;
      if (reportDir && fs.existsSync(reportDir)) {
        try {
          const files = fs.readdirSync(reportDir);
          for (const file of files) {
            if (/\.(png|jpe?g|webp|svg)$/i.test(file)) {
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

    // 分支 2: 使用内置 MidsceneRunner 驱动测试，带每步回调与产物收集
    try {
      const dataDir = path.join(os.homedir(), '.openloop');
      const instructions = node.config.instructions && node.config.instructions.length > 0
        ? node.config.instructions
        : [
            '等待页面完全加载，检查首屏关键元素',
            '点击核心导航或登录入口',
            '视觉校验页面状态机进入就绪态，无报错遮罩',
          ];

      const steps: QaStep[] = instructions.map((inst, idx) => ({
        id: `step_${idx + 1}`,
        type: inst.includes('校验') || inst.includes('检查') ? 'assert' : 'action',
        prompt: inst,
      }));

      const suite: QaSuite = {
        id: node.config.suiteId || `suite_node_${node.id}`,
        name: `${node.name} (流水线任务 ${task.title})`,
        targetUrl: testUrl,
        steps,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const runner = new MidsceneRunner({
        artifactBaseDir: path.join(dataDir, 'artifacts'),
        serverBaseUrl: 'http://127.0.0.1:19888',
        onStepStart: (index, step) => {
          emitLog('stdout', `[Midscene 步骤 ${index + 1}/${steps.length}] 执行: [${step.type}] ${step.prompt}`);
        },
        onStepFinish: (index, record) => {
          if (record.status === 'passed') {
            emitLog('stdout', `[Midscene 步骤 ${index + 1}] ✔ 完成 (${record.durationMs}ms) - ${record.thought || ''}`);
          } else {
            emitLog('stderr', `[Midscene 步骤 ${index + 1}] ✖ 失败: ${record.error || '断言未通过'}`);
          }
        },
        onLog: (msg) => {
          emitLog('system', msg);
        },
      });

      const runRecord = await runner.runSuite(suite, task.id);

      // 组装 artifacts 产物供下游消费
      const artifacts: Array<{ name: string; type: 'image' | 'video' | 'log' | 'json'; path: string }> = [];
      const runDir = path.join(dataDir, 'artifacts', runRecord.id);

      if (fs.existsSync(runDir)) {
        const files = fs.readdirSync(runDir);
        for (const f of files) {
          const fullPath = path.join(runDir, f);
          if (/\.(png|jpe?g|webp|svg)$/i.test(f)) {
            artifacts.push({ name: f, type: 'image', path: fullPath });
          } else if (f.endsWith('.json')) {
            artifacts.push({ name: f, type: 'json', path: fullPath });
          }
        }
      }

      // 将关键截图产物写入 task.attachments
      if (!task.attachments) {
        task.attachments = [];
      }
      for (const art of artifacts.filter((a) => a.type === 'image')) {
        task.attachments.push({
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: art.name,
          mimeType: art.name.endsWith('.svg') ? 'image/svg+xml' : 'image/webp',
          path: art.path,
          url: `/artifacts/${runRecord.id}/${art.name}`,
          size: fs.existsSync(art.path) ? fs.statSync(art.path).size : 1024,
          createdAt: Date.now(),
        });
      }

      const isSuccess = runRecord.status === 'passed';
      if (isSuccess) {
        emitLog('system', `[Midscene UI 测试] 全流程通过！总耗时: ${(runRecord.durationMs / 1000).toFixed(2)}s, 产出 ${artifacts.length} 个快照`);
      } else {
        emitLog('stderr', `[Midscene UI 测试] 测试未通过: ${runRecord.error || '存在断言失败步骤'}`);
      }

      return {
        status: isSuccess ? 'success' : 'failed',
        exitCode: isSuccess ? 0 : 1,
        error: isSuccess ? undefined : runRecord.error,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        output: {
          qa: {
            runId: runRecord.id,
            status: runRecord.status,
            passed: isSuccess,
            totalSteps: runRecord.totalSteps,
            passedSteps: runRecord.passedSteps,
            durationMs: runRecord.durationMs,
            reportUrl: runRecord.reportUrl,
            timeline: runRecord.timeline,
          },
        },
      };
    } catch (err: any) {
      const errorMsg = `[Midscene 节点异常] ${err.message}`;
      executorLogger.error(errorMsg, err, { taskId: task.id, nodeId: node.id });
      emitLog('stderr', errorMsg);
      return {
        status: 'failed',
        exitCode: 1,
        error: errorMsg,
      };
    }
  }
}

// 真实拼接截图与动图生成执行器
export class StitchImageExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog } = ctx;
    const outputFile = node.config.outputFile;

    executorLogger.info(`[StitchImage] 准备执行动图/视频拼接, 输出目标: ${outputFile || '未指定'}`, undefined, { taskId: ctx.task.id, nodeId: node.id });
    emitLog('system', `[动图拼接节点] 目标输出: ${outputFile || '未指定'}`);

    if (!node.config.command) {
      const err = `[动图拼接节点 ${node.id}] 未配置合成脚本 (如 ffmpeg 或 gifski)`;
      executorLogger.error(`[StitchImage] 未配置合成脚本`, undefined, { taskId: ctx.task.id, nodeId: node.id });
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

    executorLogger.info(
      `[StitchImage] 拼接完成, 产物文件存在: ${fs.existsSync(outputFile || '')}`,
      undefined,
      { taskId: ctx.task.id, nodeId: node.id }
    );

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
    executorLogger.warn(
      `[QA-Approval] 任务断点拦截，等待人工确认. 提示: "${node.config.approvalPrompt || '等待 QA 人工确认'}"`,
      { checklist: node.config.checklist },
      { taskId: ctx.task.id, nodeId: node.id }
    );
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
