import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Rocket,
  Pin,
  ArrowUpDown,
  Check,
} from 'lucide-react';
import { WorkflowDefinition, NodeType } from '@openloop/core';
import { api } from '../services/api';

const STORAGE_KEY_PINNED_WORKFLOWS = 'openloop_pinned_workflow_ids';

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
  const [templateType, setTemplateType] = useState<'empty' | 'standard' | 'deploy'>('standard');
  const [loading, setLoading] = useState(false);

  // 置顶与多维排序状态
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PINNED_WORKFLOWS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'name'>('updated');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部收起排序下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setIsSortOpen(false);
      }
    };
    if (isSortOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSortOpen]);

  // 格式化友好时间显示
  const formatFriendlyTime = (timestamp: number) => {
    if (!timestamp) return '未知时间';
    const now = Date.now();
    const diff = now - timestamp;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) {
      return '刚刚更新';
    }
    if (diff < hour) {
      return `${Math.floor(diff / minute)} 分钟前`;
    }
    if (diff < day) {
      return `${Math.floor(diff / hour)} 小时前`;
    }
    if (diff < 2 * day) {
      return '昨天';
    }
    return new Date(timestamp).toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
    });
  };

  // 置顶切换
  const handleTogglePin = (e: React.MouseEvent, wf: WorkflowDefinition) => {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const isPinned = prev.includes(wf.id);
      const next = isPinned ? prev.filter((id) => id !== wf.id) : [wf.id, ...prev];
      try {
        localStorage.setItem(STORAGE_KEY_PINNED_WORKFLOWS, JSON.stringify(next));
      } catch (err) {
        console.warn('[WorkflowListView] 保存置顶失败:', err);
      }
      if (import.meta.env?.DEV) {
        console.log('[WorkflowListView] 切换流程置顶状态:', {
          id: wf.id,
          name: wf.name,
          pinned: !isPinned,
          totalPinned: next.length,
        });
      }
      return next;
    });
  };

  // 切换排序方式
  const handleSortChange = (newSort: 'updated' | 'created' | 'name') => {
    setSortBy(newSort);
    setIsSortOpen(false);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 切换排序规则:', newSort);
    }
  };

  // 综合置顶与排序规则过滤流水线
  const filteredWorkflows = useMemo(() => {
    return [...workflows]
      .filter((w) => {
        if (!searchTerm) return true;
        const kw = searchTerm.toLowerCase();
        return (
          w.name.toLowerCase().includes(kw) ||
          w.id.toLowerCase().includes(kw) ||
          (w.description && w.description.toLowerCase().includes(kw))
        );
      })
      .sort((a, b) => {
        const aPinned = pinnedIds.includes(a.id);
        const bPinned = pinnedIds.includes(b.id);
        // 置顶优先在最顶部
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;

        if (sortBy === 'updated') {
          const aTime = a.updatedAt || a.createdAt || 0;
          const bTime = b.updatedAt || b.createdAt || 0;
          return bTime - aTime;
        }
        if (sortBy === 'created') {
          const aTime = a.createdAt || 0;
          const bTime = b.createdAt || 0;
          return bTime - aTime;
        }
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name, 'zh-CN');
        }
        return 0;
      });
  }, [workflows, searchTerm, pinnedIds, sortBy]);

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
      } else if (templateType === 'deploy') {
        nodes = [
          {
            id: 'node_deploy_prep',
            name: '环境与依赖预检',
            type: 'cli' as NodeType,
            position: { x: 80, y: 150 },
            config: {
              command: 'echo "[Deploy] 环境自检中..." && node -v && pnpm -v',
            },
          },
          {
            id: 'node_deploy_build',
            name: '生产环境构建',
            type: 'cli' as NodeType,
            position: { x: 360, y: 150 },
            config: {
              command: 'pnpm build',
            },
          },
          {
            id: 'node_deploy_exec',
            name: '应用部署上线',
            type: 'cli' as NodeType,
            position: { x: 640, y: 150 },
            config: {
              command: 'if [ -f "scripts/deploy.sh" ]; then bash scripts/deploy.sh --skip-build; else echo "[Deploy] 部署成功"; fi',
            },
          },
          {
            id: 'node_deploy_gate',
            name: '上线发布验收',
            type: 'qa-approval' as NodeType,
            position: { x: 920, y: 150 },
            config: {
              approvalPrompt: '请核验应用部署与线上探针运行正常',
            },
          },
        ];
        edges = [
          { id: 'e1', source: 'node_deploy_prep', target: 'node_deploy_build' },
          { id: 'e2', source: 'node_deploy_build', target: 'node_deploy_exec' },
          { id: 'e3', source: 'node_deploy_exec', target: 'node_deploy_gate' },
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
          <span key={type} className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb] text-[9.5px] font-medium">
            <Bot size={9.5} /> Agent
          </span>
        );
      case 'midscene':
        return (
          <span key={type} className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] bg-[#e4f6ec] text-[#189a58] border border-[#c3eed7] text-[9.5px] font-medium">
            <Target size={9.5} /> Midscene
          </span>
        );
      case 'stitch-image':
        return (
          <span key={type} className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] bg-[#eff6ff] text-[#1d4ed8] border border-[#dbeafe] text-[9.5px] font-medium">
            <FileVideo size={9.5} /> 动图合成
          </span>
        );
      case 'hook':
        return (
          <span key={type} className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] bg-[#fbf0df] text-[#b45309] border border-[#f3d0a1] text-[9.5px] font-medium">
            <Zap size={9.5} /> Hook
          </span>
        );
      case 'qa-approval':
        return (
          <span key={type} className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[3px] bg-[#fbf0df] text-[#b45309] border border-[#f3d0a1] text-[9.5px] font-medium">
            <CheckSquare size={9.5} /> QA验收
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

          {/* 排序方式选择下拉 */}
          <div className="relative" ref={sortMenuRef}>
            <button
              onClick={() => setIsSortOpen(!isSortOpen)}
              className={`h-[28px] px-2.5 rounded-[6px] border text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
                isSortOpen
                  ? 'border-[#4f46e5] bg-white text-[#4f46e5]'
                  : 'border-[#e3e3e8] bg-white text-[#4b4b53] hover:text-[#1c1c21] hover:border-[#b9b9c2]'
              }`}
            >
              <ArrowUpDown size={11} className={isSortOpen ? 'text-[#4f46e5]' : 'text-[#85858d]'} />
              <span>
                {sortBy === 'updated' && '最近更新'}
                {sortBy === 'created' && '创建时间'}
                {sortBy === 'name' && '名称 A-Z'}
              </span>
            </button>

            {isSortOpen && (
              <div className="absolute right-0 top-[calc(100%+4px)] w-32 bg-white border border-[#e3e3e8] rounded-[8px] p-1 shadow-[0_8px_20px_rgba(0,0,0,0.08)] z-30 animate-in fade-in zoom-in-95 duration-100 text-[11.5px]">
                <button
                  onClick={() => handleSortChange('updated')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors ${
                    sortBy === 'updated'
                      ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                      : 'text-[#4b4b53] hover:bg-[#f4f4f6]'
                  }`}
                >
                  <span>最近更新</span>
                  {sortBy === 'updated' && <Check size={11} strokeWidth={2.4} />}
                </button>
                <button
                  onClick={() => handleSortChange('created')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors ${
                    sortBy === 'created'
                      ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                      : 'text-[#4b4b53] hover:bg-[#f4f4f6]'
                  }`}
                >
                  <span>创建时间</span>
                  {sortBy === 'created' && <Check size={11} strokeWidth={2.4} />}
                </button>
                <button
                  onClick={() => handleSortChange('name')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors ${
                    sortBy === 'name'
                      ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                      : 'text-[#4b4b53] hover:bg-[#f4f4f6]'
                  }`}
                >
                  <span>名称 A-Z</span>
                  {sortBy === 'name' && <Check size={11} strokeWidth={2.4} />}
                </button>
              </div>
            )}
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
              const isPinned = pinnedIds.includes(wf.id);
              const friendlyTime = formatFriendlyTime(wf.updatedAt || wf.createdAt);

              return (
                <div
                  key={wf.id}
                  onClick={() => onSelectWorkflow(wf.id)}
                  className={`px-4 py-2.5 min-h-[56px] flex items-center justify-between transition-colors cursor-pointer group ${
                    isPinned ? 'bg-[#fafafc] hover:bg-[#f5f5fa]' : 'hover:bg-[#f9f9fb]'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-5">
                    {/* 左侧工作流图标与置顶快捷触发 */}
                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded-[7px] bg-[#f4f4f7] border border-[#ececf0] flex items-center justify-center text-[#1c1c21] group-hover:border-[#b9b9c2] transition-colors">
                        <Workflow size={15} strokeWidth={2} />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* 第一行：工作流名称 + 置顶胶囊 + 标识胶囊 + 节点环节能力微徽章 */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[13px] font-semibold text-[#1c1c21] shrink-0">
                          {wf.name}
                        </span>

                        {isPinned && (
                          <span className="inline-flex items-center gap-0.5 text-[9.5px] font-medium text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-1.5 py-[0.5px] rounded-[4px] shrink-0">
                            <Pin size={8.5} className="rotate-45 fill-current" />
                            已置顶
                          </span>
                        )}

                        <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[0.5px] rounded border border-[#ececf0] shrink-0">
                          {wf.id}
                        </span>

                        <div className="flex items-center gap-1 ml-1 overflow-hidden">
                          {nodeTypes.map((type) => getNodeBadge(type))}
                        </div>
                      </div>

                      {/* 第二行：描述文案 + 拓扑指标与更新时间 */}
                      <div className="flex items-center justify-between mt-1 text-[11.5px] text-[#85858d]">
                        <p className="truncate text-[#63636b] pr-4 max-w-[580px]">
                          {wf.description || '暂无流程描述'}
                        </p>
                        <div className="flex items-center gap-2 shrink-0 font-mono text-[10.5px] text-[#85858d]">
                          <span>
                            {wf.nodes.length} 节点 · {wf.edges.length} 连线
                          </span>
                          <span>·</span>
                          <div className="flex items-center gap-1">
                            <Clock size={10.5} />
                            <span>{friendlyTime}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 右侧动作操作条 (带轻量竖分隔线) */}
                  <div
                    className="flex items-center gap-2 shrink-0 border-l border-[#ececf0] pl-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* 置顶切换图钉按钮 */}
                    <button
                      onClick={(e) => handleTogglePin(e, wf)}
                      title={isPinned ? '取消置顶' : '固定在顶部'}
                      className={`w-[25px] h-[25px] rounded-[5px] flex items-center justify-center transition-all ${
                        isPinned
                          ? 'bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb] shadow-sm'
                          : 'text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <Pin
                        size={12}
                        className={`transition-transform duration-200 ${
                          isPinned ? 'rotate-45 fill-current' : 'hover:-rotate-12'
                        }`}
                      />
                    </button>

                    <button
                      onClick={(e) => handleRunWorkflow(e, wf)}
                      className="h-[25px] px-2.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                    >
                      <Play size={10} strokeWidth={2.4} />
                      <span>调试运行</span>
                    </button>

                    <button
                      onClick={() => onSelectWorkflow(wf.id)}
                      className="h-[25px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] hover:bg-[#f1f1f4] text-[11.5px] font-medium flex items-center gap-1 transition-all shadow-sm"
                    >
                      <Edit3 size={11} />
                      <span>编辑画布</span>
                      <ChevronRight size={11} className="text-[#85858d]" />
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
                <div className="grid grid-cols-3 gap-2">
                  <div
                    onClick={() => setTemplateType('standard')}
                    className={`p-2.5 rounded-[8px] border cursor-pointer transition-all ${
                      templateType === 'standard'
                        ? 'border-[#4f46e5] bg-[#eeedfd]/30 shadow-sm'
                        : 'border-[#e3e3e8] hover:border-[#b9b9c2]'
                    }`}
                  >
                    <div className="font-medium text-[11.5px] text-[#1c1c21] mb-0.5">标准研发模板</div>
                    <div className="text-[10px] text-[#85858d] line-clamp-2">
                      预置 Agent 编码 + Hook + QA 验收
                    </div>
                  </div>

                  <div
                    onClick={() => setTemplateType('deploy')}
                    className={`p-2.5 rounded-[8px] border cursor-pointer transition-all ${
                      templateType === 'deploy'
                        ? 'border-[#0284c7] bg-[#f0f9ff] shadow-sm'
                        : 'border-[#e3e3e8] hover:border-[#b9b9c2]'
                    }`}
                  >
                    <div className="font-medium text-[11.5px] text-[#1c1c21] mb-0.5 flex items-center gap-1">
                      <Rocket size={11} className="text-[#0284c7]" />
                      <span>构建部署模板</span>
                    </div>
                    <div className="text-[10px] text-[#85858d] line-clamp-2">
                      预检 + 全量构建 + 部署上线 + 门禁
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
                    <div className="font-medium text-[11.5px] text-[#1c1c21] mb-0.5">空白画布</div>
                    <div className="text-[10px] text-[#85858d] line-clamp-2">
                      从单一初始 CLI 节点自由连线构建
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
