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
} from 'lucide-react';
import {
  WorkflowDefinition,
  NodeType,
  WorkflowSessionState,
  SessionChatMessage,
  WorkflowActionPayload,
} from '@openloop/core';
import { api } from '../services/api';
import { layoutWorkflowDag } from '../utils/dagLayout';
import { EditWorkflowModal } from '../components/EditWorkflowModal';
import { ConfirmModal } from '../components/ConfirmModal';

// ==========================================
// 1. 自定义节点外观（极简高质感 + 智能体生成发光）
// ==========================================
const CustomWorkflowNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as any;
  const type: NodeType = nodeData.type || 'cli';
  const isNew = Boolean(nodeData.isNew);

  const typeConfig: Record<
    NodeType,
    { label: string; icon: React.ReactNode; bg: string; text: string }
  > = {
    agent: {
      label: 'Agent 编码',
      icon: <Bot size={13} />,
      bg: 'bg-[#eeedfd]',
      text: 'text-[#4f46e5]',
    },
    hook: {
      label: 'Hook 触发',
      icon: <Zap size={13} />,
      bg: 'bg-[#fbf0df]',
      text: 'text-[#b45309]',
    },
    midscene: {
      label: 'Midscene 测试',
      icon: <Target size={13} />,
      bg: 'bg-[#e4f6ec]',
      text: 'text-[#189a58]',
    },
    'stitch-image': {
      label: '截图拼接动图',
      icon: <FileVideo size={13} />,
      bg: 'bg-[#eff6ff]',
      text: 'text-[#1d4ed8]',
    },
    'qa-approval': {
      label: 'QA 审核验收',
      icon: <CheckSquare size={13} />,
      bg: 'bg-[#fbf0df]',
      text: 'text-[#b45309]',
    },
    cli: {
      label: 'CLI 脚本',
      icon: <Terminal size={13} />,
      bg: 'bg-[#f1f1f4]',
      text: 'text-[#4b4b53]',
    },
    custom: {
      label: '插件扩展',
      icon: <Sparkles size={13} />,
      bg: 'bg-[#fdf2f8]',
      text: 'text-[#db2777]',
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
        icon: <GitCommit size={13} />,
        bg: 'bg-[#1c1c21] text-white',
        text: 'text-[#1c1c21]',
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
        icon: <Rocket size={13} />,
        bg: 'bg-[#0f172a] text-[#38bdf8]',
        text: 'text-[#0f172a]',
      };
    }
    return typeConfig[type] || typeConfig.cli;
  }, [type, nodeData.name, nodeData.config?.command]);

  return (
    <div
      className={`w-60 rounded-[8px] bg-white border p-3 transition-all relative ${
        selected
          ? 'border-[#4f46e5] shadow-[0_0_0_2px_rgba(79,70,229,0.2),0_4px_12px_rgba(0,0,0,0.08)]'
          : isNew
          ? 'border-[#6366f1] ring-2 ring-[#6366f1]/40 shadow-[0_0_16px_rgba(99,102,241,0.25)]'
          : 'border-[#e3e3e8] shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:border-[#b9b9c2]'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="w-2.5 h-2.5 bg-[#4f46e5] border-2 border-white"
      />

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`p-1 rounded-[4px] ${currentConfig.bg} ${currentConfig.text}`}>
            {currentConfig.icon}
          </span>
          <span className={`text-[10px] font-semibold tracking-wide ${currentConfig.text}`}>
            {currentConfig.label}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isNew && (
            <span className="text-[9px] px-1 py-[1px] rounded bg-[#eeedfd] text-[#4f46e5] font-medium scale-95">
              AI生成
            </span>
          )}
          <span className="text-[9.5px] font-mono text-[#85858d]">{nodeData.id}</span>
        </div>
      </div>

      <div className="text-[12.5px] font-medium text-[#1c1c21] truncate">{nodeData.name}</div>

      <div className="mt-1.5 text-[10px] text-[#85858d] font-mono bg-[#f9f9fb] border border-[#ececf0] px-2 py-1 rounded-[4px] truncate">
        {type === 'agent' && (nodeData.config?.prompt || 'Agent 自动实现需求')}
        {type === 'midscene' && (nodeData.config?.testUrl || '智能断言与多步截屏')}
        {type === 'stitch-image' && (nodeData.config?.outputFile || '生成动图 preview.gif')}
        {type === 'hook' && (nodeData.config?.webhookUrl || '完成事件广播 -> 自动流转')}
        {type === 'qa-approval' && (nodeData.config?.approvalPrompt || '人工与用例核验确认')}
        {type === 'cli' && (nodeData.config?.command || '执行命令行指令')}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="w-2.5 h-2.5 bg-[#4f46e5] border-2 border-white"
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
  onOpenTaskLogs: (taskId: string) => void;
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
  const [saveStatus, setSaveStatus] = useState<string>('');

  // 流水线基础信息与弹窗状态
  const [workflowName, setWorkflowName] = useState(activeWorkflow?.name || '');
  const [workflowDescription, setWorkflowDescription] = useState(activeWorkflow?.description || '');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  // 右侧双模工作台状态：'copilot' (AI助手) | 'inspector' (节点属性)
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<'copilot' | 'inspector'>('copilot');

  // Copilot 会话状态
  const [copilotState, setCopilotState] = useState<WorkflowSessionState | null>(null);
  const [inputMessage, setInputMessage] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [appliedActionIds, setAppliedActionIds] = useState<Set<string>>(new Set());
  const [undoSnapshot, setUndoSnapshot] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});

  const chatEndRef = useRef<HTMLDivElement>(null);
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

    const rfEdges: Edge[] = activeWorkflow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: true,
      style: { stroke: '#4f46e5', strokeWidth: 1.8 },
    }));

    // 若原始坐标全为 0 或重叠，进行一次初始智能排版
    const needsInitialLayout =
      rfNodes.length > 1 &&
      rfNodes.every((n) => n.position.x === 0 && n.position.y === 0);

    const finalNodes = needsInitialLayout ? layoutWorkflowDag(rfNodes, rfEdges) : rfNodes;

    setNodes(finalNodes);
    setEdges(rfEdges);
    setSelectedNodeId(null);

    // 延迟平滑适配视口
    setTimeout(() => {
      reactFlow.fitView({ padding: 0.25, duration: 400 });
    }, 150);
  }, [workflowId, activeWorkflow]);

  // 同步当前工作流名称与描述
  useEffect(() => {
    if (activeWorkflow) {
      setWorkflowName(activeWorkflow.name || '');
      setWorkflowDescription(activeWorkflow.description || '');
      setTitleDraft(activeWorkflow.name || '');
    }
  }, [activeWorkflow?.id, activeWorkflow?.name, activeWorkflow?.description]);

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
      }
    });
    return () => unsub();
  }, [workflowId]);

  // 滚动到聊天窗口最底
  useEffect(() => {
    if (rightPanelTab === 'copilot' && rightPanelOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [copilotState?.messages, rightPanelTab, rightPanelOpen]);

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
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: '#4f46e5', strokeWidth: 1.8 },
          },
          eds
        )
      ),
    []
  );

  const handleNodeClick = (_: any, node: Node) => {
    setSelectedNodeId(node.id);
    // 点击节点自动切到属性编辑，方便精细微调
    setRightPanelOpen(true);
    setRightPanelTab('inspector');
  };

  // 取消新节点呼吸态
  useEffect(() => {
    const timer = setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => (n.data?.isNew ? { ...n, data: { ...n.data, isNew: false } } : n))
      );
    }, 4500);
    return () => clearTimeout(timer);
  }, [nodes]);

  // 键盘 Esc 取消选中
  useEffect(() => {
    if (!selectedNodeId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNodeId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId]);

  // 快捷一键自动排版 (Auto Layout)
  const handleAutoLayout = useCallback(() => {
    if (import.meta.env?.DEV) {
      console.log('[Workflow:Layout] 触发一键 DAG 自动排版计算');
    }
    const layouted = layoutWorkflowDag(nodes, edges);
    setNodes(layouted);
    setTimeout(() => {
      reactFlow.fitView({ padding: 0.25, duration: 500 });
    }, 50);
  }, [nodes, edges, reactFlow]);

  // 应用 Agent 编排指令到画布 (Apply Action)
  const applyWorkflowAction = useCallback(
    (actionPayload: WorkflowActionPayload, messageId?: string) => {
      if (!actionPayload) return;

      if (import.meta.env?.DEV) {
        console.log('[WorkflowCopilot] 应用编排 Action 到画布:', actionPayload);
      }

      // 保存当前状态供撤销 (Undo)
      setUndoSnapshot({ nodes: [...nodes], edges: [...edges] });

      if (actionPayload.action === 'replace_all' && actionPayload.workflow) {
        const wf = actionPayload.workflow;
        const newNodes: Node[] = (wf.nodes || []).map((n) => ({
          id: n.id,
          type: 'customNode',
          position: n.position || { x: 0, y: 0 },
          data: {
            id: n.id,
            name: n.name,
            type: n.type,
            config: n.config || {},
            isNew: true,
          },
        }));

        const newEdges: Edge[] = (wf.edges || []).map((e) => ({
          id: e.id || `e_${e.source}_${e.target}`,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: true,
          style: { stroke: '#4f46e5', strokeWidth: 1.8 },
        }));

        // 自动完成 DAG 层级对齐排版
        const layoutedNodes = layoutWorkflowDag(newNodes, newEdges);
        setNodes(layoutedNodes);
        setEdges(newEdges);

        if (messageId) {
          setAppliedActionIds((prev) => new Set([...prev, messageId]));
        }

        setTimeout(() => {
          reactFlow.fitView({ padding: 0.25, duration: 600 });
        }, 80);
      } else if (actionPayload.action === 'patch') {
        let updatedNodes = [...nodes];
        let updatedEdges = [...edges];

        // 1. 删除节点与连线
        if (actionPayload.removeNodeIds && actionPayload.removeNodeIds.length > 0) {
          const toRemove = new Set(actionPayload.removeNodeIds);
          updatedNodes = updatedNodes.filter((n) => !toRemove.has(n.id));
          updatedEdges = updatedEdges.filter(
            (e) => !toRemove.has(e.source) && !toRemove.has(e.target)
          );
        }
        if (actionPayload.removeEdgeIds && actionPayload.removeEdgeIds.length > 0) {
          const toRemoveEdges = new Set(actionPayload.removeEdgeIds);
          updatedEdges = updatedEdges.filter((e) => !toRemoveEdges.has(e.id));
        }

        // 2. 更新既有节点
        if (actionPayload.updateNodes && actionPayload.updateNodes.length > 0) {
          const updateMap = new Map(actionPayload.updateNodes.map((u) => [u.id!, u]));
          updatedNodes = updatedNodes.map((n) => {
            const patch = updateMap.get(n.id);
            if (!patch) return n;
            return {
              ...n,
              data: {
                ...n.data,
                name: patch.name || n.data.name,
                config: { ...n.data.config, ...(patch.config || {}) },
                isNew: true,
              },
            };
          });
        }

        // 3. 追加新节点
        if (actionPayload.addNodes && actionPayload.addNodes.length > 0) {
          const existingIds = new Set(updatedNodes.map((n) => n.id));
          for (const n of actionPayload.addNodes) {
            if (!existingIds.has(n.id)) {
              updatedNodes.push({
                id: n.id,
                type: 'customNode',
                position: n.position || { x: 0, y: 0 },
                data: {
                  id: n.id,
                  name: n.name,
                  type: n.type,
                  config: n.config || {},
                  isNew: true,
                },
              });
            }
          }
        }

        // 4. 追加新连线
        if (actionPayload.addEdges && actionPayload.addEdges.length > 0) {
          const existingEdgeIds = new Set(updatedEdges.map((e) => e.id));
          for (const e of actionPayload.addEdges) {
            const edgeId = e.id || `e_${e.source}_${e.target}`;
            if (!existingEdgeIds.has(edgeId)) {
              updatedEdges.push({
                id: edgeId,
                source: e.source,
                target: e.target,
                label: e.label,
                animated: true,
                style: { stroke: '#4f46e5', strokeWidth: 1.8 },
              });
            }
          }
        }

        const layoutedNodes = layoutWorkflowDag(updatedNodes, updatedEdges);
        setNodes(layoutedNodes);
        setEdges(updatedEdges);

        if (messageId) {
          setAppliedActionIds((prev) => new Set([...prev, messageId]));
        }

        setTimeout(() => {
          reactFlow.fitView({ padding: 0.25, duration: 600 });
        }, 80);
      }
    },
    [nodes, edges, reactFlow]
  );

  // 撤销上一步编排变更
  const handleUndo = useCallback(() => {
    if (!undoSnapshot) return;
    setNodes(undoSnapshot.nodes);
    setEdges(undoSnapshot.edges);
    setUndoSnapshot(null);
    setTimeout(() => {
      reactFlow.fitView({ padding: 0.25, duration: 500 });
    }, 50);
  }, [undoSnapshot, reactFlow]);

  // 发送消息给 Copilot
  const handleSendMessage = async (textToSend?: string) => {
    const content = (textToSend || inputMessage).trim();
    if (!content || isSendingMessage) return;

    setInputMessage('');
    setIsSendingMessage(true);

    // 构建当前画布快照上下文
    const snapshot = {
      name: activeWorkflow?.name,
      nodes: nodes.map((n) => ({
        id: n.id,
        name: (n.data as any).name,
        type: (n.data as any).type,
        config: (n.data as any).config,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
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
      agentName: 'Workflow Architect Copilot',
    }));

    try {
      await api.sendWorkflowChatMessage(workflowId, content, snapshot);
    } catch (err: any) {
      alert(`发送编排需求失败: ${err.message}`);
    } finally {
      setIsSendingMessage(false);
    }
  };

  // 重置对话
  const handleResetSession = async () => {
    if (!confirm('确定要重置当前工作流的 AI 编排对话历史吗？')) return;
    try {
      await api.resetWorkflowSession(workflowId);
      setCopilotState((prev) => (prev ? { ...prev, messages: [] } : null));
      setAppliedActionIds(new Set());
    } catch (err: any) {
      alert(`重置失败: ${err.message}`);
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
    setRightPanelOpen(true);
    setRightPanelTab('inspector');
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

  // 保存工作流
  const handleSave = async (overrideName?: string, overrideDesc?: string) => {
    if (!activeWorkflow) return;

    const finalName = (overrideName ?? workflowName).trim() || activeWorkflow.name;
    const finalDesc = (overrideDesc ?? workflowDescription).trim();

    const updatedWorkflow: WorkflowDefinition = {
      ...activeWorkflow,
      name: finalName,
      description: finalDesc,
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
        label: e.label,
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
        label: e.label,
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
      onRefresh();
      if (onSelectWorkflow) {
        onSelectWorkflow(newId);
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 流程复制失败:', err);
      }
      alert(`复制工作流失败: ${err?.message || '未知错误'}`);
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
      setIsDeleteModalOpen(false);
      onRefresh();
      onBack();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEditor] 删除工作流失败:', err);
      }
      alert(`删除工作流失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // 立即触发测试运行
  const handleRunNow = async () => {
    if (!activeWorkflow) return;
    try {
      const task = await api.createTask({
        title: `编排调试: ${activeWorkflow.name}`,
        workflowId: activeWorkflow.id,
        autoRun: true,
      });
      alert(`测试任务已触发: ${task.id}`);
      onRefresh();
      onOpenTaskLogs(task.id);
    } catch (err: any) {
      alert(`启动失败: ${err.message}`);
    }
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
      {/* 编排器顶栏 */}
      <div className="h-[46px] px-4 bg-white border-b border-[#e3e3e8] flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          {/* 返回按钮 */}
          <button
            onClick={onBack}
            className="flex items-center gap-1 h-[26px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-xs"
          >
            <ArrowLeft size={12} />
            <span>返回列表</span>
          </button>

          <span className="text-[#e3e3e8]">|</span>

          {/* 流程名称与快速修改 */}
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5">
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
                className="h-[26px] px-2 text-[13px] font-semibold text-[#1c1c21] bg-[#f9f9fb] border border-[#4f46e5] rounded-[5px] outline-none shadow-xs"
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
                className="p-1 rounded hover:bg-[#e4f6ec] text-[#189a58] transition-colors"
                title="确定修改"
              >
                <Check size={12} strokeWidth={2.4} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(workflowName);
                  setIsEditingTitle(false);
                }}
                className="p-1 rounded hover:bg-[#f1f1f4] text-[#85858d] transition-colors"
                title="取消修改"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 group/title">
              <span
                onClick={() => {
                  setTitleDraft(workflowName);
                  setIsEditingTitle(true);
                }}
                className="text-[13px] font-semibold text-[#1c1c21] hover:text-[#4f46e5] cursor-pointer transition-colors"
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
                className="p-0.5 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] opacity-0 group-hover/title:opacity-100 transition-all"
                title="快速重命名"
              >
                <Edit3 size={11} />
              </button>
              <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                {activeWorkflow.id}
              </span>
            </div>
          )}

          <div className="text-[11.5px] text-[#85858d] font-mono">
            ({nodes.length} 节点 · {edges.length} 连线)
          </div>
        </div>

        <div className="flex items-center gap-2">
          {undoSnapshot && (
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 px-2.5 h-[26px] rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-xs"
              title="撤销上一次编排变更"
            >
              <Undo2 size={12} />
              <span>撤销变更</span>
            </button>
          )}

          {/* 自动排版按钮 */}
          <button
            onClick={handleAutoLayout}
            className="flex items-center gap-1 px-2.5 h-[26px] rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-xs"
            title="使用 DAG 层次算法自动整齐对齐连线"
          >
            <LayoutGrid size={12} className="text-[#4f46e5]" />
            <span>自动排版</span>
          </button>

          {/* 复制流程 */}
          <button
            onClick={handleDuplicateCurrentWorkflow}
            disabled={isDuplicating}
            className="flex items-center gap-1 px-2.5 h-[26px] rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-xs disabled:opacity-50"
            title="克隆当前编排副本"
          >
            {isDuplicating ? (
              <Loader2 size={11.5} className="animate-spin text-[#4f46e5]" />
            ) : (
              <Copy size={11.5} />
            )}
            <span>复制</span>
          </button>

          {/* 流程属性 */}
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="flex items-center gap-1 px-2.5 h-[26px] rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-xs"
            title="编辑流程名称与业务描述"
          >
            <Edit3 size={11.5} />
            <span>属性</span>
          </button>

          {/* 删除流程 */}
          <button
            onClick={() => setIsDeleteModalOpen(true)}
            className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] border border-transparent hover:border-[#ffe4e6] text-[#85858d] hover:bg-[#fff1f2] hover:text-[#e11d48] transition-all"
            title="删除此流程"
          >
            <Trash2 size={12} />
          </button>

          <span className="text-[#e3e3e8]">|</span>

          {/* AI 编排助手唤起按钮 */}
          <button
            onClick={() => {
              setRightPanelOpen(true);
              setRightPanelTab('copilot');
            }}
            className={`flex items-center gap-1.5 px-3 h-[26px] rounded-[6px] border transition-all shadow-xs text-[11.5px] font-medium ${
              rightPanelOpen && rightPanelTab === 'copilot'
                ? 'bg-[#eeedfd] border-[#c7d2fe] text-[#4f46e5]'
                : 'bg-white border-[#e3e3e8] hover:bg-[#f1f1f4] text-[#1c1c21]'
            }`}
          >
            <Sparkles
              size={12}
              className={copilotState?.isBusy ? 'text-[#7c3aed] animate-spin' : 'text-[#4f46e5]'}
            />
            <span>AI 编排助手</span>
            {copilotState?.isBusy && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-pulse" />
            )}
          </button>

          <span className="text-[#e3e3e8]">|</span>

          {saveStatus && (
            <span className="text-[11.5px] text-[#189a58] font-medium">{saveStatus}</span>
          )}

          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-3 h-[26px] rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[12px] font-medium text-[#1c1c21] transition-all shadow-xs"
          >
            <Save size={13} />
            <span>保存编排</span>
          </button>

          <button
            onClick={handleRunNow}
            className="flex items-center gap-1 px-3 h-[26px] rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white transition-all active:scale-95 shadow-xs"
          >
            <Play size={12} strokeWidth={2.4} />
            <span>立即调试</span>
          </button>
        </div>
      </div>

      {/* 画布核心与协同侧栏 */}
      <div className="flex-1 relative flex overflow-hidden">
        {/* 左侧节点组件库悬浮栏 */}
        <div className="absolute top-4 left-4 z-10 bg-white/95 backdrop-blur border border-[#e3e3e8] rounded-[10px] p-2 shadow-[0_4px_16px_rgba(0,0,0,0.06)] flex flex-col gap-1 w-44">
          <div className="px-2 py-1 text-[10px] font-semibold text-[#85858d] tracking-wide flex items-center justify-between">
            <span>+ 组件节点库</span>
            <Layers size={11} className="text-[#85858d]" />
          </div>
          <button
            onClick={() => addNode('agent', 'Agent 编码')}
            className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all"
          >
            <Bot size={13} className="text-[#4f46e5]" />
            <span>Agent 接入</span>
          </button>
          <button
            onClick={() => addNode('hook', '开发完成 Hook')}
            className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all"
          >
            <Zap size={13} className="text-[#b45309]" />
            <span>Hook 调度流转</span>
          </button>
          <button
            onClick={() => addNode('midscene', 'Midscene UI 验证')}
            className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all"
          >
            <Target size={13} className="text-[#189a58]" />
            <span>Midscene 自动化</span>
          </button>
          <button
            onClick={() => addNode('stitch-image', '拼接动图 CLI')}
            className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all"
          >
            <FileVideo size={13} className="text-[#1d4ed8]" />
            <span>拼接动图 CLI</span>
          </button>
          <button
            onClick={() => addNode('qa-approval', 'QA 用例人工验收')}
            className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all"
          >
            <CheckSquare size={13} className="text-[#b45309]" />
            <span>QA 人工/用例验收</span>
          </button>
          <button
            onClick={() => addNode('git-commit', 'Git 自动提交代码')}
            className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all"
          >
            <GitCommit size={13} className="text-[#1c1c21]" />
            <span>Git 自动提交代码</span>
          </button>
          <button
            onClick={() => addNode('deploy', '生产应用部署')}
            className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all"
          >
            <Rocket size={13} className="text-[#0284c7]" />
            <span>生产应用部署</span>
          </button>
          <button
            onClick={() => addNode('cli', '通用 CLI 命令')}
            className="flex items-center gap-2 px-2 h-[26px] rounded-[6px] hover:bg-[#f1f1f4] text-[11.5px] text-[#1c1c21] text-left transition-all"
          >
            <Terminal size={13} className="text-[#85858d]" />
            <span>Shell CLI 脚本</span>
          </button>
        </div>

        {/* 零手动编排欢迎态（Empty / Welcome State Overlay，当节点数 <= 1 时出现） */}
        {nodes.length <= 1 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-white/95 backdrop-blur-md border border-[#c7d2fe] p-4 rounded-[12px] shadow-[0_8px_32px_rgba(79,70,229,0.12)] max-w-xl w-[90%] pointer-events-auto">
            <div className="flex items-center justify-between pb-2 border-b border-[#ececf0] mb-3">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-[6px] bg-[#eeedfd] text-[#4f46e5]">
                  <Wand2 size={14} />
                </span>
                <span className="text-[12.5px] font-semibold text-[#1c1c21]">
                  零手动编排 · 欢迎使用 AI 流程架构师
                </span>
              </div>
              <span className="text-[10px] text-[#6366f1] font-mono">Zero-Touch Orchestration</span>
            </div>

            <p className="text-[11.5px] text-[#63636b] mb-3 leading-relaxed">
              无需手动拖拽节点，点击下方常用方案或在右侧输入自然语言，智能体将自动规划节点、依赖与排版：
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

        {/* React Flow 画布主体 */}
        <div className="flex-1 w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={() => setSelectedNodeId(null)}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background color="#d1d1d8" gap={18} size={1} />
            <Controls />
          </ReactFlow>
        </div>

        {/* 右侧双模工作台侧栏 (AI Copilot & Node Inspector) */}
        {rightPanelOpen && (
          <div className="w-80 md:w-96 border-l border-[#e3e3e8] bg-white flex flex-col z-20 shadow-[-4px_0_16px_rgba(0,0,0,0.04)] animate-in slide-in-from-right duration-200">
            {/* 顶栏 Tab 切换器 */}
            <div className="h-[42px] px-3 border-b border-[#e3e3e8] flex items-center justify-between shrink-0 bg-[#fafafc]">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setRightPanelTab('copilot')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all ${
                    rightPanelTab === 'copilot'
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
                  onClick={() => setRightPanelTab('inspector')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all ${
                    rightPanelTab === 'inspector'
                      ? 'bg-white text-[#1c1c21] shadow-xs border border-[#e3e3e8]'
                      : 'text-[#85858d] hover:text-[#1c1c21]'
                  }`}
                >
                  <Settings2 size={12} className="text-[#85858d]" />
                  <span>{selectedNode ? '节点属性' : '流程属性'}</span>
                  {selectedNode && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5]" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1">
                {rightPanelTab === 'copilot' && (
                  <button
                    onClick={handleResetSession}
                    title="清空对话历史"
                    className="p-1 rounded hover:bg-[#f1f1f4] text-[#85858d] hover:text-[#1c1c21] transition-colors"
                  >
                    <RefreshCw size={12} />
                  </button>
                )}
                <button
                  onClick={() => setRightPanelOpen(false)}
                  title="收起侧栏"
                  className="p-1 rounded hover:bg-[#f1f1f4] text-[#85858d] hover:text-[#1c1c21] transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Tab 1: AI 编排助手 */}
            {rightPanelTab === 'copilot' && (
              <div className="flex-1 flex flex-col min-h-0 bg-white">
                {/* 消息滚动流 */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 text-[12px]">
                  {(!copilotState?.messages || copilotState.messages.length === 0) ? (
                    <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center p-4 text-[#85858d]">
                      <div className="w-10 h-10 rounded-[10px] bg-[#eeedfd] border border-[#c7d2fe] flex items-center justify-center mb-2.5 text-[#4f46e5]">
                        <Bot size={20} />
                      </div>
                      <div className="text-[12.5px] font-semibold text-[#1c1c21] mb-1">
                        AI 流程编排架构师
                      </div>
                      <div className="text-[11px] text-[#85858d] leading-relaxed max-w-[260px]">
                        直接输入您的业务目标，Agent 将为您全自动规划节点类型、CLI 脚本与执行拓扑。
                      </div>
                    </div>
                  ) : (
                    copilotState.messages.map((msg) => {
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

                      // 提取正文文本（过滤掉冗长的 raw markdown 块）
                      const cleanContent = msg.content
                        .replace(/```(?:workflow-action|json)?\s*[\s\S]*?```/g, '')
                        .trim();

                      return (
                        <div key={msg.id} className="space-y-2">
                          {/* 深度思考模块 Thinking */}
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
                                    {msg.isThinking ? '智能体深度思考中...' : '编排架构思考过程'}
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
                            <div className="p-3 rounded-[9px] bg-white border border-[#e3e3e8] text-[#1c1c21] text-[11.5px] leading-relaxed shadow-xs whitespace-pre-wrap">
                              {cleanContent}
                            </div>
                          )}

                          {/* 结构化 Action 卡片 (高质感预览与一键应用) */}
                          {actionPayload && (
                            <div className="p-3 rounded-[9px] bg-[#f8f9ff] border border-[#c7d2fe] shadow-xs space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <CheckCircle2 size={13} className="text-[#4f46e5]" />
                                  <span className="text-[11.5px] font-semibold text-[#1c1c21]">
                                    {actionPayload.action === 'replace_all'
                                      ? '全新 DAG 拓扑方案'
                                      : '局部增量编排补丁'}
                                  </span>
                                </div>
                                <span className="text-[9.5px] font-mono text-[#6366f1] bg-[#eeedfd] px-1.5 py-[1px] rounded">
                                  {actionPayload.action === 'replace_all'
                                    ? `${actionPayload.workflow?.nodes?.length || 0} 节点 · ${
                                        actionPayload.workflow?.edges?.length || 0
                                      } 连线`
                                    : '增量变更'}
                                </span>
                              </div>

                              {actionPayload.workflow?.description && (
                                <div className="text-[10.5px] text-[#63636b] leading-normal">
                                  {actionPayload.workflow.description}
                                </div>
                              )}

                              <div className="pt-1 flex items-center justify-end gap-2">
                                <button
                                  onClick={() => applyWorkflowAction(actionPayload, msg.id)}
                                  className={`flex items-center gap-1 px-3 py-1 rounded-[5px] text-[11px] font-medium transition-all shadow-xs ${
                                    isApplied
                                      ? 'bg-[#e4f6ec] text-[#189a58] border border-[#a3e635]'
                                      : 'bg-[#4f46e5] hover:bg-[#4338ca] text-white active:scale-95'
                                  }`}
                                >
                                  <Check size={11} strokeWidth={2.4} />
                                  <span>{isApplied ? '已同步画布 (重新应用)' : '立即应用到画布'}</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* 底部输入框 */}
                <div className="p-3 border-t border-[#e3e3e8] bg-[#fafafc]">
                  <div className="flex items-center justify-between mb-1.5 text-[10px] text-[#85858d]">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#189a58]" />
                      <span>已连接画布拓扑 ({nodes.length} 个节点上下文)</span>
                    </div>
                    {selectedNode && (
                      <span className="truncate max-w-[130px] text-[#4f46e5] font-mono">
                        焦点: {selectedNode.data.name}
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <textarea
                      rows={2}
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder="向 Agent 描述您的流程需求，Enter 发送..."
                      className="w-full bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[7px] p-2 pr-9 text-[11.5px] text-[#1c1c21] outline-none resize-none shadow-xs"
                    />

                    <button
                      onClick={() => handleSendMessage()}
                      disabled={!inputMessage.trim() || isSendingMessage}
                      className="absolute right-2 bottom-2.5 p-1 rounded-[5px] bg-[#4f46e5] hover:bg-[#4338ca] disabled:opacity-40 text-white transition-all shadow-xs"
                    >
                      <Send size={11} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: 节点属性编辑 (保留精细手动微调) */}
            {rightPanelTab === 'inspector' && (
              <div className="flex-1 flex flex-col justify-between p-4 overflow-y-auto">
                {selectedNode && selectedNodeData ? (
                  <div className="space-y-3.5 text-[12px]">
                    <div className="flex items-center justify-between pb-2 border-b border-[#ececf0]">
                      <div className="flex items-center gap-2">
                        <Settings2 size={14} className="text-[#4f46e5]" />
                        <span className="font-semibold text-[12.5px] text-[#1c1c21]">
                          节点参数详情
                        </span>
                      </div>
                      <button
                        onClick={deleteSelectedNode}
                        className="p-1 rounded hover:bg-[#fbe9e9] text-[#d64545] transition-colors"
                        title="删除该节点"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

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
                            rows={3}
                            value={selectedNodeData.config?.prompt || ''}
                            onChange={(e) => updateSelectedNodeConfig('prompt', e.target.value)}
                            className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2 text-[#1c1c21] outline-none resize-none"
                          />
                        </div>
                      </>
                    )}

                    {selectedNodeData.type === 'midscene' && (
                      <div>
                        <label className="block text-[#85858d] mb-1">测试目标 URL</label>
                        <input
                          type="text"
                          value={selectedNodeData.config?.testUrl || ''}
                          onChange={(e) => updateSelectedNodeConfig('testUrl', e.target.value)}
                          className="w-full h-[28px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[#1c1c21] outline-none"
                        />
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
                          rows={2}
                          value={selectedNodeData.config?.approvalPrompt || ''}
                          onChange={(e) => updateSelectedNodeConfig('approvalPrompt', e.target.value)}
                          className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2 text-[#1c1c21] outline-none resize-none"
                        />
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
                        rows={3}
                        value={selectedNodeData.config?.command || ''}
                        onChange={(e) => updateSelectedNodeConfig('command', e.target.value)}
                        className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2 font-mono text-[11px] text-[#1c1c21] outline-none resize-none"
                      />
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
                        className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[#1c1c21] outline-none focus:bg-white focus:border-[#4f46e5] transition-all"
                        placeholder="流水线名称"
                      />
                    </div>

                    <div>
                      <label className="block text-[#85858d] mb-1 font-medium">流程描述说明</label>
                      <textarea
                        rows={3}
                        value={workflowDescription}
                        onChange={(e) => setWorkflowDescription(e.target.value)}
                        className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2.5 text-[#1c1c21] outline-none resize-none focus:bg-white focus:border-[#4f46e5] transition-all placeholder:text-[#85858d]"
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

                    <div className="bg-[#f9f9fb] border border-[#ececf0] rounded-[7px] p-2.5 space-y-1.5 text-[11px] text-[#85858d]">
                      <div className="flex items-center justify-between">
                        <span>拓扑节点数</span>
                        <span className="font-mono text-[#1c1c21] font-medium">{nodes.length} 个</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>拓扑依赖连线</span>
                        <span className="font-mono text-[#1c1c21] font-medium">{edges.length} 条</span>
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
                  拖拽节点两侧圆点即可在画布连线；亦可通过 AI 助手自动生成。
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
        }}
        onClose={() => setIsEditModalOpen(false)}
        onSave={async ({ name, description }) => {
          setWorkflowName(name);
          setWorkflowDescription(description);
          await handleSave(name, description);
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
