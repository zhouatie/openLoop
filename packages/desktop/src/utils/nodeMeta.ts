import type { NodeType, NodeStatus, NodeRun } from '@openloop/core';

export interface NodeMeta {
  id: string;
  name: string;
  description: string;
  type: NodeType;
  isGit?: boolean;
  isDeploy?: boolean;
}

/** 步骤类型缺省展示名：只在步骤记录没有自报名时兜底 */
const STEP_TYPE_LABEL: Record<string, string> = {
  cli: '命令',
  agent: 'AI Agent',
  hook: 'Hook',
  midscene: 'Midscene',
  'stitch-image': '动图',
  'qa-approval': '人工验收',
  'qa-planner': 'QA 用例设计',
  'worktree-setup': '建沙箱',
  'worktree-merge': '合并代码',
  'worktree-cleanup': '清理沙箱',
  'env-prepare': '环境准备',
  'sub-workflow': '子流水线',
};

const KNOWN_STEP_TYPES = new Set(Object.keys(STEP_TYPE_LABEL));

function toStepType(type?: string): NodeType {
  return type && KNOWN_STEP_TYPES.has(type) ? (type as NodeType) : 'cli';
}

/**
 * 解析步骤展示元信息。
 * 名字与类型优先取步骤记录自报的值（编排 Agent 调工具时传的 name / type），
 * 缺失时按步骤 id 与命令关键词推断。
 */
export function resolveNodeMeta(
  nodeId: string,
  run?: NodeRun | null
): NodeMeta {
  const output = (run?.output && typeof run.output === 'object' ? run.output : null) as
    | { stepName?: string; stepType?: string }
    | null;

  const selfType = output?.stepType;
  let type: NodeType = toStepType(selfType);

  const idLower = nodeId.toLowerCase();
  const name = (output?.stepName || '').trim();
  const nameLower = name.toLowerCase();

  const isGit =
    type === 'cli' &&
    (idLower.includes('git') || nameLower.includes('git') || nameLower.includes('提交'));
  const isDeploy =
    type === 'cli' &&
    (idLower.includes('deploy') || idLower.includes('release') || nameLower.includes('部署'));

  let resolvedName = name;
  if (!resolvedName) {
    if (isGit) {
      resolvedName = 'Git 自动提交代码';
    } else if (isDeploy) {
      resolvedName = '服务发布与部署';
    } else if (idLower.includes('script')) {
      resolvedName = '流水线脚本';
    } else if (/^s\d+$/.test(idLower)) {
      resolvedName = `步骤 ${idLower.slice(1)}`;
    } else {
      const cleanId = nodeId.replace(/^node_/, '').replace(/[_-]+/g, ' ');
      resolvedName = cleanId.charAt(0).toUpperCase() + cleanId.slice(1);
    }
  }

  if (!selfType && (isGit || isDeploy)) {
    type = 'cli';
  }

  const description =
    STEP_TYPE_LABEL[type] ||
    (run?.exitCode !== undefined ? `退出码 ${run.exitCode}` : '流水线步骤');

  return {
    id: nodeId,
    name: resolvedName,
    description,
    type,
    isGit,
    isDeploy,
  };
}

export function formatDurationHuman(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0.0s';
  if (seconds < 1) {
    return `${seconds.toFixed(1)}s`;
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const totalSecs = Math.round(seconds);
  const mins = Math.floor(totalSecs / 60);
  const remainingSecs = totalSecs % 60;
  if (mins < 60) {
    const secStr = remainingSecs < 10 ? `0${remainingSecs}` : `${remainingSecs}`;
    return `${mins}分${secStr}秒 (${seconds.toFixed(1)}s)`;
  }
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  const minStr = remainMins < 10 ? `0${remainMins}` : `${remainMins}`;
  return `${hours}小时${minStr}分 (${seconds.toFixed(0)}s)`;
}

export const NODE_STATUS_DICT: Record<
  NodeStatus,
  {
    label: string;
    bg: string;
    text: string;
    border: string;
    badgeClass: string;
    dotClass: string;
    desc: string;
  }
> = {
  success: {
    label: '执行成功',
    bg: 'bg-[#e4f6ec]',
    text: 'text-[#189a58]',
    border: 'border-[#c2ecd6]',
    badgeClass: 'bg-[#e4f6ec] text-[#189a58] border border-[#c2ecd6]',
    dotClass: 'bg-[#189a58]',
    desc: '节点已顺利执行完毕并通过自检',
  },
  running: {
    label: '正在执行',
    bg: 'bg-[#eeedfd]',
    text: 'text-[#4f46e5]',
    border: 'border-[#d8d6fb]',
    badgeClass: 'bg-[#eeedfd] text-[#4f46e5] border border-[#d8d6fb]',
    dotClass: 'bg-[#4f46e5] animate-pulse',
    desc: '当前节点正在前台或后台处理中',
  },
  waiting_approval: {
    label: '待人工验收',
    bg: 'bg-[#fbf0df]',
    text: 'text-[#b45309]',
    border: 'border-[#f4dcba]',
    badgeClass: 'bg-[#fbf0df] text-[#b45309] border border-[#f4dcba]',
    dotClass: 'bg-[#f59e0b] animate-pulse',
    desc: '流水线已停驻门禁，等待人工确认',
  },
  failed: {
    label: '执行失败',
    bg: 'bg-[#fbe9e9]',
    text: 'text-[#d64545]',
    border: 'border-[#f6c6c6]',
    badgeClass: 'bg-[#fbe9e9] text-[#d64545] border border-[#f6c6c6]',
    dotClass: 'bg-[#d64545]',
    desc: '节点执行报错或退出码异常，流程已中断',
  },
  skipped: {
    label: '已跳过',
    bg: 'bg-[#f1f1f4]',
    text: 'text-[#85858d]',
    border: 'border-[#e3e3e8]',
    badgeClass: 'bg-[#f1f1f4] text-[#85858d] border border-[#e3e3e8]',
    dotClass: 'bg-[#85858d]',
    desc: '根据分支条件或策略已跳过该步骤',
  },
  pending: {
    label: '等待执行',
    bg: 'bg-[#f4f4f6]',
    text: 'text-[#85858d]',
    border: 'border-[#ececf0]',
    badgeClass: 'bg-[#f4f4f6] text-[#85858d] border border-[#ececf0]',
    dotClass: 'bg-[#c4c4cc]',
    desc: '等待前序节点完成流转',
  },
};
