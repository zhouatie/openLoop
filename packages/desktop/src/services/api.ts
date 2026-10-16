import { Task, WorkflowDefinition, LogEntry, PluginManifest } from '@openloop/core';

const BASE_URL = 'http://127.0.0.1:19888';
const WS_URL = 'ws://127.0.0.1:19888';

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
    const res = await fetch(`${BASE_URL}/api/workflows`);
    return res.json();
  }

  async saveWorkflow(wf: WorkflowDefinition): Promise<WorkflowDefinition> {
    const res = await fetch(`${BASE_URL}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wf),
    });
    return res.json();
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const res = await fetch(`${BASE_URL}/api/workflows/${id}`, { method: 'DELETE' });
    const data = await res.json();
    return data.success;
  }

  // Tasks
  async getTasks(): Promise<Task[]> {
    const res = await fetch(`${BASE_URL}/api/tasks`);
    return res.json();
  }

  async getTask(id: string): Promise<Task> {
    const res = await fetch(`${BASE_URL}/api/tasks/${id}`);
    return res.json();
  }

  async createTask(params: {
    title: string;
    workflowId: string;
    description?: string;
    context?: Record<string, any>;
    autoRun?: boolean;
  }): Promise<Task> {
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async runTask(id: string): Promise<void> {
    await fetch(`${BASE_URL}/api/tasks/${id}/run`, { method: 'POST' });
  }

  async resumeTask(id: string, approved: boolean, feedback?: string): Promise<Task> {
    const res = await fetch(`${BASE_URL}/api/tasks/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, feedback }),
    });
    return res.json();
  }

  async getTaskLogs(id: string): Promise<LogEntry[]> {
    const res = await fetch(`${BASE_URL}/api/tasks/${id}/logs`);
    return res.json();
  }

  // Plugins
  async getPlugins(): Promise<PluginManifest[]> {
    const res = await fetch(`${BASE_URL}/api/plugins`);
    return res.json();
  }

  async registerPlugin(plugin: PluginManifest): Promise<PluginManifest> {
    const res = await fetch(`${BASE_URL}/api/plugins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plugin),
    });
    return res.json();
  }
}

export const api = new DesktopApiService();
