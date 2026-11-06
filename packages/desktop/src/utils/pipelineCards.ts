/**
 * 流水线步骤卡片模型。
 *
 * 流水线在数据库里仍是一段 JS（workflow.script），卡片视图把这段 JS 渲染成
 * 可增删排序的步骤：卡片参数按字段拆成表单，保存时重新拼回调用参数。
 */

export type CardKind = 'worktree' | 'merge' | 'cleanup' | 'agent' | 'approval' | 'node';

export type FieldType = 'text' | 'number' | 'bool' | 'lines' | 'json';

export interface CardField {
  id: string;
  /** 参数对象的键名 */
  key: string;
  type: FieldType;
  /** text/number/bool 为原值，lines 一行一项，json 为原文 */
  value: string;
}

export interface PipelineCard {
  id: string;
  kind: CardKind;
  /** 步骤名称，写回参数对象的 name / title */
  title: string;
  /** 通用节点的执行器类型，仅 node 卡片使用 */
  nodeType: string;
  fields: CardField[];
}

export interface CardKindMeta {
  kind: CardKind;
  label: string;
  hint: string;
  /** 脚本里的调用表达式 */
  call: string;
  /** 步骤注释里的类型标签，即执行器 id */
  stepType: string;
  /** 步骤名称落在参数对象的哪个键上 */
  titleKey: 'name' | 'title';
  defaultTitle: string;
  defaultFields: () => CardField[];
  defaultNodeType?: string;
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '文本',
  number: '数字',
  bool: '开关',
  lines: '列表',
  json: 'JSON',
};

/** 常见参数键的中文名，未收录的键直接显示键名 */
export const KEY_LABELS: Record<string, string> = {
  prompt: '指令',
  command: '命令',
  agentName: 'Agent 名称',
  timeoutSec: '超时秒',
  basePort: '起始端口',
  allocatePorts: '分配端口',
  portBases: '端口映射',
  sharedPaths: '共享路径',
  healthUrl: '健康地址',
  targetPlatform: '目标平台',
  platform: '平台',
  warmupTimeoutMs: '预热毫秒',
  background: '后台运行',
  checklist: '验收清单',
  instructions: '操作步骤',
  deviceSerial: '设备序列号',
  appPackage: '应用包名',
  testUrl: '测试地址',
  wdaEndpoint: 'WDA 地址',
  skipLaunch: '跳过启动',
  editableParams: '需求字段',
};

/** 内容较长的键用多行输入 */
const MULTILINE_KEYS = ['prompt', 'command', 'testUrl'];

export function isMultiline(key: string): boolean {
  return MULTILINE_KEYS.includes(key);
}

/** 内置步骤类型：尽量通用，任何执行器都可以走「通用节点」 */
export const CARD_KINDS: CardKindMeta[] = [
  {
    kind: 'worktree',
    label: '创建 Worktree',
    hint: '隔离沙箱：分配端口、共享依赖',
    call: 'sandbox.create',
    stepType: 'worktree-setup',
    titleKey: 'name',
    defaultTitle: 'Worktree 隔离沙箱就绪',
    defaultFields: () => [
      field('sharedPaths', 'lines', 'node_modules'),
      field('allocatePorts', 'lines', 'webPort'),
      field('basePort', 'number', '5175'),
      field('timeoutSec', 'number', '120'),
    ],
  },
  {
    kind: 'agent',
    label: 'AI Agent',
    hint: '智能体按需求编码与自测',
    call: 'agent',
    stepType: 'agent',
    titleKey: 'name',
    defaultTitle: 'AI Agent 编码实现',
    defaultFields: () => [
      field('prompt', 'text', '任务需求：{{task.title}}\n详细说明：{{task.description}}'),
      field('agentName', 'text', 'Pi Coding Agent'),
      field('timeoutSec', 'number', '600'),
    ],
  },
  {
    kind: 'approval',
    label: '人工验收',
    hint: '卡点等待人工通过或驳回',
    call: 'approve',
    stepType: 'qa-approval',
    titleKey: 'title',
    defaultTitle: '人工验收门禁',
    defaultFields: () => [
      field('prompt', 'text', '请核对改动与验收指标'),
      field('checklist', 'lines', '改动符合需求\n构建通过'),
    ],
  },
  {
    kind: 'node',
    label: '通用节点',
    hint: '任意执行器：cli、midscene、hook…',
    call: 'node',
    stepType: 'cli',
    titleKey: 'name',
    defaultTitle: '命令执行',
    defaultNodeType: 'cli',
    defaultFields: () => [field('command', 'text', 'pnpm build'), field('timeoutSec', 'number', '300')],
  },
  {
    kind: 'merge',
    label: '合并代码',
    hint: '把沙箱改动合回基线分支',
    call: 'sandbox.merge',
    stepType: 'worktree-merge',
    titleKey: 'name',
    defaultTitle: '合并代码',
    defaultFields: () => [],
  },
  {
    kind: 'cleanup',
    label: '清理沙箱',
    hint: '回收 Worktree 与端口',
    call: 'sandbox.cleanup',
    stepType: 'worktree-cleanup',
    titleKey: 'name',
    defaultTitle: '清理沙箱',
    defaultFields: () => [],
  },
];

