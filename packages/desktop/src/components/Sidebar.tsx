import React from 'react';
import {
  Kanban,
  Workflow,
  Boxes,
  Cpu,
  Settings,
  Puzzle,
  Terminal,
  Activity,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { PluginManifest } from '@openloop/core';

interface SidebarProps {
  plugins: PluginManifest[];
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
  activePluginId,
  onSelectPlugin,
  isDaemonConnected,
}) => {
  const corePlugins = plugins.filter(
    (p) => p.id === 'kanban' || p.id === 'workflow-editor'
  );
  const extensionPlugins = plugins.filter(
    (p) => p.id !== 'kanban' && p.id !== 'workflow-editor'
  );

  return (
    <aside className="w-[212px] h-screen bg-[#f4f4f6] border-r border-[#e3e3e8] flex flex-col justify-between shrink-0 select-none">
      <div className="flex flex-col min-h-0">
        {/* 顶部：macOS 原生红黄绿窗口按钮与 openLoop Logo */}
        <div className="h-[46px] px-4 flex items-center gap-3 shrink-0">
          {/* Traffic lights */}
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

        {/* 导航菜单列表 */}
        <div className="flex-1 overflow-y-auto px-2.5 py-1.5 space-y-3.5">
          {/* 使用分组 */}
          <div>
            <div className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-[#85858d]">
              使用
            </div>
            <div className="space-y-[2px]">
              {corePlugins.map((plugin) => {
                const isActive = activePluginId === plugin.id;
                const icon =
                  (plugin.sidebarItem?.icon && ICON_MAP[plugin.sidebarItem.icon]) || (
                    <Puzzle size={15} strokeWidth={1.8} />
                  );

                return (
                  <button
                    key={plugin.id}
                    onClick={() => onSelectPlugin(plugin.id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 h-[30px] rounded-[7px] text-[13px] transition-all text-left ${
                      isActive
                        ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.08)]'
                        : 'text-[#4b4b53] hover:bg-[#e9e9ee] hover:text-[#1c1c21]'
                    }`}
                  >
                    <span className={isActive ? 'text-[#1c1c21]' : 'text-[#85858d]'}>
                      {icon}
                    </span>
                    <span className="truncate tracking-tight">
                      {plugin.sidebarItem?.title || plugin.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 扩展分组 */}
          <div>
            <div className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-[#85858d]">
              扩展
            </div>
            <div className="space-y-[2px]">
              {extensionPlugins.map((plugin) => {
                const isActive = activePluginId === plugin.id;
                const icon =
                  (plugin.sidebarItem?.icon && ICON_MAP[plugin.sidebarItem.icon]) || (
                    <Boxes size={15} strokeWidth={1.8} />
                  );

                return (
                  <button
                    key={plugin.id}
                    onClick={() => onSelectPlugin(plugin.id)}
                    className={`w-full flex items-center justify-between px-2.5 h-[30px] rounded-[7px] text-[13px] transition-all text-left ${
                      isActive
                        ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.14),0_0_0_0.5px_rgba(0,0,0,0.08)]'
                        : 'text-[#4b4b53] hover:bg-[#e9e9ee] hover:text-[#1c1c21]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <span className={isActive ? 'text-[#1c1c21]' : 'text-[#85858d]'}>
                        {icon}
                      </span>
                      <span className="truncate tracking-tight">
                        {plugin.sidebarItem?.title || plugin.name}
                      </span>
                    </div>

                    {!plugin.isBuiltin && (
                      <span className="text-[10px] text-[#4f46e5] bg-[#eeedfd] px-1.5 py-[1px] rounded font-medium">
                        槽位
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 底部系统状态 */}
      <div className="p-2.5 border-t border-[#ececf0] space-y-[2px] shrink-0">
        <button className="w-full flex items-center gap-2.5 px-2.5 h-[30px] rounded-[7px] text-[13px] text-[#4b4b53] hover:bg-[#e9e9ee] hover:text-[#1c1c21] transition-all">
          <Settings size={15} strokeWidth={1.8} className="text-[#85858d]" />
          <span>设置</span>
        </button>

        <div className="px-2.5 h-[28px] flex items-center gap-2 text-[11px] text-[#85858d] font-mono">
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
