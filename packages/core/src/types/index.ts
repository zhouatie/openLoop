export type NodeStatus = 'pending' | 'running' | 'waiting_approval' | 'success' | 'failed' | 'skipped';

export type TaskStatus = 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export type KanbanColumn = 'inbox' | 'backlog' | 'in_progress' | 'agent_executing' | 'qa_review' | 'done';

export type NodeType = 
  | 'cli'             // 通用 CLI 脚本执行
  | 'agent'           // AI Agent 调用
  | 'sub-workflow'    // 子流水线 / 复合支线调用
  | 'qa-planner'      // 资深 QA 工程师黑盒用例设计
  | 'midscene'        // Midscene 自动化 UI 测试
  | 'stitch-image'    // 拼接截图与生成动图
  | 'hook'            // Webhook / 触发器
  | 'qa-approval'     // 人工 QA 审核确认
  | 'worktree-setup'  // 创建 Git Worktree 与独立沙箱靶机
  | 'worktree-merge'  // 自动合并 Worktree 分支
  | 'worktree-cleanup'// 释放任务后台进程与清理沙箱目录
  | 'env-prepare'      // 环境准备与服务拉起 / 现场就绪检查
  | 'custom';         // 插件扩展节点

export interface NodeConfig {
  // CLI 或 Agent 相关配置
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  
  // Agent 专用
  agentName?: string;
  prompt?: string;
  inputFiles?: string[];
  
  // 环境准备 (env-prepare) 与服务拉起专用
  healthUrl?: string;
  targetPlatform?: 'web' | 'android' | 'ios' | 'desktop';
  warmupTimeoutMs?: number;
  background?: boolean; // 是否作为任务关联的后台守护服务常驻

  // 沙箱隔离 (worktree-setup) 专用
  sharedPaths?: string[];   // 需要软链共享的相对路径列表，默认 ['node_modules']
  allocatePorts?: string[]; // 需要动态分配并注入的端口变量名，例如 ['webPort', 'corePort']
  basePort?: number;        // 动态分配起始基准端口（如 3000, 5173, 8080），默认 5175
  portBases?: Record<string, number>; // 针对具体端口变量名的起始基准端口字典，如 { webPort: 3000, corePort: 19890 }

  // Midscene 自动化测试专用
  platform?: 'web' | 'android' | 'ios' | 'desktop';
  testUrl?: string;
  appPackage?: string;
  initialRoute?: string;
  suiteId?: string;
  instructions?: string[];
  screenshotPath?: string;
  
  // 拼接截图专用
  sourceDir?: string;
  outputFormat?: 'gif' | 'video' | 'sprite';
  outputFile?: string;
  
  // Hook 专用
  hookType?: 'event' | 'webhook' | 'file_change';
  webhookUrl?: string;
  
  // 审批相关
  approvalPrompt?: string;
  checklist?: string[];

  // 子流水线 (sub-workflow) 专用
  subWorkflowId?: string;     // 关联的子流水线定义 ID (如 wf_febase_app_deploy)
  inheritContext?: boolean;   // 是否继承父级任务全部变量与工作区，默认 true

  // 节点超时与重试配置
  timeoutSec?: number;
  retryCount?: number;

  // 工作区约束
  requireWorkspace?: boolean;
  
  // 自定义扩展属性
  customData?: Record<string, any>;
}

export interface ToolExecutionRecord {
  id: string;
  name: string;
  args?: any;
  result?: any;
  status: 'running' | 'success' | 'error';
  durationMs?: number;
}

export interface SessionChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  tools?: ToolExecutionRecord[];
  timestamp: number;
  attachments?: TaskAttachment[];
}

export interface TaskSessionState {
  taskId: string;
  active: boolean;
  isBusy: boolean;
  isPaused: boolean;
  messages: SessionChatMessage[];
  agentName?: string;
  model?: string;
  piSessionId?: string;
}

export interface WorkflowSessionState {
  workflowId: string;
  active: boolean;
  isBusy: boolean;
  isPaused: boolean;
  messages: SessionChatMessage[];
  agentName?: string;
  model?: string;
  piSessionId?: string;
}

