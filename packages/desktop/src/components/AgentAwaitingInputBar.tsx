import React, { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

export interface AgentAwaitingInputBarProps {
  /** 用户确认 Agent 已完成，手动放行流水线继续流转 */
  onConfirmComplete: () => Promise<void> | void;
}

/**
 * Agent 正在等待用户回复时的贴底提示条
 * 流水线停在当前节点，用户既可回答追问，也可直接确认完成放行
 */
export const AgentAwaitingInputBar: React.FC<AgentAwaitingInputBarProps> = ({
  onConfirmComplete,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (isSubmitting) return;
    if (import.meta.env?.DEV) {
      console.log('[AgentAwaitingInputBar] 用户确认节点已完成，请求放行流水线');
    }
    setIsSubmitting(true);
    try {
      await onConfirmComplete();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mb-2 flex items-center gap-2.5 pl-2.5 pr-2 py-[9px] rounded-[8px] border border-[#e2e1f8] bg-[linear-gradient(90deg,#f8f7ff_0%,#fcfcff_100%)] shadow-[0_1px_2px_rgba(79,70,229,0.05)]">
      <span className="relative flex w-1.5 h-1.5 shrink-0">
        <span className="absolute inline-flex w-1.5 h-1.5 rounded-full bg-[#6366f1]/50 animate-ping" />
        <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[#4f46e5]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-semibold text-[#312e81] leading-none">
          Agent 正在等待你的确认
        </div>
        <div className="text-[10.5px] text-[#71717a] mt-1 leading-none truncate">
          流水线已停留本节点，回答追问后自动继续；若已完成可直接放行
        </div>
      </div>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={isSubmitting}
        className="h-[24px] px-2.5 rounded-[5px] bg-white border border-[#dcdcf0] text-[#3f3f6b] hover:bg-[#1c1c21] hover:border-[#1c1c21] hover:text-white text-[10.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-default"
        title="确认当前节点已完成，流水线继续流转到下一个节点"
      >
        {isSubmitting ? (
          <Loader2 size={10.5} className="animate-spin" />
        ) : (
          <ArrowRight size={10.5} strokeWidth={2.4} />
        )}
        <span>确认完成并继续</span>
      </button>
    </div>
  );
};
