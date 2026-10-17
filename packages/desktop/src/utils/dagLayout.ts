import { Node, Edge } from '@xyflow/react';

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  gapX?: number;
  gapY?: number;
  startX?: number;
  startY?: number;
}

/**
 * 高性能零依赖 DAG 层次拓扑排版算法
 * 使用 Kahn 拓扑分层 + 层级垂直居中布局，耗时 < 1ms，完全不卡顿 UI
 */
export function layoutWorkflowDag(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node[] {
  if (!nodes || nodes.length === 0) return [];

  const nodeWidth = options.nodeWidth || 240;
  const nodeHeight = options.nodeHeight || 85;
  const gapX = options.gapX || 80;
  const gapY = options.gapY || 40;
  const startX = options.startX || 60;
  const startY = options.startY || 120;

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

  // 计算最大列的高度，用于整体垂直基准平衡
  let maxColHeight = 0;
  for (const group of layers) {
    if (group && group.length > 0) {
      const h = group.length * nodeHeight + (group.length - 1) * gapY;
      if (h > maxColHeight) maxColHeight = h;
    }
  }

  // 5. 计算并赋予每个节点最终优雅的 position 坐标
  const resultNodes: Node[] = [];

  for (let l = 0; l < layers.length; l++) {
    const group = layers[l];
    if (!group || group.length === 0) continue;

    const colX = startX + l * (nodeWidth + gapX);
    const colTotalHeight = group.length * nodeHeight + (group.length - 1) * gapY;
    // 居中偏移量
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

  return resultNodes;
}
