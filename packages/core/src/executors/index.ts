import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkflowNode, Task, LogEntry, NodeRun, TaskSessionState, QaSuite, QaStep } from '../types';
import { createLogger } from '../logger';
import { PiRpcSessionManager } from '../agent/pi-rpc-session';
import { MidsceneRunner } from '../qa/midscene-runner';
import { WorktreeManager, TaskProcessManager } from '../worktree/worktree-manager';

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

function findRepoRoot(startDir?: string): string {
  let cur = startDir ? path.resolve(startDir) : process.cwd();
  // 必须剥离 .worktrees，防止任务重试时在 worktree 内部再次嵌套创建
  const wtMarker = `${path.sep}.worktrees`;
  const wtIndex = cur.indexOf(wtMarker);
  if (wtIndex !== -1) {
    cur = cur.slice(0, wtIndex);
  }
  while (cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(cur, '.git'))) {
      return cur;
    }
    cur = path.dirname(cur);
  }
  return process.cwd();
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
  store?: any;
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

// 资深 QA 工程师黑盒自动化测试用例设计执行器 (qa-planner 节点)
// 职责：基于产品需求纯黑盒视角，设计适量精炼（3~4步）的端到端自动化验收步骤，彻底解耦 Coder Agent
export class QaPlannerExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { task, node, emitLog, settings = {} } = ctx;
    emitLog('system', `>>> 开始执行节点 [${node.name || 'QA 黑盒用例设计'}] (qa-planner)`);

    const title = task.title || '功能需求';
    const description = task.description || '';

    emitLog('system', `[QA 黑盒用例设计] 正在以资深质量工程师视角，根据需求规划端到端验收用例...`);

    const rolePrompt = `你是一名资深质量工程师（QA Engineer），负责对产品需求进行纯黑盒端到端自动化测试设计。

【输入需求】
- 任务标题: ${title}
- 详细说明: ${description || '无'}

【测试设计原则】
1. 需求驱动（黑盒视角）：严格依据上述需求设计操作路径与预期结果，关注最终用户可见的界面功能与业务逻辑，不考虑底层实现细节；
2. 适量精炼（严格 3~4 步）：步骤数量控制在 3~4 步，覆盖核心端到端冒烟链路，坚决避免冗长繁琐；
3. 典型结构：
   - 步骤 1：导航/进入需求涉及的功能页面或模块（如：点击左侧导航「xxx」进入对应模块）
   - 步骤 2：执行需求的核心交互或状态操作
   - 步骤 3：断言检查符合需求预期的界面关键渲染或反馈效果
   - 步骤 4：校验界面正常无报错与异常提示；
4. 语言明确易执行：采用明确的动词（点击「xxx」、输入「xxx」）与断言（检查「xxx」、校验「xxx」）；严禁编造需要外部复杂模拟的不可达伪步骤。

【输出格式】
请直接输出用例清单块（注意每行以 - 开头），无需多余客套：
\`\`\`qa-plan
- 点击导航「xxx」进入目标页面
- 执行核心操作「xxx」
- 检查界面出现符合需求预期的「xxx」
- 校验页面正常无报错与异常提示
\`\`\``;

    // 确定工作目录
    const repoRoot = findRepoRoot(
      node.config?.cwd ||
      (task.context?.worktree ? task.context.worktree.worktreeDir : undefined)
    );
    const cwd = task.context?.worktree?.worktreeDir || task.workspace || repoRoot;

    // 创建专属 QA 规划会话
    const qaSessionId = `qa_plan_${task.id}`;

    return new Promise<ExecutionResult>((resolve) => {
      let settled = false;
      const finish = (res: ExecutionResult) => {
        if (settled) return;
        settled = true;
        resolve(res);
      };

      try {
        const session = PiRpcSessionManager.getInstance().createSession({
          taskId: `${task.id}_qa`,
          taskTitle: `[QA 用例设计] ${title}`,
          sessionId: qaSessionId,
          agentName: '资深 QA 工程师',
          model: settings.piModel,
          thinking: 'off', // QA 规划用例无需长思考，极速产出
          cwd,
          initialPrompt: rolePrompt,
          onLog: (type, text) => {
            if (type === 'stdout' || type === 'system') {
              emitLog('stdout', text);
            }
          },
          onFinished: (error) => {
            if (error) {
              emitLog('stderr', `[QA 用例设计 异常] ${error}，启用平台通用默认冒烟用例`);
              this.applyFallbackInstructions(task, emitLog);
              finish({
                status: 'success',
                exitCode: 0,
                output: { fallback: true, qaInstructions: task.context?.qaInstructions },
              });
              return;
            }

            try {
              const state = session.getState();
              const lastMsg = [...state.messages].reverse().find((m) => m.role === 'assistant');
              const content = lastMsg?.content || '';

              const match = content.match(/```qa-plan\s*([\s\S]*?)\s*```/i);
              let steps: string[] = [];
              if (match && match[1]) {
                steps = match[1]
                  .split('\n')
                  .map((l) => l.replace(/^[-*•\d.]+\s*/, '').trim())
                  .filter((l) => Boolean(l) && !l.startsWith('//') && !l.startsWith('#'));
              }

              // 清洗步骤：剔除空行和过度复杂的模拟项，最多保留 4 步
              steps = steps
                .filter((s) => !s.includes('模拟') && !s.includes('等待后台推送'))
                .slice(0, 4);

              // 兜底保障
              if (steps.length === 0) {
                this.applyFallbackInstructions(task, emitLog);
              } else {
                if (!task.context) task.context = {};
                task.context.qaInstructions = steps;
                task.context.qaPlan = {
                  role: '资深 QA 工程师 (黑盒测试)',
                  createdAt: Date.now(),
                  steps,
                };
                emitLog(
                  'system',
                  `[QA 黑盒用例设计] ✔ 资深 QA 专家成功设计 ${steps.length} 步核心端到端验收用例:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`
                );
              }

              if (ctx.store) {
                ctx.store.saveTask(task);
              }

              finish({
                status: 'success',
                exitCode: 0,
                output: {
                  qaInstructions: task.context?.qaInstructions,
                  stepsCount: task.context?.qaInstructions?.length || 0,
                },
              });
            } catch (err: any) {
              this.applyFallbackInstructions(task, emitLog);
              finish({
                status: 'success',
                exitCode: 0,
                output: { fallback: true, error: err.message },
              });
            }
          },
        });

        if (ctx.abortSignal) {
          ctx.abortSignal.addEventListener('abort', () => {
            session.terminate();
            finish({ status: 'failed', exitCode: 1, error: 'QA 规划已手动取消' });
          });
        }
      } catch (e: any) {
        emitLog('stderr', `[QA 用例设计 启动失败] ${e.message}，使用兜底通用用例`);
        this.applyFallbackInstructions(task, emitLog);
        finish({
          status: 'success',
          exitCode: 0,
          output: { fallback: true, qaInstructions: task.context?.qaInstructions },
        });
      }
    });
  }

  private applyFallbackInstructions(task: any, emitLog: (stream: any, text: string) => void) {
    const fallbackSteps = [
      '等待页面加载并处于就绪状态',
      '检查关键主视觉元素正常渲染',
      '校验页面无报错与异常提示',
    ];
    if (!task.context) task.context = {};
    task.context.qaInstructions = fallbackSteps;
    task.context.qaPlan = {
      role: '资深 QA 工程师 (通用兜底)',
      createdAt: Date.now(),
      steps: fallbackSteps,
    };
    emitLog('system', `[QA 黑盒用例设计] 载入通用黑盒冒烟用例 (${fallbackSteps.length} 步)`);
  }
}

