import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Node,
  Edge,
  Connection,
  Handle,
  Position,
  NodeProps,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  Plus,
  Bot,
  Zap,
  Target,
  FileVideo,
  CheckSquare,
  Terminal,
  Save,
  Play,
  ArrowLeft,
  Settings2,
  Trash2,
  Sparkles,
  GitCommit,
  Rocket,
  LayoutGrid,
  Undo2,
  Check,
  Send,
  ChevronDown,
  ChevronRight,
  X,
  Layers,
  Wand2,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Copy,
  Edit3,
  Loader2,
  Workflow,
  Compass,
  GitBranch,
  Eye,
  CheckCheck,
  Minimize2,
  Maximize2,
  AlertCircle,
  XCircle,
  Square,
  Clock,
  RotateCcw,
  SkipForward,
  Bug,
  ClipboardCheck,
  Cpu,
} from 'lucide-react';
import {
  WorkflowDefinition,
  NodeType,
  WorkflowSessionState,
  SessionChatMessage,
  WorkflowActionPayload,
  Task,
} from '@openloop/core';
import { api } from '../services/api';
import { layoutWorkflowDag } from '../utils/dagLayout';
import { EditWorkflowModal } from '../components/EditWorkflowModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { AgentMarkdown } from '../components/AgentMarkdown';
import { toast } from '../components/Toast';
import { DebugWorkflowModal } from '../components/DebugWorkflowModal';
import { WorkspacePicker } from '../components/WorkspacePicker';
import { AgentSessionDrawer } from '../components/AgentSessionDrawer';
import { ChatScrollToLatestButton } from '../components/ChatScrollToLatestButton';
import { useChatAutoScroll } from '../hooks/useChatAutoScroll';
import { TagInput } from '../components/TagInput';

// ==========================================
// 1. 自定义节点外观（极简高质感 + 智能体生成发光 + 幽灵预演态 + 编排调试实时运行态）
// ==========================================
const CustomWorkflowNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as any;
  const type: NodeType = nodeData.type || 'cli';
  const isNew = Boolean(nodeData.isNew);
  const isGhost = Boolean(nodeData.isGhost);
  const executionStatus: string | undefined = nodeData.executionStatus;
  const executionDuration: number | undefined = nodeData.executionDuration;
  const executionError: string | undefined = nodeData.executionError;

  const typeConfig: Record<
    NodeType,
    { label: string; icon: React.ReactNode; bg: string; text: string; border: string }
  > = {
    agent: {
      label: 'Agent 编码',
      icon: <Bot size={12} strokeWidth={2} />,
      bg: 'bg-[#eeedfd]',
      text: 'text-[#4f46e5]',
      border: 'border-[#d8d6fb]',
    },
    hook: {
      label: 'Hook 触发',
      icon: <Zap size={12} strokeWidth={2} />,
      bg: 'bg-[#ffedd5]',
      text: 'text-[#c2410c]',
      border: 'border-[#fed7aa]',
    },
    midscene: {
      label: 'Midscene 测试',
      icon: <Target size={12} strokeWidth={2} />,
      bg: 'bg-[#e4f6ec]',
      text: 'text-[#15803d]',
      border: 'border-[#bbf7d0]',
    },
    'stitch-image': {
      label: '拼接动图',
      icon: <FileVideo size={12} strokeWidth={2} />,
      bg: 'bg-[#eff6ff]',
      text: 'text-[#1d4ed8]',
      border: 'border-[#bfdbfe]',
    },
    'qa-approval': {
      label: 'QA 审核验收',
      icon: <CheckSquare size={12} strokeWidth={2} />,
      bg: 'bg-[#fef3c7]',
      text: 'text-[#b45309]',
      border: 'border-[#fde68a]',
    },
    cli: {
      label: 'CLI 脚本',
      icon: <Terminal size={12} strokeWidth={2} />,
      bg: 'bg-[#f4f4f6]',
      text: 'text-[#4b4b53]',
      border: 'border-[#e3e3e8]',
    },
    'env-prepare': {
      label: '现场准备',
      icon: <Cpu size={12} strokeWidth={2} />,
      bg: 'bg-[#ecfdf5]',
      text: 'text-[#047857]',
      border: 'border-[#a7f3d0]',
    },
    'sub-workflow': {
      label: '子流水线 / 支线',
      icon: <Workflow size={12} strokeWidth={2} />,
      bg: 'bg-[#f0f9ff]',
      text: 'text-[#0284c7]',
      border: 'border-[#bae6fd]',
    },
    'qa-planner': {
      label: 'QA 用例设计',
      icon: <ClipboardCheck size={12} strokeWidth={2} />,
      bg: 'bg-[#fdf4ff]',
      text: 'text-[#a21caf]',
      border: 'border-[#f5d0fe]',
    },
    'worktree-setup': {
      label: '沙箱隔离',
      icon: <Layers size={12} strokeWidth={2} />,
      bg: 'bg-[#f0fdf4]',
      text: 'text-[#15803d]',
      border: 'border-[#bbf7d0]',
    },
    'worktree-merge': {
      label: '分支合并',
      icon: <Layers size={12} strokeWidth={2} />,
      bg: 'bg-[#faf5ff]',
      text: 'text-[#7e22ce]',
      border: 'border-[#e9d5ff]',
    },
    'worktree-cleanup': {
      label: '环境清理',
      icon: <Layers size={12} strokeWidth={2} />,
      bg: 'bg-[#f8fafc]',
      text: 'text-[#475569]',
      border: 'border-[#cbd5e1]',
    },
    custom: {
      label: '插件扩展',
      icon: <Sparkles size={12} strokeWidth={2} />,
      bg: 'bg-[#fdf2f8]',
      text: 'text-[#db2777]',
      border: 'border-[#fbcfe8]',
    },
  };

  const currentConfig = useMemo(() => {
    const isGit =
      type === 'cli' &&
      (nodeData.name?.toLowerCase().includes('git') ||
        nodeData.config?.command?.toLowerCase().includes('git'));
    if (isGit) {
      return {
        label: 'Git 提交',
        icon: <GitCommit size={12} strokeWidth={2} />,
        bg: 'bg-[#1c1c21]',
        text: 'text-white',
        border: 'border-[#1c1c21]',
      };
    }
    const isDeploy =
      type === 'cli' &&
      (nodeData.name?.includes('部署') ||
        nodeData.name?.toLowerCase().includes('deploy') ||
        nodeData.config?.command?.toLowerCase().includes('deploy'));
    if (isDeploy) {
      return {
        label: '应用部署',
        icon: <Rocket size={12} strokeWidth={2} />,
        bg: 'bg-[#0f172a]',
        text: 'text-[#38bdf8]',
        border: 'border-[#0f172a]',
      };
    }
    return typeConfig[type] || typeConfig.cli;
  }, [type, nodeData.name, nodeData.config?.command]);

  const nodeStatusClasses = useMemo(() => {
    if (isGhost) {
      return 'border-2 border-dashed border-[#8b5cf6] bg-[#faf8ff] ring-4 ring-[#8b5cf6]/15 shadow-[0_0_20px_rgba(139,92,246,0.2)] animate-pulse';
    }
    if (executionStatus === 'running') {
      return 'border-[#3b82f6] bg-[#f8faff] ring-4 ring-[#3b82f6]/20 shadow-[0_4px_20px_rgba(59,130,246,0.2)] animate-pulse';
    }
    if (executionStatus === 'success') {
      return 'border-[#10b981] bg-white ring-2 ring-[#10b981]/20 shadow-[0_2px_8px_rgba(16,185,129,0.12)]';
    }
    if (executionStatus === 'failed') {
      return 'border-[#ef4444] bg-[#fffbfb] ring-2 ring-[#ef4444]/20 shadow-[0_2px_8px_rgba(239,68,68,0.12)]';
    }
    if (executionStatus === 'waiting_approval') {
      return 'border-[#f59e0b] bg-[#fffdf5] ring-4 ring-[#f59e0b]/25 shadow-[0_4px_18px_rgba(245,158,11,0.2)] animate-pulse';
    }
    if (selected) {
      return 'border-[#4f46e5] bg-white ring-3 ring-[#4f46e5]/15 shadow-[0_4px_16px_rgba(79,70,229,0.12)]';
    }
    if (isNew) {
      return 'border-[#6366f1] bg-white ring-3 ring-[#6366f1]/20 shadow-[0_2px_12px_rgba(99,102,241,0.15)]';
    }
    return 'border-[#e3e3e8] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:border-[#b9b9c2]';
  }, [isGhost, executionStatus, selected, isNew]);

  return (
    <div
      className={`w-[230px] rounded-[12px] p-3 transition-all relative ${nodeStatusClasses}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={`w-2.5 h-2.5 border-2 ${
          isGhost
            ? 'bg-[#8b5cf6] border-white'
            : selected
            ? 'bg-[#4f46e5] border-white'
            : 'bg-white border-[#85858d]'
        }`}
      />

      {/* 头部：类型徽标与运行状态/ID */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] text-[10px] font-semibold tracking-wide border ${currentConfig.bg} ${currentConfig.text} ${currentConfig.border}`}
          >
            {currentConfig.icon}
            <span>{currentConfig.label}</span>
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isGhost ? (
            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-[#f3e8ff] text-[#7c3aed] font-medium border border-[#d8b4fe]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-ping" />
              AI预演
            </span>
          ) : executionStatus === 'running' ? (
            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-[#eff6ff] text-[#2563eb] font-semibold border border-[#bfdbfe]">
              <Loader2 size={10} className="animate-spin text-[#2563eb]" />
              执行中
            </span>
          ) : executionStatus === 'success' ? (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-[#ecfdf5] text-[#059669] font-medium border border-[#a7f3d0]">
              <CheckCircle2 size={10} className="text-[#059669]" />
              成功{executionDuration ? ` ${executionDuration}s` : ''}
            </span>
          ) : executionStatus === 'failed' ? (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-[#fef2f2] text-[#dc2626] font-medium border border-[#fecaca]">
              <AlertCircle size={10} className="text-[#dc2626]" />
              失败
            </span>
          ) : executionStatus === 'waiting_approval' ? (
            <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-[#fffbeb] text-[#d97706] font-medium border border-[#fde68a]">
              <Clock size={10} className="text-[#d97706]" />
              待审批
            </span>
          ) : isNew ? (
            <span className="text-[9px] px-1 py-0.5 rounded bg-[#eeedfd] text-[#4f46e5] font-medium">
              新增加
            </span>
          ) : (
            <span className="text-[9.5px] font-mono text-[#85858d]">{nodeData.id}</span>
          )}
        </div>
      </div>

      {/* 节点名称 */}
      <div className="text-[12.5px] font-semibold text-[#1c1c21] leading-snug line-clamp-2 mt-2 mb-1.5">
        {nodeData.name}
      </div>

      {/* 节点配置/指令预览胶囊 */}
      <div
        className={`text-[10px] font-mono px-2 py-1 rounded-[6px] truncate border flex items-center gap-1 ${
          isGhost
            ? 'bg-[#f5f3ff] text-[#6b21a8] border-[#e9d5ff]'
            : 'text-[#63636b] bg-[#f8f8fa] border-[#ececf0]'
        }`}
        title={
          type === 'agent'
            ? nodeData.config?.prompt
            : type === 'midscene'
            ? nodeData.config?.testUrl
            : type === 'stitch-image'
            ? nodeData.config?.outputFile
            : type === 'hook'
            ? nodeData.config?.webhookUrl
            : type === 'qa-approval'
            ? nodeData.config?.approvalPrompt
            : nodeData.config?.command
        }
      >
        <span className="text-[#85858d] select-none">&gt;_</span>
        <span className="truncate">
          {type === 'agent' && (nodeData.config?.prompt || 'Agent 自动实现需求')}
          {type === 'midscene' && (nodeData.config?.testUrl || '智能断言与多步截屏')}
          {type === 'stitch-image' && (nodeData.config?.outputFile || '生成动图 preview.gif')}
          {type === 'hook' && (nodeData.config?.webhookUrl || '完成事件广播 -> 自动流转')}
          {type === 'qa-approval' && (nodeData.config?.approvalPrompt || '人工与用例核验确认')}
          {type === 'cli' && (nodeData.config?.command || '执行命令行指令')}
          {type === 'custom' && (nodeData.config?.pluginId || '扩展插件自定义执行')}
        </span>
      </div>

      {/* 调试状态行与日志入口 */}
      {Boolean(executionStatus) && (
        <div className="mt-2 pt-1.5 border-t border-[#ececf0] flex items-center justify-between text-[10px]">
          <span className="truncate max-w-[150px]">
            {executionError ? (
              <span className="text-[#dc2626] font-medium" title={executionError}>
                报错: {executionError}
              </span>
            ) : executionStatus === 'running' ? (
              <span className="text-[#2563eb] flex items-center gap-1 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb] animate-ping" />
                正在执行...
              </span>
            ) : executionStatus === 'success' ? (
              <span className="text-[#059669]">节点执行完毕</span>
            ) : executionStatus === 'waiting_approval' ? (
              <span className="text-[#d97706]">等待人工门禁审核</span>
            ) : (
              <span className="text-[#85858d]">执行记录就绪</span>
            )}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {type === 'agent' && typeof nodeData.onInspectSession === 'function' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  nodeData.onInspectSession(nodeData.id);
                }}
                className="text-[#7c3aed] hover:text-[#6d28d9] hover:underline flex items-center gap-0.5 cursor-pointer font-medium"
                title="查看 Agent 交互会话与深度思考"
              >
                <Bot size={10} />
                <span>会话</span>
                <ArrowRight size={9} />
              </button>
            )}
            {typeof nodeData.onInspectLogs === 'function' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  nodeData.onInspectLogs(nodeData.id);
                }}
                className="text-[#4f46e5] hover:text-[#4338ca] hover:underline flex items-center gap-0.5 cursor-pointer font-medium"
                title="查看节点执行日志"
              >
                <span>日志</span>
                <ArrowRight size={9} />
              </button>
            )}
          </div>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className={`w-2.5 h-2.5 border-2 ${
          isGhost
            ? 'bg-[#8b5cf6] border-white'
            : selected
            ? 'bg-[#4f46e5] border-white'
            : 'bg-white border-[#85858d]'
        }`}
      />
    </div>
  );
};

