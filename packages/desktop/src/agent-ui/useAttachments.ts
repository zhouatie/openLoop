import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskAttachment } from '@openloop/core/types';
import { api } from '../services/api';
import type { ComposerAttachmentItem } from './Composer';

export interface PendingAttachment extends ComposerAttachmentItem {
  attachment?: TaskAttachment;
}

export interface UseAttachmentsResult {
  items: PendingAttachment[];
  ready: TaskAttachment[];
  add: (files: File[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  isUploading: boolean;
}

let seq = 0;

/**
 * 附件管线：只负责「选文件 → 上传 → 得到可用附件」。
 * 由挂载方决定是否启用、发送时是否带上，面板本身不感知上传策略。
 * scope 变化（切换会话）即清空，上一段会话的图不会留到下一段。
 */
export function useAttachments(scope?: string): UseAttachmentsResult {
  const [items, setItems] = useState<PendingAttachment[]>([]);

  const add = useCallback((files: File[]) => {
    const uploadable = files.filter((file) => file.size > 0);
    if (uploadable.length === 0) return;

    const drafts: PendingAttachment[] = uploadable.map((file) => ({
      id: `att_${Date.now()}_${++seq}`,
      name: file.name || '图片',
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      status: 'uploading',
    }));

    setItems((prev) => [...prev, ...drafts]);

    for (let i = 0; i < drafts.length; i += 1) {
      const draft = drafts[i];
      const file = uploadable[i];
      void api
        .uploadAttachment(file)
        .then((attachment) => {
          if (import.meta.env?.DEV) {
            console.log('[AgentUI:Attachments] 附件已上传:', attachment.name, attachment.path);
          }
          setItems((prev) =>
            prev.map((item) =>
              item.id === draft.id ? { ...item, status: 'ready', attachment } : item
            )
          );
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : '上传失败';
          if (import.meta.env?.DEV) {
            console.warn('[AgentUI:Attachments] 附件上传失败:', draft.name, message);
          }
          setItems((prev) =>
            prev.map((item) =>
              item.id === draft.id ? { ...item, status: 'error', errorMessage: message } : item
            )
          );
        });
    }
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const item of prev) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
  }, []);

  const scopeRef = useRef(scope);
  useEffect(() => {
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;
    if (import.meta.env?.DEV) {
      console.log('[AgentUI:Attachments] 切换会话，清空待发附件:', scope);
    }
    clear();
  }, [scope, clear]);

  // 引用稳定：否则每次渲染都会让挂载方的发送回调重建
  const ready = useMemo(
    () =>
      items
        .filter((item) => item.status === 'ready' && item.attachment)
        .map((item) => item.attachment as TaskAttachment),
    [items]
  );

  return {
    items,
    ready,
    add,
    remove,
    clear,
    isUploading: items.some((item) => item.status === 'uploading'),
  };
}
