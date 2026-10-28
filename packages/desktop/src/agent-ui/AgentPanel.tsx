import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PendingUserInput, SessionChatMessage, SessionTreeNode, SessionTreeSnapshot } from '@openloop/core/types';
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
import { WorkspaceDock, type DockRequest, type DockTab } from './WorkspaceDock';
import { OpenFileContext } from './open-file';
import { IconClose, IconFork, IconMinimize, IconPanelRight } from './icons';
import { BrandLogo } from '../components/BrandLogo';
import { useDirectoryPicker } from '../components/useDirectoryPicker';
import { ApprovalCard, type AgentUiRequest } from './ApprovalCard';
import { ShortcutSheet } from './ShortcutSheet';
import { useShortcutBindings } from '../hooks/useShortcutBindings';
import { IconCheck, IconChevronDown, IconFolderClose, IconFolderOpen, IconPlus } from './icons';
import { useDismissOnOutsidePointer } from './dsh/useDismissOnOutsidePointer.ts';
import { useAttachments } from './useAttachments';
import { SessionList, SessionListItem } from './SessionList';
import { SessionTreePanel } from './SessionTreePanel';
import { useAgentStream } from './useAgentStream';
import { QueuedInputs } from './QueuedInputs';
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

/** /api/agent/commands-and-skills → Composer 的斜杠候选 */
function toComposerCommands(data: any): ComposerCommand[] {
  const list = Array.isArray(data?.commands) ? data.commands : [];
  const skills = Array.isArray(data?.skills) ? data.skills : [];
  return [
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
  ];
}

/** @ 菜单候选：按目录前缀列出工作区里的文件与文件夹 */
async function workspaceMentionItems(base: string, query: string): Promise<ComposerMentionItem[]> {
  const slash = query.lastIndexOf('/');
  const dirPart = slash >= 0 ? query.slice(0, slash + 1) : '';
  const namePart = slash >= 0 ? query.slice(slash + 1) : query;
  const dir = dirPart ? `${base.replace(/\/$/, '')}/${dirPart}` : base;
  const items: ComposerMentionItem[] = [];
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
    /* 目录不可读时只返回空候选 */
  }
  return items;
}

export interface AgentPanelShellProps {
  title: string;
  subtitle?: string;
  messages: SessionChatMessage[];
  /** 已提交、等待 Agent 采纳的用户输入：起新一轮的在消息流尾部，插话的进输入卡上方的排队条 */
  pendingInputs?: PendingUserInput[];
  isBusy?: boolean;
  /** 会话标识：切换会话时消息区重新贴底 */
  sessionKey?: string;
  /** 该会话的历史还在加载：消息区不切到空态，也不显示空会话首页 */
  loading?: boolean;
  /** 本轮开始时间（毫秒），运行中用于显示用时 */
  turnStartedAt?: number;
  /** 上一轮用时（毫秒），结束后显示固定用时 */
  lastTurnDurationMs?: number;
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
  /** 编辑排队中的插话：正文回到输入框，原条目撤回 */
  onEditQueued?: (item: PendingUserInput) => void;
  /** 撤回排队中的插话 */
  onWithdrawQueued?: (item: PendingUserInput) => void;
  headerExtra?: React.ReactNode;
  onClose?: () => void;
  /** 提供时右上角显示最小化按钮（浮层形态） */
  onMinimize?: () => void;
  children?: React.ReactNode;
  /** 输入卡上方的内容区（放行确认、提示条等由上层决定是否注入） */
  banner?: React.ReactNode;
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
  /** 无顶栏形态的右上角位置（工作台展开按钮） */
  cornerExtra?: React.ReactNode;
  /** 右侧工作区面板（文件 / 终端 / 预览） */
  dock?: React.ReactNode;
  /** 覆盖在消息区上的会话树面板 */
  tree?: React.ReactNode;
  /** 回填输入框：seq 变化即生效，避免同样文本重复跳转失效 */
  draftFill?: { text: string; seq: number };
  /** 重新生成最后一轮回答 */
  onRegenerate?: () => void;
  /** 从某一轮回答分叉出新会话 */
  onFork?: (entryId: string) => void;
  /** 正在创建分支的条目 id：该行分叉图标显示转圈 */
  forkPendingEntryId?: string | null;
  /** 切换会话时用来隔离输入框草稿 */
  draftKey?: string;
  /** 面板当前可见时才监听面板快捷键 */
  shortcutsEnabled?: boolean;
  /** 面板层级优先级：上层浮层高于页内面板，默认 0 */
  shortcutPriority?: number;
}

