import type { WorkflowDefinition, NodeType, NodeStatus, WorkflowNode, Task } from '@openloop/core';

export interface NodeMeta {
  id: string;
  name: string;
  description: string;
  type: NodeType;
  isGit?: boolean;
  isDeploy?: boolean;
}

export const DEFAULT_NODE_METAS: Record<string, { name: string; description: string; type: NodeType }> = {
  node_agent_coder: {
    name: 'AI Agent 编码实现',
    description: '智能体解析任务需求，自主编写、调整与自测工程核心代码',
    type: 'agent',
  },
  node_build_verify: {
    name: '前端构建自检',
    description: '自动化执行构建与语法自检脚本，确保编译无报错',
    type: 'cli',
  },
  node_qa_gate: {
    name: 'QA 人工验收门禁',
    description: '人工核验界面效果与业务逻辑，确保质量符合发布标准',
    type: 'qa-approval',
  },
  node_git_commit: {
    name: 'Git 自动提交代码',
    description: '自动暂存已修改代码，生成规范提交记录并写入版本历史',
    type: 'cli',
  },
  node_start_agent: {
    name: 'AI Agent 开发执行',
    description: '智能体解析需求并自主编码实现',
    type: 'agent',
  },
  node_hook_dev_done: {
    name: '开发完成 Hook 触发器',
    description: '监听开发完成事件广播，自动触发下游质量验证流水线',
    type: 'hook',
  },
  node_midscene_test: {
    name: 'Midscene 智能 UI 测试',
    description: '基于视觉大模型执行自动化 UI 探索测试与关键截屏',
    type: 'midscene',
  },
  node_stitch_image: {
    name: 'UI 截屏拼图动图生成',
    description: '自动拼接测试步骤截屏，合成过程动图报告以供快速验收',
    type: 'stitch-image',
  },
  node_qa_approval: {
    name: 'QA 人工验收门禁',
    description: '核验自动化测试截图与动图产物，确认验收指标后放行流转',
    type: 'qa-approval',
  },
  node_deploy_prep: {
    name: '环境与依赖预检',
    description: '预检 Node/pnpm 依赖环境与运行时前置条件是否就绪',
    type: 'cli',
  },
  node_deploy_build: {
    name: '生产环境全量构建',
    description: '执行全量生产环境打包编译，输出完整静态制品包',
    type: 'cli',
  },
  node_deploy_exec: {
    name: '应用部署与服务启动',
    description: '执行发布部署脚本，拉起应用进程并监听服务端口',
    type: 'cli',
  },
  node_deploy_health: {
    name: '线上服务健康探针',
    description: '向部署完成的目标端口发送健康检查探针，验证服务活性',
    type: 'cli',
  },
  node_deploy_gate: {
    name: '发布上线核验门禁',
    description: '核验构建产物完整性与健康探针返回，最终确认发布上线',
    type: 'qa-approval',
  },
};