// ==========================================
// 2. 结构化 Action 解析工具
// ==========================================
function parseWorkflowAction(content: string): WorkflowActionPayload | null {
  if (!content) return null;
  const match = content.match(/```(?:workflow-action|json)?\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const raw = match[1].trim();
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.action || parsed.workflow || parsed.nodes)) {
      return parsed;
    }
  } catch (_) {
    // 忽略流式输出未完结时的 JSON 报错
  }
  return null;
}

interface WorkflowEditorViewProps {
  workflowId: string;
  workflows: WorkflowDefinition[];
  onBack: () => void;
  onRefresh: () => void;
  onOpenTaskLogs: (taskId: string, nodeId?: string) => void;
  onSelectWorkflow?: (workflowId: string) => void;
}

// ==========================================
// 3. 内部画板与 Copilot 协同核心组件
// ==========================================
const WorkflowEditorInner: React.FC<WorkflowEditorViewProps> = ({
  workflowId,
  workflows,
  onBack,
  onRefresh,
  onOpenTaskLogs,
  onSelectWorkflow,
}) => {
  const reactFlow = useReactFlow();
  const activeWorkflow = workflows.find((w) => w.id === workflowId) || workflows[0];

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('');

  // 流水线基础信息与弹窗状态
  const [workflowName, setWorkflowName] = useState(activeWorkflow?.name || '');
  const [workflowDescription, setWorkflowDescription] = useState(activeWorkflow?.description || '');
  const [workflowTags, setWorkflowTags] = useState<string[]>(activeWorkflow?.tags || []);
  const [workflowRequireWorkspace, setWorkflowRequireWorkspace] = useState(
    Boolean(activeWorkflow?.requireWorkspace)
  );
  const [workflowDefaultWorkspace, setWorkflowDefaultWorkspace] = useState(
    activeWorkflow?.defaultWorkspace || ''
  );
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isRunningDebug, setIsRunningDebug] = useState(false);
  const [isResetSessionModalOpen, setIsResetSessionModalOpen] = useState(false);
  const [isResettingSession, setIsResettingSession] = useState(false);

  // 编排调试弹窗与全链路执行监控状态
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const [activeDebugTaskId, setActiveDebugTaskId] = useState<string | null>(null);
  const [debugTask, setDebugTask] = useState<Task | null>(null);
  const [debugTimerSeconds, setDebugTimerSeconds] = useState(0);
  const [isCancellingDebug, setIsCancellingDebug] = useState(false);
  const [isExitDebugModalOpen, setIsExitDebugModalOpen] = useState(false);
  const [isApprovingGate, setIsApprovingGate] = useState(false);
  const dismissedDebugTaskIdsRef = useRef<Set<string>>(new Set());

  // Agent 会话抽屉状态
  const [isAgentSessionOpen, setIsAgentSessionOpen] = useState(false);
  const [inspectingSessionTaskId, setInspectingSessionTaskId] = useState<string | null>(null);
  const [inspectingSessionNodeId, setInspectingSessionNodeId] = useState<string | undefined>(undefined);
  const [inspectingSessionNodeName, setInspectingSessionNodeName] = useState<string | undefined>(undefined);

  const handleOpenAgentSession = (taskId: string, targetNodeId?: string, targetNodeName?: string) => {
    if (import.meta.env?.DEV) {
      console.log('[WorkflowEditor] 打开 Agent 会话抽屉:', { taskId, targetNodeId, targetNodeName });
    }
    setInspectingSessionTaskId(taskId);
    setInspectingSessionNodeId(targetNodeId);
    setInspectingSessionNodeName(targetNodeName);
    setIsAgentSessionOpen(true);
  };

  // 右侧边栏展开与标签页状态 (默认纯净全景画布，点击节点或手动唤起展开)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'copilot' | 'inspector'>('copilot');
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(false);
  const [qaSuites, setQaSuites] = useState<any[]>([]);

  useEffect(() => {
    fetch('http://127.0.0.1:19888/api/qa/suites')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setQaSuites(data);
      })
      .catch(() => {});
  }, []);

  // 幽灵节点方案预演机制 (Ghost Preview Pipeline)
  const [ghostPreview, setGhostPreview] = useState<{
    active: boolean;
    originalNodes: Node[];
    originalEdges: Edge[];
    actionPayload: WorkflowActionPayload;
    messageId?: string;
    summary: string;
  } | null>(null);

  // 保证闭包与异步回调永远能读取到画布真实最新节点与配置，杜绝 stale state
  const nodesRef = useRef<Node[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;
  const ghostPreviewRef = useRef<typeof ghostPreview>(ghostPreview);
  ghostPreviewRef.current = ghostPreview;
  const activeWorkflowRef = useRef<typeof activeWorkflow>(activeWorkflow);
  activeWorkflowRef.current = activeWorkflow;
  const handlePreviewRef = useRef<((action: WorkflowActionPayload, messageId?: string) => void) | null>(null);

  // Copilot 会话状态
  const [copilotState, setCopilotState] = useState<WorkflowSessionState | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [appliedActionIds, setAppliedActionIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(`openloop:wf_applied_actions:${workflowId}`);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  // 当 workflowId 切换时，重新同步 appliedActionIds
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`openloop:wf_applied_actions:${workflowId}`);
      setAppliedActionIds(raw ? new Set(JSON.parse(raw)) : new Set());
    } catch {
      setAppliedActionIds(new Set());
    }
  }, [workflowId]);
  const [undoSnapshot, setUndoSnapshot] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});

  const {
    containerRef: copilotScrollContainerRef,
    bottomRef: chatEndRef,
    isAtBottom: isCopilotAtBottom,
    hasNewOutput: hasNewCopilotOutput,
    handleScroll: handleCopilotScroll,
    handleWheel: handleCopilotWheel,
    scrollToBottom: scrollCopilotToBottom,
  } = useChatAutoScroll({
    dataKey: copilotState,
    isActive: isSidebarOpen && sidebarTab === 'copilot',
    resetKey: workflowId,
  });

  const nodeTypes = useMemo(() => ({ customNode: CustomWorkflowNode }), []);

  // 初始化加载工作流节点和连线
  useEffect(() => {
    if (!activeWorkflow) return;

    const rfNodes: Node[] = activeWorkflow.nodes.map((n) => ({
      id: n.id,
      type: 'customNode',
      position: n.position || { x: 100, y: 100 },
      data: {
        id: n.id,
        name: n.name,
        type: n.type,
        config: n.config,
      },
    }));

    const rfEdges: Edge[] = activeWorkflow.edges.map((e) => {
      const condition = e.condition || '';
      const customLabel = e.label || '';
      const displayLabel = customLabel || (condition ? `[条件] ${condition}` : undefined);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: displayLabel,
        animated: true,
        data: {
          condition,
          label: customLabel,
        },
        style: { stroke: condition ? '#6366f1' : '#4f46e5', strokeWidth: 1.8 },
      };
    });

    // 若原始坐标全为 0，自动执行一次智能排版
    const needsInitialLayout =
      rfNodes.length > 1 &&
      rfNodes.every((n) => n.position.x === 0 && n.position.y === 0);

    const finalNodes = needsInitialLayout ? layoutWorkflowDag(rfNodes, rfEdges, { direction: 'LR' }) : rfNodes;

    setNodes(finalNodes);
    setEdges(rfEdges);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);

    // 延迟平滑适配视口 (限制最大缩放倍率不超过 1.0，防止少量节点时被拉得过大)
    setTimeout(() => {
      reactFlow.fitView({ padding: 0.3, maxZoom: 1, duration: 400 });
    }, 150);
  }, [workflowId, activeWorkflow]);

  // 同步当前工作流名称与描述
  useEffect(() => {
    if (activeWorkflow) {
      setWorkflowName(activeWorkflow.name || '');
      setWorkflowDescription(activeWorkflow.description || '');
      setWorkflowTags(Array.isArray(activeWorkflow.tags) ? [...activeWorkflow.tags] : []);
      setWorkflowRequireWorkspace(Boolean(activeWorkflow.requireWorkspace));
      setWorkflowDefaultWorkspace(activeWorkflow.defaultWorkspace || '');
      setTitleDraft(activeWorkflow.name || '');
    }
  }, [
    activeWorkflow?.id,
    activeWorkflow?.name,
    activeWorkflow?.description,
    activeWorkflow?.tags,
    activeWorkflow?.requireWorkspace,
    activeWorkflow?.defaultWorkspace,
  ]);

  // 拉取 Copilot 会话历史状态
  const loadCopilotSession = useCallback(async () => {
    if (!workflowId) return;
    try {
      const state = await api.getWorkflowSession(workflowId);
      setCopilotState(state);
    } catch (err: any) {
      console.warn('[WorkflowCopilot] 获取助手会话失败:', err.message);
    }
  }, [workflowId]);

  useEffect(() => {
    loadCopilotSession();
  }, [loadCopilotSession]);

  // 监听 WebSocket 的 workflow:chat_update 实时事件
  useEffect(() => {
    const unsub = api.on('workflow:chat_update', (payload: any) => {
      if (payload && payload.workflowId === workflowId && payload.state) {
        setCopilotState(payload.state);

        // 如果最后一条助手消息包含可执行 Action，且尚未被采纳或预演过，自动在画布唤起幽灵方案预演
        const msgs = payload.state.messages || [];
        if (msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          if (lastMsg.role === 'assistant') {
            const action = parseWorkflowAction(lastMsg.content);
            if (action && !appliedActionIds.has(lastMsg.id)) {
              handlePreviewRef.current?.(action, lastMsg.id);
            }
          }
        }
      }
    });
    return () => unsub();
  }, [workflowId, appliedActionIds]);


  // React Flow 内部更新
  const onNodesChange = useCallback(
    (changes: any) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: any) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => {
      const newEdgeId = `e_${params.source}_${params.target}_${Date.now().toString(36)}`;
      const newEdge: Edge = {
        ...params,
        id: newEdgeId,
        animated: true,
        data: { condition: '', label: '' },
        style: { stroke: '#4f46e5', strokeWidth: 1.8 },
      };
      setEdges((eds) => addEdge(newEdge, eds));
      setSelectedNodeId(null);
      setSelectedEdgeId(newEdgeId);
      setIsSidebarOpen(true);
      setSidebarTab('inspector');
    },
    []
  );

  const handleEdgeClick = useCallback((_: any, edge: Edge) => {
    if (import.meta.env?.DEV) {
      console.log('[Workflow:EdgeClick] 聚焦连线:', edge.id, edge.source, '->', edge.target, edge.data);
    }
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
    setIsSidebarOpen(true);
    setSidebarTab('inspector');
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const handleNodeClick = (_: any, node: Node) => {
    if (import.meta.env?.DEV) {
      console.log('[Workflow:NodeClick] 聚焦节点:', node.id, (node.data as any)?.name);
    }
    setSelectedEdgeId(null);
    setSelectedNodeId(node.id);
    setSidebarTab('inspector');
    setIsSidebarOpen(true);
  };

  // 动态渲染 Edge 样式：支持高亮选中态、分支条件 Badge 气泡、发光效果
  const renderedEdges = useMemo(() => {
    return edges.map((e) => {
      const isSelected = e.id === selectedEdgeId;
      const condition = (e.data as any)?.condition || '';
      const customLabel = (e.data as any)?.label ?? e.label;
      const displayLabel = customLabel || (condition ? `[条件] ${condition}` : undefined);
      return {
        ...e,
        label: displayLabel,
        labelStyle: {
          fill: isSelected ? '#3730a3' : '#4338ca',
          fontWeight: 600,
          fontSize: 10.5,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        },
        labelBgStyle: {
          fill: isSelected ? '#ede9fe' : '#f5f3ff',
          fillOpacity: 0.96,
          rx: 5,
          ry: 5,
          stroke: isSelected ? '#6366f1' : '#c7d2fe',
          strokeWidth: isSelected ? 1.5 : 1,
        },
        labelBgPadding: [6, 3] as [number, number],
        style: {
          ...(e.style || {}),
          stroke: isSelected ? '#4f46e5' : condition ? '#6366f1' : '#818cf8',
          strokeWidth: isSelected ? 2.6 : 1.8,
          filter: isSelected ? 'drop-shadow(0 0 5px rgba(79, 70, 229, 0.45))' : undefined,
        },
      };
    });
  }, [edges, selectedEdgeId]);

  // 取消新节点呼吸态
  useEffect(() => {
    const timer = setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => (n.data?.isNew ? { ...n, data: { ...n.data, isNew: false } } : n))
      );
    }, 4500);
    return () => clearTimeout(timer);
  }, [nodes]);

  // 快捷一键自动排版 (Auto Layout)
  const handleAutoLayout = useCallback(() => {
    if (import.meta.env?.DEV) {
      console.log('[Workflow:Layout] 触发一键 DAG 自动排版计算');
    }
    const layouted = layoutWorkflowDag(nodes, edges);
    setNodes(layouted);
    setTimeout(() => {
      reactFlow.fitView({ padding: 0.3, maxZoom: 1, duration: 500 });
    }, 50);
  }, [nodes, edges, reactFlow]);

  // 触发幽灵方案预演 (在画布上呈现半透明与流光连线)
  const handlePreviewWorkflowAction = useCallback(
    (actionPayload: WorkflowActionPayload, messageId?: string) => {
      if (!actionPayload) return;

      if (import.meta.env?.DEV) {
        console.log('[Workflow:GhostPreview] 激活预演方案:', {
          action: actionPayload.action,
          messageId,
        });
      }

      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const currentGhost = ghostPreviewRef.current;

      // 备份当前真实节点与连线 (排除现有幽灵节点)
      let baseNodes = currentGhost
        ? currentGhost.originalNodes
        : currentNodes.filter((n) => !n.data?.isGhost);
      let baseEdges = currentGhost
        ? currentGhost.originalEdges
        : currentEdges.filter((e) => !e.data?.isGhost);

      // 安全基准兜底：若 baseNodes 为空，但 activeWorkflow 中存在有效节点，以 activeWorkflow 为基准避免画布空白
      if (
        baseNodes.length === 0 &&
        activeWorkflowRef.current?.nodes &&
        activeWorkflowRef.current.nodes.length > 0
      ) {
        baseNodes = activeWorkflowRef.current.nodes.map((n) => ({
          id: n.id,
          type: 'customNode',
          position: n.position || { x: 100, y: 100 },
          data: {
            id: n.id,
            name: n.name,
            type: n.type,
            config: n.config,
          },
        }));
        baseEdges = activeWorkflowRef.current.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: true,
          style: { stroke: '#4f46e5', strokeWidth: 1.8 },
        }));
      }

      let previewNodes: Node[] = [];
      let previewEdges: Edge[] = [];
      let summaryText = '';

      if (actionPayload.action === 'replace_all' && actionPayload.workflow) {
        const wf = actionPayload.workflow;
        previewNodes = (wf.nodes || []).map((n) => ({
          id: n.id,
          type: 'customNode',
          position: n.position || { x: 0, y: 0 },
          data: {
            id: n.id,
            name: n.name,
            type: n.type,
            config: n.config || {},
            isGhost: true,
          },
        }));

        previewEdges = (wf.edges || []).map((e) => ({
          id: e.id || `e_${e.source}_${e.target}`,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 2, strokeDasharray: '5,5' },
        }));

        summaryText = `全量规划：包含 ${previewNodes.length} 个流水线阶段`;
      } else if (actionPayload.action === 'patch') {
        previewNodes = [...baseNodes];
        previewEdges = [...baseEdges];

        // 1. 删除节点与连线
        if (actionPayload.removeNodeIds && actionPayload.removeNodeIds.length > 0) {
          const toRemove = new Set(actionPayload.removeNodeIds);
          previewNodes = previewNodes.filter((n) => !toRemove.has(n.id));
          previewEdges = previewEdges.filter(
            (e) => !toRemove.has(e.source) && !toRemove.has(e.target)
          );
        }
        if (actionPayload.removeEdgeIds && actionPayload.removeEdgeIds.length > 0) {
          const toRemoveEdges = new Set(actionPayload.removeEdgeIds);
          previewEdges = previewEdges.filter((e) => !toRemoveEdges.has(e.id));
        }

        // 2. 更新既有节点
        if (actionPayload.updateNodes && actionPayload.updateNodes.length > 0) {
          const updateMap = new Map(actionPayload.updateNodes.map((u) => [u.id!, u]));
          previewNodes = previewNodes.map((n) => {
            const patch = updateMap.get(n.id);
            if (!patch) return n;
            return {
              ...n,
              data: {
                ...n.data,
                name: patch.name || n.data.name,
                config: { ...n.data.config, ...(patch.config || {}) },
                isGhost: true,
              },
            };
          });
        }

        // 3. 追加新节点 (幽灵态)
        if (actionPayload.addNodes && actionPayload.addNodes.length > 0) {
          const existingIds = new Set(previewNodes.map((n) => n.id));
          for (const n of actionPayload.addNodes) {
            if (!existingIds.has(n.id)) {
              previewNodes.push({
                id: n.id,
                type: 'customNode',
                position: n.position || { x: 0, y: 0 },
                data: {
                  id: n.id,
                  name: n.name,
                  type: n.type,
                  config: n.config || {},
                  isGhost: true,
                },
              });
            }
          }
        }

        // 4. 追加新连线 (幽灵态)
        if (actionPayload.addEdges && actionPayload.addEdges.length > 0) {
          const existingEdgeIds = new Set(previewEdges.map((e) => e.id));
          for (const e of actionPayload.addEdges) {
            const edgeId = e.id || `e_${e.source}_${e.target}`;
            if (!existingEdgeIds.has(edgeId)) {
              previewEdges.push({
                id: edgeId,
                source: e.source,
                target: e.target,
                label: e.label,
                animated: true,
                style: { stroke: '#8b5cf6', strokeWidth: 2, strokeDasharray: '5,5' },
              });
            }
          }
        }

        // 动态生成直观的提示摘要
        const parts: string[] = [];
        if (actionPayload.removeNodeIds && actionPayload.removeNodeIds.length > 0) {
          parts.push(`移除 ${actionPayload.removeNodeIds.length} 个阶段`);
        }
        if (actionPayload.addNodes && actionPayload.addNodes.length > 0) {
          parts.push(`新增 ${actionPayload.addNodes.length} 个阶段`);
        }
        if (actionPayload.updateNodes && actionPayload.updateNodes.length > 0) {
          parts.push(`调整 ${actionPayload.updateNodes.length} 个阶段`);
        }
        summaryText = parts.length > 0 ? `链路局部调整：${parts.join('，')}` : '链路局部微调，更新拓扑依赖';
      }

      // 异常保护：若 previewNodes 意外为空，但原始基准存在节点，则不盲目清空画布
      if (previewNodes.length === 0 && baseNodes.length > 0 && actionPayload.action === 'patch') {
        console.warn('[Workflow:GhostPreview] 预演计算后节点为空，保留基准节点避免画布空白');
        previewNodes = [...baseNodes];
        previewEdges = [...baseEdges];
      }

      const layoutedNodes = layoutWorkflowDag(previewNodes, previewEdges);
      setNodes(layoutedNodes);
      setEdges(previewEdges);

      setGhostPreview({
        active: true,
        originalNodes: baseNodes,
        originalEdges: baseEdges,
        actionPayload,
        messageId,
        summary: summaryText,
      });

      setTimeout(() => {
        reactFlow.fitView({ padding: 0.3, maxZoom: 1, duration: 500 });
      }, 60);
    },
    [reactFlow]
  );
  handlePreviewRef.current = handlePreviewWorkflowAction;

  // 一键正式合入幽灵预演方案到画布 (Apply Commit) 并自动保存到后端数据库
  const handleCommitGhostPreview = useCallback(async () => {
    const currentGhost = ghostPreviewRef.current;
    if (!currentGhost) return;

    if (import.meta.env?.DEV) {
      console.log('[Workflow:ApplyCommit] 采纳合入预演方案并持久化保存');
    }

    // 保存当前真实状态供撤销 (Undo)
    setUndoSnapshot({
      nodes: currentGhost.originalNodes,
      edges: currentGhost.originalEdges,
    });

    // 固化节点与边
    const committedNodes = nodesRef.current.map((n) => ({
      ...n,
      data: {
        ...n.data,
        isGhost: false,
        isNew: true,
      },
    }));

    const committedEdges = edgesRef.current.map((e) => ({
      ...e,
      style: { stroke: '#4f46e5', strokeWidth: 1.8 },
    }));

    setNodes(committedNodes);
    setEdges(committedEdges);

    if (currentGhost.messageId) {
      setAppliedActionIds((prev) => {
        const next = new Set([...prev, currentGhost.messageId!]);
        try {
          localStorage.setItem(
            `openloop:wf_applied_actions:${workflowId}`,
            JSON.stringify(Array.from(next))
          );
        } catch {}
        return next;
      });
    }

    setGhostPreview(null);

    // 自动持久化保存到后端数据库，并刷新外部列表缓存
    const targetWf = activeWorkflowRef.current;
    if (targetWf) {
      const updatedWorkflow: WorkflowDefinition = {
        ...targetWf,
        name: workflowName || targetWf.name,
        description: workflowDescription || targetWf.description,
        nodes: committedNodes.map((n) => ({
          id: n.id,
          name: (n.data as any)?.name || '未命名节点',
          type: (n.data as any)?.type || 'cli',
          position: n.position,
          config: (n.data as any)?.config || {},
        })),
        edges: committedEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: (e.data as any)?.label ?? e.label,
          condition: (e.data as any)?.condition,
        })),
      };

      setSaveStatus('方案已合入并自动保存');
      try {
        await api.saveWorkflow(updatedWorkflow);
        setTimeout(() => setSaveStatus(''), 2500);
        onRefresh();
      } catch (err: any) {
        console.error('[Workflow:ApplyCommit] 自动保存失败:', err);
        setSaveStatus(`自动保存失败: ${err.message}`);
      }
    }
  }, [workflowId, workflowName, workflowDescription, onRefresh]);

  // 放弃预演 (Discard Ghost Preview)
  const handleDiscardGhostPreview = useCallback(() => {
    const currentGhost = ghostPreviewRef.current;
    if (!currentGhost) return;

    if (import.meta.env?.DEV) {
      console.log('[Workflow:Discard] 放弃预演方案');
    }

    let fallbackNodes = currentGhost.originalNodes;
    let fallbackEdges = currentGhost.originalEdges;

    // 安全回退：如果原始节点被异常保存为空，自动从 activeWorkflow 恢复完整拓扑
    if (
      fallbackNodes.length === 0 &&
      activeWorkflowRef.current?.nodes &&
      activeWorkflowRef.current.nodes.length > 0
    ) {
      fallbackNodes = activeWorkflowRef.current.nodes.map((n) => ({
        id: n.id,
        type: 'customNode',
        position: n.position || { x: 100, y: 100 },
        data: {
          id: n.id,
          name: n.name,
          type: n.type,
          config: n.config,
        },
      }));
      fallbackEdges = activeWorkflowRef.current.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: true,
        style: { stroke: '#4f46e5', strokeWidth: 1.8 },
      }));
    }

    setNodes(fallbackNodes);
    setEdges(fallbackEdges);
    setGhostPreview(null);

    setTimeout(() => {
      reactFlow.fitView({ padding: 0.3, maxZoom: 1, duration: 400 });
    }, 50);
  }, [reactFlow]);

  // 直接全量/增量应用 (兼容历史消息里的直接应用)
  const applyWorkflowAction = useCallback(
    (actionPayload: WorkflowActionPayload, messageId?: string) => {
      handlePreviewWorkflowAction(actionPayload, messageId);
      // 紧接着立即合入
      setTimeout(() => {
        handleCommitGhostPreview();
      }, 50);
    },
    [handlePreviewWorkflowAction, handleCommitGhostPreview]
  );

  // 键盘快捷键 (Enter 采纳预演，Esc 放弃预演或取消选中节点)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (ghostPreview?.active) {
        if (e.key === 'Enter' && !e.shiftKey) {
          const target = e.target as HTMLElement;
          if (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT') {
            e.preventDefault();
            handleCommitGhostPreview();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleDiscardGhostPreview();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (selectedNodeId) {
          setSelectedNodeId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ghostPreview, selectedNodeId, handleCommitGhostPreview, handleDiscardGhostPreview]);

  // 撤销上一步编排变更
  const handleUndo = useCallback(() => {
    if (!undoSnapshot) return;
    setNodes(undoSnapshot.nodes);
    setEdges(undoSnapshot.edges);
    setUndoSnapshot(null);
    setTimeout(() => {
      reactFlow.fitView({ padding: 0.3, maxZoom: 1, duration: 500 });
    }, 50);
  }, [undoSnapshot, reactFlow]);

  // 发送消息给 Copilot
  const handleSendMessage = async (textToSend?: string) => {
    const content = (textToSend || inputMessage).trim();
    if (!content || isSendingMessage) return;

    scrollCopilotToBottom(true);

    if (import.meta.env?.DEV) {
      console.log('[Workflow:Dispatch] 发送编排指令:', {
        workflowId,
        content: content.slice(0, 40),
        focusNodeId: selectedNodeId || null,
      });
    }

    // 若当前正在预演旧方案，先清除
    if (ghostPreview) {
      handleDiscardGhostPreview();
    }

    setInputMessage('');
    setIsSendingMessage(true);
    // 自动展开右侧栏并切到助手
    setIsSidebarOpen(true);
    setSidebarTab('copilot');

    // 构建当前真实画布快照上下文 (排除幽灵节点)
    const realNodes = nodes.filter((n) => !n.data?.isGhost);
    const realEdges = edges.filter((e) => !e.data?.isGhost);

    const snapshot = {
      name: activeWorkflow?.name,
      focusNodeId: selectedNodeId || undefined,
      nodes: realNodes.map((n) => ({
        id: n.id,
        name: (n.data as any).name,
        type: (n.data as any).type,
        config: (n.data as any).config,
      })),
      edges: realEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: (e.data as any)?.label ?? e.label,
        condition: (e.data as any)?.condition,
      })),
    };

    // 乐观 UI 插入用户消息
    const userMsg: SessionChatMessage = {
      id: `opt_u_${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setCopilotState((prev) => ({
      workflowId,
      active: true,
      isBusy: true,
      isPaused: false,
      messages: [...(prev?.messages || []), userMsg],
      agentName: 'Workflow Copilot',
    }));

    try {
      await api.sendWorkflowChatMessage(workflowId, content, snapshot);

      // 设置 10 秒前端超时兜底，防止网络或后端挂起时一直转圈
      setTimeout(() => {
        setCopilotState((prev) => (prev?.isBusy ? { ...prev, isBusy: false } : prev));
      }, 10000);
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 发送编排需求失败:', err);
      }
      toast.error(`发送编排需求失败: ${err?.message || '未知错误'}`);
      setCopilotState((prev) => (prev ? { ...prev, isBusy: false } : prev));
    } finally {
      setIsSendingMessage(false);
    }
  };

  // 重置对话（点击触发自研确认弹窗）
  const handleResetSession = () => {
    setIsResetSessionModalOpen(true);
  };

  // 确认执行重置对话
  const handleConfirmResetSession = async () => {
    if (isResettingSession) return;
    setIsResettingSession(true);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowEditor] 执行重置 AI 对话历史:', workflowId);
    }
    try {
      await api.resetWorkflowSession(workflowId);
      setCopilotState((prev) => (prev ? { ...prev, messages: [] } : null));
      setAppliedActionIds(new Set());
      try {
        localStorage.removeItem(`openloop:wf_applied_actions:${workflowId}`);
      } catch {}
      setIsResetSessionModalOpen(false);
      toast.success('AI 对话历史已重置');
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 重置 AI 对话历史失败:', err);
      }
      toast.error(`重置失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsResettingSession(false);
    }
  };

  // 手工添加节点
  const addNode = (type: NodeType | 'git-commit' | 'deploy', label: string) => {
    const isGit = type === 'git-commit';
    const isDeploy = type === 'deploy';
    const actualType: NodeType = isGit || isDeploy ? 'cli' : (type as NodeType);
    const id = `node_${actualType}_${Date.now().toString(36).substring(3, 7)}`;
    const defaultCommand = isGit
      ? 'git add -A && if git diff --staged --quiet; then echo "工作区干净，无需提交"; else git commit -m "feat: {{task.title}}" && git log -1 --stat; fi'
      : isDeploy
      ? 'echo "[部署] 开始应用构建与部署..." && pnpm build && if [ -f "scripts/deploy.sh" ]; then bash scripts/deploy.sh --skip-build; fi'
      : actualType === 'cli'
      ? 'echo "cli task"'
      : '';

    const newNode: Node = {
      id,
      type: 'customNode',
      position: { x: 220 + Math.random() * 80, y: 120 + Math.random() * 80 },
      data: {
        id,
        name: label,
        type: actualType,
        config: {
          command: defaultCommand,
          prompt: actualType === 'agent' ? '按需求完成功能' : '',
          testUrl: actualType === 'midscene' ? 'http://localhost:3000' : '',
        },
        isNew: true,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(id);
    setIsInspectorOpen(true);
  };

  // 属性更新
  const updateSelectedNodeConfig = (key: string, value: any) => {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === selectedNodeId) {
          const prevConfig = (n.data as any).config || {};
          return {
            ...n,
            data: {
              ...(n.data as any),
              config: {
                ...prevConfig,
                [key]: value,
              },
            },
          };
        }
        return n;
      })
    );
  };

  const updateSelectedNodeName = (name: string) => {
    if (!selectedNodeId) return;
    setNodes((nds) =>
      nds.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...(n.data as any), name } } : n))
    );
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId)
    );
    setSelectedNodeId(null);
  };

  // 连线与分支属性管理
  const selectedEdge = useMemo(
    () => edges.find((e) => e.id === selectedEdgeId),
    [edges, selectedEdgeId]
  );

  const edgeSourceNode = useMemo(
    () => (selectedEdge ? nodes.find((n) => n.id === selectedEdge.source) : null),
    [nodes, selectedEdge]
  );
  const edgeTargetNode = useMemo(
    () => (selectedEdge ? nodes.find((n) => n.id === selectedEdge.target) : null),
    [nodes, selectedEdge]
  );

  const updateSelectedEdge = (updates: { label?: string; condition?: string }) => {
    if (!selectedEdgeId) return;
    setEdges((eds) =>
      eds.map((e) => {
        if (e.id !== selectedEdgeId) return e;
        const prevData = (e.data as any) || {};
        const nextCondition = updates.condition !== undefined ? updates.condition : (prevData.condition ?? '');
        const nextLabel = updates.label !== undefined ? updates.label : (prevData.label ?? e.label ?? '');
        return {
          ...e,
          label: nextLabel || (nextCondition ? `[条件] ${nextCondition}` : undefined),
          data: {
            ...prevData,
            condition: nextCondition,
            label: nextLabel,
          },
        };
      })
    );
  };

  const deleteSelectedEdge = () => {
    if (!selectedEdgeId) return;
    if (import.meta.env?.DEV) {
      console.log('[Workflow:DeleteEdge] 删除连线:', selectedEdgeId);
    }
    setEdges((eds) => eds.filter((e) => e.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  };

  // 保存工作流
  const handleSave = async (overrideName?: string, overrideDesc?: string, overrideTags?: string[]) => {
    if (!activeWorkflow) return;

    const safeOverrideName = typeof overrideName === 'string' ? overrideName : undefined;
    const safeOverrideDesc = typeof overrideDesc === 'string' ? overrideDesc : undefined;
    const safeOverrideTags = Array.isArray(overrideTags) ? overrideTags : undefined;

    const finalName = (safeOverrideName ?? workflowName).trim() || activeWorkflow.name;
    const finalDesc = (safeOverrideDesc ?? workflowDescription).trim();
    const finalTags = safeOverrideTags ?? workflowTags;

    const updatedWorkflow: WorkflowDefinition = {
      ...activeWorkflow,
      name: finalName,
      description: finalDesc,
      tags: finalTags,
      requireWorkspace: workflowRequireWorkspace,
      defaultWorkspace: workflowDefaultWorkspace.trim() || undefined,
      updatedAt: Date.now(),
      nodes: nodes.map((n) => ({
        id: n.id,
        name: (n.data as any).name,
        type: (n.data as any).type,
        position: n.position,
        config: (n.data as any).config || {},
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: (e.data as any)?.label ?? e.label,
        condition: (e.data as any)?.condition,
      })),
    };

    if (import.meta.env?.DEV) {
      console.log('[WorkflowEditor] 保存工作流编排:', {
        id: updatedWorkflow.id,
        name: updatedWorkflow.name,
        nodeCount: updatedWorkflow.nodes.length,
        edgeCount: updatedWorkflow.edges.length,
      });
    }

    setSaveStatus('保存中...');
    try {
      await api.saveWorkflow(updatedWorkflow);
      setWorkflowName(finalName);
      setWorkflowDescription(finalDesc);
      setSaveStatus('已保存');
      setTimeout(() => setSaveStatus(''), 2000);
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 保存工作流失败:', err);
      }
      setSaveStatus(`保存失败: ${err.message}`);
    }
  };

  // 复制当前工作流
  const handleDuplicateCurrentWorkflow = async () => {
    if (!activeWorkflow || isDuplicating) return;
    setIsDuplicating(true);
    const newId = `wf_${Date.now().toString(36)}`;
    const clonedWf: WorkflowDefinition = {
      ...activeWorkflow,
      id: newId,
      name: `${workflowName || activeWorkflow.name} (副本)`,
      description: workflowDescription || activeWorkflow.description || '',
      tags: Array.isArray(workflowTags) ? [...workflowTags] : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: nodes.map((n) => ({
        id: n.id,
        name: (n.data as any).name,
        type: (n.data as any).type,
        position: n.position,
        config: (n.data as any).config || {},
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: (e.data as any)?.label ?? e.label,
        condition: (e.data as any)?.condition,
      })),
      variables: activeWorkflow.variables
        ? JSON.parse(JSON.stringify(activeWorkflow.variables))
        : undefined,
    };

    if (import.meta.env?.DEV) {
      console.log('[WorkflowEditor] 发起流程复制:', {
        fromId: activeWorkflow.id,
        newId: clonedWf.id,
        name: clonedWf.name,
      });
    }

    try {
      await api.saveWorkflow(clonedWf);
      if (import.meta.env?.DEV) {
        console.log('[WorkflowEditor] 流程复制成功:', clonedWf.id);
      }
      toast.success(`流程已复制为「${clonedWf.name}」`);
      onRefresh();
      if (onSelectWorkflow) {
        onSelectWorkflow(newId);
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 流程复制失败:', err);
      }
      toast.error(`复制工作流失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsDuplicating(false);
    }
  };

  // 确认删除当前工作流
  const handleConfirmDeleteCurrentWorkflow = async () => {
    if (!activeWorkflow || isDeleting) return;

    setIsDeleting(true);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowEditor] 执行删除流程:', activeWorkflow.id);
    }

    try {
      await api.deleteWorkflow(activeWorkflow.id);
      if (import.meta.env?.DEV) {
        console.log('[WorkflowEditor] 流程删除成功:', activeWorkflow.id);
      }
      toast.success(`流程「${activeWorkflow.name}」已成功删除`);
      setIsDeleteModalOpen(false);
      onRefresh();
      onBack();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 删除工作流失败:', err);
      }
      toast.error(`删除工作流失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // 页面加载或工作流切换时，自动探测当前工作流是否存在活跃执行中的调试任务并绑定监控
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const tasks = await api.getTasks();
        if (!isMounted) return;
        const runningTask = tasks.find(
          (t) =>
            t.workflowId === workflowId &&
            t.triggerSource === 'debug' &&
            (t.status === 'running' || t.status === 'waiting_approval' || t.status === 'pending')
        );
        if (runningTask && !activeDebugTaskId && !dismissedDebugTaskIdsRef.current.has(runningTask.id)) {
          if (import.meta.env?.DEV) {
            console.log('[WorkflowEditor] 自动发现并恢复关联正在运行的调试任务:', runningTask.id);
          }
          setActiveDebugTaskId(runningTask.id);
          setDebugTask(runningTask);
        }
      } catch (err) {
        // 静默处理获取失败
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [workflowId]);

  // 轮询监控调试任务执行状态
  useEffect(() => {
    if (!activeDebugTaskId) return;

    let isMounted = true;
    let timerId: any = null;
    let clockInterval: any = null;

    clockInterval = setInterval(() => {
      setDebugTimerSeconds((s) => s + 1);
    }, 1000);

    const pollTaskStatus = async () => {
      try {
        const latest = await api.getTask(activeDebugTaskId);
        if (!isMounted) return;
        setDebugTask(latest);

        if (latest.status === 'completed' || latest.status === 'failed' || latest.status === 'cancelled') {
          if (clockInterval) clearInterval(clockInterval);
          if (timerId) clearTimeout(timerId);
          onRefresh();
          return;
        }

        timerId = setTimeout(pollTaskStatus, 1200);
      } catch (err) {
        if (import.meta.env?.DEV) {
          console.warn('[WorkflowEditor] 轮询调试任务状态异常:', err);
        }
        if (isMounted) {
          timerId = setTimeout(pollTaskStatus, 2500);
        }
      }
    };

    pollTaskStatus();

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
      if (clockInterval) clearInterval(clockInterval);
    };
  }, [activeDebugTaskId]);

  // 当调试任务运行状态或节点流转变化时，动态将状态注入 ReactFlow nodes
  useEffect(() => {
    if (!debugTask) return;
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        const run = debugTask.nodeRuns?.[n.id];
        let executionStatus: string | undefined = run?.status;
        if (!executionStatus && debugTask.currentNodeId === n.id && (debugTask.status === 'running' || debugTask.status === 'pending')) {
          executionStatus = 'running';
        }
        const executionDuration =
          run?.finishedAt && run?.startedAt
            ? Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000))
            : undefined;

        return {
          ...n,
          data: {
            ...n.data,
            executionStatus,
            executionDuration,
            executionError: run?.error,
            onInspectLogs: (nodeId: string) => onOpenTaskLogs(debugTask.id, nodeId),
            onInspectSession: (nodeId: string) =>
              handleOpenAgentSession(debugTask.id, nodeId, (n.data as any)?.name),
          },
        };
      })
    );
  }, [debugTask, onOpenTaskLogs]);

  // 启动编排调试全流程
  const handleStartDebug = async ({
    title,
    description,
    workspace,
    openLogsImmediately,
  }: {
    title: string;
    description: string;
    workspace?: string;
    openLogsImmediately: boolean;
  }) => {
    if (!activeWorkflow || isRunningDebug) return;
    setIsRunningDebug(true);

    if (import.meta.env?.DEV) {
      console.log('[WorkflowEditor] 发起编排调试执行:', {
        workflowId: activeWorkflow.id,
        workflowName: activeWorkflow.name,
        title,
        workspace,
      });
    }

    try {
      // 1. 调试前自动同步保存画布最新变动
      await handleSave();

      // 2. 创建调试任务
      const task = await api.createTask({
        title,
        description: description || undefined,
        workflowId: activeWorkflow.id,
        workspace: workspace || undefined,
        autoRun: true,
        triggerSource: 'debug',
      });

      if (import.meta.env?.DEV) {
        console.log('[WorkflowEditor] 调试任务已创建并启动:', task.id);
      }

      setActiveDebugTaskId(task.id);
      setDebugTask(task);
      setDebugTimerSeconds(0);
      onRefresh();

      toast.success(`编排调试任务已触发 (${task.id})`, {
        description: `已根据流程「${activeWorkflow.name}」启动执行链路`,
        action: {
          label: '查看日志',
          onClick: () => onOpenTaskLogs(task.id, task.currentNodeId),
        },
      });

      if (openLogsImmediately) {
        onOpenTaskLogs(task.id, task.currentNodeId);
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 启动调试失败:', err);
      }
      toast.error(`启动调试失败: ${err?.message || '未知错误'}`);
      throw err;
    } finally {
      setIsRunningDebug(false);
    }
  };

  // 中止当前调试运行
  const handleCancelDebug = async () => {
    if (!debugTask || isCancellingDebug) return;
    setIsCancellingDebug(true);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowEditor] 中止调试任务:', debugTask.id);
    }
    try {
      const updated = await api.cancelTask(debugTask.id);
      setDebugTask(updated);
      toast.info(`调试任务已中止 (${debugTask.id})`);
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 中止调试任务失败:', err);
      }
      toast.error(`中止失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsCancellingDebug(false);
    }
  };

  // 单独重试指定节点
  const handleRetryNode = async (nodeId: string) => {
    if (!debugTask) return;
    try {
      if (import.meta.env?.DEV) {
        console.log('[WorkflowEditor] 重试调试节点:', debugTask.id, nodeId);
      }
      const updated = await api.retryNode(debugTask.id, nodeId);
      setDebugTask(updated);
      toast.success(`已触发节点「${nodeId}」重试`);
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 重试节点失败:', err);
      }
      toast.error(`重试节点失败: ${err?.message || '未知错误'}`);
    }
  };

  // 跳过指定节点
  const handleSkipNode = async (nodeId: string) => {
    if (!debugTask) return;
    try {
      if (import.meta.env?.DEV) {
        console.log('[WorkflowEditor] 跳过调试节点:', debugTask.id, nodeId);
      }
      const updated = await api.skipNode(debugTask.id, nodeId);
      setDebugTask(updated);
      toast.info(`已跳过节点「${nodeId}」`);
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 跳过节点失败:', err);
      }
      toast.error(`跳过节点失败: ${err?.message || '未知错误'}`);
    }
  };

  // 通过或驳回人工门禁
  const handleApproveGate = async (approved: boolean) => {
    if (!debugTask || isApprovingGate) return;
    setIsApprovingGate(true);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowEditor] 门禁审核操作:', debugTask.id, approved);
    }
    try {
      const updated = await api.resumeTask(
        debugTask.id,
        approved,
        approved ? '调试门禁通过' : '验收驳回'
      );
      setDebugTask(updated);
      toast.success(approved ? '门禁审核已通过，继续执行' : '已驳回门禁审核');
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 门禁审核失败:', err);
      }
      toast.error(`门禁操作失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsApprovingGate(false);
    }
  };

  // 退出调试并彻底恢复画布编辑模式
  const handleExitDebug = async (cancelTask = false) => {
    if (
      cancelTask &&
      debugTask &&
      (debugTask.status === 'running' ||
        debugTask.status === 'waiting_approval' ||
        debugTask.status === 'pending')
    ) {
      try {
        await api.cancelTask(debugTask.id);
        toast.info(`调试任务已中止 (${debugTask.id})`);
      } catch (err: any) {
        if (import.meta.env?.DEV) {
          console.error('[WorkflowEditor] 中止调试任务失败:', err);
        }
      }
    }
    if (activeDebugTaskId) {
      dismissedDebugTaskIdsRef.current.add(activeDebugTaskId);
    }
    setActiveDebugTaskId(null);
    setDebugTask(null);

    // 彻底清除画布节点执行状态高亮，恢复纯净编辑模式
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        const {
          executionStatus,
          executionDuration,
          executionError,
          onInspectLogs,
          ...restData
        } = (n.data as any) || {};
        return {
          ...n,
          data: restData,
        };
      })
    );
    setIsExitDebugModalOpen(false);
    onRefresh();
    toast.info('已退出编排调试');
  };

  // 立即触发测试运行（打开弹窗配置）
  const handleRunNow = async () => {
    setIsDebugModalOpen(true);
  };

  if (!activeWorkflow) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#f4f4f6]">
        <div className="text-[13px] text-[#85858d] mb-3">未找到指定流程</div>
        <button
          onClick={onBack}
          className="h-[28px] px-3 rounded-[6px] bg-white border border-[#e3e3e8] text-[12px] text-[#1c1c21]"
        >
          返回流程列表
        </button>
      </div>
    );
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedNodeData = selectedNode?.data as any;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-hidden select-none">
      {/* 编排器顶栏 (openLoop 极简设计系统，极致克制与现代感) */}
      <div className="h-[48px] px-4 bg-white border-b border-[#e3e3e8] flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-2.5 shrink-0">
          {/* 返回按钮 */}
          <button
            onClick={() => {
              if (import.meta.env?.DEV) console.log('[WorkflowEditor] 返回流程列表');
              onBack();
            }}
            className="flex items-center gap-1 h-[28px] px-2 rounded-[6px] hover:bg-[#f1f1f4] text-[12px] font-medium text-[#63636b] hover:text-[#1c1c21] transition-all cursor-pointer whitespace-nowrap"
            title="返回流程列表"
          >
            <ArrowLeft size={13} strokeWidth={2} />
            <span>返回</span>
          </button>

          <div className="w-[1px] h-3.5 bg-[#e3e3e8] shrink-0" />

          {/* 流程名称与快速修改 */}
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                autoFocus
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const trimmed = titleDraft.trim();
                    if (trimmed) {
                      setWorkflowName(trimmed);
                      handleSave(trimmed);
                    }
                    setIsEditingTitle(false);
                  } else if (e.key === 'Escape') {
                    setTitleDraft(workflowName);
                    setIsEditingTitle(false);
                  }
                }}
                onBlur={() => {
                  const trimmed = titleDraft.trim();
                  if (trimmed && trimmed !== workflowName) {
                    setWorkflowName(trimmed);
                    handleSave(trimmed);
                  }
                  setIsEditingTitle(false);
                }}
                className="h-[28px] px-2 text-[13px] font-semibold text-[#1c1c21] bg-[#f9f9fb] border border-[#4f46e5] rounded-[6px] outline-none shadow-xs"
              />
              <button
                type="button"
                onClick={() => {
                  const trimmed = titleDraft.trim();
                  if (trimmed) {
                    setWorkflowName(trimmed);
                    handleSave(trimmed);
                  }
                  setIsEditingTitle(false);
                }}
                className="p-1 rounded hover:bg-[#e4f6ec] text-[#189a58] transition-colors cursor-pointer"
                title="确定修改"
              >
                <Check size={13} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(workflowName);
                  setIsEditingTitle(false);
                }}
                className="p-1 rounded hover:bg-[#f1f1f4] text-[#85858d] transition-colors cursor-pointer"
                title="取消修改"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 shrink-0 group/title">
              <span
                onClick={() => {
                  setTitleDraft(workflowName);
                  setIsEditingTitle(true);
                }}
                className="text-[13.5px] font-semibold text-[#1c1c21] hover:text-[#4f46e5] cursor-pointer transition-colors whitespace-nowrap max-w-[200px] truncate"
                title="点击重命名流程"
              >
                {workflowName || activeWorkflow.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(workflowName);
                  setIsEditingTitle(true);
                }}
                className="p-0.5 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] opacity-0 group-hover/title:opacity-100 transition-all cursor-pointer"
                title="快速重命名"
              >
                <Edit3 size={11} />
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(activeWorkflow.id);
                    toast.success(`流程 ID 已复制: ${activeWorkflow.id}`);
                  } catch {}
                }}
                className="text-[10px] font-mono text-[#85858d] hover:text-[#1c1c21] bg-[#f4f4f7] hover:bg-[#ececf0] px-1.5 py-[1.5px] rounded border border-[#ececf0] transition-colors whitespace-nowrap cursor-pointer shrink-0 max-w-[120px] truncate"
                title="点击复制流程 ID"
              >
                {activeWorkflow.id}
              </button>
            </div>
          )}

          <div className="text-[10.5px] text-[#85858d] font-mono whitespace-nowrap shrink-0">
            ({nodes.length} 节点)
          </div>
        </div>

        {/* 右侧动作群 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {undoSnapshot && (
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 h-[28px] px-2 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11px] font-medium text-[#4b4b53] transition-all shadow-2xs whitespace-nowrap cursor-pointer"
              title="撤销上一次编排变更"
            >
              <Undo2 size={11.5} />
              <span>撤销</span>
            </button>
          )}

          {/* 自动排版按钮 */}
          <button
            onClick={() => {
              if (import.meta.env?.DEV) console.log('[WorkflowEditor] 自动排版 DAG 拓扑');
              handleAutoLayout();
            }}
            className="flex items-center gap-1 h-[28px] px-2 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11px] font-medium text-[#4b4b53] transition-all shadow-2xs whitespace-nowrap cursor-pointer"
            title="使用 DAG 层次算法自动对齐连线"
          >
            <LayoutGrid size={11.5} className="text-[#4f46e5]" />
            <span>排版</span>
          </button>

          {/* 复制流程 */}
          <button
            onClick={handleDuplicateCurrentWorkflow}
            disabled={isDuplicating}
            className="flex items-center gap-1 h-[28px] px-2 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11px] font-medium text-[#4b4b53] transition-all shadow-2xs disabled:opacity-50 whitespace-nowrap cursor-pointer"
            title="克隆当前编排副本"
          >
            {isDuplicating ? (
              <Loader2 size={11} className="animate-spin text-[#4f46e5]" />
            ) : (
              <Copy size={11} />
            )}
            <span>克隆</span>
          </button>

          {/* 属性配置面板开关 */}
          <button
            onClick={() => {
              if (isSidebarOpen && sidebarTab === 'inspector') {
                setIsSidebarOpen(false);
              } else {
                setIsSidebarOpen(true);
                setSidebarTab('inspector');
              }
            }}
            className={`flex items-center gap-1 h-[28px] px-2 rounded-[6px] border text-[11px] font-medium transition-all shadow-2xs whitespace-nowrap cursor-pointer ${
              isSidebarOpen && sidebarTab === 'inspector'
                ? 'bg-[#1c1c21] border-[#1c1c21] text-white'
                : 'bg-white border-[#e3e3e8] hover:bg-[#f1f1f4] text-[#4b4b53]'
            }`}
            title="查看属性与配置"
          >
            <Settings2 size={11.5} />
            <span>{selectedNode ? '属性' : '配置'}</span>
            {(selectedNode || selectedEdge) && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isSidebarOpen && sidebarTab === 'inspector' ? 'bg-white' : 'bg-[#4f46e5]'
                }`}
              />
            )}
          </button>

          {/* 删除流程 */}
          <button
            onClick={() => setIsDeleteModalOpen(true)}
            className="flex items-center justify-center w-[26px] h-[28px] rounded-[6px] text-[#85858d] hover:bg-[#fff1f2] hover:text-[#e11d48] transition-all cursor-pointer"
            title="删除此流程"
          >
            <Trash2 size={12} />
          </button>

          <div className="w-[1px] h-3.5 bg-[#e3e3e8]" />

          {/* AI 编排助手唤起按钮 */}
          <button
            onClick={() => {
              if (isSidebarOpen && sidebarTab === 'copilot') {
                setIsSidebarOpen(false);
              } else {
                setIsSidebarOpen(true);
                setSidebarTab('copilot');
              }
            }}
            className={`flex items-center gap-1.5 h-[28px] px-2.5 rounded-[6px] border transition-all shadow-2xs text-[11px] font-medium whitespace-nowrap cursor-pointer ${
              isSidebarOpen && sidebarTab === 'copilot'
                ? 'bg-[#eeedfd] border-[#c7d2fe] text-[#4f46e5]'
                : 'bg-white border-[#e3e3e8] hover:bg-[#f1f1f4] text-[#1c1c21]'
            }`}
            title="展开/收起 AI 编排助手"
          >
            <Sparkles
              size={11.5}
              className={copilotState?.isBusy ? 'text-[#7c3aed] animate-spin' : 'text-[#4f46e5]'}
            />
            <span>AI 助手</span>
            {copilotState?.isBusy && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-pulse" />
            )}
          </button>

          <div className="w-[1px] h-3.5 bg-[#e3e3e8]" />

          {saveStatus && (
            <span className="text-[11px] text-[#189a58] font-medium whitespace-nowrap">{saveStatus}</span>
          )}

          <button
            onClick={() => handleSave()}
            className="flex items-center gap-1 h-[28px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11px] font-medium text-[#1c1c21] transition-all shadow-2xs whitespace-nowrap cursor-pointer"
          >
            <Save size={11.5} />
            <span>保存</span>
          </button>

          {/* 编排调试按钮组 */}
          <div className="flex items-center rounded-[6px] overflow-hidden shadow-xs border border-[#1c1c21]">
            <button
              onClick={handleRunNow}
              disabled={isRunningDebug}
              className="flex items-center gap-1 px-2.5 h-[28px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[11px] font-medium text-white transition-all active:scale-95 disabled:opacity-60 cursor-pointer whitespace-nowrap"
              title="启动流水线编排调试"
            >
              {isRunningDebug ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Play size={10} strokeWidth={2.4} className="text-[#10b981]" />
              )}
              <span>{isRunningDebug ? '调试中...' : '立即调试'}</span>
            </button>
            <button
              onClick={() => setIsDebugModalOpen(true)}
              disabled={isRunningDebug}
              className="px-1.5 h-[28px] bg-[#2e2f36] hover:bg-[#3f404a] text-white/90 border-l border-white/20 flex items-center justify-center transition-all cursor-pointer disabled:opacity-60"
              title="配置调试参数并启动 (输入需求/关联工程工作区)"
            >
              <ChevronDown size={10} />
            </button>
          </div>
        </div>
      </div>

      {/* 实时调试监控控制条 (Debug Session Banner) */}
      {activeDebugTaskId && debugTask && (
        <div className="bg-[#1c1c21] text-white px-4 py-2 border-b border-[#2e2f36] flex items-center justify-between shrink-0 z-30 shadow-md animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-3">
            {/* 状态徽标与状态文本 */}
            <div className="flex items-center gap-2">
              {debugTask.status === 'running' ? (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3b82f6] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#3b82f6]" />
                </span>
              ) : debugTask.status === 'completed' ? (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#10b981] text-white text-[10px]">
                  <Check size={11} strokeWidth={3} />
                </span>
              ) : debugTask.status === 'failed' ? (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#ef4444] text-white text-[10px]">
                  <X size={11} strokeWidth={3} />
                </span>
              ) : (
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#f59e0b]" />
              )}

              <span className="text-[12px] font-semibold text-white">
                {debugTask.status === 'running'
                  ? '编排调试运行中'
                  : debugTask.status === 'completed'
                  ? '编排调试已完成'
                  : debugTask.status === 'failed'
                  ? '编排调试失败'
                  : debugTask.status === 'cancelled'
                  ? '编排调试已中止'
                  : '编排调试待流转'}
              </span>

              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/70 border border-white/10">
                {debugTask.id}
              </span>
            </div>

            <span className="text-white/20">|</span>

            {/* 当前执行步骤指示 */}
            <div className="text-[11.5px] text-white/80 flex items-center gap-1.5">
              <span>当前步骤:</span>
              <span className="font-medium text-white px-1.5 py-0.5 rounded bg-white/15">
                {nodes.find((n) => n.id === debugTask.currentNodeId)?.data?.name ||
                  debugTask.currentNodeId ||
                  (debugTask.status === 'completed' ? '所有节点执行完毕' : '准备就绪')}
              </span>
            </div>

            <span className="text-white/20">|</span>

            {/* 耗时计时器 */}
            <div className="text-[11px] font-mono text-white/70 flex items-center gap-1">
              <Clock size={11} className="text-white/50" />
              <span>
                {Math.floor(debugTimerSeconds / 60)
                  .toString()
                  .padStart(2, '0')}
                :
                {(debugTimerSeconds % 60).toString().padStart(2, '0')}
              </span>
            </div>
          </div>

          {/* 右侧操作按钮群 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleOpenAgentSession(debugTask.id, debugTask.currentNodeId)}
              className="flex items-center gap-1.5 px-2.5 h-[24px] rounded-[5px] bg-[#7c3aed]/35 hover:bg-[#7c3aed]/50 border border-[#7c3aed]/50 text-[11px] font-medium text-white transition-all shadow-2xs cursor-pointer"
              title="查看 Agent 实时交互会话、深度思考与工具调用"
            >
              <Bot size={11} className="text-[#d8d6fb]" />
              <span>Agent 交互会话</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenTaskLogs(debugTask.id, debugTask.currentNodeId)}
              className="flex items-center gap-1.5 px-2.5 h-[24px] rounded-[5px] bg-white/15 hover:bg-white/25 text-[11px] font-medium text-white transition-all shadow-2xs cursor-pointer"
            >
              <Terminal size={11} />
              <span>实时终端日志</span>
            </button>

            {/* 处于人工门禁等待时，快捷提供通过与驳回 */}
            {debugTask.status === 'waiting_approval' && (
              <>
                <button
                  type="button"
                  disabled={isApprovingGate}
                  onClick={() => handleApproveGate(true)}
                  className="flex items-center gap-1 px-2.5 h-[24px] rounded-[5px] bg-[#10b981]/25 hover:bg-[#10b981]/40 border border-[#10b981]/50 text-[11px] font-medium text-[#6ee7b7] transition-all cursor-pointer"
                  title="通过当前 QA 人工门禁，继续执行后续流水线节点"
                >
                  {isApprovingGate ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Check size={11} strokeWidth={2.5} />
                  )}
                  <span>通过门禁</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSkipNode(debugTask.currentNodeId || '')}
                  className="flex items-center gap-1 px-2 h-[24px] rounded-[5px] bg-white/10 hover:bg-white/20 border border-white/20 text-[11px] font-medium text-white/90 transition-all cursor-pointer"
                  title="跳过此门禁节点"
                >
                  <SkipForward size={10} />
                  <span>跳过</span>
                </button>
              </>
            )}

            {debugTask.status === 'failed' && (
              <>
                <button
                  type="button"
                  onClick={() => handleRetryNode(debugTask.currentNodeId || '')}
                  className="flex items-center gap-1 px-2.5 h-[24px] rounded-[5px] bg-[#3b82f6]/30 hover:bg-[#3b82f6]/50 border border-[#3b82f6]/50 text-[11px] font-medium text-[#93c5fd] transition-all cursor-pointer"
                  title="单独重新执行当前失败节点"
                >
                  <RotateCcw size={10} />
                  <span>重试节点</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSkipNode(debugTask.currentNodeId || '')}
                  className="flex items-center gap-1 px-2.5 h-[24px] rounded-[5px] bg-white/10 hover:bg-white/20 border border-white/20 text-[11px] font-medium text-white/90 transition-all cursor-pointer"
                  title="跳过失败节点继续流转"
                >
                  <SkipForward size={10} />
                  <span>跳过节点</span>
                </button>
              </>
            )}

            {(debugTask.status === 'completed' || debugTask.status === 'failed' || debugTask.status === 'cancelled') && (
              <button
                type="button"
                onClick={handleRunNow}
                className="flex items-center gap-1 px-2.5 h-[24px] rounded-[5px] bg-white/15 hover:bg-white/25 text-[11px] font-medium text-white transition-all cursor-pointer"
                title="重新启动编排调试"
              >
                <RefreshCw size={10} />
                <span>重新调试</span>
              </button>
            )}

            {(debugTask.status === 'running' ||
              debugTask.status === 'waiting_approval' ||
              debugTask.status === 'pending') && (
              <button
                type="button"
                disabled={isCancellingDebug}
                onClick={handleCancelDebug}
                className="flex items-center gap-1 px-2 h-[24px] rounded-[5px] bg-[#ef4444]/20 hover:bg-[#ef4444]/30 border border-[#ef4444]/40 text-[11px] font-medium text-[#fca5a5] transition-all cursor-pointer"
                title="立即中止当前调试任务"
              >
                <Square size={10} className="fill-[#fca5a5]" />
                <span>{isCancellingDebug ? '正在中止...' : '中止调试'}</span>
              </button>
            )}

            {/* 明确的退出调试按钮 */}
            <button
              type="button"
              onClick={() => {
                if (
                  debugTask &&
                  (debugTask.status === 'running' ||
                    debugTask.status === 'waiting_approval' ||
                    debugTask.status === 'pending')
                ) {
                  setIsExitDebugModalOpen(true);
                } else {
                  handleExitDebug(false);
                }
              }}
              title="退出调试视图并恢复画布编辑模式"
              className="flex items-center gap-1 px-2 h-[24px] rounded-[5px] bg-white/10 hover:bg-white/20 text-white/90 text-[11px] font-medium transition-all cursor-pointer ml-1"
            >
              <X size={11} />
              <span>退出调试</span>
            </button>
          </div>
        </div>
      )}

      {/* 画布核心与协同侧栏 */}
      <div className="flex-1 relative flex overflow-hidden">
        {/* 左侧节点组件库悬浮栏 (极简折叠式胶囊坞) */}
        <div className="absolute top-4 left-4 z-10 bg-white/95 backdrop-blur-md border border-[#e3e3e8] rounded-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.06)] overflow-hidden transition-all duration-200">
          {isPaletteCollapsed ? (
            <button
              onClick={() => {
                if (import.meta.env?.DEV) console.log('[WorkflowEditor] 展开组件节点库');
                setIsPaletteCollapsed(false);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-medium text-[#4b4b53] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-all cursor-pointer whitespace-nowrap"
              title="展开组件节点库"
            >
              <Plus size={13} strokeWidth={2.4} className="text-[#4f46e5]" />
              <span>添加节点</span>
              <Layers size={11} className="text-[#85858d] ml-1" />
            </button>
          ) : (
            <div className="p-2 flex flex-col gap-1 w-[165px]">
              <div className="px-1.5 py-1 text-[11px] font-semibold text-[#85858d] flex items-center justify-between border-b border-[#ececf0] mb-0.5">
                <span className="flex items-center gap-1 text-[#1c1c21]">
                  <Layers size={12} className="text-[#4f46e5]" />
                  <span>组件节点库</span>
                </span>
                <button
                  onClick={() => {
                    if (import.meta.env?.DEV) console.log('[WorkflowEditor] 收起组件节点库');
                    setIsPaletteCollapsed(true);
                  }}
                  className="p-0.5 rounded hover:bg-[#f1f1f4] text-[#85858d] hover:text-[#1c1c21] transition-colors cursor-pointer"
                  title="收起节点库"
                >
                  <ChevronDown size={12} />
                </button>
              </div>

              <button
                onClick={() => addNode('agent', 'Agent 编码')}
                className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all cursor-pointer"
              >
                <span className="w-4 h-4 rounded bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center shrink-0">
                  <Bot size={11} />
                </span>
                <span className="truncate">Agent 编码</span>
              </button>

              <button
                onClick={() => addNode('cli', 'CLI 脚本')}
                className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all cursor-pointer"
              >
                <span className="w-4 h-4 rounded bg-[#f4f4f6] text-[#4b4b53] flex items-center justify-center shrink-0">
                  <Terminal size={11} />
                </span>
                <span className="truncate">Shell 脚本</span>
              </button>

              <button
                onClick={() => addNode('qa-approval', 'QA 门禁验收')}
                className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all cursor-pointer"
              >
                <span className="w-4 h-4 rounded bg-[#fef3c7] text-[#b45309] flex items-center justify-center shrink-0">
                  <CheckSquare size={11} />
                </span>
                <span className="truncate">QA 门禁验收</span>
              </button>

              <button
                onClick={() => addNode('midscene', 'UI 自动化')}
                className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all cursor-pointer"
              >
                <span className="w-4 h-4 rounded bg-[#e4f6ec] text-[#15803d] flex items-center justify-center shrink-0">
                  <Target size={11} />
                </span>
                <span className="truncate">Midscene 测试</span>
              </button>

              <button
                onClick={() => addNode('stitch-image', '拼接动图')}
                className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all cursor-pointer"
              >
                <span className="w-4 h-4 rounded bg-[#eff6ff] text-[#1d4ed8] flex items-center justify-center shrink-0">
                  <FileVideo size={11} />
                </span>
                <span className="truncate">拼接动图 CLI</span>
              </button>

              <button
                onClick={() => addNode('git-commit', 'Git 提交')}
                className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all cursor-pointer"
              >
                <span className="w-4 h-4 rounded bg-[#1c1c21] text-white flex items-center justify-center shrink-0">
                  <GitCommit size={11} />
                </span>
                <span className="truncate">Git 自动提交</span>
              </button>

              <button
                onClick={() => addNode('deploy', '应用部署')}
                className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all cursor-pointer"
              >
                <span className="w-4 h-4 rounded bg-[#0f172a] text-[#38bdf8] flex items-center justify-center shrink-0">
                  <Rocket size={11} />
                </span>
                <span className="truncate">应用部署</span>
              </button>

              <button
                onClick={() => addNode('sub-workflow', '子流水线 / 支线')}
                className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all cursor-pointer"
              >
                <span className="w-4 h-4 rounded bg-[#f0f9ff] text-[#0284c7] flex items-center justify-center shrink-0">
                  <Workflow size={11} />
                </span>
                <span className="truncate">子流水线 / 支线</span>
              </button>

              <button
                onClick={() => addNode('hook', 'Hook 触发')}
                className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all cursor-pointer"
              >
                <span className="w-4 h-4 rounded bg-[#ffedd5] text-[#c2410c] flex items-center justify-center shrink-0">
                  <Zap size={11} />
                </span>
                <span className="truncate">Hook 调度</span>
              </button>
            </div>
          )}
        </div>

        {/* 零手动编排欢迎态（Empty / Welcome State Overlay，当节点数 <= 1 且无幽灵预演时出现） */}
        {nodes.length <= 1 && !ghostPreview && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 bg-white/95 backdrop-blur-md border border-[#c7d2fe] p-4 rounded-[12px] shadow-[0_8px_32px_rgba(79,70,229,0.12)] max-w-xl w-[90%] pointer-events-auto animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="flex items-center justify-between pb-2 border-b border-[#ececf0] mb-3">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-[6px] bg-[#eeedfd] text-[#4f46e5]">
                  <Wand2 size={14} />
                </span>
                <span className="text-[12.5px] font-semibold text-[#1c1c21]">
                  欢迎使用 AI 编排助手
                </span>
              </div>
              <span className="text-[10px] text-[#6366f1] font-mono">Zero-Touch Orchestration</span>
            </div>

            <p className="text-[11.5px] text-[#63636b] mb-3 leading-relaxed">
              无需手动拖拽节点，点击下方常用方案或在右侧助手输入业务需求，AI 将为您全景规划阶段与拓扑：
            </p>

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() =>
                  handleSendMessage(
                    '帮我编排一个自动化 PR 审查与合并流水线：先做代码规范与类型检查，然后由 Agent 审查坏味道，再执行 Midscene 视觉回归测试，最后自动提交合入。'
                  )
                }
                className="p-2.5 rounded-[8px] bg-[#f9f9fb] hover:bg-[#f1f1f8] border border-[#e3e3e8] hover:border-[#6366f1] text-left transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11.5px] font-semibold text-[#1c1c21] group-hover:text-[#4f46e5]">
                    PR 审查流水线
                  </span>
                  <ArrowRight size={11} className="text-[#85858d] group-hover:translate-x-0.5 transition-transform" />
                </div>
                <div className="text-[10px] text-[#85858d] leading-normal line-clamp-2">
                  Lint 检查 → Agent 走查 → Midscene 验收 → Git 提交
                </div>
              </button>

              <button
                onClick={() =>
                  handleSendMessage(
                    '设计一个端到端 Midscene UI 自动化测试与动图生成流程：启动预览服务，执行视觉断言截屏，拼接动图，交由 QA 人工审核。'
                  )
                }
                className="p-2.5 rounded-[8px] bg-[#f9f9fb] hover:bg-[#f1f1f8] border border-[#e3e3e8] hover:border-[#189a58] text-left transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11.5px] font-semibold text-[#1c1c21] group-hover:text-[#189a58]">
                    Midscene 视觉回归
                  </span>
                  <ArrowRight size={11} className="text-[#85858d] group-hover:translate-x-0.5 transition-transform" />
                </div>
                <div className="text-[10px] text-[#85858d] leading-normal line-clamp-2">
                  服务启动 → 自动化断言 → 动图生成 → QA 审批
                </div>
              </button>

              <button
                onClick={() =>
                  handleSendMessage(
                    '编排一个自动化生产构建与部署流水线：跑测试用例，执行生产构建，运行容器部署脚本，部署完成后触发 Webhook 通知。'
                  )
                }
                className="p-2.5 rounded-[8px] bg-[#f9f9fb] hover:bg-[#f1f1f8] border border-[#e3e3e8] hover:border-[#0284c7] text-left transition-all group"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11.5px] font-semibold text-[#1c1c21] group-hover:text-[#0284c7]">
                    生产构建与部署
                  </span>
                  <ArrowRight size={11} className="text-[#85858d] group-hover:translate-x-0.5 transition-transform" />
                </div>
                <div className="text-[10px] text-[#85858d] leading-normal line-clamp-2">
                  单元测试 → 编译构建 → 自动化发布 → Webhook 通知
                </div>
              </button>
            </div>
          </div>
        )}

        {/* 画布幽灵预演确认浮层 (Ghost Preview Action Bar) */}
        {ghostPreview?.active && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 animate-in fade-in slide-in-from-top-3 duration-300 pointer-events-auto">
            <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-[#1c1c21]/95 backdrop-blur-md text-white shadow-2xl border border-[#7c3aed]/50 ring-4 ring-[#7c3aed]/15">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-[#a78bfa] animate-spin" />
                <span className="text-[12px] font-medium tracking-wide">
                  {ghostPreview.summary}
                </span>
              </div>

              <div className="h-3 w-[1px] bg-white/20" />

              <button
                onClick={handleCommitGhostPreview}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] text-white text-[11px] font-semibold transition-all shadow-sm active:scale-95"
              >
                <Check size={12} strokeWidth={2.5} />
                <span>采纳合入</span>
                <span className="opacity-60 text-[9.5px] font-mono ml-0.5">Enter</span>
              </button>

              <button
                onClick={handleDiscardGhostPreview}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-[11px] transition-all"
              >
                <X size={12} />
                <span>放弃</span>
                <span className="opacity-60 text-[9.5px] font-mono ml-0.5">Esc</span>
              </button>
            </div>
          </div>
        )}

        {/* React Flow 画布主体 */}
        <div className="flex-1 w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            onPaneClick={handlePaneClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          >
            <Background color="#d1d1d8" gap={18} size={1} />
            <Controls />
          </ReactFlow>
        </div>

        {/* 右侧工作台侧栏 (AI 编排助手 & 属性配置) */}
        {isSidebarOpen && (
          <div className="w-[360px] border-l border-[#e3e3e8] bg-white flex flex-col z-20 shadow-[-4px_0_16px_rgba(0,0,0,0.04)] animate-in slide-in-from-right duration-200">
            {/* 顶栏 Tab 切换器 */}
            <div className="h-[42px] px-3 border-b border-[#e3e3e8] flex items-center justify-between shrink-0 bg-[#fafafc]">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSidebarTab('copilot')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all ${
                    sidebarTab === 'copilot'
                      ? 'bg-white text-[#4f46e5] shadow-xs border border-[#e3e3e8]'
                      : 'text-[#85858d] hover:text-[#1c1c21]'
                  }`}
                >
                  <Sparkles
                    size={12}
                    className={copilotState?.isBusy ? 'text-[#7c3aed] animate-spin' : 'text-[#4f46e5]'}
                  />
                  <span>AI 编排助手</span>
                  {copilotState?.isBusy && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-ping" />
                  )}
                </button>

                <button
                  onClick={() => setSidebarTab('inspector')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all ${
                    sidebarTab === 'inspector'
                      ? 'bg-white text-[#1c1c21] shadow-xs border border-[#e3e3e8]'
                      : 'text-[#85858d] hover:text-[#1c1c21]'
                  }`}
                >
                  <Settings2 size={12} className="text-[#85858d]" />
                  <span>{selectedNode ? '节点属性' : selectedEdge ? '连线属性' : '流程配置'}</span>
                  {(selectedNode || selectedEdge) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5]" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1">
                {sidebarTab === 'copilot' && (
                  <button
                    onClick={handleResetSession}
                    title="清空对话历史"
                    className="p-1 rounded hover:bg-[#f1f1f4] text-[#85858d] hover:text-[#1c1c21] transition-colors"
                  >
                    <RefreshCw size={12} />
                  </button>
                )}
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  title="收起侧栏"
                  className="p-1 rounded hover:bg-[#f1f1f4] text-[#85858d] hover:text-[#1c1c21] transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Tab 1: AI 编排助手 */}
            {sidebarTab === 'copilot' && (
              <div className="flex-1 flex flex-col min-h-0 bg-white">
                {/* 模式状态指示条 */}
                <div className="px-3.5 py-1.5 bg-[#f9f9fb] border-b border-[#ececf0] flex items-center justify-between text-[11px] shrink-0">
                  {selectedNode ? (
                    <div className="flex items-center gap-1.5 text-[#7c3aed]">
                      <GitBranch size={11} />
                      <span className="font-medium">参考节点:</span>
                      <span className="font-semibold text-[#1c1c21] truncate max-w-[150px]">
                        {selectedNode.data.name}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedNodeId(null);
                        }}
                        className="text-[#85858d] hover:text-red-500 text-[12px] ml-0.5"
                        title="取消聚焦，回到全局编排模式"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[#4f46e5]">
                      <Compass size={11} />
                      <span className="font-medium">全流程编排模式</span>
                      <span className="text-[#85858d] font-mono text-[10px]">
                        ({nodes.filter((n) => !n.data?.isGhost).length} 个节点)
                      </span>
                    </div>
                  )}

                  {copilotState?.isBusy && (
                    <div className="flex items-center gap-1 text-[10.5px] text-[#7c3aed] font-medium animate-pulse">
                      <Sparkles size={10} className="animate-spin" />
                      <span>规划中...</span>
                    </div>
                  )}
                </div>

                {/* 消息滚动流与浮动查看最新指示器 */}
                <div className="relative flex-1 min-h-0 flex flex-col">
                  <div
                    ref={copilotScrollContainerRef}
                    onScroll={handleCopilotScroll}
                    onWheel={handleCopilotWheel}
                    className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 text-[12px]"
                  >
                  {(!copilotState?.messages || copilotState.messages.length === 0) ? (
                    <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center p-4 text-[#85858d]">
                      <div className="w-10 h-10 rounded-[10px] bg-[#eeedfd] border border-[#c7d2fe] flex items-center justify-center mb-2.5 text-[#4f46e5]">
                        <Bot size={20} />
                      </div>
                      <div className="text-[12.5px] font-semibold text-[#1c1c21] mb-1">
                        {selectedNode
                          ? `以【${selectedNode.data.name}】为参考规划链路`
                          : '自动化工作流编排助手'}
                      </div>
                      <div className="text-[11px] text-[#85858d] leading-relaxed max-w-[260px]">
                        {selectedNode
                          ? '输入需求可在当前节点后追加自动化测试、人工验收门禁或结果通知，AI 将自动处理依赖接驳。'
                          : '直接输入您的业务目标，AI 将为您全自动规划节点类型、CLI 脚本与执行拓扑。'}
                      </div>
                    </div>
                  ) : (
                    copilotState.messages.map((msg, msgIdx) => {
                      if (msg.role === 'user') {
                        return (
                          <div key={msg.id} className="flex justify-end">
                            <div className="max-w-[88%] rounded-[9px] px-3 py-2 bg-[#f4f4f6] border border-[#e3e3e8] text-[#1c1c21] text-[11.5px] leading-relaxed shadow-xs">
                              <div className="text-[9px] font-mono text-[#85858d] mb-0.5 text-right">
                                YOU
                              </div>
                              <div className="whitespace-pre-wrap">{msg.content}</div>
                            </div>
                          </div>
                        );
                      }

                      // 助理回复 (支持思考流与编排 Action 卡片解析)
                      const actionPayload = parseWorkflowAction(msg.content);
                      const isApplied = appliedActionIds.has(msg.id);
                      const isCurrentlyPreviewing = ghostPreview?.messageId === msg.id;

                      const cleanContent = msg.content
                        .replace(/```(?:workflow-action|json)?\s*[\s\S]*?```/g, '')
                        .trim();

                      return (
                        <div key={msg.id} className="space-y-2">
                          {/* 思考过程模块 Thinking */}
                          {msg.thinking && (
                            <div className="rounded-[7px] border border-[#e8e8ed] bg-[#fafafc] overflow-hidden text-[11px]">
                              <button
                                onClick={() =>
                                  setExpandedThinking((p) => ({ ...p, [msg.id]: !p[msg.id] }))
                                }
                                className="w-full px-2.5 py-1.5 flex items-center justify-between text-[#63636b] hover:bg-[#f1f1f4] transition-colors"
                              >
                                <div className="flex items-center gap-1.5">
                                  <Sparkles
                                    size={11}
                                    className={
                                      msg.isThinking
                                        ? 'text-[#7c3aed] animate-spin'
                                        : 'text-[#7c3aed]'
                                    }
                                  />
                                  <span className="font-medium text-[11px]">
                                    {msg.isThinking ? '思考中...' : '编排思考过程'}
                                  </span>
                                </div>
                                {expandedThinking[msg.id] ? (
                                  <ChevronDown size={11} />
                                ) : (
                                  <ChevronRight size={11} />
                                )}
                              </button>
                              {expandedThinking[msg.id] && (
                                <div className="p-2 border-t border-[#ececf0] text-[#63636b] leading-relaxed whitespace-pre-wrap font-mono text-[10.5px] bg-white">
                                  {msg.thinking}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 助理消息正文 */}
                          {cleanContent && (
                            <div className="p-3 rounded-[9px] bg-white border border-[#e3e3e8] shadow-xs select-text">
                              <AgentMarkdown
                                content={cleanContent}
                                isStreaming={!!copilotState?.isBusy && msgIdx === copilotState.messages.length - 1}
                              />
                            </div>
                          )}

                          {/* 结构化 Action 卡片 (画布预演与一键合入) */}
                          {actionPayload && (
                            <div className="p-3 rounded-[9px] bg-[#f8f9ff] border border-[#c7d2fe] shadow-xs space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <CheckCircle2 size={13} className="text-[#4f46e5]" />
                                  <span className="text-[11.5px] font-semibold text-[#1c1c21]">
                                    {actionPayload.action === 'replace_all'
                                      ? '全新流程拓扑方案'
                                      : '局部增量编排补丁'}
                                  </span>
                                </div>
                                <span className="text-[9.5px] font-mono text-[#6366f1] bg-[#eeedfd] px-1.5 py-[1px] rounded">
                                  {actionPayload.action === 'replace_all'
                                    ? `${actionPayload.workflow?.nodes?.length || 0} 个节点`
                                    : `+${actionPayload.addNodes?.length || 0} 节点`}
                                </span>
                              </div>

                              {actionPayload.workflow?.description && (
                                <div className="text-[10.5px] text-[#63636b] leading-normal">
                                  {actionPayload.workflow.description}
                                </div>
                              )}

                              <div className="pt-1 flex items-center justify-end gap-2">
                                {isApplied ? (
                                  <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11px] font-medium bg-[#e4f6ec] text-[#189a58] border border-[#bbf7d0]">
                                      <Check size={11} strokeWidth={2.5} />
                                      <span>已合入画布</span>
                                    </div>
                                    <button
                                      onClick={() => {
                                        handlePreviewWorkflowAction(actionPayload, msg.id);
                                        setTimeout(() => handleCommitGhostPreview(), 60);
                                      }}
                                      title="如画布已被后续改动，可点击重新应用此方案"
                                      className="text-[10.5px] text-[#85858d] hover:text-[#4f46e5] hover:underline px-1 py-0.5 transition-colors"
                                    >
                                      重新应用
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => handlePreviewWorkflowAction(actionPayload, msg.id)}
                                      className={`flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-[11px] font-medium transition-all shadow-xs ${
                                        isCurrentlyPreviewing
                                          ? 'bg-[#f3e8ff] text-[#7c3aed] border border-[#d8b4fe] font-semibold'
                                          : 'bg-white hover:bg-[#f1f1f4] text-[#4b4b53] border border-[#e3e3e8]'
                                      }`}
                                    >
                                      <Eye size={11} />
                                      <span>{isCurrentlyPreviewing ? '画布预演中...' : '在画布预演'}</span>
                                    </button>

                                    <button
                                      onClick={() => {
                                        handlePreviewWorkflowAction(actionPayload, msg.id);
                                        setTimeout(() => handleCommitGhostPreview(), 60);
                                      }}
                                      className="flex items-center gap-1 px-3 py-1 rounded-[5px] text-[11px] font-medium transition-all shadow-xs bg-[#4f46e5] hover:bg-[#4338ca] text-white active:scale-95"
                                    >
                                      <Check size={11} strokeWidth={2.4} />
                                      <span>直接合入</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* 离开底部后的浮动「查看最新」胶囊按钮 */}
                <ChatScrollToLatestButton
                  visible={!isCopilotAtBottom}
                  hasNewOutput={hasNewCopilotOutput}
                  onClick={() => scrollCopilotToBottom(true)}
                />
              </div>

                {/* 推荐快捷指令胶囊条 */}
                <div className="px-3 py-1.5 bg-[#fafafc] border-t border-[#ececf0] flex items-center gap-1.5 overflow-x-auto text-[10.5px] shrink-0">
                  <span className="text-[#85858d] shrink-0">建议:</span>
                  {selectedNode ? (
                    <>
                      <button
                        onClick={() => handleSendMessage(`在节点【${selectedNode.data.name}】后追加 Midscene 视觉回归测试`)}
                        className="px-2 py-0.5 rounded-full bg-white hover:bg-[#eeedfd] border border-[#e3e3e8] hover:border-[#c7d2fe] text-[#4f46e5] shrink-0 transition-all"
                      >
                        + 串联 UI 测试
                      </button>
                      <button
                        onClick={() => handleSendMessage(`在节点【${selectedNode.data.name}】后接入 QA 人工验收门禁`)}
                        className="px-2 py-0.5 rounded-full bg-white hover:bg-[#fef3c7] border border-[#e3e3e8] hover:border-[#fde68a] text-[#b45309] shrink-0 transition-all"
                      >
                        + 插入 QA 门禁
                      </button>
                      <button
                        onClick={() => handleSendMessage(`为节点【${selectedNode.data.name}】配置阶段完成 Webhook 通知`)}
                        className="px-2 py-0.5 rounded-full bg-white hover:bg-[#f1f1f4] border border-[#e3e3e8] text-[#4b4b53] shrink-0 transition-all"
                      >
                        + 阶段完成通知
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleSendMessage('规划一个自动化 PR 审查流水线')}
                        className="px-2 py-0.5 rounded-full bg-white hover:bg-[#eeedfd] border border-[#e3e3e8] hover:border-[#c7d2fe] text-[#4f46e5] shrink-0 transition-all"
                      >
                        PR 审查流水线
                      </button>
                      <button
                        onClick={() => handleSendMessage('设计一个生产环境构建与自动化部署流水线')}
                        className="px-2 py-0.5 rounded-full bg-white hover:bg-[#eff6ff] border border-[#e3e3e8] hover:border-[#bfdbfe] text-[#1d4ed8] shrink-0 transition-all"
                      >
                        构建与部署
                      </button>
                      <button
                        onClick={() => handleSendMessage('检查当前流程拓扑，优化并发阶段并指出潜在断点')}
                        className="px-2 py-0.5 rounded-full bg-white hover:bg-[#f1f1f4] border border-[#e3e3e8] text-[#4b4b53] shrink-0 transition-all"
                      >
                        流程拓扑体检
                      </button>
                    </>
                  )}
                </div>

                {/* 底部输入框 */}
                <div className="p-3 border-t border-[#e3e3e8] bg-white">
                  <div className="relative">
                    <textarea
                      rows={2}
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder={
                        selectedNode
                          ? `以【${selectedNode.data.name}】为参考扩充链路，或描述全流程...`
                          : '向 AI 描述您的流程需求...'
                      }
                      className="w-full bg-[#f9f9fb] focus:bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[8px] p-2 pr-10 text-[11.5px] text-[#1c1c21] outline-none resize-none shadow-xs transition-all placeholder:text-[#85858d]"
                    />

                    <button
                      onClick={() => handleSendMessage()}
                      disabled={!inputMessage.trim() || isSendingMessage}
                      title="发送 (⌘ + Enter)"
                      className="absolute right-2.5 bottom-2.5 p-1.5 rounded-[6px] bg-[#4f46e5] hover:bg-[#4338ca] disabled:opacity-40 text-white transition-all shadow-xs active:scale-95"
                    >
                      <Send size={12} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1.5 px-0.5 text-[10px] text-[#85858d]">
                    <span>Enter 换行</span>
                    <span className="font-mono bg-[#f0f0f4] text-[#6b7280] px-1.5 py-0.5 rounded text-[9.5px]">
                      ⌘ + Enter 发送
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: 属性配置 (节点参数详情 / 流水线全局配置) */}
            {sidebarTab === 'inspector' && (
              <div className="flex-1 flex flex-col justify-between p-4 overflow-y-auto">
                {selectedNode && selectedNodeData ? (
                  <div className="space-y-3.5 text-[12px]">
                    <div className="flex items-center justify-between pb-2 border-b border-[#ececf0]">
                      <div className="text-[11px] text-[#85858d] font-mono">
                        ID: {selectedNode.id}
                      </div>
                      <button
                        onClick={deleteSelectedNode}
                        className="p-1 rounded hover:bg-[#fbe9e9] text-[#d64545] transition-colors"
                        title="删除该节点"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* 编排调试单节点执行状态与单节点试跑控制 */}
                    {debugTask && (
                      <div className="p-2.5 rounded-[8px] bg-[#f8f9fa] border border-[#e3e3e8] space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-[#1c1c21] flex items-center gap-1.5">
                            <Bug size={11} className="text-[#4f46e5]" />
                            <span>调试执行状态</span>
                          </span>
                          {(() => {
                            const run = debugTask.nodeRuns?.[selectedNode.id];
                            const isCurr = debugTask.currentNodeId === selectedNode.id && (debugTask.status === 'running' || debugTask.status === 'pending');
                            if (run?.status === 'completed' || run?.status === 'success') {
                              return (
                                <span className="flex items-center gap-1 text-[9.5px] px-1.5 py-[1px] rounded bg-[#ecfdf5] text-[#059669] font-medium border border-[#a7f3d0]">
                                  <CheckCircle2 size={9} />
                                  <span>成功</span>
                                </span>
                              );
                            }
                            if (run?.status === 'failed') {
                              return (
                                <span className="flex items-center gap-1 text-[9.5px] px-1.5 py-[1px] rounded bg-[#fef2f2] text-[#dc2626] font-medium border border-[#fecaca]">
                                  <AlertCircle size={9} />
                                  <span>失败</span>
                                </span>
                              );
                            }
                            if (isCurr || run?.status === 'running') {
                              return (
                                <span className="flex items-center gap-1 text-[9.5px] px-1.5 py-[1px] rounded bg-[#eff6ff] text-[#2563eb] font-semibold border border-[#bfdbfe]">
                                  <Loader2 size={9} className="animate-spin text-[#2563eb]" />
                                  <span>执行中</span>
                                </span>
                              );
                            }
                            if (run?.status === 'waiting_approval') {
                              return (
                                <span className="flex items-center gap-1 text-[9.5px] px-1.5 py-[1px] rounded bg-[#fffbeb] text-[#d97706] font-medium border border-[#fde68a]">
                                  <Clock size={9} />
                                  <span>待验收</span>
                                </span>
                              );
                            }
                            return (
                              <span className="text-[9.5px] px-1.5 py-[1px] rounded bg-[#f1f1f4] text-[#85858d]">
                                未执行
                              </span>
                            );
                          })()}
                        </div>

                        {(() => {
                          const run = debugTask.nodeRuns?.[selectedNode.id];
                          if (!run) return null;
                          const durSec =
                            run.finishedAt && run.startedAt
                              ? Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000))
                              : null;
                          return (
                            <div className="space-y-1 text-[10.5px] text-[#63636b]">
                              {durSec && (
                                <div className="flex justify-between font-mono">
                                  <span>节点耗时:</span>
                                  <span className="text-[#1c1c21] font-medium">{durSec} 秒</span>
                                </div>
                              )}
                              {run.exitCode !== undefined && (
                                <div className="flex justify-between font-mono">
                                  <span>退出码:</span>
                                  <span className="text-[#1c1c21] font-medium">{run.exitCode}</span>
                                </div>
                              )}
                              {run.error && (
                                <div className="p-1.5 rounded bg-[#fff1f2] border border-[#fecaca] text-[#dc2626] text-[10px] break-all">
                                  {run.error}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        <div className="flex items-center gap-1.5 pt-1 border-t border-[#ececf0]">
                          <button
                            type="button"
                            onClick={() => handleRetryNode(selectedNode.id)}
                            className="flex-1 h-[24px] rounded-[5px] bg-white hover:bg-[#f1f1f4] border border-[#e3e3e8] text-[10.5px] font-medium text-[#1c1c21] flex items-center justify-center gap-1 transition-all cursor-pointer"
                            title="单独重试此节点"
                          >
                            <RotateCcw size={10} />
                            <span>重试节点</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSkipNode(selectedNode.id)}
                            className="flex-1 h-[24px] rounded-[5px] bg-white hover:bg-[#f1f1f4] border border-[#e3e3e8] text-[10.5px] font-medium text-[#4b4b53] flex items-center justify-center gap-1 transition-all cursor-pointer"
                            title="跳过此节点继续后续流转"
                          >
                            <SkipForward size={10} />
                            <span>跳过节点</span>
                          </button>
                          {selectedNodeData.type === 'agent' && (
                            <button
                              type="button"
                              onClick={() => handleOpenAgentSession(debugTask.id, selectedNode.id, selectedNodeData.name)}
                              className="h-[24px] px-2 rounded-[5px] bg-[#eeedfd] text-[#7c3aed] hover:bg-[#e4dffd] text-[10.5px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer shadow-2xs"
                              title="查看 Agent 实时交互会话、深度思考与工具调用"
                            >
                              <Bot size={11} className="text-[#7c3aed]" />
                              <span>会话详情</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenTaskLogs(debugTask.id, selectedNode.id)}
                            className="h-[24px] px-2 rounded-[5px] bg-[#eeedfd] text-[#4f46e5] text-[10.5px] font-medium flex items-center justify-center gap-1 hover:bg-[#e0e7ff] transition-all cursor-pointer"
                            title="查看当前节点日志"
                          >
                            <Terminal size={10} />
                            <span>日志</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-[#85858d] mb-1">节点名称</label>
                      <input
                        type="text"
                        value={selectedNodeData.name || ''}
                        onChange={(e) => updateSelectedNodeName(e.target.value)}
                        className="w-full h-[28px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[#1c1c21] outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[#85858d] mb-1">节点类型</label>
                      <div className="px-2 py-1 rounded-[6px] bg-[#f4f4f6] font-mono text-[11px] text-[#4f46e5]">
                        {selectedNodeData.type}
                      </div>
                    </div>

                    {selectedNodeData.type === 'agent' && (
                      <>
                        <div>
                          <label className="block text-[#85858d] mb-1">Agent 角色/名称</label>
                          <input
                            type="text"
                            value={selectedNodeData.config?.agentName || ''}
                            onChange={(e) => updateSelectedNodeConfig('agentName', e.target.value)}
                            className="w-full h-[28px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[#1c1c21] outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[#85858d] mb-1">执行提示词 / Prompt</label>
                          <textarea
                            rows={6}
                            value={selectedNodeData.config?.prompt || ''}
                            onChange={(e) => updateSelectedNodeConfig('prompt', e.target.value)}
                            placeholder="描述给 AI Agent 的明确指令与任务约束..."
                            className="w-full min-h-[130px] bg-[#f9f9fb] focus:bg-white border border-[#e3e3e8] focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 rounded-[8px] p-2.5 text-[12px] leading-relaxed text-[#1c1c21] outline-none resize-y transition-all"
                          />
                        </div>
                      </>
                    )}

                    {selectedNodeData.type === 'midscene' && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[#85858d] mb-1">关联 QA 测试用例 (可选)</label>
                          <select
                            value={selectedNodeData.config?.suiteId || ''}
                            onChange={(e) => {
                              const sid = e.target.value;
                              const suite = qaSuites.find((s) => s.id === sid);
                              updateSelectedNodeConfig('suiteId', sid);
                              if (suite) {
                                if (suite.targetUrl) updateSelectedNodeConfig('testUrl', suite.targetUrl);
                                if (suite.steps) updateSelectedNodeConfig('instructions', suite.steps.map((st: any) => st.prompt));
                              }
                            }}
                            className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[#1c1c21] outline-none text-[12.5px]"
                          >
                            <option value="">-- 选择已有 QA 自动化测试用例 --</option>
                            {qaSuites.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.steps?.length || 0} 步)
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[#85858d] mb-1">测试目标 URL (支持变量如 &#123;&#123;previewUrl&#125;&#125;)</label>
                          <input
                            type="text"
                            value={selectedNodeData.config?.testUrl || ''}
                            onChange={(e) => updateSelectedNodeConfig('testUrl', e.target.value)}
                            placeholder="http://localhost:3000"
                            className="w-full h-[28px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[#1c1c21] outline-none font-mono text-[12px]"
                          />
                        </div>

                        <div className="p-2.5 rounded-[6px] bg-[#eff6ff]/70 border border-[#dbeafe] text-[11px] text-[#1e40af] leading-relaxed">
                          <p className="font-semibold mb-0.5">💡 测试结果回传与下游编排：</p>
                          <p>Midscene 测试执行完毕后，测试状态（通过/失败）、执行耗时与高清 WebP 截图将自动回传至任务上下文 <code className="bg-white/80 px-1 py-0.5 rounded font-mono">&#123;&#123;qa&#125;&#125;</code>，下游审批节点或动图生成节点可直接引用。</p>
                        </div>
                      </div>
                    )}

                    {selectedNodeData.type === 'stitch-image' && (
                      <div>
                        <label className="block text-[#85858d] mb-1">输出动画文件</label>
                        <input
                          type="text"
                          value={selectedNodeData.config?.outputFile || ''}
                          onChange={(e) => updateSelectedNodeConfig('outputFile', e.target.value)}
                          className="w-full h-[28px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[#1c1c21] outline-none"
                        />
                      </div>
                    )}

                    {selectedNodeData.type === 'hook' && (
                      <div>
                        <label className="block text-[#85858d] mb-1">Webhook 通知地址</label>
                        <input
                          type="text"
                          value={selectedNodeData.config?.webhookUrl || ''}
                          onChange={(e) => updateSelectedNodeConfig('webhookUrl', e.target.value)}
                          placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
                          className="w-full h-[28px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[#1c1c21] outline-none"
                        />
                      </div>
                    )}

                    {selectedNodeData.type === 'qa-approval' && (
                      <div>
                        <label className="block text-[#85858d] mb-1">审批提示说明</label>
                        <textarea
                          rows={3}
                          value={selectedNodeData.config?.approvalPrompt || ''}
                          onChange={(e) => updateSelectedNodeConfig('approvalPrompt', e.target.value)}
                          placeholder="说明人工验收或 QA 审批的标准与重点事项..."
                          className="w-full min-h-[80px] bg-[#f9f9fb] focus:bg-white border border-[#e3e3e8] focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 rounded-[8px] p-2.5 text-[12px] leading-relaxed text-[#1c1c21] outline-none resize-y transition-all"
                        />
                      </div>
                    )}

                    {selectedNodeData.type === 'sub-workflow' && (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-[#85858d] mb-1 font-medium">选择调用的子流水线 / 支线</label>
                          <select
                            value={selectedNodeData.config?.subWorkflowId || ''}
                            onChange={(e) => updateSelectedNodeConfig('subWorkflowId', e.target.value)}
                            className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[#1c1c21] text-[12px] outline-none cursor-pointer"
                          >
                            <option value="">-- 请选择要内嵌的子流水线 --</option>
                            {workflows
                              .filter((w) => w.id !== workflowId)
                              .map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.name} ({w.id})
                                </option>
                              ))}
                          </select>
                        </div>
                        {selectedNodeData.config?.subWorkflowId && (
                          <div className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-[6px] bg-[#f0f9ff] border border-[#bae6fd]">
                            <span className="text-[#0369a1] font-medium truncate">
                              已选: {workflows.find((w) => w.id === selectedNodeData.config?.subWorkflowId)?.name || selectedNodeData.config?.subWorkflowId}
                            </span>
                            <button
                              type="button"
                              onClick={() => onSelectWorkflow(selectedNodeData.config.subWorkflowId)}
                              className="text-[#0284c7] hover:underline font-medium shrink-0 ml-2 cursor-pointer flex items-center gap-0.5"
                            >
                              <span>跳转查看</span>
                              <ChevronRight size={11} />
                            </button>
                          </div>
                        )}
                        <div className="p-2.5 rounded-[6px] bg-[#f8fafc] border border-[#e2e8f0] text-[11px] text-[#475569] leading-relaxed">
                          <p className="font-semibold text-[#1e293b] mb-0.5">💡 子流水线执行机制：</p>
                          <p>作为独立支线嵌入流转，自动继承当前任务的标题、工作区与环境变量。执行时其内部的 DAG 拓扑节点将有序触发，前台终端带专属支线前缀实时回显。</p>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[#85858d]">真实 CLI 命令行脚本</label>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateSelectedNodeConfig(
                              'command',
                              'git add -A && if git diff --staged --quiet; then echo "工作区干净，无需提交"; else git commit -m "feat: {{task.title}}" && git log -1 --stat; fi'
                            )
                          }
                          className="px-1.5 py-[2px] rounded-[4px] bg-[#f1f1f4] hover:bg-[#e9e9ee] border border-[#e3e3e8] text-[9.5px] text-[#4b4b53] flex items-center gap-1 transition-all"
                        >
                          <GitCommit size={10} />
                          <span>Git 提交模板</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateSelectedNodeConfig(
                              'command',
                              'echo "[部署] 开始应用构建与部署..." && pnpm build && if [ -f "scripts/deploy.sh" ]; then bash scripts/deploy.sh --skip-build; fi'
                            )
                          }
                          className="px-1.5 py-[2px] rounded-[4px] bg-[#f1f1f4] hover:bg-[#e9e9ee] border border-[#e3e3e8] text-[9.5px] text-[#4b4b53] flex items-center gap-1 transition-all"
                        >
                          <Rocket size={10} className="text-[#0284c7]" />
                          <span>应用部署模板</span>
                        </button>
                      </div>
                      <textarea
                        rows={7}
                        value={selectedNodeData.config?.command || ''}
                        onChange={(e) => updateSelectedNodeConfig('command', e.target.value)}
                        placeholder="# 在此编写要执行的 Shell / CLI 脚本命令..."
                        className="w-full min-h-[160px] bg-[#f9f9fb] focus:bg-white border border-[#e3e3e8] focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 rounded-[8px] p-2.5 font-mono text-[11px] leading-relaxed text-[#1c1c21] outline-none resize-y transition-all"
                      />
                    </div>
                  </div>
                ) : selectedEdge ? (
                  <div className="space-y-4 text-[12px]">
                    {/* 顶栏：标识与删除 */}
                    <div className="flex items-center justify-between pb-2 border-b border-[#ececf0]">
                      <div className="flex items-center gap-1.5 text-[11px] text-[#85858d] font-mono">
                        <GitBranch size={13} className="text-[#4f46e5]" />
                        <span>连线分支属性</span>
                      </div>
                      <button
                        onClick={deleteSelectedEdge}
                        className="p-1 rounded hover:bg-[#fbe9e9] text-[#d64545] transition-colors flex items-center gap-1 text-[11px]"
                        title="删除此连线"
                      >
                        <Trash2 size={13} />
                        <span>删除连线</span>
                      </button>
                    </div>

                    {/* 起止拓扑关系指示卡片 */}
                    <div className="p-2.5 rounded-[8px] bg-[#f9f9fb] border border-[#e3e3e8] space-y-2">
                      <div className="text-[10px] font-semibold text-[#85858d] tracking-wide uppercase">
                        拓扑分支流向
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11.5px]">
                        <div className="flex-1 bg-white border border-[#e3e3e8] rounded-[6px] px-2 py-1.5 truncate shadow-2xs">
                          <div className="text-[9.5px] text-[#85858d]">上游阶段</div>
                          <div className="font-medium text-[#1c1c21] truncate">
                            {(edgeSourceNode?.data as any)?.name || selectedEdge.source}
                          </div>
                        </div>
                        <ArrowRight size={14} className="text-[#818cf8] shrink-0" />
                        <div className="flex-1 bg-white border border-[#e3e3e8] rounded-[6px] px-2 py-1.5 truncate shadow-2xs">
                          <div className="text-[9.5px] text-[#85858d]">目标分支</div>
                          <div className="font-medium text-[#1c1c21] truncate">
                            {(edgeTargetNode?.data as any)?.name || selectedEdge.target}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 分支显示标签 */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[#63636b] font-medium">分支显示标签 (Label)</label>
                        <span className="text-[10px] text-[#85858d]">显示于画布连线上</span>
                      </div>
                      <input
                        type="text"
                        value={(selectedEdge.data as any)?.label ?? selectedEdge.label ?? ''}
                        onChange={(e) => updateSelectedEdge({ label: e.target.value })}
                        className="w-full h-[32px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[#1c1c21] outline-none focus:bg-white focus:border-[#4f46e5] transition-all"
                        placeholder="例如: A 线路 / 验收通过 / 异常重跑"
                      />
                    </div>

                    {/* 条件表达式 */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[#63636b] font-medium flex items-center gap-1">
                          <span>流转条件表达式 (Condition)</span>
                        </label>
                        <span className="text-[10px] text-[#85858d]">为空时默认无条件流转</span>
                      </div>
                      <input
                        type="text"
                        value={(selectedEdge.data as any)?.condition ?? ''}
                        onChange={(e) => updateSelectedEdge({ condition: e.target.value })}
                        className="w-full h-[32px] font-mono text-[11px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[#4f46e5] outline-none focus:bg-white focus:border-[#4f46e5] transition-all"
                        placeholder="例如: output === 'A' 或 exitCode === 0"
                      />

                      {/* 快捷预设按钮组 */}
                      <div className="mt-2 space-y-1.5">
                        <div className="text-[10.5px] text-[#85858d] flex items-center gap-1">
                          <Sparkles size={11} className="text-[#818cf8]" />
                          <span>常用分支条件快捷预设:</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateSelectedEdge({ condition: '', label: '默认流程' })}
                            className="px-2 py-1 rounded bg-[#f3f4f6] hover:bg-[#e5e7eb] text-[#4b5563] text-[10px] font-medium transition-all"
                          >
                            无条件 (默认)
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedEdge({ condition: "output === 'A'", label: 'A 线路' })}
                            className="px-2 py-1 rounded bg-[#eef2ff] hover:bg-[#e0e7ff] text-[#4f46e5] text-[10px] font-mono font-medium transition-all border border-[#c7d2fe]"
                          >
                            output === 'A'
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedEdge({ condition: "output === 'B'", label: 'B 线路' })}
                            className="px-2 py-1 rounded bg-[#eef2ff] hover:bg-[#e0e7ff] text-[#4f46e5] text-[10px] font-mono font-medium transition-all border border-[#c7d2fe]"
                          >
                            output === 'B'
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedEdge({ condition: "output === 'C'", label: 'C 线路' })}
                            className="px-2 py-1 rounded bg-[#eef2ff] hover:bg-[#e0e7ff] text-[#4f46e5] text-[10px] font-mono font-medium transition-all border border-[#c7d2fe]"
                          >
                            output === 'C'
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedEdge({ condition: "exitCode === 0", label: '执行成功' })}
                            className="px-2 py-1 rounded bg-[#ecfdf5] hover:bg-[#d1fae5] text-[#059669] text-[10px] font-mono font-medium transition-all border border-[#a7f3d0]"
                          >
                            exitCode === 0
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedEdge({ condition: "output?.approved === true", label: '审批通过' })}
                            className="px-2 py-1 rounded bg-[#fffbeb] hover:bg-[#fef3c7] text-[#b45309] text-[10px] font-mono font-medium transition-all border border-[#fde68a]"
                          >
                            output?.approved === true
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 变量与分支机制使用说明卡片 */}
                    <div className="bg-[#f9fafb] border border-[#ececf0] rounded-[7px] p-2.5 space-y-1.5 text-[10.5px] text-[#6b7280]">
                      <div className="font-semibold text-[#374151] flex items-center gap-1 text-[11px]">
                        <span>💡 多分支编排指南</span>
                      </div>
                      <div>
                        • <code className="bg-[#e5e7eb] text-[#1f2937] px-1 py-0.5 rounded font-mono">output</code>：上游阶段执行返回的结构化输出数据。
                      </div>
                      <div>
                        • <code className="bg-[#e5e7eb] text-[#1f2937] px-1 py-0.5 rounded font-mono">exitCode</code>：命令行退出状态码（0 代表无错误退出）。
                      </div>
                      <div>
                        • <code className="bg-[#e5e7eb] text-[#1f2937] px-1 py-0.5 rounded font-mono">context</code>：当前任务关联的全局上下文变量池。
                      </div>
                      <div className="pt-1 text-[#85858d] border-t border-[#e5e7eb]">
                        当一个节点连接多条出边时，满足条件的线路会继续流转，未满足的线路将被系统自动安全跳过（Skip）。
                      </div>
                    </div>

                    {/* 保存按钮 */}
                    <div className="pt-2">
                      <button
                        onClick={() => handleSave()}
                        className="w-full h-[30px] rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-sm"
                      >
                        <Save size={12} />
                        <span>保存工作流编排</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 text-[12px]">
                    <div className="flex items-center justify-between pb-2 border-b border-[#ececf0]">
                      <div className="flex items-center gap-2">
                        <Workflow size={14} className="text-[#4f46e5]" />
                        <span className="font-semibold text-[12.5px] text-[#1c1c21]">
                          流水线全局配置
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleDuplicateCurrentWorkflow}
                          disabled={isDuplicating}
                          className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-colors"
                          title="复制流水线"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={() => setIsDeleteModalOpen(true)}
                          className="p-1 rounded text-[#85858d] hover:text-[#e11d48] hover:bg-[#fff1f2] transition-colors"
                          title="删除该流水线"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[#85858d] mb-1 font-medium">流水线名称</label>
                      <input
                        type="text"
                        value={workflowName}
                        onChange={(e) => setWorkflowName(e.target.value)}
                        onBlur={() => {
                          const trimmed = workflowName.trim();
                          if (trimmed && trimmed !== activeWorkflow.name) {
                            handleSave(trimmed);
                          }
                        }}
                        className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[#1c1c21] outline-none focus:bg-white focus:border-[#4f46e5] transition-all"
                        placeholder="流水线名称"
                      />
                    </div>

                    <div>
                      <label className="block text-[#85858d] mb-1 font-medium">流水线分类标签</label>
                      <TagInput
                        tags={workflowTags}
                        onChange={(newTags) => {
                          setWorkflowTags(newTags);
                          handleSave(undefined, undefined, newTags);
                        }}
                        placeholder="输入标签（例如：工作、部署、QA）后回车..."
                      />
                    </div>

                    <div>
                      <label className="block text-[#85858d] mb-1 font-medium">流程描述说明</label>
                      <textarea
                        rows={4}
                        value={workflowDescription}
                        onChange={(e) => setWorkflowDescription(e.target.value)}
                        onBlur={() => {
                          const trimmed = workflowDescription.trim();
                          if (trimmed !== (activeWorkflow.description || '')) {
                            handleSave(undefined, trimmed);
                          }
                        }}
                        className="w-full min-h-[96px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[8px] p-2.5 text-[12px] leading-relaxed text-[#1c1c21] outline-none resize-y focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all placeholder:text-[#85858d]"
                        placeholder="描述此流水线的业务目标与流转规则..."
                      />
                    </div>

                    <div>
                      <label className="block text-[#85858d] mb-1 font-medium">流水线标识 (ID)</label>
                      <div className="px-2.5 py-1.5 rounded-[6px] bg-[#f4f4f6] font-mono text-[11px] text-[#4b4b53] border border-[#ececf0] flex items-center justify-between">
                        <span>{activeWorkflow.id}</span>
                        <span className="text-[10px] text-[#85858d]">系统唯一</span>
                      </div>
                    </div>

                    {/* 工程工作区关联策略 */}
                    <div className="pt-2 border-t border-[#ececf0] space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11.5px] font-medium text-[#1c1c21] flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={workflowRequireWorkspace}
                            onChange={(e) => setWorkflowRequireWorkspace(e.target.checked)}
                            className="w-3.5 h-3.5 rounded-[4px] border-[#d4d4d8] text-[#4f46e5] focus:ring-[#4f46e5]"
                          />
                          <span>必须关联工程工作区</span>
                        </label>
                        <span className={`text-[10px] ${workflowRequireWorkspace ? 'text-[#dc2626] font-medium' : 'text-[#85858d]'}`}>
                          {workflowRequireWorkspace ? '必选本地工程' : '非必填'}
                        </span>
                      </div>
                      <p className="text-[10.5px] text-[#85858d] leading-relaxed">
                        勾选后，发起任务或编排调试时必须手动指定本地代码工程根目录；未勾选时在独立沙箱执行，不依赖本地工程。
                      </p>

                      <div className="pt-0.5">
                        <label className="block text-[#85858d] mb-1 font-medium text-[10.5px]">
                          默认绑定工作区 (可选)
                        </label>
                        <WorkspacePicker
                          value={workflowDefaultWorkspace}
                          onChange={setWorkflowDefaultWorkspace}
                          placeholder="可留空，或预设固定关联的工程目录..."
                        />
                      </div>
                    </div>

                    <div className="bg-[#f9f9fb] border border-[#ececf0] rounded-[7px] p-2.5 space-y-1.5 text-[11px] text-[#85858d]">
                      <div className="flex items-center justify-between">
                        <span>拓扑节点数</span>
                        <span className="font-mono text-[#1c1c21] font-medium">
                          {nodes.filter((n) => !n.data?.isGhost).length} 个
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>拓扑依赖连线</span>
                        <span className="font-mono text-[#1c1c21] font-medium">
                          {edges.filter((e) => !e.data?.isGhost).length} 条
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>最后更新</span>
                        <span className="font-mono text-[#1c1c21]">
                          {activeWorkflow.updatedAt
                            ? new Date(activeWorkflow.updatedAt).toLocaleString('zh-CN', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '刚刚'}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex flex-col gap-2">
                      <button
                        onClick={() => handleSave()}
                        className="w-full h-[30px] rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium flex items-center justify-center gap-1.5 transition-all active:scale-95 shadow-sm"
                      >
                        <Save size={12} />
                        <span>保存名称与编排</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-[#ececf0] text-[10.5px] text-[#85858d]">
                  拖拽节点两侧圆点即可在画布连线；亦可通过 AI 编排助手全流程规划。
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 流程信息编辑弹窗 */}
      <EditWorkflowModal
        isOpen={isEditModalOpen}
        workflow={{
          ...activeWorkflow,
          name: workflowName || activeWorkflow.name,
          description: workflowDescription,
          tags: workflowTags,
        }}
        onClose={() => setIsEditModalOpen(false)}
        onSave={async ({ name, description, tags }) => {
          setWorkflowName(name);
          setWorkflowDescription(description);
          if (tags) setWorkflowTags(tags);
          await handleSave(name, description, tags);
        }}
      />

      {/* 删除流程确认弹窗 */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        title="删除自动化流水线"
        targetName={workflowName || activeWorkflow.name}
        targetTag={activeWorkflow.id}
        description="确定要永久删除该自动化编排流程吗？此操作不可撤销，画布与节点配置将被清除。"
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        loading={isDeleting}
        onClose={() => {
          if (!isDeleting) setIsDeleteModalOpen(false);
        }}
        onConfirm={handleConfirmDeleteCurrentWorkflow}
      />

      {/* 重置 AI 对话确认弹窗 */}
      <ConfirmModal
        isOpen={isResetSessionModalOpen}
        title="重置 AI 编排对话"
        targetName={`流程: ${workflowName || activeWorkflow.name}`}
        targetTag={activeWorkflow.id}
        description="确定要重置当前工作流的 AI 编排对话历史吗？重置后将清除与 Copilot 的历史交互记录与暂存草稿。"
        confirmText="确认重置"
        cancelText="取消"
        variant="warning"
        loading={isResettingSession}
        onClose={() => {
          if (!isResettingSession) setIsResetSessionModalOpen(false);
        }}
        onConfirm={handleConfirmResetSession}
      />

      {/* 退出调试确认弹窗 */}
      <ConfirmModal
        isOpen={isExitDebugModalOpen}
        title="退出编排调试"
        targetName={`任务: ${debugTask?.title || debugTask?.id || ''}`}
        targetTag={debugTask?.id}
        description="调试任务仍在后台执行中（等待门禁审批或运行中）。您可以选择中止任务并退出，或者仅退出监控视图（任务将在后台继续执行）。"
        confirmText="中止并退出"
        cancelText="仅退出监控"
        variant="warning"
        onConfirm={() => handleExitDebug(true)}
        onClose={() => handleExitDebug(false)}
      />

      {/* 编排调试弹窗 */}
      <DebugWorkflowModal
        isOpen={isDebugModalOpen}
        onClose={() => setIsDebugModalOpen(false)}
        workflow={activeWorkflow}
        onStartDebug={handleStartDebug}
      />

      {/* Agent 实时交互会话抽屉 */}
      <AgentSessionDrawer
        isOpen={isAgentSessionOpen}
        onClose={() => setIsAgentSessionOpen(false)}
        taskId={inspectingSessionTaskId}
        taskTitle={debugTask?.title}
        nodeId={inspectingSessionNodeId}
        nodeName={inspectingSessionNodeName}
        workspace={debugTask?.workspace}
      />
    </div>
  );
};

// ==========================================
// 4. 导出包装 ReactFlowProvider 的主组件
// ==========================================
export const WorkflowEditorView: React.FC<WorkflowEditorViewProps> = (props) => {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  );
};
