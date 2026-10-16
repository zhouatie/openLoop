import fs from 'fs';
import path from 'path';
import os from 'os';
import { Task, WorkflowDefinition, LogEntry, PluginManifest, KanbanColumn } from '../types';

export interface StoreData {
  workflows: Record<string, WorkflowDefinition>;
  tasks: Record<string, Task>;
  plugins: Record<string, PluginManifest>;
}

export class Store {
  private dataDir: string;
  private dataFilePath: string;
  private data: StoreData;
  private logs: LogEntry[] = [];
  private maxLogs = 10000;

  constructor(customDir?: string) {
    this.dataDir = customDir || path.join(os.homedir(), '.openloop');
    this.dataFilePath = path.join(this.dataDir, 'store.json');
    this.data = {
      workflows: {},
      tasks: {},
      plugins: {},
    };
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        this.data = JSON.parse(raw);
      } else {
        this.seedInitialData();
        this.save();
      }
    } catch (err) {
      console.warn('[Store] Failed to load store, initializing defaults', err);
      this.seedInitialData();
    }
  }

  private seedInitialData() {
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
      this.data.plugins[plugin.id] = plugin;
    }

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
            command: 'echo "[Midscene] 正在启动无头浏览器并加载 Midscene AI 驱动..." && sleep 2 && echo "[Midscene] 智能识别输入框与交互..." && echo "[Midscene] 捕获步骤截图: step1.png, step2.png, step3.png"',
            screenshotPath: './artifacts/midscene',
          },
        },
        {
          id: 'node_stitch_images',
          name: '拼接截图动图 CLI',
          type: 'stitch-image',
          position: { x: 940, y: 150 },
          config: {
            sourceDir: './artifacts/midscene',
            outputFormat: 'gif',
            outputFile: './artifacts/flow_result.gif',
            command: 'echo "[Stitcher] 正在调用 CLI 将 3 张步骤截图合成为动图 preview.gif..." && sleep 1 && echo "[Stitcher] 合成完成: ./artifacts/preview.gif"',
          },
        },
        {
          id: 'node_qa_verify',
          name: 'QA 人工/用例最终验收',
          type: 'qa-approval',
          position: { x: 1220, y: 150 },
          config: {
            approvalPrompt: '请 QA 工程师查验 Midscene 生成的动图及用例覆盖情况',
            checklist: [
              '核心视觉与页面布局正常',
              '测试步骤均已覆盖成功',
              '异常场景测试通过',
            ],
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'node_start_agent', target: 'node_hook_dev_done' },
        { id: 'e2', source: 'node_hook_dev_done', target: 'node_midscene_test' },
        { id: 'e3', source: 'node_midscene_test', target: 'node_stitch_images' },
        { id: 'e4', source: 'node_stitch_images', target: 'node_qa_verify' },
      ],
    };

    this.data.workflows[defaultWorkflow.id] = defaultWorkflow;
  }

  public save() {
    try {
      fs.writeFileSync(this.dataFilePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Store] Failed to write data file', err);
    }
  }

  // Workflow APIs
  public getWorkflows(): WorkflowDefinition[] {
    return Object.values(this.data.workflows);
  }

  public getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.data.workflows[id];
  }

  public saveWorkflow(wf: WorkflowDefinition): WorkflowDefinition {
    wf.updatedAt = Date.now();
    if (!wf.createdAt) wf.createdAt = Date.now();
    this.data.workflows[wf.id] = wf;
    this.save();
    return wf;
  }

  public deleteWorkflow(id: string): boolean {
    if (this.data.workflows[id]) {
      delete this.data.workflows[id];
      this.save();
      return true;
    }
    return false;
  }

  // Task APIs
  public getTasks(): Task[] {
    return Object.values(this.data.tasks).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getTask(id: string): Task | undefined {
    return this.data.tasks[id];
  }

  public saveTask(task: Task): Task {
    task.updatedAt = Date.now();
    this.data.tasks[task.id] = task;
    this.save();
    return task;
  }

  public updateTaskColumn(taskId: string, column: KanbanColumn) {
    const task = this.data.tasks[taskId];
    if (task) {
      task.kanbanColumn = column;
      task.updatedAt = Date.now();
      this.save();
    }
  }

  // Logs APIs
  public addLog(entry: LogEntry) {
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  public getLogs(taskId?: string, nodeId?: string): LogEntry[] {
    return this.logs.filter((log) => {
      if (taskId && log.taskId !== taskId) return false;
      if (nodeId && log.nodeId !== nodeId) return false;
      return true;
    });
  }

  // Plugin APIs
  public getPlugins(): PluginManifest[] {
    return Object.values(this.data.plugins);
  }

  public registerPlugin(plugin: PluginManifest): PluginManifest {
    this.data.plugins[plugin.id] = plugin;
    this.save();
    return plugin;
  }
}
