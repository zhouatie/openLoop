export type NodeStatus = 'pending' | 'running' | 'waiting_approval' | 'success' | 'failed' | 'skipped';

export type TaskStatus = 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export type TaskKind = 'single' | 'group' | 'subtask';

export type TaskExecutionMode = 'serial' | 'parallel' | 'dag';

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
  targetPlatform?: QaPlatform;
  warmupTimeoutMs?: number;
  background?: boolean; // 是否作为任务关联的后台守护服务常驻

  // 沙箱隔离 (worktree-setup) 专用
  sharedPaths?: string[];   // 需要软链共享的相对路径列表，默认 ['node_modules']
  allocatePorts?: string[]; // 需要动态分配并注入的端口变量名，例如 ['webPort', 'corePort']
  basePort?: number;        // 动态分配起始基准端口（如 3000, 5173, 8080），默认 5175
  portBases?: Record<string, number>; // 针对具体端口变量名的起始基准端口字典，如 { webPort: 3000, corePort: 19890 }

  // Midscene 自动化测试专用
  platform?: QaPlatform;
  testUrl?: string;
  appPackage?: string;
  deviceSerial?: string;
  /** iOS WebDriverAgent 地址，如 http://localhost:8100 */
  wdaEndpoint?: string;
  initialRoute?: string;
  suiteId?: string;
  instructions?: string[];
  screenshotPath?: string;
  skipLaunch?: boolean; // 复用前置节点已拉起的页面，不再自行拉起应用
  
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
  subWorkflowId?: string;     // 关联的子流水线定义 ID
  inheritContext?: boolean;   // 是否继承父级任务全部变量与工作区，默认 true

  // 节点超时与重试配置
  timeoutSec?: number;
  retryCount?: number;

  // 工作区约束
  requireWorkspace?: boolean;

  // 任务级可调参数声明：UI 据此在任务详情自动生成输入框，调整仅在当前任务生效
  editableParams?: NodeEditableParam[];
  
  // 自定义扩展属性
  customData?: Record<string, any>;
}

/**
 * 节点声明的任务级可调参数
 * 值是插值变量，执行时优先级高于任务上下文与流水线变量
 */
export interface NodeEditableParam {
  key: string;          // 变量名，节点命令中以 {{key}} 引用
  label: string;        // 中文展示名
  placeholder?: string; // 输入占位提示
  hint?: string;        // 补充说明
}

/**
 * 任务级节点覆盖：仅对单个任务生效，不写回流水线模板
 */
export interface TaskNodeOverride {
  config?: Partial<NodeConfig>;      // 覆盖节点配置字段（如 command / prompt）
  params?: Record<string, string>;   // 覆盖节点声明的可调参数
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
  /** 本轮已结束但 Agent 未声明完成，正在等待用户回复 */
  awaitingInput?: boolean;
  messages: SessionChatMessage[];
  agentName?: string;
  model?: string;
  pendingModel?: string; // 待生效模型（运行时无法立即切换时暂存）
  modelError?: string; // 最近一次运行时模型切换的失败原因
  sessionId?: string;
  piSessionId?: string; // 兼容字段
  resumeCommand?: string;
  agentProvider?: string;
}

/** 运行时同步给活跃会话的模型/思考强度变更 */
export interface RuntimeSettingsPatch {
  model?: string;
  thinking?: string;
}

/** 单个会话的运行时同步结果：applied=已生效，queued=本轮结束后生效，failed=无法切换 */
export type RuntimeSettingsApplyResult = 'applied' | 'queued' | 'failed';

/** 全局运行时同步汇总 */
export interface RuntimeSettingsApplySummary {
  applied: number;
  queued: number;
  failed: number;
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
  descriptionTemplate?: string;    // 默认需求与上下文描述 Markdown 骨架模板 (任务说明与提示词模板)
  acceptanceTemplate?: string;     // 默认验收标准与用例骨架模板
}

/**
 * 清理与归一化工作流关联的任务模板，去除纯空字段；全空时返回 undefined
 */
