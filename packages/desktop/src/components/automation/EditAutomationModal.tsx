import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Save,
  Timer,
  Terminal,
  Workflow,
  Sparkles,
  Loader2,
  Layers,
  Clock,
  Zap,
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
  AutomationSourceConfig,
  AutomationActionConfig,
  WorkflowDefinition,
  KanbanColumn,
} from '@openloop/core';
import { INTERVAL_PRESETS, formatInterval } from '../../utils/automationDraft';

export interface EditAutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  automation: AutomationTask | null;
  /** 一句话解析生成的草稿，仅在新建时生效 */
  draft?: Partial<AutomationTask> | null;
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
  sourceConfig: AutomationSourceConfig;
  actionConfig: AutomationActionConfig;
}> = [
  {
    id: 'tpl_schedule',
    label: '定时扫描 → 流水线',
    desc: '按周期触发流水线，Agent 完成扫描与判断',
    sourceType: 'schedule',
    actionType: 'run_workflow',
    intervalSec: 1800,
    sourceConfig: {},
    actionConfig: { autoRun: true, directRun: true },
  },
  {
    id: 'tpl_cli',
    label: 'CLI 工具轮询',
    desc: '定时执行 CLI 命令，结果入看板',
    sourceType: 'cli_script',
    actionType: 'create_task',
    intervalSec: 60,
    sourceConfig: { command: 'git status --short' },
    actionConfig: {
      kanbanColumn: 'inbox',
      titleTemplate: '[CLI 轮询] {{title}}',
      autoRun: false,
    },
  },
  {
    id: 'tpl_gh',
    label: 'GitHub Issue 监控',
    desc: '拉取最新 Issues，自动创建看板任务',
    sourceType: 'github_issues',
    actionType: 'create_task',
    intervalSec: 120,
    sourceConfig: { repo: 'facebook/react' },
    actionConfig: { kanbanColumn: 'inbox', titleTemplate: '{{title}}', autoRun: false },
  },
  {
    id: 'tpl_twitter',
    label: '社媒关键词监听',
    desc: '监听社媒关键词，命中后直接驱动流水线',
    sourceType: 'twitter_query',
    actionType: 'run_workflow',
    intervalSec: 300,
    sourceConfig: { twitterQuery: 'openloop release' },
    actionConfig: { autoRun: true, directRun: true },
  },
];

