# openLoop 插件 API 接口规范 (Plugin API Specification)

本文档定义 openLoop 基座开放给插件调用的标准 RPC 能力集与事件清单。

---

## 1. 插件清单规范 (`manifest.json`)

每个独立的插件工程根目录下必须包含 `manifest.json` 清单文件：

```json
{
  "$schema": "https://openloop.dev/schemas/plugin-manifest.v1.json",
  "id": "openloop-plugin-pi",
  "name": "Pi 编码助手",
  "version": "1.0.0",
  "description": "基于 Pi 的深度编程助手，支持自主多文件侦察、代码变更审查与实时对话",
  "author": "openLoop Community",
  "category": "agent",
  "entry": "http://127.0.0.1:19999",
  "sidebarItem": {
    "id": "pi-agent",
    "title": "Pi 助手",
    "icon": "Cpu",
    "order": 10
  },
  "permissions": [
    "workspace:read",
    "workspace:write",
    "task:read",
    "ui:notify",
    "agent:execute"
  ]
}
```

### 字段说明
- `id`：全局唯一插件标识符（建议遵循 `openloop-plugin-<name>` 格式）。
- `entry`：插件 UI 入口。开发环境支持远程/本地端口 URL（如 `http://localhost:5174`），生产环境支持相对路径（如 `dist/index.html`）。
- `sidebarItem.icon`：预置图标名称（支持 `Kanban`, `Workflow`, `Boxes`, `Cpu`, `Settings`, `Puzzle`, `Layers` 等）。
- `permissions`：声明申请的能力权限。基座将在运行时根据此清单执行权限校验。

---

## 2. 核心命名空间 (Namespaces)

### 2.1 工作区能力 (`workspace.*`)

#### `workspace.getCurrent()`
获取基座当前处于聚焦状态的工作区工程目录。
- **权限要求**：`workspace:read`
- **入参**：无
- **返回**：
  ```json
  {
    "path": "/Users/developer/My/project",
    "name": "project"
  }
  ```

#### `workspace.selectDirectory()`
调用系统原生访达/文件选择器，选取新工作区目录。
- **权限要求**：`workspace:read`
- **入参**：`{ "defaultPath"?: string }`
- **返回**：`{ "path": string | null }`

---

### 2.2 任务系统能力 (`task.*`)

#### `task.getActive()`
获取当前看板中用户正在查看或选中的任务详情。
- **权限要求**：`task:read`
- **入参**：无
- **返回**：
  ```json
  {
    "task": {
      "id": "task_12345",
      "title": "更新评论组件文本",
      "status": "RUNNING",
      "column": "doing",
      "workspace": "/Users/developer/My/project"
    }
  }
  ```

#### `task.appendLog()`
向基座的实时日志控制台写入一条由插件生成的日志。
- **权限要求**：`task:write`
- **入参**：
  ```json
  {
    "taskId": "task_12345",
    "level": "INFO",
    "message": "Pi Agent 开始分析工程目录"
  }
  ```
- **返回**：`{ "success": true }`

---

### 2.3 宿主界面交互 (`ui.*`)

#### `ui.toast()`
在 openLoop 主界面右上角弹出原生风格轻提示。
- **权限要求**：`ui:notify`
- **入参**：
  ```json
  {
    "type": "success" | "error" | "info" | "warning",
    "message": "代码补丁已应用到本地文件"
  }
  ```
- **返回**：`{ "success": true }`

#### `ui.getTheme()`
获取基座当前设计主题与界面 Token。
- **权限要求**：无需权限
- **入参**：无
- **返回**：
  ```json
  {
    "theme": "light" | "dark",
    "surface": "macOS",
    "accentColor": "#4f46e5"
  }
  ```

---

### 2.4 Agent 驱动能力 (`agent.*`)

#### `agent.getSettings()`
获取 openLoop 当前配置的默认 Agent Provider（如 Pi、模型名称、思考深度）。
- **权限要求**：`agent:read`
- **入参**：无
- **返回**：
  ```json
  {
    "provider": "pi",
    "model": "antigravity/gemini-3.8-flash",
    "thinking": "medium"
  }
  ```
