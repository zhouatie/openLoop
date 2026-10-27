import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconPlus,
  IconSend,
  IconStop,
  IconFolderClose,
  IconChevronDown,
  IconClose,
  IconFile,
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
  /** 输入卡左下角的扩展按钮（技能、目录、预设等由上层注入） */
  actions?: React.ReactNode;
  /** 斜杠指令候选（来自 /api/agent/commands-and-skills） */
  commands?: ComposerCommand[];
  /** @ 文件候选：按前缀查询当前工作区文件 */
  onRequestFiles?: (query: string) => Promise<string[]>;
  /** 工具权限预设 */
  permission?: ComposerPermission;
  onPermissionSelect?: (preset: ComposerPermission) => void;
  /** 模型候选 */
  models?: Array<{ id: string; label: string }>;
  onModelSelect?: (model: string) => void;
}

interface MenuState {
  kind: 'slash' | 'mention' | 'model' | 'permission';
  items: Array<{ key: string; label: string; description?: string; isDir?: boolean }>;
  index: number;
}

const PERMISSION_ORDER: ComposerPermission[] = ['full', 'readonly', 'noshell'];

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
  actions,
  commands,
  onRequestFiles,
  permission,
  onPermissionSelect,
  models,
  onModelSelect,
}: ComposerProps) {
  const { matchShortcut } = useShortcuts();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [files, setFiles] = useState<string[]>([]);

  // 高度随内容增长，最多 8 行
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const lineHeight = 24;
    const maxHeight = lineHeight * 8 + 8;
    node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`;
  }, [value]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
  }, [value, disabled, onSend]);

  /** 斜杠指令与 @ 文件：按光标前的 token 决定候选菜单 */
  const syncSuggestions = useCallback(
    (text: string) => {
      if (commands && commands.length > 0 && /^\/[^\s]*$/.test(text)) {
        const query = text.slice(1).toLowerCase();
        const items = commands
          .filter((command) => command.name.toLowerCase().includes(query))
          .slice(0, 8)
          .map((command) => ({
            key: `/${command.name}`,
            label: `/${command.name}`,
            description: command.description,
          }));
        setMenu(items.length > 0 ? { kind: 'slash', items, index: 0 } : null);
        return;
      }

      const mention = /(?:^|\s)@([^\s]*)$/.exec(text);
      if (mention && onRequestFiles) {
        const query = mention[1];
        void onRequestFiles(query)
          .then((list) => {
            setFiles(list);
            setMenu(
              list.length > 0
                ? {
                    kind: 'mention',
                    items: list.slice(0, 12).map((item) => ({
                      key: item,
                      label: item,
                      isDir: item.endsWith('/'),
                    })),
                    index: 0,
                  }
                : null
            );
          })
          .catch(() => setMenu(null));
        return;
      }

      setMenu((prev) => (prev && (prev.kind === 'slash' || prev.kind === 'mention') ? null : prev));
    },
    [commands, onRequestFiles]
  );

  const applyMenuChoice = useCallback(
    (choice: { key: string }) => {
      if (!menu) return;
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
    [menu, onModelSelect, onPermissionSelect, onChange, value]
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
        if (event.key === 'Enter' && (menu.kind === 'slash' || menu.kind === 'mention')) {
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

  const openMenu = (kind: 'model' | 'permission') => {
    if (kind === 'permission' && onPermissionSelect) {
      setMenu({
        kind,
        index: 0,
        items: PERMISSION_ORDER.map((preset) => ({
          key: preset,
          label: PERMISSION_LABEL[preset],
          description: preset === permission ? '当前' : undefined,
        })),
      });
      return;
    }
    if (kind === 'model' && onModelSelect && models && models.length > 0) {
      setMenu({
        kind,
        index: 0,
        items: models.map((item) => ({
          key: item.id,
          label: item.label,
          description: item.id === model ? '当前' : undefined,
        })),
      });
    }
  };

  const canSend = value.trim().length > 0 && !disabled;
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

  return (
    <div className={styles.root}>
      {menu && menu.items.length > 0 && (
        <div
          className={`${styles.popover} ${menu.kind === 'mention' ? styles.popoverList : ''}`}
          role="listbox"
          data-agent-transient
        >
          {menu.kind === 'mention' && <div className={styles.popoverHeader}>文件与文件夹</div>}
          {menu.items.map((item, index) => (
            <button
              key={item.key}
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
                <span className={`${styles.popoverIcon} ${item.isDir ? styles.popoverIconDir : ''}`}>
                  {item.isDir ? <IconFolderClose size={16} /> : <IconFile size={16} />}
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
            </button>
          ))}
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
                  item.status === 'error' ? styles.attachmentError : ''
                }`}
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

        <textarea
          ref={textareaRef}
          className={styles.input}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            syncSuggestions(event.target.value);
          }}
          onKeyDown={handleKeyDown}
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
                  className={styles.add}
                  onClick={() => fileInputRef.current?.click()}
                  title="添加图片附件"
                >
                  <IconPlus size={16} />
                </button>
              </>
            )}
            {actions}
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
            {busy && (
              <span className={styles.queueHint} title="运行中回车会把消息排入队列">
                可追加消息
              </span>
            )}
            <button
              type="button"
              className={styles.primary}
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