/** 通用节点可选的执行器类型 */
export const NODE_TYPES = [
  'cli',
  'agent',
  'hook',
  'midscene',
  'qa-planner',
  'qa-approval',
  'env-prepare',
  'worktree-setup',
  'worktree-merge',
  'worktree-cleanup',
  'sub-workflow',
  'stitch-image',
];

let seq = 0;

function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export function field(key: string, type: FieldType, value = ''): CardField {
  return { id: uid('f'), key, type, value };
}

export function createCard(kind: CardKind): PipelineCard {
  const meta = kindMeta(kind);
  return {
    id: uid('card'),
    kind,
    title: meta.defaultTitle,
    nodeType: meta.defaultNodeType || '',
    fields: meta.defaultFields(),
  };
}

export function kindMeta(kind: CardKind): CardKindMeta {
  return CARD_KINDS.find((item) => item.kind === kind) ?? CARD_KINDS[0];
}

/* ------------------------------------------------------------------ 基础扫描 */

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** 跳过从 start 开始的字符串字面量，返回其后的下标 */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

/** 跳过注释，返回其后的下标 */
function skipComment(text: string, start: number): number {
  if (text[start + 1] === '/') {
    const end = text.indexOf('\n', start);
    return end < 0 ? text.length : end;
  }
  const end = text.indexOf('*/', start + 2);
  return end < 0 ? text.length : end + 2;
}

/** 返回与 start 处括号配对的闭括号下标，找不到返回 -1 */
function matchBracket(text: string, start: number): number {
  const stack: string[] = [];
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i);
      continue;
    }
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i);
      continue;
    }
    if (PAIRS[ch]) {
      stack.push(PAIRS[ch]);
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== ch) return -1;
      i += 1;
      if (stack.length === 0) return i;
      continue;
    }
    i += 1;
  }
  return -1;
}

/** 按顶层逗号切分参数，保留每段原始缩进 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(text, i);
      continue;
    }
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i);
      continue;
    }
    if (PAIRS[ch]) depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  parts.push(text.slice(start));
  return parts.filter((part) => part.trim() !== '');
}

/** 条目去掉首行缩进，续行按首行缩进对齐后返回 */
function alignEntry(part: string): string {
  const lines = part.replace(/^[ \t]*\n/, '').split('\n');
  const base = /^[ \t]*/.exec(lines[0])?.[0].length ?? 0;
  const cleaned = [
    lines[0].trim(),
    ...lines.slice(1).map((line) => line.slice(Math.min(base, /^[ \t]*/.exec(line)?.[0].length ?? 0))),
  ];
  while (cleaned.length > 1 && cleaned[cleaned.length - 1].trim() === '') cleaned.pop();
  return cleaned.join('\n').replace(/[ \t]+$/, '');
}

/** 把条目渲染成规范对象字面量：花括号顶格，条目缩进 2 空格 */
function renderObject(entries: string[]): string {
  if (entries.length === 0) return '{}';
  const body = entries.map((entry) => `  ${entry.replace(/\n/g, '\n  ')}`).join(',\n');
  return `{\n${body},\n}`;
}

