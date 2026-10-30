/**
 * 用户文本里的 @ 引用解析。
 * 文件与目录沿用 dsh 的 file/folder 规则：`@path` 与 `@"path with space"`，
 * 目录以结尾斜杠区分，未加引号时忽略句末标点。
 * 会话引用用带 label 的链接写法 `@[标题](openloop-session:<id>)`，
 * 和 dsh 的 `@[label](dsh-session:...)` 同形，标题里的空格不再是分隔符。
 */

/** 会话引用的协议前缀，与 core 的 session-reference 一致 */
export const SESSION_SCHEME = 'openloop-session:';

/** 快照区块的起始标记：渲染气泡前要裁掉这段只读上下文 */
const REFERENCE_CONTEXT_MARKER = '\n\n## Referenced sessions\n';

/** base64url：载荷是 JSON 字符串，任意会话 id 都能原样往返 */
function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function decodeBase64Url(payload: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(payload)) throw new Error('非法载荷');
  const normalized = payload.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 会话 id → 规范 URI */
export function encodeSessionReference(sessionId: string): string {
  return `${SESSION_SCHEME}${encodeBase64Url(JSON.stringify(sessionId))}`;
}

/** 规范 URI → 会话 id */
export function decodeSessionReference(uri: string): string {
  if (!uri.startsWith(SESSION_SCHEME)) throw new Error('不是会话引用');
  const decoded: unknown = JSON.parse(decodeBase64Url(uri.slice(SESSION_SCHEME.length)));
  if (typeof decoded !== 'string') throw new Error('会话 id 不是字符串');
  return decoded;
}

/**
 * 去掉消息末尾的跨会话快照区块。
 * 快照是发给模型的后台资料，不该出现在用户气泡里。
 */
export function stripReferenceContext(text: string): string {
  const index = text.indexOf(REFERENCE_CONTEXT_MARKER);
  if (index < 0) return text;
  if (!text.includes('</referenced-sessions>', index)) return text;
  return text.slice(0, index);
}

export interface MentionRef {
  kind: 'file' | 'folder' | 'session';
  /** 文件/目录：去掉引号的相对路径（目录带结尾斜杠）；会话：会话 id */
  path: string;
  /** 行内展示的名字：路径末段或会话标题 */
  label: string;
  /** 原文片段，用作 tooltip */
  raw: string;
}

/** 会话引用的文本形式：标题里的方括号与反斜杠转义，保证语法不被正文破坏 */
export function sessionMention(label: string, id: string): string {
  const escaped = label.replace(/[\\\]]/gu, (match) => `\\${match}`);
  return `@[${escaped}](${encodeSessionReference(id)})`;
}

export type MentionRun = { type: 'text'; text: string } | { type: 'ref'; ref: MentionRef };

/**
 * 引用只能从词首开始：`foo@bar` 这类邮箱与 URL 不参与。
 * 第 1、2 组是会话引用的标题与目标，第 3 组是裸 URI，第 4 组是文件/目录 token。
 */
const TOKEN = /@\[((?:\\.|[^\\\]])*)\]\((openloop-session:[^\s)]*)\)|(openloop-session:[A-Za-z0-9_-]+)|(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu;
const TRAILING_PUNCT = /[.,;:!?，。；：！？]+$/u;

/** 判断一个 @ 片段是不是真的在指路径，避免把「@某人 帮我看下」当引用 */
function looksLikePath(path: string): boolean {
  // 非 ASCII 的 @ 后面多半是自然语言，只认目录写法
  if (!/^[\x20-\x7e]+$/.test(path)) return path.endsWith('/');
  return path.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(path);
}

/** 把一条用户文本切成普通片段与引用片段 */
export function splitMentions(text: string): MentionRun[] {
  const runs: MentionRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    // 会话引用：@[标题](openloop-session:<base64url>) 或裸 URI
    const sessionUri = match[2] ?? match[3];
    if (sessionUri !== undefined) {
      let id: string;
      try {
        id = decodeSessionReference(sessionUri);
      } catch (_) {
        continue;
      }
      const rawLabel = match[1];
      const label = rawLabel === undefined ? id : rawLabel.replace(/\\(.)/gu, '$1');
      if (start > cursor) runs.push({ type: 'text', text: text.slice(cursor, start) });
      runs.push({
        type: 'ref',
        ref: { kind: 'session', path: id, label: label.trim() || id, raw: match[0] },
      });
      cursor = start + match[0].length;
      continue;
    }
    const token = match[4] ?? match[0];
    const raw = token.startsWith('@"') ? token : token.replace(TRAILING_PUNCT, '');
    const path = raw.slice(1).replace(/^"|"$/gu, '');
    if (path.length === 0 || !looksLikePath(path)) continue;
    if (start > cursor) runs.push({ type: 'text', text: text.slice(cursor, start) });
    const label = path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
    runs.push({
      type: 'ref',
      ref: { kind: path.endsWith('/') ? 'folder' : 'file', path, label, raw },
    });
    cursor = start + raw.length;
  }
  if (runs.length === 0) return [{ type: 'text', text }];
  if (cursor < text.length) runs.push({ type: 'text', text: text.slice(cursor) });
  return runs;
}