export function resolveNodeMeta(
  nodeId: string,
  workflow?: WorkflowDefinition | null,
  allWorkflows?: WorkflowDefinition[]
): NodeMeta {
  // 1. 优先从当前关联 workflow 匹配
  let matchedNode: WorkflowNode | undefined;
  if (workflow?.nodes) {
    matchedNode = workflow.nodes.find((n) => n.id === nodeId);
  }

  // 2. 其次从全部工作流列表匹配
  if (!matchedNode && allWorkflows) {
    for (const wf of allWorkflows) {
      const found = wf.nodes?.find((n) => n.id === nodeId);
      if (found) {
        matchedNode = found;
        break;
      }
    }
  }

  const defaultMeta = DEFAULT_NODE_METAS[nodeId];

  // 节点名称
  let name = matchedNode?.name?.trim() || defaultMeta?.name;

  // 节点类型
  let type: NodeType = matchedNode?.type || defaultMeta?.type || 'cli';

  // 命令或名称的关键词推断
  const idLower = nodeId.toLowerCase();
  const nameLower = (name || '').toLowerCase();
  const commandLower = (matchedNode?.config?.command || '').toLowerCase();

  const isGit =
    type === 'cli' &&
    (idLower.includes('git') || nameLower.includes('git') || commandLower.includes('git'));

  const isDeploy =
    type === 'cli' &&
    (idLower.includes('deploy') ||
      idLower.includes('release') ||
      nameLower.includes('部署') ||
      commandLower.includes('deploy'));

  if (!name) {
    // 启发式智能中文命名
    if (isGit) {
      name = 'Git 自动提交代码';
    } else if (isDeploy) {
      name = '服务发布与部署';
    } else if (idLower.includes('agent') || idLower.includes('coder') || idLower.includes('dev')) {
      name = 'AI Agent 编码任务';
      type = 'agent';
    } else if (idLower.includes('build') || idLower.includes('compile') || idLower.includes('pack')) {
      name = '工程编译与构建';
      type = 'cli';
    } else if (idLower.includes('qa') || idLower.includes('gate') || idLower.includes('approval')) {
      name = 'QA 人工验收门禁';
      type = 'qa-approval';
    } else if (idLower.includes('midscene') || idLower.includes('e2e')) {
      name = '智能 UI 测试验证';
      type = 'midscene';
    } else if (idLower.includes('stitch') || idLower.includes('image') || idLower.includes('gif')) {
      name = '截图拼接与动图合成';
      type = 'stitch-image';
    } else if (idLower.includes('hook') || idLower.includes('trigger')) {
      name = '自动化流程触发器';
      type = 'hook';
    } else if (idLower.includes('lint') || idLower.includes('check')) {
      name = '代码质量自检';
      type = 'cli';
    } else if (idLower.includes('health') || idLower.includes('probe')) {
      name = '线上服务健康探针';
      type = 'cli';
    } else {
      // 优雅剥离 node_ 前缀
      const cleanId = nodeId.replace(/^node_/, '').replace(/[_-]+/g, ' ');
      name = `节点 · ${cleanId.charAt(0).toUpperCase() + cleanId.slice(1)}`;
    }
  }

  // 描述生成
  let description = defaultMeta?.description;
  if (!description) {
    if (isGit) {
      description = '版本控制变更暂存与自动提交';
    } else if (isDeploy) {
      description = '构建产物发布与部署启动';
    } else if (type === 'agent') {
      description = '调用智能体自主处理需求与修改代码';
    } else if (type === 'qa-approval') {
      description = '质量与交互人工复核门禁';
    } else if (type === 'midscene') {
      description = '多模态 AI 智能 UI 交互与截屏断言';
    } else if (type === 'stitch-image') {
      description = '测试流程截图拼合与动图产物输出';
    } else if (type === 'hook') {
      description = '流程事件广播与节点流转触发';
    } else {
      description = matchedNode?.config?.command
        ? `执行指令: ${matchedNode.config.command.slice(0, 48)}...`
        : '执行命令行脚本与指令自检';
    }
  }

  return {
    id: nodeId,
    name,
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

/**
 * 智能解析任务对应的 QA 自动化测试与截帧节点 ID
 * 优先级：
 * 1. 若提供 workflow，优先匹配 type === 'midscene' 的测试执行节点
 * 2. 匹配 ID 包含 midscene 或结尾为 _qa_test 的测试执行节点
 * 3. 匹配名称或 ID 包含 qa/test，但排除 planner、gate、approval、review 等编排与门禁节点
 * 4. 若无 workflow 或未匹配，从 task.nodeRuns 历史已执行节点中依上述规则推断
 * 5. 兜底策略：若找不到则退回 'node_qa_test'
 */
export function resolveQaTestNodeId(
  task?: Task | null,
  workflow?: WorkflowDefinition | null
): string {
  // 1. 从工作流定义中寻找
  if (workflow?.nodes && workflow.nodes.length > 0) {
    // 1.1 优先寻找明确的 midscene 自动化测试类型节点
    const midsceneNode = workflow.nodes.find((n) => n.type === 'midscene');
    if (midsceneNode) return midsceneNode.id;

    // 1.2 明确包含 midscene 或 qa_test 的节点 ID
    const directIdNode = workflow.nodes.find((n) => {
      const id = n.id.toLowerCase();
      return (
        id === 'node_qa_test' ||
        id === 'node_midscene_test' ||
        id.includes('midscene') ||
        id.endsWith('_qa_test') ||
        (id.includes('qa') && id.includes('test'))
      );
    });
    if (directIdNode) return directIdNode.id;

    // 1.3 排除 planner、gate、approval、review 等非测试执行节点
    const testExecutionNode = workflow.nodes.find((n) => {
      if (
        n.type === 'qa-planner' ||
        n.type === 'qa-approval' ||
        n.type === 'worktree-setup' ||
        n.type === 'worktree-merge' ||
        n.type === 'worktree-cleanup' ||
        n.type === 'env-prepare' ||
        n.type === 'agent'
      ) {
        return false;
      }
      const id = n.id.toLowerCase();
      const name = (n.name || '').toLowerCase();
      const isExclude =
        id.includes('plan') ||
        id.includes('gate') ||
        id.includes('approval') ||
        id.includes('review') ||
        name.includes('设计') ||
        name.includes('门禁') ||
        name.includes('审批') ||
        name.includes('复核');
      if (isExclude) return false;

      return id.includes('qa') || id.includes('test') || name.includes('qa') || name.includes('测试');
    });
    if (testExecutionNode) return testExecutionNode.id;
  }

  // 2. 从已执行节点历史 nodeRuns 中寻找
  if (task?.nodeRuns) {
    const keys = Object.keys(task.nodeRuns);

    // 2.1 明确匹配测试节点
    const directRunId = keys.find((k) => {
      const lower = k.toLowerCase();
      return (
        lower === 'node_qa_test' ||
        lower === 'node_midscene_test' ||
        lower.includes('midscene') ||
        lower.endsWith('_qa_test') ||
        (lower.includes('qa') && lower.includes('test'))
      );
    });
    if (directRunId) return directRunId;

    // 2.2 包含 qa/test 并排除 planner、gate、approval、review、setup、merge、cleanup
    const secondaryRunId = keys.find((k) => {
      const lower = k.toLowerCase();
      const isExclude =
        lower.includes('plan') ||
        lower.includes('gate') ||
        lower.includes('approval') ||
        lower.includes('review') ||
        lower.includes('setup') ||
        lower.includes('merge') ||
        lower.includes('clean');
      if (isExclude) return false;
      return lower.includes('qa') || lower.includes('test');
    });
    if (secondaryRunId) return secondaryRunId;
  }

  // 3. 兜底策略
  return 'node_qa_test';
}