// 现场准备与服务就绪检查执行器 (env-prepare 节点)
// 通用声明式设计：通过流水线编排驱动任意开发语言/服务后台拉起与健康检查
export class EnvPrepareExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog, task, variables } = ctx;
    const platform = (node.config.platform || node.config.targetPlatform || 'web') as 'web' | 'android' | 'ios' | 'desktop';
    const warmupTimeoutMs = node.config.warmupTimeoutMs || 30000;

    emitLog('system', `[现场就绪准备] 开始准备目标测试现场 (平台: ${platform.toUpperCase()})`);

    const ports = task.context?.worktree?.ports || {
      webPort: task.context?.worktree?.webPort || 5173,
      corePort: task.context?.worktree?.corePort || 19888,
    };

    // 1. 若编排节点配置了后台服务拉起命令 (例如 npm run dev / pnpm dev / go run / python app.py)
    const rawCommand = node.config.command;
    if (rawCommand && rawCommand.trim()) {
      const resolvedCwd = resolveWorkingDir(node.config.cwd || task.workspace || process.cwd());
      const cmd = interpolateString(rawCommand, {
        task,
        ports,
        ...variables,
      });

      // 启动前安全清理当前工作区残留进程，严禁误杀其他并行任务
      const wtManager = WorktreeManager.getInstance();
      if (ports.webPort) {
        wtManager.killPortIfBusy(ports.webPort, {
          allowWorktreeDir: task.context?.worktree?.worktreeDir || resolvedCwd,
          forTaskId: task.id,
        });
      }

      emitLog('system', `[服务启动] 执行服务拉起命令: ${cmd} (目录: ${resolvedCwd})`);

      const isUnix = process.platform !== 'win32';
      const child = spawn(cmd, {
        cwd: resolvedCwd,
        shell: true,
        detached: isUnix,
        env: {
          ...process.env,
          ...node.config.env,
          ...(ports.webPort ? { PORT: String(ports.webPort), WEB_PORT: String(ports.webPort) } : {}),
        },
        stdio: 'pipe',
      });

      // 注册到通用任务进程组管理器中，任务合并/驳回/取消时统一自动回收
      TaskProcessManager.getInstance().register(task.id, child, {
        name: node.name || 'ephemeral-service',
        port: ports.webPort,
      });

      child.stdout?.on('data', (d) => emitLog('stdout', d.toString().trimEnd()));
      child.stderr?.on('data', (d) => emitLog('stderr', d.toString().trimEnd()));
    }

    // 2. 目标服务健康检查与探活 (healthUrl)
    const rawHealthUrl =
      node.config.healthUrl ||
      variables.healthUrl ||
      (task.context?.worktree ? task.context.worktree.targetUrl : undefined);

    if (rawHealthUrl) {
      const healthUrl = interpolateString(rawHealthUrl, { task, ports, ...variables });
      emitLog('system', `[健康探针] 等待目标服务就绪: ${healthUrl}...`);

      const isReady = await WorktreeManager.getInstance().waitForHttpReady(healthUrl, warmupTimeoutMs);
      if (!isReady) {
        const errMsg = `目标服务探活超时 (${healthUrl})，未在 ${warmupTimeoutMs / 1000}s 内就绪`;
        emitLog('stderr', `[健康探针 Error] ${errMsg}`);
        return {
          status: 'failed',
          exitCode: 1,
          error: errMsg,
        };
      }
      emitLog('system', `[健康探针] ✔ 目标服务已就绪 (${healthUrl})`);
    }

    // 3. Android 移动端通用设备探活
    if (platform === 'android') {
      emitLog('system', `[Android 准备] 检测 ADB 设备连接状态...`);
      try {
        const { execSync } = require('node:child_process');
        const output = execSync('adb devices', { encoding: 'utf-8' });
        const hasDevice = output.split('\n').some((l: string) => l.includes('\tdevice'));
        if (!hasDevice) {
          emitLog('stderr', `[Android 准备] 未检测到在线的 Android 设备，请确保模拟器或真机已连接`);
          return {
            status: 'failed',
            exitCode: 1,
            error: '未检测到在线的 Android 设备',
          };
        }
        emitLog('system', `[Android 准备] Android 设备已就绪`);
      } catch (err: any) {
        emitLog('stderr', `[Android 准备] 执行 adb 检查失败: ${err.message}`);
        return {
          status: 'failed',
          exitCode: 1,
          error: err.message,
        };
      }
    }

    emitLog('system', `[现场就绪准备] 目标测试现场已就绪，流程继续`);
    return {
      status: 'success',
      exitCode: 0,
      output: {
        platform,
        ready: true,
        timestamp: Date.now(),
      },
    };
  }
}

