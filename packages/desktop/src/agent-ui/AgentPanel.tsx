import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionChatMessage } from '@openloop/core/types';
import { api } from '../services/api';
import type { TaskAttachment } from '@openloop/core/types';
import { AgentChatView } from './AgentChatView';
import {
  Composer,
  ComposerAttachmentItem,
  ComposerCommand,
  ComposerMentionItem,
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

/** @ 菜单里的会话时间：够用即可，不做本地化库 */
function relativeSessionTime(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const diff = Date.now() - time;
  const minute = 60000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
}

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
  onRequestMentions?: (query: string) => Promise<ComposerMentionItem[]>;
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
  /** 切换会话时用来隔离输入框草稿 */
  draftKey?: string;
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
  onRequestMentions,
  permission,
  onPermissionSelect,
  models,
  onModelSelect,
  dock,
  onRegenerate,
  onFork,
  draftKey,
  shortcutsEnabled = true,
}: AgentPanelShellProps) {
  const [draft, setDraft] = useState('');
  /** 每个会话各自的草稿，切换会话时不会串味 */
  const draftsRef = useRef<Record<string, string>>({});
  const draftKeyRef = useRef(draftKey || '');

  useEffect(() => {
    const next = draftKey || '';
    if (next === draftKeyRef.current) {
      draftsRef.current[next] = draft;
      return;
    }
    draftsRef.current[draftKeyRef.current] = draft;
    draftKeyRef.current = next;
    setDraft(draftsRef.current[next] || '');
  }, [draftKey, draft]);
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
      onRequestMentions={onRequestMentions}
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
      draftKey={`task_${taskId}`}
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
/** 运行指示的熄灭延时：躲开 pi 一轮之间 turn_end → 下一轮 busy 的短暂间隙 */
const RUNNING_IDLE_GRACE_MS = 700;

/** pi 会话名可能是路径（任务会话用 workspace 命名），这类名字没有信息量，交回首条消息兜底 */
function usableSessionTitle(title: string | undefined): string {
  const raw = (title || '').replace(/^openLoop:\s*/i, '').trim();
  if (!raw) return '';
  if (/^(\/|~\/|[A-Za-z]:[\\/])/.test(raw)) return '';
  return raw;
}

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
  const [busyIds, setBusyIds] = useState<string[]>([]);
  /** 最近一次已知的运行集合（poll / refresh / 实时事件共同维护） */
  const busyRef = useRef<Set<string>>(new Set());
  /** 熄灭延时计时器：pi 一轮里会有 turn_end → 下一轮 busy 的间隙，立刻熄灭会让运行指示闪一下 */
  const runningClearTimers = useRef<Map<string, number>>(new Map());
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
  /** 刚发过消息、文件还没落盘的会话：id -> 占位行信息 */
  const pendingRows = useRef<Record<string, { title: string; cwd: string }>>({});
  /** 历史快照对应的会话修改时间，用于发现外部写入 */
  const historyStampRef = useRef('');
  const attachments = useAttachments();

  // 斜杠指令（提供方为 /api/agent/commands-and-skills）
  useEffect(() => {
    api
      .getAgentCommandsAndSkills?.()
      .then((data: any) => {
        const list = Array.isArray(data?.commands) ? data.commands : [];
        const skills = Array.isArray(data?.skills) ? data.skills : [];
        setCommands([
          ...list.map((item: any) => ({
            name: String(item.name || '').replace(/^\//, ''),
            description: item.description || item.label,
            kind: item.action ? ('command' as const) : ('template' as const),
          })),
          ...skills.map((item: any) => ({
            name: String(item.name || '').replace(/^\//, ''),
            description: item.description || item.label,
            kind: 'skill' as const,
          })),
        ]);
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

  /** 统一置运行指示：busy 立刻点亮；空闲延迟 RUNNING_IDLE_GRACE_MS 再熄灭，避免一轮之间闪烁 */
  const applyRunning = useCallback((busyList: string[]) => {
    const busy = new Set(busyList);
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        const pending = runningClearTimers.current.get(item.id);
        if (busy.has(item.id)) {
          if (pending) {
            window.clearTimeout(pending);
            runningClearTimers.current.delete(item.id);
          }
          if (item.running) return item;
          changed = true;
          return { ...item, running: true };
        }
        if (!item.running || pending) return item;
        runningClearTimers.current.set(
          item.id,
          window.setTimeout(() => {
            runningClearTimers.current.delete(item.id);
            if (busyRef.current.has(item.id)) return;
            setSessions((cur) =>
              cur.map((row) => (row.id === item.id && row.running ? { ...row, running: false } : row))
            );
          }, RUNNING_IDLE_GRACE_MS)
        );
        return item;
      });
      return changed ? next : prev;
    });
  }, []);

  // 卸载时清掉未触发的熄灭计时器
  useEffect(() => {
    const timers = runningClearTimers.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, live] = await Promise.all([
        api.getAgentSessions({ limit: 0 }),
        api.getLiveAgentSessions().catch(() => ({ sessions: [] as string[], busy: [] as string[] })),
      ]);
      const liveList = live.sessions || [];
      const busyList = live.busy || [];
      setLiveIds(liveList);
      setBusyIds(busyList);
      busyRef.current = new Set(busyList);
      const fromDisk: SessionListItem[] = (list.sessions || []).map((item) => ({
        id: item.id,
        // pi 会话名优先（TUI 侧由扩展 AI 生成）；openLoop 任务会话会带 "openLoop: " 前缀，展示时去掉
        title:
          usableSessionTitle(item.title) || sessionTitleOf(item.firstUserMessage, item.modifiedAt),
        cwd: item.cwd || '',
        modifiedAt: item.modifiedAt,
        messageCount: item.messageCount,
        live: liveList.includes(item.id),
        running: false,
        createdAt: item.createdAt,
        path: item.path,
        archived: item.archived === true,
        pinned: item.pinned === true,
      }));
      // 刚落盘还没被列表扫到的会话（进程仍活着或在跑）要保留，否则该行会先消失再出现
      setSessions((prev) => {
        const prevById = new Map(prev.map((item) => [item.id, item]));
        // 保留已有的运行态，避免刷新时先熄再亮
        const disk = fromDisk.map((item) =>
          prevById.get(item.id)?.running ? { ...item, running: true } : item
        );
        const known = new Set(disk.map((item) => item.id));
        const keep = prev.filter((item) => !known.has(item.id) && (item.running || item.live));
        return keep.length > 0 ? [...keep, ...disk] : disk;
      });
      applyRunning(busyList);
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[AgentPanel] 加载会话列表失败:', err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 面板打开时重新拉一次磁盘会话列表；隐藏期间外部新建的会话就靠这一下才出现
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

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
      historyStampRef.current = '';
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
        // 新会话的文件还没落盘，先登记占位行，等实时状态把它带进列表
        pendingRows.current[activeId] = { title: message.slice(0, 40) || '新会话', cwd };
        busyRef.current.add(activeId);
        applyRunning([...busyRef.current]);
        void applyLiveState();
      } catch (err) {
        if (import.meta.env?.DEV) console.warn('[AgentPanel] 发送全局会话消息失败:', err);
      } finally {
        setSending(false);
        void refresh();
        // 首条消息落盘后补一次刷新，补上真实标题与时间
        window.setTimeout(() => void refresh(), 1500);
      }
    },
    [activeId, streamKey, sendMessage, refresh, attachments, applyRunning, cwd]
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
        sessions: group.sessions.sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
          return (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0);
        }),
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
    async (id: string, title: string) => {
      // 空标题等于清掉覆盖，回到默认标题
      await api.setAgentSessionMeta(id, { title: title.trim() }).catch(() => null);
      await refresh();
    },
    [refresh]
  );

  const archiveSession = useCallback(
    async (id: string, archived: boolean) => {
      await api.setAgentSessionMeta(id, { archived }).catch(() => null);
      await refresh();
    },
    [refresh]
  );

  const pinSession = useCallback(
    async (id: string, pinned: boolean) => {
      await api.setAgentSessionMeta(id, { pinned }).catch(() => null);
      await refresh();
    },
    [refresh]
  );

  /** 把实时会话/运行状态并进列表：已存在的更新标记，文件未落盘的用占位行补上 */
  const applyLiveState = useCallback(async () => {
    const live = await api.getLiveAgentSessions().catch(() => null);
    if (!live) return;
    const liveList = live.sessions || [];
    const busyList = live.busy || [];
    setLiveIds(liveList);
    setBusyIds(busyList);
    busyRef.current = new Set(busyList);
    setSessions((prev) => {
      const known = new Set(prev.map((item) => item.id));
      const nowIso = new Date().toISOString();
      const placeholders: SessionListItem[] = Object.entries(pendingRows.current)
        .filter(([id]) => !known.has(id) && (busyList.includes(id) || liveList.includes(id)))
        .map(([id, info]) => ({
          id,
          title: info.title,
          cwd: info.cwd,
          modifiedAt: nowIso,
          messageCount: 1,
          running: busyList.includes(id),
          live: true,
          createdAt: nowIso,
        }));
      let changed = placeholders.length > 0;
      const next = prev.map((item) => {
        const liveFlag = liveList.includes(item.id);
        if (Boolean(item.live) === liveFlag) return item;
        changed = true;
        return { ...item, live: liveFlag };
      });
      return changed ? [...placeholders, ...next] : prev;
    });
    applyRunning(busyList);
  }, [applyRunning]);

  useEffect(() => {
    if (!active) return;
    void applyLiveState();
    const timer = window.setInterval(() => void applyLiveState(), 2000);
    return () => window.clearInterval(timer);
  }, [active, applyLiveState]);

  // 当前会话被外部写入（同一会话在终端或客户端里继续）时重载历史，避免停在半轮的旧快照
  useEffect(() => {
    if (!active || !activeId || busyIds.includes(activeId)) return;
    const path = sessions.find((entry) => entry.id === activeId)?.path;
    if (!path) return;
    let cancelled = false;
    const check = async () => {
      try {
        const info = await api.statAgentFs(path);
        if (cancelled) return;
        const stamp = `${info.size}:${info.mtime}`;
        if (!historyStampRef.current) {
          historyStampRef.current = stamp;
          return;
        }
        if (historyStampRef.current === stamp) return;
        // 写入还在进行时先等一轮，避免每 3 秒重载一次大文件
        if (Date.now() - info.mtime < 1500) return;
        historyStampRef.current = stamp;
        const detail = await api.getAgentSession(activeId);
        if (cancelled) return;
        setHistory(detail.messages || []);
        if (import.meta.env?.DEV) console.log('[AgentPanel] 会话文件已更新，重载历史', activeId);
      } catch (err) {
        if (import.meta.env?.DEV) console.warn('[AgentPanel] 检查会话文件失败:', err);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, activeId, busyIds, sessions]);

  // 运行指示跟随实时事件：一轮结束（agent_settled）就熄灭
  useEffect(() => {
    if (!active) return;
    const off = api.on('agent:stream', (event: any) => {
      const taskId: string | undefined = event?.taskId;
      if (!taskId || !taskId.startsWith('agent_')) return;
      const sessionId = taskId.slice('agent_'.length);
      const busy =
        event?.kind === 'status'
          ? event.patch?.isBusy
          : event?.kind === 'message_delta' || event?.kind === 'message'
            ? true
            : undefined;
      if (typeof busy !== 'boolean') return;
      if (busy) busyRef.current.add(sessionId);
      else busyRef.current.delete(sessionId);
      setSessions((prev) => {
        if (prev.some((item) => item.id === sessionId)) return prev;
        // 文件还没落盘：先用占位行让运行指示立刻出现
        const info = pendingRows.current[sessionId];
        if (!busy || !info) return prev;
        const nowIso = new Date().toISOString();
        return [
          {
            id: sessionId,
            title: info.title,
            cwd: info.cwd,
            modifiedAt: nowIso,
            messageCount: 1,
            running: true,
            live: true,
            createdAt: nowIso,
          },
          ...prev,
        ];
      });
      applyRunning([...busyRef.current]);
    });
    return () => off?.();
  }, [active, applyRunning]);

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
    async (cwdKey: string, title: string) => {
      await api.setAgentProjectMeta(cwdKey, { title: title.trim() }).catch(() => null);
      await refreshProjectMeta();
    },
    [refreshProjectMeta]
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

  // @ 候选：当前工作区文件 + 最近会话
  const requestMentions = useCallback(
    async (query: string): Promise<ComposerMentionItem[]> => {
      const base = cwd || sessions.find((item) => item.id === activeId)?.cwd || '';
      const items: ComposerMentionItem[] = [];

      if (base) {
        const slash = query.lastIndexOf('/');
        const dirPart = slash >= 0 ? query.slice(0, slash + 1) : '';
        const namePart = slash >= 0 ? query.slice(slash + 1) : query;
        const dir = dirPart ? `${base.replace(/\/$/, '')}/${dirPart}` : base;
        try {
          const listing = await api.listAgentFs(dir);
          for (const entry of listing.entries) {
            if (namePart && !entry.name.toLowerCase().includes(namePart.toLowerCase())) continue;
            items.push({
              key: `${dirPart}${entry.name}${entry.isDir ? '/' : ''}`,
              label: `${entry.name}${entry.isDir ? '/' : ''}`,
              kind: entry.isDir ? 'dir' : 'file',
            });
            if (items.length >= 12) break;
          }
        } catch (_) {
          /* 目录不可读就只列会话 */
        }
      }

      const keyword = query.toLowerCase();
      const matched = sessions
        .filter((item) => item.id !== activeId)
        .filter((item) => !keyword || (item.title || '').toLowerCase().includes(keyword))
        .slice(0, 5);
      for (const item of matched) {
        items.push({
          key: item.title || item.id,
          label: item.title || '未命名会话',
          kind: 'session',
          description: relativeSessionTime(item.modifiedAt),
        });
      }

      return items;
    },
    [cwd, sessions, activeId]
  );

  const activeSession = sessions.find((item) => item.id === activeId);
  const [searchSignal, setSearchSignal] = useState(0);
  const [renameSignal, setRenameSignal] = useState(0);
  const [rail, setRail] = useState(false);

  // 面板导航快捷键：命令表在 constants/agentShortcuts.ts，可在设置页改键
  useShortcutBindings({
    'session.new': () => startNewSession(activeCwd),
    'session.search': () => setSearchSignal((prev) => prev + 1),
    'workspace.add': () => void handleAddProject(),
    'session.rename': () => {
      // 快捷键触发页内搜索/重命名入口时，交给列表行内编辑
      setRenameSignal((value) => value + 1);
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
    <div
      className={`agent-scope ${styles.panel} ${
        mode === 'drawer' ? styles.panelDrawer : styles.panelPage
      } ${mode === 'overlay' ? styles.panelOverlay : ''}`}
    >
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
          onRenameSession={(id, title) => void renameSession(id, title)}
          onArchiveSession={(id, archived) => void archiveSession(id, archived)}
          onPinSession={(id, pinned) => void pinSession(id, pinned)}
          onDeleteSession={(id) => void deleteSession(id)}
          onRenameProject={(key, title) => void renameProject(key, title)}
          onHideProject={(key) => void hideProject(key)}
          onReorderProjects={(keys) => void reorderProjects(keys)}
          onSearchContent={(text) => api.searchAgentSessions(text, 20).then((data) => data.results)}
          renameSignal={renameSignal}
          rail={rail}
          onToggleRail={() => setRail((value) => !value)}
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
          onRequestMentions={requestMentions}
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
          draftKey={activeId || ''}
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
