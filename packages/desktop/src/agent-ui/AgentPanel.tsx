import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionChatMessage } from '@openloop/core/types';
import { api } from '../services/api';
import type { TaskAttachment } from '@openloop/core/types';
import { AgentChatView } from './AgentChatView';
import {
  Composer,
  ComposerAttachmentItem,
  ComposerCommand,
  ComposerPermission,
} from './Composer';
import { WorkspaceDock, type DockTab } from './WorkspaceDock';
import { IconClose, IconMinimize, IconPanelRight } from './icons';
import { BrandLogo } from '../components/BrandLogo';
import { ApprovalCard, type AgentUiRequest } from './ApprovalCard';
import { ShortcutSheet } from './ShortcutSheet';
import { useShortcutBindings } from '../hooks/useShortcutBindings';
import { IconChevronDown, IconFolderOpen } from './icons';
import { useAttachments } from './useAttachments';
import { SessionList, SessionListItem } from './SessionList';
import { useAgentStream } from './useAgentStream';
import styles from './AgentPanel.module.css';

function newSessionId(): string {
  return `agent_${Date.now().toString(36)}`;
}

function shortenPath(cwd: string): string {
  if (!cwd) return '未指定工作目录';
  const parts = cwd.split('/').filter(Boolean);
  return parts.length <= 3 ? cwd : `…/${parts.slice(-3).join('/')}`;
}

export interface AgentPanelShellProps {
  title: string;
  subtitle?: string;
  messages: SessionChatMessage[];
  isBusy?: boolean;
  awaitingInput?: boolean;
  model?: string;
  thinking?: string;
  emptyTitle?: string;
  emptyHint?: string;
  contentWidth?: number;
  composerDisabled?: boolean;
  sending?: boolean;
  onSend: (message: string) => void | Promise<void>;
  onStop?: () => void;
  headerExtra?: React.ReactNode;
  onClose?: () => void;
  /** 提供时右上角显示最小化按钮（浮层形态） */
  onMinimize?: () => void;
  children?: React.ReactNode;
  /** 输入卡上方的内容区（放行确认、提示条等由上层决定是否注入） */
  banner?: React.ReactNode;
  /** 输入卡左下角的扩展按钮 */
  composerActions?: React.ReactNode;
  attachments?: ComposerAttachmentItem[];
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  /** 空会话时的居中标题与工作区芯片 */
  hero?: React.ReactNode;
  /** 整页形态不渲染顶栏，与 DSH 一致 */
  headerless?: boolean;
  /** 斜杠指令与 @ 文件候选 */
  commands?: ComposerCommand[];
  onRequestFiles?: (query: string) => Promise<string[]>;
  /** 工具权限与模型切换 */
  permission?: ComposerPermission;
  onPermissionSelect?: (preset: ComposerPermission) => void;
  models?: Array<{ id: string; label: string }>;
  onModelSelect?: (model: string) => void;
  /** 右侧工作区面板（文件 / 终端 / 预览） */
  dock?: React.ReactNode;
  /** 重新生成最后一轮回答 */
  onRegenerate?: () => void;
  /** 从某一轮的用户消息分叉出新会话 */
  onFork?: (entryId: string) => void;
  /** 面板当前可见时才监听面板快捷键 */
  shortcutsEnabled?: boolean;
}

