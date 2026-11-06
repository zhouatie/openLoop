import React, { useState } from 'react';
import {
  ShieldCheck,
  Layers,
  Workflow,
  Target,
  FileVideo,
  Bell,
  Cpu,
  GitBranch,
  Plus,
  Trash2,
  Check,
  ExternalLink,
  Search,
  Sparkles,
  Boxes,
  RefreshCw,
  Sliders,
  Download,
  Folder,
} from 'lucide-react';
import { PluginManifest } from '@openloop/core';
import { api } from '../services/api';
import { toast } from '../components/Toast';

interface PluginManagerViewProps {
  plugins: PluginManifest[];
  onRefresh: () => void;
  embedded?: boolean;
}

interface CatalogPlugin {
  id: string;
  name: string;
  version: string;
  category: 'slot' | 'node' | 'hook';
  categoryLabel: string;
  author: string;
  isOfficial: boolean;
  description: string;
  iconBg: string;
  iconColor: string;
  icon: React.ReactNode;
  manifest: PluginManifest;
}

// 精选插件与能力扩展清单 (预置推荐生态)
const CATALOG_PLUGINS: CatalogPlugin[] = [
  {
    id: 'kanban',
    name: '任务看板',
    version: '1.0.0',
    category: 'slot',
    categoryLabel: '侧边栏插槽',
    author: 'openLoop 官方',
    isOfficial: true,
    description: '可视化任务全自动化流转看板，支持五阶状态追踪、产物审核与人工即时介入。',
    iconBg: 'bg-[#1c1c21]',
    iconColor: 'text-white',
    icon: <Layers size={17} strokeWidth={2.2} />,
    manifest: {
      id: 'kanban',
      name: '任务看板',
      version: '1.0.0',
      description: '可视化任务全自动化流转看板，支持阶段追踪与人工介入',
      isBuiltin: true,
      sidebarItem: { id: 'kanban', title: '任务看板', icon: 'Kanban', order: 1, path: '/kanban' },
    },
  },
  {
    id: 'workflow-editor',
    name: '流程编排',
    version: '1.0.0',
    category: 'slot',
    categoryLabel: '侧边栏插槽',
    author: 'openLoop 官方',
    isOfficial: true,
    description: '用 Markdown 写清流程的流水线设计与调试器，步骤由编排 Agent 按文档执行。',
    iconBg: 'bg-[#eeedfd]',
    iconColor: 'text-[#4f46e5]',
    icon: <Workflow size={17} strokeWidth={2} />,
    manifest: {
      id: 'workflow-editor',
      name: '流程编排',
      version: '1.0.0',
      description: '用 Markdown 描述流程的自动化流水线设计器',
      isBuiltin: true,
      sidebarItem: { id: 'workflow-editor', title: '流程编排', icon: 'Workflow', order: 2, path: '/workflow' },
    },
  },
  {
    id: 'plugin-manager',
    name: '插件扩展',
    version: '1.0.0',
    category: 'slot',
    categoryLabel: '侧边栏插槽',
    author: 'openLoop 官方',
    isOfficial: true,
    description: '管理侧边栏开放插件插槽、自定义流程节点扩展与第三方能力市场。',
    iconBg: 'bg-[#f1f1f4]',
    iconColor: 'text-[#1c1c21]',
    icon: <Boxes size={17} strokeWidth={2} />,
    manifest: {
      id: 'plugin-manager',
      name: '插件中心',
      version: '1.0.0',
      description: '管理侧边栏插件插槽与自定义流程节点扩展',
      isBuiltin: true,
      sidebarItem: { id: 'plugin-manager', title: '插件扩展', icon: 'Puzzle', order: 3, path: '/plugins' },
    },
  },
  {
    id: 'openloop-plugin-qa-midscene',
    name: 'Midscene QA 自动化测试',
    version: '1.0.0',
    category: 'slot',
    categoryLabel: '侧边栏插槽',
    author: 'openLoop 官方',
    isOfficial: true,
    description: '基于 Midscene.js 的多模态视觉 UI 自动化测试插件，支持可视化用例管理、自然语言断言、步骤执行截图与逐帧时间轴回放。',
    iconBg: 'bg-[#e4f6ec]',
    iconColor: 'text-[#189a58]',
    icon: <Target size={17} strokeWidth={2} />,
    manifest: {
      id: 'openloop-plugin-qa-midscene',
      name: 'QA 自动化',
      version: '1.0.0',
      description: '多模态视觉 UI 自动化测试与逐帧时间轴回放',
      isBuiltin: false,
      entry: 'http://localhost:5175',
      sidebarItem: {
        id: 'openloop-plugin-qa-midscene',
        title: 'QA 自动化',
        icon: 'Target',
        order: 4,
        path: '/qa',
      },
    },
  },
  {
    id: 'plugin_stitch_image',
    name: '动图多帧合成器',
    version: '1.1.0',
    category: 'node',
    categoryLabel: '流水线执行器',
    author: 'openLoop 官方',
    isOfficial: true,
    description: '自动将各环节的测试结果与步骤截图合成为动图，供 QA 在看板上一键快速验收。',
    iconBg: 'bg-[#eff6ff]',
    iconColor: 'text-[#1d4ed8]',
    icon: <FileVideo size={17} strokeWidth={2} />,
    manifest: {
      id: 'plugin_stitch_image',
      name: '动图多帧合成器',
      version: '1.1.0',
      description: '截屏多帧序列合成为交互式动图',
      isBuiltin: false,
    },
  },
  {
    id: 'plugin_feishu_notifier',
    name: '飞书 / Webhook 告警',
    version: '1.0.8',
    category: 'hook',
    categoryLabel: '生命周期 Hook',
    author: '社区精选',
    isOfficial: false,
    description: '当流水线遇到错误或到达待验收节点时，自动向飞书群、企业微信推送富文本卡片。',
    iconBg: 'bg-[#fbf0df]',
    iconColor: 'text-[#b45309]',
    icon: <Bell size={17} strokeWidth={2} />,
    manifest: {
      id: 'plugin_feishu_notifier',
      name: '飞书 / Webhook 告警',
      version: '1.0.8',
      description: '流水线状态机事件群聊通知与卡片交互',
      isBuiltin: false,
    },
  },
  {
    id: 'plugin_benchmark_suite',
    name: '性能基准与压测套件',
    version: '2.0.1',
    category: 'slot',
    categoryLabel: '侧边栏插槽',
    author: '社区精选',
    isOfficial: false,
    description: '在侧边栏挂载独立的吞吐量、响应延迟与压测面板，监控自动化执行时的系统负载。',
    iconBg: 'bg-[#fdf2f8]',
    iconColor: 'text-[#db2777]',
    icon: <Cpu size={17} strokeWidth={2} />,
    manifest: {
      id: 'plugin_benchmark_suite',
      name: '性能基准与压测套件',
      version: '2.0.1',
      description: '系统资源与流程执行性能基准压测',
      isBuiltin: false,
      sidebarItem: {
        id: 'plugin_benchmark_suite',
        title: '性能压测',
        icon: 'Cpu',
        order: 5,
        path: '/benchmark',
      },
    },
  },
  {
    id: 'plugin_git_sandbox',
    name: 'Git Worktree 隔离沙箱',
    version: '1.3.0',
    category: 'node',
    categoryLabel: '环境扩展',
    author: '社区精选',
    isOfficial: false,
    description: '为流水线中的并发 Agent 任务分配独立无污染的本地 Git 工作树，杜绝代码脏写。',
    iconBg: 'bg-[#f4f4f7]',
    iconColor: 'text-[#4b4b53]',
    icon: <GitBranch size={17} strokeWidth={2} />,
    manifest: {
      id: 'plugin_git_sandbox',
      name: 'Git Worktree 隔离沙箱',
      version: '1.3.0',
      description: 'Agent 并发多任务 Git 工作区物理隔离',
      isBuiltin: false,
    },
  },
];

