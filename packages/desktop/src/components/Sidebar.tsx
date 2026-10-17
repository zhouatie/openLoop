import React, { useMemo } from 'react';
import {
  Kanban,
  Workflow,
  Boxes,
  Cpu,
  Settings,
  Puzzle,
  Layers,
} from 'lucide-react';
import { PluginManifest } from '@openloop/core';
import { useShortcuts } from '../context/ShortcutContext';
import { getSortedSidebarPlugins } from '../utils/sidebarOrder';

interface SidebarProps {
  plugins: PluginManifest[];
  sidebarOrder?: string[];
  activePluginId: string;
  onSelectPlugin: (id: string) => void;
  isDaemonConnected: boolean;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  Kanban: <Kanban size={15} strokeWidth={1.8} />,
  Workflow: <Workflow size={15} strokeWidth={1.8} />,
  Boxes: <Boxes size={15} strokeWidth={1.8} />,
  Cpu: <Cpu size={15} strokeWidth={1.8} />,
  Settings: <Settings size={15} strokeWidth={1.8} />,
  Puzzle: <Puzzle size={15} strokeWidth={1.8} />,
  Layers: <Layers size={15} strokeWidth={1.8} />,
};

export const Sidebar: React.FC<SidebarProps> = ({
  plugins,
  sidebarOrder,
  activePluginId,
  onSelectPlugin,
  isDaemonConnected,
}) => {
  const { formatCombo } = useShortcuts();

  // 获取拍平并按配置排好序的侧边栏插件列表（自动排除 plugin-manager，前两项固定 kanban & workflow-editor）
  const displayPlugins = useMemo(() => {
    return getSortedSidebarPlugins(plugins, sidebarOrder);
  }, [plugins, sidebarOrder]);

  const isSettingsActive = activePluginId.startsWith('settings');

  const handleItemClick = (id: string) => {
    if (import.meta.env?.DEV) {
      console.log('[Sidebar] 点击切换侧边栏导航:', { id, previous: activePluginId });
    }
    onSelectPlugin(id);
  };

  return (
    <aside className="w-[212px] h-screen bg-[#f4f4f6] border-r border-[#e3e3e8] flex flex-col justify-between shrink-0 select-none">
      <div className="flex flex-col min-h-0 flex-1">
        {/* 顶部：macOS 原生红黄绿窗口控制按钮与 Logo */}
        <div className="h-[46px] px-4 flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] inline-block shadow-sm" />
            <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] inline-block shadow-sm" />
            <span className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] inline-block shadow-sm" />
          </div>

          <div className="flex items-center gap-1.5 ml-1.5">
            <div className="w-[18px] h-[18px] rounded-[5px] bg-[#1c1c21] flex items-center justify-center text-white shadow-sm">
              <Layers size={11} strokeWidth={2.4} />
            </div>
            <span className="font-semibold text-[13.5px] text-[#1c1c21] tracking-tight">
              openLoop
            </span>
          </div>
        </div>

        {/* 拍平的单一导航菜单列表（无“使用”、“扩展”分组） */}
        <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-[2px]">
          {displayPlugins.map((plugin) => {
            const isActive = activePluginId === plugin.id;
            const icon =
              (plugin.sidebarItem?.icon && ICON_MAP[plugin.sidebarItem.icon]) || (
                <Puzzle size={15} strokeWidth={1.8} />
              );

            // 仅对前两项分配全局快捷键提示
            const shortcutHint =
              plugin.id === 'kanban'
                ? formatCombo('1')
                : plugin.id === 'workflow-editor'
                ? formatCombo('2')
                : undefined;

            const titleText = plugin.sidebarItem?.title || plugin.name;

            return (
              <button
                key={plugin.id}
                onClick={() => handleItemClick(plugin.id)}
                title={shortcutHint ? `${titleText} (${shortcutHint})` : titleText}
                className={`w-full flex items-center justify-between px-2.5 h-[30px] rounded-[7px] text-[13px] transition-all text-left group ${
                  isActive
                    ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.06)]'
                    : 'text-[#4b4b53] hover:bg-[#e9e9ee] hover:text-[#1c1c21]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`shrink-0 transition-colors ${
                      isActive ? 'text-[#1c1c21]' : 'text-[#85858d] group-hover:text-[#4b4b53]'
                    }`}
                  >
                    {icon}
                  </span>
                  <span className="truncate tracking-tight">{titleText}</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                  {!plugin.isBuiltin && (
                    <span className="text-[10px] text-[#4f46e5] bg-[#eeedfd] px-1.5 py-[1px] rounded font-medium">
                      槽位
                    </span>
                  )}
                  {shortcutHint && (
                    <span className="text-[10.5px] font-mono text-[#a1a1aa] tracking-tighter opacity-70 group-hover:opacity-100">
                      {shortcutHint}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 底部：系统设置与核心服务运行状态 */}
      <div className="p-2 border-t border-[#ececf0] space-y-1 shrink-0">
        <button
          onClick={() => handleItemClick('settings')}
          title={`系统设置 (${formatCombo(',')})`}
          className={`w-full flex items-center justify-between px-2.5 h-[32px] rounded-[7px] text-[13px] transition-all text-left ${
            isSettingsActive
              ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.06)]'
              : 'text-[#4b4b53] hover:bg-[#e9e9ee] hover:text-[#1c1c21]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Settings
              size={15}
              strokeWidth={1.8}
              className={isSettingsActive ? 'text-[#1c1c21]' : 'text-[#85858d]'}
            />
            <span>设置</span>
          </div>

          <span className="text-[10.5px] font-mono text-[#a1a1aa] tracking-tighter">
            {formatCombo(',')}
          </span>
        </button>

        <div className="px-2 h-[22px] flex items-center gap-2 text-[11px] text-[#85858d] font-mono">
          <span
            className={`w-[7px] h-[7px] rounded-full shrink-0 ${
              isDaemonConnected ? 'bg-[#189a58]' : 'bg-[#d64545] animate-pulse'
            }`}
          />
          <span className="truncate">核心 127.0.0.1:19888</span>
        </div>
      </div>
    </aside>
  );
};
