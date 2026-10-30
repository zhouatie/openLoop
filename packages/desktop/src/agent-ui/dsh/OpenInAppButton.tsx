/* 取自 deepseek-harness packages/client/ui-open-in-app/src/client/OpenTargetButton.tsx（MIT）：
   只保留「用外部应用打开工作区目录」这条链路，图标改用核心服务探测出的应用图标，
   菜单换成面板内的绝对定位浮层。 */
/** 目录打开按钮：一次默认动作 + 应用菜单 + 失败提示，右上角常驻 */
import { useEffect, useRef, useState } from 'react';
import type { OpenInAppTarget } from '@openloop/core/types';
import { ArrowUpRight } from 'lucide-react';
import { api } from '../../services/api';
import { toast } from '../../components/Toast';
import { IconChevronDown } from '../icons';
import { Tooltip } from './Tooltip';
import { useDismissOnOutsidePointer } from './useDismissOnOutsidePointer';
import css from './OpenInAppButton.module.css';

/** 上次选择的应用：跨会话、跨重启都沿用，与 DSH 的选择记忆一致 */
const CHOICE_KEY = 'openloop.agent.openInApp';

/** 应用表一次会话内只取一次：探测与图标提取都在核心服务侧完成 */
let cachedTargets: OpenInAppTarget[] | null = null;
let targetsRequest: Promise<OpenInAppTarget[]> | null = null;

function loadTargets(): Promise<OpenInAppTarget[]> {
  targetsRequest ??= api.getOpenInAppTargets().then((targets) => {
    cachedTargets = targets;
    return targets;
  });
  return targetsRequest;
}

/** 应用图标；取不到图标时回退到通用箭头，避免空格子 */
function AppIcon({ source }: { source: string | null }) {
  const [failed, setFailed] = useState(false);
  if (source === null || failed) return <ArrowUpRight size={12} strokeWidth={1.6} />;
  return (
    <img
      src={source}
      width={14}
      height={14}
      className={css.appIcon}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export interface OpenInAppButtonProps {
  /** 工作区目录：为空时不出现（没有可打开的位置） */
  path: string;
}

/**
 * 用外部应用打开当前工作区：主按钮走默认应用，右侧箭头换取打开方式。
 * 应用表由核心服务探测本机安装，探测不到应用时整个按钮不渲染。
 */
export function OpenInAppButton({ path }: OpenInAppButtonProps) {
  const [targets, setTargets] = useState<OpenInAppTarget[]>(cachedTargets ?? []);
  const [choice, setChoice] = useState(() => localStorage.getItem(CHOICE_KEY) ?? '');
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsidePointer(rootRef, menuOpen, setMenuOpen);

  useEffect(() => {
    let alive = true;
    void loadTargets().then((list) => {
      if (alive) setTargets(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  /** 默认应用：上次选择还在就沿用，否则用应用表第一项 */
  const current = targets.find((item) => item.id === choice) ?? targets[0];
  if (!path || current === undefined) return null;

  const open = (id: string) => {
    if (pending) return;
    setMenuOpen(false);
    setPending(true);
    if (import.meta.env?.DEV) console.log('[OpenInApp] 用外部应用打开工作区:', { app: id, path });
    void api.openInApp(id, path).then((ok) => {
      setPending(false);
      if (!ok) {
        toast.error('打开失败，请重试');
        return;
      }
      setChoice(id);
      localStorage.setItem(CHOICE_KEY, id);
    });
  };

  return (
    <div ref={rootRef} className={css.split}>
      <Tooltip portal label={`用 ${current.name} 打开`} side="bottom" delayMs={400}>
        <button
          type="button"
          className={css.main}
          disabled={pending}
          aria-label={`用 ${current.name} 打开工作区`}
          onClick={() => open(current.id)}
        >
          <AppIcon source={current.icon} />
        </button>
      </Tooltip>
      <button
        type="button"
        className={css.chevron}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="更多打开方式"
        title="更多打开方式"
        onClick={() => setMenuOpen((value) => !value)}
      >
        <IconChevronDown size={10} />
      </button>
      {menuOpen && (
        <div className={css.menu} role="menu">
          {targets.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={css.menuItem}
              onClick={() => open(item.id)}
            >
              <AppIcon source={item.icon} />
              <span className={css.menuLabel}>
                {item.id === current.id ? `${item.name}（默认）` : item.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
