import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconPlus,
  IconSend,
  IconStop,
  IconFolderClose,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCheck,
  IconChip,
  IconFile,
  IconReferenceFile,
  IconChatLines,
  IconShield,
  IconTask,
  IconGroup,
  IconRun,
} from './icons';
import styles from './Composer.module.css';
import { ComposerEditor } from './composer-editor/ComposerEditor';
import type { ComposerEditorHandle } from './composer-editor/ComposerEditor';
import type { EditorProjection } from './composer-editor/projection';
import { sessionMention, taskMention } from './mentions';
import type { TaskActionMode } from './TaskActionPanel';
import { useShortcuts } from '../context/ShortcutContext';
import { useShortcutBindings } from '../hooks/useShortcutBindings';

export interface ComposerAttachmentItem {
  id: string;
  name: string;
  previewUrl?: string;
  status: 'uploading' | 'ready' | 'error';
  errorMessage?: string;
}

export interface ComposerCommand {
  name: string;
  description?: string;
  /** 菜单里的分组标签：指令 / 模板指令 / 技能 */
  kind?: 'command' | 'template' | 'skill';
}

export interface ComposerMentionItem {
  key: string;
  label: string;
  kind: 'file' | 'dir' | 'session' | 'task';
  description?: string;
  /** 会话 / 任务的 id：引用要带上它 */
  refId?: string;
}

export type ComposerPermission = 'full' | 'readonly' | 'noshell';

export const PERMISSION_LABEL: Record<ComposerPermission, string> = {
  full: '完全权限',
  readonly: '只读模式',
  noshell: '禁用命令',
};

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string) => void;
  /** Super + Enter：打断当前回答后立即发送 */
  onAcceleratedSend?: (message: string) => void;
  onStop?: () => void;
  busy?: boolean;
  awaitingInput?: boolean;
  disabled?: boolean;
  placeholder?: string;
  model?: string;
  thinking?: string;
  /** 附件由挂载方持有：本次传入即渲染，未传则不出现附件入口 */
  attachments?: ComposerAttachmentItem[];
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  /** 斜杠指令候选（来自 /api/agent/commands-and-skills） */
  commands?: ComposerCommand[];
  /** @ 候选：文件 / 目录 / 会话 */
  onRequestMentions?: (query: string) => Promise<ComposerMentionItem[]>;
  /** 工具权限预设 */
  permission?: ComposerPermission;
  onPermissionSelect?: (preset: ComposerPermission) => void;
  /** 模型候选 */
  models?: Array<{ id: string; label: string }>;
  onModelSelect?: (model: string) => void;
  /** 输入卡左侧控件行的附加操作（会话树入口等） */
  toolsExtra?: React.ReactNode;
  /** ➕ 面板里的任务入口：未传时该分组不出现 */
  onTaskAction?: (mode: TaskActionMode) => void;
  /** 快捷键是否生效 */
  shortcutsEnabled?: boolean;
  /** 快捷键层级优先级 */
  shortcutPriority?: number;
}

/** 输入卡内的图标操作：与输入卡同一套圆角与悬停态 */
export function ComposerIconButton({
  active,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={`${styles.iconAction} ${active ? styles.iconActionActive : ''} ${className || ''}`}
      {...rest}
    />
  );
}

interface MenuItem {
  key: string;
  label: string;
  /** ➕ 面板行：中文名旁的英文命令名 */
  alias?: string;
  description?: string;
  icon?: React.ReactNode;
  /** ➕ 面板的分组标题（添加 / 指令） */
  section?: string;
  /** 当前生效的选项 */
  checked?: boolean;
  isDir?: boolean;
  tag?: string;
  group?: string;
  mentionKind?: ComposerMentionItem['kind'];
  /** 会话行带上会话 id，选中后写进引用 */
  refId?: string;
}

interface MenuState {
  kind: 'slash' | 'mention' | 'add' | 'model' | 'permission';
  items: MenuItem[];
  index: number;
  /** 由 ➕ 面板进入的子菜单：顶部给一行返回 */
  fromAdd?: boolean;
  /** @ 菜单当前查询词：目录下钻后用来还原面包屑 */
  query?: string;
}