// 真实 Midscene 智能测试执行器（纯粹的测试动作与断言执行器，不耦合服务启停与隐式推测）
export class MidsceneExecutor implements NodeExecutor {
  private cliExecutor = new CliCommandExecutor();

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { node, emitLog, variables, task } = ctx;
    const platform = (node.config.platform || 'web') as 'web' | 'android' | 'ios' | 'desktop';

    const rawTestUrl =
      node.config.testUrl ||
      variables.testUrl ||
      (task.context?.worktree ? task.context.worktree.targetUrl : undefined) ||
      'http://127.0.0.1:5173';
    const testUrl = interpolateString(rawTestUrl, { ...variables, task });

    executorLogger.info(`[Midscene] 准备执行自动化测试 (平台: ${platform.toUpperCase()}), Target: ${testUrl}`, undefined, { taskId: task.id, nodeId: node.id });
    emitLog('system', `[Midscene UI 测试] 启动自动化测试 (平台: ${platform.toUpperCase()}), 目标: ${testUrl}`);

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

      // 1. 优先读取任务定制验收用例（用户在任务创建时输入，或 Agent 编码完成后智能规划输出）
      let instructions: string[] = [];
      if (Array.isArray(task.context?.qaInstructions) && task.context.qaInstructions.length > 0) {
        instructions = [...task.context.qaInstructions];
        emitLog('system', `[Midscene UI 测试] 载入定制验收用例 (${instructions.length} 步)`);
      } else if (node.config.instructions && node.config.instructions.length > 0) {
        instructions = [...node.config.instructions];
      } else {
        // 平台通用默认健康探针，彻底解耦特定业务菜单，适用于任意 Web 或移动端应用
        if (platform === 'web') {
          instructions = [
            '等待页面完全加载，检查首屏主视觉元素',
            '校验当前页面正常渲染，无报错与异常提示',
          ];
        } else {
          instructions = [
            '等待应用界面完全加载并处于就绪状态',
            '校验移动端界面正常渲染，无异常崩溃提示',
          ];
        }
      }

