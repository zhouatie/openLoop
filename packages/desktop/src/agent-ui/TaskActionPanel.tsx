/**
 * 输入卡上方的任务面板：新建任务 / 新建任务组 / 为已有任务执行流水线。
 *
 * 面板自己取任务与流水线数据（短缓存），挂载方只给工作区与草稿，
 * 因此会话页、全局面板和抽屉三种形态共用同一份实现。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  FolderGit2,
  FolderOpen,
  Layers,
  ListTodo,
  Loader2,
  Play,
  Search,
  Workflow,
} from 'lucide-react';
import type { WorkflowDefinition } from '@openloop/core';
import { api } from '../services/api';
import { useShortcuts } from '../context/ShortcutContext';
import { toast } from '../components/Toast';
import { useDirectoryPicker } from '../components/useDirectoryPicker';
import { formatCompactPath, getWorkspaceDirName } from '../components/workspace-path';
import {
  STORAGE_KEY_LAST_WORKSPACE,
  STORAGE_KEY_RECENT_WORKSPACES,
} from '../components/WorkspacePicker';
import { loadTaskOptions, TASK_STATUS_LABEL, type TaskOption } from './task-options';
import { IconClose } from './icons';
import styles from './TaskActionPanel.module.css';

export type TaskActionMode = 'task' | 'group' | 'pipeline';

/** 面板结束时的结果：挂载方只关心「建了什么 / 跑了什么」 */
export interface TaskActionOutcome {
  action: 'created' | 'ran';
  taskId: string;
  title: string;
}

export interface TaskActionPanelProps {
  mode: TaskActionMode;
  /** 会话工作区：新任务默认落在这里 */
  workspace?: string;
  /** 输入卡草稿：新建任务时作为需求说明 */
  draft?: string;
  onClose: () => void;
  onOutcome?: (outcome: TaskActionOutcome) => void;
}

interface WorkflowOption {
  id: string;
  name: string;
  nodeCount: number;
}

const MODE_TITLE: Record<TaskActionMode, string> = {
  task: '新建任务',
  group: '新建任务组',
  pipeline: '执行流水线',
};

/** 流水线短缓存：连续打开面板不重复打接口 */
const CACHE_TTL_MS = 15_000;
let workflowCache: { at: number; items: WorkflowOption[] } | null = null;

function toWorkflowOption(definition: WorkflowDefinition): WorkflowOption {
  return {
    id: definition.id,
    name: definition.name || definition.id,
    nodeCount: Array.isArray(definition.nodes) ? definition.nodes.length : 0,
  };
}

async function loadWorkflows(): Promise<WorkflowOption[]> {
  if (workflowCache && Date.now() - workflowCache.at < CACHE_TTL_MS) return workflowCache.items;
  const items = (await api.getWorkflows()).map(toWorkflowOption);
  workflowCache = { at: Date.now(), items };
  return items;
}

function matches(text: string, query: string): boolean {
  return query === '' || text.toLowerCase().includes(query.toLowerCase());
}

const MAX_RECENT_WORKSPACES = 30;

/** 项目目录候选：与看板的新建任务弹窗共用同一份记忆，选过就记下来 */
function readRecentWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENT_WORKSPACES);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  } catch (_) {
    return [];
  }
}

function readLastWorkspace(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_LAST_WORKSPACE) || '';
  } catch (_) {
    return '';
  }
}

function rememberWorkspace(path: string): void {
  const trimmed = path.trim();
  if (!trimmed) return;
  try {
    const next = [trimmed, ...readRecentWorkspaces().filter((item) => item !== trimmed)].slice(
      0,
      MAX_RECENT_WORKSPACES
    );
    localStorage.setItem(STORAGE_KEY_RECENT_WORKSPACES, JSON.stringify(next));
    localStorage.setItem(STORAGE_KEY_LAST_WORKSPACE, trimmed);
  } catch (_) {
    // 存储不可用不影响创建
  }
}

