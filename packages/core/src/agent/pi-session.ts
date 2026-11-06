import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  type AgentSession,
  type DefaultResourceLoader,
  type ExtensionFactory,
  type SessionManager,
} from '@earendil-works/pi-coding-agent';
import {
  PendingUserInput,
  SessionChatMessage,
  ToolExecutionRecord,
  TaskSessionState,
  TaskAttachment,
  RuntimeSettingsPatch,
  RuntimeSettingsApplyResult,
  RuntimeSettingsApplySummary,
} from '../types';
import { createLogger } from '../logger';
import { resolveResumeCommand } from '../constants/pi-agent';
import { compactToolResult } from './agent-format';
import { resolveEnabledPiExtensionPaths } from './pi-extensions';
import { piSessionIndex } from './session-index';
import { ExtensionUiBridge, type ExtensionUiResponse } from './pi-extension-ui';
import captureExtension from './extensions/openloop-capture';
import titleExtension from './extensions/openloop-title';
import { changeCaptureDir, changeIdOf, finishTurnChanges, forgetSessionChanges, rememberTurnWrite } from './turn-changes';
import {
  AgentStatusEvent,
  AgentStreamEvent,
  classifyToolKind,
  compactToolForEvent,
  compactUsage,
} from './agent-events';

const logger = createLogger('PiSession');

/** Agent 显式声明完成的标记：只有输出该标记，流水线才允许流转到下一个节点 */
export const PIPELINE_DONE_MARKER = '[OPENLOOP_DONE]';

/**
 * 全量快照限频间隔
 * 流式期间增量事件逐包推送，快照只负责对账，不需要跟每个 token 同步。
 * 快照自带全量 messages（工具结果的完整文本只在这里下发），长会话单包可达数百 KB，
 * 所以间隔按「对账够用」取值，不跟着 token 走。
 */
const PI_SNAPSHOT_INTERVAL_MS = 250;

/** pi SDK 是纯 ESM 包，CJS 宿主通过这份 ESM 桥加载（见 assets/pi-sdk.mjs） */
const PI_SDK_BRIDGE = path.join(__dirname, 'assets', 'pi-sdk.mjs');
type PiSdk = typeof import('@earendil-works/pi-coding-agent');
let sdkCache: PiSdk | null = null;

/** 惰性加载：没有 agent 会话时不为 SDK 付出加载成本 */
function piSdk(): PiSdk {
  if (!sdkCache) sdkCache = require(PI_SDK_BRIDGE) as PiSdk;
  return sdkCache;
}

/** 工具入参摘要：只保留可展示的原始字段，供工具卡直接渲染 */
function summarizeToolInput(args: any): Record<string, any> | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const summary: Record<string, any> = {};
  let count = 0;
  for (const [key, value] of Object.entries(args)) {
    if (count >= 20) break;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      summary[key] = value.length > 500 ? `${value.slice(0, 500)}…` : value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      summary[key] = value;
    }
    count += 1;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

/** 写入类工具的入参目标：pi 的 write / edit 用 path，其余变体一并兼容 */
function writeTargetOf(args: any, cwd: string): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  for (const key of ['path', 'file_path', 'filePath', 'target']) {
    const raw = args[key];
    if (typeof raw === 'string' && raw) return path.resolve(cwd, raw);
  }
  return undefined;
}

/** 附件按本地路径拼进正文：模型按需读取，不把图片塞进请求体 */
function composeMessage(message: string, attachments?: TaskAttachment[]): string {
  if (!attachments || attachments.length === 0) return message;
  const imagesPrompt = attachments
    .map((att, idx) => `[参考图片 ${idx + 1}: ${att.name}] 本地文件路径: ${att.path}`)
    .join('\n');
  return message
    ? `${message}\n\n【用户随附参考图片】\n${imagesPrompt}`
    : `【用户随附参考图片】\n${imagesPrompt}`;
}

/** 逗号分隔的工具名单转数组 */
function splitList(value?: string): string[] | undefined {
  if (!value || !value.trim()) return undefined;
  const list = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/**
 * 任意错误值转可读文本
 * SDK 抛出的不一定是 Error：字符串、普通对象都可能出现，直接 String() 只会得到 [object Object]
 */
function describeErrorValue(value: any): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch (_) {
    return String(value);
  }
}

/**
 * 扩展错误转一行可读文本
 * SDK 的扩展错误是 { extensionPath, event, error, stack } 结构，没有 message 字段，
 * 只把对象塞进模板字符串会丢掉「哪个扩展、哪个事件出错」这两项关键信息。
 */
function describeExtensionError(input: any): string {
  if (input instanceof Error || typeof input === 'string') return describeErrorValue(input);
  const where = [path.basename(input?.extensionPath || ''), input?.event]
    .filter((part) => typeof part === 'string' && part)
    .join(' ');
  const reason = describeErrorValue(input?.error) || describeErrorValue(input);
  return where ? `${where}: ${reason}` : reason;
}

/** 单张内联图片上限，超过则不给工具卡内联，避免快照体积失控 */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_IMAGES = 4;

/** 规范化模型全标识（provider/modelId），避免丢失 provider 前缀导致输入框模型闪烁 */
export function formatFullModel(model?: string, provider?: string, fallbackCurrent?: string): string | undefined {
  if (!model) return fallbackCurrent;
  if (provider && !model.startsWith(`${provider}/`)) {
    return `${provider}/${model}`;
  }
  if (fallbackCurrent && fallbackCurrent.endsWith(`/${model}`)) {
    return fallbackCurrent;
  }
  return model;
}

/** 工具结果里的图片块转成可渲染的 data URL（截图类工具的预览来源） */
function resultImageUrls(result: any): string[] {
  const content = Array.isArray(result?.content) ? result.content : [];
  const urls: string[] = [];
  for (const block of content) {
    if (urls.length >= MAX_INLINE_IMAGES) break;
    if (!block || block.type !== 'image' || typeof block.data !== 'string') continue;
    const data = block.data;
    if (!data || data.length > MAX_INLINE_IMAGE_BYTES) continue;
    urls.push(`data:${block.mimeType || 'image/png'};base64,${data}`);
  }
  return urls;
}

/**
 * 解析可用的启动目录
 *
 * 工作区可能已被回收（沙箱 worktree 清理、目录改名），cwd 不存在时工具路径全部失效。
 * 这里补建空目录：pi 按 cwd 路径定位会话文件，路径不变，历史照常续接；
 * 实在建不了才退到 home，至少保住对话能力。
 */
function resolveSessionCwd(dir: string): { cwd: string; recreated: boolean } {
  if (fs.existsSync(dir)) return { cwd: dir, recreated: false };
  try {
    fs.mkdirSync(dir, { recursive: true });
    return { cwd: dir, recreated: true };
  } catch {
    return { cwd: os.homedir(), recreated: false };
  }
}

export interface PiSessionOptions {
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  sessionId: string;
  agentName?: string;
  model?: string;
  thinking?: string;
  tools?: string;
  /** 排除的工具列表，逗号分隔，例如 'edit,write' */
  excludeTools?: string;
  /** 关闭全部工具，仅进行纯文本推理（一次性规划场景） */
  disableTools?: boolean;
  /** 会话专属工具：与 builtin 一同注册，配合 tools 白名单使用 */
  customTools?: any[];
  cwd?: string;
  env?: Record<string, string>;
  initialPrompt: string;
  initialAttachments?: TaskAttachment[];
  /** 流水线节点场景：Agent 未输出完成标记时停留在本节点等待用户回复，不自动流转下游 */
  awaitCompletionMarker?: boolean;
  /**
   * 是否在会话就绪后自动发送 initialPrompt
   * 历史会话浏览、纯面板打开场景传 false，等用户手动发消息再启动轮次
   */
  autoStart?: boolean;
  onLog?: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
  onUpdate?: (state: TaskSessionState) => void;
  /** 增量事件回调：流式期间只推变化部分，全量快照由 onUpdate 限频兜底 */
  onEvent?: (event: AgentStreamEvent) => void;
  onFinished?: (error?: string) => void;
}

