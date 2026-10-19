import React, { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  EdgeProps,
  getBezierPath,
} from '@xyflow/react';
import { Plus } from 'lucide-react';

export const WorkflowCustomEdge: React.FC<EdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const edgeData = data as any;
  const condition = edgeData?.condition || '';
  const label = edgeData?.label || '';
  const displayLabel = label || (condition ? `[条件] ${condition}` : '');

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onInsertNode = edgeData?.onInsertNode;

  return (
    <>
      {/* 隐形加粗的热区检测线，提供更好的 Hover / Click 体验 */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={20}
        className="cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

      {/* 真实可见连线 */}
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: selected ? '#4f46e5' : isHovered ? '#6366f1' : condition ? '#818cf8' : '#a5b4fc',
          strokeWidth: selected ? 2.6 : isHovered ? 2.2 : 1.8,
          transition: 'stroke 0.2s, stroke-width 0.2s',
          filter: selected ? 'drop-shadow(0 0 4px rgba(79, 70, 229, 0.4))' : undefined,
        }}
      />

      {/* 连线中点渲染器 (条件胶囊 + 插入步骤快捷按钮) */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="flex items-center gap-1 z-10"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* 条件文本标签胶囊 */}
          {displayLabel && (
            <div
              className={`text-[9.5px] font-mono px-1.5 py-0.5 rounded-[4px] border shadow-2xs whitespace-nowrap select-none transition-colors ${
                selected
                  ? 'bg-[#eeedfd] text-[#4338ca] border-[#c7d2fe] font-semibold'
                  : 'bg-white text-[#63636b] border-[#e3e3e8]'
              }`}
            >
              {displayLabel}
            </div>
          )}

          {/* 核心亮点：连线中点插桩 (+) 快捷圆钮 */}
          {typeof onInsertNode === 'function' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (import.meta.env?.DEV) {
                  console.log('[WorkflowCustomEdge] 点击连线插桩按钮:', {
                    edgeId: id,
                    source,
                    target,
                  });
                }
                onInsertNode(id, source, target);
              }}
              className={`w-[18px] h-[18px] rounded-full flex items-center justify-center transition-all cursor-pointer shadow-xs border ${
                isHovered || selected
                  ? 'bg-[#4f46e5] text-white border-[#4f46e5] scale-110 shadow-[0_2px_8px_rgba(79,70,229,0.35)]'
                  : 'bg-white text-[#85858d] hover:text-[#4f46e5] border-[#d1d1d8] hover:border-[#4f46e5]'
              }`}
              title="在两节点间插入新步骤"
            >
              <Plus size={10} strokeWidth={2.6} />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
