import fs from 'fs';
import path from 'path';

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

export interface FsListing {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

export interface FsFileContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

const MAX_TEXT_BYTES = 512 * 1024;
const HIDDEN_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);

/** 相对路径按调用方给的工作区解析（会话里引用的文件常是相对路径） */
function absolute(target: string, base?: string): string {
  const expanded = target.startsWith('~') ? path.join(process.env.HOME || '', target.slice(1)) : target;
  return path.resolve(base || process.cwd(), expanded);
}

/** 目录列举：只读，按文件夹优先 + 名称排序，隐藏 .git / node_modules */
export function listDirectory(target: string): FsListing {
  const dir = absolute(target || process.env.HOME || '/');
  const stats = fs.statSync(dir);
  if (!stats.isDirectory()) throw new Error('目标不是目录');

  const entries: FsEntry[] = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HIDDEN_NAMES.has(dirent.name)) continue;
    const full = path.join(dir, dirent.name);
    let size = 0;
    let mtime = 0;
    try {
      const info = fs.lstatSync(full);
      size = info.size;
      mtime = info.mtimeMs;
    } catch (_) {
      /* 权限不足或无权限的软链，保留条目但标记为 0 */
    }
    entries.push({ name: dirent.name, path: full, isDir: dirent.isDirectory(), size, mtime });
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, entries };
}

/** 新建子目录：名字必须是单段（不含路径分隔符），重名直接报错 */
export function createDirectory(parent: string, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('目录名不能为空');
  if (trimmed === '.' || trimmed === '..') throw new Error('目录名不合法');
  if (trimmed.includes('/') || trimmed.includes('\\')) throw new Error('目录名不能包含路径分隔符');

  const target = path.join(absolute(parent || process.env.HOME || '/'), trimmed);
  if (fs.existsSync(target)) throw new Error('同名文件或目录已存在');
  fs.mkdirSync(target);
  return target;
}

/** 文本读取：超限截断，二进制返回明确错误由前端转为预览不支持 */
export function readTextFile(target: string, base?: string, maxBytes = MAX_TEXT_BYTES): FsFileContent {
  const file = absolute(target, base);
  const stats = fs.statSync(file);
  if (!stats.isFile()) throw new Error('目标不是文件');

  const fd = fs.openSync(file, 'r');
  try {
    const length = Math.min(stats.size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    if (buffer.includes(0)) throw new Error('二进制文件不支持文本预览');
    return {
      path: file,
      content: buffer.toString('utf8'),
      size: stats.size,
      truncated: stats.size > maxBytes,
    };
  } finally {
    fs.closeSync(fd);
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

export function mimeOf(target: string): string {
  return MIME_BY_EXT[path.extname(target).toLowerCase()] || 'application/octet-stream';
}

export function statFile(target: string, base?: string): { path: string; size: number; mtime: number; mime: string } {
  const file = absolute(target, base);
  const stats = fs.statSync(file);
  return { path: file, size: stats.size, mtime: stats.mtimeMs, mime: mimeOf(file) };
}

export { absolute as resolveAbsolutePath };
