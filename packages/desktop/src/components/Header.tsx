import React from 'react';
import { PanelLeft, Terminal, Command, Sparkles } from 'lucide-react';
import { DeviceStatusMenu } from './DeviceStatusMenu';
import { useShortcuts } from '../context/ShortcutContext';

interface HeaderProps {
  category: string;
  title: string;
  isDaemonConnected: boolean;
  onToggleLogs: () => void;
  isLogsOpen: boolean;
  onOpenCommandPalette?: () => void;
  /** 打开全局智能体浮层 */
  onOpenAgent?: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  /** 在右侧镜像浮层里打开指定设备 */
  onOpenMirrorDevice?: (device: { platform: 'android' | 'ios'; serial: string; name: string }) => void;
}

export const Header: React.FC<HeaderProps> = ({
  category,
  title,
  isDaemonConnected,
  onToggleLogs,
  isLogsOpen,
  onOpenCommandPalette,
  onOpenAgent,
  isSidebarOpen = true,
  onToggleSidebar,
  onOpenMirrorDevice,
}) => {
  const { formatCombo } = useShortcuts();

  const currentCorePort = (() => {
    if (typeof window !== 'undefined' && window.location) {
      try {
        const sp = new URLSearchParams(window.location.search);
        const qPort = sp.get('corePort');
        if (qPort && /^\d+$/.test(qPort)) return qPort;
      } catch {}
    }
    return import.meta.env.VITE_CORE_PORT || (import.meta.env.DEV ? '19889' : '19888');
  })();

  const portNum = parseInt(currentCorePort, 10);
  const isSandbox = portNum >= 19890;
  const isDev = portNum === 19889;

  const handleToggleSidebarClick = () => {
    if (import.meta.env?.DEV) {
      console.log('[Header] 点击侧边栏切换按钮:', {
        currentStatus: isSidebarOpen ? '展开' : '紧凑',
        nextStatus: isSidebarOpen ? '收缩为纯图标模式' : '展开为完整模式',
      });
    }
    onToggleSidebar?.();
  };

  return (
    <header className="h-[46px] border-b border-[#e3e3e8] bg-white px-4 flex items-center justify-between select-none shrink-0">
      {/* 左侧：分栏与面包屑 */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={handleToggleSidebarClick}
          className={`w-[26px] h-[26px] rounded-[7px] flex items-center justify-center transition-all ${
            !isSidebarOpen
              ? 'bg-[#e9e9ee] text-[#1c1c21] hover:bg-[#dfdfe4] shadow-sm'
              : 'text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21]'
          }`}
          title={isSidebarOpen ? `收起侧边栏 (${formatCombo('B')})` : `展开侧边栏 (${formatCombo('B')})`}
        >
          <PanelLeft size={15} strokeWidth={1.8} />
        </button>

        <div className="flex items-center gap-1.5 text-[12.5px]">
          <span className="text-[#85858d]">{category}</span>
          <span className="text-[#b9b9c2]">/</span>
          <span className="text-[#1c1c21] font-medium">{title}</span>
        </div>

        {isSandbox ? (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-[#ecfdf5] text-[#065f46] border border-[#a7f3d0] text-[10.5px] font-mono font-medium tracking-tight select-none"
            title={`当前处于任务专属独立沙箱（端口 ${currentCorePort}），数据与稳定版完全隔离`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
            SANDBOX · {currentCorePort}
          </span>
        ) : isDev ? (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-[#fef3c7] text-[#92400e] border border-[#fde68a] text-[10.5px] font-mono font-medium tracking-tight select-none"
            title="当前处于独立开发沙箱（端口 19889），不影响稳定版环境"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] animate-pulse" />
            DEV · 19889
          </span>
        ) : null}
      </div>

      {/* 右侧：动作按钮 */}
      <div className="flex items-center gap-1.5">
        {/* 工具条：设备 / 智能体 / 命令 / 日志 / 刷新 收在一个胶囊里，避免一排等大方块 */}
        <div className="flex items-center gap-[2px] h-[26px] px-[3px] rounded-[7px] border border-[#e3e3e8] bg-white">
          {onOpenMirrorDevice && <DeviceStatusMenu onOpenMirror={onOpenMirrorDevice} />}

          {onOpenAgent && (
            <button
              onClick={() => {
                if (import.meta.env?.DEV) {
                  console.log('[Header] 点击打开全局智能体浮层');
                }
                onOpenAgent();
              }}
              className="w-[24px] h-[22px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:text-[#4f46e5] hover:bg-[#f4f4f6] transition-colors cursor-pointer"
              title="智能体（Super + `）"
            >
              <Sparkles size={13} strokeWidth={1.9} />
            </button>
          )}

          {onOpenCommandPalette && (
            <button
              onClick={onOpenCommandPalette}
              className="w-[24px] h-[22px] rounded-[5px] flex items-center justify-center text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f4f4f6] transition-colors cursor-pointer"
              title="命令面板（Super + K）"
            >
              <Command size={13} strokeWidth={1.9} />
            </button>
          )}

          <button
            onClick={onToggleLogs}
            title="运行日志"
            className={`w-[24px] h-[22px] rounded-[5px] flex items-center justify-center transition-colors cursor-pointer ${
              isLogsOpen
                ? 'bg-[#eeedf2] text-[#1c1c21]'
                : 'text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f4f4f6]'
            }`}
          >
            <Terminal size={13} strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </header>
  );
};
