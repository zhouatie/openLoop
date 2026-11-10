# 更新日志

本文件记录 openLoop 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.8.0] - 2025-11-10

首次对外开源。

### 新增

- Markdown 流水线：二级标题即步骤，随仓库同步、可评审、可 diff。
- 智能体工作台：会话树分支、`@` 文件引用、斜杠指令、工具卡与推理折叠、逐文件 Diff 审阅。
- 任务看板全生命周期：`Inbox → 待处理 → 执行中 → 待验收 → 已完成`。
- Worktree 沙箱隔离：自动建分支、软链依赖、动态端口与独立数据目录。
- QA 自动化（Web / Android / iOS）：Midscene 视觉驱动，用例套件与截图产物。
- 定时巡检与自动化任务：CLI、GitHub Issue、社交查询与自定义命令触发。
- 插件插槽系统：侧边栏插槽与自定义节点，支持第三方 Git 仓库插件。
- 全链路可观测：WebSocket 日志总线、流式终端、节点筛选与 ANSI 高亮。
- CLI 与桌面端同源：共享 Core Daemon，无 Daemon 时降级为内嵌引擎。

### 工程

- 双环境隔离：开发沙箱 `:19889` / `~/.openloop-dev`，稳定版 `:19888` / `~/.openloop`。
- 单端口生产部署、Docker 镜像与 macOS DMG 发布流水线。

[Unreleased]: https://github.com/zhouatie/openLoop/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/zhouatie/openLoop/releases/tag/v0.8.0
