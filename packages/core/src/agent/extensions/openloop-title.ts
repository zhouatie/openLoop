/**
 * openLoop 会话自动命名桥
 *
 * 参考 deepseek-harness 的 session-title 服务，分两步给会话起名：
 * 1. 兜底先落：本轮开始前就用首条有效用户消息算出确定性标题并立刻写成会话名，
 *    侧栏永不出现空白标题，也不等模型；
 * 2. 后台提炼：用当前会话模型异步提炼更贴切的标题，落地后覆盖兜底标题；
 *    提炼不阻塞本轮对话。
 *
 * 「钉住」规则：会话已有名字（任务标题、用户重命名）时不再自动生成，
 * 提炼期间名字被改过也放弃回写，人工结果永远优先。
 */

import { fallbackSessionTitle, normalizeSessionTitle } from '../title-text';

/** 提炼时最多带上前面几条用户消息，够看出会话主题即可 */
const MAX_SOURCE_MESSAGES = 2;
/** 送给模型的消息文本上限，避免把整段日志搬进辅助请求 */
const MAX_SOURCE_CHARS = 1500;
/** 辅助请求的输出上限与超时：标题很短，超时即放弃 */
const MAX_OUTPUT_TOKENS = 64;
const REQUEST_TIMEOUT_MS = 20000;

const SYSTEM_PROMPT = [
  '你为 AI 编程助手会话起标题。',
  '只输出标题本身：一行纯文本，不带引号、前缀、解释、Markdown 或控制字符。',
  '使用消息本身的语言；中文控制在 6 到 14 个字，其它语言控制在 3 到 8 个词。',
  '消息里没有可命名的信息时，也给一个最简短的概括（例如「打招呼」），不要解释。',
].join('\n');

interface TitleMessage {
  role?: string;
  content?: unknown;
}

interface TitleBranchEntry {
  type?: string;
  message?: TitleMessage;
}

interface TitleModelResponse {
  stopReason?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface TitleModelStream {
  result(): Promise<TitleModelResponse | undefined>;
}

interface TitleExtensionContext {
  model?: unknown;
  modelRegistry: {
    streamSimple(model: unknown, context: unknown, options?: unknown): TitleModelStream;
  };
  sessionManager?: { getBranch?: () => TitleBranchEntry[] };
}

interface TitleExtensionApi {
  on(
    event: 'before_agent_start',
    handler: (event: { prompt?: string }, ctx: TitleExtensionContext) => void
  ): void;
  getSessionName(): string | undefined;
  setSessionName(name: string): void;
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((part) =>
      part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
        ? [part.text]
        : []
    )
    .join('\n');
}

/**
 * 提炼用的源文本：已有对话就取开头的用户消息（会话主题在开头），
 * 全新会话还没有分支消息，就用本轮提示词。
 */
function sourceTextOf(ctx: TitleExtensionContext, prompt: string): string {
  const branch = ctx.sessionManager?.getBranch?.() || [];
  const texts: string[] = [];
  for (const entry of branch) {
    if (texts.length >= MAX_SOURCE_MESSAGES) break;
    if (entry?.type !== 'message' || entry.message?.role !== 'user') continue;
    const text = textOfContent(entry.message.content).trim();
    if (text) texts.push(text);
  }
  const source = texts.length > 0 ? texts.join('\n\n') : prompt;
  return source.slice(0, MAX_SOURCE_CHARS);
}

/** 用当前会话模型提炼标题；任何失败都返回空串，交由兜底标题兜住 */
async function requestTitle(ctx: TitleExtensionContext, source: string): Promise<string> {
  if (!ctx.model) return '';
  const context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `为这条消息起一个会话标题：\n${source}`, timestamp: Date.now() }],
  };
  /** 标题很短：限输出、不重试、带超时；推理关不掉时再试一次默认档 */
  const attempt = (reasoning?: 'off') => ({
    maxTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(reasoning ? { reasoning } : {}),
  });

  for (const options of [attempt('off'), attempt()]) {
    try {
      const response = await ctx.modelRegistry.streamSimple(ctx.model, context, options).result();
      if (!response || response.stopReason === 'error') continue;
      const text = (response.content || [])
        .filter((part) => part?.type === 'text')
        .map((part) => part.text || '')
        .join('\n');
      const title = normalizeSessionTitle(text);
      if (title) return title;
    } catch {
      // 该档推理设置不被模型支持时换下一档；全部失败就保留兜底标题
    }
  }
  return '';
}

export = function openloopTitleExtension(pi: TitleExtensionApi): void {
  let generating = false;

  pi.on('before_agent_start', (event, ctx) => {
    // 已有名字：任务标题或用户重命名，属于人工钉住的标题，不再自动生成
    if (pi.getSessionName()) return;
    const prompt = (event.prompt || '').trim();
    if (!prompt) return;
    if (generating) return;

    const source = sourceTextOf(ctx, prompt);
    const fallback = fallbackSessionTitle(source);
    if (!fallback) return;
    pi.setSessionName(fallback);

    generating = true;
    // 后台提炼，不 await：本轮对话不等命名结果
    void requestTitle(ctx, source)
      .then((title) => {
        if (!title || title === fallback) return;
        // 期间被用户改过名：人工结果优先，放弃回写
        if (pi.getSessionName() !== fallback) return;
        pi.setSessionName(title);
      })
      .catch(() => {
        // 自动命名失败不影响主链路，保留兜底标题
      })
      .finally(() => {
        generating = false;
      });
  });
};