      const steps: QaStep[] = [];
      let stepCounter = 1;

      const actionKeywords = ['点击', '切换', '输入', '选择', '跳转', '打开', '进入', '滚动', '滑动'];
      const assertKeywords = ['检查', '校验', '验证', '确认', '是否', '包含', '断言', '正常渲染', '无报错'];

      for (const rawInst of instructions) {
        const inst = rawInst.trim();
        if (!inst) continue;

        // 如果单行同时包含动作词与断言词，且包含标点符号，智能拆分为两步连续执行
        const hasAction = actionKeywords.some((k) => inst.includes(k));
        const hasAssert = assertKeywords.some((k) => inst.includes(k));

        if (hasAction && hasAssert && /[,，;；\n]+/.test(inst)) {
          const splitParts = inst.split(/[,，;；\n]+/).map((s) => s.trim()).filter(Boolean);
          if (splitParts.length >= 2) {
            for (const part of splitParts) {
              const partHasAction = actionKeywords.some((k) => part.includes(k));
              const partHasAssert = assertKeywords.some((k) => part.includes(k));
              steps.push({
                id: `step_${stepCounter++}`,
                type: partHasAction && !partHasAssert ? 'action' : partHasAssert ? 'assert' : 'action',
                prompt: part,
              });
            }
            continue;
          }
        }

        const isAssert = !hasAction && hasAssert;
        steps.push({
          id: `step_${stepCounter++}`,
          type: isAssert ? 'assert' : 'action',
          prompt: inst,
        });
      }

