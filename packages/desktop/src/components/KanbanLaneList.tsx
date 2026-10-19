import React, { useState, useEffect, useRef, memo } from 'react';
import { Task, KanbanColumn, WorkflowDefinition } from '@openloop/core';
import { KanbanCard } from './KanbanCard';
import { ChevronDown } from 'lucide-react';

const INITIAL_BATCH_SIZE = 40;
const INCREMENT_BATCH_SIZE = 30;

export interface KanbanLaneListProps {
  tasks: Task[];
  workflows: WorkflowDefinition[];
  wfMap: Map<string, WorkflowDefinition>;
  selectedTaskId?: string;
  cancellingTaskId: string | null;
  movingTaskId: string | null;
  runningTaskId: string | null;
  skippingTaskId: string | null;
  approvingId: string | null;
  onSelectTask: (task: Task) => void;
  onCancelTask: (taskId: string) => void;
  onMoveTaskColumn: (taskId: string, targetCol: KanbanColumn) => void;
  onEditTask: (task: Task) => void;
  onOpenTaskLogs: (taskId: string, nodeId?: string) => void;
  onDeleteTask: (task: Task) => void;
  onRunTask: (taskId: string) => void;
  onSkipNode: (taskId: string, nodeId?: string) => void;
  onVisualAcceptance: (task: Task) => void;
  onApprove: (taskId: string, approved: boolean) => void;
}

const KanbanLaneListComponent: React.FC<KanbanLaneListProps> = ({
  tasks,
  workflows,
  wfMap,
  selectedTaskId,
  cancellingTaskId,
  movingTaskId,
  runningTaskId,
  skippingTaskId,
  approvingId,
  onSelectTask,
  onCancelTask,
  onMoveTaskColumn,
  onEditTask,
  onOpenTaskLogs,
  onDeleteTask,
  onRunTask,
  onSkipNode,
  onVisualAcceptance,
  onApprove,
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
          workflow={wfMap.get(task.workflowId)}
          workflows={workflows}
          isSelected={selectedTaskId === task.id}
          isCancelling={cancellingTaskId === task.id}
          isMoving={movingTaskId === task.id}
          isRunning={runningTaskId === task.id}
          isSkipping={skippingTaskId === task.id}
          isApproving={approvingId === task.id}
          onSelect={onSelectTask}
          onCancel={onCancelTask}
          onMoveColumn={onMoveTaskColumn}
          onEdit={onEditTask}
          onOpenLogs={onOpenTaskLogs}
          onDelete={onDeleteTask}
          onRun={onRunTask}
          onSkipNode={onSkipNode}
          onVisualAcceptance={onVisualAcceptance}
          onApprove={onApprove}
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

export const KanbanLaneList = memo(KanbanLaneListComponent);
