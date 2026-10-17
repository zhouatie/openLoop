import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, exec } from 'child_process';
import util from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from '../store';
import { DagEngine } from '../engine/dag-engine';
import { Task, WorkflowDefinition, PluginManifest, TaskSessionState, KanbanColumn, TaskAttachment, WorkflowSessionState } from '../types';
import { createLogger } from '../logger';
import { PiRpcSessionManager } from '../agent/pi-rpc-session';
import { WorkflowCopilotManager } from '../agent/workflow-copilot';

const serverLogger = createLogger('Server');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

export interface ServerOptions {
  port?: number;
  host?: string;
  storeDir?: string;
  staticDir?: string;
}

export class OpenLoopServer {
  private port: number;
  private host: string;
  private store: Store;
  private engine: DagEngine;
  private httpServer?: http.Server;
  private wss?: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private staticDir?: string;

  constructor(options: ServerOptions = {}) {
    this.port = options.port || 19888;
    this.host = options.host || '127.0.0.1';
    this.staticDir = options.staticDir || process.env.OPENLOOP_STATIC_DIR;
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

    this.engine.on('agent:chat_update', (data) => {
      this.broadcast({ type: 'agent:chat_update', data });
    });

    // 流程编排智能体 Copilot 状态推流广播
    const copilotMgr = WorkflowCopilotManager.getInstance(this.store);
    copilotMgr.on('update', ({ workflowId, state }) => {
      this.broadcast({ type: 'workflow:chat_update', data: { workflowId, state } });
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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end(JSON.stringify(data));
  }

  private resolveStaticDir(): string | null {
    if (this.staticDir && fs.existsSync(this.staticDir)) {
      return this.staticDir;
    }
    const candidates = [
      path.resolve(__dirname, '../../desktop/dist'),
      path.resolve(__dirname, '../../../desktop/dist'),
      path.resolve(__dirname, '../../../packages/desktop/dist'),
      path.resolve(process.cwd(), 'packages/desktop/dist'),
      path.resolve(process.cwd(), 'dist'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
        return dir;
      }
    }
    return null;
  }

  private serveStatic(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    reqMeta: { method: string; pathname: string; startTime: number }
  ): boolean {
    const staticDir = this.resolveStaticDir();
    if (!staticDir) return false;

    // 清理路径防止路径穿越
    const cleanPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    let targetPath = path.join(staticDir, cleanPath);

    // 目录请求默认匹配 index.html
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      targetPath = path.join(targetPath, 'index.html');
    }

    // SPA 路由回退：非静态文件扩展名请求直接回退至 index.html
    const hasExtension = path.extname(cleanPath) !== '';
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      if (!hasExtension && fs.existsSync(path.join(staticDir, 'index.html'))) {
        targetPath = path.join(staticDir, 'index.html');
      } else {
        return false;
      }
    }

    try {
      const ext = path.extname(targetPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(targetPath);

      serverLogger.debug(
        `[Static:Serve] 命中静态资产: ${pathname} -> ${targetPath} (${stat.size} bytes)`,
        undefined,
        reqMeta
      );

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      });

      const stream = fs.createReadStream(targetPath);
      stream.pipe(res);
      return true;
    } catch (e: any) {
      serverLogger.warn(`[Static:Error] 传输静态资产失败: ${targetPath} - ${e.message}`);
      return false;
    }
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
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
      // 静态资源托管 (支持独立 Web 生产部署，无需外部 Vite 开发服务器即可直接打开使用)
      if (!pathname.startsWith('/api')) {
        const handled = this.serveStatic(req, res, pathname, reqMeta);
        if (handled) return;
      }

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

      // Workflow Copilot 会话状态读取: GET /api/workflows/:id/session
      const wfSessionMatch = pathname.match(/^\/api\/workflows\/([a-zA-Z0-9_-]+)\/session$/);
      if (wfSessionMatch && method === 'GET') {
        const wfId = wfSessionMatch[1];
        const copilot = WorkflowCopilotManager.getInstance(this.store);
        const state = copilot.getSessionState(wfId);
        return this.sendJson(res, 200, state, reqMeta);
      }

