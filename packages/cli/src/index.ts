#!/usr/bin/env node
import { Command } from 'commander';
import { OpenLoopClient } from './client';
import { OpenLoopServer, Store, DagEngine, Task, WorkflowDefinition, LogEntry, PluginManifest, NodeRun, KanbanColumn } from '@openloop/core';

const program = new Command();
const client = new OpenLoopClient();

program
  .name('openloop')
  .description('openLoop 桌面自动化编排平台 CLI 工具')
  .version('0.1.0');

// Daemon 守护进程管理
const daemonCmd = program.command('daemon').description('管理 openLoop 后台调度守护进程');

daemonCmd
  .command('start')
  .description('启动 openLoop Core 调度服务')
  .option('-p, --port <number>', '监听端口', '19888')
  .option('-h, --host <string>', '监听地址', '127.0.0.1')
  .action(async (options) => {
    console.log(`\x1b[36m[openLoop]\x1b[0m 正在启动核心服务...`);
    const server = new OpenLoopServer({
      port: parseInt(options.port, 10),
      host: options.host,
    });
    try {
      await server.start();
      console.log(`\x1b[32m✔\x1b[0m 核心调度服务已成功启动: http://${options.host}:${options.port}`);
      console.log(`按 Ctrl+C 可停止守护服务。`);

      process.on('SIGINT', async () => {
        console.log(`\n正在停止服务...`);
        await server.stop();
        process.exit(0);
      });
    } catch (err: any) {
      console.error(`\x1b[31m✖\x1b[0m 启动失败: ${err.message}`);
      process.exit(1);
    }
  });

daemonCmd
  .command('status')
  .description('检查守护进程运行状态')
  .action(async () => {
    try {
      const res = await client.checkStatus();
      console.log(`\x1b[32m✔\x1b[0m openLoop Core 守护进程正常运行中 (运行时间: ${Math.round(res.uptime)}s, 版本: v${res.version})`);
    } catch (err: any) {
      console.log(`\x1b[33m!\x1b[0m 守护进程未启动: ${err.message}`);
      console.log(`提示: 执行 'openloop daemon start' 可拉起后台服务。`);
    }
  });

// 工作流管理
const wfCmd = program.command('workflow').description('工作流编排定义管理');

wfCmd
  .command('list')
  .description('列出所有可用工作流模版')
  .action(async () => {
    try {
      let workflows: WorkflowDefinition[] = [];
      try {
        workflows = await client.listWorkflows();
      } catch {
        // 本地降级读取 store
        const store = new Store();
        workflows = store.getWorkflows();
      }

      console.log(`\n\x1b[1m可用工作流列表 (${workflows.length} 个):\x1b[0m`);
      console.log('----------------------------------------------------------------------');
      for (const wf of workflows) {
        console.log(`\x1b[36mID:\x1b[0m          ${wf.id}`);
        console.log(`\x1b[36m名称:\x1b[0m        ${wf.name}`);
        console.log(`\x1b[36m描述:\x1b[0m        ${wf.description}`);
        console.log(`\x1b[36m包含节点:\x1b[0m    ${wf.nodes.map((n) => `${n.name}(${n.type})`).join(' -> ')}`);
        console.log('----------------------------------------------------------------------');
      }
    } catch (err: any) {
      console.error(`获取工作流失败: ${err.message}`);
    }
  });

// 任务管理
const taskCmd = program.command('task').description('任务自动化创建与流转控制');

