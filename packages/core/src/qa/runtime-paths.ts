import path from 'node:path';

/**
 * Midscene 调试产物目录名（位于应用数据目录下）
 */
const QA_TRACE_DIR_NAME = 'midscene';

/**
 * 解析 Midscene 运行期调试产物目录：截图 dump、规划日志、缓存
 */
export function getQaTraceDir(dataDir: string): string {
  return path.join(dataDir, QA_TRACE_DIR_NAME);
}

/**
 * 把 Midscene 调试产物收拢到应用数据目录。
 *
 * Midscene 默认写入进程工作目录下的 midscene_run/，开发期会污染仓库，
 * 打包后目录可能不可写。此处统一重定向，并可被存储清理统一回收。
 * 已显式设置 MIDSCENE_RUN_DIR 时尊重调用方配置。
 */
export function configureQaRuntimePaths(dataDir: string): void {
  if (!process.env.MIDSCENE_RUN_DIR) {
    process.env.MIDSCENE_RUN_DIR = getQaTraceDir(dataDir);
  }
}
