import fsp from 'fs/promises';
import { createLogger } from '../logger';
import type { SessionTreeNode, SessionTreeSnapshot } from '../types';

const logger = createLogger('PiSessionTree');

/** 单行预览上限：树只用于定位，正文由消息区展示 */
const PREVIEW_CHARS = 120;
/** 工具参数预览上限：够看清在哪个文件上做了什么 */
const ARG_PREVIEW_CHARS = 72;
/** 超过该长度的行（截图 base64 等）走正则取定位字段，不做整行 JSON 解析 */
const LARGE_LINE_BYTES = 64 * 1024;
/** 参数预览只扫前这么多字符：写文件类的参数可能带整段正文 */
const ARG_SCAN_CHARS = 4096;
/** 缓存会话数上限：树只在打开面板时读取 */
const MAX_CACHED_SESSIONS = 24;

interface TreeCache {
  /** 已消费到的字节偏移：会话文件只追加，后续读取只解析新增行 */
  offset: number;
  nodes: SessionTreeNode[];
  byId: Map<string, SessionTreeNode>;
  /** 全部条目的父指针（含不进树的工具结果）：还原叶子链时用 */
  parents: Map<string, string | null>;
}

const caches = new Map<string, TreeCache>();

function clip(text: string, limit = PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function textOfContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block && block.type === 'text')
    .map((block: any) => block.text || '')
    .join('');
}

function timestampOf(value: any): number {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 参数里最有定位价值的字段：命令、路径、查询词 */
const ARG_KEYS = ['command', 'path', 'file_path', 'filePath', 'pattern', 'query'];

function readable(text: string): string {
  // 参数可能是转义过的文本（\\n、\\"）：还原成一行可读预览
  return clip(text.replace(/\\[nrt]/g, ' ').replace(/\\(.)/g, '$1'), ARG_PREVIEW_CHARS);
}

/** 工具参数里最有定位价值的一句：命令、路径或查询词 */
function previewOfArgs(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of ARG_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return readable(value);
    }
    return '';
  }
  const text = typeof raw === 'string' ? raw : '';
  if (!text) return '';
  const head = text.slice(0, ARG_SCAN_CHARS);
  const match = /["'](?:command|file_path|filePath|path|pattern|query)["']\s*:\s*["']((?:[^"'\\]|\\.){1,400})/.exec(
    head
  );
  return readable(match ? match[1] : head);
}

type Base = Pick<SessionTreeNode, 'id' | 'parentId' | 'timestamp' | 'prevId'>;

/** pi 条目 → 树节点；不参与分支定位的条目（模型切换、用量、工具结果）返回 null */
function nodeOfEntry(entry: any, base: Base): SessionTreeNode | null {
  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return {
      ...base,
      kind: 'system',
      text: clip(entry.summary || (entry.type === 'compaction' ? '上下文已压缩' : '分支摘要')),
    };
  }

  if (entry.type === 'custom_message') {
    return { ...base, kind: 'system', text: clip(textOfContent(entry.content)) || '[消息]' };
  }

  if (entry.type !== 'message') return null;
  const message = entry.message || {};

  if (message.role === 'user') {
    return { ...base, kind: 'user', text: clip(textOfContent(message.content)) || '[图片或附件]' };
  }

  if (message.role === 'assistant') {
    const text = clip(textOfContent(message.content));
    if (text) return { ...base, kind: 'assistant', text };
    const calls: any[] = Array.isArray(message.content)
      ? message.content.filter((block: any) => block?.type === 'toolCall')
      : [];
    if (calls.length > 0) {
      const names = calls.map((call) => call.name || 'tool');
      return {
        ...base,
        kind: 'assistant',
        step: true,
        toolName: names.length > 1 ? `${names[0]} ×${names.length}` : names[0],
        text: previewOfArgs(calls[0].arguments),
      };
    }
    return { ...base, kind: 'assistant', text: message.stopReason === 'aborted' ? '已中止' : '[思考]' };
  }

  // 工具结果只是上一步的产物，不提供分支定位点，进树只会把墙刷满
  return null;
}

/** 超长行的定位字段抽取：只做正则，代价与行长无关 */
function nodeOfLargeLine(line: string, base: Base): SessionTreeNode | null {
  const type = /"type":"([^"\\]+)"/.exec(line)?.[1];
  const role = /"role":"([^"\\]+)"/.exec(line)?.[1];
  if (type !== 'message' && type !== 'custom_message') return null;
  if (type === 'message' && role !== 'user' && role !== 'assistant') return null;
  const toolName = /"toolName":"([^"\\]+)"/.exec(line)?.[1];
  return {
    ...base,
    kind: role === 'user' ? 'user' : 'assistant',
    text: '[长内容已省略]',
    toolName,
  };
}

interface ParsedLine {
  id: string;
  parentId: string | null;
  /** null 表示这行进了父指针、但不进树 */
  node: SessionTreeNode | null;
}

