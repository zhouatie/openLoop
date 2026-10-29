/**
 * 轮内改动的内容捕获：给工作台的 diff 页签提供「改动前 / 改动后」两侧原文。
 *
 * 改动前的内容由 pi 扩展 openloop-capture 在工具执行前写入（同进程、被 await，
 * 不会和工具自身的写入抢时序）；改动后在轮末由这里补齐。两侧都以
 * <会话目录>/<changeId>.before|after 落盘，缺失或不可展示时写同名空标记。
 * 记录只活在进程内与本次会话目录里：会话终止即删除，服务重启后历史轮次退回源码预览。
 * 口径与 deepseek-harness 的 workspace-changes 一致（MIT）：单文件 2 MB、
 * 首 8000 字节含 NUL 视为二进制。
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';

const logger = createLogger('TurnChanges');

/** 单文件捕获上限（含）：超过只记 oversized，不存内容 */
export const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
/** 二进制探测窗口：与 git 的判定一致 */
const BINARY_PROBE_BYTES = 8000;

/** 一侧的不可展示标记，其余情况都是同名的正文文件 */
type SideMarker = 'absent' | 'binary' | 'oversized';
type Side = 'before' | 'after';

/** 一次改动的两侧内容，供 diff 页签渲染 */
export interface ChangeDiff {
  path: string;
  kind: 'text' | 'binary' | 'oversized';
  /** 新建文件时为 null */
  before: string | null;
  /** 删除文件时为 null */
  after: string | null;
}

/** 一轮里的写入记录：改动前取工具执行前，改动后取轮末 */
interface TurnWrites {
  turn: number;
  /** changeId → 绝对路径：本轮捕获过的全部改动，轮末统一补改动后一侧 */
  ids: Map<string, string>;
}

let dataDir: string | undefined;
const turns = new Map<string, TurnWrites>();
/** changeId → 所属会话与绝对路径：读取时按它定位目录 */
const captures = new Map<string, { sessionId: string; path: string }>();

// ============ 目录与标识 ============

/** 数据目录由服务启动时注入；未注入时捕获整体关闭 */
export function configureTurnChanges(dir: string): void {
  dataDir = dir;
  logger.info(`改动捕获目录: ${changesRoot()}`);
}

function changesRoot(): string {
  return path.join(dataDir || '', 'changes');
}

/** 会话捕获目录：会话 id 可能带路径分隔符，编码后再落盘 */
export function changeCaptureDir(sessionId: string): string | undefined {
  if (!dataDir) return undefined;
  return path.join(changesRoot(), encodeURIComponent(sessionId || 'unknown'));
}

/**
 * 一次工具调用的捕获标识。
 * 与 pi 扩展 openloop-capture 用同一算法：会话 + toolCallId 唯一确定。
 */
export function changeIdOf(sessionId: string, toolCallId: string): string {
  return crypto.createHash('sha1').update(`${sessionId}:${toolCallId}`).digest('hex');
}

// ============ 捕获 ============

/** 读文件信息：不存在或没权限时当作不存在 */
function statOrUndefined(target: string): fs.Stats | undefined {
  try {
    return fs.statSync(target);
  } catch (_) {
    return undefined;
  }
}

/** 读文件字节：读取失败时当作不存在 */
function readOrUndefined(target: string): Buffer | undefined {
  try {
    return fs.readFileSync(target);
  } catch (_) {
    return undefined;
  }
}

/** 把一侧内容写进会话目录；不可展示的情况写空标记 */
function storeSide(dir: string, changeId: string, side: Side, absolute: string): void {
  const stats = statOrUndefined(absolute);
  const marker = (kind: SideMarker): void => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${changeId}.${side}.${kind}`), '');
  };
  if (!stats || !stats.isFile()) return marker('absent');
  if (stats.size > MAX_CAPTURE_BYTES) return marker('oversized');
  const bytes = readOrUndefined(absolute);
  if (!bytes) return marker('absent');
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) return marker('binary');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${changeId}.${side}`), bytes);
}

/**
 * 记下一次写入：改动前的内容已由 pi 扩展写盘，改动后等轮末补齐。
 * 同一文件在同一轮被写多次时，卡片只展示第一次那个改动（改动前是轮初的内容）。
 * @param absolute 写入目标的绝对路径
 * @param changeId 本次工具调用的捕获标识
 */
