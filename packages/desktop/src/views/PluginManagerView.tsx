import React, { useState } from 'react';
import { Boxes, Plus, Puzzle, ShieldCheck, Sparkles } from 'lucide-react';
import { PluginManifest } from '@openloop/core';
import { api } from '../services/api';

interface PluginManagerViewProps {
  plugins: PluginManifest[];
  onRefresh: () => void;
}

export const PluginManagerView: React.FC<PluginManagerViewProps> = ({ plugins, onRefresh }) => {
  const [loading, setLoading] = useState(false);
  const [installedCount, setInstalledCount] = useState(0);

  const handleInstallDemoPlugin = async () => {
    setLoading(true);
    try {
      const demoPlugin: PluginManifest = {
        id: `plugin_benchmark_${Date.now()}`,
        name: '性能与压测插件 (Benchmark)',
        version: '1.2.0',
        description: '在自动化流程中接入压力测试与性能指标准备',
        author: 'openLoop Community',
        isBuiltin: false,
        sidebarItem: {
          id: `plugin_benchmark_${Date.now()}`,
          title: '性能测试槽位',
          icon: 'Cpu',
          order: 4 + installedCount,
          path: '/benchmark',
        },
      };

      await api.registerPlugin(demoPlugin);
      setInstalledCount((c) => c + 1);
      onRefresh();
      alert(`插件 [${demoPlugin.name}] 安装成功！侧边栏槽位已动态加载。`);
    } catch (err: any) {
      alert(`安装失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-y-auto select-none p-6 space-y-5">
      {/* 头部介绍 */}
      <div className="flex items-center justify-between pb-4 border-b border-[#e3e3e8]">
        <div>
          <h2 className="text-[15px] font-semibold text-[#1c1c21]">侧边栏插件插槽与扩展点</h2>
          <p className="text-[12px] text-[#85858d] mt-0.5">
            openLoop 采用开放式插槽设计。侧边栏通过插件清单动态呈现视图，工作流引擎支持插件自定义节点。
          </p>
        </div>

        <button
          onClick={handleInstallDemoPlugin}
          disabled={loading}
          className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 disabled:opacity-50"
        >
          <Plus size={13} strokeWidth={2.4} />
          <span>安装示例插件到侧边栏槽位</span>
        </button>
      </div>

      {/* 槽位列表容器（magpie .list 风格） */}
      <div>
        <div className="text-[11.5px] font-medium text-[#85858d] uppercase tracking-wide mb-2 px-1">
          已挂载插件槽位 ({plugins.length} 个)
        </div>

        <div className="bg-white border border-[#e3e3e8] rounded-[10px] divide-y divide-[#ececf0] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          {plugins.map((plugin) => (
            <div key={plugin.id} className="p-4 flex items-center justify-between hover:bg-[#f9f9fb] transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-[7px] bg-[#f1f1f4] border border-[#e3e3e8] flex items-center justify-center text-[#4b4b53]">
                  <Puzzle size={16} strokeWidth={1.8} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-[13px] font-medium text-[#1c1c21]">{plugin.name}</h4>
                    <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded">
                      v{plugin.version}
                    </span>
                    {plugin.isBuiltin ? (
                      <span className="text-[10px] text-[#189a58] bg-[#e4f6ec] px-1.5 py-[1px] rounded font-medium">
                        内置核心
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#4f46e5] bg-[#eeedfd] px-1.5 py-[1px] rounded font-medium">
                        第三方扩展
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-[#85858d] mt-0.5">{plugin.description}</div>
                </div>
              </div>

              <div className="text-right text-[11px] font-mono text-[#85858d]">
                <div>槽位标题: {plugin.sidebarItem?.title || '未配置'}</div>
                <div className="mt-0.5">优先级: {plugin.sidebarItem?.order}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 规范卡片 */}
      <div className="bg-white border border-[#e3e3e8] rounded-[10px] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#1c1c21] mb-1">
          <Sparkles className="text-[#4f46e5]" size={14} />
          <span>开发新的 openLoop 插件</span>
        </div>
        <p className="text-[11.5px] text-[#85858d] mb-2.5">
          在插件目录编写满足 <code className="text-[#1c1c21] font-mono">manifest.json</code> 规范的声明即可动态注册至侧边栏。
        </p>
        <div className="bg-[#f9f9fb] border border-[#e3e3e8] p-3 rounded-[6px] font-mono text-[11px] text-[#4b4b53]">
          {`{
  "id": "custom-qa-tool",
  "name": "自动化测试扩展",
  "sidebarItem": { "title": "测试扩展", "icon": "Workflow", "order": 10 }
}`}
        </div>
      </div>
    </div>
  );
};