const PERMISSION_ORDER: ComposerPermission[] = ['full', 'readonly', 'noshell'];
/** @ 候选的本地防抖：每次按键都请求会让工作区文件列表接口排队 */
const MENTION_DEBOUNCE_MS = 120;
/** 词内字符：与 dsh 的 WORD_CHAR 一致，中文等非 ASCII 字母也算词内 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * 光标前的 @ token：与 dsh 的 activeAtToken 同规则。
 * @ 只在草稿开头或空白之后触发，邮箱这类词内 @ 不开面板；
 * `@"` 打开引号写法，查询词可带空格。
 * 返回 token 在草稿里的起点与查询词，选中候选时只替换这一段。
 */
function atTokenBefore(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(before);
  if (quoted !== null) return { start: caret - quoted[1].length, query: quoted[2] };
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(before);
  if (plain === null) return null;
  return { start: caret - plain[1].length, query: plain[2] };
}

/** 斜杠的词边界：行首、空白或标点后才算触发点，URL 里的斜杠不算 */
function slashBoundaryOk(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text.charAt(index - 1);
  if (/\s/u.test(prev)) return true;
  if (WORD_CHAR.test(prev)) return false;
  // 协议、`//` 与 Windows 盘符里的斜杠当普通字符
  if (prev === '/') return false;
  if (prev === ':' && index >= 2 && !/\s/u.test(text.charAt(index - 2))) return false;
  return true;
}

/** @ 候选行：文件 / 目录 / 会话 / 任务共用一套行结构，按类型分组 */
function mentionRows(list: ComposerMentionItem[]): MenuItem[] {
  return list.map((item) => ({
    key: item.key,
    label: item.label,
    description: item.description,
    isDir: item.kind === 'dir',
    mentionKind: item.kind,
    refId: item.refId,
    group:
      item.kind === 'session'
        ? '会话'
        : item.kind === 'task'
          ? '任务'
          : '文件与文件夹',
  }));
}

/** 已下钻的目录：从工作区根到当前层逐级可回退，和 dsh 的面包屑一致 */
function mentionCrumbs(query: string): Array<{ label: string; prefix: string }> | null {
  const slash = query.lastIndexOf('/');
  if (slash < 0) return null;
  const segments = query.slice(0, slash).split('/').filter(Boolean);
  return [
    { label: '工作区', prefix: '' },
    ...segments.map((label, index) => ({
      label,
      prefix: `${segments.slice(0, index + 1).join('/')}/`,
    })),
  ];
}

/** 光标前的 / token：和 dsh 一致，行首与文字中间都可触发 */
function slashTokenBefore(text: string, caret: number): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const char = text.charAt(i);
    if (/\s/u.test(char)) return null;
    if (char !== '/' || !slashBoundaryOk(text, i)) continue;
    return { start: i, query: text.slice(i + 1, caret) };
  }
  return null;
}

