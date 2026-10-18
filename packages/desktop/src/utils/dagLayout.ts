import { Node, Edge } from '@xyflow/react';

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  gapX?: number;
  gapY?: number;
  startX?: number;
  startY?: number;
  direction?: 'TB' | 'LR';
}

/**
 * 高性能零依赖 DAG 层次拓扑排版算法
 * 默认使用从上到下 (Top-to-Bottom, TB) 轴对称层次排版，兼具多分支水平居中平衡
 * 耗时 < 1ms，完全不卡顿 UI
 */
export function layoutWorkflowDag(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node[] {
  if (!nodes || nodes.length === 0) return [];

  const direction = options.direction || 'TB';
  const nodeWidth = options.nodeWidth || 230;
  const nodeHeight = options.nodeHeight || 84;
  const gapX = options.gapX || 48;
  const gapY = options.gapY || 56;
  const startX = options.startX || 140;
  const startY = options.startY || 80;

  // 1. 构建邻接表与入度统计
  const nodeMap = new Map<string, Node>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      adj.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  }

  // 2. Kahn 拓扑排序计算层级 (Layer / Rank)
  const layerMap = new Map<string, number>();
  const queue: string[] = [];

  // 入度为 0 的节点作为第 0 层候选
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(id);
      layerMap.set(id, 0);
    }
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    visitedCount++;
    const currLayer = layerMap.get(curr) || 0;
    const neighbors = adj.get(curr) || [];

    for (const neighbor of neighbors) {
      const nextLayer = Math.max(layerMap.get(neighbor) || 0, currLayer + 1);
      layerMap.set(neighbor, nextLayer);

      const remainingDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, remainingDeg);
      if (remainingDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  // 3. 处理可能存在的环路或孤立未访问节点
  if (visitedCount < nodes.length) {
    let maxKnownLayer = 0;
    for (const l of layerMap.values()) {
      if (l > maxKnownLayer) maxKnownLayer = l;
    }
    for (const node of nodes) {
      if (!layerMap.has(node.id)) {
        layerMap.set(node.id, maxKnownLayer + 1);
      }
    }
  }

  // 4. 按层分组
  const layers: string[][] = [];
  for (const node of nodes) {
    const l = layerMap.get(node.id) || 0;
    if (!layers[l]) layers[l] = [];
    layers[l].push(node.id);
  }

  // 5. 计算并赋予每个节点最终优雅的 position 坐标
  const resultNodes: Node[] = [];

  if (direction === 'TB') {
    // 从上往下排版 (Top to Bottom): 拓扑层级决定纵向 Y 坐标，同层并行节点水平居中
    let maxRowWidth = 0;
    for (const group of layers) {
      if (group && group.length > 0) {
        const w = group.length * nodeWidth + (group.length - 1) * gapX;
        if (w > maxRowWidth) maxRowWidth = w;
      }
    }

    for (let l = 0; l < layers.length; l++) {
      const group = layers[l];
      if (!group || group.length === 0) continue;

      const rowY = startY + l * (nodeHeight + gapY);
      const rowTotalWidth = group.length * nodeWidth + (group.length - 1) * gapX;
      // 水平中轴对称居中对齐
      const offsetX = startX + (maxRowWidth - rowTotalWidth) / 2;

      for (let i = 0; i < group.length; i++) {
        const nodeId = group[i];
        const origNode = nodeMap.get(nodeId)!;
        const posX = offsetX + i * (nodeWidth + gapX);

        resultNodes.push({
          ...origNode,
          position: {
            x: Math.round(posX),
            y: Math.round(rowY),
          },
        });
      }
    }
  } else {
    // 从左往右排版 (Left to Right): 拓扑层级决定横向 X 坐标，同层并行节点垂直居中
    let maxColHeight = 0;
    for (const group of layers) {
      if (group && group.length > 0) {
        const h = group.length * nodeHeight + (group.length - 1) * gapY;
        if (h > maxColHeight) maxColHeight = h;
      }
    }

    for (let l = 0; l < layers.length; l++) {
      const group = layers[l];
      if (!group || group.length === 0) continue;

      const colX = startX + l * (nodeWidth + gapX);
      const colTotalHeight = group.length * nodeHeight + (group.length - 1) * gapY;
      const offsetY = startY + (maxColHeight - colTotalHeight) / 2;

      for (let i = 0; i < group.length; i++) {
        const nodeId = group[i];
        const origNode = nodeMap.get(nodeId)!;
        const posY = offsetY + i * (nodeHeight + gapY);

        resultNodes.push({
          ...origNode,
          position: {
            x: Math.round(colX),
            y: Math.round(posY),
          },
        });
      }
    }
  }

  return resultNodes;
}
