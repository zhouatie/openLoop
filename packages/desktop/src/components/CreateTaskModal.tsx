import React, { useState, useEffect } from 'react';
import { X, Play, Sparkles } from 'lucide-react';
import { WorkflowDefinition } from '@openloop/core';

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  workflows: WorkflowDefinition[];
  onCreate: (params: {
    title: string;
    workflowId: string;
    description: string;
    autoRun: boolean;
  }) => Promise<void>;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  onClose,
  workflows,
  onCreate,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workflowId, setWorkflowId] = useState(workflows[0]?.id || '');
  const [autoRun, setAutoRun] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !workflowId) return;

    setLoading(true);
    try {
      await onCreate({
        title: title.trim(),
        workflowId,
        description: description.trim(),
        autoRun,
      });
      setTitle('');
      setDescription('');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100">
      <div className="w-[480px] bg-white border border-[#e3e3e8] rounded-[12px] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.16)] text-[#1c1c21]">
        <div className="flex items-center justify-between pb-3 border-b border-[#ececf0]">
          <div>
            <h3 className="font-semibold text-[14px] text-[#1c1c21]">新建自动化任务</h3>
            <p className="text-[11.5px] text-[#85858d] mt-0.5">选择编排流程，自动化串联 Agent 与工具流水线</p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21]"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5 text-[12px]">
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1">任务名称</label>
            <input
              type="text"
              required
              placeholder="例如: 用户中心登录优化与验证"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2.5 text-[#1c1c21] placeholder-[#85858d] outline-none focus:bg-white focus:border-[#b9b9c2]"
            />
          </div>

          <div>
            <label className="block font-medium text-[#4b4b53] mb-1">关联自动化流程</label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="w-full h-[30px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[#1c1c21] outline-none"
            >
              {workflows.map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name} ({wf.nodes.length} 个节点)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-medium text-[#4b4b53] mb-1">描述与上下文 (可选)</label>
            <textarea
              rows={2.5}
              placeholder="输入任务需求描述..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2 text-[#1c1c21] placeholder-[#85858d] outline-none resize-none"
            />
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <input
              type="checkbox"
              id="autoRun"
              checked={autoRun}
              onChange={(e) => setAutoRun(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-[#4f46e5] border-[#e3e3e8]"
            />
            <label htmlFor="autoRun" className="text-[#4b4b53] cursor-pointer">
              创建后立即触发 DAG 执行
            </label>
          </div>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#ececf0]">
            <button
              type="button"
              onClick={onClose}
              className="h-[28px] px-3 rounded-[6px] text-[#4b4b53] hover:bg-[#f1f1f4] text-[12px]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="h-[28px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white font-medium flex items-center gap-1.5 active:scale-95 disabled:opacity-50"
            >
              <Play size={12} strokeWidth={2.4} />
              <span>{loading ? '启动中...' : '立即启动'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