taskCmd
  .command('create')
  .description('创建并触发自动化流转任务')
  .requiredOption('-w, --workflow <id>', '关联工作流 ID')
  .option('-t, --title <title>', '任务标题', '自动化开发验证任务')
  .option('-d, --desc <desc>', '任务描述', '')
  .option('-c, --column <column>', '看板初始泳道 (如: inbox, backlog)', 'backlog')
  .option('-f, --follow', '立即实时跟随输出日志', false)
  .option('--no-run', '仅创建任务记录，不立即启动自动化调度')
  .action(async (options) => {
    try {
      let task: Task | undefined;
      let isLocalFallback = false;
      const targetColumn = (options.column === 'inbox' ? 'inbox' : 'backlog') as KanbanColumn;
      const shouldAutoRun = options.run !== false && targetColumn !== 'inbox';

      try {
        task = await client.createTask({
          workflowId: options.workflow,
          title: options.title,
          description: options.desc,
          kanbanColumn: targetColumn,
          autoRun: shouldAutoRun,
        });
      } catch (err: any) {
        // 如果 Daemon 没启动，直接使用本地 Store 和 DagEngine 单机运行
        console.log(`\x1b[33m[提示]\x1b[0m 守护进程未启动，自动以本地内嵌模式运行任务...`);
        const store = new Store();
        const engine = new DagEngine(store);
        isLocalFallback = true;

        const localTask = store.saveTask({
          id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          title: options.title,
          description: options.desc,
          workflowId: options.workflow,
          status: 'pending',
          kanbanColumn: targetColumn,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          nodeRuns: {},
          context: {},
        });
        task = localTask;

        if (options.follow) {
          engine.on('log:new', (entry) => {
            if (entry.taskId === localTask.id) {
              const prefix = entry.stream === 'stderr' ? '\x1b[31m[ERR]\x1b[0m' : '\x1b[32m[LOG]\x1b[0m';
              console.log(`${prefix} [${entry.nodeId}] ${entry.message}`);
            }
          });
        }

        // 若允许自动执行则启动任务
        if (shouldAutoRun) {
          engine.runTask(localTask.id).catch((e) => console.error(e));
        }
      }

      if (!task) {
        throw new Error('未能成功创建任务');
      }

      console.log(`\x1b[32m✔ 任务已创建并启动自动化流转!\x1b[0m`);
      console.log(`  \x1b[1m任务 ID:\x1b[0m     ${task.id}`);
      console.log(`  \x1b[1m标题:\x1b[0m        ${task.title}`);
      console.log(`  \x1b[1m工作流:\x1b[0m      ${task.workflowId}`);
      console.log(`  \x1b[1m当前状态:\x1b[0m    ${task.status}`);
      console.log(`  \x1b[1m看板泳道:\x1b[0m    ${task.kanbanColumn}\n`);

      if (options.follow && !isLocalFallback) {
        console.log(`\x1b[36m--- 开始实时监听任务日志 (按 Ctrl+C 退出) ---\x1b[0m`);
        const close = client.followLogs(task.id, (log) => {
          const prefix = log.stream === 'stderr' ? '\x1b[31m[ERR]\x1b[0m' : '\x1b[32m[LOG]\x1b[0m';
          console.log(`${prefix} [${log.nodeId}] ${log.message}`);
        });

        process.on('SIGINT', () => {
          close();
          process.exit(0);
        });

        // 保持连接
        await new Promise(() => {});
      }
    } catch (err: any) {
      console.error(`\x1b[31m创建任务失败:\x1b[0m ${err.message}`);
      process.exit(1);
    }
  });

taskCmd
  .command('list')
  .description('列出所有任务及看板流转状态')
  .action(async () => {
    try {
      let tasks: Task[] = [];
      try {
        tasks = await client.listTasks();
      } catch {
        const store = new Store();
        tasks = store.getTasks();
      }

      if (tasks.length === 0) {
        console.log(`暂无任务。可以使用 'openloop task create -w <workflow-id>' 创建新任务。`);
        return;
      }

      console.log(`\n\x1b[1m任务流转列表 (${tasks.length} 个):\x1b[0m`);
      console.log('--------------------------------------------------------------------------------');
      console.log(`%-18s %-20s %-16s %-16s`, 'TASK ID', 'TITLE', 'STATUS', 'KANBAN COLUMN');
      console.log('--------------------------------------------------------------------------------');
      for (const t of tasks) {
        const statusColor =
          t.status === 'completed'
            ? '\x1b[32m'
            : t.status === 'waiting_approval'
            ? '\x1b[33m'
            : t.status === 'running'
            ? '\x1b[36m'
            : '\x1b[37m';
        console.log(
          `%-18s %-20s ${statusColor}%-16s\x1b[0m %-16s`,
          t.id,
          t.title.slice(0, 18),
          t.status,
          t.kanbanColumn
        );
      }
      console.log('--------------------------------------------------------------------------------');
    } catch (err: any) {
      console.error(`获取任务列表失败: ${err.message}`);
    }
  });

