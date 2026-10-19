import { useState, useRef, useEffect, useCallback } from 'react';

export interface UseChatAutoScrollOptions {
  /** 距离底部阈值（像素），默认 60 */
  threshold?: number;
  /** 数据源或状态对象，用于计算输出变化快照 */
  dataKey?: any;
  /** 当前对话视图是否处于激活显示状态 */
  isActive?: boolean;
  /** 任务 ID 或会话 ID 变更时强制重置贴底 */
  resetKey?: any;
}

/**
 * 提取会话状态的轻量特征快照，用于精确判断是否存在新输出（包括流式 Token 增长、思考过程、工具调用等）
 */
function computeSessionSnapshot(data: any): string {
  if (!data) return '';
  if (Array.isArray(data)) {
    const len = data.length;
    const last = data[len - 1];
    return `${len}:${last?.content?.length || 0}:${last?.thinking?.length || 0}:${last?.tools?.length || 0}`;
  }
  if (typeof data === 'object') {
    const msgs = data.messages;
    if (Array.isArray(msgs)) {
      const len = msgs.length;
      const last = msgs[len - 1];
      const contentLen = typeof last?.content === 'string' ? last.content.length : 0;
      const thinkingLen = typeof last?.thinking === 'string' ? last.thinking.length : 0;
      const toolsSummary = Array.isArray(last?.tools)
        ? last.tools.map((t: any) => `${t.status}:${t.result ? 1 : 0}:${t.durationMs || 0}`).join('|')
        : '';
      const isBusy = data.isBusy || data.isThinking ? 1 : 0;
      return `${len}:${contentLen}:${thinkingLen}:${toolsSummary}:${isBusy}`;
    }
  }
  return String(data);
}

/**
 * 极简优雅的聊天实时滚动管理 Hook
 * - 当用户处于底部视口时，新输出实时流式平滑跟滚
 * - 当用户翻阅历史 / 滚动到顶部后，绝对阻止自动滚到底部，保留用户阅读视口
 * - 检测到新输出时激活 hasNewOutput 状态，联动展示「查看最新」浮动胶囊按钮
 * - 提供平滑回到底部、手动滚回恢复自动跟滚以及重置等完备生命周期
 */
export function useChatAutoScroll({
  threshold = 60,
  dataKey,
  isActive = true,
  resetKey,
}: UseChatAutoScrollOptions = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);
  const [hasNewOutput, setHasNewOutput] = useState<boolean>(false);

  const isAtBottomRef = useRef<boolean>(true);
  const prevSnapshotRef = useRef<string>('');
  const prevResetKeyRef = useRef<any>(resetKey);
  const prevIsActiveRef = useRef<boolean>(false);

  // 区分用户手动交互滚轮与程序平滑滚动的防抖锁
  const isProgrammaticScrollRef = useRef<boolean>(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);

  // 平滑或直接滚动至视口底部
  const scrollToBottom = useCallback((smooth = true) => {
    if (import.meta.env.DEV) {
      console.log('[UI:ChatScroll] 触发滚向底部, smooth:', smooth);
    }

    isAtBottomRef.current = true;
    setIsAtBottom(true);
    setHasNewOutput(false);

    if (programmaticScrollTimerRef.current) {
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = null;
    }

    if (smooth) {
      isProgrammaticScrollRef.current = true;
      programmaticScrollTimerRef.current = window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 600);
    } else {
      isProgrammaticScrollRef.current = false;
    }

    const doScroll = () => {
      if (containerRef.current) {
        if (smooth) {
          containerRef.current.scrollTo({
            top: containerRef.current.scrollHeight,
            behavior: 'smooth',
          });
        } else {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      } else {
        bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
      }
    };

    doScroll();
    // 渲染下一帧二次校准，应对复杂 Markdown/卡片动态尺寸渲染
    requestAnimationFrame(doScroll);
  }, []);

  // 监听容器滚动，精确区分「底部跟随」与「阅读历史」状态
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom <= threshold;

    if (atBottom) {
      isProgrammaticScrollRef.current = false;
      if (!isAtBottomRef.current) {
        if (import.meta.env.DEV) {
          console.log('[UI:ChatScroll] 用户滚回底部视口，恢复自动跟随输出');
        }
        isAtBottomRef.current = true;
        setIsAtBottom(true);
        setHasNewOutput(false);
      }
    } else {
      // 若处于程序平滑滚动进行中，忽略过渡帧的中间偏移计算
      if (isProgrammaticScrollRef.current) {
        return;
      }

      if (isAtBottomRef.current) {
        if (import.meta.env.DEV) {
          console.log('[UI:ChatScroll] 用户离开底部，距离底部:', Math.round(distanceFromBottom));
        }
        isAtBottomRef.current = false;
        setIsAtBottom(false);
      }
    }
  }, [threshold]);

  // 监听鼠标滚轮向上手势，立即解除程序滚动锁
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0 && isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
    }
  }, []);

  // 当任务 ID 切换或会话重置时，清空快照并直接就位到底部
  useEffect(() => {
    if (resetKey !== prevResetKeyRef.current) {
      if (import.meta.env.DEV) {
        console.log('[UI:ChatScroll] 会话上下文变更, resetKey:', resetKey);
      }
      prevResetKeyRef.current = resetKey;
      prevSnapshotRef.current = '';
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      setHasNewOutput(false);
      if (isActive) {
        scrollToBottom(false);
      }
    }
  }, [resetKey, isActive, scrollToBottom]);

  // 当激活状态从未激活切换至激活时，初次定位到底部
  useEffect(() => {
    if (isActive && !prevIsActiveRef.current) {
      if (import.meta.env.DEV) {
        console.log('[UI:ChatScroll] 对话窗口激活，初始化定位底部');
      }
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      setHasNewOutput(false);
      scrollToBottom(false);
    }
    prevIsActiveRef.current = !!isActive;
  }, [isActive, scrollToBottom]);

  // 数据变更与流式推送时的跟滚控制
  useEffect(() => {
    if (!isActive) return;

    const currentSnapshot = computeSessionSnapshot(dataKey);
    const isFirstLoad = prevSnapshotRef.current === '';
    const hasDataChanged = prevSnapshotRef.current !== currentSnapshot;
    prevSnapshotRef.current = currentSnapshot;

    if (!hasDataChanged) return;

    if (isFirstLoad || isAtBottomRef.current) {
      // 处于底部时实时跟进新内容
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    } else {
      // 处于顶部或阅读历史状态：绝对不打扰，锁定视口并激活最新指示器
      if (import.meta.env.DEV) {
        console.log('[UI:ChatScroll] 检测到新输出但用户在上方浏览，保持视口并激活浮动按钮');
      }
      setHasNewOutput(true);
    }
  }, [dataKey, isActive]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
    };
  }, []);

  return {
    containerRef,
    bottomRef,
    isAtBottom,
    hasNewOutput,
    handleScroll,
    handleWheel,
    scrollToBottom,
  };
}
