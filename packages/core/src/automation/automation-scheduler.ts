import { EventEmitter } from 'events';
import { exec } from 'child_process';
import util from 'util';
import { Store } from '../store';
import { PipelineEngine } from '../engine/pipeline-engine';
import {
  AutomationTask,
  AutomationLogRecord,
  Task,
} from '../types';
import { createLogger } from '../logger';

const execPromise = util.promisify(exec);
const logger = createLogger('AutomationScheduler');

export interface TriggerOptions {
  manual?: boolean;
}

export class AutomationScheduler extends EventEmitter {
  private store: Store;
  private engine: PipelineEngine;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private runningSet: Set<string> = new Set();
  /** 直连流水线仍在运行的自动化任务（避免周期重叠与误报终态） */
  private pipelineRunningSet: Set<string> = new Set();
  private isStarted = false;

  constructor(store: Store, engine: PipelineEngine) {
    super();
    this.store = store;
    this.engine = engine;
  }

  /**
   * 启动调度器并为所有已启用的自动化任务注册定时器
   */
  public async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;
    logger.info('[AutomationScheduler] 自动化任务调度服务启动');

    const tasks = this.store.getAutomationTasks();
    logger.info(`[AutomationScheduler] 加载 ${tasks.length} 个自动化任务配置`);

