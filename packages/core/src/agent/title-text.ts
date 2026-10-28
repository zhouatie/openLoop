/**
 * 会话标题文本处理：清洗、长度收敛、兜底标题与最终标题裁决。
 *
 * 设计取自 deepseek-harness 的 session-title：
 * 1. 兜底标题必须立刻可得（不依赖模型）：首条有效用户消息的首行，去掉 Markdown /
 *    终端控制符后收敛到固定长度；
 * 2. 兜底标题与模型生成的标题走同一套长度上限（中日韩按视觉宽度、其它语言按词数，
 *    再按 UTF-8 字节兜一层），保证侧栏宽度稳定；
 * 3. 优先级固定为用户重命名 > 会话名（任务标题 / 自动命名）> 兜底标题。
 */

/** 终端命令序列（含未闭合的尾巴）。 */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu;
/** 颜色等控制序列。 */
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu;
/** 剩余的两字节 ESC 控制序列。 */
const ESC_SEQUENCE = /\u001B[@-_]/gu;
/** 非空白 C0/C1 控制字符（保留 \t \n \r）。 */
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
/** 可能让标题显示失真的方向与不可见控制字符。 */
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu;
/** 中日韩字符：命中就按视觉宽度收敛，而不是按空格分词。 */
const CJK_CHARACTER = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/u;
/** 首尾包装符：引号、括号、反引号、粗体斜体标记。 */
const EDGE_DECORATION = /^[\s"'“”‘’《》〈〉「」『』【】\[\]()（）<>*_`]+|[\s"'“”‘’《》⟨⟩「」『』【】\[\]()（）<>*_:：]+$/gu;
/** 模型爱写的标签前缀，例如 `【需求】`、`[bug]`。 */
const LABEL_PREFIX = /^[\[【][^\]】]{0,12}[\]】]\s*/u;
/** 模型爱写的前缀，例如 `会话标题：`、`自动命名：`。 */
const TITLE_PREFIX =
  /^(?:[^\s:：]{0,4})?(?:标题|名称|主题|命名|title|summary|name)\s*[:：]\s*/iu;
