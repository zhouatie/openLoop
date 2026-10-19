import React, { useMemo } from 'react';
import { Node, Edge } from '@xyflow/react';
import {
  Plus,
  ArrowDown,
  ArrowUp,
  Trash2,
  Settings2,
  Bot,
  Zap,
  Target,
  FileVideo,
  CheckSquare,
  Terminal,
  GitCommit,
  Rocket,
  Layers,
  Sparkles,
  ClipboardCheck,
  Cpu,
  Workflow,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  ChevronRight,
  Split,
} from 'lucide-react';
import { NodeType, Task } from '@openloop/core';

interface WorkflowLinearFlowViewProps {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onAppendStep: (sourceNodeId?: string) => void;
  onInsertStepBetween: (sourceNodeId: string, targetNodeId: string) => void;
  onMoveStep?: (nodeId: string, direction: 'up' | 'down') => void;
  debugTask?: Task | null;
  onOpenTaskLogs?: (taskId: string, nodeId?: string) => void;
  onOpenAgentSession?: (taskId: string, nodeId?: string, nodeName?: string) => void;
}

const TYPE_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; bg: string; text: string; border: string }
> = {
  agent: {
    label: 'Agent 编码',
    icon: <Bot size={12} strokeWidth={2} />,
    bg: 'bg-[#eeedfd]',
    text: 'text-[#4f46e5]',
    border: 'border-[#d8d6fb]',
  },
  cli: {
    label: 'CLI 脚本',
    icon: <Terminal size={12} strokeWidth={2} />,
    bg: 'bg-[#f4f4f6]',
    text: 'text-[#4b4b53]',
    border: 'border-[#e3e3e8]',
  },
  midscene: {
    label: 'Midscene 视觉测试',
    icon: <Target size={12} strokeWidth={2} />,
    bg: 'bg-[#e4f6ec]',
    text: 'text-[#15803d]',
    border: 'border-[#bbf7d0]',
  },
  'qa-approval': {
    label: 'QA 门禁验收',
    icon: <CheckSquare size={12} strokeWidth={2} />,
    bg: 'bg-[#fef3c7]',
    text: 'text-[#b45309]',
    border: 'border-[#fde68a]',
  },
  'stitch-image': {
    label: '拼接动图',
    icon: <FileVideo size={12} strokeWidth={2} />,
    bg: 'bg-[#eff6ff]',
    text: 'text-[#1d4ed8]',
    border: 'border-[#bfdbfe]',
  },
  'worktree-setup': {
    label: '沙箱隔离',
    icon: <Layers size={12} strokeWidth={2} />,
    bg: 'bg-[#f0fdf4]',
    text: 'text-[#15803d]',
    border: 'border-[#bbf7d0]',
  },
  'env-prepare': {
    label: '现场准备',
    icon: <Cpu size={12} strokeWidth={2} />,
    bg: 'bg-[#ecfdf5]',
    text: 'text-[#047857]',
    border: 'border-[#a7f3d0]',
  },
  hook: {
    label: 'Hook 触发',
    icon: <Zap size={12} strokeWidth={2} />,
    bg: 'bg-[#ffedd5]',
    text: 'text-[#c2410c]',
    border: 'border-[#fed7aa]',
  },
  'sub-workflow': {
    label: '子流水线',
    icon: <Workflow size={12} strokeWidth={2} />,
    bg: 'bg-[#f0f9ff]',
    text: 'text-[#0284c7]',
    border: 'border-[#bae6fd]',
  },
  custom: {
    label: '插件扩展',
    icon: <Sparkles size={12} strokeWidth={2} />,
    bg: 'bg-[#fdf2f8]',
    text: 'text-[#db2777]',
    border: 'border-[#fbcfe8]',
  },
};

