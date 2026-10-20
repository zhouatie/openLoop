import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Play,
  Workflow,
  ChevronDown,
  Check,
  Bot,
  Target,
  Sparkles,
  Layers,
  ArrowRight,
  Inbox,
  ListTodo,
  Clock,
  Search,
  Loader2,
  Plus,
} from 'lucide-react';
import type { WorkflowDefinition, NodeType, KanbanColumn, TaskAttachment } from '@openloop/core';
import { WorkflowRecommender } from '../utils/workflowRecommender';
import { WorkspacePicker } from './WorkspacePicker';
import { TaskPromptArea } from './TaskPromptArea';
import { toast } from './Toast';
import { api } from '../services/api';

const STORAGE_KEY_LAST_WORKFLOW = 'openloop_last_used_workflow_id';
const STORAGE_KEY_RECENT_WORKFLOWS = 'openloop_recent_workflow_ids';
const STORAGE_KEY_LAST_WORKSPACE = 'openloop_last_used_workspace';
const MAX_RECENT_COUNT = 3;

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflows: WorkflowDefinition[];
  defaultColumn?: KanbanColumn;
  defaultWorkspace?: string;
  onCreate: (params: {
    title: string;
    workflowId: string;
    description: string;
    acceptanceCriteria?: string;
    autoRun: boolean;
    kanbanColumn?: KanbanColumn;
    workspace?: string;
    attachments?: TaskAttachment[];
    kind?: 'single' | 'group' | 'subtask';
    executionMode?: 'serial' | 'parallel' | 'dag';
    concurrencyLimit?: number;
    autoDecompose?: boolean;
    subtasks?: Array<{ id?: string; title: string; workflowId?: string; description?: string; dependencies?: string[] }>;
  }) => Promise<void>;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  workflows,
  defaultColumn = 'backlog',
  defaultWorkspace,
  onCreate,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [isCriteriaOpen, setIsCriteriaOpen] = useState(false);
  const [isGeneratingQa, setIsGeneratingQa] = useState(false);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [workflowId, setWorkflowId] = useState(workflows[0]?.id || '');
  const [kanbanColumn, setKanbanColumn] = useState<KanbanColumn>(defaultColumn);
  const [workspace, setWorkspace] = useState('');
  const [autoRun, setAutoRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [workflowSearch, setWorkflowSearch] = useState('');
  
  // AI 自主工序编排与流水线推荐状态
  const [autoDecompose, setAutoDecompose] = useState(true);
  const [userManuallySelectedWf, setUserManuallySelectedWf] = useState(false);

  // 毫秒级根据用户键入的任务标题计算流水线推荐 (只依赖 title 与 workspace，绝不依赖 description 模板)
  const recommendations = useMemo(() => {
    return WorkflowRecommender.recommend(workflows, {
      title,
      workspace,
    });
  }, [workflows, title, workspace]);

  const topRecommendation = recommendations[0] || null;

  const [recentWorkflowIds, setRecentWorkflowIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RECENT_WORKFLOWS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastAutoTemplateRef = useRef<string>('');
  const lastAutoAcceptanceRef = useRef<string>('');

  const currentWf = useMemo(
    () => workflows.find((w) => w.id === workflowId) || workflows[0],
    [workflows, workflowId]
  );

  const isCurrentWfWsRequired = Boolean(
    currentWf?.requireWorkspace ||
    currentWf?.nodes?.some((node) => {
      if (node.config?.requireWorkspace) return true;
      if (node.type === 'cli') {
        const cmd = node.config?.command?.toLowerCase() || '';
        const hasGit = cmd.includes('git commit') || cmd.includes('git push') || cmd.includes('git add');
        const hasBuild = cmd.includes('pnpm') || cmd.includes('npm run') || cmd.includes('yarn') || cmd.includes('mvn') || cmd.includes('gradle');
        return (hasGit || hasBuild) && !node.config?.cwd;
      }
      return false;
    })
  );

  // 弹窗打开或 workflows 变更时，优先恢复本地上次使用的流程与工作区记忆
  useEffect(() => {
    if (!isOpen) return;

    // 工作区：如果外部指定了默认工程 (如当前看板过滤了该项目)，优先自动填充；否则从本地记忆恢复
    if (defaultWorkspace) {
      setWorkspace(defaultWorkspace);
      if (import.meta.env?.DEV) {
        console.log('[CreateTaskModal] 采用当前看板过滤项目作为默认工作区:', defaultWorkspace);
      }
    } else {
      try {
        const lastWs = localStorage.getItem(STORAGE_KEY_LAST_WORKSPACE);
        if (lastWs) {
          setWorkspace(lastWs);
          if (import.meta.env?.DEV) {
            console.log('[CreateTaskModal] 从本地记忆回填上次使用的工作区:', lastWs);
          }
        }
      } catch (err) {
        console.warn('[CreateTaskModal] 读取工作区历史记忆失败:', err);
      }
    }

    try {
      const lastId = localStorage.getItem(STORAGE_KEY_LAST_WORKFLOW);
      if (lastId && workflows.some((w) => w.id === lastId)) {
        setWorkflowId(lastId);
        if (import.meta.env?.DEV) {
          console.log('[CreateTaskModal] 从本地记忆回填上次使用的工作流:', lastId);
        }
        return;
      }
    } catch (err) {
      console.warn('[CreateTaskModal] 读取流程历史记忆失败:', err);
    }

    if (workflows.length > 0 && !workflows.some((w) => w.id === workflowId)) {
      setWorkflowId(workflows[0].id);
    }
  }, [isOpen, workflows, defaultWorkspace]);

  // 确保当 workflows 变更或加载时根据 defaultColumn 重置
  useEffect(() => {
    if (isOpen) {
      setKanbanColumn(defaultColumn);
      if (defaultColumn === 'inbox') {
        setAutoRun(false);
      }
    }
  }, [isOpen, defaultColumn]);

  // 响应 workflow 切换，智能自动填充模板
  useEffect(() => {
    if (!isOpen || !currentWf) return;

    const tplDesc = currentWf.taskTemplate?.descriptionTemplate || '';
    const tplAcc = currentWf.taskTemplate?.acceptanceTemplate || '';

    // 描述框：如果当前为空，或等于上一个自动填充的模版，则无缝更新为当前流程的模版
    if (!description.trim() || description === lastAutoTemplateRef.current) {
      setDescription(tplDesc);
      lastAutoTemplateRef.current = tplDesc;
    }

    // 验收标准：如果当前为空，或等于上一个自动填充的模版
    if (!acceptanceCriteria.trim() || acceptanceCriteria === lastAutoAcceptanceRef.current) {
      setAcceptanceCriteria(tplAcc);
      lastAutoAcceptanceRef.current = tplAcc;
      if (tplAcc.trim()) {
        setIsCriteriaOpen(true);
      }
    }
  }, [workflowId, isOpen, currentWf]);

  // 按 Esc 键优先关闭下拉菜单，再关闭整个弹窗
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDropdownOpen) {
          setIsDropdownOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDropdownOpen, onClose]);

  // 点击外部收起下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  // 全量流程按最近更新时间倒序排列
  const allSortedWorkflows = useMemo(() => {
    return [...workflows].sort(
      (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
  }, [workflows]);

  // 最近使用的工作流（最多 3 个）
  const recentWorkflows = useMemo(() => {
    return recentWorkflowIds
      .map((id) => workflows.find((w) => w.id === id))
      .filter(Boolean) as WorkflowDefinition[];
  }, [recentWorkflowIds, workflows]);

  // 搜索过滤匹配的工作流
  const filteredWorkflows = useMemo(() => {
    if (!workflowSearch.trim()) return [];
    const keyword = workflowSearch.toLowerCase().trim();
    return allSortedWorkflows.filter(
      (w) =>
        w.name.toLowerCase().includes(keyword) ||
        w.id.toLowerCase().includes(keyword) ||
        (w.description && w.description.toLowerCase().includes(keyword)) ||
        (w.tags && w.tags.some((t) => t.toLowerCase().includes(keyword)))
    );
  }, [allSortedWorkflows, workflowSearch]);

  const handleSelectWorkflow = (wf: WorkflowDefinition) => {
    setWorkflowId(wf.id);
    setUserManuallySelectedWf(true);
    setIsDropdownOpen(false);
    setWorkflowSearch('');
    if (import.meta.env?.DEV) {
      console.log('[CreateTaskModal] 用户选定工作流:', { id: wf.id, name: wf.name });
    }
  };

  const renderWorkflowItem = (wf: WorkflowDefinition, isRecentBadge = false) => {
    const isSelected = wf.id === currentWf?.id;
    const isRecommended = topRecommendation?.workflowId === wf.id && topRecommendation.score >= 30;

    return (
      <div
        key={`${isRecentBadge ? 'recent-' : 'all-'}${wf.id}`}
        onClick={() => handleSelectWorkflow(wf)}
        className={`p-2.5 rounded-[7px] cursor-pointer transition-all flex items-start justify-between ${
          isSelected
            ? 'bg-[#eeedfd]/50 border border-[#d8d6fb]'
            : 'hover:bg-[#f9f9fb] border border-transparent'
        }`}
      >
        <div className="flex items-start gap-2.5 min-w-0 flex-1 pr-3">
          <div
            className={`w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0 mt-0.5 ${
              isSelected
                ? 'bg-[#4f46e5] text-white shadow-sm'
                : 'bg-[#f1f1f4] text-[#63636b]'
            }`}
          >
            <Workflow size={12} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium text-[12.5px] text-[#1c1c21] truncate">
                {wf.name}
              </span>
              <span className="text-[9.5px] font-mono text-[#85858d] bg-[#f4f4f6] px-1 py-[0.5px] rounded">
                {wf.id}
              </span>
              {isRecommended && (
                <span className="px-1.5 py-[0.5px] rounded-[3px] text-[9px] font-semibold bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb] shrink-0 flex items-center gap-0.5">
                  <Sparkles size={8.5} />
                  <span>AI 推荐</span>
                </span>
              )}
              {isRecentBadge && !isRecommended && (
                <span className="px-1.5 py-[0.5px] rounded-[3px] text-[9px] font-semibold bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb]/60 shrink-0">
                  Recent
                </span>
              )}
            </div>

            <div className="text-[11px] text-[#85858d] truncate mt-0.5">
              {wf.description || '无附加描述'}
            </div>

            {wf.tags && wf.tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap mt-1">
                {wf.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-0.5 px-1.5 py-[0.5px] rounded-[3px] bg-[#f4f4f6] text-[#52525b] text-[9.5px] border border-[#e3e3e8]/60 font-medium"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}

            {getNodeSummaryBadges(wf)}
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0 pt-0.5">
          <span className="text-[10.5px] font-mono text-[#85858d]">
            {wf.nodes.length} 节点
          </span>
          {isSelected && (
            <span className="mt-1 flex items-center gap-1 text-[10.5px] text-[#4f46e5] font-medium">
              <Check size={12} strokeWidth={2.4} />
              已选中
            </span>
          )}
        </div>
      </div>
    );
  };

  const handleGenerateQaPlan = async (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isGeneratingQa) return;

    setIsGeneratingQa(true);
    setIsCriteriaOpen(true);

    const trimmedWorkspace = workspace.trim();
    if (import.meta.env?.DEV) {
      console.log('[CreateTaskModal:AI QA] 开始根据标题与说明智能生成验收用例:', {
        title: trimmedTitle,
        description: description.trim(),
        workspace: trimmedWorkspace || undefined,
      });
    }

    try {
      const res = await api.generateQaPlan({
        title: trimmedTitle,
        description: description.trim() || undefined,
        workspace: trimmedWorkspace || undefined,
      });
      if (res && res.text) {
        setAcceptanceCriteria(res.text);
        if (import.meta.env?.DEV) {
          console.log('[CreateTaskModal:AI QA] 生成用例成功:', res);
        }
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[CreateTaskModal:AI QA] 生成用例异常:', err);
      }
    } finally {
      setIsGeneratingQa(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !workflowId) return;

    const trimmedWorkspace = workspace.trim();
    if (isCurrentWfWsRequired && !trimmedWorkspace) {
      alert('所选自动化流程包含本地工程代码操作，必须手动选择工程工作区目录');
      return;
    }

    setLoading(true);
    if (import.meta.env?.DEV) {
      console.log('[CreateTaskModal] 提交创建任务:', {
        title: title.trim(),
        workflowId,
        kanbanColumn,
        workspace: trimmedWorkspace || '未指定(留空)',
        acceptanceCriteria: acceptanceCriteria.trim() || undefined,
        autoRun,
        autoDecompose,
      });
    }
    try {
      await onCreate({
        title: title.trim(),
        workflowId,
        description: description.trim(),
        acceptanceCriteria: acceptanceCriteria.trim() || undefined,
        autoRun,
        kanbanColumn,
        workspace: trimmedWorkspace || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        kind: 'single',
        autoDecompose,
      });

      // 保存本地记忆与 LRU 最近使用列表
      try {
        localStorage.setItem(STORAGE_KEY_LAST_WORKFLOW, workflowId);
        const nextRecents = [
          workflowId,
          ...recentWorkflowIds.filter((id) => id !== workflowId),
        ].slice(0, MAX_RECENT_COUNT);
        localStorage.setItem(STORAGE_KEY_RECENT_WORKFLOWS, JSON.stringify(nextRecents));
        setRecentWorkflowIds(nextRecents);

        if (trimmedWorkspace) {
          localStorage.setItem(STORAGE_KEY_LAST_WORKSPACE, trimmedWorkspace);
        }

        if (import.meta.env?.DEV) {
          console.log('[CreateTaskModal] 更新工作流与工作区 LRU 历史记录:', {
            lastUsed: workflowId,
            recentWorkflows: nextRecents,
            lastWorkspace: trimmedWorkspace,
          });
        }
      } catch (storageErr) {
        console.warn('[CreateTaskModal] 保存本地流程记忆失败:', storageErr);
      }

      setTitle('');
      setDescription('');
      setAcceptanceCriteria('');
      setAttachments([]);
      setWorkflowSearch('');
      setIsDropdownOpen(false);
      lastAutoTemplateRef.current = '';
      lastAutoAcceptanceRef.current = '';
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const getNodeSummaryBadges = (wf: WorkflowDefinition) => {
    const types = Array.from(new Set(wf.nodes.map((n) => n.type)));
    return (
      <div className="flex items-center gap-1 mt-1">
        {types.slice(0, 4).map((t) => {
          let label = t;
          let color = 'bg-[#f1f1f4] text-[#4b4b53]';
          if (t === 'agent') {
            label = 'Agent';
            color = 'bg-[#eeedfd] text-[#4f46e5]';
          } else if (t === 'midscene') {
            label = 'Midscene';
            color = 'bg-[#e4f6ec] text-[#189a58]';
          } else if (t === 'qa-approval') {
            label = 'QA验收';
            color = 'bg-[#fbf0df] text-[#b45309]';
          }
          return (
            <span
              key={t}
              className={`px-1.5 py-[1px] rounded-[3px] text-[9.5px] font-medium ${color}`}
            >
              {label}
            </span>
          );
        })}
        {types.length > 4 && (
          <span className="text-[9.5px] text-[#85858d]">+{types.length - 4}</span>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100">
      <div className="w-[465px] max-h-[92vh] flex flex-col bg-white border border-[#e3e3e8] rounded-[10px] p-4 shadow-[0_16px_40px_rgba(20,22,30,0.14)] text-[#1c1c21] transition-all duration-200 overflow-hidden">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-2.5 border-b border-[#ececf0] shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[13px] text-[#1c1c21]">新建任务</h3>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-3 space-y-2.5 text-[11.5px] overflow-y-auto pr-1 flex-1">
          {/* 任务名称 */}
          <div>
            <label className="block text-[11px] font-medium text-[#63636b] mb-1">
              任务名称
            </label>
            <input
              type="text"
              required
              placeholder={
                currentWf?.taskTemplate?.titlePlaceholder || '例如: 购物车结算全链路回归与截图验收'
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all"
            />
          </div>

          {/* 关联工程工作区 (单行紧凑控件，默认最新选择，右侧访达与下拉) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-[#63636b] flex items-center gap-1.5">
                <span>工程工作区</span>
                {isCurrentWfWsRequired ? (
                  <span className="text-[9.5px] font-medium px-1 py-[0.5px] rounded bg-[#fee2e2] text-[#dc2626] border border-[#fecaca]">
                    * 必选
                  </span>
                ) : (
                  <span className="text-[10px] text-[#85858d] font-normal">(可选)</span>
                )}
              </label>
              <span className={`text-[10px] ${isCurrentWfWsRequired ? 'text-[#dc2626] font-medium' : 'text-[#85858d]'}`}>
                {workspace
                  ? '已关联独立工程'
                  : isCurrentWfWsRequired
                  ? '此流程必须手动选择工程根目录'
                  : '非必选；未关联时在独立沙箱执行'}
              </span>
            </div>
            <WorkspacePicker
              value={workspace}
              onChange={setWorkspace}
              placeholder={
                isCurrentWfWsRequired
                  ? '必须选择该任务执行所需的本地代码工程根目录...'
                  : '选择工程工作区 (点击下拉或右侧打开访达)...'
              }
            />
          </div>

          {/* 关联自动化流程 (单行紧凑下拉) */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <label className="text-[11px] font-medium text-[#63636b] shrink-0">关联自动化流程</label>
                {topRecommendation && topRecommendation.score >= 20 && topRecommendation.workflowId !== workflowId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setWorkflowId(topRecommendation.workflowId);
                      setUserManuallySelectedWf(true);
                      toast.success(`已切换为推荐流程: ${topRecommendation.workflowName}`);
                    }}
                    className="inline-flex items-center gap-1 text-[9.5px] font-medium text-[#4f46e5] bg-[#eeedfd] hover:bg-[#e0defc] border border-[#d8d6fb] px-1.5 py-[0.5px] rounded animate-fadeIn cursor-pointer shrink-0 truncate max-w-[240px] transition-colors"
                    title={`${topRecommendation.reason} (点击一键采纳此流程)`}
                  >
                    <Sparkles size={9} className="shrink-0" />
                    <span className="truncate">推荐: {topRecommendation.workflowName}</span>
                  </button>
                )}
              </div>
              {currentWf && (
                <span className="text-[10px] font-mono text-[#85858d] shrink-0">
                  {currentWf.nodes.length} 节点 · {currentWf.edges.length} 连线
                </span>
              )}
            </div>

            {/* 触发单行控件 */}
            <div
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`w-full h-[30px] px-2.5 rounded-[6px] border transition-all cursor-pointer flex items-center justify-between select-none ${
                isDropdownOpen
                  ? 'border-[#4f46e5] bg-white ring-1 ring-[#eeedfd] shadow-sm'
                  : 'border-[#e3e3e8] bg-[#f9f9fb] hover:bg-white hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.02)]'
              }`}
            >
              {currentWf ? (
                <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
                  <Workflow size={13} className="text-[#4f46e5] shrink-0" />
                  <span className="font-medium text-[12px] text-[#1c1c21] truncate max-w-[200px]">
                    {currentWf.name}
                  </span>
                  <span className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1 py-[0.5px] rounded shrink-0">
                    {currentWf.id}
                  </span>
                  {currentWf.tags && currentWf.tags.length > 0 && (
                    <span className="text-[9.5px] font-medium text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-1 py-[0.5px] rounded shrink-0">
                      #{currentWf.tags[0]}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-[#85858d] text-[11.5px]">请选择工作流</span>
              )}

              <ChevronDown
                size={12}
                className={`text-[#85858d] shrink-0 transition-transform duration-150 ${
                  isDropdownOpen ? 'rotate-180 text-[#4f46e5]' : ''
                }`}
              />
            </div>

            {/* 下拉弹出浮层 Popover */}
            {isDropdownOpen && (
              <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-[#e3e3e8] rounded-[8px] shadow-[0_10px_26px_rgba(20,22,30,0.12)] z-50 max-h-[250px] overflow-hidden flex flex-col p-1 animate-in fade-in zoom-in-95 duration-100">
                {/* 快速搜索栏 */}
                {workflows.length >= 3 && (
                  <div className="px-1 pt-0.5 pb-1 border-b border-[#ececf0] mb-1">
                    <div className="relative">
                      <Search
                        size={11.5}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-[#85858d]"
                      />
                      <input
                        type="text"
                        placeholder="搜索工作流..."
                        value={workflowSearch}
                        onChange={(e) => setWorkflowSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full h-[24px] bg-[#f4f4f6] focus:bg-white border border-transparent focus:border-[#4f46e5] rounded-[5px] pl-6 pr-2 text-[11px] text-[#1c1c21] placeholder-[#85858d] outline-none transition-all"
                      />
                    </div>
                  </div>
                )}

                {/* 滚动区域 */}
                <div className="overflow-y-auto space-y-1 flex-1 pr-0.5">
                  {workflowSearch.trim() ? (
                    <div>
                      <div className="px-2 py-0.5 text-[9.5px] font-semibold text-[#85858d] uppercase tracking-wider">
                        搜索结果 ({filteredWorkflows.length})
                      </div>
                      {filteredWorkflows.length === 0 ? (
                        <div className="py-4 text-center text-[11px] text-[#85858d]">
                          未找到匹配的工作流
                        </div>
                      ) : (
                        filteredWorkflows.map((wf) => renderWorkflowItem(wf))
                      )}
                    </div>
                  ) : (
                    <>
                      {/* 最近使用分区 */}
                      {recentWorkflows.length > 0 && (
                        <div className="space-y-0.5 mb-1">
                          <div className="px-2 pt-0.5 pb-0.5 flex items-center justify-between text-[9.5px] font-semibold text-[#85858d] uppercase tracking-wider">
                            <span className="flex items-center gap-1 text-[#4f46e5]">
                              <Clock size={10} /> 最近使用
                            </span>
                            <span className="text-[9px] font-normal lowercase text-[#85858d]">
                              LRU
                            </span>
                          </div>
                          {recentWorkflows.map((wf) => renderWorkflowItem(wf, true))}
                          <div className="h-[1px] bg-[#ececf0] my-1 mx-1.5" />
                        </div>
                      )}

                      {/* 全部流程分区 */}
                      <div className="space-y-0.5">
                        <div className="px-2 pt-0.5 pb-0.5 flex items-center justify-between text-[9.5px] font-semibold text-[#85858d] uppercase tracking-wider">
                          <span className="flex items-center gap-1">
                            <Layers size={10} className="text-[#85858d]" /> 全部流程 (
                            {allSortedWorkflows.length})
                          </span>
                        </div>
                        {allSortedWorkflows.map((wf) => renderWorkflowItem(wf))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 任务说明与提示词 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-[#63636b]">
                任务说明与提示词
              </label>
              {currentWf?.taskTemplate?.descriptionTemplate &&
                description.trim() !== currentWf.taskTemplate.descriptionTemplate.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setDescription(currentWf.taskTemplate!.descriptionTemplate!);
                      lastAutoTemplateRef.current = currentWf.taskTemplate!.descriptionTemplate!;
                      toast.success(`已套用「${currentWf.name}」专属模板`);
                    }}
                    className="text-[10px] text-[#4f46e5] hover:text-[#4338ca] hover:underline flex items-center gap-1 cursor-pointer font-medium"
                    title="将说明框重置为当前流水线的专属结构化模板"
                  >
                    <Sparkles size={10} />
                    <span>套用流程模板</span>
                  </button>
                )}
            </div>
            <TaskPromptArea
              value={description}
              onChange={setDescription}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              disabled={loading}
              rows={4}
            />
          </div>

          {/* 验收预期 / UI 自动化测试用例 (可选折叠区域) */}
          <div className="border border-[#e3e3e8] rounded-[6px] bg-[#fafafc] overflow-hidden">
            <div className="w-full px-3 py-1.5 flex items-center justify-between text-[11px] font-medium text-[#63636b] select-none">
              <div
                onClick={() => setIsCriteriaOpen(!isCriteriaOpen)}
                className="flex items-center gap-1.5 cursor-pointer hover:text-[#1c1c21] transition-colors flex-1 min-w-0"
              >
                <Target size={12} className="text-[#63636b] shrink-0" />
                <span className="truncate">验收预期 / UI 自动化用例 (可选)</span>
                {acceptanceCriteria.trim() && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#1c1c21] shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {currentWf?.taskTemplate?.acceptanceTemplate &&
                  acceptanceCriteria.trim() !== currentWf.taskTemplate.acceptanceTemplate.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setAcceptanceCriteria(currentWf.taskTemplate!.acceptanceTemplate!);
                        lastAutoAcceptanceRef.current = currentWf.taskTemplate!.acceptanceTemplate!;
                        setIsCriteriaOpen(true);
                        toast.success('已应用流程验收标准模板');
                      }}
                      className="h-[19px] px-1.5 rounded-[4px] bg-white hover:bg-[#eeedfd] text-[#63636b] hover:text-[#4f46e5] border border-[#e3e3e8] text-[9.5px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                    >
                      <Sparkles size={9} />
                      <span>套用验收模板</span>
                    </button>
                  )}
                <button
                  type="button"
                  onClick={handleGenerateQaPlan}
                  disabled={isGeneratingQa || !title.trim()}
                  className="h-[19px] px-2 rounded-[4px] bg-white hover:bg-[#eeedfd] text-[#63636b] hover:text-[#4f46e5] border border-[#e3e3e8] hover:border-[#c7d2fe] text-[10px] font-medium flex items-center gap-1 transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed select-none active:scale-95 shadow-2xs"
                  title={!title.trim() ? '请先填写任务名称' : '根据标题与说明智能生成验收用例'}
                >
                  {isGeneratingQa ? (
                    <Loader2 size={10} className="animate-spin text-[#4f46e5]" />
                  ) : (
                    <Sparkles size={10} className="text-[#4f46e5]" />
                  )}
                  <span>{isGeneratingQa ? 'AI 规划中...' : 'AI 规划用例'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsCriteriaOpen(!isCriteriaOpen)}
                  className="p-0.5 hover:text-[#1c1c21] transition-colors cursor-pointer"
                >
                  <ChevronDown
                    size={12}
                    className={`transition-transform duration-150 ${isCriteriaOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>
            </div>

            {isCriteriaOpen && (
              <div className="p-2.5 pt-0 border-t border-[#f1f1f4] bg-white animate-in fade-in duration-100">
                <p className="text-[10px] text-[#85858d] mb-1.5 leading-relaxed">
                  每行一步操作或校验指令。留空则运行期自动规划，也可点击右上角由 AI 预填草稿。
                </p>
                <textarea
                  value={acceptanceCriteria}
                  onChange={(e) => setAcceptanceCriteria(e.target.value)}
                  placeholder="例如：&#10;点击左侧菜单「QA 自动化」&#10;检查顶部子 Tab 与用例列表正常渲染&#10;校验页面无报错与异常提示"
                  rows={3}
                  className="w-full bg-[#f4f4f6] focus:bg-white border border-transparent focus:border-[#e3e3e8] rounded-[5px] p-2 text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none font-mono resize-none transition-all leading-relaxed"
                />
              </div>
            )}
          </div>

          {/* 自适应智能工序编排微开关 */}
          <div className="flex items-center justify-between py-1.5 px-2.5 rounded-[6px] bg-[#fafafc] border border-[#ececf0]">
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-[#4b4b53] hover:text-[#1c1c21]">
              <input
                type="checkbox"
                checked={autoDecompose}
                onChange={(e) => setAutoDecompose(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[#c8c8d0] text-[#1c1c21] focus:ring-0 focus:ring-offset-0 cursor-pointer accent-[#1c1c21]"
              />
              <span className="flex items-center gap-1">
                <Sparkles size={11} className="text-[#4f46e5]" />
                <span>复杂任务由 AI 自主拆解与编排多工序（自适应串并行任务组）</span>
              </span>
            </label>
            <span className="text-[10px] text-[#85858d]">自适应</span>
          </div>

          {/* 紧凑单行：初始泳道分段切换 (Segmented Control) 与 立即调度 Switch */}
          <div className="flex items-center justify-between gap-2 pt-1 pb-0.5">
            {/* 泳道分段切换 */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-medium text-[#63636b] shrink-0">归属:</span>
              <div className="flex items-center p-0.5 rounded-[5px] bg-[#f1f1f4] border border-[#e3e3e8]">
                <button
                  type="button"
                  onClick={() => {
                    setKanbanColumn('inbox');
                    setAutoRun(false);
                  }}
                  className={`px-2 h-[22px] rounded-[4px] text-[10.5px] transition-all flex items-center gap-1 ${
                    kanbanColumn === 'inbox'
                      ? 'bg-white text-[#4f46e5] font-medium shadow-sm'
                      : 'text-[#63636b] hover:text-[#1c1c21]'
                  }`}
                >
                  <Inbox size={11} />
                  <span>Inbox 收集箱</span>
                </button>
                <button
                  type="button"
                  onClick={() => setKanbanColumn('backlog')}
                  className={`px-2 h-[22px] rounded-[4px] text-[10.5px] transition-all flex items-center gap-1 ${
                    kanbanColumn === 'backlog'
                      ? 'bg-white text-[#1c1c21] font-medium shadow-sm'
                      : 'text-[#63636b] hover:text-[#1c1c21]'
                  }`}
                >
                  <ListTodo size={11} />
                  <span>待处理队列</span>
                </button>
              </div>
            </div>

            {/* 立即启动 Switch */}
            <div
              onClick={() => setAutoRun(!autoRun)}
              className="flex items-center gap-1.5 cursor-pointer select-none shrink-0"
              title={kanbanColumn === 'inbox' ? '暂存于 Inbox，建议手动调度' : '创建后立即触发 DAG 执行'}
            >
              <span className="text-[11px] text-[#63636b] hover:text-[#1c1c21] transition-colors">
                立即启动
              </span>
              <div
                className={`w-[28px] h-[16px] rounded-full flex items-center px-[2px] transition-colors duration-150 ${
                  autoRun ? 'bg-[#1c1c21]' : 'bg-[#d1d1d8]'
                }`}
              >
                <div
                  className={`w-[12px] h-[12px] rounded-full bg-white shadow-sm transition-transform duration-150 ${
                    autoRun ? 'translate-x-[12px]' : 'translate-x-0'
                  }`}
                />
              </div>
            </div>
          </div>

          {/* 底部按钮栏 */}
          <div className="pt-2 flex items-center justify-end gap-1.5 border-t border-[#ececf0]">
            <button
              type="button"
              onClick={onClose}
              className="h-[26px] px-3 rounded-[5px] text-[#63636b] hover:bg-[#f1f1f4] hover:text-[#1c1c21] text-[11.5px] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="h-[26px] px-3.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
            >
              <Play size={11} strokeWidth={2.4} />
              <span>{loading ? '处理中...' : autoRun ? '立即启动' : '创建任务'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
