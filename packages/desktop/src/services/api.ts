import { Task, WorkflowDefinition, LogEntry, PluginManifest, TaskSessionState, OpenLoopSettings, KanbanColumn, TaskAttachment, WorkflowSessionState } from '@openloop/core';

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

  // Workflow Copilot (AI 协助与零手动编排)
  async getWorkflowSession(workflowId: string): Promise<WorkflowSessionState> {
    return requestJson<WorkflowSessionState>(`${BASE_URL}/api/workflows/${workflowId}/session`);
  }

  async sendWorkflowChatMessage(
    workflowId: string,
    message: string,
    snapshot?: { nodes?: any[]; edges?: any[]; name?: string; focusNodeId?: string }
  ): Promise<{ success: boolean }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:WorkflowCopilot] 发送流程编排指令 (${workflowId}${snapshot?.focusNodeId ? `, 聚焦: ${snapshot.focusNodeId}` : ''}):`, message.slice(0, 40));
    }
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/workflows/${workflowId}/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, snapshot }),
    });
  }

  async resetWorkflowSession(workflowId: string): Promise<{ success: boolean }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:WorkflowCopilot] 请求重置编排助手会话 (${workflowId})`);
    }
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/workflows/${workflowId}/session/reset`, {
      method: 'POST',
    });
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
    workspace?: string;
    attachments?: TaskAttachment[];
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
      workspace?: string;
      attachments?: TaskAttachment[];
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

  /**
   * 上传图片附件 (零内存消耗流式写入核心服务并落盘)
   */
  async uploadAttachment(file: File): Promise<TaskAttachment> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 正在上传图片附件:', { name: file.name, size: file.size, type: file.type });
    }
    const query = `filename=${encodeURIComponent(file.name)}`;
    const res = await fetch(`${BASE_URL}/api/attachments?${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'image/png',
      },
      body: file,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`上传失败 (${res.status}): ${errText || res.statusText}`);
    }
    const attachment: TaskAttachment = await res.json();
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 图片附件上传成功:', attachment);
    }
    return attachment;
  }

  /**
   * 删除指定的附件文件
   */
  async deleteAttachment(filenameOrId: string): Promise<boolean> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 请求删除图片附件:', filenameOrId);
    }
    const filename = filenameOrId.startsWith('/api/attachments/')
      ? filenameOrId.replace('/api/attachments/', '')
      : filenameOrId;
    const res = await fetch(`${BASE_URL}/api/attachments/${filename}`, {
      method: 'DELETE',
    });
    return res.ok;
  }

  /**
   * 将附件的相对/绝对路径解析为可渲染的完整 HTTP URL
   */
  getAttachmentUrl(pathOrUrl: string): string {
    if (!pathOrUrl) return '';
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('blob:')) {
      return pathOrUrl;
    }
    if (pathOrUrl.startsWith('/api/')) {
      return `${BASE_URL}${pathOrUrl}`;
    }
    return `${BASE_URL}/api/attachments/${pathOrUrl}`;
  }

  async resumeTask(id: string, approved: boolean, feedback?: string): Promise<Task> {
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, feedback }),
    });
  }

  async skipNode(id: string, nodeId?: string): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 请求跳过任务 [${id}] 的节点:`, nodeId || '自动判定');
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/skip-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
  }

  async retryNode(id: string, nodeId?: string): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 请求单独重试任务 [${id}] 的节点:`, nodeId || '自动判定');
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/retry-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
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

  async sendTaskChatMessage(taskId: string, message: string, attachments?: TaskAttachment[]): Promise<any> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 发送任务会话消息 (${taskId}):`, {
        message: message ? message.slice(0, 40) : '',
        attachmentsCount: attachments?.length || 0,
      });
    }
    return requestJson<any>(`${BASE_URL}/api/tasks/${taskId}/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, attachments }),
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

  // System Dialog & File Manager
  /**
   * 调起系统原生文件管理器（访达/资源管理器）进行目录选择
   * 优先走 Electron IPC，极速且原生；独立 Web 调试时自动回退至 Core Server 系统调用
   */
  async selectDirectory(options?: { defaultPath?: string }): Promise<string | null> {
    if (import.meta.env?.DEV) {
      console.log('[UI:System] 请求打开系统原生文件管理器选择工作区目录...', options);
    }

    if (window.electronAPI?.openDirectory) {
      try {
        const dir = await window.electronAPI.openDirectory(options);
        if (import.meta.env?.DEV) {
          console.log('[UI:System] Electron 原生访达目录选择返回:', dir);
        }
        return dir || null;
      } catch (err) {
        if (import.meta.env?.DEV) {
          console.warn('[UI:System] Electron 目录选择调用失败，尝试回退:', err);
        }
      }
    }

    // Web Fallback: 调用本地 Core Server 提供的系统对话框接口
    try {
      const res = await requestJson<{ canceled: boolean; path?: string }>(
        `${BASE_URL}/api/system/select-directory`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options || {}),
        }
      );
      if (import.meta.env?.DEV) {
        console.log('[UI:System] Core 服务端目录选择返回:', res);
      }
      return res.canceled ? null : res.path || null;
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[UI:System] 唤起系统目录选择失败:', err);
      }
      return null;
    }
  }

  /**
   * 在系统原生文件管理器（访达 Finder / 资源管理器 Explorer）中打开并定位目录
   */
  async openPath(dirPath: string): Promise<boolean> {
    if (!dirPath) return false;
    if (import.meta.env?.DEV) {
      console.log(`[UI:System] 请求在访达中打开目录: ${dirPath}`);
    }

    if (window.electronAPI?.openPath) {
      try {
        return await window.electronAPI.openPath(dirPath);
      } catch (err) {
        if (import.meta.env?.DEV) {
          console.warn('[UI:System] Electron openPath 调用失败，尝试服务端回退:', err);
        }
      }
    }

    try {
      const res = await requestJson<{ success: boolean }>(`${BASE_URL}/api/system/open-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      return !!res.success;
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[UI:System] 服务端打开系统目录失败:', err);
      }
      return false;
    }
  }
}

export const api = new DesktopApiService();
