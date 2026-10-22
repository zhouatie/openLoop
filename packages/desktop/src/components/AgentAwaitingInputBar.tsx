import React, { useState } from 'react';
import { ArrowRight, Check, Loader2, Play } from 'lucide-react';

export interface AgentAwaitingInputBarProps {
  /** 是否已有代码改动（若已改动，提示为确认改动并继续推进，而非确认方案） */
  hasCodeChanges?: boolean;
  /** 用户确认 Agent 方案，向 Agent 发送确认指令并启动执行 */
  onConfirmPlan?: () => Promise<void> | void;
  /** 兜底操作：用户强制跳过/完成当前 Agent 节点，手动放行流水线继续流转到下一节点 */
  onConfirmComplete?: () => Promise<void> | void;
}

/**
 * Agent 正在等待用户回复或确认方案时的贴底提示条
 * 流水线停在当前节点，用户可一键确认方案让 Agent 启动执行，也可在输入框补充说明或直接放行
 */
export const AgentAwaitingInputBar: React.FC<AgentAwaitingInputBarProps> = ({
  hasCodeChanges = false,
  onConfirmPlan,
  onConfirmComplete,
}) => {
  const [isSubmittingPlan, setIsSubmittingPlan] = useState(false);
  const [isSubmittingComplete, setIsSubmittingComplete] = useState(false);

  const handleConfirmPlan = async () => {
    if (isSubmittingPlan || isSubmittingComplete || !onConfirmPlan) return;
    if (import.meta.env?.DEV) {
      console.log('[AgentAwaitingInputBar] 用户确认方案，触发 Agent 启动执行');
    }
    setIsSubmittingPlan(true);
    try {
      await onConfirmPlan();
    } finally {
      setIsSubmittingPlan(false);
    }
  };

  const handleConfirmComplete = async () => {
    if (isSubmittingPlan || isSubmittingComplete || !onConfirmComplete) return;
    if (import.meta.env?.DEV) {
      console.log('[AgentAwaitingInputBar] 用户确认完成/跳过节点，请求放行流水线');
    }
    setIsSubmittingComplete(true);
    try {
      await onConfirmComplete();
    } finally {
      setIsSubmittingComplete(false);
    }
  };

  if (hasCodeChanges) {
    return (
      <div className="mb-2 flex items-center gap-2.5 pl-2.5 pr-2 py-[8px] rounded-[8px] border border-[#d1fae5] bg-[linear-gradient(90deg,#f0fdf4_0%,#fbfdfb_100%)] shadow-[0_1px_2px_rgba(5,150,105,0.05)]">
        <span className="relative flex w-1.5 h-1.5 shrink-0">
          <span className="absolute inline-flex w-1.5 h-1.5 rounded-full bg-[#10b981]/50 animate-ping" />
          <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[#059669]" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-semibold text-[#065f46] leading-none">
            代码修改已完成，等待你的确认
          </div>
          <div className="text-[10.5px] text-[#047857]/80 mt-1 leading-none truncate">
            若改动符合预期，点击放行流水线继续流转；也可在下方输入修改意见
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onConfirmComplete && (
            <button
              type="button"
              onClick={handleConfirmComplete}
              disabled={isSubmittingPlan || isSubmittingComplete}
              className="h-[24px] px-2.5 rounded-[5px] bg-[#059669] hover:bg-[#047857] text-white text-[10.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-default"
              title="确认代码修改已完成，流水线继续流转到下一阶段"
            >
              {isSubmittingComplete ? (
                <Loader2 size={10.5} className="animate-spin" />
              ) : (
                <Check size={11} strokeWidth={2.4} />
              )}
              <span>确认改动并继续推进</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 flex items-center gap-2.5 pl-2.5 pr-2 py-[8px] rounded-[8px] border border-[#e2e1f8] bg-[linear-gradient(90deg,#f8f7ff_0%,#fcfcff_100%)] shadow-[0_1px_2px_rgba(79,70,229,0.05)]">
      <span className="relative flex w-1.5 h-1.5 shrink-0">
        <span className="absolute inline-flex w-1.5 h-1.5 rounded-full bg-[#6366f1]/50 animate-ping" />
        <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[#4f46e5]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-semibold text-[#312e81] leading-none">
          Agent 正在等待你的方案确认
        </div>
        <div className="text-[10.5px] text-[#71717a] mt-1 leading-none truncate">
          流水线已停留本节点；点击确认方案将立即开始执行，也可在下方输入修改意见
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onConfirmPlan && (
          <button
            type="button"
            onClick={handleConfirmPlan}
            disabled={isSubmittingPlan || isSubmittingComplete}
            className="h-[24px] px-2.5 rounded-[5px] bg-[#4f46e5] hover:bg-[#4338ca] text-white text-[10.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-default"
            title="确认 Agent 当前方案，向 Agent 发送确认指令并进入执行中状态"
          >
            {isSubmittingPlan ? (
              <Loader2 size={10.5} className="animate-spin" />
            ) : (
              <Play size={9.5} className="fill-current" />
            )}
            <span>确认方案并开始执行</span>
          </button>
        )}

        {onConfirmComplete && (
          <button
            type="button"
            onClick={handleConfirmComplete}
            disabled={isSubmittingPlan || isSubmittingComplete}
            className="h-[24px] px-2 rounded-[5px] bg-white border border-[#dcdcf0] text-[#71717a] hover:text-[#1c1c21] hover:bg-[#f4f4f6] text-[10px] font-medium flex items-center gap-1 transition-all active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-default"
            title="跳过当前 Agent 任务，流水线直接推进到下一节点（仅在无需 Agent 编码或已手动完成时使用）"
          >
            {isSubmittingComplete ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <ArrowRight size={10} strokeWidth={2.2} />
            )}
            <span>跳过放行</span>
          </button>
        )}
      </div>
    </div>
  );
};
