import { Task, WorkflowDefinition, LogEntry, PluginManifest } from '@openloop/core';

const BASE_URL = 'http://127.0.0.1:19888';
const WS_URL = 'ws://127.0.0.1:19888';

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
  }): Promise<Task> {
    return requestJson<Task>(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async runTask(id: string): Promise<void> {
    await requestJson(`${BASE_URL}/api/tasks/${id}/run`, { method: 'POST' });
  }

  async updateTask(
    id: string,
    params: {
      title?: string;
      description?: string;
      workflowId?: string;
      context?: Record<string, any>;
    }
  ): Promise<Task> {
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
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
  async getSettings(): Promise<Record<string, any>> {
    return requestJson<Record<string, any>>(`${BASE_URL}/api/settings`);
  }

  async updateSettings(settings: Record<string, any>): Promise<Record<string, any>> {
    return requestJson<Record<string, any>>(`${BASE_URL}/api/settings`, {
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
}

export const api = new DesktopApiService();
