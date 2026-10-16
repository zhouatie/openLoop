import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from '../store';
import { DagEngine } from '../engine/dag-engine';
import { Task, WorkflowDefinition, PluginManifest } from '../types';

export interface ServerOptions {
  port?: number;
  host?: string;
  storeDir?: string;
}

export class OpenLoopServer {
  private port: number;
  private host: string;
  private store: Store;
  private engine: DagEngine;
  private httpServer?: http.Server;
  private wss?: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  constructor(options: ServerOptions = {}) {
    this.port = options.port || 19888;
    this.host = options.host || '127.0.0.1';
    this.store = new Store(options.storeDir);
    this.engine = new DagEngine(this.store);

    this.setupEngineEvents();
  }

  public getStore(): Store {
    return this.store;
  }

  public getEngine(): DagEngine {
    return this.engine;
  }

  private setupEngineEvents() {
    this.engine.on('task:update', (task: Task) => {
      this.broadcast({ type: 'task:update', data: task });
    });

    this.engine.on('node:status', (data) => {
      this.broadcast({ type: 'node:status', data });
    });

    this.engine.on('log:new', (log) => {
      this.broadcast({ type: 'log:new', data: log });
    });
  }

  private broadcast(payload: any) {
    const raw = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  }

  public async start(): Promise<{ port: number; host: string }> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        // 发送初始化问候
        ws.send(JSON.stringify({ type: 'connected', version: '0.1.0' }));

        ws.on('message', async (message) => {
          try {
            const data = JSON.parse(message.toString());
            this.handleWsMessage(ws, data);
          } catch (e) {
            // ignore
          }
        });

        ws.on('close', () => {
          this.clients.delete(ws);
        });
      });

      this.httpServer.listen(this.port, this.host, () => {
        console.log(`[openLoop Core] Server listening at http://${this.host}:${this.port}`);
        resolve({ port: this.port, host: this.host });
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    for (const ws of this.clients) {
      ws.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()));
    }
  }

  private async parseJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  private sendJson(res: http.ServerResponse, status: number, data: any) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end(JSON.stringify(data));
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      return res.end();
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    try {
      if (pathname === '/api/status' && method === 'GET') {
        return this.sendJson(res, 200, {
          status: 'ok',
          uptime: process.uptime(),
          version: '0.1.0',
        });
      }

      // Workflows
      if (pathname === '/api/workflows' && method === 'GET') {
        return this.sendJson(res, 200, this.store.getWorkflows());
      }

      if (pathname === '/api/workflows' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const saved = this.store.saveWorkflow(body);
        return this.sendJson(res, 201, saved);
      }

      if (pathname.startsWith('/api/workflows/') && method === 'DELETE') {
        const id = pathname.replace('/api/workflows/', '');
        const ok = this.store.deleteWorkflow(id);
        return this.sendJson(res, ok ? 200 : 404, { success: ok });
      }

      // Tasks
      if (pathname === '/api/tasks' && method === 'GET') {
        return this.sendJson(res, 200, this.store.getTasks());
      }

      if (pathname === '/api/tasks' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const { title, workflowId, description, context, autoRun = true } = body;
        
        if (!workflowId) {
          return this.sendJson(res, 400, { error: 'workflowId is required' });
        }

        const task: Task = {
          id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          title: title || `自动化任务 #${Date.now()}`,
          description: description || '',
          workflowId,
          status: 'pending',
          kanbanColumn: 'backlog',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          nodeRuns: {},
          context: context || {},
        };

        this.store.saveTask(task);
        this.broadcast({ type: 'task:new', data: task });

        if (autoRun) {
          // 异步启动引擎执行
          setImmediate(() => {
            this.engine.runTask(task.id).catch((err) => {
              console.error(`Task ${task.id} failed:`, err);
            });
          });
        }

        return this.sendJson(res, 201, task);
      }

      // Task detail: /api/tasks/:id
      const taskDetailMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)$/);
      if (taskDetailMatch && method === 'GET') {
        const taskId = taskDetailMatch[1];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task not found' });
        return this.sendJson(res, 200, task);
      }

      if (taskDetailMatch && (method === 'PATCH' || method === 'PUT')) {
        const taskId = taskDetailMatch[1];
        const existing = this.store.getTask(taskId);
        if (!existing) return this.sendJson(res, 404, { error: 'Task not found' });
        const body = await this.parseJsonBody(req);
        const { title, description, workflowId, context } = body;
        if (title !== undefined) existing.title = title.trim();
        if (description !== undefined) existing.description = description.trim();
        if (workflowId !== undefined && existing.status === 'pending') {
          existing.workflowId = workflowId;
        }
        if (context !== undefined) {
          existing.context = { ...existing.context, ...context };
        }
        existing.updatedAt = Date.now();
        this.store.saveTask(existing);
        this.broadcast({ type: 'task:update', data: existing });
        return this.sendJson(res, 200, existing);
      }

      if (taskDetailMatch && method === 'DELETE') {
        const taskId = taskDetailMatch[1];
        const deleted = this.store.deleteTask(taskId);
        if (deleted) {
          this.broadcast({ type: 'task:update', data: { id: taskId, deleted: true } });
          return this.sendJson(res, 200, { success: true, id: taskId });
        }
        return this.sendJson(res, 404, { error: 'Task not found' });
      }

      // Task run: /api/tasks/:id/run
      const taskRunMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/run$/);
      if (taskRunMatch && method === 'POST') {
        const taskId = taskRunMatch[1];
        this.engine.runTask(taskId).catch((e) => console.error(e));
        return this.sendJson(res, 200, { success: true, message: `Task ${taskId} triggered` });
      }

      // Task resume (QA approval): /api/tasks/:id/resume
      const taskResumeMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/resume$/);
      if (taskResumeMatch && method === 'POST') {
        const taskId = taskResumeMatch[1];
        const body = await this.parseJsonBody(req);
        const { approved = true, feedback = '' } = body;
        const task = await this.engine.resumeTask(taskId, approved, feedback);
        return this.sendJson(res, 200, task);
      }

      // Task logs: /api/tasks/:id/logs
      const taskLogsMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/logs$/);
      if (taskLogsMatch && method === 'GET') {
        const taskId = taskLogsMatch[1];
        const logs = this.store.getLogs(taskId);
        return this.sendJson(res, 200, logs);
      }

      // Plugins: /api/plugins
      if (pathname === '/api/plugins' && method === 'GET') {
        return this.sendJson(res, 200, this.store.getPlugins());
      }

      if (pathname === '/api/plugins' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const registered = this.store.registerPlugin(body);
        return this.sendJson(res, 201, registered);
      }

      this.sendJson(res, 404, { error: 'Not Found' });
    } catch (err: any) {
      console.error('[Server Error]', err);
      this.sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  }

  private handleWsMessage(ws: WebSocket, msg: any) {
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }
}