      // Workflow Copilot 发送编排对话: POST /api/workflows/:id/session/chat
      const wfChatMatch = pathname.match(/^\/api\/workflows\/([a-zA-Z0-9_-]+)\/session\/chat$/);
      if (wfChatMatch && method === 'POST') {
        const wfId = wfChatMatch[1];
        const body = await this.parseJsonBody(req);
        const { message, snapshot } = body;
        if (!message || typeof message !== 'string') {
          return this.sendJson(res, 400, { error: 'message string is required' }, reqMeta);
        }
        serverLogger.info(`[WorkflowCopilot:Chat] 收到编排对话 (Workflow: ${wfId}): "${message.slice(0, 40)}"`);
        const copilot = WorkflowCopilotManager.getInstance(this.store);
        copilot.sendMessage(wfId, message.trim(), snapshot).catch((err) => {
          serverLogger.error(`[WorkflowCopilot:Chat] 发送消息异常: ${err.message}`, undefined, { workflowId: wfId });
        });
        return this.sendJson(res, 200, { success: true }, reqMeta);
      }

      // Workflow Copilot 重置会话: POST /api/workflows/:id/session/reset
      const wfResetMatch = pathname.match(/^\/api\/workflows\/([a-zA-Z0-9_-]+)\/session\/reset$/);
      if (wfResetMatch && method === 'POST') {
        const wfId = wfResetMatch[1];
        serverLogger.info(`[WorkflowCopilot:Reset] 重置工作流会话: ${wfId}`);
        const copilot = WorkflowCopilotManager.getInstance(this.store);
        copilot.resetSession(wfId);
        return this.sendJson(res, 200, { success: true }, reqMeta);
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

      // Attachments: POST /api/attachments (高性能流式二进制上传与 Base64 兼容)
      if (pathname === '/api/attachments' && method === 'POST') {
        const queryFilename = parsedUrl.searchParams.get('filename');
        const headerFilename = req.headers['x-filename'] as string;
        const rawFilename = queryFilename || headerFilename || '';
        const filenameHeader = rawFilename ? decodeURIComponent(rawFilename) : 'image.png';
        const ext = path.extname(filenameHeader).toLowerCase() || '.png';
        const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext) ? ext : '.png';
        const id = `att_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const diskFilename = `${id}${safeExt}`;
        const attachmentsDir = path.join(this.store.getDataDir(), 'attachments');
        if (!fs.existsSync(attachmentsDir)) {
          fs.mkdirSync(attachmentsDir, { recursive: true });
        }
        const filePath = path.join(attachmentsDir, diskFilename);
        const contentType = (req.headers['content-type'] as string) || 'image/png';

        if (contentType.includes('application/json')) {
          const body = await this.parseJsonBody(req);
          const { name, data, mimeType } = body;
          const base64Data = (data || '').replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          fs.writeFileSync(filePath, buffer);
          const attachment: TaskAttachment = {
            id,
            name: name || filenameHeader,
            size: buffer.length,
            mimeType: mimeType || 'image/png',
            path: filePath,
            url: `/api/attachments/${diskFilename}`,
            createdAt: Date.now(),
          };
          serverLogger.info(`[Attachments:Create] 保存图片附件 (Base64): ${attachment.name} (${attachment.size} bytes)`);
          return this.sendJson(res, 201, attachment, reqMeta);
        }

        // 零内存损耗管道流式写入磁盘
        const writeStream = fs.createWriteStream(filePath);
        req.pipe(writeStream);

        await new Promise<void>((resolve, reject) => {
          writeStream.on('finish', () => resolve());
          writeStream.on('error', (err) => reject(err));
          req.on('error', (err) => reject(err));
        });

        const stat = fs.statSync(filePath);
        const attachment: TaskAttachment = {
          id,
          name: filenameHeader,
          size: stat.size,
          mimeType: contentType.split(';')[0] || 'image/png',
          path: filePath,
          url: `/api/attachments/${diskFilename}`,
          createdAt: Date.now(),
        };
        serverLogger.info(`[Attachments:Create] 流式保存图片附件: ${attachment.name} (${attachment.size} bytes) -> ${filePath}`);
        return this.sendJson(res, 201, attachment, reqMeta);
      }

      // Attachment serve: /api/attachments/:filename
      const attachmentMatch = pathname.match(/^\/api\/attachments\/([a-zA-Z0-9_.-]+)$/);
      if (attachmentMatch && method === 'GET') {
        const rawFilename = attachmentMatch[1];
        const safeFilename = path.basename(rawFilename);
        const attachmentsDir = path.join(this.store.getDataDir(), 'attachments');
        const filePath = path.join(attachmentsDir, safeFilename);

        if (!fs.existsSync(filePath)) {
          return this.sendJson(res, 404, { error: 'Attachment not found' }, reqMeta);
        }

        const ext = path.extname(safeFilename).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const stat = fs.statSync(filePath);

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
        return;
      }

      if (attachmentMatch && method === 'DELETE') {
        const rawFilename = attachmentMatch[1];
        const safeFilename = path.basename(rawFilename);
        const attachmentsDir = path.join(this.store.getDataDir(), 'attachments');
        const filePath = path.join(attachmentsDir, safeFilename);

        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            serverLogger.info(`[Attachments:Delete] 删除图片附件: ${safeFilename}`);
          } catch (e: any) {
            serverLogger.warn(`[Attachments:Delete] 删除文件失败: ${e.message}`);
          }
        }
        return this.sendJson(res, 200, { success: true }, reqMeta);
      }

      // Tasks
      if (pathname === '/api/tasks' && method === 'GET') {
        return this.sendJson(res, 200, this.store.getTasks(), reqMeta);
      }

      if (pathname === '/api/tasks' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const { title, workflowId, description, context, autoRun, kanbanColumn, workspace, attachments } = body;
        
        if (!workflowId) {
          return this.sendJson(res, 400, { error: 'workflowId is required' }, reqMeta);
        }

        const validColumn: KanbanColumn = kanbanColumn || 'backlog';
        // 若未显式传入 autoRun：当目标泳道为 inbox 时默认为 false，其余默认为 true
        const shouldAutoRun = autoRun !== undefined ? !!autoRun : (validColumn !== 'inbox');

        const task: Task = {
          id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          title: title || `自动化任务 #${Date.now()}`,
          description: description || '',
          attachments: Array.isArray(attachments) ? attachments : undefined,
          workflowId,
          status: 'pending',
          kanbanColumn: validColumn,
          workspace: workspace ? String(workspace).trim() : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          nodeRuns: {},
          context: context || {},
        };