/** 读取字符串字面量的值，非字面量返回 null */
function readString(text: string): string | null {
  const literal = text.trim();
  if (!/^["'`]/.test(literal)) return null;
  const end = skipString(literal, 0);
  if (end !== literal.length) return null;
  if (literal[0] === '"') {
    try {
      return JSON.parse(literal);
    } catch {
      return null;
    }
  }
  const body = literal.slice(1, -1);
  if (literal[0] === '`') return body;
  return body.replace(/\\(.)/g, (_, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
}

/* ------------------------------------------------------------------ 字段读写 */

const KEY_HEAD = /^([A-Za-z_$][\w$]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*:\s*/;
const NUMBER_TEXT = /^-?\d+(?:\.\d+)?$/;

/** 手写 JSON 值（对象或数组）的结构检查，返回问题描述 */
export function jsonIssue(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return '需要以 { 或 [ 开头';
  const end = matchBracket(trimmed, 0);
  if (end < 0) return '括号或引号没有闭合';
  if (end !== trimmed.length) return '括号后面还有多余内容';
  return null;
}

/** 按值的书写形式推断字段类型 */
function fieldOf(key: string, raw: string): CardField {
  const text = raw.trim();
  if (/^["'`]/.test(text)) {
    const value = readString(text);
    if (value !== null) return field(key, 'text', value);
  }
  if (text === 'true' || text === 'false') return field(key, 'bool', text);
  if (NUMBER_TEXT.test(text)) return field(key, 'number', text);
  if (text.startsWith('[')) {
    const items = splitTopLevel(text.slice(1, -1)).map(alignEntry);
    const values = items.map(readString);
    if (values.every((item) => item !== null && !item.includes('\n'))) {
      return field(key, 'lines', (values as string[]).join('\n'));
    }
  }
  return field(key, 'json', text);
}

/** 解析调用参数，拆出步骤名称与字段；结构异常返回 null */
function parseFields(params: string, titleKey: string): { title: string; fields: CardField[] } | null {
  const trimmed = params.trim();
  if (!trimmed.startsWith('{')) return null;
  const end = matchBracket(trimmed, 0);
  if (end < 0 || end !== trimmed.length) return null;
  const fields: CardField[] = [];
  let title = '';
  for (const entry of splitTopLevel(trimmed.slice(1, -1)).map(alignEntry)) {
    const head = KEY_HEAD.exec(entry);
    if (!head) return null;
    const key = readString(head[1]) ?? head[1];
    const raw = entry.slice(head[0].length);
    if (key === titleKey) {
      title = readString(raw) ?? '';
      continue;
    }
    fields.push(fieldOf(key, raw));
  }
  return { title, fields };
}

/** 单个字段 → 脚本里的条目文本 */
function renderField(item: CardField): string {
  const key = item.key.trim();
  const value = item.value;
  if (item.type === 'number') {
    const text = value.trim();
    return `${key}: ${NUMBER_TEXT.test(text) ? text : JSON.stringify(value)}`;
  }
  if (item.type === 'bool') return `${key}: ${value === 'true' ? 'true' : 'false'}`;
  if (item.type === 'lines') {
    const items = value.split('\n').filter((line) => line.trim() !== '');
    if (items.length === 0) return `${key}: []`;
    return `${key}: [\n${items.map((line) => `  ${JSON.stringify(line.trim())}`).join(',\n')}\n]`;
  }
  if (item.type === 'json') return `${key}: ${value.trim() || '{}'}`;
  return `${key}: ${JSON.stringify(value)}`;
}

/** 卡片的参数条目：字段在前，步骤名称放最后 */
function renderParams(card: PipelineCard, titleKey: string): string {
  const entries = card.fields.filter((item) => item.key.trim() !== '').map(renderField);
  if (titleKey && card.title.trim()) entries.push(`${titleKey}: ${JSON.stringify(card.title.trim())}`);
  return renderObject(entries);
}

/* ------------------------------------------------------------------ 解析脚本 */

const CALL_HEAD = /^const\s+[A-Za-z_$][\w$]*\s*=\s*await\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/;

function skipTrivia(text: string, start: number): number {
  let i = start;
  for (;;) {
    if (i >= text.length) return i;
    if (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r') {
      i += 1;
      continue;
    }
    if (text[i] === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i);
      continue;
    }
    return i;
  }
}

/** 把一次调用映射成卡片；无法映射返回 null */
function cardOfCall(callee: string, args: string): PipelineCard | null {
  const parts = splitTopLevel(args).map((part) => part.trim());

  if (callee === 'node') {
    if (parts.length < 2 || parts.length > 3) return null;
    const nodeType = readString(parts[0]);
    if (!nodeType) return null;
    const config = parseFields(parts[1], '__none__');
    if (!config) return null;
    let name = '';
    if (parts[2]) {
      // 第三个参数只允许 { name }：其他配置不许在卡片间被吞掉
      const opts = parseFields(parts[2], 'name');
      if (!opts || opts.fields.length > 0) return null;
      name = opts.title;
    }
    return { id: '', kind: 'node', title: name, nodeType, fields: config.fields };
  }

  const meta = CARD_KINDS.find((item) => item.call === callee);
  if (!meta) return null;
  if (parts.length === 0) return { id: '', kind: meta.kind, title: '', nodeType: '', fields: [] };
  if (parts.length > 1) return null;
  const parsed = parseFields(parts[0], meta.titleKey);
  if (!parsed) return null;
  return { id: '', kind: meta.kind, title: parsed.title, nodeType: '', fields: parsed.fields };
}

export function parsePipelineScript(script: string): PipelineCard[] | null {
  const text = script || '';
  if (!text.trim()) return [];

  let i = skipTrivia(text, 0);
  const header = 'export default async function';
  if (!text.startsWith(header, i)) return null;
  i = skipTrivia(text, text.indexOf('{', i) + 1);

  const cards: PipelineCard[] = [];
  while (i < text.length) {
    const lineEnd = text.indexOf('\n', i);
    const stop = lineEnd < 0 ? text.length : lineEnd;
    const raw = text.slice(i, stop);
    const line = raw.trim();
    const at = i + (raw.length - raw.trimStart().length);

    if (!line) {
      i = stop + 1;
      continue;
    }

    // 函数体结束
    if (line === '}') return cards;

    // 步骤前的说明注释
    if (line.startsWith('//') || line.startsWith('/*')) {
      i = skipComment(text, at);
      continue;
    }

    // 结尾 return 与单行守卫：不做卡片，只校验形态
    if (/^return\b/.test(line) || /^if \(!\w+\.ok\) return\b/.test(line)) {
      i = stop + 1;
      continue;
    }

    const call = CALL_HEAD.exec(line);
    if (call) {
      const paren = at + line.indexOf('(', call[0].length - 1);
      const close = matchBracket(text, paren);
      if (close < 0) return null;
      const card = cardOfCall(call[1], text.slice(paren + 1, close - 1));
      if (!card) return null;
      card.id = `card_${cards.length + 1}`;
      cards.push(card);
      i = skipTrivia(text, close);
      continue;
    }

    // const { sandbox, ... } = ctx
    if (/^const \{[^}]*\} = ctx$/.test(line)) {
      i = stop + 1;
      continue;
    }

    // log(...)
    if (line.startsWith('log(')) {
      const close = matchBracket(text, at + 3);
      if (close < 0) return null;
      i = skipTrivia(text, close);
      continue;
    }

    return null;
  }
  return cards;
}

/* ------------------------------------------------------------------ 生成脚本 */

function renderCard(card: PipelineCard, index: number): string {
  const meta = kindMeta(card.kind);
  const id = `step${index + 1}`;
  const title = card.title.trim();
  const params = renderParams(card, card.kind === 'node' ? '' : meta.titleKey);
  const stepType = card.kind === 'node' ? card.nodeType.trim() || 'cli' : meta.stepType;
  const label = title || meta.label;

  let expression: string;
  if (card.kind === 'node') {
    const args = [JSON.stringify(card.nodeType.trim() || 'cli'), params];
    if (title) args.push(`{\n  name: ${JSON.stringify(title)},\n}`);
    expression = `node(${args.join(', ')})`;
  } else {
    expression = `${meta.call}(${params === '{}' && card.kind === 'worktree' ? '' : params})`;
  }
  // 续行整体缩进 2 格，与语句首行对齐
  expression = expression.replace(/\n/g, '\n  ');

  return [
    `  // ${label} (${stepType})`,
    `  const ${id} = await ${expression}`,
    `  if (!${id}.ok) return { status: 'failed', error: "节点「${label}」执行未通过" }`,
  ].join('\n');
}

export function buildPipelineScript(name: string, cards: PipelineCard[]): string {
  const title = name.trim() || '未命名流水线';
  const blocks = [
    '/**',
    ` * ${title}`,
    ' * 由步骤卡片生成的脚本流水线。',
    ' */',
    'export default async function (ctx) {',
    '  const { sandbox, agent, approve, node, log } = ctx',
    '',
    `  log("启动流水线: ${title}")`,
    '',
  ];
  cards.forEach((card, index) => {
    blocks.push(renderCard(card, index), '');
  });
  blocks.push("  return { status: 'success' }", '}', '');
  return blocks.join('\n');
}
