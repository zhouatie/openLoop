import { Task, WorkflowDefinition, LogEntry, PluginManifest, TaskSessionState, OpenLoopSettings, KanbanColumn } from '@openloop/core';

function resolveBackendUrls(): { httpUrl: string; wsUrl: string } {
  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port } = window.location;
    // Vite 本地开发模式默认运行在 5173，指向 Core 调度服务默认端口 19888
    if (port === '5173') {
      const host = hostname || '127.0.0.1';
      return {
        httpUrl: `http://${host}:19888`,
        wsUrl: `ws://${host}:19888`,
      };
    }
    // 生产部署模式或 Core 静态托管模式：动态复用当前主机与端口
    if (hostname) {
      const isHttps = protocol === 'https:';
      const wsProto = isHttps ? 'wss:' : 'ws:';
      const portPart = port ? `:${port}` : '';
      return {
        httpUrl: `${protocol}//${hostname}${portPart}`,
        wsUrl: `${wsProto}//${hostname}${portPart}`,
      };
    }
  }
  return {
    httpUrl: 'http://127.0.0.1:19888',
    wsUrl: 'ws://127.0.0.1:19888',
  };
}

const { httpUrl: BASE_URL, wsUrl: WS_URL } = resolveBackendUrls();

const isDev = import.meta.env?.DEV;

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const method = options?.method || 'GET';
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (isDev) {
        console.warn(`[UI:API Warning] ${method} ${url} - Status: ${res.status}`, errText);
      }
      try {
        return JSON.parse(errText);
      } catch {
        throw new Error(`HTTP ${res.status}: ${errText || res.statusText}`);
      }
    }
    return await res.json();
  } catch (error: any) {
    if (isDev) {
      console.error(`[UI:API Error] ${method} ${url} 发生异常:`, error);
    }
    throw error;
  }
}

export class DesktopApiService {

  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private isConnected = false;

  constructor() {
    this.checkHttpConnection();
    this.connectWs();
  }

  private async checkHttpConnection() {
    try {
      const res = await fetch(`${BASE_URL}/api/status`);
      if (res.ok) {
        this.isConnected = true;
        this.emit('connection:change', true);
      }
    } catch {
      // ignore
    }
  }

  private connectWs() {
    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit('connection:change', true);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type) {
            this.emit(payload.type, payload.data);
          }
        } catch {
          // ignore
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('connection:change', false);
        // 3 秒后重试
        setTimeout(() => this.connectWs(), 3000);
      };

      this.ws.onerror = () => {
        this.isConnected = false;
      };
    } catch {
      setTimeout(() => this.connectWs(), 3000);
    }
  }

  public on(event: string, callback: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // Workflows
  async getWorkflows(): Promise<WorkflowDefinition[]> {
    return requestJson<WorkflowDefinition[]>(`${BASE_URL}/api/workflows`);
  }

  async saveWorkflow(wf: WorkflowDefinition): Promise<WorkflowDefinition> {
    return requestJson<WorkflowDefinition>(`${BASE_URL}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wf),
    });
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const data = await requestJson<{ success: boolean }>(`${BASE_URL}/api/workflows/${id}`, { method: 'DELETE' });
    return data.success;
  }

  // Tasks
  async getTasks(): Promise<Task[]> {
    return requestJson<Task[]>(`${BASE_URL}/api/tasks`);
  }

  async getTask(id: string): Promise<Task> {
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}`);
  }

  async createTask(params: {
    title: string;
    workflowId: string;
    description?: string;
    context?: Record<string, any>;
    autoRun?: boolean;
    kanbanColumn?: KanbanColumn;
  }): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 创建新任务:', params);
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async runTask(id: string): Promise<void> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 触发任务启动:', id);
    }
    await requestJson(`${BASE_URL}/api/tasks/${id}/run`, { method: 'POST' });
  }

  async cancelTask(id: string): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 请求终止任务:', id);
    }
    const res = await requestJson<{ success: boolean; task: Task }>(`${BASE_URL}/api/tasks/${id}/cancel`, {
      method: 'POST',
    });
    return res.task;
  }

  async updateTask(
    id: string,
    params: {
      title?: string;
      description?: string;
      workflowId?: string;
      context?: Record<string, any>;
      kanbanColumn?: KanbanColumn;
    }
  ): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 更新任务 [${id}]:`, params);
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async moveTaskColumn(id: string, column: KanbanColumn): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 流转任务 [${id}] 至泳道: ${column}`);
    }
    return this.updateTask(id, { kanbanColumn: column });
  }

  async deleteTask(id: string): Promise<{ success: boolean; id: string }> {
    return requestJson<{ success: boolean; id: string }>(`${BASE_URL}/api/tasks/${id}`, {
      method: 'DELETE',
    });
  }

  async resumeTask(id: string, approved: boolean, feedback?: string): Promise<Task> {
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, feedback }),
    });
  }

  async getTaskLogs(id: string): Promise<LogEntry[]> {
    return requestJson<LogEntry[]>(`${BASE_URL}/api/tasks/${id}/logs`);
  }

  // Plugins
  async getPlugins(): Promise<PluginManifest[]> {
    return requestJson<PluginManifest[]>(`${BASE_URL}/api/plugins`);
  }

  async registerPlugin(plugin: PluginManifest): Promise<PluginManifest> {
    return requestJson<PluginManifest>(`${BASE_URL}/api/plugins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plugin),
    });
  }

  async deletePlugin(id: string): Promise<{ success: boolean; id: string }> {
    return requestJson<{ success: boolean; id: string }>(`${BASE_URL}/api/plugins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // Settings
  async getSettings(): Promise<OpenLoopSettings> {
    return requestJson<OpenLoopSettings>(`${BASE_URL}/api/settings`);
  }

  async updateSettings(settings: Partial<OpenLoopSettings>): Promise<OpenLoopSettings> {
    return requestJson<OpenLoopSettings>(`${BASE_URL}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  }

  // Resume task session in terminal
  async resumeTerminal(taskId: string): Promise<{ success: boolean; command: string; sessionId: string }> {
    return requestJson<{ success: boolean; command: string; sessionId: string }>(`${BASE_URL}/api/tasks/${taskId}/resume-terminal`, {
      method: 'POST',
    });
  }

  // Agent RPC Session & Chat
  async getTaskSession(taskId: string): Promise<TaskSessionState> {
    return requestJson<TaskSessionState>(`${BASE_URL}/api/tasks/${taskId}/session`);
  }

  async sendTaskChatMessage(taskId: string, message: string): Promise<any> {
    return requestJson<any>(`${BASE_URL}/api/tasks/${taskId}/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  }

  async pauseTaskSession(taskId: string): Promise<{ success: boolean }> {
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/tasks/${taskId}/session/pause`, {
      method: 'POST',
    });
  }

  async resumeTaskSession(taskId: string): Promise<{ success: boolean }> {
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/tasks/${taskId}/session/resume`, {
      method: 'POST',
    });
  }
}

export const api = new DesktopApiService();
