import React, { useMemo, useState } from 'react';
import { AlignLeft, Edit3, GitMerge, Image as ImageIcon, Target } from 'lucide-react';
import type { NodeStatus, Task, WorkflowDefinition } from '@openloop/core';
import { parseMarkdownSteps } from '@openloop/core/markdown-format';
import { api } from '../services/api';
import { NODE_STATUS_DICT } from '../utils/nodeMeta';
import { buildTimelineItems } from '../utils/timelineSteps';
import { readTaskQaSteps } from '../utils/taskQa';
import { ImageLightboxModal, LightboxImageItem } from './ImageLightboxModal';

const QA_PREVIEW_LIMIT = 5;
const GALLERY_PREVIEW_LIMIT = 6;
const DESCRIPTION_CLAMP_CHARS = 80;

const SECTION_TITLE = 'flex items-center gap-1 text-[9.5px] font-medium text-[#85858d] select-none';

/** 卡内耗时只保小数级精度，不给单行塞入「分秒 + 秒」两套读数 */
function formatCompactDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`;
}

interface StepRow {
  id: string;
  name: string;
  status: NodeStatus;
  durationLabel: string;
  imageCount: number;
  /** 流程文档里声明但还没执行到的步骤 */
  planned: boolean;
}

export interface KanbanCardQuickViewProps {
  task: Task;
  allTasks?: Task[];
  workflow?: WorkflowDefinition;
  /** 点开某一步的实时终端日志 */
  onOpenLogs: (taskId: string, nodeId?: string) => void;
  /** 编辑需求说明与参考图（复用编辑弹窗） */
  onEdit?: (task: Task) => void;
  /** 跳转父需求卡片 */
  onSelect?: (task: Task) => void;
}

/**
 * 卡片内速览：把需求说明、参考图、产物、验收用例与步骤轨迹收进卡片，
 * 看完即可决策，不必再打开任务详情工作台。
 */
export const KanbanCardQuickView: React.FC<KanbanCardQuickViewProps> = ({
  task,
  allTasks,
  workflow,
  onOpenLogs,
  onEdit,
  onSelect,
}) => {
  const [isDescriptionOpen, setIsDescriptionOpen] = useState(false);
  const [preview, setPreview] = useState<{ list: LightboxImageItem[]; index: number } | null>(null);

  const description = (task.description || '').trim();
  const qaSteps = useMemo(() => readTaskQaSteps(task), [task]);
  const parentTaskId = task.kind === 'subtask' ? task.parentTaskId : undefined;
  const parentTask = parentTaskId ? allTasks?.find((t) => t.id === parentTaskId) : undefined;
  const parentTitle = parentTask?.title || task.context?.parentGroupSnapshot?.title || parentTaskId;

  const attachments = task.attachments || [];

  // 步骤产物只挑图片，视频/日志走执行轨迹
  const artifacts = useMemo<LightboxImageItem[]>(() => {
    const list: LightboxImageItem[] = [];
    Object.values(task.nodeRuns || {}).forEach((run) => {
      (run.artifacts || []).forEach((art) => {
        if (art.type === 'image') list.push({ name: art.name, url: art.path });
      });
    });
    return list;
  }, [task.nodeRuns]);

  // 步骤轨迹按流程文档顺序排列：已执行的在上，未执行的补空圈占位，一眼看出停在哪儿
  const steps = useMemo<StepRow[]>(() => {
    const declared = parseMarkdownSteps(workflow?.markdown || '');
    return buildTimelineItems(task, declared).map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      planned: Boolean(item.planned),
      durationLabel:
        item.durationSec !== undefined
          ? formatCompactDuration(item.durationSec)
          : item.status === 'running'
          ? '进行中'
          : '',
      imageCount: (item.run?.artifacts || []).filter((art) => art.type === 'image').length,
    }));
  }, [task, workflow?.markdown]);

  const executedStepCount = steps.filter((step) => !step.planned).length;

  const openPreview = (list: LightboxImageItem[], index: number) => {
    if (import.meta.env?.DEV) {
      console.log('[KanbanCard:QuickView] 预览图片:', { taskId: task.id, name: list[index]?.name, index });
    }
    setPreview({ list, index });
  };

  const renderGallery = (items: LightboxImageItem[], label: string) => {
    if (items.length === 0) return null;
    const shown = items.slice(0, GALLERY_PREVIEW_LIMIT);
    return (
      <div className="space-y-1">
        <span className={SECTION_TITLE}>
          <ImageIcon size={9.5} />
          <span>
            {label} {items.length}
          </span>
        </span>
        <div className="flex items-center gap-1 flex-wrap">
          {shown.map((item, index) => (
            <button
              key={`${item.name}-${index}`}
              type="button"
              onClick={() => openPreview(items, index)}
              className="relative w-8 h-8 rounded-[4px] border border-[#e3e3e8] bg-[#f4f4f6] overflow-hidden flex items-center justify-center hover:border-[#4f46e5] hover:shadow-sm transition-all cursor-pointer active:scale-95"
              title={`${item.name}\n点击大图预览`}
            >
              <ImageIcon size={11} className="absolute text-[#c2c2c9]" />
              <img
                src={api.getAttachmentUrl(item.url || item.path || '')}
                alt={item.name}
                className="relative w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  // 文件缺失时回退为占位块，避免破损图标撑坏卡片
                  e.currentTarget.style.opacity = '0';
                }}
              />
            </button>
          ))}
          {items.length > shown.length && (
            <span className="text-[9px] font-mono text-[#a1a1aa]">+{items.length - shown.length}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 rounded-[6px] border border-[#ececf0] bg-[#fafafc] p-2 space-y-2 animate-fadeIn"
    >
      {parentTaskId && (
        <button
          type="button"
          onClick={() => {
            if (import.meta.env?.DEV) {
              console.log('[KanbanCard:QuickView] 跳转父需求:', { taskId: task.id, parentTaskId });
            }
            if (parentTask) onSelect?.(parentTask);
          }}
          disabled={!parentTask}
          className="w-full flex items-center gap-1 min-w-0 text-left text-[10px] text-[#85858d] hover:text-[#4f46e5] transition-colors cursor-pointer disabled:cursor-default disabled:hover:text-[#85858d]"
          title={parentTask ? '点击查看所属父需求' : '所属父需求'}
        >
          <GitMerge size={9} className="shrink-0" />
          <span className="shrink-0">所属需求</span>
          <span className="truncate font-medium">{parentTitle}</span>
        </button>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className={SECTION_TITLE}>
            <AlignLeft size={9.5} />
            <span>需求说明</span>
          </span>
          {onEdit && description && (
            <button
              type="button"
              onClick={() => {
                if (import.meta.env?.DEV) {
                  console.log('[KanbanCard:QuickView] 编辑需求说明与参考图:', task.id);
                }
                onEdit(task);
              }}
              className="w-4 h-4 rounded-[3px] text-[#a1a1aa] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-colors cursor-pointer"
              title="编辑需求说明与参考图"
            >
              <Edit3 size={9} />
            </button>
          )}
        </div>
        {description ? (
          <>
            <p
              className={`text-[11px] leading-[16px] text-[#52525b] whitespace-pre-wrap break-words select-text ${
                isDescriptionOpen ? '' : 'line-clamp-3'
              }`}
            >
              {description}
            </p>
            {description.length > DESCRIPTION_CLAMP_CHARS && (
              <button
                type="button"
                onClick={() => setIsDescriptionOpen((v) => !v)}
                className="text-[9.5px] text-[#4f46e5] hover:underline cursor-pointer"
              >
                {isDescriptionOpen ? '收起' : '展开全文'}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => onEdit?.(task)}
            disabled={!onEdit}
            className="text-[10px] text-[#a1a1aa] hover:text-[#4f46e5] transition-colors cursor-pointer disabled:cursor-default disabled:hover:text-[#a1a1aa]"
          >
            + 添加需求说明
          </button>
        )}
      </div>

      {renderGallery(attachments, '参考图')}
      {renderGallery(artifacts, '步骤产物')}

      {qaSteps.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-1">
            <span className={SECTION_TITLE}>
              <Target size={9.5} />
              <span>验收用例 {qaSteps.length}</span>
            </span>
            {onEdit && (
              <button
                type="button"
                onClick={() => {
                  if (import.meta.env?.DEV) {
                    console.log('[KanbanCard:QuickView] 编辑验收用例:', task.id);
                  }
                  onEdit(task);
                }}
                className="w-4 h-4 rounded-[3px] text-[#a1a1aa] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-colors cursor-pointer"
                title="编辑验收用例"
              >
                <Edit3 size={9} />
              </button>
            )}
          </div>
          <div className="space-y-[2px]">
            {qaSteps.slice(0, QA_PREVIEW_LIMIT).map((step, index) => (
              <div key={index} className="flex items-start gap-1 min-w-0" title={step}>
                <span className="shrink-0 font-mono text-[9px] leading-[15px] text-[#a1a1aa]">{index + 1}</span>
                <span className="min-w-0 text-[10.5px] leading-[15px] text-[#52525b] line-clamp-1">{step}</span>
              </div>
            ))}
            {qaSteps.length > QA_PREVIEW_LIMIT && (
              <div className="pl-4 text-[9.5px] text-[#a1a1aa]">还有 {qaSteps.length - QA_PREVIEW_LIMIT} 项…</div>
            )}
          </div>
        </div>
      )}

      {steps.length > 0 && (
        <div className="space-y-1">
          <span className={SECTION_TITLE}>
            <span>步骤轨迹</span>
            <span className="font-mono text-[9px] text-[#a1a1aa]">
              {executedStepCount}/{steps.length}
            </span>
          </span>
          <div className="space-y-[1px]">
            {steps.map((step, index) => {
              const visual = NODE_STATUS_DICT[step.status] || NODE_STATUS_DICT.pending;
              // 未执行节点不可点（没有日志），只作流水线预览
              if (step.planned) {
                const isNext = index === executedStepCount;
                return (
                  <div
                    key={step.id}
                    className="w-full flex items-center gap-1.5 px-1 py-[2px]"
                    title={`${step.name} · 等待执行`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0 border border-[#c4c4cc]" />
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-[#a1a1aa]">{step.name}</span>
                    {isNext && (
                      <span className="shrink-0 font-mono text-[9px] text-[#4f46e5]">下一步</span>
                    )}
                  </div>
                );
              }
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    if (import.meta.env?.DEV) {
                      console.log('[KanbanCard:QuickView] 打开步骤日志:', { taskId: task.id, nodeId: step.id });
                    }
                    onOpenLogs(task.id, step.id);
                  }}
                  className="group/step w-full flex items-center gap-1.5 px-1 py-[2px] rounded-[3px] hover:bg-[#f1f1f4] transition-colors cursor-pointer text-left"
                  title={`${step.name} · ${visual.label}\n点击查看该步骤终端日志`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${visual.dotClass}`} />
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-[#52525b] group-hover/step:text-[#1c1c21]">
                    {step.name}
                  </span>
                  {step.imageCount > 0 && (
                    <span className="shrink-0 font-mono text-[9px] text-[#a1a1aa]">{step.imageCount} 图</span>
                  )}
                  <span className="shrink-0 font-mono text-[9px] text-[#a1a1aa]">{step.durationLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {preview && (
        <ImageLightboxModal
          isOpen
          images={preview.list}
          initialIndex={preview.index}
          currentIndex={preview.index}
          onIndexChange={(index) => setPreview((prev) => (prev ? { ...prev, index } : prev))}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
};
