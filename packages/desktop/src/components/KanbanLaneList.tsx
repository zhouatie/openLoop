import React, { useState, useEffect, useRef, memo } from 'react';
import { Task, KanbanColumn, TaskAttachment, WorkflowDefinition } from '@openloop/core';
import { KanbanCard } from './KanbanCard';
import { ChevronDown } from 'lucide-react';

const INITIAL_BATCH_SIZE = 40;
const INCREMENT_BATCH_SIZE = 30;

export interface KanbanLaneListProps {
  tasks: Task[];
  allTasks?: Task[];
  workflows: WorkflowDefinition[];
  wfMap: Map<string, WorkflowDefinition>;
  selectedTaskId?: string;
  cancellingTaskId: string | null;
  movingTaskId: string | null;
  runningTaskId: string | null;
  approvingId: string | null;
  skippingStepTaskId: string | null;
  onSelectTask: (task: Task) => void;
  onCancelTask: (taskId: string) => void;
  onMoveTaskColumn: (taskId: string, targetCol: KanbanColumn) => void;
  onEditTask: (task: Task) => void;
  onOpenTaskLogs: (taskId: string, nodeId?: string) => void;
  onOpenAgentChat?: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onRunTask: (taskId: string) => void;
  onSkipStepTask: (taskId: string) => void;
  onArchiveTask: (taskId: string) => void;
  onVisualAcceptance: (task: Task) => void;
  onApprove: (taskId: string, approved: boolean, feedback?: string) => void;
  onSetParentTask?: (task: Task) => void;
  onAddSubtask?: (
    parentId: string,
    params: { title: string; workflowId?: string; attachments?: TaskAttachment[] }
  ) => Promise<void>;
  onAddSubtasks?: (
    parentId: string,
    items: Array<{ title: string; workflowId?: string; attachments?: TaskAttachment[] }>
  ) => Promise<void>;
}

const KanbanLaneListComponent: React.FC<KanbanLaneListProps> = ({
  tasks,
  allTasks,
  workflows,
  wfMap,
  selectedTaskId,
  cancellingTaskId,
  movingTaskId,
  runningTaskId,
  approvingId,
  skippingStepTaskId,
  onSelectTask,
  onCancelTask,
  onMoveTaskColumn,
  onEditTask,
  onOpenTaskLogs,
  onOpenAgentChat,
  onDeleteTask,
  onRunTask,
  onSkipStepTask,
  onArchiveTask,
  onVisualAcceptance,
  onApprove,
  onSetParentTask,
  onAddSubtask,
  onAddSubtasks,
}) => {
  const [displayCount, setDisplayCount] = useState<number>(INITIAL_BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 当任务总数变化时，确保 displayCount 在合理区间
  useEffect(() => {
    if (tasks.length <= INITIAL_BATCH_SIZE) {
      setDisplayCount(INITIAL_BATCH_SIZE);
    }
  }, [tasks.length]);

  const hasMore = tasks.length > displayCount;
  const visibleTasks = hasMore ? tasks.slice(0, displayCount) : tasks;

  // 滚动到底部自动增量加载，避免一次性渲染海量卡片占用主线程
  useEffect(() => {
    if (!hasMore) return;

    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          if (import.meta.env?.DEV) {
            console.log('[KanbanLaneList] 触达可视区底部，增量渲染更多卡片');
          }
          setDisplayCount((prev) => Math.min(prev + INCREMENT_BATCH_SIZE, tasks.length));
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, tasks.length]);

  return (
    <>
      {visibleTasks.map((task) => (
        <KanbanCard
          key={task.id}
          task={task}
          allTasks={allTasks || tasks}
          workflow={wfMap.get(task.workflowId)}
          workflows={workflows}
          isSelected={selectedTaskId === task.id}
          isCancelling={cancellingTaskId === task.id}
          isMoving={movingTaskId === task.id}
          isRunning={runningTaskId === task.id}
          isApproving={approvingId === task.id}
          isSkipping={skippingStepTaskId === task.id}
          onSelect={onSelectTask}
          onCancel={onCancelTask}
          onMoveColumn={onMoveTaskColumn}
          onEdit={onEditTask}
          onOpenLogs={onOpenTaskLogs}
          onOpenAgentChat={onOpenAgentChat}
          onDelete={onDeleteTask}
          onRun={onRunTask}
          onSkipStep={onSkipStepTask}
          onArchive={onArchiveTask}
          onVisualAcceptance={onVisualAcceptance}
          onApprove={onApprove}
          onSetParent={onSetParentTask}
          onAddSubtask={onAddSubtask}
          onAddSubtasks={onAddSubtasks}
        />
      ))}

      {hasMore && (
        <div ref={sentinelRef} className="pt-1 pb-2 flex flex-col items-center justify-center">
          <button
            onClick={() => {
              if (import.meta.env?.DEV) {
                console.log('[KanbanLaneList] 手动加载全部卡片');
              }
              setDisplayCount(tasks.length);
            }}
            className="flex items-center gap-1 text-[10.5px] text-[#85858d] hover:text-[#4f46e5] px-2 py-1 rounded hover:bg-[#f1f1f4] transition-colors"
          >
            <span>加载更多 (剩余 {tasks.length - displayCount} 个)</span>
            <ChevronDown size={11} />
          </button>
        </div>
      )}
    </>
  );
};

export const KanbanLaneList = memo(KanbanLaneListComponent, (prev, next) => {
  return (
    prev.tasks === next.tasks &&
    prev.selectedTaskId === next.selectedTaskId &&
    prev.cancellingTaskId === next.cancellingTaskId &&
    prev.movingTaskId === next.movingTaskId &&
    prev.runningTaskId === next.runningTaskId &&
    prev.approvingId === next.approvingId &&
    prev.skippingStepTaskId === next.skippingStepTaskId &&
    prev.wfMap === next.wfMap &&
    prev.onOpenAgentChat === next.onOpenAgentChat
  );
});
