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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Layers,
  Square,
  Edit3,
  Plus,
  Minus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Target,
  Undo2,
  GitCommitHorizontal,
} from 'lucide-react';
import { Task, QaRunRecord, StepTimelineRecord, WorktreeContextInfo, TaskWorktreeDiffResult } from '@openloop/core';
import { api } from '../../services/api';
import { toast } from '../Toast';
import { CodeDiffViewerModal } from '../diff/CodeDiffViewerModal';

interface VisualAcceptanceModalProps {
  task: Task;
  onClose: () => void;
  onApproved?: () => void;
  onRejected?: () => void;
  onTaskUpdated?: (task: Task) => void;
}

// 解析 git diff --stat 摘要信息，以在离线或旧接口降级下也能呈现精准的增删徽章
function parseGitDiffSummary(rawSummary?: string) {
  if (!rawSummary) {
    return {
      fileStats: new Map<string, { additions: number; deletions: number }>(),
      totalAdd: 0,
      totalDel: 0,
      totalFiles: 0,
    };
  }
  const fileStats = new Map<string, { additions: number; deletions: number }>();
  let totalAdd = 0;
  let totalDel = 0;
  let totalFiles = 0;

  for (const rawLine of rawSummary.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.includes('changed') || line.includes('insertion') || line.includes('deletion')) {
      const fileMatch = line.match(/(\d+)\s+files?\s+changed/);
      const addMatch = line.match(/(\d+)\s+insertions?/);
      const delMatch = line.match(/(\d+)\s+deletions?/);
      if (fileMatch) totalFiles = parseInt(fileMatch[1], 10);
      if (addMatch) totalAdd = parseInt(addMatch[1], 10);
      if (delMatch) totalDel = parseInt(delMatch[1], 10);
      continue;
    }
    const parts = line.split('|');
    if (parts.length >= 2) {
      const filePath = parts[0].trim();
      const changePart = parts[1].trim();
      const numMatch = changePart.match(/^(\d+)\s*(.*)$/);
      if (numMatch) {
        const total = parseInt(numMatch[1], 10);
        const signs = numMatch[2] || '';
        const plusCount = (signs.match(/\+/g) || []).length;
        const minusCount = (signs.match(/-/g) || []).length;
        let additions = 0;
        let deletions = 0;
        if (plusCount + minusCount > 0) {
          additions = Math.round(total * (plusCount / (plusCount + minusCount)));
          deletions = total - additions;
        } else {
          additions = total;
        }
        fileStats.set(filePath, { additions, deletions });
      }
    }
  }
  return { fileStats, totalAdd, totalDel, totalFiles };
}