export const PluginManagerView: React.FC<PluginManagerViewProps> = ({
  plugins,
  onRefresh,
  embedded = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'installed' | 'market'>('all');
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [customSpec, setCustomSpec] = useState('');
  const [manualLoading, setManualLoading] = useState(false);

  // 获取已安装插件的 ID 集合
  const installedMap = new Map(plugins.map((p) => [p.id, p]));

  // 合并系统已安装列表与预置生态列表
  const allPluginItems: CatalogPlugin[] = [...CATALOG_PLUGINS];

  // 如果用户安装了自定义插件（不在预置列表中），动态补充进来
  plugins.forEach((p) => {
    if (!allPluginItems.some((item) => item.id === p.id)) {
      allPluginItems.push({
        id: p.id,
        name: p.name,
        version: p.version || '1.0.0',
        category: p.sidebarItem ? 'slot' : 'node',
        categoryLabel: p.sidebarItem ? '侧边栏插槽' : '流程扩展',
        author: p.author || '本地插件',
        isOfficial: false,
        description: p.description || '自定义本地扩展插件',
        iconBg: 'bg-[#f1f1f4]',
        iconColor: 'text-[#1c1c21]',
        icon: <Boxes size={17} strokeWidth={2} />,
        manifest: p,
      });
    }
  });

  const filteredPlugins = allPluginItems.filter((item) => {
    const isInstalled = installedMap.has(item.id);
    if (activeTab === 'installed' && !isInstalled) return false;
    if (activeTab === 'market' && isInstalled) return false;

    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.categoryLabel.toLowerCase().includes(q)
    );
  });

  // 安装插件
  const handleInstall = async (item: CatalogPlugin) => {
    setInstallingId(item.id);
    try {
      await api.registerPlugin(item.manifest);
      toast.success(`插件「${item.manifest.name}」安装成功`);
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[PluginManager] 安装插件失败:', err);
      }
      toast.error(`安装插件失败: ${err?.message || '未知错误'}`);
    } finally {
      setInstallingId(null);
    }
  };

  // 卸载插件
  const handleUninstall = async (pluginId: string) => {
    setInstallingId(pluginId);
    try {
      await api.deletePlugin(pluginId);
      toast.success('插件已成功卸载');
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[PluginManager] 卸载插件失败:', err);
      }
      toast.error(`卸载失败: ${err?.message || '未知错误'}`);
    } finally {
      setInstallingId(null);
    }
  };

  // 手动挂载本地插件
  const handleManualInstall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSpec.trim()) return;

    setManualLoading(true);
    try {
      const name = customSpec.trim().split('/').pop() || customSpec.trim();
      const newManifest: PluginManifest = {
        id: `plugin_${Date.now().toString(36)}`,
        name: `扩展: ${name}`,
        version: '1.0.0',
        description: `从路径 [${customSpec.trim()}] 载入的本地自定义扩展`,
        author: 'Local Developer',
        isBuiltin: false,
        sidebarItem: {
          id: `plugin_${Date.now().toString(36)}`,
          title: name.slice(0, 8),
          icon: 'Puzzle',
          order: 10 + plugins.length,
          path: `/${name}`,
        },
      };

      await api.registerPlugin(newManifest);
      setCustomSpec('');
      toast.success(`本地扩展 [${name}] 已成功挂载至侧边栏！`);
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[PluginManager] 挂载本地扩展失败:', err);
      }
      toast.error(`挂载失败: ${err?.message || '未知错误'}`);
    } finally {
      setManualLoading(false);
    }
  };

  return (
    <div
      className={
        embedded
          ? 'w-full space-y-4'
          : 'flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-y-auto select-none p-6 space-y-4'
      }
    >
      {/* 1:1 对齐 Magpie 的 pm-intro 顶部开场横幅卡片 */}
      <div className="relative overflow-hidden bg-white border border-[#e3e3e8] rounded-[14px] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex items-center justify-between gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h2 className="text-[15.5px] font-semibold text-[#1c1c21] tracking-tight">
              插件扩展 openLoop
            </h2>
            <span className="text-[11px] font-mono text-[#85858d] bg-[#f4f4f6] border border-[#ececf0] px-1.5 py-[0.5px] rounded">
              v0.1.0 架构
            </span>
          </div>

          <p className="text-[12px] text-[#4b4b53] leading-relaxed max-w-[620px]">
            插件负责接入自定义执行器、侧边栏独立视图或 CLI 工具链，无缝扩展流水线的自动化能力与可观测性。
          </p>

          <p className="text-[12px] text-[#4b4b53] leading-relaxed max-w-[620px] mt-1">
            插件运行在 openLoop Core 守护进程中，可拦截 DAG 执行事件，接入通知告警，或挂载自定义侧边栏配置面板。{' '}
            <span className="inline-flex items-center gap-0.5 text-[#4f46e5] hover:underline cursor-pointer font-medium">
              编写插件 <ExternalLink size={11} />
            </span>
          </p>

          <div className="flex items-center gap-1.5 mt-2.5 text-[11.5px] text-[#85858d]">
            <ShieldCheck size={13} className="text-[#189a58] shrink-0" />
            <span>插件运行在本地守护进程，会执行真实代码或挂载侧边栏视图：只安装你信任的插件。</span>
          </div>
        </div>

        {/* 右侧悬浮图标墙 (1:1 还原 Magpie 的 pm-art 倾斜艺术徽章) */}
        <div className="hidden md:grid grid-cols-3 gap-2 transform -rotate-6 shrink-0 mr-2">
          <div className="w-[36px] h-[36px] rounded-[10px] bg-[#1c1c21] text-white flex items-center justify-center shadow-md">
            <Layers size={18} />
          </div>
          <div className="w-[36px] h-[36px] rounded-[10px] bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center shadow-md border border-[#d8d6fb] translate-y-1">
            <Workflow size={18} />
          </div>
          <div className="w-[36px] h-[36px] rounded-[10px] bg-[#e4f6ec] text-[#189a58] flex items-center justify-center shadow-md border border-[#c3eed7]">
            <Target size={18} />
          </div>
          <div className="w-[36px] h-[36px] rounded-[10px] bg-[#eff6ff] text-[#1d4ed8] flex items-center justify-center shadow-md border border-[#dbeafe] col-start-2">
            <FileVideo size={18} />
          </div>
          <div className="w-[36px] h-[36px] rounded-[10px] bg-[#fbf0df] text-[#b45309] flex items-center justify-center shadow-md border border-[#f3d0a1] translate-y-1">
            <Bell size={18} />
          </div>
        </div>
      </div>

      {/* 分类栏与搜索过滤 (对齐 Magpie pm-sechead & pm-find) */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#e6e6eb] p-[2px] rounded-[7px]">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 h-[24px] rounded-[5px] text-[12px] transition-all ${
                activeTab === 'all'
                  ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              全部扩展 ({allPluginItems.length})
            </button>
            <button
              onClick={() => setActiveTab('installed')}
              className={`px-3 h-[24px] rounded-[5px] text-[12px] transition-all ${
                activeTab === 'installed'
                  ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              已挂载 ({plugins.length})
            </button>
            <button
              onClick={() => setActiveTab('market')}
              className={`px-3 h-[24px] rounded-[5px] text-[12px] transition-all ${
                activeTab === 'market'
                  ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              推荐市场
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 搜索框 */}
          <div className="relative w-56">
            <input
              type="text"
              placeholder="搜索插件或能力..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-[28px] bg-white border border-[#e3e3e8] rounded-[6px] px-2.5 text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#b9b9c2]"
            />
          </div>

          <button
            onClick={() => onRefresh()}
            className="flex items-center gap-1 h-[28px] px-2.5 rounded-[6px] bg-white border border-[#e3e3e8] text-[#85858d] hover:text-[#1c1c21] text-[11.5px] transition-colors shadow-sm"
            title="刷新插件列表"
          >
            <RefreshCw size={12} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* 网格卡片区 (1:1 对齐 Magpie 的 pm-grid 卡片布局) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
        {filteredPlugins.map((item) => {
          const installed = installedMap.get(item.id);
          const isInstalled = Boolean(installed);
          const isBuiltin = installed?.isBuiltin || item.manifest.isBuiltin;
          const isBusy = installingId === item.id;

          return (
            <div
              key={item.id}
              className="bg-white border border-[#e3e3e8] hover:border-[#b9b9c2] rounded-[12px] p-3.5 flex flex-col justify-between transition-all duration-150 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(20,22,30,0.06)] group"
            >
              <div>
                {/* 卡片头部：Logo + 标题与作者 + 操作按钮 */}
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div
                      className={`w-[36px] h-[36px] rounded-[9px] flex items-center justify-center shrink-0 shadow-sm ${item.iconBg} ${item.iconColor}`}
                    >
                      {item.icon}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[13px] text-[#1c1c21] truncate leading-tight">
                        {item.name}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5 text-[11px] text-[#85858d]">
                        {item.isOfficial ? (
                          <span className="flex items-center gap-0.5 text-[#189a58] font-medium">
                            <ShieldCheck size={11} />
                            <span>openLoop 官方</span>
                          </span>
                        ) : (
                          <span>{item.author}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 状态操作胶囊按钮 (对齐 Magpie 的 .pm-act 按钮) */}
                  <div className="shrink-0">
                    {isBuiltin ? (
                      <span className="h-[24px] px-2.5 rounded-[12px] bg-[#f1f1f4] text-[#85858d] text-[11px] font-medium flex items-center border border-[#e3e3e8]">
                        内置核心
                      </span>
                    ) : isInstalled ? (
                      <button
                        disabled={isBusy}
                        onClick={() => handleUninstall(item.id)}
                        className="h-[24px] px-2.5 rounded-[12px] bg-[#e4f6ec] hover:bg-[#fee2e2] text-[#189a58] hover:text-[#e5484d] text-[11px] font-medium flex items-center gap-1 transition-all active:scale-95 group/btn"
                        title="点击卸载此扩展"
                      >
                        <Check size={11} className="group-hover/btn:hidden" />
                        <Trash2 size={11} className="hidden group-hover/btn:inline" />
                        <span className="group-hover/btn:hidden">已挂载</span>
                        <span className="hidden group-hover/btn:inline">卸载</span>
                      </button>
                    ) : (
                      <button
                        disabled={isBusy}
                        onClick={() => handleInstall(item)}
                        className="h-[24px] px-3 rounded-[12px] bg-[#eeedfd] hover:bg-[#4f46e5] text-[#4f46e5] hover:text-white text-[11.5px] font-semibold flex items-center gap-1 transition-all active:scale-95 shadow-sm disabled:opacity-50"
                      >
                        <Download size={11} strokeWidth={2.4} />
                        <span>{isBusy ? '安装中...' : '安装'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 描述说明文案 */}
                <p className="text-[12px] text-[#4b4b53] mt-2.5 h-[34px] line-clamp-2 leading-relaxed">
                  {item.description}
                </p>
              </div>

              {/* 卡片底部元数据 (对齐 Magpie 的 .pm-meta) */}
              <div className="mt-3 pt-2.5 border-t border-[#ececf0] flex items-center justify-between text-[11px] text-[#85858d]">
                <div className="flex items-center gap-1.5">
                  <span className="h-[18px] px-1.5 rounded-[4px] bg-[#f1f1f4] text-[#63636b] text-[10px] font-medium border border-[#e3e3e8]">
                    {item.categoryLabel}
                  </span>
                  <span className="font-mono text-[10.5px]">v{item.version}</span>
                </div>

                <div className="font-mono text-[10.5px] text-[#85858d]">
                  {item.manifest.sidebarItem
                    ? `侧边栏 #${item.manifest.sidebarItem.order}`
                    : '无插槽视图'}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部：手动安装与本地开发卡片 (1:1 对齐 Magpie 的 pm-manual) */}
      <form
        onSubmit={handleManualInstall}
        className="bg-white/80 border border-dashed border-[#d1d1d8] rounded-[12px] p-3.5 flex items-center justify-between gap-3 text-[#1c1c21]"
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-[7px] bg-[#f4f4f7] border border-[#e3e3e8] flex items-center justify-center text-[#85858d] shrink-0">
            <Folder size={15} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-medium text-[#1c1c21]">
              想挂载本地开发目录或自定义插件？
            </div>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                placeholder="输入本地插件路径或 npm 包名，例如: ~/.openloop/plugins/my-qa-tool"
                value={customSpec}
                onChange={(e) => setCustomSpec(e.target.value)}
                className="w-full max-w-[480px] h-[26px] bg-white border border-[#e3e3e8] rounded-[5px] px-2.5 text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none font-mono focus:border-[#4f46e5]"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={manualLoading || !customSpec.trim()}
          className="h-[26px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-40 shrink-0 shadow-sm"
        >
          <Plus size={12} strokeWidth={2.4} />
          <span>{manualLoading ? '加载中...' : '安装本地插件'}</span>
        </button>
      </form>
    </div>
  );
};