export class PiSessionInstance extends EventEmitter {
  public static onModelsDiscovered?: (models: Array<{ id: string; provider: string; label?: string }>) => void;
  public taskId: string;
  public sessionId: string;
  public agentName: string;
  public model?: string;
  public messages: SessionChatMessage[] = [];
  public isBusy: boolean = false;
  public isPaused: boolean = false;
  /** 本轮已结束但 Agent 未声明完成，正在等待用户回复 */
  public awaitingInput: boolean = false;
  public active: boolean = true;
  public thinking?: string;
  public pendingModel?: string;
  public modelError?: string;
  public lastError?: string;
  /** 会话工作目录，工具记录直接带上，供命令卡显示提示符 */
  public cwd?: string;
  /** 实际生效的工作目录：目录被回收时会重建或回退，改动捕获按它解析相对路径 */
  private resolvedCwd?: string;
  /** 本轮（一次用户提交）开始时间，运行中用于显示用时 */
  public turnStartedAt?: number;
  /** 上一轮从开始到结束的用时（毫秒） */
  public lastTurnDurationMs?: number;
  /**
   * 进程内导航后的叶子条目：会话文件里的叶子可能被后续追加覆盖，
   * 因此由 openLoop 记住，否则读盘会读到被放弃的分支。
   * undefined=跟文件末尾一致，null=已回退到会话起点。
   */
  public leafEntryId?: string | null;

  private options: PiSessionOptions;
  /** SDK 会话：创建是异步的，所有对外方法先等它就绪 */
  private ready: Promise<AgentSession>;
  private session?: AgentSession;
  /** 扩展装载策略：关掉自动发现，只装设置页选中的包与 openLoop 自己的桥 */
  private resourceLoader?: DefaultResourceLoader;
  private modelPattern?: string;
  private pendingThinking?: string;
  private modelsCache: Array<{ id: string; provider: string; label?: string }> | null = null;
  private switching = false;
  private onLog?: (stream: 'stdout' | 'stderr' | 'system', message: string) => void;
  private onUpdateCallback?: (state: TaskSessionState) => void;
  private onEventCallback?: (event: AgentStreamEvent) => void;
  private onFinishedCallback?: (error?: string) => void;
  private currentAssistantMessage: SessionChatMessage | null = null;
  /** 本地回显层：已提交、等待 pi 采纳的用户输入 */
  private pendingInputs: PendingUserInput[] = [];
  private initialPromptSent = false;
  private executionCompleted = false;
  private awaitCompletionMarker: boolean;
  private doneMarkerSeen = false;
  /** 当前轮次序号（从 1 开始） */
  private turnSeq = 0;
  /** 实时消息对应的 pi 消息对象：pi 落盘用同一个对象引用，据此补条目 id */
  private readonly liveByPiMessage = new WeakMap<object, SessionChatMessage>();
  /** 最近一条 message_start 登记的消息：助手消息在 message_end 派的是另一个对象，按角色找回来 */
  private lastStarted?: { role: string; message: SessionChatMessage };
  /** 还没取到条目 id 的实时消息：pi 先派发 message_end 再写盘，轮末再补一次 */
  private readonly pendingEntryIds: Array<{ piMessage: any; message: SessionChatMessage }> = [];
  /** 全量快照限频：首个事件立即发，之后最多每 PI_SNAPSHOT_INTERVAL_MS 一包 */
  private snapshotTimer?: NodeJS.Timeout;
  private snapshotPending = false;
  /** 增量事件计数，仅供开发环境采样日志 */
  private eventSeq = 0;
  /** 扩展 UI 桥：对话框转成前端审批卡，会话销毁时统一取消 */
  private readonly extensionUi = new ExtensionUiBridge(
    (request) => this.emit('uiRequest', request),
    (message) => this.emitLog('system', `[扩展提示] ${message}`)
  );

  constructor(options: PiSessionOptions) {
    super();
    this.options = options;
    this.taskId = options.taskId;
    this.sessionId = options.sessionId;
    this.agentName = options.agentName || 'OpenLoop Agent';
    this.model = options.model;
    this.modelPattern = options.model?.trim() || undefined;
    this.thinking = options.thinking;
    this.onLog = options.onLog;
    this.onUpdateCallback = options.onUpdate;
    this.onEventCallback = options.onEvent;
    this.onFinishedCallback = options.onFinished;
    this.awaitCompletionMarker = options.awaitCompletionMarker === true;
    this.cwd = options.cwd;

    this.ready = this.bootstrap();
    this.ready.catch((err) => this.handleFatal(err));
    if (options.autoStart !== false) {
      void this.sendInitialPrompt(options.initialPrompt, options.initialAttachments);
    }
  }

  /** 建立 SDK 会话：解析工作目录、打开或新建会话文件、装载扩展、订阅事件 */
  private async bootstrap(): Promise<AgentSession> {
    const requestedCwd = this.options.cwd || os.tmpdir();
    const { cwd, recreated } = resolveSessionCwd(requestedCwd);
    if (recreated) {
      this.emitLog('system', `[工作目录] ${requestedCwd} 已不存在，已重建空目录，历史消息照常保留`);
    } else if (cwd !== requestedCwd) {
      this.emitLog('system', `[工作目录] ${requestedCwd} 不可用，本次会话改用 ${cwd}`);
    }

    logger.info(`建立 Pi SDK 会话 (Session: ${this.sessionId}, CWD: ${cwd})`, undefined, { taskId: this.taskId });
    this.emitLog('system', `[Pi SDK] 建立进程内 Agent 会话 (Session: ${this.sessionId})`);

    this.resolvedCwd = cwd;
    const session = await this.createSession(this.openSessionManager(cwd), cwd);
    // 会话建好前就已被销毁（任务被取消）：直接释放，不留悬挂的订阅与扩展运行时
    if (!this.active) {
      session.dispose();
      return session;
    }
    this.session = session;
    await this.seedMessagesFromDisk(session);
    // 有真实标题才写会话名：空标题会污染 pi 的 session_info，挡住后续 AI 命名
    const title = this.options.taskTitle?.trim();
    if (title) session.setSessionName(`openLoop: ${title.slice(0, 50)}`);
    // 模型 / 思考强度解析失败不能拖死会话：降级用引擎默认值继续跑
    await this.applyBootSettings(session).catch((error: any) => {
      this.modelError = error?.message || '会话初始化模型失败';
      logger.warn(`会话初始化模型失败，使用引擎默认模型: ${this.modelError}`, undefined, {
        taskId: this.taskId,
      });
      this.emitLog('system', `[模型] 初始化失败，本次会话使用引擎默认模型: ${this.modelError}`);
    });
    return session;
  }

  /**
   * 预置既有会话的消息列表
   * SDK 已把会话历史读进 session.messages，但那是 SDK 自己的形状；界面读的是这份消息列表。
   * 不预置就会出现「会话写明了有历史，界面却空白」，直到本轮说出第一句话。
   * 用 session-index 的解析结果，与全局面板的磁盘历史同源同 id，不会出现两套消息。
   */
  private async seedMessagesFromDisk(session: AgentSession): Promise<void> {
    if (this.messages.length > 0) return;
    const file = session.sessionFile;
    // 文件还没落盘（新建会话）就直接跳过：否则 session-index 会退回全目录扫描
    if (!file || !fs.existsSync(file)) return;
    const detail = await piSessionIndex.read(file).catch(() => undefined);
    const messages = detail?.messages;
    if (!messages || messages.length === 0) return;
    this.messages = messages;
    logger.info(`恢复既有会话，预置历史消息 ${messages.length} 条`, undefined, { taskId: this.taskId });
    if (process.env.NODE_ENV !== 'production') {
      this.emitLog('system', `[Pi SDK] 已载入本会话的历史消息 ${messages.length} 条`);
    }
  }

  /** 优先续接同名会话文件；不存在时按指定 id 新建，与 pi CLI 的 --session-id 语义一致 */
  private openSessionManager(cwd: string): SessionManager {
    const sessions = piSdk().SessionManager;
    const existing = sessions.findById(cwd, this.sessionId);
    if (existing) return sessions.open(existing, undefined, cwd);
    return sessions.create(cwd, undefined, { id: this.sessionId });
  }