taskCmd
  .command('show <id>')
  .description('查看单个任务各节点执行详情')
  .action(async (id) => {
    try {
      let task: Task | undefined;
      try {
        task = await client.getTask(id);
      } catch {
        const store = new Store();
        task = store.getTask(id);
      }

      if (!task) {
        console.error(`未找到任务: ${id}`);
        return;
      }

      console.log(`\n\x1b[1m任务详情: ${task.title} (${task.id})\x1b[0m`);
      console.log(`状态: ${task.status} | 看板泳道: ${task.kanbanColumn}`);
      console.log(`工作流: ${task.workflowId}`);
      console.log('\n节点执行明细:');
      console.log('----------------------------------------------------------------------');
      for (const [nodeId, runItem] of Object.entries(task.nodeRuns)) {
        const run = runItem as NodeRun;
        const color =
          run.status === 'success'
            ? '\x1b[32m✔'
            : run.status === 'running'
            ? '\x1b[36m⏳'
            : run.status === 'waiting_approval'
            ? '\x1b[33m⏸'
            : '\x1b[31m✖';
        console.log(`${color} [${nodeId}]\x1b[0m 状态: ${run.status}`);
        if (run.artifacts && run.artifacts.length > 0) {
          console.log(`   产物: ${run.artifacts.map((a: any) => `${a.name} (${a.path})`).join(', ')}`);
        }
      }
      console.log('----------------------------------------------------------------------');
    } catch (err: any) {
      console.error(`查看任务失败: ${err.message}`);
    }
  });

taskCmd
  .command('logs <id>')
  .description('查看任务日志')
  .option('-f, --follow', '实时追踪最新日志', false)
  .action(async (id, options) => {
    try {
      let logs: LogEntry[] = [];
      try {
        logs = await client.getTaskLogs(id);
      } catch {
        const store = new Store();
        logs = store.getLogs(id);
      }

      console.log(`\n\x1b[1m任务 [${id}] 日志记录 (${logs.length} 条):\x1b[0m`);
      console.log('----------------------------------------------------------------------');
      for (const log of logs) {
        const prefix = log.stream === 'stderr' ? '\x1b[31m[ERR]\x1b[0m' : '\x1b[32m[LOG]\x1b[0m';
        console.log(`${prefix} [${log.nodeId}] ${log.message}`);
      }

      if (options.follow) {
        console.log(`\n\x1b[36m--- 开始实时监听任务日志 (按 Ctrl+C 退出) ---\x1b[0m`);
        const close = client.followLogs(id, (log) => {
          const prefix = log.stream === 'stderr' ? '\x1b[31m[ERR]\x1b[0m' : '\x1b[32m[LOG]\x1b[0m';
          console.log(`${prefix} [${log.nodeId}] ${log.message}`);
        });

        process.on('SIGINT', () => {
          close();
          process.exit(0);
        });

        await new Promise(() => {});
      }
    } catch (err: any) {
      console.error(`获取日志失败: ${err.message}`);
    }
  });

taskCmd
  .command('approve <id>')
  .description('QA 人工审核通过或驳回挂起中的任务节点')
  .option('-r, --reject', '驳回该任务', false)
  .option('-c, --comment <text>', '审核意见或说明', 'QA 验证通过，用例覆盖率 100%')
  .action(async (id, options) => {
    try {
      const approved = !options.reject;
      let task;
      try {
        task = await client.resumeTask(id, approved, options.comment);
      } catch {
        const store = new Store();
        const engine = new DagEngine(store);
        task = await engine.resumeTask(id, approved, options.comment);
      }

      const actionText = approved ? '\x1b[32m审核通过\x1b[0m' : '\x1b[31m驳回\x1b[0m';
      console.log(`\x1b[32m✔\x1b[0m 任务 ${id} 操作成功: ${actionText}`);
      console.log(`当前任务状态: ${task.status}, 看板泳道: ${task.kanbanColumn}`);
    } catch (err: any) {
      console.error(`\x1b[31m审批流转失败:\x1b[0m ${err.message}`);
    }
  });

