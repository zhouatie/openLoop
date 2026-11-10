<div align="center">
  <img src="docs/branding/openloop-owl-mark.svg" width="88" alt="openLoop" />
  <h1>openLoop</h1>
  <p>把「需求 → 编码 → 验证 → 验收」串成一条可观测的桌面流水线</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1c1c21" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/node-%E2%89%A522-4f46e5" alt="Node 22+" />
    <img src="https://img.shields.io/badge/pnpm-%E2%89%A510-4f46e5" alt="pnpm 10+" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-1c1c21" alt="Platform" />
    <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-4f46e5" alt="PRs welcome" /></a>
  </p>
  <p><a href="README.en.md">English</a> · <a href="docs/README.md">文档</a> · <a href="CONTRIBUTING.md">贡献</a> · <a href="CHANGELOG.md">更新日志</a></p>
</div>

---

openLoop 是一个**全自动化、可编排、可插件化扩展**的桌面流水线平台。它不做「一次性的脚本集合」，而是把团队与 Agent 的协作过程沉淀成仓库里的可评审资产：流水线是 Markdown，任务是 Worktree，验收是截图与断言。

三种使用形态，共享同一个 Core 内核：

| 形态 | 入口 | 适用场景 |
| :--- | :--- | :--- |
| 桌面客户端 | Electron | 日常编排、Agent 工作台、任务看板 |
| Web 界面 | 浏览器访问 Core | 远程查看任务、团队评审 |
| 命令行 | `openloop` CLI | CI、脚本化触发、单机快速执行 |

> 当前版本 `0.8.0`，处于早期预览阶段。接口与数据结构仍可能调整，破坏性变更会写入 [CHANGELOG](CHANGELOG.md)。

---

## 目录

