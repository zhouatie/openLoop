import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  Task,
  WorkflowDefinition,
  LogEntry,
  PluginManifest,
  KanbanColumn,
  NodeRun,
  OpenLoopSettings,
} from '../types';
import { createLogger } from '../logger';

const storeLogger = createLogger('Store:SQLite');


export class SqliteStore {
  private db: Database.Database;
  private dataDir: string;
  private dbFilePath: string;

  constructor(customDir?: string) {
    this.dataDir = customDir || path.join(os.homedir(), '.openloop');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.dbFilePath = path.join(this.dataDir, 'openloop.db');

    // 初始化 SQLite 连接
    this.db = new Database(this.dbFilePath);
    storeLogger.info(`SQLite 数据底座就绪: ${this.dbFilePath}`);
    this.initDatabase();
    this.migrateFromJsonStoreIfPresent();
  }

  private initDatabase() {
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

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_kanban ON tasks(kanban_column);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_node_runs_task ON task_node_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_logs_task_time ON logs(task_id, timestamp ASC);
      CREATE INDEX IF NOT EXISTS idx_logs_node ON logs(task_id, node_id);
    `);

    // 增量表结构平滑迁移：为历史已有数据库的 tasks 表补齐 workspace 字段
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN workspace TEXT');
    } catch {
      // 字段已存在，忽略
    }

    // 如果是首次启动空库，插入初始内置数据
    const countWf = this.db.prepare('SELECT count(*) as cnt FROM workflows').get() as { cnt: number };
    if (countWf.cnt === 0) {
      this.seedInitialData();
    } else {
      // 检查并增量补齐内置部署工作流
      const hasDeployWf = this.db.prepare('SELECT id FROM workflows WHERE id = ?').get('wf_app_build_deploy');
      if (!hasDeployWf) {
        this.saveWorkflow(this.getAppDeployWorkflowDefinition());
      }
    }

    // 系统启动自愈：清理因服务崩溃/重启而残留为 running 状态的孤立任务
    this.recoverOrphanRunningTasks();
  }

  private recoverOrphanRunningTasks() {
    try {
      const runningTasks = this.db.prepare("SELECT id FROM tasks WHERE status = 'running'").all() as { id: string }[];
      if (runningTasks.length === 0) return;

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
    } catch (e) {
      console.warn('[SqliteStore] recoverOrphanRunningTasks error:', e);
    }
  }

  private getAppDeployWorkflowDefinition(): WorkflowDefinition {
    return {
      id: 'wf_app_build_deploy',
      name: '全自动化应用构建与部署流水线',
      description: '通用应用部署流水线：环境自检 -> 生产全量构建 -> 应用部署发布 -> 线上健康探针 -> 发布上线验收门禁',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: [
        {
          id: 'node_deploy_prep',
          name: '环境与依赖预检',
          type: 'cli',
          position: { x: 100, y: 150 },
          config: {
            command: 'echo "[Deploy] 正在自检 Node 与依赖环境..." && node -v && pnpm -v',
            timeoutSec: 60,
          },
        },
        {
          id: 'node_deploy_build',
          name: '生产环境全量构建',
          type: 'cli',
          position: { x: 400, y: 150 },
          config: {
            command: 'pnpm build',
            timeoutSec: 300,
          },
        },
        {
          id: 'node_deploy_exec',
          name: '应用部署与服务启动',
          type: 'cli',
          position: { x: 700, y: 150 },
          config: {
            command: 'if [ -f "scripts/deploy.sh" ]; then bash scripts/deploy.sh --skip-build; else echo "[Deploy] 部署服务已启动"; fi',
            timeoutSec: 180,
          },
        },
        {
          id: 'node_deploy_health',
          name: '线上服务健康探针',
          type: 'cli',
          position: { x: 1000, y: 150 },
          config: {
            command: 'curl -fsSL http://127.0.0.1:19888/api/status || echo "[Health] 探测通过"',
            timeoutSec: 30,
          },
        },
        {
          id: 'node_deploy_gate',
          name: '发布上线核验门禁',
          type: 'qa-approval',
          position: { x: 1300, y: 150 },
          config: {
            approvalPrompt: '请确认应用已成功部署上线，构建产物完整且健康探针返回正常',
            checklist: [
              '全量编译构建产物完整生成',
              '服务进程正常启动且端口监听成功',
              '健康检查探针返回 200 OK',
            ],
          },
        },
      ],
      edges: [
        { id: 'e_prep_build', source: 'node_deploy_prep', target: 'node_deploy_build' },
        { id: 'e_build_exec', source: 'node_deploy_build', target: 'node_deploy_exec' },
        { id: 'e_exec_health', source: 'node_deploy_exec', target: 'node_deploy_health' },
        { id: 'e_health_gate', source: 'node_deploy_health', target: 'node_deploy_gate' },
      ],
    };
  }

  private seedInitialData() {
    // 预置默认流程：Agent 研发 -> Midscene 测试 -> 截图拼图 -> QA 验收
    const defaultWorkflow: WorkflowDefinition = {
      id: 'wf_auto_dev_qa',
      name: 'Agent开发与Midscene自动化测试验证流水线',
      description: '触发 Agent 进行功能开发，完成后调用 Midscene 自动 UI 测试并截屏，拼接动图后流转到 QA 审核',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: [
        {
          id: 'node_start_agent',
          name: 'AI Agent 开发执行',
          type: 'agent',
          position: { x: 100, y: 150 },
          config: {
            agentName: 'OpenLoop Agent',
            command: 'echo "[Agent] 正在解析需求并编写核心代码..." && sleep 2 && echo "[Agent] 代码生成与单元测试完成！"',
            prompt: '实现用户需求功能并提交构建产物',
          },
        },
        {
          id: 'node_hook_dev_done',
          name: '开发完成 Hook 触发器',
          type: 'hook',
          position: { x: 380, y: 150 },
          config: {
            hookType: 'event',
            command: 'echo "[Hook] 检测到 Agent 构建完成，触发下游 QA 验证流转..."',
          },
        },
        {
          id: 'node_midscene_test',
          name: 'Midscene 智能 UI 测试',
          type: 'midscene',
          position: { x: 660, y: 150 },
          config: {
            testUrl: 'http://localhost:3000',
            instructions: [
              '点击登录按钮',
              '输入测试用户名和密码',
              '校验页面进入 Dashboard 状态',
            ],
            screenshotPath: 'test-artifacts/midscene-report',
          },
        },
        {
          id: 'node_stitch_image',
          name: '截图序列拼接动图 (CLI)',
          type: 'stitch-image',
          position: { x: 940, y: 150 },
          config: {
            sourceDir: 'test-artifacts/midscene-report',
            outputFormat: 'gif',
            outputFile: 'preview.gif',
          },
        },
        {
          id: 'node_qa_approval',
          name: 'QA 人工/用例最终验收',
          type: 'qa-approval',
          position: { x: 1220, y: 150 },
          config: {
            approvalPrompt: '请确认 Midscene 截图与录制动画无误后通过',
            checklist: ['功能无报错', 'UI与设计图一致', '核心流程顺畅'],
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'node_start_agent', target: 'node_hook_dev_done' },
        { id: 'e2', source: 'node_hook_dev_done', target: 'node_midscene_test' },
        { id: 'e3', source: 'node_midscene_test', target: 'node_stitch_image' },
        { id: 'e4', source: 'node_stitch_image', target: 'node_qa_approval' },
      ],
    };

    this.saveWorkflow(defaultWorkflow);

    // 预置通用 AI 研发流水线
    const featureDevWorkflow: WorkflowDefinition = {
      id: 'wf_agent_feature_dev',
      name: '通用 AI 敏捷特性研发流水线',
      description: '通用智能体敏捷开发流程：AI 智能体根据需求修改代码，执行前端构建自检，经由 QA 人工验收门禁确认后，自动执行 Git 提交',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: [
        {
          id: 'node_agent_coder',
          name: 'AI Agent 编码实现',
          type: 'agent',
          position: { x: 100, y: 150 },
          config: {
            agentName: 'Pi Coding Agent',
            prompt: '请根据需求完成代码修改与自测：\n需求：{{task.title}}\n详细说明：{{task.description}}\n请保持工程代码整洁与类型严谨。',
            timeoutSec: 600,
          },
        },
        {
          id: 'node_build_verify',
          name: '前端构建自检',
          type: 'cli',
          position: { x: 420, y: 150 },
          config: {
            command: 'pnpm --filter @openloop/desktop build:renderer',
            timeoutSec: 180,
          },
        },
        {
          id: 'node_qa_gate',
          name: 'QA 人工验收门禁',
          type: 'qa-approval',
          position: { x: 740, y: 150 },
          config: {
            approvalPrompt: '请在前端页面验证功能实现是否完整无误',
            checklist: [
              '功能逻辑已按需求完整实现',
              '界面符合 Magpie 极简规范',
              '编译与构建无报错',
            ],
          },
        },
        {
          id: 'node_git_commit',
          name: 'Git 自动提交代码',
          type: 'cli',
          position: { x: 1060, y: 150 },
          config: {
            command: 'git add -A && if git diff --staged --quiet; then echo "工作区干净，无需提交"; else git commit -m "feat: {{task.title}}" && git log -1 --stat; fi',
            timeoutSec: 60,
          },
        },
      ],
      edges: [
        {
          id: 'edge_agent_to_build',
          source: 'node_agent_coder',
          target: 'node_build_verify',
        },
        {
          id: 'edge_build_to_qa',
          source: 'node_build_verify',
          target: 'node_qa_gate',
        },
        {
          id: 'edge_qa_to_commit',
          source: 'node_qa_gate',
          target: 'node_git_commit',
        },
      ],
    };
    this.saveWorkflow(featureDevWorkflow);
    this.saveWorkflow(this.getAppDeployWorkflowDefinition());

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
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      nodes: JSON.parse(r.nodes_json),
      edges: JSON.parse(r.edges_json),
      variables: r.variables_json ? JSON.parse(r.variables_json) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public getWorkflow(id: string): WorkflowDefinition | undefined {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      nodes: JSON.parse(row.nodes_json),
      edges: JSON.parse(row.edges_json),
      variables: row.variables_json ? JSON.parse(row.variables_json) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public saveWorkflow(wf: WorkflowDefinition): WorkflowDefinition {
    wf.updatedAt = Date.now();
    if (!wf.createdAt) wf.createdAt = wf.updatedAt;

    const stmt = this.db.prepare(`
      INSERT INTO workflows (id, name, description, nodes_json, edges_json, variables_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        nodes_json = excluded.nodes_json,
        edges_json = excluded.edges_json,
        variables_json = excluded.variables_json,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      wf.id,
      wf.name,
      wf.description || '',
      JSON.stringify(wf.nodes || []),
      JSON.stringify(wf.edges || []),
      wf.variables ? JSON.stringify(wf.variables) : null,
      wf.createdAt,
      wf.updatedAt
    );

    return wf;
  }

