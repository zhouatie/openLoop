import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Play,
  Workflow,
  ChevronDown,
  Check,
  Bot,
  Target,
  Sparkles,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { WorkflowDefinition, NodeType } from '@openloop/core';

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
  const [autoRun, setAutoRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // 确保当 workflows 变更或加载时自动选中有效 ID
  useEffect(() => {
    if (!workflowId && workflows.length > 0) {
      setWorkflowId(workflows[0].id);
    }
  }, [workflows, workflowId]);

  // 按 Esc 键优先关闭下拉菜单，再关闭整个弹窗
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDropdownOpen) {
          setIsDropdownOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDropdownOpen, onClose]);

  // 点击外部收起下拉框
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  if (!isOpen) return null;

  const currentWf = workflows.find((w) => w.id === workflowId) || workflows[0];

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
      setIsDropdownOpen(false);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const getNodeSummaryBadges = (wf: WorkflowDefinition) => {
    const types = Array.from(new Set(wf.nodes.map((n) => n.type)));
    return (
      <div className="flex items-center gap-1 mt-1">
        {types.slice(0, 4).map((t) => {
          let label = t;
          let color = 'bg-[#f1f1f4] text-[#4b4b53]';
          if (t === 'agent') {
            label = 'Agent';
            color = 'bg-[#eeedfd] text-[#4f46e5]';
          } else if (t === 'midscene') {
            label = 'Midscene';
            color = 'bg-[#e4f6ec] text-[#189a58]';
          } else if (t === 'qa-approval') {
            label = 'QA验收';
            color = 'bg-[#fbf0df] text-[#b45309]';
          }
          return (
            <span
              key={t}
              className={`px-1.5 py-[1px] rounded-[3px] text-[9.5px] font-medium ${color}`}
            >
              {label}
            </span>
          );
        })}
        {types.length > 4 && (
          <span className="text-[9.5px] text-[#85858d]">+{types.length - 4}</span>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100">
      <div className="w-[500px] bg-white border border-[#e3e3e8] rounded-[12px] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.16)] text-[#1c1c21]">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-3.5 border-b border-[#ececf0]">
          <div>
            <h3 className="font-semibold text-[14px] text-[#1c1c21]">新建自动化任务</h3>
            <p className="text-[11.5px] text-[#85858d] mt-0.5">
              选择编排流程，自动化串联 Agent 编码、测试与 QA 验收闭环
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-[6px] flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-[12px]">
          {/* 任务名称 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1.5">任务名称</label>
            <input
              type="text"
              required
              placeholder="例如: 购物车结算全链路回归与截图验收"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-[32px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[7px] px-3 text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all"
            />
          </div>

          {/* 极致优雅的自定义工作流下拉选择器 */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block font-medium text-[#4b4b53]">关联自动化流程</label>
              {currentWf && (
                <span className="text-[11px] font-mono text-[#85858d]">
                  {currentWf.nodes.length} 节点 · {currentWf.edges.length} 连线
                </span>
              )}
            </div>

            {/* 触发主卡片 */}
            <div
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`w-full min-h-[46px] px-3 py-2 rounded-[8px] border transition-all cursor-pointer flex items-center justify-between ${
                isDropdownOpen
                  ? 'border-[#4f46e5] bg-white ring-2 ring-[#eeedfd] shadow-sm'
                  : 'border-[#e3e3e8] bg-[#f9f9fb] hover:bg-white hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.03)]'
              }`}
            >
              {currentWf ? (
                <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                  <div className="w-7 h-7 rounded-[6px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center justify-center text-[#4f46e5] shrink-0">
                    <Workflow size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[12.5px] text-[#1c1c21] truncate">
                        {currentWf.name}
                      </span>
                      <span className="text-[9.5px] font-mono text-[#85858d] bg-white border border-[#ececf0] px-1 py-[0.5px] rounded">
                        {currentWf.id}
                      </span>
                    </div>
                    {currentWf.description && (
                      <p className="text-[11px] text-[#85858d] truncate mt-0.5">
                        {currentWf.description}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <span className="text-[#85858d]">请选择工作流</span>
              )}

              <ChevronDown
                size={14}
                className={`text-[#85858d] shrink-0 transition-transform duration-200 ${
                  isDropdownOpen ? 'rotate-180 text-[#4f46e5]' : ''
                }`}
              />
            </div>

            {/* 下拉弹出浮层 Popover */}
            {isDropdownOpen && (
              <div className="absolute top-[calc(100%+6px)] left-0 right-0 bg-white border border-[#e3e3e8] rounded-[10px] shadow-[0_12px_32px_rgba(0,0,0,0.12)] z-50 max-h-[240px] overflow-y-auto p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-100">
                {workflows.map((wf) => {
                  const isSelected = wf.id === currentWf?.id;

                  return (
                    <div
                      key={wf.id}
                      onClick={() => {
                        setWorkflowId(wf.id);
                        setIsDropdownOpen(false);
                      }}
                      className={`p-2.5 rounded-[7px] cursor-pointer transition-all flex items-start justify-between ${
                        isSelected
                          ? 'bg-[#eeedfd]/50 border border-[#d8d6fb]'
                          : 'hover:bg-[#f9f9fb] border border-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1 pr-3">
                        <div
                          className={`w-6 h-6 rounded-[5px] flex items-center justify-center shrink-0 mt-0.5 ${
                            isSelected
                              ? 'bg-[#4f46e5] text-white shadow-sm'
                              : 'bg-[#f1f1f4] text-[#63636b]'
                          }`}
                        >
                          <Workflow size={12} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-[12.5px] text-[#1c1c21] truncate">
                              {wf.name}
                            </span>
                            <span className="text-[9.5px] font-mono text-[#85858d] bg-[#f4f4f6] px-1 py-[0.5px] rounded">
                              {wf.id}
                            </span>
                          </div>

                          <div className="text-[11px] text-[#85858d] truncate mt-0.5">
                            {wf.description || '无附加描述'}
                          </div>

                          {getNodeSummaryBadges(wf)}
                        </div>
                      </div>

                      <div className="flex flex-col items-end shrink-0 pt-0.5">
                        <span className="text-[10.5px] font-mono text-[#85858d]">
                          {wf.nodes.length} 节点
                        </span>
                        {isSelected && (
                          <span className="mt-1 flex items-center gap-1 text-[10.5px] text-[#4f46e5] font-medium">
                            <Check size={12} strokeWidth={2.4} />
                            已选中
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 任务描述与上下文 */}
          <div>
            <label className="block font-medium text-[#4b4b53] mb-1.5">任务说明与提示词 (可选)</label>
            <textarea
              rows={2.5}
              placeholder="输入任务背景、特定需求描述或传给 Agent 的 Prompt 覆盖项..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[7px] p-2.5 text-[#1c1c21] placeholder-[#85858d] outline-none resize-none focus:bg-white focus:border-[#4f46e5] focus:ring-1 focus:ring-[#4f46e5]/20 transition-all"
            />
          </div>

          {/* 拟物感极佳的黑色 Switch 开关 */}
          <div
            onClick={() => setAutoRun(!autoRun)}
            className="flex items-center justify-between p-2.5 rounded-[8px] bg-[#f9f9fb] border border-[#e3e3e8] cursor-pointer hover:bg-[#f1f1f4] transition-colors"
          >
            <div>
              <div className="font-medium text-[12px] text-[#1c1c21]">立即调度执行</div>
              <div className="text-[11px] text-[#85858d] mt-0.5">
                {autoRun
                  ? '创建后系统将自动唤醒 Agent 与底层工具链，按 DAG 拓扑执行'
                  : '创建为待处理任务，后续可在看板泳道或列表中手动触发'}
              </div>
            </div>

            <div
              className={`w-[34px] h-[20px] rounded-full flex items-center px-[2px] transition-colors duration-200 shadow-inner ${
                autoRun ? 'bg-[#1c1c21]' : 'bg-[#d1d1d8]'
              }`}
            >
              <div
                className={`w-[16px] h-[16px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  autoRun ? 'translate-x-[14px]' : 'translate-x-0'
                }`}
              />
            </div>
          </div>

          {/* 底部按钮栏 */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#ececf0]">
            <button
              type="button"
              onClick={onClose}
              className="h-[28px] px-3.5 rounded-[6px] text-[#4b4b53] hover:bg-[#f1f1f4] hover:text-[#1c1c21] text-[12px] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="h-[28px] px-4 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white font-medium flex items-center gap-1.5 active:scale-95 disabled:opacity-40 transition-all shadow-sm"
            >
              <Play size={12} strokeWidth={2.4} />
              <span>{loading ? '处理中...' : autoRun ? '立即启动' : '创建任务'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
