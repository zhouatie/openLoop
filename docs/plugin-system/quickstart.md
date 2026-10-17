# openLoop 插件开发实战指南 (Plugin Quickstart)

本文档指导开发者如何以独立的 Git 仓库开发一个符合 openLoop 规范的插件，并以接入 `pi-desktop` Web 界面为例进行演示。

---

## 1. 快速上手：创建独立插件仓库

插件推荐作为独立的 Git 仓库单独开发与管理。

### 目录结构推荐

```text
my-openloop-plugin/
├── .git/
├── manifest.json            # 插件清单规范文件
├── package.json             # 插件独立依赖 (技术栈自由选择：Vue / React / Svelte / 原生等)
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── App.tsx              # 插件主界面
│   ├── index.html
│   └── sdk/                 # 或引入 @openloop/plugin-sdk
│       └── bridge.ts        # 基座通信封装
└── dist/                    # 生产环境静态资源构建产物
```

---

## 2. 插件端通信客户端实现 (`bridge.ts`)

为了以最轻量的方式对接基座，可以在插件工程内编写一个统一的通信适配器：

```typescript
// src/sdk/bridge.ts
export interface OpenLoopBridge {
  call<T = any>(method: string, params?: any): Promise<T>;
  on(topic: string, listener: (payload: any) => void): () => void;
}

class OpenLoopBridgeClient implements OpenLoopBridge {
  private reqIdCounter = 0;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  private listeners = new Map<string, Set<Function>>();
  private initialized = false;

  constructor() {
    window.addEventListener('message', this.handleMessage.bind(this));
    this.sendHandshake();
  }

  private sendHandshake() {
    window.parent?.postMessage({
      protocol: 'openloop-plugin-protocol',
      version: '1.0.0',
      type: 'HANDSHAKE_INIT',
      timestamp: Date.now(),
    }, '*');
  }

  private handleMessage(event: MessageEvent) {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // 握手确认
    if (data.type === 'HANDSHAKE_ACK') {
      this.initialized = true;
      console.log('[PluginBridge] 与 openLoop 基座握手成功:', data.host);
      return;
    }

    // RPC 响应
    if (data.type === 'RPC_RESPONSE') {
      const handler = this.pendingRequests.get(data.id);
      if (handler) {
        this.pendingRequests.delete(data.id);
        if (data.success) {
          handler.resolve(data.result);
        } else {
          handler.reject(new Error(data.error?.message || 'RPC Failed'));
        }
      }
      return;
    }

    // 事件通知
    if (data.type === 'EVENT') {
      const set = this.listeners.get(data.topic);
      if (set) {
        set.forEach((cb) => cb(data.payload));
      }
    }
  }

  public call<T = any>(method: string, params?: any): Promise<T> {
    const id = `req_${++this.reqIdCounter}_${Date.now().toString(36)}`;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      window.parent?.postMessage({
        type: 'RPC_REQUEST',
        id,
        method,
        params,
      }, '*');

      // 10s 超时保护
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`[PluginBridge] 请求 ${method} 超时`));
        }
      }, 10000);
    });
  }

  public on(topic: string, listener: (payload: any) => void) {
    if (!this.listeners.has(topic)) {
      this.listeners.set(topic, new Set());
    }
    this.listeners.get(topic)!.add(listener);
    return () => this.listeners.get(topic)?.delete(listener);
  }
}

export const bridge = new OpenLoopBridgeClient();
```

---

## 3. 接入 PI-Desktop 界面方案

以从本地 `/Users/zhoushitie/Desktop/clone/PI-Desktop` 抽取独立插件为例：

1. **新建独立 Git 仓库**：
   ```bash
   mkdir openloop-plugin-pi && cd openloop-plugin-pi
   git init
   ```
2. **迁移核心渲染组件**：
   - 从 `PI-Desktop/apps/desktop/src` 提取：
     - `components/ChatSurface.tsx`（对话消息流）
     - `components/PromptComposer.tsx`（底部输入区）
     - `components/ui/`（按钮、卡片、气泡）
   - 插件可自由保留其原有技术栈，无需迎合基座，两者在沙箱中完全隔离。
3. **将底层的 API 调用桥接至 `bridge.call(...)`**：
   - 获取当前工作目录：`bridge.call('workspace.getCurrent')`
   - 向基座通知构建完成：`bridge.call('ui.toast', { type: 'success', message: '任务已完成' })`
4. **编写 `manifest.json`**：
   声明 `id: "openloop-plugin-pi"` 及侧边栏图标项。
5. **在 openLoop 中加载**：
   在 openLoop 的「插件扩展」管理界面中，填入插件的开发服务地址（如 `http://localhost:5174`）或打包后的绝对路径，即可完成免编译热插拔挂载。
