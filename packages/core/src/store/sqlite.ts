import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getQaTraceDir } from '../qa/runtime-paths';
import {
  Task,
  WorkflowDefinition,
  LogEntry,
  PluginManifest,
  KanbanColumn,
  NodeRun,
  OpenLoopSettings,
  QaSuite,
  QaRunRecord,
  AutomationTask,
  AutomationLogRecord,
  StorageStats,
  StorageCleanOptions,
  StorageCleanResult,
} from '../types';
import { DEFAULT_PROMPT_TEMPLATES } from '../constants/prompts';
import { createLogger } from '../logger';
import { sanitizeChatMessages } from '../agent/agent-format';

const storeLogger = createLogger('Store:SQLite');

/**
 * 任务摘要查询：列清单与 tasks 表保持一致（不含原始 context_json）。
 * - json_remove 在 SQLite 内部剔除超大字段，避免数十 MB 字符串进入 Node 堆
 * - has_code_changes 仅为执行中任务计算，供看板卡片提示「待确认放行」
 */
const TASK_SUMMARY_SQL = `
  SELECT t.id, t.title, t.description, t.workflow_id, t.status, t.kanban_column, t.current_node_id,
         json_remove(t.context_json, '$.chatMessages', '$.worktree.diffResult') AS context_json,
         t.workspace, t.attachments_json, t.trigger_source, t.kind, t.parent_task_id, t.sub_task_ids_json,
         t.dependencies_json, t.execution_mode, t.concurrency_limit, t.created_at, t.updated_at,
         CASE WHEN t.status = 'running' THEN EXISTS (
           SELECT 1
           FROM json_each(json_extract(t.context_json, '$.chatMessages')) AS msg,
                json_each(json_extract(msg.value, '$.tools')) AS tool
           WHERE json_extract(tool.value, '$.name') IN ('edit', 'write', 'patch')
             AND COALESCE(json_extract(tool.value, '$.status'), 'success') <> 'error'
         ) ELSE 0 END AS has_code_changes
  FROM tasks AS t
  ORDER BY t.updated_at DESC
`;


export class SqliteStore {
  private db: Database.Database;
  private dataDir: string;
  private dbFilePath: string;
  private cachedSettings: OpenLoopSettings | null = null;

  constructor(customDir?: string) {
    this.dataDir = customDir || path.join(os.homedir(), '.openloop');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.dbFilePath = path.join(this.dataDir, 'openloop.db');

    // 初始化 SQLite 连接
    this.db = new Database(this.dbFilePath);
    storeLogger.info(`SQLite 数据底座就绪: ${this.dbFilePath}`);
    this.assertDatabaseHealthy();
    this.initDatabase();
    this.migrateFromJsonStoreIfPresent();
  }

  /**
   * 启动自检：损坏时给出明确提示，避免业务接口随机抛 SQLITE_CORRUPT
   * 常见损坏为页账目错乱 (database disk image is malformed)，需重建快照修复
   */
  private assertDatabaseHealthy() {
    try {
      const result = this.db.pragma('quick_check', { simple: true });
      if (result !== 'ok') {
        storeLogger.error(
          `SQLite 数据文件未通过完整性自检，写入将失败: ${this.dbFilePath}\n` +
            `  自检结果: ${result}\n` +
            `  修复方式: 停止服务后执行 sqlite3 "${this.dbFilePath}" "VACUUM INTO '${this.dbFilePath}.repair'"，校验通过后替换原文件`
        );
      }
    } catch (e: any) {
      storeLogger.error(`SQLite 启动自检异常: ${e.message}`);
    }
  }

