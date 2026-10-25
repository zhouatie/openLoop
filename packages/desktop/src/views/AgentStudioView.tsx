import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { PiWebStatus } from '@openloop/core';
import {
  RotateCw,
  ExternalLink,
  Power,
  Play,
  Square,
  AlertCircle,
  Folder,
  Terminal,
  CheckCircle2,
  Clock,
  Loader2,
  Bot,
} from 'lucide-react';

interface AgentStudioViewProps {
  currentWorkspace?: string;
  isVisible: boolean;
}

export const AgentStudioView: React.FC<AgentStudioViewProps> = ({
  currentWorkspace,
  isVisible,
}) => {
  const [status, setStatus] = useState<PiWebStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActionPending, setIsActionPending] = useState<boolean>(false);
  const [iframeKey, setIframeKey] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollTimerRef = useRef<any>(null);

  // 拉取服务状态
  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.getPiWebStatus();
      setStatus(res);
      return res;
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.warn('[AgentStudio] 获取 Pi Web 状态失败:', err);
      }
      return null;
    }
  }, []);

  // 初始进入或可见时拉取状态；若未启动则自动唤醒
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      setIsLoading(true);
      const res = await fetchStatus();
      if (!isMounted) return;

      // 如果尚未启动，自动静默触发启动
      if (res && res.status === 'stopped') {
        if (import.meta.env?.DEV) {
          console.log('[AgentStudio] 检测到 Pi Web 服务未启动，自动发起启动...');
        }
        setIsActionPending(true);
        try {
          const startedRes = await api.startPiWeb();
          if (isMounted) {
            setStatus(startedRes);
          }
        } catch (err: any) {
          if (import.meta.env?.DEV) {
            console.error('[AgentStudio] 自动拉起 Pi Web 异常:', err);
          }
        } finally {
          if (isMounted) setIsActionPending(false);
        }
      }
      setIsLoading(false);
    };

    init();

    return () => {
      isMounted = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [fetchStatus]);

  // 当处于 starting 状态时，开启高频健康探测
  useEffect(() => {
    if (status?.status === 'starting') {
      pollTimerRef.current = setInterval(async () => {
        const s = await fetchStatus();
        if (s && s.status !== 'starting') {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      }, 1000);
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [status?.status, fetchStatus]);

  // 手动启动服务
  const handleStart = async () => {
    setIsActionPending(true);
    try {
      const res = await api.startPiWeb();
      setStatus(res);
      setIframeKey((k) => k + 1);
    } catch (err: any) {
      alert(`启动失败: ${err.message}`);
    } finally {
      setIsActionPending(false);
    }
  };

  // 手动停止服务
  const handleStop = async () => {
    setIsActionPending(true);
    try {
      const res = await api.stopPiWeb();
      setStatus(res);
    } catch (err: any) {
      alert(`停止失败: ${err.message}`);
    } finally {
      setIsActionPending(false);
    }
  };

  // 重启服务
  const handleRestart = async () => {
    setIsActionPending(true);
    try {
      const res = await api.restartPiWeb();
      setStatus(res);
      setIframeKey((k) => k + 1);
    } catch (err: any) {
      alert(`重启失败: ${err.message}`);
    } finally {
      setIsActionPending(false);
    }
  };

  // 刷新 iframe
  const handleReloadIframe = () => {
    setIframeKey((k) => k + 1);
  };

  // 外部浏览器打开
  const handleOpenExternal = () => {
    if (status?.url) {
      window.open(status.url, '_blank');
    }
  };

  const isRunning = status?.status === 'running';
  const isStarting = status?.status === 'starting' || (isLoading && !status);

  // 构造 iframe 访问地址（附带当前工作区 cwd 信息，方便自动对齐）
  const iframeSrc = status?.url ? status.url : '';

  return (
    <div
      className="flex-1 h-full flex flex-col bg-[#f4f4f6] overflow-hidden"
      style={{ display: isVisible ? 'flex' : 'none' }}
    >
      {/* 顶部控制栏（遵循 docs/design-system.md 微边框表头规范） */}
      <div className="h-[34px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-3 min-w-0">
          {/* 状态徽章 */}
          {isRunning ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
              <CheckCircle2 size={10} strokeWidth={2.2} />
              <span>RUNNING</span>
            </span>
          ) : isStarting ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10px] font-medium border border-[#bfdbfe]/60">
              <Loader2 size={10} className="animate-spin" />
              <span>STARTING</span>
            </span>
          ) : status?.status === 'error' ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60">
              <AlertCircle size={10} strokeWidth={2.2} />
              <span>ERROR</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#71717a] text-[10px] font-medium border border-[#e3e3e8]">
              <Clock size={10} />
              <span>STOPPED</span>
            </span>
          )}

          {/* 端口与端点指示 */}
          <span className="font-mono text-[11px] text-[#71717a]">
            127.0.0.1:{status?.port || 30141}
          </span>

          {/* 当前工作区提示 */}
          {currentWorkspace && (
            <div className="hidden md:flex items-center gap-1 text-[11px] text-[#71717a] border-l border-[#e3e3e8] pl-3 max-w-[360px] truncate">
              <Folder size={11} className="shrink-0 text-[#85858d]" />
              <span className="truncate">{currentWorkspace}</span>
            </div>
          )}
        </div>

        {/* 右侧微操作栏 */}
        <div className="flex items-center gap-1">
          {/* 刷新网页 */}
          <button
            onClick={handleReloadIframe}
            disabled={!isRunning || isActionPending}
            title="刷新工作台视图"
            className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <RotateCw size={11} strokeWidth={2} />
          </button>

          {/* 外部浏览器打开 */}
          <button
            onClick={handleOpenExternal}
            disabled={!isRunning}
            title="在独立浏览器窗口打开"
            className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
          >
            <ExternalLink size={11} strokeWidth={2} />
          </button>

          {/* 重启服务 */}
          <button
            onClick={handleRestart}
            disabled={isActionPending}
            title="重启 Pi Web 托管服务"
            className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer ml-1"
          >
            <Power size={11} strokeWidth={2} />
          </button>

          {/* 启停切换 */}
          {isRunning ? (
            <button
              onClick={handleStop}
              disabled={isActionPending}
              title="停止 Pi Web 进程"
              className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <Square size={10} strokeWidth={2.4} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={isActionPending || isStarting}
              title="启动 Pi Web 服务"
              className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#059669] hover:bg-[#ecfdf5] flex items-center justify-center transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            >
              <Play size={10} strokeWidth={2.4} fill="currentColor" />
            </button>
          )}
        </div>
      </div>

      {/* 视图主体 */}
      <div className="flex-1 relative overflow-hidden bg-white">
        {isRunning && (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={iframeSrc}
            title="Pi Web Agent Studio"
            className="w-full h-full border-none"
            allow="clipboard-read; clipboard-write"
          />
        )}

        {/* 启动中骨架屏 */}
        {isStarting && (
          <div className="absolute inset-0 bg-[#f4f4f6] flex flex-col items-center justify-center z-10 select-none">
            <div className="w-12 h-12 rounded-[10px] bg-white border border-[#e3e3e8] shadow-sm flex items-center justify-center text-[#4f46e5] mb-3">
              <Loader2 size={22} className="animate-spin" />
            </div>
            <h3 className="text-[13px] font-semibold text-[#1c1c21] mb-1">
              正在启动 Pi Web 开发工作台...
            </h3>
            <p className="text-[11.5px] text-[#85858d] max-w-sm text-center leading-relaxed mb-3">
              正在初始化本地智能体宿主环境与会话索引，通常耗时 3~6 秒。
            </p>
            <div className="font-mono text-[10px] text-[#a1a1aa] px-2.5 py-0.5 rounded bg-white border border-[#e3e3e8]">
              port: {status?.port || 30141}
            </div>
          </div>
        )}

        {/* 未运行或停止态引导 */}
        {!isRunning && !isStarting && (
          <div className="absolute inset-0 bg-[#f4f4f6] flex flex-col items-center justify-center z-10 select-none p-6">
            <div className="w-12 h-12 rounded-[10px] bg-white border border-[#e3e3e8] shadow-sm flex items-center justify-center text-[#4f46e5] mb-3">
              <Bot size={22} strokeWidth={1.8} />
            </div>
            <h3 className="text-[14px] font-semibold text-[#1c1c21] mb-1">
              智能体开发工作台已停止
            </h3>
            <p className="text-[12px] text-[#71717a] max-w-md text-center leading-relaxed mb-4">
              Pi Web 提供会话树分支、实时代码 Diff 与多模型调试能力。点击下方按钮即可唤醒本地常驻托管进程。
            </p>
            {status?.error && (
              <div className="max-w-md w-full mb-4 p-2.5 rounded-[6px] bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-[11px] font-mono break-all leading-normal">
                {status.error}
              </div>
            )}
            <button
              onClick={handleStart}
              disabled={isActionPending}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2e36] text-white text-[12px] font-medium transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              <Play size={12} fill="currentColor" />
              <span>启动工作台</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
