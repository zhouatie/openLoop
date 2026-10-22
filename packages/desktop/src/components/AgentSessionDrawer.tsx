import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Bot,
  Sparkles,
  Terminal,
  ChevronDown,
  ChevronRight,
  Check,
  AlertCircle,
  Play,
  Pause,
  Send,
  Loader2,
  Copy,
  RefreshCw,
  ExternalLink,
  FlaskConical,
  Cpu,
  MessageSquare,
} from 'lucide-react';
import { TaskSessionState, SessionChatMessage } from '@openloop/core';
import { getAgentProviderMeta, getDefaultResumeCommand } from '@openloop/agent-providers';
import { api } from '../services/api';
import { AgentMarkdown } from './AgentMarkdown';
import { AgentAwaitingInputBar } from './AgentAwaitingInputBar';
import { toast } from './Toast';
import { useChatAutoScroll } from '../hooks/useChatAutoScroll';
import { ChatScrollToLatestButton } from './ChatScrollToLatestButton';

export interface AgentSessionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string | null;
  taskTitle?: string;
  nodeId?: string;
  nodeName?: string;
  workspace?: string;
}

export const AgentSessionDrawer: React.FC<AgentSessionDrawerProps> = ({
  isOpen,
  onClose,
  taskId,
  taskTitle,
  nodeId,
  nodeName,
  workspace,
}) => {
  const [sessionState, setSessionState] = useState<TaskSessionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isTogglingPause, setIsTogglingPause] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [expandedQaAttachments, setExpandedQaAttachments] = useState<Record<string, boolean>>({});
  const [defaultModel, setDefaultModel] = useState<string>('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 加载系统配置中的默认模型并监听变更
  useEffect(() => {
    api.getSettings()
      .then((s) => {
        if (s?.defaultModel) {
          setDefaultModel(s.defaultModel);
          if (import.meta.env?.DEV) {
            console.log('[AgentSessionDrawer] 加载系统默认模型配置:', s.defaultModel);
          }
        }
      })
      .catch((err) => {
        if (import.meta.env?.DEV) {
          console.warn('[AgentSessionDrawer] 获取系统设置模型失败:', err);
        }
      });

    const unsub = api.on('settings:update', (updated: any) => {
      if (updated?.defaultModel !== undefined) {
        setDefaultModel(updated.defaultModel);
        if (import.meta.env?.DEV) {
          console.log('[AgentSessionDrawer] 实时更新默认模型配置:', updated.defaultModel);
        }
      }
    });
    return () => unsub();
  }, []);

  const effectiveChatModel = useMemo(() => {
    return sessionState?.model?.trim() || defaultModel?.trim() || '默认模型';
  }, [sessionState?.model, defaultModel]);

  const {
    containerRef: chatScrollContainerRef,
    bottomRef: chatEndRef,
    isAtBottom: isChatAtBottom,
    hasNewOutput: hasNewChatOutput,
    handleScroll: handleChatScroll,
    handleWheel: handleChatWheel,
    scrollToBottom: scrollChatToBottom,
  } = useChatAutoScroll({
    dataKey: sessionState,
    isActive: isOpen && !!taskId,
    resetKey: taskId,
  });

  // 加载会话数据
  const loadSession = async (silent = false) => {
    if (!taskId) return;
    if (!silent) setLoading(true);
    try {
      const data = await api.getTaskSession(taskId);
      setSessionState(data);
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.warn('[AgentSessionDrawer] 获取会话状态失败:', err);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // 展开抽屉或切换任务时拉取会话并订阅实时推送
  useEffect(() => {
    setExpandedThinking({});
    setExpandedTools({});
    if (!isOpen || !taskId) {
      setSessionState(null);
      setChatInput('');
      return;
    }

    loadSession(false);

    // 订阅 WebSocket agent:chat_update 实时推送
    const unsub = api.on('agent:chat_update', (data: TaskSessionState) => {
      if (data.taskId === taskId) {
        setSessionState(data);
      }
    });

    return () => {
      unsub();
    };
  }, [isOpen, taskId]);


  // 按 Esc 键关闭抽屉 (使用捕获阶段阻止冒泡，避免关闭底层弹窗)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  // 发送插话 / 引导消息
  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text || !taskId || isSending) return;

    setIsSending(true);
    scrollChatToBottom(true);
    if (import.meta.env?.DEV) {
      console.log('[AgentSessionDrawer] 发送会话消息:', { taskId, text });
    }

    // 乐观更新
    setSessionState((prev) =>
      prev
        ? {
            ...prev,
            isBusy: true,
            awaitingInput: false,
            messages: [
              ...prev.messages,
              {
                id: `opt_${Date.now()}`,
                role: 'user',
                content: text,
                timestamp: Date.now(),
              },
            ],
          }
        : prev
    );

    try {
      await api.sendTaskChatMessage(taskId, text);
      setChatInput('');
      toast('已向 Agent 发送引导消息', 'success');
      loadSession(true);
    } catch (err: any) {
      toast(err?.message || '发送消息失败', 'error');
    } finally {
      setIsSending(false);
    }
  };

  // 确认 Agent 方案，向 Agent 发送确认指令，启动执行状态
  const handleConfirmPlan = async (prompt = '方案已确认，请开始执行编码实现。') => {
    if (!taskId) return;
    if (import.meta.env?.DEV) {
      console.log('[AgentSessionDrawer] 用户确认方案，发送确认指令以开始执行:', { taskId, prompt });
    }
    // 乐观更新
    setSessionState((prev) =>
      prev
        ? {
            ...prev,
            awaitingInput: false,
            isBusy: true,
            messages: [
              ...prev.messages,
              {
                id: `opt_${Date.now()}`,
                role: 'user',
                content: prompt,
                timestamp: Date.now(),
              },
            ],
          }
        : prev
    );
    try {
      await api.sendTaskChatMessage(taskId, prompt);
      toast('方案已确认，Agent 已开始执行', 'success');
      await loadSession(true);
    } catch (err: any) {
      toast(err?.message || '启动执行失败', 'error');
      await loadSession(true);
    }
  };

  // 确认当前节点已完成，手动放行流水线（兜底跳过）
  const handleConfirmComplete = async () => {
    if (!taskId) return;
    if (import.meta.env?.DEV) {
      console.log('[AgentSessionDrawer] 请求跳过节点并放行流水线:', { taskId, nodeId });
    }
    try {
      // 乐观更新：提示条立即消失，无需等待下游节点调度完成
      setSessionState((prev) =>
        prev ? { ...prev, awaitingInput: false, isBusy: true } : prev
      );
      await api.completeNode(taskId, nodeId);
      toast('已跳过当前节点，流水线继续推进', 'info');
      await loadSession(true);
    } catch (err: any) {
      toast(err?.message || '放行失败', 'error');
      await loadSession(true);
    }
  };

  // 切换暂停 / 继续
  const handleTogglePause = async () => {
    if (!taskId || isTogglingPause || !sessionState) return;
    setIsTogglingPause(true);
    try {
      if (sessionState.isPaused) {
        await api.resumeTaskSession(taskId);
        toast('已恢复 Agent 会话推进', 'info');
      } else {
        await api.pauseTaskSession(taskId);
        toast('已暂停 Agent 执行', 'info');
      }
      await loadSession(true);
    } catch (err: any) {
      toast(err?.message || '操作失败', 'error');
    } finally {
      setIsTogglingPause(false);
    }
  };

  // 解析出真实生效的 Session ID
  const effectiveSessionId =
    sessionState?.sessionId || sessionState?.piSessionId || (taskId ? `session_${taskId}` : '');

  // 复制终端接管命令
  const handleCopyTerminalCommand = () => {
    const sid = effectiveSessionId;
    if (!sid) return;
    const baseCmd =
      sessionState?.resumeCommand || getDefaultResumeCommand(sessionState?.agentProvider, sid);
    const cmd = workspace ? `cd "${workspace}" && ${baseCmd}` : baseCmd;
    navigator.clipboard.writeText(cmd);
    toast('已复制终端接管指令: ' + cmd, 'success');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩背景 */}
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-[1px] animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* 侧滑抽屉面板 */}
      <aside
        className="relative z-50 w-full sm:w-[560px] md:w-[620px] h-full bg-white border-l border-[#e3e3e8] shadow-[0_0_36px_rgba(0,0,0,0.12)] flex flex-col animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="px-5 py-3.5 border-b border-[#ececf0] bg-[#fafafc] shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-[7px] bg-[#eeedfd] text-[#7c3aed] flex items-center justify-center shrink-0 shadow-2xs">
                <Bot size={14} strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-[#1c1c21] truncate">
                    Agent 交互会话
                  </h3>
                  {sessionState?.agentProvider && (
                    <span className="text-[10px] font-mono px-1.5 py-[1px] rounded bg-[#f4f4f6] text-[#52525b] border border-[#e3e3e8]">
                      {getAgentProviderMeta(sessionState.agentProvider).label}
                    </span>
                  )}
                  {nodeName && (
                    <span className="text-[10.5px] font-mono px-1.5 py-[1px] rounded bg-[#f1f1f4] text-[#4b4b53] border border-[#e3e3e8] truncate max-w-[160px]">
                      {nodeName}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#85858d] truncate mt-0.5">
                  {taskTitle ? `调试任务: ${taskTitle}` : `任务 ID: ${taskId}`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* 运行状态微徽章 */}
              {sessionState?.isBusy ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10px] font-medium border border-[#bfdbfe]/60">
                  <Loader2 size={10} className="animate-spin" />
                  <span>执行中</span>
                </span>
              ) : sessionState?.isPaused ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fffbeb] text-[#d97706] text-[10px] font-medium border border-[#fde68a]">
                  <Pause size={10} />
                  <span>已暂停</span>
                </span>
              ) : sessionState?.awaitingInput ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eef2ff] text-[#4338ca] text-[10px] font-medium border border-[#c7d2fe]">
                  <MessageSquare size={10} />
                  <span>等待你的回复</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                  <Check size={10} />
                  <span>就绪 / 空闲</span>
                </span>
              )}

              {/* 刷新按钮 */}
              <button
                type="button"
                onClick={() => loadSession(false)}
                disabled={loading}
                className="w-7 h-7 rounded-[5px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
                title="刷新会话数据"
              >
                <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              </button>

              {/* 关闭按钮 */}
              <button
                type="button"
                onClick={onClose}
                className="w-7 h-7 rounded-[5px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
                title="关闭抽屉"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* 会话 ID 与快捷操作工具条 */}
          <div className="mt-2.5 pt-2 border-t border-[#ececf0] flex items-center justify-between text-[11px] text-[#85858d]">
            <div className="flex items-center gap-1.5 font-mono truncate mr-2">
              <span>Session:</span>
              <span
                className="bg-white px-1.5 py-0.5 rounded border border-[#e3e3e8] text-[#1c1c21] text-[10.5px] truncate max-w-[260px]"
                title={effectiveSessionId || '等待分配...'}
              >
                {effectiveSessionId || (sessionState?.isBusy ? '分配中...' : '无独立 Session ID')}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {effectiveSessionId && (
                <button
                  type="button"
                  onClick={handleCopyTerminalCommand}
                  className="h-[22px] px-2 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] text-[10.5px] flex items-center gap-1 transition-all cursor-pointer"
                  title="复制在本地终端接管调试该 Session 的命令"
                >
                  <Copy size={10.5} />
                  <span>终端接管</span>
                </button>
              )}

              {sessionState?.isBusy && (
                <button
                  type="button"
                  disabled={isTogglingPause}
                  onClick={handleTogglePause}
                  className="h-[22px] px-2 rounded-[4px] border border-[#e3e3e8] bg-white hover:bg-[#fee2e2] text-[#4b4b53] hover:text-[#d64545] text-[10.5px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                  title="暂停智能体当前思考与执行"
                >
                  <Pause size={10} />
                  <span>{isTogglingPause ? '正在暂停...' : '暂停'}</span>
                </button>
              )}

              {sessionState?.isPaused && (
                <button
                  type="button"
                  disabled={isTogglingPause}
                  onClick={handleTogglePause}
                  className="h-[22px] px-2 rounded-[4px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[10.5px] font-medium flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                  title="恢复智能体会话继续推进"
                >
                  <Play size={10} strokeWidth={2.4} />
                  <span>{isTogglingPause ? '正在恢复...' : '继续'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 消息滚动流列表区与查看最新浮动指示器 */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            ref={chatScrollContainerRef}
            onScroll={handleChatScroll}
            onWheel={handleChatWheel}
            className="flex-1 overflow-y-auto p-4 space-y-3.5 min-h-0 text-[12px] bg-[#fafafc]"
          >
          {loading && !sessionState ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-[#85858d]">
              <Loader2 size={24} className="animate-spin text-[#7c3aed] mb-2" />
              <div className="text-[12px]">正在加载会话历史与实时思考流...</div>
            </div>
          ) : !sessionState?.messages || sessionState.messages.length === 0 ? (
            <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center p-8 text-[#85858d]">
              <div className="w-12 h-12 rounded-[10px] bg-white border border-[#e3e3e8] shadow-2xs flex items-center justify-center mb-3">
                <Bot size={22} className="text-[#85858d]" />
              </div>
              <div className="text-[13px] font-medium text-[#1c1c21] mb-1">
                暂无 Agent 交互消息记录
              </div>
              <div className="text-[11.5px] text-[#85858d] leading-relaxed max-w-[320px]">
                启动编排调试且该 Agent 节点被调度执行后，智能体的深度思考、工具调用与代码生成将在此实时流式展现。
              </div>
            </div>
          ) : (
            sessionState.messages.map((msg, msgIdx) => {
              if (msg.role === 'user') {
                const qaMarkerMatch = msg.content?.match(/\[(?:系统自动附加|用户主动附带|附带)：?最新 UI 自动化测试产物\]/);
                const qaMarkerIndex = qaMarkerMatch ? msg.content.indexOf(qaMarkerMatch[0]) : -1;
                const userText = qaMarkerIndex !== -1 ? msg.content.slice(0, qaMarkerIndex).trim() : msg.content;
                const qaText = qaMarkerIndex !== -1 ? msg.content.slice(qaMarkerIndex).trim() : '';

                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-[9px] px-3.5 py-2.5 bg-white border border-[#e3e3e8] text-[#1c1c21] text-[12px] leading-relaxed shadow-2xs">
                      <div className="text-[9.5px] font-mono text-[#85858d] mb-1 text-right font-medium">
                        YOU / PROMPT
                      </div>
                      {userText && <div className="whitespace-pre-wrap">{userText}</div>}
                      {qaText && (
                        <div className={`${userText ? 'mt-2 pt-2 border-t border-[#e6e6ec]' : ''}`}>
                          <button
                            type="button"
                            onClick={() => setExpandedQaAttachments((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] bg-[#eeedfd] border border-[#c7d2fe] text-[#4f46e5] text-[10.5px] font-medium hover:bg-[#e0e0fc] transition-colors cursor-pointer"
                          >
                            <FlaskConical size={10.5} />
                            <span>随附 UI 自动化测试产物</span>
                            {expandedQaAttachments[msg.id] ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          </button>
                          {expandedQaAttachments[msg.id] && (
                            <div className="mt-1.5 p-2 rounded-[5px] bg-[#f9f9fb] border border-[#e3e3e8] font-mono text-[10px] text-[#63636b] leading-relaxed whitespace-pre-wrap max-h-[160px] overflow-y-auto">
                              {qaText}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="space-y-2">
                  {/* 深度思考模块 Thinking */}
                  {msg.thinking && (
                    <div className="rounded-[7px] border border-[#e8e8ed] bg-white overflow-hidden text-[11px] shadow-2xs">
                      <button
                        type="button"
                        onClick={() => {
                          if (import.meta.env.DEV) {
                            console.log('[AgentSessionDrawer] 切换思考过程展开:', { msgId: msg.id, current: !!expandedThinking[msg.id] });
                          }
                          setExpandedThinking((p) => ({ ...p, [msg.id]: !p[msg.id] }));
                        }}
                        className="w-full px-2.5 py-1.5 flex items-center justify-between text-[#63636b] hover:bg-[#f8f8fa] transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <Sparkles
                            size={11}
                            className={
                              msg.isThinking
                                ? 'text-[#7c3aed] animate-spin'
                                : 'text-[#7c3aed]'
                            }
                          />
                          <span className="font-medium text-[11px]">
                            {msg.isThinking ? '智能体深度思考中...' : '深度思考过程'}
                          </span>
                          {msg.isThinking && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-pulse" />
                          )}
                        </div>
                        {expandedThinking[msg.id] ? (
                          <ChevronDown size={11} />
                        ) : (
                          <ChevronRight size={11} />
                        )}
                      </button>
                      {expandedThinking[msg.id] && (
                        <div className="p-2.5 border-t border-[#ececf0] bg-[#f8f9fa] font-mono text-[10.5px] text-[#4b4b53] leading-relaxed whitespace-pre-wrap max-h-[220px] overflow-y-auto">
                          {msg.thinking}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 工具调用卡片 Tools */}
                  {msg.tools && msg.tools.length > 0 && (
                    <div className="space-y-1.5">
                      {msg.tools.map((tool) => (
                        <div
                          key={tool.id}
                          className="rounded-[6px] border border-[#e3e3e8] bg-white overflow-hidden text-[11px] shadow-2xs"
                        >
                          <div
                            onClick={() => {
                              if (import.meta.env.DEV) {
                                console.log('[AgentSessionDrawer] 切换工具输出展开:', { toolId: tool.id, toolName: tool.name });
                              }
                              setExpandedTools((p) => ({ ...p, [tool.id]: !p[tool.id] }));
                            }}
                            className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#f9f9fb] transition-colors"
                          >
                            <div className="flex items-center gap-1.5 truncate mr-2">
                              <Terminal size={11} className="text-[#4f46e5] shrink-0" />
                              <span className="font-mono font-semibold text-[#1c1c21]">
                                {tool.name}
                              </span>
                              {tool.args && (
                                <span className="font-mono text-[#85858d] truncate max-w-[240px]">
                                  {typeof tool.args === 'string'
                                    ? tool.args
                                    : JSON.stringify(tool.args)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {tool.status === 'running' ? (
                                <span className="text-[#4f46e5] flex items-center gap-1 text-[10px]">
                                  <Loader2 size={10} className="animate-spin text-[#4f46e5]" />
                                  执行中
                                </span>
                              ) : tool.status === 'success' ? (
                                <span className="text-[#189a58] flex items-center gap-0.5 text-[10px]">
                                  <Check size={10.5} />
                                  {tool.durationMs
                                    ? `${(tool.durationMs / 1000).toFixed(1)}s`
                                    : '完成'}
                                </span>
                              ) : (
                                <span className="text-[#d64545] flex items-center gap-0.5 text-[10px]">
                                  <AlertCircle size={10.5} />
                                  失败
                                </span>
                              )}
                              {expandedTools[tool.id] ? (
                                <ChevronDown size={11} className="text-[#85858d]" />
                              ) : (
                                <ChevronRight size={11} className="text-[#85858d]" />
                              )}
                            </div>
                          </div>
                          {expandedTools[tool.id] && (
                            <div className="p-2 border-t border-[#ececf0] bg-[#1c1c21] text-[#e3e3e8] font-mono text-[10px] leading-relaxed max-h-[180px] overflow-y-auto">
                              {tool.result ? (
                                <pre className="whitespace-pre-wrap">
                                  {typeof tool.result === 'string'
                                    ? tool.result
                                    : JSON.stringify(tool.result, null, 2)}
                                </pre>
                              ) : (
                                <span className="text-[#85858d]">暂无输出内容</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Assistant 回复正文 */}
                  {msg.content && (
                    <div className="p-3 rounded-[9px] bg-white border border-[#e3e3e8] shadow-2xs select-text">
                      <AgentMarkdown
                        content={msg.content}
                        isStreaming={
                          !!sessionState?.isBusy &&
                          msgIdx === sessionState.messages.length - 1
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
          </div>

          {/* 离开底部后的浮动「查看最新」胶囊按钮 */}
          <ChatScrollToLatestButton
            visible={!isChatAtBottom}
            hasNewOutput={hasNewChatOutput}
            onClick={() => scrollChatToBottom(true)}
          />
        </div>

        {/* 贴底交互输入区 */}
        <div className="p-3 border-t border-[#ececf0] bg-white shrink-0">
          {sessionState?.agentProvider && sessionState.agentProvider !== 'pi' ? (
            <div className="p-3 rounded-[8px] bg-[#f9f9fb] border border-[#ececf0] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Terminal size={13} className="text-[#4f46e5] shrink-0" />
                <div className="text-[11.5px] text-[#4b4b53] min-w-0">
                  <span>当前节点由 </span>
                  <span className="font-semibold text-[#1c1c21]">
                    {getAgentProviderMeta(sessionState.agentProvider).label}
                  </span>
                  <span> 独立执行。如需交互调试，请使用上方「终端接管」。</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopyTerminalCommand}
                className="h-[24px] px-2.5 rounded-[5px] bg-white hover:bg-[#ececf0] text-[#1c1c21] text-[11px] font-medium border border-[#e3e3e8] shrink-0 flex items-center gap-1 transition-all shadow-2xs cursor-pointer active:scale-95"
                title="复制终端接管命令"
              >
                <Copy size={11} />
                <span>接管命令</span>
              </button>
            </div>
          ) : (
            <>
              {sessionState?.awaitingInput && (
                <AgentAwaitingInputBar
                  onConfirmPlan={handleConfirmPlan}
                  onConfirmComplete={handleConfirmComplete}
                />
              )}

              <div className="flex items-center justify-between text-[10.5px] text-[#85858d] mb-1.5 px-0.5">
                <span className="flex items-center gap-1 min-w-0">
                  {sessionState?.isBusy ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-ping" />
                      <span className="text-[#7c3aed] font-medium truncate">运行中：发送可实时插话引导 (Steer)</span>
                    </>
                  ) : sessionState?.isPaused ? (
                    <span className="text-[#d97706] font-medium truncate">会话已暂停，可输入新指令后继续</span>
                  ) : sessionState?.awaitingInput ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5]" />
                      <span className="text-[#4f46e5] font-medium truncate">等待确认：可点击上方按钮确认方案，或输入新指令继续</span>
                    </>
                  ) : (
                    <span className="truncate">可随时追加输入纠偏提示或追问</span>
                  )}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {/* 当前使用的模型微胶囊 */}
                  <div
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#71717a] hover:text-[#1c1c21] border border-[#e3e3e8] hover:border-[#d0d0d7] text-[10px] font-mono select-none transition-colors"
                    title={`当前使用模型: ${effectiveChatModel}${sessionState?.pendingModel ? ` (待生效: ${sessionState.pendingModel})` : ''}`}
                  >
                    <Cpu size={10} className="text-[#85858d] shrink-0" />
                    <span className="truncate max-w-[120px]">{effectiveChatModel}</span>
                    {sessionState?.pendingModel && (
                      <span className="text-[9px] text-[#d97706] shrink-0 font-sans">(切换中)</span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#85858d]">
                    支持按 <kbd className="font-mono px-1 py-0.5 rounded bg-[#f1f1f4] border border-[#e3e3e8]">⌘</kbd> + <kbd className="font-mono px-1 py-0.5 rounded bg-[#f1f1f4] border border-[#e3e3e8]">Enter</kbd> 发送
                  </span>
                </div>
              </div>

              <div className="relative flex items-end gap-2 bg-[#f9f9fb] border border-[#e3e3e8] focus-within:border-[#7c3aed] focus-within:ring-2 focus-within:ring-[#7c3aed]/15 rounded-[8px] p-2 transition-all">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  placeholder="向该 Agent 节点追加补充提示词、纠偏说明或指令..."
                  className="flex-1 bg-transparent border-0 outline-hidden text-[12px] text-[#1c1c21] placeholder-[#a1a1aa] resize-none leading-relaxed"
                />
                <button
                  type="button"
                  disabled={!chatInput.trim() || isSending || !taskId}
                  onClick={handleSendChat}
                  className="h-[28px] px-2.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center gap-1 transition-all disabled:opacity-40 cursor-pointer shadow-xs shrink-0"
                >
                  {isSending ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Send size={11} />
                  )}
                  <span>发送</span>
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
};
