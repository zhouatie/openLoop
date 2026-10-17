import http from 'http';
import { WebSocket } from 'ws';
import { Task, WorkflowDefinition, LogEntry, PluginManifest, KanbanColumn, QaSuite, QaRunRecord } from '@openloop/core';

export class OpenLoopClient {
  private baseUrl: string;
  private wsUrl: string;

  constructor(host = '127.0.0.1', port = 19888) {
    this.baseUrl = `http://${host}:${port}`;
    this.wsUrl = `ws://${host}:${port}`;
  }

  private async request<T>(path: string, options: { method?: string; body?: any } = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const method = options.method || 'GET';
    const payload = options.body ? JSON.stringify(options.body) : null;

    return new Promise((resolve, reject) => {
      const req = http.request(
        url,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve(data as any);
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          });
        }
      );

      req.on('error', (err) => {
        reject(new Error(`无法连接至 openLoop Daemon (${this.baseUrl}): ${err.message}`));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  async checkStatus(): Promise<{ status: string; uptime: number; version: string }> {
    return this.request('/api/status');
  }

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    return this.request('/api/workflows');
  }

  async listTasks(): Promise<Task[]> {
    return this.request('/api/tasks');
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request(`/api/tasks/${taskId}`);
  }

  async createTask(params: {
    title: string;
    workflowId: string;
    description?: string;
    context?: Record<string, any>;
    autoRun?: boolean;
    kanbanColumn?: KanbanColumn;
  }): Promise<Task> {
    return this.request('/api/tasks', { method: 'POST', body: params });
  }

  async updateTask(
    taskId: string,
    params: {
      title?: string;
      description?: string;
      workflowId?: string;
      context?: Record<string, any>;
      kanbanColumn?: KanbanColumn;
    }
  ): Promise<Task> {
    return this.request(`/api/tasks/${taskId}`, { method: 'PATCH', body: params });
  }

  async runTask(taskId: string): Promise<{ success: boolean }> {
    return this.request(`/api/tasks/${taskId}/run`, { method: 'POST' });
  }

  async resumeTask(taskId: string, approved: boolean, feedback?: string): Promise<Task> {
    return this.request(`/api/tasks/${taskId}/resume`, {
      method: 'POST',
      body: { approved, feedback },
    });
  }

  async skipNode(taskId: string, nodeId?: string): Promise<Task> {
    return this.request(`/api/tasks/${taskId}/skip-node`, {
      method: 'POST',
      body: { nodeId },
    });
  }

  async retryNode(taskId: string, nodeId?: string): Promise<Task> {
    return this.request(`/api/tasks/${taskId}/retry-node`, {
      method: 'POST',
      body: { nodeId },
    });
  }

  async getTaskLogs(taskId: string): Promise<LogEntry[]> {
    return this.request(`/api/tasks/${taskId}/logs`);
  }

  async listPlugins(): Promise<PluginManifest[]> {
    return this.request('/api/plugins');
  }

  async listQaSuites(): Promise<QaSuite[]> {
    return this.request('/api/qa/suites');
  }

  async runQa(params: { suiteId?: string; targetUrl?: string; steps?: any[]; taskId?: string }): Promise<QaRunRecord> {
    return this.request('/api/qa/run', { method: 'POST', body: params });
  }

  followLogs(taskId: string, onLog: (log: LogEntry) => void): () => void {
    const ws = new WebSocket(this.wsUrl);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'log:new' && msg.data && msg.data.taskId === taskId) {
          onLog(msg.data);
        }
      } catch {
        // ignore
      }
    });

    return () => {
      ws.close();
    };
  }
}
