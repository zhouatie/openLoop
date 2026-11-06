// @pipeline id=wf_worktree_auto_dev_qa_merge
// @name openLoop 开发专用流水线
// @tags 开发,QA

/**
 * openLoop 开发专用流水线
 * 由编排画布转译生成的脚本流水线。
 */
export default async function (ctx) {
  const { sandbox, agent, approve, node, log } = ctx

  log("启动流水线: openLoop 开发专用流水线")

  // Worktree 隔离沙箱就绪 (worktree-setup)
  const step1 = await sandbox.create({
    allocatePorts: [
      "webPort",
      "corePort"
    ],
    basePort: 5175,
    portBases: {
      "webPort": 5175,
      "corePort": 19890
    },
    sharedPaths: [
      "node_modules",
      "packages/*/node_modules"
    ],
    timeoutSec: 120,
    name: "Worktree 隔离沙箱就绪",
  })
  if (!step1.ok) return { status: 'failed', error: "节点「Worktree 隔离沙箱就绪」执行未通过" }

  // AI 开发者隔离编码实现 (agent)
  const step2 = await agent({
    prompt: "请在当前 Worktree 隔离工作区中完成任务代码修改与验证：\n任务需求：{{task.title}}\n详细说明：{{task.description}}\n执行规范：保持代码极简整洁，修改完毕后确保基础编译通过。",
    agentName: "Pi Coding Agent",
    timeoutSec: 600,
    name: "AI 开发者隔离编码实现",
  })
  if (!step2.ok) return { status: 'failed', error: "节点「AI 开发者隔离编码实现」执行未通过" }

  // QA 黑盒验收用例设计 (qa-planner)
  const step3 = await node("qa-planner", {
    timeoutSec: 60,
  }, {
    name: "QA 黑盒验收用例设计",
  })
  if (!step3.ok) return { status: 'failed', error: "节点「QA 黑盒验收用例设计」执行未通过" }

  // 测试现场准备与服务就绪 (env-prepare)
  const step4 = await node("env-prepare", {
    command: "pnpm --filter @openloop/desktop dev --port {{ports.webPort}} --strictPort --host 0.0.0.0",
    healthUrl: "http://127.0.0.1:{{ports.webPort}}",
    targetPlatform: "web",
    warmupTimeoutMs: 30000,
    background: true,
    timeoutSec: 120,
  }, {
    name: "测试现场准备与服务就绪",
  })
  if (!step4.ok) return { status: 'failed', error: "节点「测试现场准备与服务就绪」执行未通过" }

  // 自动化测试执行与视觉截帧 (midscene)
  const step5 = await node("midscene", {
    platform: "web",
    instructions: [
      "等待页面完全加载，检查首屏主视觉元素",
      "定位核心交互按钮并触发点击",
      "校验页面无报错与异常提示"
    ],
    timeoutSec: 180,
  }, {
    name: "自动化测试执行与视觉截帧",
  })
  if (!step5.ok) return { status: 'failed', error: "节点「自动化测试执行与视觉截帧」执行未通过" }

  // 视觉操作回放与验收门禁 (qa-approval)
  const step6 = await approve({
    title: "视觉操作回放与验收门禁",
    prompt: "请查看 UI 自动化截帧序列回放与变更统计，确认效果无误后点击【验收通过并合并】",
    checklist: [
      "AI 真实浏览器操作流程完整且无报错",
      "截帧回放中界面交互符合预期",
      "变更代码 Diff 准确且无冗余文件"
    ],
  })
  if (!step6.ok) return { status: 'failed', error: "节点「视觉操作回放与验收门禁」执行未通过" }

  // 自动合并代码分支 (worktree-merge)
  const step7 = await sandbox.merge({
    name: "自动合并代码分支",
  })
  if (!step7.ok) return { status: 'failed', error: "节点「自动合并代码分支」执行未通过" }

  // 环境释放与沙箱清理 (worktree-cleanup)
  const step8 = await sandbox.cleanup({
    name: "环境释放与沙箱清理",
  })
  if (!step8.ok) return { status: 'failed', error: "节点「环境释放与沙箱清理」执行未通过" }

  return { status: 'success' }
}
