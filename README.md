# openLoop - 全自动化流程编排桌面平台

> **致力于打造全自动化、可编排、可插件化扩展的桌面与 CLI 一体化流水线平台。**

---

## 核心特性

- 🔀 **可视化 DAG 流程编排**：内置 React Flow 编排器，支持自由拖拽、连线、配置各个 CLI 工具与 Agent 节点。
- 🧩 **开放式插件槽位系统**：侧边栏支持动态插件插槽，内置看板插件、流程编排插件、插件扩展中心，支持第三方扩展。
- 📋 **全自动化看板流转**：内置任务看板，全景呈现「待处理 -> Agent编码 -> 流水线执行 -> QA待验 -> 完成」全生命周期。
- 🤖 **通用 Agent 接入与 Hook 流转**：支持接入任意 AI Agent，开发完成后通过 Hook 自动广播触发下游 Midscene UI 自动化测试。
- 🎯 **Midscene 智能测试与动图生成**：自动根据提示词执行浏览器自动化与截屏，串联 CLI 拼接动图供 QA 人工/用例核验。
- 💻 **CLI 深度集成**：桌面端与 CLI 共享 Core Daemon 服务，可通过命令行创建任务、查询状态、审批流转与实时日志追踪。
- 📜 **全流程日志透明可观测**：支持流式终端抽屉、ANSI 语法高亮、按节点筛选与实时 WebSocket 日志广播。

---

## 项目结构

```
openLoop/
├── packages/
│   ├── core/         # DAG 调度引擎、Task 状态机、执行器系统、存储、Daemon 服务
│   ├── cli/          # openloop 命令行客户端 (task create/approve/logs 等)
│   └── desktop/      # Electron 桌面端 (React + React Flow + Tailwind + 插件槽位)
├── package.json
└── pnpm-workspace.yaml
```

---

## 快速上手

### 1. 构建整个项目

```bash
pnpm install
pnpm build
```

### 2. 启动方式

#### 方式 A：浏览器模式（前后端一键启动，推荐快速调试）
```bash
# 同时启动 Core 后端调度服务 (19888) 与 Vite 前端开发服务器 (5173)
pnpm dev
```
启动后在浏览器中打开 **`http://localhost:5173`** 即可在 Web 界面体验全部看板、DAG 流程编排、实时日志与插件槽位功能！

#### 方式 B：桌面客户端模式 (Electron)
```bash
# 启动原生桌面窗口
pnpm desktop:start
```

#### 方式 C：独立生产部署模式 (单端口托管)
```bash
# 一键编译构建并执行部署校验
pnpm deploy

# 启动全栈生产服务 (单端口 19888 同时托管 API、WebSocket 总线与 Web 前端界面)
pnpm start:prod
```
服务启动后直接访问 **`http://localhost:19888`** 即可在生产环境使用。

#### 方式 D：Docker 容器化部署
```bash
# 使用 Docker Compose 一键构建并启动
pnpm deploy:docker
# 或 docker compose up -d --build
```
容器自动暴露 `19888` 端口，并将 SQLite 数据底座持久化至本地命名卷。

### 3. 使用 openLoop CLI 进行自动化任务调用

可以直接使用命令行与调度引擎进行交互：

#### 查看当前可用工作流与插件槽位
```bash
node packages/cli/dist/index.js workflow list
node packages/cli/dist/index.js plugin list
```

#### 创建并自动流转任务 (带实时日志监听)
```bash
node packages/cli/dist/index.js task create \
  --workflow <workflow_id> \
  --title "用户中心登录优化" \
  --follow
```

#### 查看当前任务看板流转状态
```bash
node packages/cli/dist/index.js task list
node packages/cli/dist/index.js task show <task_id>
```

#### QA 验收通过或驳回挂起中的任务
```bash
# 验收通过，流转至完成
node packages/cli/dist/index.js task approve <task_id> -c "动图符合预期，用例通过"

# 或驳回
node packages/cli/dist/index.js task approve <task_id> --reject -c "页面断言未通过"
```

#### 查看/实时追踪任务日志
```bash
node packages/cli/dist/index.js task logs <task_id> -f
```

---

## 典型自动化闭环流程示例

```
[CLI / 界面创建任务]
        │
        ▼
 (1) Agent 开发节点 (运行指定 AI CLI，完成功能开发)
        │
        ▼
 (2) 开发完成 Hook (捕获产物事件，自动唤起下游)
        │
        ▼
 (3) Midscene 测试节点 (按提示词执行浏览器自动化与多步截图)
        │
        ▼
 (4) 拼接动图节点 (执行 CLI 将步骤截图合成为 preview.gif 动画)
        │
        ▼
 (5) QA 审核节点 (任务挂起至看板【QA待验】泳道，查验动图与用例)
        │
        ├─ [验收通过] ──► (6) 流程自动标记完成并归档
        └─ [驳回处理] ──► (7) 终止或回流触发重新修复
```
