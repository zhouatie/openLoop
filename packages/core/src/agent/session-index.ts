import { createHash } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { createLogger } from '../logger';
import type { SessionChatMessage, TaskAttachment, ToolExecutionRecord } from '../types';
import { classifyToolKind, compactUsage } from './agent-events';

const logger = createLogger('PiSessionIndex');

/** pi 默认会话根目录，可用环境变量或设置覆盖 */
export function resolveSessionRoot(): string {
  const override = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), '.pi', 'agent', 'sessions');
}

export interface PiSessionSummary {
  /** 会话 ID（头部声明的 id；缺失时由文件名推导） */
  id: string;
  /** 会话文件绝对路径，接回历史会话时使用 */
  path: string;
  cwd: string;
  createdAt: string;
  modifiedAt: string;
  /** 消息条目数（含工具结果） */
  messageCount: number;
  /** 首条用户消息摘要，供列表标题显示 */
  firstUserMessage: string;
  /** 最后一条助手消息使用的模型 */
  lastModel?: string;
  /** pi 自己的会话名（--name 或 TUI 侧自动重命名写入的 session_info.name） */
  sessionName?: string;
  parentSession?: string;
  /** 文件大小，用于变更检测与调试 */
  size: number;
}

/** 会话全文搜索命中项 */
export interface PiSessionSearchHit {
  id: string;
  path: string;
  cwd: string;
  modifiedAt: string;
  /** 命中处的上下文片段 */
  snippet: string;
  /** 会话内命中次数 */
  matches: number;
}

export interface PiSessionDetail {
  summary: PiSessionSummary;
  messages: SessionChatMessage[];
  /** 活动分支的叶子条目 ID，供后续分支操作使用 */
  leafEntryId?: string;
  model?: string;
  totalUsage?: { totalTokens?: number; cost?: number };
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  summary: PiSessionSummary;
}

/** 单个会话文件最多解析的字节数，防止异常大文件拖垮列表 */
/** 摘要扫描：从头读这么多，够了（首条用户消息 + 消息计数） */
const HEAD_SCAN_BYTES = 4 * 1024 * 1024;
/** 摘要扫描：再从尾部补一段，拿到最后一次 model_change */
const TAIL_SCAN_BYTES = 1 * 1024 * 1024;
/** 消息读取窗口：优先读文件尾部，长会话的最新几轮永远可见 */
const MAX_MESSAGE_BYTES = 12 * 1024 * 1024;
/** 全文搜索每个文件只看尾部这么多，控住总 IO */
const SEARCH_WINDOW_BYTES = 1024 * 1024;
const SNIPPET_CHARS = 120;
/** 首条用户消息截断长度 */
const TITLE_MAX_CHARS = 120;

function textOfContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block && block.type === 'text')
    .map((block: any) => block.text || '')
    .join('');
}

/** 历史里的图片块上限：太大会把会话响应撑爆，超过就只保留占位说明 */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_IMAGES = 6;

/** 把图片内容块还原成可直接渲染的附件（data URL），历史会话里的截图才能看见 */
function imagesOfContent(content: any, entryId: string): TaskAttachment[] {
  if (!Array.isArray(content)) return [];
  const attachments: TaskAttachment[] = [];
  for (const block of content) {
    if (attachments.length >= MAX_INLINE_IMAGES) break;
    if (!block || block.type !== 'image' || typeof block.data !== 'string') continue;
    const mimeType = block.mimeType || 'image/png';
    const oversize = block.data.length > MAX_INLINE_IMAGE_BYTES;
    attachments.push({
      id: `${entryId}_img${attachments.length + 1}`,
      name: oversize ? '图片（过大，未内联）' : `图片 ${attachments.length + 1}`,
      size: Math.floor((block.data.length * 3) / 4),
      mimeType,
      path: '',
      url: oversize ? '' : `data:${mimeType};base64,${block.data}`,
      createdAt: 0,
    });
  }
  return attachments;
}

function thinkingOfContent(content: any): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block && block.type === 'thinking')
    .map((block: any) => block.thinking || '')
    .join('');
}

function idFromFileName(filePath: string): string {
  const base = path.basename(filePath, '.jsonl');
  const underscore = base.indexOf('_');
  return underscore >= 0 ? base.slice(underscore + 1) : base;
}

