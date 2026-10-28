import fsp from 'fs/promises';
import { createLogger } from '../logger';
import type { SessionTreeNode, SessionTreeSnapshot } from '../types';

const logger = createLogger('PiSessionTree');

/** 单行预览上限：树只用于定位，正文由消息区展示 */
const PREVIEW_CHARS = 120;
/** 超过该长度的行（截图 base64 等）走正则取定位字段，不做整行 JSON 解析 */
const LARGE_LINE_BYTES = 64 * 1024;
/** 缓存会话数上限：树只在打开面板时读取 */
const MAX_CACHED_SESSIONS = 24;

interface TreeCache {
  /** 已消费到的字节偏移：会话文件只追加，后续读取只解析新增行 */
  offset: number;
  nodes: SessionTreeNode[];
  byId: Map<string, SessionTreeNode>;
}

const caches = new Map<string, TreeCache>();

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
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

/** pi 条目 → 树节点；不参与分支定位的条目（模型切换、用量、标签）直接跳过 */
function nodeOfEntry(entry: any): SessionTreeNode | null {
  if (!entry?.id || !entry.type) return null;
  const parentId = typeof entry.parentId === 'string' ? entry.parentId : null;

  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return {
      id: entry.id,
      parentId,
      kind: 'system',
      text: clip(entry.summary || (entry.type === 'compaction' ? '上下文已压缩' : '分支摘要')),
      timestamp: timestampOf(entry.timestamp),
    };
  }

  if (entry.type === 'custom_message') {
    return {
      id: entry.id,
      parentId,
      kind: 'system',
      text: clip(textOfContent(entry.content)) || '[消息]',
      timestamp: timestampOf(entry.timestamp),
    };
  }

  if (entry.type !== 'message') return null;
  const message = entry.message || {};
  const timestamp = timestampOf(message.timestamp ?? entry.timestamp);

  if (message.role === 'user') {
    return {
      id: entry.id,
      parentId,
      kind: 'user',
      text: clip(textOfContent(message.content)) || '[图片或附件]',
      timestamp,
    };
  }

  if (message.role === 'assistant') {
    const text = clip(textOfContent(message.content));
    return {
      id: entry.id,
      parentId,
      kind: 'assistant',
      text: text || (message.stopReason === 'aborted' ? '已中止' : '[工具调用]'),
      timestamp,
    };
  }

  if (message.role === 'toolResult' || message.role === 'bashExecution') {
    return {
      id: entry.id,
      parentId,
      kind: 'tool',
      text: '',
      toolName: message.toolName || (message.role === 'bashExecution' ? 'bash' : 'tool'),
      timestamp,
    };
  }

  return null;
}

/** 超长行的定位字段抽取：只做正则，代价与行长无关 */
function nodeOfLargeLine(line: string): SessionTreeNode | null {
  const id = /"id":"([^"\\]+)"/.exec(line)?.[1];
  if (!id) return null;
  const parentRaw = /"parentId":(null|"([^"\\]+)")/.exec(line);
  const type = /"type":"([^"\\]+)"/.exec(line)?.[1];
  const role = /"role":"([^"\\]+)"/.exec(line)?.[1];
  const timestamp = /"timestamp":"([^"]+)"/.exec(line)?.[1];
  const toolName = /"toolName":"([^"\\]+)"/.exec(line)?.[1];
  if (type !== 'message' && type !== 'custom_message') return null;
  const kind: SessionTreeNode['kind'] =
    role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'tool';
  return {
    id,
    parentId: parentRaw && parentRaw[1] !== 'null' ? parentRaw[2] : null,
    kind,
    text: '[长内容已省略]',
    toolName,
    timestamp: timestampOf(timestamp),
  };
}

/** 单行 → 节点；残缺行与无关条目返回 null */
function nodeOfLine(line: string): SessionTreeNode | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.length > LARGE_LINE_BYTES) return nodeOfLargeLine(trimmed);
  try {
    return nodeOfEntry(JSON.parse(trimmed));
  } catch (_) {
    // 流式写入中的半行
    return null;
  }
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
    return cache || { offset: 0, nodes: [], byId: new Map() };
  }

  // 文件被重写（版本迁移）或截断：丢弃缓存重来
  if (!cache || size < cache.offset) {
    cache = { offset: 0, nodes: [], byId: new Map() };
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
    const node = nodeOfLine(line);
    if (!node) continue;
    const previous = cache.byId.get(node.id);
    if (previous) Object.assign(previous, node);
    else {
      cache.nodes.push(node);
      cache.byId.set(node.id, node);
    }
  }
  cache.offset += end + 1;
  return cache;
}

/** leaf 到根的节点 id（根在前） */
function activeChain(byId: Map<string, SessionTreeNode>, leafId: string | null): string[] {
  const chain: string[] = [];
  let cursor = leafId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    const node = byId.get(cursor);
    if (!node) break;
    seen.add(cursor);
    chain.push(node.id);
    cursor = node.parentId;
  }
  return chain.reverse();
}

/**
 * 读取会话树
 *
 * @param leafId 显式叶子（进程内导航后的位置）。缺省时取文件最后一条，与 pi 重启后的语义一致；
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
      activeIds: activeChain(cache.byId, leaf),
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
