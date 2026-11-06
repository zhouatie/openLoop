/**
 * 输入卡上方的任务面板：新建任务 / 新建任务组 / 为已有任务执行流水线。
 *
 * 面板自己取任务与流水线数据（短缓存），挂载方只给工作区与草稿，
 * 因此会话页、全局面板和抽屉三种形态共用同一份实现。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import type { TaskAttachment } from '@openloop/core/types';
import { api } from '../services/api';
import { useShortcuts } from '../context/ShortcutContext';
import { toast } from '../components/Toast';
import { ImageLightboxModal } from '../components/ImageLightboxModal';
import { useDirectoryPicker } from '../components/useDirectoryPicker';
import { formatCompactPath, getWorkspaceDirName } from '../components/workspace-path';
import {
  STORAGE_KEY_LAST_WORKSPACE,
  STORAGE_KEY_RECENT_WORKSPACES,
} from '../components/WorkspacePicker';
import { loadTaskOptions, invalidateTaskOptions, TASK_STATUS_LABEL, type TaskOption } from './task-options';
import { readLastWorkflowId, rememberWorkflowId } from '../utils/workflowMemory';
import { IconClose } from './icons';
import { useAttachments } from './useAttachments';
import { clipboardImageFiles } from './clipboard-images';
import { imageSrc } from './local-image';
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
  /** 输入卡上已上传的图片：随新任务一起提交 */
  attachments?: TaskAttachment[];
  onClose: () => void;
  onOutcome?: (outcome: TaskActionOutcome) => void;
}

