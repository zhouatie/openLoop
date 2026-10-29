import type { ShortcutSuperKey } from '@openloop/core';

/**
 * 智能体面板与其所属界面的快捷键命令表。
 * 绑定字符串格式：`修饰键+...+按键`，修饰键取 `super`（受全局 Super 键设置影响）、
 * `alt`、`shift`；按键取键盘事件归一化后的 token（`n`、`/`、`enter`、`esc`）。
 */
export type ShortcutGroup = 'chat' | 'panel';

export interface ShortcutCommand {
  id: string;
  label: string;
  description: string;
  group: ShortcutGroup;
  /** 默认绑定；`esc esc` 为双击手势，不可录制 */
  defaultBinding: string;
  /** 输入框聚焦时是否仍可触发 */
  allowInInput?: boolean;
  /** 固定手势，设置页只读展示 */
  fixed?: boolean;
}

export const SHORTCUT_COMMANDS: ShortcutCommand[] = [
  {
    id: 'chat.stop',
    label: '停止生成',
    description: '连按两次 Esc 中断当前回答',
    group: 'chat',
    defaultBinding: 'esc esc',
    fixed: true,
  },
  {
    id: 'chat.acceleratedSend',
    label: '立即插话发送',
    description: '中断当前回答并立刻发送这条消息',
    group: 'chat',
    defaultBinding: 'super+enter',
    allowInInput: true,
  },
  {
    id: 'shortcuts.sheet',
    label: '快捷键速查',
    description: '打开面板内快捷键一览',
    group: 'chat',
    defaultBinding: 'super+/',
    allowInInput: true,
  },
  {
    id: 'session.new',
    label: '新会话',
    description: '在当前工作区新建会话',
    group: 'panel',
    defaultBinding: 'super+n',
  },
  {
    id: 'session.search',
    label: '搜索会话',
    description: '聚焦会话搜索框',
    group: 'panel',
    defaultBinding: 'super+k',
  },
  {
    id: 'workspace.add',
    label: '添加工作区',
    description: '选择本地目录作为工作区',
    group: 'panel',
    defaultBinding: 'super+o',
  },
  {
    id: 'session.rename',
    label: '重命名会话',
    description: '重命名当前选中的会话',
    group: 'panel',
    defaultBinding: 'super+alt+g',
  },
  {
    id: 'session.archive',
    label: '归档 / 取消归档会话',
    description: '切换当前会话的归档状态',
    group: 'panel',
    defaultBinding: 'super+shift+a',
  },
  {
    id: 'dock.toggle',
    label: '工作台开关',
    description: '展开或收起右侧工作台',
    group: 'panel',
    defaultBinding: 'super+alt+b',
    allowInInput: true,
  },
  {
    id: 'dock.files',
    label: '工作台：文件',
    description: '打开工作台的文件面板',
    group: 'panel',
    defaultBinding: 'super+p',
  },
  {
    id: 'dock.terminal',
    label: '工作台：终端',
    description: '打开工作台的终端面板',
    group: 'panel',
    defaultBinding: 'super+t',
  },
  {
    id: 'session.tree',
    label: '会话树',
    description: '查看会话分支，回到任意历史节点继续',
    group: 'panel',
    defaultBinding: 'super+shift+t',
    allowInInput: true,
  },
];

export const SHORTCUT_COMMAND_MAP: Record<string, ShortcutCommand> = Object.fromEntries(
  SHORTCUT_COMMANDS.map((command) => [command.id, command])
);

export const DEFAULT_SHORTCUT_BINDINGS: Record<string, string> = Object.fromEntries(
  SHORTCUT_COMMANDS.map((command) => [command.id, command.defaultBinding])
);

const SUPER_TOKEN = 'super';

/** 键盘事件归一化为绑定中的按键 token */
const keyToken = (event: KeyboardEvent): string => {
  const raw = event.key;
  if (raw === ' ' || raw === 'Spacebar') return 'space';
  if (raw === 'Esc' || raw === 'Escape') return 'esc';
  if (raw === 'Enter' || raw === 'Return') return 'enter';
  if (raw === 'Backquote' || raw === '`' || raw === '~') return '`';
  if (raw === 'IntlBackslash') return '`';
  if (raw === '/') return '/';
  return raw.toLowerCase();
};