export function cleanTaskTemplate(tpl?: WorkflowTaskTemplate): WorkflowTaskTemplate | undefined {
  if (!tpl) return undefined;
  const titlePlaceholder = tpl.titlePlaceholder?.trim() || undefined;
  const descriptionTemplate = tpl.descriptionTemplate?.trim() ? tpl.descriptionTemplate : undefined;
  const acceptanceTemplate = tpl.acceptanceTemplate?.trim() ? tpl.acceptanceTemplate : undefined;
  if (!titlePlaceholder && !descriptionTemplate && !acceptanceTemplate) {
    return undefined;
  }
  return {
    ...(titlePlaceholder ? { titlePlaceholder } : {}),
    ...(descriptionTemplate ? { descriptionTemplate } : {}),
    ...(acceptanceTemplate ? { acceptanceTemplate } : {}),
  };
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
  context: Record<string, any>; // 运行时上下文，节点间传参 (含 nodeOverrides 任务级节点覆盖)

  // 任务组 (Task Group) 扩展属性
  kind?: TaskKind;                             // 任务形态: single(单任务) | group(任务组根节点) | subtask(子任务)
  parentTaskId?: string;                      // 所属父任务组 ID (子任务专用)
  subTaskIds?: string[];                      // 包含的子任务 ID 列表 (任务组专用)
  dependencies?: string[];                    // 前置依赖的同组子任务 ID 列表 (串行/DAG编排专用)
  executionMode?: TaskExecutionMode;          // 任务组编排执行模式: serial(纯串行) | parallel(纯并行) | dag(自定义依赖)
  concurrencyLimit?: number;                  // 任务组内最大并行并发数 (默认 3)
  autoDecompose?: boolean;                    // 启动执行时是否允许由 AI 自动评估复杂度并拆解为多工序任务组
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

export type AgentProviderType = 'pi' | 'claude-code' | 'codex' | 'opencode';

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

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

export interface StorageRetentionSettings {
  autoCleanEnabled?: boolean;
  logRetentionDays?: number;
  qaRunRetentionCount?: number;
  automationLogRetentionDays?: number;
  lastAutoCleanAt?: number;
}

export interface OpenLoopSettings {
  agentProvider?: AgentProviderType;
  // 代码智能体引擎的通用参数，对 pi / claude-code / codex / opencode 一致生效
  defaultModel?: string;
  reasoningLevel?: ThinkingLevel;
  defaultCwd?: string;
  autoSnapshot?: boolean;
  shortcutSuperKey?: ShortcutSuperKey;
  prompts?: AgentPromptTemplates;
  storageRetention?: StorageRetentionSettings;
  qaAutomation?: QaAutomationSettings;
  [key: string]: any;
}

/**
 * UI 自动化测试的多模态视觉模型配置（Android 端视觉推理需要）
 */
export interface QaAutomationSettings {
  modelBaseUrl?: string;
  modelApiKey?: string;
  modelName?: string;
  modelFamily?: string;
  /** 客户端自动化执行时是否自动打开设备镜像窗口（默认开启） */
  autoOpenMirror?: boolean;
}

export interface WorktreeContextInfo {
  worktreeDir: string;
  branchName: string;
  baseBranch?: string;
  baseCommit?: string;
  ports?: Record<string, number>; // 通用动态端口字典，如 { webPort: 5175, corePort: 19891 }
  corePort?: number; // 兼容字段
  webPort?: number;  // 兼容字段
  targetUrl: string;
  storeDir?: string; // 沙箱独立数据底座目录 (保证任务间及与稳定版彻底隔离)
  changedFiles?: string[];
  diffSummary?: string;
  diffResult?: TaskWorktreeDiffResult;
  qaRunId?: string;
  conflictResolution?: {
    baseBranch: string;
    conflictFiles: string[];
    resolvedAt: number;
    summary?: string;
  };
}

export interface FileDiffItem {
  file: string;
  oldPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  diff: string;
  isBinary?: boolean;
}

export interface TaskWorktreeDiffResult {
  hasWorktree: boolean;
  worktreeDir?: string;
  branchName?: string;
  baseBranch?: string;
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    rawStat?: string;
  };
  files: FileDiffItem[];
}

export type QaStepType = 'action' | 'assert' | 'waitFor' | 'query';
/** 当前已实现的测试平台，新增平台需同时实现对应 QaDriver */
export type QaPlatform = 'web' | 'android' | 'ios';

export interface AndroidDeviceInfo {
  serial: string;
  model: string;
  version?: string;
  status: 'device' | 'offline' | 'unauthorized';
  isEmulator: boolean;
}

export interface IosDeviceInfo {
  /** 模拟器 UDID 或真机标识 */
  udid: string;
  name: string;
  model: string;
  version?: string;
  state: 'booted' | 'shutdown' | 'unknown';
  isSimulator: boolean;
}

