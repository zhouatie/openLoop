/**
 * 设备截图：镜像面板上的「截图」按钮与 agent 读取走同一条采集链路。
 *
 * 截图落盘到数据目录的 screenshots/ 下，按 `device-<platform>-<串号>-<时间戳>.png` 命名，
 * 每台设备各自记住「当前选定」的那一张：用户在截图条里点哪张，agent 就读哪张。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from '../logger';
import { AndroidDeviceManager } from './android-device-manager';
import { IosDeviceManager } from './ios-device-manager';

const execFileAsync = promisify(execFile);
const logger = createLogger('DeviceScreenshot');

/** 截图目录名（位于应用数据目录下） */
const SCREENSHOT_DIR_NAME = 'screenshots';
/** 只保留最近若干张：用户点一次存一张，防止无声堆积 */
const MAX_SCREENSHOTS = 30;
/** 文件名即索引：device-<platform>-<serial?-><epochMs>.<ext> */
const SHOT_FILE_PATTERN = /^device-(android|ios)-(.+)\.(png|jpe?g)$/i;
/** 每台设备「当前选定」截图的记录文件 */
const SELECTION_FILE = 'selection.json';
/** 单张截图的最大字节数（高分屏 PNG 约 2-6MB） */
const MAX_SHOT_BYTES = 32 * 1024 * 1024;

export type ScreenshotPlatform = 'android' | 'ios';

export interface DeviceScreenshot {
  platform: ScreenshotPlatform;
  /** 设备串号或模拟器 UDID；复用历史截图时可能缺失 */
  serial?: string;
  /** 本地绝对路径，可交给读图工具或 agent */
  path: string;
  /** 采集时间（毫秒时间戳） */
  capturedAt: number;
  /** 是否是这台设备当前选定的截图（agent 默认读这一张） */
  selected?: boolean;
}

export interface ListDeviceScreenshotsInput {
  dataDir: string;
  platform?: ScreenshotPlatform;
  serial?: string;
}

export interface SelectDeviceScreenshotInput {
  dataDir: string;
  /** 已保存截图的绝对路径 */
  path: string;
}

export interface CaptureDeviceScreenshotInput {
  dataDir: string;
  platform: ScreenshotPlatform;
  serial?: string;
  wdaEndpoint?: string;
}

export interface ResolveDeviceScreenshotInput {
  dataDir: string;
  platform?: ScreenshotPlatform;
  serial?: string;
  wdaEndpoint?: string;
  /** true 表示现场重抓；默认优先复用用户刚点的那一张 */
  fresh?: boolean;
}

function screenshotDir(dataDir: string): string {
  return path.join(dataDir, SCREENSHOT_DIR_NAME);
}

/** 串号进文件名：只留文件名安全字符，冒号等（如 192.168.1.7:5555）转成连字符 */
function sanitizeSerial(serial?: string): string {
  return (serial || '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
}

/** 从文件名解析截图元信息：最后一段纯数字是时间戳，前面是串号 */
function parseShotName(name: string): DeviceScreenshot | null {
  const hit = SHOT_FILE_PATTERN.exec(name);
  if (!hit) return null;
  const parts = hit[2].split('-');
  const stamp = parts.pop() || '';
  if (!/^\d{10,}$/.test(stamp)) return null;
  return {
    platform: hit[1].toLowerCase() as ScreenshotPlatform,
    serial: parts.join('-') || undefined,
    capturedAt: Number(stamp),
    path: '',
  };
}

/** 目录里的全部截图（新到旧），可限定平台与设备串号 */
export function listDeviceScreenshots(input: ListDeviceScreenshotsInput): DeviceScreenshot[] {
  const dir = screenshotDir(input.dataDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const selected = findSelectedShot(input.dataDir, input.platform, input.serial);
  const shots: DeviceScreenshot[] = [];
  for (const name of names) {
    const parsed = parseShotName(name);
    if (!parsed) continue;
    if (input.platform && parsed.platform !== input.platform) continue;
    if (input.serial && parsed.serial && parsed.serial !== sanitizeSerial(input.serial)) continue;
    shots.push({ ...parsed, path: path.join(dir, name), selected: selected?.path === path.join(dir, name) });
  }
  return shots.sort((a, b) => b.capturedAt - a.capturedAt);
}

/** 最近一张已保存的截图（按时间戳倒序，可限定平台与串号） */
export function findLatestDeviceScreenshot(
  dataDir: string,
  platform?: ScreenshotPlatform,
  serial?: string
): DeviceScreenshot | null {
  return listDeviceScreenshots({ dataDir, platform, serial })[0] || null;
}

type SelectionMap = Record<string, { name: string; selectedAt: number }>;

function readSelection(dir: string): SelectionMap {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, SELECTION_FILE), 'utf8'));
    return raw && typeof raw === 'object' ? (raw as SelectionMap) : {};
  } catch {
    return {};
  }
}

