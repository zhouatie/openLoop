import fs from 'node:fs';
import path from 'node:path';

/**
 * 寻找本地打包或随工程附带的 scrcpy-server 二进制文件路径
 */
export function resolveScrcpyServerBinaryPath(): string | null {
  const candidates: string[] = [
    // 相对当前文件 (dist/preview 或 src/preview)
    path.resolve(__dirname, '../../bin/scrcpy-server'),
    path.resolve(__dirname, '../../../bin/scrcpy-server'),
    path.resolve(__dirname, '../bin/scrcpy-server'),
    // 根工作区路径
    path.resolve(process.cwd(), 'packages/core/bin/scrcpy-server'),
    path.resolve(process.cwd(), 'bin/scrcpy-server'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
