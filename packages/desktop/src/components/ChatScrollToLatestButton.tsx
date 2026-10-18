import React from 'react';
import { ArrowDown } from 'lucide-react';

export interface ChatScrollToLatestButtonProps {
  /** 按钮是否可见（当离开底部视口时为 true） */
  visible: boolean;
  /** 离开底部后是否有新输出到达 */
  hasNewOutput: boolean;
  /** 点击回到底部回调 */
  onClick: () => void;
  /** 自定义类名扩展 */
  className?: string;
}

/**
 * 智能体实时会话专用的悬浮「查看最新」胶囊按钮
 * 严格遵循 design-system.md 的中性质感、微边框微投影与克制动效标准
 */
export const ChatScrollToLatestButton: React.FC<ChatScrollToLatestButtonProps> = ({
  visible,
  hasNewOutput,
  onClick,
  className = '',
}) => {
  if (!visible) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (import.meta.env.DEV) {
      console.log('[UI:ChatScroll] 用户点击查看最新浮动按钮');
    }
    onClick();
  };

  return (
    <div
      className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto transition-all duration-150 animate-in fade-in slide-in-from-bottom-2 ${className}`}
    >
      <button
        type="button"
        onClick={handleClick}
        className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 hover:bg-white text-[#1c1c21] border border-[#e3e3e8] hover:border-[#c7d2fe] shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:shadow-[0_6px_20px_rgba(79,70,229,0.12)] text-[11.5px] font-medium transition-all backdrop-blur-[6px] active:scale-95 cursor-pointer select-none"
        title="回到底部查看最新输出"
      >
        <ArrowDown
          size={12}
          strokeWidth={2.4}
          className="text-[#63636b] group-hover:text-[#4f46e5] group-hover:translate-y-0.5 transition-transform"
        />
        <span>{hasNewOutput ? '查看最新' : '回到底部'}</span>
        {hasNewOutput && (
          <span className="inline-flex items-center px-1.5 py-[0.5px] rounded-full text-[9.5px] font-medium bg-[#eeedfd] text-[#7c3aed] border border-[#ddd6fe]/60 animate-pulse">
            新动态
          </span>
        )}
      </button>
    </div>
  );
};