taskCmd
  .command('skip <id> [nodeId]')
  .description('跳过任务的指定节点（默认自动匹配报错节点）并驱动下游流转')
  .action(async (id, nodeId) => {
    try {
      let task;
      try {
        task = await client.skipNode(id, nodeId);
      } catch {
        const store = new Store();
        const engine = new DagEngine(store);
        task = await engine.skipNode(id, nodeId);
      }
      console.log(`\x1b[32m✔\x1b[0m 任务 ${id} 节点跳过成功`);
      console.log(`当前任务状态: ${task.status}, 看板泳道: ${task.kanbanColumn}`);
    } catch (err: any) {
      console.error(`\x1b[31m跳过节点失败:\x1b[0m ${err.message}`);
    }
  });

taskCmd
  .command('retry-node <id> [nodeId]')
  .description('单独重试任务的指定节点（默认自动匹配报错节点）')
  .action(async (id, nodeId) => {
    try {
      let task;
      try {
        task = await client.retryNode(id, nodeId);
      } catch {
        const store = new Store();
        const engine = new DagEngine(store);
        task = await engine.retryNode(id, nodeId);
      }
      console.log(`\x1b[32m✔\x1b[0m 任务 ${id} 节点已重新启动调度`);
      console.log(`当前任务状态: ${task.status}, 看板泳道: ${task.kanbanColumn}`);
    } catch (err: any) {
      console.error(`\x1b[31m重试节点失败:\x1b[0m ${err.message}`);
    }
  });

// 插件管理
const pluginCmd = program.command('plugin').description('插件扩展管理');

pluginCmd
  .command('list')
  .description('列出所有已挂载插件和侧边栏槽位')
  .action(async () => {
    try {
      let plugins: PluginManifest[] = [];
      try {
        plugins = await client.listPlugins();
      } catch {
        const store = new Store();
        plugins = store.getPlugins();
      }

      console.log(`\n\x1b[1m已安装插件与侧边栏槽位 (${plugins.length} 个):\x1b[0m`);
      console.log('----------------------------------------------------------------------');
      for (const p of plugins) {
        console.log(`\x1b[36m插件:\x1b[0m     ${p.name} (v${p.version}) [ID: ${p.id}]`);
        console.log(`\x1b[36m说明:\x1b[0m     ${p.description}`);
        if (p.sidebarItem) {
          console.log(`\x1b[36m侧边栏槽位:\x1b[0m 图标 [${p.sidebarItem.icon}] 标题 [${p.sidebarItem.title}] 路径 [${p.sidebarItem.path}] 排序 [${p.sidebarItem.order}]`);
        }
        console.log('----------------------------------------------------------------------');
      }
    } catch (err: any) {
      console.error(`获取插件列表失败: ${err.message}`);
    }
  });

// QA 自动化测试指令集 (Midscene)
const qaCmd = program.command('qa').description('Midscene UI 自动化测试执行与用例管理');

qaCmd
  .command('list')
  .description('列出所有已配置的 QA 自动化测试套件')
  .action(async () => {
    try {
      let suites: any[] = [];
      try {
        suites = await client.listQaSuites();
      } catch {
        const store = new Store();
        suites = store.getQaSuites();
      }
      console.log(`\n\x1b[1mQA 自动化测试用例 (${suites.length} 个):\x1b[0m`);
      console.log('----------------------------------------------------------------------');
      for (const s of suites) {
        const statusColor = s.lastRunStatus === 'passed' ? '\x1b[32m' : s.lastRunStatus === 'failed' ? '\x1b[31m' : '\x1b[90m';
        console.log(`\x1b[36m用例 ID:\x1b[0m    ${s.id}`);
        console.log(`\x1b[36m名称:\x1b[0m       ${s.name}`);
        console.log(`\x1b[36m目标地址:\x1b[0m   ${s.targetUrl}`);
        console.log(`\x1b[36m步骤数:\x1b[0m     ${s.steps?.length || 0} 步`);
        console.log(`\x1b[36m最后状态:\x1b[0m   ${statusColor}${s.lastRunStatus?.toUpperCase() || 'UNTESTED'}\x1b[0m`);
        console.log('----------------------------------------------------------------------');
      }
    } catch (err: any) {
      console.error(`获取 QA 用例失败: ${err.message}`);
    }
  });

