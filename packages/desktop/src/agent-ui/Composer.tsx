import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IconPlus, IconSend, IconStop } from './icons';
import styles from './Composer.module.css';

export interface ComposerAttachmentItem {
  id: string;
  name: string;
  previewUrl?: string;
  status: 'uploading' | 'ready' | 'error';
  errorMessage?: string;
}

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string) => void;
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
}

/** 输入卡：28px 圆角面板 + 底部控件行，交互保留 textarea（中文输入法最稳） */
export const Composer = React.memo(function Composer({
  value,
  onChange,
  onSend,
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
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 中文输入法候选阶段的回车不能触发发送
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    },
    [submit]
  );

  const acceptFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!onAddFiles || !files) return;
      const list = Array.from(files);
      if (list.length === 0) return;
      onAddFiles(list);
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
      const files = Array.from(event.clipboardData?.files || []).filter((file) =>
        file.type.startsWith('image/')
      );
      if (files.length === 0) return;
      event.preventDefault();
      onAddFiles(files);
    },
    [onAddFiles]
  );

  const canSend = value.trim().length > 0 && !disabled;
  const hasAttachments = Boolean(attachments && attachments.length > 0);

  return (
    <div className={styles.root}>
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
                  <img className={styles.attachmentThumb} src={item.previewUrl} alt={item.name} />
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
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className={styles.input}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder || '描述你想要构建的内容，/ 调用指令'}
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
            {model && (
              <span className={styles.chip} title={model}>
                {model}
              </span>
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
              onClick={busy && onStop ? onStop : submit}
              disabled={busy ? false : !canSend}
              title={busy ? '中止本轮' : '发送'}
            >
              {busy ? <IconStop size={14} /> : <IconSend size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