export const EditAutomationModal: React.FC<EditAutomationModalProps> = ({
  isOpen,
  onClose,
  automation,
  draft,
  workflows,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [intervalSec, setIntervalSec] = useState(1800);
  const [sourceType, setSourceType] = useState<AutomationSourceType>('schedule');
  const [scanGoal, setScanGoal] = useState('');
  const [command, setCommand] = useState('');
  const [cwd, setCwd] = useState('');
  const [repo, setRepo] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [twitterQuery, setTwitterQuery] = useState('');
  const [actionType, setActionType] = useState<AutomationActionType>('run_workflow');
  const [workflowId, setWorkflowId] = useState('');
  const [kanbanColumn, setKanbanColumn] = useState<KanbanColumn>('inbox');
  const [titleTemplate, setTitleTemplate] = useState('');
  const [autoRun, setAutoRun] = useState(true);
  const [directRun, setDirectRun] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const initial = automation || (draft as AutomationTask | undefined);
    if (initial) {
      setName(initial.name || '');
      setDescription(initial.description || '');
      setEnabled(initial.enabled !== false);
      setIntervalSec(initial.intervalSec || 1800);
      setSourceType(initial.sourceType || 'schedule');
      setScanGoal(initial.sourceConfig?.prompt || '');
      setCommand(initial.sourceConfig?.command || '');
      setCwd(initial.sourceConfig?.cwd || '');
      setRepo(initial.sourceConfig?.repo || '');
      setGithubToken(initial.sourceConfig?.githubToken || '');
      setTwitterQuery(initial.sourceConfig?.twitterQuery || '');
      setActionType(initial.actionType || 'run_workflow');
      setWorkflowId(initial.actionConfig?.workflowId || (workflows[0]?.id ?? ''));
      setKanbanColumn((initial.actionConfig?.kanbanColumn as KanbanColumn) || 'inbox');
      setTitleTemplate(initial.actionConfig?.titleTemplate || '');
      setAutoRun(initial.actionConfig?.autoRun !== false);
      setDirectRun(initial.actionConfig?.directRun !== false);
    } else {
      // 新建默认值：定时驱动流水线 + 不落看板
      setName('');
      setDescription('');
      setEnabled(true);
      setIntervalSec(1800);
      setSourceType('schedule');
      setScanGoal('');
      setCommand('git status --short');
      setCwd('');
      setRepo('');
      setGithubToken('');
      setTwitterQuery('');
      setActionType('run_workflow');
      setWorkflowId(workflows[0]?.id || '');
      setKanbanColumn('inbox');
      setTitleTemplate('');
      setAutoRun(true);
      setDirectRun(true);
    }
    setErrorMsg(null);
  }, [automation, draft, isOpen, workflows]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // 快捷套用模板
  const applyTemplate = (tpl: (typeof TEMPLATES)[0]) => {
    setName(`${tpl.label} 自动化`);
    setDescription(tpl.desc);
    setSourceType(tpl.sourceType);
    setActionType(tpl.actionType);
    setIntervalSec(tpl.intervalSec);
    setScanGoal(tpl.sourceConfig.prompt || '');
    if (tpl.sourceConfig.command) setCommand(tpl.sourceConfig.command);
    if (tpl.sourceConfig.repo) setRepo(tpl.sourceConfig.repo);
    if (tpl.sourceConfig.twitterQuery) setTwitterQuery(tpl.sourceConfig.twitterQuery);
    if (tpl.actionConfig.kanbanColumn) setKanbanColumn(tpl.actionConfig.kanbanColumn);
    if (tpl.actionConfig.titleTemplate) setTitleTemplate(tpl.actionConfig.titleTemplate);
    if (tpl.actionConfig.autoRun !== undefined) setAutoRun(tpl.actionConfig.autoRun);
    setDirectRun(Boolean(tpl.actionConfig.directRun));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMsg('请输入自动化任务名称');
      return;
    }

    if (sourceType === 'cli_script' && !command.trim()) {
      setErrorMsg('请输入需要定时执行的 CLI 脚本或命令');
      return;
    }
    if (sourceType === 'github_issues' && !repo.trim()) {
      setErrorMsg('请输入需要监控的 GitHub 仓库 (如: facebook/react)');
      return;
    }
    if (sourceType === 'twitter_query' && !twitterQuery.trim()) {
      setErrorMsg('请输入社媒搜索关键词或用户名');
      return;
    }
    if (actionType === 'run_workflow' && workflows.length === 0) {
      setErrorMsg('还没有可用流水线，请先在「流程编排」中创建一条流水线');
      return;
    }
    if (actionType === 'run_workflow' && !workflowId) {
      setErrorMsg('请选择要驱动的流水线');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const sourceConfig: AutomationSourceConfig = {};
      if (sourceType === 'schedule') {
        if (scanGoal.trim()) sourceConfig.prompt = scanGoal.trim();
      } else if (sourceType === 'cli_script') {
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

      const actionConfig: AutomationActionConfig = {
        kanbanColumn,
        autoRun,
        directRun: actionType === 'run_workflow' ? directRun : false,
      };
      if (workflowId) actionConfig.workflowId = workflowId;
      if (titleTemplate.trim()) actionConfig.titleTemplate = titleTemplate.trim();

      await onSave({
        id: automation?.id,
        name: trimmedName,
        description: description.trim() || undefined,
        enabled,
        intervalSec: Number(intervalSec) || 1800,
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] animate-fadeIn select-none"
      onClick={() => {
        if (!loading) {
          if (import.meta.env?.DEV) {
            console.log('[EditAutomationModal] 点击蒙层关闭弹窗');
          }
          onClose();
        }
      }}
    >
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

          {draft && !automation && (
            <div className="px-3 py-2 bg-[#eeedfd] border border-[#c7c4f8] text-[#4f46e5] rounded-[6px] text-[11.5px] leading-relaxed flex items-center gap-1.5">
              <Sparkles size={12} className="shrink-0" />
              <span>已根据描述生成草稿，确认关联流水线后保存即开始定时运行</span>
            </div>
          )}

          {/* 预设快捷场景模板（仅在新建模式下推荐） */}
          {!automation && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[#85858d] flex items-center gap-1">
                <Sparkles size={11} className="text-[#4f46e5]" />
                <span>快速应用常用模板</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="px-2.5 py-2 rounded-[6px] border border-[#e3e3e8] bg-[#fafafc] hover:bg-white hover:border-[#4f46e5]/50 transition-all text-left group cursor-pointer shadow-2xs"
                  >
                    <div className="font-medium text-[11.5px] text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors truncate">
                      {tpl.label}
                    </div>
                    <div className="text-[10px] text-[#85858d] line-clamp-1 mt-0.5 leading-snug">
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
                placeholder="例如: 扫描小红书上「艮兴嘉苑」租房帖子"
                className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[12px] focus:outline-hidden focus:border-[#4f46e5] transition-colors"
                disabled={loading}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-[#85858d] flex items-center justify-between">
                <span>触发周期 (秒) *</span>
                <span className="text-[10px] text-[#a1a1aa] font-mono">= 每 {formatInterval(intervalSec)}</span>
              </label>
              <input
                type="number"
                min="5"
                max="86400"
                value={intervalSec}
                onChange={(e) => setIntervalSec(Math.max(5, parseInt(e.target.value, 10) || 1800))}
                className="w-full h-[32px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[12px] font-mono focus:outline-hidden focus:border-[#4f46e5] transition-colors"
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {INTERVAL_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setIntervalSec(preset)}
                className={`h-[22px] px-2 rounded-[4px] border text-[10.5px] transition-all cursor-pointer ${
                  intervalSec === preset
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#71717a] hover:bg-[#fafafc]'
                }`}
              >
                {formatInterval(preset)}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#85858d]">任务描述 (可选)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简述业务目标，会与扫描目标一起注入流水线上下文"
              className="w-full h-[30px] px-2.5 rounded-[6px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[12px] focus:outline-hidden focus:border-[#4f46e5] transition-colors"
              disabled={loading}
            />
          </div>

          {/* 触发方式 */}
          <div className="space-y-2 pt-1 border-t border-[#f1f1f4]">
            <label className="text-[11px] font-medium text-[#85858d]">触发方式 *</label>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setSourceType('schedule')}
                className={`h-[34px] px-2 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  sourceType === 'schedule'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <Clock size={12} strokeWidth={2} />
                <span>定时触发</span>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('cli_script')}
                className={`h-[34px] px-2 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  sourceType === 'cli_script'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <Terminal size={12} strokeWidth={2} />
                <span>CLI 轮询</span>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('github_issues')}
                className={`h-[34px] px-2 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  sourceType === 'github_issues'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <GithubIcon size={12} />
                <span>GitHub</span>
              </button>

              <button
                type="button"
                onClick={() => setSourceType('twitter_query')}
                className={`h-[34px] px-2 rounded-[6px] border flex items-center justify-center gap-1.5 transition-all text-[11.5px] cursor-pointer ${
                  sourceType === 'twitter_query'
                    ? 'border-[#4f46e5] bg-[#eeedfd] text-[#4f46e5] font-medium'
                    : 'border-[#e3e3e8] bg-white text-[#52525b] hover:bg-[#fafafc]'
                }`}
              >
                <TwitterIcon size={12} />
                <span>社媒监听</span>
              </button>
            </div>

            {/* 动态配置字段 */}
            {sourceType === 'schedule' && (
              <div className="space-y-2 p-3 bg-[#fafafc] rounded-[6px] border border-[#e3e3e8]">
                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a] flex items-center justify-between">
                    <span>扫描 / 执行目标 (注入流水线上下文)</span>
                    <span className="text-[10px] text-[#a1a1aa]">抓取与判断由流水线内的 Agent 节点完成</span>
                  </label>
                  <textarea
                    value={scanGoal}
                    onChange={(e) => setScanGoal(e.target.value)}
                    rows={2}
                    placeholder="例如: 扫描小红书上关于「艮兴嘉苑」租房的帖子，筛出真实房源并整理成清单"
                    className="w-full px-2.5 py-1.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[11.5px] leading-relaxed resize-none focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  />
                </div>
              </div>
            )}

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
                    placeholder="例如: twscrape search 'openloop' --limit 5"
                    className="w-full h-[30px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] font-mono text-[11px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 触发后动作 */}
          <div className="space-y-2 pt-1 border-t border-[#f1f1f4]">
            <label className="text-[11px] font-medium text-[#85858d]">触发后动作 (Action) *</label>
            <div className="grid grid-cols-3 gap-2">
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
                <span>驱动流水线</span>
              </button>

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
                <span>写入看板</span>
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
              <div className="space-y-2 p-3 bg-[#fafafc] rounded-[6px] border border-[#e3e3e8]">
                <div className="space-y-1">
                  <label className="text-[10.5px] font-medium text-[#71717a]">
                    {actionType === 'run_workflow' ? '关联流水线 (必须)' : '关联流水线 (可选)'}
                  </label>
                  <select
                    value={workflowId}
                    onChange={(e) => setWorkflowId(e.target.value)}
                    className="w-full h-[30px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] text-[11.5px] focus:outline-hidden focus:border-[#4f46e5]"
                    disabled={loading}
                  >
                    {workflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name}
                      </option>
                    ))}
                    {workflows.length === 0 && <option value="">暂无流水线</option>}
                  </select>
                </div>

                {actionType === 'run_workflow' && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Zap size={11} className="text-[#4f46e5]" />
                      <div>
                        <div className="text-[11px] text-[#1c1c21] font-medium leading-tight">直连运行，不落看板</div>
                        <div className="text-[10px] text-[#85858d] leading-tight mt-0.5">
                          任务只存活于自动化 Tab，看板保持干净
                        </div>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={directRun}
                        onChange={(e) => setDirectRun(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-[#e4e4e7] peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#d4d4d8] after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#4f46e5]" />
                    </label>
                  </div>
                )}

                {!directRun && (
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
                )}

                {actionType === 'run_workflow' && (
                  <div className="flex items-center justify-between pt-0.5">
                    <span className="text-[11px] text-[#52525b]">触发后立即自动启动流水线</span>
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
              <div className="text-[11.5px] font-medium text-[#1c1c21]">保存后立即启用</div>
              <div className="text-[10.5px] text-[#85858d]">调度器将按指定周期自动运行，无需人工介入</div>
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
