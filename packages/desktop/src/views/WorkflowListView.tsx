import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  ChevronDown,
  Boxes,
  FileText,
  Rocket,
  Pin,
  ArrowUpDown,
  Check,
  Loader2,
  List,
  LayoutGrid,
  Terminal,
  GitBranch,
  GitCommit,
  X,
  History,
  MoreHorizontal,
  Tag as TagIcon,
  Tags as TagsIcon,
} from 'lucide-react';
import { WorkflowDefinition, NodeType, Task, WorkflowTaskTemplate } from '@openloop/core';
import { cleanTaskTemplate } from '../utils/workflowTemplate';
import { markdownTemplate } from '../utils/pipelineMarkdown';
import { api } from '../services/api';
import { ConfirmModal } from '../components/ConfirmModal';
import { DebugWorkflowModal } from '../components/DebugWorkflowModal';
import { toast } from '../components/Toast';
import { TagInput } from '../components/TagInput';
import { WorkflowExecutionHistoryView } from './workflow/WorkflowExecutionHistoryView';

const STORAGE_KEY_PINNED_WORKFLOWS = 'openloop_pinned_workflow_ids';
const STORAGE_KEY_VIEW_MODE = 'openloop_workflow_view_mode';
const STORAGE_KEY_SUBTAB = 'openloop_workflow_subtab';
// 行级操作浮层高度，用于判断向下或向上展开
const ACTION_MENU_HEIGHT = 112;

interface WorkflowListViewProps {
  workflows: WorkflowDefinition[];
  tasks?: Task[];
  onSelectWorkflow: (workflowId: string) => void;
  onRefresh: () => void;
  onOpenTaskLogs: (taskId: string, nodeId?: string) => void;
  initialSubTab?: 'workflows' | 'runs';
  initialFilteredWorkflowId?: string | null;
  initialSelectedTaskId?: string | null;
  onClearSelectedTask?: () => void;
}

