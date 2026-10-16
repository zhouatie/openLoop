import http from 'http';
import { spawn } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from '../store';
import { DagEngine } from '../engine/dag-engine';
import { Task, WorkflowDefinition, PluginManifest } from '../types';
import { createLogger } from '../logger';

const serverLogger = createLogger('Server');

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

      this.wss.on('connection', (ws, req) => {
        this.clients.add(ws);
        const remoteIp = req.socket.remoteAddress || 'unknown';
        serverLogger.info(`[WS:Connected] 新客户端已建立 WebSocket 连接 (${remoteIp}), 当前活跃客户端数: ${this.clients.size}`);
        // 发送初始化问候
        ws.send(JSON.stringify({ type: 'connected', version: '0.1.0' }));

        ws.on('message', async (message) => {
          try {
            const data = JSON.parse(message.toString());
            serverLogger.debug(`[WS:Message] 收到客户端消息: ${data.type}`);
            this.handleWsMessage(ws, data);
          } catch (e) {
            serverLogger.warn(`[WS:Message] 解析客户端消息失败: ${message.toString().slice(0, 100)}`);
          }
        });

        ws.on('close', (code, reason) => {
          this.clients.delete(ws);
          serverLogger.info(`[WS:Closed] 客户端断开连接 (Code: ${code}, Reason: "${reason.toString()}"), 剩余活跃客户端数: ${this.clients.size}`);
        });
      });

      this.httpServer.listen(this.port, this.host, () => {
        serverLogger.info(`[openLoop Core] 服务就绪，监听地址: http://${this.host}:${this.port}`);
        console.log(`[openLoop Core] Server listening at http://${this.host}:${this.port}`);
        resolve({ port: this.port, host: this.host });
      });

      this.httpServer.on('error', (err) => {
        serverLogger.error(`[openLoop Core] HTTP 服务器监听出错: ${err.message}`, err);
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

  private sendJson(
    res: http.ServerResponse,
    status: number,
    data: any,
    reqMeta?: { method: string; pathname: string; startTime: number }
  ) {
    if (reqMeta) {
      const duration = Date.now() - reqMeta.startTime;
      if (status >= 500) {
        serverLogger.error(
          `[HTTP <-- ${status}] ${reqMeta.method} ${reqMeta.pathname} (${duration}ms) - Server Error`,
          data
        );
      } else if (status >= 400) {
        serverLogger.warn(
          `[HTTP <-- ${status}] ${reqMeta.method} ${reqMeta.pathname} (${duration}ms) - Client Warning`,
          data
        );
      } else {
        serverLogger.info(
          `[HTTP <-- ${status}] ${reqMeta.method} ${reqMeta.pathname} (${duration}ms)`
        );
      }
    }

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
    const method = req.method || 'GET';
    const startTime = Date.now();
    const reqMeta = { method, pathname, startTime };

    serverLogger.debug(`[HTTP -->] ${method} ${pathname}`);

    try {
      if (pathname === '/api/status' && method === 'GET') {
        return this.sendJson(res, 200, {
          status: 'ok',
          uptime: process.uptime(),
          version: '0.1.0',
        }, reqMeta);
      }

      // Workflows
      if (pathname === '/api/workflows' && method === 'GET') {
        const workflows = this.store.getWorkflows();
        return this.sendJson(res, 200, workflows, reqMeta);
      }

      if (pathname === '/api/workflows' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        serverLogger.info(`[Workflows] 保存工作流: "${body.name || '未命名'}" (${body.id})`);
        const saved = this.store.saveWorkflow(body);
        return this.sendJson(res, 201, saved, reqMeta);
      }

      if (pathname.startsWith('/api/workflows/') && method === 'DELETE') {
        const id = pathname.replace('/api/workflows/', '');
        serverLogger.info(`[Workflows] 删除工作流: ${id}`);
        const ok = this.store.deleteWorkflow(id);
        return this.sendJson(res, ok ? 200 : 404, { success: ok }, reqMeta);
      }

      // Tasks
      if (pathname === '/api/tasks' && method === 'GET') {
        return this.sendJson(res, 200, this.store.getTasks(), reqMeta);
      }

      if (pathname === '/api/tasks' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const { title, workflowId, description, context, autoRun = true } = body;
        
        if (!workflowId) {
          return this.sendJson(res, 400, { error: 'workflowId is required' }, reqMeta);
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

        serverLogger.info(
          `[Tasks:Create] 创建新任务: "${task.title}" (ID: ${task.id}, Workflow: ${workflowId}, AutoRun: ${autoRun})`,
          { context: task.context },
          { taskId: task.id }
        );

        this.store.saveTask(task);
        this.broadcast({ type: 'task:new', data: task });

        if (autoRun) {
          serverLogger.info(`[Tasks:AutoRun] 异步启动任务调度: ${task.id}`, undefined, { taskId: task.id });
          setImmediate(() => {
            this.engine.runTask(task.id).catch((err) => {
              serverLogger.error(`[Tasks:RunError] 任务执行失败: ${err.message}`, err, { taskId: task.id });
              console.error(`Task ${task.id} failed:`, err);
            });
          });
        }

        return this.sendJson(res, 201, task, reqMeta);
      }

      // Task detail: /api/tasks/:id
      const taskDetailMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)$/);
      if (taskDetailMatch && method === 'GET') {
        const taskId = taskDetailMatch[1];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);
        return this.sendJson(res, 200, task, reqMeta);
      }

      if (taskDetailMatch && (method === 'PATCH' || method === 'PUT')) {
        const taskId = taskDetailMatch[1];
        const existing = this.store.getTask(taskId);
        if (!existing) return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);
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
        serverLogger.info(`[Tasks:Update] 更新任务信息: ${taskId}`, { updatedFields: Object.keys(body) }, { taskId });
        this.store.saveTask(existing);
        this.broadcast({ type: 'task:update', data: existing });
        return this.sendJson(res, 200, existing, reqMeta);
      }

      if (taskDetailMatch && method === 'DELETE') {
        const taskId = taskDetailMatch[1];
        serverLogger.info(`[Tasks:Delete] 删除任务: ${taskId}`, undefined, { taskId });
        const deleted = this.store.deleteTask(taskId);
        if (deleted) {
          this.broadcast({ type: 'task:update', data: { id: taskId, deleted: true } });
          return this.sendJson(res, 200, { success: true, id: taskId }, reqMeta);
        }
        return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);
      }

      // Task run: /api/tasks/:id/run
      const taskRunMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/run$/);
      if (taskRunMatch && method === 'POST') {
        const taskId = taskRunMatch[1];
        serverLogger.info(`[Tasks:ManualTrigger] 手动触发执行任务: ${taskId}`, undefined, { taskId });
        this.engine.runTask(taskId).catch((e) => {
          serverLogger.error(`[Tasks:RunError] 手动触发任务失败: ${e.message}`, e, { taskId });
          console.error(e);
        });
        return this.sendJson(res, 200, { success: true, message: `Task ${taskId} triggered` }, reqMeta);
      }

      // Task resume (QA approval): /api/tasks/:id/resume
      const taskResumeMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/resume$/);
      if (taskResumeMatch && method === 'POST') {
        const taskId = taskResumeMatch[1];
        const body = await this.parseJsonBody(req);
        const { approved = true, feedback = '' } = body;
        serverLogger.info(
          `[Tasks:Resume] 接收到任务审批指令: ${taskId}, Approved: ${approved}`,
          { feedback },
          { taskId }
        );
        const task = await this.engine.resumeTask(taskId, approved, feedback);
        return this.sendJson(res, 200, task, reqMeta);
      }

      // Task logs: /api/tasks/:id/logs
      const taskLogsMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/logs$/);
      if (taskLogsMatch && method === 'GET') {
        const taskId = taskLogsMatch[1];
        const logs = this.store.getLogs(taskId);
        return this.sendJson(res, 200, logs, reqMeta);
      }

      // Plugins: /api/plugins
      if (pathname === '/api/plugins' && method === 'GET') {
        return this.sendJson(res, 200, this.store.getPlugins(), reqMeta);
      }

      if (pathname === '/api/plugins' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        serverLogger.info(`[Plugins:Register] 注册插件: ${body.name || body.id}`);
        const registered = this.store.registerPlugin(body);
        return this.sendJson(res, 201, registered, reqMeta);
      }

      if (pathname.startsWith('/api/plugins/') && method === 'DELETE') {
        const id = decodeURIComponent(pathname.replace('/api/plugins/', ''));
        serverLogger.info(`[Plugins:Delete] 删除插件: ${id}`);
        const ok = this.store.deletePlugin(id);
        return this.sendJson(res, 200, { success: ok, id }, reqMeta);
      }

      // Settings: /api/settings
      if (pathname === '/api/settings' && method === 'GET') {
        return this.sendJson(res, 200, this.store.getSettings(), reqMeta);
      }

      if (pathname === '/api/settings' && (method === 'PUT' || method === 'POST')) {
        const body = await this.parseJsonBody(req);
        serverLogger.info(`[Settings:Update] 更新全局配置`, { keys: Object.keys(body) });
        const updated = this.store.updateSettings(body);
        return this.sendJson(res, 200, updated, reqMeta);
      }

      // Resume terminal: /api/tasks/:id/resume-terminal
      if (pathname.match(/^\/api\/tasks\/[^/]+\/resume-terminal$/) && method === 'POST') {
        const taskId = pathname.split('/')[3];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task Not Found' }, reqMeta);

        const sessionId =
          task.context?.piSessionId ||
          `session_${task.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const cmd = `pi --session ${sessionId}`;

        serverLogger.info(
          `[Tasks:ResumeTerminal] 唤起外部终端接管交互: ${taskId}, Session: ${sessionId}`,
          { command: cmd },
          { taskId }
        );

        if (process.platform === 'darwin') {
          spawn('osascript', ['-e', `tell application "Terminal" to do script "${cmd}"`, '-e', 'tell application "Terminal" to activate'], { detached: true });
        }

        return this.sendJson(res, 200, { success: true, command: cmd, sessionId }, reqMeta);
      }

      this.sendJson(res, 404, { error: 'Not Found' }, reqMeta);
    } catch (err: any) {
      serverLogger.error(`[Server Error] 请求异常 (${method} ${pathname}): ${err.message}`, err);
      console.error('[Server Error]', err);
      this.sendJson(res, 500, { error: err.message || 'Internal Server Error' }, reqMeta);
    }
  }

  private handleWsMessage(ws: WebSocket, msg: any) {
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  }
}
