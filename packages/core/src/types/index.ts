export type NodeStatus = 'pending' | 'running' | 'waiting_approval' | 'success' | 'failed' | 'skipped';

export type TaskStatus = 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';

export type KanbanColumn = 'inbox' | 'backlog' | 'in_progress' | 'agent_executing' | 'qa_review' | 'done';

export type NodeType = 
  | 'cli'             // 通用 CLI 脚本执行
  | 'agent'           // AI Agent 调用
  | 'midscene'        // Midscene 自动化 UI 测试
  | 'stitch-image'    // 拼接截图与生成动图
  | 'hook'            // Webhook / 触发器
  | 'qa-approval'     // 人工 QA 审核确认
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
  
  // Midscene 专用
  testUrl?: string;
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

  // 节点超时与重试配置
  timeoutSec?: number;
  retryCount?: number;
  
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

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables?: Record<string, any>;
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

export interface Task {
  id: string;
  title: string;
  description?: string;
  workflowId: string;
  status: TaskStatus;
  kanbanColumn: KanbanColumn;
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

export interface OpenLoopSettings {
  agentProvider?: AgentProviderType;
  piModel?: string;
  piThinking?: PiThinkingLevel;
  piTools?: string;
  defaultCwd?: string;
  autoSnapshot?: boolean;
  [key: string]: any;
}