/** 输入卡：28px 圆角面板 + 底部控件行，交互保留 textarea（中文输入法最稳） */
export const Composer = React.memo(function Composer({
  value,
  onChange,
  onSend,
  onAcceleratedSend,
  onStop,
  busy,
  awaitingInput,
  disabled,
  placeholder,
  model,
  thinking,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  commands,
  onRequestMentions,
  permission,
  onPermissionSelect,
  models,
  onModelSelect,
  toolsExtra,
  onTaskAction,
  shortcutsEnabled = true,
  shortcutPriority = 0,
}: ComposerProps) {
  const { matchShortcut, describeShortcut } = useShortcuts();
  const addKeys = describeShortcut('composer.addMenu').join('+');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ComposerEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  /** 编辑器里的草稿文本（chip 展开成 `@path`）：发送与可发送判断都用它 */
  const [text, setText] = useState(value);

  /** 发送后焦点留在输入框：发送期间输入框会短暂禁用，解禁后再补回焦点 */
  const restoreFocusRef = useRef(false);
  const focusInput = useCallback(() => editorRef.current?.focus(), []);

  useEffect(() => {
    if (disabled || !restoreFocusRef.current) return;
    // 焦点已被别处拿走时不抢回
    const active = document.activeElement;
    if (active && active !== document.body) {
      restoreFocusRef.current = false;
      return;
    }
    focusInput();
  }, [disabled, focusInput]);

  const submit = useCallback(() => {
    const trimmed = text.trim();
    if (import.meta.env?.DEV) console.log('[Composer] 提交:', { length: trimmed.length });
    if (!trimmed || disabled) return;
    // 生成中发送会作为追加消息排入本轮，由输入卡上方的排队条承接反馈
    onSend(trimmed);
    // 发送会让输入框短暂禁用：下一帧取回焦点，仍禁用则等解禁后补回
    restoreFocusRef.current = true;
    window.requestAnimationFrame(focusInput);
  }, [text, disabled, onSend, focusInput]);

  /** @ 候选的请求序号：连续输入时只采纳最后一次的结果，避免旧结果盖掉新候选 */
  const mentionSeq = useRef(0);
  const mentionTimer = useRef<number | null>(null);
  /** 当前 @ / 斜杠 token 在草稿里的范围：选中候选时只替换这一段，不动前后文字 */
  const tokenSpan = useRef<{ start: number; end: number } | null>(null);
  /** 斜杠 token 着色的词表：指令与技能名 */
  const refNames = useMemo(() => (commands ?? []).map((item) => item.name), [commands]);

  /** @ 候选请求：输入与目录下钻走同一条路径，后到的结果覆盖先到的 */
  const loadMentions = useCallback(
    (query: string) => {
      const request = onRequestMentions;
      if (!request) return;
      const seq = ++mentionSeq.current;
      void request(query)
        .then((list) => {
          if (seq !== mentionSeq.current) return;
          if (import.meta.env?.DEV && list.length > 0) {
            console.log('[Composer] @ 候选:', { query, count: list.length });
          }
          setMenu(
            list.length > 0
              ? { kind: 'mention', items: mentionRows(list), index: 0, query }
              : null
          );
        })
        .catch(() => {
          if (seq === mentionSeq.current) setMenu(null);
        });
    },
    [onRequestMentions]
  );

  /** 斜杠指令与 @ 文件：按光标前的 token 决定候选菜单 */
  const syncSuggestions = useCallback(
    (text: string, caret: number) => {
      if (mentionTimer.current !== null) {
        window.clearTimeout(mentionTimer.current);
        mentionTimer.current = null;
      }
      const slashCommands = commands && commands.length > 0 ? commands : null;
      const slash = slashCommands ? slashTokenBefore(text, caret) : null;
      if (slash && slashCommands) {
        tokenSpan.current = { start: slash.start, end: caret };
        const query = slash.query.toLowerCase();
        const matched = slashCommands
          .filter((command) => command.name.toLowerCase().includes(query))
          .slice(0, 10);
        const items = matched.map((command) => ({
          key: `/${command.name}`,
          label: `/${command.name}`,
          description: command.description,
          tag: command.kind === 'skill' ? '技能' : command.kind === 'template' ? '模板' : '指令',
          group:
            command.kind === 'skill'
              ? '技能'
              : command.kind === 'template'
                ? '模板指令（可继续补充参数）'
                : '指令',
        }));
        setMenu(items.length > 0 ? { kind: 'slash', items, index: 0 } : null);
        return;
      }

      if (import.meta.env?.DEV) {
        console.log('[Composer] 候选检测:', { caret, head: text.slice(0, caret) });
      }
      const request = onRequestMentions;
      const at = request ? atTokenBefore(text, caret) : null;
      if (at && request) {
        tokenSpan.current = { start: at.start, end: caret };
        const query = at.query;
        // 敲键立刻作废在途请求，防抖窗内不会闪回旧候选
        mentionSeq.current += 1;
        mentionTimer.current = window.setTimeout(() => {
          mentionTimer.current = null;
          loadMentions(query);
        }, MENTION_DEBOUNCE_MS);
        return;
      }

      setMenu((prev) => (prev && (prev.kind === 'slash' || prev.kind === 'mention') ? null : prev));
    },
    [commands, onRequestMentions, loadMentions]
  );

  useEffect(
    () => () => {
      if (mentionTimer.current !== null) window.clearTimeout(mentionTimer.current);
    },
    []
  );

  /** 编辑器每次提交后同步草稿与候选菜单 */
  const handleEditorUpdate = useCallback(
    (projection: EditorProjection) => {
      setText(projection.clipboardText);
      onChange(projection.clipboardText);
      // 只有焦点在输入框时才驱动候选：发送后清空、切会话恢复草稿不应弹出面板
      if (!rootRef.current?.contains(document.activeElement)) return;
      syncSuggestions(projection.detectText, projection.caret ?? projection.detectText.length);
    },
    [onChange, syncSuggestions]
  );

  /** 外部改写草稿（发送后清空、切会话、指令回填）：让编辑器跟随 */
  useEffect(() => {
    if (value === text) return;
    editorRef.current?.setDraft(value);
  }, [value, text]);

  /** 权限 / 模型清单：面板与底部 chip 共用同一套行渲染 */
  const openMenu = useCallback(
    (kind: 'model' | 'permission', fromAdd = false) => {
      // 底部 chip 再点一次收起
      if (!fromAdd && menu?.kind === kind) {
        setMenu(null);
        return;
      }
      const rows: MenuItem[] =
        kind === 'permission'
          ? PERMISSION_ORDER.map((preset) => ({
              key: preset,
              label: PERMISSION_LABEL[preset],
              icon: <IconShield size={16} />,
              checked: preset === permission,
            }))
          : (models || []).map((item) => ({
              key: item.id,
              label: item.label,
              icon: <IconChip size={16} />,
              checked: item.id === model,
            }));
      // 没有对应回调时这行本就不出现，这里只做防御
      if (rows.length === 0) return;
      setMenu({ kind, items: rows, index: 0, fromAdd });
      // 焦点留在输入框：菜单的键盘选择走编辑器的按键处理
      editorRef.current?.focus();
    },
    [menu, permission, model, models]
  );

  /** ➕ 面板：任务 / 添加 / 指令三段，行内带图标、命令名与说明（取自 DSH 命令菜单） */
  const openAddMenu = useCallback(() => {
    if (menu?.kind === 'add') {
      setMenu(null);
      return;
    }
    const items: MenuItem[] = [];
    if (onTaskAction) {
      items.push(
        {
          key: 'task',
          label: '任务',
          alias: 'task',
          description: '把输入卡里的需求变成任务',
          icon: <IconTask size={16} />,
          section: '任务与流水线',
        },
        {
          key: 'group',
          label: '任务组',
          alias: 'group',
          description: '一行一个子工序，串行编排',
          icon: <IconGroup size={16} />,
          section: '任务与流水线',
        },
        {
          key: 'pipeline',
          label: '流水线',
          alias: 'run',
          description: '为已有任务选择流水线并启动',
          icon: <IconRun size={16} />,
          section: '任务与流水线',
        }
      );
    }
    if (onAddFiles) {
      items.push({
        key: 'file',
        label: '文件',
        alias: 'file',
        description: '上传图片作为附件',
        icon: <IconFile size={16} />,
        section: '添加',
      });
    }
    if (onPermissionSelect) {
      items.push({
        key: 'permission',
        label: '权限',
        alias: 'permission',
        description: '切换工具权限预设',
        icon: <IconShield size={16} />,
        section: '指令',
      });
    }
    if (onModelSelect && models && models.length > 0) {
      items.push({
        key: 'model',
        label: '模型',
        alias: 'model',
        description: '选择本会话使用的模型',
        icon: <IconChip size={16} />,
        section: '指令',
      });
    }
    if (import.meta.env?.DEV) console.log('[Composer] 打开 ➕ 面板:', items.map((item) => item.key));
    setMenu({ kind: 'add', items, index: 0 });
    // 点加号不抢焦点：面板的上下键与回车由编辑器承接
    editorRef.current?.focus();
  }, [menu, onAddFiles, onPermissionSelect, onModelSelect, models, onTaskAction]);

  useShortcutBindings(
    useMemo(
      () => ({
        'composer.addMenu': onAddFiles ? openAddMenu : undefined,
      }),
      [onAddFiles, openAddMenu]
    ),
    shortcutsEnabled && !disabled,
    shortcutPriority
  );

  /** 选中候选：只替换当前 token，前后文字和光标都原位保留 */
  const insertToken = useCallback((insert: string, keepSpan = false) => {
    const editor = editorRef.current;
    if (!editor) return;
    const span = tokenSpan.current ?? editor.caretSpan();
    editor.replaceText(span, insert);
    setMenu(null);
    // 目录下钻后面板还要接着用：保留 token 范围，下一层候选仍能原位替换
    tokenSpan.current = keepSpan ? { start: span.start, end: span.start + insert.length } : null;
  }, []);

  /** @param drill 目录行的下钻动作：dsh 里只有 Tab 与行尾箭头下钻，选中一律落成 chip */
  const applyMenuChoice = useCallback(
    (choice: { key: string }, drill = false) => {
      if (!menu) return;
      if (menu.kind === 'add') {
        if (import.meta.env?.DEV) console.log('[Composer] ➕ 面板选择:', choice.key);
        if (choice.key === 'file') {
          setMenu(null);
          fileInputRef.current?.click();
          return;
        }
        if (choice.key === 'task' || choice.key === 'group' || choice.key === 'pipeline') {
          setMenu(null);
          onTaskAction?.(choice.key);
          return;
        }
        openMenu(choice.key === 'permission' ? 'permission' : 'model', true);
        return;
      }
      if (menu.kind === 'model' && onModelSelect) {
        onModelSelect(choice.key);
        setMenu(null);
        return;
      }
      if (menu.kind === 'permission' && onPermissionSelect) {
        onPermissionSelect(choice.key as ComposerPermission);
        setMenu(null);
        return;
      }
      if (menu.kind === 'slash') {
        insertToken(`${choice.key} `);
        return;
      }
      if (menu.kind === 'mention') {
        const picked = menu.items.find((item) => item.key === choice.key);
        if (!picked) return;
        if (picked.isDir && drill) {
          if (import.meta.env?.DEV) console.log('[Composer] @ 目录下钻:', picked.key);
          insertToken(`@${picked.key}`, true);
          loadMentions(picked.key);
          return;
        }
        const editor = editorRef.current;
        if (!editor) return;
        const span = tokenSpan.current ?? editor.caretSpan();
        // 会话与任务都落成带标题的引用 chip：标题里的空格不再是分隔符
        if (picked.mentionKind === 'session' || picked.mentionKind === 'task') {
          const id = picked.refId ?? picked.key;
          const isTask = picked.mentionKind === 'task';
          editor.insertReference(span, {
            ref: id,
            label: picked.label,
            appearance: isTask ? 'task' : 'session',
            clipboardText: isTask
              ? taskMention(picked.label, id)
              : sessionMention(picked.label, id),
          });
          setMenu(null);
          tokenSpan.current = null;
          editor.focus();
          return;
        }
        // 目录引用同样落成 chip，路径保留结尾斜杠以区分文件夹
        editor.insertReference(span, {
          ref: picked.key,
          label: picked.label.replace(/\/$/, ''),
          appearance: picked.isDir ? 'folder' : 'file',
          clipboardText: `@${picked.key}`,
        });
        setMenu(null);
        tokenSpan.current = null;
      }
    },
    [menu, openMenu, onModelSelect, onPermissionSelect, insertToken, loadMentions, onTaskAction]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // 中文输入法候选阶段的回车不能触发发送
      if (event.nativeEvent.isComposing) return;

      if (menu && menu.items.length > 0) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          // 拦在编辑器之前：否则方向键会先移动光标
          event.preventDefault();
          event.stopPropagation();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setMenu({ ...menu, index: (menu.index + step + menu.items.length) % menu.items.length });
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setMenu(null);
          return;
        }
        if (event.key === 'Tab' && (menu.kind === 'mention' || menu.kind === 'slash')) {
          // 与 dsh 一致：Shift+Tab 收起面板；目录行 Tab 下钻并保持面板，其余行 Tab 直接落成引用
          event.preventDefault();
          event.stopPropagation();
          const picked = menu.items[menu.index];
          if (event.shiftKey) setMenu(null);
          else if (picked) applyMenuChoice(picked, picked.isDir === true);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          applyMenuChoice(menu.items[menu.index]);
          return;
        }
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        // 拦截在编辑器之前，否则 Lexical 会先插入换行
        event.preventDefault();
        event.stopPropagation();
        // Super + Enter：打断当前回答并立刻发送
        if (onAcceleratedSend && matchShortcut(event.nativeEvent, 'chat.acceleratedSend') && text.trim()) {
          onAcceleratedSend(text.trim());
          return;
        }
        submit();
      }
    },
    [submit, menu, applyMenuChoice, onAcceleratedSend, matchShortcut, text]
  );

  const acceptFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!onAddFiles || !list) return;
      const picked = Array.from(list);
      if (picked.length === 0) return;
      onAddFiles(picked);
    },
    [onAddFiles]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      acceptFiles(event.dataTransfer?.files || null);
    },
    [acceptFiles]
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!onAddFiles) return;
      const picked = Array.from(event.clipboardData?.files || []).filter((item) =>
        item.type.startsWith('image/')
      );
      if (picked.length === 0) return;
      // 图片走附件，其余文本交给编辑器自己插入
      event.preventDefault();
      onAddFiles(picked);
    },
    [onAddFiles]
  );

  const canSend = text.trim().length > 0 && !disabled;

  /** 命令面板：点面板外关闭；Esc 只关面板，不穿透到面板级的缩放/关闭快捷键 */
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setPreview(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [preview]);

  const hasAttachments = Boolean(attachments && attachments.length > 0);
  /** ➕ 面板与权限 / 模型清单共用一套行渲染，斜杠与 @ 保留紧凑候选列表 */
  const panelMenu =
    menu && (menu.kind === 'add' || menu.kind === 'permission' || menu.kind === 'model') ? menu : null;
  /** @ 菜单下钻后的面包屑：最后一级是当前目录，不能点 */
  const crumbs = menu?.kind === 'mention' ? mentionCrumbs(menu.query || '') : null;

  return (
    <div className={styles.root} ref={rootRef}>
      {panelMenu && panelMenu.items.length > 0 && (
        <div
          className={`${styles.popover} ${styles.popoverPanel}`}
          role="menu"
          aria-label={panelMenu.fromAdd ? '子菜单' : '添加'}
          data-agent-transient
        >
          {panelMenu.fromAdd && (
            <button
              type="button"
              className={styles.panelBack}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openAddMenu}
            >
              <IconChevronDown size={12} className={styles.panelBackChevron} />
              返回
            </button>
          )}
          {panelMenu.items.map((item, index) => (
            <React.Fragment key={item.key}>
              {item.section && item.section !== panelMenu.items[index - 1]?.section && (
                <div className={styles.panelSection}>{item.section}</div>
              )}
              <button
                type="button"
                className={`${styles.panelItem} ${
                  index === panelMenu.index ? styles.panelItemActive : ''
                }`}
                role="menuitem"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setMenu({ ...panelMenu, index })}
                onClick={() => applyMenuChoice(item)}
              >
                {item.icon && <span className={styles.panelIcon}>{item.icon}</span>}
                <span className={styles.panelLabel}>{item.label}</span>
                {item.alias && <span className={styles.panelAlias}>{item.alias}</span>}
                {item.description && <span className={styles.panelDesc}>{item.description}</span>}
                {item.checked && (
                  <span className={styles.panelCheck}>
                    <IconCheck size={14} />
                  </span>
                )}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {menu && (menu.kind === 'slash' || menu.kind === 'mention') && menu.items.length > 0 && (
        <div
          className={`${styles.popover} ${menu.kind === 'mention' ? styles.popoverList : ''}`}
          role="listbox"
          data-agent-transient
        >
          {crumbs && (
            <div className={styles.popoverCrumbs}>
              {crumbs.map((crumb, index) => {
                const current = index === crumbs.length - 1;
                return (
                  <React.Fragment key={`crumb-${crumb.prefix}`}>
                    {index > 0 && (
                      <span className={styles.popoverCrumbSep}>
                        <IconChevronRight size={12} />
                      </span>
                    )}
                    <button
                      type="button"
                      className={`${styles.popoverCrumb} ${current ? styles.popoverCrumbCurrent : ''}`}
                      disabled={current}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        insertToken(`@${crumb.prefix}`, true);
                        loadMentions(crumb.prefix);
                      }}
                    >
                      {crumb.label}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}
          {menu.items.map((item, index) => {
            const showGroup = Boolean(item.group) && item.group !== menu.items[index - 1]?.group;
            return (
              <React.Fragment key={`${item.group || ''}-${item.key}`}>
                {showGroup && <div className={styles.popoverHeader}>{item.group}</div>}
                <button
                  type="button"
                  className={`${styles.popoverItem} ${index === menu.index ? styles.popoverItemActive : ''} ${
                    menu.kind === 'mention' ? styles.popoverRow : ''
                  }`}
                  role="option"
                  aria-selected={index === menu.index}
                  onMouseEnter={() => setMenu({ ...menu, index })}
                  onClick={() => applyMenuChoice(item)}
                >
                  {menu.kind === 'mention' && (
                    <span className={styles.popoverIcon}>
                      {item.mentionKind === 'session' ? (
                        <IconChatLines size={14} />
                      ) : item.mentionKind === 'task' ? (
                        <IconTask size={14} />
                      ) : item.isDir ? (
                        <IconFolderClose size={14} />
                      ) : (
                        <IconReferenceFile size={14} />
                      )}
                    </span>
                  )}
                  <span className={menu.kind === 'mention' ? styles.popoverName : styles.popoverLabel}>
                    {item.label}
                  </span>
                  {item.description && <span className={styles.popoverDesc}>{item.description}</span>}
                  {menu.kind === 'mention' && item.isDir && (
                    <span className={styles.popoverTrailing}>
                      {/* 与 dsh 一致：进入提示只在当前行出现，箭头常驻以对齐右边缘 */}
                      {index === menu.index && (
                        <>
                          <span className={styles.popoverDrillHint}>进入目录</span>
                          <kbd className={styles.popoverKey}>Tab</kbd>
                        </>
                      )}
                      <span
                        role="button"
                        tabIndex={-1}
                        className={styles.popoverDrill}
                        aria-label="进入目录"
                        // 行尾箭头是下钻的唯一鼠标入口，不能让事件冒泡成整行选中
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          applyMenuChoice(item, true);
                        }}
                      >
                        <IconChevronRight size={12} />
                      </span>
                    </span>
                  )}
                  {menu.kind === 'slash' && item.tag && (
                    <span className={styles.popoverTag}>{item.tag}</span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div
        className={`${styles.card} ${isDragging ? styles.cardDragging : ''}`}
        onDragOver={
          onAddFiles
            ? (event) => {
                event.preventDefault();
                if (!isDragging) setIsDragging(true);
              }
            : undefined
        }
        onDragLeave={
          onAddFiles
            ? (event) => {
                event.preventDefault();
                setIsDragging(false);
              }
            : undefined
        }
        onDrop={onAddFiles ? handleDrop : undefined}
      >
        {hasAttachments && (
          <div className={styles.attachments}>
            {attachments!.map((item) => (
              <div
                key={item.id}
                className={`${styles.attachment} ${
                  item.previewUrl ? styles.attachmentImage : ''
                } ${item.status === 'error' ? styles.attachmentError : ''}`}
                title={item.errorMessage || item.name}
              >
                {item.previewUrl ? (
                  <button
                    type="button"
                    className={styles.attachmentThumbButton}
                    onClick={() => setPreview({ url: item.previewUrl as string, name: item.name })}
                    title="查看大图"
                    aria-label={`预览 ${item.name}`}
                  >
                    <img className={styles.attachmentThumb} src={item.previewUrl} alt={item.name} />
                  </button>
                ) : (
                  <span className={styles.attachmentIcon}>▤</span>
                )}
                <span className={styles.attachmentName}>{item.name}</span>
                {item.status === 'uploading' && <span className={styles.attachmentSpinner} />}
                {onRemoveAttachment && (
                  <button
                    type="button"
                    className={styles.attachmentRemove}
                    onClick={() => onRemoveAttachment(item.id)}
                    title="移除"
                    aria-label={`移除 ${item.name}`}
                  >
                    <IconClose size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {preview && (
          <div
            className={styles.previewBackdrop}
            data-agent-transient
            role="dialog"
            aria-label="图片预览"
            onClick={() => setPreview(null)}
          >
            <img
              className={styles.previewImage}
              src={preview.url}
              alt={preview.name}
              onClick={(event) => event.stopPropagation()}
            />
            <div className={styles.previewBar}>
              <span className={styles.previewName}>{preview.name}</span>
              <button
                type="button"
                className={styles.previewClose}
                onClick={() => setPreview(null)}
                aria-label="关闭预览"
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {isDragging && (
          <div className={styles.dropOverlay} aria-hidden>
            松开以添加图片
          </div>
        )}

        <ComposerEditor
          ref={editorRef}
          onUpdate={handleEditorUpdate}
          refNames={refNames}
          onKeyDownCapture={handleKeyDown}
          onFocus={() => {
            restoreFocusRef.current = false;
          }}
          onPaste={handlePaste}
          placeholder={placeholder || '描述你想要构建的内容，/ 调用指令，@ 引用文件'}
          disabled={disabled}
        />

        <div className={styles.row}>
          <div className={styles.tools}>
            {onAddFiles && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  className={styles.fileInput}
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  onChange={(event) => {
                    acceptFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className={`${styles.add} ${menu?.kind === 'add' ? styles.addActive : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={openAddMenu}
                  title={`添加 ${addKeys}`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.kind === 'add'}
                >
                  <IconPlus size={16} />
                </button>
              </>
            )}
            {toolsExtra}
            {onPermissionSelect && (
              <button
                type="button"
                className={styles.chip}
                onClick={() => openMenu('permission')}
                title="切换工具权限"
              >
                {PERMISSION_LABEL[permission || 'full']}
              </button>
            )}
            {thinking && thinking !== 'off' && (
              <span className={styles.chip} title={`思考等级：${thinking}`}>
                思考 {thinking}
              </span>
            )}
            {awaitingInput && <span className={styles.hint}>等待你的回复</span>}
          </div>

          <div className={styles.trailing}>
            {/* 模型席位与 dsh 一致：停在输入框右下角，紧邻发送按钮 */}
            {model && (
              <button
                type="button"
                className={styles.chip}
                onClick={() => openMenu('model')}
                title={onModelSelect ? '切换模型' : model}
                disabled={!onModelSelect}
              >
                {model}
              </button>
            )}
            <button
              type="button"
              className={styles.primary}
              // 按下不抢焦点，发送后输入框仍可直接继续输入
              onMouseDown={(event) => event.preventDefault()}
              onClick={busy && onStop ? onStop : submit}
              disabled={busy ? false : !canSend}
              title={busy ? '中止本轮' : '发送'}
              aria-label={busy ? '停止' : '发送'}
            >
              {busy ? <IconStop size={16} /> : <IconSend size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
