import React, { useState, useEffect } from 'react';
import { X, Play, CheckCircle2, XCircle, Loader2, Eye, Terminal, Smartphone, Globe } from 'lucide-react';
import { QaSuite, QaRunRecord } from '@openloop/core';
import { api } from '../../services/api';

interface QaLiveRunModalProps {
  suite: QaSuite;
  onClose: () => void;
  onOpenReplay: (run: QaRunRecord) => void;
}

export const QaLiveRunModal: React.FC<QaLiveRunModalProps> = ({
  suite,
  onClose,
  onOpenReplay,
}) => {
  const isAndroid = suite.platform === 'android';
  const isIos = suite.platform === 'ios';
  const isMobilePlatform = isAndroid || isIos;
  const mobileTarget = suite.appPackage || suite.targetUrl;
  const [isRunning, setIsRunning] = useState(true);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [runRecord, setRunRecord] = useState<QaRunRecord | null>(null);
  const [logs, setLogs] = useState<string[]>([
    `[Core:Daemon] 正在连接 openLoop 核心调度服务...`,
    isIos
      ? `[Midscene:iOS] 正在连接 WebDriverAgent (${suite.wdaEndpoint || 'http://localhost:8100'})...`
      : isAndroid
      ? `[Midscene:Android] 正在连接 Android 设备/模拟器 (${suite.deviceSerial || '自动探测'})...`
      : `[Midscene:Web] 正在初始化无头浏览器视口 (${suite.viewport?.width || 1280}x${suite.viewport?.height || 800})...`,
    isMobilePlatform
      ? `[Midscene:Launch] 唤醒设备并拉起目标应用: ${mobileTarget}`
      : `[Midscene:Nav] 打开目标地址: ${suite.targetUrl}`,
  ]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 监听 WebSocket 实时步骤推进事件
  useEffect(() => {
    const unsubStart = api.on('qa:step_start', (data: any) => {
      if (data && (data.suiteId === suite.id || !data.suiteId)) {
        setCurrentStepIndex(data.stepIndex);
        setLogs((prev) => [
          ...prev,
          `[Midscene:Step #${data.stepIndex + 1}] 开始执行: ${data.step?.prompt || ''}`,
        ]);
      }
    });

    const unsubFinish = api.on('qa:step_finish', (data: any) => {
      if (data && (data.suiteId === suite.id || !data.suiteId)) {
        const statusText = data.record?.status === 'passed' ? '✔ 验证通过' : '✖ 验证失败';
        setLogs((prev) => [
          ...prev,
          `[Midscene:Step #${data.stepIndex + 1}] ${statusText} (${data.record?.durationMs || 0}ms)`,
        ]);
      }
    });

    return () => {
      unsubStart();
      unsubFinish();
    };
  }, [suite.id]);

  useEffect(() => {
    let isCancelled = false;

    const execute = async () => {
      try {
        if (import.meta.env?.DEV) {
          console.log('[QaLiveRunModal] 发起测试执行:', { suiteId: suite.id, platform: suite.platform });
        }
        setLogs((prev) => [...prev, `[Midscene:AI] 启动多模态视觉推理执行流 (共 ${suite.steps.length} 步)...`]);

        const res = await api.runQaSuite({
          suiteId: suite.id,
          targetUrl: suite.targetUrl,
        });

        if (!isCancelled) {
          setRunRecord(res);
          setIsRunning(false);
          setLogs((prev) => [
            ...prev,
            `[Midscene:Done] 测试流水线完成，状态: ${res.status.toUpperCase()}`,
            `[Midscene:Artifacts] 生成 ${res.timeline.length} 张步骤截图与时间轴回放数据`,
          ]);
          if (import.meta.env?.DEV) {
            console.log('[QaLiveRunModal] 测试执行完成:', res);
          }
        }
      } catch (err: any) {
        if (!isCancelled) {
          setIsRunning(false);
          setLogs((prev) => [...prev, `[Midscene:Error] 测试执行异常: ${err.message}`]);
          if (import.meta.env?.DEV) {
            console.error('[QaLiveRunModal] 测试执行出错:', err);
          }
        }
      }
    };

    execute();

    return () => {
      isCancelled = true;
    };
  }, [suite]);

  const isPassed = runRecord?.status === 'passed';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-xl bg-white rounded-[12px] border border-[#e3e3e8] shadow-[0_12px_32px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 顶部标题栏 */}
        <div className="px-5 py-3.5 border-b border-[#ececf0] flex items-center justify-between shrink-0 bg-[#fafafc]">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-[5px] bg-[#eeedfd] text-[#4f46e5] flex items-center justify-center">
              <Play size={13} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-[13px] font-semibold text-[#1c1c21]">
                  {suite.name} · 执行中
                </h3>
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-[4px] bg-[#f4f4f5] text-[#52525b] text-[10px] font-medium border border-[#e3e3e8]">
                  {isAndroid ? <Smartphone size={10} /> : <Globe size={10} />}
                  <span>{isAndroid ? 'Android' : 'Web'}</span>
                </span>
              </div>
              <p className="text-[11px] text-[#85858d] font-mono mt-0.5">
                {isMobilePlatform ? mobileTarget : suite.targetUrl} · 耗时: {elapsedSeconds}s
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-[5px] hover:bg-[#f0f0f2] text-[#85858d] flex items-center justify-center transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* 步骤状态序列 */}
        <div className="p-4 border-b border-[#f4f4f6] space-y-2">
          <div className="text-[11px] font-semibold text-[#85858d] uppercase tracking-wide">
            步骤执行序列
          </div>
          <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
            {suite.steps.map((step, idx) => {
              const finishedStep = runRecord?.timeline?.find((t) => t.stepIndex === idx);
              const isStepDone = Boolean(finishedStep);
              const isStepPass = finishedStep?.status === 'passed';

              return (
                <div
                  key={step.id || idx}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-[5px] border text-[11.5px] transition-colors ${
                    idx === currentStepIndex && isRunning
                      ? 'bg-[#eff6ff] border-[#bfdbfe]'
                      : 'bg-[#fafafc] border-[#ececf0]'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {isStepDone ? (
                      isStepPass ? (
                        <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle size={13} className="text-red-500 shrink-0" />
                      )
                    ) : isRunning && idx === currentStepIndex ? (
                      <Loader2 size={13} className="text-[#4f46e5] animate-spin shrink-0" />
                    ) : (
                      <span className="w-3 h-3 rounded-full border border-[#cbd5e1] inline-block shrink-0" />
                    )}
                    <span className="font-mono text-[#85858d]">#{idx + 1}</span>
                    <span className="font-medium text-[#1c1c21] truncate">
                      [{step.type}] {step.prompt}
                    </span>
                  </div>

                  {finishedStep && (
                    <span className="font-mono text-[10.5px] text-[#85858d] shrink-0">
                      {finishedStep.durationMs}ms
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 控制台实时日志 */}
        <div className="p-3.5 bg-[#18181b] text-[#e4e4e7] font-mono text-[11px] h-[140px] overflow-y-auto space-y-1 select-text">
          <div className="flex items-center gap-1.5 text-[#a1a1aa] pb-1 border-b border-[#27272a] mb-1.5 text-[10px]">
            <Terminal size={11} />
            <span>实时执行控制台 (Realtime Console)</span>
          </div>
          {logs.map((log, idx) => (
            <div key={idx} className="leading-relaxed">
              <span className="text-[#818cf8]">❯</span> {log}
            </div>
          ))}
        </div>

        {/* 底部动作栏 */}
        <div className="px-4 py-3 bg-white border-t border-[#ececf0] flex items-center justify-between">
          <div>
            {!isRunning && runRecord && (
              <span
                className={`text-[12px] font-semibold flex items-center gap-1.5 ${
                  isPassed ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {isPassed ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                <span>
                  测试{isPassed ? '全部通过' : '未通过'} · 耗时 {(runRecord.durationMs / 1000).toFixed(2)}s
                </span>
              </span>
            )}
            {isRunning && (
              <span className="text-[11.5px] text-[#71717a] flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin text-[#4f46e5]" />
                <span>Midscene AI 视觉定位执行中...</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isRunning && runRecord && (
              <button
                onClick={() => {
                  onClose();
                  onOpenReplay(runRecord);
                }}
                className="h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium flex items-center gap-1.5 shadow-xs transition-all active:scale-95"
              >
                <Eye size={12} />
                <span>截图逐帧回放</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="h-[28px] px-3 rounded-[6px] border border-[#e3e3e8] hover:bg-[#f4f4f6] text-[#4b4b53] text-[12px] transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
