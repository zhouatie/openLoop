import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Save,
  Workflow,
  Copy,
  Check,
  AlertCircle,
  Loader2,
  FileText,
  ChevronDown,
  ChevronUp,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import { WorkflowDefinition, WorkflowTaskTemplate } from '@openloop/core';
import { cleanTaskTemplate } from '../utils/workflowTemplate';
import { TagInput } from './TagInput';

export interface EditWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflow: WorkflowDefinition | null;
  onSave: (params: {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    taskTemplate?: WorkflowTaskTemplate;
  }) => Promise<void>;
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
  const [titlePlaceholder, setTitlePlaceholder] = useState('');
  const [descriptionTemplate, setDescriptionTemplate] = useState('');
  const [acceptanceTemplate, setAcceptanceTemplate] = useState('');
  const [isTemplateSectionOpen, setIsTemplateSectionOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (workflow) {
      setName(workflow.name || '');
      setDescription(workflow.description || '');
      setTags(Array.isArray(workflow.tags) ? [...workflow.tags] : []);
      const tpl = workflow.taskTemplate;
      setTitlePlaceholder(tpl?.titlePlaceholder || '');
      setDescriptionTemplate(tpl?.descriptionTemplate || '');
      setAcceptanceTemplate(tpl?.acceptanceTemplate || '');
      setIsTemplateSectionOpen(
        Boolean(tpl?.titlePlaceholder || tpl?.descriptionTemplate || tpl?.acceptanceTemplate)
      );
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

    const taskTemplate = cleanTaskTemplate({
      titlePlaceholder,
      descriptionTemplate,
      acceptanceTemplate,
    });

    if (import.meta.env?.DEV) {
      console.log('[WorkflowEdit] 提交编辑工作流基本信息与任务模板:', {
        id: workflow.id,
        name: trimmedName,
        description: description.trim(),
        tags,
        hasTaskTemplate: Boolean(taskTemplate),
      });
    }

    try {
      await onSave({
        id: workflow.id,
        name: trimmedName,
        description: description.trim(),
        tags,
        taskTemplate,
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

  const handleLoadPresetTemplate = () => {
    if (!titlePlaceholder.trim()) {
      setTitlePlaceholder(`例如: ${name.trim() || '核心需求'} 开发与验收`);
    }
    if (!descriptionTemplate.trim()) {
      setDescriptionTemplate(
        [
          '### 需求目标',
          '- 目标功能说明: ',
          '- 涉及修改模块: ',
          '- 关联依赖/分支: ',
        ].join('\n')
      );
    }
    if (!acceptanceTemplate.trim()) {
      setAcceptanceTemplate(
        [
          '- [ ] 核心功能修改完成并通过本地自测',
          '- [ ] 自动化测试与质量门禁无报错阻断',
        ].join('\n')
      );
    }
    setIsTemplateSectionOpen(true);
  };

  const handleClearTemplate = () => {
    setTitlePlaceholder('');
    setDescriptionTemplate('');
    setAcceptanceTemplate('');
  };

  const configuredTemplateCount = [
    Boolean(titlePlaceholder.trim()),
    Boolean(descriptionTemplate.trim()),
    Boolean(acceptanceTemplate.trim()),
  ].filter(Boolean).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100 select-none"
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[500px] max-h-[88vh] bg-white rounded-[12px] border border-[#e3e3e8] shadow-[0_20px_48px_rgba(20,22,30,0.16)] flex flex-col animate-in zoom-in-95 duration-150 text-[#1c1c21] overflow-hidden"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between p-5 pb-3.5 border-b border-[#ececf0] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[8px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center justify-center text-[#4f46e5]">
              <Workflow size={16} strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-[#1c1c21] tracking-tight leading-snug">
                编辑流水线信息与模板
              </h3>
              <p className="text-[11.5px] text-[#85858d] mt-0.5">
                调整工作流属性与关联任务说明、提示词模板
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded-[6px] text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* 错误提示 */}
        {errorMsg && (
          <div className="mx-5 mt-3.5 flex items-center gap-2 p-2.5 rounded-[7px] bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] text-[12px] shrink-0">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{errorMsg}</span>
          </div>
        )}

        {/* 表单滚动主体区 */}
        <form onSubmit={handleSubmit} className="p-5 pt-3.5 overflow-y-auto space-y-3.5 text-[12px] flex-1">
          {/* 流水线 ID 只读显示 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1">流水线标识 (ID)</label>
            <div className="flex items-center justify-between h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 font-mono text-[11px] text-[#85858d]">
              <span>{workflow.id}</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="flex items-center gap-1 text-[10px] text-[#63636b] hover:text-[#1c1c21] transition-colors cursor-pointer"
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
              rows={2.5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="说明此流水线的目标、执行环节与业务规则..."
              className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2.5 text-[#1c1c21] outline-none resize-none focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/30 transition-all placeholder:text-[#85858d]"
            />
          </div>

          {/* 流程关联任务说明与提示词模板 */}
          <div className="border border-[#e3e3e8] rounded-[8px] bg-[#fafafc] overflow-hidden">
            <div
              onClick={() => setIsTemplateSectionOpen(!isTemplateSectionOpen)}
              className="px-3 py-2.5 flex items-center justify-between cursor-pointer hover:bg-[#f4f4f7] transition-colors select-none"
            >
              <div className="flex items-center gap-2">
                <FileText size={13} className="text-[#4f46e5]" />
                <span className="font-medium text-[#1c1c21] text-[12px]">
                  任务说明与提示词模板
                </span>
                {configuredTemplateCount > 0 ? (
                  <span className="px-1.5 py-0.5 rounded-[4px] bg-[#eeedfd] text-[#4f46e5] text-[10px] font-medium border border-[#d8d6fb]/60">
                    已配 {configuredTemplateCount}/3
                  </span>
                ) : (
                  <span className="text-[10px] text-[#85858d]">未配置 (可选)</span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[#85858d]">
                <span className="text-[10.5px]">
                  {isTemplateSectionOpen ? '收起' : '展开配置'}
                </span>
                {isTemplateSectionOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </div>
            </div>

            {isTemplateSectionOpen && (
              <div className="p-3 pt-2 border-t border-[#ececf0] space-y-3 bg-white">
                <p className="text-[11px] text-[#85858d] leading-relaxed">
                  为该流程配置专属任务输入模板；用户在新建或编辑任务选择该流程时，将自动填充对应提示词与说明骨架。
                </p>

                {/* 任务标题占位提示 */}
                <div>
                  <label className="block font-medium text-[#4b4b53] mb-1 text-[11px]">
                    任务标题输入指引 (Placeholder)
                  </label>
                  <input
                    type="text"
                    value={titlePlaceholder}
                    onChange={(e) => setTitlePlaceholder(e.target.value)}
                    placeholder="例如: 购物车结算全链路回归与截图验收"
                    className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[#1c1c21] outline-none focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/30 transition-all placeholder:text-[#85858d] text-[11.5px]"
                  />
                </div>

                {/* 任务说明与提示词模板 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-[#4b4b53] text-[11px]">
                      任务说明与提示词骨架 (Markdown)
                    </label>
                  </div>
                  <textarea
                    rows={4}
                    value={descriptionTemplate}
                    onChange={(e) => setDescriptionTemplate(e.target.value)}
                    placeholder="输入该流程推荐的需求描述结构或给 Agent 的提示词骨架，例如:&#10;### 需求说明&#10;- 功能目标: &#10;- 涉及模块: "
                    className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2.5 text-[#1c1c21] font-mono text-[11px] leading-relaxed outline-none resize-y focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/30 transition-all placeholder:text-[#85858d] placeholder:font-sans"
                  />
                </div>

                {/* 验收标准与用例模板 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-[#4b4b53] text-[11px]">
                      验收标准与用例骨架 (可选)
                    </label>
                  </div>
                  <textarea
                    rows={3}
                    value={acceptanceTemplate}
                    onChange={(e) => setAcceptanceTemplate(e.target.value)}
                    placeholder="输入该流程推荐的验收标准或自动化测试用例，例如:&#10;- [ ] 核心功能修改完成自测通过&#10;- [ ] 自动化测试与构建无报错"
                    className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2.5 text-[#1c1c21] font-mono text-[11px] leading-relaxed outline-none resize-y focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/30 transition-all placeholder:text-[#85858d] placeholder:font-sans"
                  />
                </div>

                {/* 快捷载入与清空操作 */}
                <div className="flex items-center justify-between pt-1 text-[11px]">
                  <button
                    type="button"
                    onClick={handleLoadPresetTemplate}
                    className="text-[#4f46e5] hover:text-[#4338ca] hover:underline flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <Sparkles size={11} />
                    <span>填入推荐模板骨架</span>
                  </button>
                  {configuredTemplateCount > 0 && (
                    <button
                      type="button"
                      onClick={handleClearTemplate}
                      className="text-[#85858d] hover:text-[#dc2626] flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <RotateCcw size={10} />
                      <span>清空模板</span>
                    </button>
                  )}
                </div>
              </div>
            )}
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
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#ececf0] shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="h-[28px] px-3 rounded-[6px] text-[#4b4b53] hover:bg-[#f1f1f4] text-[12px] font-medium transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="h-[28px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium flex items-center gap-1.5 active:scale-95 disabled:opacity-50 transition-all shadow-sm cursor-pointer"
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
