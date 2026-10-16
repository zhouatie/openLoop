import React, { useState, useEffect } from 'react';
import {
  Workflow,
  Plus,
  Play,
  Edit3,
  Trash2,
  Copy,
  Clock,
  Sparkles,
  Bot,
  Zap,
  Target,
  FileVideo,
  CheckSquare,
  Search,
  ChevronRight,
  Boxes,
} from 'lucide-react';
import { WorkflowDefinition, NodeType } from '@openloop/core';
import { api } from '../services/api';

interface WorkflowListViewProps {
  workflows: WorkflowDefinition[];
  onSelectWorkflow: (workflowId: string) => void;
  onRefresh: () => void;
  onOpenTaskLogs: (taskId: string) => void;
}

export const WorkflowListView: React.FC<WorkflowListViewProps> = ({
  workflows,
  onSelectWorkflow,
  onRefresh,
  onOpenTaskLogs,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [templateType, setTemplateType] = useState<'empty' | 'standard'>('standard');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isCreateModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCreateModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreateModalOpen]);

  const filteredWorkflows = workflows.filter((w) => {
    if (!searchTerm) return true;
    return (
      w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (w.description && w.description.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setLoading(true);
    try {
      const id = `wf_${Date.now().toString(36)}`;
      let nodes = [];
      let edges = [];

      if (templateType === 'standard') {
        nodes = [
          {
            id: 'node_agent',
            name: 'AI Agent 开发执行',
            type: 'agent' as NodeType,
            position: { x: 100, y: 150 },
            config: {
              agentName: 'OpenLoop Agent',
              command: 'echo "[Agent] 正在执行业务编码..."',
              prompt: '按需求完成功能并输出改动',
            },
          },
          {
            id: 'node_hook',
            name: '构建完成 Hook',
            type: 'hook' as NodeType,
            position: { x: 380, y: 150 },
            config: {
              command: 'echo "[Hook] Agent 开发就绪，触发下游验证..."',
            },
          },
          {
            id: 'node_qa',
            name: 'QA 审核验收',
            type: 'qa-approval' as NodeType,
            position: { x: 660, y: 150 },
            config: {
              approvalPrompt: '请确认功能实现与测试无误',
            },
          },
        ];
        edges = [
          { id: 'e1', source: 'node_agent', target: 'node_hook' },
          { id: 'e2', source: 'node_hook', target: 'node_qa' },
        ];
      } else {
        nodes = [
          {
            id: 'node_start',
            name: '起始 CLI 节点',
            type: 'cli' as NodeType,
            position: { x: 200, y: 150 },
            config: { command: 'echo "Hello openLoop"' },
          },
        ];
      }

      const newWf: WorkflowDefinition = {
        id,
        name: newTitle.trim(),
        description: newDesc.trim() || '自定义自动化编排流程',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodes,
        edges,
      };

      await api.saveWorkflow(newWf);
      setIsCreateModalOpen(false);
      setNewTitle('');
      setNewDesc('');
      onRefresh();
      // 直接打开新创建的流程画布
      onSelectWorkflow(id);
    } catch (err: any) {
      alert(`创建流程失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunWorkflow = async (e: React.MouseEvent, wf: WorkflowDefinition) => {
    e.stopPropagation();
    try {
      const task = await api.createTask({
        title: `调试执行: ${wf.name}`,
        workflowId: wf.id,
        autoRun: true,
      });
      alert(`已根据流程 [${wf.name}] 创建调试任务: ${task.id}`);
      onRefresh();
      onOpenTaskLogs(task.id);
    } catch (err: any) {
      alert(`启动失败: ${err.message}`);
    }
  };

  const getNodeBadge = (type: NodeType) => {
    switch (type) {
      case 'agent':
        return (
          <span key={type} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eeedfd] text-[#4f46e5] text-[10px] font-medium">
            <Bot size={10} /> Agent
          </span>
        );
      case 'midscene':
        return (
          <span key={type} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#e4f6ec] text-[#189a58] text-[10px] font-medium">
            <Target size={10} /> Midscene
          </span>
        );
      case 'stitch-image':
        return (
          <span key={type} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#1d4ed8] text-[10px] font-medium">
            <FileVideo size={10} /> 动图合成
          </span>
        );
      case 'hook':
        return (
          <span key={type} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fbf0df] text-[#b45309] text-[10px] font-medium">
            <Zap size={10} /> Hook
          </span>
        );
      case 'qa-approval':
        return (
          <span key={type} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fbf0df] text-[#b45309] text-[10px] font-medium">
            <CheckSquare size={10} /> QA验收
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-y-auto select-none p-6 space-y-4">
      {/* 顶部工具栏 (符合 magpie 极简风格) */}
      <div className="flex items-center justify-between pb-4 border-b border-[#e3e3e8]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-[#1c1c21]">流程编排模版库</h2>
            <span className="text-[11px] font-mono text-[#85858d] bg-white border border-[#e3e3e8] px-2 py-[1px] rounded-[5px] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              {workflows.length} 个编排
            </span>
          </div>
          <p className="text-[12px] text-[#85858d] mt-0.5">
            设计、串联与编排你的自动化研发 DAG 流水线。点击进入可视化画布自由连线。
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* 搜索框 */}
          <div className="relative w-52">
            <input
              type="text"
              placeholder="搜索编排名称..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-[28px] bg-white border border-[#e3e3e8] rounded-[6px] px-2.5 text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#b9b9c2]"
            />
          </div>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-sm"
          >
            <Plus size={13} strokeWidth={2.4} />
            <span>新建工作流</span>
          </button>
        </div>
      </div>

      {/* 流程列表卡片区 */}
      <div className="space-y-2.5">
        <div className="text-[11.5px] font-medium text-[#85858d] uppercase tracking-wide px-1">
          已就绪自动化流水线
        </div>

        {filteredWorkflows.length === 0 ? (
          <div className="bg-white border border-[#e3e3e8] rounded-[10px] p-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <Workflow size={28} className="mx-auto text-[#b9b9c2] mb-2" />
            <div className="text-[13px] font-medium text-[#1c1c21]">未匹配到工作流</div>
            <p className="text-[11.5px] text-[#85858d] mt-1">
              可以点击右上角“新建工作流”创建新的自动化编排
            </p>
          </div>
        ) : (
          <div className="bg-white border border-[#e3e3e8] rounded-[10px] divide-y divide-[#ececf0] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            {filteredWorkflows.map((wf) => {
              const nodeTypes = Array.from(new Set(wf.nodes.map((n) => n.type)));
              const updatedDate = new Date(wf.updatedAt || wf.createdAt).toLocaleDateString();

              return (
                <div
                  key={wf.id}
                  onClick={() => onSelectWorkflow(wf.id)}
                  className="p-4 flex items-center justify-between hover:bg-[#f9f9fb] transition-colors cursor-pointer group"
                >
                  <div className="flex items-start gap-3.5 min-w-0 flex-1 pr-4">
                    <div className="w-9 h-9 rounded-[8px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center justify-center text-[#4f46e5] shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                      <Workflow size={18} strokeWidth={2} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-[13.5px] font-medium text-[#1c1c21] truncate">
                          {wf.name}
                        </h4>
                        <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                          {wf.id}
                        </span>
                      </div>

                      <p className="text-[11.5px] text-[#85858d] mt-1 line-clamp-1 leading-relaxed">
                        {wf.description || '暂无流程描述'}
                      </p>

                      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-[#63636b] font-mono">
                          {wf.nodes.length} 节点 · {wf.edges.length} 连线
                        </span>
                        <span className="text-[#d1d1d8]">|</span>
                        <div className="flex items-center gap-1.5">
                          {nodeTypes.map((type) => getNodeBadge(type))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 右侧动作操作条 */}
                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-right mr-3 hidden sm:block">
                      <div className="text-[10.5px] text-[#85858d] flex items-center gap-1 justify-end">
                        <Clock size={11} />
                        <span>更新于 {updatedDate}</span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => handleRunWorkflow(e, wf)}
                      className="h-[26px] px-2.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                    >
                      <Play size={11} strokeWidth={2.4} />
                      <span>调试运行</span>
                    </button>

                    <button
                      onClick={() => onSelectWorkflow(wf.id)}
                      className="h-[26px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] hover:bg-[#f1f1f4] text-[11.5px] font-medium flex items-center gap-1 transition-all shadow-sm"
                    >
                      <Edit3 size={11} />
                      <span>编辑画布</span>
                      <ChevronRight size={12} className="text-[#85858d]" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 新建工作流弹窗 */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100">
          <div className="w-[460px] bg-white border border-[#e3e3e8] rounded-[12px] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.16)] text-[#1c1c21]">
            <div className="flex items-center justify-between pb-3 border-b border-[#ececf0]">
              <div>
                <h3 className="font-semibold text-[14px] text-[#1c1c21]">新建自动化流程</h3>
                <p className="text-[11.5px] text-[#85858d] mt-0.5">
                  创建新的 DAG 编排拓扑，完成后将直接打开画布编辑器
                </p>
              </div>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-3.5 text-[12px]">
              <div>
                <label className="block font-medium text-[#4b4b53] mb-1">流程名称</label>
                <input
                  type="text"
                  required
                  placeholder="例如: 智能 PR Review 与回归测试流水线"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[#1c1c21] outline-none focus:bg-white focus:border-[#b9b9c2]"
                />
              </div>

              <div>
                <label className="block font-medium text-[#4b4b53] mb-1">流程描述</label>
                <textarea
                  rows={2.5}
                  placeholder="说明此流水线的目标与流转规则..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2 text-[#1c1c21] outline-none resize-none focus:bg-white focus:border-[#b9b9c2]"
                />
              </div>

              <div>
                <label className="block font-medium text-[#4b4b53] mb-1.5">初始化模板</label>
                <div className="grid grid-cols-2 gap-2">
                  <div
                    onClick={() => setTemplateType('standard')}
                    className={`p-2.5 rounded-[8px] border cursor-pointer transition-all ${
                      templateType === 'standard'
                        ? 'border-[#4f46e5] bg-[#eeedfd]/30 shadow-sm'
                        : 'border-[#e3e3e8] hover:border-[#b9b9c2]'
                    }`}
                  >
                    <div className="font-medium text-[12px] text-[#1c1c21] mb-0.5">标准全自动模板</div>
                    <div className="text-[10.5px] text-[#85858d]">
                      预置 Agent 编码 + Hook 触发 + QA 验收节点
                    </div>
                  </div>

                  <div
                    onClick={() => setTemplateType('empty')}
                    className={`p-2.5 rounded-[8px] border cursor-pointer transition-all ${
                      templateType === 'empty'
                        ? 'border-[#4f46e5] bg-[#eeedfd]/30 shadow-sm'
                        : 'border-[#e3e3e8] hover:border-[#b9b9c2]'
                    }`}
                  >
                    <div className="font-medium text-[12px] text-[#1c1c21] mb-0.5">空白画布</div>
                    <div className="text-[10.5px] text-[#85858d]">
                      从单一初始 CLI 节点开始自由连线构建
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#ececf0]">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="h-[28px] px-3 rounded-[6px] text-[#4b4b53] hover:bg-[#f1f1f4] text-[12px]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="h-[28px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white font-medium flex items-center gap-1 active:scale-95 disabled:opacity-50"
                >
                  <Plus size={12} strokeWidth={2.4} />
                  <span>{loading ? '创建中...' : '创建并编辑'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
