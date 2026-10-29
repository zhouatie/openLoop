/* 取自 deepseek-harness packages/client/ui-sidebar-terminal/src/client/terminal-cursor.ts（MIT）：
   光标颜色按它所在格子的底色算对比度。默认色、索引色、真彩色、反显都要看得见，
   所以不能只跟着界面主题走 —— 每次重绘读一次格子的实际颜色。 */
import type { IDisposable, Terminal } from '@xterm/xterm';

/**
 * 按格子底色给光标挑一个看得清的颜色，写进屏幕容器的 CSS 变量。
 * @param terminal - 用 DOM 渲染的终端实例
 * @param node - 终端屏幕根节点，光标的 CSS 变量挂在这里
 * @param preferredCursor - 界面主题或应用指定的光标色
 * @returns 解除监听的函数；不产生终端输入，也不改调色板
 */
export function observeTerminalCursor(
  terminal: Terminal,
  node: HTMLElement,
  preferredCursor: () => string
): IDisposable {
  return terminal.onRender(() => {
    const cursor = node.querySelector<HTMLElement>('.xterm-cursor');
    if (cursor === null) return;
    // 只摘掉光标类名，露出的就是这一格的真实配色（含反显）
    cursor.classList.remove('xterm-cursor');
    let background: string;
    let foreground: string;
    try {
      const style = getComputedStyle(cursor);
      foreground = style.color;
      background = opaqueColor(
        style.backgroundColor,
        () => getComputedStyle(node.querySelector('.xterm-scrollable-element')!).backgroundColor
      );
    } finally {
      cursor.classList.add('xterm-cursor');
    }
    const preferred = opaqueColor(preferredCursor(), () => background);
    const cellLuminance = luminance(background);
    const preferredLuminance = luminance(preferred);
    // WCAG：光标本体 3:1，光标里的字符 4.5:1
    const contrast =
      (Math.max(cellLuminance, preferredLuminance) + 0.05) / (Math.min(cellLuminance, preferredLuminance) + 0.05);
    const fill = contrast >= 3 ? preferred : cellLuminance > 0.179 ? '#000000' : '#ffffff';
    node.style.setProperty('--terminal-cursor', fill);
    node.style.setProperty('--terminal-cursor-accent', luminance(fill) > 0.179 ? '#000000' : '#ffffff');
    node.style.setProperty('--terminal-cursor-cell-background', background);
    node.style.setProperty('--terminal-cursor-cell-foreground', foreground);
  });
}

/** xterm 输出 sRGB 颜色；OSC 值已被 TerminalTheme 归一成六位十六进制 */
function luminance(color: string): number {
  const [r, g, b] = colorChannels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function colorChannels(color: string): number[] {
  return color.startsWith('#')
    ? [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((value) => Number.parseInt(value, 16))
    : color.match(/[\d.]+/gu)!.map(Number);
}

function opaqueColor(color: string, background: () => string): string {
  const channels = colorChannels(color);
  const alpha = channels[3] ?? 1;
  if (alpha === 1) return color;
  const surface = colorChannels(background());
  const rgb = channels.slice(0, 3).map((channel, index) => Math.round(channel * alpha + surface[index]! * (1 - alpha)));
  return `rgb(${rgb.join(', ')})`;
}
