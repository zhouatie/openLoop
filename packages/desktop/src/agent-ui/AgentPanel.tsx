import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionChatMessage } from '@openloop/core/types';
import { api } from '../services/api';
import type { TaskAttachment } from '@openloop/core/types';
import { AgentChatView } from './AgentChatView';
import { Composer, ComposerAttachmentItem } from './Composer';
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
  children,
  banner,
  composerActions,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  hero,
  headerless,
}: AgentPanelShellProps) {
  const [draft, setDraft] = useState('');

  const handleSend = useCallback(
    (message: string) => {
      setDraft('');
      void onSend(message);
    },
    [onSend]
  );

  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSend={handleSend}
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
    />
  );

  const isBlank = messages.length === 0;

  return (
    <div className={`agent-scope ${styles.panel}`}>
      {!headerless && (
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        <div className={styles.headerActions}>
          {headerExtra}
          {onClose && (
            <button type="button" className={styles.closeButton} onClick={onClose} title="关闭">
              ✕
            </button>
          )}
        </div>
      </header>
      )}

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
          />
          {banner}
          {composer}
        </>
      )}
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
}: TaskAgentPanelProps) {
  const [sending, setSending] = useState(false);
  const attachments = useAttachments();

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
      headerExtra={headerExtra}
      banner={banner}
      composerActions={composerActions}
      attachments={attachments.items}
      onAddFiles={attachments.add}
      onRemoveAttachment={attachments.remove}
      emptyTitle={taskTitle ? `开始推进：${taskTitle}` : '开始一段新的会话'}
      emptyHint="描述目标即可，Agent 会在任务工作区里读写代码、执行命令。"
    />
  );
}

export interface GlobalAgentPanelProps {
  mode: 'page' | 'drawer';
  onClose?: () => void;
  initialSessionId?: string | null;
}

interface ProjectGroup {
  key: string;
  label: string;
  cwd: string;
  sessions: SessionListItem[];
  lastModified: number;
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
export function GlobalAgentPanel({ mode, onClose, initialSessionId }: GlobalAgentPanelProps) {
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
  const attachments = useAttachments();

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
          title: sessionTitleOf(item.firstUserMessage, item.modifiedAt),
          cwd: item.cwd || '',
          modifiedAt: item.modifiedAt,
          messageCount: item.messageCount,
          live: liveList.includes(item.id),
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
              }),
            pause: () => api.pauseAgentSession(activeId),
            resume: () => api.resumeAgentSession(activeId),
            stop: () => api.stopAgentSession(activeId),
          }
        : undefined,
    [activeId, cwd]
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
      const group: ProjectGroup = {
        key,
        label: projectLabel(projectCwd),
        cwd: projectCwd,
        sessions: [],
        lastModified: 0,
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
    }

    return [...map.values()]
      .map((group) => ({
        ...group,
        sessions: group.sessions.sort(
          (a, b) => (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0)
        ),
      }))
      .sort((a, b) => b.lastModified - a.lastModified);
  }, [filteredSessions, extraProjects]);

  const activeSession = sessions.find((item) => item.id === activeId);
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
    <div className={`agent-scope ${styles.panel} ${mode === 'page' ? styles.panelPage : styles.panelDrawer}`}>
      {mode === 'page' && (
        <SessionList
          groups={groups}
          activeId={activeId}
          loading={loading}
          query={query}
          collapsed={collapsed}
          onQueryChange={setQuery}
          onToggleGroup={handleToggleGroup}
          onSelectSession={(id) => void selectSession(id)}
          onNewInGroup={startNewSession}
          onAddProject={() => void handleAddProject()}
          onRefresh={() => void refresh()}
        />
      )}

      <div className={styles.main}>
        <AgentPanelShell
          title={title}
          subtitle={mode === 'page' ? `${shortenPath(activeCwd)}${isLive ? ' · 运行中' : ''}` : undefined}
          messages={messages}
          isBusy={isBusy}
          awaitingInput={awaitingInput}
          model={state?.model}
          contentWidth={920}
          sending={sending}
          onSend={handleSend}
          onStop={() => void stop()}
          onClose={onClose}
          composerDisabled={!activeId}
          headerless={mode === 'page'}
          hero={hero}
          attachments={attachments.items}
          onAddFiles={activeId ? attachments.add : undefined}
          onRemoveAttachment={attachments.remove}
          headerExtra={
            <button
              type="button"
              className={styles.cwdButton}
              onClick={() => void handleAddProject()}
              title="切换工作目录"
            >
              {shortenPath(activeCwd)}
            </button>
          }
          emptyTitle={activeId ? '开始一段新的会话' : '选择左侧会话，或新建一段'}
          emptyHint="会话直接跑在本机 pi 上，拥有读写文件与执行命令的能力。"
        />
      </div>
    </div>
  );
}