/**
 * pi 会话索引
 *
 * pi 把会话存成 JSONL 文件（每行一个条目），没有提供列举接口。
 * 这里按 (size, mtime) 缓存每个文件的解析结果，只重读变更过的文件。
 */
export class PiSessionIndex {
  private cache = new Map<string, CacheEntry>();
  private scanning?: Promise<PiSessionSummary[]>;

  constructor(private rootDir: string = resolveSessionRoot()) {}

  public getRootDir(): string {
    return this.rootDir;
  }

  /** 列举会话，按最后修改时间倒序 */
  public async list(options?: { cwd?: string; limit?: number }): Promise<PiSessionSummary[]> {
    // 同一时刻只跑一次扫描，避免并发请求重复遍历目录
    if (!this.scanning) {
      this.scanning = this.scan().finally(() => {
        this.scanning = undefined;
      });
    }
    const all = await this.scanning;
    let result = all;
    if (options?.cwd) {
      const target = path.resolve(options.cwd);
      result = result.filter((item) => path.resolve(item.cwd || '') === target);
    }
    if (options?.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }
    return result;
  }

  /** 按会话 ID 或文件路径定位会话 */
  public async find(idOrPath: string): Promise<PiSessionSummary | undefined> {
    if (!idOrPath) return undefined;
    if (idOrPath.endsWith('.jsonl') && fs.existsSync(idOrPath)) {
      return this.describeFile(idOrPath);
    }
    const all = await this.list();
    return all.find((item) => item.id === idOrPath);
  }

  /** 读取单个会话的消息序列（活动分支） */
  public async read(idOrPath: string, options?: { limit?: number }): Promise<PiSessionDetail | undefined> {
    const summary = await this.find(idOrPath);
    if (!summary) return undefined;
    const entries = await this.readEntries(summary.path);
    if (entries.length === 0) {
      return { summary, messages: [] };
    }

    const branch = selectActiveBranch(entries);
    const { messages, model, totalUsage, leafEntryId } = mapEntriesToMessages(branch, summary.id);
    const limited = options?.limit && options.limit > 0 ? messages.slice(-options.limit) : messages;
    return { summary, messages: limited, leafEntryId, model, totalUsage };
  }

  /**
   * 全文搜索：只看每个会话文件尾部的一段，避免把 2000 多个会话全量读进来。
   * 标题匹配由调用方用 list() 处理，这里只负责正文。
   */
  public async searchContent(
    query: string,
    options?: { limit?: number; maxFiles?: number }
  ): Promise<PiSessionSearchHit[]> {
    const keyword = query.trim().toLowerCase();
    if (keyword.length < 1) return [];
    const limit = options?.limit && options.limit > 0 ? options.limit : 30;
    const maxFiles = options?.maxFiles && options.maxFiles > 0 ? options.maxFiles : 160;
    const summaries = await this.list();
    const hits: PiSessionSearchHit[] = [];

    for (const summary of summaries.slice(0, maxFiles)) {
      if (hits.length >= limit) break;
      let window: { text: string; fromStart: boolean };
      try {
        window = await readFileTail(summary.path, SEARCH_WINDOW_BYTES);
      } catch (_) {
        continue;
      }
      const lines = window.text.split('\n');
      if (!window.fromStart) lines.shift();
      let matches = 0;
      let snippet = '';
      for (const line of lines) {
        if (!line || !line.toLowerCase().includes(keyword)) continue;
        try {
          const entry = JSON.parse(line);
          const message = entry?.message;
          if (!message) continue;
          const text =
            message.role === 'user' || message.role === 'assistant'
              ? textOfContent(message.content)
              : '';
          if (!text || !text.toLowerCase().includes(keyword)) continue;
          matches += 1;
          if (!snippet) snippet = snippetAround(text, keyword);
        } catch (_) {
          // 非 JSON 行或半行直接跳过
        }
      }
      if (matches > 0) {
        hits.push({
          id: summary.id,
          path: summary.path,
          cwd: summary.cwd,
          modifiedAt: summary.modifiedAt,
          snippet: snippet || query,
          matches,
        });
      }
    }

    return hits;
  }

  /** 会话文件变更后主动失效缓存 */
  public invalidate(filePath?: string) {
    if (filePath) this.cache.delete(filePath);
    else this.cache.clear();
  }