/** 单行 → 解析结果；残缺行与无关条目返回 null */
function parseLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let entry: any;
  if (trimmed.length > LARGE_LINE_BYTES) {
    const id = /"id":"([^"\\]+)"/.exec(trimmed)?.[1];
    if (!id) return null;
    // 只取 parentId 的值部分：整行 JSON 解析太贵
    const parentId = /"parentId":(?:null|"([^"\\]+)")/.exec(trimmed)?.[1] ?? null;
    const base: Base = {
      id,
      parentId,
      prevId: parentId,
      timestamp: timestampOf(/"timestamp":"([^"]+)"/.exec(trimmed)?.[1]),
    };
    return { id, parentId, node: nodeOfLargeLine(trimmed, base) };
  }
  try {
    entry = JSON.parse(trimmed);
  } catch (_) {
    // 流式写入中的半行
    return null;
  }
  if (!entry?.id || !entry.type) return null;
  const parentId = typeof entry.parentId === 'string' ? entry.parentId : null;
  const base: Base = {
    id: entry.id,
    parentId,
    prevId: parentId,
    timestamp: timestampOf(entry.message?.timestamp ?? entry.timestamp),
  };
  return { id: entry.id, parentId, node: nodeOfEntry(entry, base) };
}

/** 父指针穿过多条被跳过的条目，落到最近的进树祖先 */
function resolveParent(cache: TreeCache, parentId: string | null): string | null {
  let cursor = parentId;
  const seen = new Set<string>();
  while (cursor && !cache.byId.has(cursor)) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const next = cache.parents.get(cursor);
    if (next === undefined) return null;
    cursor = next;
  }
  return cursor;
}

/**
 * 增量读取会话文件
 *
 * 会话文件是追加写的 JSONL，因此只解析上次偏移之后的新增行；
 * 首次读取才处理全文件，之后打开面板的代价只与新增条目数有关。
 */
async function loadCache(sessionPath: string): Promise<TreeCache> {
  let cache = caches.get(sessionPath);
  let size = 0;
  try {
    size = (await fsp.stat(sessionPath)).size;
  } catch (_) {
    return cache || { offset: 0, nodes: [], byId: new Map(), parents: new Map() };
  }

  // 文件被重写（版本迁移）或截断：丢弃缓存重来
  if (!cache || size < cache.offset) {
    cache = { offset: 0, nodes: [], byId: new Map(), parents: new Map() };
    caches.set(sessionPath, cache);
    while (caches.size > MAX_CACHED_SESSIONS) {
      const oldest = caches.keys().next().value;
      if (!oldest || oldest === sessionPath) break;
      caches.delete(oldest);
    }
  }

  if (size === cache.offset) return cache;

  const handle = await fsp.open(sessionPath, 'r');
  let buffer: Buffer;
  try {
    const length = size - cache.offset;
    buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, cache.offset);
  } finally {
    await handle.close();
  }

  // 只消费到最后一个换行：尾部半行留到下次
  const end = buffer.lastIndexOf(0x0a);
  if (end < 0) return cache;
  for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    cache.parents.set(parsed.id, parsed.parentId);
    if (!parsed.node) continue;
    parsed.node.parentId = resolveParent(cache, parsed.parentId);
    const previous = cache.byId.get(parsed.node.id);
    if (previous) Object.assign(previous, parsed.node);
    else {
      cache.nodes.push(parsed.node);
      cache.byId.set(parsed.node.id, parsed.node);
    }
  }
  cache.offset += end + 1;
  return cache;
}

/** leaf 到根的节点 id（根在前） */
function activeChain(parents: Map<string, string | null>, leafId: string | null): string[] {
  const chain: string[] = [];
  let cursor = leafId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    cursor = parents.get(cursor) ?? null;
  }
  return chain.reverse();
}

/**
 * 读取会话树
 *
 * @param leafId 显式叶子（进程内导航后的位置）。缺省时取最后一条可定位条目，与 pi 重启后的语义一致；
 *               传 null 表示已回退到会话起点。
 */
export async function readSessionTree(
  sessionPath: string,
  leafId?: string | null
): Promise<SessionTreeSnapshot> {
  try {
    const cache = await loadCache(sessionPath);
    const tip = cache.nodes.length > 0 ? cache.nodes[cache.nodes.length - 1].id : null;
    const leaf = leafId === undefined ? tip : leafId;
    return {
      nodes: cache.nodes,
      activeIds: activeChain(cache.parents, leaf),
      leafId: leaf,
    };
  } catch (err: any) {
    logger.warn(`读取会话树失败: ${err?.message || err}`);
    return { nodes: [], activeIds: [], leafId: null };
  }
}

/** 会话文件变更后主动失效缓存 */
export function invalidateSessionTree(sessionPath?: string) {
  if (sessionPath) caches.delete(sessionPath);
  else caches.clear();
}
