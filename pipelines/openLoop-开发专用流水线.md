---
id: wf_worktree_auto_dev_qa_merge
name: openLoop 开发专用流水线
tags: 开发,QA
---

# 目标

端到端全闭环研发流水线：根据需求创建 Git Worktree 与独立端口靶机，Agent 隔离编写代码，Playwright 真实浏览器 UI 自动化截帧（任务配置验收用例时才执行），在人工门禁打开靶机自测验收通过后自动合并到开发分支并清理沙箱

# 流程

## 1. Worktree 隔离沙箱就绪

调 `sandbox_create` 建立隔离 worktree 沙箱：分配端口 webPort、corePort（webPort 基准 5175，corePort 基准 19890），共享 node_modules、packages/*/node_modules。超时 120 秒。
就绪后报告分支、目录与端口。失败就停，把报错原文记为失败原因。

## 2. AI 开发者隔离编码实现

调 `agent_task` 起一个 Agent 会话，agentName 用「Pi Coding Agent」。超时 600 秒。
指令：

```text
请在当前 Worktree 隔离工作区中完成任务代码修改与验证：
任务需求：{{task.title}}
详细说明：{{task.description}}
执行规范：保持代码极简整洁，修改完毕后确保基础编译通过。
```

## 3. QA 黑盒验收用例设计

调 `run_node`，type 用 `qa-planner`，设计黑盒验收用例。超时 60 秒。
失败就停。

## 4. 测试现场准备与服务就绪

调 `run_node`，type 用 `env-prepare` 拉起开发服务靶机。超时 120 秒。
就绪检查地址用 `http://127.0.0.1:{{ports.webPort}}`。
预热最长等待 30000 毫秒。
background 用 `true`：服务常驻后台，不要等它退出。
config 里的 command 用下面这段命令原文，不要改写：

```bash
pnpm --filter @openloop/desktop dev --port {{ports.webPort}} --strictPort --host 0.0.0.0
```
服务在后台常驻，失败就停。

## 5. 自动化测试执行与视觉截帧

调 `run_node`，type 用 `midscene` 执行 UI 自动化验收与视觉截帧。超时 180 秒。
platform 用 `web`。
instructions 不要自行编写：只由任务的验收用例提供。任务未配置验收用例时，该步骤会自动跳过，不截图。
失败就停。

## 6. 靶机自测与人工验收门禁

调 `ask_human` 提交人工验收门禁。
标题用「靶机自测与人工验收门禁」。
说明用「请打开沙箱靶机自测，核对变更统计，确认效果无误后点击【验收通过并合并】」。
清单：

- 靶机自测中界面交互符合预期
- 页面无报错与异常提示
- 变更代码 Diff 准确且无冗余文件
等我决策；驳回就把驳回意见作为失败原因，整条流水线终止。

## 7. 自动合并代码分支

调 `sandbox_merge` 把特性分支合并回本地开发分支。失败就停，把冲突原文记为失败原因。

## 8. 环境释放与沙箱清理

调 `sandbox_cleanup` 释放端口与沙箱目录。

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