      const suiteId = node.config.suiteId || `suite_task_${task.id}`;
      const suite: QaSuite = {
        id: suiteId,
        name: `任务验收: ${task.title.slice(0, 30)}`,
        targetUrl: testUrl,
        steps,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // 自动沉淀用例至用例库，让用户在用例库中可查可复测
      if (ctx.store) {
        try {
          ctx.store.saveQaSuite(suite);
        } catch {}
      }

      const runner = new MidsceneRunner({
        artifactBaseDir: path.join(dataDir, 'artifacts'),
        serverBaseUrl: 'http://127.0.0.1:19888',
        platform,
        signal: ctx.abortSignal,
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

      // 将关键截图产物写入 task.attachments 并更新 task.context
      if (!task.attachments) {
        task.attachments = [];
      }
      if (!task.context) {
        task.context = {};
      }
      task.context.qaRunId = runRecord.id;
      if (task.context.worktree) {
        task.context.worktree.qaRunId = runRecord.id;
      }
      if (ctx.store?.saveQaRun) {
        try {
          ctx.store.saveQaRun(runRecord);
        } catch (e: any) {
          executorLogger.warn(`[Midscene] 持久化 QaRun 记录告警: ${e.message}`);
        }
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
    const { node, emitLog, task } = ctx;
    
    // 如果任务关联了 Worktree 独立沙箱，自动提取当前代码改动统计
    if (task.context?.worktree?.worktreeDir) {
      try {
        const wtManager = WorktreeManager.getInstance();
        const diffInfo = wtManager.getWorktreeDiff(task.context.worktree.worktreeDir);
        task.context.worktree.changedFiles = diffInfo.changedFiles;
        task.context.worktree.diffSummary = diffInfo.diffSummary;
        
        emitLog('system', `[Worktree 沙箱状态] 分支: ${task.context.worktree.branchName}, 靶机: ${task.context.worktree.targetUrl}`);
        emitLog('system', `[代码变更统计] ${diffInfo.diffSummary || (diffInfo.changedFiles.length + ' 个文件修改')}`);
        if (diffInfo.changedFiles.length > 0) {
          diffInfo.changedFiles.slice(0, 5).forEach((f) => emitLog('system', `  • ${f}`));
          if (diffInfo.changedFiles.length > 5) {
            emitLog('system', `  ... 以及更多 ${diffInfo.changedFiles.length - 5} 个文件`);
          }
        }
      } catch (err: any) {
        executorLogger.warn(`[QA-Approval] 获取 Worktree Diff 告警: ${err.message}`);
      }
    }

    executorLogger.warn(
      `[QA-Approval] 任务断点拦截，等待人工确认. 提示: "${node.config.approvalPrompt || '等待 QA 人工确认'}"`,
      { checklist: node.config.checklist },
      { taskId: ctx.task.id, nodeId: node.id }
    );
    emitLog('system', `=====================================================`);
    emitLog('system', `[QA 视觉验收门禁] 工作流已暂停，等待用户审核回放与确认`);
    emitLog('system', `[提示]: ${node.config.approvalPrompt || '请查看自动化测试截帧回放与页面效果，确认无误后点击验收通过'}`);
    if (node.config.checklist && node.config.checklist.length > 0) {
      emitLog('system', `[核查清单]:`);
      node.config.checklist.forEach((item, idx) => {
        emitLog('system', `  ${idx + 1}. [ ] ${item}`);
      });
    }
    emitLog('system', `任务已挂起，可通过桌面端看板点击【验收通过并合并】或【驳回】。`);
    emitLog('system', `=====================================================`);

    return {
      status: 'waiting_approval',
    };
  }
}

// Git Worktree 隔离沙箱环境初始化执行器（通用沙箱隔离与环境参数注入）
export class WorktreeSetupExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { task, emitLog, node } = ctx;
    const repoRoot = findRepoRoot(node.config.cwd || task.workspace);
    emitLog('system', `[Worktree 初始化] 准备在宿主仓库 (${repoRoot}) 下建立隔离特性分支与开发目录...`);

    try {
      const wtManager = WorktreeManager.getInstance();
      const sharedPaths = node.config.sharedPaths || ['node_modules'];
      const portKeys = node.config.allocatePorts || ['webPort', 'corePort'];

      const wtInfo = await wtManager.createWorktree(repoRoot, task.id, task.title, {
        sharedPaths,
        portKeys,
      });

      // 将任务物理工作空间无缝切换为隔离的 worktree 目录
      task.workspace = wtInfo.worktreeDir;
      if (!task.context) task.context = {};
      task.context.worktree = wtInfo;
      ctx.variables.worktree = wtInfo;
      ctx.variables.ports = wtInfo.ports;
      ctx.variables.testUrl = wtInfo.targetUrl;

      emitLog('system', `[Worktree 就绪] 特性分支: ${wtInfo.branchName}, 物理目录: ${wtInfo.worktreeDir}`);
      emitLog('system', `[环境分配] 动态端口: ${JSON.stringify(wtInfo.ports || {})}, 目标地址: ${wtInfo.targetUrl}`);

      return {
        status: 'success',
        exitCode: 0,
        output: wtInfo,
      };
    } catch (err: any) {
      const errMsg = `[Worktree 初始化失败] ${err.message}`;
      executorLogger.error(errMsg, err, { taskId: task.id, nodeId: node.id });
      emitLog('stderr', errMsg);
      return {
        status: 'failed',
        exitCode: 1,
        error: errMsg,
      };
    }
  }
}

// Git Worktree 自动合并与环境清理执行器
export class WorktreeMergeExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { task, emitLog, node } = ctx;
    const repoRoot = findRepoRoot(
      node.config.cwd ||
      (task.context?.worktree ? path.dirname(path.dirname(task.context.worktree.worktreeDir)) : undefined)
    );