export interface WorkflowActionPayload {
  action: 'replace_all' | 'patch' | 'layout';
  workflow?: {
    name?: string;
    description?: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  addNodes?: WorkflowNode[];
  updateNodes?: Partial<WorkflowNode>[];
  removeNodeIds?: string[];
  addEdges?: WorkflowEdge[];
  removeEdgeIds?: string[];
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: NodeType;
  config: NodeConfig;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string; // 支持简单表达式，如 outcome === 'success'
}

export interface WorkflowTaskTemplate {
  titlePlaceholder?: string;       // 任务标题输入指引
  descriptionTemplate?: string;    // 默认需求与上下文描述 Markdown 骨架模板
  acceptanceTemplate?: string;     // 默认验收标准与用例骨架模板
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  tags?: string[]; // 流水线标签列表，用于归类、筛选与过滤 (例如: '工作', '部署', 'QA', '日常')
  taskTemplate?: WorkflowTaskTemplate; // 流水线关联的创建任务输入模板
  variables?: Record<string, any>;
  requireWorkspace?: boolean; // 该流水线是否要求必须关联工程工作区根目录
  defaultWorkspace?: string; // 该流水线绑定的默认工程工作区目录 (可选)
  context?: {
    chatMessages?: SessionChatMessage[];
    [key: string]: any;
  };
}

export interface NodeRun {
  nodeId: string;
  status: NodeStatus;
  startedAt?: number;
  finishedAt?: number;
  output?: any;
  error?: string;
  exitCode?: number;
  artifacts?: Array<{
    name: string;
    type: 'image' | 'video' | 'log' | 'json';
    path: string;
  }>;
}

export interface LogEntry {
  id: string;
  taskId: string;
  nodeId: string;
  timestamp: number;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface TaskAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  path: string;       // 本地存储物理路径，供本地 CLI / Agent 读取
  url: string;        // Core Server 访问路径 (如 /api/attachments/:id)
  createdAt: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  attachments?: TaskAttachment[]; // 关联的截图/图片附件
  workflowId: string;
  status: TaskStatus;
  kanbanColumn: KanbanColumn;
  workspace?: string; // 关联的本地代码工程根目录工作区
  triggerSource?: 'shortcut' | 'debug' | 'kanban' | 'api' | 'manual'; // 任务/流水线调用触发来源
  createdAt: number;
  updatedAt: number;
  currentNodeId?: string;
  nodeRuns: Record<string, NodeRun>;
  context: Record<string, any>; // 运行时上下文，节点间传参
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  isBuiltin?: boolean;
  entry?: string; // 插件 Web 入口 (URL 或相对路径)
  sidebarItem?: {
    id: string;
    title: string;
    icon: string;
    order: number;
    path: string;
  };
  customNodes?: Array<{
    type: string;
    label: string;
    description: string;
    defaultConfig: NodeConfig;
  }>;
}

export type AgentProviderType = 'pi' | 'custom-cli';

export type PiThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export type ShortcutSuperKey = 'Control' | 'Meta' | 'Alt';

export type AgentPromptKey =
  | 'workflowCopilot'
  | 'qaPlanner'
  | 'agentNodeRequirement'
  | 'conflictResolution'
  | 'qaArtifactFeedback';

export type AgentPromptTemplates = Partial<Record<AgentPromptKey, string>>;

export interface PromptMeta {
  key: AgentPromptKey;
  label: string;
  category: string;
  description: string;
  variables: Array<{ name: string; description: string }>;
  defaultTemplate: string;
}

export interface OpenLoopSettings {
  agentProvider?: AgentProviderType;
  piModel?: string;
  piThinking?: PiThinkingLevel;
  piTools?: string;
  defaultCwd?: string;
  autoSnapshot?: boolean;
  shortcutSuperKey?: ShortcutSuperKey;
  prompts?: AgentPromptTemplates;
  [key: string]: any;
}

export interface WorktreeContextInfo {
  worktreeDir: string;
  branchName: string;
  baseBranch?: string;
  ports?: Record<string, number>; // 通用动态端口字典，如 { webPort: 5175, corePort: 19891 }
  corePort?: number; // 兼容字段
  webPort?: number;  // 兼容字段
  targetUrl: string;
  changedFiles?: string[];
  diffSummary?: string;
  qaRunId?: string;
  conflictResolution?: {
    baseBranch: string;
    conflictFiles: string[];
    resolvedAt: number;
    summary?: string;
  };
}

export type QaStepType = 'action' | 'assert' | 'waitFor' | 'query';

export interface QaStep {
  id: string;
  type: QaStepType;
  prompt: string;
  timeoutMs?: number;
  optional?: boolean;
}

export interface QaSuite {
  id: string;
  name: string;
  description?: string;
  targetUrl: string;
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    isMobile?: boolean;
  };
  steps: QaStep[];
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  lastRunStatus?: 'passed' | 'failed' | 'running' | 'untested';
  lastRunDurationMs?: number;
  lastRunAt?: number;
}

export interface StepTimelineRecord {
  stepIndex: number;
  stepId?: string;
  type: QaStepType;
  prompt: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  screenshotRelPath?: string;
  screenshotUrl?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  thought?: string;
  error?: string;
}

export interface QaRunRecord {
  id: string;
  suiteId: string;
  suiteName: string;
  taskId?: string;
  status: 'running' | 'passed' | 'failed';
  totalSteps: number;
  passedSteps: number;
  durationMs: number;
  timeline: StepTimelineRecord[];
  reportRelPath?: string;
  reportUrl?: string;
  createdAt: number;
  finishedAt?: number;
  error?: string;
}


