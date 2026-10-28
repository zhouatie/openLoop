import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from '../logger';

const logger = createLogger('PiExtensions');

/**
 * pi 扩展按包装载，每个包都会给进程启动加一份成本（实测：扩展管理器 +1.6s，
 * 子代理 +1.0s，绝大多数交互式扩展对流水线节点无用）。
 * 因此会话进程统一用 --no-extensions 关掉自动发现，只显式装载下面这份名单。
 */
export const DEFAULT_PI_EXTENSION_PACKAGES = [
  'pi-observational-memory',
  'pi-web-access',
  '@lucascardozo/pi-edit-guard',
  'pi-tool-repair',
];

/** pi 自身的包安装目录：npm 来源的包都在这里，git 来源的包不在候选范围内 */
const PI_NPM_ROOT = path.join(os.homedir(), '.pi', 'agent', 'npm', 'node_modules');

export interface InstalledPiExtension {
  name: string;
  version?: string;
  description?: string;
}

let enabledPackages: string[] = [...DEFAULT_PI_EXTENSION_PACKAGES];

/** 设置项未配置时回落到默认名单；配置为空数组表示只装 openLoop 自己的桥接扩展 */
function normalizePackages(list?: string[] | null): string[] {
  if (!Array.isArray(list)) return [...DEFAULT_PI_EXTENSION_PACKAGES];
  return [...new Set(list.filter((name): name is string => typeof name === 'string' && name.trim() !== ''))];
}

export function setEnabledPiExtensions(list?: string[] | null): void {
  enabledPackages = normalizePackages(list);
}

export function getEnabledPiExtensions(): string[] {
  return [...enabledPackages];
}

function readPackageManifest(name: string): { dir: string; manifest: any } | null {
  const dir = path.join(PI_NPM_ROOT, name);
  const manifestPath = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return { dir, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
  } catch {
    return null;
  }
}

/** 扫描本机已安装的 pi 扩展包，供设置页勾选 */
export function listInstalledPiExtensions(): InstalledPiExtension[] {
  const result: InstalledPiExtension[] = [];
  const collect = (scopeDir: string, prefix = '') => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(scopeDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const name = `${prefix}${entry.name}`;
      if (entry.name.startsWith('.')) continue;
      const found = readPackageManifest(name);
      if (!found) continue;
      // 只认声明了 pi 清单的包，普通依赖不参与装载
      if (!found.manifest.pi) continue;
      result.push({
        name,
        version: typeof found.manifest.version === 'string' ? found.manifest.version : undefined,
        description: typeof found.manifest.description === 'string' ? found.manifest.description : undefined,
      });
    }
  };

  collect(PI_NPM_ROOT);
  // scoped 包（@scope/pkg）挂在下一层
  let scoped: fs.Dirent[] = [];
  try {
    scoped = fs.readdirSync(PI_NPM_ROOT, { withFileTypes: true }).filter((e) => e.name.startsWith('@'));
  } catch {
    scoped = [];
  }
  for (const scope of scoped) collect(path.join(PI_NPM_ROOT, scope.name), `${scope.name}/`);

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 生成会话进程的扩展装载参数：先关掉自动发现，再逐个显式装载名单内的包。
 * 包没装就跳过并记日志，不让一个缺失的扩展拖垮整条链路。
 */
export function buildPiExtensionArgs(): string[] {
  const args = ['--no-extensions'];
  for (const name of enabledPackages) {
    const found = readPackageManifest(name);
    if (!found) {
      logger.debug(`pi 扩展包未安装，已跳过: ${name}`);
      continue;
    }
    args.push('--extension', found.dir);
  }
  return args;
}
