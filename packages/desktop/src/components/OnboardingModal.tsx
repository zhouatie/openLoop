import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  FolderLock,
  Terminal,
  Cpu,
  ArrowRight,
  Check,
  HardDrive,
  GitBranch,
  RotateCcw,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { api } from '../services/api';

interface ToolStatus {
  name: string;
  command: string;
  available: boolean;
  path?: string;
  version?: string;
}

interface SystemStatus {
  platform: string;
  nodeVersion: string;
  hasFullDiskAccess: boolean;
  tools: ToolStatus[];
}

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDaemonConnected: boolean;
  asPage?: boolean; // 支持全屏沉浸页或弹窗模式
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  isDaemonConnected,
  asPage = false,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [isRestarting, setIsRestarting] = useState<boolean>(false);
  const [serverEndpoint, setServerEndpoint] = useState<string>('127.0.0.1:19888');
  const [status, setStatus] = useState<SystemStatus>({
    platform: 'darwin',
    nodeVersion: '',
    hasFullDiskAccess: false,
    tools: [
      { name: 'Node.js', command: 'node', available: true },
      { name: 'Git', command: 'git', available: true },
    ],
  });

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      if (window.electronAPI?.checkSystemStatus) {
        const res = await window.electronAPI.checkSystemStatus();
        setStatus(res);
        if (import.meta.env?.DEV) {
          console.log('[Onboarding] System status verified:', res);
        }
      }
    } catch (err) {
      console.warn('[Onboarding] Verify error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      checkStatus();
    }
  }, [isOpen, checkStatus]);

  useEffect(() => {
    try {
      const url = new URL(api.getBaseUrl());
      setServerEndpoint(url.host || '127.0.0.1:19888');
    } catch {
      setServerEndpoint('127.0.0.1:19888');
    }
  }, []);

  const handleRetryConnection = useCallback(async () => {
    if (isRetrying || isRestarting) return;
    setIsRetrying(true);
    if (import.meta.env?.DEV) {
      console.log('[Onboarding] 用户手动点击重试连接后台服务');
    }
    try {
      await api.retryConnection();
    } finally {
      setTimeout(() => setIsRetrying(false), 500);
    }
  }, [isRetrying, isRestarting]);

  const handleRestartCoreServer = useCallback(async () => {
    if (isRestarting) return;
    setIsRestarting(true);
    if (import.meta.env?.DEV) {
      console.log('[Onboarding] 用户触发一键重启后台 Core 引擎');
    }
    try {
      await api.restartCoreServer();
    } finally {
      setTimeout(() => setIsRestarting(false), 800);
    }
  }, [isRestarting]);

  const handleOpenPrivacySettings = useCallback(async () => {
    if (window.electronAPI?.openPrivacySetting) {
      if (import.meta.env?.DEV) {
        console.log('[Onboarding] Trigger opening Full Disk Access in macOS Settings');
      }
      await window.electronAPI.openPrivacySetting('all-files');
    }
  }, []);

  const handleComplete = useCallback(() => {
    try {
      localStorage.setItem('openloop_onboarding_completed', 'true');
    } catch {}
    if (import.meta.env?.DEV) {
      console.log('[Onboarding] Completed and dismissed');
    }
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const isMac = status.platform === 'darwin' || navigator.userAgent.includes('Mac');

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${
        asPage
          ? 'bg-gradient-to-b from-[#fafafb] via-[#f4f4f6] to-[#ebebee]'
          : 'bg-black/35 backdrop-blur-[3px]'
      } p-6 select-none animate-in fade-in duration-200`}
      onClick={() => {
        if (!asPage) {
          if (import.meta.env?.DEV) {
            console.log('[OnboardingModal] 点击蒙层关闭引导弹窗');
          }
          handleComplete();
        }
      }}
    >
      {/* 居中面板：极简苹果原厂质感 */}
      <div
        className="bg-white border border-[#e2e2e7] rounded-[14px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.07),0_1px_3px_rgba(0,0,0,0.03)] w-full max-w-[640px] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 Header：克制留白与品牌呈现 */}
        <div className="px-7 pt-7 pb-5 border-b border-[#f1f1f4] bg-gradient-to-b from-white to-[#fafafc]">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <BrandLogo size={32} className="shrink-0 shadow-sm" />
              <div>
                <h2 className="text-[15px] font-semibold text-[#18181b] tracking-tight flex items-center gap-2">
                  <span>openLoop 初始化配置</span>
                  <span className="text-[10px] font-medium text-[#71717a] px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] border border-[#e4e4e7]">
                    macOS
                  </span>
                </h2>
              </div>
            </div>
            <div className="text-[10.5px] font-medium text-[#71717a] px-2 py-0.5 rounded-[4px] bg-[#fafafc] border border-[#e4e4e7]">
              系统自检
            </div>
          </div>
          <p className="text-[12px] text-[#71717a] leading-relaxed">
            极速完成本地运行环境与系统权限确认，保障任务自动化编排、Worktree 分支隔离与流水线部署顺畅执行。
          </p>
        </div>

        {/* 主体自检内容 */}
        <div className="px-7 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 1. macOS 核心权限 (完全磁盘访问) */}
          {isMac && (
            <div className="border border-[#e4e4e7] rounded-[10px] p-4 bg-[#fafafc]/70 hover:bg-[#fafafc] transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 w-7 h-7 rounded-[6px] bg-[#f4f4f6] border border-[#e4e4e7] text-[#18181b] flex items-center justify-center shrink-0">
                    <FolderLock size={15} strokeWidth={1.8} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[#18181b]">
                        系统完全磁盘访问权限 (Full Disk Access)
                      </span>
                      {status.hasFullDiskAccess ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                          <CheckCircle2 size={10} strokeWidth={2.2} />
                          <span>已授权</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fefce8] text-[#b45309] text-[10px] font-medium border border-[#fef08a]">
                          <AlertCircle size={10} strokeWidth={2} />
                          <span>推荐开启</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] text-[#71717a] mt-1 leading-normal">
                      允许应用在工作区创建 Git Worktree 隔离分支并执行自动化构建/部署指令。
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handleOpenPrivacySettings}
                    type="button"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-[#18181b] hover:bg-[#27272a] text-white text-[11px] font-medium transition-all shadow-sm active:scale-[0.98]"
                  >
                    <span>前往设置授权</span>
                    <ExternalLink size={11} />
                  </button>
                  <button
                    onClick={checkStatus}
                    disabled={loading}
                    title="刷新检测"
                    type="button"
                    className="p-1.5 rounded-[6px] text-[#71717a] hover:text-[#18181b] hover:bg-[#eaeaea] transition-colors"
                  >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* 优雅的操作步进小胶囊 */}
              <div className="mt-3 pt-2.5 border-t border-[#ededf2] flex items-center gap-2 text-[11px] text-[#71717a]">
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#e4e4e7] text-[#18181b] text-[10px] font-mono font-medium">
                  1
                </span>
                <span>在弹出的偏好设置中找到 <strong>openLoop</strong></span>
                <span className="text-[#d4d4d8]">→</span>
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-[#e4e4e7] text-[#18181b] text-[10px] font-mono font-medium">
                  2
                </span>
                <span>点亮开启开关即可完成一次性永久授权</span>
              </div>
            </div>
          )}

          {/* 2. 本地开发工具链矩阵 */}
          <div className="border border-[#e4e4e7] rounded-[10px] p-4 bg-white">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] text-[#18181b] flex items-center justify-center">
                  <Terminal size={12} strokeWidth={2} />
                </span>
                <span className="text-[12.5px] font-medium text-[#18181b]">
                  本地开发工具链与 Shell 环境
                </span>
              </div>
              <span className="text-[10.5px] text-[#a1a1aa] font-mono">
                自动继承 ~/.zshrc 环境变量
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {status.tools.map((tool) => (
                <div
                  key={tool.name}
                  className="p-2.5 rounded-[7px] border border-[#f0f0f3] bg-[#fafafc] flex items-center justify-between hover:border-[#e4e4e7] transition-colors"
                >
                  <div className="min-w-0 pr-2">
                    <div className="text-[11.5px] font-medium text-[#18181b] flex items-center gap-1.5">
                      <span>{tool.name}</span>
                      {tool.name === 'Node.js' && status.nodeVersion && (
                        <span className="text-[9.5px] font-mono text-[#71717a] px-1 py-0.2 bg-[#f0f0f3] rounded">
                          {status.nodeVersion}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] font-mono text-[#8c8c94] truncate mt-0.5">
                      {tool.path || `$ which ${tool.command}`}
                    </div>
                  </div>

                  {tool.available ? (
                    <span className="shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0]/60">
                      <Check size={10} strokeWidth={2.5} />
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-[#8c8c94] font-medium px-1.5 py-0.5 rounded bg-[#f4f4f6]">
                      未检测到
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 3. 调度核心服务通信 */}
          <div className="border border-[#e4e4e7] rounded-[10px] p-3.5 bg-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-[6px] bg-[#f4f4f6] border border-[#e4e4e7] text-[#18181b] flex items-center justify-center">
                <Cpu size={14} strokeWidth={1.8} />
              </div>
              <div>
                <div className="text-[12.5px] font-medium text-[#18181b] flex items-center gap-2">
                  <span>核心调度引擎 (Core Server)</span>
                  <span className="font-mono text-[10.5px] text-[#71717a]">
                    {serverEndpoint}
                  </span>
                </div>
                <div className="text-[11px] text-[#8c8c94] mt-0.5">
                  SQLite 数据底座 · 双环隔离保护已生效
                </div>
              </div>
            </div>

            {isDaemonConnected ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10.5px] font-medium border border-[#a7f3d0]/60">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                <span>就绪</span>
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10.5px] font-medium border border-[#fecaca]/60">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                  <span>{isRestarting ? '重启中...' : isRetrying ? '探测中...' : '连接中'}</span>
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleRetryConnection}
                    disabled={isRetrying || isRestarting}
                    title="立即重新探活服务"
                    className="h-[24px] px-2 rounded-[5px] border border-[#e3e3e8] bg-[#fafafc] hover:bg-[#f4f4f6] text-[#52525b] hover:text-[#18181b] text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50 active:scale-95 shadow-xs"
                  >
                    <RefreshCw size={11} className={isRetrying ? 'animate-spin' : ''} />
                    <span>重试</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRestartCoreServer}
                    disabled={isRestarting || isRetrying}
                    title="一键平滑重启后台核心服务"
                    className="h-[24px] px-2 rounded-[5px] border border-[#fecaca]/70 bg-[#fff5f5] hover:bg-[#fee2e2] text-[#dc2626] text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50 active:scale-95 shadow-xs"
                  >
                    <RotateCcw size={11} className={isRestarting ? 'animate-spin' : ''} />
                    <span>重启服务</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部 Footer：主行动按钮 */}
        <div className="px-7 py-4 bg-[#fafafc] border-t border-[#f1f1f4] flex items-center justify-between">
          <button
            onClick={handleComplete}
            type="button"
            className="text-[11.5px] text-[#8c8c94] hover:text-[#52525b] transition-colors"
          >
            稍后在「设置」中查看
          </button>

          <button
            onClick={handleComplete}
            type="button"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[7px] bg-[#18181b] hover:bg-[#27272a] text-white text-[12px] font-medium transition-all shadow-sm active:scale-[0.98]"
          >
            <span>进入 openLoop</span>
            <ArrowRight size={13} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
};