/** 三种挂载共用的会话外壳：顶栏 + 消息列 + 输入卡 */
export function AgentPanelShell({
  title,
  subtitle,
  messages,
  pendingInputs,
  isBusy,
  sessionKey,
  loading,
  turnStartedAt,
  lastTurnDurationMs,
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
  onEditQueued,
  onWithdrawQueued,
  headerExtra,
  onClose,
  onMinimize,
  children,
  banner,
  cornerExtra,
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
  tree,
  draftFill,
  onRegenerate,
  onFork,
  forkPendingEntryId,
  draftKey,
  shortcutsEnabled = true,
  shortcutPriority = 0,
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

  // 会话树里选中一条提问：正文回到输入框，改完再发就是从那个点开新分支
  const fillSeqRef = useRef(draftFill?.seq);
  useEffect(() => {
    if (!draftFill || draftFill.seq === fillSeqRef.current) return;
    fillSeqRef.current = draftFill.seq;
    if (import.meta.env?.DEV) console.log('[AgentPanel] 回填输入框:', draftFill.text.slice(0, 40));
    setDraft(draftFill.text);
  }, [draftFill]);

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
    shortcutsEnabled && !sheetOpen,
    shortcutPriority
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
      commands={commands}
      onRequestMentions={onRequestMentions}
      permission={permission}
      onPermissionSelect={onPermissionSelect}
      models={models}
      onModelSelect={onModelSelect}
    />
  );

  // 消息已发出但实时状态还没回来时也算运行中，否则新会话首轮开头没有运行指示
  const running = Boolean(isBusy || sending);
  /** 运行中发出的插话：pi 收进队列后排在输入卡上方，等当前这一步结束再送进去 */
  const queuedInputs = useMemo(
    () => (pendingInputs || []).filter((item) => item.placement === 'steering'),
    [pendingInputs]
  );
  const isBlank = messages.length === 0 && !running && !loading;

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
      {tree}

      <div className={styles.mainRow}>
        <div className={styles.mainCol}>
          {cornerExtra && <div className={styles.corner}>{cornerExtra}</div>}
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
                pendingInputs={pendingInputs}
                isBusy={running}
                sessionKey={sessionKey}
                loading={loading}
                turnStartedAt={turnStartedAt}
                lastTurnDurationMs={lastTurnDurationMs}
                emptyTitle={emptyTitle}
                emptyHint={emptyHint}
                contentWidth={contentWidth}
                onRegenerate={onRegenerate}
                onFork={onFork}
                forkPendingEntryId={forkPendingEntryId}
              />
              {banner}
              <QueuedInputs
                items={queuedInputs}
                onEdit={onEditQueued}
                onWithdraw={onWithdrawQueued}
              />
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
  cwd,
}: TaskAgentPanelProps) {
  const [sending, setSending] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  /** 工作台的页签请求：文件、终端，或某个文件的预览 */
  const [dockRequest, setDockRequest] = useState<DockRequest | null>(null);
  const dockSeq = useRef(0);
  const [uiRequest, setUiRequest] = useState<AgentUiRequest | null>(null);
  const [commands, setCommands] = useState<ComposerCommand[]>([]);
  /** 回填输入框：seq 变化即生效 */
  const [draftFill, setDraftFill] = useState<{ text: string; seq: number }>();
  const attachments = useAttachments(taskId);

  /** 打开工作台并切到某个页签；带路径就是把该文件作为预览页签打开 */
  const openDock = useCallback((kind: DockTab, path?: string) => {
    setDockOpen(true);
    setDockRequest({ kind, path, seq: ++dockSeq.current });
  }, []);

  // 面板内快捷键：工作台开合与页签
  useShortcutBindings({
    'dock.toggle': () => setDockOpen((prev) => !prev),
    'dock.files': () => openDock('files'),
    'dock.terminal': () => openDock('terminal'),
  });

  const load = useCallback(() => api.getTaskSession(taskId).catch(() => null), [taskId]);

  // 斜杠指令：候选按任务工作区解析，与全局会话同一份来源
  useEffect(() => {
    api
      .getAgentCommandsAndSkills?.(taskId)
      .then((data: any) => setCommands(toComposerCommands(data)))
      .catch(() => setCommands([]));
  }, [taskId]);

  // 扩展 UI 请求（审批卡）：任务会话的事件带 taskId，只接管本任务
  useEffect(() => {
    const off = api.on('agent:ui_request', (payload: any) => {
      if (!payload || payload.taskId !== taskId) return;
      setUiRequest(payload as AgentUiRequest);
    });
    return () => off?.();
  }, [taskId]);

  const respondUi = useCallback(
    async (payload: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
      if (!uiRequest) return;
      if (import.meta.env?.DEV) {
        console.log('[AgentPanel] 回应任务会话审批请求:', { taskId, id: uiRequest.id, ...payload });
      }
      setUiRequest(null);
      await api.respondTaskUiRequest(taskId, { id: uiRequest.id, ...payload }).catch(() => null);
    },
    [uiRequest, taskId]
  );

  // @ 候选：任务工作区文件
  const requestMentions = useCallback(
    (query: string): Promise<ComposerMentionItem[]> =>
      cwd ? workspaceMentionItems(cwd, query) : Promise.resolve([]),
    [cwd]
  );

  const transport = useMemo(
    () => ({
      send: (message: string, files?: TaskAttachment[], extra?: Record<string, unknown>) =>
        api.sendTaskChatMessage(taskId, message, files, extra as any),
      withdraw: (pendingId: string) => api.withdrawTaskPending(taskId, pendingId),
      pause: () => api.pauseTaskSession(taskId),
      resume: () => api.resumeTaskSession(taskId),
      stop: () => api.pauseTaskSession(taskId),
    }),
    [taskId]
  );

  const { messages, pendingInputs, isBusy, awaitingInput, sendMessage, withdraw, stop, state } =
    useAgentStream({
      streamKey: taskId,
      load,
      transport,
    });

  /** 编辑排队中的插话：先撤回，正文回到输入框 */
  const handleEditQueued = useCallback(
    async (item: PendingUserInput) => {
      await withdraw?.(item.id);
      setDraftFill({ text: item.content, seq: Date.now() });
    },
    [withdraw]
  );

  const handleWithdrawQueued = useCallback(
    (item: PendingUserInput) => {
      void withdraw?.(item.id);
    },
    [withdraw]
  );

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

  /** 消息里的文件引用：作为预览页签在工作台里打开 */
  const openFile = useCallback(
    (path: string) => {
      if (import.meta.env?.DEV) console.log('[AgentPanel] 预览文件:', path);
      openDock('preview', path);
    },
    [openDock]
  );

  return (
    <OpenFileContext.Provider value={openFile}>
    <AgentPanelShell
      title={taskTitle || 'Agent 协作流'}
      subtitle={mode === 'inline' ? '与任务同屏协作' : undefined}
      draftKey={`task_${taskId}`}
      sessionKey={`task_${taskId}`}
      messages={messages}
      pendingInputs={pendingInputs}
      isBusy={isBusy}
      turnStartedAt={state?.turnStartedAt}
      lastTurnDurationMs={state?.lastTurnDurationMs}
      awaitingInput={awaitingInput}
      model={state?.model || model}
      contentWidth={920}
      sending={sending}
      commands={commands}
      onRequestMentions={requestMentions}
      onSend={handleSend}
      onStop={() => void stop()}
      onEditQueued={handleEditQueued}
      onWithdrawQueued={handleWithdrawQueued}
      draftFill={draftFill}
      onClose={onClose}
      headerExtra={
        <>
          {headerExtra}
          <button
            type="button"
            className={`${styles.iconButton} ${dockOpen ? styles.iconButtonActive : ''}`}
            onClick={() => setDockOpen((prev) => !prev)}
            title={dockOpen ? '收起工作台' : '打开工作台：文件 / 终端 / 预览'}
            aria-label="工作台"
          >
            <IconPanelRight size={16} />
          </button>
        </>
      }
      banner={uiRequest ? <ApprovalCard request={uiRequest} onRespond={respondUi} /> : banner}
      dock={
        dockOpen ? (
          <WorkspaceDock cwd={cwd} request={dockRequest} onClose={() => setDockOpen(false)} />
        ) : undefined
      }
      attachments={attachments.items}
      onAddFiles={attachments.add}
      onRemoveAttachment={attachments.remove}
      emptyTitle={taskTitle ? `开始推进：${taskTitle}` : '开始一段新的会话'}
      emptyHint="描述目标即可，Agent 会在任务工作区里读写代码、执行命令。"
      onRegenerate={() => {
        if (import.meta.env?.DEV) console.log('[AgentPanel] 重新生成任务会话最后一轮:', taskId);
        void api.regenerateTaskSession(taskId).catch(() => null);
      }}
    />
    </OpenFileContext.Provider>
  );
}