export const WorkflowListView: React.FC<WorkflowListViewProps> = ({
  workflows,
  tasks = [],
  onSelectWorkflow,
  onRefresh,
  onOpenTaskLogs,
  initialSubTab,
  initialFilteredWorkflowId,
  initialSelectedTaskId,
  onClearSelectedTask,
}) => {
  // 子 Tab 切换状态与记忆
  const [activeSubTab, setActiveSubTab] = useState<'workflows' | 'runs'>(() => {
    if (initialSubTab) return initialSubTab;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SUBTAB);
      if (saved === 'runs' || saved === 'workflows') return saved;
    } catch {}
    return 'workflows';
  });

  const [runsFilterWfId, setRunsFilterWfId] = useState<string | null>(initialFilteredWorkflowId || null);

  useEffect(() => {
    if (initialSubTab) {
      setActiveSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  useEffect(() => {
    if (initialFilteredWorkflowId !== undefined) {
      setRunsFilterWfId(initialFilteredWorkflowId);
    }
  }, [initialFilteredWorkflowId]);

  const handleSubTabChange = (tab: 'workflows' | 'runs') => {
    setActiveSubTab(tab);
    try {
      localStorage.setItem(STORAGE_KEY_SUBTAB, tab);
    } catch {}
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 切换流程编排子 Tab:', tab);
    }
  };

  const handleViewRunsOfWorkflow = (e: React.MouseEvent, wfId: string) => {
    e.stopPropagation();
    setRunsFilterWfId(wfId);
    handleSubTabChange('runs');
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // 流水线编辑、复制、删除与调试状态
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

  // 更多操作下拉菜单状态（浮层挂载到 body，避免被列表滚动容器裁剪）
  const [actionMenu, setActionMenu] = useState<{ wfId: string; right: number; top: number } | null>(
    null
  );
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionMenuPanelRef = useRef<HTMLDivElement>(null);

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
  const [selectedTag, setSelectedTag] = useState<string | 'all'>('all');
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
  const tagMenuRef = useRef<HTMLDivElement>(null);
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

  // 点击外部收起排序下拉菜单与标签筛选菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setIsSortOpen(false);
      }
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setIsTagMenuOpen(false);
      }
    };
    if (isSortOpen || isTagMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSortOpen, isTagMenuOpen]);

  // 点击外部或滚动、缩放时关闭行级操作下拉菜单
  useEffect(() => {
    if (!actionMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (actionMenuRef.current?.contains(target) || actionMenuPanelRef.current?.contains(target)) {
        return;
      }
      setActionMenu(null);
    };
    const close = () => setActionMenu(null);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [actionMenu]);

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
    const isPinned = pinnedIds.includes(wf.id);
    const next = isPinned ? pinnedIds.filter((id) => id !== wf.id) : [wf.id, ...pinnedIds];
    try {
      localStorage.setItem(STORAGE_KEY_PINNED_WORKFLOWS, JSON.stringify(next));
    } catch (err) {
      console.warn('[WorkflowListView] 保存置顶失败:', err);
    }
    setPinnedIds(next);
    toast.success(isPinned ? `已取消「${wf.name}」置顶` : `已将「${wf.name}」固定在顶部`);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 切换流程置顶状态:', {
        id: wf.id,
        name: wf.name,
        pinned: !isPinned,
        totalPinned: next.length,
      });
    }
  };

  // 切换排序方式
  const handleSortChange = (newSort: 'updated' | 'created' | 'name' | 'nodes') => {
    setSortBy(newSort);
    setIsSortOpen(false);
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 切换排序规则:', newSort);
    }
  };

  // 提取全部可用标签并统计频次 (排序使得高频如「工作」靠前)
  const allAvailableTags = useMemo(() => {
    const tagCountMap: Record<string, number> = {};
    workflows.forEach((w) => {
      if (Array.isArray(w.tags)) {
        w.tags.forEach((t) => {
          const trimmed = t?.trim();
          if (trimmed) {
            tagCountMap[trimmed] = (tagCountMap[trimmed] || 0) + 1;
          }
        });
      }
    });
    return Object.keys(tagCountMap)
      .sort((a, b) => tagCountMap[b] - tagCountMap[a] || a.localeCompare(b, 'zh-CN'))
      .map((tag) => ({ name: tag, count: tagCountMap[tag] }));
  }, [workflows]);

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

  // 节点类型图标与徽章元数据 (支持识别特定 CLI: Git/构建/部署)
  const getNodeMeta = (type: NodeType, step?: any) => {
    if (type === 'cli' && step) {
      const name = step.name || '';
      const cmd = step.config?.command || '';
      const isGit = name.toLowerCase().includes('git') || step.id?.includes('git') || cmd.includes('git ');
      if (isGit) {
        return {
          label: 'Git',
          icon: <GitCommit size={11} className="text-[#1c1c21]" />,
          badgeBg: 'bg-[#f4f4f6]',
          badgeText: 'text-[#1c1c21]',
          badgeBorder: 'border-[#e3e3e8]',
        };
      }
      const isDeploy = name.includes('部署') || step.id === 'node_cli_deploy' || cmd.includes('deploy.sh');
      if (isDeploy) {
        return {
          label: '部署',
          icon: <Rocket size={11} className="text-[#52525b]" />,
          badgeBg: 'bg-[#f4f4f5]',
          badgeText: 'text-[#52525b]',
          badgeBorder: 'border-transparent',
        };
      }
      const isBuild = name.includes('构建') || cmd.includes('build');
      if (isBuild) {
        return {
          label: '构建',
          icon: <Boxes size={11} className="text-[#52525b]" />,
          badgeBg: 'bg-[#f4f4f5]',
          badgeText: 'text-[#52525b]',
          badgeBorder: 'border-transparent',
        };
      }
    }
    switch (type) {
      case 'agent':
        return {
          label: 'Agent',
          icon: <Bot size={11} className="text-[#52525b]" />,
          badgeBg: 'bg-[#f4f4f5]',
          badgeText: 'text-[#52525b]',
          badgeBorder: 'border-transparent',
        };
      case 'midscene':
        return {
          label: 'Midscene',
          icon: <Target size={11} className="text-[#52525b]" />,
          badgeBg: 'bg-[#f4f4f5]',
          badgeText: 'text-[#52525b]',
          badgeBorder: 'border-transparent',
        };
      case 'stitch-image':
        return {
          label: '动图',
          icon: <FileVideo size={11} className="text-[#52525b]" />,
          badgeBg: 'bg-[#f4f4f5]',
          badgeText: 'text-[#52525b]',
          badgeBorder: 'border-transparent',
        };
      case 'hook':
        return {
          label: 'Hook',
          icon: <Zap size={11} className="text-[#52525b]" />,
          badgeBg: 'bg-[#f4f4f5]',
          badgeText: 'text-[#52525b]',
          badgeBorder: 'border-transparent',
        };
      case 'qa-approval':
        return {
          label: 'QA门禁',
          icon: <CheckSquare size={11} className="text-[#52525b]" />,
          badgeBg: 'bg-[#f4f4f5]',
          badgeText: 'text-[#52525b]',
          badgeBorder: 'border-transparent',
        };
      case 'cli':
        return {
          label: 'CLI脚本',
          icon: <Terminal size={11} className="text-[#52525b]" />,
          badgeBg: 'bg-[#f4f4f5]',
          badgeText: 'text-[#52525b]',
          badgeBorder: 'border-transparent',
        };
      default:
        return {
          label: '扩展',
          icon: <Boxes size={11} className="text-[#52525b]" />,
          badgeBg: 'bg-[#f4f4f5]',
          badgeText: 'text-[#52525b]',
          badgeBorder: 'border-transparent',
        };
    }
  };

  // 工作流图标配置 (Markdown 流水线统一使用文档图标)
  const getWorkflowVisual = (wf: WorkflowDefinition) => {
    const nodeTypes = new Set(wf.nodes.map((n) => n.type));
    const iconClass = 'text-[#52525b] group-hover:text-[#18181b] transition-colors';
    let icon = <Workflow size={15} strokeWidth={1.8} className={iconClass} />;

    if (wf.markdown) {
      icon = <FileText size={15} strokeWidth={1.8} className={iconClass} />;
    } else if (nodeTypes.has('agent')) {
      icon = <Bot size={15} strokeWidth={1.8} className={iconClass} />;
    } else if (nodeTypes.has('midscene')) {
      icon = <Target size={15} strokeWidth={1.8} className={iconClass} />;
    } else if (wf.name.includes('部署') || wf.id.includes('deploy')) {
      icon = <Rocket size={15} strokeWidth={1.8} className={iconClass} />;
    } else if (nodeTypes.has('qa-approval')) {
      icon = <CheckSquare size={15} strokeWidth={1.8} className={iconClass} />;
    }

    return {
      icon,
      bg: 'bg-[#f4f4f5] group-hover:bg-[#ebebee]',
      border: 'border-[#e4e4e7]',
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

        // 标签筛选
        if (selectedTag !== 'all') {
          if (!w.tags || !w.tags.includes(selectedTag)) {
            return false;
          }
        }

        // 关键词筛选 (匹配名称、ID、描述、节点名、分类标签)
        if (!searchTerm) return true;
        const kw = searchTerm.toLowerCase();
        return (
          w.name.toLowerCase().includes(kw) ||
          w.id.toLowerCase().includes(kw) ||
          (w.description && w.description.toLowerCase().includes(kw)) ||
          (w.markdown && w.markdown.toLowerCase().includes(kw)) ||
          w.nodes.some((n) => n.name.toLowerCase().includes(kw)) ||
          (w.tags && w.tags.some((t) => t.toLowerCase().includes(kw)))
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
  }, [workflows, searchTerm, pinnedIds, sortBy, filterCategory, selectedTag]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setLoading(true);
    try {
      const id = `wf_${Date.now().toString(36)}`;
      const newWf: WorkflowDefinition = {
        id,
        name: newTitle.trim(),
        description: newDesc.trim() || 'Markdown 流水线',
        tags: newTags,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodes: [],
        edges: [],
        markdown: markdownTemplate(newTitle.trim()),
      };

      await api.saveWorkflow(newWf);
      setIsCreateModalOpen(false);
      setNewTitle('');
      setNewDesc('');
      setNewTags([]);
      toast.success(`流程「${newTitle.trim()}」创建成功`);
      onRefresh();
      // 新建后直接进入流程文档编辑页
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

  /** 打开流水线：统一进入流程文档编辑页，画布已下线 */
  const openWorkflow = (wf: WorkflowDefinition) => {
    if (import.meta.env?.DEV) {
      console.log('[WorkflowListView] 打开流水线编辑页:', wf.id, {
        markdownBytes: (wf.markdown || '').length,
      });
    }
    onSelectWorkflow(wf.id);
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
        triggerSource: 'debug',
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
      tags: wf.tags ? [...wf.tags] : [],
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

  const hasRunningTasks = useMemo(() => {
    return tasks.some((t) => t.status === 'running');
  }, [tasks]);

  const executionTasksCount = useMemo(() => {
    return tasks.filter((task) => {
      const hasNodeRuns = task.nodeRuns && Object.keys(task.nodeRuns).length > 0;
      if (hasNodeRuns) return true;
      if (
        task.status === 'running' ||
        task.status === 'completed' ||
        task.status === 'failed' ||
        task.status === 'cancelled'
      ) {
        return true;
      }
      if (
        task.triggerSource === 'shortcut' ||
        task.triggerSource === 'debug' ||
        task.triggerSource === 'api'
      ) {
        return true;
      }
      return false;
    }).length;
  }, [tasks]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-hidden select-none">
      {/* 顶部主子标签栏 (对齐 openLoop 极简设计系统与 QA 模块) */}
      <div className="px-6 pt-3 pb-1 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-[#ececf0] p-0.5 rounded-[7px] border border-[#e3e3e8]/70">
          <button
            type="button"
            onClick={() => handleSubTabChange('workflows')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[11.5px] font-medium transition-all cursor-pointer ${
              activeSubTab === 'workflows'
                ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                : 'text-[#63636b] hover:text-[#1c1c21]'
            }`}
          >
            <Workflow size={13} className={activeSubTab === 'workflows' ? 'text-[#1c1c21]' : 'text-[#85858d]'} />
            <span>流水线编排</span>
            <span className="text-[10px] font-mono px-1.5 py-[0.5px] rounded bg-black/5 text-[#63636b]">
              {workflows.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSubTabChange('runs')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[11.5px] font-medium transition-all cursor-pointer ${
              activeSubTab === 'runs'
                ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                : 'text-[#63636b] hover:text-[#1c1c21]'
            }`}
          >
            <History size={13} className={activeSubTab === 'runs' ? 'text-[#1c1c21]' : 'text-[#85858d]'} />
            <span>执行调用记录</span>
            <span className="text-[10px] font-mono px-1.5 py-[0.5px] rounded bg-black/5 text-[#63636b]">
              {executionTasksCount}
            </span>
            {hasRunningTasks && (
              <span className="relative flex h-2 w-2 ml-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
            )}
          </button>
        </div>

        {activeSubTab === 'workflows' && (
          <div className="flex items-center gap-2">
            {/* 新建工作流按钮 */}
            <button
              type="button"
              onClick={() => {
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 点击新建工作流');
                setIsCreateModalOpen(true);
              }}
              className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs cursor-pointer"
            >
              <Plus size={13} strokeWidth={2.4} />
              <span>新建工作流</span>
            </button>
          </div>
        )}
      </div>

      {activeSubTab === 'runs' ? (
        <WorkflowExecutionHistoryView
          workflows={workflows}
          tasks={tasks}
          onRefresh={onRefresh}
          onSelectWorkflow={onSelectWorkflow}
          onOpenTaskLogs={onOpenTaskLogs}
          selectedTaskId={initialSelectedTaskId}
          filterWorkflowId={runsFilterWfId}
          onClearSelectedTask={onClearSelectedTask}
        />
      ) : (
        <>
          {/* 次级工具栏 (Sub-header) - 1:1 对齐任务看板极简规范 */}
          <div className="px-6 py-2 bg-transparent flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          {/* 分类快速筛选 Segmented Control */}
          <div className="flex items-center bg-[#ececf0]/90 p-0.5 rounded-[7px] text-[11.5px] border border-[#e3e3e8]/70">
            <button
              type="button"
              onClick={() => {
                setFilterCategory('all');
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 筛选分类: 全部');
              }}
              className={`px-2.5 py-1 rounded-[5px] font-medium transition-all cursor-pointer ${
                filterCategory === 'all'
                  ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              全部 {counts.all}
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterCategory('pinned');
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 筛选分类: 已置顶');
              }}
              className={`px-2.5 py-1 rounded-[5px] font-medium transition-all flex items-center gap-1 cursor-pointer ${
                filterCategory === 'pinned'
                  ? 'bg-white text-[#4f46e5] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <Pin size={9.5} className="rotate-45 fill-current" />
              已置顶 {counts.pinned}
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterCategory('agent');
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 筛选分类: 含 AI Agent');
              }}
              className={`px-2.5 py-1 rounded-[5px] font-medium transition-all flex items-center gap-1 cursor-pointer ${
                filterCategory === 'agent'
                  ? 'bg-white text-[#4f46e5] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <Bot size={11} />
              含 Agent {counts.agent}
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterCategory('qa');
                if (import.meta.env?.DEV) console.log('[WorkflowListView] 筛选分类: 含 QA 门禁');
              }}
              className={`px-2.5 py-1 rounded-[5px] font-medium transition-all flex items-center gap-1 cursor-pointer ${
                filterCategory === 'qa'
                  ? 'bg-white text-[#ea580c] shadow-2xs font-semibold'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <CheckSquare size={11} />
              含门禁 {counts.qa}
            </button>
          </div>

          {/* 标签专属快速筛选下拉 */}
          <div className="relative" ref={tagMenuRef}>
            <button
              type="button"
              onClick={() => setIsTagMenuOpen(!isTagMenuOpen)}
              className={`h-[28px] px-2.5 rounded-[6px] border text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer ${
                selectedTag !== 'all'
                  ? 'border-[#4f46e5] bg-[#eeedfd]/40 text-[#4f46e5]'
                  : 'border-[#e3e3e8] bg-white text-[#4b4b53] hover:text-[#1c1c21] hover:border-[#b9b9c2]'
              }`}
            >
              <TagIcon size={11} className={selectedTag !== 'all' ? 'text-[#4f46e5]' : 'text-[#85858d]'} />
              <span>{selectedTag === 'all' ? '全部标签' : `#${selectedTag}`}</span>
              {selectedTag !== 'all' && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTag('all');
                    if (import.meta.env?.DEV) console.log('[WorkflowListView] 清除标签筛选');
                  }}
                  className="w-3.5 h-3.5 rounded-full hover:bg-[#4f46e5]/10 flex items-center justify-center text-[#4f46e5] transition-colors ml-0.5"
                  title="清除标签筛选"
                >
                  <X size={9} strokeWidth={2.2} />
                </span>
              )}
              <ChevronDown size={10} className={`text-[#85858d] transition-transform ${isTagMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {isTagMenuOpen && (
              <div className="absolute left-0 top-[calc(100%+4px)] w-48 bg-white border border-[#e3e3e8] rounded-[8px] p-1 shadow-[0_8px_20px_rgba(0,0,0,0.08)] z-30 animate-in fade-in zoom-in-95 duration-100 text-[11.5px] max-h-64 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTag('all');
                    setIsTagMenuOpen(false);
                    if (import.meta.env?.DEV) console.log('[WorkflowListView] 标签筛选: 全部');
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors cursor-pointer ${
                    selectedTag === 'all'
                      ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                      : 'text-[#4b4b53] hover:bg-[#f4f4f6]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <TagsIcon size={11} className="text-[#85858d]" />
                    <span>全部标签</span>
                  </span>
                  <span className="text-[10px] text-[#85858d] font-mono">{workflows.length}</span>
                </button>

                {allAvailableTags.length > 0 && <div className="h-[1px] bg-[#f1f1f4] my-1" />}

                {allAvailableTags.map(({ name: tag, count }) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      setSelectedTag(tag);
                      setIsTagMenuOpen(false);
                      if (import.meta.env?.DEV) console.log('[WorkflowListView] 标签筛选:', tag);
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors cursor-pointer ${
                      selectedTag === tag
                        ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                        : 'text-[#4b4b53] hover:bg-[#f4f4f6]'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <TagIcon size={10.5} className={selectedTag === tag ? 'text-[#4f46e5]' : 'text-[#85858d]'} />
                      <span className="truncate">#{tag}</span>
                    </span>
                    <span className="text-[10px] font-mono text-[#85858d] ml-1">{count}</span>
                  </button>
                ))}

                {allAvailableTags.length === 0 && (
                  <div className="px-2 py-2 text-[11px] text-[#85858d] text-center italic">
                    暂无流水线标签
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 搜索框 */}
          <div className="relative w-64">
            <Search size={12} className="absolute left-2.5 top-2 text-[#85858d]" />
            <input
              type="text"
              placeholder="搜索流程名称、描述或 ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-[28px] pl-7 pr-7 bg-white border border-[#e3e3e8] rounded-[6px] text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-2xs focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-2 text-[#85858d] hover:text-[#1c1c21] transition-colors cursor-pointer"
                title="清空搜索"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* 右侧：排序 + 视图切换 + 分割线 + 新建工作流 */}
        <div className="flex items-center gap-2">
          {/* 排序方式选择下拉 */}
          <div className="relative" ref={sortMenuRef}>
            <button
              type="button"
              onClick={() => setIsSortOpen(!isSortOpen)}
              className={`h-[28px] px-2.5 rounded-[6px] border text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer ${
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
              <ChevronDown size={10} className={`text-[#85858d] transition-transform ${isSortOpen ? 'rotate-180' : ''}`} />
            </button>

            {isSortOpen && (
              <div className="absolute right-0 top-[calc(100%+4px)] w-32 bg-white border border-[#e3e3e8] rounded-[8px] p-1 shadow-[0_8px_20px_rgba(0,0,0,0.08)] z-30 animate-in fade-in zoom-in-95 duration-100 text-[11.5px]">
                <button
                  type="button"
                  onClick={() => handleSortChange('updated')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors cursor-pointer ${
                    sortBy === 'updated'
                      ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                      : 'text-[#4b4b53] hover:bg-[#f4f4f6]'
                  }`}
                >
                  <span>最近更新</span>
                  {sortBy === 'updated' && <Check size={11} strokeWidth={2.4} />}
                </button>
                <button
                  type="button"
                  onClick={() => handleSortChange('created')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors cursor-pointer ${
                    sortBy === 'created'
                      ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                      : 'text-[#4b4b53] hover:bg-[#f4f4f6]'
                  }`}
                >
                  <span>创建时间</span>
                  {sortBy === 'created' && <Check size={11} strokeWidth={2.4} />}
                </button>
                <button
                  type="button"
                  onClick={() => handleSortChange('name')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors cursor-pointer ${
                    sortBy === 'name'
                      ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                      : 'text-[#4b4b53] hover:bg-[#f4f4f6]'
                  }`}
                >
                  <span>名称 A-Z</span>
                  {sortBy === 'name' && <Check size={11} strokeWidth={2.4} />}
                </button>
                <button
                  type="button"
                  onClick={() => handleSortChange('nodes')}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[5px] text-left transition-colors cursor-pointer ${
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
              type="button"
              onClick={() => handleViewModeChange('list')}
              title="紧凑列表视图"
              className={`w-[26px] h-[24px] rounded-[4px] flex items-center justify-center transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white text-[#1c1c21] shadow-2xs'
                  : 'hover:text-[#1c1c21]'
              }`}
            >
              <List size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange('grid')}
              title="卡片网格视图"
              className={`w-[26px] h-[24px] rounded-[4px] flex items-center justify-center transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white text-[#1c1c21] shadow-2xs'
                  : 'hover:text-[#1c1c21]'
              }`}
            >
              <LayoutGrid size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* 流程展示区 (与看板完全一致的对称边距) */}
      <div className="px-6 pb-6 pt-1 flex-1 overflow-y-auto">
        {filteredWorkflows.length === 0 ? (
          <div className="bg-white border border-[#e3e3e8] rounded-[12px] p-16 text-center shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-[12px] bg-[#f4f4f7] border border-[#ececf0] flex items-center justify-center text-[#85858d] mb-3 shadow-inner">
              <Workflow size={22} strokeWidth={1.8} />
            </div>
            <div className="text-[14px] font-semibold text-[#1c1c21]">
              {searchTerm || filterCategory !== 'all' || selectedTag !== 'all' ? '未匹配到符合条件的工作流' : '暂无自动化流水线'}
            </div>
            <p className="text-[12px] text-[#85858d] mt-1 max-w-sm">
              {searchTerm || filterCategory !== 'all' || selectedTag !== 'all'
                ? '可以尝试更换筛选条件、清除标签或清空搜索关键词'
                : '点击右上角“新建工作流”基于 DAG 节点自由连线编排'}
            </p>
            {searchTerm || filterCategory !== 'all' || selectedTag !== 'all' ? (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setFilterCategory('all');
                  setSelectedTag('all');
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
          /* 极致优雅表格视图 (1:1 借鉴执行调用记录规范，表头对齐、秩序井然) */
          <div className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden flex flex-col">
            {/* 表头 */}
            <div className="h-[34px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center text-[11px] font-medium text-[#85858d] select-none">
              <div className="flex-1 min-w-0">流水线名称</div>
              <div className="w-[200px] shrink-0">标签</div>
              <div className="w-[90px] shrink-0 text-right">更新时间</div>
              <div className="w-[110px] shrink-0 text-center">操作</div>
            </div>

            {/* 列表行 */}
            <div className="divide-y divide-[#f1f1f4]">
              {filteredWorkflows.map((wf) => {
                const isPinned = pinnedIds.includes(wf.id);
                const friendlyTime = formatFriendlyTime(wf.updatedAt || wf.createdAt);
                const hasTemplate = Boolean(
                  wf.taskTemplate?.descriptionTemplate || wf.taskTemplate?.acceptanceTemplate
                );

                return (
                  <div
                    key={wf.id}
                    onClick={() => {
                      if (import.meta.env?.DEV) {
                        console.log('[WorkflowListView] 打开流程:', wf.id);
                      }
                      openWorkflow(wf);
                    }}
                    className="group px-4 py-2.5 flex items-center text-[12px] transition-colors cursor-pointer hover:bg-[#fafafc]"
                  >
                    {/* 流水线名称 */}
                    <div className="flex-1 min-w-0 flex items-center gap-2 pr-3">
                      <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] group-hover:bg-white flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60 transition-colors">
                        <Workflow size={11} />
                      </div>
                      {isPinned && (
                        <span title="已置顶" className="shrink-0 flex items-center">
                          <Pin
                            size={10}
                            className="text-[#3b82f6] fill-current rotate-45"
                          />
                        </span>
                      )}
                      <span
                        className="font-medium text-[#1c1c21] truncate hover:text-[#4f46e5] transition-colors"
                        title={wf.name}
                      >
                        {wf.name}
                      </span>
                      {hasTemplate && (
                        <span
                          className="w-4 h-4 rounded-[3px] bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center shrink-0 border border-[#d8d6fb]/60"
                          title="已自定义配置任务说明与提示词模板"
                        >
                          <FileText size={9} />
                        </span>
                      )}
                    </div>

                    {/* 分类标签微徽章 */}
                    <div className="w-[200px] shrink-0 flex items-center gap-1 overflow-hidden pr-2">
                      {wf.tags && wf.tags.length > 0 ? (
                        <div className="flex items-center gap-1 flex-nowrap min-w-0 overflow-hidden">
                          {wf.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = selectedTag === tag ? 'all' : tag;
                                setSelectedTag(next);
                                if (import.meta.env?.DEV) {
                                  console.log('[WorkflowListView] 点击微标切换标签筛选:', next);
                                }
                              }}
                              className={`inline-flex items-center gap-0.5 min-w-0 px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium border transition-colors cursor-pointer ${
                                selectedTag === tag
                                  ? 'bg-[#eeedfd] text-[#4f46e5] border-[#d8d6fb]'
                                  : 'bg-[#f4f4f6] text-[#52525b] border-[#e3e3e8]/70 hover:bg-[#ececf0] hover:text-[#1c1c21]'
                              }`}
                              title={`点击筛选标签: #${tag}`}
                            >
                              <TagIcon size={9} className="shrink-0 opacity-70" />
                              <span className="truncate max-w-[56px]">{tag}</span>
                            </span>
                          ))}
                          {wf.tags.length > 2 && (
                            <span
                              className="text-[9.5px] font-mono text-[#85858d] bg-[#f4f4f6] px-1 py-0.5 rounded shrink-0 border border-[#e3e3e8]/50"
                              title={wf.tags.slice(2).join(', ')}
                            >
                              +{wf.tags.length - 2}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#b9b9c2] select-none">-</span>
                      )}
                    </div>

                    {/* 更新时间 */}
                    <div
                      className="w-[90px] shrink-0 text-right text-[11px] text-[#85858d]"
                      title={new Date(wf.updatedAt || wf.createdAt).toLocaleString()}
                    >
                      {friendlyTime}
                    </div>

                    {/* 操作区 */}
                    <div
                      className="w-[110px] shrink-0 flex items-center justify-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 调试运行 */}
                      <button
                        type="button"
                        onClick={(e) => handleRunWorkflow(e, wf)}
                        title="启动测试运行"
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-all cursor-pointer"
                      >
                        <Play size={11} className="fill-current text-[#4f46e5]" />
                      </button>

                      {/* 执行记录 */}
                      <button
                        type="button"
                        onClick={(e) => handleViewRunsOfWorkflow(e, wf.id)}
                        title="查看流水线执行记录"
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
                      >
                        <History size={12} />
                      </button>

                      {/* 更多管理操作下拉菜单 */}
                      <div
                        className="relative"
                        ref={actionMenu?.wfId === wf.id ? actionMenuRef : null}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (actionMenu?.wfId === wf.id) {
                              setActionMenu(null);
                              return;
                            }
                            const rect = e.currentTarget.getBoundingClientRect();
                            const openUp =
                              rect.bottom + ACTION_MENU_HEIGHT + 4 > window.innerHeight;
                            setActionMenu({
                              wfId: wf.id,
                              right: window.innerWidth - rect.right,
                              top: openUp
                                ? rect.top - ACTION_MENU_HEIGHT - 4
                                : rect.bottom + 4,
                            });
                          }}
                          title="更多操作"
                          className={`w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer ${
                            actionMenu?.wfId === wf.id ? 'bg-[#ececf0] text-[#1c1c21]' : ''
                          }`}
                        >
                          <MoreHorizontal size={12} />
                        </button>

                        {actionMenu?.wfId === wf.id &&
                          createPortal(
                            <div
                              ref={actionMenuPanelRef}
                              style={{ right: actionMenu.right, top: actionMenu.top }}
                              className="fixed z-[90] w-[120px] bg-white border border-[#e3e3e8] rounded-[6px] shadow-[0_8px_20px_rgba(0,0,0,0.08)] py-1 text-[11.5px] animate-in fade-in zoom-in-95 duration-100"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  handleTogglePin(e, wf);
                                  setActionMenu(null);
                                }}
                                className="w-full px-2.5 py-1.5 flex items-center gap-2 text-[#52525b] hover:text-[#1c1c21] hover:bg-[#f4f4f5] text-left transition-colors cursor-pointer"
                              >
                                <Pin
                                  size={11.5}
                                  className={
                                    isPinned ? 'rotate-45 text-[#3b82f6] fill-current' : ''
                                  }
                                />
                                <span>{isPinned ? '取消置顶' : '固定置顶'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  handleDuplicateWorkflow(e, wf);
                                  setActionMenu(null);
                                }}
                                disabled={duplicatingId === wf.id}
                                className="w-full px-2.5 py-1.5 flex items-center gap-2 text-[#52525b] hover:text-[#18181b] hover:bg-[#f4f4f5] text-left transition-colors cursor-pointer"
                              >
                                {duplicatingId === wf.id ? (
                                  <Loader2 size={11.5} className="animate-spin text-[#4f46e5]" />
                                ) : (
                                  <Copy size={11.5} />
                                )}
                                <span>克隆流程</span>
                              </button>

                              <div className="h-[1px] bg-[#f4f4f5] my-1" />

                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteTargetWf(wf);
                                  setActionMenu(null);
                                }}
                                className="w-full px-2.5 py-1.5 flex items-center gap-2 text-[#dc2626] hover:bg-[#fef2f2] text-left transition-colors cursor-pointer"
                              >
                                <Trash2 size={11.5} />
                                <span>删除流程</span>
                              </button>
                            </div>,
                            document.body
                          )}
                      </div>

                      {/* 进入画布 */}
                      <button
                        type="button"
                        onClick={() => openWorkflow(wf)}
                        title={wf.markdown ? '编辑流水线' : '进入流程画布编辑'}
                        className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-all cursor-pointer"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* 卡片网格视图 */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
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
                      console.log('[WorkflowListView] 打开流程:', wf.id);
                    }
                    openWorkflow(wf);
                  }}
                  className={`bg-white border rounded-[12px] p-4 flex flex-col justify-between transition-all duration-200 cursor-pointer group shadow-2xs hover:shadow-[0_8px_20px_rgba(20,22,30,0.06)] hover:-translate-y-0.5 ${
                    isPinned
                      ? 'border-[#d8d6fb] bg-[#fbfbfe] hover:border-[#4f46e5]/40'
                      : 'border-[#e3e3e8] hover:border-[#b9b9c2]'
                  }`}
                >
                  <div>
                    {/* 卡片头部：左侧图标 + 置顶微标，右侧悬浮动作 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-8 h-8 rounded-[6px] border flex items-center justify-center shrink-0 transition-colors ${visual.bg} ${visual.border}`}
                        >
                          {visual.icon}
                        </div>
                        {isPinned && (
                          <span title="已置顶" className="shrink-0 flex items-center">
                            <Pin size={11} className="text-[#3b82f6] fill-current rotate-45" />
                          </span>
                        )}
                      </div>

                      {/* 卡片右上角操作 */}
                      <div
                        className="flex items-center gap-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => handleTogglePin(e, wf)}
                          title={isPinned ? '取消置顶' : '固定在顶部'}
                          className={`w-[24px] h-[24px] rounded-[5px] flex items-center justify-center transition-all cursor-pointer ${
                            isPinned
                              ? 'text-[#3b82f6] hover:bg-[#eff6ff]'
                              : 'text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#18181b] opacity-0 group-hover:opacity-100'
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
                          type="button"
                          onClick={() => openWorkflow(wf)}
                          title="编辑步骤与信息"
                          className="w-[24px] h-[24px] rounded-[5px] flex items-center justify-center text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#18181b] opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          <Edit3 size={11} />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => handleDuplicateWorkflow(e, wf)}
                          title="复制流程"
                          disabled={duplicatingId === wf.id}
                          className="w-[24px] h-[24px] rounded-[5px] flex items-center justify-center text-[#71717a] hover:bg-[#f4f4f5] hover:text-[#18181b] opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {duplicatingId === wf.id ? (
                            <Loader2 size={11} className="animate-spin text-[#4f46e5]" />
                          ) : (
                            <Copy size={11} />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeleteTargetWf(wf)}
                          title="删除流程"
                          className="w-[24px] h-[24px] rounded-[5px] flex items-center justify-center text-[#71717a] hover:bg-[#fef2f2] hover:text-[#dc2626] opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    {/* 流程名称 (全宽展示，绝不狭窄截断) */}
                    <h3
                      className="font-medium text-[13px] text-[#18181b] group-hover:text-black transition-colors truncate leading-snug mt-2.5"
                      title={wf.name}
                    >
                      {wf.name}
                    </h3>

                    {/* 元数据行 */}
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-[#71717a] font-sans">
                      {(wf.taskTemplate?.descriptionTemplate || wf.taskTemplate?.acceptanceTemplate) && (
                        <>
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] text-[#4f46e5] bg-[#eeedfd] px-1.5 py-[0.5px] rounded-[3px] border border-[#d8d6fb]/60 font-medium"
                            title="已自定义配置任务说明与提示词模板"
                          >
                            <FileText size={8.5} />
                            <span>已设模板</span>
                          </span>
                          <span className="text-[#d4d4d8]">·</span>
                        </>
                      )}
                      <span className="flex items-center gap-1 whitespace-nowrap" title={new Date(wf.updatedAt || wf.createdAt).toLocaleString()}>
                        {friendlyTime}
                      </span>
                    </div>

                    {/* 标签微徽章列表 */}
                    {wf.tags && wf.tags.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-2">
                        {wf.tags.map((tag) => (
                          <span
                            key={tag}
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = selectedTag === tag ? 'all' : tag;
                              setSelectedTag(next);
                              if (import.meta.env?.DEV) {
                                console.log('[WorkflowListView] 卡片点击标签筛选:', next);
                              }
                            }}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium border transition-colors cursor-pointer ${
                              selectedTag === tag
                                ? 'bg-[#eeedfd] text-[#4f46e5] border-[#d8d6fb]'
                                : 'bg-[#f4f4f6] text-[#52525b] border-[#e3e3e8]/70 hover:bg-[#ececf0] hover:text-[#1c1c21]'
                            }`}
                            title={`点击筛选标签: #${tag}`}
                          >
                            <TagIcon size={9} className="opacity-70" />
                            <span>{tag}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 流程描述 */}
                    <p className="text-[12px] text-[#71717a] line-clamp-2 leading-relaxed min-h-[34px] mt-2">
                      {wf.description || '暂无流程描述，点击进入画布编辑'}
                    </p>

                    {/* DAG 流水线环节预览栏 (极简中性胶囊) */}
                    <div className="mt-3 p-2 rounded-[6px] bg-[#f9f9fb] border border-[#f0f0f3]">
                      <div className="flex items-center gap-1 overflow-hidden font-sans">
                        {pipelineSteps.slice(0, 3).map((step, idx) => {
                          const meta = getNodeMeta(step.type, step);
                          return (
                            <React.Fragment key={step.id}>
                              {idx > 0 && <span className="text-[#d4d4d8] text-[9px]">→</span>}
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f5] text-[#52525b] text-[10px] font-medium shrink-0"
                                title={`${step.name} (${meta.label})`}
                              >
                                {meta.label}
                              </span>
                            </React.Fragment>
                          );
                        })}
                        {pipelineSteps.length > 3 && (
                          <span
                            className="text-[9.5px] font-mono text-[#a1a1aa] bg-[#f4f4f5] px-1 py-0.5 rounded shrink-0"
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
                    className="border-t border-[#f4f4f7] pt-2.5 mt-2.5 flex items-center justify-end gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => handleViewRunsOfWorkflow(e, wf.id)}
                      title="查看此工作流的历史与快捷键执行记录"
                      className="h-[25px] px-2 rounded-[4px] bg-[#f4f4f5] hover:bg-[#ebebee] text-[#52525b] hover:text-[#18181b] text-[11px] font-medium flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                    >
                      <History size={11} className="text-[#71717a]" />
                      <span>记录</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleRunWorkflow(e, wf)}
                      title="启动测试运行与验证任务"
                      className="h-[25px] px-2 rounded-[4px] bg-[#f4f4f5] hover:bg-[#ebebee] text-[#18181b] text-[11px] font-medium flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                    >
                      <Play size={10} className="fill-current text-[#4f46e5]" />
                      <span>调试</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openWorkflow(wf)}
                      title={wf.markdown ? '编辑流水线' : '进入 DAG 可视化连线画布'}
                      className="h-[25px] px-2.5 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-xs cursor-pointer"
                    >
                      <span>编辑</span>
                      <ChevronRight size={10} className="text-white/70" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}

      {/* 新建工作流弹窗 */}
      {isCreateModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100"
          onClick={() => {
            if (!loading) {
              if (import.meta.env?.DEV) {
                console.log('[WorkflowListView] 点击蒙层关闭新建工作流弹窗');
              }
              setIsCreateModalOpen(false);
              setNewTitle('');
              setNewDesc('');
              setNewTags([]);
            }
          }}
        >
          <div
            className="w-[460px] bg-white border border-[#e3e3e8] rounded-[12px] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.16)] text-[#1c1c21]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#ececf0]">
              <div>
                <h3 className="font-semibold text-[14px] text-[#1c1c21]">新建自动化流程</h3>
                <p className="text-[11.5px] text-[#85858d] mt-0.5">
                  用自然语言写流程文档，编排 Agent 按文档逐步执行
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
                <label className="block font-medium text-[#4b4b53] mb-1">流水线分类标签</label>
                <TagInput
                  tags={newTags}
                  onChange={setNewTags}
                  placeholder="添加标签（例如：工作、部署、QA）后回车..."
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#ececf0]">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setNewTitle('');
                    setNewDesc('');
                    setNewTags([]);
                  }}
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
