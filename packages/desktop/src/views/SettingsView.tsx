import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Globe,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  Terminal,
  RotateCcw,
  Sliders,
  Folder,
  FolderOpen,
  Download,
  Keyboard,
  Cpu,
  Boxes,
  Lock,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Layers,
  Workflow,
  Puzzle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api } from '../services/api';
import {
  OpenLoopSettings,
  AgentProviderType,
  PiThinkingLevel,
  ShortcutSuperKey,
  PluginManifest,
} from '@openloop/core';
import { useShortcuts } from '../context/ShortcutContext';
import { Kbd } from '../components/Kbd';
import { toast } from '../components/Toast';
import { PluginManagerView } from './PluginManagerView';
import {
  getSortedSidebarPlugins,
  saveStoredSidebarOrder,
  moveSidebarItem,
} from '../utils/sidebarOrder';

export type SettingsTabId = 'agent' | 'workspace' | 'sidebar' | 'plugins' | 'shortcuts';

interface SettingsViewProps {
  activeSubTab?: string;
  onSelectSubTab?: (id: string) => void;
  plugins?: PluginManifest[];
  sidebarOrder?: string[];
  onUpdateSidebarOrder?: (newOrder: string[]) => void;
  onRefreshPlugins?: () => void;
}

const SETTINGS_TAB_ITEMS: { id: SettingsTabId; label: string; icon: React.ReactNode }[] = [
  { id: 'agent', label: '智能体驱动', icon: <Cpu size={14} strokeWidth={2} /> },
  { id: 'workspace', label: '工作区与环境', icon: <Folder size={14} strokeWidth={2} /> },
  { id: 'sidebar', label: '侧边栏排序', icon: <Sliders size={14} strokeWidth={2} /> },
  { id: 'plugins', label: '插件扩展', icon: <Boxes size={14} strokeWidth={2} /> },
  { id: 'shortcuts', label: '快捷键', icon: <Keyboard size={14} strokeWidth={2} /> },
];