  private async createSession(sessionManager: SessionManager, cwd: string): Promise<AgentSession> {
    const { session } = await piSdk().createAgentSession({
      cwd,
      resourceLoader: await this.getResourceLoader(cwd),
      sessionManager,
      tools: splitList(this.options.tools),
      excludeTools: splitList(this.options.excludeTools),
      noTools: this.options.disableTools ? 'all' : undefined,
      customTools: [
        ...(this.options.customTools || []),
        ...(this.shellEnv() ? [this.createBashToolDefinition(cwd)] : []),
      ],
    });
    await session.bindExtensions({
      uiContext: this.extensionUi.createContext(),
      // 沿用 rpc 模式：扩展里 ctx.mode === 'tui' 的终端专属能力依旧不启用
      mode: 'rpc',
      onError: (error: any) => {
        const text = describeExtensionError(error);
        // 原始对象留给日志文件：stack 与扩展路径只在排查时用得上，不上界面时间轴
        logger.warn(`扩展运行出错: ${text}`, error, { taskId: this.taskId });
        this.emitLog('stderr', `[扩展错误] ${text}`);
      },
    });
    session.subscribe((event) => this.handleSessionEvent(event));
    return session;
  }

  /**
   * 沙箱会话的附加环境变量（沙箱端口、数据目录）
   * 进程内会话不能改子进程环境，只能由自带 spawnHook 的 bash 工具注入，
   * 否则工具命令会回落到生产默认端口，误触生产库。
   */
  private shellEnv(): Record<string, string> | undefined {
    const env = this.options.env;
    return env && Object.keys(env).length > 0 ? env : undefined;
  }

  /**
   * 自定义 bash 工具：只为把会话级环境变量注入到每条命令
   * （SDK 的 ToolDefinition 在 details 泛型上是逆向变体，这里只能按 any 交回）
   */
  private createBashToolDefinition(cwd: string): any {
    const env = this.shellEnv()!;
    return piSdk().createBashToolDefinition(cwd, {
      spawnHook: (ctx) => ({ ...ctx, env: { ...ctx.env, ...env } }),
    });
  }

  /**
   * 扩展装载：关掉自动发现，只装设置页选中的包；
   * openLoop 自己的两个桥（改动捕获、会话自动命名）以进程内扩展形式注入，
   * 配置走闭包而不是环境变量——同一进程里的多个会话互不影响。
   */
  private async getResourceLoader(cwd: string): Promise<DefaultResourceLoader> {
    if (this.resourceLoader) return this.resourceLoader;
    const captureDir = changeCaptureDir(this.sessionId);
    const loader = new (piSdk().DefaultResourceLoader)({
      cwd,
      agentDir: piSdk().getAgentDir(),
      noExtensions: true,
      additionalExtensionPaths: resolveEnabledPiExtensionPaths(),
      extensionFactories: [
        // SDK 会话不自带 CLI 的内置扩展，需显式加载，否则 codemode / tool_search / MCP 工具全部缺失
        piSdk().createCodemodeExtension(),
        piSdk().createToolSearchExtension(),
        piSdk().createMcpExtension(),
        ...(captureDir
          ? [captureExtension({ dir: captureDir, sessionId: this.sessionId, cwd }) as ExtensionFactory]
          : []),
        titleExtension as ExtensionFactory,
      ],
    });
    await loader.reload();
    this.resourceLoader = loader;
    return loader;
  }

  /** 会话建立后的模型与思考强度：与运行时切换同一套解析逻辑 */
  private async applyBootSettings(session: AgentSession) {
    const pattern = this.options.model?.trim();
    if (pattern) {
      const resolved = this.resolveModel(session, pattern);
      if (resolved) {
        await session.setModel(resolved);
        this.model = `${resolved.provider}/${resolved.id}`;
      } else {
        this.modelError = `未找到唯一匹配的模型: ${pattern}`;
        logger.warn(`模型解析失败，使用引擎默认模型: ${this.modelError}`, undefined, { taskId: this.taskId });
        this.emitLog('system', `[模型] ${this.modelError}，本次会话使用引擎默认模型`);
      }
    }

    const thinking = this.options.thinking?.trim();
    if (thinking && thinking !== 'off') {
      session.setThinkingLevel(thinking as any);
      this.thinking = thinking;
    }
  }

  /** 宿主回传扩展 UI 结果 */
  public respondExtensionUi(id: string, response: ExtensionUiResponse) {
    this.extensionUi.respond(id, response);
  }

  public sendInitialPrompt(prompt: string, attachments?: TaskAttachment[]) {
    if (this.initialPromptSent) return;
    this.initialPromptSent = true;
    this.sendPrompt(prompt, attachments).catch((err) => {
      const errMsg = err?.message || '发送初始 Prompt 失败';
      logger.error(`发送初始 Prompt 失败: ${errMsg}`, undefined, { taskId: this.taskId });
      this.emitLog('stderr', `[Agent 报错] ${errMsg}`);
      this.lastError = errMsg;
      if (this.onFinishedCallback && !this.executionCompleted) {
        this.executionCompleted = true;
        this.awaitingInput = false;
        this.onFinishedCallback(errMsg);
      }
    });
  }

  /** 会话建立失败：进程内没有子进程可等，直接把错误落到界面状态 */
  private handleFatal(err: any) {
    const message = err?.message || String(err);
    logger.error(`Pi SDK 会话建立失败: ${message}`, undefined, { taskId: this.taskId });
    this.emitLog('stderr', `[Pi SDK 异常] ${message}`);
    this.active = false;
    this.lastError = message;
    this.emitStatus({ active: false });
    this.notifyUpdate(true);
    if (this.onFinishedCallback && !this.executionCompleted) {
      this.executionCompleted = true;
      this.onFinishedCallback(message);
    }
  }

  /**
   * 登记本地回显：气泡立即出现，但只属于回显层，不进会话流
   * 会话流只由 pi 的 message_start 驱动，两边不会重复。
   */
  private queuePendingInput(
    content: string,
    attachments: TaskAttachment[] | undefined,
    placement: PendingUserInput['placement']
  ): string | null {
    if (!content.trim()) return null;
    const id = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    logger.debug(`登记本地回显 (${placement}): "${content.slice(0, 40)}"`, undefined, { taskId: this.taskId });
    this.pendingInputs = [
      ...this.pendingInputs,
      {
        id,
        content,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
        placement,
        createdAt: Date.now(),
      },
    ];
    this.emitPending();
    return id;
  }

  /** pi 已确认把这条输入放进等待队列：此后可以整条撤回 */
  private markPendingQueued(id: string | null) {
    if (!id) return;
    const index = this.pendingInputs.findIndex((item) => item.id === id);
    if (index < 0) return;
    const next = this.pendingInputs.slice();
    next[index] = { ...next[index], queued: true };
    this.pendingInputs = next;
    this.emitPending();
  }

  /**
   * 撤回一条尚未被采纳的输入。
   * pi 的队列只能整队清空，所以清空后按原顺序补发其余条目，顺序不变。
   */
  public async withdrawPending(pendingId: string): Promise<boolean> {
    const target = this.pendingInputs.find((item) => item.id === pendingId);
    if (!target) return false;
    this.pendingInputs = this.pendingInputs.filter((item) => item.id !== pendingId);
    this.emitPending();
    // 还没进 pi 队列的条目只存在于回显层，移除即可
    if (!target.queued) return true;

    const rest = this.pendingInputs.filter((item) => item.queued);
    try {
      const session = await this.ready;
      session.clearQueue();
      for (const item of rest) {
        await session.steer(composeMessage(item.content, item.attachments), undefined, { source: 'rpc' });
      }
    } catch (err: any) {
      this.emitLog('stderr', `[Agent 队列] 撤回排队输入失败: ${err?.message || err}`);
      return false;
    }
    logger.info(`撤回排队中的输入: "${target.content.slice(0, 40)}"`, undefined, { taskId: this.taskId });
    this.notifyUpdate();
    return true;
  }

  /**
   * pi 采纳某条输入时取出对应的本地回显
   * 回显文本可能追加【用户随附参考图片】说明，所以按前缀匹配。
   */
  private takePendingInput(content: string): PendingUserInput | null {
    if (!content || this.pendingInputs.length === 0) return null;
    const index = this.pendingInputs.findIndex(
      (pending) => content === pending.content || content.startsWith(pending.content)
    );
    // 正文被 pi 展开（模板 / 指令）时前缀对不上：pi 按先来后到采纳，取最旧的一条，
    // 否则回显层会一直挂着这条，同一句提问在界面上出现两次。
    const takenIndex = index >= 0 ? index : 0;
    const taken = this.pendingInputs[takenIndex];
    this.pendingInputs = this.pendingInputs.filter((_, i) => i !== takenIndex);
    logger.debug(`本地回显已被 Agent 采纳: "${content.slice(0, 40)}"`, undefined, { taskId: this.taskId });
    return taken;
  }