  private async scan(): Promise<PiSessionSummary[]> {
    const summaries: PiSessionSummary[] = [];
    let dirs: string[] = [];
    try {
      const entries = await fsp.readdir(this.rootDir, { withFileTypes: true });
      dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(this.rootDir, entry.name));
      // 兼容直接放在根目录下的会话文件
      const rootFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => path.join(this.rootDir, entry.name));
      for (const file of rootFiles) {
        const summary = await this.describeFile(file);
        if (summary) summaries.push(summary);
      }
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        logger.warn(`读取 pi 会话根目录失败: ${err?.message || err}`);
      }
      return [];
    }

    for (const dir of dirs) {
      let files: string[];
      try {
        files = (await fsp.readdir(dir)).filter((name) => name.endsWith('.jsonl'));
      } catch (_) {
        continue;
      }
      for (const name of files) {
        const summary = await this.describeFile(path.join(dir, name));
        if (summary) summaries.push(summary);
      }
    }

    // 清理已删除文件的缓存
    const alive = new Set(summaries.map((item) => item.path));
    for (const key of this.cache.keys()) {
      if (!alive.has(key)) this.cache.delete(key);
    }

    summaries.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
    return summaries;
  }

  private async describeFile(filePath: string): Promise<PiSessionSummary | undefined> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch (_) {
      return undefined;
    }
    if (!stat.isFile()) return undefined;

    const cached = this.cache.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.summary;
    }

    const summary = await parseSessionFile(filePath, stat);
    if (!summary) return undefined;
    this.cache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, summary });
    return summary;
  }

  private async readEntries(filePath: string): Promise<any[]> {
    const window = await readFileTail(filePath, MAX_MESSAGE_BYTES);
    const lines = window.text.split('\n');
    // 窗口从中间切进来时，首行一定是残缺的
    if (!window.fromStart) lines.shift();
    const entries: any[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch (_) {
        // 残缺的最后一行在流式写入时常见，直接跳过
      }
    }
    return entries;
  }
}

async function readFileHead(filePath: string, maxBytes = HEAD_SCAN_BYTES): Promise<string> {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString('utf-8');
  } finally {
    await handle.close();
  }
}

/** 读文件尾部 window 字节；fromStart 表示是否整份读完（没被截断） */
async function readFileTail(
  filePath: string,
  maxBytes: number
): Promise<{ text: string; fromStart: boolean }> {
  const handle = await fsp.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const fromStart = length >= stat.size;
    const offset = fromStart ? 0 : stat.size - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    return { text: buffer.toString('utf-8'), fromStart };
  } finally {
    await handle.close();
  }
}

