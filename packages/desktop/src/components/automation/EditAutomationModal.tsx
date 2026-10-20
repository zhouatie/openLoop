import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Save,
  Timer,
  Terminal,
  Workflow,
  Sparkles,
  Loader2,
  Folder,
  Layers,
  HelpCircle,
} from 'lucide-react';

const GithubIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const TwitterIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
  </svg>
);
import {
  AutomationTask,
  AutomationSourceType,
  AutomationActionType,
  WorkflowDefinition,
  KanbanColumn,
} from '@openloop/core';

export interface EditAutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  automation: AutomationTask | null;
  workflows: WorkflowDefinition[];
  onSave: (taskData: Partial<AutomationTask> & { name: string }) => Promise<void>;
}

const TEMPLATES: Array<{
  id: string;
  label: string;
  desc: string;
  sourceType: AutomationSourceType;
  actionType: AutomationActionType;
  intervalSec: number;
  sourceConfig: any;
  actionConfig: any;
}> = [
  {
    id: 'tpl_cli',
    label: 'CLI 工具轮询',
    desc: '定时执行 CLI 脚本/命令，监控构建或状态',
    sourceType: 'cli_script',
    actionType: 'create_task',
    intervalSec: 60,
    sourceConfig: {
      command: 'git status --short',
    },
    actionConfig: {
      kanbanColumn: 'inbox',
      titleTemplate: '[CLI 轮询] {{title}}',
      autoRun: false,
    },
  },
  {
    id: 'tpl_gh',
    label: 'GitHub Issue 监控',
    desc: '拉取最新 Issues，自动入会创建看板任务',
    sourceType: 'github_issues',
    actionType: 'create_task',
    intervalSec: 120,
    sourceConfig: {
      repo: 'facebook/react',
    },
    actionConfig: {
      kanbanColumn: 'inbox',
      titleTemplate: '{{title}}',
      autoRun: false,
    },
  },
  {
    id: 'tpl_twitter',
    label: '推特消息流水线',
    desc: '监听推特关键词，自动创建任务并驱动流水线',
    sourceType: 'twitter_query',
    actionType: 'run_workflow',
    intervalSec: 300,
    sourceConfig: {
      twitterQuery: 'openloop release',
    },
    actionConfig: {
      kanbanColumn: 'in_progress',
      autoRun: true,
    },
  },
];

