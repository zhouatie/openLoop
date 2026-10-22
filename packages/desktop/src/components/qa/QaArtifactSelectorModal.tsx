import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Check,
  FlaskConical,
  ZoomIn,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  ListOrdered,
  ChevronDown,
} from 'lucide-react';
import { QaRunRecord, StepTimelineRecord, SelectedQaArtifacts, SelectedQaStepArtifact, SelectedQaScreenshotArtifact } from '@openloop/core';
import { api } from '../../services/api';
import { ImageLightboxModal } from '../ImageLightboxModal';

export interface QaArtifactSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId?: string | null;
  qaRun?: QaRunRecord | null;
  initialSelection?: SelectedQaArtifacts | null;
  onConfirm: (selection: SelectedQaArtifacts) => void;
}

export const QaArtifactSelectorModal: React.FC<QaArtifactSelectorModalProps> = ({
  isOpen,
  onClose,
  taskId,
  qaRun: propQaRun,
  initialSelection,
  onConfirm,
}) => {
  const [qaRuns, setQaRuns] = useState<QaRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // 选中的步骤索引集合 (0-based stepIndex)
  const [selectedStepIndices, setSelectedStepIndices] = useState<Set<number>>(new Set());
  // 选中的截图标识集合 (image name 或 url)
  const [selectedScreenshotNames, setSelectedScreenshotNames] = useState<Set<string>>(new Set());

  // 大图弹窗预览状态
  const [activeLightbox, setActiveLightbox] = useState<{ name: string; url: string; path?: string } | null>(null);

  // 1. 加载 QA 运行记录
  useEffect(() => {
    if (!isOpen) return;

    if (propQaRun) {
      setQaRuns([propQaRun]);
      setSelectedRunId(propQaRun.id);
      return;
    }

    if (taskId) {
      setLoading(true);
      api.getQaRuns(undefined, taskId)
        .then((runs) => {
          if (import.meta.env?.DEV) {
            console.log('[QaArtifactSelectorModal] 检索到任务 QA 运行记录:', { taskId, count: runs.length });
          }
          setQaRuns(runs);
          if (runs.length > 0) {
            setSelectedRunId(runs[0].id);
          }
        })
        .catch((err) => {
          if (import.meta.env?.DEV) {
            console.warn('[QaArtifactSelectorModal] 获取 QA 运行记录失败:', err);
          }
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, taskId, propQaRun]);

  // 当前选中的 QA Run 实体
  const currentRun: QaRunRecord | null = useMemo(() => {
    if (propQaRun && (!selectedRunId || propQaRun.id === selectedRunId)) {
      return propQaRun;
    }
    return qaRuns.find((r) => r.id === selectedRunId) || qaRuns[0] || null;
  }, [qaRuns, selectedRunId, propQaRun]);

  // 当前 Run 的步骤列表
  const steps: StepTimelineRecord[] = useMemo(() => {
    return currentRun?.timeline || [];
  }, [currentRun]);

  // 从步骤列表与产物中提取所有可用截图
  const screenshots = useMemo(() => {
    if (!currentRun) return [];
    const list: Array<{
      name: string;
      url: string;
      relPath?: string;
      stepIndex?: number;
      stepPrompt?: string;
      status?: 'passed' | 'failed' | 'skipped';
    }> = [];

    steps.forEach((st, idx) => {
      const rawUrl = st.screenshotUrl || (st.screenshotRelPath ? api.getArtifactUrl(st.screenshotRelPath) : '');
      if (rawUrl) {
        const fileName = (st.screenshotRelPath || rawUrl).split(/[/\\]/).pop() || `step_${idx + 1}.png`;
        list.push({
          name: fileName,
          url: api.getArtifactUrl(rawUrl),
          relPath: st.screenshotRelPath,
          stepIndex: idx,
          stepPrompt: st.prompt,
          status: st.status,
        });
      }
    });

    return list;
  }, [currentRun, steps]);

  // 2. 初始化已选状态
  useEffect(() => {
    if (!isOpen) return;

    if (initialSelection) {
      const stepIdxSet = new Set<number>();
      if (Array.isArray(initialSelection.steps)) {
        initialSelection.steps.forEach((s) => stepIdxSet.add(s.stepIndex));
      }
      setSelectedStepIndices(stepIdxSet);

      const scNameSet = new Set<string>();
      if (Array.isArray(initialSelection.screenshots)) {
        initialSelection.screenshots.forEach((sc) => scNameSet.add(sc.name));
      }
      setSelectedScreenshotNames(scNameSet);
    } else {
      // 默认智能策略：若测试有失败，默认预选失败的步骤及其截图
      const failedSteps = steps
        .map((s, idx) => ({ step: s, idx }))
        .filter(({ step }) => step.status === 'failed');

      if (failedSteps.length > 0) {
        const stepIdxs = new Set<number>(failedSteps.map((f) => f.idx));
        setSelectedStepIndices(stepIdxs);

        const scNames = new Set<string>();
        screenshots.forEach((sc) => {
          if (sc.stepIndex !== undefined && stepIdxs.has(sc.stepIndex)) {
            scNames.add(sc.name);
          }
        });
        setSelectedScreenshotNames(scNames);
      } else {
        setSelectedStepIndices(new Set());
        setSelectedScreenshotNames(new Set());
      }
    }
  }, [isOpen, initialSelection, steps, screenshots]);

  // 步骤勾选切换
  const handleToggleStep = (index: number) => {
    setSelectedStepIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // 截图勾选切换
  const handleToggleScreenshot = (name: string) => {
    setSelectedScreenshotNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  // 一键全选/取消步骤
  const handleToggleAllSteps = () => {
    if (selectedStepIndices.size === steps.length) {
      setSelectedStepIndices(new Set());
    } else {
      setSelectedStepIndices(new Set(steps.map((_, idx) => idx)));
    }
  };

  // 一键全选/取消截图
  const handleToggleAllScreenshots = () => {
    if (selectedScreenshotNames.size === screenshots.length) {
      setSelectedScreenshotNames(new Set());
    } else {
      setSelectedScreenshotNames(new Set(screenshots.map((s) => s.name)));
    }
  };

  // 一键精选所有失败项及对应截图
  const handleSelectFailedItems = () => {
    const failedIndices = steps
      .map((st, idx) => ({ st, idx }))
      .filter(({ st }) => st.status === 'failed')
      .map(({ idx }) => idx);

    setSelectedStepIndices(new Set(failedIndices));

    const failedScNames = screenshots
      .filter((sc) => sc.stepIndex !== undefined && failedIndices.includes(sc.stepIndex))
      .map((sc) => sc.name);

    setSelectedScreenshotNames(new Set(failedScNames));
  };

  // 一键清空所有选择
  const handleClearAll = () => {
    setSelectedStepIndices(new Set());
    setSelectedScreenshotNames(new Set());
  };

  // 确认选择并提交
  const handleConfirm = () => {
    if (!currentRun) {
      onClose();
      return;
    }

    const selectedSteps: SelectedQaStepArtifact[] = [];
    steps.forEach((st, idx) => {
      if (selectedStepIndices.has(idx)) {
        selectedSteps.push({
          stepIndex: idx,
          stepId: st.stepId,
          prompt: st.prompt,
          status: st.status,
          durationMs: st.durationMs,
          error: st.error,
          thought: st.thought,
          screenshotUrl: st.screenshotUrl,
          screenshotRelPath: st.screenshotRelPath,
        });
      }
    });

    const selectedScreenshots: SelectedQaScreenshotArtifact[] = [];
    screenshots.forEach((sc) => {
      if (selectedScreenshotNames.has(sc.name)) {
        selectedScreenshots.push({
          name: sc.name,
          url: sc.url,
          path: sc.relPath,
          stepIndex: sc.stepIndex,
          stepPrompt: sc.stepPrompt,
        });
      }
    });

    const selection: SelectedQaArtifacts = {
      qaRunId: currentRun.id,
      suiteName: currentRun.suiteName,
      steps: selectedSteps,
      screenshots: selectedScreenshots,
    };

    if (import.meta.env?.DEV) {
      console.log('[QaArtifactSelectorModal] 用户确认选择 QA 产物:', {
        qaRunId: currentRun.id,
        stepsCount: selectedSteps.length,
        screenshotsCount: selectedScreenshots.length,
      });
    }

    onConfirm(selection);
    onClose();
  };

  // 键盘快捷键监听 (Enter 确认, ESC 关闭)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleConfirm, onClose]);

  if (!isOpen) return null;

  const totalSelectedCount = selectedStepIndices.size + selectedScreenshotNames.size;
  const hasFailedSteps = steps.some((s) => s.status === 'failed');

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[3px] flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[840px] h-[78vh] max-h-[640px] min-h-[440px] bg-white rounded-[10px] border border-[#e3e3e8] shadow-[0_20px_50px_rgba(0,0,0,0.14)] flex flex-col overflow-hidden text-[#1c1c21] select-none my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏：单层极简规范，高度 46px，彻底消除多层堆叠与挤压 */}
        <div className="h-[46px] bg-white border-b border-[#e3e3e8] px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1 mr-3">
            <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] border border-[#e3e3e8]/70 flex items-center justify-center text-[#4f46e5] shrink-0">
              <FlaskConical size={11.5} strokeWidth={2.2} />
            </div>
            <span className="text-[12.5px] font-semibold text-[#1c1c21] shrink-0">
              选择测试产物
            </span>

            {currentRun && (
              <div className="flex items-center gap-1.5 text-[11px] text-[#71717a] min-w-0 truncate">
                <span className="text-[#d4d4d8] shrink-0">•</span>
                <span
                  className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.2 rounded-[3px] text-[9.5px] font-medium border ${
                    currentRun.status === 'passed'
                      ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/60'
                      : 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]/60'
                  }`}
                >
                  {currentRun.status === 'passed' ? (
                    <CheckCircle2 size={8.5} strokeWidth={2.2} />
                  ) : (
                    <XCircle size={8.5} strokeWidth={2.2} />
                  )}
                  <span>{currentRun.status.toUpperCase()}</span>
                </span>
                {currentRun.durationMs > 0 && (
                  <span className="font-mono text-[10px] text-[#85858d] shrink-0">
                    {(currentRun.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
                {currentRun.suiteName && (
                  <span className="text-[#85858d] text-[11px] truncate max-w-[200px]" title={currentRun.suiteName}>
                    {currentRun.suiteName}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* 一键选失败项快捷按钮 */}
            {hasFailedSteps && (
              <button
                type="button"
                onClick={handleSelectFailedItems}
                className="h-[24px] px-2 rounded-[4px] bg-[#fef2f2] hover:bg-[#fee2e2] text-[#dc2626] border border-[#fecaca]/70 text-[10.5px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                title="一键选择全部失败的用例步骤与关联截帧"
              >
                <AlertCircle size={10} strokeWidth={2.2} />
                <span>选失败项</span>
              </button>
            )}

            {/* 切换历史运行记录 (紧凑定宽，避免撑破布局) */}
            {qaRuns.length > 1 && (
              <div className="relative flex items-center">
                <select
                  value={currentRun?.id || ''}
                  onChange={(e) => setSelectedRunId(e.target.value)}
                  className="h-[24px] pl-2 pr-5 text-[10.5px] font-mono bg-[#f9f9fb] border border-[#e3e3e8] rounded-[4px] text-[#4b4b53] focus:outline-none focus:border-[#4f46e5] cursor-pointer appearance-none max-w-[130px] truncate"
                >
                  {qaRuns.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      Run #{i + 1} ({r.status})
                    </option>
                  ))}
                </select>
                <ChevronDown size={10} className="absolute right-1.5 text-[#85858d] pointer-events-none" />
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-5 h-5 rounded-[4px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer"
              title="关闭 (Esc)"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* 内容展示区：左右分栏布局 */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[#e8e8ed] overflow-hidden">
          {/* 左栏：操作流程与步骤 */}
          <div className="w-full md:w-1/2 flex flex-col min-h-0 overflow-hidden bg-[#fafafc]/60">
            {/* 左表头 (34px 标准高度) */}
            <div className="h-[34px] px-3.5 bg-[#fafafc] border-b border-[#e8e8ed] flex items-center justify-between text-[11px] font-medium text-[#71717a] shrink-0">
              <div className="flex items-center gap-1.5">
                <ListOrdered size={11} className="text-[#63636b]" />
                <span>用例步骤</span>
                <span className="font-mono text-[10px] text-[#85858d]">
                  ({selectedStepIndices.size}/{steps.length})
                </span>
              </div>
              <button
                type="button"
                onClick={handleToggleAllSteps}
                className="text-[10.5px] text-[#4f46e5] hover:text-[#4338ca] hover:underline cursor-pointer"
              >
                {selectedStepIndices.size === steps.length ? '取消全选' : '全选流程'}
              </button>
            </div>

            {/* 步骤列表内容区 */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
              {steps.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[#85858d]">
                  <ListOrdered size={20} className="opacity-30 mb-1.5" />
                  <span className="text-[11px]">未解析到用例步骤记录</span>
                </div>
              ) : (
                steps.map((st, idx) => {
                  const isChecked = selectedStepIndices.has(idx);
                  const isFailed = st.status === 'failed';

                  return (
                    <div
                      key={st.stepId || idx}
                      onClick={() => handleToggleStep(idx)}
                      className={`p-2 rounded-[6px] border transition-all cursor-pointer group select-none ${
                        isChecked
                          ? 'bg-[#f5f5fe] border-[#c7d2fe] shadow-2xs'
                          : 'bg-white hover:bg-[#fafafc] border-[#e3e3e8]/70 hover:border-[#d0d0d8]'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="pt-0.5 shrink-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="w-3.5 h-3.5 rounded text-[#4f46e5] focus:ring-[#4f46e5] cursor-pointer"
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="font-mono text-[10px] font-semibold text-[#85858d]">
                              #{idx + 1}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {st.durationMs > 0 && (
                                <span className="font-mono text-[9px] text-[#85858d]">
                                  {st.durationMs}ms
                                </span>
                              )}
                              <span
                                className={`inline-flex items-center gap-0.5 px-1 py-0.2 rounded-[3px] text-[9px] font-medium border ${
                                  st.status === 'passed'
                                    ? 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/60'
                                    : st.status === 'failed'
                                    ? 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]/60 font-semibold'
                                    : 'bg-[#f4f4f6] text-[#71717a] border-[#e3e3e8]'
                                }`}
                              >
                                {st.status === 'passed' ? (
                                  <CheckCircle2 size={8.5} strokeWidth={2} />
                                ) : st.status === 'failed' ? (
                                  <XCircle size={8.5} strokeWidth={2} />
                                ) : null}
                                <span>{st.status.toUpperCase()}</span>
                              </span>
                            </div>
                          </div>

                          <div className="text-[11.5px] font-medium text-[#1c1c21] leading-snug line-clamp-2">
                            {st.prompt}
                          </div>

                          {/* 紧凑优雅的报错提示 */}
                          {st.error && (
                            <div className="mt-1 px-1.5 py-0.5 rounded-[3px] bg-[#fef2f2] border-l-2 border-[#f87171] text-[10px] text-[#dc2626] font-mono leading-tight line-clamp-2">
                              {st.error}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 右栏：界面截帧快照 */}
          <div className="w-full md:w-1/2 flex flex-col min-h-0 overflow-hidden bg-white">
            {/* 右表头 (34px 标准高度，与左栏严格水平对齐) */}
            <div className="h-[34px] px-3.5 bg-[#fafafc] border-b border-[#e8e8ed] flex items-center justify-between text-[11px] font-medium text-[#71717a] shrink-0">
              <div className="flex items-center gap-1.5">
                <ImageIcon size={11} className="text-[#63636b]" />
                <span>截帧快照</span>
                <span className="font-mono text-[10px] text-[#85858d]">
                  ({selectedScreenshotNames.size}/{screenshots.length})
                </span>
              </div>
              <button
                type="button"
                onClick={handleToggleAllScreenshots}
                className="text-[10.5px] text-[#4f46e5] hover:text-[#4338ca] hover:underline cursor-pointer"
              >
                {selectedScreenshotNames.size === screenshots.length ? '取消全选' : '全选截图'}
              </button>
            </div>

            {/* 截图画廊网格 */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
              {screenshots.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-[#85858d]">
                  <ImageIcon size={20} className="opacity-30 mb-1.5" />
                  <span className="text-[11px]">未生成步骤截帧快照</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {screenshots.map((sc, i) => {
                    const isChecked = selectedScreenshotNames.has(sc.name);
                    const isFailed = sc.status === 'failed';

                    return (
                      <div
                        key={sc.name + i}
                        onClick={() => handleToggleScreenshot(sc.name)}
                        className={`group relative rounded-[6px] border overflow-hidden cursor-pointer transition-all flex flex-col ${
                          isChecked
                            ? 'border-[#4f46e5] ring-2 ring-[#4f46e5]/15 shadow-2xs'
                            : 'border-[#e3e3e8] hover:border-[#1c1c21]/30 bg-[#fafafc]'
                        }`}
                      >
                        {/* 截图预览区 */}
                        <div className="relative aspect-[16/10] bg-[#18181b] overflow-hidden flex items-center justify-center">
                          <img
                            src={sc.url}
                            alt={sc.name}
                            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-102"
                            loading="lazy"
                          />

                          {/* 悬浮微圆形放大镜按钮 */}
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveLightbox({ name: sc.name, url: sc.url, path: sc.relPath });
                              }}
                              className="w-7 h-7 rounded-full bg-white/95 hover:bg-white text-[#1c1c21] shadow-md flex items-center justify-center transition-transform hover:scale-110 cursor-pointer"
                              title="全屏大图预览"
                            >
                              <ZoomIn size={12} />
                            </button>
                          </div>

                          {/* 右上角精简勾选框 */}
                          <div className="absolute top-1.5 right-1.5">
                            <div
                              className={`w-3.5 h-3.5 rounded-[3px] flex items-center justify-center border transition-all ${
                                isChecked
                                  ? 'bg-[#4f46e5] border-[#4f46e5] text-white'
                                  : 'bg-white/85 border-[#18181b]/30 text-transparent group-hover:border-[#4f46e5]'
                              }`}
                            >
                              <Check size={9} strokeWidth={3} />
                            </div>
                          </div>

                          {/* 左下角步骤序号微标 */}
                          {sc.stepIndex !== undefined && (
                            <div className="absolute bottom-1.5 left-1.5">
                              <span
                                className={`px-1 py-0.2 rounded-[3px] text-[9px] font-mono font-medium backdrop-blur-xs ${
                                  isFailed
                                    ? 'bg-[#dc2626]/85 text-white'
                                    : 'bg-black/60 text-white'
                                }`}
                              >
                                #{sc.stepIndex + 1}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* 单行步骤描述摘要 (去除无意义的冗长文件名) */}
                        <div className="px-2 py-1 bg-white border-t border-[#f1f1f4]">
                          <span
                            className="text-[10.5px] text-[#4b4b53] block truncate"
                            title={sc.stepPrompt || sc.name}
                          >
                            {sc.stepPrompt || sc.name}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部确认操作栏 (始终固定，绝不被内容遮挡) */}
        <div className="h-[46px] bg-[#fafafc] border-t border-[#e3e3e8] px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-[#63636b]">
            <span>
              已选择: <strong className="text-[#1c1c21] font-semibold">{selectedStepIndices.size}</strong> 项流程，
              <strong className="text-[#1c1c21] font-semibold">{selectedScreenshotNames.size}</strong> 张截图
            </span>
            {totalSelectedCount > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="text-[10.5px] text-[#85858d] hover:text-[#dc2626] transition-colors cursor-pointer ml-1"
              >
                清空
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[26px] px-3 rounded-[5px] border border-[#e3e3e8] bg-white hover:bg-[#f4f4f6] text-[#63636b] hover:text-[#1c1c21] text-[11px] font-medium transition-colors cursor-pointer"
            >
              取消
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              className="h-[26px] px-3.5 rounded-[5px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11px] font-medium flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer active:scale-98"
            >
              <Check size={11} strokeWidth={2.5} />
              <span>确认添加至会话</span>
            </button>
          </div>
        </div>
      </div>

      {/* 截帧大图全屏预览弹窗 */}
      {activeLightbox && (
        <ImageLightboxModal
          isOpen={true}
          attachment={{ name: activeLightbox.name, url: activeLightbox.url, path: activeLightbox.path }}
          onClose={() => setActiveLightbox(null)}
        />
      )}
    </div>
  );
};
