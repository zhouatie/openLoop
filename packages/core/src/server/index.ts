import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { spawn, exec } from 'child_process';
import util from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import { Store, toTaskSummary } from '../store';
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
import { PiRpcSessionManager, PIPELINE_DONE_MARKER } from '../agent/pi-rpc-session';
import { sanitizeChatMessages } from '../agent/agent-format';
import { piSessionIndex } from '../agent/session-index';
import {
  DEFAULT_PI_EXTENSION_PACKAGES,
  getEnabledPiExtensions,
  listInstalledPiExtensions,
  setEnabledPiExtensions,
} from '../agent/pi-extensions';
import { agentSessionHost, GLOBAL_AGENT_PREFIX, type AgentPermissionPreset } from '../agent/agent-session-host';
import { agentSessionMeta, moveSessionFileToTrash } from '../agent/session-meta';
import { resolveSessionTitle } from '../agent/title-text';
import { createDirectory, listDirectory, readTextFile, statFile } from '../agent/fs-browser';
import { listOpenInAppTargets, openInApp } from '../system/open-in-app';
import { terminalHost } from '../agent/terminal-host';
import { WorkflowCopilotManager } from '../agent/workflow-copilot';
import { MidsceneRunner } from '../qa/midscene-runner';
import { AndroidDeviceManager } from '../qa/android-device-manager';
import { IosDeviceManager } from '../qa/ios-device-manager';
import { DeviceLeasePool } from '../qa/device-lease-pool';
import { isQaPlatform } from '../qa/qa-driver';
import { applyQaModelEnv } from '../qa/model-env';
import { configureQaRuntimePaths } from '../qa/runtime-paths';
import { guessImageMimeType } from '../constants/media-mime';
import { resolveArtifactPath } from '../qa/artifact-paths';
import { WorktreeManager, TaskProcessManager, findRepoRoot } from '../worktree/worktree-manager';
import { interpolateString } from '../executors';
import { getAgentProviderMeta, resolveResumeCommand } from '../constants/agent-providers';
import { getEffectivePrompt, renderPromptTemplate } from '../constants/prompts';
import { AutomationScheduler } from '../automation/automation-scheduler';
import { WorkflowRecommender } from '../engine/workflow-recommender';
import { SubtaskPlanner } from '../agent/subtask-planner';
import {
  configureTurnChanges,
  forgetSessionChanges,
  readChangeDiff,
  sweepTurnChanges,
} from '../agent/turn-changes';

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
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
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
  private unsubscribeDeviceLeases?: () => void;
  private workspaceFilesCache = new Map<string, { files: string[]; timestamp: number }>();
  private skillsCache: { data: { commands: any[]; skills: any[] }; timestamp: number } | null = null;

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

  /**
   * 流水线 agent 节点跑的就是同一份 pi 会话，事件再按 `agent_<sessionId>` 路由一份，
   * 让「智能体开发」面板打开这个会话时也能看到运行状态与流式输出
   */
  private globalAgentAlias(taskId: string | undefined): string | undefined {
    if (!taskId) return undefined;
    const session = PiRpcSessionManager.getInstance().getSession(taskId);
    return session ? `${GLOBAL_AGENT_PREFIX}${session.sessionId}` : undefined;
  }

  private setupEngineEvents() {
    this.engine.on('task:update', (task: Task) => {
      this.broadcastTaskUpdate(task);
    });

    this.engine.on('node:status', (data) => {
      this.broadcast({ type: 'node:status', data });
    });

    this.engine.on('log:new', (log) => {
      this.broadcast({ type: 'log:new', data: log });
    });

    this.engine.on('agent:chat_update', (data) => {
      this.broadcast({ type: 'agent:chat_update', data });
      const alias = this.globalAgentAlias(data.taskId);
      if (alias) this.broadcast({ type: 'agent:chat_update', data: { ...data, taskId: alias } });
    });

    // Agent 会话增量事件：流式期间只推变化部分，快照仍走 agent:chat_update
    this.engine.on('agent:stream', (event) => {
      this.broadcast({ type: 'agent:stream', data: event });
      const alias = this.globalAgentAlias(event.taskId);
      if (alias) this.broadcast({ type: 'agent:stream', data: { ...event, taskId: alias } });
    });

    // 不绑定任务的全局 Agent 会话（侧边栏「智能体开发」）：事件同样并入同一条推流通道
    agentSessionHost.onStream((event) => {
      this.broadcast({ type: 'agent:stream', data: event });
    });
    agentSessionHost.on('update', (state) => {
      this.broadcast({ type: 'agent:chat_update', data: state });
    });

    // 扩展 UI 请求（审批 / 选择卡片）
    agentSessionHost.onUiRequest((request) => {
      this.broadcast({ type: 'agent:ui_request', data: request });
    });
    // 任务会话（流水线 agent 节点）的审批卡走同一条推流通道
    PiRpcSessionManager.getInstance().on('uiRequest', (request) => {
      this.broadcast({ type: 'agent:ui_request', data: request });
    });

    // 终端输出推流
    terminalHost.on('data', ({ id, data }) => {
      this.broadcast({ type: 'agent:terminal', data: { id, data } });
    });
    terminalHost.on('exit', ({ id, code }) => {
      this.broadcast({ type: 'agent:terminal', data: { id, exited: true, code } });
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
      this.broadcastTaskNew(task);
    });

    // 设备租约队列推流：多任务争用同一 iOS 设备时，界面实时展示占用者与排队位次
    this.unsubscribeDeviceLeases = DeviceLeasePool.subscribe(() => {
      this.broadcast({ type: 'qa:device_leases', data: { leases: DeviceLeasePool.getSnapshots() } });
    });
  }

  // 任务事件按摘要推流：剔除超大会话与 Diff 明细，避免每条实时事件都搬运数 MB 数据
  private broadcastTaskUpdate(task: Task | { id: string; deleted: true }) {
    this.broadcast({ type: 'task:update', data: toTaskSummary(task as Task) });
  }

  private broadcastTaskNew(task: Task) {
    this.broadcast({ type: 'task:new', data: toTaskSummary(task) });
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
            // 终端按键逐字上报，不逐条打日志，避免刷穿控制台
            if (data.type !== 'terminal:input') {
              serverLogger.debug(`[WS:Message] 收到客户端消息: ${data.type}`);
            }
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
      // 会话进程的扩展装载名单：只装设置页选中的包，避免每个节点加载全部全局扩展
      setEnabledPiExtensions(this.store.getSettings()?.piExtensions);
      serverLogger.info(`[PiExtensions] 会话进程装载扩展: ${getEnabledPiExtensions().join(', ') || '(仅 openLoop 桥接)'}`);
      // 把 Midscene 调试产物收拢到数据目录，避免污染工作目录并可被存储清理回收
      configureQaRuntimePaths(this.store.getDataDir());
      // 轮内改动捕获：内容落在 <数据目录>/changes，启动时清掉上次进程残留的会话目录
      configureTurnChanges(this.store.getDataDir());
      sweepTurnChanges();

      this.httpServer.listen(this.port, this.host, () => {
        serverLogger.info(`[openLoop Core] 服务就绪，监听地址: http://${this.host}:${this.port}`);
        console.log(`[openLoop Core] Server listening at http://${this.host}:${this.port}`);

        // 监听成功后才执行一次自愈：清理上次崩溃/重启遗留的 running 任务。
        // 端口被占用时本进程会启动失败，此时必须不碰数据库，否则会误杀同库中真实运行中的任务。
        try {
          const recovered = this.store.recoverOrphanRunningTasks();
          if (recovered > 0) {
            serverLogger.warn(`[Store:Recovery] 已恢复 ${recovered} 个因上次服务中断而残留的任务`);
          }
        } catch (err: any) {
          serverLogger.warn(`[Store:Recovery] 孤立任务恢复失败: ${err?.message || err}`);
        }

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
    this.unsubscribeDeviceLeases?.();
    terminalHost.closeAll();

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

  private async getWorkspaceFiles(targetDir: string): Promise<string[]> {
    const now = Date.now();
    const cached = this.workspaceFilesCache.get(targetDir);
    if (cached && now - cached.timestamp < 15000) {
      return cached.files;
    }

    try {
      const gitFiles = await new Promise<string[]>((resolve, reject) => {
        exec(
          'git ls-files --cached --others --exclude-standard',
          { cwd: targetDir, maxBuffer: 10 * 1024 * 1024, timeout: 3000 },
          (error, stdout) => {
            if (error) return reject(error);
            const list = stdout
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            resolve(list);
          }
        );
      });

      if (Array.isArray(gitFiles) && gitFiles.length > 0) {
        this.workspaceFilesCache.set(targetDir, { files: gitFiles, timestamp: now });
        return gitFiles;
      }
    } catch {
      // 降级为快速目录遍历
    }

    const files: string[] = [];
    const maxFiles = 2500;
    const ignoredDirs = new Set([
      '.git',
      'node_modules',
      'dist',
      'build',
      'out',
      '.worktrees',
      '.next',
      '.turbo',
      'coverage',
      '.svn',
      '.hg',
      'target',
      'vendor',
      '.pi',
      '.agents',
    ]);

    const scan = (currentDir: string, relPrefix = '') => {
      if (files.length >= maxFiles) return;
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (files.length >= maxFiles) break;
          const name = entry.name;
          if (entry.isDirectory()) {
            if (ignoredDirs.has(name) || name.startsWith('.')) continue;
            scan(path.join(currentDir, name), relPrefix ? `${relPrefix}/${name}` : name);
          } else if (entry.isFile()) {
            files.push(relPrefix ? `${relPrefix}/${name}` : name);
          }
        }
      } catch {}
    };

    scan(targetDir);
    this.workspaceFilesCache.set(targetDir, { files, timestamp: now });
    return files;
  }

  private async getAgentCommandsAndSkills(targetDir?: string): Promise<{ commands: any[]; skills: any[] }> {
    const now = Date.now();
    if (this.skillsCache && now - this.skillsCache.timestamp < 30000) {
      return this.skillsCache.data;
    }

    const commands = [
      {
        name: '/clear',
        label: '清空会话',
        description: '清空当前任务的 Agent 对话与历史记录',
        type: 'command',
        action: 'clear',
      },
      {
        name: '/plan',
        label: '工序规划',
        description: '梳理任务目标并生成可行的分步执行计划',
        type: 'command',
        template: '/plan 请分析当前任务需求，制定极简可行的分步执行计划',
      },
      {
        name: '/review',
        label: '代码审查',
        description: '审查当前工作区已修改的代码改动 (Git Diff)',
        type: 'command',
        template: '/review 请全面审查当前工作区已修改的代码，重点关注正确性、边界情况与潜在缺陷',
      },
      {
        name: '/test',
        label: '运行测试',
        description: '执行自动化测试脚本并分析验收结果',
        type: 'command',
        template: '/test 请运行工程相关测试与验证脚本并汇报结果',
      },
      {
        name: '/fix',
        label: '报错修复',
        description: '针对上一轮错误日志或测试失败原因自动排查并修复',
        type: 'command',
        template: '/fix 请分析上一步的错误信息与堆栈并完成代码修复',
      },
      {
        name: '/pause',
        label: '暂停会话',
        description: '暂停当前正在运行的 Agent 推理与执行',
        type: 'command',
        action: 'pause',
      },
      {
        name: '/resume',
        label: '恢复运行',
        description: '恢复当前已暂停的 Agent 会话继续运行',
        type: 'command',
        action: 'resume',
      },
      {
        name: '/compact',
        label: '提炼记忆',
        description: '压缩长对话并提炼核心上下文决策与关键信息',
        type: 'command',
        template: '/compact 请提炼当前会话的核心上下文和决策记忆',
      },
      {
        name: '/help',
        label: '帮助指南',
        description: '查看常用命令与 Skill 扩展使用指导',
        type: 'command',
        template: '/help 请列出当前可用的指令建议与使用指导',
      },
    ];

    const searchDirs: string[] = [
      path.join(os.homedir(), '.agents', 'skills'),
      path.join(os.homedir(), '.pi', 'agent', 'skills'),
    ];
    if (targetDir) {
      searchDirs.unshift(
        path.join(targetDir, '.agents', 'skills'),
        path.join(targetDir, '.pi', 'skills'),
        path.join(targetDir, 'skills')
      );
    }

    const skillsMap = new Map<string, { name: string; label: string; description: string; type: 'skill'; path: string; template: string }>();

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const subEntries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of subEntries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
          const skillName = entry.name;
          if (skillsMap.has(skillName)) continue;

          const skillPath = path.join(dir, skillName);
          const skillFile = path.join(skillPath, 'SKILL.md');
          if (fs.existsSync(skillFile)) {
            let description = `加载并使用 ${skillName} 扩展技能`;
            try {
              const content = fs.readFileSync(skillFile, 'utf-8');
              const descMatch = content.match(/description:\s*(?:>|\|)?\s*([^\n\r]+(?:\n\s+[^\n\r]+)*)/i);
              if (descMatch && descMatch[1]) {
                description = descMatch[1].replace(/\n\s+/g, ' ').trim().slice(0, 100);
              } else {
                const lines = content.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('---'));
                if (lines.length > 0) {
                  description = lines[0].slice(0, 100);
                }
              }
            } catch {}

            skillsMap.set(skillName, {
              name: `/${skillName}`,
              label: `Skill: ${skillName}`,
              description,
              type: 'skill',
              path: skillFile,
              template: `/${skillName} `,
            });
          }
        }
      } catch {}
    }

    const skills = Array.from(skillsMap.values());
    const result = { commands, skills };
    this.skillsCache = { data: result, timestamp: now };
    return result;
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

    const json = JSON.stringify(data);
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    const req = res.req;
    const acceptEncoding = (req?.headers?.['accept-encoding'] || '') as string;
    if (json.length > 1024 && acceptEncoding.includes('gzip')) {
      const compressed = zlib.gzipSync(Buffer.from(json, 'utf-8'));
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = compressed.length;
      res.writeHead(status, headers);
      res.end(compressed);
      return;
    }

    headers['Content-Length'] = Buffer.byteLength(json);
    res.writeHead(status, headers);
    res.end(json);
  }

  /** 本地图片预览：只放行图片扩展名的绝对路径，用于会话里提到的截图 */
  private serveLocalImage(
    res: http.ServerResponse,
    rawPath: string,
    reqMeta: { method: string; pathname: string; startTime: number }
  ) {
    const targetPath = rawPath.trim();
    const isImage = MIME_TYPES[path.extname(targetPath).toLowerCase()]?.startsWith('image/');
    if (!targetPath || !path.isAbsolute(targetPath) || !isImage) {
      return this.sendJson(res, 400, { error: 'Invalid image path' }, reqMeta);
    }
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      return this.sendJson(res, 404, { error: 'Image Not Found' }, reqMeta);
    }
    res.writeHead(200, {
      'Content-Type': guessImageMimeType(targetPath),
      'Content-Length': fs.statSync(targetPath).size,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    return fs.createReadStream(targetPath).pipe(res);
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

      // 本地图片预览：会话里出现的绝对路径图片（如 /tmp/shot.png）
      if (pathname === '/api/local-image' && method === 'GET') {
        return this.serveLocalImage(res, parsedUrl.searchParams.get('path') || '', reqMeta);
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

      // Agent 会话浏览：pi 把会话存成 JSONL 文件，没有列举接口，这里按目录索引
      if (pathname === '/api/agent/sessions' && method === 'GET') {
        const cwd = parsedUrl.searchParams.get('cwd') || undefined;
        const limit = Number(parsedUrl.searchParams.get('limit') || 0);
        // 先取全量再按 limit 截断，total 才是真实会话总数
        const raw = await piSessionIndex.list({ cwd });
        const projectMeta = agentSessionMeta.listProjects();
        const sessions = raw
          .map((session) => {
            const meta = agentSessionMeta.getSession(session.id);
            const project = projectMeta[session.cwd] || {};
            return {
              ...session,
              // 标题优先级：面板手动重命名 > pi 会话名（任务标题 / 自动命名）> 首条消息兜底
              title: resolveSessionTitle({
                metaTitle: meta.title,
                sessionName: session.sessionName,
                firstUserMessage: session.firstUserMessage,
              }),
              archived: meta.archived === true,
              deleted: meta.deleted === true,
              pinned: meta.pinned === true,
              projectTitle: project.title,
              projectHidden: project.hidden === true,
              projectOrder: project.order,
            };
          })
          .filter((session) => !session.deleted);
        const total = sessions.length;
        const page = limit > 0 ? sessions.slice(0, limit) : sessions;
        return this.sendJson(
          res,
          200,
          { root: piSessionIndex.getRootDir(), total, sessions: page },
          reqMeta
        );
      }

      // 会话全文搜索：必须在 /api/agent/sessions/:id 之前匹配，否则 search 会被当成 id
      if (pathname === '/api/agent/sessions/search' && method === 'GET') {
        const keyword = (parsedUrl.searchParams.get('q') || '').trim();
        const limit = Number(parsedUrl.searchParams.get('limit') || 20);
        if (!keyword) {
          return this.sendJson(res, 200, { query: '', results: [] }, reqMeta);
        }
        const results = await piSessionIndex.searchContent(keyword, { limit });
        return this.sendJson(res, 200, { query: keyword, results }, reqMeta);
      }

      // 读取单个历史会话的消息序列（活动分支）
      const agentSessionMatch = pathname.match(/^\/api\/agent\/sessions\/([^/]+)$/);
      if (agentSessionMatch && method === 'GET') {
        const sessionKey = decodeURIComponent(agentSessionMatch[1]);
        const limit = Number(parsedUrl.searchParams.get('limit') || 0);
        // 进程内刚导航过：盘上文件还停在被放弃的分支，按进程里的叶子读才是当前分支
        const leafId = agentSessionHost.getLeafEntryId(sessionKey);
        const detail = await piSessionIndex.read(sessionKey, { limit, leafId });
        if (!detail) {
          return this.sendJson(res, 404, { error: 'Session Not Found' }, reqMeta);
        }
        return this.sendJson(res, 200, detail, reqMeta);
      }

      // 当前活跃的全局 Agent 会话（用于界面判断哪些会话可实时连接）
      if (pathname === '/api/agent/live' && method === 'GET') {
        return this.sendJson(
          res,
          200,
          {
            sessions: agentSessionHost.listLive(),
            // 流水线 agent 节点也在跑 pi 会话，运行指示要一并统计
            busy: [...agentSessionHost.listBusy(), ...PiRpcSessionManager.getInstance().listBusySessionIds()],
          },
          reqMeta
        );
      }

      // 会话元数据：重命名 / 归档
      const agentMetaMatch = pathname.match(/^\/api\/agent\/sessions\/([^/]+)\/meta$/);
      if (agentMetaMatch && (method === 'PUT' || method === 'POST')) {
        const sessionKey = decodeURIComponent(agentMetaMatch[1]);
        const body = await this.parseJsonBody(req).catch(() => ({}) as any);
        const meta = agentSessionMeta.setSession(sessionKey, {
          title: typeof body?.title === 'string' ? body.title : undefined,
          archived: typeof body?.archived === 'boolean' ? body.archived : undefined,
          pinned: typeof body?.pinned === 'boolean' ? body.pinned : undefined,
          // deleted:false 用于把软删除的会话恢复回来
          deleted: typeof body?.deleted === 'boolean' ? body.deleted : undefined,
        });
        return this.sendJson(res, 200, { sessionId: sessionKey, meta }, reqMeta);
      }

      // 删除会话：默认软删除（列表隐藏），purge=1 时把文件移入回收目录
      const agentDeleteMatch = pathname.match(/^\/api\/agent\/sessions\/([^/]+)$/);
      if (agentDeleteMatch && method === 'DELETE') {
        const sessionKey = decodeURIComponent(agentDeleteMatch[1]);
        const purge = parsedUrl.searchParams.get('purge') === '1';
        if (!purge) {
          agentSessionMeta.setSession(sessionKey, { deleted: true });
          return this.sendJson(res, 200, { success: true, purged: false }, reqMeta);
        }
        const summary = await piSessionIndex.find(sessionKey);
        if (!summary) {
          return this.sendJson(res, 404, { error: 'Session Not Found' }, reqMeta);
        }
        agentSessionHost.stop(sessionKey);
        // 会话删掉后改动捕获也没人看：目录与记录一起清
        forgetSessionChanges(sessionKey);
        const moved = moveSessionFileToTrash(summary.path);
        if (!moved.ok) {
          return this.sendJson(res, 500, { error: moved.error || '删除失败' }, reqMeta);
        }
        piSessionIndex.invalidate(summary.path);
        agentSessionMeta.setSession(sessionKey, { deleted: true });
        serverLogger.info(`[Agent:Session] 删除会话 ${sessionKey} → ${moved.target}`);
        return this.sendJson(res, 200, { success: true, purged: true, target: moved.target }, reqMeta);
      }

      // 工作区元数据：重命名 / 隐藏 / 置顶 / 排序
      if (pathname === '/api/agent/projects') {
        if (method === 'GET') {
          return this.sendJson(res, 200, { projects: agentSessionMeta.listProjects() }, reqMeta);
        }
        if (method === 'PUT' || method === 'POST') {
          const body = await this.parseJsonBody(req).catch(() => ({}) as any);
          const target = typeof body?.cwd === 'string' ? body.cwd : '';
          if (!target) return this.sendJson(res, 400, { error: '缺少 cwd' }, reqMeta);
          const meta = agentSessionMeta.setProject(target, {
            title: typeof body?.title === 'string' ? body.title : undefined,
            hidden: typeof body?.hidden === 'boolean' ? body.hidden : undefined,
            pinned: typeof body?.pinned === 'boolean' ? body.pinned : undefined,
            order: typeof body?.order === 'number' ? body.order : undefined,
          });
          return this.sendJson(res, 200, { cwd: target, meta }, reqMeta);
        }
      }

      // 文件浏览与文本预览：工作区面板的「文件」「文档预览」
      if (pathname === '/api/agent/fs/list' && method === 'GET') {
        const target = parsedUrl.searchParams.get('path') || '';
        try {
          return this.sendJson(res, 200, listDirectory(target), reqMeta);
        } catch (err: any) {
          return this.sendJson(res, 400, { error: err?.message || '无法读取目录' }, reqMeta);
        }
      }

      if (pathname === '/api/agent/fs/mkdir' && method === 'POST') {
        const body = await this.parseJsonBody(req).catch(() => ({}) as any);
        try {
          const created = createDirectory(String(body?.parent || ''), String(body?.name || ''));
          return this.sendJson(res, 200, { path: created }, reqMeta);
        } catch (err: any) {
          return this.sendJson(res, 400, { error: err?.message || '无法新建目录' }, reqMeta);
        }
      }

      if (pathname === '/api/agent/fs/read' && method === 'GET') {
        const target = parsedUrl.searchParams.get('path') || '';
        // base：会话工作区，用来解析消息里的相对路径
        const base = parsedUrl.searchParams.get('base') || undefined;
        try {
          return this.sendJson(res, 200, readTextFile(target, base), reqMeta);
        } catch (err: any) {
          return this.sendJson(res, 400, { error: err?.message || '无法读取文件' }, reqMeta);
        }
      }

      // 轮内改动的两侧原文：工作台 diff 页签按 changeId 取
      if (pathname === '/api/agent/changes/diff' && method === 'GET') {
        const changeId = parsedUrl.searchParams.get('changeId') || '';
        const diff = changeId ? readChangeDiff(changeId) : undefined;
        serverLogger.debug(`[改动对比] changeId=${changeId} ${diff ? diff.kind : 'missing'}`);
        if (!diff) return this.sendJson(res, 404, { error: '改动内容已过期' }, reqMeta);
        return this.sendJson(res, 200, diff, reqMeta);
      }

      if (pathname === '/api/agent/fs/stat' && method === 'GET') {
        const target = parsedUrl.searchParams.get('path') || '';
        try {
          const info = statFile(target, parsedUrl.searchParams.get('base') || undefined);
          return this.sendJson(res, 200, info, reqMeta);
        } catch (err: any) {
          return this.sendJson(res, 404, { error: err?.message || '文件不存在' }, reqMeta);
        }
      }

      if (pathname === '/api/agent/fs/raw' && method === 'GET') {
        const target = parsedUrl.searchParams.get('path') || '';
        try {
          const info = statFile(target, parsedUrl.searchParams.get('base') || undefined);
          res.writeHead(200, {
            'Content-Type': info.mime,
            'Content-Length': String(info.size),
            'Cache-Control': 'no-store',
          });
          fs.createReadStream(info.path).pipe(res);
          return;
        } catch (err: any) {
          return this.sendJson(res, 404, { error: err?.message || '文件不存在' }, reqMeta);
        }
      }

      // 终端：一个终端一个 PTY 进程，输出经 WS 推送
      if (pathname === '/api/agent/terminal' && method === 'POST') {
        const body = await this.parseJsonBody(req).catch(() => ({}) as any);
        const session = terminalHost.open(
          typeof body?.cwd === 'string' ? body.cwd : undefined,
          typeof body?.cols === 'number' ? body.cols : undefined,
          typeof body?.rows === 'number' ? body.rows : undefined
        );
        return this.sendJson(res, 200, { ...session, replay: terminalHost.replay(session.id) }, reqMeta);
      }

      if (pathname === '/api/agent/terminal' && method === 'GET') {
        return this.sendJson(res, 200, { terminals: terminalHost.list() }, reqMeta);
      }

      const terminalResizeMatch = pathname.match(/^\/api\/agent\/terminal\/([^/]+)\/resize$/);
      if (terminalResizeMatch && method === 'POST') {
        const terminalId = decodeURIComponent(terminalResizeMatch[1]);
        const body = await this.parseJsonBody(req).catch(() => ({}) as any);
        const ok = terminalHost.resize(terminalId, body?.cols, body?.rows);
        return this.sendJson(res, 200, { success: ok }, reqMeta);
      }

      const terminalInputMatch = pathname.match(/^\/api\/agent\/terminal\/([^/]+)\/input$/);
      if (terminalInputMatch && method === 'POST') {
        const terminalId = decodeURIComponent(terminalInputMatch[1]);
        const body = await this.parseJsonBody(req).catch(() => ({}) as any);
        const data = typeof body?.data === 'string' ? body.data : '';
        return this.sendJson(res, 200, { success: terminalHost.write(terminalId, data) }, reqMeta);
      }

      const terminalMatch = pathname.match(/^\/api\/agent\/terminal\/([^/]+)$/);
      if (terminalMatch) {
        const terminalId = decodeURIComponent(terminalMatch[1]);
        if (method === 'DELETE') {
          return this.sendJson(res, 200, { success: terminalHost.close(terminalId) }, reqMeta);
        }
        if (method === 'GET') {
          const replay = terminalHost.replay(terminalId);
          return this.sendJson(res, 200, { id: terminalId, replay }, reqMeta);
        }
      }

      // 读取某个全局会话的实时状态（进程未启动时返回 null，界面改用历史消息）
      const agentLiveMatch = pathname.match(/^\/api\/agent\/sessions\/(.+)\/live$/);
      if (agentLiveMatch && method === 'GET') {
        const sessionKey = decodeURIComponent(agentLiveMatch[1]);
        const state =
          agentSessionHost.getState(sessionKey) ||
          // 流水线 agent 节点的会话不在全局宿主里，接上同一份实时状态
          PiRpcSessionManager.getInstance().getStateBySessionId(sessionKey) ||
          null;
        return this.sendJson(res, 200, { state }, reqMeta);
      }

      // 回应扩展 UI 请求：approval 卡片的选择结果
      const agentUiResponseMatch = pathname.match(/^\/api\/agent\/sessions\/(.+)\/ui-response$/);
      if (agentUiResponseMatch && method === 'POST') {
        const sessionKey = decodeURIComponent(agentUiResponseMatch[1]);
        const body = await this.parseJsonBody(req).catch(() => ({}) as any);
        const requestId = typeof body?.id === 'string' ? body.id : '';
        if (!requestId) return this.sendJson(res, 400, { error: '缺少 id' }, reqMeta);
        const success = agentSessionHost.respondUiRequest(sessionKey, requestId, {
          value: typeof body?.value === 'string' ? body.value : undefined,
          confirmed: typeof body?.confirmed === 'boolean' ? body.confirmed : undefined,
          cancelled: body?.cancelled === true ? true : undefined,
        });
        return this.sendJson(res, 200, { success }, reqMeta);
      }

      // 会话可用模型（模型选择器）
      const agentModelsMatch = pathname.match(/^\/api\/agent\/sessions\/(.+)\/models$/);
      if (agentModelsMatch && method === 'GET') {
        const sessionKey = decodeURIComponent(agentModelsMatch[1]);
        const models = await agentSessionHost.listModels(sessionKey).catch(() => []);
        return this.sendJson(res, 200, { models }, reqMeta);
      }

      // 全局 Agent 会话控制：打开 / 发消息 / 暂停 / 继续 / 停止
      const agentActionMatch = pathname.match(
        /^\/api\/agent\/sessions\/(.+)\/(chat|open|pause|resume|stop|model|permission|regenerate|fork|tree|navigate|withdraw)$/
      );
      if (agentActionMatch) {
        const sessionKey = decodeURIComponent(agentActionMatch[1]);
        const action = agentActionMatch[2];
        // 读树是幂等的：只许 GET，其余动作一律 POST
        const readOnly = action === 'tree';
        if (method !== (readOnly ? 'GET' : 'POST')) {
          return this.sendJson(res, 405, { error: 'Method Not Allowed' }, reqMeta);
        }
        const body = readOnly ? {} : await this.parseJsonBody(req).catch(() => ({}) as any);

        try {
          if (action === 'tree') {
            return this.sendJson(res, 200, await agentSessionHost.getTree(sessionKey), reqMeta);
          }
          if (action === 'navigate') {
            const entryId = typeof body?.entryId === 'string' ? body.entryId.trim() : '';
            if (!entryId) {
              return this.sendJson(res, 400, { error: '缺少 entryId' }, reqMeta);
            }
            return this.sendJson(res, 200, await agentSessionHost.navigate(sessionKey, entryId), reqMeta);
          }
          if (action === 'open') {
            const result = await agentSessionHost.open(sessionKey, {
              cwd: body?.cwd,
              model: body?.model,
              thinking: body?.thinking,
              permission: body?.permission,
            });
            return this.sendJson(res, 200, result, reqMeta);
          }
          if (action === 'chat') {
            const message = typeof body?.message === 'string' ? body.message.trim() : '';
            if (!message) {
              return this.sendJson(res, 400, { error: '缺少 message' }, reqMeta);
            }
            // 流水线常驻会话持有同一份 pi 会话：消息直接转给它，否则两个进程会同时写同一个会话文件
            const pipeline = PiRpcSessionManager.getInstance().findLiveBySessionId(sessionKey);
            if (pipeline) {
              await pipeline.sendUserMessage(
                message,
                Array.isArray(body?.attachments) ? body.attachments : undefined
              );
              return this.sendJson(res, 200, pipeline.getState(), reqMeta);
            }
            const state = await agentSessionHost.chat(sessionKey, message, {
              cwd: body?.cwd,
              model: body?.model,
              attachments: Array.isArray(body?.attachments) ? body.attachments : undefined,
              thinking: body?.thinking,
              permission: body?.permission,
            });
            return this.sendJson(res, 200, state, reqMeta);
          }
          if (action === 'model') {
            const result = await agentSessionHost.setModel(
              sessionKey,
              typeof body?.model === 'string' ? body.model : undefined,
              typeof body?.thinking === 'string' ? body.thinking : undefined
            );
            return this.sendJson(res, 200, result, reqMeta);
          }
          if (action === 'permission') {
            const preset = (typeof body?.preset === 'string' ? body.preset : 'full') as AgentPermissionPreset;
            const result = await agentSessionHost.setPermission(sessionKey, preset);
            return this.sendJson(res, 200, { ...result, settings: agentSessionHost.getSettings(sessionKey) }, reqMeta);
          }
          if (action === 'regenerate') {
            const state = agentSessionHost.getState(sessionKey);
            const lastUser = [...(state?.messages || [])].reverse().find((item) => item.role === 'user');
            if (!lastUser) {
              return this.sendJson(res, 400, { error: '没有可重发的用户消息' }, reqMeta);
            }
            await agentSessionHost.pause(sessionKey).catch(() => false);
            const next = await agentSessionHost.chat(sessionKey, lastUser.content, {});
            return this.sendJson(res, 200, next, reqMeta);
          }
          if (action === 'fork') {
            const entryId = typeof body?.entryId === 'string' ? body.entryId.trim() : '';
            if (!entryId) {
              return this.sendJson(res, 400, { error: '缺少 entryId' }, reqMeta);
            }
            const result = await agentSessionHost.fork(sessionKey, entryId);
            this.broadcast({ type: 'agent:forked', data: { from: sessionKey, ...result } });
            return this.sendJson(res, 200, result, reqMeta);
          }
          if (action === 'withdraw') {
            const pendingId = typeof body?.pendingId === 'string' ? body.pendingId.trim() : '';
            if (!pendingId) return this.sendJson(res, 400, { error: '缺少 pendingId' }, reqMeta);
            const pipeline = PiRpcSessionManager.getInstance().findLiveBySessionId(sessionKey);
            const success = pipeline
              ? await pipeline.withdrawPending(pendingId)
              : await agentSessionHost.withdrawPending(sessionKey, pendingId);
            return this.sendJson(res, 200, { success }, reqMeta);
          }
          if (action === 'pause') {
            return this.sendJson(res, 200, { success: await agentSessionHost.pause(sessionKey) }, reqMeta);
          }
          if (action === 'resume') {
            return this.sendJson(res, 200, { success: await agentSessionHost.resume(sessionKey) }, reqMeta);
          }
          return this.sendJson(res, 200, { success: agentSessionHost.stop(sessionKey) }, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[Agent:Session] ${action} 失败: ${err?.message || err}`);
          return this.sendJson(res, 500, { error: err?.message || 'Agent 会话操作失败' }, reqMeta);
        }
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
        const startedAt = Date.now();
        // 直连流水线的隐藏载体任务不进入看板；同时只下发任务摘要（剔除会话与 Diff 明细）
        const tasks = this.store.getTaskSummaries().filter((t) => !t.context?.hiddenFromKanban);
        serverLogger.debug(`[Tasks:List] 看板任务摘要就绪: ${tasks.length} 个, 耗时 ${Date.now() - startedAt}ms`);
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
                parentGroupSnapshot: {
                  title: title || `任务组 #${Date.now()}`,
                  description: description || '',
                  attachments: Array.isArray(attachments) ? attachments : undefined,
                },
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
        this.broadcastTaskNew(task);
        for (const child of createdSubtasks) {
          this.broadcastTaskNew(child);
        }

        if (shouldAutoRun && (!isGroup || finalSubTaskIds.length > 0)) {
          serverLogger.info(`[Tasks:AutoRun] 异步启动任务调度: ${task.id}`, undefined, { taskId: task.id });
          setImmediate(() => {
            this.engine.runTask(task.id).catch((err) => {
              serverLogger.error(`[Tasks:RunError] 任务执行失败: ${err.message}`, err, { taskId: task.id });
              console.error(`Task ${task.id} failed:`, err);
            });
          });
        } else if (isGroup && finalSubTaskIds.length === 0) {
          serverLogger.info(`[Tasks:Create] 任务组 ${task.id} 尚未包含子工序，保持等待添加工序状态，暂不自动调度`);
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
        if (parentTaskId !== undefined) {
          const nextParentId = parentTaskId ? String(parentTaskId).trim() : undefined;
          if (nextParentId !== existing.parentTaskId) {
            // 1. 若原先属于其他父任务，从原父任务中解绑
            if (existing.parentTaskId) {
              const oldParent = this.store.getTask(existing.parentTaskId);
              if (oldParent) {
                oldParent.subTaskIds = (oldParent.subTaskIds || []).filter((sid) => sid !== existing.id);
                if (oldParent.subTaskIds.length === 0) oldParent.kind = 'single';
                oldParent.updatedAt = Date.now();
                this.store.saveTask(oldParent);
                this.broadcastTaskUpdate(oldParent);
              }
            }
            // 2. 若指定了新父任务，挂载至新父任务
            if (nextParentId) {
              const newParent = this.store.getTask(nextParentId);
              if (newParent && !newParent.parentTaskId && newParent.kind !== 'subtask') {
                newParent.kind = 'group';
                const sids = newParent.subTaskIds || [];
                if (!sids.includes(existing.id)) newParent.subTaskIds = [...sids, existing.id];
                newParent.updatedAt = Date.now();
                this.store.saveTask(newParent);
                this.broadcastTaskUpdate(newParent);
                existing.kind = 'subtask';
                existing.parentTaskId = nextParentId;
              }
            } else {
              existing.kind = 'single';
              existing.parentTaskId = undefined;
            }
          }
        } else if (kind !== undefined) {
          existing.kind = kind;
        }
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
        this.broadcastTaskUpdate(existing);
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
            const dataDir = path.join(this.store.getDataDir(), 'artifacts');
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
          this.broadcastTaskUpdate({ id: taskId, deleted: true });
          for (const subId of subtaskIds) {
            this.broadcastTaskUpdate({ id: subId, deleted: true });
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
        
        // 解析子任务物理工作区：若传入相对路径，自动基于父任务工作区解析为绝对路径
        let childWorkspace = parent.workspace;
        if (typeof workspace === 'string' && workspace.trim()) {
          const trimmed = workspace.trim();
          childWorkspace = path.isAbsolute(trimmed)
            ? trimmed
            : (parent.workspace ? path.resolve(parent.workspace, trimmed) : trimmed);
        }

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
            parentGroupSnapshot: {
              title: parent.title,
              description: parent.description || '',
              attachments: parent.attachments,
            },
          },
        };

        // 升级父任务为 group 并挂载子任务 ID
        parent.kind = 'group';
        parent.subTaskIds = [...(parent.subTaskIds || []), subId];
        parent.updatedAt = Date.now();

        this.store.saveTask(childTask);
        this.store.saveTask(parent);

        this.broadcastTaskNew(childTask);
        this.broadcastTaskUpdate(parent);

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

          // 解析子任务物理工作区：若传入相对路径，自动基于父任务工作区解析为绝对路径
          let childWorkspace = parent.workspace;
          if (typeof raw.workspace === 'string' && raw.workspace.trim()) {
            const trimmed = raw.workspace.trim();
            childWorkspace = path.isAbsolute(trimmed)
              ? trimmed
              : (parent.workspace ? path.resolve(parent.workspace, trimmed) : trimmed);
          }

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
              parentGroupSnapshot: {
                title: parent.title,
                description: parent.description || '',
                attachments: parent.attachments,
              },
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
          this.broadcastTaskNew(child);
        }
        this.broadcastTaskUpdate(parent);

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

      // Unlink Subtask (从任务组中脱离，恢复为独立单任务，不删除数据): POST /api/tasks/:id/subtasks/:subId/unlink
      const taskUnlinkSubtaskMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/subtasks\/([a-zA-Z0-9_-]+)\/unlink$/);
      if (taskUnlinkSubtaskMatch && method === 'POST') {
        const parentId = taskUnlinkSubtaskMatch[1];
        const subId = taskUnlinkSubtaskMatch[2];
        const parent = this.store.getTask(parentId);
        if (!parent) return this.sendJson(res, 404, { error: 'Parent task not found' }, reqMeta);

        const subtask = this.store.getTask(subId);
        if (!subtask) return this.sendJson(res, 404, { error: 'Subtask not found' }, reqMeta);

        if (subtask.status === 'running') {
          return this.sendJson(res, 400, { error: '正在运行中的子工序无法脱离任务组' }, reqMeta);
        }

        // 从父任务 subTaskIds 中移除
        parent.subTaskIds = (parent.subTaskIds || []).filter((id) => id !== subId);
        if (parent.subTaskIds.length === 0) {
          parent.kind = 'single';
        }
        parent.updatedAt = Date.now();
        this.store.saveTask(parent);

        // 恢复子任务为独立单任务
        subtask.kind = 'single';
        subtask.parentTaskId = undefined;
        if (subtask.context) {
          delete subtask.context.parentTaskId;
          delete subtask.context.parentGroupSnapshot;
        }
        subtask.updatedAt = Date.now();
        this.store.saveTask(subtask);

        this.broadcastTaskUpdate(parent);
        this.broadcastTaskUpdate(subtask);

        serverLogger.info(`[Tasks:UnlinkSubtask] 成功将子工序 ${subId} 从任务组 ${parent.id} 中解绑恢复为独立任务`);
        return this.sendJson(res, 200, { success: true, parent, subtask }, reqMeta);
      }

      // Set Task Parent (选择成为某个任务的子任务 / 或解除归属): POST /api/tasks/:id/parent
      const taskSetParentMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/parent$/);
      if (taskSetParentMatch && method === 'POST') {
        const taskId = taskSetParentMatch[1];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);

        if (task.status === 'running') {
          return this.sendJson(res, 400, { error: '正在运行中的任务无法更改父任务归属' }, reqMeta);
        }

        const body = await this.parseJsonBody(req);
        const { parentTaskId } = body;
        const targetParentId = typeof parentTaskId === 'string' && parentTaskId.trim() ? parentTaskId.trim() : null;

        // 若无需变更（已在同一父任务下或本来就为独立任务）
        if (targetParentId === (task.parentTaskId || null)) {
          return this.sendJson(res, 200, { success: true, task }, reqMeta);
        }

        let targetParent: Task | undefined;
        let oldParent: Task | undefined;

        if (targetParentId) {
          if (targetParentId === taskId) {
            return this.sendJson(res, 400, { error: '无法将任务自身设为父任务' }, reqMeta);
          }

          targetParent = this.store.getTask(targetParentId);
          if (!targetParent) {
            return this.sendJson(res, 404, { error: '目标父任务不存在' }, reqMeta);
          }

          if (targetParent.kind === 'subtask' || targetParent.parentTaskId) {
            return this.sendJson(res, 400, { error: '子工序不能作为父任务（不支持多层任务嵌套）' }, reqMeta);
          }

          if (task.kind === 'group' && Array.isArray(task.subTaskIds) && task.subTaskIds.length > 0) {
            return this.sendJson(res, 400, { error: '当前任务已有子工序，无法作为其他任务的子工序' }, reqMeta);
          }

          if (targetParent.status === 'running') {
            return this.sendJson(res, 400, { error: '目标任务组正在执行中，无法动态添加子工序' }, reqMeta);
          }
        }

        // 1. 若先前已有父任务，从旧父任务中解绑
        if (task.parentTaskId && task.parentTaskId !== targetParentId) {
          oldParent = this.store.getTask(task.parentTaskId);
          if (oldParent) {
            oldParent.subTaskIds = (oldParent.subTaskIds || []).filter((sid) => sid !== taskId);
            if (oldParent.subTaskIds.length === 0) {
              oldParent.kind = 'single';
            }
            oldParent.updatedAt = Date.now();
            this.store.saveTask(oldParent);
            this.broadcastTaskUpdate(oldParent);
          }
        }

        // 2. 挂载到新父任务
        if (targetParent) {
          targetParent.kind = 'group';
          const currentSubIds = targetParent.subTaskIds || [];
          if (!currentSubIds.includes(taskId)) {
            targetParent.subTaskIds = [...currentSubIds, taskId];
          }
          targetParent.updatedAt = Date.now();
          this.store.saveTask(targetParent);
          this.broadcastTaskUpdate(targetParent);

          task.kind = 'subtask';
          task.parentTaskId = targetParent.id;
          task.context = {
            ...(task.context || {}),
            parentTaskId: targetParent.id,
            parentGroupSnapshot: {
              title: targetParent.title,
              description: targetParent.description || '',
              attachments: targetParent.attachments,
            },
          };
        } else {
          // 3. 解绑恢复为独立任务
          task.kind = 'single';
          task.parentTaskId = undefined;
          if (task.context) {
            delete task.context.parentTaskId;
            delete task.context.parentGroupSnapshot;
          }
        }

        task.updatedAt = Date.now();
        this.store.saveTask(task);
        this.broadcastTaskUpdate(task);

        serverLogger.info(`[Tasks:SetParent] 成功将任务 ${taskId} 归属变更为: ${targetParentId || '独立任务'}`);
        return this.sendJson(res, 200, { success: true, task, parent: targetParent, previousParent: oldParent }, reqMeta);
      }

      // Link Existing Tasks to Task/Group: POST /api/tasks/:id/link-subtasks
      const taskLinkSubtasksMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/link-subtasks$/);
      if (taskLinkSubtasksMatch && method === 'POST') {
        const parentId = taskLinkSubtasksMatch[1];
        const parent = this.store.getTask(parentId);
        if (!parent) return this.sendJson(res, 404, { error: 'Parent task not found' }, reqMeta);

        if (parent.kind === 'subtask' || parent.parentTaskId) {
          return this.sendJson(res, 400, { error: '子工序不能作为父任务（不支持多层任务嵌套）' }, reqMeta);
        }
        if (parent.status === 'running') {
          return this.sendJson(res, 400, { error: '目标任务组正在执行中，无法动态添加子工序' }, reqMeta);
        }

        const body = await this.parseJsonBody(req);
        const { subTaskIds } = body;
        if (!Array.isArray(subTaskIds) || subTaskIds.length === 0) {
          return this.sendJson(res, 400, { error: 'subTaskIds array is required' }, reqMeta);
        }

        const linkedTasks: Task[] = [];
        const validSubIds: string[] = [];

        for (const subId of subTaskIds) {
          if (!subId || subId === parentId) continue;
          const subtask = this.store.getTask(subId);
          if (!subtask) continue;
          if (subtask.status === 'running') continue;
          if (subtask.kind === 'group' && Array.isArray(subtask.subTaskIds) && subtask.subTaskIds.length > 0) continue;

          // 若此前属于其他父任务，先从原父任务中解绑
          if (subtask.parentTaskId && subtask.parentTaskId !== parentId) {
            const oldParent = this.store.getTask(subtask.parentTaskId);
            if (oldParent) {
              oldParent.subTaskIds = (oldParent.subTaskIds || []).filter((id) => id !== subId);
              if (oldParent.subTaskIds.length === 0) oldParent.kind = 'single';
              oldParent.updatedAt = Date.now();
              this.store.saveTask(oldParent);
              this.broadcastTaskUpdate(oldParent);
            }
          }

          subtask.kind = 'subtask';
          subtask.parentTaskId = parent.id;
          subtask.context = {
            ...(subtask.context || {}),
            parentTaskId: parent.id,
            parentGroupSnapshot: {
              title: parent.title,
              description: parent.description || '',
              attachments: parent.attachments,
            },
          };
          subtask.updatedAt = Date.now();
          this.store.saveTask(subtask);
          this.broadcastTaskUpdate(subtask);
          linkedTasks.push(subtask);
          validSubIds.push(subId);
        }

        if (validSubIds.length > 0) {
          parent.kind = 'group';
          const set = new Set([...(parent.subTaskIds || []), ...validSubIds]);
          parent.subTaskIds = Array.from(set);
          parent.updatedAt = Date.now();
          this.store.saveTask(parent);
          this.broadcastTaskUpdate(parent);
        }

        serverLogger.info(`[Tasks:LinkSubtasks] 成功为任务组 ${parent.id} 关联 ${linkedTasks.length} 个已有任务`);
        return this.sendJson(res, 200, { success: true, parent, linkedTasks }, reqMeta);
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
        this.broadcastTaskUpdate(parent);

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

        const workflow = this.store.getWorkflow(task.workflowId);
        const currentNode = workflow?.nodes.find((n) => n.id === task.currentNodeId);
        const isCurrentAgentRunning = task.status === 'running' && currentNode?.type === 'agent';

        // 若任务当前并非停留在 Agent 节点（例如进入了后续测试、门禁或已结束），修正历史遗留的 awaitingInput 脏数据
        if (!isCurrentAgentRunning && task.context?.awaitingInput) {
          task.context.awaitingInput = false;
          this.store.saveTask(task);
        }

        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (rpcSession) {
          const state = rpcSession.getState();
          const effectiveAwaiting = isCurrentAgentRunning ? !!state.awaitingInput : false;
          return this.sendJson(
            res,
            200,
            {
              ...state,
              messages: sanitizeChatMessages(state.messages),
              awaitingInput: effectiveAwaiting,
              sessionId,
              resumeCommand,
            },
            reqMeta
          );
        }

        // 无常驻 RPC 进程时，历史以磁盘会话文件为准：同一份 pi 会话可能在全局 Agent 面板里被继续对话，
        // task.context.chatMessages 只是任务侧的副本，不会跟着更新
        // isBusy 只表示智能体会话本身在执行：无常驻会话时任务即便处于 running
        // （例如正在跑 CLI / Hook 节点），智能体也未启动
        const diskSession = await piSessionIndex.readByName(sessionId).catch(() => null);
        const persistedMessages =
          diskSession && diskSession.messages.length > 0
            ? diskSession.messages
            : sanitizeChatMessages(task.context?.chatMessages || []);
        const historicalState: TaskSessionState = {
          taskId,
          active: false,
          isBusy: false,
          isPaused: false,
          awaitingInput: isCurrentAgentRunning ? !!task.context?.awaitingInput : false,
          messages: persistedMessages,
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
        const { message, attachments, includeQaArtifacts, selectedQaArtifacts } = body;
        const safeAttachments: TaskAttachment[] = Array.isArray(attachments) ? attachments : [];
        const rawMsg = typeof message === 'string' ? message.trim() : '';

        const hasSelectedQa = Boolean(
          selectedQaArtifacts &&
          ((Array.isArray(selectedQaArtifacts.steps) && selectedQaArtifacts.steps.length > 0) ||
           (Array.isArray(selectedQaArtifacts.screenshots) && selectedQaArtifacts.screenshots.length > 0))
        );

        if (!rawMsg && safeAttachments.length === 0 && !includeQaArtifacts && !hasSelectedQa) {
          return this.sendJson(res, 400, { error: 'Message or attachments required' }, reqMeta);
        }

        const finalMessage = rawMsg || (hasSelectedQa
          ? '请查看我选中的 UI 自动化测试产物与操作流程，并分析修改代码。'
          : (includeQaArtifacts
            ? '请查看最新 UI 自动化测试产物并分析修复。'
            : (safeAttachments.length > 0 ? '请查看我提供的图片附件并推进任务。' : '')));

        serverLogger.info(
          `[AgentChat] 接收到任务会话消息 (${taskId}): "${finalMessage.slice(0, 30)}", 附件数: ${safeAttachments.length}, 附带QA产物: ${!!includeQaArtifacts}, 精选QA产物: ${hasSelectedQa}`
        );

        // 如果用户选择了特定 QA 产物，自动解析本地截图路径并装配入 safeAttachments
        const dataDir = this.store.getDataDir();
        if (selectedQaArtifacts && Array.isArray(selectedQaArtifacts.screenshots)) {
          const runId = selectedQaArtifacts.qaRunId;
          for (const sc of selectedQaArtifacts.screenshots) {
            const absPath = resolveArtifactPath(
              sc.path,
              dataDir,
              runId && sc.name ? path.join('artifacts', runId, sc.name) : undefined
            );
            if (!absPath) {
              serverLogger.warn(`[AgentChat] 未找到选中的 QA 截图: ${sc.path || sc.name}`);
              continue;
            }
            const existingAtt = safeAttachments.find((a) => a.path === absPath || a.name === sc.name);
            if (existingAtt) continue;
            safeAttachments.push({
              id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: sc.name,
              mimeType: guessImageMimeType(sc.name || absPath),
              path: absPath,
              url: sc.url || (runId ? `/artifacts/${runId}/${sc.name}` : undefined),
              size: fs.statSync(absPath).size,
              createdAt: Date.now(),
            });
          }
        }

        // 如果用户上传或选择了新图片，也同步累加到任务全局 attachments 中
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

        // 优先装配用户精选的 QA 截图与步骤产物
        if (hasSelectedQa && !enrichedMessage.includes('[用户主动附带：')) {
          const parts: string[] = [];
          parts.push(`[用户主动附带：UI 自动化测试验收产物与问题流程]`);
          if (selectedQaArtifacts.qaRunId) {
            parts.push(`- 自动化测试 Run ID: ${selectedQaArtifacts.qaRunId}${selectedQaArtifacts.suiteName ? ` (${selectedQaArtifacts.suiteName})` : ''}`);
          }
          if (Array.isArray(selectedQaArtifacts.steps) && selectedQaArtifacts.steps.length > 0) {
            parts.push(`\n【选中的关键操作流程与步骤 (${selectedQaArtifacts.steps.length} 项)】`);
            for (const step of selectedQaArtifacts.steps) {
              const statusUpper = (step.status || 'unknown').toUpperCase();
              const durationText = step.durationMs !== undefined ? ` [${step.durationMs}ms]` : '';
              parts.push(`* 步骤 ${step.stepIndex + 1} [${statusUpper}]${durationText}: ${step.prompt}`);
              if (step.error) {
                parts.push(`  - 报错信息: ${step.error}`);
              }
              if (step.thought) {
                parts.push(`  - 步骤思考: ${step.thought}`);
              }
            }
          }
          if (Array.isArray(selectedQaArtifacts.screenshots) && selectedQaArtifacts.screenshots.length > 0) {
            const runId = selectedQaArtifacts.qaRunId;
            parts.push(`\n【选中的截帧快照与界面证据 (${selectedQaArtifacts.screenshots.length} 张)】`);
            for (const sc of selectedQaArtifacts.screenshots) {
              const promptDesc = sc.stepPrompt ? ` (对应步骤: ${sc.stepPrompt})` : (sc.stepIndex !== undefined ? ` (对应步骤 #${sc.stepIndex + 1})` : '');
              const resolvedPath = resolveArtifactPath(
                sc.path,
                dataDir,
                runId && sc.name ? path.join('artifacts', runId, sc.name) : undefined
              );
              const displayPath = resolvedPath || (sc.path ? path.join(dataDir, sc.path) : undefined);
              const pathInfo = displayPath ? ` [路径: ${displayPath}]` : '';
              parts.push(`* ${sc.name}${promptDesc}${pathInfo}`);
            }
          }
          parts.push(`\n提示：请结合上述选中的真实测试截帧与流程报错，精准分析失败根因并修改代码。`);
          const qaFormattedText = parts.join('\n');
          enrichedMessage = enrichedMessage ? `${enrichedMessage}\n\n${qaFormattedText}` : qaFormattedText;
        } else if (includeQaArtifacts) {
          let qaRunId = task.context?.qaRunId || (task.context?.worktree as any)?.qaRunId;
          if (!qaRunId) {
            const taskQaRuns = this.store.getQaRuns(undefined, taskId, 1);
            if (taskQaRuns && taskQaRuns.length > 0) {
              qaRunId = taskQaRuns[0].id;
            }
          }
          if (qaRunId) {
            const runDir = path.join(dataDir, 'artifacts', qaRunId);
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

        // 校验当前任务是否真正停留在 agent 节点上
        const workflow = this.store.getWorkflow(task.workflowId);
        const currentNode = workflow?.nodes.find((n) => n.id === task.currentNodeId);
        const isCurrentAgentNode = task.status === 'running' && currentNode?.type === 'agent';
        const isTaskGroup = task.kind === 'group' || (Array.isArray(task.subTaskIds) && task.subTaskIds.length > 0);

        let effectiveAgentName = task.context?.agentName || (isTaskGroup ? '任务组架构师' : 'OpenLoop Agent');
        let excludeTools: string | undefined = undefined;

        // 仅当当前任务真正由 Agent 节点驱动流水线时，才注入完成协议提示词，提示 Agent 在验证通过后输出完成标记
        let promptToSend = enrichedMessage;
        if (isCurrentAgentNode) {
          promptToSend += `\n\n【完成协议（重要）】\n- 需求修改并验证通过后，在最后一条回复末尾单独一行输出 ${PIPELINE_DONE_MARKER}，流水线据此流转到下一个节点。\n- 只要还需要用户确认方案、补充信息或回答问题，就直接提问并不要输出该标记，流水线会停留在本节点等待用户回复。`;
        } else if (isTaskGroup) {
          effectiveAgentName = '任务组架构师';
          excludeTools = 'edit,write';

          const existingSubtasks = (task.subTaskIds || [])
            .map((id) => this.store.getTask(id))
            .filter(Boolean) as Task[];
          const existingSubSummary =
            existingSubtasks.length > 0
              ? existingSubtasks
                  .map(
                    (s, i) =>
                      `${i + 1}. ${s.title} (workspace: ${s.workspace || '默认'}, workflow: ${s.workflowId})`
                  )
                  .join('\n')
              : '（当前尚未拆分子工序）';

          const architectHeader = `【系统指令：任务组架构与规划 Agent】
你当前处于【任务组 (Task Group)】顶层架构规划上下文，身份为「任务组架构师」。

【核心原则】
1. 【严禁修改或编写业务代码】你不是具体编码的 Agent，禁止直接写文件或修改文件（系统已禁用写代码工具）。你的职责是需求梳理、方案设计与工序拆解。
2. 【只读分析】允许且鼓励使用只读工具（read、grep、find，或查看目录与状态的 bash 命令如 ls、cat、git status）来探查工作区目录结构、工程配置与业务需求。
3. 【任务拆解】与用户沟通交流，深入理解需求。根据实际工程结构（如单体项目分阶段、多工程项目跨目录等），将其拆解为独立闭环的子任务，并明确为每个子任务指定：
   - title: 子工序标题
   - workspace: 目标工作区路径（若在特定子目录或独立工程，指定相对路径或绝对路径；若与父任务一致可留空）
   - workflowId: 绑定的流水线 ID（由用户指定或与用户商定）
   - description: 针对该子工序的具体详细交付说明
   - dependencies: 前序依赖（如 ["sub_1"] 或 []）
4. 【工序方案结构化输出】当你与用户沟通确认好拆解方案后，除了用自然语言解释你的方案外，请在回复末尾附带标准的 JSON 代码块（系统前端会自动捕获并渲染为「一键采纳方案卡片」，方便用户一键挂载子工序）：
\`\`\`json
{
  "type": "subtask_plan",
  "executionMode": "serial",
  "concurrencyLimit": 1,
  "subtasks": [
    {
      "title": "子工序标题",
      "workspace": "相对路径或绝对路径（留空则继承父工作区）",
      "workflowId": "流水线 ID",
      "description": "该工序的具体交付与验收内容...",
      "dependencies": []
    }
  ]
}
\`\`\`

【任务组上下文】
- 标题: ${task.title}
- 需求描述: ${task.description?.trim() || '（无）'}
- 工作区根目录: ${task.workspace || '（未指定）'}

【已有子工序】
${existingSubSummary}
----------------------------------------\n\n`;

          const hasInjectedHeader = task.context?.chatMessages?.some((m: any) =>
            typeof m.content === 'string' && m.content.includes('【系统指令：任务组架构与规划 Agent】')
          );
          if (!hasInjectedHeader) {
            promptToSend = `${architectHeader}${promptToSend}`;
          }
        }

        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (rpcSession && rpcSession.active) {
          rpcSession.sendUserMessage(promptToSend, safeAttachments).catch((err) => {
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
          agentName: effectiveAgentName,
          excludeTools,
          model: settings.defaultModel,
          thinking: settings.reasoningLevel || 'high',
          cwd,
          initialPrompt: promptToSend,
          initialAttachments: safeAttachments.length > 0 ? safeAttachments : undefined,
          awaitCompletionMarker: isCurrentAgentNode,
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
              const prevAwaiting = !!currentTask.context.awaitingInput;
              const nextAwaiting = isCurrentAgentNode ? !!state.awaitingInput : false;
              currentTask.context.awaitingInput = nextAwaiting;
              this.store.saveTask(currentTask);
              if (prevAwaiting !== nextAwaiting) {
                this.broadcastTaskUpdate(currentTask);
              }
            }
            this.broadcast({
              type: 'agent:chat_update',
              data: {
                ...state,
                awaitingInput: isCurrentAgentNode ? !!state.awaitingInput : false,
              },
            });
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

      // Task session withdraw: /api/tasks/:id/session/withdraw
      const taskWithdrawMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/session\/withdraw$/);
      if (taskWithdrawMatch && method === 'POST') {
        const taskId = taskWithdrawMatch[1];
        const body = await this.parseJsonBody(req).catch(() => ({}) as any);
        const pendingId = typeof body?.pendingId === 'string' ? body.pendingId.trim() : '';
        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (!pendingId || !rpcSession) {
          return this.sendJson(res, 400, { error: '缺少 pendingId 或会话未启动' }, reqMeta);
        }
        return this.sendJson(res, 200, { success: await rpcSession.withdrawPending(pendingId) }, reqMeta);
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

      // Task session ui-response: /api/tasks/:id/session/ui-response
      const taskUiResponseMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/session\/ui-response$/);
      if (taskUiResponseMatch && method === 'POST') {
        const taskId = taskUiResponseMatch[1];
        const body = await this.parseJsonBody(req).catch(() => ({}) as any);
        const requestId = typeof body?.id === 'string' ? body.id : '';
        const session = PiRpcSessionManager.getInstance().getSession(taskId);
        if (!requestId || !session) {
          return this.sendJson(res, 400, { error: '缺少 id 或会话未启动' }, reqMeta);
        }
        session.respondExtensionUi(requestId, {
          value: typeof body?.value === 'string' ? body.value : undefined,
          confirmed: typeof body?.confirmed === 'boolean' ? body.confirmed : undefined,
          cancelled: body?.cancelled === true ? true : undefined,
        });
        return this.sendJson(res, 200, { success: true }, reqMeta);
      }

      // Task session regenerate: /api/tasks/:id/session/regenerate
      const taskRegenerateMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/session\/regenerate$/);
      if (taskRegenerateMatch && method === 'POST') {
        const taskId = taskRegenerateMatch[1];
        const session = PiRpcSessionManager.getInstance().getSession(taskId);
        if (!session) return this.sendJson(res, 400, { error: 'No active session to regenerate' }, reqMeta);
        const lastUser = [...session.messages].reverse().find((item) => item.role === 'user');
        if (!lastUser) return this.sendJson(res, 400, { error: '没有可重发的用户消息' }, reqMeta);
        await session.pause().catch(() => false);
        await session.sendPrompt(lastUser.content, lastUser.attachments);
        return this.sendJson(res, 200, session.getState(), reqMeta);
      }

      // Task session clear: /api/tasks/:id/session/clear
      const taskSessionClearMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/session\/clear$/);
      if (taskSessionClearMatch && method === 'POST') {
        const taskId = taskSessionClearMatch[1];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);

        if (task.context) {
          task.context.chatMessages = [];
        }
        this.store.saveTask(task);

        const rpcSession = PiRpcSessionManager.getInstance().getSession(taskId);
        if (rpcSession) {
          rpcSession.messages = [];
          rpcSession.clearPendingInputs();
        }

        this.broadcastTaskUpdate(task);
        serverLogger.info(`[Tasks:ClearSession] 已清空任务 [${taskId}] 的全部会话消息`);
        return this.sendJson(res, 200, { success: true }, reqMeta);
      }

      // Task files search: /api/tasks/:id/files
      const taskFilesMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/files$/);
      if (taskFilesMatch && method === 'GET') {
        const taskId = taskFilesMatch[1];
        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);

        const repoRoot = findRepoRoot(process.cwd());
        const targetDir = task.context?.worktree?.worktreeDir || task.workspace || repoRoot || process.cwd();

        const query = (parsedUrl.searchParams.get('query') || '').trim().toLowerCase();
        const limitParam = parsedUrl.searchParams.get('limit');
        const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 2000) : 50;

        try {
          const allFiles = await this.getWorkspaceFiles(targetDir);
          let filtered = allFiles;
          if (query) {
            filtered = allFiles
              .filter((f) => f.toLowerCase().includes(query))
              .sort((a, b) => {
                const aLower = a.toLowerCase();
                const bLower = b.toLowerCase();
                const aName = aLower.split('/').pop() || '';
                const bName = bLower.split('/').pop() || '';

                const aStarts = aName.startsWith(query) ? 2 : aName.includes(query) ? 1 : 0;
                const bStarts = bName.startsWith(query) ? 2 : bName.includes(query) ? 1 : 0;
                if (aStarts !== bStarts) return bStarts - aStarts;
                return a.length - b.length;
              });
          }
          const resultFiles = filtered.slice(0, limit);
          return this.sendJson(res, 200, {
            files: resultFiles,
            workspace: targetDir,
            total: allFiles.length,
            matched: filtered.length,
          }, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[Tasks:Files] 读取工作区文件失败: ${err.message}`, err, { taskId });
          return this.sendJson(res, 500, { error: err.message }, reqMeta);
        }
      }

      // Task agent commands & skills: /api/tasks/:id/agent/commands-and-skills 或 /api/agent/commands-and-skills
      const taskCommandsSkillsMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/agent\/commands-and-skills$/);
      if ((taskCommandsSkillsMatch || pathname === '/api/agent/commands-and-skills') && method === 'GET') {
        let targetDir: string | undefined;
        if (taskCommandsSkillsMatch) {
          const taskId = taskCommandsSkillsMatch[1];
          const task = this.store.getTask(taskId);
          if (task) {
            const repoRoot = findRepoRoot(process.cwd());
            targetDir = task.context?.worktree?.worktreeDir || task.workspace || repoRoot;
          }
        }
        try {
          const data = await this.getAgentCommandsAndSkills(targetDir);
          return this.sendJson(res, 200, data, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[Agent:CommandsAndSkills] 获取命令与技能失败: ${err.message}`, err);
          return this.sendJson(res, 500, { error: err.message }, reqMeta);
        }
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

      // Task complete node: /api/tasks/:id/complete-node
      const taskCompleteNodeMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/complete-node$/);
      if (taskCompleteNodeMatch && method === 'POST') {
        const taskId = taskCompleteNodeMatch[1];
        const body = await this.parseJsonBody(req);
        const { nodeId } = body;
        serverLogger.info(
          `[Tasks:CompleteNode] 接收到确认节点完成指令: ${taskId}, Node: ${nodeId || '自动判定'}`,
          { nodeId },
          { taskId }
        );
        try {
          // 先释放仍停留在等待回复的 RPC 会话，再放行节点，避免下游长节点阻塞用户操作反馈
          PiRpcSessionManager.getInstance().removeSession(taskId);
          const task = await this.engine.completeNode(taskId, nodeId);
          return this.sendJson(res, 200, task, reqMeta);
        } catch (err: any) {
          serverLogger.error(`[Tasks:CompleteNode] 确认节点完成失败: ${err.message}`, err, { taskId });
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

      // Task node override: /api/tasks/:id/node-override
      // 任务级节点覆盖：仅本任务生效，不写回流水线模板（O(1) 改写 context.nodeOverrides 单键）
      const taskNodeOverrideMatch = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)\/node-override$/);
      if (taskNodeOverrideMatch && method === 'POST') {
        const taskId = taskNodeOverrideMatch[1];
        const body = await this.parseJsonBody(req);
        const nodeId = String(body?.nodeId || '').trim();
        if (!nodeId) return this.sendJson(res, 400, { error: '缺少 nodeId' }, reqMeta);

        const task = this.store.getTask(taskId);
        if (!task) return this.sendJson(res, 404, { error: 'Task not found' }, reqMeta);

        const workflow = this.store.getWorkflow(task.workflowId);
        if (workflow && !workflow.nodes.some((n) => n.id === nodeId)) {
          return this.sendJson(res, 400, { error: `流水线中不存在节点: ${nodeId}` }, reqMeta);
        }

        if (!task.context) task.context = {};
        const overrides: Record<string, any> = { ...(task.context.nodeOverrides || {}) };
        const current = { ...(overrides[nodeId] || {}) };

        if (body?.reset === true) {
          delete overrides[nodeId];
        } else {
          if (body?.params !== undefined) {
            const params: Record<string, string> = {};
            if (body.params && typeof body.params === 'object') {
              for (const [k, v] of Object.entries(body.params)) {
                const key = String(k).trim();
                const value = v === undefined || v === null ? '' : String(v);
                // 空值等同于清除该参数，避免残留空字符串覆盖掉模板默认值
                if (key && value !== '') params[key] = value;
              }
            }
            if (Object.keys(params).length > 0) current.params = params;
            else delete current.params;
          }
          if (body?.config !== undefined) {
            const patch: Record<string, any> = { ...(current.config || {}) };
            if (body.config && typeof body.config === 'object') {
              for (const [k, v] of Object.entries(body.config)) {
                // 传 null 表示清除该字段覆盖，回落到模板原值
                if (v === null) delete patch[k];
                else patch[k] = v;
              }
            } else {
              for (const k of Object.keys(patch)) delete patch[k];
            }
            if (Object.keys(patch).length > 0) current.config = patch;
            else delete current.config;
          }
          if (Object.keys(current).length > 0) overrides[nodeId] = current;
          else delete overrides[nodeId];
        }

        if (Object.keys(overrides).length > 0) task.context.nodeOverrides = overrides;
        else delete task.context.nodeOverrides;

        task.updatedAt = Date.now();
        this.store.saveTask(task);
        serverLogger.info(
          `[Tasks:NodeOverride] 更新任务级节点覆盖: ${taskId}, Node: ${nodeId}, 剩余覆盖节点: ${Object.keys(overrides).length}`,
          { nodeId, reset: body?.reset === true },
          { taskId }
        );
        this.broadcastTaskUpdate(task);
        return this.sendJson(res, 200, task, reqMeta);
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
        // 仅统计任务专属 Worktree 的改动；未创建隔离工作区时共享宿主仓库的改动与该任务无归属关系
        const targetDir = task?.context?.worktree?.worktreeDir;
        if (!task || !targetDir || !fs.existsSync(targetDir)) {
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
          const baseBranch = task.context?.worktree?.baseBranch;
          const baseCommit = task.context?.worktree?.baseCommit;
          const diffResult = WorktreeManager.getInstance().getWorktreeDiffDetail(
            targetDir,
            baseBranch,
            baseCommit
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
        let targetUrl = task.context.worktree.targetUrl || `http://localhost:${port}`;
        // 生产端口安全纠正：若历史 targetUrl 包含了 19888，自动纠正为沙箱独立端口
        if (targetUrl.includes('corePort=19888')) {
          const safePort = task.context.worktree.corePort && task.context.worktree.corePort !== 19888
            ? task.context.worktree.corePort
            : 19890;
          targetUrl = targetUrl.replace('corePort=19888', `corePort=${safePort}`);
        }
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

        // 0. 沙箱全栈 Core 服务就绪（严格隔离稳定版 19888）
        const currentCorePort = String(
          await WorktreeManager.getInstance().ensureSandboxCoreServer(
            taskId,
            task.context.worktree,
            (msg) => this.engine.log(taskId, 'node_env_prep', 'stdout', msg)
          )
        );
        ports.corePort = parseInt(currentCorePort, 10);
        if (task.context.worktree.ports) {
          task.context.worktree.ports.corePort = ports.corePort;
        }
        task.context.worktree.corePort = ports.corePort;
        try {
          this.store.saveTask(task);
        } catch {}

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
        let baseTargetUrl = targetUrl.replace(/([?&])corePort=\d+(&?)/, (_m: string, p1: string, p2: string) => (p2 ? p1 : ''));
        if (baseTargetUrl.endsWith('?') || baseTargetUrl.endsWith('&')) {
          baseTargetUrl = baseTargetUrl.slice(0, -1);
        }
        const browserTargetUrl = `${baseTargetUrl}${baseTargetUrl.includes('?') ? '&' : '?'}corePort=${currentCorePort}`;

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
        if (task?.context?.worktree?.corePort) {
          WorktreeManager.getInstance().killPortIfBusy(task.context.worktree.corePort);
        }
        if (task?.context?.worktree?.ports) {
          for (const p of Object.values(task.context.worktree.ports)) {
            if (typeof p === 'number') {
              WorktreeManager.getInstance().killPortIfBusy(p);
            }
          }
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

      // Global logs: /api/logs?limit=
      if (pathname === '/api/logs' && method === 'GET') {
        const limit = Number(parsedUrl.searchParams.get('limit')) || undefined;
        return this.sendJson(res, 200, this.store.getLogs(undefined, undefined, limit), reqMeta);
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

      // Settings: 会话进程可装载的 pi 扩展清单
      if (pathname === '/api/settings/pi-extensions' && method === 'GET') {
        return this.sendJson(
          res,
          200,
          {
            enabled: getEnabledPiExtensions(),
            defaults: DEFAULT_PI_EXTENSION_PACKAGES,
            installed: listInstalledPiExtensions(),
          },
          reqMeta
        );
      }

      if (pathname === '/api/settings' && (method === 'PUT' || method === 'POST')) {
        const body = await this.parseJsonBody(req);
        serverLogger.info(`[Settings:Update] 更新全局配置`, { keys: Object.keys(body) });
        const previous = this.store.getSettings();
        const updated = this.store.updateSettings(body);
        applyQaModelEnv(updated.qaAutomation);
        // 扩展名单只影响后续新开的会话进程，进行中的会话保持启动时的装载结果
        if (body.piExtensions !== undefined) {
          setEnabledPiExtensions(updated.piExtensions);
          serverLogger.info(`[PiExtensions] 扩展名单已更新: ${getEnabledPiExtensions().join(', ') || '(仅 openLoop 桥接)'}`);
        }
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

      if (pathname === '/api/qa/device-leases' && method === 'GET') {
        return this.sendJson(res, 200, { leases: DeviceLeasePool.getSnapshots() }, reqMeta);
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

      const qaSuiteMatch = pathname.match(/^\/api\/qa\/suites\/([a-zA-Z0-9_-]+)$/);
      if (qaSuiteMatch && method === 'GET') {
        const suite = this.store.getQaSuiteById(qaSuiteMatch[1]);
        if (!suite) return this.sendJson(res, 404, { error: 'QA Suite Not Found' }, reqMeta);
        return this.sendJson(res, 200, suite, reqMeta);
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
        const taskId = parsedUrl.searchParams.get('taskId') || undefined;
        const limitStr = parsedUrl.searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : 30;
        const runs = this.store.getQaRuns(suiteId, taskId, limit);
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
          ownerId: body.ownerId,
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

      // 本机「打开方式」应用表：首次调用探测一次，图标为内联 PNG
      if (pathname === '/api/system/open-targets' && method === 'GET') {
        return this.sendJson(res, 200, { targets: await listOpenInAppTargets() }, reqMeta);
      }

      // 用指定应用打开工作区目录
      if (pathname === '/api/system/open-target' && method === 'POST') {
        const body = await this.parseJsonBody(req).catch(() => ({}));
        if (!body.app || !body.path) {
          return this.sendJson(res, 400, { success: false, error: 'app and path are required' }, reqMeta);
        }
        const opened = openInApp(String(body.app), String(body.path));
        return this.sendJson(res, opened ? 200 : 400, { success: opened }, reqMeta);
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
      return;
    }
    // 终端按键与输出走同一条有序通道：转义序列、方向键与鼠标事件按顺序进 PTY，
    // 不会被多条 HTTP 请求的到达顺序打乱（TUI 程序对顺序极其敏感）
    if (msg.type === 'terminal:input' && typeof msg.data?.id === 'string' && typeof msg.data?.data === 'string') {
      terminalHost.write(msg.data.id, msg.data.data);
    }
  }
}