  /** 清空本地回显层（采纳、中止或会话被清空时调用） */
  public clearPendingInputs() {
    if (this.pendingInputs.length === 0) return;
    this.pendingInputs = [];
    this.emitPending();
  }

  private emitPending() {
    this.emitEvent({ kind: 'pending', taskId: this.taskId, pendingInputs: [...this.pendingInputs] });
  }

  /** 记录本轮开始时间；一次用户提交可能含多个 turn（工具调用），只在首个 turn 定时 */
  private markTurnStart() {
    if (this.turnStartedAt === undefined) this.turnStartedAt = Date.now();
  }

  /** 本轮结束：冻结用时，供界面显示「已完成，用时 N 秒」 */
  private finishTurn() {
    if (this.turnStartedAt === undefined) return;
    this.lastTurnDurationMs = Date.now() - this.turnStartedAt;
    this.turnStartedAt = undefined;
  }

  private emitLog(stream: 'stdout' | 'stderr' | 'system', message: string) {
    if (this.onLog) {
      this.onLog(stream, message);
    }
  }

  /** 抹除完成标记，标记仅用于流水线判定，不展示在会话气泡中 */
  private stripDoneMarker(text: string): string {
    if (!text.includes(PIPELINE_DONE_MARKER)) return text;
    return text.split(PIPELINE_DONE_MARKER).join('').replace(/\n{3,}/g, '\n\n').trimEnd();
  }

  /** 记住实时消息对应的 pi 消息对象，落盘后按对象引用补条目 id */
  private rememberLiveMessage(piMessage: any, message: SessionChatMessage) {
    if (!piMessage || typeof piMessage !== 'object') return;
    this.liveByPiMessage.set(piMessage, message);
    this.lastStarted = { role: piMessage.role, message };
  }

  /**
   * 给实时消息补上 pi 条目 id
   *
   * 界面把磁盘历史与实时段按条目归并：同一条消息两侧必须同一个 key。
   * 缺了条目 id 就只能比内容，而内容会重复（「好的」「继续」这类短句），判不出谁是谁，
   * 同一段对话会在列表里出现两遍。
   */
  private bindEntryId(piMessage: any) {
    if (!piMessage) return;
    // 用户消息两侧是同一个对象；助手消息 message_start 派的是拷贝、message_end 派的是落盘对象
    const started = this.lastStarted;
    const fallback = started && started.role === piMessage.role ? started.message : undefined;
    const message = this.liveByPiMessage.get(piMessage) || fallback;
    if (!message || message.entryId) return;
    this.pendingEntryIds.push({ piMessage, message });
    // pi 先派发 message_end 再落盘：等本次事件处理完再按对象引用找回条目 id
    queueMicrotask(() => {
      try {
        this.flushEntryIds();
      } catch (error: any) {
        logger.warn(`补条目 id 失败: ${error?.message || error}`, undefined, { taskId: this.taskId });
      }
    });
  }

  /** 取回待补消息的条目 id：还没落盘的留到下一拍，轮末兜底再试 */
  private flushEntryIds() {
    if (this.pendingEntryIds.length === 0) return;
    const rest: Array<{ piMessage: any; message: SessionChatMessage }> = [];
    for (const item of this.pendingEntryIds) {
      const entryId = this.findEntryId(item.piMessage);
      if (!entryId) {
        rest.push(item);
        continue;
      }
      item.message.entryId = entryId;
      logger.debug(`绑定会话条目 id: ${item.message.id} → ${entryId}`, undefined, { taskId: this.taskId });
      this.emitMessagePatch(item.message.id, { entryId });
    }
    this.pendingEntryIds.length = 0;
    this.pendingEntryIds.push(...rest);
  }