        serverLogger.info(
          `[Tasks:Create] 创建新任务: "${task.title}" (ID: ${task.id}, Workflow: ${workflowId}, Column: ${task.kanbanColumn}, Workspace: ${task.workspace || '未指定'}, AutoRun: ${shouldAutoRun})`,
          { context: task.context, workspace: task.workspace },
          { taskId: task.id }
        );

        this.store.saveTask(task);
        this.broadcast({ type: 'task:new', data: task });

        if (shouldAutoRun) {
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
        const { title, description, workflowId, context, kanbanColumn, workspace, attachments } = body;
        if (title !== undefined) existing.title = title.trim();
        if (description !== undefined) existing.description = description.trim();
        if (attachments !== undefined) {
          existing.attachments = Array.isArray(attachments) ? attachments : [];
        }
        if (workspace !== undefined) {
          existing.workspace = workspace ? String(workspace).trim() : undefined;
        }
        if (workflowId !== undefined && existing.status === 'pending') {
          existing.workflowId = workflowId;
        }
        if (context !== undefined) {
          existing.context = { ...existing.context, ...context };
        }
        if (kanbanColumn !== undefined) {
          existing.kanbanColumn = kanbanColumn;
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

      // Task cancel / abort: /api/tasks/:id/cancel
      const taskCancelMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/cancel$/);
      if (taskCancelMatch && method === 'POST') {
        const taskId = taskCancelMatch[1];
        serverLogger.warn(`[Tasks:Cancel] 接收到终止任务指令: ${taskId}`, undefined, { taskId });
        try {
          const task = await this.engine.cancelTask(taskId);
          return this.sendJson(res, 200, { success: true, message: `Task ${taskId} cancelled`, task }, reqMeta);
        } catch (e: any) {
          serverLogger.error(`[Tasks:CancelError] 终止任务失败: ${e.message}`, e, { taskId });
          return this.sendJson(res, 500, { error: e.message }, reqMeta);
        }
      }

      // Task session get: /api/tasks/:id/session
      const taskSessionMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/session$/);
      if (taskSessionMatch && method === 'GET') {
        const taskId = taskSessionMatch[1];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);

        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (rpcSession) {
          return this.sendJson(res, 200, rpcSession.getState(), reqMeta);
        }

