import { createContext, useContext } from 'react';

/** 一次改动的定位：服务端的 changeId 加展示用路径 */
export interface ChangeTarget {
  changeId: string;
  path: string;
}

/** 会话里打开本地文件的入口：普通文件引用走预览，改动卡的行走 diff 页签 */
export interface OpenFileApi {
  /** 在右侧工作台预览该文件 */
  openFile: (path: string) => void;
  /** 在右侧工作台打开这次改动的 diff；未提供时改动卡退回预览 */
  openDiff?: (target: ChangeTarget) => void;
}

/**
 * 由面板挂载方提供。
 * 未提供时（例如预览面板不可用）文件引用保持不可点。
 */
export const OpenFileContext = createContext<OpenFileApi | undefined>(undefined);

export function useOpenFileApi(): OpenFileApi | undefined {
  return useContext(OpenFileContext);
}

export function useOpenFile(): ((path: string) => void) | undefined {
  return useContext(OpenFileContext)?.openFile;
}

export function useOpenDiff(): ((target: ChangeTarget) => void) | undefined {
  return useContext(OpenFileContext)?.openDiff;
}

/** 本地文件链接：去掉 #L12 之类的锚点，排除协议与站内相对地址 */
export function localFileTarget(href: string | undefined): string | undefined {
  const destination = (href || '').split('#')[0];
  if (!destination || destination.includes('?')) return undefined;
  const scheme = /^([a-z][\w+.-]*):/i.exec(destination);
  // 单字母是 Windows 盘符，其余带协议的都是外部地址
  if ((scheme && scheme[1].length > 1) || destination.startsWith('//')) return undefined;
  try {
    return decodeURIComponent(destination);
  } catch (_) {
    return undefined;
  }
}
