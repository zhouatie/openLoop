import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Sparkles,
  Camera,
  Globe,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { QaRunRecord, StepTimelineRecord, QaSuite } from '@openloop/core';
import { api } from '../../services/api';
import { toast } from '../../components/Toast';

interface QaRunDetailViewProps {
  runId: string;
  onBack: () => void;
  onRerun: (suiteId: string) => void;
  onDeleteRun?: (runId: string) => void;
}

export const QaRunDetailView: React.FC<QaRunDetailViewProps> = ({
  runId,
  onBack,
  onRerun,
  onDeleteRun,
}) => {
  const [run, setRun] = useState<QaRunRecord | null>(null);
  const [suite, setSuite] = useState<QaSuite | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 播放器状态
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isAiOverlayVisible, setIsAiOverlayVisible] = useState(true);
  const timerRef = useRef<any>(null);

  // 加载数据
  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      setIsLoading(true);
      if (import.meta.env?.DEV) {
        console.log('[QaRunDetailView] 开始加载运行详情:', runId);
      }
      try {
        const data = await api.getQaRunById(runId);
        if (!isCancelled && data) {
          setRun(data);
          if (data.suiteId) {
            const suiteData = await api.getQaSuiteById(data.suiteId);
            if (!isCancelled) setSuite(suiteData);
          }
        }
      } catch (err: any) {
        if (!isCancelled) {
          toast.error(`加载运行记录失败: ${err.message}`);
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      isCancelled = true;
    };
  }, [runId]);

  const steps = run?.timeline || [];
  const currentStep: StepTimelineRecord | undefined = steps[currentStepIndex];

  // 自动回放定时器
  useEffect(() => {
    if (isPlaying) {
      const intervalMs = Math.max(700, 1600 / playbackSpeed);
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

  if (isLoading) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center text-[#85858d]">
        <RefreshCw size={22} className="animate-spin text-[#4f46e5] mb-2" />
        <span className="text-[12px]">正在载入任务运行快照与时间轴...</span>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center text-[#85858d]">
        <p className="text-[13px] mb-3">未找到该运行记录</p>
        <button
          onClick={onBack}
          className="px-3 py-1.5 rounded-[6px] bg-[#1c1c21] text-white text-[12px]"
        >
          返回任务历史
        </button>
      </div>
    );
  }

  const isPassed = run.status === 'passed';
  const imageUrl = currentStep?.screenshotRelPath
    ? api.getArtifactUrl(currentStep.screenshotRelPath)
    : currentStep?.screenshotUrl || '';
  const reportUrl = run.reportRelPath ? api.getArtifactUrl(run.reportRelPath) : run.reportUrl;

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden bg-[#f4f4f6] select-none">
      {/* 顶部面包屑与操作栏 (符合 openLoop 极简规范) */}
      <div className="h-[46px] px-4 bg-white border-b border-[#e3e3e8] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onBack}
            className="flex items-center gap-1 h-[26px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-xs"
          >
            <ArrowLeft size={12} />
            <span>返回列表</span>
          </button>

          <span className="text-[#d8d8de] text-[13px]">/</span>

          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#1c1c21]">{run.suiteName}</span>
            <span
              className={`flex items-center gap-0.5 text-[9.5px] px-1.5 py-[1px] rounded font-medium border ${
                isPassed
                  ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]'
                  : 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]'
              }`}
            >
              {isPassed ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
              <span>{isPassed ? 'PASSED' : 'FAILED'}</span>
            </span>
            <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
              #{run.id}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {reportUrl && (
            <a
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 h-[26px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f1f1f4] text-[11.5px] font-medium text-[#4b4b53] transition-all shadow-xs"
            >
              <ExternalLink size={11} />
              <span>打开原生报告</span>
            </a>
          )}

          {run.suiteId && (
            <button
              onClick={() => onRerun(run.suiteId)}
              className="flex items-center gap-1 h-[26px] px-3 bg-[#1c1c21] hover:bg-[#2e2f36] text-[11.5px] font-medium text-white rounded-[5px] transition-all active:scale-95 shadow-xs cursor-pointer"
            >
              <Play size={11} />
              <span>重新执行</span>
            </button>
          )}

          {onDeleteRun && (
            <button
              onClick={() => onDeleteRun(run.id)}
              title="删除该运行记录与截图产物"
              className="flex items-center gap-1 h-[26px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#fef2f2] text-[11.5px] font-medium text-[#4b4b53] hover:text-[#dc2626] hover:border-[#fecaca] transition-all shadow-xs cursor-pointer"
            >
              <Trash2 size={11} />
              <span>删除记录</span>
            </button>
          )}
        </div>
      </div>

      {/* 元数据状态细条 */}
      <div className="px-4 py-2 bg-[#fafafc] border-b border-[#e3e3e8] flex items-center justify-between text-[11px] text-[#71717a] shrink-0">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-1">
            <span className="text-[#a1a1aa]">测试地址:</span>
            {suite?.targetUrl ? (
              <a
                href={suite.targetUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[#4b4b53] hover:text-[#1c1c21] hover:underline flex items-center gap-1"
              >
                <Globe size={11} className="text-[#a1a1aa]" />
                <span>{suite.targetUrl}</span>
              </a>
            ) : (
              <span className="font-mono text-[#4b4b53]">默认浏览器视口</span>
            )}
          </div>

          <div>
            <span className="text-[#a1a1aa]">通过步骤: </span>
            <span className="font-semibold text-[#1c1c21]">
              {run.passedSteps} / {run.totalSteps}
            </span>
          </div>

          <div>
            <span className="text-[#a1a1aa]">总耗时: </span>
            <span className="font-mono text-[#1c1c21]">{(run.durationMs / 1000).toFixed(2)}s</span>
          </div>

          <div>
            <span className="text-[#a1a1aa]">执行时间: </span>
            <span>{new Date(run.createdAt).toLocaleString('zh-CN')}</span>
          </div>
        </div>

        <div>
          <button
            onClick={() => setIsAiOverlayVisible(!isAiOverlayVisible)}
            className={`px-2 py-0.5 rounded text-[10.5px] font-medium flex items-center gap-1 transition-colors ${
              isAiOverlayVisible
                ? 'bg-[#eeedfd] text-[#4f46e5] border border-[#c7d2fe]'
                : 'text-[#85858d] hover:bg-[#f0f0f2] border border-transparent'
            }`}
          >
            <Sparkles size={11} />
            <span>AI 视觉热区标注</span>
          </button>
        </div>
      </div>

      {/* 主工作区：左侧步骤流水线 + 右侧浅色视口大画布 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧：步骤列表与思考过程 */}
        <div className="w-[360px] bg-white border-r border-[#e3e3e8] flex flex-col shrink-0 overflow-hidden">
          <div className="p-2.5 px-3.5 border-b border-[#ececf0] bg-[#fafafc] flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[#85858d] uppercase tracking-wide">
              执行步骤序列 ({steps.length})
            </span>
            <span className="text-[10px] text-[#a1a1aa]">点击步骤跳帧</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#ececf0]">
            {steps.map((st, idx) => {
              const isSelected = idx === currentStepIndex;
              const isStepPass = st.status === 'passed';

              return (
                <div
                  key={idx}
                  onClick={() => {
                    setIsPlaying(false);
                    setCurrentStepIndex(idx);
                  }}
                  className={`p-3 text-[12px] cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#f4f4f8] border-l-2 border-[#1c1c21]' : 'hover:bg-[#f9f9fb]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-4 h-4 rounded-full bg-[#f1f1f4] text-[#52525b] text-[10px] font-mono font-semibold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className="font-mono text-[9.5px] text-[#4f46e5] font-semibold bg-[#eeedfd] px-1.5 py-[1px] rounded">
                        {st.type}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-[#85858d]">
                        {st.durationMs}ms
                      </span>
                      {isStepPass ? (
                        <CheckCircle2 size={12} className="text-[#10b981]" />
                      ) : (
                        <XCircle size={12} className="text-[#ef4444]" />
                      )}
                    </div>
                  </div>

                  <p className="text-[#1c1c21] font-medium leading-relaxed mb-1.5 text-[12px]">{st.prompt}</p>

                  {/* AI 决策推理过程 */}
                  {st.thought && (
                    <div className="p-2 rounded-[5px] bg-[#f9f9fb] border border-[#ececf0] text-[10.5px] text-[#63636b] leading-relaxed flex items-start gap-1.5">
                      <Sparkles size={11} className="text-[#4f46e5] shrink-0 mt-0.5" />
                      <span>{st.thought}</span>
                    </div>
                  )}

                  {st.error && (
                    <div className="mt-1 p-2 rounded-[5px] bg-[#fef2f2] border border-[#fecaca] text-[10.5px] font-mono text-[#dc2626] leading-relaxed">
                      {st.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧：浅色模拟浏览器视口与时间轴播放器 */}
        <div className="flex-1 flex flex-col bg-[#eef0f3] min-w-0 overflow-hidden">
          {/* 视口舞台 */}
          <div className="flex-1 relative flex items-center justify-center p-6 overflow-hidden select-none">
            {imageUrl ? (
              <div className="relative max-w-full max-h-full bg-white rounded-[8px] border border-[#d8d8de] shadow-[0_4px_24px_rgba(0,0,0,0.06)] overflow-hidden flex flex-col">
                {/* 模拟浏览器头部栏 */}
                <div className="h-[32px] px-3 bg-[#fbfbfd] border-b border-[#ececf0] flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                  </div>

                  <div className="flex-1 max-w-xs mx-auto">
                    <div className="bg-[#f0f1f4] border border-[#e3e3e8] rounded-[4px] px-2.5 py-0.5 text-center font-mono text-[10px] text-[#71717a] truncate">
                      {suite?.targetUrl || 'http://localhost:3000'}
                    </div>
                  </div>

                  <span className="text-[10px] font-mono text-[#a1a1aa]">1280 x 800</span>
                </div>

                {/* 截图本体 */}
                <div className="relative overflow-hidden bg-white flex items-center justify-center">
                  <img
                    src={imageUrl}
                    alt={`Step ${currentStepIndex + 1}`}
                    className="max-w-full max-h-[calc(100vh-250px)] object-contain block"
                  />

                  {/* AI 目标区域高亮标注框 */}
                  {isAiOverlayVisible && currentStep?.boundingBox && (
                    <div
                      className="absolute border-2 border-[#4f46e5] bg-[#4f46e5]/10 rounded-[3px] pointer-events-none transition-all duration-200"
                      style={{
                        left: `${(currentStep.boundingBox.x / 1280) * 100}%`,
                        top: `${(currentStep.boundingBox.y / 800) * 100}%`,
                        width: `${(currentStep.boundingBox.width / 1280) * 100}%`,
                        height: `${(currentStep.boundingBox.height / 800) * 100}%`,
                      }}
                    >
                      <div className="absolute -top-5 left-0 px-1 py-0.2 rounded bg-[#1c1c21] text-[9px] font-mono font-medium text-white shadow-xs flex items-center gap-1 whitespace-nowrap">
                        <Sparkles size={8} className="text-[#818cf8]" />
                        <span>AI 聚焦目标</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-[#85858d]">
                <Camera size={32} className="mb-2 opacity-40 text-[#a1a1aa]" />
                <p className="text-[12px]">当前步骤无快照图像</p>
              </div>
            )}
          </div>

          {/* 底部浅色一体化控制栏 (符合 openLoop 原生极简规范) */}
          <div className="h-[48px] bg-white border-t border-[#e3e3e8] px-5 flex items-center gap-4 shrink-0 select-none">
            {/* 播放按钮组 */}
            <div className="flex items-center gap-1">
              <button
                onClick={handlePrev}
                disabled={currentStepIndex === 0}
                className="w-6 h-6 rounded-[5px] hover:bg-[#f1f1f4] disabled:opacity-30 text-[#4b4b53] flex items-center justify-center transition-all"
                title="上一帧"
              >
                <SkipBack size={12} />
              </button>
              <button
                onClick={togglePlay}
                className="w-7 h-7 rounded-full bg-[#1c1c21] hover:bg-[#2e2f36] text-white flex items-center justify-center shadow-xs transition-transform active:scale-95"
                title={isPlaying ? '暂停' : '自动回放'}
              >
                {isPlaying ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
              </button>
              <button
                onClick={handleNext}
                disabled={currentStepIndex >= steps.length - 1}
                className="w-6 h-6 rounded-[5px] hover:bg-[#f1f1f4] disabled:opacity-30 text-[#4b4b53] flex items-center justify-center transition-all"
                title="下一帧"
              >
                <SkipForward size={12} />
              </button>
            </div>

            {/* 进度轨道与刻度卡扣 */}
            <div className="flex-1 flex flex-col justify-center gap-1">
              <div className="flex items-center justify-between text-[10px] text-[#71717a] font-mono">
                <span>
                  步骤 {currentStepIndex + 1} / {steps.length}
                </span>
                <span className="truncate max-w-sm text-[#1c1c21] font-sans font-medium">
                  {currentStep?.prompt}
                </span>
                <span>{(currentStep?.durationMs || 0)}ms</span>
              </div>

              <div className="relative h-1 bg-[#e3e3e8] rounded-full flex items-center">
                {/* 激活进度线 */}
                <div
                  className="absolute left-0 h-full bg-[#1c1c21] rounded-full transition-all duration-200"
                  style={{
                    width: `${steps.length > 1 ? (currentStepIndex / (steps.length - 1)) * 100 : 100}%`,
                  }}
                />

                {/* 步骤圆点卡扣 */}
                {steps.map((st, idx) => {
                  const isCurrent = idx === currentStepIndex;
                  const isStepPass = st.status === 'passed';
                  const percent = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 50;

                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentStepIndex(idx);
                      }}
                      style={{ left: `${percent}%` }}
                      className={`absolute -translate-x-1/2 rounded-full border transition-all cursor-pointer ${
                        isCurrent
                          ? 'w-3 h-3 bg-[#4f46e5] border-2 border-white shadow-xs z-10 scale-125'
                          : isStepPass
                          ? 'w-2 h-2 bg-[#10b981] border-white'
                          : 'w-2 h-2 bg-[#ef4444] border-white'
                      }`}
                      title={`步骤 ${idx + 1}: ${st.prompt}`}
                    />
                  );
                })}
              </div>
            </div>

            {/* 倍速调节 */}
            <div className="flex items-center gap-1 border-l border-[#ececf0] pl-3">
              {[0.5, 1, 2].map((spd) => (
                <button
                  key={spd}
                  onClick={() => setPlaybackSpeed(spd)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    playbackSpeed === spd
                      ? 'bg-[#1c1c21] text-white font-medium'
                      : 'text-[#71717a] hover:bg-[#f1f1f4]'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
