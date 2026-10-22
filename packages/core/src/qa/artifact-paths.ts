import fs from 'fs';
import path from 'path';

/**
 * 解析产物文件的绝对路径。
 * 产物相对路径（如 `artifacts/<runId>/x.png`）相对 OpenLoop 数据目录。
 * 返回 undefined 表示文件不存在。
 */
export function resolveArtifactPath(
  rawPath: string | undefined,
  dataDir: string,
  fallbackRelPath?: string
): string | undefined {
  const raw = rawPath || fallbackRelPath;
  if (!raw) return undefined;
  for (const candidate of [raw, path.join(dataDir, raw)]) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  return undefined;
}
