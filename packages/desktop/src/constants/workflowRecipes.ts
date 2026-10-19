import React from 'react';
import {
  Bot,
  Zap,
  Target,
  FileVideo,
  CheckSquare,
  Terminal,
  GitCommit,
  Rocket,
  Layers,
  Sparkles,
  ClipboardCheck,
  Cpu,
  Workflow,
  CheckCircle2,
  FileCode,
  ShieldCheck,
  PlayCircle,
  Bell,
  Split,
} from 'lucide-react';
import { NodeType, NodeConfig } from '@openloop/core';

export type RecipeCategory = 'ai' | 'quality' | 'testing' | 'release' | 'env';

export interface WorkflowRecipe {
  id: string;
  name: string;
  subtitle: string;
  category: RecipeCategory;
  categoryLabel: string;
  type: NodeType;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  iconBg: string;
  iconText: string;
  borderClass: string;
  badge: string;
  defaultName: string;
  defaultConfig: Partial<NodeConfig>;
  description: string;
  popular?: boolean;
}

export const WORKFLOW_RECIPE_CATEGORIES: { id: RecipeCategory; label: string }[] = [
  { id: 'ai', label: 'AI 智能体' },
  { id: 'quality', label: '代码与构建' },
  { id: 'testing', label: '自动化与验收' },
  { id: 'env', label: '环境与沙箱' },
  { id: 'release', label: '发布与协同' },
];

