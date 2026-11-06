/**
 * 会话任务条：全局智能体里当前会话属于某个看板任务时，把任务与流水线搬到顶栏。
 * 收起是一行状态与进度，展开可看每一步的进展，并能运行、暂停或回到任务详情。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ChevronDown, Loader2, Pause, Play } from 'lucide-react';
import type { NodeStatus, Task, WorkflowDefinition } from '@openloop/core';
import { api } from '../services/api';
import { toast } from '../components/Toast';
import { TASK_STATUS_LABEL } from './task-options';
import { resolveNodeMeta } from '../utils/nodeMeta';
import { useAnchoredPosition } from './dsh/useAnchoredPosition';
import { useDismissOnOutsidePointer } from './dsh/useDismissOnOutsidePointer';
import css from './TaskPipelineChip.module.css';

export interface TaskPipelineChipProps {
  /** 会话所属的任务 */
  taskId: string;
  /** 打开任务详情：由挂载方决定跳转方式（看板详情 / 任务页） */
  onOpenTask?: (taskId: string) => void;
}

const NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  pending: '等待',
  running: '执行中',
  waiting_approval: '待确认',
  success: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const MENU_GAP = 6;
const VIEWPORT_MARGIN = 12;
/** 流水线定义短缓存：连续切换任务会话不重复打接口 */
const WORKFLOW_CACHE_TTL_MS = 20_000;

let workflowCache: { at: number; items: WorkflowDefinition[] } | null = null;

async function loadWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
  if (workflowCache && Date.now() - workflowCache.at < WORKFLOW_CACHE_TTL_MS) return workflowCache.items;
  const items = await api.getWorkflows();
  workflowCache = { at: Date.now(), items };
  return items;
}

interface PipelineNode {
  id: string;
  name: string;
  status: NodeStatus;
  error?: string;
}

/** 步骤按执行记录还原，顺序取开始时间 */
function buildNodes(task: Task | null): PipelineNode[] {
  const runs = Object.values(task?.nodeRuns || {});
  return runs
    .slice()
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
    .map((run) => ({
      id: run.nodeId,
      name: resolveNodeMeta(run.nodeId, run).name,
      status: run.status,
      error: run.error,
    }));
}

