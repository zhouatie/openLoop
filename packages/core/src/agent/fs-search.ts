import { readdir, lstat } from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';

export interface FsSearchEntry {
  /** 相对工作区根的路径 */
  path: string;
  isDir: boolean;
}

/** 不遍历的目录名：依赖、构建产物与缓存，和 dsh 的默认排除表一致 */
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.gradle',
]);
/** 单次索引最多收多少条路径：超出的部分不参与搜索，防止巨型仓库拖垮内存 */
const MAX_ENTRIES = 50_000;
const MAX_RESULTS = 20;
/** 索引保鲜期：过期后先用旧索引答，重建在后台跑 */
const INDEX_TTL_MS = 10_000;

interface WorkspaceIndex {
  builtAt: number;
  entries: FsSearchEntry[];
}

const indexes = new Map<string, WorkspaceIndex>();
const building = new Map<string, Promise<FsSearchEntry[]>>();

/** 广度优先遍历工作区：只收路径，不读文件内容 */
async function scan(root: string): Promise<FsSearchEntry[]> {
  const entries: FsSearchEntry[] = [];
  const queue: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '' }];
  for (let cursor = 0; cursor < queue.length && entries.length < MAX_ENTRIES; cursor += 1) {
    const current = queue[cursor];
    if (!current) break;
    let dirents: Dirent[];
    try {
      dirents = await readdir(current.abs, { withFileTypes: true });
    } catch (err) {
      // 工作区根读不了等于没学到任何东西：不要把空索引缓存下来
      if (cursor === 0) throw err;
      // 其余读不了的子目录不贡献候选，其他分支照常
      continue;
    }
    for (const dirent of dirents) {
      const rel = current.rel ? `${current.rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (EXCLUDED_DIRS.has(dirent.name)) continue;
        entries.push({ path: rel, isDir: true });
        queue.push({ abs: path.join(current.abs, dirent.name), rel });
      } else if (dirent.isFile()) {
        entries.push({ path: rel, isDir: false });
      }
    }
  }
  return entries;
}

/** 重建索引：同一工作区同时只跑一次遍历，并发的查询共用同一次结果 */
function rebuild(root: string): Promise<FsSearchEntry[]> {
  const pending = building.get(root);
  if (pending) return pending;
  const task = scan(root)
    .then((entries) => {
      indexes.set(root, { builtAt: Date.now(), entries });
      return entries;
    })
    .finally(() => {
      building.delete(root);
    });
  building.set(root, task);
  return task;
}

/** 取索引：有旧索引就先答，过期只在后台重建，不把遍历挂在光标前 */
async function indexOf(root: string): Promise<FsSearchEntry[]> {
  const cached = indexes.get(root);
  if (!cached) return rebuild(root);
  if (Date.now() - cached.builtAt >= INDEX_TTL_MS) void rebuild(root).catch(() => undefined);
  return cached.entries;
}

/** 目录直列：查询带 / 时只看该层，和 dsh 的下钻行为一致 */
async function listLevel(root: string, dir: string, fragment: string): Promise<FsSearchEntry[]> {
  const segments = dir.split('/').filter(Boolean);
  // 目录直列不允许越出工作区
  if (segments.some((segment) => segment === '..' || segment === '.')) return [];
  const absolute = path.join(root, ...segments);
  let dirents: Dirent[];
  try {
    const info = await lstat(absolute);
    if (!info.isDirectory()) return [];
    dirents = await readdir(absolute, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const prefix = segments.length > 0 ? `${segments.join('/')}/` : '';
  // 隐藏项只在用户显式输入 . 时才列，和 dsh 的目录直列规则一致
  const showHidden = fragment.startsWith('.');
  const entries: FsSearchEntry[] = [];
  for (const dirent of dirents) {
    if (!showHidden && dirent.name.startsWith('.')) continue;
    if (dirent.isDirectory()) {
      if (EXCLUDED_DIRS.has(dirent.name)) continue;
      entries.push({ path: `${prefix}${dirent.name}`, isDir: true });
    } else if (dirent.isFile()) {
      entries.push({ path: `${prefix}${dirent.name}`, isDir: false });
    }
  }
  return rank(entries, fragment, () => true);
}

/** 全局模糊查询：隐藏路径只在用户显式输入 . 时才出现 */
function visibleForGlobalQuery(entryPath: string, query: string): boolean {
  if (query.startsWith('.') || query.includes('/.')) return true;
  return !entryPath.split('/').some((segment) => segment.startsWith('.'));
}

function score(entry: FsSearchEntry, query: string): number | undefined {
  if (query === '') return 0;
  const lower = entry.path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf('/') + 1);
  const dirBonus = entry.isDir ? 25 : 0;
  if (name === query) return 1000 + dirBonus;
  if (name.startsWith(query)) return 900 + dirBonus;
  if (name.includes(query)) return 700 + dirBonus;
  if (lower.includes(query)) return 500 + dirBonus;
  // 子序列兜底：`cmp` 也能命中 Composer.Menu.tsx 这类驼峰路径
  let cursor = 0;
  let gap = 0;
  for (const character of query) {
    const found = lower.indexOf(character, cursor);
    if (found < 0) return undefined;
    gap += found - cursor;
    cursor = found + 1;
  }
  return 300 + Math.max(0, 100 - gap) + dirBonus;
}

/** 打分排序：同名、前缀、包含、子序列逐级退让，目录优先，路径短的靠前 */
function rank(
  entries: FsSearchEntry[],
  query: string,
  filter: (entry: FsSearchEntry) => boolean
): FsSearchEntry[] {
  const needle = query.toLowerCase();
  const scored: Array<{ entry: FsSearchEntry; score: number }> = [];
  for (const entry of entries) {
    if (!filter(entry)) continue;
    const value = score(entry, needle);
    if (value !== undefined) scored.push({ entry, score: value });
  }
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      Number(right.entry.isDir) - Number(left.entry.isDir) ||
      left.entry.path.length - right.entry.path.length ||
      left.entry.path.localeCompare(right.entry.path)
  );
  return scored.slice(0, MAX_RESULTS).map((item) => item.entry);
}

/** @ 候选：带 / 的查询直列该层目录，其余查询在整个工作区里模糊排序 */
export async function searchWorkspaceFiles(root: string, rawQuery: string): Promise<FsSearchEntry[]> {
  const query = rawQuery.replaceAll('\\', '/');
  const slash = query.lastIndexOf('/');
  if (query === '' || slash >= 0) {
    return listLevel(root, slash < 0 ? '' : query.slice(0, slash + 1), slash < 0 ? query : query.slice(slash + 1));
  }
  const entries = await indexOf(root);
  return rank(entries, query, (entry) => visibleForGlobalQuery(entry.path, query.toLowerCase()));
}