        // 无常驻 RPC 进程时，从持久化 context 中读取历史消息
        const historicalState: TaskSessionState = {
          taskId,
          active: false,
          isBusy: task.status === 'running',
          isPaused: false,
          messages: task.context?.chatMessages || [],
          agentName: 'OpenLoop Agent',
          piSessionId: task.context?.piSessionId,
        };
        return this.sendJson(res, 200, historicalState, reqMeta);
      }

      // Task session chat: /api/tasks/:id/session/chat
      const taskChatMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/session\/chat$/);
      if (taskChatMatch && method === 'POST') {
        const taskId = taskChatMatch[1];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);
        const body = await this.parseJsonBody(req);
        const { message, attachments } = body;
        const safeAttachments: TaskAttachment[] = Array.isArray(attachments) ? attachments : [];
        const rawMsg = typeof message === 'string' ? message.trim() : '';

        if (!rawMsg && safeAttachments.length === 0) {
          return this.sendJson(res, 400, { error: 'Message or attachments required' }, reqMeta);
        }

        const finalMessage = rawMsg || (safeAttachments.length > 0 ? '请查看我提供的图片附件并推进任务。' : '');

        serverLogger.info(
          `[AgentChat] 接收到任务会话消息 (${taskId}): "${finalMessage.slice(0, 30)}", 附件数: ${safeAttachments.length}`
        );

        // 如果用户上传了新图片，也同步累加到任务全局 attachments 中
        if (safeAttachments.length > 0) {
          const currentAtts = task.attachments || [];
          const existingIds = new Set(currentAtts.map((a) => a.id));
          const newAtts = safeAttachments.filter((a) => !existingIds.has(a.id));
          if (newAtts.length > 0) {
            task.attachments = [...currentAtts, ...newAtts];
            this.store.saveTask(task);
          }
        }

        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (rpcSession && rpcSession.active) {
          rpcSession.sendUserMessage(finalMessage, safeAttachments).catch((err) => {
            serverLogger.error(`发送用户消息失败: ${err.message}`, undefined, { taskId });
          });
          return this.sendJson(res, 200, { success: true, message: 'Message sent to active session' }, reqMeta);
        }

        // 若任务未启动或当前非活跃，暂存用户输入并提示
        if (!task.context) task.context = {};
        if (!task.context.chatMessages) task.context.chatMessages = [];
        task.context.chatMessages.push({
          id: `msg_u_${Date.now()}`,
          role: 'user',
          content: finalMessage,
          attachments: safeAttachments.length > 0 ? safeAttachments : undefined,
          timestamp: Date.now(),
        });
        this.store.saveTask(task);
        return this.sendJson(res, 200, { success: true, message: 'Message saved to history', active: false }, reqMeta);
      }

      // Task session pause: /api/tasks/:id/session/pause
      const taskPauseMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/session\/pause$/);
      if (taskPauseMatch && method === 'POST') {
        const taskId = taskPauseMatch[1];
        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (rpcSession) {
          const paused = await rpcSession.pause();
          return this.sendJson(res, 200, { success: paused }, reqMeta);
        }
        return this.sendJson(res, 400, { error: 'No active session to pause' }, reqMeta);
      }

      // Task session resume: /api/tasks/:id/session/resume
      const taskSessionResumeMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/session\/resume$/);
      if (taskSessionResumeMatch && method === 'POST') {
        const taskId = taskSessionResumeMatch[1];
        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (rpcSession) {
          const resumed = await rpcSession.resume();
          return this.sendJson(res, 200, { success: resumed }, reqMeta);
        }
        return this.sendJson(res, 400, { error: 'No active session to resume' }, reqMeta);
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

      // Task skip node: /api/tasks/:id/skip-node
      const taskSkipNodeMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/skip-node$/);
      if (taskSkipNodeMatch && method === 'POST') {
        const taskId = taskSkipNodeMatch[1];
        const body = await this.parseJsonBody(req);
        const { nodeId } = body;
        serverLogger.info(
          `[Tasks:SkipNode] 接收到跳过节点指令: ${taskId}, Node: ${nodeId || '自动判定'}`,
          { nodeId },
          { taskId }
        );
        try {
          const task = await this.engine.skipNode(taskId, nodeId);
          return this.sendJson(res, 200, task, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[Tasks:SkipNode] 跳过节点失败: ${err.message}`, err, { taskId });
          return this.sendJson(res, 400, { error: err.message }, reqMeta);
        }
      }

      // Task retry node: /api/tasks/:id/retry-node
      const taskRetryNodeMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/retry-node$/);
      if (taskRetryNodeMatch && method === 'POST') {
        const taskId = taskRetryNodeMatch[1];
        const body = await this.parseJsonBody(req);
        const { nodeId } = body;
        serverLogger.info(
          `[Tasks:RetryNode] 接收到单节点重试指令: ${taskId}, Node: ${nodeId || '自动判定'}`,
          { nodeId },
          { taskId }
        );
        try {
          const task = await this.engine.retryNode(taskId, nodeId);
          return this.sendJson(res, 200, task, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[Tasks:RetryNode] 重试节点失败: ${err.message}`, err, { taskId });
          return this.sendJson(res, 400, { error: err.message }, reqMeta);
        }
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

      // System Directory Dialog (Web / Fallback 支持)
      if (pathname === '/api/system/select-directory' && method === 'POST') {
        const body = await this.parseJsonBody(req).catch(() => ({}));
        const defaultPath = body.defaultPath;
        serverLogger.info('[System:Dialog] 接收到系统目录选择请求', { defaultPath });

        try {
          const execAsync = util.promisify(exec);
          let chosenPath: string | null = null;

          if (process.platform === 'darwin') {
            const promptText = '请选择工程工作区目录';
            let script = '';
            if (defaultPath && fs.existsSync(defaultPath)) {
              const safePath = defaultPath.replace(/"/g, '\\"');
              script = `osascript -e 'try' -e 'set defaultLoc to POSIX file "${safePath}"' -e 'set chosen to choose folder with prompt "${promptText}" default location defaultLoc' -e 'POSIX path of chosen' -e 'on error number -128' -e 'return ""' -e 'end try'`;
            } else {
              script = `osascript -e 'try' -e 'set chosen to choose folder with prompt "${promptText}"' -e 'POSIX path of chosen' -e 'on error number -128' -e 'return ""' -e 'end try'`;
            }
            const { stdout } = await execAsync(script);
            const trimmed = stdout.trim();
            chosenPath = trimmed ? trimmed.replace(/\/+$/, '') : null;
          } else if (process.platform === 'win32') {
            const psScript = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '请选择工程工作区目录'; ${defaultPath ? `$f.SelectedPath = '${defaultPath.replace(/'/g, "''")}';` : ''} if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }`;
            const { stdout } = await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`);
            const trimmed = stdout.trim();
            chosenPath = trimmed || null;
          } else {
            try {
              const { stdout } = await execAsync('zenity --file-selection --directory --title="请选择工程工作区目录"');
              const trimmed = stdout.trim();
              chosenPath = trimmed || null;
            } catch {
              chosenPath = null;
            }
          }

          serverLogger.info('[System:Dialog] 系统目录选择完成:', { chosenPath, canceled: !chosenPath });
          return this.sendJson(res, 200, {
            canceled: !chosenPath,
            path: chosenPath || undefined,
          }, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[System:Dialog] 唤起系统目录选择异常: ${err.message}`, err);
          return this.sendJson(res, 200, { canceled: true, error: err.message }, reqMeta);
        }
      }

      // System Open Path in OS file manager (Finder / Explorer)
      if (pathname === '/api/system/open-path' && method === 'POST') {
        const body = await this.parseJsonBody(req).catch(() => ({}));
        const targetPath = body.path;
        if (!targetPath) {
          return this.sendJson(res, 400, { error: 'path is required' }, reqMeta);
        }
        let resolvedPath = String(targetPath).trim();
        if (resolvedPath === '~') {
          resolvedPath = os.homedir();
        } else if (resolvedPath.startsWith('~/') || resolvedPath.startsWith('~\\')) {
          resolvedPath = path.join(os.homedir(), resolvedPath.slice(2));
        }
        serverLogger.info(`[System:OpenPath] 在系统文件管理器中打开路径: ${resolvedPath}`);
        const execAsync = util.promisify(exec);
        try {
          if (process.platform === 'darwin') {
            await execAsync(`open "${resolvedPath.replace(/"/g, '\\"')}"`);
          } else if (process.platform === 'win32') {
            await execAsync(`start "" "${resolvedPath.replace(/"/g, '\\"')}"`);
          } else {
            await execAsync(`xdg-open "${resolvedPath.replace(/"/g, '\\"')}"`);
          }
          return this.sendJson(res, 200, { success: true }, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[System:OpenPath] 打开系统路径失败: ${err.message}`, err);
          return this.sendJson(res, 500, { success: false, error: err.message }, reqMeta);
        }
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