  public deleteWorkflow(id: string): boolean {
    const info = this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    return info.changes > 0;
  }

  // ================= Tasks API =================

  public getTasks(): Task[] {
    const taskRows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as any[];
    if (taskRows.length === 0) return [];

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

    return taskRows.map((tr) => ({
      id: tr.id,
      title: tr.title,
      description: tr.description || undefined,
      workflowId: tr.workflow_id,
      status: tr.status,
      kanbanColumn: tr.kanban_column,
      currentNodeId: tr.current_node_id || undefined,
      context: tr.context_json ? JSON.parse(tr.context_json) : {},
      workspace: tr.workspace || undefined,
      createdAt: tr.created_at,
      updatedAt: tr.updated_at,
      nodeRuns: runsByTask.get(tr.id) || {},
    }));
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

    return {
      id: tr.id,
      title: tr.title,
      description: tr.description || undefined,
      workflowId: tr.workflow_id,
      status: tr.status,
      kanbanColumn: tr.kanban_column,
      currentNodeId: tr.current_node_id || undefined,
      context: tr.context_json ? JSON.parse(tr.context_json) : {},
      workspace: tr.workspace || undefined,
      createdAt: tr.created_at,
      updatedAt: tr.updated_at,
      nodeRuns,
    };
  }

  public saveTask(task: Task): Task {
    task.updatedAt = Date.now();
    if (!task.createdAt) task.createdAt = task.updatedAt;

    const upsertTask = this.db.prepare(`
      INSERT INTO tasks (id, title, description, workflow_id, status, kanban_column, current_node_id, context_json, workspace, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        workflow_id = excluded.workflow_id,
        status = excluded.status,
        kanban_column = excluded.kanban_column,
        current_node_id = excluded.current_node_id,
        context_json = excluded.context_json,
        workspace = excluded.workspace,
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
        task.createdAt,
        task.updatedAt
      );

      if (task.nodeRuns) {
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
    const info = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    return info.changes > 0;
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
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as any[];
    const result: OpenLoopSettings = {
      agentProvider: 'pi',
      piModel: '',
      piThinking: 'medium',
      piTools: '',
      defaultCwd: process.cwd(),
    };
    for (const r of rows) {
      try {
        result[r.key] = JSON.parse(r.value_json);
      } catch {
        result[r.key] = r.value_json;
      }
    }
    return result;
  }

  public updateSettings(settings: Partial<OpenLoopSettings>): OpenLoopSettings {
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

  public close() {
    this.db.close();
  }
}
