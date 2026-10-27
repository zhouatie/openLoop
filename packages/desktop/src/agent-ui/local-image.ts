/** 会话里的图片引用（本地路径 / 附件 URL / data URL）统一解析成可渲染的图片地址 */

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** 「随附参考图片」段落的单行形态：[参考图片 1: 名称] 本地文件路径: /abs/path */
const PROMPT_IMAGE_LINE = /^\[参考图片\s*\d+:\s*(.*?)\]\s*本地文件路径:\s*(.+)$/;
const PROMPT_IMAGE_BLOCK = /(?:^|\n)【用户随附参考图片】\s*\n([\s\S]*)$/;

export function isImagePath(value: string | undefined | null): boolean {
  const target = (value || '').trim();
  return target.length > 0 && IMAGE_EXTENSION.test(target.split(/[?#]/)[0]);
}

export function imageSrc(source: string | undefined | null): string {
  const target = (source || '').trim();
  if (!target) return '';
  if (/^(data:|blob:|https?:)/i.test(target) || target.startsWith('/api/')) return target;
  if (target.startsWith('/')) {
    return `/api/local-image?path=${encodeURIComponent(target)}`;
  }
  return `/api/attachments/${target}`;
}

export interface PromptImage {
  name: string;
  path: string;
}

/** 用户消息正文与随附的本地图片路径：正文照旧渲染，图片走缩略图 */
export function splitPromptImages(content: string): { text: string; images: PromptImage[] } {
  const text = content || '';
  const block = PROMPT_IMAGE_BLOCK.exec(text);
  if (!block) return { text, images: [] };

  const images: PromptImage[] = [];
  for (const line of block[1].split('\n')) {
    const hit = PROMPT_IMAGE_LINE.exec(line.trim());
    const imagePath = hit?.[2].trim();
    if (!imagePath) continue;
    images.push({ name: hit![1].trim() || imagePath.split('/').pop() || '图片', path: imagePath });
  }
  return { text: text.slice(0, block.index).trimEnd(), images };
}