qaCmd
  .command('run <suiteId>')
  .description('运行指定的 QA 自动化测试用例并输出产物')
  .option('-u, --url <url>', '覆盖目标测试地址')
  .option('--format <format>', '输出格式: pretty 或 json', 'pretty')
  .action(async (suiteId, options) => {
    try {
      if (options.format !== 'json') {
        console.log(`\x1b[36m[Midscene QA]\x1b[0m 正在启动自动化测试: ${suiteId}...`);
      }
      let record: any;
      try {
        record = await client.runQa({
          suiteId,
          targetUrl: options.url,
        });
      } catch {
        // 脱机/降级本地 Runner 执行
        const store = new Store();
        const suite = store.getQaSuiteById(suiteId);
        if (!suite) {
          throw new Error(`未找到用例 ID: ${suiteId}`);
        }
        if (options.url) suite.targetUrl = options.url;
        const { MidsceneRunner, applyQaModelEnv, configureQaRuntimePaths } = require('@openloop/core');
        applyQaModelEnv(store.getSettings()?.qaAutomation);
        configureQaRuntimePaths(store.getDataDir());
        const path = require('path');
        const os = require('os');
        const runner = new MidsceneRunner({
          artifactBaseDir: path.join(store.getDataDir(), 'artifacts'),
          serverBaseUrl: 'http://127.0.0.1:19888',
          onStepStart: (idx: number, step: any) => {
            if (options.format !== 'json') {
              console.log(`\x1b[36m[Step ${idx + 1}]\x1b[0m 正在执行 [${step.type}]: ${step.prompt}`);
            }
          },
          onStepFinish: (idx: number, rec: any) => {
            if (options.format !== 'json') {
              const sym = rec.status === 'passed' ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✖\x1b[0m';
              console.log(`  ${sym} 耗时: ${rec.durationMs}ms - ${rec.thought || ''}`);
            }
          },
        });
        record = await runner.runSuite(suite);
        store.saveQaRun(record);
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(record, null, 2));
      } else {
        const isPass = record.status === 'passed';
        console.log('\n================== 测试执行总结 ==================');
        console.log(`用例名称:   ${record.suiteName}`);
        console.log(`运行结果:   ${isPass ? '\x1b[32m✔ PASSED\x1b[0m' : '\x1b[31m✖ FAILED\x1b[0m'}`);
        console.log(`通过步骤:   ${record.passedSteps} / ${record.totalSteps}`);
        console.log(`总耗时:     ${(record.durationMs / 1000).toFixed(2)}s`);
        if (record.reportUrl) {
          console.log(`交互式报告: ${record.reportUrl}`);
        }
        console.log('==================================================');
      }

      if (record.status !== 'passed') {
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`执行测试失败: ${err.message}`);
      process.exit(1);
    }
  });

