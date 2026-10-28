/* 取自 deepseek-harness packages/client/ui-primitives/src/ansi.ts（MIT）：
   语义保留（SGR 着色、控制序列剥离），解析换成本地实现以避免新增 anser 依赖。 */
import type { CSSProperties } from 'react';

/** 一段终端文本；`style` 未设置表示不需要额外包裹 */
export interface AnsiSpan {
  /** 去掉转义序列后的纯文本，不含换行 */
  text: string;
  /** 解析出的内联样式，未着色时为 undefined */
  style: CSSProperties | undefined;
}

/** 一行的若干文本片段 */
export type AnsiLine = readonly AnsiSpan[];

/**
 * 16 色基线：与 DSH 一样落到主题令牌上。黑与白都取主标签色，避免文字与卡片底色
 * 相同而看不见；亮黑取弱化灰，青与亮青取两档静态蓝（设计系统没有青色）。
 */
const BASE_16 = [
  'var(--dsw-alias-label-primary)',
  'var(--dsw-alias-state-error-primary)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-state-business-primary)',
  'rgb(187, 85, 187)',
  'var(--dsw-static-blue-600)',
  'var(--dsw-alias-label-primary)',
  'var(--dsw-alias-label-tertiary)',
  'var(--dsw-alias-state-error-secondary)',
  'var(--dsw-alias-state-success-secondary)',
  'var(--dsw-alias-state-warn-secondary)',
  'var(--dsw-static-blue-400)',
  'rgb(255, 85, 255)',
  'var(--dsw-static-blue-500)',
  'var(--dsw-alias-label-primary)',
];

/** 256 色立方体的 6 档取值 */
const CUBE = [0, 95, 135, 175, 215, 255];

/** 除 SGR 外的转义：OSC 标题、光标移动、字符集切换等一律丢弃 */
const ESCAPE = /\u001b(?:\[([0-9;]*)m|\[[0-9;?]*[A-Za-z]|\][\s\S]*?(?:\u0007|\u001b\\)|[@-_])/g;

/** 输出里除换行、制表外的 C0 控制字符（\r 进度条残留等）不进入 DOM */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

interface Sgr {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

/** 256 色索引转 CSS 颜色 */
function color256(index: number): string {
  if (index < 16) return BASE_16[index];
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return `rgb(${level}, ${level}, ${level})`;
  }
  const offset = index - 16;
  return `rgb(${CUBE[Math.floor(offset / 36)]}, ${CUBE[Math.floor(offset / 6) % 6]}, ${CUBE[offset % 6]})`;
}

/**
 * 按一次 SGR 参数串更新着色状态
 * @param sgr - 当前状态，就地修改
 * @param params - 分号分隔的参数串
 */
function applySgr(sgr: Sgr, params: string): void {
  const codes = params === '' ? [0] : params.split(';').map((part) => Number(part) || 0);
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (code === 0) {
      for (const key of Object.keys(sgr)) delete sgr[key as keyof Sgr];
    } else if (code === 1) sgr.bold = true;
    else if (code === 2) sgr.dim = true;
    else if (code === 3) sgr.italic = true;
    else if (code === 4) sgr.underline = true;
    else if (code === 7) sgr.inverse = true;
    else if (code === 22) sgr.bold = false;
    else if (code === 23) sgr.italic = false;
    else if (code === 24) sgr.underline = false;
    else if (code === 27) sgr.inverse = false;
    else if (code === 39) delete sgr.fg;
    else if (code === 49) delete sgr.bg;
    else if (code >= 30 && code <= 37) sgr.fg = BASE_16[code - 30];
    else if (code >= 90 && code <= 97) sgr.fg = BASE_16[code - 90 + 8];
    else if (code >= 40 && code <= 47) sgr.bg = BASE_16[code - 40];
    else if (code >= 100 && code <= 107) sgr.bg = BASE_16[code - 100 + 8];
    else if (code === 38 || code === 48) {
      const color = extendedColor(codes, index + 1);
      if (!color) break;
      if (code === 38) sgr.fg = color.value;
      else sgr.bg = color.value;
      index = color.next;
    }
  }
}

/** `38;5;n` / `38;2;r;g;b` 的取值，返回颜色与下一个未消费的参数位置 */
function extendedColor(codes: number[], start: number): { value: string; next: number } | null {
  const mode = codes[start];
  if (mode === 5 && start + 1 < codes.length) {
    return { value: color256(codes[start + 1]), next: start + 1 };
  }
  if (mode === 2 && start + 3 < codes.length) {
    const [r, g, b] = [codes[start + 1], codes[start + 2], codes[start + 3]];
    return { value: `rgb(${r}, ${g}, ${b})`, next: start + 3 };
  }
  return null;
}

/** 着色状态转内联样式，没有任何属性时返回 undefined（渲染成裸文本） */
function styleOf(sgr: Sgr): CSSProperties | undefined {
  let { fg, bg } = sgr;
  if (sgr.inverse) {
    const previousFg = fg ?? 'var(--dsw-alias-label-primary)';
    fg = bg ?? 'var(--dsw-alias-markdown-code-block)';
    bg = previousFg;
  }
  const style: CSSProperties = {};
  if (fg !== undefined) style.color = fg;
  if (bg !== undefined) style.backgroundColor = bg;
  if (sgr.bold) style.fontWeight = 600;
  if (sgr.italic) style.fontStyle = 'italic';
  if (sgr.underline) style.textDecoration = 'underline';
  if (sgr.dim) style.opacity = 0.65;
  return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * 把带 ANSI 转义的输出切成按行分组的文本片段
 * @param text - 原始输出文本
 * @returns 每行的片段列表；空文本返回单个空行
 */
export function parseAnsiLines(text: string): AnsiLine[] {
  const lines: AnsiSpan[][] = [[]];
  const sgr: Sgr = {};
  const emit = (chunk: string): void => {
    chunk.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      const clean = part.replace(CONTROL, '');
      if (clean) lines[lines.length - 1].push({ text: clean, style: styleOf(sgr) });
    });
  };
  let cursor = 0;
  for (const match of text.matchAll(ESCAPE)) {
    emit(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) applySgr(sgr, match[1]);
  }
  emit(text.slice(cursor));
  return lines;
}
