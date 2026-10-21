/**
 * 统一定义在宿主系统默认浏览器 (如 Chrome / Safari / Arc) 中打开外部链接的方法
 * 优先调用 Electron 宿主 shell.openExternal，Web 开发态下平滑降级为 window.open
 */
export async function openInDefaultBrowser(url: string): Promise<void> {
  if (!url) return;
  try {
    if (window.electronAPI?.openExternal) {
      if (import.meta.env?.DEV) {
        console.log(`[Browser:OpenExternal] 正在通过系统默认浏览器打开: ${url}`);
      }
      await window.electronAPI.openExternal(url);
      return;
    }
  } catch (err) {
    console.warn('[Browser:OpenExternal] 调用 Electron 打开外部浏览器失败，降级 window.open:', err);
  }

  // Web 端或降级处理
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
