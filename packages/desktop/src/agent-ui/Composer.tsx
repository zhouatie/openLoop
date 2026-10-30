import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconPlus,
  IconSend,
  IconStop,
  IconFolderClose,
  IconChevronDown,
  IconClose,
  IconCheck,
  IconChip,
  IconFile,
  IconNewChat,
  IconShield,
} from './icons';
import styles from './Composer.module.css';
import { useShortcuts } from '../context/ShortcutContext';

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
  kind: 'file' | 'dir' | 'session';
  description?: string;
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
}

interface MenuState {
  kind: 'slash' | 'mention' | 'add' | 'model' | 'permission';
  items: MenuItem[];
  index: number;
  /** 由 ➕ 面板进入的子菜单：顶部给一行返回 */
  fromAdd?: boolean;
}

const PERMISSION_ORDER: ComposerPermission[] = ['full', 'readonly', 'noshell'];
/** @ 候选的本地防抖：每次按键都请求会让工作区文件列表接口排队 */
const MENTION_DEBOUNCE_MS = 120;

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
}: ComposerProps) {
  const { matchShortcut } = useShortcuts();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // 高度随内容增长，最多 8 行
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const lineHeight = 24;
    const maxHeight = lineHeight * 8 + 8;
    node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`;
  }, [value]);

  /** 发送后焦点留在输入框：发送期间输入框会短暂禁用，解禁后再补回焦点 */
  const restoreFocusRef = useRef(false);
  const focusInput = useCallback(() => textareaRef.current?.focus(), []);

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
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    // 生成中发送会作为追加消息排入本轮，由输入卡上方的排队条承接反馈
    onSend(trimmed);
    // 发送会让输入框短暂禁用：下一帧取回焦点，仍禁用则等解禁后补回
    restoreFocusRef.current = true;
    window.requestAnimationFrame(focusInput);
  }, [value, disabled, onSend, focusInput]);

  /** @ 候选的请求序号：连续输入时只采纳最后一次的结果，避免旧结果盖掉新候选 */
  const mentionSeq = useRef(0);
  const mentionTimer = useRef<number | null>(null);

  /** 斜杠指令与 @ 文件：按光标前的 token 决定候选菜单 */
  const syncSuggestions = useCallback(
    (text: string) => {
      if (mentionTimer.current !== null) {
        window.clearTimeout(mentionTimer.current);
        mentionTimer.current = null;
      }
      if (commands && commands.length > 0 && /^\/[^\s]*$/.test(text)) {
        const query = text.slice(1).toLowerCase();
        const matched = commands.filter((command) => command.name.toLowerCase().includes(query)).slice(0, 10);
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

      const mention = /(?:^|\s)@([^\s]*)$/.exec(text);
      if (mention && onRequestMentions) {
        const query = mention[1];
        const seq = ++mentionSeq.current;
        mentionTimer.current = window.setTimeout(() => {
          mentionTimer.current = null;
          void onRequestMentions(query)
            .then((list) => {
              if (seq !== mentionSeq.current) return;
              setMenu(
                list.length > 0
                  ? {
                      kind: 'mention',
                      items: list.slice(0, 14).map((item) => ({
                        key: item.key,
                        label: item.label,
                        description: item.description,
                        isDir: item.kind === 'dir',
                        mentionKind: item.kind,
                        group: item.kind === 'session' ? '会话' : '文件与文件夹',
                      })),
                      index: 0,
                    }
                  : null
              );
            })
            .catch(() => {
              if (seq === mentionSeq.current) setMenu(null);
            });
        }, MENTION_DEBOUNCE_MS);
        return;
      }

      setMenu((prev) => (prev && (prev.kind === 'slash' || prev.kind === 'mention') ? null : prev));
    },
    [commands, onRequestMentions]
  );

  useEffect(
    () => () => {
      if (mentionTimer.current !== null) window.clearTimeout(mentionTimer.current);
    },
    []
  );

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
      // 焦点留在输入框：菜单的键盘选择走 textarea 的按键处理
      textareaRef.current?.focus();
    },
    [menu, permission, model, models]
  );

  /** ➕ 面板：添加 / 指令两段，行内带图标、命令名与说明（取自 DSH 命令菜单） */
  const openAddMenu = useCallback(() => {
    if (menu?.kind === 'add') {
      setMenu(null);
      return;
    }
    const items: MenuItem[] = [];
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
    // 点加号不抢焦点：面板的上下键与回车由 textarea 承接
    textareaRef.current?.focus();
  }, [menu, onAddFiles, onPermissionSelect, onModelSelect, models]);

  const applyMenuChoice = useCallback(
    (choice: { key: string }) => {
      if (!menu) return;
      if (menu.kind === 'add') {
        if (import.meta.env?.DEV) console.log('[Composer] ➕ 面板选择:', choice.key);
        if (choice.key === 'file') {
          setMenu(null);
          fileInputRef.current?.click();
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
        onChange(`${choice.key} `);
        setMenu(null);
        textareaRef.current?.focus();
        return;
      }
      if (menu.kind === 'mention') {
        onChange(value.replace(/@([^\s]*)$/, `@${choice.key} `));
        setMenu(null);
        textareaRef.current?.focus();
      }
    },
    [menu, openMenu, onModelSelect, onPermissionSelect, onChange, value]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 中文输入法候选阶段的回车不能触发发送
      if (event.nativeEvent.isComposing) return;

      if (menu && menu.items.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setMenu({ ...menu, index: (menu.index + 1) % menu.items.length });
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setMenu({ ...menu, index: (menu.index - 1 + menu.items.length) % menu.items.length });
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setMenu(null);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          applyMenuChoice(menu.items[menu.index]);
          return;
        }
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        // Super + Enter：打断当前回答并立刻发送
        if (onAcceleratedSend && matchShortcut(event.nativeEvent, 'chat.acceleratedSend') && value.trim()) {
          event.preventDefault();
          onAcceleratedSend(value.trim());
          return;
        }
        event.preventDefault();
        submit();
      }
    },
    [submit, menu, applyMenuChoice]
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
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!onAddFiles) return;
      const picked = Array.from(event.clipboardData?.files || []).filter((item) =>
        item.type.startsWith('image/')
      );
      if (picked.length === 0) return;
      event.preventDefault();
      onAddFiles(picked);
    },
    [onAddFiles]
  );

  const canSend = value.trim().length > 0 && !disabled;

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
                    <span
                      className={`${styles.popoverIcon} ${
                        item.mentionKind === 'dir' ? styles.popoverIconDir : ''
                      }`}
                    >
                      {item.mentionKind === 'session' ? (
                        <IconNewChat size={16} />
                      ) : item.isDir ? (
                        <IconFolderClose size={16} />
                      ) : (
                        <IconFile size={16} />
                      )}
                    </span>
                  )}
                  <span className={menu.kind === 'mention' ? styles.popoverName : styles.popoverLabel}>
                    {item.label}
                  </span>
                  {item.description && <span className={styles.popoverDesc}>{item.description}</span>}
                  {menu.kind === 'mention' && item.isDir && (
                    <span className={styles.popoverTrailing}>
                      <span className={styles.popoverHint}>进入目录</span>
                      <IconChevronDown size={12} className={styles.popoverChevron} />
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

        <textarea
          ref={textareaRef}
          className={styles.input}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            syncSuggestions(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            restoreFocusRef.current = false;
          }}
          onPaste={handlePaste}
          placeholder={placeholder || '描述你想要构建的内容，/ 调用指令，@ 引用文件'}
          rows={1}
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
                  title="添加"
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
            {thinking && thinking !== 'off' && (
              <span className={styles.chip} title={`思考等级：${thinking}`}>
                思考 {thinking}
              </span>
            )}
            {awaitingInput && <span className={styles.hint}>等待你的回复</span>}
          </div>

          <div className={styles.trailing}>
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
