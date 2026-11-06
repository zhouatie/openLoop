/**
 * Markdown 流水线的纯解析：只有字符串处理，无运行时依赖。
 * 服务端与渲染层共用同一份约定（文件头、二级标题步骤）。
 */

/** Markdown 流水线的文件头信息 */
export interface MarkdownPipelineMeta {
  /** 流水线 id，仓库里的文件头用；数据库里的记录是运行时副本 */
  id: string;
  /** 流水线名称，缺省回落到数据库里的名称 */
  name: string;
  tags: string[];
  /** 流程正文，去掉文件头后的全部内容 */
  body: string;
}

/**
 * 解析 Markdown 流水线。
 * 文件头只承载身份信息（name / tags），正文是人工写的流程说明，不解析成步骤。
 */
export function parseMarkdownPipeline(raw: string, fallbackName = ''): MarkdownPipelineMeta {
  const text = (raw || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const meta: MarkdownPipelineMeta = { id: '', name: fallbackName, tags: [], body: text.trim() };
  if (lines[0]?.trim() !== '---') return meta;

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return meta;

  for (const line of lines.slice(1, end)) {
    const hit = /^([A-Za-z][\w-]*)\s*:\s*(.+)$/.exec(line.trim());
    if (!hit) continue;
    const [, key, value] = hit;
    if (key === 'id') meta.id = value.trim();
    if (key === 'name') meta.name = value.trim();
    if (key === 'tags') {
      meta.tags = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  meta.body = lines.slice(end + 1).join('\n').trim();
  return meta;
}

/**
 * 提取流程文档的步骤：二级标题（##）即一个步骤，代码块内的文本不参与。
 * 界面按它展示流水线环节，与编排 Agent 的步骤约定共用同一份定义。
 */
export function parseMarkdownSteps(raw: string): string[] {
  const steps: string[] = [];
  let inFence = false;
  for (const line of (raw || '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const hit = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (hit) steps.push(hit[1].trim());
  }
  return steps;
}