    emitLog('system', `[Worktree 自动合并] 开始将已验收特性分支合并至本地开发分支...`);

    try {
      const wtManager = WorktreeManager.getInstance();
      const res = await wtManager.approveAndMerge(
        repoRoot,
        task.id,
        task.title,
        (msg) => emitLog('system', msg)
      );

      if (res.success) {
        emitLog('system', `[Worktree 自动合并] ✔ ${res.message}`);
        // 恢复任务工作区路径
        task.workspace = repoRoot;
        return {
          status: 'success',
          exitCode: 0,
          output: { merged: true, message: res.message },
        };
      } else {
        // 判断是否为合并冲突异常
        const isConflict =
          res.message.includes('冲突') ||
          res.message.includes('CONFLICT') ||
          res.message.includes('conflict') ||
          res.message.includes('Automatic merge failed') ||
          res.message.includes('Merge with strategy ort failed');

        if (isConflict) {
          emitLog('system', `[Worktree 自动合并] 检测到代码合并冲突，启动沙箱内 Agent 冲突自愈机制...`);
          const resolveResult = await wtManager.resolveConflictWithAgent(
            repoRoot,
            task.id,
            task.title,
            task.context?.piSessionId,
            (msg) => emitLog('system', msg),
            ctx.onSessionUpdate
          );

          if (resolveResult.resolved) {
            emitLog('system', `[Worktree 自动合并] ✔ 冲突已由 Agent 自动消解，已提交至沙箱分支！`);
            emitLog('system', `[Worktree 自动合并] 正在重新尝试将自愈后的分支合并至本地开发分支...`);

            // 再次在宿主尝试合并（此时沙箱分支已完全包含宿主基线分支的最新变更，为 Fast-Forward 或无冲突）
            const retryRes = await wtManager.approveAndMerge(
              repoRoot,
              task.id,
              task.title,
              (msg) => emitLog('system', msg)
            );

            if (retryRes.success) {
              emitLog('system', `[Worktree 自动合并] ✔ 自愈后代码成功合并至本地开发分支！`);
              task.workspace = repoRoot;
              if (!task.context) task.context = {};
              if (!task.context.worktree) {
                task.context.worktree = {
                  worktreeDir: path.join(repoRoot, '.worktrees', `task-${task.id}`),
                  branchName: `feat/task-${task.id}`,
                  targetUrl: '',
                };
              }
              task.context.worktree.conflictResolution = {
                baseBranch: 'main',
                conflictFiles: resolveResult.conflictFiles,
                resolvedAt: Date.now(),
                summary: resolveResult.summary,
              };

              return {
                status: 'success',
                exitCode: 0,
                output: {
                  merged: true,
                  conflictResolved: true,
                  conflictFiles: resolveResult.conflictFiles,
                  message: '代码冲突已在沙箱中由 Agent 自动消解并成功合并',
                },
              };
            }
          }

          // 若自动协调后仍然有错误
          emitLog('stderr', `[Worktree 自动合并] 代码冲突自愈未完成: ${resolveResult.error || res.message}`);
          return {
            status: 'failed',
            exitCode: 1,
            error: resolveResult.error || res.message,
          };
        }

        emitLog('stderr', `[Worktree 自动合并失败] ${res.message}`);
        return {
          status: 'failed',
          exitCode: 1,
          error: res.message,
        };
      }
    } catch (err: any) {
      const errMsg = `[Worktree 合并异常] ${err.message}`;
      executorLogger.error(errMsg, err, { taskId: task.id, nodeId: node.id });
      emitLog('stderr', errMsg);
      return {
        status: 'failed',
        exitCode: 1,
        error: errMsg,
      };
    }
  }
}

