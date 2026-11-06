---
id: wf_febase_app_deploy
name: febase 部署
tags: 部署
---

# 目标

AI Agent 驱动的极简部署编排流水线：Agent 智能校验 Prompt 充足性并锁定发布单（信息不足自动终止） -> 原生 mws CLI 分配环境 -> 原生 mws CLI 触发云端打包

# 流程

## 1. AI 智能校验需求与锁定单据

调 `agent_task` 起一个 Agent 会话，agentName 用「Pi Agent」。
指令：

```text
请分析本次部署任务的需求内容：
任务名称: {{task.title}}
任务描述: {{task.description}}

【关键前置规则：信息充足性校验与任务终止机制】
在执行任何部署操作前，必须首先检查需求是否提供了全部必要信息：
1. 必需要素核查：
   - 目标应用名 (appName)：如 rn-lyric-share-page
   - 代码分支 (branch)：如 feat/OMMUSIC-3825654
   - 目标环境类型与域名/数字编号 (envType & domain)：如 PRETEST 或 TEST，以及 211 或 qa-test211.pretest.igame.163.com
2. 若上述信息存在缺失或语义不明确（例如未提供分支或未指定环境）：
   - 严禁自行猜测或随意默认参数！
   - 执行清理指令：rm -f /tmp/openloop-febase-env.sh
   - 将具体终止原因写入中止文件：echo "【部署中止】Prompt 提供的信息不充足！缺失要素: <具体列出缺失项>。请补充后重新发起。" > /tmp/openloop_abort_{{task.id}}
   - 在日志中清晰打印错误原因，立即结束执行。
3. 若信息完整充足：
   - 确保清理旧中止文件：rm -f /tmp/openloop_abort_{{task.id}}
   - 调用 mws 命令检索应用 (mws febase app-search --env online --json '{"keyword":"<appName>"}') 获取 appId。
   - 调用 mws 命令获取该分支对应的活跃发布单 (mws febase sprint-list --env online --json '{"appId":<appId>,"engineStatus":"running"}') 获取 sprintId（如无活跃发布单则通过 sprint-create 创建）。
   - 将解析出的结构化参数写入临时环境变量文件 /tmp/openloop-febase-env.sh：
     export FEBASE_APP_ID="<appId>"
     export FEBASE_SPRINT_ID="<sprintId>"
     export FEBASE_ENV_TYPE="<envType>"
     export FEBASE_ENV_NAME="<envName>"
   - 打印解析确认摘要供下游 CLI 节点流转。
```

## 2. CLI 环境绑定与域名就绪

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 60 秒。
失败就停，把报错原文记为失败原因。

```bash
if [ ! -f /tmp/openloop-febase-env.sh ]; then echo "[ERROR] 前置参数校验未通过，缺少部署环境变量文件，任务终止！" >&2; exit 1; fi && source /tmp/openloop-febase-env.sh && if [ -z "$FEBASE_APP_ID" ] || [ -z "$FEBASE_SPRINT_ID" ] || [ -z "$FEBASE_ENV_NAME" ]; then echo "[ERROR] 部署参数不完整，任务终止！" >&2; exit 1; fi && echo "[FEBase] 正在为发布单 Sprint $FEBASE_SPRINT_ID 绑定环境 $FEBASE_ENV_NAME ($FEBASE_ENV_TYPE)..." && mws febase sprint-env-create --env online --json "{\"appId\":$FEBASE_APP_ID,\"sprintId\":$FEBASE_SPRINT_ID,\"envType\":\"$FEBASE_ENV_TYPE\",\"envName\":\"$FEBASE_ENV_NAME\"}" || true
```

## 3. CLI 触发云端打包部署

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 120 秒。
失败就停，把报错原文记为失败原因。

```bash
if [ ! -f /tmp/openloop-febase-env.sh ]; then echo "[ERROR] 缺少部署环境变量文件，任务终止！" >&2; exit 1; fi && source /tmp/openloop-febase-env.sh && echo "[FEBase] 正在触发云端 Tekton 打包构建 (App: $FEBASE_APP_ID, Sprint: $FEBASE_SPRINT_ID, Env: $FEBASE_ENV_NAME)..." && (DEPLOY_OUTPUT=$(mws febase sprint-deploy --env online --json "{\"appId\":$FEBASE_APP_ID,\"sprintId\":$FEBASE_SPRINT_ID,\"env\":\"$FEBASE_ENV_TYPE\",\"envName\":\"$FEBASE_ENV_NAME\"}" 2>&1); DEPLOY_STATUS=$?; echo "$DEPLOY_OUTPUT"; if [ $DEPLOY_STATUS -eq 0 ]; then echo "[FEBase] 部署指令触发成功！" && exit 0; fi; echo "[FEBase] 部署网关返回异常或网络抖动，正在复核云端实际就绪状态..."; sleep 2; STATUS_CHECK=$(mws febase deploy-envs-status --env online --json "{\"appId\":$FEBASE_APP_ID,\"sprintId\":$FEBASE_SPRINT_ID,\"env\":\"$FEBASE_ENV_TYPE\"}" 2>&1); if echo "$STATUS_CHECK" | grep -q "$FEBASE_ENV_NAME"; then echo "[FEBase] 复核通过：已在云端检测到目标域名 $FEBASE_ENV_NAME 的流水线任务，任务判定为成功！"; echo "$STATUS_CHECK" | grep "$FEBASE_ENV_NAME"; exit 0; fi; echo "[FEBase] 二次复核未就绪，重试一次部署触发..."; mws febase sprint-deploy --env online --json "{\"appId\":$FEBASE_APP_ID,\"sprintId\":$FEBASE_SPRINT_ID,\"env\":\"$FEBASE_ENV_TYPE\",\"envName\":\"$FEBASE_ENV_NAME\"}"; )
```

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