export interface GlobalAgentPanelProps {
  /** page：整页（带会话列）；overlay：全屏浮层（带会话列 + 关闭）；drawer：抽屉（无会话列） */
  mode: 'page' | 'overlay' | 'drawer';
  onClose?: () => void;
  /** 外部请求打开某条会话：seq 递增即切换，同一条会话再次请求也会切回去 */
  sessionRequest?: { id: string; seq: number } | null;
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
  pinned?: boolean;
  /** 只读组：已删除工作区的会话落在这里 */
  readonly?: boolean;
}

const COLLAPSED_KEY = 'openloop.agent.collapsedProjects';
const PROJECTS_KEY = 'openloop.agent.projects';

const TEMP_PROJECT_KEY = '__temp__';
/** 已删除工作区的会话归入的只读组 */
const UNGROUPED_KEY = '__ungrouped__';
/** 运行指示的熄灭延时：躲开 pi 一轮之间 turn_end → 下一轮 busy 的短暂间隙 */
const RUNNING_IDLE_GRACE_MS = 700;
/**
 * 轮询间隔（毫秒）：磁盘列表 / 实时存活 / 外部写入检测。
 * 列表扫描要给几千个会话文件做 stat 再全量序列化，扫太勤会和切会话读历史抢调度服务。
 */
const LIST_POLL_MS = 60000;
const LIVE_POLL_MS = 2000;
const STAMP_POLL_MS = 5000;
/**
 * 预热延时：pi 冷启动要十几秒（装了扩展更久），等首条消息才起进程会让首条消息白等这一段。
 * 选中会话后停顿这么久再预热：翻列表时只预热真正停留的那一条。
 */
const WARM_DELAY_MS = 600;