function writeSelection(dir: string, map: SelectionMap): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, SELECTION_FILE), JSON.stringify(map));
  } catch {
    /* 选定记录丢了不致命：下次按最新一张兜底 */
  }
}

/** 选定记录的键：同平台同串号的设备各自一份 */
function selectionKey(platform: ScreenshotPlatform, serial?: string): string {
  return `${platform}:${sanitizeSerial(serial)}`;
}

/** 读取已选定且文件仍在的截图 */
function findSelectedShot(
  dataDir: string,
  platform?: ScreenshotPlatform,
  serial?: string
): DeviceScreenshot | null {
  const dir = screenshotDir(dataDir);
  const map = readSelection(dir);
  let best: { shot: DeviceScreenshot; selectedAt: number } | null = null;
  for (const [key, entry] of Object.entries(map)) {
    const [keyPlatform, keySerial] = key.split(':');
    if (platform && keyPlatform !== platform) continue;
    if (serial && keySerial && keySerial !== sanitizeSerial(serial)) continue;
    const parsed = parseShotName(entry.name);
    if (!parsed) continue;
    const filePath = path.join(dir, entry.name);
    if (!fs.existsSync(filePath)) continue;
    if (!best || entry.selectedAt > best.selectedAt) {
      best = { shot: { ...parsed, path: filePath, selected: true }, selectedAt: entry.selectedAt };
    }
  }
  return best?.shot || null;
}

/** 把某张截图设为该设备「agent 要读的那一张」 */
export function selectDeviceScreenshot(input: SelectDeviceScreenshotInput): DeviceScreenshot {
  const dir = screenshotDir(input.dataDir);
  const name = path.basename(input.path);
  const parsed = parseShotName(name);
  if (!parsed || !fs.existsSync(path.join(dir, name))) {
    throw new Error('截图不存在或已被清理，请重新截图');
  }
  const map = readSelection(dir);
  map[selectionKey(parsed.platform, parsed.serial)] = { name, selectedAt: Date.now() };
  writeSelection(dir, map);
  logger.info(`[DeviceScreenshot] 已选定截图: ${name}`);
  return { ...parsed, path: path.join(dir, name), selected: true };
}

/** 按文件头识别真实图片格式：WDA 不同版本返回 PNG 或 JPEG */
function sniffImageExt(data: Buffer): 'png' | 'jpg' {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) return 'jpg';
  return 'png';
}

/** ADB 流式截屏：真机与模拟器都通用 */
async function captureAndroid(serial?: string): Promise<{ data: Buffer; serial?: string }> {
  let target = serial?.trim();
  if (!target) {
    const online = (await AndroidDeviceManager.getDevices()).find((device) => device.status === 'device');
    target = online?.serial;
  }
  if (!target) throw new Error('没有在线的 Android 设备');

  const args = ['-s', target, 'exec-out', 'screencap', '-p'];
  const { stdout } = await execFileAsync('adb', args, {
    encoding: 'buffer',
    maxBuffer: MAX_SHOT_BYTES,
    timeout: 8000,
  });
  const data = stdout as Buffer;
  if (!data || data.length === 0) throw new Error('adb screencap 返回空画面');
  return { data, serial: target };
}

