// @pipeline id=wf_febase_app_deploy
// @name febase 部署
// @tags 部署

/**
 * febase 部署
 * 由编排画布转译生成的脚本流水线。
 */
export default async function (ctx) {
  const { sandbox, agent, approve, node, log } = ctx

  log("启动流水线: febase 部署")

  // AI 智能校验需求与锁定单据 (agent)
  const step1 = await agent({
    prompt: "请分析本次部署任务的需求内容：\n任务名称: {{task.title}}\n任务描述: {{task.description}}\n\n【关键前置规则：信息充足性校验与任务终止机制】\n在执行任何部署操作前，必须首先检查需求是否提供了全部必要信息：\n1. 必需要素核查：\n   - 目标应用名 (appName)：如 rn-lyric-share-page\n   - 代码分支 (branch)：如 feat/OMMUSIC-3825654\n   - 目标环境类型与域名/数字编号 (envType & domain)：如 PRETEST 或 TEST，以及 211 或 qa-test211.pretest.igame.163.com\n2. 若上述信息存在缺失或语义不明确（例如未提供分支或未指定环境）：\n   - 严禁自行猜测或随意默认参数！\n   - 执行清理指令：rm -f /tmp/openloop-febase-env.sh\n   - 将具体终止原因写入中止文件：echo \"【部署中止】Prompt 提供的信息不充足！缺失要素: <具体列出缺失项>。请补充后重新发起。\" > /tmp/openloop_abort_{{task.id}}\n   - 在日志中清晰打印错误原因，立即结束执行。\n3. 若信息完整充足：\n   - 确保清理旧中止文件：rm -f /tmp/openloop_abort_{{task.id}}\n   - 调用 mws 命令检索应用 (mws febase app-search --env online --json '{\"keyword\":\"<appName>\"}') 获取 appId。\n   - 调用 mws 命令获取该分支对应的活跃发布单 (mws febase sprint-list --env online --json '{\"appId\":<appId>,\"engineStatus\":\"running\"}') 获取 sprintId（如无活跃发布单则通过 sprint-create 创建）。\n   - 将解析出的结构化参数写入临时环境变量文件 /tmp/openloop-febase-env.sh：\n     export FEBASE_APP_ID=\"<appId>\"\n     export FEBASE_SPRINT_ID=\"<sprintId>\"\n     export FEBASE_ENV_TYPE=\"<envType>\"\n     export FEBASE_ENV_NAME=\"<envName>\"\n   - 打印解析确认摘要供下游 CLI 节点流转。",
    agentName: "Pi Agent",
    name: "AI 智能校验需求与锁定单据",
  })
  if (!step1.ok) return { status: 'failed', error: "节点「AI 智能校验需求与锁定单据」执行未通过" }

  // CLI 环境绑定与域名就绪 (cli)
  const step2 = await node("cli", {
    command: "if [ ! -f /tmp/openloop-febase-env.sh ]; then echo \"[ERROR] 前置参数校验未通过，缺少部署环境变量文件，任务终止！\" >&2; exit 1; fi && source /tmp/openloop-febase-env.sh && if [ -z \"$FEBASE_APP_ID\" ] || [ -z \"$FEBASE_SPRINT_ID\" ] || [ -z \"$FEBASE_ENV_NAME\" ]; then echo \"[ERROR] 部署参数不完整，任务终止！\" >&2; exit 1; fi && echo \"[FEBase] 正在为发布单 Sprint $FEBASE_SPRINT_ID 绑定环境 $FEBASE_ENV_NAME ($FEBASE_ENV_TYPE)...\" && mws febase sprint-env-create --env online --json \"{\\\"appId\\\":$FEBASE_APP_ID,\\\"sprintId\\\":$FEBASE_SPRINT_ID,\\\"envType\\\":\\\"$FEBASE_ENV_TYPE\\\",\\\"envName\\\":\\\"$FEBASE_ENV_NAME\\\"}\" || true",
    timeoutSec: 60,
  }, {
    name: "CLI 环境绑定与域名就绪",
  })
  if (!step2.ok) return { status: 'failed', error: "节点「CLI 环境绑定与域名就绪」执行未通过" }

  // CLI 触发云端打包部署 (cli)
  const step3 = await node("cli", {
    command: "if [ ! -f /tmp/openloop-febase-env.sh ]; then echo \"[ERROR] 缺少部署环境变量文件，任务终止！\" >&2; exit 1; fi && source /tmp/openloop-febase-env.sh && echo \"[FEBase] 正在触发云端 Tekton 打包构建 (App: $FEBASE_APP_ID, Sprint: $FEBASE_SPRINT_ID, Env: $FEBASE_ENV_NAME)...\" && (DEPLOY_OUTPUT=$(mws febase sprint-deploy --env online --json \"{\\\"appId\\\":$FEBASE_APP_ID,\\\"sprintId\\\":$FEBASE_SPRINT_ID,\\\"env\\\":\\\"$FEBASE_ENV_TYPE\\\",\\\"envName\\\":\\\"$FEBASE_ENV_NAME\\\"}\" 2>&1); DEPLOY_STATUS=$?; echo \"$DEPLOY_OUTPUT\"; if [ $DEPLOY_STATUS -eq 0 ]; then echo \"[FEBase] 部署指令触发成功！\" && exit 0; fi; echo \"[FEBase] 部署网关返回异常或网络抖动，正在复核云端实际就绪状态...\"; sleep 2; STATUS_CHECK=$(mws febase deploy-envs-status --env online --json \"{\\\"appId\\\":$FEBASE_APP_ID,\\\"sprintId\\\":$FEBASE_SPRINT_ID,\\\"env\\\":\\\"$FEBASE_ENV_TYPE\\\"}\" 2>&1); if echo \"$STATUS_CHECK\" | grep -q \"$FEBASE_ENV_NAME\"; then echo \"[FEBase] 复核通过：已在云端检测到目标域名 $FEBASE_ENV_NAME 的流水线任务，任务判定为成功！\"; echo \"$STATUS_CHECK\" | grep \"$FEBASE_ENV_NAME\"; exit 0; fi; echo \"[FEBase] 二次复核未就绪，重试一次部署触发...\"; mws febase sprint-deploy --env online --json \"{\\\"appId\\\":$FEBASE_APP_ID,\\\"sprintId\\\":$FEBASE_SPRINT_ID,\\\"env\\\":\\\"$FEBASE_ENV_TYPE\\\",\\\"envName\\\":\\\"$FEBASE_ENV_NAME\\\"}\"; )",
    timeoutSec: 120,
  }, {
    name: "CLI 触发云端打包部署",
  })
  if (!step3.ok) return { status: 'failed', error: "节点「CLI 触发云端打包部署」执行未通过" }

  return { status: 'success' }
}