/** 停顿符：截断落在半句上时回退到这里。 */
const PAUSE_BOUNDARY = /[，。、；：！？,.;:!?\s]/u;
/** 尾部残留的停顿符与空白。 */
const TRAILING_PAUSE = /[，。、；：！？,.;:!?\s]+$/u;
/** Markdown 标题符号。 */
const HEADING_PREFIX = /^#{1,6}\s*/u;
/** 代码块围栏。 */
const CODE_FENCE = /```[a-zA-Z0-9+#._-]*/gu;
/** 首条消息常以路径 / URL / 命令开头，这一段没有信息量。 */
const LEADING_PATH_TOKEN = /^(?:~\/|\/|[A-Za-z]:[\\/]|https?:\/\/|file:\/\/)\S*\s*/u;
/** 以路径 / URL 开头且没有中日韩文字，说明这个标题只是一串位置。 */
const PATH_LIKE_PREFIX = /^(?:~\/|\/|[A-Za-z]:[\\/]|https?:\/\/|file:\/\/)/u;

/**
 * 标题长度上限：中日韩文本按宽度收口（汉字 2、其它 1），其它语言按词数收口，
 * 最后统一按 UTF-8 字节兜一层；侧栏仍会用省略号做最后的视觉收敛。
 */
export interface SessionTitleLimits {
  maxWidth: number;
  maxWords: number;
  maxBytes: number;
}

/** 侧栏标题的默认上限：约 15 个汉字或 8 个英文词。 */
export const DEFAULT_TITLE_LIMITS: SessionTitleLimits = {
  maxWidth: 30,
  maxWords: 8,
  maxBytes: 48,
};

/** 去掉控制符与代码围栏后按行清洗，只保留有内容的行。 */
function cleanLines(input: string): string[] {
  return input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(CODE_FENCE, '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
}

/** 去掉 Markdown、模型爱写的前缀与首尾包装符。 */
function stripDecorations(line: string): string {
  return line
    .replace(LABEL_PREFIX, '')
    .replace(EDGE_DECORATION, '')
    .replace(TITLE_PREFIX, '')
    .replace(HEADING_PREFIX, '')
    .replace(EDGE_DECORATION, '');
}

/** 判断一个名字/消息是否只是一串位置，没有可读信息。 */
function isPathLike(text: string): boolean {
  return PATH_LIKE_PREFIX.test(text) && !CJK_CHARACTER.test(text);
}

/** 按 UTF-8 字节预算截断，不切断码点。 */
export function truncateTitleUtf8(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input;
  let used = 0;
  let output = '';
  for (const character of input) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (used + bytes > maxBytes) break;
    output += character;
    used += bytes;
  }
  return output;
}

/** 收敛到长度上限：中日韩文本按宽度、其它语言按词数，最后按字节兜底。 */
function clampTitle(text: string, limits: SessionTitleLimits): string {
  const bounded = CJK_CHARACTER.test(text)
    ? cutByWidth(text, limits.maxWidth)
    : text.split(' ').slice(0, limits.maxWords).join(' ');
  const trimmed = truncateTitleUtf8(bounded.trim(), limits.maxBytes).trim();
  return trimmed.replace(TRAILING_PAUSE, '');
}

/**
 * 按视觉宽度截断（汉字算 2，其它算 1，不切断码点）。
 * 截断点落在半句上时回退到最近的停顿符，但最多回退一半宽度。
 */
function cutByWidth(text: string, maxWidth: number): string {
  const characters = Array.from(text);
  let width = 0;
  let consumed = 0;
  let pauseAt = -1;
  let pauseWidth = 0;
  for (const character of characters) {
    const characterWidth = CJK_CHARACTER.test(character) ? 2 : 1;
    if (width + characterWidth > maxWidth) break;
    width += characterWidth;
    consumed += 1;
    if (PAUSE_BOUNDARY.test(character)) {
      pauseAt = consumed;
      pauseWidth = width;
    }
  }
  if (consumed === characters.length) return text;
  const usePause = pauseAt > 0 && pauseWidth >= maxWidth / 2;
  return characters.slice(0, usePause ? pauseAt : consumed).join('');
}

/**
 * 归一化一个已经生成的标题（模型输出或用户输入）：取首个非空行，去掉装饰与长度溢出。
 */
export function normalizeSessionTitle(
  input: string,
  limits: SessionTitleLimits = DEFAULT_TITLE_LIMITS
): string {
  const [line] = cleanLines(input);
  if (!line) return '';
  return clampTitle(stripDecorations(line), limits);
}

/** 去掉 pi 会话名里的 openLoop 前缀，任务标题会带这个标记 */
export function stripSessionNamePrefix(name: string): string {
  return name.replace(/^openLoop\s*[:：]\s*/iu, '').trim();
}

/**
 * 生成确定性兜底标题：不依赖模型，进程内即时可得。
 * 只取首行，避免把整段贴进来的日志、报错堆进侧栏；开头的路径 / URL 先去掉。
 */
export function fallbackSessionTitle(
  input: string,
  limits: SessionTitleLimits = DEFAULT_TITLE_LIMITS
): string {
  const [line] = cleanLines(input);
  if (!line) return '';
  const title = stripDecorations(line).replace(LEADING_PATH_TOKEN, '');
  if (!title || isPathLike(title)) return '';
  return clampTitle(title, limits);
}

/**
 * 裁决一个会话最终展示的标题。
 * 用户重命名与任务标题都是人工给定的，原样使用；只有兜底标题做长度收敛。
 */
export function resolveSessionTitle(
  input: { metaTitle?: string; sessionName?: string; firstUserMessage?: string },
  limits: SessionTitleLimits = DEFAULT_TITLE_LIMITS
): string {
  const override = (input.metaTitle || '').trim();
  if (override) return override;

  const name = stripSessionNamePrefix((input.sessionName || '').trim());
  // 历史会话被写成路径名（早期用首条消息或工作目录当会话名），这种名字没有信息量
  if (name && !isPathLike(name)) return name;

  return fallbackSessionTitle(input.firstUserMessage || '', limits);
}
