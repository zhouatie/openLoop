import React from 'react';
import { PanelLeft, RefreshCw, Plus, Terminal, Command } from 'lucide-react';
import { Kbd } from './Kbd';
import { useShortcuts } from '../context/ShortcutContext';

interface HeaderProps {
  category: string;
  title: string;
  isDaemonConnected: boolean;
  onOpenCreateTask: () => void;
  onToggleLogs: () => void;
  isLogsOpen: boolean;
  unreadLogsCount: number;
  onRefresh: () => void;
  onOpenCommandPalette?: () => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  category,
  title,
  isDaemonConnected,
  onOpenCreateTask,
  onToggleLogs,
  isLogsOpen,
  unreadLogsCount,
  onRefresh,
  onOpenCommandPalette,
  isSidebarOpen = true,
  onToggleSidebar,
}) => {
  const { formatCombo } = useShortcuts();

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

        {import.meta.env.DEV && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-[#fef3c7] text-[#92400e] border border-[#fde68a] text-[10.5px] font-mono font-medium tracking-tight select-none"
            title="当前处于独立开发沙箱（端口 19889），不影响稳定版环境"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] animate-pulse" />
            DEV · 19889
          </span>
        )}
      </div>

      {/* 右侧：动作按钮 */}
      <div className="flex items-center gap-2">
        {/* 命令面板快捷唤起 */}
        {onOpenCommandPalette && (
          <button
            onClick={onOpenCommandPalette}
            className="flex items-center gap-1.5 h-[26px] px-2 rounded-[7px] border border-[#e3e3e8] bg-[#f9f9fb] hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] text-[11.5px] transition-all"
            title="唤起全局命令面板"
          >
            <Command size={12} strokeWidth={2} className="text-[#85858d]" />
            <span className="text-[11.5px]">命令</span>
            <Kbd keys={['super', 'K']} size="xs" variant="light" className="ml-0.5" />
          </button>
        )}

        {/* 新建任务 */}
        <button
          onClick={onOpenCreateTask}
          className="flex items-center gap-1.5 h-[26px] px-2.5 rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-sm"
          title="新建任务"
        >
          <Plus size={13} strokeWidth={2.4} />
          <span>新建任务</span>
          <Kbd keys={['super', 'N']} size="xs" variant="dark" className="ml-0.5 opacity-80" />
        </button>

        {/* 终端实时日志 */}
        <button
          onClick={onToggleLogs}
          className={`flex items-center gap-1.5 h-[26px] px-2.5 rounded-[7px] text-[12px] border transition-all ${
            isLogsOpen
              ? 'bg-[#e9e9ee] border-[#e3e3e8] text-[#1c1c21] font-medium'
              : 'border-[#e3e3e8] bg-white text-[#4b4b53] hover:bg-[#f1f1f4] hover:text-[#1c1c21]'
          }`}
        >
          <Terminal size={13} strokeWidth={1.8} className="text-[#85858d]" />
          <span>日志</span>
          {unreadLogsCount > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] inline-block" />
          )}
        </button>

        {/* 更新/刷新胶囊 */}
        <button
          onClick={onRefresh}
          className="h-[26px] px-2 rounded-[7px] border border-[#e3e3e8] bg-white text-[#4b4b53] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-all flex items-center justify-center"
          title="刷新数据"
        >
          <RefreshCw size={13} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
};
