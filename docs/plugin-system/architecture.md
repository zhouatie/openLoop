# openLoop 插件系统架构设计规范 (Plugin System Architecture)

本文档定义 openLoop 插件系统的核心架构、沙箱隔离模型与双向通信协议（OLPP v1）。

---

## 1. 设计目标与核心原则

- **基座零侵入 (Zero Core Intrusion)**：基座仅提供标准的插件插槽与统一通信网关。基座代码库不包含任何第三方插件的业务逻辑。
- **技术栈完全无关 (Framework-Agnostic)**：基座不限制插件的技术栈。插件可以使用任意框架（React、Vue、Svelte、Solid、原生 HTML/JS 等）或打包工具进行开发。
- **独立生命周期 (Decoupled Lifecycle)**：插件作为独立的 Git 仓库进行开发、版本管理与打包。
- **进程级隔离 (Process-Level Isolation)**：插件运行于独立沙箱（`<webview>` / `WebContentsView` / `iframe`），防止样式污染、全局对象篡改及运行时崩溃扩散。
- **开发环境全链路可观测 (Observable in Development)**：开发环境下，所有通信握手、RPC 调用与事件广播均输出结构化跟踪日志。

---

## 2. 整体通信拓扑

通信架构分为三层：

```
┌─────────────────────────────────────────────────────────────┐
│                 openLoop 基座 (Host Realm)                  │
│                                                             │
│  ┌───────────────────────┐      ┌────────────────────────┐  │
│  │   UI 层               │      │  PluginManager 调度中枢 │  │
│  │   - Sidebar 导航项    │◄────►│  - 插件注册表 (Store)  │  │
│  │   - PluginContainer   │      │  - 权限网关 (Gateway)   │  │
│  └───────────┬───────────┘      └───────────┬────────────┘  │
│              │                              │               │
│              ▼                              ▼               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         HostBridge Adapter (统一事件与 RPC 路由)        │  │
│  └───────────────────────────┬───────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────┘
                               │ 双向通信通道 (postMessage / IPC)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             插件沙箱 (Plugin Sandbox / Webview)             │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Plugin SDK (@openloop/plugin-sdk)             │  │
│  │         - window.openLoopBridge 适配器                │  │
│  │         - Typed API (workspace, task, ui, agent)      │  │
│  └───────────────────────────┬───────────────────────────┘  │
│                              │                              │
│                              ▼                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │        独立插件前端应用 (技术栈不限，支持任意框架)   │  │
│  │        (React / Vue / Svelte / Solid / 原生 Web 等)   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. openLoop 插件通信协议 (OLPP v1)

协议基于 JSON 文本传输，分为三类数据帧：**握手帧 (Handshake)**、**RPC 帧 (Request/Response)** 和 **事件广播帧 (Event)**。

### 3.1 握手协议 (Handshake)

插件加载完成后，必须先与基座完成握手才能发起权限能力调用：

1. **插件发起初始化**：
   ```json
   {
     "protocol": "openloop-plugin-protocol",
     "version": "1.0.0",
     "type": "HANDSHAKE_INIT",
     "pluginId": "openloop-plugin-pi",
     "timestamp": 1713340000000
   }
   ```
2. **基座应答确认并下发宿主状态**：
   ```json
   {
     "protocol": "openloop-plugin-protocol",
     "type": "HANDSHAKE_ACK",
     "success": true,
     "host": {
       "version": "0.1.0",
       "theme": "light",
       "currentWorkspace": "/Users/example/project",
       "activeTask": null
     }
   }
   ```

### 3.2 RPC 协议 (Request / Response)

用于插件请求基座宿主提供的能力服务。

- **插件请求帧 (Request)**：
  ```json
  {
    "type": "RPC_REQUEST",
    "id": "req_a1b2c3d4",
    "method": "workspace.getFiles",
    "params": {
      "path": "src",
      "recursive": false
    }
  }
  ```
- **基座响应帧 (Response - 成功)**：
  ```json
  {
    "type": "RPC_RESPONSE",
    "id": "req_a1b2c3d4",
    "success": true,
    "result": [
      { "name": "App.tsx", "isDirectory": false }
    ]
  }
  ```
- **基座响应帧 (Response - 失败)**：
  ```json
  {
    "type": "RPC_RESPONSE",
    "id": "req_a1b2c3d4",
    "success": false,
    "error": {
      "code": "PERMISSION_DENIED",
      "message": "插件未声明 workspace:read 权限"
    }
  }
  ```

#### 标准错误码表

| 错误码 | 说明 |
| :--- | :--- |
| `ERR_INVALID_FRAME` | 数据帧格式不合法 |
| `ERR_NOT_INITIALIZED` | 未完成握手即发起调用 |
| `ERR_METHOD_NOT_FOUND` | 请求的能力方法未注册 |
| `ERR_PERMISSION_DENIED` | 缺少对应权限 |
| `ERR_TIMEOUT` | 请求超时 (默认 10000ms) |
| `ERR_INTERNAL` | 基座内部执行异常 |

### 3.3 事件广播帧 (Event)

用于基座主动向插件推送状态变更，或者插件上报特定业务事件。

```json
{
  "type": "EVENT",
  "topic": "workspace:changed",
  "payload": {
    "currentWorkspace": "/Users/example/new-workspace"
  }
}
```

#### 基座内置广播主题 (Topics)
- `theme:changed`：宿主暗黑/浅色模式切换
- `workspace:changed`：用户切换工作区目录
- `task:selected`：用户在看板中选中了任务
- `task:statusChanged`：任务状态变更（流转、暂停、完成）

---

## 4. 插件生命周期模型

插件在基座中的生命周期分为 5 个阶段：

```
[Registered 登记] ──► [Mounting 挂载沙箱] ──► [Ready 就绪运行]
                            │                     │
                            ▼                     ▼
                     [Failed 异常隔离]     [Unmounted 卸载销毁]
```

1. **Registered (登记)**：基座解析插件的 `manifest.json`，在侧边栏挂载入口图标。
2. **Mounting (挂载沙箱)**：用户点击侧边栏，基座创建沙箱容器并加载插件 entry URL。
3. **Ready (就绪)**：双向握手完成，开始处理 RPC 与事件订阅。
4. **Active / Inactive (激活与后台挂载)**：切换视图时，基座可通过 `display: none` 维持沙箱保活，避免重复重新加载；也可按策略延迟释放。
5. **Unmounted (销毁)**：插件卸载时，关闭 Webview，释放所有通信 Listener。

---

## 5. 开发环境日志规范

为了保障排查体验，基座通信桥在 `import.meta.env.DEV` 为 `true` 时执行日志审计：
- **握手日志**：`[PluginHost:Handshake]` 打印插件标识、耗时、协议版本。
- **RPC 链路日志**：`[PluginHost:RPC]` 打印请求方法名、入参、耗时、响应结果。
- **异常链路日志**：`[PluginHost:Error]` 打印红色高亮异常堆栈与关联请求 ID。