/**
 * 物理键位归一化。macOS 上按住 Option 会让 event.key 变成特殊字符（⌥B → '∫'），
 * 匹配与录制都要优先用 code。
 */
const codeToken = (event: KeyboardEvent): string | null => {
  const code = event.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === 'Slash' || code === 'NumpadDivide') return '/';
  if (code === 'Backquote' || code === 'IntlBackslash') return '`';
  if (code === 'Comma') return ',';
  if (code === 'Minus') return '-';
  if (code === 'Equal') return '=';
  if (code === 'Enter' || code === 'NumpadEnter') return 'enter';
  if (code === 'Escape') return 'esc';
  if (code === 'Space') return 'space';
  return null;
};

/** 事件按键是否等于绑定里的按键片段 */
const matchesKey = (event: KeyboardEvent, key: string): boolean => {
  if (keyToken(event) === key) return true;
  const fromCode = codeToken(event);
  return fromCode !== null && fromCode === key;
};

/** 录制时把普通按键事件转成绑定字符串 */
export function bindingFromEvent(event: KeyboardEvent, superKey: ShortcutSuperKey): string | null {
  // 有修饰键时以物理键位为准，避免 Option 组合产生特殊字符
  const token = (event.altKey || event.metaKey || event.ctrlKey ? codeToken(event) : null) || keyToken(event);
  // 单独按修饰键不构成绑定；Esc 保留给「停止生成」手势
  if (['control', 'meta', 'alt', 'shift', 'esc'].includes(token)) return null;
  const parts: string[] = [];
  const superPressed =
    superKey === 'Meta' ? event.metaKey : superKey === 'Alt' ? event.altKey : event.ctrlKey;
  if (superPressed) parts.push(SUPER_TOKEN);
  if (superKey === 'Alt' ? event.ctrlKey : event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(token);
  return parts.join('+');
}

export interface ParsedBinding {
  needSuper: boolean;
  needAlt: boolean;
  needShift: boolean;
  key: string;
}

export function parseBinding(binding: string): ParsedBinding {
  const parts = binding.toLowerCase().split('+');
  const key = parts[parts.length - 1] || '';
  const mods = new Set(parts.slice(0, -1));
  return {
    needSuper: mods.has(SUPER_TOKEN),
    needAlt: mods.has('alt'),
    needShift: mods.has('shift'),
    key,
  };
}

/** 判断键盘事件是否命中绑定；Super 键跟随全局设置 */
export function matchesBinding(
  event: KeyboardEvent,
  binding: string,
  superKey: ShortcutSuperKey
): boolean {
  if (!binding) return false;
  const parsed = parseBinding(binding);
  const superPressed =
    superKey === 'Meta' ? event.metaKey : superKey === 'Alt' ? event.altKey : event.ctrlKey;
  // Super 设为 Alt 时，alt 位置由 ctrl 承担，避免与 Super 冲突
  const altPressed = superKey === 'Alt' ? event.ctrlKey : event.altKey;

  if (parsed.needSuper !== superPressed) return false;
  if (parsed.needAlt !== altPressed) return false;
  if (parsed.needShift !== event.shiftKey) return false;
  if (!parsed.needSuper && (event.ctrlKey || event.metaKey || event.altKey)) return false;
  return matchesKey(event, parsed.key);
}

/** 绑定字符串转成展示用的按键片段，Super 为设置中的符号 */
export function describeBinding(
  binding: string,
  superKey: ShortcutSuperKey
): string[] {
  if (!binding) return [];
  if (binding === 'esc esc') return ['Esc', 'Esc'];
  const parsed = parseBinding(binding);
  const superSymbol = superKey === 'Meta' ? '⌘' : superKey === 'Alt' ? '⌥' : 'Ctrl';
  const tokens: string[] = [];
  if (parsed.needSuper) tokens.push(superSymbol);
  if (parsed.needAlt) tokens.push(superKey === 'Alt' ? 'Ctrl' : '⌥');
  if (parsed.needShift) tokens.push('⇧');
  const keyLabels: Record<string, string> = {
    enter: 'Enter',
    esc: 'Esc',
    space: 'Space',
    '`': '`',
    '/': '/',
  };
  tokens.push(keyLabels[parsed.key] || parsed.key.toUpperCase());
  return tokens;
}
