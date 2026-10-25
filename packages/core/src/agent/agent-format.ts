import { SessionChatMessage } from '../types';

/**
 * 提取工具调用的纯文本结果（兼容 Pi RPC 格式与各类 CLI 原始输出）
 */
export function extractToolResultText(result: any): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;

  // 1. Pi ToolResult 规范格式: { content: [{ type: 'text', text: '...' }] }
  if (result && typeof result === 'object' && Array.isArray(result.content)) {
    const textPieces = result.content
      .filter((c: any) => c && (c.type === 'text' || typeof c.text === 'string'))
      .map((c: any) => c.text || '');
    if (textPieces.length > 0) {
      return textPieces.join('\n');
    }
  }

  // 2. structuredContent 或 output / stdout / error 常见字段
  if (result && typeof result === 'object') {
    if (typeof result.structuredContent?.output === 'string') {
      return result.structuredContent.output;
    }
    if (typeof result.output === 'string') {
      return result.output;
    }
    if (typeof result.stdout === 'string') {
      return result.stdout;
    }
    if (typeof result.error === 'string') {
      return result.error;
    }
    if (typeof result.message === 'string') {
      return result.message;
    }
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  return String(result);
}

/**
 * 格式化工具调用参数，提取最关键的入参展示（如 bash 命令、文件路径等），避免 JSON 字符串杂乱堆叠
 */
export function formatToolArgs(toolName: string, args: any): string {
  if (!args) return '';
  if (typeof args === 'string') return args;
  if (typeof args === 'object') {
    if (args.command && typeof args.command === 'string') return args.command;
    if (args.pattern && typeof args.pattern === 'string') return `"${args.pattern}"`;
    if (args.path && typeof args.path === 'string') return args.path;
    if (args.file && typeof args.file === 'string') return args.file;
    if (args.query && typeof args.query === 'string') return args.query;
    try {
      return JSON.stringify(args);
    } catch {
      return String(args);
    }
  }
  return String(args);
}

/**
 * 清理会话中被工具执行结果污染的 Assistant 消息。
 * 历史版本在 message_end(toolResult) 时将工具输出覆盖到了 msg.content，
 * 导致界面将工具输出错误地渲染为未格式化的普通 Markdown 卡片。
 */
export function sanitizeChatMessages(messages?: SessionChatMessage[]): SessionChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((msg) => {
    if (msg.role !== 'assistant' || !msg.tools || msg.tools.length === 0 || !msg.content) {
      return msg;
    }
    const trimmedContent = msg.content.trim();
    // 检查 msg.content 是否与当前消息挂载的任意工具输出完全一致
    const isToolOutputDuplicate = msg.tools.some((tool) => {
      const toolText = extractToolResultText(tool.result).trim();
      return toolText && toolText === trimmedContent;
    });

    if (isToolOutputDuplicate) {
      return {
        ...msg,
        content: '',
      };
    }
    return msg;
  });
}
