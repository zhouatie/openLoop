# 更新日志

本文件记录 openLoop 的显著变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.9.0] - 2026-11-24

### 变更

- 流水线脚本化：下线画布编排，流水线只保留 Markdown 与脚本节点。

### 新增

- 设备监视：Android / iOS 实时镜像与反向控制，右侧镜像浮层可用 `Super+M` 唤起。
- 本机模拟器支持启动与关闭，iOS 镜像增加三级降级串流。
- 设备镜像支持截图、切换设备、操作按键列移到画面左侧，并可在镜像内打开 App 后台与 URL。
- 智能体内可直接启动与关闭本机 RN 服务，不依赖任务触发。

### 修复

- 修复设备镜像卡死、上传无限转圈、iOS 冻结与点按无响应。
- 修复设备镜像断流黑屏：会话随流结束销毁，前端自动重连。
- Worktree 冲突自愈改以文件内容判定，并由节点统一暂存。
- 修复 Agent 中止被误报为错误，以及会话终止时扩展拿到失效 ctx。

### 工程

- Electron 版本统一由 `package.json` 决定，移除 electron-builder 固定版本。
- 固定 Electron 二进制下载镜像，避免代理访问 GitHub 504。

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

[Unreleased]: https://github.com/zhouatie/openLoop/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/zhouatie/openLoop/releases/tag/v0.9.0
[0.8.0]: https://github.com/zhouatie/openLoop/releases/tag/v0.8.0
