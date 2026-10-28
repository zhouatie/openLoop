import { createContext, useContext } from 'react';

/**
 * 会话里点开本地文件时的入口：由面板挂载方提供，用来把右侧工作台切到该文件的预览。
 * 未提供时（例如预览面板不可用）文件引用保持不可点。
 */
export const OpenFileContext = createContext<((path: string) => void) | undefined>(undefined);

export function useOpenFile(): ((path: string) => void) | undefined {
  return useContext(OpenFileContext);
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
