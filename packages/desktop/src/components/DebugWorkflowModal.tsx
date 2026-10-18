import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Terminal,
  Bot,
  Zap,
  Target,
  FileVideo,
  CheckSquare,
  Sparkles,
  GitCommit,
  Rocket,
  ArrowRight,
  FolderGit2,
  Loader2,
  Workflow,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import { WorkflowDefinition, NodeType } from '@openloop/core';
import { WorkspacePicker } from './WorkspacePicker';

export interface DebugWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflow: WorkflowDefinition | null;
  onStartDebug: (params: {
    title: string;
    description: string;
    workspace?: string;
    openLogsImmediately: boolean;
  }) => Promise<void>;
}

const STORAGE_KEY_LAST_WORKSPACE = 'openloop_last_used_workspace';

export const DebugWorkflowModal: React.FC<DebugWorkflowModalProps> = ({
  isOpen,
  onClose,
  workflow,
  onStartDebug,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [openLogsImmediately, setOpenLogsImmediately] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

  // 评估当前流水线是否必须关联工程工作区
  const isWorkspaceRequired = Boolean(
    workflow?.requireWorkspace ||
    workflow?.nodes?.some((node) => {
      if (node.type === 'cli') {
        const cmd = node.config?.command?.toLowerCase() || '';
        const hasGit = cmd.includes('git commit') || cmd.includes('git push') || cmd.includes('git add');
        const hasBuild = cmd.includes('pnpm') || cmd.includes('npm run') || cmd.includes('yarn') || cmd.includes('mvn') || cmd.includes('gradle');
        return (hasGit || hasBuild) && !node.config?.cwd;
      }
      return false;
    })
  );

  // 打开弹窗时初始化表单状态与焦点
  useEffect(() => {
    if (isOpen && workflow) {
      setTitle(`编排调试: ${workflow.name}`);
      setDescription('');
      setErrorMsg(null);

      // 工作区初始化规则：
      // 1. 若流水线显式绑定了默认工作区，使用默认工作区；
      // 2. 若流水线声明必须在工程目录执行，优先尝试回填该流水线专属的历史选择；
      // 3. 若流水线不需要工程根目录（如纯云端编排、API/CLI调用），绝不盲目套用其他项目的路径，默认留空
      if (workflow.defaultWorkspace) {
        setWorkspace(workflow.defaultWorkspace);
      } else if (isWorkspaceRequired) {
        try {
          const wfWs = localStorage.getItem(`openloop_ws_wf_${workflow.id}`);
          setWorkspace(wfWs || '');
        } catch {
          setWorkspace('');
        }
      } else {
        setWorkspace('');
      }

      // 用户打开调试弹窗的主要目的是输入自测场景或 Prompt，优先聚焦说明输入框
      const timer = setTimeout(() => {
        descriptionTextareaRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen, workflow, isWorkspaceRequired]);

  // 快捷键支持：Cmd/Ctrl + Enter 提交，Escape 取消
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !loading) {
        handleSubmit(e as any);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, title, description, workspace, openLogsImmediately]);

  if (!isOpen || !workflow) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const finalTitle = title.trim();
    if (!finalTitle) {
      setErrorMsg('调试任务标题不能为空');
      return;
    }

    // 必填工作区校验：避免未选工作区时误在系统目录或错误上下文下执行
    if (isWorkspaceRequired && !workspace.trim()) {
      setErrorMsg('当前流水线包含本地代码工程操作，必须手动选择关联工程工作区目录');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    if (import.meta.env?.DEV) {
      console.log('[DebugWorkflowModal] 提交编排调试任务:', {
        workflowId: workflow.id,
        workflowName: workflow.name,
        title: finalTitle,
        description: description.trim(),
        workspace: workspace.trim() || undefined,
        isWorkspaceRequired,
        openLogsImmediately,
      });
    }

    try {
      if (workspace.trim()) {
        try {
          localStorage.setItem(STORAGE_KEY_LAST_WORKSPACE, workspace.trim());
          localStorage.setItem(`openloop_ws_wf_${workflow.id}`, workspace.trim());
        } catch {}
      }

      await onStartDebug({
        title: finalTitle,
        description: description.trim(),
        workspace: workspace.trim() || undefined,
        openLogsImmediately,
      });
      onClose();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[DebugWorkflowModal] 启动调试失败:', err);
      }
      setErrorMsg(err?.message || '启动调试任务失败，请检查服务状态');
    } finally {
      setLoading(false);
    }
  };

  // 渲染节点小图标与类型标签
  const renderNodeBadge = (node: WorkflowDefinition['nodes'][number]) => {
    const isGit =
      node.type === 'cli' &&
      (node.name?.toLowerCase().includes('git') ||
        node.config?.command?.toLowerCase().includes('git'));
    const isDeploy =
      node.type === 'cli' &&
      (node.name?.includes('部署') ||
        node.name?.toLowerCase().includes('deploy') ||
        node.config?.command?.toLowerCase().includes('deploy'));

    let icon = <Terminal size={10} />;
    let badgeClass = 'bg-[#f1f1f4] text-[#4b4b53] border-[#e3e3e8]';

    if (node.type === 'agent') {
      icon = <Bot size={10} />;
      badgeClass = 'bg-[#eeedfd] text-[#4f46e5] border-[#c7d2fe]';
    } else if (node.type === 'hook') {
      icon = <Zap size={10} />;
      badgeClass = 'bg-[#fbf0df] text-[#b45309] border-[#fde68a]';
    } else if (node.type === 'midscene') {
      icon = <Target size={10} />;
      badgeClass = 'bg-[#e4f6ec] text-[#189a58] border-[#a7f3d0]';
    } else if (node.type === 'stitch-image') {
      icon = <FileVideo size={10} />;
      badgeClass = 'bg-[#eff6ff] text-[#1d4ed8] border-[#bfdbfe]';
    } else if (node.type === 'qa-approval') {
      icon = <CheckSquare size={10} />;
      badgeClass = 'bg-[#fef3c7] text-[#92400e] border-[#fde68a]';
    } else if (isGit) {
      icon = <GitCommit size={10} />;
      badgeClass = 'bg-[#1c1c21] text-white border-[#1c1c21]';
    } else if (isDeploy) {
      icon = <Rocket size={10} />;
      badgeClass = 'bg-[#0f172a] text-[#38bdf8] border-[#0f172a]';
    }

    return (
      <div
        key={node.id}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-[5px] text-[11px] font-medium border shadow-2xs shrink-0 ${badgeClass}`}
      >
        <span>{icon}</span>
        <span className="truncate max-w-[120px]">{node.name || node.id}</span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-[560px] bg-white rounded-[12px] border border-[#e3e3e8] shadow-[0_16px_48px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col scale-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 弹窗头部 */}
        <div className="px-5 py-4 border-b border-[#ececf0] flex items-center justify-between bg-[#fafafc]">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-[7px] bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center shadow-2xs">
              <Play size={14} className="fill-[#4f46e5] translate-x-[0.5px]" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-[#1c1c21]">编排调试流水线</h3>
                <span className="text-[10px] font-mono px-1.5 py-[1px] rounded bg-[#f1f1f4] text-[#71717a] border border-[#e3e3e8]">
                  {workflow.id}
                </span>
              </div>
              <p className="text-[11.5px] text-[#85858d] mt-0.5">
                以调试任务驱动链路执行，验证节点依赖流转、产物传递与执行状态
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-6 h-6 rounded-[5px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all"
          >
            <X size={14} />
          </button>
        </div>

        {/* 弹窗表单主体 */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4 text-[#1c1c21]">
          {/* 错误提示横幅 */}
          {errorMsg && (
            <div className="p-2.5 rounded-[6px] bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-[11.5px] flex items-center justify-between animate-in fade-in">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-[#dc2626] hover:opacity-75"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* 流水线节点流转拓扑预览 */}
          <div className="p-3 rounded-[8px] bg-[#f8f9fa] border border-[#e9ebed] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#4b4b53] flex items-center gap-1.5">
                <Workflow size={12} className="text-[#4f46e5]" />
                流水线链路概览 ({workflow.nodes?.length || 0} 个节点)
              </span>
              <span className="text-[10.5px] text-[#85858d] truncate max-w-[240px]">
                {workflow.name}
              </span>
            </div>

            {/* 节点横向流转预览条 */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
              {workflow.nodes && workflow.nodes.length > 0 ? (
                workflow.nodes.map((node, idx) => (
                  <React.Fragment key={node.id}>
                    {renderNodeBadge(node)}
                    {idx < workflow.nodes.length - 1 && (
                      <ArrowRight size={11} className="text-[#a1a1aa] shrink-0" />
                    )}
                  </React.Fragment>
                ))
              ) : (
                <div className="text-[11px] text-[#85858d] italic">该流水线暂未配置节点</div>
              )}
            </div>
          </div>

          {/* 调试任务标题 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-medium text-[#4b4b53] flex items-center justify-between">
              <span>调试任务标题</span>
              <span className="text-[10px] text-[#85858d]">将在任务看板中作为独立任务显示</span>
            </label>
            <input
              ref={titleInputRef}
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如: 编排调试: 通用研发流水线"
              className="h-[32px] px-2.5 rounded-[6px] border border-[#d4d4d8] bg-white text-[12px] text-[#1c1c21] placeholder-[#a1a1aa] outline-hidden focus:border-[#4f46e5] focus:ring-2 focus:ring-[#4f46e5]/15 transition-all"
            />
          </div>

          {/* 调试执行说明 / 模拟需求输入 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-medium text-[#4b4b53] flex items-center justify-between">
              <span className="flex items-center gap-1">
                <span>调试需求与执行说明</span>
                <span className="text-[10px] text-[#85858d] font-normal">(可选)</span>
              </span>
              <span className="text-[10px] text-[#85858d]">
                将注入为任务描述及 Agent 节点的执行上下文
              </span>
            </label>
            <textarea
              ref={descriptionTextareaRef}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可输入具体自测场景或模拟需求，例如:&#10;验证通用研发流水线代码修改、自检命令以及门禁审批全链路闭环"
              className="px-2.5 py-2 rounded-[6px] border border-[#d4d4d8] bg-white text-[12px] text-[#1c1c21] placeholder-[#a1a1aa] outline-hidden focus:border-[#4f46e5] focus:ring-2 focus:ring-[#4f46e5]/15 transition-all resize-none font-sans"
            />
          </div>

          {/* 关联工程工作区目录 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11.5px] font-medium text-[#4b4b53] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <FolderGit2
                  size={12}
                  className={isWorkspaceRequired ? 'text-[#4f46e5]' : 'text-[#85858d]'}
                />
                <span>关联工程工作区目录</span>
                {isWorkspaceRequired ? (
                  <span className="text-[10px] font-medium px-1.5 py-[0.5px] rounded bg-[#fee2e2] text-[#dc2626] border border-[#fecaca]">
                    * 必选
                  </span>
                ) : (
                  <span className="text-[10px] text-[#85858d] font-normal">(可选)</span>
                )}
              </span>
              <span className={`text-[10px] ${isWorkspaceRequired ? 'text-[#dc2626] font-medium' : 'text-[#85858d]'}`}>
                {isWorkspaceRequired
                  ? '此流水线包含本地代码操作，必须手动指定工程目录'
                  : '非必选；留空时将在独立临时沙箱中执行'}
              </span>
            </label>
            <WorkspacePicker
              value={workspace}
              onChange={(val) => {
                setWorkspace(val);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder={
                isWorkspaceRequired
                  ? '必须选择该流水线执行所需的本地代码工程根目录...'
                  : '可留空（在独立沙箱执行），或选择本地代码目录...'
              }
            />
          </div>

          {/* 运行选项 */}
          <div className="pt-1 border-t border-[#ececf0] flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={openLogsImmediately}
                onChange={(e) => setOpenLogsImmediately(e.target.checked)}
                className="w-3.5 h-3.5 rounded-[4px] border-[#d4d4d8] text-[#4f46e5] focus:ring-[#4f46e5] focus:ring-offset-0"
              />
              <span className="text-[11.5px] text-[#4b4b53]">
                触发后立即在底部展开实时日志抽屉
              </span>
            </label>
            <span className="text-[10.5px] text-[#85858d] hidden sm:inline">
              支持按 <kbd className="font-mono text-[9.5px] px-1 py-0.5 rounded bg-[#f1f1f4] border border-[#e3e3e8]">⌘</kbd> + <kbd className="font-mono text-[9.5px] px-1 py-0.5 rounded bg-[#f1f1f4] border border-[#e3e3e8]">Enter</kbd> 快速启动
            </span>
          </div>

          {/* 弹窗底栏操作按钮 */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="h-[28px] px-3 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[12px] font-medium text-[#4b4b53] transition-all"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="h-[28px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] active:scale-97 text-[12px] font-medium text-white flex items-center gap-1.5 shadow-xs transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={13} className="animate-spin text-white" />
                  <span>正在触发...</span>
                </>
              ) : (
                <>
                  <Play size={12} className="fill-white" />
                  <span>开始调试执行</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
