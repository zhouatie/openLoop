/**
 * 「打开方式」：把工作区目录交给本机的访达 / 编辑器 / 终端打开。
 * 应用表与启动方式取自 deepseek-harness 的 open-in-app 包（MIT），按 openLoop 的本机场景简化：
 * 只探测本机真实存在的应用，图标由系统工具转成内联 PNG，启动后与核心服务脱钩。
 */
import { execFile, execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createLogger } from '../logger';
import type { OpenInAppTarget } from '../types';

const logger = createLogger('OpenInApp');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

/** 一条启动方式：命令 + 参数，`{path}` 由工作区目录替换，没有占位时目录追加在末尾 */
interface Launch {
  command: string;
  args: string[];
}

/** 探测成功的应用：启动方式 + 图标所在的应用包 */
interface DetectedApp {
  launch: Launch;
  /** macOS 应用包路径；省略时界面回退到通用图标 */
  iconBundle?: string;
}

interface AppSpec {
  id: string;
  name: string;
  /** 探测本机应用；null 表示没装，不进菜单 */
  detect: () => DetectedApp | null;
}

/** macOS 应用包的探测位置 */
const APP_ROOTS = ['/Applications', path.join(os.homedir(), 'Applications')];

/** 执行一条短命令并拿到 stdout */
function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

/** 在已知应用目录里找应用包，命中后交给 LaunchServices 并带上工作区目录 */
function macApp(...bundles: string[]): DetectedApp | null {
  for (const root of APP_ROOTS) {
    for (const bundle of bundles) {
      const dir = path.join(root, bundle);
      if (fs.existsSync(dir)) return { launch: { command: 'open', args: ['-a', dir] }, iconBundle: dir };
    }
  }
  return null;
}

/** 跟随 xcode-select 找 Xcode：Beta 版与改名安装也能命中 */
function xcodeApp(): DetectedApp | null {
  try {
    const developer = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim();
    const bundle = path.dirname(path.dirname(developer));
    if (bundle.endsWith('.app') && fs.existsSync(bundle)) {
      return { launch: { command: 'open', args: ['-a', bundle] }, iconBundle: bundle };
    }
  } catch (_) {
    /* 没装命令行工具时没有 Xcode 可打开 */
  }
  return null;
}