/** 窗口在后台时不轮询：回到前台由下一次 tick 自动补上 */
function pollAllowed(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
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

/** 没有可用标题时退回「会话 + 日期」 */
function dateLabel(modifiedAt: string): string {
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
  sessionRequest,
  active = true,
}: GlobalAgentPanelProps) {
  const initialSessionId = sessionRequest?.id || null;
  const { pick: pickDirectory, dialog: directoryDialog } = useDirectoryPicker();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [liveIds, setLiveIds] = useState<string[]>([]);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  /** 最近一次已知的运行集合（poll / refresh / 实时事件共同维护） */
  const busyRef = useRef<Set<string>>(new Set());
  /** 熄灭延时计时器：pi 一轮里会有 turn_end → 下一轮 busy 的间隙，立刻熄灭会让运行指示闪一下 */
  const runningClearTimers = useRef<Map<string, number>>(new Map());
  const [extraProjects, setExtraProjects] = useState<string[]>(() => readJsonArray(PROJECTS_KEY));
  const [collapsed, setCollapsed] = useState<string[]>(() => readJsonArray(COLLAPSED_KEY));
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const wsPickerRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsidePointer(wsPickerRef, wsMenuOpen, setWsMenuOpen);
  useEffect(() => {
    if (!wsMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWsMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [wsMenuOpen]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(initialSessionId || newSessionId());
  /** 新会话占位行：对齐 DSH 的 blank session，点「新会话」后立刻在工作区里插入并选中 */
  const [draft, setDraft] = useState<{ id: string; cwd: string } | null>(null);
  const [streamKey, setStreamKey] = useState<string | null>(() => {
    const id = initialSessionId || newSessionId();
    return `agent_${id}`;
  });
  const [history, setHistory] = useState<SessionChatMessage[] | undefined>(undefined);
  /** 当前选中的会话历史是否还在加载（切换会话时消息区据此保留上一段内容） */
  const [historyLoading, setHistoryLoading] = useState<boolean>(Boolean(initialSessionId));
  /** 切换序号：快速连点以最后一次点击为准，旧的响应直接丢弃 */
  const selectSeq = useRef(0);
  const [cwd, setCwd] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [commands, setCommands] = useState<ComposerCommand[]>([]);
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [permission, setPermission] = useState<ComposerPermission>('full');
  /** 回填输入框：seq 变化即生效，同一句正文重复跳转也有效 */
  const [draftFill, setDraftFill] = useState<{ text: string; seq: number }>();
  const [projectMeta, setProjectMeta] = useState<
    Record<string, { title?: string; hidden?: boolean; pinned?: boolean; order?: number }>
  >({});
  const [dockOpen, setDockOpen] = useState(false);
  /** 工作台的页签请求：文件、终端，或某个文件的预览 */
  const [dockRequest, setDockRequest] = useState<DockRequest | null>(null);
  const dockSeq = useRef(0);
  const [uiRequest, setUiRequest] = useState<AgentUiRequest | null>(null);
  /** 刚发过消息、文件还没落盘的会话：id -> 占位行信息 */
  const pendingRows = useRef<Record<string, { title: string; cwd: string }>>({});
  /** 首条消息落盘后的补刷计时器 */
  const postSendTimer = useRef<number | null>(null);
  /** 历史快照对应的会话与修改时间：切换会话时旧的戳不能拿来比，否则会白读一次整段历史 */
  const historyStampRef = useRef<{ id: string; stamp: string }>({ id: '', stamp: '' });
  const attachments = useAttachments(activeId || '');

  /**
   * 预热槽：pi 冷启动要十几秒（装载扩展、扫目录），选中会话就先把进程拉起来，
   * 首条消息就不用再等冷启动。只留一个槽：换会话时上一个预热进程若一条消息都没发过，直接收回，
   * 避免快速翻会话拉出一堆进程。
   */
  const warmRef = useRef<{ id: string; used: boolean } | null>(null);

  /** 打开工作台并切到某个页签；带路径就是把该文件作为预览页签打开 */
  const openDock = useCallback((kind: DockTab, path?: string) => {
    setDockOpen(true);
    setDockRequest({ kind, path, seq: ++dockSeq.current });
  }, []);

  // 斜杠指令（提供方为 /api/agent/commands-and-skills）
  useEffect(() => {
    api
      .getAgentCommandsAndSkills?.()
      .then((data: any) => setCommands(toComposerCommands(data)))
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
        // 服务端已裁决好标题：重命名 > 会话名（任务标题 / 自动命名）> 首条消息兜底
        title: item.title || dateLabel(item.modifiedAt),
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
      // 失败时保留上一次的列表，否则一次抖动就会把侧栏清成空工作区
      if (import.meta.env?.DEV) console.warn('[AgentPanel] 加载会话列表失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 面板打开时重新拉一次磁盘会话列表；隐藏期间外部新建的会话就靠这一下才出现
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (pollAllowed()) void refresh();
    }, LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(extraProjects));
  }, [extraProjects]);

  const selectSession = useCallback(async (id: string) => {
    const seq = ++selectSeq.current;
    setActiveId(id);
    setStreamKey(`agent_${id}`);
    setHistory(undefined);
    setHistoryLoading(true);
    // 上一个会话遗留的审批卡不能带到新会话
    setUiRequest(null);
    // 离开新会话就撤掉占位行
    setDraft((prev) => (prev?.id === id ? prev : null));
    try {
      const detail = await api.getAgentSession(id);
      if (seq !== selectSeq.current) return;
      setHistory(detail.messages || []);
      setCwd(detail.summary?.cwd || '');
      // 打开会话即展开它所在的项目，侧栏能看到选中行
      const projectKey = normalizeProjectCwd(detail.summary?.cwd || '');
      setCollapsed((prev) => (prev.includes(projectKey) ? prev.filter((item) => item !== projectKey) : prev));
      historyStampRef.current = { id, stamp: '' };
    } catch (err) {
      if (seq !== selectSeq.current) return;
      if (import.meta.env?.DEV) console.warn('[AgentPanel] 读取历史会话失败:', err);
      setHistory([]);
    } finally {
      if (seq === selectSeq.current) {
        setHistoryLoading(false);
        if (import.meta.env?.DEV) console.log('[AgentPanel] 会话历史就绪:', id);
      }
    }
  }, []);

  // 外部请求（例如任务详情页打开会话）：seq 变化就切过去；面板内部切换不回写这里
  const appliedRequestSeq = useRef(0);
  useEffect(() => {
    if (!sessionRequest || sessionRequest.seq === appliedRequestSeq.current) return;
    appliedRequestSeq.current = sessionRequest.seq;
    if (import.meta.env?.DEV) console.log('[AgentPanel] 外部请求打开会话:', sessionRequest.id);
    void selectSession(sessionRequest.id);
  }, [sessionRequest, selectSession]);

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
            withdraw: (pendingId: string) => api.withdrawAgentPending(activeId, pendingId),
            pause: () => api.pauseAgentSession(activeId),
            resume: () => api.resumeAgentSession(activeId),
            stop: () => api.stopAgentSession(activeId),
          }
        : undefined,
    [activeId, cwd, permission]
  );

  const { messages, pendingInputs, isBusy, awaitingInput, sendMessage, withdraw, stop, state, reload } =
    useAgentStream({
      streamKey,
      load: loadLiveState,
      historyMessages: history,
      transport,
      enabled: Boolean(streamKey),
    });

  /** 编辑排队中的插话：先撤回，正文回到输入框 */
  const handleEditQueued = useCallback(
    async (item: PendingUserInput) => {
      await withdraw?.(item.id);
      setDraftFill({ text: item.content, seq: Date.now() });
    },
    [withdraw]
  );

  const handleWithdrawQueued = useCallback(
    (item: PendingUserInput) => {
      void withdraw?.(item.id);
    },
    [withdraw]
  );

  const startNewSession = useCallback((projectCwd: string) => {
    const id = newSessionId();
    const safeCwd = projectCwd && projectCwd !== TEMP_PROJECT_KEY ? projectCwd : '';
    if (import.meta.env?.DEV) console.log('[AgentPanel] 新建会话:', { id, cwd: safeCwd });
    setActiveId(id);
    setStreamKey(`agent_${id}`);
    setHistory([]);
    setHistoryLoading(false);
    setCwd(safeCwd);
    setDraft({ id, cwd: safeCwd });
    if (projectCwd && projectCwd !== TEMP_PROJECT_KEY) {
      setExtraProjects((prev) => (prev.includes(projectCwd) ? prev : [projectCwd, ...prev]));
      setCollapsed((prev) => prev.filter((key) => key !== projectCwd));
    }
  }, []);

  const handleAddProject = useCallback(async () => {
    // 桌面端调用系统原生面板，浏览器调试退回应用内目录面板
    const picked = await pickDirectory(cwd || undefined);
    if (!picked) return;
    if (import.meta.env?.DEV) console.log('[AgentPanel] 添加工作区:', picked);
    // 同名目录曾被删除过就恢复工作区行（对齐 DSH：添加即重新建立工作区）
    const projectKey = normalizeProjectCwd(picked);
    if (projectMeta[projectKey]?.hidden) {
      await api.setAgentProjectMeta(projectKey, { hidden: false }).catch(() => null);
      await refreshProjectMeta();
    }
    // 对齐 DSH：添加项目即在该项目里开一段新会话，右侧同时切到空白会话
    startNewSession(picked);
  }, [cwd, startNewSession, pickDirectory, projectMeta, refreshProjectMeta]);

  const handleToggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  }, []);

  const handleSend = useCallback(
    async (message: string) => {
      if (!activeId) return;
      setSending(true);
      if (!streamKey) setStreamKey(`agent_${activeId}`);
      // 首条消息发出后由实时状态/磁盘列表接管该行
      setDraft(null);
      try {
        // 预热过的会话已经发过消息：不能再当成可回收的预热槽
        if (warmRef.current?.id === activeId) warmRef.current.used = true;
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
        if (postSendTimer.current !== null) window.clearTimeout(postSendTimer.current);
        postSendTimer.current = window.setTimeout(() => {
          postSendTimer.current = null;
          void refresh();
        }, 1500);
      }
    },
    [activeId, streamKey, sendMessage, refresh, attachments, applyRunning, cwd]
  );

  // 卸载时清掉未到期的补刷，并收回没发过消息的预热进程
  useEffect(
    () => () => {
      if (postSendTimer.current !== null) window.clearTimeout(postSendTimer.current);
      const warm = warmRef.current;
      if (warm && !warm.used) void api.stopAgentSession(warm.id).catch(() => null);
    },
    []
  );

  const keyword = query.trim().toLowerCase();
  /** 列表数据源：当前新会话先以占位行出现，等文件落盘后换成真实会话行 */
  const listedSessions = useMemo(() => {
    let rows = sessions;
    if (draft && draft.id === activeId && !keyword && !sessions.some((item) => item.id === draft.id)) {
      const nowIso = new Date().toISOString();
      const row: SessionListItem = {
        id: draft.id,
        title: '新会话',
        cwd: draft.cwd,
        modifiedAt: nowIso,
        createdAt: nowIso,
        messageCount: 0,
        draft: true,
      };
      rows = [row, ...sessions];
    }
    // 同一会话可能因工作区改名或搬移留下新旧两份文件（id 相同）：行 key 必须唯一，否则会重复出行且多行同时高亮
    const seen = new Set<string>();
    const unique: SessionListItem[] = [];
    for (const item of rows) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      unique.push(item);
    }
    return unique;
  }, [sessions, draft, activeId, keyword]);

  const filteredSessions = useMemo(() => {
    if (!keyword) return listedSessions;
    return listedSessions.filter((item) => item.title.toLowerCase().includes(keyword));
  }, [listedSessions, keyword]);

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
        pinned: meta.pinned === true,
      };
      map.set(key, group);
      return group;
    };

    for (const projectCwd of extraProjects) ensure(projectCwd);
    // 已删除的工作区：行从列表移除，它的会话落到末尾的「未分组」（对齐 DSH 的删除语义）
    const orphaned: SessionListItem[] = [];
    for (const session of filteredSessions) {
      const projectKey = normalizeProjectCwd(session.cwd || '');
      if (projectMeta[projectKey]?.hidden) {
        orphaned.push(session);
        continue;
      }
      const group = ensure(projectKey);
      group.sessions.push(session);
      const time = Date.parse(session.modifiedAt) || 0;
      if (time > group.lastModified) group.lastModified = time;
      const created = Date.parse(session.createdAt || '');
      if (Number.isFinite(created) && (!group.createdAt || created < Date.parse(group.createdAt))) {
        group.createdAt = session.createdAt;
      }
    }

    const sorted = [...map.values()]
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

    if (orphaned.length === 0) return sorted;
    return [
      ...sorted,
      {
        key: UNGROUPED_KEY,
        label: '未分组',
        cwd: '',
        readonly: true,
        lastModified: Math.max(0, ...orphaned.map((item) => Date.parse(item.modifiedAt) || 0)),
        sessions: orphaned.sort(
          (a, b) => (Date.parse(b.modifiedAt) || 0) - (Date.parse(a.modifiedAt) || 0)
        ),
      },
    ];
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
    const timer = window.setInterval(() => {
      if (pollAllowed()) void applyLiveState();
    }, LIVE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, applyLiveState]);

  // 当前会话被外部写入（同一会话在终端或客户端里继续）时重载历史，避免停在半轮的旧快照
  const activePath = sessions.find((entry) => entry.id === activeId)?.path;
  const activeRunning = Boolean(activeId && busyIds.includes(activeId));
  useEffect(() => {
    if (!active || !activeId || activeRunning || !activePath) return;
    let cancelled = false;
    const check = async () => {
      try {
        const info = await api.statAgentFs(activePath);
        if (cancelled) return;
        const stamp = `${info.size}:${info.mtime}`;
        // 换过会话（或还没记过这份文件）时只登记戳，不做重载
        if (historyStampRef.current.id !== activeId || !historyStampRef.current.stamp) {
          historyStampRef.current = { id: activeId, stamp };
          return;
        }
        if (historyStampRef.current.stamp === stamp) return;
        // 写入还在进行时先等一轮，避免每 3 秒重载一次大文件
        if (Date.now() - info.mtime < 1500) return;
        historyStampRef.current = { id: activeId, stamp };
        const detail = await api.getAgentSession(activeId);
        if (cancelled) return;
        setHistory(detail.messages || []);
        if (import.meta.env?.DEV) console.log('[AgentPanel] 会话文件已更新，重载历史', activeId);
      } catch (err) {
        if (import.meta.env?.DEV) console.warn('[AgentPanel] 检查会话文件失败:', err);
      }
    };
    void check();
    const timer = window.setInterval(() => {
      if (pollAllowed()) void check();
    }, STAMP_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // 只跟会话本身与运行态：列表每次轮询都会换数组，用 sessions 当依赖会让计时器被反复重建
  }, [active, activeId, activeRunning, activePath]);

  // 运行指示跟随实时事件：一轮结束（agent_settled）就熄灭；会话命名变化即时换标题
  useEffect(() => {
    if (!active) return;
    const off = api.on('agent:stream', (event: any) => {
      const taskId: string | undefined = event?.taskId;
      if (!taskId || !taskId.startsWith('agent_')) return;
      const sessionId = taskId.slice('agent_'.length);

      if (event?.kind === 'title') {
        const title = typeof event.title === 'string' ? event.title.trim() : '';
        if (!title) return;
        if (import.meta.env?.DEV) console.log('[AgentPanel] 会话已自动命名', sessionId, title);
        const pending = pendingRows.current[sessionId];
        if (pending) pending.title = title;
        setSessions((prev) =>
          prev.some((item) => item.id === sessionId)
            ? prev.map((item) => (item.id === sessionId ? { ...item, title } : item))
            : prev
        );
        return;
      }

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
        setDraft({ id: next, cwd });
      }
      await refresh();
    },
    [activeId, refresh, cwd]
  );

  const renameProject = useCallback(
    async (cwdKey: string, title: string) => {
      await api.setAgentProjectMeta(cwdKey, { title: title.trim() }).catch(() => null);
      await refreshProjectMeta();
    },
    [refreshProjectMeta]
  );

  const deleteProject = useCallback(
    async (cwdKey: string) => {
      // 对齐 DSH：只从工作区列表移除，文件夹与会话都保留，会话落到「未分组」
      await api.setAgentProjectMeta(cwdKey, { hidden: true }).catch(() => null);
      await refreshProjectMeta();
    },
    [refreshProjectMeta]
  );

  const pinProject = useCallback(
    async (cwdKey: string, pinned: boolean) => {
      await api.setAgentProjectMeta(cwdKey, { pinned }).catch(() => null);
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
  // 一次分叉要重建 pi 会话（几秒），期间重复点击会分叉出多个会话，这里锁住
  const forkingRef = useRef(false);
  /** 正在创建分支的那一行（图标换转圈），一次只允许一条 */
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  /** 面板内的轻量提示条：分叉完成 / 失败时给一句反馈 */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, 4000);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    },
    []
  );
  const handleFork = useCallback(
    async (entryId: string) => {
      if (!activeId || forkingRef.current) return;
      forkingRef.current = true;
      setForkingEntryId(entryId);
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
        setDraft(null);
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
        showNotice(result.title ? `已创建分支：${result.title}` : '已创建分支');
      } catch (err) {
        if (import.meta.env?.DEV) console.warn('[AgentPanel] 分叉失败:', err);
        showNotice('分叉失败，请重试');
      } finally {
        forkingRef.current = false;
        setForkingEntryId(null);
      }
    },
    [activeId, refresh, showNotice]
  );

  // 会话树：pi 允许回到任意历史条目继续，被放弃的分支一条不删
  const [treeOpen, setTreeOpen] = useState(false);
  const [tree, setTree] = useState<SessionTreeSnapshot | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const openTree = useCallback(async () => {
    if (!activeId) return;
    setTreeOpen(true);
    setTreeLoading(true);
    try {
      const snapshot = await api.getAgentSessionTree(activeId);
      if (import.meta.env?.DEV) {
        console.log('[AgentPanel] 会话树:', { nodes: snapshot.nodes.length, leaf: snapshot.leafId });
      }
      setTree(snapshot);
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[AgentPanel] 读取会话树失败:', err);
      setTree(null);
    } finally {
      setTreeLoading(false);
    }
  }, [activeId]);

  const handleTreeSelect = useCallback(
    async (node: SessionTreeNode) => {
      if (!activeId) return;
      try {
        const result = await api.navigateAgentSessionTree(activeId, node.id);
        if (import.meta.env?.DEV) {
          console.log('[AgentPanel] 会话树跳转:', { entry: node.id, leaf: result.leafEntryId });
        }
        // 选中提问：正文回到输入框，改完再发就是从那个点长出新分支
        if (node.kind === 'user' && node.text) setDraftFill({ text: node.text, seq: Date.now() });
        setTreeOpen(false);
        setTree(null);
        // 历史前缀也要换成新分支，否则会跟着旧分支重新拼回来
        const detail = await api.getAgentSession(activeId);
        setHistory(detail.messages || []);
        void reload();
      } catch (err) {
        if (import.meta.env?.DEV) console.warn('[AgentPanel] 会话树跳转失败:', err);
      }
    },
    [activeId, reload]
  );

  // @ 候选：当前工作区文件 + 最近会话
  const requestMentions = useCallback(
    async (query: string): Promise<ComposerMentionItem[]> => {
      const base = cwd || sessions.find((item) => item.id === activeId)?.cwd || '';
      const items: ComposerMentionItem[] = base ? await workspaceMentionItems(base, query) : [];

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
  useShortcutBindings(
    {
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
      'dock.toggle': () => setDockOpen((prev) => !prev),
      'dock.files': () => openDock('files'),
      'dock.terminal': () => openDock('terminal'),
      'session.tree': () => void openTree(),
    },
    active,
    1
  );
  // 仅 Electron（macOS）需要为红黄绿窗口按钮让位；浏览器里不偏移
  const trafficLightInset = (() => {
    if (typeof window === 'undefined') return false;
    const electron = (window as any).electronAPI;
    if (!electron) return false;
    const platform = electron.platform as string | undefined;
    if (platform) return platform === 'darwin';
    return /mac/i.test(navigator.userAgent);
  })();
  const title = activeSession?.title || (activeId ? '新会话' : '智能体开发');
  const activeCwd = cwd || activeSession?.cwd || '';

  /**
   * 预热 pi 进程
   * 只是把进程拉起来、不发消息；进程在线后首条消息不必再等冷启动。
   * 工作目录确定后才预热：进程的 cwd 在启动时固定，预热错目录等于白热。
   * 只留一个槽：换会话时上一个预热进程若一条消息都没发过，直接收回，不让翻会话堆进程。
   */
  useEffect(() => {
    if (!active || !activeId || !activeCwd || warmRef.current?.id === activeId) return;
    const timer = window.setTimeout(() => {
      const previous = warmRef.current;
      if (previous && !previous.used) {
        if (import.meta.env?.DEV) console.log('[AgentPanel] 收回未使用的预热进程:', previous.id);
        void api.stopAgentSession(previous.id).catch(() => null);
      }
      warmRef.current = { id: activeId, used: false };
      if (import.meta.env?.DEV) console.log('[AgentPanel] 预热 Agent 进程:', { id: activeId, cwd: activeCwd });
      api
        .openAgentSession(activeId, { cwd: activeCwd, permission })
        .then((result) => {
          // 预热期间已经切走：这条进程没人要了，立刻收回
          if (warmRef.current?.id !== activeId) {
            if (result.created) void api.stopAgentSession(activeId).catch(() => null);
            return;
          }
          // 进程本来就在：这条槽没有可回收的进程
          if (!result.created) warmRef.current = null;
        })
        .catch(() => {
          if (warmRef.current?.id === activeId) warmRef.current = null;
        });
    }, WARM_DELAY_MS);
    return () => window.clearTimeout(timer);
    // permission 变了不重新预热：权限切换会重启进程，这里只负责首次拉起来
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeId, activeCwd]);

  // 工作区选择：点芯片先开列表（与 DSH 一致），最后一项才是添加工作区
  const activeProjectKey = normalizeProjectCwd(activeCwd);
  const activeProject = groups.find((group) => group.key === activeProjectKey);
  const wsLabelText = activeCwd && activeProject ? activeProject.label : '选择工作区';

  const pickWorkspace = (group: ProjectGroup) => {
    setWsMenuOpen(false);
    const next = group.key === TEMP_PROJECT_KEY ? '' : group.cwd;
    if (next) {
      setExtraProjects((prev) => (prev.includes(next) ? prev : [next, ...prev]));
      setCollapsed((prev) => prev.filter((key) => key !== next));
    }
    setCwd(next);
  };

  const hero = (
    <>
      <div className={styles.headline}>开始一段新的会话</div>
      <div className={styles.chipRow}>
        <div
          ref={wsPickerRef}
          className={styles.wsPicker}
          data-agent-transient={wsMenuOpen ? '' : undefined}
        >
          <button
            type="button"
            className={styles.wsChip}
            onClick={() => setWsMenuOpen((prev) => !prev)}
            title={activeCwd || '选择工作区'}
            aria-haspopup="menu"
            aria-expanded={wsMenuOpen}
          >
            <IconFolderOpen size={16} className={styles.wsFolder} />
            <span className={styles.wsLabel}>{wsLabelText}</span>
            <IconChevronDown size={12} className={styles.wsChevron} />
          </button>
          {wsMenuOpen && (
            <div className={styles.wsMenu} role="menu">
              <div className={styles.wsMenuList}>
                {groups.map((group) => (
                  <button
                    key={group.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={Boolean(activeCwd) && group.key === activeProjectKey}
                    className={styles.wsMenuItem}
                    title={group.cwd || group.label}
                    onClick={() => pickWorkspace(group)}
                  >
                    <IconFolderClose size={16} className={styles.wsMenuIcon} />
                    <span className={styles.wsMenuLabel}>{group.label}</span>
                    {activeCwd && group.key === activeProjectKey && (
                      <IconCheck size={14} className={styles.wsMenuCheck} />
                    )}
                  </button>
                ))}
              </div>
              {groups.length > 0 && <div className={styles.wsMenuDivider} />}
              <button
                type="button"
                role="menuitem"
                className={styles.wsMenuItem}
                onClick={() => {
                  setWsMenuOpen(false);
                  void handleAddProject();
                }}
              >
                <IconPlus size={16} className={styles.wsMenuIcon} />
                <span className={styles.wsMenuLabel}>添加工作区…</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  /** 消息里的文件引用：作为预览页签在工作台里打开 */
  const openFile = useCallback(
    (path: string) => {
      if (import.meta.env?.DEV) console.log('[AgentPanel] 预览文件:', path);
      openDock('preview', path);
    },
    [openDock]
  );

  /** 工作台展开按钮：顶栏形态放顶栏，整页形态（无顶栏）放右上角 */
  const dockToggle = (
    <button
      type="button"
      className={`${styles.iconButton} ${dockOpen ? styles.iconButtonActive : ''}`}
      onClick={() => setDockOpen((prev) => !prev)}
      title={dockOpen ? '收起工作台' : '打开工作台：文件 / 终端 / 预览'}
      aria-label="工作台"
    >
      <IconPanelRight size={16} />
    </button>
  );

  /** 会话树入口：与分叉同一套语义，只是不离开当前会话 */
  const treeToggle = (
    <button
      type="button"
      className={`${styles.iconButton} ${treeOpen ? styles.iconButtonActive : ''}`}
      onClick={() => (treeOpen ? setTreeOpen(false) : void openTree())}
      disabled={!activeId}
      title="会话树：回到任意历史节点继续，历史不丢"
      aria-label="会话树"
    >
      <IconFork size={16} />
    </button>
  );
  const cornerToggles = (
    <>
      {treeToggle}
      {dockToggle}
    </>
  );

  return (
    <OpenFileContext.Provider value={openFile}>
    <div
      className={`agent-scope ${styles.panel} ${
        mode === 'drawer' ? styles.panelDrawer : styles.panelPage
      } ${mode === 'overlay' ? styles.panelOverlay : ''}`}
    >
      {mode !== 'drawer' && (
        <SessionList
          brandSlot={
            <>
              {trafficLightInset && <div className={styles.windowStrip} />}
              <div className={styles.brandRow}>
                <BrandLogo size={18} className={styles.brandLogo} />
                <span className={styles.brandName}>openLoop</span>
                <span className={styles.brandTag}>智能体</span>
              </div>
            </>
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
          onDeleteProject={(key) => void deleteProject(key)}
          onPinProject={(key, pinned) => void pinProject(key, pinned)}
          onReorderProjects={(keys) => void reorderProjects(keys)}
          onSearchContent={(text) => api.searchAgentSessions(text, 20).then((data) => data.results)}
          renameSignal={renameSignal}
          activeCwd={activeCwd}
          rail={rail}
          onToggleRail={() => setRail((value) => !value)}
        />
      )}

      <div className={styles.main}>
        <AgentPanelShell
          title={title}
          subtitle={
            // 只在真正执行一轮时标注运行中：进程在线但空闲不算运行，避免与消息区的用时指示不一致
            mode === 'drawer' ? undefined : `${shortenPath(activeCwd)}${isBusy ? ' · 运行中' : ''}`
          }
          messages={messages}
          pendingInputs={pendingInputs}
          isBusy={isBusy}
          sessionKey={activeId || ''}
          loading={historyLoading}
          turnStartedAt={state?.turnStartedAt}
          lastTurnDurationMs={state?.lastTurnDurationMs}
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
          onEditQueued={handleEditQueued}
          onWithdrawQueued={handleWithdrawQueued}
          onClose={onClose}
          onMinimize={mode === 'overlay' ? onClose : undefined}
          composerDisabled={!activeId}
          headerless={mode === 'page'}
          shortcutsEnabled={active}
          shortcutPriority={1}
          hero={hero}
          attachments={attachments.items}
          onAddFiles={activeId ? attachments.add : undefined}
          onRemoveAttachment={attachments.remove}
          headerExtra={cornerToggles}
          cornerExtra={mode === 'page' ? cornerToggles : undefined}
          onRegenerate={
            activeId
              ? () => {
                  void api.regenerateAgentSession(activeId).catch(() => null);
                }
              : undefined
          }
          onFork={handleFork}
          forkPendingEntryId={forkingEntryId}
          tree={
            treeOpen ? (
              <SessionTreePanel
                nodes={tree?.nodes || []}
                activeIds={tree?.activeIds || []}
                leafId={tree?.leafId ?? null}
                loading={treeLoading}
                busy={isBusy}
                onClose={() => setTreeOpen(false)}
                onSelect={(node) => void handleTreeSelect(node)}
              />
            ) : undefined
          }
          draftFill={draftFill}
          draftKey={activeId || ''}
          dock={
            dockOpen ? (
              <WorkspaceDock cwd={activeCwd} request={dockRequest} onClose={() => setDockOpen(false)} />
            ) : undefined
          }
          banner={
            uiRequest ? (
              <ApprovalCard request={uiRequest} onRespond={respondUi} />
            ) : notice ? (
              <div className={styles.notice} role="status">
                {notice}
              </div>
            ) : undefined
          }
          emptyTitle={activeId ? '开始一段新的会话' : '选择左侧会话，或新建一段'}
          emptyHint="会话直接跑在本机 pi 上，拥有读写文件与执行命令的能力。"
        />
      </div>

      {directoryDialog}
    </div>
    </OpenFileContext.Provider>
  );
}
