# 工作区开发服务（启动服务）

写代码的 Agent 会话不必先建任务：在输入卡 ➕ 面板里选「启动服务」，挑一个工程就地拉起 Metro。

这个能力只依赖目录，不绑定任务、流水线或某次会话——换成通用宿主（例如 DSH 插件）时，
复用的是同一份「扫描工程 + 拉起进程 + 探活」实现。

## 入口

| 位置 | 说明 |
| :--- | :--- |
| ➕ 面板 → 插件 → 启动服务 | 面板列出工作区里的 RN 工程，逐个启动 / 停止 / 配置 |
| `dev_server` 工具 | 任意 Agent 会话可用，`action` 取 `status` / `start` / `stop` |

面板顶部显示工作区根目录，可「换目录」指向任意位置；工作区根不是 RN 工程时，
会向下浅扫三层（跳过 `node_modules`、`ios`、`android` 等目录），把识别到的工程列出来。

识别规则：工程根存在 `appJson.json`、`metro.config.js`、`react-native.config.js`，
或 `package.json` 依赖 `react-native` / `chitu`，或脚本里出现 `chitu`。

## 状态与启动方式

| 徽章 | 含义 |
| :--- | :--- |
| 运行中 | 本应用拉起的进程在监听端口 |
| 运行中 · 外部 | 同目录下已有的 Metro（例如手动启动的）在监听 |
| 启动中 | 进程已拉起，端口尚未就绪 |
| 端口冲突 | 端口被别的工程或别的进程占用，直接启动会报错 |
| 已退出 | 上一次启动已结束，展开可看退出原因 |

默认启动命令来自工程自身：`scripts.dev` → `npm run dev`；有 `appJson.json` → `npx chitu dev`；
否则 `npm start` / `npx react-native start`。默认端口 8081。

## 启动配置

每行右侧齿轮可改命令、Node 运行时目录与端口：

- **命令**：完整 shell 命令。Chitu 与 `react-native start` 的 `--port` 以端口字段为准，会被覆盖。
- **Node**：形如 `~/.nvm/versions/node/v14/bin`，只注入 `PATH`，用于老项目必须跑 Node 14 的场景。
- **端口**：默认 8081，改动在下一次启动生效。

配置按工程归属保存：worktree 内的工程回落到主仓库的同名子目录，同一工程配置一次，所有分支共用。

## 生命周期与安全

- 进程始终 detach：关闭面板、结束对话、刷新界面都不会带走 Metro。
- 端口被别的进程占用时只报错，不清理。仅当占用者的工作目录在本工程内才接管。
- 沙箱回收（任务合并或驳回清理）时，按工作区键一并停止会话里启动的服务，不留孤儿进程。
- 状态探测走 TCP 握手（<300ms），面板打开时 2.5 秒对账一次。

## 与其他方案的关系

流水线 `env-prepare` 节点面向任务：命令绑定任务端口与流水线变量，任务清理时一并回收。
启动服务复用同一套「命令 + Node 运行时 + 端口」要素，但不依赖任务与流水线定义，
两种入口互不干扰：任务沙箱用任务端口，启动服务用工程自己的端口。

## 迁移到其他宿主

模块自带类型与路由，宿主只需要提供五个注入口：

| 注入口 | 作用 | 缺省行为 |
| :--- | :--- | :--- |
| `setDevServerProcessRegistry(registry)` | 进程登记与回收 | 直接终止子进程 |
| `setDevServerConfigProvider(fn)` | 读取已保存的启动配置 | 一律用自动探测值 |
| `createDevServerRoutes(deps)` | 挂到宿主的 HTTP 分发 | openLoop 在构造时挂载 |
| `<DevServerPanel client={...}>` | 扫描与启停的实现 | 走桌面端 `api` |
| `<DevServerPanel pickDirectory / notify>` | 目录选择与提示 | 内置目录弹窗与 toast |

`DevServerClient`（`scan / start / stop / saveConfig`）是界面唯一依赖的契约，
换成 dsh 插件时实现这四个方法即可，界面代码不用改。
