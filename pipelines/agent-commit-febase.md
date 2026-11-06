---
id: wf_mvf7mq89
name: agent-commit-febase
tags: 工作
---

# 目标

agent 改完代码 + commit + febase 构建

# 流程

## 1. Agent 代码开发

调 `agent_task` 起一个 Agent 会话，agentName 用「CodeDeveloper」。
指令：

```text
按照需求完成代码修改，并确保本地自测通过
```

## 2. Git 提交代码

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。
失败就停，把报错原文记为失败原因。

```bash
git add -A && git commit -m "feat: auto commit by agent"
```

## 3. 推送到远程仓库

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。
失败就停，把报错原文记为失败原因。

```bash
git push origin HEAD
```

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