/** PATH 上的命令：命中返回完整路径，未安装返回 null */
function onPath(command: string): string | null {
  const suffixes = IS_WIN ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const file = path.join(dir, command + suffix);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/** PATH 命令式的应用（编辑器 CLI、Linux 终端） */
function cliApp(command: string, ...args: string[]): DetectedApp | null {
  const found = onPath(command);
  return found === null ? null : { launch: { command: found, args } };
}

const MAC_APPS: AppSpec[] = [
  {
    id: 'finder',
    name: '访达',
    detect: () => ({
      launch: { command: 'open', args: ['{path}'] },
      iconBundle: '/System/Library/CoreServices/Finder.app',
    }),
  },
  { id: 'cursor', name: 'Cursor', detect: () => macApp('Cursor.app') },
  { id: 'vscode', name: 'Visual Studio Code', detect: () => macApp('Visual Studio Code.app') },
  { id: 'zed', name: 'Zed', detect: () => macApp('Zed.app', 'Zed Preview.app') },
  { id: 'xcode', name: 'Xcode', detect: xcodeApp },
  { id: 'androidstudio', name: 'Android Studio', detect: () => macApp('Android Studio.app') },
  { id: 'ghostty', name: 'Ghostty', detect: () => macApp('Ghostty.app') },
  { id: 'warp', name: 'Warp', detect: () => macApp('Warp.app') },
  { id: 'iterm', name: 'iTerm', detect: () => macApp('iTerm.app') },
  { id: 'kitty', name: 'kitty', detect: () => macApp('kitty.app') },
  {
    id: 'terminal',
    name: '终端',
    detect: () => ({
      launch: { command: 'open', args: ['-a', 'Terminal', '{path}'] },
      iconBundle: '/System/Applications/Utilities/Terminal.app',
    }),
  },
];

const LINUX_APPS: AppSpec[] = [
  { id: 'filemanager', name: '文件管理器', detect: () => cliApp('xdg-open') },
  { id: 'cursor', name: 'Cursor', detect: () => cliApp('cursor') },
  { id: 'vscode', name: 'Visual Studio Code', detect: () => cliApp('code') },
  { id: 'zed', name: 'Zed', detect: () => cliApp('zed') },
  { id: 'ghostty', name: 'Ghostty', detect: () => cliApp('ghostty', '--working-directory={path}') },
  { id: 'kitty', name: 'kitty', detect: () => cliApp('kitty', '--directory') },
  { id: 'terminal', name: '终端', detect: () => cliApp('gnome-terminal', '--working-directory={path}') },
];

const WIN_APPS: AppSpec[] = [
  { id: 'explorer', name: '资源管理器', detect: () => ({ launch: { command: 'explorer', args: ['{path}'] } }) },
  { id: 'cursor', name: 'Cursor', detect: () => cliApp('cursor') },
  { id: 'vscode', name: 'Visual Studio Code', detect: () => cliApp('code') },
  { id: 'terminal', name: 'Windows Terminal', detect: () => cliApp('wt', '-d', '{path}') },
];

const APP_SPECS = IS_MAC ? MAC_APPS : IS_WIN ? WIN_APPS : LINUX_APPS;

type ResolvedApp = { id: string; name: string } & DetectedApp;

/** 本机应用表：一次进程生命周期内只探测一遍 */
let detectedApps: ResolvedApp[] | null = null;

function detectApps(): ResolvedApp[] {
  if (detectedApps !== null) return detectedApps;
  const apps: ResolvedApp[] = [];
  for (const spec of APP_SPECS) {
    const app = spec.detect();
    if (app !== null) apps.push({ id: spec.id, name: spec.name, ...app });
  }
  logger.info(`[OpenInApp] 探测到 ${apps.length} 个可打开的应用: ${apps.map((app) => app.id).join(', ')}`);
  detectedApps = apps;
  return apps;
}

/** 图标缓存：同一次运行里应用不会换图标，取一次就够 */
const iconCache = new Map<string, Promise<string | null>>();

/** 应用包里的图标转成 64px PNG data URL：Info.plist 声明的 .icns 优先，退到 Resources 里第一个 */
async function bundleIcon(bundleDir: string): Promise<string | null> {
  const resources = path.join(bundleDir, 'Contents', 'Resources');
  let icns = '';
  try {
    const plist = JSON.parse(
      await run('plutil', ['-convert', 'json', '-o', '-', path.join(bundleDir, 'Contents', 'Info.plist')])
    );
    const declared = plist?.CFBundleIconFile;
    if (typeof declared === 'string' && declared !== '') {
      icns = path.join(resources, declared.endsWith('.icns') ? declared : `${declared}.icns`);
    }
  } catch (_) {
    /* Info.plist 读不到时退到 Resources 扫描 */
  }
  if (!fs.existsSync(icns)) {
    const found = fs.existsSync(resources) ? fs.readdirSync(resources).find((entry) => entry.endsWith('.icns')) : undefined;
    icns = found === undefined ? '' : path.join(resources, found);
  }
  if (icns === '') return null;

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openloop-icon-'));
  const out = path.join(workDir, 'icon.png');
  try {
    await run('sips', ['-s', 'format', 'png', '-Z', '64', icns, '--out', out]);
    return `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`;
  } catch (err: any) {
    logger.warn(`[OpenInApp] 图标转换失败 ${icns}: ${err.message}`);
    return null;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function iconOf(app: ResolvedApp): Promise<string | null> {
  let pending = iconCache.get(app.id);
  if (pending === undefined) {
    pending = app.iconBundle === undefined ? Promise.resolve(null) : bundleIcon(app.iconBundle);
    iconCache.set(app.id, pending);
  }
  return pending;
}

/** 本机可用的「打开方式」应用，按应用表顺序返回，图标为内联 PNG */
export async function listOpenInAppTargets(): Promise<OpenInAppTarget[]> {
  return Promise.all(
    detectApps().map(async (app) => ({ id: app.id, name: app.name, icon: await iconOf(app) }))
  );
}

/** 用指定应用打开目录；应用不在本机表里、目录不存在都算失败 */
export function openInApp(appId: string, dirPath: string): boolean {
  const app = detectApps().find((item) => item.id === appId);
  if (app === undefined) {
    logger.warn(`[OpenInApp] 未探测到的应用: ${appId}`);
    return false;
  }
  const dir = path.resolve(dirPath.startsWith('~') ? path.join(os.homedir(), dirPath.slice(1)) : dirPath);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    logger.warn(`[OpenInApp] 目标不是已存在的目录: ${dir}`);
    return false;
  }

  const hasPathToken = app.launch.args.some((arg) => arg.includes('{path}'));
  const args = app.launch.args.map((arg) => arg.replace(/\{path\}/g, dir));
  if (!hasPathToken) args.push(dir);

  try {
    // 与应用脱钩：核心服务重启、退出都不影响已经打开的应用
    const child = spawn(app.launch.command, args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => logger.error(`[OpenInApp] 启动 ${app.name} 失败: ${err.message}`));
    child.unref();
    logger.info(`[OpenInApp] 用 ${app.name} 打开: ${dir}`);
    return true;
  } catch (err: any) {
    logger.error(`[OpenInApp] 启动 ${app.name} 异常: ${err.message}`, err);
    return false;
  }
}
