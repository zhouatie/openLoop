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
  Loader2,
  List,
  LayoutGrid,
  Terminal,
  GitBranch,
  X,
} from 'lucide-react';
import { WorkflowDefinition, NodeType } from '@openloop/core';
import { api } from '../services/api';
import { EditWorkflowModal } from '../components/EditWorkflowModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { DebugWorkflowModal } from '../components/DebugWorkflowModal';
import { toast } from '../components/Toast';

const STORAGE_KEY_PINNED_WORKFLOWS = 'openloop_pinned_workflow_ids';
const STORAGE_KEY_VIEW_MODE = 'openloop_workflow_view_mode';

interface WorkflowListViewProps {
  workflows: WorkflowDefinition[];
  onSelectWorkflow: (workflowId: string) => void;
  onRefresh: () => void;
  onOpenTaskLogs: (taskId: string, nodeId?: string) => void;
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
  const [templateType, setTemplateType] = useState<'feature_dev' | 'standard' | 'deploy' | 'empty'>('feature_dev');
  const [loading, setLoading] = useState(false);

  // 流水线编辑、复制、删除与调试状态
  const [editTargetWf, setEditTargetWf] = useState<WorkflowDefinition | null>(null);
  const [deleteTargetWf, setDeleteTargetWf] = useState<WorkflowDefinition | null>(null);
  const [debugTargetWf, setDebugTargetWf] = useState<WorkflowDefinition | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  // 置顶与多维排序状态
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PINNED_WORKFLOWS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'name' | 'nodes'>('updated');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // 视图模式与分类过滤状态
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_VIEW_MODE);
      return saved === 'grid' || saved === 'list' ? saved : 'list';
    } catch {
      return 'list';
    }
  });
  const [filterCategory, setFilterCategory] = useState<'all' | 'pinned' | 'agent' | 'qa'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 切换视图模式
  const handleViewModeChange = (mode: 'list' | 'grid') => {
    setViewMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY_VIEW_MODE, mode);
    } catch (err) {
      console.warn('[WorkflowListView] 保存视图偏好失败:', err);
    }
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 切换视图模式:', mode);
    }
  };

  // 复制流水线 ID 快捷反馈
  const handleCopyId = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
      toast.success(`流程 ID 已复制: ${id}`);
      if (import.meta.env?.DEV) {
        console.log('[WorkflowListView] 复制流程 ID:', id);
      }
    } catch (err) {
      console.warn('[WorkflowListView] 复制流程 ID 失败:', err);
    }
  };

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
      toast.success(isPinned ? `已取消「${wf.name}」置顶` : `已将「${wf.name}」固定在顶部`);
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
  const handleSortChange = (newSort: 'updated' | 'created' | 'name' | 'nodes') => {
    setSortBy(newSort);
    setIsSortOpen(false);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 切换排序规则:', newSort);
    }
  };

  // 分类统计项
  const counts = useMemo(() => {
    return {
      all: workflows.length,
      pinned: workflows.filter((w) => pinnedIds.includes(w.id)).length,
      agent: workflows.filter((w) => w.nodes.some((n) => n.type === 'agent')).length,
      qa: workflows.filter((w) => w.nodes.some((n) => n.type === 'qa-approval')).length,
    };
  }, [workflows, pinnedIds]);

  // 拓扑分析与有序流水线环节提炼
  const getPipelineSteps = (nodes: WorkflowDefinition['nodes'] = [], edges: WorkflowDefinition['edges'] = []) => {
    if (!nodes || nodes.length === 0) return [];
    if (nodes.length === 1) return nodes;

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};

    nodes.forEach((n) => {
      inDegree[n.id] = 0;
      adj[n.id] = [];
    });

    edges.forEach((e) => {
      if (inDegree[e.target] !== undefined) {
        inDegree[e.target] = (inDegree[e.target] || 0) + 1;
      }
      if (adj[e.source]) {
        adj[e.source].push(e.target);
      }
    });

    const queue: string[] = nodes
      .filter((n) => inDegree[n.id] === 0)
      .sort((a, b) => (a.position?.x || 0) - (b.position?.x || 0))
      .map((n) => n.id);

    const ordered: typeof nodes = [];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const curId = queue.shift()!;
      if (visited.has(curId)) continue;
      visited.add(curId);
      const node = nodeMap.get(curId);
      if (node) ordered.push(node);

      const neighbors = adj[curId] || [];
      neighbors.sort((a, b) => {
        const nodeA = nodeMap.get(a);
        const nodeB = nodeMap.get(b);
        return (nodeA?.position?.x || 0) - (nodeB?.position?.x || 0);
      });

      for (const nextId of neighbors) {
        inDegree[nextId]--;
        if (inDegree[nextId] <= 0 && !visited.has(nextId)) {
          queue.push(nextId);
        }
      }
    }

    nodes.forEach((n) => {
      if (!visited.has(n.id)) {
        ordered.push(n);
      }
    });

    return ordered;
  };

  // 节点类型图标与徽章元数据
  const getNodeMeta = (type: NodeType) => {
    switch (type) {
      case 'agent':
        return {
          label: 'Agent',
          icon: <Bot size={11} className="text-[#4f46e5]" />,
          badgeBg: 'bg-[#eeedfd]',
          badgeText: 'text-[#4f46e5]',
          badgeBorder: 'border-[#d8d6fb]',
        };
      case 'midscene':
        return {
          label: 'Midscene',
          icon: <Target size={11} className="text-[#16a34a]" />,
          badgeBg: 'bg-[#e4f6ec]',
          badgeText: 'text-[#16a34a]',
          badgeBorder: 'border-[#c3eed7]',
        };
      case 'stitch-image':
        return {
          label: '动图合成',
          icon: <FileVideo size={11} className="text-[#0284c7]" />,
          badgeBg: 'bg-[#eff6ff]',
          badgeText: 'text-[#1d4ed8]',
          badgeBorder: 'border-[#dbeafe]',
        };
      case 'hook':
        return {
          label: 'Hook',
          icon: <Zap size={11} className="text-[#d97706]" />,
          badgeBg: 'bg-[#fef3c7]',
          badgeText: 'text-[#d97706]',
          badgeBorder: 'border-[#fde68a]',
        };
      case 'qa-approval':
        return {
          label: 'QA验收',
          icon: <CheckSquare size={11} className="text-[#ea580c]" />,
          badgeBg: 'bg-[#fff7ed]',
          badgeText: 'text-[#ea580c]',
          badgeBorder: 'border-[#fed7aa]',
        };
      case 'cli':
        return {
          label: 'CLI脚本',
          icon: <Terminal size={11} className="text-[#4b4b53]" />,
          badgeBg: 'bg-[#f4f4f7]',
          badgeText: 'text-[#4b4b53]',
          badgeBorder: 'border-[#e3e3e8]',
        };
      default:
        return {
          label: '自定义',
          icon: <Boxes size={11} className="text-[#85858d]" />,
          badgeBg: 'bg-[#f4f4f7]',
          badgeText: 'text-[#63636b]',
          badgeBorder: 'border-[#e3e3e8]',
        };
    }
  };

  // 工作流视觉主题配置
  const getWorkflowVisual = (wf: WorkflowDefinition) => {
    const nodeTypes = new Set(wf.nodes.map((n) => n.type));
    if (nodeTypes.has('agent')) {
      return {
        icon: <Bot size={17} strokeWidth={2.2} className="text-[#4f46e5]" />,
        bg: 'bg-[#eeedfd]',
        border: 'border-[#d8d6fb]',
        glow: 'group-hover:border-[#4f46e5]/40',
        tag: 'AI 智能体',
      };
    }
    if (nodeTypes.has('midscene')) {
      return {
        icon: <Target size={17} strokeWidth={2.2} className="text-[#16a34a]" />,
        bg: 'bg-[#e4f6ec]',
        border: 'border-[#c3eed7]',
        glow: 'group-hover:border-[#16a34a]/40',
        tag: '视觉自动化',
      };
    }
    if (wf.name.includes('部署') || wf.id.includes('deploy')) {
      return {
        icon: <Rocket size={17} strokeWidth={2.2} className="text-[#0284c7]" />,
        bg: 'bg-[#f0f9ff]',
        border: 'border-[#bae6fd]',
        glow: 'group-hover:border-[#0284c7]/40',
        tag: '持续交付',
      };
    }
    if (nodeTypes.has('qa-approval')) {
      return {
        icon: <CheckSquare size={17} strokeWidth={2.2} className="text-[#ea580c]" />,
        bg: 'bg-[#fff7ed]',
        border: 'border-[#fed7aa]',
        glow: 'group-hover:border-[#ea580c]/40',
        tag: '门禁验收',
      };
    }
    return {
      icon: <Workflow size={17} strokeWidth={2.2} className="text-[#1c1c21]" />,
      bg: 'bg-[#f4f4f7]',
      border: 'border-[#ececf0]',
      glow: 'group-hover:border-[#b9b9c2]',
      tag: '基础流水线',
    };
  };

  // 综合置顶与排序规则过滤流水线
  const filteredWorkflows = useMemo(() => {
    return [...workflows]
      .filter((w) => {
        // 分类筛选
        if (filterCategory === 'pinned' && !pinnedIds.includes(w.id)) return false;
        if (filterCategory === 'agent' && !w.nodes.some((n) => n.type === 'agent')) return false;
        if (filterCategory === 'qa' && !w.nodes.some((n) => n.type === 'qa-approval')) return false;

        // 关键词筛选
        if (!searchTerm) return true;
        const kw = searchTerm.toLowerCase();
        return (
          w.name.toLowerCase().includes(kw) ||
          w.id.toLowerCase().includes(kw) ||
          (w.description && w.description.toLowerCase().includes(kw)) ||
          w.nodes.some((n) => n.name.toLowerCase().includes(kw))
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
        if (sortBy === 'nodes') {
          return b.nodes.length - a.nodes.length;
        }
        return 0;
      });
  }, [workflows, searchTerm, pinnedIds, sortBy, filterCategory]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setLoading(true);
    try {
      const id = `wf_${Date.now().toString(36)}`;
      let nodes = [];
      let edges = [];

      if (templateType === 'feature_dev') {
        nodes = [
          {
            id: 'node_agent_coder',
            name: 'AI Agent 编码实现',
            type: 'agent' as NodeType,
            position: { x: 100, y: 150 },
            config: {
              agentName: 'Pi Coding Agent',
              prompt: '请根据需求完成代码修改与自测：\n需求：{{task.title}}\n详细说明：{{task.description}}\n请保持工程代码整洁与类型严谨。',
              timeoutSec: 600,
            },
          },
          {
            id: 'node_build_verify',
            name: '前端构建自检',
            type: 'cli' as NodeType,
            position: { x: 420, y: 150 },
            config: {
              command: 'pnpm --filter @openloop/desktop build:renderer',
              timeoutSec: 180,
            },
          },
          {
            id: 'node_qa_gate',
            name: 'QA 人工验收门禁',
            type: 'qa-approval' as NodeType,
            position: { x: 740, y: 150 },
            config: {
              approvalPrompt: '请在前端页面验证功能实现是否完整无误',
              checklist: ['功能逻辑已按需求完整实现', '界面符合极简高质感规范', '构建与类型自检无报错'],
            },
          },
          {
            id: 'node_git_commit',
            name: 'Git 自动提交代码',
            type: 'cli' as NodeType,
            position: { x: 1060, y: 150 },
            config: {
              command: 'git add -A && if git diff --staged --quiet; then echo "工作区干净，无需提交"; else git commit -m "feat: {{task.title}}" && git log -1 --stat; fi',
              timeoutSec: 60,
            },
          },
        ];
        edges = [
          { id: 'edge_agent_to_build', source: 'node_agent_coder', target: 'node_build_verify' },
          { id: 'edge_build_to_qa', source: 'node_build_verify', target: 'node_qa_gate' },
          { id: 'edge_qa_to_commit', source: 'node_qa_gate', target: 'node_git_commit' },
        ];
      } else if (templateType === 'standard') {
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
      toast.success(`流程「${newTitle.trim()}」创建成功`);
      onRefresh();
      // 直接打开新创建的流程画布
      onSelectWorkflow(id);
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowListView] 创建流程失败:', err);
      }
      toast.error(`创建流程失败: ${err?.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunWorkflow = (e: React.MouseEvent, wf: WorkflowDefinition) => {
    e.stopPropagation();
    setDebugTargetWf(wf);
  };

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
    if (!debugTargetWf) return;
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 发起编排调试执行:', {
        workflowId: debugTargetWf.id,
        workflowName: debugTargetWf.name,
        title,
        workspace,
      });
    }

    try {
      const task = await api.createTask({
        title,
        description: description || undefined,
        workflowId: debugTargetWf.id,
        workspace: workspace || undefined,
        autoRun: true,
      });

      if (import.meta.env?.DEV) {
        console.log('[WorkflowListView] 调试任务已创建成功:', task.id);
      }

      toast.success(`编排调试任务已触发 (${task.id})`, {
        description: `已根据流程「${debugTargetWf.name}」自动开始运行`,
        action: {
          label: '查看运行日志',
          onClick: () => onOpenTaskLogs(task.id),
        },
      });

      onRefresh();
      if (openLogsImmediately) {
        onOpenTaskLogs(task.id);
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowListView] 启动调试失败:', err);
      }
      toast.error(`启动失败: ${err?.message || '未知错误'}`);
      throw err;
    }
  };

  // 复制工作流
  const handleDuplicateWorkflow = async (e: React.MouseEvent, wf: WorkflowDefinition) => {
    e.stopPropagation();
    if (duplicatingId) return;

    setDuplicatingId(wf.id);
    const newId = `wf_${Date.now().toString(36)}`;
    const clonedWf: WorkflowDefinition = {
      ...wf,
      id: newId,
      name: `${wf.name} (副本)`,
      description: wf.description || '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: JSON.parse(JSON.stringify(wf.nodes || [])),
      edges: JSON.parse(JSON.stringify(wf.edges || [])),
      variables: wf.variables ? JSON.parse(JSON.stringify(wf.variables)) : undefined,
    };

    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 发起流程复制:', {
        fromId: wf.id,
        newId: clonedWf.id,
        name: clonedWf.name,
      });
    }

    try {
      await api.saveWorkflow(clonedWf);
      if (import.meta.env?.DEV) {
        console.log('[WorkflowListView] 流程复制成功:', clonedWf.id);
      }
      toast.success(`流程已复制为「${clonedWf.name}」`);
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowListView] 流程复制失败:', err);
      }
      toast.error(`复制流程失败: ${err?.message || '未知错误'}`);
    } finally {
      setDuplicatingId(null);
    }
  };

  // 保存工作流基本信息修改
  const handleSaveEditWorkflow = async ({
    id,
    name,
    description,
  }: {
    id: string;
    name: string;
    description: string;
  }) => {
    const target = workflows.find((w) => w.id === id);
    if (!target) return;

    const updatedWf: WorkflowDefinition = {
      ...target,
      name,
      description,
      updatedAt: Date.now(),
    };

    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 更新流程信息:', {
        id,
        name,
        description,
      });
    }

    await api.saveWorkflow(updatedWf);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 流程信息更新成功:', id);
    }
    setEditTargetWf(null);
    onRefresh();
  };

  // 确认删除工作流
  const handleConfirmDeleteWorkflow = async () => {
    if (!deleteTargetWf) return;

    setIsDeleting(true);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 执行删除流程:', deleteTargetWf.id);
    }

    try {
      await api.deleteWorkflow(deleteTargetWf.id);
      // 同步移除置顶记录
      setPinnedIds((prev) => {
        const next = prev.filter((id) => id !== deleteTargetWf.id);
        try {
          localStorage.setItem(STORAGE_KEY_PINNED_WORKFLOWS, JSON.stringify(next));
        } catch (err) {
          console.warn('[WorkflowListView] 同步置顶列表失败:', err);
        }
        return next;
      });

      if (import.meta.env?.DEV) {
        console.log('[WorkflowListView] 流程删除成功:', deleteTargetWf.id);
      }
      toast.success(`流程「${deleteTargetWf.name}」已成功删除`);
      setDeleteTargetWf(null);
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowListView] 流程删除失败:', err);
      }
      toast.error(`删除流程失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-y-auto select-none p-6 space-y-4">
      {/* 顶部工具栏 (Magpie 极简工业质感) */}
      <div className="flex flex-col gap-3.5 pb-2 border-b border-[#e3e3e8]">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-[16px] font-bold text-[#1c1c21] tracking-tight">流程编排模版库</h2>
              <span className="text-[11px] font-mono font-medium text-[#63636b] bg-white border border-[#e3e3e8] px-2 py-[1px] rounded-[5px] shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                {workflows.length} 个编排
              </span>
            </div>
            <p className="text-[12px] text-[#85858d] mt-1">
              设计、串联与编排你的自动化研发 DAG 流水线。支持 AI 智能体、代码自检、自动化回归与人工门禁自由连线。
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 点击新建工作流');
                setIsCreateModalOpen(true);
              }}
              className="flex items-center gap-1.5 h-[30px] px-3.5 rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-sm"
            >
              <Plus size={13} strokeWidth={2.4} />
              <span>新建工作流</span>
            </button>
          </div>
        </div>

        {/* 筛选标签与操作栏 */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* 左侧：分类快速筛选胶囊 */}
          <div className="flex items-center gap-1 bg-[#ececf0]/75 p-0.5 rounded-[7px] text-[11.5px]">
            <button
              onClick={() => {
                setFilterCategory('all');
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 筛选分类: 全部');
              }}
              className={`px-2.5 py-1 rounded-[5px] font-medium transition-all ${
                filterCategory === 'all'
                  ? 'bg-white text-[#1c1c21] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              全部 ({counts.all})
            </button>
            <button
              onClick={() => {
                setFilterCategory('pinned');
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 筛选分类: 已置顶');
              }}
              className={`px-2.5 py-1 rounded-[5px] font-medium transition-all flex items-center gap-1 ${
                filterCategory === 'pinned'
                  ? 'bg-white text-[#4f46e5] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <Pin size={10} className="rotate-45 fill-current" />
              已置顶 ({counts.pinned})
            </button>
            <button
              onClick={() => {
                setFilterCategory('agent');
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 筛选分类: 含 AI Agent');
              }}
              className={`px-2.5 py-1 rounded-[5px] font-medium transition-all flex items-center gap-1 ${
                filterCategory === 'agent'
                  ? 'bg-white text-[#4f46e5] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <Bot size={11} />
              含 Agent ({counts.agent})
            </button>
            <button
              onClick={() => {
                setFilterCategory('qa');
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 筛选分类: 含 QA 门禁');
              }}
              className={`px-2.5 py-1 rounded-[5px] font-medium transition-all flex items-center gap-1 ${
                filterCategory === 'qa'
                  ? 'bg-white text-[#ea580c] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <CheckSquare size={11} />
              含门禁 ({counts.qa})
            </button>
          </div>

          {/* 右侧：搜索 + 排序 + 视图切换 */}
          <div className="flex items-center gap-2">
            {/* 搜索框 */}
            <div className="relative w-56">
              <Search size={12} className="absolute left-2.5 top-2 text-[#85858d]" />
              <input
                type="text"
                placeholder="搜索名称、描述或环节..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-[28px] pl-7 pr-7 bg-white border border-[#e3e3e8] rounded-[6px] text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus:border-[#4f46e5] transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-2 text-[#85858d] hover:text-[#1c1c21] transition-colors"
                  title="清空搜索"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* 排序方式选择下拉 */}
            <div className="relative" ref={sortMenuRef}>
              <button
                onClick={() => setIsSortOpen(!isSortOpen)}
                className={`h-[28px] px-2.5 rounded-[6px] border text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${
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
                  {sortBy === 'nodes' && '节点最多'}
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
                  <button
                    onClick={() => handleSortChange('nodes')}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors ${
                      sortBy === 'nodes'
                        ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                        : 'text-[#4b4b53] hover:bg-[#f4f4f6]'
                    }`}
                  >
                    <span>节点最多</span>
                    {sortBy === 'nodes' && <Check size={11} strokeWidth={2.4} />}
                  </button>
                </div>
              )}
            </div>

            {/* 视图模式切换 (列表 / 卡片网格) */}
            <div className="flex items-center bg-[#ececf0]/75 p-0.5 rounded-[6px] text-[#63636b]">
              <button
                onClick={() => handleViewModeChange('list')}
                title="紧凑列表视图"
                className={`w-[26px] h-[24px] rounded-[4px] flex items-center justify-center transition-all ${
                  viewMode === 'list'
                    ? 'bg-white text-[#1c1c21] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                    : 'hover:text-[#1c1c21]'
                }`}
              >
                <List size={13} />
              </button>
              <button
                onClick={() => handleViewModeChange('grid')}
                title="卡片网格视图"
                className={`w-[26px] h-[24px] rounded-[4px] flex items-center justify-center transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white text-[#1c1c21] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                    : 'hover:text-[#1c1c21]'
                }`}
              >
                <LayoutGrid size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 流程展示区 */}
      <div className="space-y-2">
        {filteredWorkflows.length === 0 ? (
          <div className="bg-white border border-[#e3e3e8] rounded-[12px] p-16 text-center shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-[12px] bg-[#f4f4f7] border border-[#ececf0] flex items-center justify-center text-[#85858d] mb-3 shadow-inner">
              <Workflow size={22} strokeWidth={1.8} />
            </div>
            <div className="text-[14px] font-semibold text-[#1c1c21]">
              {searchTerm || filterCategory !== 'all' ? '未匹配到符合条件的工作流' : '暂无自动化流水线'}
            </div>
            <p className="text-[12px] text-[#85858d] mt-1 max-w-sm">
              {searchTerm || filterCategory !== 'all'
                ? '可以尝试更换筛选条件或清空搜索关键词'
                : '点击右上角“新建工作流”基于 DAG 节点自由连线编排'}
            </p>
            {searchTerm || filterCategory !== 'all' ? (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setFilterCategory('all');
                }}
                className="mt-4 h-[28px] px-3 rounded-[6px] bg-[#f4f4f7] hover:bg-[#ececf0] text-[#1c1c21] text-[12px] font-medium transition-all"
              >
                重置筛选条件
              </button>
            ) : (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="mt-4 flex items-center gap-1.5 h-[30px] px-3.5 rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-sm"
              >
                <Plus size={13} strokeWidth={2.4} />
                <span>立即新建</span>
              </button>
            )}
          </div>
        ) : viewMode === 'list' ? (
          /* 极致优雅列表视图 */
          <div className="bg-white border border-[#e3e3e8] rounded-[12px] divide-y divide-[#ececf0] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
            {filteredWorkflows.map((wf) => {
              const isPinned = pinnedIds.includes(wf.id);
              const friendlyTime = formatFriendlyTime(wf.updatedAt || wf.createdAt);
              const visual = getWorkflowVisual(wf);
              const pipelineSteps = getPipelineSteps(wf.nodes, wf.edges);

              return (
                <div
                  key={wf.id}
                  onClick={() => {
                    if (import.meta.env?.DEV) {
                      console.log('[WorkflowListView] 进入流程画布:', wf.id);
                    }
                    onSelectWorkflow(wf.id);
                  }}
                  className={`px-4 py-3 flex items-center justify-between gap-4 transition-all duration-150 cursor-pointer group ${
                    isPinned ? 'bg-[#fafaff] hover:bg-[#f4f4fc]' : 'hover:bg-[#fafafc]'
                  }`}
                >
                  {/* 左侧：工作流图标 + 标题 + 置顶徽章 + ID + 描述 */}
                  <div className="flex items-center gap-3.5 min-w-0 flex-1 max-w-[440px]">
                    <div
                      className={`w-9 h-9 rounded-[8px] border flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-2xs ${visual.bg} ${visual.border}`}
                    >
                      {visual.icon}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="text-[13.5px] font-semibold text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors truncate leading-tight"
                          title={wf.name}
                        >
                          {wf.name}
                        </span>

                        {isPinned && (
                          <span className="inline-flex items-center gap-0.5 text-[9.5px] font-medium text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-1.5 py-[0.5px] rounded-[4px] shrink-0">
                            <Pin size={8.5} className="rotate-45 fill-current" />
                            已置顶
                          </span>
                        )}

                        <button
                          onClick={(e) => handleCopyId(e, wf.id)}
                          className="text-[10px] font-mono text-[#85858d] hover:text-[#4f46e5] bg-[#f4f4f7] hover:bg-[#eeedfd] px-1.5 py-[0.5px] rounded border border-[#ececf0] hover:border-[#d8d6fb] transition-colors shrink-0 flex items-center gap-1"
                          title="点击复制流程 ID"
                        >
                          <span>{wf.id}</span>
                          {copiedId === wf.id ? (
                            <Check size={8.5} className="text-[#16a34a]" />
                          ) : (
                            <Copy size={8} className="opacity-0 group-hover:opacity-60" />
                          )}
                        </button>
                      </div>

                      <p className="text-[11.5px] text-[#63636b] truncate mt-0.5 leading-normal">
                        {wf.description || '暂无流程描述'}
                      </p>
                    </div>
                  </div>

                  {/* 中部：DAG 流水线编排流转链 (充实宽屏视觉留白，展现工程科技质感) */}
                  <div className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#f8f8fa] border border-[#ececf0] max-w-[460px] overflow-hidden shrink-0">
                    <span className="text-[10px] text-[#85858d] font-medium tracking-wider shrink-0 mr-1 flex items-center gap-1">
                      <GitBranch size={10.5} className="text-[#85858d]" /> 环节
                    </span>
                    {pipelineSteps.slice(0, 4).map((step, idx) => {
                      const meta = getNodeMeta(step.type);
                      return (
                        <React.Fragment key={step.id}>
                          {idx > 0 && <ChevronRight size={10} className="text-[#c7c7cf] shrink-0" />}
                          <div
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-white border border-[#e3e3e8] text-[10.5px] text-[#4b4b53] shrink-0 max-w-[95px] shadow-[0_1px_1px_rgba(0,0,0,0.02)]"
                            title={`${step.name} (${meta.label})`}
                          >
                            {meta.icon}
                            <span className="truncate">{step.name}</span>
                          </div>
                        </React.Fragment>
                      );
                    })}
                    {pipelineSteps.length > 4 && (
                      <span
                        className="text-[10px] font-mono text-[#85858d] bg-white border border-[#e3e3e8] px-1.5 py-0.5 rounded shrink-0"
                        title={`共有 ${pipelineSteps.length} 个编排环节`}
                      >
                        +{pipelineSteps.length - 4}
                      </span>
                    )}
                  </div>

                  {/* 右侧：统计指标与操作按钮 */}
                  <div
                    className="flex items-center gap-3 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* 指标与时间 */}
                    <div className="flex flex-col items-end text-right">
                      <span className="text-[11px] font-medium text-[#4b4b53] font-mono">
                        {wf.nodes.length} 节点 · {wf.edges.length} 连线
                      </span>
                      <span className="text-[10.5px] text-[#85858d] flex items-center gap-1 mt-0.5">
                        <Clock size={10} />
                        {friendlyTime}
                      </span>
                    </div>

                    {/* 竖分割线 */}
                    <div className="w-[1px] h-6 bg-[#ececf0]" />

                    {/* 快捷悬浮动作组 */}
                    <div className="flex items-center gap-1">
                      {/* 置顶切换 */}
                      <button
                        onClick={(e) => handleTogglePin(e, wf)}
                        title={isPinned ? '取消置顶' : '固定在顶部'}
                        className={`w-[26px] h-[26px] rounded-[5px] flex items-center justify-center transition-all ${
                          isPinned
                            ? 'bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb] shadow-2xs'
                            : 'text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] opacity-0 group-hover:opacity-100 border border-transparent hover:border-[#e3e3e8]'
                        }`}
                      >
                        <Pin
                          size={11.5}
                          className={`transition-transform duration-200 ${
                            isPinned ? 'rotate-45 fill-current' : 'hover:-rotate-12'
                          }`}
                        />
                      </button>

                      {/* 编辑基本信息 */}
                      <button
                        onClick={() => setEditTargetWf(wf)}
                        title="编辑流程名称与描述"
                        className="w-[26px] h-[26px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] opacity-0 group-hover:opacity-100 transition-all border border-transparent hover:border-[#e3e3e8]"
                      >
                        <Edit3 size={11} />
                      </button>

                      {/* 复制流程 */}
                      <button
                        onClick={(e) => handleDuplicateWorkflow(e, wf)}
                        title="复制为新流程"
                        disabled={duplicatingId === wf.id}
                        className="w-[26px] h-[26px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] opacity-0 group-hover:opacity-100 transition-all border border-transparent hover:border-[#e3e3e8] disabled:opacity-50"
                      >
                        {duplicatingId === wf.id ? (
                          <Loader2 size={11} className="animate-spin text-[#4f46e5]" />
                        ) : (
                          <Copy size={11} />
                        )}
                      </button>

                      {/* 删除流程 */}
                      <button
                        onClick={() => setDeleteTargetWf(wf)}
                        title="删除流程"
                        className="w-[26px] h-[26px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:bg-[#fff1f2] hover:text-[#e11d48] hover:border-[#ffe4e6] opacity-0 group-hover:opacity-100 transition-all border border-transparent"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>

                    {/* 调试运行 */}
                    <button
                      onClick={(e) => handleRunWorkflow(e, wf)}
                      title="启动测试运行与验证任务"
                      className="h-[27px] px-2.5 rounded-[5px] bg-[#f4f4f7] hover:bg-[#eeedfd] text-[#4b4b53] hover:text-[#4f46e5] border border-[#e3e3e8] hover:border-[#d8d6fb] text-[11.5px] font-medium flex items-center gap-1.5 transition-all active:scale-95 shadow-2xs"
                    >
                      <Play size={10} strokeWidth={2.4} className="fill-current text-[#4f46e5]" />
                      <span>调试运行</span>
                    </button>

                    {/* 编辑画布 */}
                    <button
                      onClick={() => onSelectWorkflow(wf.id)}
                      title="进入 DAG 可视化连线画布"
                      className="h-[27px] px-2.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-xs"
                    >
                      <span>编辑画布</span>
                      <ChevronRight size={11} className="text-white/70" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* 卡片网格视图 */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredWorkflows.map((wf) => {
              const isPinned = pinnedIds.includes(wf.id);
              const friendlyTime = formatFriendlyTime(wf.updatedAt || wf.createdAt);
              const visual = getWorkflowVisual(wf);
              const pipelineSteps = getPipelineSteps(wf.nodes, wf.edges);

              return (
                <div
                  key={wf.id}
                  onClick={() => {
                    if (import.meta.env?.DEV) {
                      console.log('[WorkflowListView] 进入流程画布:', wf.id);
                    }
                    onSelectWorkflow(wf.id);
                  }}
                  className={`bg-white border rounded-[12px] p-4 flex flex-col justify-between transition-all duration-200 cursor-pointer group shadow-[0_1px_3px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_20px_rgba(20,22,30,0.07)] hover:-translate-y-0.5 ${
                    isPinned
                      ? 'border-[#d8d6fb] bg-[#fdfdff] hover:border-[#4f46e5]/40'
                      : 'border-[#e3e3e8] hover:border-[#b9b9c2]'
                  }`}
                >
                  <div>
                    {/* 卡片头部：图标、标题、ID 与置顶按钮 */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`w-9 h-9 rounded-[8px] border flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-2xs ${visual.bg} ${visual.border}`}
                        >
                          {visual.icon}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <h3
                              className="font-semibold text-[13.5px] text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors truncate leading-tight"
                              title={wf.name}
                            >
                              {wf.name}
                            </h3>
                            {isPinned && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-1 py-[0.5px] rounded shrink-0">
                                <Pin size={8} className="rotate-45 fill-current" />
                                置顶
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 mt-1">
                            <button
                              onClick={(e) => handleCopyId(e, wf.id)}
                              className="text-[10px] font-mono text-[#85858d] hover:text-[#4f46e5] bg-[#f4f4f7] hover:bg-[#eeedfd] px-1.5 py-[0.5px] rounded border border-[#ececf0] hover:border-[#d8d6fb] transition-colors shrink-0 flex items-center gap-1"
                              title="点击复制 ID"
                            >
                              <span>{wf.id}</span>
                              {copiedId === wf.id ? (
                                <Check size={8} className="text-[#16a34a]" />
                              ) : (
                                <Copy size={7.5} className="opacity-0 group-hover:opacity-60" />
                              )}
                            </button>
                            <span className="text-[10.5px] text-[#85858d] flex items-center gap-1">
                              <Clock size={9.5} />
                              {friendlyTime}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 卡片右上角操作 */}
                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={(e) => handleTogglePin(e, wf)}
                          title={isPinned ? '取消置顶' : '固定在顶部'}
                          className={`w-[24px] h-[24px] rounded-[5px] flex items-center justify-center transition-all ${
                            isPinned
                              ? 'bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb]'
                              : 'text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <Pin
                            size={11}
                            className={`transition-transform duration-200 ${
                              isPinned ? 'rotate-45 fill-current' : 'hover:-rotate-12'
                            }`}
                          />
                        </button>

                        <button
                          onClick={() => setEditTargetWf(wf)}
                          title="编辑流程信息"
                          className="w-[24px] h-[24px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Edit3 size={11} />
                        </button>

                        <button
                          onClick={(e) => handleDuplicateWorkflow(e, wf)}
                          title="复制流程"
                          disabled={duplicatingId === wf.id}
                          className="w-[24px] h-[24px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                        >
                          {duplicatingId === wf.id ? (
                            <Loader2 size={11} className="animate-spin text-[#4f46e5]" />
                          ) : (
                            <Copy size={11} />
                          )}
                        </button>

                        <button
                          onClick={() => setDeleteTargetWf(wf)}
                          title="删除流程"
                          className="w-[24px] h-[24px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:bg-[#fff1f2] hover:text-[#e11d48] opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    {/* 流程描述 */}
                    <p className="text-[12px] text-[#63636b] line-clamp-2 leading-relaxed min-h-[34px] mt-2.5">
                      {wf.description || '暂无流程描述，点击进入画布编辑'}
                    </p>

                    {/* DAG 流水线环节预览栏 */}
                    <div className="mt-3 p-2 rounded-[8px] bg-[#f8f8fa] border border-[#ececf0]">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-medium text-[#85858d] flex items-center gap-1 uppercase tracking-wider">
                          <GitBranch size={10} className="text-[#85858d]" /> 流水线环节 ({wf.nodes.length})
                        </span>
                        <span className="text-[10px] font-mono text-[#85858d]">
                          {wf.edges.length} 连线
                        </span>
                      </div>
                      <div className="flex items-center gap-1 overflow-hidden">
                        {pipelineSteps.slice(0, 3).map((step, idx) => {
                          const meta = getNodeMeta(step.type);
                          return (
                            <React.Fragment key={step.id}>
                              {idx > 0 && <ChevronRight size={9} className="text-[#c7c7cf] shrink-0" />}
                              <div
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-white border border-[#e3e3e8] text-[10px] text-[#4b4b53] shrink-0 max-w-[90px] shadow-[0_1px_1px_rgba(0,0,0,0.02)]"
                                title={`${step.name} (${meta.label})`}
                              >
                                {meta.icon}
                                <span className="truncate">{step.name}</span>
                              </div>
                            </React.Fragment>
                          );
                        })}
                        {pipelineSteps.length > 3 && (
                          <span
                            className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#e3e3e8] px-1 py-0.5 rounded shrink-0"
                            title={`剩余 ${pipelineSteps.length - 3} 个环节`}
                          >
                            +{pipelineSteps.length - 3}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 卡片底栏操作 */}
                  <div
                    className="border-t border-[#f4f4f7] pt-3 mt-3 flex items-center justify-end gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => handleRunWorkflow(e, wf)}
                      title="启动测试运行与验证任务"
                      className="h-[27px] px-2.5 rounded-[5px] bg-[#f4f4f7] hover:bg-[#eeedfd] text-[#4b4b53] hover:text-[#4f46e5] border border-[#e3e3e8] hover:border-[#d8d6fb] text-[11.5px] font-medium flex items-center gap-1.5 transition-all active:scale-95 shadow-2xs"
                    >
                      <Play size={10} strokeWidth={2.4} className="fill-current text-[#4f46e5]" />
                      <span>调试运行</span>
                    </button>

                    <button
                      onClick={() => onSelectWorkflow(wf.id)}
                      title="进入 DAG 可视化连线画布"
                      className="h-[27px] px-3 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-xs"
                    >
                      <span>编辑画布</span>
                      <ChevronRight size={11} className="text-white/70" />
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
                    onClick={() => setTemplateType('feature_dev')}
                    className={`p-2.5 rounded-[8px] border cursor-pointer transition-all ${
                      templateType === 'feature_dev'
                        ? 'border-[#4f46e5] bg-[#eeedfd]/40 shadow-sm'
                        : 'border-[#e3e3e8] hover:border-[#b9b9c2]'
                    }`}
                  >
                    <div className="font-semibold text-[11.5px] text-[#1c1c21] mb-0.5 flex items-center gap-1.5">
                      <Bot size={12} className="text-[#4f46e5]" />
                      <span>通用研发流水线</span>
                    </div>
                    <div className="text-[10px] text-[#85858d] line-clamp-2">
                      Agent 编码 + 构建自检 + QA 门禁 + Git 提交
                    </div>
                  </div>

                  <div
                    onClick={() => setTemplateType('standard')}
                    className={`p-2.5 rounded-[8px] border cursor-pointer transition-all ${
                      templateType === 'standard'
                        ? 'border-[#4f46e5] bg-[#eeedfd]/40 shadow-sm'
                        : 'border-[#e3e3e8] hover:border-[#b9b9c2]'
                    }`}
                  >
                    <div className="font-medium text-[11.5px] text-[#1c1c21] mb-0.5 flex items-center gap-1.5">
                      <Zap size={12} className="text-[#b45309]" />
                      <span>轻量研发模板</span>
                    </div>
                    <div className="text-[10px] text-[#85858d] line-clamp-2">
                      Agent 编码 + Hook 触发 + QA 验收
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
                    <div className="font-medium text-[11.5px] text-[#1c1c21] mb-0.5 flex items-center gap-1.5">
                      <Rocket size={12} className="text-[#0284c7]" />
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
                        ? 'border-[#4f46e5] bg-[#eeedfd]/40 shadow-sm'
                        : 'border-[#e3e3e8] hover:border-[#b9b9c2]'
                    }`}
                  >
                    <div className="font-medium text-[11.5px] text-[#1c1c21] mb-0.5 flex items-center gap-1.5">
                      <Sparkles size={12} className="text-[#4f46e5]" />
                      <span>空白 / AI 助手生成</span>
                    </div>
                    <div className="text-[10px] text-[#85858d] line-clamp-2">
                      进入后由 Agent 对话从头到尾自动编排
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
      {/* 编辑工作流基本信息弹窗 */}
      <EditWorkflowModal
        isOpen={!!editTargetWf}
        workflow={editTargetWf}
        onClose={() => setEditTargetWf(null)}
        onSave={handleSaveEditWorkflow}
      />

      {/* 删除工作流二次确认弹窗 */}
      <ConfirmModal
        isOpen={!!deleteTargetWf}
        title="删除自动化流水线"
        targetName={deleteTargetWf?.name}
        targetTag={deleteTargetWf?.id}
        description="确定要永久删除该自动化编排流程吗？此操作不可撤销，已有关联历史任务执行记录不受影响。"
        confirmText="确认删除"
        cancelText="取消"
        variant="danger"
        loading={isDeleting}
        onClose={() => {
          if (!isDeleting) setDeleteTargetWf(null);
        }}
        onConfirm={handleConfirmDeleteWorkflow}
      />

      {/* 编排调试流水线弹窗 */}
      <DebugWorkflowModal
        isOpen={!!debugTargetWf}
        workflow={debugTargetWf}
        onClose={() => setDebugTargetWf(null)}
        onStartDebug={handleStartDebug}
      />
    </div>
  );
};