  /** 按对象引用在会话分支里找回条目 id */
  private findEntryId(piMessage: any): string | undefined {
    const manager = this.session?.sessionManager;
    if (!manager) return undefined;
    const leaf = manager.getLeafEntry();
    if (leaf?.type === 'message' && leaf.message === piMessage) return leaf.id;
    const branch = manager.getBranch();
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      const entry = branch[index];
      if (entry.type === 'message' && entry.message === piMessage) return entry.id;
    }
    return undefined;
  }

  /**
   * SDK 事件分发：处理出错只影响本次事件
   * （进程内没有子进程隔离，这里抛出去会直接打死核心服务）
   */
  private handleSessionEvent(record: any) {
    if (!record || typeof record.type !== 'string') return;
    try {
      this.applySessionEvent(record);
    } catch (error: any) {
      logger.error(`处理会话事件失败 (${record.type}): ${error?.message || error}`, undefined, {
        taskId: this.taskId,
      });
    }
  }

  private applySessionEvent(record: any) {
    // 1. 状态与会话生命周期事件
    switch (record.type) {
      case 'agent_start':
        this.isBusy = true;
        this.markTurnStart();
        this.emitStatus({ isBusy: true, active: this.active, turnStartedAt: this.turnStartedAt });
        this.notifyUpdate(true);
        break;

      // 会话名变化（自动命名 / 任务标题 / 用户重命名）：把新标题推给界面即时替换
      case 'session_info_changed': {
        const title = typeof record.name === 'string' ? record.name.trim() : '';
        if (!title) break;
        if (process.env.NODE_ENV !== 'production') {
          this.emitLog('system', `[会话命名] ${title}`);
        }
        this.emitEvent({ kind: 'title', taskId: this.taskId, title });
        break;
      }

      case 'turn_start':
        this.isBusy = true;
        this.turnSeq += 1;
        this.markTurnStart();
        this.emitStatus({ isBusy: true, turnStartedAt: this.turnStartedAt });
        this.notifyUpdate(true);
        break;

      case 'message_start': {
        const msg = record.message;
        if (!msg) break;

        if (msg.role === 'user') {
          // 新消息会以当前叶子为父追写，叶子回到文件末尾，跟踪值失效
          this.leafEntryId = undefined;
          const userText = Array.isArray(msg.content)
            ? msg.content.map((c: any) => c.text || '').join('')
            : String(msg.content || '');

          // pi 采纳该输入：本地回显退出，会话流接管（单源，不会重复）
          const taken = this.takePendingInput(userText);

          const userMessage: SessionChatMessage = {
            id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: 'user',
            content: userText,
            attachments: taken?.attachments,
            timestamp: taken?.createdAt ?? Date.now(),
            turn: this.turnSeq || undefined,
            source: 'live',
          };
          this.messages.push(userMessage);
          this.emitMessage(userMessage);
          this.rememberLiveMessage(msg, userMessage);
          if (taken) this.emitPending();
          this.notifyUpdate(true);
        } else if (msg.role === 'assistant') {
          // 会话没指定模型时模型由 pi 决定，只能从消息里得知：记下来供输入框显示与后续消息沿用
          const fullModel = formatFullModel(msg.model, msg.provider, this.model);
          if (fullModel) this.model = fullModel;
          const newAssistantMsg: SessionChatMessage = {
            id: `msg_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: '',
            isStreaming: true,
            isThinking: false,
            tools: [],
            timestamp: Date.now(),
            turn: this.turnSeq || undefined,
            model: fullModel || this.model,
            source: 'live',
          };
          this.currentAssistantMessage = newAssistantMsg;
          this.messages.push(newAssistantMsg);
          this.emitMessage(newAssistantMsg);
          this.rememberLiveMessage(msg, newAssistantMsg);
          this.notifyUpdate(true);
        }
        break;
      }

      case 'message_update': {
        const ev = record.assistantMessageEvent;
        if (!ev || !this.currentAssistantMessage) break;

        if (ev.type === 'thinking_start') {
          this.currentAssistantMessage.isThinking = true;
          this.emitMessagePatch(this.currentAssistantMessage.id, { isThinking: true });
          this.notifyUpdate();
        } else if (ev.type === 'thinking_delta') {
          this.currentAssistantMessage.isThinking = true;
          this.currentAssistantMessage.thinking = (this.currentAssistantMessage.thinking || '') + (ev.delta || '');
          this.emitDelta('thinking', ev.delta || '', { isThinking: true });
        } else if (ev.type === 'thinking_end') {
          this.currentAssistantMessage.isThinking = false;
          if (ev.content) {
            this.currentAssistantMessage.thinking = ev.content;
          }
          this.emitMessagePatch(this.currentAssistantMessage.id, {
            isThinking: false,
            thinking: this.currentAssistantMessage.thinking,
          });
          this.notifyUpdate();
        } else if (ev.type === 'text_start') {
          this.currentAssistantMessage.isStreaming = true;
          this.emitMessagePatch(this.currentAssistantMessage.id, { isStreaming: true });
          this.notifyUpdate();
        } else if (ev.type === 'text_delta') {
          this.currentAssistantMessage.isStreaming = true;
          this.currentAssistantMessage.content = (this.currentAssistantMessage.content || '') + (ev.delta || '');
          this.emitDelta('content', ev.delta || '', { isStreaming: true });
        } else if (ev.type === 'text_end') {
          if (ev.content) {
            this.currentAssistantMessage.content = ev.content;
          }
          this.emitMessagePatch(this.currentAssistantMessage.id, {
            content: this.currentAssistantMessage.content,
          });
          this.notifyUpdate();
        } else if (ev.type === 'error') {
          const errText = ev.error?.message || ev.error || ev.reason || '流式输出异常';
          const errMsg = typeof errText === 'string' ? errText : JSON.stringify(errText);
          this.lastError = errMsg;
          this.emitLog('stderr', `[Agent 报错] ${errMsg}`);
          if (this.currentAssistantMessage) {
            this.currentAssistantMessage.errorMessage = errMsg;
            this.currentAssistantMessage.stopReason = 'error';
            this.emitMessagePatch(this.currentAssistantMessage.id, {
              errorMessage: errMsg,
              stopReason: 'error',
            });
          }
          this.notifyUpdate(true);
        }
        break;
      }

      case 'tool_execution_start': {
        const owner = this.ensureTool(record);
        if (owner) {
          owner.tool.args = record.args;
          owner.tool.input = summarizeToolInput(record.args);
          if (!owner.tool.kind) owner.tool.kind = classifyToolKind(owner.tool.name);
          // 写入类工具：改动前内容已由捕获桥在工具执行前写盘，这里只记下本次改动的标识
          if (owner.tool.kind === 'write') {
            const target = writeTargetOf(record.args, this.resolvedCwd || this.cwd || process.cwd());
            if (target) {
              const changeId = changeIdOf(this.sessionId, record.toolCallId);
              rememberTurnWrite(this.sessionId, this.turnSeq, target, changeId);
              owner.tool.changeId = changeId;
              logger.debug(`改动捕获关联: ${target} → ${changeId} (第 ${this.turnSeq} 轮)`, undefined, {
                taskId: this.taskId,
              });
            }
          }
          this.emitTool(owner.messageId, owner.tool);
          this.notifyUpdate();
        }
        const toolLabel = record.toolName ? `[${record.toolName}]` : '';
        const argsPreview = record.args ? ` 参数: ${JSON.stringify(record.args).slice(0, 100)}` : '';
        this.emitLog('stdout', `[Agent 工具调用] 正在执行 ${toolLabel}${argsPreview}`);
        break;
      }

      case 'tool_execution_end': {
        const owner = this.ensureTool(record);
        let toolName = '';
        if (owner) {
          owner.tool.result = compactToolResult(record.result);
          owner.tool.status = record.isError ? 'error' : 'success';
          owner.tool.durationMs = record.durationMs;
          const images = resultImageUrls(record.result);
          if (images.length > 0) owner.tool.imageUrls = images;
          toolName = owner.tool.name;
          this.emitTool(owner.messageId, owner.tool);
          this.notifyUpdate(true);
        }
        const statusText = record.isError ? '失败' : '完成';
        const costText = record.durationMs !== undefined ? ` (耗时: ${record.durationMs}ms)` : '';
        this.emitLog(
          record.isError ? 'stderr' : 'stdout',
          `[Agent 工具${statusText}] ${toolName ? `[${toolName}] ` : ''}执行${statusText}${costText}`
        );
        break;
      }

      case 'message_end': {
        const msg = record.message;
        if (!msg) break;
        this.bindEntryId(msg);
        if (msg.role !== 'assistant') break;

        const rawContent = msg?.content;
        const contentText = typeof rawContent === 'string'
          ? rawContent
          : Array.isArray(rawContent)
            ? rawContent.filter((c: any) => c.type === 'text').map((c: any) => c.text || '').join('')
            : '';

        if (this.currentAssistantMessage) {
          this.currentAssistantMessage.isStreaming = false;
          this.currentAssistantMessage.isThinking = false;
          if (contentText) {
            if (contentText.includes(PIPELINE_DONE_MARKER)) this.doneMarkerSeen = true;
            this.currentAssistantMessage.content = this.stripDoneMarker(contentText);
            // 将 Agent 生成的最终结论同步打入终端日志，便于在终端抽屉中闭环查看
            const summaryText = this.currentAssistantMessage.content.trim();
            if (summaryText) {
              this.emitLog('stdout', `[Agent 输出] ${summaryText.slice(0, 300)}${summaryText.length > 300 ? '...' : ''}`);
            }
          }
          if (msg?.errorMessage || msg?.stopReason === 'error') {
            const errorText = msg?.errorMessage || '模型调用失败';
            this.lastError = errorText;
            this.currentAssistantMessage.errorMessage = errorText;
            this.currentAssistantMessage.stopReason = msg?.stopReason || 'error';
            this.emitLog('stderr', `[Agent 报错] 模型接口异常: ${errorText}`);
          }
          // 用量与模型归属：供输入框上方统计胶囊与工具卡展示
          const usage = compactUsage(msg?.usage);
          if (usage) this.currentAssistantMessage.usage = usage;
          if (msg?.model) {
            const fullModel = formatFullModel(msg.model, msg.provider, this.model);
            if (fullModel) {
              this.model = fullModel;
              this.currentAssistantMessage.model = fullModel;
            }
          }
          if (msg?.stopReason) this.currentAssistantMessage.stopReason = msg.stopReason;
          this.emitMessage(this.currentAssistantMessage);
          this.notifyUpdate(true);
          this.currentAssistantMessage = null;
        } else if (msg?.errorMessage || msg?.stopReason === 'error') {
          const errorText = msg?.errorMessage || '模型调用失败';
          this.lastError = errorText;
          this.emitLog('stderr', `[Agent 报错] 模型接口异常: ${errorText}`);
        }
        break;
      }

      case 'turn_end': {
        // 轮末补齐改动后内容：之后再打开 diff 页签就不用等
        finishTurnChanges(this.sessionId, this.turnSeq);
        this.flushEntryIds();
        const msg = record.message;
        if (msg?.errorMessage || msg?.stopReason === 'error') {
          const errorText = msg.errorMessage || '模型调用失败';
          this.lastError = errorText;
          const targetMsg =
            this.currentAssistantMessage ||
            this.messages.slice().reverse().find((m) => m.role === 'assistant');
          if (targetMsg) {
            targetMsg.errorMessage = errorText;
            targetMsg.stopReason = msg.stopReason || 'error';
            this.emitMessagePatch(targetMsg.id, { errorMessage: errorText, stopReason: msg.stopReason || 'error' });
          }
        }
        // 一轮结束即空闲：状态位必须同时落到快照，否则快照仍报忙碌，界面运行指示会赖着不消失
        this.isBusy = false;
        this.emitStatus({ isBusy: false });
        this.notifyUpdate(true);
        break;
      }

      case 'agent_settled': {
        this.isBusy = false;
        // 轮末兜底：没收到 turn_end 时也把改动后内容补齐
        finishTurnChanges(this.sessionId, this.turnSeq);
        // 还差条目 id 的消息再补一次：界面按条目合并，缺一个 key 就会多出一行
        this.flushEntryIds();
        // 一轮结束后仍未送达的输入不会再进本轮，回显层清零；若 pi 稍后采纳，会话流仍会显示它
        this.clearPendingInputs();
        this.finishTurn();
        if (this.currentAssistantMessage) {
          // 流式增量拼接的文本也可能携带完成标记，兜底判定一次
          if (this.currentAssistantMessage.content?.includes(PIPELINE_DONE_MARKER)) this.doneMarkerSeen = true;
          this.currentAssistantMessage.isStreaming = false;
          this.currentAssistantMessage.isThinking = false;
          this.emitMessagePatch(this.currentAssistantMessage.id, { isStreaming: false, isThinking: false });
          this.currentAssistantMessage = null;
        }
        this.emitStatus({
          isBusy: false,
          active: this.active,
          turnStartedAt: this.turnStartedAt,
          lastTurnDurationMs: this.lastTurnDurationMs,
        });
        this.notifyUpdate(true);

        // 本轮空闲后应用排队中的模型 / 思考强度变更
        this.flushPendingSettings().catch((err) => {
          logger.error(`应用排队中的运行时配置失败: ${err?.message || err}`, undefined, {
            taskId: this.taskId,
          });
        });

        // 首次提示执行结束且没有在等待排队消息时，通知节点执行完成
        if (this.initialPromptSent && !this.executionCompleted && !record.aborted && !this.isPaused) {
          if (this.lastError) {
            // 本轮执行发生模型或系统报错，直接标记失败并通知错误，绝不能误判为“等待用户确认”
            this.executionCompleted = true;
            this.awaitingInput = false;
            if (this.onFinishedCallback) {
              this.onFinishedCallback(this.lastError);
            }
          } else if (this.awaitCompletionMarker && !this.doneMarkerSeen) {
            // 未声明完成：视为仍在向用户确认信息，节点保持运行并等待用户回复，绝不流转下游
            if (!this.awaitingInput) {
              this.awaitingInput = true;
              this.emitLog(
                'system',
                '[等待用户回复] Agent 本轮未声明完成，流水线停留在本节点，不会流转到下一个节点'
              );
              this.notifyUpdate();
            }
          } else {
            this.executionCompleted = true;
            if (this.onFinishedCallback) {
              this.onFinishedCallback();
            }
          }
        }
        break;
      }
    }
  }

  /**
   * 在同一个会话文件内切换叶子（pi 的 /tree 语义）
   * 不产生模型调用，代价是一次进程内指针移动。
   */
  public async navigateTo(entryId: string): Promise<void> {
    const session = await this.ready;
    if (!this.active) throw new Error('会话未启动，无法切换分支');
    await session.navigateTree(entryId, { summarize: false });
  }

  /** 用指定分支的消息替换实时消息列表（导航后由上层按新分支重建） */
  public replaceMessages(messages: SessionChatMessage[]) {
    this.messages = messages;
    this.currentAssistantMessage = null;
    this.notifyUpdate(true);
  }

  /**
   * 从某条消息分叉出新会话：新会话以该条目为末尾（含这条回答），源会话的消息不动。
   * 分叉会换掉活跃会话，所以这里跟着换本地 session id 并重建会话实例。
   */
  public async fork(entryId: string): Promise<{
    cancelled?: boolean;
    sessionId: string;
  }> {
    const session = await this.ready;
    if (!this.active) throw new Error('会话未启动，无法分叉');
    const sourceFile = session.sessionFile;
    if (!sourceFile) throw new Error('当前会话没有会话文件，无法分叉');

    // 另开一个管理器做分支，不动正在运行的会话
    const sourceManager = piSdk().SessionManager.open(sourceFile);
    const forkedFile = sourceManager.createBranchedSession(entryId);
    if (!forkedFile) throw new Error('分叉失败：新会话文件未生成');
    const forkCwd = this.resolvedCwd || this.cwd || process.cwd();
    const next = await this.createSession(sourceManager, forkCwd);

    session.dispose();
    this.session = next;
    this.sessionId = next.sessionId;
    // 分叉后当前上下文已被替换：同步新会话的历史，由前端按新分支重新渲染
    this.messages = [];
    await this.seedMessagesFromDisk(next);
    this.leafEntryId = undefined;
    this.clearPendingInputs();
    this.currentAssistantMessage = null;
    this.isBusy = false;
    this.isPaused = false;
    this.awaitingInput = false;
    const title = this.options.taskTitle?.trim();
    if (title) next.setSessionName(`openLoop: ${title.slice(0, 50)}`);
    logger.info(`会话分叉: ${entryId} -> ${next.sessionId}`, undefined, { taskId: this.taskId });
    return { cancelled: false, sessionId: next.sessionId };
  }

  /**
   * 发送普通提示词（启动新轮次）
   * prompt() 要等本轮跑完才 resolve，所以这里不 await：受理由 agent_settled 事件驱动完成判定。
   */
  public async sendPrompt(message: string, attachments?: TaskAttachment[]): Promise<any> {
    this.isPaused = false;
    this.isBusy = true;
    this.awaitingInput = false;
    this.doneMarkerSeen = false;
    this.lastError = undefined;
    this.markTurnStart();

    // 先只上回显层：气泡立即出现，会话流等 pi 采纳后再接管
    const pendingId = this.queuePendingInput(message, attachments, 'turn');
    this.emitStatus({ isBusy: true, isPaused: false, awaitingInput: false, turnStartedAt: this.turnStartedAt });
    this.notifyUpdate(true);

    logger.info(
      `向 Agent 会话发送 Prompt: "${message.slice(0, 40)}" (含 ${attachments?.length || 0} 个图片附件)`,
      undefined,
      { taskId: this.taskId }
    );

    let session: AgentSession;
    try {
      session = await this.ready;
    } catch (err) {
      this.handlePromptFailure(err, pendingId);
      return { disposition: 'failed' };
    }
    const streaming = session.isStreaming;
    void session
      .prompt(composeMessage(message, attachments), {
        streamingBehavior: streaming ? 'steer' : undefined,
        source: 'rpc',
      })
      .catch((err) => this.handlePromptFailure(err, pendingId));
    if (streaming) this.markPendingQueued(pendingId);
    return { disposition: streaming ? 'queued' : 'started' };
  }

  /** 提示词被拒绝（无模型、无凭证等）：错误落到会话状态，界面照常展示 */
  private handlePromptFailure(err: any, pendingId: string | null) {
    const errMsg = err?.message || '发送 Prompt 失败';
    logger.error(`发送 Prompt 失败: ${errMsg}`, undefined, { taskId: this.taskId });
    this.emitLog('stderr', `[Agent 报错] ${errMsg}`);
    this.lastError = errMsg;
    if (pendingId) {
      this.pendingInputs = this.pendingInputs.filter((item) => item.id !== pendingId);
      this.emitPending();
    }
    this.isBusy = false;
    this.emitStatus({ isBusy: false, lastError: errMsg });
    this.notifyUpdate(true);
    if (this.onFinishedCallback && !this.executionCompleted) {
      this.executionCompleted = true;
      this.awaitingInput = false;
      this.onFinishedCallback(errMsg);
    }
  }

  /**
   * 在运行中无缝插话 (Steer)
   */
  public async steer(message: string, attachments?: TaskAttachment[]): Promise<any> {
    this.isPaused = false;
    this.awaitingInput = false;
    this.lastError = undefined;
    // 先只上回显层：气泡立即出现，会话流等 pi 采纳后再接管
    const pendingId = this.queuePendingInput(message, attachments, 'steering');
    this.emitStatus({ awaitingInput: false });
    this.notifyUpdate(true);

    logger.info(
      `向 Agent 会话进行 Steer 插话: "${message.slice(0, 40)}" (含 ${attachments?.length || 0} 个图片附件)`,
      undefined,
      { taskId: this.taskId }
    );

    let session: AgentSession;
    try {
      session = await this.ready;
    } catch (err) {
      this.handlePromptFailure(err, pendingId);
      return { disposition: 'failed' };
    }
    const disposition = await session.steer(composeMessage(message, attachments), undefined, { source: 'rpc' });
    if (disposition === 'queued') this.markPendingQueued(pendingId);
    return { disposition };
  }

  /**
   * 用户直接从输入框发消息（自动智能选择 prompt 或 steer）
   */
  public async sendUserMessage(message: string, attachments?: TaskAttachment[]): Promise<any> {
    if (this.isBusy) {
      return this.steer(message, attachments);
    } else {
      return this.sendPrompt(message, attachments);
    }
  }

  /**
   * 暂停会话 (中止当前推理和工具执行，进入空闲待命)
   */
  public async pause(): Promise<boolean> {
    if (!this.active) return false;
    this.isPaused = true;
    this.isBusy = false;
    this.clearPendingInputs();
    this.finishTurn();
    if (this.currentAssistantMessage) {
      this.currentAssistantMessage.isStreaming = false;
      this.currentAssistantMessage.isThinking = false;
      this.emitMessagePatch(this.currentAssistantMessage.id, { isStreaming: false, isThinking: false });
      this.currentAssistantMessage = null;
    }
    this.emitStatus({ isPaused: true, isBusy: false, turnStartedAt: this.turnStartedAt });
    this.notifyUpdate(true);

    try {
      const session = await this.ready;
      await withTimeout(session.abort(), 1500, 'abort');
      return true;
    } catch (e: any) {
      logger.warn(`中止超时或失败 (${e.message})，销毁会话实例以恢复待命`, undefined, {
        taskId: this.taskId,
      });
      this.terminate();
      return true;
    }
  }

  /**
   * 恢复会话 (继续让 Agent 推进)
   */
  public async resume(): Promise<boolean> {
    this.isPaused = false;
    this.lastError = undefined;
    try {
      await this.sendPrompt('请继续完成刚才的工作。');
      return true;
    } catch (e: any) {
      logger.error(`恢复会话失败: ${e.message}`, undefined, { taskId: this.taskId });
      return false;
    }
  }

  /**
   * 运行时同步模型 / 思考强度（不重建会话、不丢上下文）
   * 忙碌中或正在切换时暂存，本轮结束后由 flushPendingSettings 自动应用
   */
  public async applyRuntimeSettings(patch: RuntimeSettingsPatch): Promise<RuntimeSettingsApplyResult> {
    const modelPattern = patch.model === undefined ? undefined : patch.model.trim();
    const thinkingLevel = patch.thinking === undefined ? undefined : patch.thinking.trim();

    const modelChanged = modelPattern !== undefined && modelPattern !== this.modelPattern;
    const thinkingChanged = thinkingLevel !== undefined && thinkingLevel !== this.thinking;
    // 未变化直接跳过，避免无谓的会话内命令
    if (!modelChanged && !thinkingChanged) return 'applied';

    const effective: RuntimeSettingsPatch = {};
    let inheritsDefaultModel = false;
    if (modelChanged) {
      if (modelPattern === '') {
        // 留空表示继承引擎默认模型，无法热切换，只能在新建会话时生效
        inheritsDefaultModel = true;
      } else {
        effective.model = modelPattern;
      }
    }
    if (thinkingChanged) effective.thinking = thinkingLevel;

    // 仅剩下「继承默认模型」需求：不改会话模型，只标记待生效
    if (!effective.model && !effective.thinking) {
      this.pendingModel = '';
      this.modelError = undefined;
      this.notifyUpdate();
      return 'queued';
    }

    let result: RuntimeSettingsApplyResult;
    if (!this.active) {
      result = 'failed';
    } else if (this.isBusy || this.switching) {
      this.rememberPending(effective);
      this.notifyUpdate();
      return 'queued';
    } else {
      result = await this.applySettingsPatch(effective);
    }

    if (inheritsDefaultModel) {
      this.pendingModel = '';
      this.notifyUpdate();
      return result === 'failed' ? 'failed' : 'queued';
    }
    return result;
  }

  private rememberPending(patch: RuntimeSettingsPatch) {
    if (patch.model !== undefined) this.pendingModel = patch.model;
    if (patch.thinking !== undefined) this.pendingThinking = patch.thinking;
  }

  private async flushPendingSettings(): Promise<void> {
    if (!this.pendingModel && !this.pendingThinking) return;
    // 待生效模型为空字符串表示需继承引擎默认，只能等下次新建会话
    const patch: RuntimeSettingsPatch = {};
    if (this.pendingModel) patch.model = this.pendingModel;
    if (this.pendingThinking) patch.thinking = this.pendingThinking;
    if (!patch.model && !patch.thinking) return;
    this.pendingModel = undefined;
    this.pendingThinking = undefined;
    await this.applySettingsPatch(patch);
  }

  private async applySettingsPatch(patch: RuntimeSettingsPatch): Promise<RuntimeSettingsApplyResult> {
    this.switching = true;
    try {
      const session = await this.ready;
      if (patch.model) {
        const resolved = this.resolveModel(session, patch.model);
        if (!resolved) {
          this.modelError = `未找到唯一匹配的模型: ${patch.model}`;
          logger.warn(`模型切换失败，保留原模型: ${this.modelError}`, undefined, { taskId: this.taskId });
          this.notifyUpdate();
          return 'failed';
        }
        await withTimeout(session.setModel(resolved), 5000, 'set_model');
        this.model = `${resolved.provider}/${resolved.id}`;
        this.modelPattern = patch.model;
        // 模型换了，模型清单可能随之变化，下次重新取
        this.modelsCache = null;
      }

      if (patch.thinking) {
        session.setThinkingLevel(patch.thinking as any);
        this.thinking = patch.thinking;
      }

      this.modelError = undefined;
      this.pendingModel = undefined;
      this.pendingThinking = undefined;
      this.notifyUpdate();
      logger.info(
        `会话运行时配置已切换: 模型=${this.model || '继承默认'}, 思考强度=${this.thinking || '未设置'}`,
        undefined,
        { taskId: this.taskId }
      );
      return 'applied';
    } catch (e: any) {
      this.modelError = e?.message || '运行时配置切换失败';
      logger.error(`会话运行时配置切换失败，保留原模型: ${this.modelError}`, undefined, {
        taskId: this.taskId,
      });
      this.notifyUpdate();
      return 'failed';
    } finally {
      this.switching = false;
    }
  }

  /** 供上层列举可用模型（模型选择器） */
  public async listModels(): Promise<Array<{ id: string; provider: string; label?: string }>> {
    if (!this.active) return [];
    try {
      const session = await this.ready;
      return this.collectModels(session);
    } catch {
      return [];
    }
  }

  private collectModels(session: AgentSession): Array<{ id: string; provider: string; label?: string }> {
    if (this.modelsCache) return this.modelsCache;
    const models = session.modelRuntime.getAvailableSnapshot();
    const resolved = models
      .filter((m) => m && typeof m.id === 'string' && typeof m.provider === 'string')
      .map((m: any) => ({
        id: m.id,
        provider: m.provider,
        label: m.name ? `${m.name} (${m.provider}/${m.id})` : `${m.provider}/${m.id}`,
      }));
    this.modelsCache = resolved;
    if (resolved.length > 0) {
      PiSessionInstance.onModelsDiscovered?.(resolved);
    }
    return resolved;
  }

  /**
   * 将设置页的自由文本模型描述解析为 provider + modelId
   * 匹配优先级：provider/id 精确 → id 精确 → 唯一模糊匹配；歧义时放弃，绝不猜测
   */
  private resolveModel(session: AgentSession, pattern: string): any | null {
    // 去掉 pi CLI 支持的 :thinking 后缀，思考强度走 setThinkingLevel
    const target = pattern.split(':')[0].trim();
    if (!target) return null;

    const models = session.modelRuntime.getAvailableSnapshot();
    const slashIndex = target.indexOf('/');
    if (slashIndex > 0) {
      const provider = target.slice(0, slashIndex);
      const id = target.slice(slashIndex + 1);
      const hit = models.find((m) => m.provider === provider && m.id === id);
      if (hit) return hit;
      // 模型清单尚未就绪（凭证异步解析）时按 provider/id 直接取
      return session.modelRuntime.getModel(provider, id) || null;
    }

    const exact = models.filter((m) => m.id === target);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;

    const lower = target.toLowerCase();
    const fuzzy = models.filter((m) => `${m.provider}/${m.id}`.toLowerCase().includes(lower));
    return fuzzy.length === 1 ? fuzzy[0] : null;
  }

  /**
   * 获取当前会话状态快照
   */
  public getState(): TaskSessionState {
    return {
      taskId: this.taskId,
      active: this.active,
      isBusy: this.isBusy,
      isPaused: this.isPaused,
      awaitingInput: this.awaitingInput,
      turnStartedAt: this.turnStartedAt,
      lastTurnDurationMs: this.lastTurnDurationMs,
      messages: [...this.messages],
      pendingInputs: [...this.pendingInputs],
      agentName: this.agentName,
      model: this.model,
      pendingModel: this.pendingModel,
      modelError: this.modelError,
      lastError: this.lastError,
      sessionId: this.sessionId,
      piSessionId: this.sessionId,
      resumeCommand: resolveResumeCommand(this.sessionId),
    };
  }

  /**
   * 推送增量事件（单包小、按需推送）
   */
  private emitEvent(event: AgentStreamEvent) {
    this.eventSeq += 1;
    if (process.env.NODE_ENV !== 'production' && this.eventSeq % 200 === 0) {
      logger.debug(`[Pi SDK] 已推送 ${this.eventSeq} 个增量事件 (${event.kind})`, undefined, {
        taskId: this.taskId,
      });
    }
    if (this.onEventCallback) {
      this.onEventCallback(event);
    }
    this.emit('stream', event);
  }

  /** 定位工具调用所属的消息，返回可变引用与消息 ID */
  private findToolOwner(toolCallId: string): { messageId: string; tool: ToolExecutionRecord } | null {
    if (toolCallId && this.currentAssistantMessage?.tools) {
      const tool = this.currentAssistantMessage.tools.find((t) => t.id === toolCallId);
      if (tool) return { messageId: this.currentAssistantMessage.id, tool };
    }
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      const tool = message.tools?.find((t) => t.id === toolCallId);
      if (tool) return { messageId: message.id, tool };
    }
    return null;
  }

  /**
   * 工具卡来源：SDK 的工具调用事件带 toolCallId / toolName，流式增量里没有，
   * 所以工具卡统一在工具开始执行时建，同一个调用 id 只建一张。
   */
  private ensureTool(record: any): { messageId: string; tool: ToolExecutionRecord } | null {
    const existing = this.findToolOwner(record?.toolCallId);
    if (existing) return existing;
    if (!record?.toolCallId) return null;
    const message =
      this.currentAssistantMessage ||
      this.messages.slice().reverse().find((item) => item.role === 'assistant');
    if (!message) return null;
    if (!message.tools) message.tools = [];
    const tool: ToolExecutionRecord = {
      id: record.toolCallId,
      name: record.toolName,
      status: 'running',
      kind: classifyToolKind(record.toolName),
      cwd: this.cwd,
    };
    message.tools.push(tool);
    return { messageId: message.id, tool };
  }

  /** 流式文本增量：只在消息已存在时推送，避免半截消息污染状态 */
  private emitDelta(field: 'content' | 'thinking', delta: string, flags?: { isStreaming?: boolean; isThinking?: boolean }) {
    if (!delta) return;
    const message = this.currentAssistantMessage;
    if (!message) return;
    this.emitEvent({
      kind: 'message_delta',
      taskId: this.taskId,
      messageId: message.id,
      field,
      delta,
      isStreaming: flags?.isStreaming,
      isThinking: flags?.isThinking,
    });
  }

  /** 推送完整消息（新增或既有消息的整条覆盖） */
  private emitMessage(message: SessionChatMessage) {
    this.emitEvent({ kind: 'message', taskId: this.taskId, message });
  }

  /** 推送消息局部变更（状态翻转、错误信息等） */
  private emitMessagePatch(messageId: string, patch: Partial<SessionChatMessage>) {
    this.emitEvent({ kind: 'message_patch', taskId: this.taskId, messageId, patch });
  }

  /** 推送工具调用状态 */
  private emitTool(messageId: string, tool: ToolExecutionRecord) {
    this.emitEvent({ kind: 'tool', taskId: this.taskId, messageId, tool: compactToolForEvent(tool) });
  }

  /** 推送会话级状态位（忙碌、等待回复、模型等） */
  private emitStatus(patch: AgentStatusEvent['patch']) {
    this.emitEvent({ kind: 'status', taskId: this.taskId, patch });
  }

  /**
   * 全量快照：限频推送，首包立即发出，之后最多每 PI_SNAPSHOT_INTERVAL_MS 一包
   * @param immediate 强制立即推送（消息边界、错误、结束、会话销毁等）
   */
  private notifyUpdate(immediate = false) {
    if (this.snapshotTimer) {
      if (!immediate) {
        this.snapshotPending = true;
        return;
      }
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
      this.snapshotPending = false;
    }

    const state = this.getState();
    if (this.onUpdateCallback) {
      this.onUpdateCallback(state);
    }
    this.emit('update', state);
    this.emitEvent({ kind: 'snapshot', taskId: this.taskId, state });

    if (immediate) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      if (!this.snapshotPending) return;
      this.snapshotPending = false;
      this.notifyUpdate();
    }, PI_SNAPSHOT_INTERVAL_MS);
    this.snapshotTimer.unref?.();
  }

  /**
   * 彻底停止并销毁会话
   */
  public terminate() {
    this.active = false;
    this.isBusy = false;
    this.extensionUi.cancelAll();
    // 会话销毁：连同本轮改动的捕获记录与内容副本一起清理
    forgetSessionChanges(this.sessionId);
    this.session?.dispose();
    this.session = undefined;
    this.emitStatus({ active: false, isBusy: false });
    this.notifyUpdate(true);
  }
}

/** 小工具：把 Promise 套上超时，避免会话无响应时阻塞设置保存或终止链路 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`会话操作超时 (${label})`)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * 全局 Pi 会话管理器
 */
export class PiSessionManager extends EventEmitter {
  private static instance: PiSessionManager;
  private sessions = new Map<string, PiSessionInstance>();

  public static getInstance(): PiSessionManager {
    if (!PiSessionManager.instance) {
      PiSessionManager.instance = new PiSessionManager();
    }
    return PiSessionManager.instance;
  }

  public createSession(options: PiSessionOptions): PiSessionInstance {
    // 若已存在相同任务的活跃会话，先安全终止
    const existing = this.sessions.get(options.taskId);
    if (existing) {
      existing.terminate();
      this.sessions.delete(options.taskId);
    }

    const shouldAutoStart = options.autoStart !== false && Boolean(options.initialPrompt);
    const session = new PiSessionInstance({ ...options, autoStart: false });
    this.sessions.set(options.taskId, session);

    // 扩展 UI 请求（审批卡）转给上层：带上任务路由键，界面据此过滤
    session.on('uiRequest', (request) => {
      this.emit('uiRequest', { ...request, taskId: options.taskId, sessionId: session.sessionId });
    });

    if (shouldAutoStart) {
      session.sendInitialPrompt(options.initialPrompt, options.initialAttachments);
    }

    return session;
  }

  public getSession(taskId: string): PiSessionInstance | undefined {
    return this.sessions.get(taskId);
  }

  /** 正在跑一轮回复的会话 id：「智能体开发」面板据此显示运行指示 */
  public listBusySessionIds(): string[] {
    return [...this.sessions.values()]
      .filter((session) => session.active && session.isBusy)
      .map((session) => session.sessionId);
  }

  /** 按 pi 会话 id 取实时状态：流水线 agent 节点与全局会话共用同一份 pi 会话 */
  public getStateBySessionId(sessionId: string): TaskSessionState | undefined {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) return session.getState();
    }
    return undefined;
  }

  /** 按 pi 会话 id 取仍在运行的流水线会话：全局面板接管这类会话时复用同一个实例 */
  public findLiveBySessionId(sessionId: string): PiSessionInstance | undefined {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId && session.active) return session;
    }
    return undefined;
  }

  /**
   * 将模型 / 思考强度变更同步到所有活跃会话
   * 并行下发，不重建会话，不阻塞设置保存
   */
  public async applyRuntimeSettings(patch: RuntimeSettingsPatch): Promise<RuntimeSettingsApplySummary> {
    const sessions = [...this.sessions.values()];
    const summary: RuntimeSettingsApplySummary = { applied: 0, queued: 0, failed: 0 };
    if (sessions.length === 0) return summary;

    const results = await Promise.allSettled(sessions.map((s) => s.applyRuntimeSettings(patch)));
    for (const result of results) {
      if (result.status === 'fulfilled') {
        summary[result.value] += 1;
      } else {
        summary.failed += 1;
      }
    }

    logger.info(
      `运行时配置同步完成: ${sessions.length} 个活跃会话 (已生效 ${summary.applied}, 排队 ${summary.queued}, 失败 ${summary.failed})`
    );
    return summary;
  }

  public removeSession(taskId: string) {
    const session = this.sessions.get(taskId);
    if (session) {
      session.terminate();
      this.sessions.delete(taskId);
    }
  }

  public terminateAll() {
    for (const session of this.sessions.values()) {
      session.terminate();
    }
    this.sessions.clear();
  }
}
