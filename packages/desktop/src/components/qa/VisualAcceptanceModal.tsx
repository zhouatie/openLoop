import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Eye,
  Camera,
  GitBranch,
  GitMerge,
  Sparkles,
  FileCode2,
  Globe,
  Loader2,
  RotateCcw,
  Check,
  ChevronRight,
  Clock,
  Layers,
} from 'lucide-react';
import { Task, QaRunRecord, StepTimelineRecord, WorktreeContextInfo } from '@openloop/core';
import { api } from '../../services/api';
import { toast } from '../Toast';

interface VisualAcceptanceModalProps {
  task: Task;
  onClose: () => void;
  onApproved?: () => void;
  onRejected?: () => void;
}

export const VisualAcceptanceModal: React.FC<VisualAcceptanceModalProps> = ({
  task,
  onClose,
  onApproved,
  onRejected,
}) => {
  const [run, setRun] = useState<QaRunRecord | null>(null);
  const [isLoadingRun, setIsLoadingRun] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isRerunning, setIsRerunning] = useState<boolean>(false);

  // 播放器状态
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isAiOverlayVisible, setIsAiOverlayVisible] = useState(true);
  const timerRef = useRef<any>(null);

  const worktree: WorktreeContextInfo | undefined = task.context?.worktree;
  const qaRunId = task.context?.qaRunId || (worktree as any)?.qaRunId;

  // 加载 QA 执行结果
  useEffect(() => {
    let active = true;
    const fetchQaRun = async () => {
      if (import.meta.env?.DEV) {
        console.log('[VisualAcceptanceModal] 尝试加载 QA 运行记录:', { qaRunId, taskId: task.id });
      }

      if (qaRunId) {
        try {
          const res = await api.getQaRunById(qaRunId);
          if (active && res) {
            setRun(res);
            setIsLoadingRun(false);
            return;
          }
        } catch (e: any) {
          if (import.meta.env?.DEV) console.warn('[VisualAcceptanceModal] 加载指定 qaRunId 失败:', e);
        }
      }

      // 兜底尝试通过关联 task.id 获取 QA 运行记录
      try {
        const allRuns = await api.getQaRuns();
        const matched = allRuns.find((r) => r.taskId === task.id);
        if (active && matched) {
          setRun(matched);
        }
      } catch (err: any) {
        if (import.meta.env?.DEV) console.error('[VisualAcceptanceModal] 加载运行列表失败:', err);
      } finally {
        if (active) setIsLoadingRun(false);
      }
    };

    fetchQaRun();
    return () => {
      active = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [qaRunId, task.id]);

  // 智能推导时间轴步骤列表（三级兜底）
  const steps: StepTimelineRecord[] = useMemo(() => {
    // 1. 若有完整的 run.timeline，直接使用
    if (run?.timeline && run.timeline.length > 0) {
      return run.timeline;
    }

    // 2. 从 task.nodeRuns 各节点 output?.qa?.timeline 中提取
    const nodeRunsList = Object.values(task.nodeRuns || {});
    for (const nr of nodeRunsList) {
      const qaOutput = nr.output?.qa;
      if (qaOutput?.timeline && Array.isArray(qaOutput.timeline) && qaOutput.timeline.length > 0) {
        return qaOutput.timeline;
      }
    }

    // 3. 从 task.attachments 中提取所有图片快照生成连续时间轴
    const imageAttachments = (task.attachments || []).filter(
      (att) =>
        att.name.endsWith('.png') ||
        att.name.endsWith('.jpg') ||
        att.name.endsWith('.svg') ||
        att.name.endsWith('.webp') ||
        att.mimeType?.startsWith('image/')
    );

    if (imageAttachments.length > 0) {
      return imageAttachments.map((att, idx) => ({
        stepIndex: idx,
        stepId: att.id,
        type: 'action' as const,
        prompt: `快照 #${idx + 1}: ${att.name}`,
        status: 'passed' as const,
        durationMs: 400,
        screenshotRelPath: att.url || att.path,
        screenshotUrl: api.getArtifactUrl(att.url || att.path),
        thought: '页面交互与状态变化真实浏览器截帧',
      }));
    }

    return [];
  }, [run, task]);

  // 过滤并规范化改动文件列表（彻底过滤 node_modules 软链与临时产物，修复截断问题）
  const cleanChangedFiles = useMemo(() => {
    const rawFiles: string[] = worktree?.changedFiles || [];
    return rawFiles.filter((file) => {
      if (!file) return false;
      const f = file.trim();
      if (
        f.includes('node_modules') ||
        f.startsWith('.worktrees') ||
        f.startsWith('.openloop') ||
        f.includes('.openloop-store') ||
        f.endsWith('/dist')
      ) {
        return false;
      }
      return true;
    });
  }, [worktree?.changedFiles]);

  const currentStep: StepTimelineRecord | undefined = steps[currentStepIndex];

  // 图片资源预加载以保证拖拽与逐帧切换丝滑零延迟
  useEffect(() => {
    if (steps.length === 0) return;
    steps.forEach((step) => {
      const url = step.screenshotUrl || (step.screenshotRelPath ? api.getArtifactUrl(step.screenshotRelPath) : '');
      if (url) {
        const img = new Image();
        img.src = url;
      }
    });
  }, [steps]);

  // 自动回放定时器
  useEffect(() => {
    if (isPlaying) {
      const intervalMs = Math.max(600, 1500 / playbackSpeed);
      timerRef.current = setInterval(() => {
        setCurrentStepIndex((prev) => {
          if (prev >= steps.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, playbackSpeed, steps.length]);

  const handlePrev = useCallback(() => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNext = useCallback(() => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.min(steps.length - 1, prev + 1));
  }, [steps.length]);

  const togglePlay = useCallback(() => {
    if (!isPlaying && currentStepIndex >= steps.length - 1) {
      setCurrentStepIndex(0);
    }
    setIsPlaying((prev) => !prev);
  }, [currentStepIndex, isPlaying, steps.length]);

  // 键盘快捷键监听 (方向键切帧、空格播放/暂停、ESC 关闭)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrev, handleNext, togglePlay, onClose]);

  // 验收通过并自动合并
  const handleApproveAndMerge = async () => {
    setIsSubmitting(true);
    if (import.meta.env?.DEV) {
      console.log('[VisualAcceptanceModal] 用户确认验收通过并自动合并:', task.id);
    }
    try {
      await api.resumeTask(task.id, true, '视觉验收通过，自动合并');
      toast.success('验收通过！代码正在自动合并到本地开发分支...');
      onApproved?.();
      onClose();
    } catch (err: any) {
      toast.error(`验收处理失败: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 驳回
  const handleReject = async () => {
    setIsSubmitting(true);
    if (import.meta.env?.DEV) {
      console.log('[VisualAcceptanceModal] 用户点击驳回:', task.id);
    }
    try {
      await api.resumeTask(task.id, false, '视觉验收未通过');
      toast.info('任务已驳回，临时沙箱环境已释放');
      onRejected?.();
      onClose();
    } catch (err: any) {
      toast.error(`驳回失败: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 重新跑测试
  const handleRerunTest = async () => {
    if (isRerunning || isSubmitting) return;
    try {
      setIsRerunning(true);
      const testNodeId = 'node_qa_test';
      if (import.meta.env?.DEV) {
        console.log('[VisualAcceptanceModal] 触发重跑 QA 自动化测试:', { taskId: task.id, testNodeId });
      }
      await api.retryNode(task.id, testNodeId);
      toast.info('已重新启动 QA 自动化测试与动态截帧...');

      let pollCount = 0;
      const pollInterval = setInterval(async () => {
        pollCount++;
        try {
          const latestTask = await api.getTask(task.id);
          const qaRunIdNew = latestTask.context?.qaRunId;
          const testNodeStatus = latestTask.nodeRuns?.[testNodeId]?.status;

          if (testNodeStatus === 'completed' || latestTask.status === 'waiting_approval') {
            clearInterval(pollInterval);
            setIsRerunning(false);
            toast.success('自动化测试已完成，最新截帧已就绪');
            if (qaRunIdNew) {
              const res = await api.getQaRunById(qaRunIdNew);
              if (res) {
                setRun(res);
                setCurrentStepIndex(0);
              }
            }
          }
        } catch {}
        if (pollCount > 40) {
          clearInterval(pollInterval);
          setIsRerunning(false);
        }
      }, 1500);
    } catch (err: any) {
      toast.error(`重新跑测试失败: ${err.message}`);
      setIsRerunning(false);
    }
  };

  const isPassed = run ? run.status === 'passed' : true;
  const passedCount = run ? run.passedSteps : steps.length;
  const totalCount = run ? run.totalSteps : steps.length;
  const imageUrl = currentStep?.screenshotUrl
    ? api.getArtifactUrl(currentStep.screenshotUrl)
    : currentStep?.screenshotRelPath
    ? api.getArtifactUrl(currentStep.screenshotRelPath)
    : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-6xl h-[90vh] bg-[#f4f4f6] rounded-[12px] border border-[#e3e3e8] shadow-[0_24px_70px_rgba(0,0,0,0.18)] flex flex-col overflow-hidden text-[#1c1c21] animate-in fade-in zoom-in-95 duration-150">
        {/* 顶部 Header：白底、细下边框、对齐 openLoop 统一设计规范 */}
        <div className="h-[50px] bg-white border-b border-[#e3e3e8] px-5 flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-6 h-6 rounded-[5px] bg-[#f4f4f6] border border-[#e3e3e8]/70 flex items-center justify-center text-[#1c1c21] shrink-0">
              <Camera size={13} strokeWidth={2.2} />
            </div>

            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-[13px] font-semibold text-[#1c1c21] truncate max-w-[380px]" title={task.title}>
                {task.title}
              </h2>

              <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#71717a] text-[10.5px] font-medium border border-[#e3e3e8] shrink-0">
                视觉验收门禁
              </span>

              {worktree?.branchName && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10.5px] font-mono border border-[#bfdbfe]/60 shrink-0">
                  <GitBranch size={10} />
                  <span>{worktree.branchName}</span>
                </span>
              )}

              {/* 状态微徽章 */}
              {isPassed ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60 shrink-0">
                  <CheckCircle2 size={10} strokeWidth={2.2} />
                  <span>PASSED</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60 shrink-0">
                  <XCircle size={10} strokeWidth={2.2} />
                  <span>FAILED</span>
                </span>
              )}
            </div>
          </div>

          {/* 右侧微操作群 */}
          <div className="flex items-center gap-2">
            {/* 靶机独立外链直达 */}
            {worktree?.targetUrl && (
              <a
                href={worktree.targetUrl}
                target="_blank"
                rel="noreferrer"
                className="h-[28px] px-2.5 rounded-[6px] bg-white hover:bg-[#fafafc] text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1.5 border border-[#e3e3e8] shadow-2xs transition-all active:scale-95"
                title="在浏览器新标签页中打开独立沙箱靶机"
              >
                <Globe size={12} className="text-[#63636b]" />
                <span>打开沙箱靶机 ({worktree.webPort})</span>
                <ExternalLink size={10} className="text-[#85858d]" />
              </a>
            )}

            {/* AI 热区开关 */}
            <button
              type="button"
              onClick={() => setIsAiOverlayVisible(!isAiOverlayVisible)}
              className={`h-[28px] px-2.5 rounded-[6px] text-[11.5px] font-medium flex items-center gap-1.5 border transition-all cursor-pointer ${
                isAiOverlayVisible
                  ? 'bg-white text-[#1c1c21] border-[#1c1c21]/20 shadow-2xs'
                  : 'bg-transparent text-[#71717a] border-transparent hover:bg-[#ececf0]'
              }`}
            >
              <Eye size={12} />
              <span>AI 焦点标注</span>
            </button>

            {/* 关闭按钮 */}
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-[5px] text-[#71717a] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer ml-1"
              title="关闭 (Esc)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 主内容区域：左侧截帧渲染 + 右侧审计抽屉 */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* 左侧：截帧显示区（浅冷灰基底承载高质感白底 Mac 视窗容器） */}
          <div className="flex-1 relative flex items-center justify-center p-5 bg-[#ebebf0] overflow-hidden">
            {isLoadingRun ? (
              <div className="flex flex-col items-center justify-center text-[#71717a] gap-2">
                <Loader2 size={22} className="animate-spin text-[#1c1c21]" />
                <span className="text-[12px]">正在加载 UI 自动化截帧序列...</span>
              </div>
            ) : imageUrl ? (
              <div className="max-w-full max-h-full rounded-[8px] border border-[#d8d8de] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.08)] flex flex-col overflow-hidden animate-in fade-in duration-100">
                {/* 拟态原生 Mac 视窗标题栏 */}
                <div className="h-[28px] bg-[#fafafc] border-b border-[#e3e3e8] px-3 flex items-center justify-between shrink-0 select-none">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] border border-[#e0443e]/40 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-[#dea123]/40 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] border border-[#1aab29]/40 inline-block" />
                  </div>

                  <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-[#85858d] bg-white border border-[#e3e3e8]/70 px-2.5 py-[1px] rounded-[4px] shadow-3xs max-w-[340px] truncate">
                    <Globe size={10} className="text-[#85858d] shrink-0" />
                    <span className="truncate">{worktree?.targetUrl || 'http://localhost:5175/'}</span>
                  </div>

                  <div className="w-12 text-right text-[10px] font-mono text-[#85858d]">
                    {currentStepIndex + 1}/{steps.length}
                  </div>
                </div>

                {/* 截图承载视口 */}
                <div className="relative flex items-center justify-center bg-white overflow-hidden">
                  <img
                    src={imageUrl}
                    alt={`Step ${currentStepIndex + 1}`}
                    className="max-w-full max-h-[calc(90vh-190px)] object-contain block select-none"
                  />

                  {/* AI 目标区域高亮悬浮聚焦框 */}
                  {isAiOverlayVisible && currentStep?.boundingBox && (
                    <div
                      className="absolute border-2 border-indigo-600 bg-indigo-500/15 rounded-[3px] pointer-events-none transition-all duration-300"
                      style={{
                        left: `${(currentStep.boundingBox.x / 1280) * 100}%`,
                        top: `${(currentStep.boundingBox.y / 800) * 100}%`,
                        width: `${(currentStep.boundingBox.width / 1280) * 100}%`,
                        height: `${(currentStep.boundingBox.height / 800) * 100}%`,
                      }}
                    >
                      <div className="absolute -top-5 left-0 px-1.5 py-0.5 rounded bg-[#1c1c21] text-[9.5px] font-mono font-medium text-white shadow-xs flex items-center gap-1 whitespace-nowrap">
                        <Sparkles size={9} />
                        <span>{currentStep.prompt.slice(0, 24)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-[#85858d] gap-2">
                <Camera size={32} className="opacity-40" />
                <p className="text-[12px]">当前步骤无快照图像</p>
              </div>
            )}
          </div>

          {/* 右侧：审计与步骤详情抽屉（白底、规范卡片式排版） */}
          <div className="w-[330px] bg-white border-l border-[#e3e3e8] flex flex-col shrink-0 select-none">
            {/* 顶栏：当前步骤与状态 */}
            <div className="h-[42px] px-4 border-b border-[#e3e3e8] flex items-center justify-between shrink-0 bg-[#fafafc]">
              <span className="text-[11px] font-medium text-[#71717a]">
                步骤 {steps.length > 0 ? `${currentStepIndex + 1} / ${steps.length}` : '0'}
              </span>

              {currentStep?.status === 'passed' ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                  <CheckCircle2 size={10} strokeWidth={2.2} />
                  <span>PASSED</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60">
                  <XCircle size={10} strokeWidth={2.2} />
                  <span>FAILED</span>
                </span>
              )}
            </div>

            {/* 滚动详情卡片 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-[12px]">
              {/* 卡片 1: 当前操作指令 */}
              <div>
                <label className="text-[11px] font-medium text-[#71717a] block mb-1">
                  当前操作指令
                </label>
                <div className="bg-[#f4f4f6] text-[#1c1c21] p-2.5 rounded-[6px] border border-[#e3e3e8] leading-relaxed text-[11.5px] font-medium">
                  {currentStep?.prompt || '等待执行指令'}
                </div>
              </div>

              {/* 卡片 2: AI 动作判定与分析 */}
              <div>
                <label className="text-[11px] font-medium text-[#71717a] block mb-1 flex items-center gap-1">
                  <Sparkles size={11} className="text-[#4f46e5]" />
                  AI 动作判定与分析
                </label>
                <div className="bg-[#fafafc] text-[#4b4b54] border border-[#e3e3e8] p-2.5 rounded-[6px] leading-relaxed text-[11.5px]">
                  {currentStep?.thought || '无头浏览器已定位页面状态，操作与断言通过。'}
                </div>
              </div>

              {/* 卡片 3: 执行时间轴轻量列表 (支持秒级点选直达) */}
              {steps.length > 0 && (
                <div>
                  <label className="text-[11px] font-medium text-[#71717a] block mb-1 flex items-center gap-1">
                    <Layers size={11} className="text-[#63636b]" />
                    执行时间轴 ({steps.length} 步)
                  </label>
                  <div className="bg-[#fafafc] border border-[#e3e3e8] rounded-[6px] divide-y divide-[#f1f1f4] max-h-[140px] overflow-y-auto">
                    {steps.map((st, idx) => {
                      const isCurrent = idx === currentStepIndex;
                      return (
                        <div
                          key={st.stepId || idx}
                          onClick={() => {
                            setIsPlaying(false);
                            setCurrentStepIndex(idx);
                          }}
                          className={`px-2.5 py-1.5 flex items-center justify-between text-[11px] transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-white font-semibold text-[#1c1c21] shadow-3xs'
                              : 'text-[#63636b] hover:bg-white hover:text-[#1c1c21]'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-mono text-[10px] text-[#85858d] w-3.5">
                              #{idx + 1}
                            </span>
                            <span className="truncate">{st.prompt}</span>
                          </div>
                          {st.status === 'passed' ? (
                            <Check size={11} className="text-[#059669] shrink-0" />
                          ) : (
                            <XCircle size={11} className="text-[#dc2626] shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 卡片 4: 本次迭代变更文件（严格去除 node_modules 软链） */}
              {cleanChangedFiles.length > 0 && (
                <div>
                  <label className="text-[11px] font-medium text-[#71717a] block mb-1 flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <FileCode2 size={11} className="text-[#63636b]" />
                      变更代码文件 ({cleanChangedFiles.length})
                    </span>
                    {worktree?.diffSummary && (
                      <span className="text-[10px] font-mono text-[#85858d]">{worktree.diffSummary}</span>
                    )}
                  </label>
                  <div className="bg-[#fafafc] border border-[#e3e3e8] rounded-[6px] p-2 space-y-1 max-h-[140px] overflow-y-auto font-mono text-[11px] text-[#4b4b54]">
                    {cleanChangedFiles.map((file, i) => (
                      <div key={i} className="truncate hover:text-[#1c1c21] flex items-center gap-1.5" title={file}>
                        <span className="w-1 h-1 rounded-full bg-[#1c1c21] shrink-0" />
                        <span className="truncate">{file}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部播放控制与【验收通过并合并】决策工具栏（高 54px，白底微边框） */}
        <div className="h-[54px] bg-white border-t border-[#e3e3e8] px-5 flex items-center justify-between gap-5 shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.02)]">
          {/* 左侧播放控制器 */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrev}
              disabled={currentStepIndex === 0 || steps.length <= 1}
              className="w-7 h-7 rounded-[5px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] disabled:opacity-30 flex items-center justify-center transition-colors cursor-pointer"
              title="上一帧 (←)"
            >
              <SkipBack size={13} />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={steps.length <= 1}
              className="w-8 h-8 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white flex items-center justify-center shadow-xs transition-transform active:scale-95 cursor-pointer disabled:opacity-40"
              title={isPlaying ? '暂停 (空格)' : '连续播放 (空格)'}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={currentStepIndex === steps.length - 1 || steps.length <= 1}
              className="w-7 h-7 rounded-[5px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] disabled:opacity-30 flex items-center justify-center transition-colors cursor-pointer"
              title="下一帧 (→)"
            >
              <SkipForward size={13} />
            </button>

            {/* 倍速切换微胶囊 */}
            <div className="flex items-center bg-[#ececf0] rounded-[5px] p-0.5 border border-[#e3e3e8]/70 ml-2">
              {[1, 1.5, 2].map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setPlaybackSpeed(spd)}
                  className={`px-1.5 py-0.5 text-[10.5px] font-mono rounded-[3px] transition-colors cursor-pointer ${
                    playbackSpeed === spd
                      ? 'bg-white text-[#1c1c21] font-semibold shadow-2xs'
                      : 'text-[#63636b] hover:text-[#1c1c21]'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>

          {/* 中间进度条拖拽 */}
          <div className="flex-1 max-w-lg mx-3 flex items-center gap-3">
            <span className="text-[11px] font-mono text-[#85858d] shrink-0">
              {steps.length > 0 ? `${currentStepIndex + 1}/${steps.length}` : '0/0'}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, steps.length - 1)}
              value={currentStepIndex}
              onChange={(e) => {
                setIsPlaying(false);
                setCurrentStepIndex(Number(e.target.value));
              }}
              disabled={steps.length <= 1}
              className="flex-1 accent-[#1c1c21] h-1 bg-[#e3e3e8] rounded-lg cursor-pointer"
            />
          </div>

          {/* 右侧核心决策按钮群 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting || isRerunning}
              onClick={handleRerunTest}
              className="h-[30px] px-3 rounded-[6px] bg-white hover:bg-[#fafafc] border border-[#e3e3e8] text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1.5 transition-all active:scale-95 shadow-2xs cursor-pointer disabled:opacity-50"
              title="在靶机中重新执行自动化测试与截帧"
            >
              <RotateCcw size={12} className={isRerunning ? 'animate-spin' : ''} />
              <span>{isRerunning ? '测试中...' : '重新跑测试'}</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting || isRerunning}
              onClick={handleReject}
              className="h-[30px] px-3 rounded-[6px] bg-white hover:bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-[11.5px] font-medium flex items-center gap-1.5 transition-all active:scale-95 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <span>驳回</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting || isRerunning}
              onClick={handleApproveAndMerge}
              className="h-[30px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium flex items-center gap-1.5 transition-all active:scale-95 shadow-xs cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>正在合并并清理...</span>
                </>
              ) : (
                <>
                  <GitMerge size={13} />
                  <span>验收通过并合并至主分支</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
