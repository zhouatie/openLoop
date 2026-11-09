import { AgentPromptKey, PromptMeta } from '../types';

/**
 * OpenLoop 内置系统提示词模板默认值
 */
export const DEFAULT_PROMPT_TEMPLATES: Record<AgentPromptKey, string> = {
  qaPlanner: `你是一名资深质量工程师（QA Engineer），负责对产品需求进行纯黑盒端到端自动化测试设计。

【输入需求】
- 任务标题: {{task.title}}
- 详细说明: {{task.description}}

【测试设计原则】
1. 需求驱动（黑盒视角）：严格依据上述需求设计操作路径与预期结果，关注最终用户可见的界面功能与业务逻辑，不考虑底层实现细节；
2. 适量精炼（严格 3~4 步）：步骤数量控制在 3~4 步，覆盖核心端到端冒烟链路，坚决避免冗长繁琐；
3. 典型结构：
   - 步骤 1：导航/进入需求涉及的功能页面或模块（如：点击左侧导航「xxx」进入对应模块）
   - 步骤 2：执行需求的核心交互或状态操作（如：输入「xxx」后点击「保存」）
   - 步骤 3：断言界面出现符合需求预期的可见结果（如：检查列表中出现了「xxx」）
   - 步骤 4：可再补一条独立的可见结果断言；
4. 断言必须正向且单一：一条用例只描述一个肉眼可见的事实，禁止使用「且无报错」「无异常弹窗」这类复合或否定句式，否则会被当成反向断言而空跑通过；
5. 操作与断言分开写：含操作动词（点击、输入、选择、切换等）的一句就是操作步骤，不要在同一句里混入断言，避免步骤类型被误判；严禁编造需要外部复杂模拟的不可达伪步骤。

【输出格式】
请直接输出用例清单块（注意每行以 - 开头），无需多余客套：
\`\`\`qa-plan
- 点击导航「xxx」进入目标页面
- 输入「xxx」并点击「提交」
- 检查列表中出现「xxx」
\`\`\``,

  agentNodeRequirement: `任务需求: {{task.title}}
详细说明: {{task.description}}

执行要求:
{{task.prompt}}`,

  conflictResolution: `【严重：代码合并冲突自动协调】
当前沙箱特性分支在合入基线分支「{{baseBranch}}」时产生代码冲突。
产生冲突的文件列表：
{{conflictFiles}}

请立即协助完成冲突协调与自愈：
1. 使用 read 工具查看上述冲突文件，识别出所有 Git 冲突标记块（形如 <<<<<<< HEAD ... ======= ... >>>>>>> {{baseBranch}}）；
2. 仔细理解双方代码改动：保留基线分支的新增逻辑与接口规范，同时完整保留当前任务实现的核心特性；
3. 使用 edit 工具精确消除所有冲突标记（严格移除 <<<<<<<, =======, >>>>>>>），融合两方修改；
4. 检查修改后的代码，确保无语法错误与未定义变量；
5. 消解完成后，对每个冲突文件执行 \`git add <文件>\`（未暂存时 Git 仍把它视为未合并）；
6. 修改完成后，输出格式：
【冲突消解总结】
- 融合要点 1: ...
- 融合要点 2: ...`,

  qaArtifactFeedback: `[用户主动附带：最新 UI 自动化测试产物]
- 自动化测试 Run ID: {{qaRunId}}
- 时间轴数据路径: {{timelinePath}}
- 本次生成的真实操作截图路径:
{{screenshotPaths}}
提示：你可以直接使用 read 工具查看上述图片截帧或 timeline.json，确认当前界面的真实渲染效果，进行精准代码修复。`,
};

/**
 * 提示词元数据定义（用于前端设置面板渲染及变量快速插入）
 */
export const PROMPT_METAS: PromptMeta[] = [
  {
    key: 'qaPlanner',
    label: 'QA 黑盒用例自动设计',
    category: '自动化测试',
    description: '在 QA-Planner 节点或新建任务快速规划时，指导 Agent 生成 3~4 步端到端黑盒冒烟用例。',
    variables: [
      { name: '{{task.title}}', description: '任务标题' },
      { name: '{{task.description}}', description: '任务详细说明' },
    ],
    defaultTemplate: DEFAULT_PROMPT_TEMPLATES.qaPlanner,
  },
  {
    key: 'agentNodeRequirement',
    label: 'Agent 节点需求注入包装',
    category: '任务执行',
    description: '当流水线中 Agent 节点的 Prompt 未包含任务标题时，自动将需求与执行要求组装注入。',
    variables: [
      { name: '{{task.title}}', description: '任务标题' },
      { name: '{{task.description}}', description: '任务详细说明' },
      { name: '{{task.prompt}}', description: '节点配置的原始 Prompt' },
    ],
    defaultTemplate: DEFAULT_PROMPT_TEMPLATES.agentNodeRequirement,
  },
  {
    key: 'conflictResolution',
    label: 'Git 分支代码冲突自愈',
    category: '沙箱合并',
    description: '沙箱特性分支合入基线分支发生 Git Conflict 时唤醒 Agent 进行智能消解的指导词。',
    variables: [
      { name: '{{baseBranch}}', description: '目标基线分支名称' },
      { name: '{{conflictFiles}}', description: '冲突文件列表清单' },
    ],
    defaultTemplate: DEFAULT_PROMPT_TEMPLATES.conflictResolution,
  },
  {
    key: 'qaArtifactFeedback',
    label: 'UI 自动化测试产物附加词',
    category: '任务对话',
    description: '用户在任务对话抽屉中勾选“附带最新 UI 自动化测试产物”时，拼接注入的测试截图与时间轴说明。',
    variables: [
      { name: '{{qaRunId}}', description: '测试运行唯一 ID' },
      { name: '{{timelinePath}}', description: '时间轴数据文件本地路径' },
      { name: '{{screenshotPaths}}', description: '测试截帧图片文件绝对路径列表' },
    ],
    defaultTemplate: DEFAULT_PROMPT_TEMPLATES.qaArtifactFeedback,
  },
];

/**
 * 高性能获取生效提示词（内存直读，O(1) 复杂度，带安全兜底）
 */
export function getEffectivePrompt(
  key: AgentPromptKey,
  customPrompts?: Partial<Record<AgentPromptKey, string>>
): string {
  const custom = customPrompts?.[key];
  if (typeof custom === 'string' && custom.trim().length > 0) {
    return custom;
  }
  return DEFAULT_PROMPT_TEMPLATES[key] || '';
}

/**
 * 轻量变量插值助手函数
 */
export function renderPromptTemplate(template: string, context: Record<string, any>): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const parts = key.split('.');
    let val: any = context;
    for (const part of parts) {
      if (val === undefined || val === null) break;
      val = val[part];
    }
    return val !== undefined && val !== null ? String(val) : '';
  });
}