/** 三种挂载共用的会话外壳：顶栏 + 消息列 + 输入卡 */
export function AgentPanelShell({
  title,
  subtitle,
  messages,
  isBusy,
  awaitingInput,
  model,
  thinking,
  emptyTitle,
  emptyHint,
  contentWidth,
  composerDisabled,
  sending,
  onSend,
  onStop,
  headerExtra,
  onClose,
  onMinimize,
  children,
  banner,
  composerActions,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  hero,
  headerless,
  commands,
  onRequestFiles,
  permission,
  onPermissionSelect,
  models,
  onModelSelect,
  dock,
  onRegenerate,
  onFork,
  shortcutsEnabled = true,
}: AgentPanelShellProps) {
  const [draft, setDraft] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastEscRef = useRef(0);

  const handleSend = useCallback(
    (message: string) => {
      setDraft('');
      void onSend(message);
    },
    [onSend]
  );

  /** Super + Enter：打断当前回答并立刻发送 */
  const handleAcceleratedSend = useCallback(
    (message: string) => {
      setDraft('');
      if (import.meta.env?.DEV) {
        console.log('[AgentPanel] 加速发送：先中断当前回答', { length: message.length });
      }
      onStop?.();
      void onSend(message);
    },
    [onSend, onStop]
  );

  useShortcutBindings(
    { 'shortcuts.sheet': () => setSheetOpen(true) },
    shortcutsEnabled && !sheetOpen
  );

  /**
   * Esc 分层处理：双击 Esc 停止生成；有瞬时层（popover / 菜单 / 审批卡）时交给它们；
   * 否则关闭面板。
   */
  const handleEscape = useCallback(() => {
    const now = Date.now();
    const isDouble = now - lastEscRef.current < 500;
    lastEscRef.current = now;
    if (isBusy && onStop) {
      // 生成中：单击 Esc 只关闭瞬时层（由它们自己处理），双击才停止生成
      if (isDouble) {
        if (import.meta.env?.DEV) {
          console.log('[AgentPanel] 双击 Esc 停止生成');
        }
        lastEscRef.current = 0;
        onStop();
      }
      return;
    }
    if (rootRef.current?.querySelector('[data-agent-transient]')) return;
    onClose?.();
  }, [isBusy, onStop, onClose]);

  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSend={handleSend}
      onAcceleratedSend={handleAcceleratedSend}
      onStop={onStop}
      busy={isBusy}
      awaitingInput={awaitingInput}
      disabled={composerDisabled || sending}
      model={model}
      thinking={thinking}
      attachments={attachments}
      onAddFiles={onAddFiles}
      onRemoveAttachment={onRemoveAttachment}
      actions={composerActions}
      commands={commands}
      onRequestFiles={onRequestFiles}
      permission={permission}
      onPermissionSelect={onPermissionSelect}
      models={models}
      onModelSelect={onModelSelect}
    />
  );

  const isBlank = messages.length === 0;

  return (
    <div
      ref={rootRef}
      className={`agent-scope ${styles.panel}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') handleEscape();
      }}
    >
      {!headerless && (
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        <div className={styles.headerActions}>
          {headerExtra}
          {onMinimize ? (
            <button
              type="button"
              className={styles.iconButton}
              onClick={onMinimize}
              title="最小化"
              aria-label="最小化"
            >
              <IconMinimize size={16} />
            </button>
          ) : (
            onClose && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={onClose}
                title="关闭"
                aria-label="关闭"
              >
                <IconClose size={14} />
              </button>
            )
          )}
        </div>
      </header>
      )}

      {sheetOpen && <ShortcutSheet onClose={() => setSheetOpen(false)} />}

      <div className={styles.mainRow}>
        <div className={styles.mainCol}>
          <div className={styles.body}>{children}</div>

          {isBlank ? (
            <div className={styles.heroArea}>
              <div className={styles.heroStack}>
                {hero}
                {composer}
              </div>
            </div>
          ) : (
            <>
              <AgentChatView
                messages={messages}
                isBusy={isBusy}
                emptyTitle={emptyTitle}
                emptyHint={emptyHint}
                contentWidth={contentWidth}
                onRegenerate={onRegenerate}
                onFork={onFork}
              />
              {banner}
              {composer}
            </>
          )}
        </div>
        {dock}
      </div>
    </div>
  );
}

export interface TaskAgentPanelProps {
  taskId: string;
  taskTitle?: string;
  mode: 'inline' | 'drawer';
  model?: string;
  onClose?: () => void;
  /** 挂载方追加的发送参数（例如随消息附带的测试产物），面板不解释其含义 */
  sendExtra?: () => Record<string, unknown>;
  headerExtra?: React.ReactNode;
  banner?: React.ReactNode;
  composerActions?: React.ReactNode;
  /** 任务工作区，用于文件 / 终端 / 预览面板 */
  cwd?: string;
}

/** 任务绑定会话：数据来自任务会话接口，事件按 task.id 路由 */
export function TaskAgentPanel({
  taskId,
  taskTitle,
  mode,
  model,
  onClose,
  sendExtra,
  headerExtra,
  banner,
  composerActions,
  cwd,
}: TaskAgentPanelProps) {
  const [sending, setSending] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab | null>(null);
  const [uiRequest, setUiRequest] = useState<AgentUiRequest | null>(null);
  const attachments = useAttachments();

  // 面板内快捷键：工作台开合与页签
  useShortcutBindings({
    'dock.toggle': () => setDockTab((prev) => (prev ? null : 'files')),
    'dock.files': () => setDockTab('files'),
    'dock.terminal': () => setDockTab('terminal'),
  });

  const load = useCallback(() => api.getTaskSession(taskId).catch(() => null), [taskId]);

  const transport = useMemo(
    () => ({
      send: (message: string, files?: TaskAttachment[], extra?: Record<string, unknown>) =>
        api.sendTaskChatMessage(taskId, message, files, extra as any),
      pause: () => api.pauseTaskSession(taskId),
      resume: () => api.resumeTaskSession(taskId),
      stop: () => api.pauseTaskSession(taskId),
    }),
    [taskId]
  );

  const { messages, isBusy, awaitingInput, sendMessage, stop, state } = useAgentStream({
    streamKey: taskId,
    load,
    transport,
  });

  const handleSend = useCallback(
    async (message: string) => {
      setSending(true);
      try {
        await sendMessage(message, attachments.ready, sendExtra?.());
        attachments.clear();
      } catch (err) {
        if (import.meta.env?.DEV) console.warn('[AgentPanel] 发送任务会话消息失败:', err);
      } finally {
        setSending(false);
      }
    },
    [sendMessage, attachments, sendExtra]
  );

  return (
    <AgentPanelShell
      title={taskTitle || 'Agent 协作流'}
      subtitle={mode === 'inline' ? '与任务同屏协作' : undefined}
      messages={messages}
      isBusy={isBusy}
      awaitingInput={awaitingInput}
      model={state?.model || model}
      contentWidth={920}
      sending={sending}
      onSend={handleSend}
      onStop={() => void stop()}
      onClose={onClose}
      headerExtra={
        <>
          {headerExtra}
          <button
            type="button"
            className={`${styles.iconButton} ${dockTab ? styles.iconButtonActive : ''}`}
            onClick={() => setDockTab((prev) => (prev ? null : 'files'))}
            title={dockTab ? '收起工作台' : '打开工作台：文件 / 终端 / 预览'}
            aria-label="工作台"
          >
            <IconPanelRight size={16} />
          </button>
        </>
      }
      banner={banner}
      composerActions={composerActions}
      dock={
        dockTab ? (
          <WorkspaceDock
            cwd={cwd}
            activeTab={dockTab}
            onTabChange={setDockTab}
            onClose={() => setDockTab(null)}
          />
        ) : undefined
      }
      attachments={attachments.items}
      onAddFiles={attachments.add}
      onRemoveAttachment={attachments.remove}
      emptyTitle={taskTitle ? `开始推进：${taskTitle}` : '开始一段新的会话'}
      emptyHint="描述目标即可，Agent 会在任务工作区里读写代码、执行命令。"
    />
  );
}

export interface GlobalAgentPanelProps {
  /** page：整页（带会话列）；overlay：全屏浮层（带会话列 + 关闭）；drawer：抽屉（无会话列） */
  mode: 'page' | 'overlay' | 'drawer';
  onClose?: () => void;
  initialSessionId?: string | null;
  /** 不可见时关闭面板级快捷键 */
  active?: boolean;
}

interface ProjectGroup {
  key: string;
  label: string;
  cwd: string;
  sessions: SessionListItem[];
  lastModified: number;
  createdAt?: string;
  order?: number;
}

const COLLAPSED_KEY = 'openloop.agent.collapsedProjects';
const PROJECTS_KEY = 'openloop.agent.projects';

const TEMP_PROJECT_KEY = '__temp__';

/** 临时目录、仓库子包与会话工作树都归入所属项目，避免侧栏被内部路径刷屏 */
function normalizeProjectCwd(cwd: string): string {
  if (!cwd) return TEMP_PROJECT_KEY;
  if (/^\/(private\/)?var\/folders\//.test(cwd)) return TEMP_PROJECT_KEY;
  if (/^\/(private\/)?tmp\//.test(cwd)) return TEMP_PROJECT_KEY;

  let root = cwd;
  const worktreeAt = root.indexOf('/.worktrees/');
  if (worktreeAt > 0) root = root.slice(0, worktreeAt);

  for (const marker of ['/packages/', '/apps/', '/node_modules/', '/src/']) {
    const at = root.indexOf(marker);
    if (at > 0) {
      root = root.slice(0, at);
      break;
    }
  }

  const basename = root.split('/').filter(Boolean).pop() || '';
  if (/^(tmp|temp|Temp|T)$/.test(basename)) return TEMP_PROJECT_KEY;
  return root;
}

/** 首条消息若是本地路径，就没有可读标题，退回「会话 + 日期」 */
function sessionTitleOf(firstUserMessage: string | undefined, modifiedAt: string): string {
  const raw = (firstUserMessage || '').trim();
  const looksLikePath = raw.startsWith('/') || raw.startsWith('~/') || /^[A-Za-z]:\\/.test(raw);
  if (raw && !looksLikePath) return raw;
  const time = Date.parse(modifiedAt);
  const stamp = Number.isFinite(time)
    ? new Date(time).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  return stamp ? `会话 ${stamp}` : '未命名会话';
}

function projectLabel(cwd: string): string {
  if (cwd === TEMP_PROJECT_KEY) return '临时任务';
  if (!cwd) return '临时目录';
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function readJsonArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** 全局会话：左侧项目（工作目录）树，展开后是该项目下的会话 */
export function GlobalAgentPanel({
  mode,
  onClose,
  initialSessionId,
  active = true,
}: GlobalAgentPanelProps) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [liveIds, setLiveIds] = useState<string[]>([]);
  const [extraProjects, setExtraProjects] = useState<string[]>(() => readJsonArray(PROJECTS_KEY));
  const [collapsed, setCollapsed] = useState<string[]>(() => readJsonArray(COLLAPSED_KEY));
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(initialSessionId || newSessionId());
  const [streamKey, setStreamKey] = useState<string | null>(() => {
    const id = initialSessionId || newSessionId();
    return `agent_${id}`;
  });
  const [history, setHistory] = useState<SessionChatMessage[] | undefined>(undefined);
  const [cwd, setCwd] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [commands, setCommands] = useState<ComposerCommand[]>([]);
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [permission, setPermission] = useState<ComposerPermission>('full');
  const [projectMeta, setProjectMeta] = useState<
    Record<string, { title?: string; hidden?: boolean; order?: number }>
  >({});
  const [dockTab, setDockTab] = useState<DockTab | null>(null);
  const [uiRequest, setUiRequest] = useState<AgentUiRequest | null>(null);
  const attachments = useAttachments();

  // 斜杠指令（提供方为 /api/agent/commands-and-skills）
  useEffect(() => {
    api
      .getAgentCommandsAndSkills?.()
      .then((data: any) => {
        const list = Array.isArray(data?.commands) ? data.commands : [];
        setCommands(
          list.map((item: any) => ({
            name: String(item.name || '').replace(/^\//, ''),
            description: item.description || item.label,
          }))
        );
      })
      .catch(() => setCommands([]));
  }, []);

  // 扩展 UI 请求（审批 / 选择）：只接管当前会话的请求
  useEffect(() => {
    const off = api.on('agent:ui_request', (payload: any) => {
      if (!payload || payload.sessionId !== activeId) return;
      setUiRequest(payload as AgentUiRequest);
    });
    return () => off?.();
  }, [activeId]);

  const respondUi = useCallback(
    async (payload: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      if (!uiRequest || !activeId) return;
      setUiRequest(null);
      await api.respondAgentUiRequest(activeId, { id: uiRequest.id, ...payload }).catch(() => null);
    },
    [uiRequest, activeId]
  );

  const refreshProjectMeta = useCallback(async () => {
    const data = await api.getAgentProjects().catch(() => ({ projects: {} }));
    setProjectMeta(data.projects || {});
  }, []);

  useEffect(() => {
    void refreshProjectMeta();
  }, [refreshProjectMeta]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, live] = await Promise.all([
        api.getAgentSessions({ limit: 300 }),
        api.getLiveAgentSessions().catch(() => ({ sessions: [] as string[] })),
      ]);
      const liveList = live.sessions || [];
      setLiveIds(liveList);
      setSessions(
        (list.sessions || []).map((item) => ({
          id: item.id,
          title: item.title || sessionTitleOf(item.firstUserMessage, item.modifiedAt),
          cwd: item.cwd || '',
          modifiedAt: item.modifiedAt,
          messageCount: item.messageCount,
          live: liveList.includes(item.id),
          createdAt: item.createdAt,
          path: item.path,
          archived: item.archived === true,
        }))
      );
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[AgentPanel] 加载会话列表失败:', err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(extraProjects));
  }, [extraProjects]);

  const selectSession = useCallback(async (id: string) => {
    setActiveId(id);
    setStreamKey(`agent_${id}`);
    setHistory(undefined);
    try {
      const detail = await api.getAgentSession(id);
      setHistory(detail.messages || []);
      setCwd(detail.summary?.cwd || '');
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[AgentPanel] 读取历史会话失败:', err);
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (initialSessionId) void selectSession(initialSessionId);
    // 仅首帧按传入会话打开
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLiveState = useCallback(async () => {
    if (!activeId) return null;
    const result = await api.getLiveAgentSessionState(activeId).catch(() => ({ state: null }));
    return result.state;
  }, [activeId]);

  const transport = useMemo(
    () =>
      activeId
        ? {
            send: (message: string, files?: TaskAttachment[]) =>
              api.sendAgentSessionMessage(activeId, message, {
                cwd: cwd || undefined,
                attachments: files,
                permission,
              }),
            pause: () => api.pauseAgentSession(activeId),
            resume: () => api.resumeAgentSession(activeId),
            stop: () => api.stopAgentSession(activeId),
          }
        : undefined,
    [activeId, cwd, permission]
  );

  const { messages, isBusy, awaitingInput, sendMessage, stop, state } = useAgentStream({
    streamKey,
    load: loadLiveState,
    historyMessages: history,
    transport,
    enabled: Boolean(streamKey),
  });

  const startNewSession = useCallback((projectCwd: string) => {
    const id = newSessionId();
    const safeCwd = projectCwd && projectCwd !== TEMP_PROJECT_KEY ? projectCwd : '';
    setActiveId(id);
    setStreamKey(`agent_${id}`);
    setHistory([]);
    setCwd(safeCwd);
    if (projectCwd && projectCwd !== TEMP_PROJECT_KEY) {
      setExtraProjects((prev) => (prev.includes(projectCwd) ? prev : [projectCwd, ...prev]));
      setCollapsed((prev) => prev.filter((key) => key !== projectCwd));
    }
  }, []);

  const handleAddProject = useCallback(async () => {
    const bridge = (window as any).electronAPI;
    let picked: string | undefined;
    if (bridge?.openDirectory) {
      picked = await bridge.openDirectory();
    } else if (typeof window !== 'undefined') {
      picked = window.prompt('输入项目目录的绝对路径') || undefined;
    }
    if (!picked) return;
    setExtraProjects((prev) => (prev.includes(picked) ? prev : [picked, ...prev]));
    setCollapsed((prev) => prev.filter((key) => key !== picked));
    // 还没发过消息的会话直接切到新目录
    setCwd((prev) => (prev ? prev : picked));
  }, []);

  const handleToggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }, []);

  const handleSend = useCallback(
    async (message: string) => {
      if (!activeId) return;
      setSending(true);
      if (!streamKey) setStreamKey(`agent_${activeId}`);
      try {
        await sendMessage(message, attachments.ready);
        attachments.clear();
      } catch (err) {
        if (import.meta.env?.DEV) console.warn('[AgentPanel] 发送全局会话消息失败:', err);
      } finally {
        setSending(false);
        void refresh();
      }
    },
    [activeId, streamKey, sendMessage, refresh, attachments]
  );

  const keyword = query.trim().toLowerCase();
  const filteredSessions = useMemo(() => {
    if (!keyword) return sessions;
    return sessions.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [sessions, keyword]);

  const groups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>();
    const ensure = (projectCwd: string): ProjectGroup => {
      const key = projectCwd || TEMP_PROJECT_KEY;
      const existing = map.get(key);
      if (existing) return existing;
      const meta = projectMeta[key] || {};
      const group: ProjectGroup = {
        key,
        label: meta.title || projectLabel(projectCwd),
        cwd: projectCwd,
        sessions: [],
        lastModified: 0,
        order: typeof meta.order === 'number' ? meta.order : undefined,
      };
      map.set(key, group);
      return group;
    };

    for (const projectCwd of extraProjects) ensure(projectCwd);
    for (const session of filteredSessions) {
      const group = ensure(normalizeProjectCwd(session.cwd || ''));
      group.sessions.push(session);
      const time = Date.parse(session.modifiedAt) || 0;
      if (time > group.lastModified) group.lastModified = time;
      const created = Date.parse(session.createdAt || '');
      if (Number.isFinite(created) && (!group.createdAt || created < Date.parse(group.createdAt))) {
        group.createdAt = session.createdAt;
      }
    }

    return [...map.values()]
      .filter((group) => !projectMeta[group.key]?.hidden)
      .map((group) => ({
        ...group,
        sessions: group.sessions.sort(
          (a, b) => (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0)
        ),
      }))
      .sort((a, b) => {
        if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return b.lastModified - a.lastModified;
      });
  }, [filteredSessions, extraProjects, projectMeta]);

  // 会话与工作区元数据操作
  const renameSession = useCallback(
    async (id: string) => {
      const current = sessions.find((item) => item.id === id);
      const next = window.prompt('重命名会话', current?.title || '');
      if (next === null) return;
      await api.setAgentSessionMeta(id, { title: next.trim() }).catch(() => null);
      await refresh();
    },
    [sessions, refresh]
  );

  const archiveSession = useCallback(
    async (id: string, archived: boolean) => {
      await api.setAgentSessionMeta(id, { archived }).catch(() => null);
      await refresh();
    },
    [refresh]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      if (!window.confirm('删除该会话？文件会移入 openLoop 回收目录。')) return;
      await api.deleteAgentSession(id, true).catch(() => null);
      if (id === activeId) {
        const next = newSessionId();
        setActiveId(next);
        setStreamKey(`agent_${next}`);
        setHistory([]);
      }
      await refresh();
    },
    [activeId, refresh]
  );

  const renameProject = useCallback(
    async (cwdKey: string) => {
      const next = window.prompt('重命名工作区', projectMeta[cwdKey]?.title || projectLabel(cwdKey));
      if (next === null) return;
      await api.setAgentProjectMeta(cwdKey, { title: next.trim() }).catch(() => null);
      await refreshProjectMeta();
    },
    [projectMeta, refreshProjectMeta]
  );

  const hideProject = useCallback(
    async (cwdKey: string) => {
      await api.setAgentProjectMeta(cwdKey, { hidden: true }).catch(() => null);
      await refreshProjectMeta();
    },
    [refreshProjectMeta]
  );

  const reorderProjects = useCallback(
    async (keys: string[]) => {
      await Promise.all(
        keys.map((key, index) => api.setAgentProjectMeta(key, { order: index }).catch(() => null))
      );
      await refreshProjectMeta();
    },
    [refreshProjectMeta]
  );

  // 模型候选：会话在线时可列举，离线时用当前模型占位
  useEffect(() => {
    if (!activeId || !liveIds.includes(activeId)) return;
    api
      .getAgentSessionModels(activeId)
      .then((data) => {
        setModels(
          (data.models || []).map((item) => ({
            id: `${item.provider}/${item.id}`,
            label: `${item.provider}/${item.id}`,
          }))
        );
      })
      .catch(() => setModels([]));
  }, [activeId, liveIds]);

  const handleModelSelect = useCallback(
    async (modelId: string) => {
      if (!activeId) return;
      await api.setAgentSessionModel(activeId, modelId).catch(() => null);
    },
    [activeId]
  );

  const handlePermissionSelect = useCallback(
    async (preset: ComposerPermission) => {
      setPermission(preset);
      if (!activeId) return;
      await api.setAgentSessionPermission(activeId, preset).catch(() => null);
    },
    [activeId]
  );

  // 分叉：pi 在同一个子进程里切到新会话，前端跟着切过去
  const handleFork = useCallback(
    async (entryId: string) => {
      if (!activeId) return;
      try {
        const result = await api.forkAgentSession(activeId, entryId);
        if (result.cancelled) return;
        const nextId = result.sessionId;
        if (import.meta.env?.DEV) {
          console.log('[AgentPanel] 分叉会话:', { from: activeId, to: nextId });
        }
        setActiveId(nextId);
        setStreamKey(`agent_${nextId}`);
        setHistory([]);
        setUiRequest(null);
        setLiveIds((prev) => [...new Set([...prev, nextId])]);
        if (result.cwd) setCwd(result.cwd);
        // 读取新会话已落盘的历史，让分叉点之前的上下文立刻可见
        try {
          const detail = await api.getAgentSession(nextId);
          setHistory(detail.messages || []);
          if (!result.cwd && detail.summary?.cwd) setCwd(detail.summary.cwd);
        } catch (err) {
          if (import.meta.env?.DEV) console.warn('[AgentPanel] 读取分叉会话历史失败:', err);
        }
        void refresh();
      } catch (err) {
        if (import.meta.env?.DEV) console.warn('[AgentPanel] 分叉失败:', err);
      }
    },
    [activeId, refresh]
  );

  // @ 文件候选：按输入前缀列目录
  const requestFiles = useCallback(
    async (query: string): Promise<string[]> => {
      const base = cwd || sessions.find((item) => item.id === activeId)?.cwd || '';
      if (!base) return [];
      const slash = query.lastIndexOf('/');
      const dirPart = slash >= 0 ? query.slice(0, slash + 1) : '';
      const namePart = slash >= 0 ? query.slice(slash + 1) : query;
      const dir = dirPart ? `${base.replace(/\/$/, '')}/${dirPart}` : base;
      try {
        const listing = await api.listAgentFs(dir);
        return listing.entries
          .filter((entry) => !namePart || entry.name.toLowerCase().includes(namePart.toLowerCase()))
          .slice(0, 20)
          .map((entry) => `${dirPart}${entry.name}${entry.isDir ? '/' : ''}`);
      } catch (_) {
        return [];
      }
    },
    [cwd, sessions, activeId]
  );

  const activeSession = sessions.find((item) => item.id === activeId);
  const [searchSignal, setSearchSignal] = useState(0);

  // 面板导航快捷键：命令表在 constants/agentShortcuts.ts，可在设置页改键
  useShortcutBindings({
    'session.new': () => startNewSession(activeCwd),
    'session.search': () => setSearchSignal((prev) => prev + 1),
    'workspace.add': () => void handleAddProject(),
    'session.rename': () => {
      if (activeId) void renameSession(activeId);
    },
    'session.archive': () => {
      const target = sessions.find((item) => item.id === activeId);
      if (target) void archiveSession(target.id, !target.archived);
    },
    'dock.toggle': () => setDockTab((prev) => (prev ? null : 'files')),
    'dock.files': () => setDockTab('files'),
    'dock.terminal': () => setDockTab('terminal'),
  });
  // 仅 Electron（macOS）需要为红黄绿窗口按钮让位；浏览器里不偏移
  const trafficLightInset = (() => {
    if (typeof window === 'undefined') return false;
    const electron = (window as any).electronAPI;
    if (!electron) return false;
    const platform = electron.platform as string | undefined;
    if (platform) return platform === 'darwin';
    return /mac/i.test(navigator.userAgent);
  })();
  const isLive = activeId ? liveIds.includes(activeId) : false;
  const title = activeSession?.title || (activeId ? '新会话' : '智能体开发');
  const activeCwd = cwd || activeSession?.cwd || '';

  const hero = (
    <>
      <div className={styles.headline}>开始一段新的会话</div>
      <div className={styles.chipRow}>
        <button
          type="button"
          className={styles.wsChip}
          onClick={() => void handleAddProject()}
          title={activeCwd || '选择工作区'}
        >
          <IconFolderOpen size={16} className={styles.wsFolder} />
          <span className={styles.wsLabel}>{activeCwd ? projectLabel(activeCwd) : '选择工作区'}</span>
          <IconChevronDown size={12} className={styles.wsChevron} />
        </button>
      </div>
    </>
  );

  return (
    <div className={`agent-scope ${styles.panel} ${mode === 'drawer' ? styles.panelDrawer : styles.panelPage}`}>
      {mode !== 'drawer' && (
        <SessionList
          brandSlot={
            <div
              className={styles.brandRow}
              // macOS 桌面端左上角被红黄绿窗口按钮占用，留出同样的让位
              style={trafficLightInset ? { paddingLeft: 72 } : undefined}
            >
              <BrandLogo size={18} className={styles.brandLogo} />
              <span className={styles.brandName}>openLoop</span>
              <span className={styles.brandTag}>智能体</span>
            </div>
          }
          groups={groups}
          activeId={activeId}
          loading={loading}
          query={query}
          collapsed={collapsed}
          onQueryChange={setQuery}
          onToggleGroup={handleToggleGroup}
          searchSignal={searchSignal}
          onSelectSession={(id) => void selectSession(id)}
          onNewInGroup={startNewSession}
          onAddProject={() => void handleAddProject()}
          onRefresh={() => void refresh()}
          onRevealPath={(path) => {
            (window as any).electronAPI?.openPath?.(path);
          }}
          onRenameSession={(id) => void renameSession(id)}
          onArchiveSession={(id, archived) => void archiveSession(id, archived)}
          onDeleteSession={(id) => void deleteSession(id)}
          onRenameProject={(key) => void renameProject(key)}
          onHideProject={(key) => void hideProject(key)}
          onReorderProjects={(keys) => void reorderProjects(keys)}
        />
      )}

      <div className={styles.main}>
        <AgentPanelShell
          title={title}
          subtitle={
            mode === 'drawer' ? undefined : `${shortenPath(activeCwd)}${isLive ? ' · 运行中' : ''}`
          }
          messages={messages}
          isBusy={isBusy}
          awaitingInput={awaitingInput}
          model={state?.model}
          commands={commands}
          onRequestFiles={requestFiles}
          permission={permission}
          onPermissionSelect={handlePermissionSelect}
          models={models}
          onModelSelect={models.length > 0 ? handleModelSelect : undefined}
          contentWidth={920}
          sending={sending}
          onSend={handleSend}
          onStop={() => void stop()}
          onClose={onClose}
          onMinimize={mode === 'overlay' ? onClose : undefined}
          composerDisabled={!activeId}
          headerless={mode === 'page'}
          hero={hero}
          attachments={attachments.items}
          onAddFiles={activeId ? attachments.add : undefined}
          onRemoveAttachment={attachments.remove}
          headerExtra={
            <>
              <button
                type="button"
                className={`${styles.iconButton} ${dockTab ? styles.iconButtonActive : ''}`}
                onClick={() => setDockTab((prev) => (prev ? null : 'files'))}
                title={dockTab ? '收起工作台' : '打开工作台：文件 / 终端 / 预览'}
                aria-label="工作台"
              >
                <IconPanelRight size={16} />
              </button>
            </>
          }
          onRegenerate={
            activeId
              ? () => {
                  void api.regenerateAgentSession(activeId).catch(() => null);
                }
              : undefined
          }
          onFork={handleFork}
          dock={
            dockTab ? (
              <WorkspaceDock
                cwd={activeCwd}
                activeTab={dockTab}
                onTabChange={setDockTab}
                onClose={() => setDockTab(null)}
              />
            ) : undefined
          }
          banner={uiRequest ? <ApprovalCard request={uiRequest} onRespond={respondUi} /> : undefined}
          composerActions={
            mode !== 'drawer' ? (
              <button
                type="button"
                className={`${styles.dockToggle} ${dockTab ? styles.dockToggleActive : ''}`}
                onClick={() => setDockTab((prev) => (prev ? null : 'files'))}
                title={dockTab ? '收起工作台' : '打开工作台：文件 / 终端 / 预览'}
                aria-label="工作台"
              >
                <IconPanelRight size={16} />
              </button>
            ) : undefined
          }
          emptyTitle={activeId ? '开始一段新的会话' : '选择左侧会话，或新建一段'}
          emptyHint="会话直接跑在本机 pi 上，拥有读写文件与执行命令的能力。"
        />
      </div>
    </div>
  );
}
