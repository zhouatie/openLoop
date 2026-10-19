import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  BookmarkPlus,
  Sparkles,
  Pin,
  Check,
  Terminal,
  Bot,
  Layers,
} from 'lucide-react';
import { NodeType, NodeConfig } from '@openloop/core';
import { getNodeTypeVisuals } from '../../services/recipeStore';

export interface SaveRecipeModalProps {
  isOpen: boolean;
  nodeName: string;
  nodeType: NodeType;
  nodeConfig: Partial<NodeConfig>;
  onClose: () => void;
  onSave: (data: {
    name: string;
    subtitle: string;
    description: string;
    pinToSidebar: boolean;
  }) => void;
}

export const SaveRecipeModal: React.FC<SaveRecipeModalProps> = ({
  isOpen,
  nodeName,
  nodeType,
  nodeConfig,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState(nodeName);
  const [subtitle, setSubtitle] = useState('');
  const [description, setDescription] = useState('');
  const [pinToSidebar, setPinToSidebar] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(nodeName || '我的常用步骤');
      setSubtitle('');
      setDescription('');
      setPinToSidebar(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, nodeName]);

  // Esc 快捷退出
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const visuals = getNodeTypeVisuals(nodeType, nodeName, nodeConfig?.command);
  const IconComp = visuals.icon;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave({
      name: name.trim(),
      subtitle: subtitle.trim() || `${nodeType.toUpperCase()} 常用预设`,
      description: description.trim() || subtitle.trim() || `${name.trim()} 自定义动作步骤`,
      pinToSidebar,
    });
  };

  const previewSnippet =
    nodeType === 'agent'
      ? nodeConfig.prompt || '(未设置 Prompt)'
      : nodeType === 'cli'
      ? nodeConfig.command || '(未设置 CLI 命令)'
      : nodeType === 'midscene'
      ? nodeConfig.testUrl || '(未设置测试地址)'
      : nodeType === 'hook'
      ? nodeConfig.webhookUrl || '(未设置 Webhook 地址)'
      : JSON.stringify(nodeConfig, null, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_12px_40px_rgba(0,0,0,0.12)] w-full max-w-[460px] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 表头 */}
        <div className="h-[44px] px-4 bg-[#fafafc] border-b border-[#e3e3e8] flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-[4px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center justify-center text-[#4f46e5]">
              <BookmarkPlus size={11} strokeWidth={2.2} />
            </div>
            <span className="text-[12.5px] font-semibold text-[#1c1c21]">
              存为常用动作配方
            </span>
          </div>

          <button
            onClick={onClose}
            className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-colors cursor-pointer"
            title="关闭 (Esc)"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-[12px]">
          {/* 配方基本类型胶囊提示 */}
          <div className="flex items-center justify-between p-2 rounded-[6px] bg-[#f9f9fb] border border-[#ececf0]">
            <div className="flex items-center gap-2">
              <div
                className={`w-5 h-5 rounded-[4px] ${visuals.iconBg} ${visuals.iconText} border ${visuals.borderClass} flex items-center justify-center`}
              >
                <IconComp size={11} strokeWidth={2} />
              </div>
              <span className="text-[11.5px] font-medium text-[#1c1c21]">
                基于当前步骤配置另存
              </span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white text-[#71717a] border border-[#e3e3e8]">
              {nodeType}
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#63636b] mb-1">
              配方名称 <span className="text-[#dc2626]">*</span>
            </label>
            <input
              ref={inputRef}
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：AI 代码走查专家、增量构建与单测"
              className="w-full h-[32px] px-2.5 bg-[#f9f9fb] focus:bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[6px] text-[12px] text-[#1c1c21] outline-none transition-all shadow-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#63636b] mb-1">
              功能副标题 / 一句话说明 (选填)
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="例如：严格走查潜在坏味道与边界安全性"
              className="w-full h-[32px] px-2.5 bg-[#f9f9fb] focus:bg-white border border-[#e3e3e8] focus:border-[#4f46e5] rounded-[6px] text-[12px] text-[#1c1c21] outline-none transition-all shadow-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#63636b] mb-1">
              当前配置内容预览
            </label>
            <div className="max-h-[85px] overflow-y-auto p-2 rounded-[6px] bg-[#f4f4f6] border border-[#e3e3e8] font-mono text-[10.5px] text-[#4b4b53] leading-relaxed break-all select-text">
              {previewSnippet}
            </div>
          </div>

          {/* 设为边栏常用复选框 */}
          <div className="pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pinToSidebar}
                onChange={(e) => setPinToSidebar(e.target.checked)}
                className="w-3.5 h-3.5 accent-[#4f46e5] rounded cursor-pointer"
              />
              <span className="text-[11.5px] text-[#1c1c21] flex items-center gap-1 font-medium">
                <Pin size={11} className="text-[#4f46e5]" />
                <span>同时固定到画布左侧「常用动作步骤」快捷坞</span>
              </span>
            </label>
            <div className="text-[10.5px] text-[#85858d] ml-5.5 mt-0.5">
              固定后无需打开弹窗，可在左侧常用坞一键点击直接添加
            </div>
          </div>

          {/* 底部按钮 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f1f1f4]">
            <button
              type="button"
              onClick={onClose}
              className="h-[28px] px-3 rounded-[5px] text-[11.5px] font-medium text-[#63636b] hover:text-[#1c1c21] hover:bg-[#f1f1f4] transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="h-[28px] px-3.5 rounded-[5px] bg-[#4f46e5] hover:bg-[#4338ca] disabled:opacity-50 text-white text-[11.5px] font-medium flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
            >
              <Check size={12} strokeWidth={2.4} />
              <span>保存为配方</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
