# Markdown 流水线

一条流水线 = 一份人工写的 Markdown 流程文档。逻辑不写代码，写自然语言；执行由编排 Agent 读取文档后调工具完成。

与 skill 同构：文件头是身份，正文是流程说明，工具是能力边界。

## 文件形态

```md
---
name: openLoop 开发专用流水线
tags: 开发,QA
---

# 目标

把任务需求变成可验收的代码改动：隔离沙箱、AI 编码、QA 验收、人工卡点、合并。

# 流程

## 1. 建沙箱

建立隔离 worktree。分配两个端口：web 用 5175，core 用 19890。共享 node_modules。
就绪后报告分支、目录与端口。

## 2. AI 编码

起一个 Agent 会话，指令：

- 任务需求：{{task.title}}
- 详细说明：{{task.description}}
- 要求：代码保持极简；修改后确保基础编译通过。

超时 600 秒。

## 3. 构建校验

在沙箱内执行 `pnpm build`。失败就停，把报错原文记为失败原因，不继续下一步。

## 4. 人工卡点

提交人工验收，标题「构建与验收门禁」。
清单：改动符合需求、构建通过、无控制台报错。
等我决策；驳回时把驳回意见作为失败原因。

## 5. 合并与收尾

合并特性分支到本地开发分支，然后清理沙箱。

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
```

文件头只有 `id`、`name`、`tags` 三个键。`id` 由同步脚本写回，人不用手填。

## 怎么被解释

| 文档元素 | 运行期含义 |
| :--- | :--- |
| 文件头 `name` / `tags` | 流水线身份；`push` 用它建库记录 |
| `{{task.title}}`、`{{task.description}}` | 执行前替换为任务真实值 |
| `{{ports.webPort}}` | 沙箱端口，建沙箱之后才有值 |
| 二级标题 | 步骤名称，显示在任务时间轴 |
| 标题下正文 | 交给编排 Agent 的指令内容 |
| 行内代码 `` `pnpm build` `` | 原样使用，不改写 |

运行时把整篇文档交给一个编排 Agent。Agent 只能通过工具动手：

| 工具 | 作用 |
| :--- | :--- |
| `sandbox_create` | 建隔离 worktree，分配端口，切换任务工作区 |
| `run_command` | 执行一条 shell 命令，返回退出码与输出 |
| `agent_task` | 起一轮 Agent 会话编码或分析 |
| `run_node` | 执行任意注册节点：`qa-planner`、`midscene`、`env-prepare`、`hook` 等 |
| `ask_human` | 人工卡点，任务转 `waiting_approval`，等界面决策 |
| `sandbox_merge` | 合并特性分支 |
| `sandbox_cleanup` | 释放端口与沙箱目录 |
| `finish_pipeline` | 声明整条流水线结束，带成功或失败原因 |

每次工具调用落一条步骤记录，含状态、耗时、退出码与输出。界面时间轴、节点日志、人工卡点 Diff 与节点执行共用同一套视图。

## 表达精度

- 散文是默认写法：写「分配端口 5175」，Agent 会调 `sandbox_create` 并带上这个端口。
- 需要原样执行的命令、端口、超时放进行内代码。
- 硬门禁靠措辞与 `ask_human`：写「失败就停」，Agent 必须调 `finish_pipeline` 报失败，不能继续下一步。
- 人工驳回会直接终止流水线，任务回到 `backlog`。

## 唯一承载方式

流水线只有 Markdown 一种承载方式，正文存在 `workflow.markdown`。
编辑器只有一个流程文档输入框，没有步骤卡片，也没有脚本。

## 仓库同步

```bash
pnpm pipeline:pull     # 数据库 -> pipelines/*.md
pnpm pipeline:push     # pipelines/*.md -> 数据库
pnpm pipeline:check    # 只比对，有漂移退出码 1
pnpm pipeline:run pipelines/openLoop-开发专用流水线.md --workspace ~/My/openLoop --yes
```

`push` 会把解析出的 id 写回文件头：

```md
---
id: wf_worktree_auto_dev_qa_merge
name: openLoop 开发专用流水线
tags: 开发,QA
---
```

## 本地试跑

`run-pipeline.js` 只接受 `.md`。用临时数据目录启动宿主，不建看板任务。

- 遇到人工卡点在终端询问，`--yes` 自动通过。
- `--workspace` 决定真实工作目录，默认当前目录。
- 沙箱、命令行、Agent 都会真实产生副作用，执行前先确认工作目录。

## 边界

- 编排 Agent 没有直接改代码与执行 bash 的能力，动作一律走工具。
- 未调用 `finish_pipeline` 就结束的会话按失败处理，任务回到 `backlog`，日志写明原因。
- daemon 重启后挂起中的卡点作废，需要重新创建任务。