    for (const task of tasks) {
      if (task.enabled) {
        this.scheduleTask(task);
      }
    }
  }

  /**
   * 停止调度器，清除所有定时器
   */
  public stop(): void {
    logger.info('[AutomationScheduler] 停止自动化任务调度服务');
    for (const [id, timer] of this.timers.entries()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.runningSet.clear();
    this.pipelineRunningSet.clear();
    this.isStarted = false;
  }

  /**
   * 注册或更新单个任务的调度定时器
   */
  public scheduleTask(task: AutomationTask): void {
    // 先清理旧定时器
    const existingTimer = this.timers.get(task.id);
    if (existingTimer) {
      clearInterval(existingTimer);
      this.timers.delete(task.id);
    }

    if (!task.enabled) {
      logger.debug(`[AutomationScheduler] 任务 ${task.name} (${task.id}) 未启用，跳过调度`);
      return;
    }

    const intervalMs = Math.max((task.intervalSec || 60) * 1000, 5000); // 最少 5 秒防击穿
    logger.info(`[AutomationScheduler] 为任务 ${task.name} 注册定时轮询，周期: ${intervalMs / 1000}s`);

    const timer = setInterval(() => {
      this.executeTask(task.id, { manual: false }).catch((err) => {
        logger.error(`[AutomationScheduler] 自动轮询执行任务 ${task.id} 失败:`, err);
      });
    }, intervalMs);

    this.timers.set(task.id, timer);
  }

  /**
   * 移除任务定时器
   */
  public unscheduleTask(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(taskId);
      logger.debug(`[AutomationScheduler] 清除任务 ${taskId} 的定时轮询器`);
    }
  }

  /**
   * 外部保存/更新任务后同步调度状态
   */
  public onTaskSaved(task: AutomationTask): void {
    if (task.enabled) {
      this.scheduleTask(task);
    } else {
      this.unscheduleTask(task.id);
    }
  }

  /**
   * 外部删除任务后清理
   */
  public onTaskDeleted(taskId: string): void {
    this.unscheduleTask(taskId);
    this.runningSet.delete(taskId);
    this.pipelineRunningSet.delete(taskId);
  }

  /**
   * 手动或定时触发执行自动化任务
   */
  public async executeTask(
    taskId: string,
    options: TriggerOptions = {}
  ): Promise<{ success: boolean; message: string; createdTaskId?: string }> {
    const task = this.store.getAutomationTask(taskId);
    if (!task) {
      throw new Error(`未找到 ID 为 ${taskId} 的自动化任务`);
    }

    if (this.runningSet.has(taskId)) {
      logger.warn(`[AutomationScheduler] 任务 ${task.name} 正在执行中，跳过本次调度`);
      return { success: false, message: '任务正在执行中，请勿重复触发' };
    }

    if (this.pipelineRunningSet.has(taskId)) {
      logger.warn(`[AutomationScheduler] 任务 ${task.name} 上一轮流水线尚未结束，跳过本次调度`);
      return { success: false, message: '上一轮流水线仍在执行中，本轮已跳过' };
    }

    this.runningSet.add(taskId);
    const startTime = Date.now();
    logger.info(`[AutomationScheduler] 开始执行自动化任务: ${task.name} (${task.id}), 手动触发: ${Boolean(options.manual)}`);

    // 状态广播为 running
    task.lastRunStatus = 'running';
    this.emit('automation:update', task);

    let stdout = '';
    let stderr = '';
    let isSuccess = false;
    let summary = '';
    let createdTaskId: string | undefined;
    let pipelineRun: Promise<void> | undefined;

    try {
      // 1. 根据数据源执行获取
      const fetchResult = await this.fetchSourceData(task);
      stdout = fetchResult.rawOutput;
      isSuccess = fetchResult.success;
      summary = fetchResult.summary;

      // 2. 联动下游动作（若成功且配置了相应动作）
      if (isSuccess && (task.actionType === 'create_task' || task.actionType === 'run_workflow')) {
        const actionResult = await this.dispatchDownstreamAction(task, fetchResult);
        createdTaskId = actionResult.taskId;
        if (actionResult.taskTitle) {
          summary += actionResult.directRun
            ? ` | 已驱动流水线: ${actionResult.taskTitle}`
            : ` | 已自动创建看板任务: ${actionResult.taskTitle}`;
        }

        // 流水线在后台继续执行，不阻塞调度周期
        pipelineRun = actionResult.runPromise;
      }
    } catch (err: any) {
      isSuccess = false;
      stderr = err.message || String(err);
      summary = `执行失败: ${stderr.slice(0, 120)}`;
      logger.error(`[AutomationScheduler] 任务 ${task.name} 执行出错:`, err);
    } finally {
      this.runningSet.delete(taskId);
    }

    const durationMs = Date.now() - startTime;

    // 3. 更新任务统计信息
    task.lastRunAt = Date.now();
    task.lastRunStatus = isSuccess ? 'success' : 'failed';
    task.lastRunDurationMs = durationMs;
    task.lastRunMessage = summary;
    task.lastRunOutput = (stdout || stderr || '').slice(0, 1000);
    task.totalRuns = (task.totalRuns || 0) + 1;
    if (isSuccess) {
      task.successRuns = (task.successRuns || 0) + 1;
    } else {
      task.failedRuns = (task.failedRuns || 0) + 1;
    }
    if (createdTaskId) {
      const ids = new Set(task.createdTaskIds || []);
      ids.add(createdTaskId);
      task.createdTaskIds = Array.from(ids);
    }
    task.updatedAt = Date.now();

    // 持久化最新状态
    this.store.saveAutomationTask(task);

    // 4. 写入执行日志
    const logRecord: AutomationLogRecord = {
      id: `alog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      automationId: task.id,
      timestamp: Date.now(),
      status: isSuccess ? 'success' : 'failed',
      durationMs,
      summary,
      output: stdout || undefined,
      error: stderr || undefined,
      createdTaskId,
    };
    this.store.addAutomationLog(logRecord);

    // 5. 流水线型任务在流水线结束后回写真实终态（结果通知由流水线自身负责）
    if (pipelineRun && createdTaskId) {
      const runTaskId = createdTaskId;
      this.pipelineRunningSet.add(taskId);
      const writeBack = (ok: boolean, message: string) => {
        const latest = this.store.getAutomationTask(taskId);
        if (!latest) return;
        latest.lastRunStatus = ok ? 'success' : 'failed';
        latest.lastRunMessage = message;
        this.emit('automation:update', this.store.saveAutomationTask(latest));
      };
      void pipelineRun
        .then(() => {
          const runStatus = this.store.getTask(runTaskId)?.status;
          const ok = runStatus === 'completed';
          writeBack(ok, `${summary} | 流水线${ok ? '执行完成' : `结束于 ${runStatus || 'unknown'}`}`);
        })
        .catch((err: any) => {
          logger.error(`[AutomationScheduler] 流水线执行异常 (${task.name}):`, err);
          writeBack(false, `${summary} | 流水线执行异常: ${err?.message || String(err)}`);
        })
        .finally(() => this.pipelineRunningSet.delete(taskId));
    }

    // 广播事件
    this.emit('automation:update', task);
    this.emit('automation:log', logRecord);

    logger.info(`[AutomationScheduler] 任务 ${task.name} 执行完毕，耗时 ${durationMs}ms, 状态: ${task.lastRunStatus}`);

    return {
      success: isSuccess,
      message: summary,
      createdTaskId,
    };
  }

  /**
   * 根据任务数据源类型拉取/轮询数据
   */
  private async fetchSourceData(task: AutomationTask): Promise<{
    success: boolean;
    summary: string;
    rawOutput: string;
    items?: Array<{ title: string; body?: string; url?: string; raw?: any }>;
  }> {
    const { sourceType, sourceConfig } = task;

    switch (sourceType) {
      case 'schedule': {
        // 纯定时触发：不做数据抓取，扫描/调研由关联流水线内的 Agent 节点完成
        const goal = (sourceConfig.prompt || task.description || task.name).trim();
        logger.debug(`[AutomationScheduler] 定时触发流水线: ${task.name} (目标: ${goal.slice(0, 60)})`);
        return {
          success: true,
          summary: `定时触发流水线${goal ? `: ${goal.slice(0, 60).replace(/\n/g, ' ')}` : ''}`,
          rawOutput: goal,
          items: [{ title: task.name, body: goal }],
        };
      }

      case 'cli_script': {
        const cmd = sourceConfig.command?.trim();
        if (!cmd) {
          throw new Error('未配置要执行的 CLI 命令或脚本');
        }
        const cwd = sourceConfig.cwd || process.cwd();
        logger.debug(`[AutomationScheduler] 执行 CLI 轮询: ${cmd} (cwd: ${cwd})`);
        const { stdout, stderr } = await execPromise(cmd, {
          cwd,
          timeout: 60000,
          env: { ...process.env, ...(sourceConfig.env || {}) },
        });
        const out = stdout.trim() || stderr.trim() || '执行完毕，无输出';
        return {
          success: true,
          summary: `CLI 命令执行完成 (输出前 80 字符: ${out.slice(0, 80).replace(/\n/g, ' ')})`,
          rawOutput: stdout || stderr,
          items: [{ title: `CLI 任务输出: ${task.name}`, body: out }],
        };
      }

      case 'github_issues': {
        const repo = sourceConfig.repo?.trim();
        if (!repo) {
          throw new Error('未配置 GitHub Repository (格式: owner/repo)');
        }
        logger.debug(`[AutomationScheduler] 轮询 GitHub Issues: ${repo}`);

        // 优先通过 gh CLI 获取
        try {
          const { stdout } = await execPromise(
            `gh issue list --repo ${repo} --limit 5 --state open --json number,title,body,url,author`,
            { timeout: 30000 }
          );
          const issues = JSON.parse(stdout);
          if (Array.isArray(issues) && issues.length > 0) {
            const latest = issues[0];
            return {
              success: true,
              summary: `拉取到 ${issues.length} 个 GitHub Issues (最新: #${latest.number} ${latest.title})`,
              rawOutput: JSON.stringify(issues, null, 2),
              items: issues.map((i) => ({
                title: `[GH #${i.number}] ${i.title}`,
                body: `**Repository**: ${repo}\n**Issue URL**: ${i.url || ''}\n\n${i.body || '无正文'}`,
                url: i.url,
                raw: i,
              })),
            };
          }
          return {
            success: true,
            summary: `仓库 ${repo} 暂无待处理的 open issues`,
            rawOutput: stdout,
            items: [],
          };
        } catch (ghErr) {
          // 若无 gh CLI，优雅使用 GitHub 公开 API
          logger.debug(`[AutomationScheduler] gh CLI 不可用，降级使用 GitHub REST API: ${repo}`);
          const headers: Record<string, string> = {
            'User-Agent': 'openLoop-Automation-Agent',
            Accept: 'application/vnd.github.v3+json',
          };
          if (sourceConfig.githubToken) {
            headers.Authorization = `Bearer ${sourceConfig.githubToken}`;
          }
          const resp = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=5`, {
            headers,
          });
          if (!resp.ok) {
            const errBody = await resp.text();
            throw new Error(`GitHub API 返回 HTTP ${resp.status}: ${errBody.slice(0, 100)}`);
          }
          const issues = (await resp.json()) as any[];
          if (Array.isArray(issues) && issues.length > 0) {
            const latest = issues[0];
            return {
              success: true,
              summary: `拉取到 ${issues.length} 个 GitHub Issues (最新: #${latest.number} ${latest.title})`,
              rawOutput: JSON.stringify(issues, null, 2),
              items: issues.map((i) => ({
                title: `[GH #${i.number}] ${i.title}`,
                body: `**Repository**: ${repo}\n**Issue URL**: ${i.html_url || ''}\n\n${i.body || '无正文'}`,
                url: i.html_url,
                raw: i,
              })),
            };
          }
          return {
            success: true,
            summary: `仓库 ${repo} 暂无待处理的 open issues`,
            rawOutput: JSON.stringify(issues),
            items: [],
          };
        }
      }

      case 'twitter_query': {
        const query = sourceConfig.twitterQuery?.trim() || 'openloop';
        const cmd = sourceConfig.command?.trim();
        logger.debug(`[AutomationScheduler] 轮询推特/社交媒体消息: query="${query}", cmd="${cmd || 'builtin'}"`);

        if (cmd) {
          // 用户配置了专属推特抓取 CLI 工具 (如 twscrape / twikit / twitter-cli)
          const { stdout, stderr } = await execPromise(cmd, {
            timeout: 60000,
            env: { ...process.env, ...(sourceConfig.env || {}) },
          });
          const out = stdout.trim() || stderr.trim();
          return {
            success: true,
            summary: `推特 CLI 工具执行完成，捕获推文动态`,
            rawOutput: out,
            items: [{ title: `[推特动态] 命中关键词 "${query}"`, body: out }],
          };
        }

        throw new Error('未配置推特抓取 CLI 工具或抓取命令');
      }

      case 'custom':
      default: {
        const script = sourceConfig.script || sourceConfig.command;
        if (!script) {
          throw new Error('未配置自定义脚本或命令');
        }
        const { stdout, stderr } = await execPromise(script, {
          timeout: 60000,
          env: { ...process.env, ...(sourceConfig.env || {}) },
        });
        const out = stdout.trim() || stderr.trim();
        return {
          success: true,
          summary: `自定义任务执行完成`,
          rawOutput: out,
          items: [{ title: `[自定义任务] ${task.name}`, body: out }],
        };
      }
    }
  }

  /**
   * 触发下游看板任务创建与流水线执行联动
   * - directRun: 复用单条隐藏任务，不进入看板，直接在自动化 Tab 内驱动流水线
   */
  private async dispatchDownstreamAction(
    task: AutomationTask,
    fetchResult: { items?: Array<{ title: string; body?: string }>; rawOutput: string }
  ): Promise<{ taskId?: string; taskTitle?: string; directRun: boolean; runPromise?: Promise<void> }> {
    const { actionConfig, actionType } = task;
    const directRun = Boolean(actionConfig.directRun) && actionType === 'run_workflow';
    const firstItem = fetchResult.items && fetchResult.items[0];

    const workflowId =
      actionConfig.workflowId || this.store.getWorkflows()[0]?.id || 'wf_default_automation';

    const taskTitle = directRun
      ? task.name
      : actionConfig.titleTemplate
      ? actionConfig.titleTemplate
          .replace('{{title}}', firstItem?.title || task.name)
          .replace('{{name}}', task.name)
      : firstItem?.title || `[自动化] ${task.name} - ${new Date().toLocaleDateString()}`;

    const taskDescription =
      actionConfig.descriptionTemplate ||
      (firstItem
        ? `由自动化任务 **${task.name}** 自动捕获拉取。\n\n${firstItem.body || ''}`
        : `由自动化任务 **${task.name}** 执行产出：\n\`\`\`\n${fetchResult.rawOutput.slice(0, 2000)}\n\`\`\``);

    const now = Date.now();
    const taskId = directRun
      ? `auto_run_${task.id}`
      : `task_${now}_${Math.random().toString(36).slice(2, 6)}`;
    const existing = this.store.getTask(taskId);
    const newTask: Task = {
      id: taskId,
      title: taskTitle,
      description: taskDescription,
      workflowId,
      status: 'pending',
      kanbanColumn: directRun ? 'in_progress' : actionConfig.kanbanColumn || 'inbox',
      workspace: actionConfig.workspace,
      triggerSource: 'api',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      nodeRuns: {},
      context: {
        automationTaskId: task.id,
        automationTaskName: task.name,
        sourceType: task.sourceType,
        ...(directRun ? { hiddenFromKanban: true } : {}),
      },
    };

    logger.info(
      `[AutomationScheduler] ${directRun ? '直连流水线（不落看板）' : '自动生成 openLoop 看板任务'}: ${newTask.title} (${newTask.id})`
    );
    this.store.saveTask(newTask);
    if (!directRun) {
      this.emit('task:new', newTask);
    }

    // 若配置为走流水线且开启了 autoRun，立即驱动 DAG 引擎
    if (actionType === 'run_workflow' && actionConfig.autoRun !== false) {
      const wf = this.store.getWorkflow(workflowId);
      if (!wf) {
        throw new Error(`关联流水线 ${workflowId} 不存在，无法执行`);
      }
      logger.info(`[AutomationScheduler] 驱动流水线执行: ${wf.name} (Task: ${newTask.id})`);
      const runPromise = this.engine.runTask(newTask.id);
      if (directRun) {
        return { taskId: newTask.id, taskTitle: newTask.title, directRun, runPromise };
      }
      runPromise.catch((err: any) => {
        logger.error(`[AutomationScheduler] 流水线执行启动异常:`, err);
      });
    }

    return { taskId: newTask.id, taskTitle: newTask.title, directRun };
  }
}
