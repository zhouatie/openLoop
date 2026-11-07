import type { NodeRun, NodeStatus, Task } from '@openloop/core';
import { resolveNodeMeta } from './nodeMeta';

export interface TimelineItem {
  id: string;
  name: string;
  description: string;
  type: string;
  isGit?: boolean;
  isDeploy?: boolean;
  run?: NodeRun;
  status: NodeStatus;
  durationSec?: number;
  timeRangeStr?: string;
  order: number;
  /** 流程文档声明但还没执行到的步骤占位 */
  planned?: boolean;
}

/** 步骤名比对键：去掉行首序号与全部空白，忽略大小写 */
export const stepKey = (name: string) =>
  String(name || '')
    .replace(/^\s*\d+\s*[.、)]\s*/, '')
    .replace(/\s+/g, '')
    .toLowerCase();

const formatTime = (ts?: number) => {
  if (!ts) return '';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
};

/**
 * 步骤轨迹数据源：执行记录按时间排序，再按流程文档标题对齐；
 * 文档声明但尚未执行的步骤补占位（planned），保证卡片能看到整条流水线。
 */
export function buildTimelineItems(task: Task, declaredSteps: string[]): TimelineItem[] {
  const runs = task.nodeRuns || {};

  const items: TimelineItem[] = Object.entries(runs).map(([nid, run]) => {
    const meta = resolveNodeMeta(nid, run);

    let durationSec: number | undefined;
    let timeRangeStr: string | undefined;
    if (run.startedAt && run.finishedAt) {
      durationSec = (run.finishedAt - run.startedAt) / 1000;
      timeRangeStr = `${formatTime(run.startedAt)} ~ ${formatTime(run.finishedAt)}`;
    } else if (run.startedAt) {
      timeRangeStr = `${formatTime(run.startedAt)} 开始`;
    }

    return {
      id: nid,
      name: meta.name,
      description: meta.description,
      type: meta.type,
      isGit: meta.isGit,
      isDeploy: meta.isDeploy,
      run,
      status: run.status,
      durationSec,
      timeRangeStr,
      order: 0,
    };
  });

  items.sort((a, b) => (a.run?.startedAt || 0) - (b.run?.startedAt || 0));

  // 步骤名按文档标题对齐：先精确匹配，再容忍省略标题尾部注释的前缀匹配
  const claimed = new Set<string>();
  const matchExecuted = (title: string, fuzzy: boolean) => {
    const key = stepKey(title);
    if (key.length < 2) return undefined;
    const hit = items.find((item) => {
      if (claimed.has(item.id)) return false;
      const other = stepKey(item.name);
      if (!other) return false;
      return fuzzy ? other.startsWith(key) || key.startsWith(other) : other === key;
    });
    if (hit) claimed.add(hit.id);
    return hit;
  };

  let merged = items;
  if (declaredSteps.length > 0) {
    const exactHits = new Map<string, TimelineItem>();
    declaredSteps.forEach((title) => {
      const hit = matchExecuted(title, false);
      if (hit) exactHits.set(stepKey(title), hit);
    });
    merged = declaredSteps.map((title, index) => {
      const hit = exactHits.get(stepKey(title)) || matchExecuted(title, true);
      if (hit) return hit;
      return {
        id: `plan-${index}`,
        // 文档标题带着「1. 」这类序号，卡片已有步骤序号，不重复
        name: title.replace(/^\s*\d+\s*[.、)]\s*/, ''),
        description: '',
        type: '',
        status: 'pending' as NodeStatus,
        order: 0,
        planned: true,
      };
    });
    // 文档里没有对应标题的执行记录（重跑或文档改动）按时间顺序追加在末尾；
    // 若一个名字都没对上（流水线节点用固定 id 命名），退回按执行先后与文档顺序对齐
    const leftovers = items.filter((item) => !claimed.has(item.id));
    if (claimed.size === 0 && leftovers.length > 0) {
      merged = merged.map((item, idx) => leftovers[idx] || item);
      merged.push(...leftovers.slice(merged.length));
    } else {
      merged.push(...leftovers);
    }
  }

  merged.forEach((item, idx) => {
    item.order = idx + 1;
  });
  return merged;
}
