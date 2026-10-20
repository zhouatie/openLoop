import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Copy,
  Check,
  X,
  ChevronDown,
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
  Search,
  Target,
  Timer,
  HardDrive,
  Database,
  Trash2,
  RefreshCw,
  Loader2,
  Camera,
  Terminal,
} from 'lucide-react';
import { api } from '../services/api';
import {
  OpenLoopSettings,
  AgentProviderType,
  ThinkingLevel,
  ShortcutSuperKey,
  PluginManifest,
  AgentPromptKey,
  AgentPromptTemplates,
  RuntimeSettingsApplySummary,
  StorageStats,
  StorageCleanOptions,
  StorageCleanResult,
  StorageRetentionSettings,
} from '@openloop/core';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  AGENT_PROVIDERS,
  getAgentProviderMeta,
} from '@openloop/agent-providers';
import { PROMPT_METAS, DEFAULT_PROMPT_TEMPLATES } from '../constants/prompts';
import { useShortcuts } from '../context/ShortcutContext';
import { Kbd } from '../components/Kbd';
import { toast } from '../components/Toast';
import { PluginManagerView } from './PluginManagerView';
import {
  getSortedSidebarPlugins,
  saveStoredSidebarOrder,
  moveSidebarItem,
} from '../utils/sidebarOrder';

/** 将运行时同步结果转成一句可直接读懂的保存提示 */
const describeRuntimeSync = (runtime?: RuntimeSettingsApplySummary): string => {
  if (!runtime) return '已自动保存';
  if (runtime.failed > 0) return `${runtime.failed} 个进行中会话切换失败`;
  if (runtime.queued > 0) return `已保存 · ${runtime.queued} 个会话本轮结束后生效`;
  if (runtime.applied > 0) return `已同步 ${runtime.applied} 个进行中会话`;
  return '已自动保存';
};