export const WorkflowLinearFlowView: React.FC<WorkflowLinearFlowViewProps> = ({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onDeleteNode,
  onAppendStep,
  onInsertStepBetween,
  onMoveStep,
  debugTask,
  onOpenTaskLogs,
  onOpenAgentSession,
}) => {
  // 1. 根据拓扑依赖关系计算有序的线性节点序列
  const orderedNodes = useMemo(() => {
    if (nodes.length <= 1) return nodes;

    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    const nodeMap = new Map<string, Node>();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      inDegree.set(node.id, 0);
      adj.set(node.id, []);
    }

    for (const edge of edges) {
      if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
        adj.get(edge.source)!.push(edge.target);
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
      }
    }

    // Kahn 算法拓扑排队
    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const result: Node[] = [];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const curr = queue.shift()!;
      visited.add(curr);
      const nodeObj = nodeMap.get(curr);
      if (nodeObj) result.push(nodeObj);

      const neighbors = adj.get(curr) || [];
      for (const next of neighbors) {
        const remaining = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, remaining);
        if (remaining === 0) queue.push(next);
      }
    }

    // 处理遗漏或环中节点
    for (const node of nodes) {
      if (!visited.has(node.id)) result.push(node);
    }

    return result;
  }, [nodes, edges]);

  // 前置依赖查找字典
  const predecessorMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const edge of edges) {
      if (!map.has(edge.target)) map.set(edge.target, []);
      map.get(edge.target)!.push(edge.source);
    }
    return map;
  }, [edges]);

  return (
    <div className="flex-1 h-full overflow-y-auto p-6 flex flex-col items-center bg-[#f4f4f6] select-none">
      <div className="w-full max-w-[720px] flex flex-col items-center">
        {/* 顶部简短提示 */}
        <div className="w-full mb-4 px-1 flex items-center justify-between text-[11.5px] text-[#85858d]">
          <span className="flex items-center gap-1.5 font-medium text-[#1c1c21]">
            <span>执行步骤清单</span>
            <span className="text-[10px] font-mono text-[#85858d] bg-white px-1.5 py-0.5 rounded border border-[#e3e3e8]">
              共 {orderedNodes.length} 个步骤
            </span>
          </span>
          <span>点击步骤卡片可查看并编辑右侧配置</span>
        </div>

        {orderedNodes.length === 0 ? (
          <div className="w-full bg-white border border-[#e3e3e8] rounded-[10px] p-8 text-center shadow-xs flex flex-col items-center justify-center">
            <div className="w-10 h-10 rounded-[8px] bg-[#eeedfd] border border-[#d8d6fb] text-[#4f46e5] flex items-center justify-center mb-3">
              <Workflow size={20} strokeWidth={2} />
            </div>
            <div className="text-[13px] font-semibold text-[#1c1c21] mb-1">
              当前流程尚无执行步骤
            </div>
            <div className="text-[11.5px] text-[#85858d] mb-4">
              点击下方按钮即可从动作配方库中选择第一步
            </div>
            <button
              onClick={() => onAppendStep()}
              className="flex items-center gap-1.5 h-[32px] px-4 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all shadow-xs cursor-pointer active:scale-95"
            >
              <Plus size={13} strokeWidth={2.4} />
              <span>添加第一个步骤</span>
            </button>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center">
            {orderedNodes.map((node, index) => {
              const nodeData = node.data as any;
              const type: NodeType = nodeData?.type || 'cli';
              const isSelected = node.id === selectedNodeId;
              const predecessors = predecessorMap.get(node.id) || [];
              const nextNode = orderedNodes[index + 1];

              // 类型配置
              const isGit =
                type === 'cli' &&
                (nodeData?.name?.toLowerCase().includes('git') ||
                  nodeData?.config?.command?.toLowerCase().includes('git'));
              const isDeploy =
                type === 'cli' &&
                (nodeData?.name?.includes('部署') ||
                  nodeData?.config?.command?.toLowerCase().includes('deploy'));

              const cfg = isGit
                ? {
                    label: 'Git 提交',
                    icon: <GitCommit size={12} strokeWidth={2} />,
                    bg: 'bg-[#1c1c21]',
                    text: 'text-white',
                    border: 'border-[#1c1c21]',
                  }
                : isDeploy
                ? {
                    label: '应用部署',
                    icon: <Rocket size={12} strokeWidth={2} />,
                    bg: 'bg-[#0f172a]',
                    text: 'text-[#38bdf8]',
                    border: 'border-[#0f172a]',
                  }
                : TYPE_CONFIG[type] || TYPE_CONFIG.cli;

              // 调试状态
              const run = debugTask?.nodeRuns?.[node.id];
              const isRunning =
                (debugTask?.currentNodeId === node.id &&
                  (debugTask?.status === 'running' || debugTask?.status === 'pending')) ||
                run?.status === 'running';

              return (
                <React.Fragment key={node.id}>
                  {/* 步骤卡片容器 */}
                  <div
                    onClick={() => onSelectNode(node.id)}
                    className={`w-full bg-white rounded-[10px] border transition-all cursor-pointer shadow-xs p-3.5 relative ${
                      isSelected
                        ? 'border-[#4f46e5] ring-2 ring-[#4f46e5]/15 shadow-[0_4px_16px_rgba(79,70,229,0.1)]'
                        : 'border-[#e3e3e8] hover:border-[#b9b9c2] hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      {/* 左侧：步骤序号与微图标 */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-7 h-7 rounded-[6px] bg-[#f4f4f6] border border-[#e3e3e8] flex items-center justify-center font-mono text-[11px] font-semibold text-[#63636b] shrink-0">
                          {index + 1}
                        </div>

                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border} shrink-0`}
                            >
                              {cfg.icon}
                              <span>{cfg.label}</span>
                            </span>
                            <span className="text-[13px] font-medium text-[#1c1c21] truncate">
                              {nodeData?.name || '未命名步骤'}
                            </span>
                            <span className="text-[10px] font-mono text-[#85858d]">
                              ({node.id})
                            </span>
                          </div>

                          {/* 预览配置信息 */}
                          <div className="text-[11px] font-mono text-[#71717a] truncate mt-1 max-w-[460px]">
                            {type === 'agent'
                              ? nodeData?.config?.prompt || 'AI Agent 自动分析与实现'
                              : type === 'midscene'
                              ? nodeData?.config?.testUrl || 'UI 自动化多模态测试'
                              : type === 'qa-approval'
                              ? nodeData?.config?.approvalPrompt || '等待测试人员审核验收'
                              : type === 'hook'
                              ? nodeData?.config?.webhookUrl || '通知机器人 Webhook'
                              : nodeData?.config?.command || '执行命令行命令'}
                          </div>
                        </div>
                      </div>

                      {/* 右侧：状态指示器与快捷按钮 */}
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* 调试状态微胶囊 */}
                        {isRunning ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10px] font-medium border border-[#bfdbfe]">
                            <Loader2 size={10} className="animate-spin" />
                            <span>执行中</span>
                          </span>
                        ) : run?.status === 'completed' || run?.status === 'success' ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]">
                            <CheckCircle2 size={10} />
                            <span>成功</span>
                          </span>
                        ) : run?.status === 'failed' ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]">
                            <AlertCircle size={10} />
                            <span>失败</span>
                          </span>
                        ) : null}

                        {/* 查看日志与会话 */}
                        {debugTask && typeof onOpenTaskLogs === 'function' && (
                          <button
                            type="button"
                            onClick={() => onOpenTaskLogs(debugTask.id, node.id)}
                            className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-colors cursor-pointer"
                            title="查看当前步骤日志"
                          >
                            <Terminal size={11.5} />
                          </button>
                        )}

                        {/* 上移 / 下移 */}
                        {typeof onMoveStep === 'function' && (
                          <>
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => onMoveStep(node.id, 'up')}
                              className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer"
                              title="上移步骤"
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              disabled={index === orderedNodes.length - 1}
                              onClick={() => onMoveStep(node.id, 'down')}
                              className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer"
                              title="下移步骤"
                            >
                              <ArrowDown size={12} />
                            </button>
                          </>
                        )}

                        {/* 删除该步骤 */}
                        <button
                          type="button"
                          onClick={() => onDeleteNode(node.id)}
                          className="w-6 h-6 rounded-[4px] text-[#85858d] hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-colors cursor-pointer"
                          title="删除该步骤"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* 下方前置依赖关系指示 */}
                    {predecessors.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-[#f1f1f4] flex items-center gap-2 text-[10.5px] text-[#85858d]">
                        <span className="flex items-center gap-1 text-[#71717a]">
                          <Split size={10} className="text-[#85858d]" />
                          <span>前置依赖:</span>
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {predecessors.map((pId) => {
                            const pNode = nodes.find((n) => n.id === pId);
                            return (
                              <span
                                key={pId}
                                className="px-1.5 py-[1px] rounded bg-[#f4f4f6] text-[#63636b] border border-[#e3e3e8] font-mono text-[10px]"
                              >
                                {pNode ? (pNode.data as any)?.name || pId : pId}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 步骤之间的中轴连接线与快速插桩按钮 (+) */}
                  {index < orderedNodes.length - 1 && (
                    <div className="flex flex-col items-center py-2 relative group/line">
                      <div className="w-[1.5px] h-6 bg-[#d1d1d8] group-hover/line:bg-[#6366f1] transition-colors" />
                      <button
                        type="button"
                        onClick={() => {
                          if (nextNode) {
                            onInsertStepBetween(node.id, nextNode.id);
                          } else {
                            onAppendStep(node.id);
                          }
                        }}
                        className="w-5 h-5 -my-2.5 rounded-full bg-white border border-[#c7d2fe] hover:border-[#4f46e5] text-[#6366f1] hover:text-[#4f46e5] shadow-xs flex items-center justify-center transition-all hover:scale-110 active:scale-95 cursor-pointer z-10"
                        title="在此处插入新步骤"
                      >
                        <Plus size={11} strokeWidth={2.6} />
                      </button>
                      <div className="w-[1.5px] h-6 bg-[#d1d1d8] group-hover/line:bg-[#6366f1] transition-colors" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* 尾部连接线与追加按钮 */}
            <div className="flex flex-col items-center py-2">
              <div className="w-[1.5px] h-4 bg-[#d1d1d8]" />
              <button
                type="button"
                onClick={() => {
                  const lastNode = orderedNodes[orderedNodes.length - 1];
                  onAppendStep(lastNode ? lastNode.id : undefined);
                }}
                className="flex items-center gap-1.5 h-[32px] px-4 rounded-[6px] bg-white hover:bg-[#fafafc] border border-dashed border-[#c7d2fe] hover:border-[#4f46e5] text-[#4f46e5] text-[11.5px] font-medium transition-all shadow-2xs cursor-pointer active:scale-95"
              >
                <Plus size={13} strokeWidth={2.4} />
                <span>追加下一步骤</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