export function TaskActionPanel({
  mode,
  workspace,
  draft,
  onClose,
  onOutcome,
}: TaskActionPanelProps) {
  const [workflows, setWorkflows] = useState<WorkflowOption[]>(() => workflowCache?.items ?? []);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [groupLines, setGroupLines] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  /** 默认勾选「创建后立即执行」：面板建任务多为建完就跑 */
  const [autoRun, setAutoRun] = useState(true);
  const [query, setQuery] = useState('');
  const [pickingWorkflow, setPickingWorkflow] = useState(false);
  const [pickingWorkspace, setPickingWorkspace] = useState(false);
  const [pickedTask, setPickedTask] = useState<TaskOption | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 项目目录：优先用会话工作区，否则接上次选过的目录
  const [workspaceDir, setWorkspaceDir] = useState(
    () => (workspace || '').trim() || readLastWorkspace()
  );
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(readRecentWorkspaces);
  const { pick, dialog } = useDirectoryPicker();

  const titleRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef<HTMLInputElement>(null);

  const { matchShortcut, describeShortcut } = useShortcuts();
  const confirmKeys = describeShortcut('taskAction.confirm').join('+');
  /** Super + 回车才算确认：面板里单按回车不再建任务或跑流水线 */
  const handleConfirm = (event: React.KeyboardEvent, action: () => void) => {
    if (!matchShortcut(event.nativeEvent, 'taskAction.confirm')) return;
    event.preventDefault();
    action();
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void Promise.allSettled([loadWorkflows(), loadTaskOptions()]).then(([wfResult, taskResult]) => {
      if (!alive) return;
      if (wfResult.status === 'fulfilled') {
        setWorkflows(wfResult.value);
        setWorkflowId((prev) => prev || wfResult.value[0]?.id || '');
      }
      if (taskResult.status === 'fulfilled') setTasks(taskResult.value);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // 焦点落在第一个输入：候选形态落在搜索，新建形态落在标题
    if (pickingWorkspace || pickingWorkflow || (mode === 'pipeline' && !pickedTask)) {
      queryRef.current?.focus();
    } else {
      titleRef.current?.focus();
    }
  }, [mode, pickedTask, pickingWorkflow, pickingWorkspace]);

  const workflowName = useMemo(
    () => workflows.find((item) => item.id === workflowId)?.name ?? '选择流水线',
    [workflows, workflowId]
  );

  const filteredWorkflows = useMemo(
    () => workflows.filter((item) => matches(item.name, query)),
    [workflows, query]
  );

  const filteredTasks = useMemo(
    () => tasks.filter((item) => matches(item.title, query)).slice(0, 40),
    [tasks, query]
  );

  const workspaceCandidates = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    [workspaceDir, ...recentWorkspaces].forEach((item) => {
      const trimmed = item.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      list.push(trimmed);
    });
    return list;
  }, [recentWorkspaces, workspaceDir]);

  const filteredWorkspaces = useMemo(() => {
    if (query.trim() === '') return workspaceCandidates;
    return workspaceCandidates.filter(
      (item) => matches(getWorkspaceDirName(item), query) || matches(item, query)
    );
  }, [query, workspaceCandidates]);

  const subtaskLines = useMemo(
    () =>
      groupLines
        .split('\n')
        .map((line) => line.replace(/^[-*•\d.、]+\s*/u, '').trim())
        .filter(Boolean),
    [groupLines]
  );

  const canSubmit = Boolean(workflowId) && !submitting && (mode === 'group' ? true : title.trim() !== '');

  const createTask = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    if (import.meta.env?.DEV) {
      console.log('[TaskActionPanel] 创建任务:', {
        mode,
        title,
        workflowId,
        subtasks: mode === 'group' ? subtaskLines.length : 0,
        autoRun,
        workspace: workspaceDir,
      });
    }
    try {
      const description = (draft || '').trim();
      const taskWorkspace = workspaceDir || undefined;
      const task =
        mode === 'group'
          ? await api.createTask({
              title: title.trim() || `任务组 ${new Date().toLocaleString('zh-CN')}`,
              workflowId,
              description,
              workspace: taskWorkspace,
              kind: 'group',
              executionMode: 'serial',
              subtasks: subtaskLines.map((line) => ({ title: line })),
              kanbanColumn: 'backlog',
              autoRun,
              triggerSource: 'kanban',
            })
          : await api.createTask({
              title: title.trim(),
              workflowId,
              description,
              workspace: taskWorkspace,
              kind: 'single',
              kanbanColumn: autoRun ? 'agent_executing' : 'backlog',
              autoRun,
              triggerSource: 'kanban',
            });
      toast.success(`${mode === 'group' ? '已创建任务组' : '已创建任务'}「${task.title}」`);
      onOutcome?.({ action: 'created', taskId: task.id, title: task.title });
      onClose();
    } catch (error: any) {
      if (import.meta.env?.DEV) console.warn('[TaskActionPanel] 创建任务失败:', error);
      toast.error(error?.message || '创建任务失败');
    } finally {
      setSubmitting(false);
    }
  }, [
    autoRun,
    canSubmit,
    draft,
    mode,
    onClose,
    onOutcome,
    subtaskLines,
    title,
    workflowId,
    workspaceDir,
  ]);

  /** 选定项目目录：记住到本地，与看板的新建任务弹窗共用同一份记忆 */
  const chooseWorkspace = useCallback((path: string) => {
    setWorkspaceDir(path);
    rememberWorkspace(path);
    setRecentWorkspaces(readRecentWorkspaces());
    setPickingWorkspace(false);
    setQuery('');
    if (import.meta.env?.DEV) console.log('[TaskActionPanel] 选定项目目录:', path);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, []);

  /** 浏览目录：桌面端走系统面板，浏览器调试走应用内目录面板 */
  const pickingDirRef = useRef(false);
  const browseWorkspace = useCallback(async () => {
    if (pickingDirRef.current) return;
    pickingDirRef.current = true;
    try {
      const chosen = await pick(workspaceDir || undefined);
      if (chosen) chooseWorkspace(chosen);
    } finally {
      pickingDirRef.current = false;
    }
  }, [chooseWorkspace, pick, workspaceDir]);

  const runPipeline = useCallback(
    async (task: TaskOption, nextWorkflowId: string) => {
      if (submitting) return;
      setSubmitting(true);
      if (import.meta.env?.DEV) {
        console.log('[TaskActionPanel] 为任务执行流水线:', { taskId: task.id, workflowId: nextWorkflowId });
      }
      try {
        // 先把流水线挂到任务上，再启动：任务详情里的编排与实际执行保持一致
        if (task.workflowId !== nextWorkflowId) await api.updateTask(task.id, { workflowId: nextWorkflowId });
        await api.runTask(task.id);
        const name = workflows.find((item) => item.id === nextWorkflowId)?.name ?? nextWorkflowId;
        toast.success(`已为「${task.title}」执行流水线「${name}」`);
        onOutcome?.({ action: 'ran', taskId: task.id, title: task.title });
        onClose();
      } catch (error: any) {
        if (import.meta.env?.DEV) console.warn('[TaskActionPanel] 执行流水线失败:', error);
        toast.error(error?.message || '执行流水线失败');
      } finally {
        setSubmitting(false);
      }
    },
    [onClose, onOutcome, submitting, workflows]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (pickingWorkspace) {
          setPickingWorkspace(false);
          setQuery('');
          return;
        }
        if (pickingWorkflow) {
          setPickingWorkflow(false);
          setQuery('');
          return;
        }
        if (pickedTask) {
          setPickedTask(null);
          setQuery('');
          return;
        }
        onClose();
      }
    },
    [onClose, pickedTask, pickingWorkflow, pickingWorkspace]
  );

  const rootRef = useRef<HTMLDivElement>(null);
  /** 点面板外收起：输入卡自己的菜单状态不受影响 */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // 目录选择弹层挂在 body 下，算面板自身的一部分，不算「点外面」
      if (pickingDirRef.current) return;
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  const header = (label: string, onBack?: () => void) => (
    <div className={styles.header}>
      {onBack ? (
        <button type="button" className={styles.back} onClick={onBack} title="返回">
          <ChevronLeft size={13} />
        </button>
      ) : (
        <span className={styles.headerIcon}>
          <Workflow size={13} />
        </span>
      )}
      <span className={styles.headerTitle}>{label}</span>
      {loading && <Loader2 size={12} className={styles.spin} />}
      <button type="button" className={styles.close} onClick={onClose} title="关闭" aria-label="关闭">
        <IconClose size={12} />
      </button>
    </div>
  );

  const searchRow = (placeholder: string, onConfirm: () => void) => (
    <div className={styles.search}>
      <Search size={13} className={styles.searchIcon} />
      <input
        ref={queryRef}
        className={styles.searchInput}
        value={query}
        placeholder={placeholder}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => handleConfirm(event, onConfirm)}
      />
    </div>
  );

  /** 流水线候选列表：新建与执行两种形态共用 */
  const workflowRows = (onPick: (id: string) => void) => (
    <div className={styles.list} role="listbox">
      {filteredWorkflows.map((item) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={item.id === workflowId}
          className={styles.row}
          onClick={() => onPick(item.id)}
        >
          <span className={styles.rowIcon}>
            <Workflow size={13} />
          </span>
          <span className={styles.rowTitle}>{item.name}</span>
          <span className={styles.rowMeta}>{item.nodeCount} 节点</span>
          {item.id === workflowId && (
            <span className={styles.rowCheck}>
              <Check size={13} />
            </span>
          )}
        </button>
      ))}
      {filteredWorkflows.length === 0 && !loading && <div className={styles.empty}>没有匹配的流水线</div>}
    </div>
  );

  /** 三种形态共用一块面板：标题、返回与正文按状态计算 */
  const headerLabel = pickingWorkspace
    ? '选择项目目录'
    : mode === 'pipeline' && pickedTask
      ? `为「${pickedTask.title}」选择流水线`
      : MODE_TITLE[mode];
  const back = pickingWorkspace
    ? () => {
        setPickingWorkspace(false);
        setQuery('');
      }
    : mode === 'pipeline' && pickedTask
      ? () => {
          setPickedTask(null);
          setQuery('');
        }
      : undefined;
  const workspaceName = workspaceDir ? getWorkspaceDirName(workspaceDir) : '';
  return (
    <div
      ref={rootRef}
      className={styles.panel}
      role="dialog"
      aria-label={headerLabel}
      data-agent-transient
      onKeyDown={handleKeyDown}
    >
      {header(headerLabel, back)}

      {mode === 'pipeline' && !pickedTask && (
        <>
          {searchRow('搜索任务', () => {
            const first = filteredTasks[0];
            if (first) setPickedTask(first);
          })}
          <div className={styles.list} role="listbox">
            {filteredTasks.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={false}
                className={styles.row}
                onClick={() => {
                  setPickedTask(item);
                  setQuery('');
                  if (import.meta.env?.DEV) console.log('[TaskActionPanel] 选中任务:', item.id);
                }}
              >
                <span className={styles.rowIcon}>
                  {item.isGroup ? <Layers size={13} /> : <ListTodo size={13} />}
                </span>
                <span className={styles.rowTitle}>{item.title}</span>
                <span className={`${styles.rowMeta} ${item.status === 'running' ? styles.rowRunning : ''}`}>
                  {TASK_STATUS_LABEL[item.status] || item.status}
                </span>
              </button>
            ))}
            {filteredTasks.length === 0 && !loading && <div className={styles.empty}>没有匹配的任务</div>}
          </div>
        </>
      )}

      {mode === 'pipeline' && pickedTask && (
        <>
          {searchRow('搜索流水线', () => {
            const first = filteredWorkflows[0];
            if (first) void runPipeline(pickedTask, first.id);
          })}
          {workflowRows((id) => void runPipeline(pickedTask, id))}
        </>
      )}

      {mode !== 'pipeline' && pickingWorkflow && (
        <>
          {searchRow('搜索流水线', () => {
            const first = filteredWorkflows[0];
            if (!first) return;
            setWorkflowId(first.id);
            setPickingWorkflow(false);
          })}
          {workflowRows((id) => {
            setWorkflowId(id);
            setPickingWorkflow(false);
            setQuery('');
            requestAnimationFrame(() => titleRef.current?.focus());
          })}
        </>
      )}

      {mode !== 'pipeline' && pickingWorkspace && (
        <>
          {searchRow('搜索项目目录', () => {
            const first = filteredWorkspaces[0];
            if (first) chooseWorkspace(first);
          })}
          <div className={styles.list} role="listbox">
            {filteredWorkspaces.map((item) => (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={item === workspaceDir}
                className={styles.row}
                title={item}
                onClick={() => chooseWorkspace(item)}
              >
                <span className={styles.rowIcon}>
                  <FolderGit2 size={13} />
                </span>
                <span className={styles.rowTitle}>{getWorkspaceDirName(item)}</span>
                <span className={styles.rowPath}>{formatCompactPath(item)}</span>
                {item === workspaceDir && (
                  <span className={styles.rowCheck}>
                    <Check size={13} />
                  </span>
                )}
              </button>
            ))}
            {filteredWorkspaces.length === 0 && (
              <div className={styles.empty}>
                {query.trim() ? '没有匹配的项目目录' : '还没有选过项目目录'}
              </div>
            )}
            <button
              type="button"
              className={`${styles.row} ${styles.rowAction}`}
              onClick={() => void browseWorkspace()}
            >
              <span className={styles.rowIcon}>
                <FolderOpen size={13} />
              </span>
              <span className={styles.rowTitle}>浏览并选择目录…</span>
            </button>
          </div>
        </>
      )}

      {mode !== 'pipeline' && !pickingWorkflow && !pickingWorkspace && (
        <>
          {mode === 'group' ? (
            <>
              <input
                ref={titleRef}
                className={styles.titleInput}
                value={title}
                placeholder="任务组名称（可留空自动命名）"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => handleConfirm(event, () => void createTask())}
              />
              <textarea
                className={styles.linesInput}
                value={groupLines}
                rows={5}
                placeholder={'子工序，一行一个，按顺序串行执行\n例如：\n梳理数据结构\n实现接口\n补齐回归用例'}
                onChange={(event) => setGroupLines(event.target.value)}
                onKeyDown={(event) => handleConfirm(event, () => void createTask())}
              />
            </>
          ) : (
            <input
              ref={titleRef}
              className={styles.titleInput}
              value={title}
              placeholder={`任务标题，${confirmKeys} 创建`}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => handleConfirm(event, () => void createTask())}
            />
          )}

          <button type="button" className={styles.pickRow} onClick={() => setPickingWorkflow(true)}>
            <span className={styles.rowIcon}>
              <Workflow size={13} />
            </span>
            <span className={styles.rowTitle}>{workflowName}</span>
            <span className={styles.rowMeta}>流水线</span>
          </button>

          <button
            type="button"
            className={styles.pickRow}
            title={workspaceDir || undefined}
            onClick={() => {
              setQuery('');
              setPickingWorkspace(true);
            }}
          >
            <span className={styles.rowIcon}>
              {workspaceDir ? <FolderGit2 size={13} /> : <FolderOpen size={13} />}
            </span>
            <span
              className={workspaceDir ? styles.rowTitle : styles.rowPlaceholder}
            >
              {workspaceName || '选择项目目录'}
            </span>
            <span className={styles.rowMeta}>
              {workspaceDir ? formatCompactPath(workspaceDir) : '任务将在这里执行'}
            </span>
          </button>

          <div className={styles.footer}>
            <button
              type="button"
              className={`${styles.toggle} ${autoRun ? styles.toggleOn : ''}`}
              onClick={() => setAutoRun((prev) => !prev)}
              title="创建后立即启动流水线"
            >
              <span className={styles.toggleDot} />
              创建后立即执行
            </button>
            {mode === 'group' && <span className={styles.hint}>{subtaskLines.length} 个子工序</span>}
            {mode !== 'group' && draft && draft.trim() !== '' && (
              <span className={styles.hint}>说明取自输入卡草稿</span>
            )}
            <button
              type="button"
              className={styles.submit}
              disabled={!canSubmit}
              onClick={() => void createTask()}
            >
              {submitting ? <Loader2 size={13} className={styles.spin} /> : <Play size={13} />}
              创建
            </button>
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
