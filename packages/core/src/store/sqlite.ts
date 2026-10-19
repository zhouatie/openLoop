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
  QaSuite,
  QaRunRecord,
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
        tags_json TEXT,
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

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_kanban ON tasks(kanban_column);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_node_runs_task ON task_node_runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_logs_task_time ON logs(task_id, timestamp ASC);
      CREATE INDEX IF NOT EXISTS idx_logs_node ON logs(task_id, node_id);
      CREATE INDEX IF NOT EXISTS idx_qa_runs_suite ON qa_runs(suite_id, created_at DESC);
    `);

    // 增量表结构平滑迁移：为历史已有数据库的 workflows 表补齐 tags_json 字段
    try {
      this.db.exec('ALTER TABLE workflows ADD COLUMN tags_json TEXT');
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

    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_workflow_created ON tasks(workflow_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_trigger_source ON tasks(trigger_source);
      `);
    } catch {
      // 忽略
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
      // 检查并增量补齐内置通用研发流水线
      const hasDevWf = this.db.prepare('SELECT id FROM workflows WHERE id = ? OR name LIKE ?').get('wf_agent_feature_dev', '%通用研发%');
      if (!hasDevWf) {
        this.saveWorkflow(this.getGeneralDevWorkflowDefinition());
      }
      // 检查并增量补齐内置 FEBase 应用构建部署流水线
      const hasFebaseDeployWf = this.db.prepare('SELECT id FROM workflows WHERE id = ?').get('wf_febase_app_deploy');
      if (!hasFebaseDeployWf) {
        this.saveWorkflow(this.getFebaseDeployWorkflowDefinition());
      }
      // 检查并增量补齐内置 Worktree 隔离开发与视觉 QA 自动验收流水线
      const hasWorktreeWf = this.db.prepare('SELECT id FROM workflows WHERE id = ?').get('wf_worktree_auto_dev_qa_merge');
      if (!hasWorktreeWf) {
        this.saveWorkflow(this.getWorktreeDevQaMergeWorkflowDefinition());
      }
    }

    // 平滑补齐或迁移标签数据 (除了 FEBase 流水线保留「工作」tag 之外，其他流水线去掉「工作」tag)
    try {
      const defaultTagMap: Record<string, string[]> = {
        wf_agent_feature_dev: ['研发', 'AI Agent'],
        wf_febase_app_deploy: ['工作', '部署', 'FEBase'],
        wf_worktree_auto_dev_qa_merge: ['研发', '沙箱', 'QA'],
        wf_app_build_deploy: ['部署', '构建', 'CI/CD'],
        wf_auto_dev_qa: ['研发', '测试', 'AI Agent'],
      };
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
        if (!hasTagsSource && defaultTagMap[row.id]) {
          tags = defaultTagMap[row.id];
          hasTagsSource = true;
        }

        // 业务规则：除了 FEBase 流水线需要工作 tag 之外，其他的流水线去掉工作 tag
        const isFebase =
          row.id === 'wf_febase_app_deploy' ||
          (typeof row.name === 'string' && row.name.toLowerCase().includes('febase'));

        if (isFebase) {
          if (!tags.includes('工作')) {
            tags = ['工作', ...tags];
          }
        } else {
          if (tags.includes('工作')) {
            tags = tags.filter((t) => t !== '工作');
          }
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

  private getFebaseDeployWorkflowDefinition(): WorkflowDefinition {
    return {
      id: 'wf_febase_app_deploy',
      name: 'FEBase 应用智能编排与部署流水线',
      description: 'AI Agent 驱动的极简部署编排流水线：Agent 智能校验 Prompt 充足性并锁定发布单（信息不足自动终止） -> 原生 mws CLI 分配环境 -> 原生 mws CLI 触发云端打包',
      tags: ['工作', '部署', 'FEBase'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: [
        {
          id: 'node_agent_parse',
          name: 'AI 智能校验需求与锁定单据',
          type: 'agent',
          position: { x: 100, y: 150 },
          config: {
            agentName: 'Pi Agent',
            prompt: `请分析本次部署任务的需求内容：
任务名称: {{task.title}}
任务描述: {{task.description}}

【关键前置规则：信息充足性校验与任务终止机制】
在执行任何部署操作前，必须首先检查需求是否提供了全部必要信息：
1. 必需要素核查：
   - 目标应用名 (appName)：如 rn-lyric-share-page
   - 代码分支 (branch)：如 feat/OMMUSIC-3825654
   - 目标环境类型与域名/数字编号 (envType & domain)：如 PRETEST 或 TEST，以及 211 或 qa-test211.pretest.igame.163.com
2. 若上述信息存在缺失或语义不明确（例如未提供分支或未指定环境）：
   - 严禁自行猜测或随意默认参数！
   - 执行清理指令：rm -f /tmp/openloop-febase-env.sh
   - 将具体终止原因写入中止文件：echo "【部署中止】Prompt 提供的信息不充足！缺失要素: <具体列出缺失项>。请补充后重新发起。" > /tmp/openloop_abort_{{task.id}}
   - 在日志中清晰打印错误原因，立即结束执行。
3. 若信息完整充足：
   - 确保清理旧中止文件：rm -f /tmp/openloop_abort_{{task.id}}
   - 调用 mws 命令检索应用 (mws febase app-search --env online --json '{"keyword":"<appName>"}') 获取 appId。
   - 调用 mws 命令获取该分支对应的活跃发布单 (mws febase sprint-list --env online --json '{"appId":<appId>,"engineStatus":"running"}') 获取 sprintId（如无活跃发布单则通过 sprint-create 创建）。
   - 将解析出的结构化参数写入临时环境变量文件 /tmp/openloop-febase-env.sh：
     export FEBASE_APP_ID="<appId>"
     export FEBASE_SPRINT_ID="<sprintId>"
     export FEBASE_ENV_TYPE="<envType>"
     export FEBASE_ENV_NAME="<envName>"
   - 打印解析确认摘要供下游 CLI 节点流转。`,
          },
        },
        {
          id: 'node_cli_env',
          name: 'CLI 环境绑定与域名就绪',
          type: 'cli',
          position: { x: 480, y: 150 },
          config: {
            command: 'if [ ! -f /tmp/openloop-febase-env.sh ]; then echo "[ERROR] 前置参数校验未通过，缺少部署环境变量文件，任务终止！" >&2; exit 1; fi && source /tmp/openloop-febase-env.sh && if [ -z "$FEBASE_APP_ID" ] || [ -z "$FEBASE_SPRINT_ID" ] || [ -z "$FEBASE_ENV_NAME" ]; then echo "[ERROR] 部署参数不完整，任务终止！" >&2; exit 1; fi && echo "[FEBase] 正在为发布单 Sprint $FEBASE_SPRINT_ID 绑定环境 $FEBASE_ENV_NAME ($FEBASE_ENV_TYPE)..." && mws febase sprint-env-create --env online --json "{\\"appId\\":$FEBASE_APP_ID,\\"sprintId\\":$FEBASE_SPRINT_ID,\\"envType\\":\\"$FEBASE_ENV_TYPE\\",\\"envName\\":\\"$FEBASE_ENV_NAME\\"}" || true',
            timeoutSec: 60,
          },
        },
        {
          id: 'node_cli_deploy',
          name: 'CLI 触发云端打包部署',
          type: 'cli',
          position: { x: 860, y: 150 },
          config: {
            command:
              'if [ ! -f /tmp/openloop-febase-env.sh ]; then echo "[ERROR] 缺少部署环境变量文件，任务终止！" >&2; exit 1; fi && source /tmp/openloop-febase-env.sh && echo "[FEBase] 正在触发云端 Tekton 打包构建 (App: $FEBASE_APP_ID, Sprint: $FEBASE_SPRINT_ID, Env: $FEBASE_ENV_NAME)..." && (' +
              'DEPLOY_OUTPUT=$(mws febase sprint-deploy --env online --json "{\\"appId\\":$FEBASE_APP_ID,\\"sprintId\\":$FEBASE_SPRINT_ID,\\"env\\":\\"$FEBASE_ENV_TYPE\\",\\"envName\\":\\"$FEBASE_ENV_NAME\\"}" 2>&1); ' +
              'DEPLOY_STATUS=$?; ' +
              'echo "$DEPLOY_OUTPUT"; ' +
              'if [ $DEPLOY_STATUS -eq 0 ]; then echo "[FEBase] 部署指令触发成功！" && exit 0; fi; ' +
              'echo "[FEBase] 部署网关返回异常或网络抖动，正在复核云端实际就绪状态..."; ' +
              'sleep 2; ' +
              'STATUS_CHECK=$(mws febase deploy-envs-status --env online --json "{\\"appId\\":$FEBASE_APP_ID,\\"sprintId\\":$FEBASE_SPRINT_ID,\\"env\\":\\"$FEBASE_ENV_TYPE\\"}" 2>&1); ' +
              'if echo "$STATUS_CHECK" | grep -q "$FEBASE_ENV_NAME"; then ' +
              'echo "[FEBase] 复核通过：已在云端检测到目标域名 $FEBASE_ENV_NAME 的流水线任务，任务判定为成功！"; ' +
              'echo "$STATUS_CHECK" | grep "$FEBASE_ENV_NAME"; ' +
              'exit 0; ' +
              'fi; ' +
              'echo "[FEBase] 二次复核未就绪，重试一次部署触发..."; ' +
              'mws febase sprint-deploy --env online --json "{\\"appId\\":$FEBASE_APP_ID,\\"sprintId\\":$FEBASE_SPRINT_ID,\\"env\\":\\"$FEBASE_ENV_TYPE\\",\\"envName\\":\\"$FEBASE_ENV_NAME\\"}"; ' +
              ')',
            timeoutSec: 120,
          },
        },
      ],
      edges: [
        { id: 'e_parse_to_env', source: 'node_agent_parse', target: 'node_cli_env' },
        { id: 'e_env_to_deploy', source: 'node_cli_env', target: 'node_cli_deploy' },
      ],
    };
  }

  private getAppDeployWorkflowDefinition(): WorkflowDefinition {
    return {
      id: 'wf_app_build_deploy',
      name: '全自动化应用构建与部署流水线',
      description: '通用应用部署流水线：环境自检 -> 生产全量构建 -> 应用部署发布 -> 线上健康探针 -> 发布上线验收门禁',
      tags: ['部署', '构建', 'CI/CD'],
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

  private getWorktreeDevQaMergeWorkflowDefinition(): WorkflowDefinition {
    return {
      id: 'wf_worktree_auto_dev_qa_merge',
      name: 'Worktree 隔离开发与视觉 QA 自动验收流水线',
      description: '端到端全闭环研发流水线：根据需求创建 Git Worktree 与独立端口靶机，Agent 隔离编写代码，Playwright 真实浏览器 UI 自动化截帧，查看连贯截图回放验收通过后自动合并到开发分支并清理沙箱',
      tags: ['研发', '沙箱', 'QA'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: [
        {
          id: 'node_wt_setup',
          name: '1. Worktree 隔离沙箱就绪',
          type: 'worktree-setup',
          position: { x: 100, y: 150 },
          config: {
            allocatePorts: ['webPort'],
            basePort: 5175,
            sharedPaths: ['node_modules', 'packages/*/node_modules'],
            timeoutSec: 120,
          },
        },
        {
          id: 'node_agent_coder',
          name: '2. AI 开发者隔离编码实现',
          type: 'agent',
          position: { x: 380, y: 150 },
          config: {
            agentName: 'Pi Coding Agent',
            prompt: '请在当前 Worktree 隔离工作区中完成任务代码修改与验证：\n任务需求：{{task.title}}\n详细说明：{{task.description}}\n执行规范：保持代码极简整洁，修改完毕后确保基础编译通过。',
            timeoutSec: 600,
          },
        },
        {
          id: 'node_qa_plan',
          name: '3. QA 黑盒验收用例设计',
          type: 'qa-planner',
          position: { x: 660, y: 150 },
          config: {
            timeoutSec: 60,
          },
        },
        {
          id: 'node_env_prep',
          name: '4. 测试现场准备与服务就绪',
          type: 'env-prepare',
          position: { x: 940, y: 150 },
          config: {
            command: 'pnpm --filter @openloop/desktop dev --port {{ports.webPort}} --strictPort --host 0.0.0.0',
            healthUrl: 'http://127.0.0.1:{{ports.webPort}}',
            targetPlatform: 'web',
            warmupTimeoutMs: 30000,
            background: true,
            timeoutSec: 120,
          },
        },
        {
          id: 'node_qa_test',
          name: '5. 自动化测试执行与视觉截帧',
          type: 'midscene',
          position: { x: 1220, y: 150 },
          config: {
            platform: 'web',
            instructions: [
              '等待页面完全加载，检查首屏主视觉元素',
              '定位核心交互按钮并触发点击',
              '校验页面无报错与异常提示',
            ],
            timeoutSec: 180,
          },
        },
        {
          id: 'node_qa_gate',
          name: '6. 视觉操作回放与验收门禁',
          type: 'qa-approval',
          position: { x: 1500, y: 150 },
          config: {
            approvalPrompt: '请查看 UI 自动化截帧序列回放与变更统计，确认效果无误后点击【验收通过并合并】',
            checklist: [
              'AI 真实浏览器操作流程完整且无报错',
              '截帧回放中界面交互符合预期',
              '变更代码 Diff 准确且无冗余文件',
            ],
          },
        },
        {
          id: 'node_wt_merge',
          name: '7. 自动合并代码分支',
          type: 'worktree-merge',
          position: { x: 1780, y: 150 },
          config: {
            timeoutSec: 60,
          },
        },
        {
          id: 'node_wt_cleanup',
          name: '8. 环境释放与沙箱清理',
          type: 'worktree-cleanup',
          position: { x: 2060, y: 150 },
          config: {
            timeoutSec: 60,
          },
        },
      ],
      edges: [
        { id: 'e_wt_to_agent', source: 'node_wt_setup', target: 'node_agent_coder' },
        { id: 'e_agent_to_qaplan', source: 'node_agent_coder', target: 'node_qa_plan' },
        { id: 'e_qaplan_to_prep', source: 'node_qa_plan', target: 'node_env_prep' },
        { id: 'e_prep_to_qa', source: 'node_env_prep', target: 'node_qa_test' },
        { id: 'e_qa_to_gate', source: 'node_qa_test', target: 'node_qa_gate' },
        { id: 'e_gate_to_merge', source: 'node_qa_gate', target: 'node_wt_merge' },
        { id: 'e_merge_to_cleanup', source: 'node_wt_merge', target: 'node_wt_cleanup' },
      ],
    };
  }

  private getGeneralDevWorkflowDefinition(): WorkflowDefinition {
    return {
      id: 'wf_agent_feature_dev',
      name: '通用研发流水线',
      description: '通用智能体敏捷开发流程：AI 智能体根据需求修改代码，执行前端构建自检，经由 QA 人工验收门禁确认',
      tags: ['研发', 'AI Agent'],
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
      ],
    };
  }

  private seedInitialData() {
    // 预置默认流程：Agent 研发 -> Midscene 测试 -> 截图拼图 -> QA 验收
    const defaultWorkflow: WorkflowDefinition = {
      id: 'wf_auto_dev_qa',
      name: 'Agent开发与Midscene自动化测试验证流水线',
      description: '触发 Agent 进行功能开发，完成后调用 Midscene 自动 UI 测试并截屏，拼接动图后流转到 QA 审核',
      tags: ['研发', '测试', 'AI Agent'],
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

    // 预置通用研发流水线
    this.saveWorkflow(this.getGeneralDevWorkflowDefinition());
    this.saveWorkflow(this.getAppDeployWorkflowDefinition());
    this.saveWorkflow(this.getFebaseDeployWorkflowDefinition());
    this.saveWorkflow(this.getWorktreeDevQaMergeWorkflowDefinition());

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
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        nodes: JSON.parse(r.nodes_json),
        edges: JSON.parse(r.edges_json),
        tags,
        variables,
        requireWorkspace: variables?.requireWorkspace,
        defaultWorkspace: variables?.defaultWorkspace,
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
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      nodes: JSON.parse(row.nodes_json),
      edges: JSON.parse(row.edges_json),
      tags,
      variables,
      requireWorkspace: variables?.requireWorkspace,
      defaultWorkspace: variables?.defaultWorkspace,
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

    const variablesObj = {
      ...(wf.variables || {}),
      ...(wf.requireWorkspace !== undefined ? { requireWorkspace: wf.requireWorkspace } : {}),
      ...(wf.defaultWorkspace !== undefined ? { defaultWorkspace: wf.defaultWorkspace } : {}),
      tags: tagsList,
    };
    const hasVariables = Object.keys(variablesObj).length > 0;

    const stmt = this.db.prepare(`
      INSERT INTO workflows (id, name, description, nodes_json, edges_json, variables_json, tags_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        nodes_json = excluded.nodes_json,
        edges_json = excluded.edges_json,
        variables_json = excluded.variables_json,
        tags_json = excluded.tags_json,
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

    return taskRows.map((tr) => {
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
        createdAt: tr.created_at,
        updatedAt: tr.updated_at,
        nodeRuns: runsByTask.get(tr.id) || {},
      };
    });
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
      createdAt: tr.created_at,
      updatedAt: tr.updated_at,
      nodeRuns,
    };
  }

  public saveTask(task: Task): Task {
    task.updatedAt = Date.now();
    if (!task.createdAt) task.createdAt = task.updatedAt;

    const upsertTask = this.db.prepare(`
      INSERT INTO tasks (id, title, description, workflow_id, status, kanban_column, current_node_id, context_json, workspace, attachments_json, trigger_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    const tx = this.db.transaction((id: string) => {
      this.db.prepare('DELETE FROM logs WHERE task_id = ?').run(id);
      this.db.prepare('DELETE FROM qa_runs WHERE task_id = ?').run(id);
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

  // ================= QA Automation Suites API =================

  public getQaSuites(): QaSuite[] {
    const rows = this.db.prepare('SELECT * FROM qa_suites ORDER BY updated_at DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || undefined,
      targetUrl: r.target_url,
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
      targetUrl: r.target_url,
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
      updatedAt: now,
      createdAt: suite.createdAt || now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO qa_suites (
        id, name, description, target_url, viewport_json, steps_json,
        tags_json, created_at, updated_at, last_run_status, last_run_duration_ms, last_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        target_url = excluded.target_url,
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
      suiteToSave.targetUrl,
      suiteToSave.viewport ? JSON.stringify(suiteToSave.viewport) : null,
      JSON.stringify(suiteToSave.steps || []),
      suiteToSave.tags ? JSON.stringify(suiteToSave.tags) : null,
      suiteToSave.createdAt,
      suiteToSave.updatedAt,
      suiteToSave.lastRunStatus || 'untested',
      suiteToSave.lastRunDurationMs || null,
      suiteToSave.lastRunAt || null
    );

    return suiteToSave;
  }

  public deleteQaSuite(id: string): boolean {
    const res = this.db.prepare('DELETE FROM qa_suites WHERE id = ?').run(id);
    return res.changes > 0;
  }

  // ================= QA Execution Runs API =================

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
        id, suite_id, suite_name, task_id, status, total_steps, passed_steps,
        duration_ms, timeline_json, report_rel_path, created_at, finished_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
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

  public close() {
    this.db.close();
  }
}
