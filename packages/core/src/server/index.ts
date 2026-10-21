import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, exec } from 'child_process';
import util from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from '../store';
import { DagEngine } from '../engine/dag-engine';
import {
  Task,
  WorkflowDefinition,
  PluginManifest,
  TaskSessionState,
  KanbanColumn,
  TaskAttachment,
  WorkflowSessionState,
  QaSuite,
  QaRunRecord,
  AutomationTask,
  AutomationLogRecord,
  RuntimeSettingsApplySummary,
} from '../types';
import { createLogger } from '../logger';
import { PiRpcSessionManager } from '../agent/pi-rpc-session';
import { WorkflowCopilotManager } from '../agent/workflow-copilot';
import { MidsceneRunner } from '../qa/midscene-runner';
import { AndroidDeviceManager } from '../qa/android-device-manager';
import { IosDeviceManager } from '../qa/ios-device-manager';
import { isQaPlatform } from '../qa/qa-driver';
import { applyQaModelEnv } from '../qa/model-env';
import { configureQaRuntimePaths } from '../qa/runtime-paths';
import { WorktreeManager, TaskProcessManager, findRepoRoot } from '../worktree/worktree-manager';
import { interpolateString } from '../executors';
import { getAgentProviderMeta, resolveResumeCommand } from '../constants/agent-providers';
import { getEffectivePrompt, renderPromptTemplate } from '../constants/prompts';
import { AutomationScheduler } from '../automation/automation-scheduler';
import { WorkflowRecommender } from '../engine/workflow-recommender';
import { SubtaskPlanner } from '../agent/subtask-planner';

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
  private scheduler: AutomationScheduler;
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
    // 进程重启后恢复各活跃任务的靶机端口预占，防止新任务抢占同一端口
    WorktreeManager.getInstance().restoreReservedPorts(this.store.getTasks());
    this.scheduler = new AutomationScheduler(this.store, this.engine);

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

    // 自动化任务调度服务事件推流广播
    this.scheduler.on('automation:update', (data) => {
      this.broadcast({ type: 'automation:update', data });
    });
    this.scheduler.on('automation:log', (data) => {
      this.broadcast({ type: 'automation:log', data });
    });
    this.scheduler.on('task:new', (task) => {
      this.broadcast({ type: 'task:new', data: task });
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

      // 启动时把界面配置的多模态模型参数注入进程环境（Android 视觉推理依赖）
      applyQaModelEnv(this.store.getSettings()?.qaAutomation);
      // 把 Midscene 调试产物收拢到数据目录，避免污染工作目录并可被存储清理回收
      configureQaRuntimePaths(this.store.getDataDir());

      this.httpServer.listen(this.port, this.host, () => {
        serverLogger.info(`[openLoop Core] 服务就绪，监听地址: http://${this.host}:${this.port}`);
        console.log(`[openLoop Core] Server listening at http://${this.host}:${this.port}`);
        this.scheduler.start().catch((err) => {
          serverLogger.error('[openLoop Core] 启动自动化任务调度器异常:', err);
        });
        setTimeout(() => this.checkAutoStorageCleanup(), 5000);
        setInterval(() => this.checkAutoStorageCleanup(), 6 * 3600 * 1000);
        resolve({ port: this.port, host: this.host });
      });

      this.httpServer.on('error', (err) => {
        serverLogger.error(`[openLoop Core] HTTP 服务器监听出错: ${err.message}`, err);
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    this.scheduler.stop();

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

  private checkAutoStorageCleanup(): void {
    try {
      const settings = this.store.getSettings();
      const retention = settings.storageRetention;
      if (!retention || !retention.autoCleanEnabled) return;

      const now = Date.now();
      const lastClean = retention.lastAutoCleanAt || 0;
      if (now - lastClean < 12 * 3600 * 1000) return;

      serverLogger.info('[Storage:AutoRetention] 触发后台轻量化数据生命周期维护');
      const res = this.store.cleanStorage({
        cleanLogsDays: retention.logRetentionDays || 14,
        cleanQaRunsKeepLatest: retention.qaRunRetentionCount || 10,
        cleanAutomationLogsDays: retention.automationLogRetentionDays || 7,
        cleanOrphanFiles: true,
        vacuum: true,
      });
      this.store.updateSettings({
        storageRetention: {
          ...retention,
          lastAutoCleanAt: now,
        },
      });
      serverLogger.info(`[Storage:AutoRetention] 自动维护完成: 释放空间 ${(res.freedBytes / 1024 / 1024).toFixed(2)} MB`);
    } catch (e: any) {
      serverLogger.warn(`[Storage:AutoRetention] 自动维护异常: ${e.message}`);
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
      // 产物文件托管 (如 Midscene 自动化测试截图、回放 HTML 等)
      if (pathname.startsWith('/artifacts/')) {
        const artifactClean = path.normalize(pathname.replace(/^\/artifacts\//, '')).replace(/^(\.\.[\/\\])+/, '');
        const targetPath = path.join(this.store.getDataDir(), 'artifacts', artifactClean);
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
          const ext = path.extname(targetPath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=86400',
          });
          return fs.createReadStream(targetPath).pipe(res);
        } else {
          return this.sendJson(res, 404, { error: 'Artifact Not Found' }, reqMeta);
        }
      }

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
        // 直连流水线的隐藏载体任务不进入看板
        const tasks = this.store.getTasks().filter((t) => !t.context?.hiddenFromKanban);
        return this.sendJson(res, 200, tasks, reqMeta);
      }

      if (pathname === '/api/tasks' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const {
          title,
          workflowId,
          description,
          context,
          autoRun,
          kanbanColumn,
          workspace,
          attachments,
          triggerSource,
          kind = 'single',
          parentTaskId,
          subTaskIds,
          dependencies,
          executionMode,
          concurrencyLimit,
          subtasks,
        } = body;
        
        if (!workflowId) {
          return this.sendJson(res, 400, { error: 'workflowId is required' }, reqMeta);
        }

        const validColumn: KanbanColumn = kanbanColumn || 'backlog';
        // 若未显式传入 autoRun：当目标泳道为 inbox 时默认为 false，其余默认为 true
        const shouldAutoRun = autoRun !== undefined ? !!autoRun : (validColumn !== 'inbox');

        const taskContext = { ...(context || {}) };
        if (body.qaInstructions && Array.isArray(body.qaInstructions)) {
          taskContext.qaInstructions = body.qaInstructions.map((s: any) => String(s).trim()).filter(Boolean);
        } else if (body.acceptanceCriteria && typeof body.acceptanceCriteria === 'string') {
          const steps = body.acceptanceCriteria
            .split('\n')
            .map((s: string) => s.replace(/^[-*•\d.]+\s*/, '').trim())
            .filter(Boolean);
          if (steps.length > 0) {
            taskContext.qaInstructions = steps;
          }
        }

        const isGroup = kind === 'group' || (Array.isArray(subtasks) && subtasks.length > 0);
        const groupId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

        // 如果携带了批量子任务，原子化创建子任务并构建拓扑
        const createdSubtasks: Task[] = [];
        const finalSubTaskIds: string[] = Array.isArray(subTaskIds) ? [...subTaskIds] : [];

        if (Array.isArray(subtasks) && subtasks.length > 0) {
          // 建立临时索引映射，支持子任务间通过客户端 index/tempId 建立依赖
          const tempIdToRealId = new Map<string, string>();
          for (let i = 0; i < subtasks.length; i++) {
            const rawSub = subtasks[i];
            const subRealId = `task_sub_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
            if (rawSub.id) tempIdToRealId.set(rawSub.id, subRealId);
            tempIdToRealId.set(String(i), subRealId);
            finalSubTaskIds.push(subRealId);
          }

          for (let i = 0; i < subtasks.length; i++) {
            const rawSub = subtasks[i];
            const realId = finalSubTaskIds[i];

            // 映射子任务依赖
            const mappedDeps: string[] = [];
            if (Array.isArray(rawSub.dependencies)) {
              for (const dep of rawSub.dependencies) {
                if (tempIdToRealId.has(dep)) {
                  mappedDeps.push(tempIdToRealId.get(dep)!);
                } else {
                  mappedDeps.push(dep);
                }
              }
            }

            const childTask: Task = {
              id: realId,
              title: rawSub.title || `子工序 #${i + 1}`,
              description: rawSub.description || '',
              attachments: Array.isArray(rawSub.attachments) ? rawSub.attachments : undefined,
              workflowId: rawSub.workflowId || workflowId,
              status: 'pending',
              kanbanColumn: validColumn,
              workspace: (rawSub.workspace || workspace) ? String(rawSub.workspace || workspace).trim() : undefined,
              triggerSource: triggerSource || (context && context.triggerSource) || 'kanban',
              kind: 'subtask',
              parentTaskId: groupId,
              dependencies: mappedDeps.length > 0 ? mappedDeps : undefined,
              createdAt: Date.now() + i,
              updatedAt: Date.now() + i,
              nodeRuns: {},
              context: {
                ...(rawSub.context || {}),
                parentTaskId: groupId,
              },
            };

            this.store.saveTask(childTask);
            createdSubtasks.push(childTask);
          }
        }

        const task: Task = {
          id: groupId,
          title: title || (isGroup ? `任务组 #${Date.now()}` : `自动化任务 #${Date.now()}`),
          description: description || '',
          attachments: Array.isArray(attachments) ? attachments : undefined,
          workflowId,
          status: 'pending',
          kanbanColumn: validColumn,
          workspace: workspace ? String(workspace).trim() : undefined,
          triggerSource: triggerSource || (context && context.triggerSource) || 'kanban',
          kind: isGroup ? 'group' : kind,
          parentTaskId: parentTaskId || undefined,
          subTaskIds: isGroup ? finalSubTaskIds : undefined,
          dependencies: Array.isArray(dependencies) ? dependencies : undefined,
          executionMode: executionMode || (isGroup ? 'serial' : undefined),
          concurrencyLimit: typeof concurrencyLimit === 'number' ? concurrencyLimit : (isGroup ? 3 : undefined),
          autoDecompose: body.autoDecompose !== undefined ? Boolean(body.autoDecompose) : true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          nodeRuns: {},
          context: taskContext,
        };

        serverLogger.info(
          `[Tasks:Create] 创建新任务: "${task.title}" (ID: ${task.id}, Kind: ${task.kind}, Subtasks: ${finalSubTaskIds.length}, Workflow: ${workflowId}, AutoRun: ${shouldAutoRun})`,
          { context: task.context, workspace: task.workspace, triggerSource: task.triggerSource },
          { taskId: task.id }
        );

        this.store.saveTask(task);
        this.broadcast({ type: 'task:new', data: task });
        for (const child of createdSubtasks) {
          this.broadcast({ type: 'task:new', data: child });
        }

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
        const {
          title,
          description,
          workflowId,
          context,
          kanbanColumn,
          workspace,
          attachments,
          triggerSource,
          kind,
          parentTaskId,
          subTaskIds,
          dependencies,
          executionMode,
          concurrencyLimit,
        } = body;
        if (title !== undefined) existing.title = title.trim();
        if (description !== undefined) existing.description = description.trim();
        if (triggerSource !== undefined) existing.triggerSource = triggerSource;
        if (kind !== undefined) existing.kind = kind;
        if (parentTaskId !== undefined) existing.parentTaskId = parentTaskId || undefined;
        if (subTaskIds !== undefined) existing.subTaskIds = Array.isArray(subTaskIds) ? subTaskIds : undefined;
        if (dependencies !== undefined) existing.dependencies = Array.isArray(dependencies) ? dependencies : undefined;
        if (executionMode !== undefined) existing.executionMode = executionMode;
        if (concurrencyLimit !== undefined) existing.concurrencyLimit = typeof concurrencyLimit === 'number' ? concurrencyLimit : 3;
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
        if (body.qaInstructions && Array.isArray(body.qaInstructions)) {
          existing.context = {
            ...(existing.context || {}),
            qaInstructions: body.qaInstructions.map((s: any) => String(s).trim()).filter(Boolean),
          };
        } else if (body.acceptanceCriteria && typeof body.acceptanceCriteria === 'string') {
          const steps = body.acceptanceCriteria
            .split('\n')
            .map((s: string) => s.replace(/^[-*•\d.]+\s*/, '').trim())
            .filter(Boolean);
          existing.context = {
            ...(existing.context || {}),
            qaInstructions: steps,
          };
        }
        if (kanbanColumn !== undefined) {
          existing.kanbanColumn = kanbanColumn;
          // 当卡片被移入已完成列 (done) 时，立即清理该任务的所有子进程与沙箱靶机
          if (kanbanColumn === 'done') {
            try {
              TaskProcessManager.stopAll(taskId);
              if (existing.context?.worktree?.webPort) {
                WorktreeManager.getInstance().killPortIfBusy(existing.context.worktree.webPort);
              }
              WorktreeManager.unregisterTaskPorts(taskId);
            } catch (err: any) {
              serverLogger.warn(`[Tasks:Update] 清理已完成任务的靶机进程告警: ${err.message}`);
            }
          }
        }
        if (body.status === 'completed' || body.status === 'cancelled') {
          existing.status = body.status;
          try {
            TaskProcessManager.stopAll(taskId);
            if (existing.context?.worktree?.webPort) {
              WorktreeManager.getInstance().killPortIfBusy(existing.context.worktree.webPort);
            }
            WorktreeManager.unregisterTaskPorts(taskId);
          } catch {}
        }
        existing.updatedAt = Date.now();
        serverLogger.info(`[Tasks:Update] 更新任务信息: ${taskId}`, { updatedFields: Object.keys(body) }, { taskId });
        this.store.saveTask(existing);
        this.broadcast({ type: 'task:update', data: existing });
        return this.sendJson(res, 200, existing, reqMeta);
      }

      if (taskDetailMatch && method === 'DELETE') {
        const taskId = taskDetailMatch[1];
        serverLogger.info(`[Tasks:Delete] 接收到任务全链路删除请求: ${taskId}`, undefined, { taskId });
        const existingTask = this.store.getTask(taskId);

        // 收集需要级联清理的任务清单（包含父任务与所有子任务）
        const subtaskIds = existingTask?.subTaskIds || [];
        const allTargetTasks: Task[] = [];
        if (existingTask) allTargetTasks.push(existingTask);
        for (const subId of subtaskIds) {
          const sub = this.store.getTask(subId);
          if (sub) allTargetTasks.push(sub);
        }

        // 1. 中止可能正在执行的 DAG 引擎与子进程
        try {
          this.engine.cancelTask(taskId).catch(() => {});
        } catch {}

        // 2. 级联释放所有目标任务的运行时资源（Pi 会话、Worktree 分支、靶机沙箱端口、磁盘产物）
        for (const target of allTargetTasks) {
          try {
            PiRpcSessionManager.getInstance().removeSession(target.id);
          } catch {}

          try {
            TaskProcessManager.stopAll(target.id);
            if (target.context?.worktree?.webPort) {
              WorktreeManager.getInstance().killPortIfBusy(target.context.worktree.webPort);
            }
            WorktreeManager.unregisterTaskPorts(target.id);
          } catch {}

          try {
            let repoRoot = process.cwd();
            if (target.workspace) {
              repoRoot = target.workspace.includes('.worktrees')
                ? path.dirname(path.dirname(target.workspace))
                : target.workspace;
            }
            await WorktreeManager.getInstance().cleanupTaskWorktree(repoRoot, target.id);
          } catch (wtErr: any) {
            serverLogger.warn(`[Tasks:Delete] 清理 Worktree 告警 (${target.id}): ${wtErr.message}`);
          }

          try {
            const dataDir = path.join(os.homedir(), '.openloop', 'artifacts');
            const runIdsToClean: string[] = [];
            if (target.context?.qaRunId) runIdsToClean.push(target.context.qaRunId);
            if (target.attachments) {
              const attachmentsDir = path.join(this.store.getDataDir(), 'attachments');
              for (const att of target.attachments) {
                const m = att.path?.match(/artifacts\/([^/\\]+)/);
                if (m && !runIdsToClean.includes(m[1])) {
                  runIdsToClean.push(m[1]);
                }
                const fn = att.url ? path.basename(att.url) : (att.path ? path.basename(att.path) : null);
                if (fn) {
                  const filePath = path.join(attachmentsDir, fn);
                  if (fs.existsSync(filePath)) {
                    try {
                      fs.unlinkSync(filePath);
                      serverLogger.info(`[Tasks:Delete] 成功清理任务图片附件: ${filePath}`);
                    } catch {}
                  }
                }
              }
            }
            const taskQaRuns = this.store.getQaRuns(undefined, target.id);
            for (const qr of taskQaRuns) {
              if (!runIdsToClean.includes(qr.id)) {
                runIdsToClean.push(qr.id);
              }
            }
            for (const rId of runIdsToClean) {
              const rDir = path.join(dataDir, rId);
              if (fs.existsSync(rDir)) {
                fs.rmSync(rDir, { recursive: true, force: true });
                serverLogger.info(`[Tasks:Delete] 成功清理磁盘产物目录: ${rDir}`);
              }
            }
          } catch (cleanErr: any) {
            serverLogger.warn(`[Tasks:Delete] 清理磁盘产物告警 (${target.id}): ${cleanErr.message}`);
          }
        }

        // 3. 级联删除数据库记录 (tasks, logs, qa_runs, task_node_runs)
        const deleted = this.store.deleteTask(taskId);
        if (deleted) {
          this.broadcast({ type: 'task:update', data: { id: taskId, deleted: true } });
          for (const subId of subtaskIds) {
            this.broadcast({ type: 'task:update', data: { id: subId, deleted: true } });
          }
          return this.sendJson(res, 200, { success: true, id: taskId }, reqMeta);
        }
        return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);
      }

      // Add Subtask to Task/Group: POST /api/tasks/:id/subtasks
      const taskAddSubtaskMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/subtasks$/);
      if (taskAddSubtaskMatch && method === 'POST') {
        const parentId = taskAddSubtaskMatch[1];
        const parent = this.store.getTask(parentId);
        if (!parent) return this.sendJson(res, 404, { error: 'Parent task not found' }, reqMeta);

        const body = await this.parseJsonBody(req);
        const { title, workflowId, description, dependencies, attachments, workspace } = body;
        const subId = `task_sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const childWorkspace = typeof workspace === 'string' && workspace.trim() ? workspace.trim() : parent.workspace;

        const childTask: Task = {
          id: subId,
          title: title || `子工序 #${(parent.subTaskIds?.length || 0) + 1}`,
          description: description || '',
          attachments: Array.isArray(attachments) ? attachments : undefined,
          workflowId: workflowId || parent.workflowId,
          status: 'pending',
          kanbanColumn: parent.kanbanColumn,
          workspace: childWorkspace,
          triggerSource: parent.triggerSource,
          kind: 'subtask',
          parentTaskId: parent.id,
          dependencies: Array.isArray(dependencies) ? dependencies : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          nodeRuns: {},
          context: {
            parentTaskId: parent.id,
          },
        };

        // 升级父任务为 group 并挂载子任务 ID
        parent.kind = 'group';
        parent.subTaskIds = [...(parent.subTaskIds || []), subId];
        parent.updatedAt = Date.now();

        this.store.saveTask(childTask);
        this.store.saveTask(parent);

        this.broadcast({ type: 'task:new', data: childTask });
        this.broadcast({ type: 'task:update', data: parent });

        serverLogger.info(`[Tasks:AddSubtask] 成功为任务组 ${parent.id} 添加子任务: ${childTask.id} (${childTask.title})`);
        return this.sendJson(res, 201, { success: true, subtask: childTask, parent }, reqMeta);
      }

      // Batch Add Subtasks to Task/Group: POST /api/tasks/:id/subtasks/batch
      const taskBatchSubtasksMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/subtasks\/batch$/);
      if (taskBatchSubtasksMatch && method === 'POST') {
        const parentId = taskBatchSubtasksMatch[1];
        const parent = this.store.getTask(parentId);
        if (!parent) return this.sendJson(res, 404, { error: 'Parent task not found' }, reqMeta);

        const body = await this.parseJsonBody(req);
        const { subtasks: rawSubtasks, executionMode, concurrencyLimit } = body;

        if (!Array.isArray(rawSubtasks) || rawSubtasks.length === 0) {
          return this.sendJson(res, 400, { error: 'subtasks array is required' }, reqMeta);
        }

        const createdList: Task[] = [];
        const currentSubTaskIds = [...(parent.subTaskIds || [])];
        const tempIdToRealId = new Map<string, string>();

        for (let i = 0; i < rawSubtasks.length; i++) {
          const raw = rawSubtasks[i];
          const newSubId = `task_sub_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
          if (raw.id) tempIdToRealId.set(raw.id, newSubId);
          tempIdToRealId.set(`sub_${i + 1}`, newSubId);
          tempIdToRealId.set(String(i), newSubId);
          currentSubTaskIds.push(newSubId);
        }

        for (let i = 0; i < rawSubtasks.length; i++) {
          const raw = rawSubtasks[i];
          const realId = currentSubTaskIds[currentSubTaskIds.length - rawSubtasks.length + i];
          const mappedDeps = (raw.dependencies || [])
            .map((d: string) => tempIdToRealId.get(d) || d)
            .filter((d: string) => currentSubTaskIds.includes(d));

          const childWorkspace =
            typeof raw.workspace === 'string' && raw.workspace.trim() ? raw.workspace.trim() : parent.workspace;

          const childTask: Task = {
            id: realId,
            title: raw.title || `子工序 #${currentSubTaskIds.length - rawSubtasks.length + i + 1}`,
            description: raw.description || parent.description,
            attachments: Array.isArray(raw.attachments) ? raw.attachments : undefined,
            workflowId: raw.workflowId || parent.workflowId,
            status: 'pending',
            kanbanColumn: parent.kanbanColumn,
            workspace: childWorkspace,
            triggerSource: parent.triggerSource,
            kind: 'subtask',
            parentTaskId: parent.id,
            dependencies: mappedDeps.length > 0 ? mappedDeps : undefined,
            createdAt: Date.now() + i,
            updatedAt: Date.now() + i,
            nodeRuns: {},
            context: {
              ...(raw.context || {}),
              parentTaskId: parent.id,
            },
          };

          this.store.saveTask(childTask);
          createdList.push(childTask);
        }

        parent.kind = 'group';
        parent.subTaskIds = currentSubTaskIds;
        if (executionMode) parent.executionMode = executionMode;
        if (typeof concurrencyLimit === 'number') parent.concurrencyLimit = concurrencyLimit;
        parent.updatedAt = Date.now();
        this.store.saveTask(parent);

        for (const child of createdList) {
          this.broadcast({ type: 'task:new', data: child });
        }
        this.broadcast({ type: 'task:update', data: parent });

        serverLogger.info(`[Tasks:BatchSubtasks] 成功为任务组 ${parent.id} 批量添加 ${createdList.length} 个子工序`);
        return this.sendJson(res, 201, { success: true, subtasks: createdList, parent }, reqMeta);
      }

      // AI Plan Subtasks for Task: POST /api/tasks/:id/plan-subtasks
      const taskPlanSubtasksMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/plan-subtasks$/);
      if (taskPlanSubtasksMatch && method === 'POST') {
        const taskId = taskPlanSubtasksMatch[1];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);

        const allWorkflows = this.store.getWorkflows();
        const plan = await SubtaskPlanner.plan(this.store, task, allWorkflows);
        if (!plan) {
          serverLogger.warn(`[Tasks:PlanSubtasks] 任务 ${taskId} 的 AI 工序规划未产出有效方案`);
          return this.sendJson(
            res,
            502,
            { error: 'AI 工序规划失败，请重试或手动添加工序' },
            reqMeta
          );
        }
        serverLogger.info(`[Tasks:PlanSubtasks] 为任务 ${taskId} 规划子工序方案:`, plan);
        return this.sendJson(res, 200, { success: true, plan }, reqMeta);
      }

      // Delete Subtask: DELETE /api/tasks/:id/subtasks/:subId
      const taskDeleteSubtaskMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/subtasks\/([a-zA-Z0-9_-]+)$/);
      if (taskDeleteSubtaskMatch && method === 'DELETE') {
        const parentId = taskDeleteSubtaskMatch[1];
        const subId = taskDeleteSubtaskMatch[2];
        const parent = this.store.getTask(parentId);
        if (!parent) return this.sendJson(res, 404, { error: 'Parent task not found' }, reqMeta);

        const subtask = this.store.getTask(subId);
        if (!subtask) return this.sendJson(res, 404, { error: 'Subtask not found' }, reqMeta);

        if (subtask.status === 'running') {
          return this.sendJson(res, 400, { error: 'Cannot delete a running subtask' }, reqMeta);
        }

        // 从父任务 subTaskIds 中移除
        parent.subTaskIds = (parent.subTaskIds || []).filter((id) => id !== subId);
        if (parent.subTaskIds.length === 0) {
          parent.kind = 'single';
        }
        parent.updatedAt = Date.now();
        this.store.saveTask(parent);

        // 删除子任务
        this.store.deleteTask(subId);
        this.broadcast({ type: 'task:delete', data: { id: subId } });
        this.broadcast({ type: 'task:update', data: parent });

        serverLogger.info(`[Tasks:DeleteSubtask] 成功从任务 ${parent.id} 移除子工序 ${subId}`);
        return this.sendJson(res, 200, { success: true, parent }, reqMeta);
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

        const settings = this.store.getSettings() || {};
        const sessionId =
          task.context?.sessionId ||
          task.context?.piSessionId ||
          `session_${task.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const provider = getAgentProviderMeta(
          task.context?.agentProvider || settings.agentProvider
        ).id;
        const resumeCommand =
          task.context?.resumeCommand || resolveResumeCommand(provider, sessionId);

        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (rpcSession) {
          return this.sendJson(
            res,
            200,
            { ...rpcSession.getState(), sessionId, resumeCommand },
            reqMeta
          );
        }

        // 无常驻 RPC 进程时，从持久化 context 中读取历史消息
        const historicalState: TaskSessionState = {
          taskId,
          active: false,
          isBusy: task.status === 'running',
          isPaused: false,
          messages: task.context?.chatMessages || [],
          agentName: task.context?.agentName || 'OpenLoop Agent',
          model: task.context?.model || settings.defaultModel || undefined,
          sessionId,
          piSessionId: sessionId,
          resumeCommand,
          agentProvider: provider,
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
        const { message, attachments, includeQaArtifacts } = body;
        const safeAttachments: TaskAttachment[] = Array.isArray(attachments) ? attachments : [];
        const rawMsg = typeof message === 'string' ? message.trim() : '';

        if (!rawMsg && safeAttachments.length === 0 && !includeQaArtifacts) {
          return this.sendJson(res, 400, { error: 'Message or attachments required' }, reqMeta);
        }

        const finalMessage = rawMsg || (includeQaArtifacts ? '请查看最新 UI 自动化测试产物并分析修复。' : (safeAttachments.length > 0 ? '请查看我提供的图片附件并推进任务。' : ''));

        serverLogger.info(
          `[AgentChat] 接收到任务会话消息 (${taskId}): "${finalMessage.slice(0, 30)}", 附件数: ${safeAttachments.length}, 附带QA产物: ${!!includeQaArtifacts}`
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

        // 仅在用户主动操作附带时，才装配 QA 自动化测试产物信息，默认绝不自动插入
        let enrichedMessage = finalMessage;
        if (includeQaArtifacts) {
          let qaRunId = task.context?.qaRunId || (task.context?.worktree as any)?.qaRunId;
          if (!qaRunId) {
            const taskQaRuns = this.store.getQaRuns(undefined, taskId, 1);
            if (taskQaRuns && taskQaRuns.length > 0) {
              qaRunId = taskQaRuns[0].id;
            }
          }
          if (qaRunId) {
            const runDir = path.join(os.homedir(), '.openloop', 'artifacts', qaRunId);
            const timelinePath = path.join(runDir, 'timeline.json');
            const imageFiles = fs.existsSync(runDir)
              ? fs.readdirSync(runDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => path.join(runDir, f))
              : [];

            if (imageFiles.length > 0) {
              const settings = this.store.getSettings();
              const feedbackTemplate = getEffectivePrompt('qaArtifactFeedback', settings.prompts);
              const feedbackText = renderPromptTemplate(feedbackTemplate, {
                qaRunId,
                timelinePath,
                screenshotPaths: imageFiles.map((p) => `  * ${p}`).join('\n'),
              });
              enrichedMessage += `\n\n${feedbackText}`;
            }
          }
        }

        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (rpcSession && rpcSession.active) {
          rpcSession.sendUserMessage(enrichedMessage, safeAttachments).catch((err) => {
            serverLogger.error(`发送用户消息失败: ${err.message}`, undefined, { taskId });
          });
          return this.sendJson(res, 200, { success: true, message: 'Message sent to active session', active: true }, reqMeta);
        }

        // 若当前无活跃会话，立即自动拉起/唤醒 Agent RPC 会话，响应用户追加指令
        const sessionId = task.context?.sessionId || task.context?.piSessionId || `session_${task.id}`;
        const cwd = task.context?.worktree?.worktreeDir || task.workspace || process.cwd();
        const settings = this.store.getSettings() || {};
        const provider = getAgentProviderMeta(
          task.context?.agentProvider || settings.agentProvider
        ).id;

        // 非 pi 引擎属于单次 CLI 独立进程，不支持内置 RPC 长连接双向聊天
        if (provider !== 'pi') {
          return this.sendJson(
            res,
            400,
            {
              error: `当前任务运行引擎为 [${getAgentProviderMeta(provider).label}]。双向会话仅支持内置 Pi Agent，请在终端中使用接管命令调试。`,
              provider,
            },
            reqMeta
          );
        }

        serverLogger.info(`[AgentChat:AutoWakeup] 唤醒并启动 Agent 会话: ${sessionId} (CWD: ${cwd})`, undefined, { taskId });

        // 记录用户消息到任务上下文，供刷新与持久化
        if (!task.context) task.context = {};
        if (!task.context.chatMessages) task.context.chatMessages = [];
        const userMsg = {
          id: `msg_u_${Date.now()}`,
          role: 'user' as const,
          content: enrichedMessage,
          attachments: safeAttachments.length > 0 ? safeAttachments : undefined,
          timestamp: Date.now(),
        };
        const hasRecentSame = task.context.chatMessages.some(
          (m: any) => m.content === userMsg.content && Math.abs(m.timestamp - userMsg.timestamp) < 3000
        );
        if (!hasRecentSame) {
          task.context.chatMessages.push(userMsg);
          this.store.saveTask(task);
        }

        // 启动 Pi RPC 进程并实时绑定广播
        PiRpcSessionManager.getInstance().createSession({
          taskId: task.id,
          taskTitle: task.title,
          taskDescription: task.description,
          sessionId,
          agentName: 'OpenLoop Agent',
          model: settings.defaultModel,
          thinking: settings.reasoningLevel || 'high',
          cwd,
          initialPrompt: enrichedMessage,
          onLog: (stream, message) => {
            const logEntry = {
              id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              taskId: task.id,
              nodeId: task.currentNodeId || 'agent_chat',
              timestamp: Date.now(),
              stream,
              message,
            };
            this.store.addLog(logEntry);
            this.broadcast({ type: 'log', data: logEntry });
          },
          onUpdate: (state) => {
            const currentTask = this.store.getTask(taskId);
            if (currentTask) {
              if (!currentTask.context) currentTask.context = {};
              currentTask.context.chatMessages = state.messages;
              if (state.model) currentTask.context.model = state.model;
              this.store.saveTask(currentTask);
            }
            this.broadcast({ type: 'agent:chat_update', data: state });
          },
          onFinished: (error) => {
            serverLogger.info(`[AgentChat] 对话处理轮次完成: ${error || '成功'}`, undefined, { taskId });
          },
        });

        return this.sendJson(res, 200, { success: true, message: 'Agent session resumed and running', active: true }, reqMeta);
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

      // Task custom retry: /api/tasks/:id/custom-retry
      const taskCustomRetryMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/custom-retry$/);
      if (taskCustomRetryMatch && method === 'POST') {
        const taskId = taskCustomRetryMatch[1];
        const body = await this.parseJsonBody(req);
        const { selectedNodeIds, fromNodeId } = body;
        serverLogger.info(
          `[Tasks:CustomRetry] 接收到流水线定制重试指令: ${taskId}`,
          { selectedNodeIds, fromNodeId },
          { taskId }
        );
        try {
          const task = await this.engine.customRetryTask(taskId, {
            selectedNodeIds: Array.isArray(selectedNodeIds) ? selectedNodeIds : [],
            fromNodeId,
          });
          return this.sendJson(res, 200, task, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[Tasks:CustomRetry] 定制重试失败: ${err.message}`, err, { taskId });
          return this.sendJson(res, 400, { error: err.message }, reqMeta);
        }
      }

      // Task diff: /api/tasks/:id/diff
      const taskDiffMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/diff$/);
      if (taskDiffMatch && method === 'GET') {
        const taskId = taskDiffMatch[1];
        const task = this.store.getTask(taskId);
        if (!task || !task.context?.worktree?.worktreeDir) {
          return this.sendJson(
            res,
            200,
            {
              hasWorktree: false,
              summary: { filesChanged: 0, insertions: 0, deletions: 0, rawStat: '' },
              files: [],
            },
            reqMeta
          );
        }

        try {
          const wt = task.context.worktree;
          const diffResult = WorktreeManager.getInstance().getWorktreeDiffDetail(
            wt.worktreeDir,
            wt.baseBranch
          );
          return this.sendJson(res, 200, diffResult, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[Tasks:Diff] 获取 Diff 失败: ${err.message}`, err, { taskId });
          return this.sendJson(res, 500, { error: err.message }, reqMeta);
        }
      }

      // Sandbox status: /api/tasks/:id/sandbox/status
      const taskSandboxStatusMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/sandbox\/status$/);
      if (taskSandboxStatusMatch && method === 'GET') {
        const taskId = taskSandboxStatusMatch[1];
        const task = this.store.getTask(taskId);
        if (!task || !task.context?.worktree) {
          return this.sendJson(res, 200, { status: 'none', message: 'No worktree context' }, reqMeta);
        }
        const port = task.context.worktree.webPort || task.context.worktree.ports?.webPort || 5175;
        const targetUrl = task.context.worktree.targetUrl || `http://localhost:${port}`;
        // 轻量极速端口探针 (<200ms)
        const isRunning = await new Promise<boolean>((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(250);
          socket.once('connect', () => {
            socket.destroy();
            resolve(true);
          });
          socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
          });
          socket.once('error', () => {
            socket.destroy();
            resolve(false);
          });
          socket.connect(port, '127.0.0.1');
        });

        return this.sendJson(
          res,
          200,
          {
            status: isRunning ? 'running' : 'stopped',
            port,
            targetUrl,
            worktreeDir: task.context.worktree.worktreeDir,
            branchName: task.context.worktree.branchName,
          },
          reqMeta
        );
      }

      // Sandbox start: /api/tasks/:id/sandbox/start
      const taskSandboxStartMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/sandbox\/start$/);
      if (taskSandboxStartMatch && method === 'POST') {
        const taskId = taskSandboxStartMatch[1];
        const task = this.store.getTask(taskId);
        if (!task || !task.context?.worktree) {
          return this.sendJson(res, 400, { error: '未找到任务或沙箱工作区' }, reqMeta);
        }
        const worktreeDir = task.context.worktree.worktreeDir;
        if (!fs.existsSync(worktreeDir)) {
          return this.sendJson(res, 400, { error: `沙箱工作区目录不存在: ${worktreeDir}` }, reqMeta);
        }
        const port = task.context.worktree.webPort || task.context.worktree.ports?.webPort || 5175;

        // 1. 安全清理属于当前任务工作区的残留旧进程，不影响其他并行任务沙箱
        TaskProcessManager.stopAll(taskId);
        WorktreeManager.getInstance().killPortIfBusy(port, {
          allowWorktreeDir: worktreeDir,
          forTaskId: taskId,
        });

        // 2. 动态获取命令与配置：优先从流水线 env-prepare 编排节点提取
        const ports = {
          webPort: port,
          ...(task.context.worktree.ports || {}),
        };
        const wf = this.store.getWorkflow(task.workflowId);
        const envNode = wf?.nodes.find((n) => n.type === 'env-prepare');

        let cmd = '';
        if (envNode?.config?.command) {
          cmd = interpolateString(envNode.config.command, {
            task,
            ports,
          });
        } else {
          cmd = `pnpm --filter @openloop/desktop dev --port ${port} --strictPort --host 0.0.0.0`;
          serverLogger.warn(`[Sandbox:Start] 任务 ${taskId} 工作流未声明 env-prepare 节点命令，回退默认命令: ${cmd}`);
        }

        // 3. 探活地址与超时时间优先采用编排配置
        let targetUrl = task.context.worktree.targetUrl || `http://localhost:${port}`;
        if (envNode?.config?.healthUrl) {
          targetUrl = interpolateString(envNode.config.healthUrl, {
            task,
            ports,
          });
        }
        const warmupTimeoutMs = envNode?.config?.warmupTimeoutMs || 20000;

        serverLogger.info(`[Sandbox:Start] 为任务 ${taskId} 启动靶机服务: ${cmd} (目录: ${worktreeDir}, 探活: ${targetUrl})`);

        const currentCorePort = String(
          task.context.worktree.corePort || this.port || process.env.OPENLOOP_PORT || '19888'
        );

        const isUnix = process.platform !== 'win32';
        const child = spawn(cmd, {
          cwd: worktreeDir,
          shell: true,
          detached: isUnix,
          env: {
            ...process.env,
            PORT: String(port),
            WEB_PORT: String(port),
            VITE_CORE_PORT: currentCorePort,
          },
          stdio: 'pipe',
        });

        TaskProcessManager.getInstance().register(taskId, child, {
          name: 'sandbox-dev-server',
          port,
        });

        child.stdout?.on('data', (d) => {
          this.engine.log(taskId, 'node_env_prep', 'stdout', d.toString().trimEnd());
        });
        child.stderr?.on('data', (d) => {
          this.engine.log(taskId, 'node_env_prep', 'stderr', d.toString().trimEnd());
        });

        // 4. 探活等待就绪
        const isReady = await WorktreeManager.getInstance().waitForHttpReady(targetUrl, warmupTimeoutMs);
        const separator = targetUrl.includes('?') ? '&' : '?';
        const browserTargetUrl = targetUrl.includes('corePort=')
          ? targetUrl
          : `${targetUrl}${separator}corePort=${currentCorePort}`;

        if (isReady) {
          serverLogger.info(`[Sandbox:Start] ✔ 任务 ${taskId} 靶机服务已就绪 (${browserTargetUrl})`);
          return this.sendJson(
            res,
            200,
            { success: true, status: 'running', port, targetUrl: browserTargetUrl },
            reqMeta
          );
        } else {
          serverLogger.warn(`[Sandbox:Start] 任务 ${taskId} 靶机启动超时 (${browserTargetUrl})`);
          return this.sendJson(
            res,
            200,
            { success: false, status: 'starting', port, targetUrl: browserTargetUrl, message: '靶机启动中，探活尚在等待中' },
            reqMeta
          );
        }
      }

      // Sandbox stop: /api/tasks/:id/sandbox/stop
      const taskSandboxStopMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/sandbox\/stop$/);
      if (taskSandboxStopMatch && method === 'POST') {
        const taskId = taskSandboxStopMatch[1];
        const task = this.store.getTask(taskId);
        serverLogger.info(`[Sandbox:Stop] 收到任务 ${taskId} 沙箱靶机关停指令`);
        TaskProcessManager.stopAll(taskId);
        if (task?.context?.worktree?.webPort) {
          WorktreeManager.getInstance().killPortIfBusy(task.context.worktree.webPort);
        }
        WorktreeManager.unregisterTaskPorts(taskId);
        return this.sendJson(res, 200, { success: true, status: 'stopped' }, reqMeta);
      }

      // Sandbox cleanup all: /api/sandbox/cleanup-all
      if (pathname === '/api/sandbox/cleanup-all' && method === 'POST') {
        serverLogger.info(`[Sandbox:CleanupAll] 收到全局沙箱清理指令，清空所有靶机进程与端口占用`);
        const allTasks = this.store.getTasks();
        for (const t of allTasks) {
          TaskProcessManager.stopAll(t.id);
          if (t.context?.worktree?.webPort) {
            WorktreeManager.getInstance().killPortIfBusy(t.context.worktree.webPort);
          }
          WorktreeManager.unregisterTaskPorts(t.id);
        }
        for (const p of WorktreeManager.getInstance().getBusyOrReservedPorts()) {
          WorktreeManager.getInstance().killPortIfBusy(p);
        }
        return this.sendJson(res, 200, { success: true, message: '全局沙箱与端口已全部清空' }, reqMeta);
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
        const previous = this.store.getSettings();
        const updated = this.store.updateSettings(body);
        applyQaModelEnv(updated.qaAutomation);
        this.broadcast({ type: 'settings:update', data: updated });

        // 仅有模型 / 思考强度变化时，才同步到已活跃的 Agent 会话（热切换，不重启进程）
        const modelChanged = (previous.defaultModel || '') !== (updated.defaultModel || '');
        const thinkingChanged = (previous.reasoningLevel || '') !== (updated.reasoningLevel || '');
        let runtime: RuntimeSettingsApplySummary | undefined;
        if (modelChanged || thinkingChanged) {
          runtime = await PiRpcSessionManager.getInstance().applyRuntimeSettings({
            ...(modelChanged ? { model: updated.defaultModel || '' } : {}),
            ...(thinkingChanged ? { thinking: updated.reasoningLevel || '' } : {}),
          });
          serverLogger.info(`[Settings:Runtime] 已同步进行中会话`, { ...runtime });
        }

        return this.sendJson(res, 200, { ...updated, runtime }, reqMeta);
      }

      // AI QA Plan Generation: /api/qa/generate-plan
      if (pathname === '/api/qa/generate-plan' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const title = (body.title || '').trim();
        const description = (body.description || '').trim();
        const workspace = body.workspace ? String(body.workspace).trim() : undefined;

        if (!title) {
          return this.sendJson(res, 400, { error: '任务标题不可为空' }, reqMeta);
        }

        serverLogger.info(`[QA:GeneratePlan] 接收到 AI 验收用例规划请求: "${title}"`, { description, workspace }, reqMeta);

        const settings = this.store.getSettings();
        const repoRoot = findRepoRoot(workspace || process.cwd());
        const cwd = workspace || repoRoot;

        const rolePromptTemplate = getEffectivePrompt('qaPlanner', settings.prompts);
        const rolePrompt = renderPromptTemplate(rolePromptTemplate, {
          task: {
            title,
            description: description || '无',
          },
        });

        const tempTaskId = `qa_plan_modal_${Date.now()}`;
        const sessionId = `session_qa_plan_${Date.now()}`;

        try {
          const steps = await new Promise<string[]>((resolve, reject) => {
            const timeoutTimer = setTimeout(() => {
              cleanup();
              reject(new Error('AI 生成用例超时'));
            }, 30000);

            const cleanup = () => {
              clearTimeout(timeoutTimer);
              PiRpcSessionManager.getInstance().removeSession(tempTaskId);
            };

            const session = PiRpcSessionManager.getInstance().createSession({
              taskId: tempTaskId,
              taskTitle: `[QA 快速规划] ${title}`,
              sessionId,
              agentName: '资深 QA 工程师',
              model: settings.defaultModel,
              thinking: 'off',
              cwd,
              initialPrompt: rolePrompt,
              onFinished: (error) => {
                cleanup();
                if (error) {
                  return reject(new Error(error));
                }
                try {
                  const state = session.getState();
                  const lastMsg = [...state.messages].reverse().find((m) => m.role === 'assistant');
                  const content = lastMsg?.content || '';
                  const match = content.match(/```qa-plan\s*([\s\S]*?)\s*```/i);
                  let parsedSteps: string[] = [];
                  if (match && match[1]) {
                    parsedSteps = match[1]
                      .split('\n')
                      .map((l) => l.replace(/^[-*•\d.]+\s*/, '').trim())
                      .filter((l) => Boolean(l) && !l.startsWith('//') && !l.startsWith('#'));
                  }
                  parsedSteps = parsedSteps
                    .filter((s) => !s.includes('模拟') && !s.includes('等待后台推送'))
                    .slice(0, 4);

                  if (parsedSteps.length === 0) {
                    parsedSteps = [
                      `打开并进入相关功能界面`,
                      `触发需求核心操作并检查响应`,
                      `校验界面数据与状态更新正常`,
                      `校验页面渲染正常无报错`,
                    ];
                  }
                  resolve(parsedSteps);
                } catch (e: any) {
                  reject(e);
                }
              },
            });
          });

          return this.sendJson(res, 200, {
            success: true,
            steps,
            text: steps.join('\n'),
          }, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[QA:GeneratePlan] 生成失败: ${err.message}`, err, reqMeta);
          const fallbackSteps = [
            `进入与「${title.slice(0, 15)}」相关的界面`,
            `执行核心功能操作`,
            `检查界面按预期更新渲染`,
            `校验页面无报错与异常提示`,
          ];
          return this.sendJson(res, 200, {
            success: true,
            steps: fallbackSteps,
            text: fallbackSteps.join('\n'),
            fallback: true,
          }, reqMeta);
        }
      }

      // 智能流水线推荐: POST /api/recommend-workflow
      if (pathname === '/api/recommend-workflow' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const title = (body.title || '').trim();
        const description = (body.description || '').trim();
        const workspace = (body.workspace || '').trim();

        const workflows = this.store.getWorkflows();
        const recommendations = WorkflowRecommender.recommend(workflows, { title, workspace });
        return this.sendJson(res, 200, {
          success: true,
          recommendations,
          topRecommendation: recommendations[0] || null,
        }, reqMeta);
      }

      // QA Automation Suites: /api/qa/suites
      if (pathname === '/api/qa/suites' && method === 'GET') {
        const suites = this.store.getQaSuites();
        return this.sendJson(res, 200, suites, reqMeta);
      }

      // Android 设备探测与管理 API
      if (pathname === '/api/qa/devices/android' && method === 'GET') {
        const devices = await AndroidDeviceManager.getDevices();
        return this.sendJson(res, 200, devices, reqMeta);
      }

      if (pathname === '/api/qa/devices/android/mirror' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const mirrorRes = await AndroidDeviceManager.openMirror(body.serial || undefined);
        return this.sendJson(res, mirrorRes.success ? 200 : 400, mirrorRes, reqMeta);
      }

      if (pathname === '/api/qa/devices/android/current-app' && method === 'GET') {
        const serial = parsedUrl.searchParams.get('serial') || undefined;
        const app = await AndroidDeviceManager.getCurrentForegroundApp(serial);
        return this.sendJson(res, 200, app || { packageName: '' }, reqMeta);
      }

      if (pathname === '/api/qa/devices/android/connect' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const resConn = await AndroidDeviceManager.connectWifiDevice(body.address || body.ipPort || '');
        return this.sendJson(res, resConn.success ? 200 : 400, resConn, reqMeta);
      }

      if (pathname === '/api/qa/devices/android/disconnect' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const resDis = await AndroidDeviceManager.disconnectWifiDevice(body.address || body.ipPort || '');
        return this.sendJson(res, resDis.success ? 200 : 400, resDis, reqMeta);
      }

      if (pathname === '/api/qa/devices/ios' && method === 'GET') {
        const endpoint = parsedUrl.searchParams.get('endpoint') || undefined;
        const snapshot = await IosDeviceManager.getSnapshot(endpoint);
        return this.sendJson(res, 200, snapshot, reqMeta);
      }

      if (pathname === '/api/qa/suites' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        const target = body.targetUrl || body.appPackage;
        if (!body.name || !target) {
          return this.sendJson(res, 400, { error: 'name and targetUrl (or appPackage) are required' }, reqMeta);
        }
        if (body.platform !== undefined && !isQaPlatform(body.platform)) {
          return this.sendJson(res, 400, { error: `不支持的测试平台: ${body.platform}` }, reqMeta);
        }
        const suite: QaSuite = {
          id: body.id || `suite_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: body.name,
          description: body.description,
          platform: body.platform || 'web',
          targetUrl: body.targetUrl || body.appPackage || '',
          appPackage: body.appPackage,
          deviceSerial: body.deviceSerial,
          wdaEndpoint: body.wdaEndpoint,
          viewport: body.viewport,
          steps: body.steps || [],
          tags: body.tags || [],
          createdAt: body.createdAt || Date.now(),
          updatedAt: Date.now(),
          lastRunStatus: body.lastRunStatus || 'untested',
        };
        serverLogger.info(`[QA:SaveSuite] 保存测试套件: ${suite.name} (ID: ${suite.id}, 平台: ${suite.platform})`);
        const saved = this.store.saveQaSuite(suite);
        return this.sendJson(res, 200, saved, reqMeta);
      }

      if (pathname.startsWith('/api/qa/suites/') && method === 'DELETE') {
        const id = decodeURIComponent(pathname.replace('/api/qa/suites/', ''));
        serverLogger.info(`[QA:DeleteSuite] 删除测试套件: ${id}`);
        const ok = this.store.deleteQaSuite(id);
        return this.sendJson(res, 200, { success: ok, id }, reqMeta);
      }

      // QA Automation Runs: /api/qa/runs
      if (pathname === '/api/qa/runs' && method === 'GET') {
        const suiteId = parsedUrl.searchParams.get('suiteId') || undefined;
        const limitStr = parsedUrl.searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : 30;
        const runs = this.store.getQaRuns(suiteId, undefined, limit);
        return this.sendJson(res, 200, runs, reqMeta);
      }

      const qaRunMatch = pathname.match(/^\/api\/qa\/runs\/([a-zA-Z0-9_-]+)$/);
      if (qaRunMatch && method === 'GET') {
        const runId = qaRunMatch[1];
        const record = this.store.getQaRunById(runId);
        if (!record) return this.sendJson(res, 404, { error: 'QA Run Not Found' }, reqMeta);
        return this.sendJson(res, 200, record, reqMeta);
      }

      if (pathname.startsWith('/api/qa/runs/') && method === 'DELETE') {
        const runId = decodeURIComponent(pathname.replace('/api/qa/runs/', ''));
        serverLogger.info(`[QA:DeleteRun] 删除 QA 测试记录及截图产物: ${runId}`);
        const ok = this.store.deleteQaRun(runId);
        if (ok) {
          this.broadcast({ type: 'qa:run_deleted', data: { id: runId } });
        }
        return this.sendJson(res, 200, { success: ok, id: runId }, reqMeta);
      }

      if (pathname === '/api/qa/runs' && method === 'DELETE') {
        let body: any = {};
        try {
          body = await this.parseJsonBody(req);
        } catch {}
        const suiteId = body?.suiteId || parsedUrl.searchParams.get('suiteId') || undefined;
        const olderThanDaysStr = body?.olderThanDays ?? parsedUrl.searchParams.get('olderThanDays');
        const keepLatestStr = body?.keepLatestPerSuite ?? parsedUrl.searchParams.get('keepLatestPerSuite');
        const olderThanDays = olderThanDaysStr !== undefined ? parseInt(String(olderThanDaysStr), 10) : undefined;
        const keepLatestPerSuite = keepLatestStr !== undefined ? parseInt(String(keepLatestStr), 10) : undefined;
        const runIds = Array.isArray(body?.runIds) ? body.runIds : undefined;

        serverLogger.info(`[QA:BatchDeleteRuns] 批量清理 QA 测试记录`, { suiteId, olderThanDays, keepLatestPerSuite, runIdsCount: runIds?.length });
        const deletedCount = this.store.deleteQaRuns({ suiteId, olderThanDays, keepLatestPerSuite, runIds });
        this.broadcast({ type: 'qa:runs_cleared', data: { suiteId, deletedCount, runIds } });
        return this.sendJson(res, 200, { success: true, deletedCount }, reqMeta);
      }

      // Execute QA Run: /api/qa/run
      if (pathname === '/api/qa/run' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        let suite = body.suiteId ? this.store.getQaSuiteById(body.suiteId) : null;
        if (!suite && (body.targetUrl || body.appPackage) && body.steps) {
          // 允许临时传入内联用例
          suite = {
            id: `temp_${Date.now()}`,
            name: body.name || '临时执行用例',
            platform: body.platform || 'web',
            targetUrl: body.targetUrl || body.appPackage || '',
            appPackage: body.appPackage,
            deviceSerial: body.deviceSerial,
            wdaEndpoint: body.wdaEndpoint,
            steps: body.steps,
            viewport: body.viewport,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        }
        if (!suite) {
          return this.sendJson(res, 400, { error: 'suiteId or inline suite definition is required' }, reqMeta);
        }

        const runner = new MidsceneRunner({
          artifactBaseDir: path.join(this.store.getDataDir(), 'artifacts'),
          serverBaseUrl: `http://${this.host}:${this.port}`,
          platform: suite.platform,
          onStepStart: (stepIndex, step) => {
            this.broadcast({
              type: 'qa:step_start',
              data: { suiteId: suite.id, stepIndex, step },
            });
          },
          onStepFinish: (stepIndex, record) => {
            this.broadcast({
              type: 'qa:step_finish',
              data: { suiteId: suite.id, stepIndex, record },
            });
          },
          onLog: (msg) => {
            serverLogger.info(`[QA:LiveLog] ${msg}`);
          },
        });

        const record = await runner.runSuite(suite, body.taskId);
        this.store.saveQaRun(record);
        this.broadcast({
          type: 'qa:run_completed',
          data: record,
        });

        return this.sendJson(res, 200, record, reqMeta);
      }

      // Resume terminal: /api/tasks/:id/resume-terminal
      if (pathname.match(/^\/api\/tasks\/[^/]+\/resume-terminal$/) && method === 'POST') {
        const taskId = pathname.split('/')[3];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task Not Found' }, reqMeta);

        const settings = this.store.getSettings() || {};
        const sessionId =
          task.context?.sessionId ||
          task.context?.piSessionId ||
          `session_${task.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const workspace = task.context?.worktree?.worktreeDir || task.workspace || process.cwd();
        const provider = getAgentProviderMeta(
          task.context?.agentProvider || settings.agentProvider
        ).id;

        const cmd = task.context?.resumeCommand || resolveResumeCommand(provider, sessionId);

        serverLogger.info(
          `[Tasks:ResumeTerminal] 唤起外部终端接管交互: ${taskId}, Session: ${sessionId}`,
          { command: cmd, workspace },
          { taskId }
        );

        if (process.platform === 'darwin') {
          const terminalScript = workspace ? `cd "${workspace.replace(/"/g, '\\"')}" && ${cmd}` : cmd;
          const escaped = terminalScript.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          spawn('osascript', ['-e', `tell application "Terminal" to do script "${escaped}"`, '-e', 'tell application "Terminal" to activate'], { detached: true });
        }

        return this.sendJson(res, 200, { success: true, command: cmd, sessionId }, reqMeta);
      }

      // Automations: /api/automations
      if (pathname === '/api/automations' && method === 'GET') {
        const tasks = this.store.getAutomationTasks();
        return this.sendJson(res, 200, tasks, reqMeta);
      }

      if (pathname === '/api/automations' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        if (!body.name) {
          return this.sendJson(res, 400, { error: 'name is required' }, reqMeta);
        }

        const now = Date.now();
        const id = body.id || `auto_${now}_${Math.random().toString(36).slice(2, 6)}`;
        const existing = this.store.getAutomationTask(id);

        const task: AutomationTask = {
          id,
          name: String(body.name).trim(),
          description: body.description ? String(body.description).trim() : undefined,
          enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
          intervalSec: Number(body.intervalSec) || 60,
          sourceType: body.sourceType || 'cli_script',
          sourceConfig: body.sourceConfig || {},
          actionType: body.actionType || 'create_task',
          actionConfig: body.actionConfig || {},
          lastRunAt: existing?.lastRunAt,
          lastRunStatus: existing?.lastRunStatus,
          lastRunDurationMs: existing?.lastRunDurationMs,
          lastRunMessage: existing?.lastRunMessage,
          lastRunOutput: existing?.lastRunOutput,
          totalRuns: existing?.totalRuns || 0,
          successRuns: existing?.successRuns || 0,
          failedRuns: existing?.failedRuns || 0,
          createdTaskIds: existing?.createdTaskIds || [],
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };

        const saved = this.store.saveAutomationTask(task);
        this.scheduler.onTaskSaved(saved);
        this.broadcast({ type: 'automation:update', data: saved });
        return this.sendJson(res, 200, saved, reqMeta);
      }

      if (pathname.startsWith('/api/automations/') && pathname.endsWith('/trigger') && method === 'POST') {
        const id = pathname.replace('/api/automations/', '').replace('/trigger', '');
        serverLogger.info(`[API] 手动触发自动化任务: ${id}`);
        try {
          const result = await this.scheduler.executeTask(id, { manual: true });
          return this.sendJson(res, 200, result, reqMeta);
        } catch (err: any) {
          return this.sendJson(res, 500, { success: false, error: err.message }, reqMeta);
        }
      }

      if (pathname.startsWith('/api/automations/') && pathname.endsWith('/toggle') && method === 'POST') {
        const id = pathname.replace('/api/automations/', '').replace('/toggle', '');
        const body = await this.parseJsonBody(req);
        const task = this.store.getAutomationTask(id);
        if (!task) {
          return this.sendJson(res, 404, { error: 'Automation task not found' }, reqMeta);
        }
        task.enabled = body.enabled !== undefined ? Boolean(body.enabled) : !task.enabled;
        task.updatedAt = Date.now();
        const saved = this.store.saveAutomationTask(task);
        this.scheduler.onTaskSaved(saved);
        this.broadcast({ type: 'automation:update', data: saved });
        return this.sendJson(res, 200, saved, reqMeta);
      }

      if (pathname.startsWith('/api/automations/') && pathname.endsWith('/logs') && method === 'GET') {
        const id = pathname.replace('/api/automations/', '').replace('/logs', '');
        const logs = this.store.getAutomationLogs(id, 50);
        return this.sendJson(res, 200, logs, reqMeta);
      }

      if (pathname.startsWith('/api/automations/') && method === 'GET') {
        const id = pathname.replace('/api/automations/', '');
        const task = this.store.getAutomationTask(id);
        if (!task) {
          return this.sendJson(res, 404, { error: 'Automation task not found' }, reqMeta);
        }
        return this.sendJson(res, 200, task, reqMeta);
      }

      if (pathname.startsWith('/api/automations/') && method === 'DELETE') {
        const id = pathname.replace('/api/automations/', '');
        this.scheduler.onTaskDeleted(id);
        const deleted = this.store.deleteAutomationTask(id);
        this.broadcast({ type: 'automation:delete', data: { id } });
        return this.sendJson(res, 200, { success: deleted }, reqMeta);
      }

      // Automation Logs Deletion: DELETE /api/automations/logs
      if (pathname === '/api/automations/logs' && method === 'DELETE') {
        const automationId = parsedUrl.searchParams.get('automationId') || undefined;
        const olderThanDaysStr = parsedUrl.searchParams.get('olderThanDays');
        const olderThanDays = olderThanDaysStr ? parseInt(olderThanDaysStr, 10) : 0;

        serverLogger.info(`[Automation:ClearLogs] 清理自动化日志`, { automationId, olderThanDays });
        const deletedCount = this.store.deleteOldAutomationLogs(olderThanDays, automationId);
        this.broadcast({ type: 'automation:logs_cleared', data: { automationId, deletedCount } });
        return this.sendJson(res, 200, { success: true, deletedCount }, reqMeta);
      }

      // Storage & Garbage Collection: /api/storage/stats & /api/storage/clean
      if (pathname === '/api/storage/stats' && method === 'GET') {
        const stats = this.store.getStorageStats();
        return this.sendJson(res, 200, stats, reqMeta);
      }

      if (pathname === '/api/storage/clean' && method === 'POST') {
        const body = await this.parseJsonBody(req);
        serverLogger.info('[Storage:Clean] 收到存储空间优化清理指令', body);
        const result = this.store.cleanStorage(body);
        this.broadcast({ type: 'storage:cleaned', data: result });
        return this.sendJson(res, 200, result, reqMeta);
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
