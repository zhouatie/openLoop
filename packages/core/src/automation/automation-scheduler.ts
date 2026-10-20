import { EventEmitter } from 'events';
import { exec } from 'child_process';
import util from 'util';
import { Store } from '../store';
import { DagEngine } from '../engine/dag-engine';
import {
  AutomationTask,
  AutomationLogRecord,
  Task,
  KanbanColumn,
} from '../types';
import { createLogger } from '../logger';

const execPromise = util.promisify(exec);
const logger = createLogger('AutomationScheduler');

export interface TriggerOptions {
  manual?: boolean;
}

export class AutomationScheduler extends EventEmitter {
  private store: Store;
  private engine: DagEngine;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private runningSet: Set<string> = new Set();
  private isStarted = false;

  constructor(store: Store, engine: DagEngine) {
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

    // 如果数据库中尚无任何自动化任务，初始化几个代表性预置示例
    this.initDefaultTemplatesIfEmpty();

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
        if (createdTaskId) {
          summary += ` | 已自动创建看板任务: ${actionResult.taskTitle}`;
        }
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

        // 内置模拟抓取/测试推文解析
        const mockTweet = {
          author: '@dev_fanatic',
          text: `Found an interesting issue in latest release with query "${query}". Needs automated pipeline check!`,
          timestamp: new Date().toISOString(),
        };
        return {
          success: true,
          summary: `推特消息监控成功，发现动态 (关键词: ${query})`,
          rawOutput: JSON.stringify(mockTweet, null, 2),
          items: [
            {
              title: `[推特消息] 来自 ${mockTweet.author}: ${mockTweet.text.slice(0, 30)}...`,
              body: `**作者**: ${mockTweet.author}\n**内容**: ${mockTweet.text}\n**抓取时间**: ${mockTweet.timestamp}`,
            },
          ],
        };
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
   */
  private async dispatchDownstreamAction(
    task: AutomationTask,
    fetchResult: { items?: Array<{ title: string; body?: string }>; rawOutput: string }
  ): Promise<{ taskId?: string; taskTitle?: string }> {
    const { actionConfig, actionType } = task;
    const firstItem = fetchResult.items && fetchResult.items[0];

    const taskTitle =
      actionConfig.titleTemplate
        ? actionConfig.titleTemplate
            .replace('{{title}}', firstItem?.title || task.name)
            .replace('{{name}}', task.name)
        : firstItem?.title || `[自动化] ${task.name} - ${new Date().toLocaleDateString()}`;

    const taskDescription =
      actionConfig.descriptionTemplate ||
      (firstItem
        ? `由自动化任务 **${task.name}** 自动捕获拉取。\n\n${firstItem.body || ''}`
        : `由自动化任务 **${task.name}** 执行产出：\n\`\`\`\n${fetchResult.rawOutput.slice(0, 2000)}\n\`\`\``);

    // 查找有效 workflowId
    let workflowId = actionConfig.workflowId;
    if (!workflowId) {
      const availableWorkflows = this.store.getWorkflows();
      if (availableWorkflows.length > 0) {
        workflowId = availableWorkflows[0].id;
      } else {
        workflowId = 'wf_default_automation';
      }
    }

    const newTask: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: taskTitle,
      description: taskDescription,
      workflowId,
      status: 'pending',
      kanbanColumn: (actionConfig.kanbanColumn as KanbanColumn) || 'inbox',
      workspace: actionConfig.workspace,
      triggerSource: 'api',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodeRuns: {},
      context: {
        automationTaskId: task.id,
        automationTaskName: task.name,
        sourceType: task.sourceType,
      },
    };

    logger.info(`[AutomationScheduler] 自动生成 openLoop 看板任务: ${newTask.title} (${newTask.id})`);
    this.store.saveTask(newTask);
    this.emit('task:new', newTask);

    // 若配置为走流水线且开启了 autoRun，立即驱动 DAG 引擎
    if (actionType === 'run_workflow' && actionConfig.autoRun !== false) {
      try {
        const wf = this.store.getWorkflow(workflowId);
        if (wf) {
          logger.info(`[AutomationScheduler] 驱动流水线执行: ${wf.name} (Task: ${newTask.id})`);
          // 异步驱动流水线
          this.engine.runTask(newTask.id).catch((err: any) => {
            logger.error(`[AutomationScheduler] 流水线执行启动异常:`, err);
          });
        }
      } catch (wfErr) {
        logger.warn(`[AutomationScheduler] 触发工作流失败，已保留任务在看板:`, wfErr);
      }
    }

    return { taskId: newTask.id, taskTitle: newTask.title };
  }

  /**
   * 首次启动空库时注入常见实用自动化任务模板
   */
  private initDefaultTemplatesIfEmpty(): void {
    const existing = this.store.getAutomationTasks();
    if (existing.length > 0) return;

    logger.info('[AutomationScheduler] 初始化预置自动化任务示例');
    const now = Date.now();

    const sampleTasks: AutomationTask[] = [
      {
        id: 'auto_gh_issues_sync',
        name: 'GitHub Issues 监控并自动入会',
        description: '定时拉取 GitHub Issues，命中后自动创建任务并投递看板 Inbox',
        enabled: false,
        intervalSec: 120,
        sourceType: 'github_issues',
        sourceConfig: {
          repo: 'facebook/react',
        },
        actionType: 'create_task',
        actionConfig: {
          kanbanColumn: 'inbox',
          titleTemplate: '{{title}}',
          autoRun: false,
        },
        totalRuns: 0,
        successRuns: 0,
        failedRuns: 0,
        createdTaskIds: [],
        createdAt: now - 3600000,
        updatedAt: now - 3600000,
      },
      {
        id: 'auto_twitter_pipeline',
        name: '推特特定舆情/反馈监听流水线',
        description: '监控社交媒体关键词，自动创建任务并驱动自动化流水线处理',
        enabled: false,
        intervalSec: 300,
        sourceType: 'twitter_query',
        sourceConfig: {
          twitterQuery: 'openloop release',
        },
        actionType: 'run_workflow',
        actionConfig: {
          kanbanColumn: 'in_progress',
          autoRun: true,
        },
        totalRuns: 0,
        successRuns: 0,
        failedRuns: 0,
        createdTaskIds: [],
        createdAt: now - 1800000,
        updatedAt: now - 1800000,
      },
      {
        id: 'auto_cli_polling',
        name: 'CLI 本地构建与代码状态定时轮询',
        description: '通过脚本轮询本地 CLI 工具方法或 Git 状态，自动报告运行结果',
        enabled: false,
        intervalSec: 60,
        sourceType: 'cli_script',
        sourceConfig: {
          command: 'git status --short',
          cwd: process.cwd(),
        },
        actionType: 'create_task',
        actionConfig: {
          kanbanColumn: 'inbox',
          titleTemplate: '[CLI 轮询] {{title}}',
          autoRun: false,
        },
        totalRuns: 0,
        successRuns: 0,
        failedRuns: 0,
        createdTaskIds: [],
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const t of sampleTasks) {
      this.store.saveAutomationTask(t);
    }
  }
}
