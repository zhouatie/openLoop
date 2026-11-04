/* 会话头部后台服务列表：取自 deepseek-harness packages/client/ui-jobs 的头部触发器与弹出列表（MIT），
   数据换成 openLoop 的 TaskProcessManager 名册：REST 取一次，process:changed 推流对账。
   没有后台服务时整个控件不渲染。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskBackgroundProcess } from '@openloop/core';
import { api } from '../services/api';
import { openInDefaultBrowser } from '../utils/openExternalBrowser';
import { IconChevronDown, IconGlobe, IconStop } from './icons';
import { useAnchoredPosition } from './dsh/useAnchoredPosition';
import { useDismissOnOutsidePointer } from './dsh/useDismissOnOutsidePointer';
import css from './BackgroundProcessesAction.module.css';

/** 触发按钮与弹层的间距 */
const MENU_GAP = 6;
/** 弹层与视口边缘的最小留白 */
const VIEWPORT_MARGIN = 12;
/** 停止按钮武装后等待确认的时长 */
const STOP_ARM_MS = 3_000;

/** 已知进程来源的中文名；未登记的来源直接用原始名称 */
const PROCESS_LABELS: Record<string, string> = {
  'sandbox-core-server': '沙箱核心服务',
  'sandbox-dev-server': '靶机服务',
  'ephemeral-service': '编排服务',
};

function processLabel(name: string): string {
  return PROCESS_LABELS[name] || name;
}

/** 已运行时长：最多两级单位，够看即可 */
function elapsedLabel(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

export interface BackgroundProcessesActionProps {
  /** 任务 ID：后台进程按任务登记 */
  taskId: string;
}

/**
 * 顶栏的后台服务计数：点开列出每个服务的来源、端口与已运行时长，可打开靶机地址或单独终止。
 * @param props 任务 ID
 */
export function BackgroundProcessesAction({ taskId }: BackgroundProcessesActionProps) {
  const [rows, setRows] = useState<TaskBackgroundProcess[]>([]);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [host, setHost] = useState<HTMLElement | null>(null);
  /** 已武装等待确认的进程 ID；3 秒后自动收回 */
  const [armedId, setArmedId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const res = await api.getTaskProcesses(taskId);
      setRows(res.processes || []);
    } catch {
      setRows([]);
    }
  }, [taskId]);

  // 名册：挂载取一次，之后只跟本任务的推流事件走
  useEffect(() => {
    let active = true;
    void reload();
    const offProcess = api.on('process:changed', (data: { taskId: string; processes: TaskBackgroundProcess[] }) => {
      if (!active || data?.taskId !== taskId) return;
      setRows(data.processes || []);
    });
    const offConnection = api.on('connection:change', (connected: boolean) => {
      if (active && connected) void reload();
    });
    return () => {
      active = false;
      offProcess();
      offConnection();
    };
  }, [taskId, reload]);

  // 弹层挂在 agent-scope 根节点下，主题令牌与深色模式一起继承；
  // 名册为空时组件不渲染，所以只在打开那一刻按触发器现查宿主。
  const resolveHost = (): HTMLElement => rootRef.current?.closest<HTMLElement>('.agent-scope') || document.body;

  const position = useAnchoredPosition({
    open,
    anchorRef: rootRef,
    panelRef: menuRef,
    align: 'end',
    gap: MENU_GAP,
    margin: VIEWPORT_MARGIN,
  });
  useDismissOnOutsidePointer(rootRef, open, setOpen, menuRef);

  // 时长读数只在弹层打开且有进程时走表
  useEffect(() => {
    if (!open || rows.length === 0) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open, rows.length]);

  // 武装状态超时收回
  useEffect(() => {
    if (armedId === null) return;
    const timer = window.setTimeout(() => setArmedId(null), STOP_ARM_MS);
    return () => window.clearTimeout(timer);
  }, [armedId]);

  // 名册变短时，武装的行可能已经不在了
  useEffect(() => {
    if (armedId !== null && !rows.some((row) => row.id === armedId)) setArmedId(null);
  }, [rows, armedId]);

  const stopProcess = async (row: TaskBackgroundProcess) => {
    if (armedId !== row.id) {
      setArmedId(row.id);
      return;
    }
    setArmedId(null);
    // 先本地移除再对账：推流会再送一次权威名册
    setRows((current) => current.filter((item) => item.id !== row.id));
    try {
      await api.stopTaskProcess(taskId, row.id);
    } catch {
      void reload();
    }
  };

  if (rows.length === 0) return null;

  const countLabel = `${rows.length} 个后台服务`;

  return (
    <div ref={rootRef} className={css.root}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={countLabel}
        title={countLabel}
        onClick={() => {
          setNow(Date.now());
          setHost(resolveHost());
          setOpen((current) => !current);
        }}
      >
        <span className={css.dot} aria-hidden />
        <span className={css.count}>{countLabel}</span>
        <IconChevronDown size={12} className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open && host
        ? createPortal(
          <div
            ref={menuRef}
            className={css.menu}
            style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
            role="dialog"
            aria-label="后台服务"
          >
            <ul className={css.list}>
              {rows.map((row) => (
                <li key={row.id} className={css.item}>
                  <span className={css.rowDot} aria-hidden />
                  <span className={css.name} title={row.name}>{processLabel(row.name)}</span>
                  {row.port !== undefined ? <span className={css.port}>:{row.port}</span> : null}
                  <span className={css.duration}>{elapsedLabel(row.startedAt, now)}</span>
                  {row.url ? (
                    <button
                      type="button"
                      className={css.iconButton}
                      title="在浏览器打开"
                      aria-label={`在浏览器打开 ${processLabel(row.name)}`}
                      onClick={() => {
                        if (import.meta.env.DEV) console.log(`[UI:Processes] 打开服务 ${row.url}`);
                        void openInDefaultBrowser(row.url!);
                      }}
                    >
                      <IconGlobe size={13} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={armedId === row.id ? `${css.stopButton} ${css.stopArmed}` : css.stopButton}
                    title={armedId === row.id ? '再次点击确认停止' : `停止 ${processLabel(row.name)}`}
                    aria-label={armedId === row.id ? '再次点击确认停止' : `停止 ${processLabel(row.name)}`}
                    onClick={() => void stopProcess(row)}
                  >
                    <IconStop size={10} />
                    {armedId === row.id ? <span className={css.stopLabel}>确认停止</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          host,
        )
        : null}
    </div>
  );
}