/** WebDriverAgent 连接状态（iOS 自动化的唯一连接入口） */
export interface IosWdaStatus {
  reachable: boolean;
  endpoint: string;
  udid?: string;
  deviceName?: string;
  isSimulator?: boolean;
  message?: string;
}

export interface IosDevicesSnapshot {
  environment: { available: boolean; message?: string };
  wda: IosWdaStatus;
  simulators: IosDeviceInfo[];
}

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
  platform?: QaPlatform;
  targetUrl: string;
  /** Android 包名 / iOS Bundle ID */
  appPackage?: string;
  deviceSerial?: string;
  /** iOS WebDriverAgent 地址，如 http://localhost:8100 */
  wdaEndpoint?: string;
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
  platform?: QaPlatform;
  deviceSerial?: string;
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

export interface SelectedQaStepArtifact {
  stepIndex: number;
  stepId?: string;
  prompt: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
  thought?: string;
  screenshotUrl?: string;
  screenshotRelPath?: string;
}

export interface SelectedQaScreenshotArtifact {
  name: string;
  url: string;
  path?: string;
  stepIndex?: number;
  stepPrompt?: string;
}

export interface SelectedQaArtifacts {
  qaRunId?: string;
  suiteName?: string;
  steps: SelectedQaStepArtifact[];
  screenshots: SelectedQaScreenshotArtifact[];
}

export type AutomationSourceType = 'schedule' | 'cli_script' | 'github_issues' | 'twitter_query' | 'custom';
export type AutomationActionType = 'create_task' | 'run_workflow' | 'notify_only';
export type AutomationStatus = 'idle' | 'running' | 'success' | 'failed';

export interface AutomationSourceConfig {
  /** schedule: 注入流水线的扫描 / 执行目标 */
  prompt?: string;
  command?: string;
  cwd?: string;
  repo?: string;
  githubToken?: string;
  twitterQuery?: string;
  endpointUrl?: string;
  script?: string;
  env?: Record<string, string>;
}

export interface AutomationActionConfig {
  workflowId?: string;
  kanbanColumn?: KanbanColumn;
  workspace?: string;
  titleTemplate?: string;
  descriptionTemplate?: string;
  autoRun?: boolean;
  /** 直连运行：不生成看板卡片，任务只存活于自动化 Tab */
  directRun?: boolean;
}

export interface AutomationTask {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  intervalSec: number;
  sourceType: AutomationSourceType;
  sourceConfig: AutomationSourceConfig;
  actionType: AutomationActionType;
  actionConfig: AutomationActionConfig;
  lastRunAt?: number;
  lastRunStatus?: AutomationStatus;
  lastRunDurationMs?: number;
  lastRunMessage?: string;
  lastRunOutput?: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  createdTaskIds?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AutomationLogRecord {
  id: string;
  automationId: string;
  timestamp: number;
  status: 'success' | 'failed';
  durationMs: number;
  summary: string;
  output?: string;
  error?: string;
  createdTaskId?: string;
}

export interface StorageStats {
  database: {
    dbSizeBytes: number;
    walSizeBytes: number;
    shmSizeBytes: number;
    totalSizeBytes: number;
    pageSize: number;
    pageCount: number;
    freelistCount: number;
  };
  counts: {
    tasks: number;
    taskNodeRuns: number;
    logs: number;
    qaSuites: number;
    qaRuns: number;
    automationTasks: number;
    automationLogs: number;
  };
  disk: {
    artifactsBytes: number;
    artifactsFilesCount: number;
    attachmentsBytes: number;
    attachmentsFilesCount: number;
    /** Midscene 运行期调试产物（截图 dump / 规划日志 / 缓存） */
    qaTraceBytes: number;
    qaTraceFilesCount: number;
    orphanFilesCount: number;
    orphanFilesBytes: number;
  };
  reclaimableEstimateBytes: number;
}

export interface StorageCleanOptions {
  cleanLogsDays?: number;
  cleanQaRunsKeepLatest?: number;
  cleanQaRunsDays?: number;
  cleanAutomationLogsDays?: number;
  cleanOrphanFiles?: boolean;
  /** 清理 Midscene 调试产物，默认随存储清理一并执行 */
  cleanQaTrace?: boolean;
  vacuum?: boolean;
}

export interface StorageCleanResult {
  freedBytes: number;
  deletedLogs: number;
  deletedQaRuns: number;
  deletedAutomationLogs: number;
  deletedOrphanFiles: number;
  vacuumExecuted: boolean;
  durationMs: number;
}




