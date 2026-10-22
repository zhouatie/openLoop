import React, { useState, useEffect, useRef } from 'react';
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
  Layers,
  Sparkles,
} from 'lucide-react';
import { QaRunRecord, StepTimelineRecord } from '@openloop/core';
import { api } from '../../services/api';

interface QaReplayerModalProps {
  run: QaRunRecord;
  onClose: () => void;
}

export const QaReplayerModal: React.FC<QaReplayerModalProps> = ({ run, onClose }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isAiOverlayVisible, setIsAiOverlayVisible] = useState(true);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number }>({ width: 1280, height: 800 });
  const imgRef = useRef<HTMLImageElement>(null);
  const timerRef = useRef<any>(null);

  const steps = run.timeline || [];
  const currentStep: StepTimelineRecord | undefined = steps[currentStepIndex];

  useEffect(() => {
    if (isPlaying) {
      const intervalMs = Math.max(700, 1500 / playbackSpeed);
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

  const handlePrev = () => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.min(steps.length - 1, prev + 1));
  };

  const togglePlay = () => {
    if (!isPlaying && currentStepIndex >= steps.length - 1) {
      setCurrentStepIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const isPassed = run.status === 'passed';
  const imageUrl = currentStep?.screenshotRelPath
    ? api.getArtifactUrl(currentStep.screenshotRelPath)
    : currentStep?.screenshotUrl || '';

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      if (import.meta.env?.DEV) {
        console.log('[QaReplayerModal] 截帧原始尺寸解析成功:', { naturalWidth, naturalHeight });
      }
      setImageNaturalSize({ width: naturalWidth, height: naturalHeight });
    }
  };

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setImageNaturalSize({
        width: imgRef.current.naturalWidth,
        height: imgRef.current.naturalHeight,
      });
    }
  }, [imageUrl]);

  const reportUrl = run.reportRelPath ? api.getArtifactUrl(run.reportRelPath) : run.reportUrl;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 select-none">
      <div className="w-full max-w-6xl h-[90vh] bg-[#18181b] rounded-[12px] border border-[#27272a] shadow-[0_20px_60px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden text-[#e4e4e7] animate-in fade-in zoom-in-95 duration-150">
        {/* 顶部标题与摘要栏 */}
        <div className="h-[48px] bg-[#27272a]/70 border-b border-[#3f3f46] px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-6 h-6 rounded-[5px] flex items-center justify-center ${
                isPassed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {isPassed ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-semibold text-white tracking-tight">
                  {run.suiteName} · 执行时间轴回放
                </h2>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    isPassed
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-red-500/20 text-red-300 border border-red-500/30'
                  }`}
                >
                  {run.status}
                </span>
              </div>
              <p className="text-[10.5px] text-[#a1a1aa]">
                步骤通过: {run.passedSteps}/{run.totalSteps} · 耗时 {(run.durationMs / 1000).toFixed(2)}s · ID: {run.id}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAiOverlayVisible(!isAiOverlayVisible)}
              className={`h-[26px] px-2.5 rounded-[5px] border text-[11px] flex items-center gap-1.5 transition-colors ${
                isAiOverlayVisible
                  ? 'bg-[#4f46e5]/30 border-[#6366f1] text-[#c7d2fe]'
                  : 'bg-[#3f3f46]/40 border-transparent text-[#a1a1aa] hover:bg-[#3f3f46]'
              }`}
              title="切换显示 AI 视觉识别热区"
            >
              <Eye size={12} />
              <span>AI 热区高亮</span>
            </button>

            {reportUrl && (
              <a
                href={reportUrl}
                target="_blank"
                rel="noreferrer"
                className="h-[26px] px-2.5 rounded-[5px] bg-[#3f3f46]/50 hover:bg-[#3f3f46] text-[#e4e4e7] text-[11px] flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink size={11} />
                <span>原生报告</span>
              </a>
            )}

            <button
              onClick={onClose}
              className="w-6 h-6 rounded-[5px] hover:bg-[#3f3f46] text-[#a1a1aa] hover:text-white flex items-center justify-center transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 主视口展示区域 */}
        <div className="flex-1 flex min-h-0 bg-[#09090b]">
          {/* 左侧快照大画面 */}
          <div className="flex-1 relative flex items-center justify-center p-4 overflow-hidden">
            {imageUrl ? (
              <div
                className="relative max-w-full max-h-[calc(90vh-170px)] rounded-[6px] overflow-hidden shadow-2xl border border-[#27272a] flex items-center justify-center select-none"
                style={{
                  aspectRatio: `${imageNaturalSize.width} / ${imageNaturalSize.height}`,
                }}
              >
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt={`Step ${currentStepIndex + 1}`}
                  className="w-full h-full object-contain block select-none pointer-events-none"
                  onLoad={handleImageLoad}
                />

                {/* AI 目标区域高亮悬浮聚焦框（与图片像素严格 1:1 投影） */}
                {isAiOverlayVisible && currentStep?.boundingBox && (
                  <div
                    className="absolute border-2 border-[#6366f1] bg-[#6366f1]/20 rounded-[3px] pointer-events-none transition-all duration-300 z-10"
                    style={{
                      left: `${(currentStep.boundingBox.x / imageNaturalSize.width) * 100}%`,
                      top: `${(currentStep.boundingBox.y / imageNaturalSize.height) * 100}%`,
                      width: `${(currentStep.boundingBox.width / imageNaturalSize.width) * 100}%`,
                      height: `${(currentStep.boundingBox.height / imageNaturalSize.height) * 100}%`,
                    }}
                  >
                    <div
                      className={`absolute left-0 px-1 py-0.2 rounded bg-[#4f46e5] text-[9.5px] font-mono font-medium text-white shadow-xs flex items-center gap-1 whitespace-nowrap z-20 ${
                        currentStep.boundingBox.y / imageNaturalSize.height < 0.05
                          ? 'top-full mt-1'
                          : '-top-5'
                      }`}
                    >
                      <Sparkles size={9} />
                      <span>{currentStep.prompt ? currentStep.prompt.slice(0, 24) : 'AI 聚焦目标'}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-[#71717a]">
                <Camera size={36} className="mb-2 opacity-40" />
                <p className="text-[12px]">当前步骤无快照图像</p>
              </div>
            )}
          </div>

          {/* 右侧步骤检查详情抽屉 */}
          <div className="w-[300px] bg-[#18181b] border-l border-[#27272a] flex flex-col shrink-0">
            <div className="p-3.5 border-b border-[#27272a]">
              <span className="text-[10px] font-mono text-[#a1a1aa] uppercase tracking-wider block mb-1">
                步骤序列 ({currentStepIndex + 1} / {steps.length})
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.2 rounded text-[10.5px] font-semibold ${
                    currentStep?.status === 'passed'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-red-500/20 text-red-300'
                  }`}
                >
                  {currentStep?.status?.toUpperCase()}
                </span>
                <span className="text-[11.5px] font-mono text-[#a1a1aa]">
                  耗时: {currentStep?.durationMs}ms
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-[12px]">
              <div>
                <label className="text-[10.5px] font-medium text-[#71717a] block mb-1">
                  步骤操作类型
                </label>
                <div className="font-mono text-[#e4e4e7] bg-[#27272a]/60 px-2 py-1 rounded-[5px] border border-[#3f3f46]/50">
                  {currentStep?.type}
                </div>
              </div>

              <div>
                <label className="text-[10.5px] font-medium text-[#71717a] block mb-1">
                  自然语言指令 (Prompt)
                </label>
                <div className="text-[#f4f4f5] bg-[#27272a]/60 p-2.5 rounded-[5px] border border-[#3f3f46]/50 leading-relaxed font-sans">
                  {currentStep?.prompt}
                </div>
              </div>

              <div>
                <label className="text-[10.5px] font-medium text-[#71717a] block mb-1 flex items-center gap-1">
                  <Sparkles size={11} className="text-[#a5b4fc]" />
                  AI 决策推理 (Reasoning)
                </label>
                <div className="text-[#c7d2fe] bg-[#1e1b4b]/30 border border-[#3730a3]/40 p-2.5 rounded-[5px] leading-relaxed text-[11.5px]">
                  {currentStep?.thought || '视觉多模态模型准确定位元素并执行完毕。'}
                </div>
              </div>

              {currentStep?.error && (
                <div>
                  <label className="text-[10.5px] font-medium text-red-400 block mb-1">
                    失败原因 / 断言错误
                  </label>
                  <div className="text-red-300 bg-red-950/30 border border-red-900/50 p-2.5 rounded-[5px] text-[11.5px] font-mono leading-relaxed">
                    {currentStep.error}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部时间轴播放控制栏 */}
        <div className="h-[68px] bg-[#18181b] border-t border-[#27272a] px-5 flex items-center gap-5 shrink-0">
          {/* 播放控制按钮 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePrev}
              disabled={currentStepIndex === 0}
              className="w-7 h-7 rounded-full bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-30 text-white flex items-center justify-center transition-all"
              title="上一帧"
            >
              <SkipBack size={13} />
            </button>
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-[#4f46e5] hover:bg-[#4338ca] text-white flex items-center justify-center shadow-md transition-transform active:scale-95"
              title={isPlaying ? '暂停' : '自动回放'}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
            </button>
            <button
              onClick={handleNext}
              disabled={currentStepIndex >= steps.length - 1}
              className="w-7 h-7 rounded-full bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-30 text-white flex items-center justify-center transition-all"
              title="下一帧"
            >
              <SkipForward size={13} />
            </button>
          </div>

          {/* 刻度节点指示器 */}
          <div className="flex-1 flex flex-col justify-center gap-1">
            <div className="flex items-center justify-between text-[10.5px] text-[#a1a1aa] font-mono">
              <span>
                步骤 {currentStepIndex + 1} / {steps.length}
              </span>
              <span className="truncate max-w-sm text-[#d4d4d8]">
                {currentStep?.prompt}
              </span>
              <span>{(currentStep?.durationMs || 0)}ms</span>
            </div>

            <div className="relative h-1.5 bg-[#27272a] rounded-full flex items-center">
              {/* 激活进度线 */}
              <div
                className="absolute left-0 h-full bg-[#6366f1] rounded-full transition-all duration-200"
                style={{
                  width: `${steps.length > 1 ? (currentStepIndex / (steps.length - 1)) * 100 : 100}%`,
                }}
              />

              {/* 各步骤圆点 */}
              {steps.map((st, idx) => {
                const isCurrent = idx === currentStepIndex;
                const isPassedStep = st.status === 'passed';
                const percent = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 50;

                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentStepIndex(idx);
                    }}
                    style={{ left: `${percent}%` }}
                    className={`absolute -translate-x-1/2 w-3 h-3 rounded-full border transition-all cursor-pointer ${
                      isCurrent
                        ? 'ring-4 ring-[#6366f1]/30 scale-125 z-10 ' +
                          (isPassedStep ? 'bg-[#818cf8] border-white' : 'bg-red-400 border-white')
                        : isPassedStep
                        ? 'bg-[#4f46e5] border-[#18181b]'
                        : 'bg-red-500 border-[#18181b]'
                    }`}
                    title={`步骤 ${idx + 1}: ${st.prompt}`}
                  />
                );
              })}
            </div>
          </div>

          {/* 播放速度调节 */}
          <div className="flex items-center gap-1 border-l border-[#27272a] pl-3">
            {[0.5, 1, 2].map((spd) => (
              <button
                key={spd}
                onClick={() => setPlaybackSpeed(spd)}
                className={`px-1.5 py-0.5 rounded text-[10.5px] font-mono transition-colors ${
                  playbackSpeed === spd
                    ? 'bg-white/20 text-white font-medium'
                    : 'text-[#a1a1aa] hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
