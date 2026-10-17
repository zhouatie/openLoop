import React, { useEffect, useState, useRef } from 'react';
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
} from 'lucide-react';
import { api } from '../services/api';
import { OpenLoopSettings, AgentProviderType, PiThinkingLevel, ShortcutSuperKey } from '@openloop/core';
import { useShortcuts } from '../context/ShortcutContext';
import { Kbd } from '../components/Kbd';
import { toast } from '../components/Toast';

interface SettingsViewProps {
  activeSubTab?: string;
  onSelectSubTab?: (id: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  activeSubTab = 'settings-agent',
  onSelectSubTab,
}) => {
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

      // 获取当前最新的服务端配置并与当前前端状态深度合并
      let baseSettings: OpenLoopSettings = {};
      try {
        baseSettings = await api.getSettings();
      } catch (fetchErr) {
        if (import.meta.env?.DEV) {
          console.warn('[Settings:Export] 获取远端最新配置失败，使用当前本地状态', fetchErr);
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

      if (import.meta.env?.DEV) {
        console.log('[Settings:Export] 待导出完整配置数据:', configToExport);
      }

      // 要求导出文件名为 openloop-settings.json，使用标准格式化缩进 2 格
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
      setTimeout(() => {
        setHasExported(false);
      }, 2000);
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

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-y-auto select-none px-8 py-6">
      <div className="max-w-[1040px] w-full space-y-5">
        {/* ==================== 顶部标题与快捷操作栏 ==================== */}
        <div className="flex items-center justify-between pb-1 pt-1">
          <div>
            <h1 className="text-[17px] font-semibold text-[#1c1c21] tracking-tight">系统设置</h1>
            <p className="text-[12px] text-[#85858d] mt-0.5">
              管理 openLoop 核心调度服务、代码智能体驱动与工作区环境变量
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
                  <span>导出配置文件</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ==================== 分组 1: 代码智能体 (对齐截图中的图像/模型组) ==================== */}
        <div>
          <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
            代码智能体
          </div>

          <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            {/* 默认智能体驱动 */}
            <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#1c1c21]">默认代码智能体</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                  流水线执行代码实现、单元自测时的底层驱动；选用 Pi Agent 时将通过本地 Pi CLI 自动派发会话
                </div>
              </div>

              {/* 对齐截图的分段控制器 .segs */}
              <div className="inline-flex p-[2px] rounded-[7px] bg-[#e6e6eb] shrink-0 self-center">
                <button
                  type="button"
                  onClick={() => {
                    setAgentProvider('pi');
                    handleSave({ agentProvider: 'pi' });
                  }}
                  className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all ${
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
                  className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all ${
                    agentProvider === 'custom-cli'
                      ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                      : 'text-[#63636b] hover:text-[#1c1c21]'
                  }`}
                >
                  自定义 CLI 脚本
                </button>
              </div>
            </div>

            {/* 终端会话接管 (1:1 对齐截图中的只读复制行如 MCP 识图服务器) */}
            <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#1c1c21]">终端会话交互恢复</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                  为每个任务派发唯一的 Session ID，在外部终端中随时可通过 pi resume 交互式接管并继续讨论
                </div>
              </div>

              <div className="shrink-0 self-center flex items-center gap-1.5 font-mono text-[11.5px] text-[#4b4b53]">
                <span>pi --session &lt;sessionId&gt;</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard('pi --session session_<taskId>', 'resumeCmd')}
                  className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-colors"
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

            {/* 会话控制台 */}
            <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#1c1c21]">交互终端程序</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                  在看板点击「在终端打开」时默认拉起的系统终端程序
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

        {/* ==================== 分组 2: Pi Agent 配置 (对齐截图中的联网搜索组) ==================== */}
        {agentProvider === 'pi' && (
          <div className="relative z-20">
            <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
              Pi Agent 配置
            </div>

            <div className="bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              {/* 模型选择：1:1 对齐截图中的胶囊按钮 `🌐 自动 · GPT-6-Luna · Codex` + `📊 默认` */}
              <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#1c1c21]">智能体模型</div>
                  <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                    任务执行调用的基础模型，留空则继承 Pi 本地默认配置；支持自动多模型回退
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
                    className="h-[26px] px-2 rounded-[13px] bg-[#f1f1f4] hover:bg-[#e9e9ee] border border-[#e3e3e8] text-[11px] text-[#63636b] hover:text-[#1c1c21] transition-all"
                    title="重置为默认模型"
                  >
                    默认
                  </button>
                </div>
              </div>

              {/* 思考推理级别：1:1 对齐截图中的 `[ 不再问 | 1 | 2 | 3 | 全部 ]` 多选项分段器 */}
              <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#1c1c21]">思考推理级别</div>
                  <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                    控制模型在执行复杂代码实现与测试逻辑时的深度思考程度 (--thinking)
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
                      className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all ${
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

              {/* 内置工具调用权限白名单 (输入行) */}
              <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#1c1c21]">内置工具权限 (--tools)</div>
                  <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                    允许智能体在任务工作区调用的工具集，包含 read、bash、edit、write 等
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

              {/* 代码编辑快照备份：1:1 对齐截图中的 `[ 关闭 | 开启 ]` 开关分段器 */}
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
                    className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all ${
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
                    className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all ${
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

        {/* ==================== 分组 3: 工作区与环境 (对齐截图中的回复组) ==================== */}
        <div>
          <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
            工作区与网络
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
                  className="h-[26px] px-2 rounded-[6px] bg-[#f9f9fb] hover:bg-[#f1f1f4] text-[#4b4b53] hover:text-[#1c1c21] border border-[#e3e3e8] text-[11px] font-medium flex items-center gap-1 transition-colors shadow-sm"
                  title="打开系统访达选择目录"
                >
                  <FolderOpen size={12} />
                  <span>访达</span>
                </button>
              </div>
            </div>

            {/* 核心守护进程地址：只读单行复制 */}
            <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#1c1c21]">核心服务地址</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                  提供 RESTful 接口与 WebSocket 状态广播，数据持久化于 SQLite (WAL 模式)
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
                  className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-colors"
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
          </div>
        </div>

        {/* ==================== 分组 4: 规则黑名单 (1:1 对齐截图底部的已停用的模型) ==================== */}
        <div>
          <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
            工作区过滤
          </div>

          <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#1c1c21]">忽略的工作区路径</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                  智能体扫描或检索代码时自动排除的路径规则。输入如 node_modules/, dist/, *.min.js 等
                </div>
              </div>

              <div className="shrink-0 self-center">
                <button
                  type="button"
                  className="h-[26px] px-2.5 rounded-[6px] bg-[#f1f1f4] hover:bg-[#e9e9ee] border border-[#e3e3e8] text-[11.5px] text-[#4b4b53] hover:text-[#1c1c21] transition-all"
                >
                  配置规则...
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== 分组 5: 全局快捷键与控制 ==================== */}
        <div>
          <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal flex items-center gap-1.5">
            <Keyboard size={13} className="text-[#85858d]" />
            <span>全局快捷键与控制</span>
          </div>

          <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            {/* Super 键选择器 */}
            <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6 border-b border-[#ececf0]">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#1c1c21]">全局 Super 引导键</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                  配置用于触发页面快速跳转、新建任务与命令面板的修饰键。默认为 Control 键，可按操作习惯切换为 Command 或 Alt
                </div>
              </div>

              <div className="inline-flex p-[2px] rounded-[7px] bg-[#e6e6eb] shrink-0 self-center">
                <button
                  type="button"
                  onClick={() => setSuperKey('Control')}
                  className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all ${
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
                  className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all ${
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
                  className={`h-[22px] px-2.5 rounded-[5px] text-[11.5px] transition-all ${
                    superKey === 'Alt'
                      ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                      : 'text-[#63636b] hover:text-[#1c1c21]'
                  }`}
                >
                  Alt / Option (⌥)
                </button>
              </div>
            </div>

            {/* 快捷键实时映射清单 */}
            <div className="px-3.5 py-3 bg-[#fafafc]">
              <div className="text-[12px] font-medium text-[#1c1c21] mb-2.5">
                已激活的全局快捷键清单
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="flex items-center justify-between p-2 rounded-[6px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  <span className="text-[11.5px] text-[#4b4b53]">任务看板</span>
                  <Kbd keys={['super', '1']} size="xs" />
                </div>
                <div className="flex items-center justify-between p-2 rounded-[6px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  <span className="text-[11.5px] text-[#4b4b53]">流程编排</span>
                  <Kbd keys={['super', '2']} size="xs" />
                </div>
                <div className="flex items-center justify-between p-2 rounded-[6px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  <span className="text-[11.5px] text-[#4b4b53]">扩展插件</span>
                  <Kbd keys={['super', '3']} size="xs" />
                </div>
                <div className="flex items-center justify-between p-2 rounded-[6px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  <span className="text-[11.5px] text-[#4b4b53]">系统设置</span>
                  <Kbd keys={['super', ',']} size="xs" />
                </div>
                <div className="flex items-center justify-between p-2 rounded-[6px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  <span className="text-[11.5px] text-[#4b4b53]">新建任务</span>
                  <Kbd keys={['super', 'N']} size="xs" />
                </div>
                <div className="flex items-center justify-between p-2 rounded-[6px] bg-white border border-[#e8e8ed] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                  <span className="text-[11.5px] text-[#4b4b53]">命令面板</span>
                  <Kbd keys={['super', 'K']} size="xs" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== 分组 6: 配置文件管理 ==================== */}
        <div>
          <div className="text-[11.5px] text-[#85858d] mb-1.5 px-0.5 font-normal">
            配置文件与备份
          </div>

          <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <div className="min-h-[52px] px-3.5 py-3 flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-[#1c1c21]">导出配置文件</div>
                <div className="text-[11.5px] text-[#85858d] mt-0.5 leading-relaxed">
                  将当前系统运行配置（包括智能体驱动、模型参数、工具白名单与工作区路径）导出为 openloop-settings.json 文件
                </div>
              </div>

              <div className="shrink-0 self-center">
                <button
                  type="button"
                  onClick={handleExportConfig}
                  disabled={isExporting}
                  className={`h-[26px] px-3 rounded-[6px] text-[11.5px] font-medium flex items-center gap-1.5 border transition-all cursor-pointer active:scale-95 ${
                    hasExported
                      ? 'bg-[#eaf7ee] border-[#b6e8c4] text-[#189a58]'
                      : 'bg-[#f1f1f4] hover:bg-[#e9e9ee] border-[#e3e3e8] text-[#1c1c21]'
                  }`}
                  title="导出为 openloop-settings.json"
                >
                  {hasExported ? (
                    <>
                      <Check size={12} className="stroke-[2.2]" />
                      <span>已成功导出</span>
                    </>
                  ) : (
                    <>
                      <Download size={12} className="text-[#63636b] stroke-[1.9]" />
                      <span>导出 JSON 配置文件</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