interface WorkflowOption {
  id: string;
  name: string;
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

/** 默认只回填上次用过的流水线；没有记忆就停在空态，不按列表顺序硬猜 */
function pickRememberedWorkflowId(items: WorkflowOption[]): string {
  const remembered = readLastWorkflowId();
  return remembered && items.some((item) => item.id === remembered) ? remembered : '';
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
  attachments,
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
  /** 新建任务时可选归属的任务组；空串表示建独立任务 */
  const [pickingParent, setPickingParent] = useState(false);
  const [parentTaskId, setParentTaskId] = useState('');
  const [pickedTask, setPickedTask] = useState<TaskOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 面板里直接粘贴的截图：与输入卡共用同一条上传管线 */
  const pasted = useAttachments('task-action');
  const addPasted = pasted.add;
  const removePasted = pasted.remove;
  const clearPasted = pasted.clear;
  /** 一处列表：输入卡带进来的图只展示，面板里粘贴的图可移除 */
  const panelAttachments = useMemo(
    () => [
      ...(attachments ?? []).map((item) => ({
        id: `composer_${item.id}`,
        name: item.name,
        previewUrl: imageSrc(item.url),
        status: 'ready' as const,
        removable: false,
        attachment: item,
      })),
      ...pasted.items.map((item) => ({ ...item, removable: true })),
    ],
    [attachments, pasted.items]
  );
  /** 随任务提交的图片：只取已落盘的那几张 */
  const readyAttachments = useMemo(
    () =>
      panelAttachments
        .filter((item) => item.status === 'ready' && item.attachment)
        .map((item) => item.attachment as TaskAttachment),
    [panelAttachments]
  );
  /** 大图预览：点缩略图看原图，本轮的全部图可左右翻 */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewImages = useMemo(
    () =>
      panelAttachments
        .filter((item) => Boolean(item.previewUrl))
        .map((item) => ({
          id: item.id,
          name: item.name,
          url: item.previewUrl as string,
          size: item.attachment?.size,
          path: item.attachment?.path,
        })),
    [panelAttachments]
  );
  const openPreview = useCallback(
    (id: string) => {
      const index = previewImages.findIndex((image) => image.id === id);
      if (index < 0) return;
      if (import.meta.env?.DEV) {
        console.log('[TaskActionPanel:Preview] 打开大图:', { id, index, total: previewImages.length });
      }
      setPreviewIndex(index);
    },
    [previewImages]
  );

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
        const initialWorkflowId = pickRememberedWorkflowId(wfResult.value);
        if (import.meta.env?.DEV) {
          console.log('[TaskActionPanel] 流水线默认值:', initialWorkflowId || '空态待选');
        }
        setWorkflowId((prev) => prev || initialWorkflowId);
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
    if (pickingWorkspace || pickingWorkflow || pickingParent || (mode === 'pipeline' && !pickedTask)) {
      queryRef.current?.focus();
    } else {
      titleRef.current?.focus();
    }
  }, [mode, pickedTask, pickingParent, pickingWorkflow, pickingWorkspace]);

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

  /** 任务组候选：只有组根节点能接收新工序，子工序不出现在列表里 */
  const groups = useMemo(() => tasks.filter((item) => item.isGroup), [tasks]);

  const filteredGroups = useMemo(
    () => groups.filter((item) => matches(item.title, query)),
    [groups, query]
  );

  const parentName = useMemo(
    () => groups.find((item) => item.id === parentTaskId)?.title ?? '',
    [groups, parentTaskId]
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

  /** 选中任务组后新任务变为子工序，执行与否由「创建后立即执行」决定 */
  const underGroup = mode === 'task' && parentTaskId !== '';

  const canSubmit = Boolean(workflowId) && !submitting && (mode === 'group' ? true : title.trim() !== '');

  /** 粘贴截图：面板里任意位置都能贴，图片不落到输入框 */
  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (mode === 'pipeline') return;
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      if (import.meta.env?.DEV) {
        console.log('[TaskActionPanel:Paste] 剪贴板图片转附件:', files.map((file) => file.name));
      }
      addPasted(files);
    },
    [addPasted, mode]
  );

  const createTask = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    if (import.meta.env?.DEV) {
      console.log('[TaskActionPanel] 创建任务:', {
        mode,
        title,
        workflowId,
        subtasks: mode === 'group' ? subtaskLines.length : 0,
        parentTaskId: parentTaskId || undefined,
        attachmentsCount: readyAttachments.length,
        autoRun,
        workspace: workspaceDir,
      });
    }
    try {
      const description = (draft || '').trim();
      const taskWorkspace = workspaceDir || undefined;
      const files = readyAttachments.length > 0 ? readyAttachments : undefined;

      if (underGroup) {
        const created = await api.addSubTask(parentTaskId, {
          title: title.trim(),
          workflowId,
          description,
          attachments: files,
          workspace: taskWorkspace,
          autoRun,
        });
        const groupName = parentName || created.parent.title;
        toast.success(autoRun ? `已加入任务组「${groupName}」并开始执行` : `已加入任务组「${groupName}」`);
        invalidateTaskOptions();
        rememberWorkflowId(workflowId);
        clearPasted();
        onOutcome?.({ action: 'created', taskId: created.subtask.id, title: created.subtask.title });
        onClose();
        return;
      }

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
              attachments: files,
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
              attachments: files,
              kanbanColumn: autoRun ? 'agent_executing' : 'backlog',
              autoRun,
              triggerSource: 'kanban',
            });
      toast.success(`${mode === 'group' ? '已创建任务组' : '已创建任务'}「${task.title}」`);
      invalidateTaskOptions();
      rememberWorkflowId(workflowId);
      clearPasted();
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
    clearPasted,
    draft,
    mode,
    onClose,
    onOutcome,
    parentName,
    parentTaskId,
    readyAttachments,
    subtaskLines,
    title,
    underGroup,
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

  /** 选定任务组：选空串恢复为独立任务 */
  const chooseParent = useCallback((id: string) => {
    setParentTaskId(id);
    setPickingParent(false);
    setQuery('');
    if (import.meta.env?.DEV) console.log('[TaskActionPanel] 选定任务组:', id || '独立任务');
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
        if (pickingParent) {
          setPickingParent(false);
          setQuery('');
          return;
        }
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
    [onClose, pickedTask, pickingParent, pickingWorkflow, pickingWorkspace]
  );

  const rootRef = useRef<HTMLDivElement>(null);
  /** 点面板外收起：输入卡自己的菜单状态不受影响 */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // 目录选择弹层挂在 body 下，算面板自身的一部分，不算「点外面」
      if (pickingDirRef.current) return;
      // 大图预览也挂在 body 下：点它不能把面板关掉
      if (previewIndex !== null) return;
      if (rootRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose, previewIndex]);

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
    : pickingParent
      ? '选择任务组'
      : mode === 'pipeline' && pickedTask
        ? `为「${pickedTask.title}」选择流水线`
        : MODE_TITLE[mode];
  const back = pickingWorkspace
    ? () => {
        setPickingWorkspace(false);
        setQuery('');
      }
    : pickingParent
      ? () => {
          setPickingParent(false);
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
      onPaste={handlePaste}
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

      {mode !== 'pipeline' && pickingParent && (
        <>
          {searchRow('搜索任务组', () => {
            const first = filteredGroups[0];
            if (first) chooseParent(first.id);
          })}
          <div className={styles.list} role="listbox">
            <button
              type="button"
              role="option"
              aria-selected={parentTaskId === ''}
              className={styles.row}
              onClick={() => chooseParent('')}
            >
              <span className={styles.rowIcon}>
                <ListTodo size={13} />
              </span>
              <span className={styles.rowTitle}>不加入任务组</span>
              <span className={styles.rowMeta}>独立任务</span>
              {parentTaskId === '' && (
                <span className={styles.rowCheck}>
                  <Check size={13} />
                </span>
              )}
            </button>
            {filteredGroups.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={item.id === parentTaskId}
                className={styles.row}
                onClick={() => chooseParent(item.id)}
              >
                <span className={styles.rowIcon}>
                  <Layers size={13} />
                </span>
                <span className={styles.rowTitle}>{item.title}</span>
                <span className={`${styles.rowMeta} ${item.status === 'running' ? styles.rowRunning : ''}`}>
                  {TASK_STATUS_LABEL[item.status] || item.status}
                </span>
                {item.id === parentTaskId && (
                  <span className={styles.rowCheck}>
                    <Check size={13} />
                  </span>
                )}
              </button>
            ))}
            {filteredGroups.length === 0 && !loading && (
              <div className={styles.empty}>
                {groups.length === 0 ? '还没有任务组，先在 ➕ 面板新建任务组' : '没有匹配的任务组'}
              </div>
            )}
          </div>
        </>
      )}

      {mode !== 'pipeline' && !pickingWorkflow && !pickingWorkspace && !pickingParent && (
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

          <div className={styles.attachments}>
            {panelAttachments.map((item) => (
              <div key={item.id} className={styles.attachment} title={item.name}>
                {item.previewUrl ? (
                  <button
                    type="button"
                    className={styles.attachmentThumb}
                    onClick={() => openPreview(item.id)}
                    title="查看大图"
                    aria-label={`预览 ${item.name}`}
                  >
                    <img className={styles.attachmentImage} src={item.previewUrl} alt={item.name} />
                  </button>
                ) : (
                  <span className={styles.attachmentIcon}>▤</span>
                )}
                {item.status === 'uploading' && (
                  <span className={styles.attachmentBusy}>
                    <Loader2 size={11} className={styles.spin} />
                  </span>
                )}
                {item.removable && (
                  <button
                    type="button"
                    className={styles.attachmentRemove}
                    onClick={() => removePasted(item.id)}
                    title="移除"
                    aria-label={`移除 ${item.name}`}
                  >
                    <IconClose size={8} />
                  </button>
                )}
              </div>
            ))}
            {panelAttachments.length === 0 && (
              <span className={styles.attachHint}>可粘贴截图，随任务一起提交</span>
            )}
          </div>

          <button type="button" className={styles.pickRow} onClick={() => setPickingWorkflow(true)}>
            <span className={styles.rowIcon}>
              <Workflow size={13} />
            </span>
            <span className={workflowId ? styles.rowTitle : styles.rowPlaceholder}>{workflowName}</span>
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

          {mode === 'task' && (
            <button
              type="button"
              className={styles.pickRow}
              title={parentName || undefined}
              onClick={() => {
                setQuery('');
                setPickingParent(true);
              }}
            >
              <span className={styles.rowIcon}>
                <Layers size={13} />
              </span>
              <span className={parentTaskId ? styles.rowTitle : styles.rowPlaceholder}>
                {parentName || '不加入任务组'}
              </span>
              <span className={styles.rowMeta}>{parentTaskId ? '任务组' : '独立任务'}</span>
            </button>
          )}

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
            {underGroup && <span className={styles.hint}>作为工序加入「{parentName}」</span>}
            {mode !== 'group' && !underGroup && draft && draft.trim() !== '' && (
              <span className={styles.hint}>说明取自输入卡草稿</span>
            )}
            <button
              type="button"
              className={styles.submit}
              disabled={!canSubmit}
              onClick={() => void createTask()}
            >
              {submitting ? <Loader2 size={13} className={styles.spin} /> : <Play size={13} />}
              {underGroup ? '加入' : '创建'}
            </button>
          </div>
        </>
      )}
      {dialog}

      {/* 面板自身是半透明表面，灯箱必须挂到 body 才能盖住整屏 */}
      {previewIndex !== null &&
        createPortal(
          <ImageLightboxModal
            isOpen
            images={previewImages}
            initialIndex={previewIndex}
            onClose={() => setPreviewIndex(null)}
          />,
          document.body
        )}
    </div>
  );
}