export function rememberTurnWrite(sessionId: string, turn: number, absolute: string, changeId: string): void {
  let state = turns.get(sessionId);
  if (!state || state.turn !== turn) {
    state = { turn, ids: new Map() };
    turns.set(sessionId, state);
  }
  state.ids.set(changeId, absolute);
  captures.set(changeId, { sessionId, path: absolute });
}

/** 轮末补齐改动后内容；重复调用只补还没写的那些 */
export function finishTurnChanges(sessionId: string, turn?: number): void {
  const state = turns.get(sessionId);
  const dir = changeCaptureDir(sessionId);
  if (!state || !dir) return;
  if (turn !== undefined && state.turn !== turn) return;
  for (const [changeId, absolute] of state.ids) {
    if (fs.existsSync(path.join(dir, `${changeId}.after`))) continue;
    storeSide(dir, changeId, 'after', absolute);
  }
}

// ============ 读取 ============

/** 一侧不可展示的标记 */
function sideMarker(dir: string, changeId: string, side: Side): SideMarker | undefined {
  for (const kind of ['oversized', 'binary', 'absent'] as const) {
    if (fs.existsSync(path.join(dir, `${changeId}.${side}.${kind}`))) return kind;
  }
  return undefined;
}

/** 一侧的正文；文件不存在时当作缺失 */
function sideText(dir: string, changeId: string, side: Side): string | null {
  const bytes = readOrUndefined(path.join(dir, `${changeId}.${side}`));
  return bytes ? bytes.toString('utf8') : null;
}

/**
 * 一次改动的两侧内容。
 * @returns 未知 changeId（进程重启、会话已清理）时为 undefined
 */
export function readChangeDiff(changeId: string): ChangeDiff | undefined {
  const capture = captures.get(changeId);
  if (!capture) return undefined;
  const dir = changeCaptureDir(capture.sessionId);
  if (!dir) return undefined;
  const before = sideMarker(dir, changeId, 'before');
  // 改动前一侧缺失说明扩展没参与到这次调用：当作没有捕获，让界面退回源码预览
  if (!before && !fs.existsSync(path.join(dir, `${changeId}.before`))) return undefined;
  const after = sideMarker(dir, changeId, 'after');
  if (before === 'oversized' || after === 'oversized') {
    return { path: capture.path, kind: 'oversized', before: null, after: null };
  }
  if (before === 'binary' || after === 'binary') {
    return { path: capture.path, kind: 'binary', before: null, after: null };
  }
  return {
    path: capture.path,
    kind: 'text',
    before: before === 'absent' ? null : sideText(dir, changeId, 'before'),
    after: after === 'absent' ? null : sideText(dir, changeId, 'after'),
  };
}

// ============ 清理 ============

/** 会话终止：删内存记录与捕获目录 */
export function forgetSessionChanges(sessionId: string): void {
  turns.delete(sessionId);
  for (const [changeId, capture] of captures) {
    if (capture.sessionId === sessionId) captures.delete(changeId);
  }
  const dir = changeCaptureDir(sessionId);
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err: any) {
    logger.warn(`清理改动目录失败: ${err?.message || err}`);
  }
}

/** 列举目录：读不到时返回 undefined */
function readDirOrUndefined(target: string): fs.Dirent[] | undefined {
  try {
    return fs.readdirSync(target, { withFileTypes: true });
  } catch (_) {
    return undefined;
  }
}

/** 启动清扫：删除不属于存活会话的残留目录（上次进程被强杀留下的） */
export function sweepTurnChanges(liveSessionIds: Iterable<string> = []): void {
  if (!dataDir) return;
  const entries = readDirOrUndefined(changesRoot());
  if (!entries) return;
  const live = new Set([...liveSessionIds].map((id) => encodeURIComponent(id)));
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || live.has(entry.name)) continue;
    try {
      fs.rmSync(path.join(changesRoot(), entry.name), { recursive: true, force: true });
      removed += 1;
    } catch (_) {
      /* 目录被占用时留给下次启动 */
    }
  }
  if (removed > 0) logger.info(`改动捕获清扫: 删除 ${removed} 个残留会话目录`);
}
