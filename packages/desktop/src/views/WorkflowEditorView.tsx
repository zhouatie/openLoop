import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import { WorkflowDefinition, NodeType } from '@openloop/core';
import { api } from '../services/api';

// 自定义节点外观（极简高质感）
const CustomWorkflowNode: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as any;
  const type: NodeType = nodeData.type || 'cli';

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
      className={`w-60 rounded-[8px] bg-white border p-3 transition-all ${
        selected
          ? 'border-[#4f46e5] shadow-[0_0_0_2px_rgba(79,70,229,0.15),0_1px_3px_rgba(0,0,0,0.08)]'
          : 'border-[#e3e3e8] shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:border-[#b9b9c2]'
      }`}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-[#4f46e5] border-white" />

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`p-1 rounded-[4px] ${currentConfig.bg} ${currentConfig.text}`}>
            {currentConfig.icon}
          </span>
          <span className={`text-[10px] font-semibold tracking-wide ${currentConfig.text}`}>
            {currentConfig.label}
          </span>
        </div>
        <span className="text-[9.5px] font-mono text-[#85858d]">{nodeData.id}</span>
      </div>

      <div className="text-[12.5px] font-medium text-[#1c1c21] truncate">{nodeData.name}</div>

      <div className="mt-1.5 text-[10px] text-[#85858d] font-mono bg-[#f9f9fb] border border-[#ececf0] px-2 py-1 rounded-[4px] truncate">
        {type === 'agent' && (nodeData.config?.prompt || 'Agent 自动实现需求')}
        {type === 'midscene' && (nodeData.config?.testUrl || '智能断言与多步截屏')}
        {type === 'stitch-image' && (nodeData.config?.outputFile || '生成动图 preview.gif')}
        {type === 'hook' && '完成事件广播 -> 自动流转'}
        {type === 'qa-approval' && '人工与用例核验确认'}
        {type === 'cli' && (nodeData.config?.command || '执行命令行指令')}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-[#4f46e5] border-white" />
    </div>
  );
};

interface WorkflowEditorViewProps {
  workflowId: string;
  workflows: WorkflowDefinition[];
  onBack: () => void;
  onRefresh: () => void;
  onOpenTaskLogs: (taskId: string) => void;
}

export const WorkflowEditorView: React.FC<WorkflowEditorViewProps> = ({
  workflowId,
  workflows,
  onBack,
  onRefresh,
  onOpenTaskLogs,
}) => {
  const activeWorkflow = workflows.find((w) => w.id === workflowId) || workflows[0];
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('');

  const nodeTypes = useMemo(() => ({ customNode: CustomWorkflowNode }), []);

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
      animated: true,
      style: { stroke: '#4f46e5', strokeWidth: 1.8 },
    }));

    setNodes(rfNodes);
    setEdges(rfEdges);
    setSelectedNodeId(null);
  }, [workflowId, activeWorkflow]);

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
  };

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

  const addNode = (type: NodeType | 'git-commit' | 'deploy', label: string) => {
    const isGit = type === 'git-commit';
    const isDeploy = type === 'deploy';
    const actualType: NodeType = (isGit || isDeploy) ? 'cli' : (type as NodeType);
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
      position: { x: 220 + Math.random() * 150, y: 120 + Math.random() * 120 },
      data: {
        id,
        name: label,
        type: actualType,
        config: {
          command: defaultCommand,
          prompt: actualType === 'agent' ? '按需求完成功能' : '',
          testUrl: actualType === 'midscene' ? 'http://localhost:3000' : '',
        },
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(id);
  };

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
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  };

  const handleSave = async () => {
    if (!activeWorkflow) return;

    const updatedWorkflow: WorkflowDefinition = {
      ...activeWorkflow,
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
      })),
    };

    setSaveStatus('保存中...');
    try {
      await api.saveWorkflow(updatedWorkflow);
      setSaveStatus('已保存');
      setTimeout(() => setSaveStatus(''), 2000);
      onRefresh();
    } catch (err: any) {
      setSaveStatus(`保存失败: ${err.message}`);
    }
  };

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
      {/* 编排器顶栏（含返回列表按钮） */}
      <div className="h-[46px] px-6 bg-white border-b border-[#e3e3e8] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {/* 返回按钮 */}
          <button
            onClick={onBack}
            className="flex items-center gap-1 h-[26px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-sm"
          >
            <ArrowLeft size={12} />
            <span>返回列表</span>
          </button>

          <span className="text-[#d1d1d8]">|</span>

          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#1c1c21]">{activeWorkflow.name}</span>
            <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
              {activeWorkflow.id}
            </span>
          </div>

          <div className="text-[11.5px] text-[#85858d] font-mono">
            ({nodes.length} 节点 · {edges.length} 连线)
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus && <span className="text-[11.5px] text-[#189a58] font-medium">{saveStatus}</span>}

          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-3 h-[26px] rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[12px] font-medium text-[#1c1c21] transition-all shadow-sm"
          >
            <Save size={13} />
            <span>保存编排</span>
          </button>

          <button
            onClick={handleRunNow}
            className="flex items-center gap-1 px-3 h-[26px] rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white transition-all active:scale-95 shadow-sm"
          >
            <Play size={12} strokeWidth={2.4} />
            <span>立即调试</span>
          </button>
        </div>
      </div>

      {/* 画布核心 */}
      <div className="flex-1 relative overflow-hidden">
        {/* 左侧节点组件库悬浮栏 */}
        <div className="absolute top-4 left-4 z-10 bg-white border border-[#e3e3e8] rounded-[10px] p-2 shadow-[0_4px_16px_rgba(0,0,0,0.06)] flex flex-col gap-1 w-44">
          <div className="px-2 py-1 text-[10px] font-semibold text-[#85858d] tracking-wide">
            + 拖拽/添加组件
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

        {/* React Flow 画布 */}
        <div className="w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background color="#d1d1d8" gap={18} size={1} />
            <Controls />
          </ReactFlow>
        </div>

        {/* 右侧节点属性配置面板 */}
        {selectedNode && selectedNodeData && (
          <div className="w-72 border-l border-[#e3e3e8] bg-white p-4 flex flex-col justify-between shadow-[0_16px_44px_rgba(20,22,30,0.12)] z-20 absolute top-0 right-0 bottom-0 animate-in slide-in-from-right duration-150">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-[#ececf0]">
                <div className="flex items-center gap-2">
                  <Settings2 size={15} className="text-[#4f46e5]" />
                  <span className="font-medium text-[12.5px] text-[#1c1c21]">编排节点属性</span>
                </div>
                <button
                  onClick={deleteSelectedNode}
                  className="p-1 rounded hover:bg-[#fbe9e9] text-[#d64545]"
                  title="删除该节点"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="mt-3.5 space-y-3 text-[12px]">
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
                        updateSelectedNodeConfig('command', 'pnpm --filter @openloop/desktop build:renderer')
                      }
                      className="px-1.5 py-[2px] rounded-[4px] bg-[#f1f1f4] hover:bg-[#e9e9ee] border border-[#e3e3e8] text-[9.5px] text-[#4b4b53] flex items-center gap-1 transition-all"
                    >
                      <Terminal size={10} />
                      <span>构建自检</span>
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
            </div>

            <div className="pt-3 border-t border-[#ececf0] text-[10.5px] text-[#85858d]">
              拖动节点两侧圆点即可在界面自由编排工作流
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