const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 1)} ${sizes[i]}`;
};
export type SettingsTabId = 'agent' | 'prompts' | 'workspace' | 'storage' | 'sidebar' | 'plugins' | 'shortcuts';

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
  { id: 'prompts', label: '提示词配置', icon: <Sparkles size={14} strokeWidth={2} /> },
  { id: 'workspace', label: '工作区与环境', icon: <Folder size={14} strokeWidth={2} /> },
  { id: 'storage', label: '存储与清理', icon: <HardDrive size={14} strokeWidth={2} /> },
  { id: 'sidebar', label: '侧边栏排序', icon: <Sliders size={14} strokeWidth={2} /> },
  { id: 'plugins', label: '插件扩展', icon: <Boxes size={14} strokeWidth={2} /> },
  { id: 'shortcuts', label: '快捷键', icon: <Keyboard size={14} strokeWidth={2} /> },
];

const SIDEBAR_ICON_MAP: Record<string, React.ReactNode> = {
  Kanban: <Layers size={14} strokeWidth={2} />,
  Workflow: <Workflow size={14} strokeWidth={2} />,
  Timer: <Timer size={14} strokeWidth={2} />,
  Target: <Target size={14} strokeWidth={2} />,
  Boxes: <Boxes size={14} strokeWidth={2} />,
  Cpu: <Cpu size={14} strokeWidth={2} />,
  Puzzle: <Puzzle size={14} strokeWidth={2} />,
};

const ModelInput: React.FC<{
  value: string;
  onSave: (val: string) => void;
}> = ({ value, onSave }) => {
  const [localVal, setLocalVal] = useState(value);
  const debounceTimerRef = useRef<any>(null);

  useEffect(() => {
    setLocalVal(value);
  }, [value]);

  const commitSave = (nextVal: string) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const trimmed = nextVal.trim();
    if (trimmed !== value) {
      if (import.meta.env?.DEV) {
        console.log('[Settings:Model] 保存模型配置:', trimmed);
      }
      onSave(trimmed);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setLocalVal(next);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      commitSave(next);
    }, 600);
  };

  const handleClear = () => {
    setLocalVal('');
    commitSave('');
  };

  return (
    <div className="relative shrink-0 flex items-center">
      <input
        type="text"
        value={localVal}
        onChange={handleChange}
        onBlur={() => commitSave(localVal)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        spellCheck={false}
        placeholder="例如 sonnet / gpt-5-codex"
        className="w-56 h-[26px] pl-2 pr-6 rounded-[6px] border border-[#e3e3e8] bg-white text-[11.5px] font-mono text-[#1c1c21] placeholder-[#a1a1aa] outline-none shadow-2xs transition-all hover:border-[#d0d0d7] focus:border-[#4f46e5] focus:ring-2 focus:ring-[#4f46e5]/10"
      />
      {localVal && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-1.5 w-4 h-4 rounded-full text-[#a1a1aa] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
          title="清空并继承引擎默认模型"
        >
          <X size={10} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
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
      if (activeSubTab.includes('prompt')) return 'prompts';
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
  const [saveStatusTone, setSaveStatusTone] = useState<'ok' | 'warn'>('ok');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 快捷键状态
  const { superKey, setSuperKey, superKeyLabel } = useShortcuts();

  // 表单状态
  const [agentProvider, setAgentProvider] = useState<AgentProviderType>('pi');
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState<ThinkingLevel>('high');
  const [defaultCwd, setDefaultCwd] = useState('');
  const [autoSnapshot, setAutoSnapshot] = useState(true);

  // 提示词状态
  const [prompts, setPrompts] = useState<AgentPromptTemplates>({ ...DEFAULT_PROMPT_TEMPLATES });
  const [activePromptKey, setActivePromptKey] = useState<AgentPromptKey>('workflowCopilot');
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const promptSaveDebounceRef = useRef<any>(null);

  // 导出配置状态
  const [isExporting, setIsExporting] = useState(false);
  const [hasExported, setHasExported] = useState(false);

  // 拖拽排序状态
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // 存储与数据维护状态
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [storageRetention, setStorageRetention] = useState<StorageRetentionSettings>({
    autoCleanEnabled: false,
    logRetentionDays: 14,
    qaRunRetentionCount: 10,
    automationLogRetentionDays: 7,
  });
  const [cleanLogsDaysChoice, setCleanLogsDaysChoice] = useState<number>(14);
  const [cleanQaRunsKeepChoice, setCleanQaRunsKeepChoice] = useState<number>(10);
  const [cleanAutomationLogsChoice, setCleanAutomationLogsChoice] = useState<number>(7);
  const [confirmCleanModal, setConfirmCleanModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    targetName?: string;
    options: StorageCleanOptions;
    successMsg?: string;
  } | null>(null);

  // 分类复选批量清理
  const [selectedCleanCategories, setSelectedCleanCategories] = useState<string[]>([
    'logs',
    'qaRuns',
    'orphanFiles',
    'vacuum',
  ]);

  const allCategoryKeys = ['logs', 'qaRuns', 'automationLogs', 'orphanFiles', 'vacuum'];
  const isAllCategoriesSelected = allCategoryKeys.length > 0 && allCategoryKeys.every((k) => selectedCleanCategories.includes(k));

  const toggleSelectAllCategories = () => {
    if (isAllCategoriesSelected) {
      setSelectedCleanCategories([]);
    } else {
      setSelectedCleanCategories([...allCategoryKeys]);
    }
  };

  const toggleCleanCategory = (key: string) => {
    setSelectedCleanCategories((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleBatchCleanSelected = () => {
    if (selectedCleanCategories.length === 0) {
      toast.error('请至少勾选一个清理分类');
      return;
    }
    const opts: StorageCleanOptions = {};
    const names: string[] = [];
    if (selectedCleanCategories.includes('logs')) {
      opts.cleanLogsDays = cleanLogsDaysChoice;
      names.push(cleanLogsDaysChoice === 0 ? '全部任务执行日志' : `${cleanLogsDaysChoice} 天前任务日志`);
    }
    if (selectedCleanCategories.includes('qaRuns')) {
      opts.cleanQaRunsKeepLatest = cleanQaRunsKeepChoice;
      names.push(cleanQaRunsKeepChoice === 0 ? '全部 UI 测试截帧' : `UI 测试历史 (每用例保留 ${cleanQaRunsKeepChoice} 次)`);
    }
    if (selectedCleanCategories.includes('automationLogs')) {
      opts.cleanAutomationLogsDays = cleanAutomationLogsChoice;
      names.push(cleanAutomationLogsChoice === 0 ? '全部自动化巡检日志' : `${cleanAutomationLogsChoice} 天前巡检日志`);
    }
    if (selectedCleanCategories.includes('orphanFiles')) {
      opts.cleanOrphanFiles = true;
      names.push('孤儿残留脱钩文件');
    }
    if (selectedCleanCategories.includes('vacuum')) {
      opts.vacuum = true;
      names.push('数据库紧凑 (VACUUM)');
    }

    setConfirmCleanModal({
      isOpen: true,
      title: `批量清理选中的 ${selectedCleanCategories.length} 个分类项目`,
      description: `即将批量执行所选分类的清理操作：${names.join('、')}。已删除数据与磁盘截图产物将彻底释放。`,
      targetName: `已勾选 ${selectedCleanCategories.length} 个类别`,
      options: opts,
      successMsg: `分类批量清理完成！已释放磁盘存储`,
    });
  };

  // Tab 检索过滤
  const [tabSearchQuery, setTabSearchQuery] = useState('');

  const filteredTabs = useMemo(() => {
    if (!tabSearchQuery.trim()) return SETTINGS_TAB_ITEMS;
    const q = tabSearchQuery.trim().toLowerCase();
    return SETTINGS_TAB_ITEMS.filter((t) => t.label.toLowerCase().includes(q));
  }, [tabSearchQuery]);

  const currentTabItem = useMemo(() => {
    return SETTINGS_TAB_ITEMS.find((t) => t.id === activeTab) || SETTINGS_TAB_ITEMS[0];
  }, [activeTab]);

  // 当外部 activeSubTab 发生变化时同步更新
  useEffect(() => {
    if (!activeSubTab) return;
    let target: SettingsTabId = 'agent';
    if (activeSubTab.includes('prompt')) target = 'prompts';
    else if (activeSubTab.includes('plugin')) target = 'plugins';
    else if (activeSubTab.includes('storage') || activeSubTab.includes('clean') || activeSubTab.includes('data')) target = 'storage';
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
        if (settings.agentProvider) setAgentProvider(getAgentProviderMeta(settings.agentProvider).id);
        if (settings.defaultModel) setModel(settings.defaultModel);
        if (settings.reasoningLevel) setThinking(settings.reasoningLevel);
        setDefaultCwd(settings.defaultCwd || '');
        if (settings.autoSnapshot !== undefined) setAutoSnapshot(settings.autoSnapshot);
        if (settings.storageRetention) {
          setStorageRetention(settings.storageRetention);
        }
        if (settings.prompts) {
          setPrompts({ ...DEFAULT_PROMPT_TEMPLATES, ...settings.prompts });
        }
      }
    } catch (err) {
      console.error('加载系统设置失败:', err);
    } finally {
      setLoading(false);
    }
  };

  // 提示词更新与防抖保存
  const handlePromptChange = (key: AgentPromptKey, val: string, immediateSave = false) => {
    const updated = { ...prompts, [key]: val };
    setPrompts(updated);

    if (promptSaveDebounceRef.current) {
      clearTimeout(promptSaveDebounceRef.current);
    }

    const doSave = async () => {
      try {
        await api.updateSettings({ prompts: updated });
        if (import.meta.env?.DEV) {
          console.log('[Settings:Prompts] 提示词已持久化保存:', { key, length: val.length });
        }
        setSaveStatus('已自动保存');
        setTimeout(() => setSaveStatus(null), 1800);
      } catch (err: any) {
        toast.error(`保存失败: ${err?.message || '未知错误'}`);
      }
    };

    if (immediateSave) {
      doSave();
    } else {
      promptSaveDebounceRef.current = setTimeout(doSave, 400);
    }
  };

  // 恢复单项出厂提示词
  const handleResetCurrentPrompt = () => {
    const defaultVal = DEFAULT_PROMPT_TEMPLATES[activePromptKey] || '';
    handlePromptChange(activePromptKey, defaultVal, true);
    const meta = PROMPT_METAS.find((m) => m.key === activePromptKey);
    toast.success(`已恢复【${meta?.label || '当前场景'}】为出厂默认设置`);
  };

  // 恢复全部出厂提示词
  const handleResetAllPrompts = async () => {
    const reset = { ...DEFAULT_PROMPT_TEMPLATES };
    setPrompts(reset);
    if (promptSaveDebounceRef.current) clearTimeout(promptSaveDebounceRef.current);
    try {
      await api.updateSettings({ prompts: reset });
      toast.success('已将所有场景的提示词恢复为出厂配置');
      setSaveStatus('已恢复默认并保存');
      setTimeout(() => setSaveStatus(null), 1800);
    } catch (err: any) {
      toast.error(`重置失败: ${err?.message || '未知错误'}`);
    }
  };

  // 插入变量到光标位置
  const handleInsertVariable = (varName: string) => {
    const textarea = promptTextareaRef.current;
    const currentVal = prompts[activePromptKey] ?? DEFAULT_PROMPT_TEMPLATES[activePromptKey] ?? '';
    if (!textarea) {
      handlePromptChange(activePromptKey, currentVal + (currentVal ? '\n' : '') + varName);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newVal = currentVal.substring(0, start) + varName + currentVal.substring(end);
    handlePromptChange(activePromptKey, newVal);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + varName.length, start + varName.length);
    }, 0);
  };

  // 判断某场景是否已被用户自定义
  const isPromptCustomized = (key: AgentPromptKey) => {
    const val = prompts[key];
    if (val === undefined || val === null) return false;
    return val.trim() !== (DEFAULT_PROMPT_TEMPLATES[key] || '').trim();
  };

  const handleSave = async (override?: Partial<OpenLoopSettings>) => {
    const payload: OpenLoopSettings = {
      agentProvider,
      defaultModel: model.trim(),
      reasoningLevel: thinking,
      defaultCwd,
      autoSnapshot,
      ...override,
    };
    try {
      const saved = await api.updateSettings(payload);
      if (import.meta.env?.DEV) {
        console.log('[Settings] 配置已自动持久化:', payload, '运行时同步结果:', saved.runtime);
      }
      setSaveStatus(describeRuntimeSync(saved.runtime));
      setSaveStatusTone(saved.runtime?.failed ? 'warn' : 'ok');
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
        if (import.meta.env?.DEV) {
          console.log('[Settings] 用户选择默认工程工作区:', chosen);
        }
        setDefaultCwd(chosen);
        await handleSave({ defaultCwd: chosen });
      }
    } catch (err) {
      console.error('选择目录失败:', err);
    }
  };

  const handleClearCwd = () => {
    if (import.meta.env?.DEV) {
      console.log('[Settings] 用户清空默认工程工作区 (CWD)');
    }
    setDefaultCwd('');
    handleSave({ defaultCwd: '' });
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
        defaultModel: model.trim(),
        reasoningLevel: thinking,
        defaultCwd,
        autoSnapshot,
        shortcutSuperKey: superKey,
        prompts,
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

  const handleSelectProvider = (providerId: AgentProviderType) => {
    if (import.meta.env?.DEV) {
      console.log('[Settings:Agent] 切换代码智能体:', { from: agentProvider, to: providerId });
    }
    setAgentProvider(providerId);
    handleSave({ agentProvider: providerId });
  };

  // 计算当前排好序的侧边栏插件清单
  const currentSidebarPlugins = useMemo(() => {
    return getSortedSidebarPlugins(plugins, sidebarOrder);
  }, [plugins, sidebarOrder]);

  // 上移某一项（禁止移动前四项固定项）
  const handleMoveUp = (index: number) => {
    if (index <= 4) return; // 索引 0, 1, 2, 3 不可排；索引 4 是可排项第一位，不能往上移动跨越固定项
    const updated = moveSidebarItem(currentSidebarPlugins, index, index - 1);
    const newOrderIds = updated.map((p) => p.id);
    if (onUpdateSidebarOrder) {
      onUpdateSidebarOrder(newOrderIds);
    }
    toast.success('已更新侧边栏排序');
  };

  // 下移某一项（禁止移动前四项固定项）
  const handleMoveDown = (index: number) => {
    if (index < 4 || index >= currentSidebarPlugins.length - 1) return;
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

  // ================= 存储监控与数据清理 =================
  useEffect(() => {
    if (activeTab === 'storage') {
      loadStorageStats();
    }
  }, [activeTab]);

  const loadStorageStats = async () => {
    try {
      setLoadingStats(true);
      if (import.meta.env?.DEV) console.log('[Settings:Storage] 加载系统存储分布状态');
      const stats = await api.getStorageStats();
      setStorageStats(stats);
    } catch (err: any) {
      if (import.meta.env?.DEV) console.error('[Settings:Storage] 加载存储状态失败:', err);
      toast.error('拉取存储状态失败');
    } finally {
      setLoadingStats(false);
    }
  };

  const executeStorageClean = async (options: StorageCleanOptions, successMsg?: string) => {
    try {
      setIsCleaning(true);
      if (import.meta.env?.DEV) console.log('[Settings:Storage] 执行存储空间清理:', options);
      const res = await api.cleanStorage(options);
      const freedMb = (res.freedBytes / 1024 / 1024).toFixed(2);
      toast.success(successMsg || `优化完成：释放 ${freedMb} MB 空间`);
      await loadStorageStats();
    } catch (err: any) {
      if (import.meta.env?.DEV) console.error('[Settings:Storage] 清理异常:', err);
      toast.error(`清理失败: ${err?.message || '未知错误'}`);
    } finally {
      setIsCleaning(false);
    }
  };

  const handleOneClickClean = () => {
    executeStorageClean({
      cleanLogsDays: 14,
      cleanQaRunsKeepLatest: 10,
      cleanAutomationLogsDays: 7,
      cleanOrphanFiles: true,
      vacuum: true,
    }, '一键深度瘦身完成！已清理旧日志、修剪测试截帧并紧凑数据库');
  };

  const handleConfirmCleanLogs = (days: number) => {
    setConfirmCleanModal({
      isOpen: true,
      title: days === 0 ? '清空全部任务执行日志' : `清理 ${days} 天前的任务日志`,
      description: days === 0
        ? '此操作将彻底删除所有任务的历史标准输出与错误日志，释放数据库存储。此操作不可逆。'
        : `将删除创建时间超过 ${days} 天的所有任务历史日志，释放空间。`,
      targetName: days === 0 ? '全部任务执行日志' : `${days} 天前历史日志`,
      options: { cleanLogsDays: days, vacuum: true },
      successMsg: `已清理任务日志并释放空间`,
    });
  };

  const handleConfirmCleanQaRuns = (keepCount: number) => {
    setConfirmCleanModal({
      isOpen: true,
      title: keepCount === 0 ? '清空所有 UI 自动化测试回放与截图' : `修剪 UI 自动化测试历史 (每用例保留 ${keepCount} 次)`,
      description: keepCount === 0
        ? '此操作将彻底删除所有 UI 自动化测试运行记录及其磁盘截图产物 (artifacts/)。'
        : `针对每个测试套件，仅保留最新的 ${keepCount} 次执行记录与截图产物，其余历史将被删除并释放磁盘空间。`,
      targetName: keepCount === 0 ? '全部测试回放与截图' : `每套件超过 ${keepCount} 次的历史截图`,
      options: { cleanQaRunsKeepLatest: keepCount, vacuum: true },
      successMsg: `已修剪测试回放并释放磁盘截图`,
    });
  };

  const handleConfirmCleanAutomationLogs = (days: number) => {
    setConfirmCleanModal({
      isOpen: true,
      title: days === 0 ? '清空所有巡检日志' : `清理 ${days} 天前的巡检日志`,
      description: days === 0
        ? '此操作将彻底清空所有定时自动化任务的历史巡检输出。'
        : `将删除时间早于 ${days} 天的自动化巡检执行日志。`,
      targetName: '自动化巡检历史记录',
      options: { cleanAutomationLogsDays: days },
      successMsg: `已清理自动化巡检历史`,
    });
  };

  const handleStorageRetentionChange = (patch: Partial<StorageRetentionSettings>) => {
    const updated = { ...storageRetention, ...patch };
    setStorageRetention(updated);
    handleSave({ storageRetention: updated });
    toast.success('已保存数据生命周期维护配置');
  };

  // 拖拽排序处理
  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (index < 4) {
      e.preventDefault();
      return;
    }
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (index < 4) return; // 不能拖到前四项区域
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggingIndex === null || draggingIndex < 4 || targetIndex < 4 || draggingIndex === targetIndex) {
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
    <div className="flex-1 flex h-full bg-[#f4f4f6] overflow-hidden select-none">
      {/* ==================== 左侧偏好设置导航栏 ==================== */}
      <div className="w-[210px] shrink-0 h-full flex flex-col bg-[#f9f9fb] border-r border-[#e3e3e8]">
        {/* 顶部标题与搜索框 */}
        <div className="p-3 border-b border-[#ececf0] space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[13px] font-semibold text-[#1c1c21] tracking-tight">系统设置</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[4px] bg-[#eaeaf0] text-[#71717a]">
              Preferences
            </span>
          </div>

          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#85858d]" />
            <input
              type="text"
              value={tabSearchQuery}
              onChange={(e) => setTabSearchQuery(e.target.value)}
              placeholder="搜索设置项..."
              className="w-full h-[26px] pl-7 pr-2 rounded-[6px] bg-[#f1f1f4] hover:bg-[#ececf0] focus:bg-white border border-transparent focus:border-[#4f46e5] text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none transition-all"
            />
          </div>
        </div>

        {/* 纵向选项卡列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-[6px] text-[12.5px] transition-all cursor-pointer relative group ${
                  isActive
                    ? 'bg-[#ececf0] text-[#1c1c21] font-medium shadow-2xs'
                    : 'text-[#63636b] hover:text-[#1c1c21] hover:bg-[#f1f1f4]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={isActive ? 'text-[#1c1c21]' : 'text-[#85858d] group-hover:text-[#63636b]'}>
                    {tab.icon}
                  </span>
                  <span className="truncate">{tab.label}</span>
                </div>
                {isActive && (
                  <div className="w-[3px] h-[14px] rounded-full bg-[#4f46e5] shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* 左侧底部版本标识 */}
        <div className="p-3 border-t border-[#ececf0] flex items-center justify-between text-[11px] text-[#85858d]">
          <span className="font-mono">OpenLoop v0.1</span>
          <span className="inline-flex items-center gap-1 text-[10px] text-[#189a58]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#189a58]" />
            在线
          </span>
        </div>
      </div>

      {/* ==================== 右侧配置主工作区 ==================== */}
      <div className="flex-1 h-full flex flex-col min-w-0 bg-[#f4f4f6] overflow-hidden">
        {/* 固定顶部 Header：当前分类标题与快捷操作 */}
        <div className="h-[48px] px-6 bg-white border-b border-[#e3e3e8] flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-2.5">
            <span className="text-[#4f46e5]">
              {currentTabItem.icon}
            </span>
            <h2 className="text-[14px] font-semibold text-[#1c1c21] tracking-tight">
              {currentTabItem.label}
            </h2>
          </div>

          <div className="flex items-center gap-2.5">
            {saveStatus && (
              <span
                className={`text-[11.5px] flex items-center gap-1 px-2 py-0.5 rounded-[5px] transition-all ${
                  saveStatusTone === 'warn'
                    ? 'text-[#b45309] bg-[#fffbeb]'
                    : 'text-[#189a58] bg-[#eaf7ee]'
                }`}
              >
                {saveStatusTone === 'warn' ? (
                  <X size={11} className="stroke-[2.4]" />
                ) : (
                  <Check size={11} className="stroke-[2.2]" />
                )}
                <span>{saveStatus}</span>
              </span>
            )}

            <button
              type="button"
              onClick={handleExportConfig}
              disabled={isExporting}
              className={`h-[26px] px-2.5 rounded-[6px] text-[11.5px] font-medium flex items-center gap-1.5 transition-all border cursor-pointer active:scale-95 shadow-2xs ${
                hasExported
                  ? 'bg-[#eaf7ee] border-[#b6e8c4] text-[#189a58]'
                  : 'bg-white hover:bg-[#fafafc] active:bg-[#f1f1f4] border-[#e3e3e8] text-[#1c1c21] hover:border-[#d0d0d7]'
              }`}
              title="导出当前配置为 openloop-settings.json"
            >
              {hasExported ? (
                <>
                  <Check size={12} className="stroke-[2.2]" />
                  <span>已导出 JSON</span>
                </>
              ) : (
                <>
                  <Download size={12} className="text-[#63636b] stroke-[1.9]" />
                  <span>导出配置</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 滚动配置内容区 */}
        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className={`${activeTab === 'prompts' ? 'max-w-none' : 'max-w-[880px]'} w-full mx-auto space-y-5`}>
            {/* ==================== TAB 1: 智能体驱动 ==================== */}
        {activeTab === 'agent' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            <div className="bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              {/* 代码智能体 */}
              <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#1c1c21]">代码智能体</div>
                  <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                    执行任务的代码智能体引擎，模型与思考强度对所有引擎共用
                  </div>
                </div>

                <div className="relative shrink-0 self-center">
                  <select
                    value={agentProvider}
                    onChange={(e) => handleSelectProvider(e.target.value as AgentProviderType)}
                    className="appearance-none h-[26px] pl-2.5 pr-6 rounded-[6px] border border-[#e3e3e8] bg-white text-[11.5px] font-medium text-[#1c1c21] outline-none shadow-2xs cursor-pointer transition-all hover:border-[#d0d0d7] focus:border-[#4f46e5] focus:ring-2 focus:ring-[#4f46e5]/10"
                  >
                    {AGENT_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={11}
                    className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[#85858d]"
                  />
                </div>
              </div>

              {/* 模型 */}
              <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#1c1c21]">模型</div>
                  <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                    所有引擎共用同一个模型配置，留空则继承引擎自身默认模型
                  </div>
                </div>

                <div className="self-center">
                  <ModelInput
                    value={model}
                    onSave={(val) => {
                      setModel(val);
                      handleSave({ defaultModel: val });
                    }}
                  />
                </div>
              </div>

              {/* 思考强度 */}
              <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#1c1c21]">思考强度</div>
                  <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                    控制模型在执行复杂代码实现与测试逻辑时的深度推理程度
                  </div>
                </div>

                <div className="inline-flex p-[2px] rounded-[7px] bg-[#e6e6eb] shrink-0 self-center">
                  {(['off', 'low', 'medium', 'high'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        setThinking(level);
                        handleSave({ reasoningLevel: level });
                      }}
                      className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer active:scale-95 ${
                        thinking === level
                          ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2.5px_rgba(0,0,0,0.08)]'
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

              {/* 编辑前快照 */}
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
                    className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer active:scale-95 ${
                      !autoSnapshot
                        ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2.5px_rgba(0,0,0,0.08)]'
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
                    className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all cursor-pointer active:scale-95 ${
                      autoSnapshot
                        ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2.5px_rgba(0,0,0,0.08)]'
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

        {/* ==================== TAB 2: 提示词配置 (统一纳管) ==================== */}
        {activeTab === 'prompts' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* 顶栏说明与全量重置 */}
            <div className="flex items-center justify-between px-0.5">
              <div>
                <div className="text-[13px] font-medium text-[#1c1c21]">系统提示词统一配置中心</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                  集中维护 OpenLoop 全链路 Agent 提示词与模板；留空将自动回退至系统内置最佳实践
                </div>
              </div>

              <button
                type="button"
                onClick={handleResetAllPrompts}
                className="h-[26px] px-2.5 rounded-[6px] bg-white hover:bg-[#fafafc] text-[#dc2626] hover:text-[#b91c1c] border border-[#fca5a5]/70 hover:border-[#f87171] text-[11.5px] font-medium flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer active:scale-95"
                title="将所有场景的提示词恢复为系统出厂默认值"
              >
                <RotateCcw size={11.5} className="stroke-[2.2]" />
                <span>全部恢复出厂</span>
              </button>
            </div>

            {/* 双栏工作区 */}
            <div className="flex gap-4 items-start">
              {/* 左侧：场景清单导航 */}
              <div className="w-[240px] shrink-0 bg-white border border-[#e3e3e8] rounded-[10px] p-2 space-y-1 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                <div className="px-2 py-1 text-[10.5px] font-medium text-[#85858d] tracking-wider uppercase">
                  场景导航
                </div>

                {PROMPT_METAS.map((meta) => {
                  const isActive = activePromptKey === meta.key;
                  const customized = isPromptCustomized(meta.key);

                  return (
                    <button
                      key={meta.key}
                      type="button"
                      onClick={() => {
                        if (import.meta.env?.DEV) {
                          console.log('[Settings:Prompts] 切换提示词场景:', meta.key);
                        }
                        setActivePromptKey(meta.key);
                      }}
                      className={`w-full text-left p-2.5 rounded-[7px] transition-all cursor-pointer border ${
                        isActive
                          ? 'bg-[#f4f4f6] border-[#d1d1d8] text-[#1c1c21] shadow-2xs'
                          : 'bg-transparent border-transparent hover:bg-[#fafafc] hover:border-[#ececf0] text-[#4b4b53]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <span className="text-[12px] font-medium truncate leading-tight">
                          {meta.label}
                        </span>
                        {customized ? (
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded-[3px] bg-[#eff6ff] text-[#2563eb] text-[9.5px] font-medium border border-[#bfdbfe]/70 shrink-0">
                            已自定义
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded-[3px] bg-[#f4f4f6] text-[#71717a] text-[9.5px] font-medium border border-[#e3e3e8] shrink-0">
                            内置
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[10.5px] text-[#85858d]">
                        <span>{meta.category}</span>
                        <span className="font-mono text-[9.5px]">
                          {(prompts[meta.key] || DEFAULT_PROMPT_TEMPLATES[meta.key] || '').length} 字符
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* 右侧：当前场景专注编辑器 */}
              {(() => {
                const currentMeta = PROMPT_METAS.find((m) => m.key === activePromptKey) || PROMPT_METAS[0];
                const currentPromptText =
                  prompts[currentMeta.key] ?? DEFAULT_PROMPT_TEMPLATES[currentMeta.key] ?? '';
                const lineCount = currentPromptText.split('\n').length;
                const charCount = currentPromptText.length;
                const customized = isPromptCustomized(currentMeta.key);

                return (
                  <div className="flex-1 bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] flex flex-col">
                    {/* 编辑器顶栏 */}
                    <div className="px-4 py-3 border-b border-[#ececf0] flex items-start justify-between gap-4 bg-[#fafafc]">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[13px] font-semibold text-[#1c1c21]">
                            {currentMeta.label}
                          </span>
                          <span className="px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f5] text-[#52525b] text-[10.5px] font-medium">
                            {currentMeta.category}
                          </span>
                          <span className="text-[11px] font-mono text-[#85858d]">
                            ({lineCount} 行 · {charCount} 字)
                          </span>
                        </div>
                        <div className="text-[11.5px] text-[#85858d] leading-relaxed">
                          {currentMeta.description}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* 复制按钮 */}
                        <button
                          type="button"
                          onClick={() => copyToClipboard(currentPromptText, `prompt_${currentMeta.key}`)}
                          className="h-[24px] px-2 rounded-[5px] bg-white hover:bg-[#f1f1f4] text-[#63636b] hover:text-[#1c1c21] border border-[#e3e3e8] text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                          title="复制当前提示词文本到剪贴板"
                        >
                          {copiedKey === `prompt_${currentMeta.key}` ? (
                            <>
                              <Check size={11} className="text-[#189a58]" />
                              <span className="text-[#189a58]">已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy size={11} />
                              <span>复制</span>
                            </>
                          )}
                        </button>

                        {/* 恢复单项出厂按钮 */}
                        <button
                          type="button"
                          onClick={handleResetCurrentPrompt}
                          disabled={!customized}
                          className={`h-[24px] px-2 rounded-[5px] text-[11px] font-medium flex items-center gap-1 transition-all border shadow-2xs ${
                            customized
                              ? 'bg-white hover:bg-[#fafafc] text-[#dc2626] border-[#fca5a5]/70 hover:border-[#f87171] cursor-pointer active:scale-95'
                              : 'bg-[#fafafc] text-[#a1a1aa] border-[#e4e4e7] cursor-not-allowed opacity-60'
                          }`}
                          title={customized ? '恢复此场景为出厂内置提示词' : '当前内容与出厂配置一致'}
                        >
                          <RotateCcw size={11} />
                          <span>恢复出厂</span>
                        </button>
                      </div>
                    </div>

                    {/* 插值变量提示与点击插入栏 */}
                    {currentMeta.variables && currentMeta.variables.length > 0 && (
                      <div className="px-4 py-2 border-b border-[#ececf0] bg-[#fafafc]/50 flex items-center flex-wrap gap-1.5">
                        <span className="text-[11px] text-[#71717a] font-normal mr-1">
                          点击插入插值变量:
                        </span>
                        {currentMeta.variables.map((v) => (
                          <button
                            key={v.name}
                            type="button"
                            onClick={() => handleInsertVariable(v.name)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-white border border-[#d4d4d8] hover:border-[#4f46e5] text-[11px] font-mono text-[#374151] hover:text-[#4f46e5] transition-all cursor-pointer shadow-2xs active:scale-95"
                            title={`点击将变量 ${v.name} 插入到光标所在位置`}
                          >
                            <span>{v.name}</span>
                            <span className="text-[#a1a1aa] text-[10px]">({v.description})</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 编辑区 */}
                    <div className="p-3.5 flex-1 flex flex-col bg-white">
                      <textarea
                        ref={promptTextareaRef}
                        value={currentPromptText}
                        onChange={(e) => handlePromptChange(currentMeta.key, e.target.value)}
                        placeholder="请输入该场景的系统提示词或格式规范..."
                        spellCheck={false}
                        className="w-full flex-1 min-h-[380px] p-3 rounded-[7px] bg-[#fafafc] border border-[#e3e3e8] text-[12px] font-mono leading-relaxed text-[#1c1c21] resize-none outline-none focus:border-[#4f46e5] focus:bg-white transition-all shadow-inner"
                      />
                    </div>

                    {/* 底部状态提示条 */}
                    <div className="px-4 py-2 bg-[#fafafc] border-t border-[#ececf0] flex items-center justify-between text-[11px] text-[#85858d]">
                      <div className="flex items-center gap-1.5">
                        <Sparkles size={11} className="text-[#4f46e5]" />
                        <span>修改后实时保存至本地数据库，下次触发对应场景时即刻生效；清空将自动以出厂模板兜底。</span>
                      </div>
                      <div className="shrink-0 font-mono text-[10.5px]">
                        {saveStatus ? (
                          <span className="text-[#189a58] font-medium">{saveStatus}</span>
                        ) : (
                          <span>输入自动保存</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ==================== TAB 3: 工作区与环境 ==================== */}
        {activeTab === 'workspace' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            <div>
              <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
                工作区与环境
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
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={defaultCwd}
                        onChange={(e) => setDefaultCwd(e.target.value)}
                        onBlur={() => handleSave()}
                        placeholder="留空使用 openLoop 启动目录"
                        className={`w-64 h-[26px] pl-2 ${defaultCwd ? 'pr-6' : 'pr-2'} rounded-[6px] border border-[#e3e3e8] text-[11.5px] font-mono text-[#1c1c21] placeholder-[#85858d] outline-none shadow-sm focus:border-[#4f46e5]`}
                      />
                      {defaultCwd && (
                        <button
                          type="button"
                          onClick={handleClearCwd}
                          className="absolute right-1.5 p-0.5 text-[#85858d] hover:text-[#1c1c21] rounded transition-colors cursor-pointer"
                          title="清空工作区"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
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

        {/* ==================== TAB 4: 存储与数据维护 ==================== */}
        {activeTab === 'storage' && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* 顶栏控制：刷新状态与上次清理提示 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-[#1c1c21]">存储监控与数据清理</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5">
                  监控 SQLite 数据库底座、执行日志、UI 测试截图与任务附件占用，随时清理历史垃圾
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadStorageStats}
                  disabled={loadingStats}
                  className="h-[26px] px-2.5 rounded-[6px] text-[11.5px] text-[#63636b] hover:text-[#1c1c21] bg-white hover:bg-[#f9f9fb] border border-[#e3e3e8] transition-colors flex items-center gap-1 shadow-sm cursor-pointer disabled:opacity-50"
                  title="刷新存储统计数据"
                >
                  <RefreshCw size={11} className={loadingStats ? 'animate-spin' : ''} />
                  <span>刷新统计</span>
                </button>
              </div>
            </div>

            {/* 1. 顶层存储指标微网格 (Storage Overview Grid) */}
            <div className="grid grid-cols-4 gap-3">
              {/* SQLite 数据库 */}
              <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-3.5 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#85858d]">SQLite 数据库</span>
                  <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] border border-[#e3e3e8]/60">
                    <Database size={11} strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-[16px] font-semibold font-mono text-[#1c1c21]">
                    {formatBytes(storageStats?.database.totalSizeBytes)}
                  </div>
                  <div className="text-[10.5px] text-[#85858d] mt-0.5 truncate">
                    主库 {formatBytes(storageStats?.database.dbSizeBytes)} · WAL {formatBytes(storageStats?.database.walSizeBytes)}
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-[#f1f1f4] flex items-center justify-between">
                  <span className="text-[10px] text-[#85858d]">页状态</span>
                  {(storageStats?.database.freelistCount || 0) > 30 ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fffbeb] text-[#b45309] text-[10px] font-medium border border-[#fde68a]">
                      待整理 ({storageStats?.database.freelistCount} 页)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                      已紧凑
                    </span>
                  )}
                </div>
              </div>

              {/* UI 自动化截帧产物 */}
              <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-3.5 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#85858d]">测试截帧与报告</span>
                  <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] border border-[#e3e3e8]/60">
                    <Camera size={11} strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-[16px] font-semibold font-mono text-[#1c1c21]">
                    {formatBytes(storageStats?.disk.artifactsBytes)}
                  </div>
                  <div className="text-[10.5px] text-[#85858d] mt-0.5 truncate">
                    {storageStats?.counts.qaRuns || 0} 次测试回放 · {storageStats?.disk.artifactsFilesCount || 0} 个截图文件
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-[#f1f1f4] flex items-center justify-between">
                  <span className="text-[10px] text-[#85858d]">磁盘位置</span>
                  <span className="text-[10px] font-mono text-[#71717a]">artifacts/</span>
                </div>
              </div>

              {/* 图片附件 */}
              <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-3.5 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#85858d]">任务图片附件</span>
                  <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] border border-[#e3e3e8]/60">
                    <Folder size={11} strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-[16px] font-semibold font-mono text-[#1c1c21]">
                    {formatBytes(storageStats?.disk.attachmentsBytes)}
                  </div>
                  <div className="text-[10.5px] text-[#85858d] mt-0.5 truncate">
                    {storageStats?.disk.attachmentsFilesCount || 0} 个任务上传附件
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-[#f1f1f4] flex items-center justify-between">
                  <span className="text-[10px] text-[#85858d]">磁盘位置</span>
                  <span className="text-[10px] font-mono text-[#71717a]">attachments/</span>
                </div>
              </div>

              {/* 日志记录 */}
              <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-3.5 shadow-sm flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#85858d]">历史日志总量</span>
                  <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] border border-[#e3e3e8]/60">
                    <Terminal size={11} strokeWidth={2} />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-[16px] font-semibold font-mono text-[#1c1c21]">
                    {((storageStats?.counts.logs || 0) + (storageStats?.counts.automationLogs || 0)).toLocaleString()} 行
                  </div>
                  <div className="text-[10.5px] text-[#85858d] mt-0.5 truncate">
                    任务日志 {(storageStats?.counts.logs || 0).toLocaleString()} · 巡检 {(storageStats?.counts.automationLogs || 0).toLocaleString()}
                  </div>
                </div>
                <div className="mt-2.5 pt-2 border-t border-[#f1f1f4] flex items-center justify-between">
                  <span className="text-[10px] text-[#85858d]">索引优化</span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                    时间序 B-Tree
                  </span>
                </div>
              </div>
            </div>

            {/* 2. 一键深度瘦身卡片 (Hero Smart Clean) */}
            <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-4 shadow-sm flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-[6px] bg-[#eeedfd] flex items-center justify-center text-[#4f46e5] shrink-0 border border-[#c7d2fe]/60">
                  <Sparkles size={18} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#1c1c21] flex items-center gap-2">
                    <span>智能一键深度瘦身</span>
                    {(storageStats?.disk.orphanFilesCount || 0) > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60">
                        发现 {storageStats?.disk.orphanFilesCount} 个孤立残留文件 ({formatBytes(storageStats?.disk.orphanFilesBytes)})
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-[#71717a] mt-0.5 leading-relaxed">
                    自动清理 14 天前任务日志、修剪过期的 UI 自动化截帧（各套件保留最新 10 次）、清除孤儿文件并执行 SQLite VACUUM 释放物理磁盘
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isCleaning}
                onClick={handleOneClickClean}
                className="flex items-center gap-1.5 h-[30px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs cursor-pointer shrink-0 disabled:opacity-50"
              >
                {isCleaning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} strokeWidth={2.4} />}
                <span>{isCleaning ? '深度瘦身整理中...' : '一键深度瘦身'}</span>
              </button>
            </div>

            {/* 3. 分类数据管理表格 (Strict Table Grid Alignment & Multi-Category Batch Cleanup) */}
            <div className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden flex flex-col">
              {/* 表头（支持全选/批量清理） */}
              <div className="h-[38px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center justify-between text-[11px] font-medium text-[#85858d] select-none">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAllCategoriesSelected}
                      onChange={toggleSelectAllCategories}
                      className="w-3.5 h-3.5 rounded border-[#c7c7cf] text-[#4f46e5] focus:ring-0 cursor-pointer"
                    />
                    <span className="text-[11.5px] font-semibold text-[#1c1c21]">数据类别 (支持勾选组合)</span>
                  </label>
                  <span className="text-[#e3e3e8]">|</span>
                  <span className="text-[#85858d]">
                    已勾选 <span className="font-mono font-medium text-[#1c1c21]">{selectedCleanCategories.length}</span> / {allCategoryKeys.length} 项
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {selectedCleanCategories.length > 0 && (
                    <button
                      type="button"
                      disabled={isCleaning}
                      onClick={handleBatchCleanSelected}
                      className="h-[25px] px-2.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 size={11} />
                      <span>批量清理所选 ({selectedCleanCategories.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 行列表 */}
              <div className="divide-y divide-[#f1f1f4]">
                {/* 任务日志 */}
                <div className="px-4 py-2.5 flex items-center text-[12px] hover:bg-[#fafafc] transition-colors">
                  <div className="w-[190px] shrink-0 flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedCleanCategories.includes('logs')}
                      onChange={() => toggleCleanCategory('logs')}
                      className="w-3.5 h-3.5 rounded border-[#c7c7cf] text-[#4f46e5] focus:ring-0 cursor-pointer"
                    />
                    <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60">
                      <Terminal size={11} strokeWidth={2} />
                    </div>
                    <span className="font-medium text-[#1c1c21]">任务执行日志</span>
                  </div>
                  <div className="w-[120px] shrink-0 font-mono text-[11px] text-[#71717a]">
                    {(storageStats?.counts.logs || 0).toLocaleString()} 行
                  </div>
                  <div className="flex-1 min-w-0 px-2 flex items-center gap-2">
                    <select
                      value={cleanLogsDaysChoice}
                      onChange={(e) => setCleanLogsDaysChoice(Number(e.target.value))}
                      className="h-[26px] px-2 rounded-[5px] bg-[#fafafc] border border-[#e3e3e8] text-[11.5px] text-[#1c1c21] outline-none cursor-pointer focus:border-[#4f46e5]"
                    >
                      <option value={7}>清理 7 天前日志</option>
                      <option value={14}>清理 14 天前日志 (推荐)</option>
                      <option value={30}>清理 30 天前日志</option>
                      <option value={0}>清空全部日志记录</option>
                    </select>
                    <span className="text-[11px] text-[#85858d]">删除对应时间窗口前的所有任务日志</span>
                  </div>
                  <div className="w-[100px] shrink-0 flex items-center justify-center">
                    <button
                      type="button"
                      disabled={isCleaning || (storageStats?.counts.logs || 0) === 0}
                      onClick={() => handleConfirmCleanLogs(cleanLogsDaysChoice)}
                      className="h-[26px] px-2.5 rounded-[5px] bg-white hover:bg-[#fef2f2] text-[#4b4b53] hover:text-[#dc2626] border border-[#e3e3e8] hover:border-[#fecaca] text-[11px] font-medium transition-all cursor-pointer shadow-2xs flex items-center gap-1 disabled:opacity-40"
                    >
                      <Trash2 size={11} />
                      <span>单独清理</span>
                    </button>
                  </div>
                </div>

                {/* UI 自动化截图与回放 */}
                <div className="px-4 py-2.5 flex items-center text-[12px] hover:bg-[#fafafc] transition-colors">
                  <div className="w-[190px] shrink-0 flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedCleanCategories.includes('qaRuns')}
                      onChange={() => toggleCleanCategory('qaRuns')}
                      className="w-3.5 h-3.5 rounded border-[#c7c7cf] text-[#4f46e5] focus:ring-0 cursor-pointer"
                    />
                    <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60">
                      <Camera size={11} strokeWidth={2} />
                    </div>
                    <span className="font-medium text-[#1c1c21]">UI 自动化回放与截图</span>
                  </div>
                  <div className="w-[120px] shrink-0 font-mono text-[11px] text-[#71717a]">
                    {storageStats?.counts.qaRuns || 0} 次 · {formatBytes(storageStats?.disk.artifactsBytes)}
                  </div>
                  <div className="flex-1 min-w-0 px-2 flex items-center gap-2">
                    <select
                      value={cleanQaRunsKeepChoice}
                      onChange={(e) => setCleanQaRunsKeepChoice(Number(e.target.value))}
                      className="h-[26px] px-2 rounded-[5px] bg-[#fafafc] border border-[#e3e3e8] text-[11.5px] text-[#1c1c21] outline-none cursor-pointer focus:border-[#4f46e5]"
                    >
                      <option value={5}>每用例保留最新 5 次</option>
                      <option value={10}>每用例保留最新 10 次 (推荐)</option>
                      <option value={20}>每用例保留最新 20 次</option>
                      <option value={0}>清空全部测试截图</option>
                    </select>
                    <span className="text-[11px] text-[#85858d]">级联删除超出保留次数的历史截图文件</span>
                  </div>
                  <div className="w-[100px] shrink-0 flex items-center justify-center">
                    <button
                      type="button"
                      disabled={isCleaning || (storageStats?.counts.qaRuns || 0) === 0}
                      onClick={() => handleConfirmCleanQaRuns(cleanQaRunsKeepChoice)}
                      className="h-[26px] px-2.5 rounded-[5px] bg-white hover:bg-[#fef2f2] text-[#4b4b53] hover:text-[#dc2626] border border-[#e3e3e8] hover:border-[#fecaca] text-[11px] font-medium transition-all cursor-pointer shadow-2xs flex items-center gap-1 disabled:opacity-40"
                    >
                      <Trash2 size={11} />
                      <span>单独修剪</span>
                    </button>
                  </div>
                </div>

                {/* 自动化巡检历史 */}
                <div className="px-4 py-2.5 flex items-center text-[12px] hover:bg-[#fafafc] transition-colors">
                  <div className="w-[190px] shrink-0 flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedCleanCategories.includes('automationLogs')}
                      onChange={() => toggleCleanCategory('automationLogs')}
                      className="w-3.5 h-3.5 rounded border-[#c7c7cf] text-[#4f46e5] focus:ring-0 cursor-pointer"
                    />
                    <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60">
                      <Timer size={11} strokeWidth={2} />
                    </div>
                    <span className="font-medium text-[#1c1c21]">自动化任务日志</span>
                  </div>
                  <div className="w-[120px] shrink-0 font-mono text-[11px] text-[#71717a]">
                    {(storageStats?.counts.automationLogs || 0).toLocaleString()} 条
                  </div>
                  <div className="flex-1 min-w-0 px-2 flex items-center gap-2">
                    <select
                      value={cleanAutomationLogsChoice}
                      onChange={(e) => setCleanAutomationLogsChoice(Number(e.target.value))}
                      className="h-[26px] px-2 rounded-[5px] bg-[#fafafc] border border-[#e3e3e8] text-[11.5px] text-[#1c1c21] outline-none cursor-pointer focus:border-[#4f46e5]"
                    >
                      <option value={7}>清理 7 天前记录 (推荐)</option>
                      <option value={14}>清理 14 天前记录</option>
                      <option value={0}>清空全部巡检历史</option>
                    </select>
                    <span className="text-[11px] text-[#85858d]">清除周期性定时巡检触发记录</span>
                  </div>
                  <div className="w-[100px] shrink-0 flex items-center justify-center">
                    <button
                      type="button"
                      disabled={isCleaning || (storageStats?.counts.automationLogs || 0) === 0}
                      onClick={() => handleConfirmCleanAutomationLogs(cleanAutomationLogsChoice)}
                      className="h-[26px] px-2.5 rounded-[5px] bg-white hover:bg-[#fef2f2] text-[#4b4b53] hover:text-[#dc2626] border border-[#e3e3e8] hover:border-[#fecaca] text-[11px] font-medium transition-all cursor-pointer shadow-2xs flex items-center gap-1 disabled:opacity-40"
                    >
                      <Trash2 size={11} />
                      <span>单独清理</span>
                    </button>
                  </div>
                </div>

                {/* 孤儿碎片与无效文件 */}
                <div className="px-4 py-2.5 flex items-center text-[12px] hover:bg-[#fafafc] transition-colors">
                  <div className="w-[190px] shrink-0 flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedCleanCategories.includes('orphanFiles')}
                      onChange={() => toggleCleanCategory('orphanFiles')}
                      className="w-3.5 h-3.5 rounded border-[#c7c7cf] text-[#4f46e5] focus:ring-0 cursor-pointer"
                    />
                    <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60">
                      <Layers size={11} strokeWidth={2} />
                    </div>
                    <span className="font-medium text-[#1c1c21]">孤儿残留文件</span>
                  </div>
                  <div className="w-[120px] shrink-0 font-mono text-[11px] text-[#71717a]">
                    {storageStats?.disk.orphanFilesCount || 0} 个 · {formatBytes(storageStats?.disk.orphanFilesBytes)}
                  </div>
                  <div className="flex-1 min-w-0 px-2 flex items-center gap-2">
                    <span className="text-[11.5px] text-[#85858d]">
                      检测并回收已被删除任务或用例脱钩的无主截图与附件
                    </span>
                  </div>
                  <div className="w-[100px] shrink-0 flex items-center justify-center">
                    <button
                      type="button"
                      disabled={isCleaning || (storageStats?.disk.orphanFilesCount || 0) === 0}
                      onClick={() => executeStorageClean({ cleanOrphanFiles: true }, '孤儿残留文件已彻底清除')}
                      className="h-[26px] px-2.5 rounded-[5px] bg-white hover:bg-[#fafafc] text-[#1c1c21] border border-[#e3e3e8] hover:border-[#b9b9c2] text-[11px] font-medium transition-all cursor-pointer shadow-2xs flex items-center gap-1 disabled:opacity-40"
                    >
                      <RotateCcw size={11} />
                      <span>单独回收</span>
                    </button>
                  </div>
                </div>

                {/* SQLite 物理压缩 (VACUUM) */}
                <div className="px-4 py-2.5 flex items-center text-[12px] hover:bg-[#fafafc] transition-colors">
                  <div className="w-[190px] shrink-0 flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedCleanCategories.includes('vacuum')}
                      onChange={() => toggleCleanCategory('vacuum')}
                      className="w-3.5 h-3.5 rounded border-[#c7c7cf] text-[#4f46e5] focus:ring-0 cursor-pointer"
                    />
                    <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60">
                      <HardDrive size={11} strokeWidth={2} />
                    </div>
                    <span className="font-medium text-[#1c1c21]">数据库紧凑 (VACUUM)</span>
                  </div>
                  <div className="w-[120px] shrink-0 font-mono text-[11px] text-[#71717a]">
                    {storageStats?.database.freelistCount || 0} 空闲页
                  </div>
                  <div className="flex-1 min-w-0 px-2 flex items-center gap-2">
                    <span className="text-[11.5px] text-[#85858d]">
                      执行 WAL 日志截断与 SQLite VACUUM，将已删除记录的空闲数据页归还操作系统
                    </span>
                  </div>
                  <div className="w-[100px] shrink-0 flex items-center justify-center">
                    <button
                      type="button"
                      disabled={isCleaning}
                      onClick={() => executeStorageClean({ vacuum: true }, '数据库已成功执行 VACUUM 紧凑优化')}
                      className="h-[26px] px-2.5 rounded-[5px] bg-white hover:bg-[#fafafc] text-[#1c1c21] border border-[#e3e3e8] hover:border-[#b9b9c2] text-[11px] font-medium transition-all cursor-pointer shadow-2xs flex items-center gap-1 disabled:opacity-40"
                    >
                      <HardDrive size={11} />
                      <span>单独紧凑</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 4. 自动化生命周期维护策略 (Retention Settings Card) */}
            <div className="bg-white border border-[#e3e3e8] rounded-[8px] p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[#ececf0] pb-3">
                <div>
                  <div className="text-[13px] font-medium text-[#1c1c21]">自动生命周期维护策略</div>
                  <div className="text-[11.5px] text-[#85858d] mt-0.5">
                    开启后 openLoop 会在后台静默修剪旧记录与截图，防止磁盘垃圾持续膨胀
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(storageRetention.autoCleanEnabled)}
                    onChange={(e) => handleStorageRetentionChange({ autoCleanEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4.5 bg-[#e3e3e8] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-[#4f46e5]"></div>
                </label>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-[#71717a] mb-1">
                    任务日志自动保留
                  </label>
                  <select
                    disabled={!storageRetention.autoCleanEnabled}
                    value={storageRetention.logRetentionDays || 14}
                    onChange={(e) => handleStorageRetentionChange({ logRetentionDays: Number(e.target.value) })}
                    className="w-full h-[28px] px-2 bg-[#fafafc] border border-[#e3e3e8] rounded-[6px] text-[11.5px] text-[#1c1c21] outline-none disabled:opacity-50"
                  >
                    <option value={7}>保留近 7 天日志</option>
                    <option value={14}>保留近 14 天日志</option>
                    <option value={30}>保留近 30 天日志</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#71717a] mb-1">
                    每测试用例回放保留
                  </label>
                  <select
                    disabled={!storageRetention.autoCleanEnabled}
                    value={storageRetention.qaRunRetentionCount || 10}
                    onChange={(e) => handleStorageRetentionChange({ qaRunRetentionCount: Number(e.target.value) })}
                    className="w-full h-[28px] px-2 bg-[#fafafc] border border-[#e3e3e8] rounded-[6px] text-[11.5px] text-[#1c1c21] outline-none disabled:opacity-50"
                  >
                    <option value={5}>保留最新 5 次回放</option>
                    <option value={10}>保留最新 10 次回放</option>
                    <option value={20}>保留最新 20 次回放</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#71717a] mb-1">
                    自动化巡检记录保留
                  </label>
                  <select
                    disabled={!storageRetention.autoCleanEnabled}
                    value={storageRetention.automationLogRetentionDays || 7}
                    onChange={(e) => handleStorageRetentionChange({ automationLogRetentionDays: Number(e.target.value) })}
                    className="w-full h-[28px] px-2 bg-[#fafafc] border border-[#e3e3e8] rounded-[6px] text-[11.5px] text-[#1c1c21] outline-none disabled:opacity-50"
                  >
                    <option value={3}>保留近 3 天记录</option>
                    <option value={7}>保留近 7 天记录</option>
                    <option value={14}>保留近 14 天记录</option>
                  </select>
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
                const isFixed = index < 4;
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">任务看板</span>
                      <Kbd keys={['super', '1']} size="xs" />
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">流程编排</span>
                      <Kbd keys={['super', '2']} size="xs" />
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">自动化任务</span>
                      <Kbd keys={['super', '3']} size="xs" />
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-[7px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                      <span className="text-[12px] text-[#4b4b53]">QA 自动化</span>
                      <Kbd keys={['super', '4']} size="xs" />
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

        {/* 固定底栏 Footer */}
        <div className="h-[40px] px-6 bg-white border-t border-[#e3e3e8] flex items-center justify-between shrink-0 text-[11.5px] text-[#85858d]">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#189a58]" />
            <span>所有更改已自动持久化保存在本地 SQLite 数据库中</span>
          </div>

          <div className="text-[11px] font-mono text-[#a1a1aa]">
            openLoop Core Daemon · IPC Active
          </div>
        </div>
      </div>

      {/* 清理确认弹窗 */}
      {confirmCleanModal && confirmCleanModal.isOpen && (
        <ConfirmModal
          isOpen={true}
          title={confirmCleanModal.title}
          description={confirmCleanModal.description}
          targetName={confirmCleanModal.targetName}
          confirmText="确认清理"
          cancelText="取消"
          variant="danger"
          loading={isCleaning}
          onConfirm={async () => {
            const opts = confirmCleanModal.options;
            const msg = confirmCleanModal.successMsg;
            setConfirmCleanModal(null);
            await executeStorageClean(opts, msg);
          }}
          onClose={() => setConfirmCleanModal(null)}
        />
      )}
    </div>
  );
};
