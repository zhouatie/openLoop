import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Workflow, Copy, Check, AlertCircle, Loader2 } from 'lucide-react';
import { WorkflowDefinition } from '@openloop/core';
import { TagInput } from './TagInput';

export interface EditWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflow: WorkflowDefinition | null;
  onSave: (params: { id: string; name: string; description: string; tags?: string[] }) => Promise<void>;
}

export const EditWorkflowModal: React.FC<EditWorkflowModalProps> = ({
  isOpen,
  onClose,
  workflow,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (workflow) {
      setName(workflow.name || '');
      setDescription(workflow.description || '');
      setTags(Array.isArray(workflow.tags) ? [...workflow.tags] : []);
      setErrorMsg(null);
      setCopiedId(false);
    }
  }, [workflow, isOpen]);

  useEffect(() => {
    if (isOpen) {
      // 弹窗打开后聚焦于名称输入框
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !loading) {
        handleSubmit(e as any);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, name, description, workflow]);

  if (!isOpen || !workflow) return null;

  const handleCopyId = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!workflow.id) return;
    try {
      navigator.clipboard.writeText(workflow.id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
      if (import.meta.env?.DEV) {
        console.log('[WorkflowEdit] 复制流程 ID 到剪贴板:', workflow.id);
      }
    } catch (err) {
      console.warn('[WorkflowEdit] 复制 ID 失败:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMsg('流水线名称不能为空');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    if (import.meta.env?.DEV) {
      console.log('[WorkflowEdit] 提交编辑工作流基本信息:', {
        id: workflow.id,
        name: trimmedName,
        description: description.trim(),
        tags,
      });
    }

    try {
      await onSave({
        id: workflow.id,
        name: trimmedName,
        description: description.trim(),
        tags,
      });
      onClose();
    } catch (err: any) {
      const msg = err?.message || '保存失败，请检查网络或服务连接';
      if (import.meta.env?.DEV) {
        console.error('[WorkflowEdit] 保存工作流失败:', err);
      }
      setErrorMsg(`保存失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100 select-none"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] bg-white rounded-[12px] border border-[#e3e3e8] shadow-[0_20px_48px_rgba(20,22,30,0.16)] p-5 animate-in zoom-in-95 duration-150 -mt-12 text-[#1c1c21]"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-3.5 border-b border-[#ececf0]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[8px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center justify-center text-[#4f46e5]">
              <Workflow size={16} strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-[#1c1c21] tracking-tight leading-snug">
                编辑流水线信息
              </h3>
              <p className="text-[11.5px] text-[#85858d] mt-0.5">
                调整工作流的显示名称与用途说明
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded-[6px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* 错误提示 */}
        {errorMsg && (
          <div className="mt-3.5 flex items-center gap-2 p-2.5 rounded-[7px] bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] text-[12px]">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{errorMsg}</span>
          </div>
        )}

        {/* 表单区域 */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-[12px]">
          {/* 流水线 ID 只读显示 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1">流水线标识 (ID)</label>
            <div className="flex items-center justify-between h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 font-mono text-[11px] text-[#85858d]">
              <span>{workflow.id}</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="flex items-center gap-1 text-[10px] text-[#63636b] hover:text-[#1c1c21] transition-colors"
                title="复制流程 ID"
              >
                {copiedId ? (
                  <>
                    <Check size={11} className="text-[#189a58]" />
                    <span className="text-[#189a58]">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy size={11} />
                    <span>复制</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 流水线名称 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1">
              流水线名称 <span className="text-[#e11d48]">*</span>
            </label>
            <input
              ref={inputRef}
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="例如: 智能 PR Review 与回归测试流水线"
              className="w-full h-[32px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[#1c1c21] outline-none focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/30 transition-all placeholder:text-[#85858d]"
            />
          </div>

          {/* 分类标签 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1">流水线分类标签</label>
            <TagInput
              tags={tags}
              onChange={setTags}
              placeholder="输入标签（例如：工作、部署、QA）后回车..."
            />
          </div>

          {/* 流程描述 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1">流程描述</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="说明此流水线的目标、执行环节与业务规则..."
              className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2.5 text-[#1c1c21] outline-none resize-none focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/30 transition-all placeholder:text-[#85858d]"
            />
          </div>

          {/* 拓扑信息小卡片 */}
          <div className="bg-[#f9f9fb] border border-[#ececf0] rounded-[7px] p-2.5 flex items-center justify-between text-[11px] text-[#85858d]">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-[#4b4b53]">拓扑规模:</span>
              <span className="font-mono">
                {workflow.nodes?.length || 0} 个节点 · {workflow.edges?.length || 0} 组依赖
              </span>
            </div>
            <div className="text-[10.5px]">
              快捷键 <kbd className="px-1 py-0.5 bg-white border border-[#e3e3e8] rounded text-[9.5px]">⌘ + Enter</kbd> 保存
            </div>
          </div>

          {/* 底部操作按钮 */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#ececf0]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="h-[28px] px-3 rounded-[6px] text-[#4b4b53] hover:bg-[#f1f1f4] text-[12px] font-medium transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="h-[28px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium flex items-center gap-1.5 active:scale-95 disabled:opacity-50 transition-all shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <Save size={12} />
                  <span>保存修改</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