- [核心能力](#核心能力)
- [架构与目录结构](#架构与目录结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [常用脚本](#常用脚本)
- [命令行用法](#命令行用法)
- [环境变量](#环境变量)
- [典型自动化闭环](#典型自动化闭环)
- [文档](#文档)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

---

## 核心能力

| 能力 | 说明 |
| :--- | :--- |
| **Markdown 流水线** | 一条流水线 = 一份人工写的流程文档：二级标题即步骤，编排 Agent 读文档调受控工具执行；文档随仓库同步、可评审、可 diff。 |
| **智能体工作台** | 内置多轮 Agent 会话：会话树分支、`@` 文件引用与斜杠指令、工具卡与推理折叠、变更文件清单与逐文件 Diff 审阅、任务级子代理编排。 |
| **任务看板全生命周期** | `Inbox → 待处理 → 执行中 → 待验收 → 已完成` 泳道流转，卡片内嵌步骤时间轴、步骤日志与人工卡点。 |
| **Worktree 沙箱隔离** | 每个任务自动创建 Git Worktree、软链共享 `node_modules`、动态分配端口与独立数据目录，多任务并发互不干扰。 |
| **QA 自动化（Web / Android / iOS）** | 基于 Midscene 多模态视觉驱动；用例套件、时间轴回放、截图与动图产物；移动端未配置模型密钥时自动降级为 ADB / WDA 源码树直通模式。 |
| **定时巡检与自动化任务** | 按周期轮询 CLI 脚本、GitHub Issue、社交查询或自定义命令，命中即创建任务或直连流水线。 |
| **插件插槽系统** | 侧边栏插槽与自定义节点扩展解耦于基座，内置看板、编排、自动化、QA、插件中心；支持第三方 Git 仓库插件。 |
| **全链路可观测** | WebSocket 实时日志总线、流式终端抽屉、按节点筛选、ANSI 高亮，CLI 侧同样可实时跟随。 |
| **CLI 与桌面同源** | 桌面端与 CLI 共享同一个 Core Daemon；Daemon 未启动时 CLI 自动降级为内嵌引擎单机执行。 |

---

## 架构与目录结构

```
openLoop/
├── packages/
│   ├── core/       # 流水线调度、任务状态机、执行器、SQLite 存储、Agent 会话宿主、QA 运行时、HTTP/WebSocket 服务
│   ├── cli/        # openloop 命令行客户端（daemon / workflow / task / plugin / qa / run）
│   └── desktop/    # Electron + React 桌面端与 Web 前端（看板、流水线、Agent 工作台、插件沙箱）
├── pipelines/      # 示例流水线（Markdown 即流程，可直接在界面上导入或修改）
├── docs/           # 架构、插件系统、设计系统、移动端 QA 与品牌资源
├── scripts/        # 开发沙箱、端口清理、数据克隆、打包与部署脚本
└── build/          # 应用图标与签名配置
```

内核是单进程 Daemon：它持有 SQLite、任务状态机与执行器，通过 HTTP + WebSocket 对三种形态提供同一套能力；插件运行在独立沙箱进程中，通过 OLPP 协议与基座通信（见 [docs/plugin-system/architecture.md](docs/plugin-system/architecture.md)）。

---

## 环境要求

- **Node.js 22+**（原生模块 `better-sqlite3` 需要与 Node ABI 匹配）
- **pnpm 10+**（`corepack enable` 即可启用）
- macOS 打包 Electron 需要 Xcode 命令行工具；iOS 自动化需要 WebDriverAgent

---

## 快速开始

```bash
pnpm install
pnpm build          # 全量编译 core + cli + desktop
```

### 开发沙箱（推荐日常开发）

```bash
pnpm dev            # Core 服务 :19889 + Vite 前端 :5173
```

打开 <http://localhost:5173> 即可使用全部界面能力。

开发沙箱与稳定版严格隔离，避免调试动作影响正在运行的生产任务：

| 项 | 开发沙箱 | 稳定生产 |
| :--- | :--- | :--- |
| Core 端口 | `19889` | `19888` |
| 数据目录 | `~/.openloop-dev` | `~/.openloop` |
| 前端 | Vite `5173` | Core 单端口托管 |

需要把稳定版数据克隆到沙箱调试时执行 `pnpm db:fork`。

### 桌面客户端

```bash
pnpm dev:desktop    # Vite 热更新 + Electron 窗口
pnpm desktop:start  # 直接启动已构建产物
```

全局 Agent 工作台快捷键：Super 键 + 反引号。快捷键可在「设置 → 快捷键」中改绑。

### 单端口生产部署

```bash
pnpm deploy         # 清理端口 + 全量构建 + 产物校验
pnpm start:prod     # :19888 同时托管 API、WebSocket 与 Web 前端
```

### Docker

```bash
pnpm deploy:docker  # 等价于 docker compose up -d --build
```

镜像暴露 `19888`，SQLite 数据持久化在命名卷 `openloop-data`，内置 `/api/status` 健康检查。

### macOS 安装包

```bash
pnpm electron:build:mac   # 生成 DMG（需自行配置签名）
pnpm pack:mac             # 打包并输出本地安装包
pnpm pack:install         # 打包并覆盖安装本机应用
```

---

## 常用脚本

| 脚本 | 作用 |
| :--- | :--- |
| `pnpm dev` / `pnpm dev:desktop` | 启动开发沙箱（浏览器 / 桌面窗口） |
| `pnpm service:start` / `pnpm service:restart` | 启动 / 重启 Core 服务（默认 `:19888`） |
| `pnpm build` | 全量构建；`build:core`、`build:cli`、`build:desktop` 可单独执行 |
| `pnpm cli <args>` | 调用 CLI（等价于 `node packages/cli/dist/index.js`） |
| `pnpm clean:ports` / `clean:ports:all` | 清理被占用端口（`--all` 含稳定版端口，慎用） |
| `pnpm db:fork` | 克隆稳定版数据库到开发沙箱 |
| `pnpm pack` | 打开打包控制台（非交互终端默认本地安装） |
| `pnpm pack:mac` / `pack:all` | 当前架构 DMG + ZIP / arm64 + x64 全平台发布包 |
| `pnpm pack:install` | 打包并安装到 `/Applications` |

---

## 命令行用法

CLI 优先连接 daemon；连接失败时自动以内嵌引擎运行，便于单机脚本化。

```bash
# 守护进程
pnpm cli daemon start --port 19888
pnpm cli daemon status

# 流水线与插件
pnpm cli workflow list
pnpm cli plugin list

# 创建任务并实时跟随日志
pnpm cli task create --workflow <workflow_id> --title "用户中心登录优化" --follow

# 快捷触发：自动挑选流水线，也可直接传自然语言需求
pnpm cli run "构建并部署应用"

# 查询与日志
pnpm cli task list
pnpm cli task show <task_id>
pnpm cli task logs <task_id> -f

# 人工卡点：通过 / 驳回
pnpm cli task approve <task_id> -c "动图符合预期，用例通过"
pnpm cli task approve <task_id> --reject -c "页面断言未通过"

# QA 自动化
pnpm cli qa list
pnpm cli qa run <suiteId>
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `OPENLOOP_PORT` | `19888` | Core 服务端口 |
| `OPENLOOP_HOST` | `127.0.0.1` | 监听地址；容器内使用 `0.0.0.0` |
| `OPENLOOP_STORE_DIR` | `~/.openloop` | 数据目录（SQLite、日志、QA 产物） |
| `OPENLOOP_STATIC_DIR` | 自动推导 | 生产托管的前端静态目录 |
| `OPENLOOP_LOG_LEVEL` | 生产 `info`、开发 `debug` | 服务日志级别 |
| `VITE_CORE_PORT` | `19889` | 开发态 Vite 代理的 Core 端口 |
| `MIDSCENE_MODEL_BASE_URL` / `_API_KEY` / `_NAME` / `_FAMILY` | 空 | QA 多模态模型；也可在「设置 → 自动化测试」填写并即时生效 |

---

## 典型自动化闭环

```
创建任务（界面 / CLI / 定时巡检）
        │
        ▼
(1) worktree-setup：建分支、软链依赖、分配端口、拉起待测服务
        │
        ▼
(2) agent 节点：pi / Claude Code / Codex / OpenCode 完成编码
        │
        ▼
(3) 质量门禁：Lint、tsc、单测、构建
        │
        ▼
(4) Midscene 节点：按提示词执行 UI 自动化并逐步截屏
        │
        ▼
(5) 动图合成：拼接截图生成 GIF 演示产物
        │
        ▼
(6) qa-approval：人工卡点，任务停留「待验收」
        │
        ├─ 通过 ──► worktree-merge / cleanup ──► 归档完成
        └─ 驳回 ──► 回流修复或终止
```

`pipelines/` 目录存放可直接使用的示例流水线，也可以复制一份改成自己的流程；流水线语法见 [docs/pipeline-markdown.md](docs/pipeline-markdown.md)。

---

## 文档

| 文档 | 内容 |
| :--- | :--- |
| [docs/README.md](docs/README.md) | 文档库总览 |
| [docs/pipeline-markdown.md](docs/pipeline-markdown.md) | 流水线 Markdown 语法与执行语义 |
| [docs/plugin-system/architecture.md](docs/plugin-system/architecture.md) | 插件沙箱隔离模型与双向通信协议（OLPP） |
| [docs/plugin-system/api-spec.md](docs/plugin-system/api-spec.md) | 基座能力命名空间与 Manifest 字段 |
| [docs/plugin-system/quickstart.md](docs/plugin-system/quickstart.md) | 从零开发并接入一个插件 |
| [docs/design-system.md](docs/design-system.md) | UI 设计系统与视觉规范（前端改动必读） |
| [docs/qa-android.md](docs/qa-android.md) / [docs/qa-ios.md](docs/qa-ios.md) | Android / iOS 端 QA 自动化接入 |
| [docs/branding/README.md](docs/branding/README.md) | 品牌标志与用法规范 |
| [AGENTS.md](AGENTS.md) | 面向 AI 编码代理的仓库约定 |

---

## 参与贡献

欢迎 Issue 与 PR。开始之前请读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [行为准则](CODE_OF_CONDUCT.md)。

- 缺陷：使用 [缺陷模板](https://github.com/zhouatie/openLoop/issues/new?template=bug_report.yml) 提交，附版本、环境与复现步骤。
- 建议：使用 [功能模板](https://github.com/zhouatie/openLoop/issues/new?template=feature_request.yml) 提交，说明场景而非只给方案。
- 安全：请勿公开提交，按 [SECURITY.md](SECURITY.md) 私密报告。
- 文档链接自查：`node scripts/check-docs-links.js`。

## 许可证

[MIT](LICENSE) © openLoop contributors

品牌标志与名称的使用规范见 [docs/branding/README.md](docs/branding/README.md)。
