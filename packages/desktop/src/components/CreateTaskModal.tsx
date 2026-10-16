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
  FolderGit2,
  FolderOpen,
  ExternalLink,
} from 'lucide-react';
import { WorkflowDefinition, NodeType, KanbanColumn } from '@openloop/core';
import { api } from '../services/api';

const STORAGE_KEY_LAST_WORKFLOW = 'openloop_last_used_workflow_id';
const STORAGE_KEY_RECENT_WORKFLOWS = 'openloop_recent_workflow_ids';
const STORAGE_KEY_LAST_WORKSPACE = 'openloop_last_used_workspace';
const STORAGE_KEY_RECENT_WORKSPACES = 'openloop_recent_workspaces';
const MAX_RECENT_COUNT = 3;

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflows: WorkflowDefinition[];
  defaultColumn?: KanbanColumn;
  onCreate: (params: {
    title: string;
    workflowId: string;
    description: string;
    autoRun: boolean;
    kanbanColumn?: KanbanColumn;
    workspace?: string;
  }) => Promise<void>;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  workflows,
  defaultColumn = 'backlog',
  onCreate,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workflowId, setWorkflowId] = useState(workflows[0]?.id || '');
  const [kanbanColumn, setKanbanColumn] = useState<KanbanColumn>(defaultColumn);
  const [workspace, setWorkspace] = useState('');
  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [workflowSearch, setWorkflowSearch] = useState('');
  const [recentWorkflowIds, setRecentWorkflowIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RECENT_WORKFLOWS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_RECENT_WORKSPACES);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const dropdownRef = useRef<HTMLDivElement>(null);

  // 弹窗打开或 workflows 变更时，优先恢复本地上次使用的流程与工作区记忆
  useEffect(() => {
    if (!isOpen) return;

    // 工作区本地历史记忆恢复
    try {
      const lastWs = localStorage.getItem(STORAGE_KEY_LAST_WORKSPACE);
      if (lastWs && !workspace) {
        setWorkspace(lastWs);
        if (import.meta.env?.DEV) {
          console.log('[CreateTaskModal] 从本地记忆回填上次使用的工作区:', lastWs);
        }
      }
    } catch (err) {
      console.warn('[CreateTaskModal] 读取工作区历史记忆失败:', err);
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
  }, [isOpen, workflows]);

  // 确保当 workflows 变更或加载时根据 defaultColumn 重置
  useEffect(() => {
    if (isOpen) {
      setKanbanColumn(defaultColumn);
      if (defaultColumn === 'inbox') {
        setAutoRun(false);
      }
    }
  }, [isOpen, defaultColumn]);

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

  const currentWf = workflows.find((w) => w.id === workflowId) || workflows[0];

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
        (w.description && w.description.toLowerCase().includes(keyword))
    );
  }, [allSortedWorkflows, workflowSearch]);

  const handleSelectWorkflow = (wf: WorkflowDefinition) => {
    setWorkflowId(wf.id);
    setIsDropdownOpen(false);
    setWorkflowSearch('');
    if (import.meta.env?.DEV) {
      console.log('[CreateTaskModal] 用户选定工作流:', { id: wf.id, name: wf.name });
    }
  };

  const renderWorkflowItem = (wf: WorkflowDefinition, isRecentBadge = false) => {
    const isSelected = wf.id === currentWf?.id;

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
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-[12.5px] text-[#1c1c21] truncate">
                {wf.name}
              </span>
              <span className="text-[9.5px] font-mono text-[#85858d] bg-[#f4f4f6] px-1 py-[0.5px] rounded">
                {wf.id}
              </span>
              {isRecentBadge && (
                <span className="px-1.5 py-[0.5px] rounded-[3px] text-[9px] font-semibold bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb]/60 shrink-0">
                  Recent
                </span>
              )}
            </div>

            <div className="text-[11px] text-[#85858d] truncate mt-0.5">
              {wf.description || '无附加描述'}
            </div>

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

  const getDirectoryName = (dirPath: string) => {
    if (!dirPath) return '';
    const trimmed = dirPath.replace(/[/\\]+$/, '');
    const parts = trimmed.split(/[/\\]/);
    return parts[parts.length - 1] || dirPath;
  };

  const handleSelectWorkspace = async () => {
    if (isSelectingWorkspace) return;
    setIsSelectingWorkspace(true);
    if (import.meta.env?.DEV) {
      console.log('[CreateTaskModal] 用户触发选择工作区，准备调起访达...');
    }
    try {
      const chosen = await api.selectDirectory({ defaultPath: workspace || undefined });
      if (chosen) {
        setWorkspace(chosen);
        if (import.meta.env?.DEV) {
          console.log('[CreateTaskModal] 成功关联工作区:', chosen);
        }
      } else {
        if (import.meta.env?.DEV) {
          console.log('[CreateTaskModal] 用户取消了访达目录选择');
        }
      }
    } catch (err) {
      console.error('[CreateTaskModal] 调起目录选择器异常:', err);
    } finally {
      setIsSelectingWorkspace(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !workflowId) return;

    setLoading(true);
    const trimmedWorkspace = workspace.trim();
    if (import.meta.env?.DEV) {
      console.log('[CreateTaskModal] 提交创建任务:', {
        title: title.trim(),
        workflowId,
        kanbanColumn,
        workspace: trimmedWorkspace || '未指定(留空)',
        autoRun,
      });
    }
    try {
      await onCreate({
        title: title.trim(),
        workflowId,
        description: description.trim(),
        autoRun,
        kanbanColumn,
        workspace: trimmedWorkspace || undefined,
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

        // 保存工作区记忆
        if (trimmedWorkspace) {
          localStorage.setItem(STORAGE_KEY_LAST_WORKSPACE, trimmedWorkspace);
          const nextWsRecents = [
            trimmedWorkspace,
            ...recentWorkspaces.filter((w) => w !== trimmedWorkspace),
          ].slice(0, MAX_RECENT_COUNT);
          localStorage.setItem(STORAGE_KEY_RECENT_WORKSPACES, JSON.stringify(nextWsRecents));
          setRecentWorkspaces(nextWsRecents);
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
      setWorkflowSearch('');
      setIsDropdownOpen(false);
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
      <div className="w-[500px] bg-white border border-[#e3e3e8] rounded-[12px] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.16)] text-[#1c1c21]">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-3.5 border-b border-[#ececf0]">
          <div>
            <h3 className="font-semibold text-[14px] text-[#1c1c21]">新建自动化任务</h3>
            <p className="text-[11.5px] text-[#85858d] mt-0.5">
              选择编排流程，自动化串联 Agent 编码、测试与 QA 验收闭环
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-[6px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-[12px]">
          {/* 任务名称 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1.5">任务名称</label>
            <input
              type="text"
              required
              placeholder="例如: 购物车结算全链路回归与截图验收"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-[32px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[7px] px-3 text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all"
            />
          </div>

          {/* 关联工程工作区 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block font-medium text-[#4b4b53]">关联工程工作区</label>
              {workspace ? (
                <span className="text-[10.5px] text-[#189a58] font-medium flex items-center gap-1 bg-[#e4f6ec] px-1.5 py-[0.5px] rounded">
                  <Check size={10.5} strokeWidth={2.4} /> 已绑定
                </span>
              ) : (
                <span className="text-[10.5px] text-[#85858d]">
                  独立工程目录，非默认工具目录
                </span>
              )}
            </div>

            {workspace ? (
              <div className="w-full min-h-[46px] px-3 py-2 rounded-[8px] border border-[#d8d6fb] bg-[#f5f5ff]/60 flex items-center justify-between gap-2 shadow-[0_1px_2px_rgba(79,70,229,0.04)]">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-7 h-7 rounded-[6px] bg-[#4f46e5] text-white flex items-center justify-center shrink-0 shadow-sm">
                    <FolderGit2 size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[12.5px] text-[#1c1c21] truncate">
                        {getDirectoryName(workspace)}
                      </span>
                      <span className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1 py-[0.5px] rounded">
                        Workspace
                      </span>
                    </div>
                    <div
                      className="text-[11px] font-mono text-[#63636b] truncate mt-0.5 select-all"
                      title={workspace}
                    >
                      {workspace}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => api.openPath(workspace)}
                    className="h-[24px] px-2 rounded-[5px] bg-white hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[11px] font-medium transition-colors shadow-sm flex items-center gap-1"
                    title="在系统访达中定位该目录"
                  >
                    <ExternalLink size={11} />
                    <span>访达</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSelectingWorkspace}
                    onClick={handleSelectWorkspace}
                    className="h-[24px] px-2 rounded-[5px] bg-white hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[11px] font-medium transition-colors shadow-sm"
                    title="更换其他工程目录"
                  >
                    {isSelectingWorkspace ? '选择中...' : '更换'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspace('');
                      if (import.meta.env?.DEV) console.log('[CreateTaskModal] 清除工作区关联');
                    }}
                    className="w-6 h-[24px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:text-[#d64545] hover:bg-[#fee2e2]/60 transition-colors"
                    title="取消关联工作区"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={handleSelectWorkspace}
                className="group w-full min-h-[46px] px-3 py-2.5 rounded-[8px] border border-dashed border-[#d1d1d8] hover:border-[#4f46e5] bg-[#f9f9fb] hover:bg-[#f5f5ff]/60 cursor-pointer transition-all flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <div className="w-7 h-7 rounded-[6px] bg-[#f1f1f4] group-hover:bg-[#eeedfd] group-hover:text-[#4f46e5] text-[#85858d] flex items-center justify-center shrink-0 transition-colors">
                    <FolderGit2 size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-[#4b4b53] group-hover:text-[#4f46e5] transition-colors flex items-center gap-1.5">
                      <span>点击关联本地工程工作区</span>
                    </div>
                    <div className="text-[10.5px] text-[#85858d] truncate mt-0.5">
                      选择待迭代代码工程，执行时在此目录下自测与编码
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSelectingWorkspace}
                  className="px-2.5 h-[26px] rounded-[6px] bg-white border border-[#e3e3e8] group-hover:border-[#d8d6fb] text-[11px] font-medium text-[#4b4b53] group-hover:text-[#4f46e5] shadow-sm flex items-center gap-1 transition-all shrink-0"
                >
                  <FolderOpen size={12} />
                  <span>{isSelectingWorkspace ? '选择中...' : '打开访达'}</span>
                </button>
              </div>
            )}

            {recentWorkspaces.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-[#85858d] flex items-center gap-1">
                  <Clock size={10} /> 最近工作区:
                </span>
                {recentWorkspaces.map((wsPath) => {
                  const isCurrent = wsPath === workspace;
                  return (
                    <button
                      key={wsPath}
                      type="button"
                      onClick={() => {
                        setWorkspace(wsPath);
                        if (import.meta.env?.DEV) console.log('[CreateTaskModal] 切换工作区:', wsPath);
                      }}
                      className={`px-2 py-[2px] rounded-[4px] text-[10.5px] font-mono border transition-all max-w-[180px] truncate shadow-[0_1px_2px_rgba(0,0,0,0.02)] ${
                        isCurrent
                          ? 'bg-[#eeedfd] border-[#4f46e5] text-[#4f46e5] font-semibold'
                          : 'bg-white hover:bg-[#f9f9fb] border-[#e3e3e8] text-[#4b4b53] hover:text-[#1c1c21]'
                      }`}
                      title={wsPath}
                    >
                      {getDirectoryName(wsPath)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 极致优雅的自定义工作流下拉选择器 */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block font-medium text-[#4b4b53]">关联自动化流程</label>
              {currentWf && (
                <span className="text-[11px] font-mono text-[#85858d]">
                  {currentWf.nodes.length} 节点 · {currentWf.edges.length} 连线
                </span>
              )}
            </div>

            {/* 触发主卡片 */}
            <div
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`w-full min-h-[46px] px-3 py-2 rounded-[8px] border transition-all cursor-pointer flex items-center justify-between ${
                isDropdownOpen
                  ? 'border-[#4f46e5] bg-white ring-2 ring-[#eeedfd] shadow-sm'
                  : 'border-[#e3e3e8] bg-[#f9f9fb] hover:bg-white hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.03)]'
              }`}
            >
              {currentWf ? (
                <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                  <div className="w-7 h-7 rounded-[6px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center justify-center text-[#4f46e5] shrink-0">
                    <Workflow size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[12.5px] text-[#1c1c21] truncate">
                        {currentWf.name}
                      </span>
                      <span className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1 py-[0.5px] rounded">
                        {currentWf.id}
                      </span>
                    </div>
                    {currentWf.description && (
                      <p className="text-[11px] text-[#85858d] truncate mt-0.5">
                        {currentWf.description}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <span className="text-[#85858d]">请选择工作流</span>
              )}

              <ChevronDown
                size={14}
                className={`text-[#85858d] shrink-0 transition-transform duration-200 ${
                  isDropdownOpen ? 'rotate-180 text-[#4f46e5]' : ''
                }`}
              />
            </div>

            {/* 下拉弹出浮层 Popover */}
            {isDropdownOpen && (
              <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_12px_32px_rgba(0,0,0,0.12)] z-50 max-h-[290px] overflow-hidden flex flex-col p-1.5 animate-in fade-in zoom-in-95 duration-100">
                {/* 快速搜索栏 */}
                {workflows.length >= 3 && (
                  <div className="px-1 pt-0.5 pb-1.5 border-b border-[#ececf0] mb-1">
                    <div className="relative">
                      <Search
                        size={12}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#85858d]"
                      />
                      <input
                        type="text"
                        placeholder="搜索工作流名称或 ID..."
                        value={workflowSearch}
                        onChange={(e) => setWorkflowSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full h-[26px] bg-[#f4f4f6] focus:bg-white border border-transparent focus:border-[#4f46e5] rounded-[6px] pl-7 pr-2 text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none transition-all"
                      />
                    </div>
                  </div>
                )}

                {/* 滚动区域 */}
                <div className="overflow-y-auto space-y-1 flex-1 pr-0.5">
                  {workflowSearch.trim() ? (
                    // 处于搜索状态
                    <div>
                      <div className="px-2 py-1 text-[10px] font-semibold text-[#85858d] uppercase tracking-wider">
                        搜索结果 ({filteredWorkflows.length})
                      </div>
                      {filteredWorkflows.length === 0 ? (
                        <div className="py-6 text-center text-[11.5px] text-[#85858d]">
                          未找到匹配的工作流
                        </div>
                      ) : (
                        filteredWorkflows.map((wf) => renderWorkflowItem(wf))
                      )}
                    </div>
                  ) : (
                    // 常规分层视图：最近使用 + 全部流程
                    <>
                      {/* 最近使用分区 */}
                      {recentWorkflows.length > 0 && (
                        <div className="space-y-1 mb-1.5">
                          <div className="px-2 pt-1 pb-0.5 flex items-center justify-between text-[10px] font-semibold text-[#85858d] uppercase tracking-wider">
                            <span className="flex items-center gap-1 text-[#4f46e5]">
                              <Clock size={10.5} /> 最近使用
                            </span>
                            <span className="text-[9.5px] font-normal lowercase text-[#85858d]">
                              LRU 优先
                            </span>
                          </div>
                          {recentWorkflows.map((wf) => renderWorkflowItem(wf, true))}
                          <div className="h-[1px] bg-[#ececf0] my-1 mx-1.5" />
                        </div>
                      )}

                      {/* 全部流程分区 */}
                      <div className="space-y-1">
                        <div className="px-2 pt-1 pb-0.5 flex items-center justify-between text-[10px] font-semibold text-[#85858d] uppercase tracking-wider">
                          <span className="flex items-center gap-1">
                            <Layers size={10.5} className="text-[#85858d]" /> 全部流程 (
                            {allSortedWorkflows.length})
                          </span>
                          <span className="text-[9.5px] font-normal lowercase text-[#85858d]">
                            按更新时间倒序
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

          {/* 任务描述与上下文 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1.5">任务说明与提示词 (可选)</label>
            <textarea
              rows={2.5}
              placeholder="输入任务背景、特定需求描述或传给 Agent 的 Prompt 覆盖项..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[7px] p-2.5 text-[#1c1c21] placeholder-[#85858d] outline-none resize-none focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all"
            />
          </div>

          {/* 看板初始归属泳道 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1.5">初始收纳位置</label>
            <div className="grid grid-cols-2 gap-2">
              <div
                onClick={() => {
                  setKanbanColumn('inbox');
                  setAutoRun(false);
                }}
                className={`p-2.5 rounded-[8px] border cursor-pointer transition-all flex items-start gap-2.5 ${
                  kanbanColumn === 'inbox'
                    ? 'bg-[#f5f5ff] border-[#6366f1] ring-1 ring-[#6366f1]/20 shadow-sm'
                    : 'bg-[#f9f9fb] border-[#e3e3e8] hover:bg-white hover:border-[#b9b9c2]'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0 mt-0.5 ${
                    kanbanColumn === 'inbox'
                      ? 'bg-[#6366f1] text-white shadow-sm'
                      : 'bg-[#f1f1f4] text-[#85858d]'
                  }`}
                >
                  <Inbox size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[12px] text-[#1c1c21]">Inbox 收集箱</span>
                    {kanbanColumn === 'inbox' && (
                      <Check size={12} className="text-[#6366f1]" strokeWidth={2.5} />
                    )}
                  </div>
                  <div className="text-[10.5px] text-[#85858d] mt-0.5 leading-snug">
                    想法与未排期需求，暂缓执行
                  </div>
                </div>
              </div>

              <div
                onClick={() => setKanbanColumn('backlog')}
                className={`p-2.5 rounded-[8px] border cursor-pointer transition-all flex items-start gap-2.5 ${
                  kanbanColumn === 'backlog'
                    ? 'bg-[#f5f5ff] border-[#4f46e5] ring-1 ring-[#4f46e5]/20 shadow-sm'
                    : 'bg-[#f9f9fb] border-[#e3e3e8] hover:bg-white hover:border-[#b9b9c2]'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0 mt-0.5 ${
                    kanbanColumn === 'backlog'
                      ? 'bg-[#4f46e5] text-white shadow-sm'
                      : 'bg-[#f1f1f4] text-[#85858d]'
                  }`}
                >
                  <ListTodo size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[12px] text-[#1c1c21]">待处理队列</span>
                    {kanbanColumn === 'backlog' && (
                      <Check size={12} className="text-[#4f46e5]" strokeWidth={2.5} />
                    )}
                  </div>
                  <div className="text-[10.5px] text-[#85858d] mt-0.5 leading-snug">
                    已确认的任务，排期进入流水线
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 拟物感极佳的黑色 Switch 开关 */}
          <div
            onClick={() => setAutoRun(!autoRun)}
            className="flex items-center justify-between p-2.5 rounded-[8px] bg-[#f9f9fb] border border-[#e3e3e8] cursor-pointer hover:bg-[#f1f1f4] transition-colors"
          >
            <div>
              <div className="font-medium text-[12px] text-[#1c1c21]">立即调度执行</div>
              <div className="text-[11px] text-[#85858d] mt-0.5">
                {autoRun
                  ? '创建后系统将自动唤醒 Agent 与底层工具链，按 DAG 拓扑执行'
                  : kanbanColumn === 'inbox'
                  ? '作为想法保存在 Inbox，后续随时移入待处理或手动触发'
                  : '创建为待处理任务，后续可在看板泳道或列表中手动触发'}
              </div>
            </div>

            <div
              className={`w-[34px] h-[20px] rounded-full flex items-center px-[2px] transition-colors duration-200 shadow-inner ${
                autoRun ? 'bg-[#1c1c21]' : 'bg-[#d1d1d8]'
              }`}
            >
              <div
                className={`w-[16px] h-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  autoRun ? 'translate-x-[14px]' : 'translate-x-0'
                }`}
              />
            </div>
          </div>

          {/* 底部按钮栏 */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#ececf0]">
            <button
              type="button"
              onClick={onClose}
              className="h-[28px] px-3.5 rounded-[6px] text-[#4b4b53] hover:bg-[#f1f1f4] hover:text-[#1c1c21] text-[12px] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="h-[28px] px-4 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white font-medium flex items-center gap-1.5 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
            >
              <Play size={12} strokeWidth={2.4} />
              <span>{loading ? '处理中...' : autoRun ? '立即启动' : '创建任务'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