export const VisualAcceptanceModal: React.FC<VisualAcceptanceModalProps> = ({
  task,
  onClose,
  onApproved,
  onRejected,
  onTaskUpdated,
}) => {
  const [currentTask, setCurrentTask] = useState<Task>(task);
  const [run, setRun] = useState<QaRunRecord | null>(null);
  const [isLoadingRun, setIsLoadingRun] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isRerunning, setIsRerunning] = useState<boolean>(false);

  // 抽屉视图切换：'audit' (回放审计) | 'editor' (用例编辑)
  const [activeDrawerTab, setActiveDrawerTab] = useState<'audit' | 'editor'>('audit');

  // 用例编辑状态
  const [instructions, setInstructions] = useState<string[]>([]);
  const [rawTextMode, setRawTextMode] = useState<boolean>(false);
  const [rawInstructionsText, setRawInstructionsText] = useState<string>('');
  const [isCaseDirty, setIsCaseDirty] = useState<boolean>(false);
  const [isSavingCase, setIsSavingCase] = useState<boolean>(false);

  // 播放器状态
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isAiOverlayVisible, setIsAiOverlayVisible] = useState(true);
  const timerRef = useRef<any>(null);

  const [sandboxStatus, setSandboxStatus] = useState<'checking' | 'running' | 'stopped'>('checking');
  const [isStartingSandbox, setIsStartingSandbox] = useState<boolean>(false);

  // 代码变更 Diff 与审查模态框状态
  const [diffResult, setDiffResult] = useState<TaskWorktreeDiffResult | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState<boolean>(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState<boolean>(false);
  const [diffModalInitialFile, setDiffModalInitialFile] = useState<string | undefined>(undefined);

  const worktree: WorktreeContextInfo | undefined = currentTask.context?.worktree;
  const qaRunId = currentTask.context?.qaRunId || (worktree as any)?.qaRunId;

  // 同步外部 task 属性变更
  useEffect(() => {
    setCurrentTask(task);
    if (task.context?.worktree?.diffResult) {
      setDiffResult(task.context.worktree.diffResult);
    }
  }, [task]);

  // 异步获取最新的代码 Diff 详情与增删统计
  const fetchTaskDiff = useCallback(async () => {
    if (!currentTask.id || !currentTask.context?.worktree) return;
    setIsLoadingDiff(true);
    setDiffError(null);
    if (import.meta.env?.DEV) console.log(`[VisualAcceptanceModal:Diff] 异步拉取任务 [${currentTask.id}] 代码 Diff 详情`);
    try {
      const res = await api.getTaskWorktreeDiff(currentTask.id);
      if (res && res.hasWorktree) {
        setDiffResult(res);
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) console.warn('[VisualAcceptanceModal:Diff] 异步拉取 Diff 告警 (优雅降级):', err);
      setDiffError(err.message || '获取代码变更 Diff 失败');
    } finally {
      setIsLoadingDiff(false);
    }
  }, [currentTask.id, currentTask.context?.worktree]);

  useEffect(() => {
    fetchTaskDiff();
  }, [fetchTaskDiff]);

  // 探测沙箱靶机在线状态
  useEffect(() => {
    let active = true;
    if (task.context?.worktree) {
      if (import.meta.env?.DEV) console.log('[VisualAcceptanceModal:Sandbox] 探活靶机状态...');
      api.getTaskSandboxStatus(task.id)
        .then((res) => {
          if (active) setSandboxStatus(res.status === 'running' ? 'running' : 'stopped');
        })
        .catch(() => {
          if (active) setSandboxStatus('stopped');
        });
    }
    return () => {
      active = false;
    };
  }, [task.id, task.context?.worktree?.webPort]);

  const handleStopSandbox = async () => {
    try {
      if (import.meta.env?.DEV) console.log('[VisualAcceptanceModal:Sandbox] 关停靶机服务...');
      await api.stopTaskSandbox(task.id);
      setSandboxStatus('stopped');
      toast.info('沙箱靶机已关停，端口已释放');
    } catch (err: any) {
      toast.error(`关停靶机失败: ${err.message || '未知错误'}`);
    }
  };

  const handleStartOrOpenSandbox = async () => {
    const targetUrl = worktree?.targetUrl || (worktree?.webPort ? `http://localhost:${worktree.webPort}` : 'http://localhost');
    if (sandboxStatus === 'running') {
      window.open(targetUrl, '_blank');
      return;
    }

    try {
      setIsStartingSandbox(true);
      if (import.meta.env?.DEV) console.log('[VisualAcceptanceModal:Sandbox] 启动靶机服务...');
      const res = await api.startTaskSandbox(task.id);
      if (res.success || res.status === 'running') {
        setSandboxStatus('running');
        toast.success('沙箱靶机服务已就绪');
        window.open(res.targetUrl || targetUrl, '_blank');
      } else {
        toast.warning(res.message || '靶机服务启动超时');
        setSandboxStatus('stopped');
      }
    } catch (err: any) {
      toast.error(`启动靶机失败: ${err.message || '未知异常'}`);
      setSandboxStatus('stopped');
    } finally {
      setIsStartingSandbox(false);
    }
  };

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
        f.endsWith('/') ||
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

  // 解析历史与上下文中的 diffSummary，用于接口未生效时的无缝优雅降级
  const fallbackSummary = useMemo(() => {
    return parseGitDiffSummary(worktree?.diffSummary);
  }, [worktree?.diffSummary]);

  // 统一结构化改动文件列表（优先采用实时 diffResult，降级兜底采用 cleanChangedFiles + diffSummary 统计）
  const unifiedChangedFiles = useMemo(() => {
    if (diffResult && diffResult.files && diffResult.files.length > 0) {
      return diffResult.files;
    }
    return cleanChangedFiles.map((file) => {
      let additions = 0;
      let deletions = 0;
      for (const [pattern, stat] of fallbackSummary.fileStats.entries()) {
        const cleanPattern = pattern.replace(/^\.\.\.\//, '');
        if (file === pattern || file.endsWith(cleanPattern)) {
          additions = stat.additions;
          deletions = stat.deletions;
          break;
        }
      }
      return {
        file,
        status: 'modified' as const,
        additions,
        deletions,
        diff: '',
      };
    });
  }, [diffResult, cleanChangedFiles, fallbackSummary]);

  const totalInsertions = diffResult?.summary?.insertions ?? fallbackSummary.totalAdd;
  const totalDeletions = diffResult?.summary?.deletions ?? fallbackSummary.totalDel;

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

  // 胶片时间轴节点引用与自动居中
  const filmstripRef = useRef<HTMLDivElement>(null);
  const stepItemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // 精准手动切帧至指定索引
  const handleSeekTo = useCallback(
    (index: number) => {
      setIsPlaying(false);
      const targetIndex = Math.max(0, Math.min(steps.length - 1, index));
      if (import.meta.env?.DEV) {
        console.log('[VisualAcceptanceModal:Scrub] 手动切帧至:', targetIndex);
      }
      setCurrentStepIndex(targetIndex);
    },
    [steps.length]
  );

  const handlePrev = useCallback(() => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => {
      const next = Math.max(0, prev - 1);
      if (import.meta.env?.DEV && next !== prev) {
        console.log('[VisualAcceptanceModal:Scrub] 手动切至上一帧:', next);
      }
      return next;
    });
  }, []);

  const handleNext = useCallback(() => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => {
      const next = Math.min(steps.length - 1, prev + 1);
      if (import.meta.env?.DEV && next !== prev) {
        console.log('[VisualAcceptanceModal:Scrub] 手动切至下一帧:', next);
      }
      return next;
    });
  }, [steps.length]);

  const handleSeekFirst = useCallback(() => {
    handleSeekTo(0);
  }, [handleSeekTo]);

  const handleSeekLast = useCallback(() => {
    handleSeekTo(steps.length - 1);
  }, [handleSeekTo, steps.length]);

  const togglePlay = useCallback(() => {
    if (!isPlaying && currentStepIndex >= steps.length - 1) {
      setCurrentStepIndex(0);
    }
    setIsPlaying((prev) => !prev);
  }, [currentStepIndex, isPlaying, steps.length]);

  // 当前步变动时自动将对应的缩略图居中平滑显示
  useEffect(() => {
    const el = stepItemRefs.current.get(currentStepIndex);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentStepIndex]);

  // 鼠标滚轮/触控板手势切帧（基于阻尼累加器，丝滑且防止惯性瞬跳）
  const wheelAccumulatorRef = useRef<number>(0);
  const lastWheelTimeRef = useRef<number>(0);

  const handleViewportWheel = useCallback(
    (e: React.WheelEvent) => {
      if (steps.length <= 1) return;
      // 优先取绝对值较大的方向轴 (同时支持横向双指手势与纵向滚轮)
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 4) return;

      const now = performance.now();
      if (now - lastWheelTimeRef.current > 350) {
        wheelAccumulatorRef.current = 0;
      }
      lastWheelTimeRef.current = now;

      wheelAccumulatorRef.current += delta;
      const THRESHOLD = 35; // 阻尼阈值

      if (wheelAccumulatorRef.current >= THRESHOLD) {
        wheelAccumulatorRef.current = 0;
        setIsPlaying(false);
        setCurrentStepIndex((prev) => {
          const next = Math.min(steps.length - 1, prev + 1);
          if (import.meta.env?.DEV && next !== prev) {
            console.log('[VisualAcceptanceModal:Wheel] 滚轮切至下一帧:', next);
          }
          return next;
        });
      } else if (wheelAccumulatorRef.current <= -THRESHOLD) {
        wheelAccumulatorRef.current = 0;
        setIsPlaying(false);
        setCurrentStepIndex((prev) => {
          const next = Math.max(0, prev - 1);
          if (import.meta.env?.DEV && next !== prev) {
            console.log('[VisualAcceptanceModal:Wheel] 滚轮切至上一帧:', next);
          }
          return next;
        });
      }
    },
    [steps.length]
  );

  // 键盘快捷键监听 (方向键切帧、首尾帧跳转、翻页、空格播放/暂停、ESC 关闭)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && target.type !== 'range');
      if (isTextInput) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'Home') {
        e.preventDefault();
        handleSeekFirst();
      } else if (e.key === 'End') {
        e.preventDefault();
        handleSeekLast();
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        handleSeekTo(currentStepIndex - 5);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        handleSeekTo(currentStepIndex + 5);
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
  }, [handlePrev, handleNext, handleSeekFirst, handleSeekLast, handleSeekTo, currentStepIndex, togglePlay, onClose]);

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

  // 初始化/同步测试用例步骤列表
  useEffect(() => {
    if (isCaseDirty) return;
    let initialList: string[] = [];
    if (Array.isArray(currentTask.context?.qaInstructions) && currentTask.context.qaInstructions.length > 0) {
      initialList = [...currentTask.context.qaInstructions];
    } else if (Array.isArray(currentTask.context?.qaPlan?.steps) && currentTask.context.qaPlan.steps.length > 0) {
      initialList = [...currentTask.context.qaPlan.steps];
    } else if (run?.timeline && run.timeline.length > 0) {
      initialList = run.timeline.map((s) => s.prompt).filter(Boolean);
    } else if (steps.length > 0) {
      initialList = steps.map((s) => s.prompt).filter(Boolean);
    } else {
      initialList = [
        '等待页面完全加载，检查首屏主视觉元素',
        '定位核心交互按钮并触发点击',
        '校验页面无报错与异常提示',
      ];
    }
    setInstructions(initialList);
    setRawInstructionsText(initialList.join('\n'));
  }, [currentTask, run, steps, isCaseDirty]);

  const handleUpdateStepText = (index: number, newText: string) => {
    setIsCaseDirty(true);
    setInstructions((prev) => {
      const next = [...prev];
      next[index] = newText;
      return next;
    });
  };

  const handleAddStep = () => {
    setIsCaseDirty(true);
    setInstructions((prev) => [...prev, '']);
  };

  const handleRemoveStep = (index: number) => {
    setIsCaseDirty(true);
    setInstructions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveStep = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= instructions.length) return;
    setIsCaseDirty(true);
    setInstructions((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  };

  const handleResetInstructions = () => {
    let originalList: string[] = [];
    if (Array.isArray(currentTask.context?.qaInstructions) && currentTask.context.qaInstructions.length > 0) {
      originalList = [...currentTask.context.qaInstructions];
    } else if (Array.isArray(currentTask.context?.qaPlan?.steps) && currentTask.context.qaPlan.steps.length > 0) {
      originalList = [...currentTask.context.qaPlan.steps];
    } else if (run?.timeline && run.timeline.length > 0) {
      originalList = run.timeline.map((s) => s.prompt).filter(Boolean);
    } else {
      originalList = steps.map((s) => s.prompt).filter(Boolean);
    }
    setInstructions(originalList);
    setRawInstructionsText(originalList.join('\n'));
    setIsCaseDirty(false);
    toast.info('已恢复原始用例步骤');
  };

  const getCleanInstructions = (): string[] => {
    if (rawTextMode) {
      return rawInstructionsText
        .split('\n')
        .map((l) => l.replace(/^[-*•\d.]+\s*/, '').trim())
        .filter(Boolean);
    }
    return instructions.map((s) => s.trim()).filter(Boolean);
  };

  const handleSaveInstructionsOnly = async () => {
    const cleanList = getCleanInstructions();
    if (cleanList.length === 0) {
      toast.warning('用例至少需要包含 1 个有效步骤');
      return;
    }
    setIsSavingCase(true);
    if (import.meta.env?.DEV) {
      console.log('[VisualAcceptanceModal] 保存编辑后的用例:', { taskId: currentTask.id, steps: cleanList });
    }
    try {
      const updated = await api.updateTask(currentTask.id, {
        qaInstructions: cleanList,
        context: {
          qaInstructions: cleanList,
          qaPlan: {
            role: '用户定制验收用例',
            createdAt: Date.now(),
            steps: cleanList,
          },
        },
      });
      setCurrentTask(updated);
      setInstructions(cleanList);
      setRawInstructionsText(cleanList.join('\n'));
      setIsCaseDirty(false);
      onTaskUpdated?.(updated);
      toast.success('用例修改已保存');
    } catch (err: any) {
      toast.error(`保存用例失败: ${err.message}`);
    } finally {
      setIsSavingCase(false);
    }
  };

  // 重新跑测试 (支持传入最新编辑用例)
  const handleRerunTest = async (overrideInstructions?: string[]) => {
    if (isRerunning || isSubmitting) return;
    try {
      setIsRerunning(true);

      // 1. 如果用例有修改或显式传入新用例，先持久化最新用例
      const targetInstructions = overrideInstructions || (isCaseDirty ? getCleanInstructions() : null);
      if (targetInstructions && targetInstructions.length > 0) {
        if (import.meta.env?.DEV) {
          console.log('[VisualAcceptanceModal] 重跑前自动同步最新用例:', { taskId: currentTask.id, steps: targetInstructions });
        }
        try {
          const updated = await api.updateTask(currentTask.id, {
            qaInstructions: targetInstructions,
            context: {
              qaInstructions: targetInstructions,
              qaPlan: {
                role: '用户定制验收用例',
                createdAt: Date.now(),
                steps: targetInstructions,
              },
            },
          });
          setCurrentTask(updated);
          setInstructions(targetInstructions);
          setRawInstructionsText(targetInstructions.join('\n'));
          setIsCaseDirty(false);
          onTaskUpdated?.(updated);
        } catch (e: any) {
          if (import.meta.env?.DEV) console.warn('[VisualAcceptanceModal] 保存用例告警:', e);
        }
      }

      // 2. 探活或启动靶机沙箱
      if (sandboxStatus === 'stopped' && currentTask.context?.worktree) {
        try {
          if (import.meta.env?.DEV) console.log('[VisualAcceptanceModal] 靶机离线，自动唤醒靶机...');
          const sbRes = await api.startTaskSandbox(currentTask.id);
          if (sbRes.success || sbRes.status === 'running') {
            setSandboxStatus('running');
          }
        } catch (sbErr) {
          if (import.meta.env?.DEV) console.warn('[VisualAcceptanceModal] 尝试拉起靶机告警:', sbErr);
        }
      }

      // 3. 动态寻找 QA 测试节点 ID
      const testNodeId = (() => {
        const nr = currentTask.nodeRuns || {};
        const keys = Object.keys(nr);
        const match = keys.find((k) => k === 'node_qa_test' || k === 'node_midscene_test' || k.includes('qa') || k.includes('midscene'));
        return match || 'node_qa_test';
      })();

      if (import.meta.env?.DEV) {
        console.log('[VisualAcceptanceModal] 触发重跑 QA 自动化测试:', { taskId: currentTask.id, testNodeId });
      }

      const prevQaRunId = currentTask.context?.qaRunId;
      await api.retryNode(currentTask.id, testNodeId);
      toast.info('已重新启动 QA 自动化测试，AI 正在走查执行...');

      let pollCount = 0;
      const pollInterval = setInterval(async () => {
        pollCount++;
        try {
          const latestTask = await api.getTask(currentTask.id);
          const qaRunIdNew = latestTask.context?.qaRunId;
          const testNodeStatus = latestTask.nodeRuns?.[testNodeId]?.status;
          const taskStatus = latestTask.status;

          const isNodeFinished = testNodeStatus === 'success' || testNodeStatus === 'failed';
          const isTaskWaiting = taskStatus === 'waiting_approval' || taskStatus === 'failed';
          const isNewRunGenerated = Boolean(qaRunIdNew && qaRunIdNew !== prevQaRunId);

          if ((isNodeFinished || isTaskWaiting) && (isNewRunGenerated || pollCount >= 3)) {
            clearInterval(pollInterval);
            setIsRerunning(false);
            setCurrentTask(latestTask);
            onTaskUpdated?.(latestTask);

            if (qaRunIdNew) {
              const res = await api.getQaRunById(qaRunIdNew);
              if (res) {
                setRun(res);
                setCurrentStepIndex(0);
              }
            }

            if (testNodeStatus === 'failed' || taskStatus === 'failed') {
              toast.warning('测试执行完毕，部分断言未通过，请查看执行截帧与报错');
            } else {
              toast.success('自动化测试已完成，最新截帧已就绪！');
            }
            setActiveDrawerTab('audit');
            return;
          }
        } catch {}

        if (pollCount > 60) {
          clearInterval(pollInterval);
          setIsRerunning(false);
          toast.warning('测试执行轮询超时，请稍后刷新重试');
        }
      }, 1500);
    } catch (err: any) {
      toast.error(`重新跑测试失败: ${err.message}`);
      setIsRerunning(false);
    }
  };

  const handleSaveAndRerun = async () => {
    const cleanList = getCleanInstructions();
    if (cleanList.length === 0) {
      toast.warning('用例至少需要包含 1 个有效步骤');
      return;
    }
    await handleRerunTest(cleanList);
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
        <div className="h-[50px] bg-white border-b border-[#e3e3e8] px-5 flex items-center justify-between gap-4 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-6 h-6 rounded-[5px] bg-[#f4f4f6] border border-[#e3e3e8]/70 flex items-center justify-center text-[#1c1c21] shrink-0">
              <Camera size={13} strokeWidth={2.2} />
            </div>

            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h2 className="text-[13px] font-semibold text-[#1c1c21] truncate shrink min-w-0" title={task.title}>
                {task.title}
              </h2>

              <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#71717a] text-[10.5px] font-medium border border-[#e3e3e8] shrink-0 whitespace-nowrap">
                视觉验收门禁
              </span>

              {worktree?.branchName && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10.5px] font-mono border border-[#bfdbfe]/60 shrink-0 max-w-[200px]"
                  title={worktree.branchName}
                >
                  <GitBranch size={10} className="shrink-0" />
                  <span className="truncate">{worktree.branchName}</span>
                </span>
              )}

              {/* 冲突自愈微徽标 */}
              {worktree?.conflictResolution && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0] shrink-0 whitespace-nowrap"
                  title={`已由 Agent 自动消解冲突文件:\n${worktree.conflictResolution.conflictFiles.join('\n')}`}
                >
                  <Sparkles size={10} className="text-[#059669] shrink-0" />
                  <span className="whitespace-nowrap">冲突已自愈 ({worktree.conflictResolution.conflictFiles.length})</span>
                </span>
              )}

              {/* 状态微徽章 */}
              {isPassed ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60 shrink-0 whitespace-nowrap">
                  <CheckCircle2 size={10} strokeWidth={2.2} className="shrink-0" />
                  <span className="whitespace-nowrap">PASSED</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60 shrink-0 whitespace-nowrap">
                  <XCircle size={10} strokeWidth={2.2} className="shrink-0" />
                  <span className="whitespace-nowrap">FAILED</span>
                </span>
              )}
            </div>
          </div>

          {/* 右侧微操作群：绝对禁止压缩与折行 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 靶机微交互直达/一键唤醒与关停按钮群 */}
            {worktree && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleStartOrOpenSandbox}
                  disabled={isStartingSandbox}
                  className={`h-[28px] px-2.5 rounded-[6px] text-[11.5px] font-medium flex items-center gap-1.5 border shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-60 shrink-0 whitespace-nowrap ${
                    sandboxStatus === 'running'
                      ? 'bg-white hover:bg-[#fafafc] text-[#1c1c21] border-[#e3e3e8]'
                      : isStartingSandbox
                      ? 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]'
                      : 'bg-[#1c1c21] hover:bg-[#2e2f36] text-white border-transparent'
                  }`}
                  title={
                    sandboxStatus === 'running'
                      ? '沙箱靶机在线，点击在新标签页打开'
                      : isStartingSandbox
                      ? '正在拉起靶机 dev server...'
                      : '靶机离线，点击一键唤醒服务'
                  }
                >
                  {isStartingSandbox ? (
                    <Loader2 size={12} className="animate-spin text-[#b45309] shrink-0" />
                  ) : sandboxStatus === 'running' ? (
                    <Globe size={12} className="text-[#059669] shrink-0" />
                  ) : (
                    <Play size={10} className="fill-current text-white shrink-0" />
                  )}
                  <span className="whitespace-nowrap">
                    {isStartingSandbox
                      ? '正在唤醒靶机...'
                      : sandboxStatus === 'running'
                      ? `打开沙箱靶机${worktree?.webPort ? ` (${worktree.webPort})` : ''}`
                      : `启动沙箱靶机${worktree?.webPort ? ` (${worktree.webPort})` : ''}`}
                  </span>
                  {sandboxStatus === 'running' && <ExternalLink size={10} className="text-[#85858d] shrink-0" />}
                </button>

                {/* 在线时展示一键关停微按钮 */}
                {sandboxStatus === 'running' && (
                  <button
                    type="button"
                    onClick={handleStopSandbox}
                    className="h-[28px] px-2 rounded-[6px] bg-white hover:bg-[#fef2f2] text-[#71717a] hover:text-[#dc2626] border border-[#e3e3e8] hover:border-[#fecaca] text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                    title="立即关停沙箱靶机，释放端口与系统资源"
                  >
                    <Square size={9} className="fill-current text-[#dc2626] shrink-0" />
                    <span className="whitespace-nowrap">关停</span>
                  </button>
                )}
              </div>
            )}

            {/* AI 热区开关 */}
            <button
              type="button"
              onClick={() => setIsAiOverlayVisible(!isAiOverlayVisible)}
              className={`h-[28px] px-2.5 rounded-[6px] text-[11.5px] font-medium flex items-center gap-1.5 border transition-all cursor-pointer shrink-0 whitespace-nowrap ${
                isAiOverlayVisible
                  ? 'bg-white text-[#1c1c21] border-[#1c1c21]/20 shadow-2xs'
                  : 'bg-transparent text-[#71717a] border-transparent hover:bg-[#ececf0]'
              }`}
            >
              <Eye size={12} className="shrink-0" />
              <span className="whitespace-nowrap">AI 焦点标注</span>
            </button>

            {/* 关闭按钮 */}
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-[5px] text-[#71717a] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer ml-1 shrink-0"
              title="关闭 (Esc)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 主内容区域：左侧截帧渲染 + 右侧审计抽屉 */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* 左侧：截帧显示区（浅冷灰基底承载高质感白底 Mac 视窗容器） */}
          <div className="flex-1 relative flex items-center justify-center p-4 bg-[#ebebf0] overflow-hidden">
            {isLoadingRun ? (
              <div className="flex flex-col items-center justify-center text-[#71717a] gap-2">
                <Loader2 size={22} className="animate-spin text-[#1c1c21]" />
                <span className="text-[12px]">正在加载 UI 自动化截帧序列...</span>
              </div>
            ) : imageUrl ? (
              <div className="w-full h-full max-w-full max-h-full rounded-[8px] border border-[#d8d8de] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.08)] flex flex-col overflow-hidden animate-in fade-in duration-100">
                {/* 拟态原生 Mac 视窗标题栏 */}
                <div className="h-[28px] bg-[#fafafc] border-b border-[#e3e3e8] px-3 flex items-center justify-between shrink-0 select-none">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] border border-[#e0443e]/40 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-[#dea123]/40 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] border border-[#1aab29]/40 inline-block" />
                  </div>

                  <button
                    type="button"
                    onClick={handleStartOrOpenSandbox}
                    className="flex items-center gap-1.5 text-[10.5px] font-mono text-[#71717a] hover:text-[#1c1c21] bg-white hover:bg-[#fafafc] border border-[#e3e3e8]/80 hover:border-[#b9b9c2] px-2.5 py-[2px] rounded-[4px] shadow-3xs max-w-[340px] truncate transition-colors cursor-pointer group"
                    title={sandboxStatus === 'running' ? '点击在新窗口打开靶机预览' : '靶机离线，点击一键唤醒并打开'}
                  >
                    {sandboxStatus === 'running' ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#059669] shrink-0" />
                    ) : isStartingSandbox ? (
                      <Loader2 size={10} className="animate-spin text-[#b45309] shrink-0" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#a1a1aa] shrink-0" />
                    )}
                    <Globe size={10} className="text-[#85858d] group-hover:text-[#4f46e5] shrink-0 transition-colors" />
                    <span className="truncate">{worktree?.targetUrl || (worktree?.webPort ? `http://localhost:${worktree.webPort}/` : 'http://localhost/')}</span>
                    <ExternalLink size={9} className="opacity-60 group-hover:opacity-100 transition-opacity" />
                  </button>

                  <div className="flex items-center gap-2 text-[10px] font-mono text-[#85858d]">
                    <span className="hidden sm:inline-block text-[#a1a1aa]">滚轮或 ← → 切帧</span>
                    <span className="bg-[#f4f4f6] px-1.5 py-0.5 rounded border border-[#e3e3e8] font-medium text-[#1c1c21]">
                      {currentStepIndex + 1}/{steps.length}
                    </span>
                  </div>
                </div>

                {/* 截图承载视口 (支持悬浮切帧按钮与滚轮手势切帧) */}
                <div
                  className="relative flex-1 min-h-0 flex items-center justify-center bg-[#fbfbfc] overflow-hidden group/viewport"
                  onWheel={handleViewportWheel}
                >
                  <img
                    src={imageUrl}
                    alt={`Step ${currentStepIndex + 1}`}
                    className="max-w-full max-h-full object-contain block select-none"
                    decoding="async"
                  />

                  {/* 悬浮上一帧切换按钮 */}
                  {steps.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrev();
                      }}
                      disabled={currentStepIndex === 0}
                      className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-[#1c1c21] shadow-md border border-[#e3e3e8] backdrop-blur-[4px] flex items-center justify-center transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-0 disabled:pointer-events-none opacity-0 group-hover/viewport:opacity-90 hover:!opacity-100"
                      title="上一帧 (←)"
                    >
                      <ChevronLeft size={16} strokeWidth={2.2} />
                    </button>
                  )}

                  {/* 悬浮下一帧切换按钮 */}
                  {steps.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNext();
                      }}
                      disabled={currentStepIndex >= steps.length - 1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-[#1c1c21] shadow-md border border-[#e3e3e8] backdrop-blur-[4px] flex items-center justify-center transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-0 disabled:pointer-events-none opacity-0 group-hover/viewport:opacity-90 hover:!opacity-100"
                      title="下一帧 (→)"
                    >
                      <ChevronRight size={16} strokeWidth={2.2} />
                    </button>
                  )}

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

                  {/* 当前步骤说明微胶囊 */}
                  {currentStep && (
                    <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-10 max-w-[85%] px-2.5 py-1 rounded-[5px] bg-[#1c1c21]/80 hover:bg-[#1c1c21]/95 text-white backdrop-blur-[6px] shadow-sm flex items-center gap-2 pointer-events-auto transition-all text-[11px] select-none truncate">
                      <span className="font-mono text-[10px] text-[#a5b4fc] shrink-0 font-medium">
                        #{currentStepIndex + 1}
                      </span>
                      <span className="truncate text-[#f4f4f6]">{currentStep.prompt}</span>
                      {currentStep.status === 'passed' ? (
                        <CheckCircle2 size={11} className="text-[#34d399] shrink-0" />
                      ) : (
                        <XCircle size={11} className="text-[#f87171] shrink-0" />
                      )}
                    </div>
                  )}

                  {/* AI 正在重跑自动化测试时的半透明蒙层 */}
                  {isRerunning && (
                    <div className="absolute inset-0 z-20 bg-black/40 backdrop-blur-[2px] flex flex-col items-center justify-center text-white p-4 animate-in fade-in duration-200">
                      <div className="px-4 py-3 bg-[#18181b]/95 border border-[#3f3f46] rounded-[10px] shadow-2xl flex items-center gap-3 max-w-sm">
                        <Loader2 size={18} className="animate-spin text-[#818cf8] shrink-0" />
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-white tracking-tight">AI 正在按新用例执行自动化测试...</div>
                          <div className="text-[10.5px] text-[#a1a1aa] truncate mt-0.5">操控靶机浏览器走查交互与捕获动态截帧</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 底部帧胶片序列时间轴 (Filmstrip Track) */}
                {steps.length > 0 && (
                  <div className="h-[74px] bg-[#fafafc] border-t border-[#e3e3e8] px-3 flex items-center gap-2 shrink-0 select-none overflow-hidden">
                    <button
                      type="button"
                      onClick={handleSeekFirst}
                      disabled={currentStepIndex === 0}
                      className="w-6 h-6 rounded-[4px] bg-white hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] border border-[#e3e3e8] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                      title="跳到首帧 (Home)"
                    >
                      <ChevronsLeft size={12} />
                    </button>

                    <div
                      ref={filmstripRef}
                      className="flex-1 flex items-center gap-2 overflow-x-auto py-1 scroll-smooth"
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                      {steps.map((st, idx) => {
                        const isCurrent = idx === currentStepIndex;
                        const thumbUrl = st.screenshotUrl
                          ? api.getArtifactUrl(st.screenshotUrl)
                          : st.screenshotRelPath
                          ? api.getArtifactUrl(st.screenshotRelPath)
                          : '';

                        return (
                          <div
                            key={st.stepId || idx}
                            ref={(el) => {
                              if (el) stepItemRefs.current.set(idx, el);
                              else stepItemRefs.current.delete(idx);
                            }}
                            onClick={() => handleSeekTo(idx)}
                            className={`group/thumb relative w-[68px] h-[48px] rounded-[5px] shrink-0 cursor-pointer overflow-hidden transition-all duration-150 border ${
                              isCurrent
                                ? 'border-[#4f46e5] ring-2 ring-[#4f46e5]/30 shadow-xs scale-102 bg-white'
                                : 'border-[#e3e3e8] bg-[#f4f4f6] opacity-70 hover:opacity-100 hover:border-[#b9b9c2]'
                            }`}
                            title={`第 ${idx + 1} 步: ${st.prompt}`}
                          >
                            {thumbUrl ? (
                              <img
                                src={thumbUrl}
                                alt={`Frame ${idx + 1}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-[#f4f4f6] text-[#85858d] text-[9px] font-mono">
                                无快照
                              </div>
                            )}

                            {/* 帧号角标 */}
                            <div className="absolute top-0 left-0 px-1 py-0.2 rounded-br-[4px] bg-black/60 backdrop-blur-[1px] text-white text-[9px] font-mono font-medium leading-none">
                              #{idx + 1}
                            </div>

                            {/* 状态指示 */}
                            <div className="absolute top-1 right-1">
                              <span
                                className={`w-1.5 h-1.5 rounded-full block ${
                                  st.status === 'passed' ? 'bg-[#10b981]' : 'bg-[#ef4444]'
                                }`}
                              />
                            </div>

                            {/* 激活指示底条 */}
                            {isCurrent && (
                              <div className="absolute bottom-0 inset-x-0 h-[2.5px] bg-[#4f46e5]" />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={handleSeekLast}
                      disabled={currentStepIndex === steps.length - 1}
                      className="w-6 h-6 rounded-[4px] bg-white hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] border border-[#e3e3e8] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                      title="跳到尾帧 (End)"
                    >
                      <ChevronsRight size={12} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-[#85858d] gap-2">
                <Camera size={32} className="opacity-40" />
                <p className="text-[12px]">当前步骤无快照图像</p>
              </div>
            )}
          </div>

          {/* 右侧：审计与用例编辑抽屉 */}
          <div className="w-[350px] bg-white border-l border-[#e3e3e8] flex flex-col shrink-0 select-none">
            {/* 顶栏：Tab 切换与状态微徽标 */}
            <div className="h-[44px] px-3.5 border-b border-[#e3e3e8] flex items-center justify-between shrink-0 bg-[#fafafc]">
              <div className="flex items-center bg-[#ececf0] p-0.5 rounded-[6px] border border-[#e3e3e8]/60">
                <button
                  type="button"
                  onClick={() => {
                    if (import.meta.env?.DEV) console.log('[VisualAcceptanceModal] 切换至回放审计');
                    setActiveDrawerTab('audit');
                  }}
                  className={`px-2.5 py-1 rounded-[4px] text-[11px] font-medium transition-all cursor-pointer ${
                    activeDrawerTab === 'audit'
                      ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                      : 'text-[#71717a] hover:text-[#1c1c21]'
                  }`}
                >
                  回放审计
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (import.meta.env?.DEV) console.log('[VisualAcceptanceModal] 切换至用例编辑');
                    setActiveDrawerTab('editor');
                  }}
                  className={`px-2.5 py-1 rounded-[4px] text-[11px] font-medium transition-all flex items-center gap-1 cursor-pointer ${
                    activeDrawerTab === 'editor'
                      ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                      : 'text-[#71717a] hover:text-[#1c1c21]'
                  }`}
                >
                  <Edit3 size={10} />
                  <span>用例编辑</span>
                  {instructions.length > 0 && (
                    <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-[#e3e3e8] text-[#52525b]">
                      {instructions.length}
                    </span>
                  )}
                  {isCaseDirty && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5]" title="有未保存修改" />
                  )}
                </button>
              </div>

              {activeDrawerTab === 'audit' ? (
                currentStep?.status === 'passed' ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
                    <CheckCircle2 size={10} strokeWidth={2.2} />
                    <span>PASSED</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60">
                    <XCircle size={10} strokeWidth={2.2} />
                    <span>FAILED</span>
                  </span>
                )
              ) : (
                <div className="flex items-center gap-1.5">
                  {isCaseDirty && (
                    <button
                      type="button"
                      onClick={handleResetInstructions}
                      className="text-[10px] text-[#71717a] hover:text-[#1c1c21] flex items-center gap-0.5 cursor-pointer px-1.5 py-0.5 rounded hover:bg-[#ececf0] transition-colors"
                      title="放弃修改，恢复原始用例"
                    >
                      <Undo2 size={10} />
                      <span>重置</span>
                    </button>
                  )}
                  <span className="text-[10.5px] font-mono text-[#85858d]">
                    {instructions.length} 步
                  </span>
                </div>
              )}
            </div>

            {/* 滚动内容区域 */}
            {activeDrawerTab === 'audit' ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-[12px]">
                {/* 卡片 1: 当前操作指令 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-[#71717a]">
                      当前操作指令 ({steps.length > 0 ? `步骤 ${currentStepIndex + 1}/${steps.length}` : '0'})
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (import.meta.env?.DEV) console.log('[VisualAcceptanceModal] 从操作指令直达用例编辑');
                        setActiveDrawerTab('editor');
                      }}
                      className="text-[10.5px] text-[#4f46e5] hover:text-[#4338ca] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                      title="编辑测试用例指令"
                    >
                      <Edit3 size={10} />
                      <span>编辑用例</span>
                    </button>
                  </div>
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
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-[#71717a] flex items-center gap-1">
                        <Layers size={11} className="text-[#63636b]" />
                        执行时间轴 ({steps.length} 步)
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (import.meta.env?.DEV) console.log('[VisualAcceptanceModal] 从时间轴直达用例编辑');
                          setActiveDrawerTab('editor');
                        }}
                        className="text-[10px] text-[#4f46e5] hover:text-[#4338ca] font-medium flex items-center gap-0.5 cursor-pointer"
                      >
                        <Edit3 size={9.5} />
                        <span>编辑用例</span>
                      </button>
                    </div>
                    <div className="bg-[#fafafc] border border-[#e3e3e8] rounded-[6px] divide-y divide-[#f1f1f4] max-h-[140px] overflow-y-auto">
                      {steps.map((st, idx) => {
                        const isCurrent = idx === currentStepIndex;
                        return (
                          <div
                            key={st.stepId || idx}
                            onClick={() => handleSeekTo(idx)}
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

                {/* 卡片 4: 本次迭代变更文件（极致优雅代码变更审计与 Diff 审查直达） */}
                {unifiedChangedFiles.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5 gap-2 select-none">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <GitCommitHorizontal size={12} className="text-[#63636b] shrink-0" />
                        <span className="text-[11px] font-medium text-[#71717a] shrink-0">
                          变更代码文件
                        </span>
                        <span className="font-mono text-[9.5px] px-1 py-0.2 rounded bg-[#f4f4f6] text-[#52525b] border border-[#e3e3e8] shrink-0">
                          {unifiedChangedFiles.length}
                        </span>
                        {totalInsertions > 0 && (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded-[3px] bg-[#ecfdf5] text-[#059669] text-[9.5px] font-mono font-medium border border-[#a7f3d0]/60 shrink-0">
                            <Plus size={8} strokeWidth={2.4} />
                            <span>{totalInsertions}</span>
                          </span>
                        )}
                        {totalDeletions > 0 && (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded-[3px] bg-[#fef2f2] text-[#dc2626] text-[9.5px] font-mono font-medium border border-[#fecaca]/60 shrink-0">
                            <Minus size={8} strokeWidth={2.4} />
                            <span>{totalDeletions}</span>
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (import.meta.env?.DEV) console.log('[VisualAcceptanceModal] 打开完整代码 Diff 审查');
                          setDiffModalInitialFile(undefined);
                          setIsDiffModalOpen(true);
                        }}
                        className="text-[10px] text-[#4f46e5] hover:text-[#4338ca] hover:bg-[#eeedfd] px-1.5 py-0.5 rounded-[4px] font-medium flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                        title="查看完整代码 Diff"
                      >
                        <Eye size={10} />
                        <span>查看 Diff</span>
                      </button>
                    </div>

                    <div className="bg-white border border-[#e3e3e8] rounded-[6px] divide-y divide-[#f1f1f4] max-h-[150px] overflow-y-auto shadow-3xs">
                      {unifiedChangedFiles.map((item, i) => {
                        const parts = item.file.split('/');
                        const fileName = parts.pop() || item.file;
                        const fileDir = parts.length > 0 ? parts.join('/') + '/' : '';

                        return (
                          <div
                            key={item.file || i}
                            onClick={() => {
                              if (import.meta.env?.DEV) console.log(`[VisualAcceptanceModal] 点击文件直达 Diff: ${item.file}`);
                              setDiffModalInitialFile(item.file);
                              setIsDiffModalOpen(true);
                            }}
                            className="group px-2.5 py-1.5 flex items-center justify-between text-[11px] hover:bg-[#fafafc] transition-colors cursor-pointer select-none"
                            title={`点击查看 ${item.file} 的代码 Diff`}
                          >
                            <div className="flex items-center gap-2 min-w-0 pr-2">
                              <div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] group-hover:bg-white flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60 group-hover:border-[#e3e3e8] transition-colors">
                                <FileCode2 size={11} strokeWidth={2} />
                              </div>
                              <div className="truncate flex items-baseline gap-1 min-w-0">
                                <span className="font-medium text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors truncate">
                                  {fileName}
                                </span>
                                {fileDir && (
                                  <span className="font-mono text-[9.5px] text-[#85858d] truncate">
                                    {fileDir}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {(item.additions > 0 || item.deletions > 0) && (
                                <div className="flex items-center gap-1 font-mono text-[9.5px]">
                                  {item.additions > 0 && (
                                    <span className="text-[#059669]">+{item.additions}</span>
                                  )}
                                  {item.deletions > 0 && (
                                    <span className="text-[#dc2626]">-{item.deletions}</span>
                                  )}
                                </div>
                              )}
                              <div className="w-4 h-4 rounded text-[#85858d] group-hover:text-[#4f46e5] flex items-center justify-center opacity-40 group-hover:opacity-100 transition-opacity">
                                <ChevronRight size={11} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 p-3.5 space-y-3">
                {/* 模式切换与提示 */}
                <div className="flex items-center justify-between text-[11px] pb-2 border-b border-[#f1f1f4] shrink-0">
                  <div className="flex items-center gap-1.5 text-[#63636b]">
                    <Target size={12} className="text-[#4f46e5]" />
                    <span className="font-medium text-[#1c1c21]">验收步骤列表</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!rawTextMode) {
                        setRawInstructionsText(instructions.join('\n'));
                      } else {
                        const parsed = rawInstructionsText
                          .split('\n')
                          .map((l) => l.replace(/^[-*•\d.]+\s*/, '').trim())
                          .filter(Boolean);
                        setInstructions(parsed.length > 0 ? parsed : ['等待页面完全加载，检查首屏主视觉元素']);
                      }
                      setRawTextMode(!rawTextMode);
                    }}
                    className="text-[10.5px] text-[#4f46e5] hover:text-[#4338ca] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    {rawTextMode ? '切换为步骤卡片' : '切换为多行文本'}
                  </button>
                </div>

                {/* 编辑主区域 */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                  {rawTextMode ? (
                    <div className="space-y-1.5 h-full flex flex-col">
                      <p className="text-[10.5px] text-[#85858d] leading-relaxed">
                        每行一条自然语言操作或断言指令。AI 浏览器 Agent 将严格按序执行测试与截帧。
                      </p>
                      <textarea
                        value={rawInstructionsText}
                        onChange={(e) => {
                          setRawInstructionsText(e.target.value);
                          setIsCaseDirty(true);
                        }}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                            e.preventDefault();
                            handleSaveAndRerun();
                          }
                        }}
                        rows={10}
                        placeholder="例如：&#10;等待页面完全加载，检查首屏主视觉元素&#10;定位核心交互按钮并触发点击&#10;校验页面无报错与异常提示"
                        className="w-full flex-1 bg-[#f9f9fb] focus:bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[6px] p-2.5 text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none font-mono resize-none transition-all leading-relaxed shadow-3xs"
                      />
                      <span className="text-[10px] text-[#a1a1aa] font-mono">
                        快捷键: ⌘+Enter / Ctrl+Enter 立即保存并让 AI 重跑
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {instructions.map((inst, idx) => {
                        const isAssert =
                          inst.includes('检查') ||
                          inst.includes('校验') ||
                          inst.includes('验证') ||
                          inst.includes('是否') ||
                          inst.includes('断言');
                        return (
                          <div
                            key={idx}
                            className="p-2.5 rounded-[6px] bg-[#fafafc] border border-[#e3e3e8] hover:border-[#c7d2fe] transition-all group/step space-y-1.5 shadow-3xs"
                          >
                            <div className="flex items-center justify-between text-[10.5px]">
                              <span className="font-mono font-medium text-[#71717a] flex items-center gap-1.5">
                                <span className="w-4 h-4 rounded-[3px] bg-[#ececf0] text-[#1c1c21] text-[9.5px] font-bold flex items-center justify-center">
                                  {idx + 1}
                                </span>
                                <span
                                  className={`text-[9.5px] px-1 py-0.2 rounded font-medium ${
                                    isAssert
                                      ? 'bg-[#eff6ff] text-[#2563eb] border border-[#bfdbfe]/50'
                                      : 'bg-[#f4f4f6] text-[#52525b] border border-[#e3e3e8]'
                                  }`}
                                >
                                  {isAssert ? '断言判定' : '动作执行'}
                                </span>
                              </span>
                              <div className="flex items-center gap-1 opacity-60 group-hover/step:opacity-100 transition-opacity">
                                {idx > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveStep(idx, -1)}
                                    className="w-5 h-5 rounded hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] flex items-center justify-center transition-colors cursor-pointer"
                                    title="上移此步"
                                  >
                                    <ArrowUp size={10.5} />
                                  </button>
                                )}
                                {idx < instructions.length - 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveStep(idx, 1)}
                                    className="w-5 h-5 rounded hover:bg-[#ececf0] text-[#71717a] hover:text-[#1c1c21] flex items-center justify-center transition-colors cursor-pointer"
                                    title="下移此步"
                                  >
                                    <ArrowDown size={10.5} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveStep(idx)}
                                  className="w-5 h-5 rounded hover:bg-[#fee2e2] text-[#85858d] hover:text-[#dc2626] flex items-center justify-center transition-colors cursor-pointer"
                                  title="删除此步"
                                >
                                  <Trash2 size={10.5} />
                                </button>
                              </div>
                            </div>

                            <textarea
                              value={inst}
                              onChange={(e) => handleUpdateStepText(idx, e.target.value)}
                              onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveAndRerun();
                                }
                              }}
                              rows={2}
                              placeholder="输入自然语言测试步骤或断言指令..."
                              className="w-full bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[4px] p-2 text-[11.5px] text-[#1c1c21] placeholder-[#85858d] outline-none resize-none transition-all leading-relaxed shadow-3xs"
                            />
                          </div>
                        );
                      })}

                      {/* 添加步骤 */}
                      <button
                        type="button"
                        onClick={handleAddStep}
                        className="w-full h-[30px] rounded-[6px] border border-dashed border-[#d1d1d6] hover:border-[#4f46e5] hover:bg-[#eeedfd]/40 text-[#63636b] hover:text-[#4f46e5] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Plus size={11} strokeWidth={2.4} />
                        <span>添加用例步骤</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 用例编辑抽屉底部操作条 */}
                <div className="pt-2.5 border-t border-[#f1f1f4] flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={isSavingCase || isRerunning}
                    onClick={handleSaveInstructionsOnly}
                    className="flex-1 h-[30px] rounded-[6px] bg-white hover:bg-[#fafafc] border border-[#e3e3e8] text-[#1c1c21] text-[11.5px] font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-3xs disabled:opacity-50"
                  >
                    <Check size={11} strokeWidth={2.2} />
                    <span>{isSavingCase ? '保存中...' : '仅保存用例'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSavingCase || isRerunning}
                    onClick={handleSaveAndRerun}
                    className="flex-1 h-[30px] rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95 disabled:opacity-50"
                    title="保存用例并让 AI 重新执行自动化测试 (⌘+Enter)"
                  >
                    {isRerunning ? (
                      <>
                        <Loader2 size={12} className="animate-spin text-white" />
                        <span>AI 测试中...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={12} className="text-[#a5b4fc]" />
                        <span>让 AI 重新跑</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部播放控制与【验收通过并合并】决策工具栏（高 54px，白底微边框） */}
        <div className="h-[54px] bg-white border-t border-[#e3e3e8] px-5 flex items-center justify-between gap-5 shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.02)]">
          {/* 左侧播放控制器 */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleSeekFirst}
              disabled={currentStepIndex === 0 || steps.length <= 1}
              className="w-7 h-7 rounded-[5px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="首帧 (Home)"
            >
              <ChevronsLeft size={13} />
            </button>

            <button
              type="button"
              onClick={handlePrev}
              disabled={currentStepIndex === 0 || steps.length <= 1}
              className="w-7 h-7 rounded-[5px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="上一帧 (←)"
            >
              <SkipBack size={13} />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={steps.length <= 1}
              className="w-8 h-8 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white flex items-center justify-center shadow-xs transition-transform active:scale-95 cursor-pointer disabled:opacity-40 shrink-0"
              title={isPlaying ? '暂停 (空格)' : '连续播放 (空格)'}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={handleNext}
              disabled={currentStepIndex === steps.length - 1 || steps.length <= 1}
              className="w-7 h-7 rounded-[5px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="下一帧 (→)"
            >
              <SkipForward size={13} />
            </button>

            <button
              type="button"
              onClick={handleSeekLast}
              disabled={currentStepIndex === steps.length - 1 || steps.length <= 1}
              className="w-7 h-7 rounded-[5px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="末帧 (End)"
            >
              <ChevronsRight size={13} />
            </button>

            {/* 倍速切换微胶囊 */}
            <div className="flex items-center bg-[#ececf0] rounded-[5px] p-0.5 border border-[#e3e3e8]/70 ml-2 shrink-0">
              {[1, 1.5, 2].map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setPlaybackSpeed(spd)}
                  className={`px-1.5 py-0.5 text-[10.5px] font-mono rounded-[3px] transition-colors cursor-pointer shrink-0 ${
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

          {/* 中间进度条拖拽与百分比 */}
          <div className="flex-1 max-w-lg mx-3 flex items-center gap-3 min-w-0">
            <span className="text-[11px] font-mono text-[#85858d] shrink-0 font-medium">
              {steps.length > 0 ? `${currentStepIndex + 1} / ${steps.length}` : '0/0'}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, steps.length - 1)}
              value={currentStepIndex}
              onChange={(e) => {
                handleSeekTo(Number(e.target.value));
              }}
              disabled={steps.length <= 1}
              className="flex-1 accent-[#1c1c21] h-1.5 bg-[#e3e3e8] rounded-lg cursor-pointer"
            />
            <span className="hidden sm:inline-block text-[10.5px] text-[#85858d] font-mono shrink-0 whitespace-nowrap">
              {steps.length > 0 ? `${Math.round(((currentStepIndex + 1) / steps.length) * 100)}%` : '0%'}
            </span>
          </div>

          {/* 右侧核心决策按钮群 */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isSubmitting || isRerunning}
              onClick={() => handleRerunTest()}
              className="h-[30px] px-3 rounded-[6px] bg-white hover:bg-[#fafafc] border border-[#e3e3e8] text-[#1c1c21] text-[11.5px] font-medium flex items-center gap-1.5 transition-all active:scale-95 shadow-2xs cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
              title="按当前测试用例重新执行自动化测试与截帧"
            >
              <RotateCcw size={12} className={isRerunning ? 'animate-spin shrink-0' : 'shrink-0'} />
              <span className="whitespace-nowrap">{isRerunning ? '测试执行中...' : '重新跑测试'}</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting || isRerunning}
              onClick={handleReject}
              className="h-[30px] px-3 rounded-[6px] bg-white hover:bg-[#fef2f2] border border-[#fecaca] text-[#dc2626] text-[11.5px] font-medium flex items-center gap-1.5 transition-all active:scale-95 shadow-2xs cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
            >
              <span className="whitespace-nowrap">驳回</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting || isRerunning}
              onClick={handleApproveAndMerge}
              className="h-[30px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium flex items-center gap-1.5 transition-all active:scale-95 shadow-xs cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={13} className="animate-spin shrink-0" />
                  <span className="whitespace-nowrap">正在合并并清理...</span>
                </>
              ) : (
                <>
                  <GitMerge size={13} className="shrink-0" />
                  <span className="whitespace-nowrap">验收通过并合并至主分支</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 代码变更审查模态框 (Diff Review) */}
      {isDiffModalOpen && (
        <CodeDiffViewerModal
          diffResult={
            diffResult || {
              hasWorktree: Boolean(worktree?.worktreeDir),
              branchName: worktree?.branchName,
              baseBranch: worktree?.baseBranch,
              summary: {
                filesChanged: unifiedChangedFiles.length,
                insertions: totalInsertions,
                deletions: totalDeletions,
              },
              files: unifiedChangedFiles,
            }
          }
          taskTitle={currentTask.title}
          initialFile={diffModalInitialFile}
          isLoading={isLoadingDiff}
          error={diffError}
          onRetry={fetchTaskDiff}
          onClose={() => setIsDiffModalOpen(false)}
        />
      )}
    </div>
  );
};