/** WebDriverAgent 的 /screenshot 接口：真机与模拟器都可用 */
async function captureWdaScreenshot(wdaEndpoint: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const resp = await fetch(`${wdaEndpoint}/screenshot`, { signal: controller.signal });
    if (!resp.ok) return null;
    const payload: any = await resp.json();
    const base64 = payload?.value;
    if (typeof base64 !== 'string' || base64.length === 0) return null;
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** xcrun simctl 截图：WDA 未启动时的本机模拟器通路 */
async function captureSimulatorScreenshot(udid?: string): Promise<Buffer | null> {
  const target = udid?.trim() || 'booted';
  const shotPath = path.join(os.tmpdir(), `openloop-device-shot-${process.pid}-${Date.now()}.png`);
  try {
    await execFileAsync('xcrun', ['simctl', 'io', target, 'screenshot', '--type=png', shotPath], {
      timeout: 8000,
    });
    return await fs.promises.readFile(shotPath);
  } catch (err: any) {
    logger.debug(`[DeviceScreenshot] simctl 截图失败 (${target}): ${err?.message}`);
    return null;
  } finally {
    void fs.promises.unlink(shotPath).catch(() => {});
  }
}

async function captureIos(
  serial: string | undefined,
  wdaEndpoint: string | undefined
): Promise<{ data: Buffer; serial?: string }> {
  const endpoint = IosDeviceManager.resolveEndpoint(wdaEndpoint);
  const fromWda = await captureWdaScreenshot(endpoint);
  if (fromWda && fromWda.length > 0) return { data: fromWda, serial };

  const fromSimulator = await captureSimulatorScreenshot(serial);
  if (fromSimulator && fromSimulator.length > 0) return { data: fromSimulator, serial };

  throw new Error('无法截取 iOS 画面：WebDriverAgent 未就绪，且没有可截图的已启动模拟器');
}

/** 清理过期截图：只保留最近的若干张，已选定的那张不删 */
function pruneScreenshots(dir: string): void {
  try {
    const keepNames = new Set(Object.values(readSelection(dir)).map((entry) => entry.name));
    const shots = fs
      .readdirSync(dir)
      .map((name) => ({ name, at: parseShotName(name)?.capturedAt || 0 }))
      .filter((shot) => shot.at > 0)
      .sort((a, b) => a.at - b.at);
    for (const shot of shots.slice(0, Math.max(0, shots.length - MAX_SCREENSHOTS))) {
      if (keepNames.has(shot.name)) continue;
      fs.unlinkSync(path.join(dir, shot.name));
    }
  } catch {
    /* 清理失败不影响本次截图 */
  }
}

/** 现场截取设备当前画面并落盘 */
export async function captureDeviceScreenshot(input: CaptureDeviceScreenshotInput): Promise<DeviceScreenshot> {
  const captured =
    input.platform === 'ios'
      ? await captureIos(input.serial, input.wdaEndpoint)
      : await captureAndroid(input.serial);

  const capturedAt = Date.now();
  const dir = screenshotDir(input.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const serialSegment = sanitizeSerial(captured.serial);
  const fileName = `device-${input.platform}-${serialSegment ? `${serialSegment}-` : ''}${capturedAt}.${sniffImageExt(captured.data)}`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, captured.data);
  // 刚截的这张自动成为 agent 要读的那张，用户改选时才切换
  const map = readSelection(dir);
  map[selectionKey(input.platform, captured.serial)] = { name: fileName, selectedAt: capturedAt };
  writeSelection(dir, map);
  pruneScreenshots(dir);

  logger.info(`[DeviceScreenshot] 已保存设备截图 (${input.platform} ${captured.serial || '默认设备'}): ${filePath}`);
  return { platform: input.platform, serial: captured.serial, path: filePath, capturedAt, selected: true };
}

/**
 * 取一张可用的设备截图：默认复用用户刚在镜像里点下的那一张，
 * 没有历史截图或显式要求 fresh 时现场抓取。
 */
export async function resolveDeviceScreenshot(input: ResolveDeviceScreenshotInput): Promise<DeviceScreenshot> {
  if (!input.fresh) {
    // 先认用户选定/刚截的那张，再退回到最新一张
    const selected = findSelectedShot(input.dataDir, input.platform, input.serial);
    if (selected) return selected;
    const latest = findLatestDeviceScreenshot(input.dataDir, input.platform, input.serial);
    if (latest) return latest;
  }
  if (!input.platform) {
    throw new Error('还没有设备截图：请在设备镜像里点击截图，或指定 platform 现场抓取');
  }
  return captureDeviceScreenshot({
    dataDir: input.dataDir,
    platform: input.platform,
    serial: input.serial,
    wdaEndpoint: input.wdaEndpoint,
  });
}