export function TaskPipelineChip({ taskId, onOpenTask }: TaskPipelineChipProps) {
  const [task, setTask] = useState<Task | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [open, setOpen] = useState(false);
  /** 正在提交的动作标记：动作进行中禁止重复点击 */
  const [busy, setBusy] = useState<string | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 任务快照：挂载取一次，之后只跟本任务的推流事件走
  useEffect(() => {
    let alive = true;
    setTask(null);
    setOpen(false);
    const load = () => {
      api
        .getTask(taskId)
        .then((next) => {
          if (alive) setTask(next || null);
        })
        .catch((err) => {
          if (import.meta.env?.DEV) console.warn('[TaskPipelineChip] 读取任务失败:', taskId, err);
          if (alive) setTask(null);
        });
    };
    void load();
    const offTask = api.on('task:update', (updated: Task) => {
      if (alive && updated?.id === taskId) setTask(updated);
    });
    const offConnection = api.on('connection:change', (connected: boolean) => {
      if (alive && connected) load();
    });
    return () => {
      alive = false;
      offTask();
      offConnection();
    };
  }, [taskId]);

  // 流水线定义：只用来取流水线名称
  useEffect(() => {
    const workflowId = task?.workflowId;
    if (!workflowId) {
      setWorkflow(null);
      return;
    }
    let alive = true;
    loadWorkflowDefinitions()
      .then((items) => {
        if (alive) setWorkflow(items.find((item) => item.id === workflowId) || null);
      })
      .catch(() => {
        if (alive) setWorkflow(null);
      });
    return () => {
      alive = false;
    };
  }, [task?.workflowId]);

  const nodes = useMemo(() => buildNodes(task), [task]);
  const doneCount = nodes.filter((node) => node.status === 'success' || node.status === 'skipped').length;
  const activeNode = nodes.find((node) => node.status === 'running') || nodes.find((node) => node.status === 'waiting_approval');

  // 弹层挂在 agent-scope 根节点下，主题令牌与深色模式一起继承
  const position = useAnchoredPosition({
    open,
    anchorRef: rootRef,
    panelRef: menuRef,
    align: 'end',
    gap: MENU_GAP,
    margin: VIEWPORT_MARGIN,
  });
  useDismissOnOutsidePointer(rootRef, open, setOpen, menuRef);

  const act = useCallback(
    async (key: string, action: () => Promise<Task | void>) => {
      if (import.meta.env?.DEV) console.log('[TaskPipelineChip] 流水线动作:', { taskId, action: key });
      setBusy(key);
      try {
        const next = await action();
        if (next && typeof next === 'object' && 'id' in next) setTask(next as Task);
      } catch (err) {
        if (import.meta.env?.DEV) console.warn('[TaskPipelineChip] 动作失败:', key, err);
        toast.error(`操作失败：${(err as Error)?.message || '请稍后重试'}`);
      } finally {
        setBusy(null);
      }
    },
    [taskId]
  );

  /** 顶栏主按钮：运行中可暂停，待确认即放行，其余情况启动或重新运行 */
  const primary = useMemo(() => {
    if (!task) return null;
    if (task.status === 'running') {
      return { key: 'pause', label: '暂停', icon: Pause, run: () => api.cancelTask(task.id) };
    }
    if (task.status === 'waiting_approval') {
      return { key: 'approve', label: '继续', icon: Play, run: () => api.resumeTask(task.id, true) };
    }
    return {
      key: 'run',
      label: task.status === 'pending' ? '运行' : '重新运行',
      icon: Play,
      run: async () => {
        await api.runTask(task.id);
      },
    };
  }, [task]);

  if (!task) return null;

  const PrimaryIcon = primary?.icon;
  const progress = nodes.length > 0 ? `${doneCount}/${nodes.length}` : '';

  return (
    <div
      ref={rootRef}
      className={css.root}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={`任务流水线：${task.title}`}
        title={`${TASK_STATUS_LABEL[task.status] || task.status} · ${task.title}`}
        onClick={() => {
          if (import.meta.env?.DEV) console.log('[TaskPipelineChip] 展开任务流水线:', task.id);
          setHost(rootRef.current?.closest<HTMLElement>('.agent-scope') || document.body);
          setOpen((current) => !current);
        }}
      >
        <span className={css.dot} data-status={task.status} aria-hidden />
        <span className={css.title}>{task.title}</span>
        {progress ? <span className={css.progress}>{progress}</span> : null}
        {activeNode ? <span className={css.activeNode}>· {activeNode.name}</span> : null}
        <ChevronDown size={12} className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>

      {open && host
        ? createPortal(
            <div
              ref={menuRef}
              className={css.menu}
              style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
              role="dialog"
              aria-label="任务流水线"
              data-agent-transient
            >
              <div className={css.head}>
                <span className={css.workflowName} title={workflow?.name || ''}>
                  {workflow?.name || '任务流水线'}
                </span>
                <span className={css.badge} data-status={task.status}>
                  {TASK_STATUS_LABEL[task.status] || task.status}
                </span>
              </div>

              {nodes.length > 0 ? (
                <ul className={css.nodes}>
                  {nodes.map((node, index) => (
                    <li key={node.id} className={css.node} data-status={node.status}>
                      <span className={css.nodeIndex}>{index + 1}</span>
                      <span className={css.nodeName} title={node.error || node.name}>
                        {node.name}
                      </span>
                      <span className={css.nodeTail}>
                        <span className={css.nodeStatus}>{NODE_STATUS_LABEL[node.status]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={css.empty}>该任务还没有执行步骤，可直接运行。</p>
              )}

              <div className={css.foot}>
                {primary && PrimaryIcon ? (
                  <button
                    type="button"
                    className={css.primary}
                    disabled={Boolean(busy)}
                    onClick={() => void act(primary.key, primary.run)}
                  >
                    {busy === primary.key ? <Loader2 size={12} className={css.spin} /> : <PrimaryIcon size={12} />}
                    <span>{primary.label}</span>
                  </button>
                ) : null}
                {onOpenTask ? (
                  <button
                    type="button"
                    className={css.ghost}
                    title="关闭工作台，在看板打开这条任务"
                    onClick={() => {
                      if (import.meta.env?.DEV) console.log('[TaskPipelineChip] 打开任务详情:', task.id);
                      setOpen(false);
                      onOpenTask(task.id);
                    }}
                  >
                    <ArrowUpRight size={12} />
                    <span>打开任务</span>
                  </button>
                ) : null}
              </div>
            </div>,
            host
          )
        : null}
    </div>
  );
}