  private initDatabase() {
    // 等待锁最多 5 秒，避免多进程共用同一库时直接抛 SQLITE_BUSY
    this.db.pragma('busy_timeout = 5000');
    // 启用高性能 WAL (Write-Ahead Logging) 模式与常规同步
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    // 创建表结构
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        nodes_json TEXT NOT NULL,
        edges_json TEXT NOT NULL,
        variables_json TEXT,
        tags_json TEXT,
        task_template_json TEXT,
        script TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        kanban_column TEXT NOT NULL,
        current_node_id TEXT,
        context_json TEXT,
        workspace TEXT,
        attachments_json TEXT,
        trigger_source TEXT,
        kind TEXT DEFAULT 'single',
        parent_task_id TEXT,
        sub_task_ids_json TEXT,
        dependencies_json TEXT,
        execution_mode TEXT,
        concurrency_limit INTEGER DEFAULT 3,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_node_runs (
        task_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        output_json TEXT,
        error TEXT,
        exit_code INTEGER,
        artifacts_json TEXT,
        PRIMARY KEY (task_id, node_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        stream TEXT NOT NULL,
        message TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT,
        author TEXT,
        is_builtin INTEGER NOT NULL,
        manifest_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS qa_suites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        target_url TEXT NOT NULL,
        viewport_json TEXT,
        steps_json TEXT NOT NULL,
        tags_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_run_status TEXT,
        last_run_duration_ms INTEGER,
        last_run_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS qa_runs (
        id TEXT PRIMARY KEY,
        suite_id TEXT NOT NULL,
        suite_name TEXT NOT NULL,
        task_id TEXT,
        status TEXT NOT NULL,
        total_steps INTEGER NOT NULL,
        passed_steps INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        timeline_json TEXT NOT NULL,
        report_rel_path TEXT,
        created_at INTEGER NOT NULL,
        finished_at INTEGER,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS automation_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL,
        interval_sec INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        source_config_json TEXT NOT NULL,
        action_type TEXT NOT NULL,
        action_config_json TEXT NOT NULL,
        last_run_at INTEGER,
        last_run_status TEXT,
        last_run_duration_ms INTEGER,
        last_run_message TEXT,
        last_run_output TEXT,
        total_runs INTEGER NOT NULL,
        success_runs INTEGER NOT NULL,
        failed_runs INTEGER NOT NULL,
        created_task_ids_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_logs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        summary TEXT NOT NULL,
        output TEXT,
        error TEXT,
        created_task_id TEXT,
        FOREIGN KEY (automation_id) REFERENCES automation_tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_kanban ON tasks(kanban_column);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_node_runs_task ON task_node_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_logs_task_time ON logs(task_id, timestamp ASC);
      CREATE INDEX IF NOT EXISTS idx_logs_node ON logs(task_id, node_id);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_qa_runs_suite ON qa_runs(suite_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_qa_runs_created ON qa_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_qa_runs_task ON qa_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_automation_logs ON automation_logs(automation_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_automation_logs_timestamp ON automation_logs(timestamp DESC);
    `);

    // 增量表结构平滑迁移：为历史已有数据库的 workflows 表补齐 tags_json 字段
    try {
      this.db.exec('ALTER TABLE workflows ADD COLUMN tags_json TEXT');
    } catch {
      // 字段已存在，忽略
    }

    // 增量表结构平滑迁移：为历史已有数据库的 workflows 表补齐 task_template_json 字段
    try {
      this.db.exec('ALTER TABLE workflows ADD COLUMN task_template_json TEXT');
    } catch {
      // 字段已存在，忽略
    }

    // 增量表结构平滑迁移：为历史已有数据库的 workflows 表补齐 script 字段（脚本流水线）
    try {
      this.db.exec('ALTER TABLE workflows ADD COLUMN script TEXT');
    } catch {
      // 字段已存在，忽略
    }

    // 增量表结构平滑迁移：为历史已有数据库的 tasks 表补齐 workspace 字段
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN workspace TEXT');
    } catch {
      // 字段已存在，忽略
    }

    // 增量表结构平滑迁移：为历史已有数据库的 tasks 表补齐 attachments_json 字段
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN attachments_json TEXT');
    } catch {
      // 字段已存在，忽略
    }

    // 增量表结构平滑迁移：为历史已有数据库的 tasks 表补齐 trigger_source 字段与高频索引
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN trigger_source TEXT');
    } catch {
      // 字段已存在，忽略
    }

    // 增量表结构平滑迁移：任务组 (Task Group) 架构扩展字段
    try {
      this.db.exec("ALTER TABLE tasks ADD COLUMN kind TEXT DEFAULT 'single'");
    } catch {}
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN parent_task_id TEXT');
    } catch {}
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN sub_task_ids_json TEXT');
    } catch {}
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN dependencies_json TEXT');
    } catch {}
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN execution_mode TEXT');
    } catch {}
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN concurrency_limit INTEGER DEFAULT 3');
    } catch {}

    // 增量表结构平滑迁移：QA 跨端平台 (Web/Android/iOS) 扩展字段
    try {
      this.db.exec("ALTER TABLE qa_suites ADD COLUMN platform TEXT DEFAULT 'web'");
    } catch {}
    try {
      this.db.exec('ALTER TABLE qa_suites ADD COLUMN app_package TEXT');
    } catch {}
    try {
      this.db.exec('ALTER TABLE qa_suites ADD COLUMN device_serial TEXT');
    } catch {}
    try {
      this.db.exec('ALTER TABLE qa_suites ADD COLUMN wda_endpoint TEXT');
    } catch {}
    try {
      this.db.exec("ALTER TABLE qa_runs ADD COLUMN platform TEXT DEFAULT 'web'");
    } catch {}
    try {
      this.db.exec('ALTER TABLE qa_runs ADD COLUMN device_serial TEXT');
    } catch {}

    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_workflow_created ON tasks(workflow_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_trigger_source ON tasks(trigger_source);
        CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_task_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_kind ON tasks(kind);
      `);
    } catch {
      // 忽略
    }

    // 内置插件仅在缺失时补齐；流水线不内置，完全由用户创建或导入
    const countPlugin = this.db.prepare('SELECT count(*) as cnt FROM plugins').get() as { cnt: number };
    if (countPlugin.cnt === 0) this.seedBuiltinPlugins();

    // 清理已废弃的示例自动化任务
    try {
      this.db.prepare("DELETE FROM automation_tasks WHERE id IN ('auto_gh_issues_sync', 'auto_twitter_pipeline', 'auto_cli_polling')").run();
    } catch {
      // 忽略
    }

    // 平滑补齐或迁移标签数据
    try {
      const rows = this.db.prepare('SELECT id, name, tags_json, variables_json FROM workflows').all() as any[];
      const updateStmt = this.db.prepare('UPDATE workflows SET tags_json = ?, variables_json = ? WHERE id = ?');
      for (const row of rows) {
        let tags: string[] = [];
        let hasTagsSource = false;
        if (row.tags_json) {
          try {
            const parsed = JSON.parse(row.tags_json);
            if (Array.isArray(parsed)) {
              tags = parsed;
              hasTagsSource = true;
            }
          } catch {}
        }
        if (!hasTagsSource && row.variables_json) {
          try {
            const vars = JSON.parse(row.variables_json);
            if (Array.isArray(vars.tags) && vars.tags.length > 0) {
              tags = vars.tags;
              hasTagsSource = true;
            }
          } catch {}
        }
        if (!hasTagsSource) {
          continue;
        }

        let varsObj: any = null;
        if (row.variables_json) {
          try {
            varsObj = JSON.parse(row.variables_json);
          } catch {}
        }
        if (varsObj && typeof varsObj === 'object') {
          varsObj.tags = tags;
        }

        const newTagsJson = JSON.stringify(tags);
        const newVarsJson = varsObj ? JSON.stringify(varsObj) : row.variables_json;
        if (newTagsJson !== row.tags_json || newVarsJson !== row.variables_json) {
          updateStmt.run(newTagsJson, newVarsJson, row.id);
        }
      }
    } catch {
      // 忽略
    }

    // 增量配置平滑迁移：历史版本曾将 defaultCwd 默认写入为 process.cwd()，旧默认启动目录重置为空
    try {
      const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'defaultCwd'").get() as { value_json: string } | undefined;
      if (row) {
        const val = JSON.parse(row.value_json);
        if (typeof val === 'string' && (val === process.cwd() || path.resolve(val) === path.resolve(process.cwd()) || process.cwd().startsWith(val))) {
          this.db.prepare("DELETE FROM settings WHERE key = 'defaultCwd'").run();
        }
      }
    } catch {
      // 忽略
    }

    // 注意：孤立任务恢复不在此处执行。Store 会被 CLI、脚本等多个进程实例化，
    // 若在构造时清理，任何并发进程都会误杀正在执行的任务。
    // 该动作改由 OpenLoopServer.start() 在服务启动时执行一次。
  }

  /**
   * 清理因服务崩溃/重启而残留为 running 状态的孤立任务。
   * 只允许服务进程在启动时调用一次。
   * @returns 被恢复的任务数量
   */
  public recoverOrphanRunningTasks(): number {
    try {
      const runningTasks = this.db.prepare("SELECT id FROM tasks WHERE status = 'running'").all() as { id: string }[];
      if (runningTasks.length === 0) return 0;

      const now = Date.now();
      const updateTaskStmt = this.db.prepare(`
        UPDATE tasks 
        SET status = 'cancelled', kanban_column = 'backlog', updated_at = ?
        WHERE id = ?
      `);
      const updateRunsStmt = this.db.prepare(`
        UPDATE task_node_runs
        SET status = 'failed', error = '服务重启导致执行中断', finished_at = ?
        WHERE task_id = ? AND status = 'running'
      `);

      for (const t of runningTasks) {
        updateTaskStmt.run(now, t.id);
        updateRunsStmt.run(now, t.id);
      }
      return runningTasks.length;
    } catch (e) {
      console.warn('[SqliteStore] recoverOrphanRunningTasks error:', e);
      return 0;
    }
  }

  private seedBuiltinPlugins() {
    // 预置插件
    const builtinPlugins: PluginManifest[] = [
      {
        id: 'kanban',
        name: '任务看板',
        version: '1.0.0',
        description: '可视化任务全自动化流转看板，支持阶段追踪与人工介入',
        isBuiltin: true,
        sidebarItem: {
          id: 'kanban',
          title: '任务看板',
          icon: 'Kanban',
          order: 1,
          path: '/kanban',
        },
      },
      {
        id: 'workflow-editor',
        name: '流程编排',
        version: '1.0.0',
        description: '基于 DAG 节点的可视化自动化流程设计与调试器',
        isBuiltin: true,
        sidebarItem: {
          id: 'workflow-editor',
          title: '流程编排',
          icon: 'Workflow',
          order: 2,
          path: '/workflows',
        },
      },
      {
        id: 'plugin-manager',
        name: '插件中心',
        version: '1.0.0',
        description: '管理侧边栏插件插槽与自定义流程节点扩展',
        isBuiltin: true,
        sidebarItem: {
          id: 'plugin-manager',
          title: '插件扩展',
          icon: 'Boxes',
          order: 3,
          path: '/plugins',
        },
      },
    ];

    for (const plugin of builtinPlugins) {
      this.registerPlugin(plugin);
    }
  }

  /**
   * 平滑迁移旧的 store.json 数据到 SQLite
   */
  private migrateFromJsonStoreIfPresent() {
    const jsonPath = path.join(this.dataDir, 'store.json');
    if (!fs.existsSync(jsonPath)) return;

    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const oldData = JSON.parse(raw);

      const countTasks = this.db.prepare('SELECT count(*) as cnt FROM tasks').get() as { cnt: number };
      if (countTasks.cnt === 0 && oldData.tasks) {
        // 迁移流程
        if (oldData.workflows) {
          for (const wf of Object.values(oldData.workflows) as WorkflowDefinition[]) {
            this.saveWorkflow(wf);
          }
        }

        // 迁移任务
        for (const t of Object.values(oldData.tasks) as Task[]) {
          this.saveTask(t);
        }

        // 迁移插件
        if (oldData.plugins) {
          for (const p of Object.values(oldData.plugins) as PluginManifest[]) {
            this.registerPlugin(p);
          }
        }
      }

      // 备份旧的 store.json 避免重复处理
      const backupPath = `${jsonPath}.bak`;
      if (!fs.existsSync(backupPath)) {
        fs.renameSync(jsonPath, backupPath);
      }
    } catch (e) {
      console.warn('[SqliteStore] Failed to migrate store.json into SQLite:', e);
    }
  }

  // ================= Workflows API =================

  public getWorkflows(): WorkflowDefinition[] {
    const rows = this.db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all() as any[];
    return rows.map((r) => {
      const variables = r.variables_json ? JSON.parse(r.variables_json) : undefined;
      let tags: string[] = [];
      if (r.tags_json) {
        try {
          const parsed = JSON.parse(r.tags_json);
          if (Array.isArray(parsed)) tags = parsed;
        } catch {}
      } else if (variables?.tags && Array.isArray(variables.tags)) {
        tags = variables.tags;
      }
      let taskTemplate = r.task_template_json ? JSON.parse(r.task_template_json) : undefined;
      if (!taskTemplate && variables?.taskTemplate) {
        taskTemplate = variables.taskTemplate;
      }
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        nodes: JSON.parse(r.nodes_json),
        edges: JSON.parse(r.edges_json),
        tags,
        taskTemplate,
        variables,
        requireWorkspace: variables?.requireWorkspace,
        defaultWorkspace: variables?.defaultWorkspace,
        script: r.script || undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  public getWorkflow(id: string): WorkflowDefinition | undefined {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    const variables = row.variables_json ? JSON.parse(row.variables_json) : undefined;
    let tags: string[] = [];
    if (row.tags_json) {
      try {
        const parsed = JSON.parse(row.tags_json);
        if (Array.isArray(parsed)) tags = parsed;
      } catch {}
    } else if (variables?.tags && Array.isArray(variables.tags)) {
      tags = variables.tags;
    }
    let taskTemplate = row.task_template_json ? JSON.parse(row.task_template_json) : undefined;
    if (!taskTemplate && variables?.taskTemplate) {
      taskTemplate = variables.taskTemplate;
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      nodes: JSON.parse(row.nodes_json),
      edges: JSON.parse(row.edges_json),
      tags,
      taskTemplate,
      variables,
      requireWorkspace: variables?.requireWorkspace,
      defaultWorkspace: variables?.defaultWorkspace,
      script: row.script || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public saveWorkflow(wf: WorkflowDefinition): WorkflowDefinition {
    wf.updatedAt = Date.now();
    if (!wf.createdAt) wf.createdAt = wf.updatedAt;

    const tagsList = Array.isArray(wf.tags)
      ? Array.from(new Set(wf.tags.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)))
      : [];
    wf.tags = tagsList;

    const taskTemplateJson = wf.taskTemplate ? JSON.stringify(wf.taskTemplate) : null;
    const variablesObj = {
      ...(wf.variables || {}),
      ...(wf.requireWorkspace !== undefined ? { requireWorkspace: wf.requireWorkspace } : {}),
      ...(wf.defaultWorkspace !== undefined ? { defaultWorkspace: wf.defaultWorkspace } : {}),
      ...(wf.taskTemplate ? { taskTemplate: wf.taskTemplate } : {}),
      tags: tagsList,
    };
    const hasVariables = Object.keys(variablesObj).length > 0;

    const stmt = this.db.prepare(`
      INSERT INTO workflows (id, name, description, nodes_json, edges_json, variables_json, tags_json, task_template_json, script, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        nodes_json = excluded.nodes_json,
        edges_json = excluded.edges_json,
        variables_json = excluded.variables_json,
        tags_json = excluded.tags_json,
        task_template_json = excluded.task_template_json,
        script = excluded.script,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      wf.id,
      wf.name,
      wf.description || '',
      JSON.stringify(wf.nodes || []),
      JSON.stringify(wf.edges || []),
      hasVariables ? JSON.stringify(variablesObj) : null,
      JSON.stringify(tagsList),
      taskTemplateJson,
      wf.script && wf.script.trim() ? wf.script : null,
      wf.createdAt,
      wf.updatedAt
    );

    return wf;
  }

  public deleteWorkflow(id: string): boolean {
    const info = this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    return info.changes > 0;
  }

  public getDataDir(): string {
    return this.dataDir;
  }

  // ================= Tasks API =================

  public getTasks(): Task[] {
    const taskRows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as any[];
    if (taskRows.length === 0) return [];
    const runsByTask = this.buildNodeRunsByTask();
    return taskRows.map((tr) => this.mapTaskRow(tr, runsByTask));
  }

  /**
   * 看板初始化 / 任务列表使用的轻量查询：
   * 在 SQLite 侧直接剔除超大 JSON 字段（Agent 全量会话、逐文件 Diff 明细），
   * 只把任务摘要送回 Node 与网络层，避免每次刷新搬运数十 MB 数据。
   */
  public getTaskSummaries(): Task[] {
    const taskRows = this.db.prepare(TASK_SUMMARY_SQL).all() as any[];
    if (taskRows.length === 0) return [];
    const runsByTask = this.buildNodeRunsByTask();
    return taskRows.map((tr) => {
      const task = this.mapTaskRow(tr, runsByTask);
      if (tr.has_code_changes) task.context.hasCodeChanges = true;
      return task;
    });
  }

  private buildNodeRunsByTask(): Map<string, Record<string, NodeRun>> {
    const nodeRunRows = this.db.prepare('SELECT * FROM task_node_runs').all() as any[];
    const runsByTask = new Map<string, Record<string, NodeRun>>();

    for (const nr of nodeRunRows) {
      if (!runsByTask.has(nr.task_id)) {
        runsByTask.set(nr.task_id, {});
      }
      runsByTask.get(nr.task_id)![nr.node_id] = {
        nodeId: nr.node_id,
        status: nr.status,
        startedAt: nr.started_at || undefined,
        finishedAt: nr.finished_at || undefined,
        output: nr.output_json ? JSON.parse(nr.output_json) : undefined,
        error: nr.error || undefined,
        exitCode: nr.exit_code !== null ? nr.exit_code : undefined,
        artifacts: nr.artifacts_json ? JSON.parse(nr.artifacts_json) : undefined,
      };
    }

    return runsByTask;
  }

  private mapTaskRow(tr: any, runsByTask: Map<string, Record<string, NodeRun>>): Task {
    const parsedContext = tr.context_json ? JSON.parse(tr.context_json) : {};
    return {
      id: tr.id,
      title: tr.title,
      description: tr.description || undefined,
      workflowId: tr.workflow_id,
      status: tr.status,
      kanbanColumn: tr.kanban_column,
      currentNodeId: tr.current_node_id || undefined,
      context: parsedContext,
      workspace: tr.workspace || undefined,
      attachments: tr.attachments_json ? JSON.parse(tr.attachments_json) : undefined,
      triggerSource: tr.trigger_source || parsedContext?.triggerSource || 'kanban',
      kind: tr.kind || 'single',
      parentTaskId: tr.parent_task_id || undefined,
      subTaskIds: tr.sub_task_ids_json ? JSON.parse(tr.sub_task_ids_json) : undefined,
      dependencies: tr.dependencies_json ? JSON.parse(tr.dependencies_json) : undefined,
      executionMode: tr.execution_mode || undefined,
      concurrencyLimit: typeof tr.concurrency_limit === 'number' ? tr.concurrency_limit : undefined,
      createdAt: tr.created_at,
      updatedAt: tr.updated_at,
      nodeRuns: runsByTask.get(tr.id) || {},
    };
  }

  /** 局部更新任务上下文：只写入指定字段，避免整列覆盖其它并发写入 */
  public updateTaskContext(taskId: string, patch: Record<string, any>): Record<string, any> | undefined {
    const row = this.db.prepare('SELECT context_json FROM tasks WHERE id = ?').get(taskId) as any;
    if (!row) return undefined;
    const merged = { ...this.parseContextJson(row.context_json), ...patch };
    this.db
      .prepare('UPDATE tasks SET context_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), Date.now(), taskId);
    return merged;
  }

  private parseContextJson(raw?: string | null): Record<string, any> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.chatMessages)) {
          parsed.chatMessages = sanitizeChatMessages(parsed.chatMessages);
        }
        return parsed;
      }
      return {};
    } catch {
      return {};
    }
  }

  public getTask(id: string): Task | undefined {
    const tr = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!tr) return undefined;

    const nodeRunRows = this.db.prepare('SELECT * FROM task_node_runs WHERE task_id = ?').all(id) as any[];
    const nodeRuns: Record<string, NodeRun> = {};

    for (const nr of nodeRunRows) {
      nodeRuns[nr.node_id] = {
        nodeId: nr.node_id,
        status: nr.status,
        startedAt: nr.started_at || undefined,
        finishedAt: nr.finished_at || undefined,
        output: nr.output_json ? JSON.parse(nr.output_json) : undefined,
        error: nr.error || undefined,
        exitCode: nr.exit_code !== null ? nr.exit_code : undefined,
        artifacts: nr.artifacts_json ? JSON.parse(nr.artifacts_json) : undefined,
      };
    }

    const parsedContext = this.parseContextJson(tr.context_json);

    return {
      id: tr.id,
      title: tr.title,
      description: tr.description || undefined,
      workflowId: tr.workflow_id,
      status: tr.status,
      kanbanColumn: tr.kanban_column,
      currentNodeId: tr.current_node_id || undefined,
      context: parsedContext,
      workspace: tr.workspace || undefined,
      attachments: tr.attachments_json ? JSON.parse(tr.attachments_json) : undefined,
      triggerSource: tr.trigger_source || parsedContext?.triggerSource || 'kanban',
      kind: tr.kind || 'single',
      parentTaskId: tr.parent_task_id || undefined,
      subTaskIds: tr.sub_task_ids_json ? JSON.parse(tr.sub_task_ids_json) : undefined,
      dependencies: tr.dependencies_json ? JSON.parse(tr.dependencies_json) : undefined,
      executionMode: tr.execution_mode || undefined,
      concurrencyLimit: typeof tr.concurrency_limit === 'number' ? tr.concurrency_limit : undefined,
      createdAt: tr.created_at,
      updatedAt: tr.updated_at,
      nodeRuns,
    };
  }

  public saveTask(task: Task): Task {
    task.updatedAt = Date.now();
    if (!task.createdAt) task.createdAt = task.updatedAt;

    // 上下文按字段合并：内存任务对象可能是流水线启动时的旧快照，
    // 直接整列覆盖会丢弃运行期间由 HTTP 写入的字段（如用户刚保存的 qaInstructions）。
    // 内存快照持有的字段优先，未持有的字段保留库中最新值。
    const storedRow = this.db.prepare('SELECT context_json FROM tasks WHERE id = ?').get(task.id) as any;
    if (storedRow?.context_json) {
      const storedContext = this.parseContextJson(storedRow.context_json);
      task.context = { ...storedContext, ...(task.context || {}) };
    }

    const upsertTask = this.db.prepare(`
      INSERT INTO tasks (
        id, title, description, workflow_id, status, kanban_column,
        current_node_id, context_json, workspace, attachments_json, trigger_source,
        kind, parent_task_id, sub_task_ids_json, dependencies_json, execution_mode, concurrency_limit,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        workflow_id = excluded.workflow_id,
        status = excluded.status,
        kanban_column = excluded.kanban_column,
        current_node_id = excluded.current_node_id,
        context_json = excluded.context_json,
        workspace = excluded.workspace,
        attachments_json = excluded.attachments_json,
        trigger_source = excluded.trigger_source,
        kind = excluded.kind,
        parent_task_id = excluded.parent_task_id,
        sub_task_ids_json = excluded.sub_task_ids_json,
        dependencies_json = excluded.dependencies_json,
        execution_mode = excluded.execution_mode,
        concurrency_limit = excluded.concurrency_limit,
        updated_at = excluded.updated_at
    `);

    const upsertNodeRun = this.db.prepare(`
      INSERT INTO task_node_runs (task_id, node_id, status, started_at, finished_at, output_json, error, exit_code, artifacts_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, node_id) DO UPDATE SET
        status = excluded.status,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        output_json = excluded.output_json,
        error = excluded.error,
        exit_code = excluded.exit_code,
        artifacts_json = excluded.artifacts_json
    `);

    // 事务批量保存 Task 和 NodeRuns
    const saveTransaction = this.db.transaction(() => {
      upsertTask.run(
        task.id,
        task.title,
        task.description || '',
        task.workflowId,
        task.status,
        task.kanbanColumn,
        task.currentNodeId || null,
        JSON.stringify(task.context || {}),
        task.workspace || null,
        task.attachments && task.attachments.length > 0 ? JSON.stringify(task.attachments) : null,
        task.triggerSource || task.context?.triggerSource || 'kanban',
        task.kind || 'single',
        task.parentTaskId || null,
        task.subTaskIds && task.subTaskIds.length > 0 ? JSON.stringify(task.subTaskIds) : null,
        task.dependencies && task.dependencies.length > 0 ? JSON.stringify(task.dependencies) : null,
        task.executionMode || null,
        typeof task.concurrencyLimit === 'number' ? task.concurrencyLimit : 3,
        task.createdAt,
        task.updatedAt
      );

      if (task.nodeRuns) {
        const activeNodeIds = Object.keys(task.nodeRuns);
        if (activeNodeIds.length > 0) {
          const placeholders = activeNodeIds.map(() => '?').join(',');
          this.db
            .prepare(`DELETE FROM task_node_runs WHERE task_id = ? AND node_id NOT IN (${placeholders})`)
            .run(task.id, ...activeNodeIds);
        } else {
          this.db.prepare('DELETE FROM task_node_runs WHERE task_id = ?').run(task.id);
        }

        for (const [nodeId, run] of Object.entries(task.nodeRuns)) {
          upsertNodeRun.run(
            task.id,
            nodeId,
            run.status,
            run.startedAt || null,
            run.finishedAt || null,
            run.output ? JSON.stringify(run.output) : null,
            run.error || null,
            typeof run.exitCode === 'number' ? run.exitCode : null,
            run.artifacts ? JSON.stringify(run.artifacts) : null
          );
        }
      }
    });

    saveTransaction();
    return task;
  }

  public updateTaskColumn(taskId: string, column: KanbanColumn) {
    this.db.prepare('UPDATE tasks SET kanban_column = ?, updated_at = ? WHERE id = ?').run(
      column,
      Date.now(),
      taskId
    );
  }

  public deleteTask(taskId: string): boolean {
    const artifactsDir = path.join(this.dataDir, 'artifacts');
    const attachmentsDir = path.join(this.dataDir, 'attachments');
    const cleanTaskFiles = (id: string) => {
      // 1. 清理关联的 qa_runs 截图产物
      const qaRows = this.db.prepare('SELECT id FROM qa_runs WHERE task_id = ?').all(id) as { id: string }[];
      for (const qr of qaRows) {
        const rDir = path.join(artifactsDir, qr.id);
        if (fs.existsSync(rDir)) {
          try { fs.rmSync(rDir, { recursive: true, force: true }); } catch {}
        }
      }
      // 2. 清理 attachments_json 中的附件文件
      const tRow = this.db.prepare('SELECT attachments_json FROM tasks WHERE id = ?').get(id) as { attachments_json?: string } | undefined;
      if (tRow?.attachments_json) {
        try {
          const atts = JSON.parse(tRow.attachments_json);
          if (Array.isArray(atts)) {
            for (const a of atts) {
              const fn = a.url ? path.basename(a.url) : (a.path ? path.basename(a.path) : null);
              if (fn) {
                const filePath = path.join(attachmentsDir, fn);
                if (fs.existsSync(filePath)) {
                  try { fs.unlinkSync(filePath); } catch {}
                }
              }
            }
          }
        } catch {}
      }
    };

    const tx = this.db.transaction((id: string) => {
      // 1. 若被删除的是任务组，级联清理其所有子任务相关数据
      const subtasks = this.db.prepare('SELECT id FROM tasks WHERE parent_task_id = ?').all(id) as { id: string }[];
      for (const sub of subtasks) {
        cleanTaskFiles(sub.id);
        this.db.prepare('DELETE FROM logs WHERE task_id = ?').run(sub.id);
        this.db.prepare('DELETE FROM qa_runs WHERE task_id = ?').run(sub.id);
        this.db.prepare('DELETE FROM task_node_runs WHERE task_id = ?').run(sub.id);
        this.db.prepare('DELETE FROM tasks WHERE id = ?').run(sub.id);
      }

      // 2. 若被删除的是子任务，从其父任务组的 subTaskIds 中解绑
      const currentTask = this.db.prepare('SELECT parent_task_id FROM tasks WHERE id = ?').get(id) as { parent_task_id?: string } | undefined;
      if (currentTask?.parent_task_id) {
        const parent = this.getTask(currentTask.parent_task_id);
        if (parent && parent.subTaskIds) {
          parent.subTaskIds = parent.subTaskIds.filter((sid) => sid !== id);
          this.saveTask(parent);
        }
      }

      // 3. 删除当前任务关联的日志、QA记录与任务记录
      cleanTaskFiles(id);
      this.db.prepare('DELETE FROM logs WHERE task_id = ?').run(id);
      this.db.prepare('DELETE FROM qa_runs WHERE task_id = ?').run(id);
      this.db.prepare('DELETE FROM task_node_runs WHERE task_id = ?').run(id);
      const info = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      return info.changes > 0;
    });
    return tx(taskId);
  }

  // ================= Logs API =================

  public addLog(entry: LogEntry) {
    const stmt = this.db.prepare(`
      INSERT INTO logs (id, task_id, node_id, timestamp, stream, message)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    try {
      stmt.run(entry.id, entry.taskId, entry.nodeId, entry.timestamp, entry.stream, entry.message);
    } catch (e: any) {
      storeLogger.warn(`持久化日志记录失败: ${e.message}`, { entryId: entry.id, taskId: entry.taskId });
    }
  }

  public getLogs(taskId?: string, nodeId?: string, limit: number = 2000): LogEntry[] {
    let sql = 'SELECT * FROM logs';
    const params: any[] = [];

    if (taskId && nodeId) {
      sql += ' WHERE task_id = ? AND node_id = ?';
      params.push(taskId, nodeId);
    } else if (taskId) {
      sql += ' WHERE task_id = ?';
      params.push(taskId);
    } else if (nodeId) {
      sql += ' WHERE node_id = ?';
      params.push(nodeId);
    }

    sql += ' ORDER BY timestamp ASC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      nodeId: r.node_id,
      timestamp: r.timestamp,
      stream: r.stream,
      message: r.message,
    }));
  }

  public clearLogs(taskId?: string) {
    if (taskId) {
      this.db.prepare('DELETE FROM logs WHERE task_id = ?').run(taskId);
    } else {
      this.db.prepare('DELETE FROM logs').run();
    }
  }

  // ================= Plugins API =================

  public getPlugins(): PluginManifest[] {
    const rows = this.db.prepare('SELECT * FROM plugins ORDER BY id ASC').all() as any[];
    return rows.map((r) => JSON.parse(r.manifest_json));
  }

  public registerPlugin(plugin: PluginManifest): PluginManifest {
    const stmt = this.db.prepare(`
      INSERT INTO plugins (id, name, version, description, author, is_builtin, manifest_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        description = excluded.description,
        author = excluded.author,
        is_builtin = excluded.is_builtin,
        manifest_json = excluded.manifest_json,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      plugin.id,
      plugin.name,
      plugin.version,
      plugin.description || '',
      plugin.author || '',
      plugin.isBuiltin ? 1 : 0,
      JSON.stringify(plugin),
      Date.now()
    );

    return plugin;
  }

  public deletePlugin(id: string): boolean {
    const res = this.db.prepare('DELETE FROM plugins WHERE id = ?').run(id);
    return res.changes > 0;
  }

  public getSettings(): OpenLoopSettings {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as any[];
    const result: OpenLoopSettings = {
      defaultModel: '',
      reasoningLevel: 'high',
      defaultCwd: '',
      autoOpenGlobalAgent: false,
      prompts: { ...DEFAULT_PROMPT_TEMPLATES },
    };
    for (const r of rows) {
      try {
        const val = JSON.parse(r.value_json);
        if (r.key === 'prompts' && typeof val === 'object' && val !== null) {
          result.prompts = {
            ...DEFAULT_PROMPT_TEMPLATES,
            ...val,
          };
        } else {
          result[r.key] = val;
        }
      } catch {
        result[r.key] = r.value_json;
      }
    }
    this.cachedSettings = result;
    return result;
  }

  public updateSettings(settings: Partial<OpenLoopSettings>): OpenLoopSettings {
    this.cachedSettings = null;
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `);

    const updateAll = this.db.transaction((obj: Record<string, any>) => {
      const now = Date.now();
      for (const [k, v] of Object.entries(obj)) {
        stmt.run(k, JSON.stringify(v), now);
      }
    });

    updateAll(settings);
    return this.getSettings();
  }

  // ================= QA Automation Suites API =================

  public getQaSuites(): QaSuite[] {
    const rows = this.db.prepare('SELECT * FROM qa_suites ORDER BY updated_at DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || undefined,
      platform: r.platform || 'web',
      targetUrl: r.target_url,
      appPackage: r.app_package || undefined,
      deviceSerial: r.device_serial || undefined,
      wdaEndpoint: r.wda_endpoint || undefined,
      viewport: r.viewport_json ? JSON.parse(r.viewport_json) : undefined,
      steps: JSON.parse(r.steps_json),
      tags: r.tags_json ? JSON.parse(r.tags_json) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastRunStatus: r.last_run_status || 'untested',
      lastRunDurationMs: r.last_run_duration_ms || undefined,
      lastRunAt: r.last_run_at || undefined,
    }));
  }

  public getQaSuiteById(id: string): QaSuite | null {
    const r = this.db.prepare('SELECT * FROM qa_suites WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      description: r.description || undefined,
      platform: r.platform || 'web',
      targetUrl: r.target_url,
      appPackage: r.app_package || undefined,
      deviceSerial: r.device_serial || undefined,
      wdaEndpoint: r.wda_endpoint || undefined,
      viewport: r.viewport_json ? JSON.parse(r.viewport_json) : undefined,
      steps: JSON.parse(r.steps_json),
      tags: r.tags_json ? JSON.parse(r.tags_json) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastRunStatus: r.last_run_status || 'untested',
      lastRunDurationMs: r.last_run_duration_ms || undefined,
      lastRunAt: r.last_run_at || undefined,
    };
  }

  public saveQaSuite(suite: QaSuite): QaSuite {
    const now = Date.now();
    const suiteToSave: QaSuite = {
      ...suite,
      platform: suite.platform || 'web',
      updatedAt: now,
      createdAt: suite.createdAt || now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO qa_suites (
        id, name, description, platform, target_url, app_package, device_serial, wda_endpoint, viewport_json, steps_json,
        tags_json, created_at, updated_at, last_run_status, last_run_duration_ms, last_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        platform = excluded.platform,
        target_url = excluded.target_url,
        app_package = excluded.app_package,
        device_serial = excluded.device_serial,
        wda_endpoint = excluded.wda_endpoint,
        viewport_json = excluded.viewport_json,
        steps_json = excluded.steps_json,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at,
        last_run_status = COALESCE(excluded.last_run_status, qa_suites.last_run_status),
        last_run_duration_ms = COALESCE(excluded.last_run_duration_ms, qa_suites.last_run_duration_ms),
        last_run_at = COALESCE(excluded.last_run_at, qa_suites.last_run_at)
    `);

    stmt.run(
      suiteToSave.id,
      suiteToSave.name,
      suiteToSave.description || '',
      suiteToSave.platform || 'web',
      suiteToSave.targetUrl,
      suiteToSave.appPackage || null,
      suiteToSave.deviceSerial || null,
      suiteToSave.wdaEndpoint || null,
      suiteToSave.viewport ? JSON.stringify(suiteToSave.viewport) : null,
      JSON.stringify(suiteToSave.steps || []),
      suiteToSave.tags ? JSON.stringify(suiteToSave.tags) : null,
      suiteToSave.createdAt,
      suiteToSave.updatedAt,
      suiteToSave.lastRunStatus || null,
      suiteToSave.lastRunDurationMs || null,
      suiteToSave.lastRunAt || null
    );

    return suiteToSave;
  }

  public deleteQaSuite(id: string): boolean {
    const runs = this.db.prepare('SELECT id FROM qa_runs WHERE suite_id = ?').all(id) as { id: string }[];
    const artifactsDir = path.join(this.dataDir, 'artifacts');
    for (const run of runs) {
      const runArtifactDir = path.join(artifactsDir, run.id);
      if (fs.existsSync(runArtifactDir)) {
        try {
          fs.rmSync(runArtifactDir, { recursive: true, force: true });
        } catch (e: any) {
          storeLogger.warn(`清理 QA Run 截图产物目录失败: ${runArtifactDir}`, { error: e.message });
        }
      }
    }
    this.db.prepare('DELETE FROM qa_runs WHERE suite_id = ?').run(id);
    const res = this.db.prepare('DELETE FROM qa_suites WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // ================= QA Execution Runs API =================

  public deleteQaRun(id: string): boolean {
    const run = this.db.prepare('SELECT id, suite_id FROM qa_runs WHERE id = ?').get(id) as { id: string; suite_id: string } | undefined;
    if (!run) return false;

    const runArtifactDir = path.join(this.dataDir, 'artifacts', id);
    if (fs.existsSync(runArtifactDir)) {
      try {
        fs.rmSync(runArtifactDir, { recursive: true, force: true });
      } catch (e: any) {
        storeLogger.warn(`清理 QA Run 截图产物目录失败: ${runArtifactDir}`, { error: e.message });
      }
    }

    const res = this.db.prepare('DELETE FROM qa_runs WHERE id = ?').run(id);

    if (run.suite_id) {
      const latestRun = this.db.prepare('SELECT status, duration_ms, finished_at, created_at FROM qa_runs WHERE suite_id = ? ORDER BY created_at DESC LIMIT 1').get(run.suite_id) as any;
      if (latestRun) {
        this.db.prepare('UPDATE qa_suites SET last_run_status = ?, last_run_duration_ms = ?, last_run_at = ?, updated_at = ? WHERE id = ?')
          .run(latestRun.status, latestRun.duration_ms, latestRun.finished_at || latestRun.created_at, Date.now(), run.suite_id);
      } else {
        this.db.prepare("UPDATE qa_suites SET last_run_status = 'untested', last_run_duration_ms = NULL, last_run_at = NULL, updated_at = ? WHERE id = ?")
          .run(Date.now(), run.suite_id);
      }
    }

    return res.changes > 0;
  }

  public deleteQaRuns(filter?: { suiteId?: string; olderThanDays?: number; keepLatestPerSuite?: number; runIds?: string[] }): number {
    const artifactsDir = path.join(this.dataDir, 'artifacts');
    let deletedCount = 0;

    const removeRunArtifactsAndRow = (runId: string) => {
      const rDir = path.join(artifactsDir, runId);
      if (fs.existsSync(rDir)) {
        try { fs.rmSync(rDir, { recursive: true, force: true }); } catch {}
      }
      const r = this.db.prepare('DELETE FROM qa_runs WHERE id = ?').run(runId);
      if (r.changes > 0) deletedCount += r.changes;
    };

    if (filter?.runIds && filter.runIds.length > 0) {
      for (const runId of filter.runIds) {
        removeRunArtifactsAndRow(runId);
      }
    } else if (filter?.keepLatestPerSuite !== undefined && filter.keepLatestPerSuite >= 0) {
      const keepCount = filter.keepLatestPerSuite;
      const suites = filter.suiteId
        ? [{ id: filter.suiteId }]
        : (this.db.prepare('SELECT DISTINCT suite_id as id FROM qa_runs').all() as { id: string }[]);

      for (const s of suites) {
        const rows = this.db.prepare('SELECT id FROM qa_runs WHERE suite_id = ? ORDER BY created_at DESC').all(s.id) as { id: string }[];
        if (rows.length > keepCount) {
          const toDelete = rows.slice(keepCount);
          for (const row of toDelete) {
            removeRunArtifactsAndRow(row.id);
          }
        }
      }
    } else if (filter?.olderThanDays !== undefined && filter.olderThanDays >= 0) {
      const cutoff = filter.olderThanDays === 0 ? Date.now() + 1000 : Date.now() - filter.olderThanDays * 86400000;
      let sql = 'SELECT id FROM qa_runs WHERE created_at <= ?';
      const params: any[] = [cutoff];
      if (filter.suiteId) {
        sql += ' AND suite_id = ?';
        params.push(filter.suiteId);
      }
      const rows = this.db.prepare(sql).all(...params) as { id: string }[];
      for (const row of rows) {
        removeRunArtifactsAndRow(row.id);
      }
    } else if (filter?.suiteId) {
      const rows = this.db.prepare('SELECT id FROM qa_runs WHERE suite_id = ?').all(filter.suiteId) as { id: string }[];
      for (const row of rows) {
        removeRunArtifactsAndRow(row.id);
      }
    } else {
      const rows = this.db.prepare('SELECT id FROM qa_runs').all() as { id: string }[];
      for (const row of rows) {
        removeRunArtifactsAndRow(row.id);
      }
    }

    return deletedCount;
  }

  public getQaRuns(suiteId?: string, taskId?: string, limit: number = 30): QaRunRecord[] {
    let rows: any[];
    if (suiteId && taskId) {
      rows = this.db.prepare('SELECT * FROM qa_runs WHERE suite_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT ?').all(suiteId, taskId, limit);
    } else if (suiteId) {
      rows = this.db.prepare('SELECT * FROM qa_runs WHERE suite_id = ? ORDER BY created_at DESC LIMIT ?').all(suiteId, limit);
    } else if (taskId) {
      rows = this.db.prepare('SELECT * FROM qa_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT ?').all(taskId, limit);
    } else {
      rows = this.db.prepare('SELECT * FROM qa_runs ORDER BY created_at DESC LIMIT ?').all(limit);
    }

    return rows.map((r) => ({
      id: r.id,
      suiteId: r.suite_id,
      suiteName: r.suite_name,
      platform: r.platform || 'web',
      deviceSerial: r.device_serial || undefined,
      taskId: r.task_id || undefined,
      status: r.status,
      totalSteps: r.total_steps,
      passedSteps: r.passed_steps,
      durationMs: r.duration_ms,
      timeline: JSON.parse(r.timeline_json),
      reportRelPath: r.report_rel_path || undefined,
      createdAt: r.created_at,
      finishedAt: r.finished_at || undefined,
      error: r.error || undefined,
    }));
  }

  public getQaRunById(id: string): QaRunRecord | null {
    const r = this.db.prepare('SELECT * FROM qa_runs WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      suiteId: r.suite_id,
      suiteName: r.suite_name,
      platform: r.platform || 'web',
      deviceSerial: r.device_serial || undefined,
      taskId: r.task_id || undefined,
      status: r.status,
      totalSteps: r.total_steps,
      passedSteps: r.passed_steps,
      durationMs: r.duration_ms,
      timeline: JSON.parse(r.timeline_json),
      reportRelPath: r.report_rel_path || undefined,
      createdAt: r.created_at,
      finishedAt: r.finished_at || undefined,
      error: r.error || undefined,
    };
  }

  public saveQaRun(run: QaRunRecord): QaRunRecord {
    const stmt = this.db.prepare(`
      INSERT INTO qa_runs (
        id, suite_id, suite_name, platform, device_serial, task_id, status, total_steps, passed_steps,
        duration_ms, timeline_json, report_rel_path, created_at, finished_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        platform = COALESCE(excluded.platform, qa_runs.platform),
        device_serial = COALESCE(excluded.device_serial, qa_runs.device_serial),
        total_steps = excluded.total_steps,
        passed_steps = excluded.passed_steps,
        duration_ms = excluded.duration_ms,
        timeline_json = excluded.timeline_json,
        report_rel_path = excluded.report_rel_path,
        finished_at = excluded.finished_at,
        error = excluded.error
    `);

    stmt.run(
      run.id,
      run.suiteId,
      run.suiteName,
      run.platform || 'web',
      run.deviceSerial || null,
      run.taskId || null,
      run.status,
      run.totalSteps,
      run.passedSteps,
      run.durationMs,
      JSON.stringify(run.timeline || []),
      run.reportRelPath || null,
      run.createdAt,
      run.finishedAt || null,
      run.error || null
    );

    // 同步更新对应 suite 的最新状态
    const updateSuiteStmt = this.db.prepare(`
      UPDATE qa_suites
      SET last_run_status = ?, last_run_duration_ms = ?, last_run_at = ?, updated_at = ?
      WHERE id = ?
    `);
    updateSuiteStmt.run(run.status, run.durationMs, run.finishedAt || Date.now(), Date.now(), run.suiteId);

    return run;
  }

  private mapRowToAutomationTask(r: any): AutomationTask {
    return {
      id: r.id,
      name: r.name,
      description: r.description || undefined,
      enabled: Boolean(r.enabled),
      intervalSec: r.interval_sec,
      sourceType: r.source_type,
      sourceConfig: r.source_config_json ? JSON.parse(r.source_config_json) : {},
      actionType: r.action_type,
      actionConfig: r.action_config_json ? JSON.parse(r.action_config_json) : {},
      lastRunAt: r.last_run_at || undefined,
      lastRunStatus: r.last_run_status || undefined,
      lastRunDurationMs: r.last_run_duration_ms || undefined,
      lastRunMessage: r.last_run_message || undefined,
      lastRunOutput: r.last_run_output || undefined,
      totalRuns: r.total_runs || 0,
      successRuns: r.success_runs || 0,
      failedRuns: r.failed_runs || 0,
      createdTaskIds: r.created_task_ids_json ? JSON.parse(r.created_task_ids_json) : [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public getAutomationTasks(): AutomationTask[] {
    const rows = this.db.prepare('SELECT * FROM automation_tasks ORDER BY updated_at DESC').all() as any[];
    return rows.map((r) => this.mapRowToAutomationTask(r));
  }

  public getAutomationTask(id: string): AutomationTask | undefined {
    const r = this.db.prepare('SELECT * FROM automation_tasks WHERE id = ?').get(id) as any;
    return r ? this.mapRowToAutomationTask(r) : undefined;
  }

  public saveAutomationTask(task: AutomationTask): AutomationTask {
    const stmt = this.db.prepare(`
      INSERT INTO automation_tasks (
        id, name, description, enabled, interval_sec, source_type,
        source_config_json, action_type, action_config_json,
        last_run_at, last_run_status, last_run_duration_ms,
        last_run_message, last_run_output, total_runs, success_runs,
        failed_runs, created_task_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        enabled = excluded.enabled,
        interval_sec = excluded.interval_sec,
        source_type = excluded.source_type,
        source_config_json = excluded.source_config_json,
        action_type = excluded.action_type,
        action_config_json = excluded.action_config_json,
        last_run_at = excluded.last_run_at,
        last_run_status = excluded.last_run_status,
        last_run_duration_ms = excluded.last_run_duration_ms,
        last_run_message = excluded.last_run_message,
        last_run_output = excluded.last_run_output,
        total_runs = excluded.total_runs,
        success_runs = excluded.success_runs,
        failed_runs = excluded.failed_runs,
        created_task_ids_json = excluded.created_task_ids_json,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      task.id,
      task.name,
      task.description || null,
      task.enabled ? 1 : 0,
      task.intervalSec || 60,
      task.sourceType,
      JSON.stringify(task.sourceConfig || {}),
      task.actionType,
      JSON.stringify(task.actionConfig || {}),
      task.lastRunAt || null,
      task.lastRunStatus || null,
      task.lastRunDurationMs || null,
      task.lastRunMessage || null,
      task.lastRunOutput || null,
      task.totalRuns || 0,
      task.successRuns || 0,
      task.failedRuns || 0,
      JSON.stringify(task.createdTaskIds || []),
      task.createdAt || Date.now(),
      task.updatedAt || Date.now()
    );

    return task;
  }

  public deleteAutomationTask(id: string): boolean {
    const res = this.db.prepare('DELETE FROM automation_tasks WHERE id = ?').run(id);
    return res.changes > 0;
  }

  public getAutomationLogs(automationId?: string, limit = 50): AutomationLogRecord[] {
    let rows: any[];
    if (automationId) {
      rows = this.db.prepare('SELECT * FROM automation_logs WHERE automation_id = ? ORDER BY timestamp DESC LIMIT ?').all(automationId, limit);
    } else {
      rows = this.db.prepare('SELECT * FROM automation_logs ORDER BY timestamp DESC LIMIT ?').all(limit);
    }
    return rows.map((r) => ({
      id: r.id,
      automationId: r.automation_id,
      timestamp: r.timestamp,
      status: r.status,
      durationMs: r.duration_ms,
      summary: r.summary,
      output: r.output || undefined,
      error: r.error || undefined,
      createdTaskId: r.created_task_id || undefined,
    }));
  }

  public addAutomationLog(log: AutomationLogRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO automation_logs (
        id, automation_id, timestamp, status, duration_ms, summary, output, error, created_task_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      log.id,
      log.automationId,
      log.timestamp,
      log.status,
      log.durationMs,
      log.summary,
      log.output || null,
      log.error || null,
      log.createdTaskId || null
    );
  }

  // ================= Storage & Garbage Collection API =================

  public deleteOldLogs(olderThanDays: number, taskId?: string): number {
    const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * 86400000 : Date.now() + 1000;
    if (taskId) {
      const res = this.db.prepare('DELETE FROM logs WHERE task_id = ? AND timestamp <= ?').run(taskId, cutoff);
      return res.changes;
    }
    const res = this.db.prepare('DELETE FROM logs WHERE timestamp <= ?').run(cutoff);
    return res.changes;
  }

  public deleteOldAutomationLogs(olderThanDays: number, automationId?: string): number {
    const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * 86400000 : Date.now() + 1000;
    if (automationId) {
      const res = this.db.prepare('DELETE FROM automation_logs WHERE automation_id = ? AND timestamp <= ?').run(automationId, cutoff);
      return res.changes;
    }
    const res = this.db.prepare('DELETE FROM automation_logs WHERE timestamp <= ?').run(cutoff);
    return res.changes;
  }

  private getDirectorySize(dirPath: string): { totalBytes: number; fileCount: number } {
    let totalBytes = 0;
    let fileCount = 0;
    if (!fs.existsSync(dirPath)) return { totalBytes: 0, fileCount: 0 };

    const traverse = (current: string) => {
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            traverse(fullPath);
          } else if (entry.isFile()) {
            fileCount++;
            try {
              const stat = fs.statSync(fullPath);
              totalBytes += stat.size;
            } catch {}
          }
        }
      } catch {}
    };

    traverse(dirPath);
    return { totalBytes, fileCount };
  }

  public cleanOrphanFiles(): { deletedCount: number; freedBytes: number } {
    let deletedCount = 0;
    let freedBytes = 0;

    const artifactsDir = path.join(this.dataDir, 'artifacts');
    const attachmentsDir = path.join(this.dataDir, 'attachments');

    // 1. 清理未引用的 artifacts 运行目录
    if (fs.existsSync(artifactsDir)) {
      try {
        const entries = fs.readdirSync(artifactsDir, { withFileTypes: true });
        const existingRunIds = new Set(
          (this.db.prepare('SELECT id FROM qa_runs').all() as any[]).map((r) => r.id)
        );
        for (const entry of entries) {
          if (entry.isDirectory() && !existingRunIds.has(entry.name)) {
            const subDir = path.join(artifactsDir, entry.name);
            const dirStat = this.getDirectorySize(subDir);
            try {
              fs.rmSync(subDir, { recursive: true, force: true });
              deletedCount += dirStat.fileCount;
              freedBytes += dirStat.totalBytes;
              storeLogger.info(`[Storage:Orphan] 清理孤儿 QA 产物目录: ${entry.name} (${(dirStat.totalBytes / 1024).toFixed(1)} KB)`);
            } catch {}
          }
        }
      } catch (e: any) {
        storeLogger.warn(`扫描孤儿 artifacts 异常: ${e.message}`);
      }
    }

    // 2. 清理未引用的 attachments 图片附件
    if (fs.existsSync(attachmentsDir)) {
      try {
        const entries = fs.readdirSync(attachmentsDir, { withFileTypes: true });
        const tasks = this.db.prepare('SELECT attachments_json FROM tasks WHERE attachments_json IS NOT NULL').all() as any[];
        const referencedFilenames = new Set<string>();
        for (const t of tasks) {
          try {
            const atts = JSON.parse(t.attachments_json);
            if (Array.isArray(atts)) {
              for (const a of atts) {
                const fn = a.url ? path.basename(a.url) : (a.path ? path.basename(a.path) : null);
                if (fn) referencedFilenames.add(fn);
              }
            }
          } catch {}
        }

        for (const entry of entries) {
          if (entry.isFile() && !referencedFilenames.has(entry.name)) {
            const fPath = path.join(attachmentsDir, entry.name);
            try {
              const sz = fs.statSync(fPath).size;
              fs.unlinkSync(fPath);
              deletedCount += 1;
              freedBytes += sz;
              storeLogger.info(`[Storage:Orphan] 清理孤儿图片附件: ${entry.name} (${(sz / 1024).toFixed(1)} KB)`);
            } catch {}
          }
        }
      } catch (e: any) {
        storeLogger.warn(`扫描孤儿 attachments 异常: ${e.message}`);
      }
    }

    return { deletedCount, freedBytes };
  }

  public vacuum(): { beforeBytes: number; afterBytes: number; freedBytes: number } {
    const walPath = `${this.dbFilePath}-wal`;
    const getDbTotalSize = () => {
      let size = 0;
      try { size += fs.statSync(this.dbFilePath).size; } catch {}
      try { if (fs.existsSync(walPath)) size += fs.statSync(walPath).size; } catch {}
      return size;
    };

    const beforeBytes = getDbTotalSize();
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      this.db.exec('VACUUM');
      this.db.pragma('optimize');
    } catch (e: any) {
      storeLogger.warn(`SQLite VACUUM 优化异常: ${e.message}`);
    }
    const afterBytes = getDbTotalSize();
    const freedBytes = Math.max(0, beforeBytes - afterBytes);
    storeLogger.info(`SQLite VACUUM 优化完成: 释放空间 ${(freedBytes / 1024 / 1024).toFixed(2)} MB`);
    return { beforeBytes, afterBytes, freedBytes };
  }

  public getStorageStats(): StorageStats {
    const walPath = `${this.dbFilePath}-wal`;
    const shmPath = `${this.dbFilePath}-shm`;

    let dbSizeBytes = 0;
    let walSizeBytes = 0;
    let shmSizeBytes = 0;
    try { dbSizeBytes = fs.statSync(this.dbFilePath).size; } catch {}
    try { if (fs.existsSync(walPath)) walSizeBytes = fs.statSync(walPath).size; } catch {}
    try { if (fs.existsSync(shmPath)) shmSizeBytes = fs.statSync(shmPath).size; } catch {}

    let pageSize = 4096;
    let pageCount = 0;
    let freelistCount = 0;
    try {
      pageSize = Number(this.db.pragma('page_size', { simple: true }) || 4096);
      pageCount = Number(this.db.pragma('page_count', { simple: true }) || 0);
      freelistCount = Number(this.db.pragma('freelist_count', { simple: true }) || 0);
    } catch {}

    const countTasks = (this.db.prepare('SELECT count(*) as cnt FROM tasks').get() as any)?.cnt || 0;
    const countTaskNodeRuns = (this.db.prepare('SELECT count(*) as cnt FROM task_node_runs').get() as any)?.cnt || 0;
    const countLogs = (this.db.prepare('SELECT count(*) as cnt FROM logs').get() as any)?.cnt || 0;
    const countQaSuites = (this.db.prepare('SELECT count(*) as cnt FROM qa_suites').get() as any)?.cnt || 0;
    const countQaRuns = (this.db.prepare('SELECT count(*) as cnt FROM qa_runs').get() as any)?.cnt || 0;
    const countAutomationTasks = (this.db.prepare('SELECT count(*) as cnt FROM automation_tasks').get() as any)?.cnt || 0;
    const countAutomationLogs = (this.db.prepare('SELECT count(*) as cnt FROM automation_logs').get() as any)?.cnt || 0;

    const artifactsDir = path.join(this.dataDir, 'artifacts');
    const attachmentsDir = path.join(this.dataDir, 'attachments');
    const artifactsStat = this.getDirectorySize(artifactsDir);
    const attachmentsStat = this.getDirectorySize(attachmentsDir);
    const qaTraceStat = this.getDirectorySize(getQaTraceDir(this.dataDir));

    let orphanFilesCount = 0;
    let orphanFilesBytes = 0;

    if (fs.existsSync(artifactsDir)) {
      try {
        const dirs = fs.readdirSync(artifactsDir, { withFileTypes: true });
        const existingRunIds = new Set(
          (this.db.prepare('SELECT id FROM qa_runs').all() as any[]).map((r) => r.id)
        );
        for (const d of dirs) {
          if (d.isDirectory() && !existingRunIds.has(d.name)) {
            const subStat = this.getDirectorySize(path.join(artifactsDir, d.name));
            orphanFilesCount += subStat.fileCount;
            orphanFilesBytes += subStat.totalBytes;
          }
        }
      } catch {}
    }

    if (fs.existsSync(attachmentsDir)) {
      try {
        const files = fs.readdirSync(attachmentsDir, { withFileTypes: true });
        const tasks = this.db.prepare('SELECT attachments_json FROM tasks WHERE attachments_json IS NOT NULL').all() as any[];
        const referencedFilenames = new Set<string>();
        for (const t of tasks) {
          try {
            const atts = JSON.parse(t.attachments_json);
            if (Array.isArray(atts)) {
              for (const a of atts) {
                const fn = a.url ? path.basename(a.url) : (a.path ? path.basename(a.path) : null);
                if (fn) referencedFilenames.add(fn);
              }
            }
          } catch {}
        }
        for (const f of files) {
          if (f.isFile() && !referencedFilenames.has(f.name)) {
            try {
              const sz = fs.statSync(path.join(attachmentsDir, f.name)).size;
              orphanFilesCount += 1;
              orphanFilesBytes += sz;
            } catch {}
          }
        }
      } catch {}
    }

    const freelistBytes = freelistCount * pageSize;
    const reclaimableEstimateBytes = freelistBytes + orphanFilesBytes + qaTraceStat.totalBytes;

    return {
      database: {
        dbSizeBytes,
        walSizeBytes,
        shmSizeBytes,
        totalSizeBytes: dbSizeBytes + walSizeBytes + shmSizeBytes,
        pageSize,
        pageCount,
        freelistCount,
      },
      counts: {
        tasks: countTasks,
        taskNodeRuns: countTaskNodeRuns,
        logs: countLogs,
        qaSuites: countQaSuites,
        qaRuns: countQaRuns,
        automationTasks: countAutomationTasks,
        automationLogs: countAutomationLogs,
      },
      disk: {
        artifactsBytes: artifactsStat.totalBytes,
        artifactsFilesCount: artifactsStat.fileCount,
        attachmentsBytes: attachmentsStat.totalBytes,
        attachmentsFilesCount: attachmentsStat.fileCount,
        qaTraceBytes: qaTraceStat.totalBytes,
        qaTraceFilesCount: qaTraceStat.fileCount,
        orphanFilesCount,
        orphanFilesBytes,
      },
      reclaimableEstimateBytes,
    };
  }

  /**
   * 清空 Midscene 调试产物目录，返回删除的文件数
   */
  private cleanQaTraceDir(): number {
    const traceDir = getQaTraceDir(this.dataDir);
    if (!fs.existsSync(traceDir)) return 0;
    const stat = this.getDirectorySize(traceDir);
    try {
      fs.rmSync(traceDir, { recursive: true, force: true });
    } catch {
      return 0;
    }
    return stat.fileCount;
  }

  public cleanStorage(options: StorageCleanOptions): StorageCleanResult {
    const startTime = Date.now();
    const initialStats = this.getStorageStats();
    let deletedLogs = 0;
    let deletedQaRuns = 0;
    let deletedAutomationLogs = 0;
    let deletedOrphanFiles = 0;
    let deletedQaTrace = 0;
    let vacuumExecuted = false;

    // 1. 清理日志
    if (options.cleanLogsDays !== undefined) {
      deletedLogs = this.deleteOldLogs(options.cleanLogsDays);
    }

    // 2. 清理 QA 测试运行与截图
    if (options.cleanQaRunsKeepLatest !== undefined) {
      deletedQaRuns += this.deleteQaRuns({ keepLatestPerSuite: options.cleanQaRunsKeepLatest });
    }
    if (options.cleanQaRunsDays !== undefined) {
      deletedQaRuns += this.deleteQaRuns({ olderThanDays: options.cleanQaRunsDays });
    }

    // 3. 清理自动化巡检日志
    if (options.cleanAutomationLogsDays !== undefined) {
      deletedAutomationLogs = this.deleteOldAutomationLogs(options.cleanAutomationLogsDays);
    }

    // 4. 清理 Midscene 调试产物（纯诊断数据，不参与任何回放）
    if (options.cleanQaTrace !== false) {
      deletedQaTrace = this.cleanQaTraceDir();
    }

    // 5. 清理孤儿文件
    if (options.cleanOrphanFiles) {
      const orphanRes = this.cleanOrphanFiles();
      deletedOrphanFiles = orphanRes.deletedCount;
    }

    // 6. 压缩与回收 SQLite 空间
    if (options.vacuum || (options.cleanLogsDays !== undefined && deletedLogs > 0)) {
      this.vacuum();
      vacuumExecuted = true;
    }

    const finalStats = this.getStorageStats();
    const initialTotal = initialStats.database.totalSizeBytes + initialStats.disk.artifactsBytes + initialStats.disk.attachmentsBytes + initialStats.disk.qaTraceBytes;
    const finalTotal = finalStats.database.totalSizeBytes + finalStats.disk.artifactsBytes + finalStats.disk.attachmentsBytes + finalStats.disk.qaTraceBytes;
    const freedBytes = Math.max(0, initialTotal - finalTotal);

    storeLogger.info(`[Storage:Clean] 存储垃圾清理完成 (${Date.now() - startTime}ms): 释放 ${(freedBytes / 1024 / 1024).toFixed(2)} MB, 删除日志 ${deletedLogs} 条, 测试运行 ${deletedQaRuns} 个, 自动化日志 ${deletedAutomationLogs} 条, 孤儿文件 ${deletedOrphanFiles} 个, 调试产物 ${deletedQaTrace} 个`);

    return {
      freedBytes,
      deletedLogs,
      deletedQaRuns,
      deletedAutomationLogs,
      deletedOrphanFiles,
      vacuumExecuted,
      durationMs: Date.now() - startTime,
    };
  }

  public close() {
    this.db.close();
  }
}