export const EditAutomationModal: React.FC<EditAutomationModalProps> = ({
  isOpen,
  onClose,
  automation,
  workflows,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [intervalSec, setIntervalSec] = useState(60);
  const [sourceType, setSourceType] = useState<AutomationSourceType>('cli_script');
  const [command, setCommand] = useState('');
  const [cwd, setCwd] = useState('');
  const [repo, setRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [twitterQuery, setTwitterQuery] = useState('');
  const [actionType, setActionType] = useState<AutomationActionType>('create_task');
  const [workflowId, setWorkflowId] = useState('');
  const [kanbanColumn, setKanbanColumn] = useState<KanbanColumn>('inbox');
  const [titleTemplate, setTitleTemplate] = useState('');
  const [autoRun, setAutoRun] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (automation) {
      setName(automation.name || '');
      setDescription(automation.description || '');
      setEnabled(automation.enabled !== false);
      setIntervalSec(automation.intervalSec || 60);
      setSourceType(automation.sourceType || 'cli_script');
      setCommand(automation.sourceConfig?.command || '');
      setCwd(automation.sourceConfig?.cwd || '');
      setRepo(automation.sourceConfig?.repo || '');
      setGithubToken(automation.sourceConfig?.githubToken || '');
      setTwitterQuery(automation.sourceConfig?.twitterQuery || '');
      setActionType(automation.actionType || 'create_task');
      setWorkflowId(automation.actionConfig?.workflowId || (workflows[0]?.id ?? ''));
      setKanbanColumn((automation.actionConfig?.kanbanColumn as KanbanColumn) || 'inbox');
      setTitleTemplate(automation.actionConfig?.titleTemplate || '');
      setAutoRun(automation.actionConfig?.autoRun !== false);
    } else {
      // 默认新建初始值
      setName('');
      setDescription('');
      setEnabled(true);
      setIntervalSec(60);
      setSourceType('cli_script');
      setCommand('git status --short');
      setCwd('');
      setRepo('');
      setGithubToken('');
      setTwitterQuery('');
      setActionType('create_task');
      setWorkflowId(workflows[0]?.id || '');
      setKanbanColumn('inbox');
      setTitleTemplate('');
      setAutoRun(true);
    }
    setErrorMsg(null);
  }, [automation, isOpen, workflows]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // 快捷套用模板
  const applyTemplate = (tpl: typeof TEMPLATES[0]) => {
    setName(`${tpl.label} 自动化`);
    setDescription(tpl.desc);
    setSourceType(tpl.sourceType);
    setActionType(tpl.actionType);
    setIntervalSec(tpl.intervalSec);
    if (tpl.sourceConfig.command) setCommand(tpl.sourceConfig.command);
    if (tpl.sourceConfig.repo) setRepo(tpl.sourceConfig.repo);
    if (tpl.sourceConfig.twitterQuery) setTwitterQuery(tpl.sourceConfig.twitterQuery);
    if (tpl.actionConfig.kanbanColumn) setKanbanColumn(tpl.actionConfig.kanbanColumn);
    if (tpl.actionConfig.titleTemplate) setTitleTemplate(tpl.actionConfig.titleTemplate);
    if (tpl.actionConfig.autoRun !== undefined) setAutoRun(tpl.actionConfig.autoRun);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMsg('请输入自动化任务名称');
      return;
    }

    if (sourceType === 'cli_script' && !command.trim()) {
      setErrorMsg('请输入需要轮询执行的 CLI 脚本或命令');
      return;
    }
    if (sourceType === 'github_issues' && !repo.trim()) {
      setErrorMsg('请输入需要监控的 GitHub 仓库 (如: facebook/react)');
      return;
    }
    if (sourceType === 'twitter_query' && !twitterQuery.trim()) {
      setErrorMsg('请输入推特搜索关键词或用户名');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const sourceConfig: any = {};
      if (sourceType === 'cli_script') {
        sourceConfig.command = command.trim();
        if (cwd.trim()) sourceConfig.cwd = cwd.trim();
      } else if (sourceType === 'github_issues') {
        sourceConfig.repo = repo.trim();
        if (githubToken.trim()) sourceConfig.githubToken = githubToken.trim();
      } else if (sourceType === 'twitter_query') {
        sourceConfig.twitterQuery = twitterQuery.trim();
        if (command.trim()) sourceConfig.command = command.trim();
      } else {
        sourceConfig.command = command.trim();
      }

      const actionConfig: any = {
        kanbanColumn,
        autoRun,
      };
      if (workflowId) actionConfig.workflowId = workflowId;
      if (titleTemplate.trim()) actionConfig.titleTemplate = titleTemplate.trim();

      await onSave({
        id: automation?.id,
        name: trimmedName,
        description: description.trim() || undefined,
        enabled,
        intervalSec: Number(intervalSec) || 60,
        sourceType,
        sourceConfig,
        actionType,
        actionConfig,
      });

      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || '保存自动化任务失败');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] animate-fadeIn select-none">
      <div
        className="bg-white rounded-[10px] shadow-2xl border border-[#e3e3e8] w-full max-w-[620px] max-h-[90vh] flex flex-col overflow-hidden text-[#1c1c21] animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="h-[46px] px-5 border-b border-[#e3e3e8] flex items-center justify-between shrink-0 bg-[#fafafc]">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#4f46e5] border border-[#e3e3e8]/60">
              <Timer size={12} strokeWidth={2.2} />
            </div>
            <span className="text-[13px] font-semibold text-[#1c1c21]">
              {automation ? '编辑自动化任务' : '创建自动化任务'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-6 h-6 rounded-[4px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* 内容滚动区 */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-[12px]">
          {errorMsg && (
            <div className="px-3 py-2 bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] rounded-[6px] text-[11.5px] leading-relaxed">
              {errorMsg}
            </div>
          )}

          {/* 预设快捷场景模板（仅在新建模式下推荐） */}
          {!automation && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[#85858d] flex items-center gap-1">
                <Sparkles size={11} className="text-[#4f46e5]" />
                <span>快速应用常用模板</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="p-2.5 rounded-[6px] border border-[#e3e3e8] bg-[#fafafc] hover:bg-white hover:border-[#4f46e5]/50 transition-all text-left group cursor-pointer shadow-2xs"
                  >
                    <div className="font-medium text-[11.5px] text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors truncate">
                      {tpl.label}
                    </div>
                    <div className="text-[10px] text-[#85858d] line-clamp-2 mt-0.5 leading-snug">
                      {tpl.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 基本信息 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-[11px] font-medium text-[#85858d]">任务名称 *</label>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: 轮询 CLI 工具 / 监控 GitHub Issue"
                className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[12px] focus:outline-hidden focus:border-[#4f46e5] transition-colors"
                disabled={loading}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-[#85858d]">轮询间隔 (秒) *</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="5"
                  max="86400"
                  value={intervalSec}
                  onChange={(e) => setIntervalSec(Math.max(5, parseInt(e.target.value, 10) || 60))}
                  className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[12px] font-mono focus:outline-hidden focus:border-[#4f46e5] transition-colors"
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#85858d]">任务描述 (可选)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要说明此轮询自动化任务的业务目标"
              className="w-full h-[30px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[12px] focus:outline-hidden focus:border-[#4f46e5] transition-colors"
              disabled={loading}
            />
          </div>

          {/* 轮询数据源类型 */}
          <div className="space-y-2 pt-1 border-t border-[#f1f1f4]">
            <label className="text-[11px] font-medium text-[#85858d]">数据源与触发类型 *</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSourceType('cli_script')}
                className={`h-[34px] px-2.5 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  sourceType === 'cli_script'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <Terminal size={12} strokeWidth={2} />
                <span>CLI 脚本轮询</span>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('github_issues')}
                className={`h-[34px] px-2.5 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  sourceType === 'github_issues'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <GithubIcon size={12} />
                <span>GitHub Issues</span>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('twitter_query')}
                className={`h-[34px] px-2.5 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  sourceType === 'twitter_query'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <TwitterIcon size={12} />
                <span>推特 / 社媒消息</span>
              </button>
            </div>

            {/* 动态配置字段 */}
            {sourceType === 'cli_script' && (
              <div className="space-y-2 p-3 bg-[#fafafc] rounded-[6px] border border-[#e3e3e8]">
                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a] flex items-center justify-between">
                    <span>CLI 命令 / 脚本方法 *</span>
                    <span className="font-mono text-[10px] text-[#a1a1aa]">支持执行本地 cli 工具或 node/sh 脚本</span>
                  </label>
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="例如: gh issue list --limit 5 或 my-cli check 或 git status --short"
                    className="w-full h-[32px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] font-mono text-[11.5px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a]">执行工作区目录 (可选)</label>
                  <input
                    type="text"
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                    placeholder="留空则使用 openLoop 根运行目录"
                    className="w-full h-[30px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] font-mono text-[11px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            {sourceType === 'github_issues' && (
              <div className="space-y-2 p-3 bg-[#fafafc] rounded-[6px] border border-[#e3e3e8]">
                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a]">GitHub Repository (格式: owner/repo) *</label>
                  <input
                    type="text"
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="例如: facebook/react 或 vercel/next.js"
                    className="w-full h-[32px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] font-mono text-[11.5px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a]">GitHub Personal Access Token (私有仓库必填，公开可选)</label>
                  <input
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    className="w-full h-[30px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] font-mono text-[11px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  />
                </div>
              </div>
            )}

            {sourceType === 'twitter_query' && (
              <div className="space-y-2 p-3 bg-[#fafafc] rounded-[6px] border border-[#e3e3e8]">
                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a]">关键词 / 搜索 Query *</label>
                  <input
                    type="text"
                    value={twitterQuery}
                    onChange={(e) => setTwitterQuery(e.target.value)}
                    placeholder="例如: openloop bug 或 #release"
                    className="w-full h-[32px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[11.5px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a]">外部 CLI 工具调用脚本 (可选)</label>
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="例如: twscrape search 'openloop' --limit 5，留空使用内置模拟监听"
                    className="w-full h-[30px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] font-mono text-[11px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 下游联动动作 */}
          <div className="space-y-2 pt-1 border-t border-[#f1f1f4]">
            <label className="text-[11px] font-medium text-[#85858d]">轮询命中后续动作 (Action) *</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setActionType('create_task')}
                className={`h-[34px] px-2 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  actionType === 'create_task'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <Layers size={12} strokeWidth={2} />
                <span>自动创建看板任务</span>
              </button>

              <button
                type="button"
                onClick={() => setActionType('run_workflow')}
                className={`h-[34px] px-2 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  actionType === 'run_workflow'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <Workflow size={12} strokeWidth={2} />
                <span>驱动流水线执行</span>
              </button>

              <button
                type="button"
                onClick={() => setActionType('notify_only')}
                className={`h-[34px] px-2 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  actionType === 'notify_only'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <Timer size={12} strokeWidth={2} />
                <span>仅记录日志</span>
              </button>
            </div>

            {(actionType === 'create_task' || actionType === 'run_workflow') && (
              <div className="grid grid-cols-2 gap-3 p-3 bg-[#fafafc] rounded-[6px] border border-[#e3e3e8]">
                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a]">投递看板泳道</label>
                  <select
                    value={kanbanColumn}
                    onChange={(e) => setKanbanColumn(e.target.value as KanbanColumn)}
                    className="w-full h-[30px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[11.5px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  >
                    <option value="inbox">📥 Inbox (收集箱)</option>
                    <option value="backlog">📋 Backlog (待排期)</option>
                    <option value="in_progress">⚡ In Progress (进行中)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a]">
                    {actionType === 'run_workflow' ? '关联工作流 (必须)' : '关联工作流 (可选)'}
                  </label>
                  <select
                    value={workflowId}
                    onChange={(e) => setWorkflowId(e.target.value)}
                    className="w-full h-[30px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[11.5px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  >
                    {workflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name} ({wf.nodes?.length || 0} 节点)
                      </option>
                    ))}
                    {workflows.length === 0 && <option value="">暂无工作流，将使用默认</option>}
                  </select>
                </div>

                {actionType === 'run_workflow' && (
                  <div className="col-span-2 flex items-center justify-between pt-1">
                    <span className="text-[11px] text-[#52525b]">创建任务后立即自动启动 DAG 引擎</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoRun}
                        onChange={(e) => setAutoRun(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-[#e4e4e7] peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#d4d4d8] after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#4f46e5]" />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 启用开关 */}
          <div className="flex items-center justify-between p-3 rounded-[6px] bg-[#fafafc] border border-[#e3e3e8]">
            <div>
              <div className="text-[11.5px] font-medium text-[#1c1c21]">立即启用调度轮询</div>
              <div className="text-[10.5px] text-[#85858d]">保存后调度器将立即按照指定周期定时自动轮询</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#e4e4e7] peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#d4d4d8] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#059669]" />
            </label>
          </div>
        </form>

        {/* 底部按钮栏 */}
        <div className="h-[46px] px-5 border-t border-[#e3e3e8] flex items-center justify-end gap-2 bg-[#fafafc] shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-[28px] px-3 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#52525b] text-[11.5px] font-medium transition-all cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={loading}
            className="flex items-center gap-1.5 h-[28px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium transition-all shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            <span>{automation ? '保存修改' : '创建任务'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
