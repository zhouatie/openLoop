/* 「启动服务」面板：从 ➕ 面板进入，列工作区里识别到的 RN 工程并逐个启动。
   面板只依赖一个目录，与任务、会话解耦；服务跑在独立进程里，关掉面板不会停。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Loader2, Play, RefreshCw, Settings2, Square, X } from 'lucide-react';
import type { DevServerClient, DevServerProject } from '@openloop/core/types';
import { api } from '../services/api';
import { openInDefaultBrowser } from '../utils/openExternalBrowser';
import { DirectoryBrowserModal } from './DirectoryBrowserModal';
import { toast } from './Toast';

/** 面板打开时的对账间隔：拉起阶段需要较快反馈 */
const POLL_MS = 2_500;

interface FormState {
  command: string;
  nodeBinPath: string;
  port: string;
}

/** 徽章：运行 / 启动中 / 端口冲突 / 退出 / 停止 */
function badgeOf(project: DevServerProject): { label: string; className: string } {
  if (project.running) return { label: project.owned ? '运行中' : '运行中 · 外部', className: 'bg-[#ecfdf5] text-[#059669]' };
  if (project.starting) return { label: '启动中', className: 'bg-[#eff6ff] text-[#2563eb]' };
  if (project.owned) return { label: '未就绪', className: 'bg-[#eff6ff] text-[#2563eb]' };
  if (project.portBusy) return { label: '端口冲突', className: 'bg-[#fffbeb] text-[#b45309]' };
  if (project.error) return { label: '已退出', className: 'bg-[#fef2f2] text-[#dc2626]' };
  return { label: '已停止', className: 'bg-[#f4f4f6] text-[#71717a]' };
}

/** 桌面端默认实现：宿主不传 client 时走本地核心服务 */
const desktopClient: DevServerClient = {
  scan: (cwd) => api.scanDevServerProjects(cwd),
  start: (cwd, config) => api.startDevServer(cwd, config),
  stop: (cwd) => api.stopDevServer(cwd),
  saveConfig: (cwd, config) => api.saveDevServerConfig(cwd, config),
};

export interface DevServerPanelProps {
  /** 起始目录：会话工作区根，面板可从根目录向下挑选工程 */
  rootDir: string;
  onClose: () => void;
  /** 宿主实现：扫描与启停。默认走桌面端 api，其他宿主可整套替换 */
  client?: DevServerClient;
  /** 选择目录：宿主可换成自己的目录选择器，缺省用内置浏览弹窗 */
  pickDirectory?: (defaultPath: string) => Promise<string | null>;
  /** 轻提示：宿主可换成自己的通知组件 */
  notify?: (message: string, tone: 'success' | 'error') => void;
}

/**
 * 工作区开发服务面板：挑一个 RN 工程就地拉起 Metro。
 * @param props 起始目录与关闭回调
 */