// 快捷一键执行工作流命令
program
  .command('run [args...]')
  .description('快捷触发流水线执行（支持指定流水线名称或自然语言 Prompt，例如: openloop run "构建并部署应用"）')
  .option('-w, --workflow <id>', '指定工作流 ID')
  .option('-f, --follow', '实时跟随并打印执行日志', true)
  .action(async (args: string[], options) => {
    try {
      let workflows: WorkflowDefinition[] = [];
      try {
        workflows = await client.listWorkflows();
      } catch {
        const store = new Store();
        workflows = store.getWorkflows();
      }

      let selectedWorkflow: WorkflowDefinition | undefined;
      let prompt = '';

      if (options.workflow) {
        selectedWorkflow = workflows.find((w) => w.id === options.workflow || w.name.includes(options.workflow));
        prompt = args.join(' ');
      } else if (args.length > 0) {
        const firstArg = args[0];
        const match = workflows.find((w) => w.id === firstArg || w.name.toLowerCase().includes(firstArg.toLowerCase()));
        if (match && args.length > 1) {
          selectedWorkflow = match;
          prompt = args.slice(1).join(' ');
        } else if (match && args.length === 1) {
          selectedWorkflow = match;
          prompt = match.name;
        } else {
          prompt = args.join(' ');
          selectedWorkflow = workflows[0];
        }
      } else {
        selectedWorkflow = workflows[0];
        prompt = selectedWorkflow ? `执行 ${selectedWorkflow.name}` : '';
      }

      if (!selectedWorkflow) {
        console.error('\x1b[31m✖ 未找到可用的工作流，请先通过 openloop workflow list 检查可用流程\x1b[0m');
        process.exit(1);
      }

      console.log(`\n\x1b[1m\x1b[36m⚡ openLoop 快捷流水线执行\x1b[0m`);
      console.log(`----------------------------------------------------------------------`);
      console.log(`目标工作流: \x1b[33m${selectedWorkflow.name}\x1b[0m (${selectedWorkflow.id})`);
      console.log(`执行需求:   \x1b[32m${prompt}\x1b[0m`);
      console.log(`----------------------------------------------------------------------\n`);

      let task: Task | undefined;
      let isLocalFallback = false;

      try {
        task = await client.createTask({
          workflowId: selectedWorkflow.id,
          title: prompt.length > 200 ? prompt.slice(0, 197) + '...' : prompt,
          description: prompt,
          kanbanColumn: 'in_progress',
          autoRun: true,
        });
      } catch (err: any) {
        console.log(`\x1b[33m[提示]\x1b[0m 核心守护进程未启动，自动使用内嵌引擎执行...`);
        const store = new Store();
        const engine = new DagEngine(store);
        isLocalFallback = true;

        task = store.saveTask({
          id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          title: prompt.length > 200 ? prompt.slice(0, 197) + '...' : prompt,
          description: prompt,
          workflowId: selectedWorkflow.id,
          status: 'running',
          kanbanColumn: 'in_progress',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          nodeRuns: {},
          context: {},
        });

        engine.on('log:new', (entry) => {
          if (entry.taskId === task!.id) {
            const prefix = entry.stream === 'stderr' ? '\x1b[31m[ERR]\x1b[0m' : '\x1b[32m[LOG]\x1b[0m';
            console.log(`${prefix} [${entry.nodeId}] ${entry.message}`);
          }
        });

        engine.runTask(task.id).catch((e) => console.error(e));
      }

      if (task && !isLocalFallback) {
        console.log(`\x1b[32m✔ 任务已成功派发至调度引擎，任务 ID: ${task.id}\x1b[0m`);
        console.log(`\x1b[36m--- 开始实时跟随执行日志 (Ctrl+C 可随时退出控制台) ---\x1b[0m\n`);

        const closeFollow = client.followLogs(task.id, (log) => {
          const prefix = log.stream === 'stderr' ? '\x1b[31m[ERR]\x1b[0m' : log.stream === 'system' ? '\x1b[35m[SYS]\x1b[0m' : '\x1b[32m[LOG]\x1b[0m';
          console.log(`${prefix} [${log.nodeId}] ${log.message}`);
        });

        const timer = setInterval(async () => {
          try {
            const current = await client.getTask(task!.id);
            if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
              clearInterval(timer);
              closeFollow();
              console.log(`\n----------------------------------------------------------------------`);
              if (current.status === 'completed') {
                console.log(`\x1b[32m\x1b[1m✔ 流水线执行成功！\x1b[0m`);
              } else {
                console.log(`\x1b[31m\x1b[1m✖ 流水线执行终止 (状态: ${current.status})\x1b[0m`);
              }
              console.log(`----------------------------------------------------------------------\n`);
              process.exit(current.status === 'completed' ? 0 : 1);
            }
          } catch {}
        }, 1500);
      }
    } catch (err: any) {
      console.error(`\x1b[31m执行失败: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  });

program.parse(process.argv);
