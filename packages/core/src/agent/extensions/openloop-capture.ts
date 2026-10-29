/**
 * openLoop 改动捕获桥
 *
 * 写入类工具执行前把「改动前」内容存一份，供会话工作台的 diff 页签使用。
 * 选在 pi 的 tool_call 钩子（工具执行前、被 await）而不是 openLoop 侧监听
 * tool_execution_start：后者要跨进程收事件，读写会与工具本身的写入抢时序。
 *
 * 目录与标识由 openLoop 启动会话进程时通过环境变量注入：
 * - OPENLOOP_CHANGE_DIR：本会话的捕获目录
 * - OPENLOOP_CHANGE_SESSION：会话 id，与 openLoop 一起推出同一个 changeId
 * - OPENLOOP_CHANGE_CWD：解析相对路径用的会话工作区
 * 缺一（独立运行 pi、无服务进程）时本扩展什么都不做。
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** 触发捕获的工具名：与 openLoop 的 ToolKind=write 判定一致 */
const WRITE_TOOLS = new Set(['write', 'edit', 'patch', 'apply_patch', 'multiedit']);

/** 单文件捕获上限（含）：与 dsh 默认值一致 */
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
/** 二进制探测窗口 */
const BINARY_PROBE_BYTES = 8000;

interface ToolCallEvent {
  toolCallId?: string;
  toolName?: string;
  input?: { path?: unknown };
}

interface ExtensionApi {
  on: (event: 'tool_call', handler: (event: ToolCallEvent) => Promise<void> | void) => unknown;
}

/** 与 openLoop 侧同一个算法：会话 + 工具调用 id 唯一确定一次捕获 */
function changeIdOf(sessionId: string, toolCallId: string): string {
  return crypto.createHash('sha1').update(`${sessionId}:${toolCallId}`).digest('hex');
}

/** 读文件字节：读取失败时当作不存在 */
function readOrUndefined(target: string): Buffer | undefined {
  try {
    return fs.readFileSync(target);
  } catch (_) {
    return undefined;
  }
}

/** 开发环境把捕获写进 stderr，跟着会话日志一起看 */
function debug(message: string): void {
  if (process.env.NODE_ENV !== 'production') {
    process.stderr.write(`[openloop-capture] ${message}\n`);
  }
}

/** 写一个空标记，表示这一侧没有可展示的文本 */
function writeMarker(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '');
}

function factory(pi: ExtensionApi) {
  const dir = process.env.OPENLOOP_CHANGE_DIR;
  const sessionId = process.env.OPENLOOP_CHANGE_SESSION;
  const cwd = process.env.OPENLOOP_CHANGE_CWD;
  if (!dir || !sessionId || !cwd) return;

  pi.on('tool_call', async (event) => {
    try {
      if (!event?.toolCallId || !event.toolName || !WRITE_TOOLS.has(event.toolName)) return;
      const target = typeof event.input?.path === 'string' ? event.input.path : undefined;
      if (!target) return;
      const absolute = path.resolve(cwd, target);
      const changeId = changeIdOf(sessionId, event.toolCallId);
      const contentFile = path.join(dir, `${changeId}.before`);
      // 同一次工具调用只捕获一次；重试与并发都靠这个判断去重
      if (fs.existsSync(contentFile)) return;

      let stats: fs.Stats | undefined;
      try {
        stats = fs.statSync(absolute);
      } catch (_) {
        stats = undefined;
      }
      if (!stats || !stats.isFile()) {
        writeMarker(dir, `${changeId}.before.absent`);
        return;
      }
      if (stats.size > MAX_CAPTURE_BYTES) {
        writeMarker(dir, `${changeId}.before.oversized`);
        return;
      }
      const bytes = readOrUndefined(absolute);
      if (!bytes) {
        writeMarker(dir, `${changeId}.before.absent`);
        return;
      }
      if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
        writeMarker(dir, `${changeId}.before.binary`);
        return;
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(contentFile, bytes);
      debug(`捕获改动前内容 ${absolute} (${bytes.length} 字节)`);
    } catch (err: any) {
      // 捕获失败不能挡住工具本身：这一轮没有 diff，页签会退回源码预览
      debug(`捕获失败 ${String(err?.message || err)}`);
    }
  });
}

export = factory;