const SIDEBAR_ICON_MAP: Record<string, React.ReactNode> = {
  Kanban: <Layers size={14} strokeWidth={2} />,
  Workflow: <Workflow size={14} strokeWidth={2} />,
  Boxes: <Boxes size={14} strokeWidth={2} />,
  Cpu: <Cpu size={14} strokeWidth={2} />,
  Puzzle: <Puzzle size={14} strokeWidth={2} />,
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  activeSubTab,
  onSelectSubTab,
  plugins = [],
  sidebarOrder = [],
  onUpdateSidebarOrder,
  onRefreshPlugins,
}) => {
  // 解析初始选中的 Tab
  const resolveInitialTab = (): SettingsTabId => {
    if (activeSubTab) {
      if (activeSubTab.includes('plugin')) return 'plugins';
      if (activeSubTab.includes('sidebar')) return 'sidebar';
      if (activeSubTab.includes('general') || activeSubTab.includes('workspace')) return 'workspace';
      if (activeSubTab.includes('shortcut')) return 'shortcuts';
      if (activeSubTab.includes('agent')) return 'agent';
    }
    try {
      const saved = localStorage.getItem('openloop_settings_active_tab') as SettingsTabId;
      if (saved && SETTINGS_TAB_ITEMS.some((t) => t.id === saved)) {
        return saved;
      }
    } catch {}
    return 'agent';
  };

  const [activeTab, setActiveTab] = useState<SettingsTabId>(resolveInitialTab);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 快捷键状态
  const { superKey, setSuperKey, superKeyLabel } = useShortcuts();

  // 表单状态
  const [agentProvider, setAgentProvider] = useState<AgentProviderType>('pi');
  const [piModel, setPiModel] = useState('');
  const [piThinking, setPiThinking] = useState<PiThinkingLevel>('medium');
  const [piTools, setPiTools] = useState('read,bash,edit,write,grep,find');
  const [defaultCwd, setDefaultCwd] = useState('');
  const [autoSnapshot, setAutoSnapshot] = useState(true);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // 导出配置状态
  const [isExporting, setIsExporting] = useState(false);
  const [hasExported, setHasExported] = useState(false);

  // 拖拽排序状态
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // 当外部 activeSubTab 发生变化时同步更新
  useEffect(() => {
    if (!activeSubTab) return;
    let target: SettingsTabId = 'agent';
    if (activeSubTab.includes('plugin')) target = 'plugins';
    else if (activeSubTab.includes('sidebar')) target = 'sidebar';
    else if (activeSubTab.includes('general') || activeSubTab.includes('workspace')) target = 'workspace';
    else if (activeSubTab.includes('shortcut')) target = 'shortcuts';
    else if (activeSubTab.includes('agent')) target = 'agent';

    setActiveTab((prev) => {
      if (prev !== target) {
        if (import.meta.env?.DEV) {
          console.log('[Settings] 外部联动切换 Tab:', target);
        }
        return target;
      }
      return prev;
    });
  }, [activeSubTab]);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTabChange = (tabId: SettingsTabId) => {
    if (import.meta.env?.DEV) {
      console.log('[Settings] 切换设置选项卡:', { from: activeTab, to: tabId });
    }
    setActiveTab(tabId);
    try {
      localStorage.setItem('openloop_settings_active_tab', tabId);
    } catch {}
    if (onSelectSubTab) {
      onSelectSubTab(`settings-${tabId}`);
    }
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      const settings = await api.getSettings();
      if (settings) {
        if (settings.agentProvider) setAgentProvider(settings.agentProvider);
        if (settings.piModel !== undefined) setPiModel(settings.piModel);
        if (settings.piThinking) setPiThinking(settings.piThinking);
        if (settings.piTools) setPiTools(settings.piTools);
        if (settings.defaultCwd) setDefaultCwd(settings.defaultCwd);
        if (settings.autoSnapshot !== undefined) setAutoSnapshot(settings.autoSnapshot);
      }
    } catch (err) {
      console.error('加载系统设置失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (override?: Partial<OpenLoopSettings>) => {
    const payload: OpenLoopSettings = {
      agentProvider,
      piModel,
      piThinking,
      piTools,
      defaultCwd,
      autoSnapshot,
      ...override,
    };
    try {
      await api.updateSettings(payload);
      if (import.meta.env?.DEV) {
        console.log('[Settings] 配置已自动持久化:', payload);
      }
      setSaveStatus('已自动保存');
      setTimeout(() => setSaveStatus(null), 1800);
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[Settings] 保存配置失败:', err);
      }
      toast.error(`保存失败: ${err?.message || '未知错误'}`);
    }
  };

  const handleBrowseCwd = async () => {
    try {
      const chosen = await api.selectDirectory({ defaultPath: defaultCwd || undefined });
      if (chosen) {
        setDefaultCwd(chosen);
        await handleSave({ defaultCwd: chosen });
      }
    } catch (err) {
      console.error('选择目录失败:', err);
    }
  };

  const handleExportConfig = async () => {
    if (import.meta.env?.DEV) {
      console.log('[Settings:Export] 用户触发导出配置文件操作');
    }

    try {
      setIsExporting(true);
      let baseSettings: OpenLoopSettings = {};
      try {
        baseSettings = await api.getSettings();
      } catch (fetchErr) {
        if (import.meta.env?.DEV) {
          console.warn('[Settings:Export] 获取远端最新配置失败，使用本地状态', fetchErr);
        }
      }

      const configToExport: OpenLoopSettings = {
        ...baseSettings,
        agentProvider,
        piModel,
        piThinking,
        piTools,
        defaultCwd,
        autoSnapshot,
        shortcutSuperKey: superKey,
      };

      const jsonContent = JSON.stringify(configToExport, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'openloop-settings.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      if (import.meta.env?.DEV) {
        console.log(`[Settings:Export] openloop-settings.json 导出成功，文件大小: ${blob.size} 字节`);
      }

      toast.success('配置文件 openloop-settings.json 导出成功');
      setHasExported(true);
      setTimeout(() => setHasExported(false), 2000);
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[Settings:Export] 导出配置文件发生异常:', err);
      }
      toast.error(`导出配置文件失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const presetModels = [
    { label: 'Claude 3.7 Sonnet', value: 'sonnet' },
    { label: 'Gemini 3.6 Flash', value: 'gemini-3.6-flash' },
    { label: 'GPT-4o', value: 'gpt-4o' },
    { label: 'DeepSeek R1 Reasoner', value: 'deepseek-reasoner' },
  ];

  const currentModelDisplay = piModel
    ? presetModels.find((m) => m.value === piModel)?.label || piModel
    : '自动 · 继承 Pi 本地配置';

  // 计算当前排好序的侧边栏插件清单
  const currentSidebarPlugins = useMemo(() => {
    return getSortedSidebarPlugins(plugins, sidebarOrder);
  }, [plugins, sidebarOrder]);

  // 上移某一项（禁止移动前两项固定项）
  const handleMoveUp = (index: number) => {
    if (index <= 2) return; // 索引 0, 1 不可排；索引 2 是可排项第一位，不能往上移动跨越固定项
    const updated = moveSidebarItem(currentSidebarPlugins, index, index - 1);
    const newOrderIds = updated.map((p) => p.id);
    if (onUpdateSidebarOrder) {
      onUpdateSidebarOrder(newOrderIds);
    }
    toast.success('已更新侧边栏排序');
  };

  // 下移某一项（禁止移动前两项固定项）
  const handleMoveDown = (index: number) => {
    if (index < 2 || index >= currentSidebarPlugins.length - 1) return;
    const updated = moveSidebarItem(currentSidebarPlugins, index, index + 1);
    const newOrderIds = updated.map((p) => p.id);
    if (onUpdateSidebarOrder) {
      onUpdateSidebarOrder(newOrderIds);
    }
    toast.success('已更新侧边栏排序');
  };

  // 恢复默认侧边栏排序
  const handleResetSidebarOrder = () => {
    if (import.meta.env?.DEV) {
      console.log('[Settings:SidebarOrder] 恢复侧边栏默认排序');
    }
    saveStoredSidebarOrder([]);
    if (onUpdateSidebarOrder) {
      onUpdateSidebarOrder([]);
    }
    toast.success('已恢复侧边栏默认排序');
  };

  // 拖拽排序处理
  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (index < 2) {
      e.preventDefault();
      return;
    }
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (index < 2) return; // 不能拖到前两项区域
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex < 2 || targetIndex < 2 || draggingIndex === targetIndex) {
      setDraggingIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = moveSidebarItem(currentSidebarPlugins, draggingIndex, targetIndex);
    const newOrderIds = updated.map((p) => p.id);
    if (onUpdateSidebarOrder) {
      onUpdateSidebarOrder(newOrderIds);
    }
    toast.success('已更新侧边栏排序');
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-y-auto select-none px-8 py-6">
      <div className="max-w-[1040px] w-full space-y-5 mx-auto">
        {/* ==================== 顶部标题与 Tab 导航栏 ==================== */}
        <div className="pb-1 pt-1 space-y-3.5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[17px] font-semibold text-[#1c1c21] tracking-tight">系统设置</h1>
              <p className="text-[12px] text-[#85858d] mt-0.5">
                管理 openLoop 核心调度服务、智能体驱动、侧边栏导航与插件生态
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              {saveStatus && (
                <span className="text-[11.5px] text-[#189a58] flex items-center gap-1 bg-[#eaf7ee] px-2 py-1 rounded-[6px] transition-all">
                  <Check size={12} className="stroke-[2.2]" />
                  <span>{saveStatus}</span>
                </span>
              )}

              <button
                type="button"
                onClick={handleExportConfig}
                disabled={isExporting}
                className={`h-[28px] px-3 rounded-[7px] text-[12px] font-medium flex items-center gap-1.5 transition-all shadow-[0_1px_2px_rgba(0,0,0,0.04)] border cursor-pointer active:scale-95 ${
                  hasExported
                    ? 'bg-[#eaf7ee] border-[#b6e8c4] text-[#189a58]'
                    : 'bg-white hover:bg-[#fafafc] active:bg-[#f1f1f4] border-[#e3e3e8] text-[#1c1c21] hover:border-[#d0d0d7]'
                }`}
                title="导出当前配置为 openloop-settings.json"
              >
                {hasExported ? (
                  <>
                    <Check size={13} className="stroke-[2.2]" />
                    <span>已导出 JSON</span>
                  </>
                ) : (
                  <>
                    <Download size={13} className="text-[#63636b] stroke-[1.9]" />
                    <span>导出配置</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 选项卡切换 Bar (macOS 极简分段器设计) */}
          <div className="inline-flex p-[3px] rounded-[9px] bg-[#e6e6eb] border border-[#dddee3] shadow-sm">
            {SETTINGS_TAB_ITEMS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-[7px] text-[12.5px] transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white text-[#1c1c21] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.1),0_0_0_0.5px_rgba(0,0,0,0.04)]'
                      : 'text-[#63636b] hover:text-[#1c1c21] hover:bg-white/40'
                  }`}
                >
                  <span className={isActive ? 'text-[#1c1c21]' : 'text-[#85858d]'}>
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ==================== TAB 1: 智能体驱动 ==================== */}
        {activeTab === 'agent' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* 智能体底层驱动 */}
            <div>
              <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
                代码智能体引擎
              </div>

              <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                {/* 默认智能体驱动 */}
                <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#1c1c21]">默认代码智能体</div>
                    <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                      流水线执行代码实现、单元自测时的底层驱动；选用 Pi Agent 时将通过本地 Pi CLI 自动派发独立会话
                    </div>
                  </div>

                  <div className="inline-flex p-[2px] rounded-[7px] bg-[#e6e6eb] shrink-0 self-center">
                    <button
                      type="button"
                      onClick={() => {
                        setAgentProvider('pi');
                        handleSave({ agentProvider: 'pi' });
                      }}
                      className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer ${
                        agentProvider === 'pi'
                          ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                          : 'text-[#63636b] hover:text-[#1c1c21]'
                      }`}
                    >
                      Pi Agent (推荐)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAgentProvider('custom-cli');
                        handleSave({ agentProvider: 'custom-cli' });
                      }}
                      className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer ${
                        agentProvider === 'custom-cli'
                          ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                          : 'text-[#63636b] hover:text-[#1c1c21]'
                      }`}
                    >
                      自定义 CLI 脚本
                    </button>
                  </div>
                </div>

                {/* 终端会话恢复命令 */}
                <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#1c1c21]">终端会话交互恢复</div>
                    <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                      为每个任务派发唯一的 Session ID，在系统终端中随时可通过 pi resume 交互式接管并继续讨论
                    </div>
                  </div>

                  <div className="shrink-0 self-center flex items-center gap-1.5 font-mono text-[11.5px] text-[#4b4b53]">
                    <span>pi --session &lt;sessionId&gt;</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard('pi --session session_<taskId>', 'resumeCmd')}
                      className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-colors cursor-pointer"
                      title="复制恢复命令格式"
                    >
                      {copiedKey === 'resumeCmd' ? (
                        <Check size={12} className="text-[#189a58]" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                </div>

                {/* 会话终端 */}
                <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#1c1c21]">交互终端程序</div>
                    <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                      在看板点击「在终端打开」时默认唤起的宿主系统终端程序
                    </div>
                  </div>

                  <div className="shrink-0 self-center">
                    <span className="text-[11.5px] text-[#4b4b53] font-mono bg-[#f1f1f4] border border-[#e3e3e8] px-2.5 py-1 rounded-[5px]">
                      macOS Terminal / iTerm
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Pi Agent 配置 */}
            {agentProvider === 'pi' && (
              <div>
                <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
                  Pi Agent 参数配置
                </div>

                <div className="bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  {/* 模型选择 */}
                  <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#1c1c21]">智能体模型</div>
                      <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                        任务执行调用的基础大语言模型，留空则自动继承本地 Pi CLI 默认模型
                      </div>
                    </div>

                    <div className="shrink-0 self-center flex items-center gap-1.5 relative">
                      <div className="relative">
                        <div className="h-[26px] px-2.5 rounded-[13px] bg-[#f1f1f4] hover:bg-[#e9e9ee] border border-[#e3e3e8] text-[11.5px] text-[#1c1c21] flex items-center gap-1.5 transition-all shadow-sm">
                          <Globe size={12} className="text-[#4f46e5]" />
                          <span className="max-w-[180px] truncate">{currentModelDisplay}</span>
                          <ChevronDown size={11} className="text-[#85858d]" />
                        </div>
                        <select
                          value={piModel}
                          onChange={(e) => {
                            setPiModel(e.target.value);
                            handleSave({ piModel: e.target.value });
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full text-[12px]"
                          title="切换智能体模型"
                        >
                          <option value="">自动 · 继承 Pi 本地配置</option>
                          {presetModels.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label} ({m.value})
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setPiModel('');
                          handleSave({ piModel: '' });
                        }}
                        className="h-[26px] px-2 rounded-[13px] bg-[#f1f1f4] hover:bg-[#e9e9ee] border border-[#e3e3e8] text-[11px] text-[#63636b] hover:text-[#1c1c21] transition-all cursor-pointer"
                        title="重置为默认模型"
                      >
                        默认
                      </button>
                    </div>
                  </div>

                  {/* 思考推理级别 */}
                  <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#1c1c21]">思考推理级别</div>
                      <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                        控制模型在执行复杂代码实现与测试逻辑时的深度推理程度 (--thinking)
                      </div>
                    </div>

                    <div className="inline-flex p-[2px] rounded-[7px] bg-[#e6e6eb] shrink-0 self-center">
                      {(['off', 'low', 'medium', 'high'] as const).map((level) => (
                        <button
                          key={level}
                          type="button"
                          onClick={() => {
                            setPiThinking(level);
                            handleSave({ piThinking: level });
                          }}
                          className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer ${
                            piThinking === level
                              ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                              : 'text-[#63636b] hover:text-[#1c1c21]'
                          }`}
                        >
                          {level === 'off' && '关闭'}
                          {level === 'low' && '轻量'}
                          {level === 'medium' && '均衡'}
                          {level === 'high' && '深度'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 内置工具调用白名单 */}
                  <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#1c1c21]">内置工具权限 (--tools)</div>
                      <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                        允许智能体在任务工作区直接调用的核心工具集，如 read, bash, edit, write, grep, find
                      </div>
                    </div>

                    <div className="shrink-0 self-center">
                      <input
                        type="text"
                        value={piTools}
                        onChange={(e) => setPiTools(e.target.value)}
                        onBlur={() => handleSave()}
                        placeholder="read,bash,edit,write,grep,find"
                        className="w-56 h-[26px] px-2 rounded-[6px] border border-[#e3e3e8] text-[11.5px] font-mono text-[#1c1c21] placeholder-[#85858d] outline-none shadow-sm focus:border-[#4f46e5]"
                      />
                    </div>
                  </div>

                  {/* 代码编辑快照备份 */}
                  <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#1c1c21]">编辑前代码快照备份</div>
                      <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                        智能体在修改代码前自动建立本地工作区备份，确保任务异常时随时可回滚
                      </div>
                    </div>

                    <div className="inline-flex p-[2px] rounded-[7px] bg-[#e6e6eb] shrink-0 self-center">
                      <button
                        type="button"
                        onClick={() => {
                          setAutoSnapshot(false);
                          handleSave({ autoSnapshot: false });
                        }}
                        className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer ${
                          !autoSnapshot
                            ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                            : 'text-[#63636b] hover:text-[#1c1c21]'
                        }`}
                      >
                        关闭
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAutoSnapshot(true);
                          handleSave({ autoSnapshot: true });
                        }}
                        className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer ${
                          autoSnapshot
                            ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                            : 'text-[#63636b] hover:text-[#1c1c21]'
                        }`}
                      >
                        开启
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 2: 工作区与环境 ==================== */}
        {activeTab === 'workspace' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            <div>
              <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
                工作区与核心守护进程
              </div>

              <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                {/* 默认工作目录 */}
                <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#1c1c21]">默认工程工作区 (CWD)</div>
                    <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                      智能体与工作流 CLI 脚本读取代码、运行构建和自测的根目录路径
                    </div>
                  </div>

                  <div className="shrink-0 self-center flex items-center gap-1.5">
                    <input
                      type="text"
                      value={defaultCwd}
                      onChange={(e) => setDefaultCwd(e.target.value)}
                      onBlur={() => handleSave()}
                      placeholder="留空使用 openLoop 启动目录"
                      className="w-64 h-[26px] px-2 rounded-[6px] border border-[#e3e3e8] text-[11.5px] font-mono text-[#1c1c21] placeholder-[#85858d] outline-none shadow-sm focus:border-[#4f46e5]"
                    />
                    <button
                      type="button"
                      onClick={handleBrowseCwd}
                      className="h-[26px] px-2.5 rounded-[6px] bg-[#f9f9fb] hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[11.5px] font-medium flex items-center gap-1 transition-colors shadow-sm cursor-pointer"
                      title="打开系统访达选择目录"
                    >
                      <FolderOpen size={12} />
                      <span>访达</span>
                    </button>
                  </div>
                </div>

                {/* 核心守护进程地址 */}
                <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#1c1c21]">核心服务地址</div>
                    <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                      提供 RESTful 接口与 WebSocket 状态广播，数据持久化于本地 SQLite (WAL 模式)
                    </div>
                  </div>

                  <div className="shrink-0 self-center flex items-center gap-1.5 font-mono text-[11.5px] text-[#4b4b53]">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#189a58]" />
                      <span>http://127.0.0.1:19888</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard('http://127.0.0.1:19888', 'daemonUrl')}
                      className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-colors cursor-pointer"
                      title="复制服务地址"
                    >
                      {copiedKey === 'daemonUrl' ? (
                        <Check size={12} className="text-[#189a58]" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                </div>

                {/* 工作区过滤规则 */}
                <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#1c1c21]">忽略的工作区路径</div>
                    <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                      智能体检索或执行扫描时自动排除的高频路径，如 node_modules/, dist/, *.min.js 等
                    </div>
                  </div>

                  <div className="shrink-0 self-center">
                    <span className="text-[11.5px] font-mono text-[#63636b] bg-[#f1f1f4] px-2 py-0.5 rounded border border-[#e3e3e8]">
                      node_modules/, dist/, .git/
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: 侧边栏排序 ==================== */}
        {activeTab === 'sidebar' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-[#1c1c21]">侧边栏导航定制</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5">
                  前两项为核心视图锁定置顶不可调整；其它扩展插件可通过上下箭头或鼠标拖拽自由排序
                </div>
              </div>

              <button
                type="button"
                onClick={handleResetSidebarOrder}
                className="h-[26px] px-2.5 rounded-[6px] text-[11.5px] text-[#63636b] hover:text-[#1c1c21] bg-white hover:bg-[#f9f9fb] border border-[#e3e3e8] transition-colors flex items-center gap-1 shadow-sm cursor-pointer"
                title="重置侧边栏为默认排序"
              >
                <RotateCcw size={11} strokeWidth={2} />
                <span>恢复默认排序</span>
              </button>
            </div>

            <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] divide-y divide-[#ececf0]">
              {currentSidebarPlugins.map((plugin, index) => {
                const isFixed = index < 2;
                const icon =
                  (plugin.sidebarItem?.icon && SIDEBAR_ICON_MAP[plugin.sidebarItem.icon]) || (
                    <Puzzle size={14} strokeWidth={2} />
                  );
                const title = plugin.sidebarItem?.title || plugin.name;
                const isDragging = draggingIndex === index;
                const isDragOver = dragOverIndex === index;

                return (
                  <div
                    key={plugin.id}
                    draggable={!isFixed}
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`min-h-[50px] px-3.5 py-2.5 flex items-center justify-between gap-4 transition-all ${
                      isDragging ? 'opacity-40 bg-[#f9f9fb]' : 'bg-white'
                    } ${isDragOver ? 'border-t-2 border-t-[#4f46e5] bg-[#eeedfd]/20' : ''}`}
                  >
                    {/* 左侧：排序抓手 / 锁定指示器与标题 */}
                    <div className="flex items-center gap-3 min-w-0">
                      {isFixed ? (
                        <div
                          className="w-[20px] h-[20px] rounded flex items-center justify-center text-[#a1a1aa] bg-[#f4f4f6]"
                          title="系统核心功能，置顶锁定不可调整"
                        >
                          <Lock size={12} strokeWidth={2} />
                        </div>
                      ) : (
                        <div
                          className="w-[20px] h-[20px] rounded flex items-center justify-center text-[#85858d] hover:text-[#1c1c21] cursor-grab active:cursor-grabbing hover:bg-[#f1f1f4]"
                          title="拖动调整顺序"
                        >
                          <GripVertical size={13} strokeWidth={2} />
                        </div>
                      )}

                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-[24px] h-[24px] rounded-[6px] bg-[#f4f4f6] border border-[#e3e3e8] flex items-center justify-center text-[#1c1c21] shrink-0">
                          {icon}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-[#1c1c21] truncate flex items-center gap-2">
                            <span>{title}</span>
                            {isFixed ? (
                              <span className="text-[10px] text-[#63636b] bg-[#f1f1f4] border border-[#e3e3e8] px-1.5 py-[0.5px] rounded font-medium">
                                锁定置顶
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#4f46e5] bg-[#eeedfd] border border-[#d8d6fb] px-1.5 py-[0.5px] rounded font-medium">
                                扩展槽位
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#85858d] truncate mt-0.5">
                            {plugin.description || `ID: ${plugin.id}`}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 右侧：上移/下移控制器或锁定提示 */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      {isFixed ? (
                        <span className="text-[11px] text-[#a1a1aa] font-medium">
                          #{index + 1} 核心固定
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-[#85858d] font-mono mr-2">
                            #{index + 1}
                          </span>
                          <button
                            type="button"
                            disabled={index <= 2}
                            onClick={() => handleMoveUp(index)}
                            className={`w-[24px] h-[24px] rounded flex items-center justify-center transition-all ${
                              index <= 2
                                ? 'text-[#c4c4cc] cursor-not-allowed bg-transparent'
                                : 'text-[#4b4b53] hover:text-[#1c1c21] hover:bg-[#f1f1f4] active:scale-95 cursor-pointer'
                            }`}
                            title={index <= 2 ? '已处于可排项最顶部' : '向上移动'}
                          >
                            <ArrowUp size={13} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            disabled={index >= currentSidebarPlugins.length - 1}
                            onClick={() => handleMoveDown(index)}
                            className={`w-[24px] h-[24px] rounded flex items-center justify-center transition-all ${
                              index >= currentSidebarPlugins.length - 1
                                ? 'text-[#c4c4cc] cursor-not-allowed bg-transparent'
                                : 'text-[#4b4b53] hover:text-[#1c1c21] hover:bg-[#f1f1f4] active:scale-95 cursor-pointer'
                            }`}
                            title={
                              index >= currentSidebarPlugins.length - 1
                                ? '已处于最底部'
                                : '向下移动'
                            }
                          >
                            <ArrowDown size={13} strokeWidth={2} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {currentSidebarPlugins.length <= 2 && (
                <div className="p-4 text-center bg-[#fafafc] border-t border-[#ececf0]">
                  <p className="text-[12px] text-[#85858d]">
                    当前侧边栏仅包含系统核心功能项。在「插件扩展」中挂载第三方插槽插件后，可在此自由调整它们的排列顺序。
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================== TAB 4: 插件扩展 (无缝内嵌插件管理) ==================== */}
        {activeTab === 'plugins' && (
          <div className="animate-in fade-in duration-150">
            <PluginManagerView
              plugins={plugins}
              onRefresh={onRefreshPlugins || (() => {})}
              embedded={true}
            />
          </div>
        )}

        {/* ==================== TAB 5: 快捷键与控制 ==================== */}
        {activeTab === 'shortcuts' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            <div>
              <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
                全局 Super 引导键
              </div>

              <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#1c1c21]">Super 修饰键映射</div>
                    <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                      配置触发快速跳转、新建任务与命令面板的全局修饰键；可按个人习惯切换为 Control、Command 或 Alt
                    </div>
                  </div>

                  <div className="inline-flex p-[2px] rounded-[7px] bg-[#e6e6eb] shrink-0 self-center">
                    <button
                      type="button"
                      onClick={() => setSuperKey('Control')}
                      className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer ${
                        superKey === 'Control'
                          ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                          : 'text-[#63636b] hover:text-[#1c1c21]'
                      }`}
                    >
                      Control (默认)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuperKey('Meta')}
                      className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer ${
                        superKey === 'Meta'
                          ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                          : 'text-[#63636b] hover:text-[#1c1c21]'
                      }`}
                    >
                      Command (⌘)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuperKey('Alt')}
                      className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer ${
                        superKey === 'Alt'
                          ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                          : 'text-[#63636b] hover:text-[#1c1c21]'
                      }`}
                    >
                      Alt / Option (⌥)
                    </button>
                  </div>
                </div>

                {/* 快捷键生效清单 (已彻底移除之前的 Super + 3) */}
                <div className="px-3.5 py-3.5 bg-[#fafafc]">
                  <div className="text-[12px] font-medium text-[#1c1c21] mb-2.5 flex items-center justify-between">
                    <span>当前已启用的快捷键映射</span>
                    <span className="text-[11px] text-[#85858d] font-normal">
                      打字与表单输入时单键不会被拦截
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">任务看板</span>
                      <Kbd keys={['super', '1']} size="xs" />
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">流程编排</span>
                      <Kbd keys={['super', '2']} size="xs" />
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">系统设置</span>
                      <Kbd keys={['super', ',']} size="xs" />
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">新建任务</span>
                      <Kbd keys={['super', 'N']} size="xs" />
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">命令面板</span>
                      <Kbd keys={['super', 'K']} size="xs" />
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">关闭弹窗/面板</span>
                      <Kbd keys={['esc']} size="xs" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