async function parseSessionFile(filePath: string, stat: fs.Stats): Promise<PiSessionSummary | undefined> {
  let raw: string;
  try {
    raw = await readFileHead(filePath);
  } catch (_) {
    return undefined;
  }

  const lines = raw.split('\n');
  let header: any;
  let messageCount = 0;
  let firstUserMessage = '';
  let lastModel: string | undefined;
  /** pi 自己的会话名（--name 或 TUI 自动重命名写入的 session_info.name） */
  let sessionName: string | undefined;

  /** 开头没有 session 头的文件（例如 pi 分叉只写了增量条目）也要能读 */
  let hasSessionHeader = false;
  let firstLineChecked = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!firstLineChecked) {
      firstLineChecked = true;
      try {
        const first = JSON.parse(trimmed);
        if (first?.type === 'session') {
          header = first;
          hasSessionHeader = true;
          continue;
        }
      } catch (_) {
        // 首行损坏：放弃这个文件
        return undefined;
      }
      // 首行不是 session 头：当成无头文件，继续用这一行做统计
    }
    if (trimmed.includes('"type":"session_info"')) {
      try {
        const entry = JSON.parse(trimmed);
        if (typeof entry?.name === 'string' && entry.name.trim()) {
          sessionName = entry.name.trim().slice(0, TITLE_MAX_CHARS);
        }
      } catch (_) {}
      continue;
    }
    if (!trimmed.includes('"type":"message"')) {
      if (trimmed.includes('"type":"model_change"')) {
        try {
          const entry = JSON.parse(trimmed);
          if (entry?.modelId) {
            lastModel = entry.provider ? `${entry.provider}/${entry.modelId}` : entry.modelId;
          }
        } catch (_) {}
      }
      continue;
    }
    messageCount += 1;
    if (!firstUserMessage && trimmed.includes('"role":"user"')) {
      try {
        const entry = JSON.parse(trimmed);
        const text = textOfContent(entry?.message?.content);
        if (text.trim()) firstUserMessage = text.trim().slice(0, TITLE_MAX_CHARS);
      } catch (_) {}
    }
  }

  // 长会话：再扫一段尾部，补齐总消息数与最后一次模型
  if (stat.size > HEAD_SCAN_BYTES) {
    try {
      const tail = await readFileTail(filePath, TAIL_SCAN_BYTES);
      for (const line of tail.text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('{') === false) continue;
        if (trimmed.includes('"type":"session_info"')) {
          try {
            const entry = JSON.parse(trimmed);
            if (typeof entry?.name === 'string' && entry.name.trim()) {
              sessionName = entry.name.trim().slice(0, TITLE_MAX_CHARS);
            }
          } catch (_) {}
        } else if (trimmed.includes('"type":"message"')) messageCount += 1;
        else if (trimmed.includes('"type":"model_change"')) {
          try {
            const entry = JSON.parse(trimmed);
            if (entry?.modelId) {
              lastModel = entry.provider ? `${entry.provider}/${entry.modelId}` : entry.modelId;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  return {
    id: (hasSessionHeader && header?.id) || idFromFileName(filePath),
    path: filePath,
    cwd: (hasSessionHeader && header?.cwd) || deriveCwdFromFolder(filePath),
    createdAt: (hasSessionHeader && header?.timestamp) || stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
    messageCount,
    firstUserMessage: firstUserMessage || deriveFolderTitle(filePath),
    lastModel,
    sessionName,
    parentSession: hasSessionHeader ? header?.parentSession : undefined,
    size: stat.size,
  };
}

/** 取命中词附近的一段文本作为摘要 */
function snippetAround(text: string, keyword: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const index = flat.toLowerCase().indexOf(keyword);
  if (index < 0) return flat.slice(0, SNIPPET_CHARS);
  const start = Math.max(0, index - Math.floor(SNIPPET_CHARS / 2));
  const end = Math.min(flat.length, start + SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/** 目录名里的 `-` 同时代表路径分隔符和连字符，只能按真实文件系统贪心还原 */
function decodeEncodedPath(encoded: string, base: string): string {
  const segments = encoded.split('-').filter(Boolean);
  let dir = base;
  let index = 0;
  while (index < segments.length) {
    let next = '';
    // 尽量吃下更长的片段：`rn-community-collect-cards` 这类真实目录名含连字符
    for (let end = segments.length; end > index; end--) {
      const candidate = path.join(dir, segments.slice(index, end).join('-'));
      try {
        if (fs.statSync(candidate).isDirectory()) {
          next = candidate;
          index = end;
          break;
        }
      } catch (_) {
        // 该组合不存在，继续缩短
      }
    }
    if (!next) return '';
    dir = next;
  }
  return dir === base ? '' : dir;
}

const folderCwdCache = new Map<string, string>();

/** pi 用 `--<路径，/ 换成 ->--` 命名项目目录；缺会话头的文件只能靠目录名反推工作目录 */
function deriveCwdFromFolder(filePath: string): string {
  const folder = path.basename(path.dirname(filePath));
  if (folderCwdCache.has(folder)) return folderCwdCache.get(folder) as string;
  const encoded = folder.replace(/^-+|-+$/g, '');
  const resolved = encoded
    ? decodeEncodedPath(encoded, '/') || decodeEncodedPath(encoded, os.homedir()) || ''
    : '';
  folderCwdCache.set(folder, resolved);
  return resolved;
}

function deriveFolderTitle(filePath: string): string {
  return deriveCwdFromFolder(filePath) || path.basename(path.dirname(filePath));
}

/**
 * 取活动分支：pi 的会话是树，最后一条条目的祖先链就是当前展示的分支
 */
function selectActiveBranch(entries: any[]): any[] {
  const byId = new Map<string, any>();
  for (const entry of entries) {
    if (entry?.id) byId.set(entry.id, entry);
  }
  // v3 树结构：从最后一条有 parentId 的条目回溯
  let leaf: any | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry && typeof entry.parentId !== 'undefined' && entry.type !== 'session') {
      leaf = entry;
      break;
    }
  }
  if (!leaf || !leaf.id) {
    // v1 线性结构：整份文件就是一个分支
    return entries.filter((entry) => entry && entry.type !== 'session');
  }

  const chain: any[] = [];
  const seen = new Set<string>();
  let cursor: any = leaf;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  chain.reverse();
  return chain.filter((entry) => entry && entry.type !== 'session');
}

function mapEntriesToMessages(branch: any[], sessionId: string) {
  const messages: SessionChatMessage[] = [];
  const toolIndex = new Map<string, { message: SessionChatMessage; tool: ToolExecutionRecord }>();
  const usageTotal = { totalTokens: 0, cost: 0 };
  let model: string | undefined;
  let leafEntryId: string | undefined;
  let seq = 0;

  const nextId = (prefix: string, entry: any) =>
    `${prefix}_${entry?.id || `${sessionId}_${++seq}`}`;

  for (const entry of branch) {
    leafEntryId = entry?.id || leafEntryId;

    if (entry.type === 'model_change' && entry.modelId) {
      model = entry.provider ? `${entry.provider}/${entry.modelId}` : entry.modelId;
      continue;
    }

    if (entry.type === 'compaction') {
      messages.push({
        id: nextId('sys', entry),
        role: 'system',
        content: entry.summary ? `上下文已压缩：${String(entry.summary).slice(0, 200)}` : '上下文已压缩',
        timestamp: Date.parse(entry.timestamp) || Date.now(),
        source: 'history',
        entryId: entry.id,
      });
      continue;
    }

    if (entry.type === 'custom_message') {
      if (entry.display === false) continue;
      messages.push({
        id: nextId('sys', entry),
        role: 'system',
        content: textOfContent(entry.content),
        timestamp: Date.parse(entry.timestamp) || Date.now(),
        source: 'history',
        entryId: entry.id,
      });
      continue;
    }

    if (entry.type !== 'message') continue;
    const msg = entry.message || {};
    const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : Date.parse(entry.timestamp) || Date.now();

    if (msg.role === 'user') {
      const content = textOfContent(msg.content);
      const images = imagesOfContent(msg.content, entry.id || `${sessionId}_${seq}`);
      if (!content.trim() && images.length === 0) continue;
      messages.push({
        id: nextId('msg_u', entry),
        role: 'user',
        content,
        timestamp,
        source: 'history',
        entryId: entry.id,
        ...(images.length > 0 ? { attachments: images } : {}),
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const content = textOfContent(msg.content);
      const thinking = thinkingOfContent(msg.content);
      const tools: ToolExecutionRecord[] = [];
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.type === 'toolCall') {
            tools.push({
              id: block.id,
              name: block.name,
              args: block.arguments,
              input: block.arguments,
              kind: classifyToolKind(block.name),
              status: 'running',
            });
          }
        }
      }
      const usage = compactUsage(msg.usage);
      if (usage?.totalTokens) usageTotal.totalTokens += usage.totalTokens;
      if (usage?.cost) usageTotal.cost += usage.cost;
      if (msg.model) model = msg.model;

      const chatMessage: SessionChatMessage = {
        id: nextId('msg_a', entry),
        role: 'assistant',
        content,
        thinking: thinking || undefined,
        tools: tools.length > 0 ? tools : undefined,
        timestamp,
        usage,
        model: msg.model,
        stopReason: msg.stopReason,
        source: 'history',
        entryId: entry.id,
      };
      messages.push(chatMessage);
      for (const tool of tools) {
        toolIndex.set(tool.id, { message: chatMessage, tool });
      }
      continue;
    }

    if (msg.role === 'toolResult') {
      const hit = toolIndex.get(msg.toolCallId);
      if (!hit) continue;
      hit.tool.result = textOfContent(msg.content) || msg.content;
      hit.tool.status = msg.isError ? 'error' : 'success';
      // 截图类工具的结果是图片块，抽出来给工具卡渲染缩略图
      const images = imagesOfContent(msg.content, hit.tool.id);
      if (images.length > 0) {
        hit.tool.imageUrls = images.map((item) => item.url).filter(Boolean);
      }
    }
  }

  return {
    messages,
    model,
    totalUsage: usageTotal.totalTokens > 0 || usageTotal.cost > 0 ? usageTotal : undefined,
    leafEntryId,
  };
}

/** 计算会话内容的稳定指纹，用于客户端缓存判定 */
export function sessionFingerprint(summary: PiSessionSummary): string {
  return createHash('sha1').update(`${summary.path}:${summary.size}:${summary.modifiedAt}`).digest('hex').slice(0, 12);
}

export const piSessionIndex = new PiSessionIndex();