export const WORKFLOW_RECIPES: WorkflowRecipe[] = [
  // 1. AI 智能体
  {
    id: 'agent-feature',
    name: 'AI 自动实现需求',
    subtitle: 'Agent 自主读取上下文、定位代码并完成编码开发',
    category: 'ai',
    categoryLabel: 'AI 智能体',
    type: 'agent',
    icon: Bot,
    iconBg: 'bg-[#eeedfd]',
    iconText: 'text-[#4f46e5]',
    borderClass: 'border-[#d8d6fb]',
    badge: '推荐',
    popular: true,
    defaultName: 'AI 自动实现需求',
    defaultConfig: {
      agentName: 'Coder',
      prompt: '请根据当前任务需求描述与验收标准，仔细分析关联模块，完成代码修改并确保不破坏既有功能。',
    },
    description: '通过智能体全自动进行代码分析、文件编辑与功能实现，并输出变更日志。',
  },
  {
    id: 'agent-review',
    name: 'AI 代码走查评审',
    subtitle: '智能分析 Git Diff，检查潜在缺陷、坏味道与可维护性',
    category: 'ai',
    categoryLabel: 'AI 智能体',
    type: 'agent',
    icon: ShieldCheck,
    iconBg: 'bg-[#faf5ff]',
    iconText: 'text-[#9333ea]',
    borderClass: 'border-[#f3e8ff]',
    badge: '走查',
    popular: true,
    defaultName: 'AI 代码走查评审',
    defaultConfig: {
      agentName: 'Reviewer',
      prompt: '请严格审查当前分支所有未提交的更改或最近一次 Commit。重点检查潜在运行时 Bug、边界条件处理、空指针安全与冗余代码，并给出简洁的改进建议。',
    },
    description: '模拟资深技术专家的 Fresh-Context 独立代码评审，输出审查报告。',
  },
  {
    id: 'agent-test-gen',
    name: 'AI 编写单元测试',
    subtitle: '分析核心业务逻辑，自动编写高覆盖率单测用例',
    category: 'ai',
    categoryLabel: 'AI 智能体',
    type: 'agent',
    icon: FileCode,
    iconBg: 'bg-[#f0fdf4]',
    iconText: 'text-[#16a34a]',
    borderClass: 'border-[#dcfce7]',
    badge: '单测',
    defaultName: 'AI 编写单元测试',
    defaultConfig: {
      agentName: 'Tester',
      prompt: '请为当前功能模块新编写或修改的方法补充完善的单元测试用例，覆盖典型正常路径与异常边界情况，确保用例可直接跑通。',
    },
    description: '智能生成基于项目测试框架（Vitest / Jest）的测试用例文件。',
  },

  // 2. 代码质量与构建
  {
    id: 'cli-lint',
    name: '代码规范检查 (Lint)',
    subtitle: '执行静态代码扫描，保证代码风格与规则一致性',
    category: 'quality',
    categoryLabel: '代码与构建',
    type: 'cli',
    icon: Terminal,
    iconBg: 'bg-[#f4f4f6]',
    iconText: 'text-[#4b4b53]',
    borderClass: 'border-[#e3e3e8]',
    badge: '基础',
    popular: true,
    defaultName: '代码规范检查',
    defaultConfig: {
      command: 'pnpm lint || npm run lint',
    },
    description: '执行 ESLint / Prettier 规范校验，失败则阻断流水线。',
  },
  {
    id: 'cli-typecheck',
    name: 'TypeScript 类型校验',
    subtitle: '严格执行静态类型推断检查，杜绝隐式 any 与类型遗漏',
    category: 'quality',
    categoryLabel: '代码与构建',
    type: 'cli',
    icon: CheckCircle2,
    iconBg: 'bg-[#f0f9ff]',
    iconText: 'text-[#0284c7]',
    borderClass: 'border-[#e0f2fe]',
    badge: '静态分析',
    popular: true,
    defaultName: 'TypeScript 类型校验',
    defaultConfig: {
      command: 'pnpm tsc --noEmit || npx tsc --noEmit',
    },
    description: '通过 tsc --noEmit 执行类型检查，防止带错合入。',
  },
  {
    id: 'cli-test',
    name: '运行单元测试',
    subtitle: '全量或增量执行测试用例集，验证功能正确性',
    category: 'quality',
    categoryLabel: '代码与构建',
    type: 'cli',
    icon: PlayCircle,
    iconBg: 'bg-[#ecfdf5]',
    iconText: 'text-[#059669]',
    borderClass: 'border-[#d1fae5]',
    badge: '测试',
    popular: true,
    defaultName: '运行单元测试',
    defaultConfig: {
      command: 'pnpm test || npm test',
    },
    description: '执行项目测试套件，实时输出通过率报告。',
  },
  {
    id: 'cli-build',
    name: '项目编译打包 (Build)',
    subtitle: '执行生产级构建打包，验证编译产物完整性',
    category: 'quality',
    categoryLabel: '代码与构建',
    type: 'cli',
    icon: Rocket,
    iconBg: 'bg-[#0f172a]',
    iconText: 'text-[#38bdf8]',
    borderClass: 'border-[#1e293b]',
    badge: '构建',
    defaultName: '项目编译打包',
    defaultConfig: {
      command: 'pnpm build || npm run build',
    },
    description: '生产打包命令，确认打包无报错且资源无缺失。',
  },

  // 3. 自动化与验收
  {
    id: 'midscene-test',
    name: 'Midscene 视觉自动化测试',
    subtitle: 'AI 驱动的多模态浏览器端到端交互走查与智能断言',
    category: 'testing',
    categoryLabel: '自动化与验收',
    type: 'midscene',
    icon: Target,
    iconBg: 'bg-[#e4f6ec]',
    iconText: 'text-[#15803d]',
    borderClass: 'border-[#bbf7d0]',
    badge: 'AI UI 测试',
    popular: true,
    defaultName: 'Midscene 视觉回归',
    defaultConfig: {
      testUrl: 'http://localhost:3000',
      instructions: [
        '检查页面关键元素与主导航栏是否完整展示',
        '点击主操作按钮，确认弹窗正常呼出',
      ],
    },
    description: '使用大模型视觉能力自动操控浏览器、截屏并验证业务界面是否符合预期。',
  },
  {
    id: 'qa-approval-gate',
    name: 'QA 视觉与功能人工验收门禁',
    subtitle: '流水线阻断点，等待测试工程师或研发确认后继续执行',
    category: 'testing',
    categoryLabel: '自动化与验收',
    type: 'qa-approval',
    icon: CheckSquare,
    iconBg: 'bg-[#fef3c7]',
    iconText: 'text-[#b45309]',
    borderClass: 'border-[#fde68a]',
    badge: '人工门禁',
    popular: true,
    defaultName: 'QA 人工验收门禁',
    defaultConfig: {
      approvalPrompt: '请重点核对上述阶段生成的截图与测试结果，确认界面还原度与主要交互无缺陷后点击通过。',
    },
    description: '在流水线中设置人工卡点，提供一键核验与驳回重试控制。',
  },
  {
    id: 'stitch-image-gif',
    name: '测试动图合成 (GIF)',
    subtitle: '将测试过程产生的高清连续截屏自动拼接为动图',
    category: 'testing',
    categoryLabel: '自动化与验收',
    type: 'stitch-image',
    icon: FileVideo,
    iconBg: 'bg-[#eff6ff]',
    iconText: 'text-[#1d4ed8]',
    borderClass: 'border-[#bfdbfe]',
    badge: '可视化',
    defaultName: '生成验收动图',
    defaultConfig: {
      outputFile: 'preview.gif',
      outputFormat: 'gif',
    },
    description: '自动收集测试运行截屏，生成可在 PR 或看板中直观呈现的动态演示。',
  },

  // 4. 环境与沙箱
  {
    id: 'worktree-isolate',
    name: 'Git Worktree 独立沙箱隔离',
    subtitle: '在独立沙箱目录执行任务，完全不污染主工作区与主分支',
    category: 'env',
    categoryLabel: '环境与沙箱',
    type: 'worktree-setup',
    icon: Layers,
    iconBg: 'bg-[#f0fdf4]',
    iconText: 'text-[#15803d]',
    borderClass: 'border-[#bbf7d0]',
    badge: '安全隔离',
    defaultName: '沙箱环境隔离',
    defaultConfig: {
      sharedPaths: ['node_modules'],
      allocatePorts: ['webPort'],
      basePort: 5175,
    },
    description: '创建轻量 Git Worktree 分支与专属动态端口，支持并发任务安全运行。',
  },
  {
    id: 'env-prepare-service',
    name: '现场服务准备与健康探测',
    subtitle: '后台拉起本地开发服务，轮询等待 HTTP 端口探针就绪',
    category: 'env',
    categoryLabel: '环境与沙箱',
    type: 'env-prepare',
    icon: Cpu,
    iconBg: 'bg-[#ecfdf5]',
    iconText: 'text-[#047857]',
    borderClass: 'border-[#a7f3d0]',
    badge: '就绪检查',
    defaultName: '拉起本地预览服务',
    defaultConfig: {
      command: 'pnpm dev',
      healthUrl: 'http://localhost:5173',
      warmupTimeoutMs: 30000,
      background: true,
    },
    description: '在后台启动待测服务，并持续轮询健康检查接口直到返回 200。',
  },

  // 5. 发布与协同
  {
    id: 'git-auto-commit',
    name: 'Git 变更自动提交',
    subtitle: '自动暂存修改并创建规范化的 Git Commit',
    category: 'release',
    categoryLabel: '发布与协同',
    type: 'cli',
    icon: GitCommit,
    iconBg: 'bg-[#1c1c21]',
    iconText: 'text-white',
    borderClass: 'border-[#1c1c21]',
    badge: '版本管理',
    popular: true,
    defaultName: 'Git 自动提交',
    defaultConfig: {
      command:
        'git add -A && if git diff --staged --quiet; then echo "工作区干净，无需提交"; else git commit -m "feat: {{task.title}}" && git log -1 --stat; fi',
    },
    description: '检测未提交更改，自动执行规范化 commit 操作并输出简要说明。',
  },
  {
    id: 'hook-notify',
    name: 'Webhook 机器人通知',
    subtitle: '将流水线状态或关键产物一键广播至飞书/企微/钉钉群',
    category: 'release',
    categoryLabel: '发布与协同',
    type: 'hook',
    icon: Bell,
    iconBg: 'bg-[#ffedd5]',
    iconText: 'text-[#c2410c]',
    borderClass: 'border-[#fed7aa]',
    badge: '消息广播',
    defaultName: '群机器人通知',
    defaultConfig: {
      hookType: 'webhook',
      webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx',
    },
    description: '通过 Webhook 将任务结果推送至协同通讯平台。',
  },
  {
    id: 'sub-workflow-call',
    name: '子流水线 / 支线调用',
    subtitle: '将成熟的公共流水线作为子模块内嵌执行',
    category: 'release',
    categoryLabel: '发布与协同',
    type: 'sub-workflow',
    icon: Workflow,
    iconBg: 'bg-[#f0f9ff]',
    iconText: 'text-[#0284c7]',
    borderClass: 'border-[#bae6fd]',
    badge: '流程复用',
    defaultName: '调用子流水线',
    defaultConfig: {
      inheritContext: true,
    },
    description: '复用其他已编排好的流水线，支持跨流水线传递上下文。',
  },
];