export function DevServerPanel({ rootDir, onClose, client, pickDirectory, notify }: DevServerPanelProps) {
  const service = client ?? desktopClient;
  const say = notify ?? ((message: string, tone: 'success' | 'error') => (tone === 'error' ? toast.error(message) : toast.success(message)));
  const [root, setRoot] = useState(rootDir);
  const [projects, setProjects] = useState<DevServerProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (target: string, quiet = false) => {
    const request = ++seq.current;
    if (!target) {
      setProjects([]);
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const next = await service.scan(target);
      if (seq.current !== request) return;
      setProjects(next.projects);
      setScanError(null);
    } catch (err: any) {
      if (seq.current !== request) return;
      setScanError(err?.message || '无法读取该目录');
    } finally {
      if (seq.current === request) setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    if (import.meta.env?.DEV) console.log('[DevServerPanel] 打开启动服务面板:', root);
    void load(root);
  }, [root, load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(root, true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [root, load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // 配置输入态先退出编辑，再关面板
        if (editing) {
          setEditing(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, onClose]);

  const refresh = useCallback(() => load(root, true), [load, root]);

  const start = async (project: DevServerProject) => {
    if (busyPath) return;
    setBusyPath(project.path);
    if (import.meta.env?.DEV) console.log('[DevServerPanel] 启动开发服务:', project.path);
    try {
      const snapshot = await service.start(project.path);
      if (snapshot.error && !snapshot.starting) say('启动失败，展开配置可看输出与端口', 'error');
      await refresh();
    } catch (err: any) {
      say(`启动失败: ${err?.message || '未知异常'}`, 'error');
    } finally {
      setBusyPath(null);
    }
  };

  const stop = async (project: DevServerProject) => {
    if (busyPath) return;
    setBusyPath(project.path);
    if (import.meta.env?.DEV) console.log('[DevServerPanel] 停止开发服务:', project.path);
    try {
      await service.stop(project.path);
      await refresh();
    } catch (err: any) {
      say(`停止失败: ${err?.message || '未知异常'}`, 'error');
    } finally {
      setBusyPath(null);
    }
  };

  const openConfig = (project: DevServerProject) => {
    if (editing === project.path) {
      setEditing(null);
      return;
    }
    setEditing(project.path);
    setForm({ command: project.command, nodeBinPath: project.nodeBinPath || '', port: String(project.port) });
    setBrowsing(false);
  };

  const saveConfig = async (project: DevServerProject) => {
    if (!form) return;
    const port = Number(form.port);
    try {
      await service.saveConfig(project.path, {
        command: form.command.trim(),
        nodeBinPath: form.nodeBinPath.trim(),
        ...(Number.isInteger(port) && port > 0 ? { port } : {}),
      });
      setEditing(null);
      setForm(null);
      say('启动配置已保存', 'success');
      await refresh();
    } catch (err: any) {
      say(`保存失败: ${err?.message || '未知异常'}`, 'error');
    }
  };

  const rows = projects || [];

  return createPortal(
    <>
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[rgba(20,22,30,0.24)] backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="启动服务"
        className="w-full max-w-[580px] max-h-[72vh] bg-white rounded-[12px] border border-[#e3e3e8] shadow-[0_24px_60px_rgba(20,22,30,0.18)] flex flex-col overflow-hidden"
      >
        {/* 头部：标题与关闭 */}
        <div className="h-[42px] px-3.5 flex items-center justify-between border-b border-[#ececf0] shrink-0">
          <span className="text-[12.5px] font-semibold text-[#1c1c21] tracking-tight">启动服务</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => void load(root)}
              aria-label="重新扫描"
              title="重新扫描"
              className="w-6 h-6 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              title="关闭 (Esc)"
              className="w-6 h-6 rounded-[4px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* 目录区：工作区根，可换目录 */}
        <div className="h-[34px] px-2 flex items-center gap-1 border-b border-[#f1f1f4] shrink-0">
          <span className="shrink-0 pl-1 text-[11px] text-[#85858d]">工作区</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#63636b]" title={root}>
            {root}
          </span>
          <button
            type="button"
            onClick={() => {
              if (!pickDirectory) {
                setBrowsing(true);
                return;
              }
              void pickDirectory(root).then((picked) => {
                if (picked) setRoot(picked);
              });
            }}
            className="shrink-0 h-[22px] px-1.5 rounded-[4px] text-[11.5px] text-[#63636b] hover:bg-[#f4f4f7] hover:text-[#1c1c21] transition-colors"
          >
            {root ? '换目录' : '选择目录'}
          </button>
        </div>

        {/* 工程列表 */}
        <div className="flex-1 overflow-y-auto">
          {loading && !projects ? (
            <div className="h-[120px] flex flex-col items-center justify-center gap-2 text-[11.5px] text-[#85858d]">
              <Loader2 size={14} className="animate-spin" />
              <span>正在扫描可启动的工程</span>
            </div>
          ) : scanError ? (
            <div className="h-[100px] flex items-center justify-center text-[11.5px] text-[#dc2626]">{scanError}</div>
          ) : rows.length === 0 ? (
            <div className="h-[120px] flex flex-col items-center justify-center gap-1.5 text-[11.5px] text-[#85858d]">
              <span>{root ? '这个目录下没有识别到 RN 工程' : '先选择一个工作区目录'}</span>
              {root ? (
                <span className="text-[10.5px] text-[#a1a1aa]">工程根需有 appJson.json、metro.config.js 或 react-native 依赖</span>
              ) : null}
            </div>
          ) : (
            rows.map((project) => {
              const badge = badgeOf(project);
              const busy = busyPath === project.path;
              return (
                <div key={project.path} className="border-b border-[#f1f1f4] last:border-b-0">
                  <div className="flex items-center gap-2 pl-3 pr-2 h-[50px] hover:bg-[#fafafc] transition-colors">
                    <span
                      className={`shrink-0 w-[6px] h-[6px] rounded-full ${
                        project.running
                          ? 'bg-[#059669]'
                          : project.owned || project.starting
                            ? 'bg-[#2563eb]'
                            : 'bg-[#d4d4d8]'
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-medium text-[#1c1c21] truncate" title={project.path}>
                          {project.name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-[#a1a1aa] truncate max-w-[220px]">
                          {project.relative === '.' ? '当前目录' : project.relative}
                        </span>
                      </div>
                      <div className="font-mono text-[10.5px] text-[#85858d] truncate" title={project.command}>
                        {project.command} · :{project.port}
                      </div>
                    </div>
                    <span className={`shrink-0 h-[18px] px-1.5 rounded-full text-[10px] font-medium leading-[18px] ${badge.className}`}>
                      {badge.label}
                    </span>
                    {project.running ? (
                      <button
                        type="button"
                        onClick={() => void openInDefaultBrowser(`http://localhost:${project.port}`)}
                        aria-label="在浏览器打开"
                        title="在浏览器打开"
                        className="shrink-0 w-6 h-6 rounded-[4px] flex items-center justify-center text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] transition-colors"
                      >
                        <ExternalLink size={12} />
                      </button>
                    ) : null}
                    {project.owned ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void stop(project)}
                        className="shrink-0 h-[24px] px-2 rounded-[5px] border border-[#e3e3e8] text-[11px] text-[#63636b] hover:bg-[#f4f4f7] hover:text-[#1c1c21] transition-colors disabled:opacity-50"
                      >
                        <span className="flex items-center gap-1">
                          <Square size={9} />
                          {busy ? '停止中' : '停止'}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void start(project)}
                        className="shrink-0 h-[24px] px-2 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium transition-colors disabled:opacity-50"
                      >
                        <span className="flex items-center gap-1">
                          <Play size={9} />
                          {busy ? '启动中' : project.running ? '接管启动' : '启动'}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openConfig(project)}
                      aria-label="启动配置"
                      title="启动配置"
                      className={`shrink-0 w-6 h-6 rounded-[4px] flex items-center justify-center transition-colors ${
                        editing === project.path
                          ? 'text-[#1c1c21] bg-[#ececf0]'
                          : 'text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0]'
                      }`}
                    >
                      <Settings2 size={12} />
                    </button>
                  </div>

                  {project.error ? (
                    <div className="px-3 pb-2 -mt-0.5 font-mono text-[10.5px] leading-[15px] text-[#dc2626] max-h-[84px] overflow-y-auto whitespace-pre-wrap">
                      {project.error}
                    </div>
                  ) : null}

                  {editing === project.path && form ? (
                    <div className="px-3 py-2 border-t border-[#f1f1f4] bg-[#fafafc] space-y-1.5">
                      <label className="flex items-center gap-2">
                        <span className="shrink-0 w-[38px] text-[11px] text-[#85858d]">命令</span>
                        <input
                          value={form.command}
                          spellCheck={false}
                          onChange={(event) => setForm({ ...form, command: event.target.value })}
                          aria-label="启动命令"
                          className="flex-1 h-[24px] px-2 bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[5px] font-mono text-[11px] text-[#1c1c21] outline-none"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="shrink-0 w-[38px] text-[11px] text-[#85858d]">Node</span>
                        <input
                          value={form.nodeBinPath}
                          spellCheck={false}
                          placeholder="可选，如 ~/.nvm/versions/node/v14/bin"
                          onChange={(event) => setForm({ ...form, nodeBinPath: event.target.value })}
                          aria-label="Node 运行时目录"
                          className="flex-1 h-[24px] px-2 bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[5px] font-mono text-[11px] text-[#1c1c21] outline-none placeholder:text-[#b4b4bb]"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="shrink-0 w-[38px] text-[11px] text-[#85858d]">端口</span>
                        <input
                          value={form.port}
                          inputMode="numeric"
                          onChange={(event) => setForm({ ...form, port: event.target.value.replace(/[^\d]/g, '') })}
                          aria-label="端口"
                          className="w-[88px] h-[24px] px-2 bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[5px] font-mono text-[11px] text-[#1c1c21] outline-none"
                        />
                        <span className="flex-1" />
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="h-[24px] px-2 rounded-[5px] text-[11px] text-[#63636b] hover:bg-[#f1f1f4] transition-colors"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveConfig(project)}
                          className="h-[24px] px-2.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium transition-colors"
                        >
                          保存
                        </button>
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* 底部提示 */}
        <div className="h-[30px] px-3.5 flex items-center border-t border-[#f1f1f4] shrink-0">
          <span className="text-[10.5px] text-[#a1a1aa]">
            服务独立于会话运行，关闭面板或退出对话都不会停止；再次打开这里可以停止。
          </span>
        </div>
      </div>
    </div>

    {browsing ? (
      <DirectoryBrowserModal
        defaultPath={root}
        onPick={(picked) => {
          setBrowsing(false);
          setEditing(null);
          setRoot(picked);
        }}
        onClose={() => setBrowsing(false)}
      />
    ) : null}
    </>,
    document.body
  );
}
