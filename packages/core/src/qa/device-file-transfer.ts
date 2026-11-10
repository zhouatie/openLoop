/**
 * 设备文件下发：镜像按键列的「文件」按钮把本地文件送到设备。
 *
 * 普通文件落到设备的 /sdcard/Download 下；安装包直接安装，
 * 省掉「先推送、再进文件管理器点安装」这一步。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createLogger } from '../logger';
import { AndroidDeviceManager } from './android-device-manager';

const execFileAsync = promisify(execFile);
const logger = createLogger('DeviceFileTransfer');

/** 设备侧下载目录：文件管理器里可见，用户拿得到 */
const REMOTE_DOWNLOAD_DIR = '/sdcard/Download';
/** 单次下发上限，超过只会白等带宽 */
const MAX_PUSH_BYTES = 2 * 1024 * 1024 * 1024;
/** adb push / install 的最长等待时间 */
const ADB_TRANSFER_TIMEOUT_MS = 600000;

export interface PushDeviceFileInput {
  dataDir: string;
  serial?: string;
  /** 原始文件名（浏览器侧提供），只取文件名部分 */
  name: string;
  stream: Readable;
  contentLength?: number;
}

export interface PushDeviceFileResult {
  success: true;
  serial: string;
  name: string;
  bytes: number;
  /** 推送到设备后的路径；安装安装包时为空 */
  path?: string;
  /** 是否是安装包并已安装 */
  installed?: boolean;
  message: string;
}

/** 文件名即用户可见产物：去掉路径分隔符与控制字符，避免写出目标目录 */
function sanitizeFileName(value: string): string {
  const base = path.basename(String(value || '').replace(/\\/g, '/')).trim();
  const cleaned = base
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  if (!cleaned || cleaned === '.' || cleaned === '..') return '';
  return cleaned;
}

async function resolveSerial(serial?: string): Promise<string> {
  const target = serial?.trim();
  if (target) return target;
  const online = (await AndroidDeviceManager.getDevices()).find((device) => device.status === 'device');
  if (!online) throw new Error('没有在线的 Android 设备');
  return online.serial;
}

/** adb 失败时把 stderr 原文交给用户，比「exit code 1」有用 */
async function runAdb(serial: string, args: string[], timeout: number): Promise<void> {
  try {
    await execFileAsync('adb', ['-s', serial, ...args], { timeout, maxBuffer: 4 * 1024 * 1024 });
  } catch (err: any) {
    const detail = String(err?.stderr || err?.message || '').trim();
    throw new Error(detail || 'adb 执行失败');
  }
}

export async function pushDeviceFile(input: PushDeviceFileInput): Promise<PushDeviceFileResult> {
  const name = sanitizeFileName(input.name);
  if (!name) throw new Error('文件名无效');
  if ((input.contentLength ?? 0) > MAX_PUSH_BYTES) throw new Error('文件超过 2 GB');

  const serial = await resolveSerial(input.serial);
  const tempDir = path.join(input.dataDir, 'tmp');
  await fsp.mkdir(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, `push-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  let bytes = 0;
  try {
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_PUSH_BYTES) {
          callback(new Error('文件超过 2 GB'));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(input.stream, limiter, fs.createWriteStream(tempFile));
    if (bytes === 0) throw new Error('文件为空');

    if (/\.apk$/i.test(name)) {
      logger.info(`[${serial}] 安装安装包: ${name} (${bytes} 字节)`);
      await runAdb(serial, ['install', '-r', tempFile], ADB_TRANSFER_TIMEOUT_MS);
      return { success: true, serial, name, bytes, installed: true, message: `已安装 ${name}` };
    }

    const remotePath = `${REMOTE_DOWNLOAD_DIR}/${name}`;
    logger.info(`[${serial}] 推送文件: ${name} (${bytes} 字节) -> ${remotePath}`);
    await runAdb(serial, ['shell', 'mkdir', '-p', REMOTE_DOWNLOAD_DIR], 8000);
    await runAdb(serial, ['push', tempFile, remotePath], ADB_TRANSFER_TIMEOUT_MS);
    return { success: true, serial, name, bytes, path: remotePath, message: `已发送到 ${remotePath}` };
  } finally {
    await fsp.rm(tempFile, { force: true }).catch(() => {});
  }
}