// Git Worktree 隔离沙箱与服务环境清理执行器 (worktree-cleanup 节点)
// 显式解耦清理动作：负责统一关闭后台靶机进程、释放网络端口、移除临时工作目录与特性分支
export class WorktreeCleanupExecutor implements NodeExecutor {
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { task, emitLog, node } = ctx;
    const repoRoot = findRepoRoot(
      node.config.cwd ||
      (task.context?.worktree ? path.dirname(path.dirname(task.context.worktree.worktreeDir)) : undefined)
    );

    emitLog('system', `[沙箱现场清理] 开始释放任务后台进程与清理 Worktree 隔离环境...`);

    try {
      const wtManager = WorktreeManager.getInstance();

      // 1. 释放任务后台进程与端口占用
      TaskProcessManager.getInstance().stopAll(task.id);
      if (task.context?.worktree?.webPort) {
        wtManager.killPortIfBusy(task.context.worktree.webPort);
      }
      if (task.context?.worktree?.ports) {
        for (const p of Object.values(task.context.worktree.ports)) {
          if (typeof p === 'number') {
            wtManager.killPortIfBusy(p);
          }
        }
      }
      emitLog('system', `[沙箱现场清理] ✔ 已安全终止所有后台关联进程与网络端口`);

      // 2. 清理临时特性分支与工作目录
      wtManager.cleanupTaskWorktree(repoRoot, task.id, (msg) => emitLog('system', msg));
      emitLog('system', `[沙箱现场清理] ✔ 隔离工作目录与临时分支已彻底清空`);

      // 恢复任务工作空间为宿主仓库根目录
      task.workspace = repoRoot;

      return {
        status: 'success',
        exitCode: 0,
        output: { cleaned: true, timestamp: Date.now() },
      };
    } catch (err: any) {
      const errMsg = `[沙箱现场清理异常] ${err.message}`;
      executorLogger.error(errMsg, err, { taskId: task.id, nodeId: node.id });
      emitLog('stderr', errMsg);
      return {
        status: 'failed',
        exitCode: 1,
        error: errMsg,
      };
    }
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
    this.register('qa-planner', new QaPlannerExecutor());
    this.register('worktree-setup', new WorktreeSetupExecutor());
    this.register('worktree-merge', new WorktreeMergeExecutor());
    this.register('worktree-cleanup', new WorktreeCleanupExecutor());
    this.register('env-prepare', new EnvPrepareExecutor());
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
