import React, { useState, useEffect, useRef } from 'react';
import {
  Zap,
  X,
  Play,
  ArrowRight,
  Workflow as WorkflowIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Terminal,
  RotateCcw,
} from 'lucide-react';
import { WorkflowDefinition, Task, LogEntry } from '@openloop/core';
import { api } from '../services/api';
import { Kbd } from './Kbd';
import { useShortcuts } from '../context/ShortcutContext';

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
  const { superKeyLabel } = useShortcuts();
  const defaultWfId = workflows.find((w) => w.id.includes('febase'))?.id || workflows[0]?.id || '';
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(defaultWfId);
  const [prompt, setPrompt] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<Array<{ stream: string; message: string; nodeId?: string }>>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'success' | 'terminated' | 'failed'>('idle');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);
  const unsubLogRef = useRef<(() => void) | null>(null);
  const unsubTaskRef = useRef<(() => void) | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  const quickChips = [
    {
      label: '🚀 部署至预发 211',
      text: '将 rn-lyric-share-page 分支 feat/OMMUSIC-3825654 部署到预发测试 211 环境',
    },
    {
      label: '🧪 部署至日常测试 100',
      text: '将 rn-lyric-share-page 分支 feat/OMMUSIC-3825654 部署到日常测试 100 环境',
    },
    {
      label: '⚠️ 信息不足测试（拦截）',
      text: '将 rn-lyric-share-page 部署一下',
    },
  ];

  const handleExecute = async () => {
    if (!prompt.trim() || !activeWorkflow || isRunning) return;

    setIsRunning(true);
    setRunStatus('running');
    setRunError(null);
    setLogs([{ stream: 'system', message: `[QuickRun] 正在分发任务至工作流: ${activeWorkflow.name}...` }]);

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

      // 正确订阅 WebSocket 日志事件 log:new
      unsubLogRef.current = api.on('log:new', (entry: LogEntry) => {
        if (entry.taskId === task.id) {
          setLogs((prev) => [...prev, { stream: entry.stream, message: entry.message, nodeId: entry.nodeId }]);
        }
      });

      // 订阅任务更新事件 task:update
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
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault();
      handleExecute();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100 p-4">
      <div className="w-[520px] max-w-full bg-white border border-[#e3e3e8] rounded-[10px] p-4 shadow-[0_16px_40px_rgba(20,22,30,0.14)] text-[#1c1c21] flex flex-col max-h-[88vh]">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-2.5 border-b border-[#ececf0]">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-[4px] bg-[#1c1c21] text-white flex items-center justify-center">
              <Zap size={12} className="fill-white" />
            </div>
            <h3 className="font-semibold text-[13px] text-[#1c1c21]">快捷流水线执行</h3>
            <span className="flex items-center gap-0.5 text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1 py-[0.5px] rounded border border-[#ececf0]">
              <Kbd size="xs" variant="light">{superKeyLabel}</Kbd> + <Kbd size="xs" variant="light">R</Kbd>
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* 表单内容区 */}
        <div className="mt-3 space-y-3 text-[11.5px] flex-1 overflow-y-auto">
          {/* 工作流选择 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-[#63636b] flex items-center gap-1">
                <WorkflowIcon size={12} className="text-[#4f46e5]" />
                目标编排流程
              </label>
              {activeWorkflow && (
                <span className="text-[10px] font-mono text-[#85858d]">
                  {activeWorkflow.nodes.length} 个节点
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {workflows.map((wf) => {
                const isSelected = wf.id === selectedWorkflowId;
                return (
                  <button
                    key={wf.id}
                    type="button"
                    onClick={() => setSelectedWorkflowId(wf.id)}
                    className={`h-[26px] px-2.5 rounded-[5px] text-[11px] font-medium border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#eeedfd] text-[#4f46e5] border-[#c7d2fe] shadow-[0_1px_2px_rgba(79,70,229,0.06)]'
                        : 'bg-[#f9f9fb] text-[#63636b] border-[#e3e3e8] hover:bg-white hover:text-[#1c1c21]'
                    }`}
                  >
                    {wf.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt 输入框 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-[#63636b]">执行需求 Prompt</label>
              <span className="text-[10px] text-[#85858d]">
                按 <Kbd size="xs" variant="light">Enter</Kbd> 执行，<Kbd size="xs" variant="light">Shift+Enter</Kbd> 换行
              </span>
            </div>
            <textarea
              ref={textareaRef}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning}
              placeholder="例如：将 rn-lyric-share-page 分支 feat/OMMUSIC-3825654 部署到预发测试 211 环境..."
              className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2.5 text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 font-mono resize-none leading-relaxed transition-all"
            />

            {/* 快捷示例词 */}
            {!isRunning && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className="text-[10.5px] text-[#85858d]">快捷示例:</span>
                {quickChips.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setPrompt(chip.text);
                      textareaRef.current?.focus();
                    }}
                    className="h-[22px] px-2 rounded-[4px] bg-[#f4f4f6] hover:bg-[#ececf0] text-[10.5px] text-[#4b4b53] border border-[#ececf0] transition-colors cursor-pointer"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 实时执行状态面板 */}
          {runStatus !== 'idle' && (
            <div className="rounded-[6px] border border-[#ececf0] bg-[#fafafc] p-2.5 space-y-2 animate-in fade-in-50 duration-150">
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 font-medium">
                  {runStatus === 'running' && <Loader2 size={13} className="text-[#4f46e5] animate-spin" />}
                  {runStatus === 'success' && <CheckCircle2 size={13} className="text-[#10b981]" />}
                  {runStatus === 'terminated' && <AlertCircle size={13} className="text-[#f59e0b]" />}
                  {runStatus === 'failed' && <AlertCircle size={13} className="text-[#ef4444]" />}

                  <span className={
                    runStatus === 'success' ? 'text-[#10b981]' :
                    runStatus === 'terminated' ? 'text-[#b45309]' :
                    runStatus === 'failed' ? 'text-[#dc2626]' :
                    'text-[#4f46e5]'
                  }>
                    {runStatus === 'running' && '流水线正在执行...'}
                    {runStatus === 'success' && '流水线执行成功！'}
                    {runStatus === 'terminated' && '任务中止：信息不充足'}
                    {runStatus === 'failed' && '流水线执行失败'}
                  </span>
                </div>

                {activeTask && (
                  <span className="text-[10px] font-mono text-[#85858d]">
                    {activeTask.id.slice(0, 18)}...
                  </span>
                )}
              </div>

              {/* 异常/终止信息警示条 */}
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

              {/* 终端实时日志 */}
              <div className="rounded-[5px] bg-white border border-[#e3e3e8] p-2 max-h-36 overflow-y-auto font-mono text-[10.5px] leading-relaxed text-[#4b4b53] space-y-0.5">
                {logs.length === 0 ? (
                  <div className="text-[#85858d] flex items-center gap-1 text-[10px]">
                    <Terminal size={11} /> 等待调度控制台输出...
                  </div>
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
        <div className="pt-3 mt-3 border-t border-[#ececf0] flex items-center justify-between">
          <div>
            {activeTask && onNavigateKanban && (
              <button
                type="button"
                onClick={() => {
                  onNavigateKanban();
                  onClose();
                }}
                className="text-[11px] text-[#4f46e5] hover:text-[#4338ca] flex items-center gap-1 font-medium transition-colors cursor-pointer"
              >
                前往看板跟踪全景 <ArrowRight size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[28px] px-3 rounded-[6px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-xs cursor-pointer"
            >
              关闭
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
                <RotateCcw size={12} /> 重填
              </button>
            ) : null}

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
          </div>
        </div>
      </div>
    </div>
  );
};
