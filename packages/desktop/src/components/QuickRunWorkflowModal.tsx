import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Zap,
  X,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Workflow as WorkflowIcon,
  ChevronDown,
  Search,
  Check,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import { WorkflowDefinition, Task, LogEntry } from '@openloop/core';
import { api } from '../services/api';

interface QuickRunWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflows: WorkflowDefinition[];
  onTaskCreated?: (task: Task) => void;
  onNavigateKanban?: () => void;
}

export const QuickRunWorkflowModal: React.FC<QuickRunWorkflowModalProps> = ({
  isOpen,
  onClose,
  workflows,
  onTaskCreated,
  onNavigateKanban,
}) => {
  const defaultWfId = workflows.find((w) => w.id.includes('febase'))?.id || workflows[0]?.id || '';
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(defaultWfId);
  const [prompt, setPrompt] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<Array<{ stream: string; message: string; nodeId?: string }>>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'success' | 'terminated' | 'failed'>('idle');

  // 下拉选择器与搜索状态
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const dropdownRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);
  const unsubLogRef = useRef<(() => void) | null>(null);
  const unsubTaskRef = useRef<(() => void) | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 点击外部关闭下拉浮层
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

  useEffect(() => {
    if (isOpen) {
      if (!selectedWorkflowId && defaultWfId) {
        setSelectedWorkflowId(defaultWfId);
      }
      setIsRunning(false);
      setActiveTask(null);
      setLogs([]);
      setRunError(null);
      setRunStatus('idle');
      setIsDropdownOpen(false);
      setSearchQuery('');
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    } else {
      if (unsubLogRef.current) {
        unsubLogRef.current();
        unsubLogRef.current = null;
      }
      if (unsubTaskRef.current) {
        unsubTaskRef.current();
        unsubTaskRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
  }, [isOpen, defaultWfId]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const activeWorkflow = workflows.find((w) => w.id === selectedWorkflowId) || workflows[0];

  // 流程搜索过滤
  const filteredWorkflows = useMemo(() => {
    if (!searchQuery.trim()) return workflows;
    const q = searchQuery.toLowerCase().trim();
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q) ||
        (w.description && w.description.toLowerCase().includes(q))
    );
  }, [workflows, searchQuery]);

  const handleSelectWorkflow = (wf: WorkflowDefinition) => {
    setSelectedWorkflowId(wf.id);
    setIsDropdownOpen(false);
    setSearchQuery('');
  };

  const handleExecute = async () => {
    if (!prompt.trim() || !activeWorkflow || isRunning) return;

    setIsRunning(true);
    setRunStatus('running');
    setRunError(null);
    setLogs([{ stream: 'system', message: `[QuickRun] 正在分发任务至: ${activeWorkflow.name}...` }]);

    try {
      const task = await api.createTask({
        workflowId: activeWorkflow.id,
        title: prompt.trim().slice(0, 60),
        description: prompt.trim(),
        kanbanColumn: 'in_progress',
        autoRun: true,
      });

      setActiveTask(task);
      onTaskCreated?.(task);

      unsubLogRef.current = api.on('log:new', (entry: LogEntry) => {
        if (entry.taskId === task.id) {
          setLogs((prev) => [...prev, { stream: entry.stream, message: entry.message, nodeId: entry.nodeId }]);
        }
      });

      unsubTaskRef.current = api.on('task:update', (updatedTask: Task) => {
        if (updatedTask.id === task.id) {
          setActiveTask(updatedTask);
          if (updatedTask.status === 'completed') {
            setIsRunning(false);
            setRunStatus('success');
          } else if (updatedTask.status === 'failed' || updatedTask.status === 'cancelled') {
            setIsRunning(false);
            const runs = Object.values(updatedTask.nodeRuns || {});
            const failedRun = runs.find((r) => r.status === 'failed');
            const lastAssistantMsg = (updatedTask.context?.chatMessages || [])
              .filter((m: any) => m.role === 'assistant' && m.content)
              .pop();
            const abortReasonFromMsg = lastAssistantMsg?.content;

            const errMsg =
              abortReasonFromMsg &&
              (abortReasonFromMsg.includes('中止') ||
                abortReasonFromMsg.includes('信息不充足') ||
                abortReasonFromMsg.includes('缺失'))
                ? abortReasonFromMsg
                : failedRun?.error || '流水线执行未通过';

            if (
              errMsg.includes('信息不充足') ||
              errMsg.includes('部署中止') ||
              errMsg.includes('中止') ||
              errMsg.includes('缺失')
            ) {
              setRunStatus('terminated');
              setRunError(errMsg);
            } else {
              setRunStatus('failed');
              setRunError(errMsg);
            }
          }
        }
      });

      // 兜底状态轮询
      pollTimerRef.current = setInterval(async () => {
        try {
          const current = await api.getTask(task.id);
          setActiveTask(current);

          if (current.status === 'completed') {
            setIsRunning(false);
            setRunStatus('success');
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          } else if (current.status === 'failed' || current.status === 'cancelled') {
            setIsRunning(false);
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);

            const runs = Object.values(current.nodeRuns || {});
            const failedRun = runs.find((r) => r.status === 'failed');
            const lastAssistantMsg = (current.context?.chatMessages || [])
              .filter((m: any) => m.role === 'assistant' && m.content)
              .pop();
            const abortReasonFromMsg = lastAssistantMsg?.content;

            const errMsg =
              abortReasonFromMsg &&
              (abortReasonFromMsg.includes('中止') ||
                abortReasonFromMsg.includes('信息不充足') ||
                abortReasonFromMsg.includes('缺失'))
                ? abortReasonFromMsg
                : failedRun?.error || '流水线执行未通过';

            if (
              errMsg.includes('信息不充足') ||
              errMsg.includes('部署中止') ||
              errMsg.includes('缺失')
            ) {
              setRunStatus('terminated');
              setRunError(errMsg);
            } else {
              setRunStatus('failed');
              setRunError(errMsg);
            }
          }
        } catch {}
      }, 1200);
    } catch (err: any) {
      setIsRunning(false);
      setRunStatus('failed');
      setRunError(err.message || '启动工作流异常');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleExecute();
    } else if (e.key === 'Escape') {
      if (isDropdownOpen) {
        setIsDropdownOpen(false);
      } else {
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] animate-in fade-in duration-100 p-4">
      <div className="w-[460px] max-w-full bg-white border border-[#e3e3e8] rounded-[10px] p-4 shadow-[0_16px_40px_rgba(20,22,30,0.12)] text-[#1c1c21] flex flex-col max-h-[85vh] transition-all">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-2.5 border-b border-[#ececf0]">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-[#1c1c21]" />
            <h3 className="font-semibold text-[13px] text-[#1c1c21]">快捷运行流水线</h3>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="mt-3 space-y-3 text-[11.5px] flex-1 overflow-y-auto">
          {/* 工作流选择下拉控件（支持搜索） */}
          <div className="relative" ref={dropdownRef}>
            <label className="block text-[11px] font-medium text-[#63636b] mb-1">
              目标流程
            </label>

            {/* 触发单行控件 */}
            <div
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`w-full h-[32px] px-2.5 rounded-[6px] border transition-all cursor-pointer flex items-center justify-between select-none ${
                isDropdownOpen
                  ? 'border-[#4f46e5] bg-white ring-1 ring-[#eeedfd]'
                  : 'border-[#e3e3e8] bg-[#f9f9fb] hover:bg-white hover:border-[#b9b9c2]'
              }`}
            >
              {activeWorkflow ? (
                <div className="flex items-center gap-2 min-w-0 flex-1 pr-1">
                  <WorkflowIcon size={12.5} className="text-[#4f46e5] shrink-0" />
                  <span className="font-medium text-[12px] text-[#1c1c21] truncate">
                    {activeWorkflow.name}
                  </span>
                  <span className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1 py-[0.5px] rounded shrink-0">
                    {activeWorkflow.nodes.length} 节点
                  </span>
                </div>
              ) : (
                <span className="text-[#85858d] text-[11.5px]">选择工作流...</span>
              )}

              <ChevronDown
                size={12}
                className={`text-[#85858d] shrink-0 transition-transform duration-150 ${
                  isDropdownOpen ? 'rotate-180 text-[#4f46e5]' : ''
                }`}
              />
            </div>

            {/* 下拉浮层 Popover */}
            {isDropdownOpen && (
              <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-white border border-[#e3e3e8] rounded-[8px] shadow-[0_12px_28px_rgba(20,22,30,0.12)] z-50 max-h-[220px] overflow-hidden flex flex-col p-1 animate-in fade-in zoom-in-95 duration-100">
                {/* 搜索栏 */}
                <div className="px-1 pt-0.5 pb-1 border-b border-[#ececf0] mb-1">
                  <div className="relative">
                    <Search
                      size={11.5}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-[#85858d]"
                    />
                    <input
                      type="text"
                      autoFocus
                      placeholder="搜索工作流..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full h-[24px] bg-[#f4f4f6] focus:bg-white border border-transparent focus:border-[#4f46e5] rounded-[5px] pl-6 pr-2 text-[11px] text-[#1c1c21] placeholder-[#85858d] outline-none transition-all"
                    />
                  </div>
                </div>

                {/* 选项列表 */}
                <div className="overflow-y-auto space-y-0.5 flex-1 pr-0.5">
                  {filteredWorkflows.length === 0 ? (
                    <div className="py-3 text-center text-[11px] text-[#85858d]">
                      未匹配到工作流
                    </div>
                  ) : (
                    filteredWorkflows.map((wf) => {
                      const isSelected = wf.id === selectedWorkflowId;
                      return (
                        <div
                          key={wf.id}
                          onClick={() => handleSelectWorkflow(wf)}
                          className={`px-2 py-1.5 rounded-[5px] cursor-pointer flex items-center justify-between text-[11.5px] transition-colors ${
                            isSelected
                              ? 'bg-[#eeedfd] text-[#4f46e5] font-medium'
                              : 'text-[#1c1c21] hover:bg-[#f4f4f6]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                            <span className="truncate">{wf.name}</span>
                            <span className="text-[9.5px] font-mono text-[#85858d] opacity-75 shrink-0">
                              {wf.nodes.length} 节点
                            </span>
                          </div>
                          {isSelected && <Check size={12} className="text-[#4f46e5] shrink-0" />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Prompt 输入框 */}
          <div>
            <label className="block text-[11px] font-medium text-[#63636b] mb-1">
              需求 Prompt
            </label>
            <textarea
              ref={textareaRef}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning}
              placeholder="输入部署需求，例如：部署 rn-lyric-share-page 分支 feat/xxx 到预发 211 环境..."
              className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2.5 text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 font-mono resize-none leading-relaxed transition-all"
            />
          </div>

          {/* 实时执行状态面板（仅在运行或完成时展示） */}
          {runStatus !== 'idle' && (
            <div className="rounded-[6px] border border-[#ececf0] bg-[#fafafc] p-2.5 space-y-2 animate-in fade-in duration-100">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 font-medium">
                  {runStatus === 'running' && <Loader2 size={12} className="text-[#4f46e5] animate-spin" />}
                  {runStatus === 'success' && <CheckCircle2 size={12} className="text-[#10b981]" />}
                  {runStatus === 'terminated' && <AlertCircle size={12} className="text-[#b45309]" />}
                  {runStatus === 'failed' && <AlertCircle size={12} className="text-[#dc2626]" />}

                  <span
                    className={
                      runStatus === 'success'
                        ? 'text-[#10b981]'
                        : runStatus === 'terminated'
                        ? 'text-[#b45309]'
                        : runStatus === 'failed'
                        ? 'text-[#dc2626]'
                        : 'text-[#4f46e5]'
                    }
                  >
                    {runStatus === 'running' && '正在执行流水线...'}
                    {runStatus === 'success' && '流水线执行成功'}
                    {runStatus === 'terminated' && '任务中止：信息不充足'}
                    {runStatus === 'failed' && '执行未通过'}
                  </span>
                </div>

                {activeTask && onNavigateKanban && (
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateKanban();
                      onClose();
                    }}
                    className="text-[10px] text-[#4f46e5] hover:underline flex items-center gap-0.5 cursor-pointer"
                  >
                    在看板查看 <ExternalLink size={9} />
                  </button>
                )}
              </div>

              {/* 异常/终止说明 */}
              {runError && (
                <div
                  className={`p-2 rounded-[5px] text-[11px] leading-relaxed border ${
                    runStatus === 'terminated'
                      ? 'bg-[#fffbeb] border-[#fde68a] text-[#b45309]'
                      : 'bg-[#fef2f2] border-[#fecaca] text-[#dc2626]'
                  }`}
                >
                  {runError}
                </div>
              )}

              {/* 极简实时日志输出 */}
              <div className="rounded-[5px] bg-white border border-[#e3e3e8] p-2 max-h-32 overflow-y-auto font-mono text-[10px] leading-relaxed text-[#4b4b53] space-y-0.5">
                {logs.length === 0 ? (
                  <div className="text-[#85858d]">等待引擎日志流...</div>
                ) : (
                  logs.map((log, idx) => (
                    <div
                      key={idx}
                      className={
                        log.stream === 'stderr'
                          ? 'text-[#dc2626]'
                          : log.stream === 'system'
                          ? 'text-[#4f46e5] font-medium'
                          : 'text-[#4b4b53]'
                      }
                    >
                      {log.nodeId && <span className="text-[#85858d] mr-1">[{log.nodeId}]</span>}
                      {log.message}
                    </div>
                  ))
                )}
                <div ref={logBottomRef} />
              </div>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="pt-2.5 mt-3 border-t border-[#ececf0] flex items-center justify-between">
          <span className="text-[10.5px] text-[#85858d]">
            按 ⌘ / Ctrl + Enter 执行
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[28px] px-3 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-xs cursor-pointer"
            >
              {runStatus === 'success' ? '完成' : '取消'}
            </button>

            {runStatus === 'terminated' || runStatus === 'failed' ? (
              <button
                type="button"
                onClick={() => {
                  setRunStatus('idle');
                  setRunError(null);
                  textareaRef.current?.focus();
                }}
                className="h-[28px] px-3 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] flex items-center gap-1 transition-all shadow-xs cursor-pointer"
              >
                <RotateCcw size={11} /> 修改需求
              </button>
            ) : null}

            {runStatus !== 'success' && (
              <button
                type="button"
                onClick={handleExecute}
                disabled={!prompt.trim() || isRunning}
                className="h-[28px] px-3.5 bg-[#1c1c21] hover:bg-[#2e2f36] text-[11.5px] font-medium text-white rounded-[6px] flex items-center gap-1.5 transition-all active:scale-95 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {isRunning ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> 执行中...
                  </>
                ) : (
                  <>
                    <Play size={11} className="fill-white" /> 立即执行
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
