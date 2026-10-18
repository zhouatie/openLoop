import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { TaskSessionState, SessionChatMessage } from '@openloop/core';
import { api } from '../services/api';
import { AgentMarkdown } from './AgentMarkdown';
import { toast } from './Toast';

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

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // 新消息到达时平滑自动滚动至底部
  useEffect(() => {
    if (isOpen && sessionState?.messages?.length) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, sessionState?.messages?.length, sessionState?.isBusy]);

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
    if (import.meta.env?.DEV) {
      console.log('[AgentSessionDrawer] 发送会话消息:', { taskId, text });
    }

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
    sessionState?.piSessionId ||
    (sessionState as any)?.sessionId ||
    (taskId ? `session_${taskId}` : '');

  // 复制终端接管命令
  const handleCopyTerminalCommand = () => {
    const sid = effectiveSessionId;
    if (!sid) return;
    const cmd = workspace ? `cd "${workspace}" && pi --session ${sid}` : `pi --session ${sid}`;
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

        {/* 消息滚动流列表区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 min-h-0 text-[12px] bg-[#fafafc]">
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
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-[9px] px-3.5 py-2.5 bg-white border border-[#e3e3e8] text-[#1c1c21] text-[12px] leading-relaxed shadow-2xs">
                      <div className="text-[9.5px] font-mono text-[#85858d] mb-1 text-right font-medium">
                        YOU / PROMPT
                      </div>
                      {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
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
                        onClick={() =>
                          setExpandedThinking((p) => ({ ...p, [msg.id]: !p[msg.id] }))
                        }
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
                            <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-ping" />
                          )}
                        </div>
                        {expandedThinking[msg.id] ? (
                          <ChevronDown size={11} />
                        ) : (
                          <ChevronRight size={11} />
                        )}
                      </button>
                      {(expandedThinking[msg.id] || msg.isThinking) && (
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
                            onClick={() =>
                              setExpandedTools((p) => ({ ...p, [tool.id]: !p[tool.id] }))
                            }
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
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] animate-ping" />
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

        {/* 贴底交互输入区 */}
        <div className="p-3 border-t border-[#ececf0] bg-white shrink-0">
          <div className="flex items-center justify-between text-[10.5px] text-[#85858d] mb-1.5 px-0.5">
            <span className="flex items-center gap-1">
              {sessionState?.isBusy ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7c3aed] animate-ping" />
                  <span className="text-[#7c3aed] font-medium">运行中：发送可实时插话引导 (Steer)</span>
                </>
              ) : sessionState?.isPaused ? (
                <span className="text-[#d97706] font-medium">会话已暂停，可输入新指令后继续</span>
              ) : (
                <span>可随时追加输入纠偏提示或追问</span>
              )}
            </span>
            <span className="text-[10px] text-[#85858d]">
              支持按 <kbd className="font-mono px-1 py-0.5 rounded bg-[#f1f1f4] border border-[#e3e3e8]">⌘</kbd> + <kbd className="font-mono px-1 py-0.5 rounded bg-[#f1f1f4] border border-[#e3e3e8]">Enter</kbd> 发送
            </span>
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
        </div>
      </aside>
    </div>
  );
};
