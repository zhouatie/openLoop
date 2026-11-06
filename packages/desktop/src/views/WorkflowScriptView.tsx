import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Play,
  Save,
  Check,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  ListTree,
  AlertTriangle,
} from 'lucide-react';
import { toast } from '../components/Toast';
import { WorkflowDefinition, Task } from '@openloop/core';
import { api } from '../services/api';
import { TagInput } from '../components/TagInput';
import { DebugWorkflowModal } from '../components/DebugWorkflowModal';
import { PipelineCards } from './workflow/PipelineCards';
import { buildPipelineScript, parsePipelineScript } from '../utils/pipelineCards';
import type { PipelineCard } from '../utils/pipelineCards';

export interface WorkflowScriptViewProps {
  workflowId: string;
  workflows: WorkflowDefinition[];
  tasks: Task[];
  onBack: () => void;
  onRefresh: () => void;
  onOpenTaskLogs: (taskId: string) => void;
}

const STATUS_META: Record<
  string,
  { label: string; className: string; icon: React.ReactNode }
> = {
  completed: {
    label: '成功',
    className: 'bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]/60',
    icon: <CheckCircle2 size={10} strokeWidth={2.2} />,
  },
  running: {
    label: '运行中',
    className: 'bg-[#eff6ff] text-[#2563eb] border-[#bfdbfe]/60',
    icon: <Loader2 size={10} className="animate-spin" />,
  },
  failed: {
    label: '失败',
    className: 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]/60',
    icon: <XCircle size={10} strokeWidth={2.2} />,
  },
  waiting_approval: {
    label: '待验收',
    className: 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]/60',
    icon: <Clock size={10} />,
  },
  cancelled: {
    label: '已终止',
    className: 'bg-[#f4f4f6] text-[#71717a] border-[#e3e3e8]',
    icon: <XCircle size={10} strokeWidth={2.2} />,
  },
  pending: {
    label: '待处理',
    className: 'bg-[#f4f4f6] text-[#71717a] border-[#e3e3e8]',
    icon: <Clock size={10} />,
  },
};

/** 按中英文宽度估算名称输入框宽度，避免长名字被截断 */
function nameFieldWidth(text: string): number {
  const width = Array.from(text).reduce(
    (total, char) => total + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 13 : 7.5),
    0
  );
  return Math.min(Math.max(Math.round(width) + 26, 150), 460);
}

function formatTime(ts?: number): string {
  if (!ts) return '-';
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const WorkflowScriptView: React.FC<WorkflowScriptViewProps> = ({
  workflowId,
  workflows,
  tasks,
  onBack,
  onRefresh,
  onOpenTaskLogs,
}) => {
  const base = useMemo(
    () => workflows.find((item) => item.id === workflowId) || null,
    [workflows, workflowId]
  );

  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(base);
  const [name, setName] = useState(base?.name || '');
  const [description, setDescription] = useState(base?.description || '');
  const [tags, setTags] = useState<string[]>(base?.tags || []);
  const [cards, setCards] = useState<PipelineCard[]>([]);
  /** 脚本含卡片之外的逻辑：卡片只显示能识别的步骤 */
  const [unparsed, setUnparsed] = useState(false);
  const [savedCode, setSavedCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  /** 载入脚本：解析成卡片，解析不了就只读展示能识别的部分 */
  const applyScript = useCallback((script: string, pipelineName: string) => {
    const parsed = parsePipelineScript(script);
    setCards(parsed || []);
    setUnparsed(parsed === null);
    // 卡片是脚本的规范化视图，以它作为基线，避免刚进页面就显示未保存
    setSavedCode(buildPipelineScript(pipelineName, parsed || []));
    if (import.meta.env?.DEV) {
      console.log('[WorkflowScriptView] 载入流水线脚本:', {
        steps: parsed?.length ?? 0,
        unparsed: parsed === null,
      });
    }
  }, []);

  useEffect(() => {
    applyScript(base?.script || '', base?.name || '');
  }, [applyScript, base?.script, base?.name]);

  // 列表数据可能落后（脚本由外部写入），进入页面时补一次最新定义
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fresh = (await api.getWorkflows()).find((item) => item.id === workflowId);
        if (!fresh || cancelled) return;
        setWorkflow(fresh);
        setName(fresh.name);
        setDescription(fresh.description || '');
        setTags(fresh.tags || []);
        applyScript(fresh.script || '', fresh.name);
      } catch (err: any) {
        if (import.meta.env?.DEV) {
          console.warn('[WorkflowScriptView] 拉取流水线定义失败:', err?.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyScript, workflowId]);

  // 描述框按内容自适应高度，最多 12 行后内部滚动
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 12 * 17 + 18)}px`;
  }, [description, workflowId]);

  const code = buildPipelineScript(name, cards);

  const dirty =
    code !== savedCode ||
    (workflow ? name !== workflow.name || description !== (workflow.description || '') : false) ||
    (workflow ? tags.join(',') !== (workflow.tags || []).join(',') : false);

  const recentRuns = useMemo(
    () =>
      tasks
        .filter((task) => task.workflowId === workflowId)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 6),
    [tasks, workflowId]
  );

  const handleSave = useCallback(async () => {
    if (!workflow || saving) return;
    if (!name.trim()) {
      toast.error('流水线名称不能为空');
      return;
    }
    setSaving(true);
    try {
      const updated: WorkflowDefinition = {
        ...workflow,
        name: name.trim(),
        description: description.trim(),
        tags,
        script: code,
        updatedAt: Date.now(),
      };
      const saved = await api.saveWorkflow(updated);
      if (import.meta.env?.DEV) {
        console.log('[WorkflowScriptView] 流水线已保存:', {
          id: updated.id,
          steps: cards.length,
          scriptBytes: code.length,
        });
      }
      setWorkflow({ ...updated, ...(saved || {}) });
      setSavedCode(code);
      toast.success('流水线已保存');
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowScriptView] 保存失败:', err);
      }
      toast.error(`保存失败: ${err?.message || '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }, [workflow, saving, name, description, tags, code, cards.length, onRefresh]);

  const handleCopyId = useCallback(async () => {
    const id = workflow?.id;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      toast.success('已复制流水线 ID', { description: id });
    } catch {
      toast.error('复制失败，请手动选择复制');
    }
  }, [workflow?.id]);

  const handleBack = useCallback(() => {
    if (dirty && !window.confirm('有未保存的修改，确定离开？')) return;
    onBack();
  }, [dirty, onBack]);

  const handleDebugStart = useCallback(
    async ({
      title,
      description: desc,
      workspace,
      openLogsImmediately,
    }: {
      title: string;
      description: string;
      workspace?: string;
      openLogsImmediately: boolean;
    }) => {
      if (!workflow) return;
      const task = await api.createTask({
        title,
        description: desc || undefined,
        workflowId: workflow.id,
        workspace: workspace || undefined,
        autoRun: true,
        triggerSource: 'debug',
      });
      toast.success(`已触发运行 (${task.id})`, {
        action: { label: '查看运行日志', onClick: () => onOpenTaskLogs(task.id) },
      });
      onRefresh();
      if (openLogsImmediately) onOpenTaskLogs(task.id);
    },
    [workflow, onRefresh, onOpenTaskLogs]
  );

  if (!workflow) {
    return (
      <div className="flex-1 h-full flex items-center justify-center bg-[#f4f4f6] text-[#71717a] text-[12px]">
        流水线不存在或已删除
      </div>
    );
  }

  const template = workflow.taskTemplate || {};
  const legacyNodes = (workflow.nodes || []).length;

  return (
    <div className="flex-1 h-full flex flex-col bg-[#f4f4f6] overflow-hidden">
      {/* 顶部固定操作条 */}
      <div className="bg-white border-b border-[#e3e3e8] px-4 h-[46px] flex items-center gap-2.5 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <button
          type="button"
          onClick={handleBack}
          title="返回流水线列表"
          className="w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="w-[1px] h-4 bg-[#e3e3e8]" />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          title={name}
          style={{ width: nameFieldWidth(name) }}
          className="shrink-0 text-[13px] font-medium text-[#1c1c21] bg-transparent outline-none border-b border-transparent focus:border-[#d4d4d8] py-0.5"
        />
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eeedfd] text-[#4f46e5] text-[10px] font-medium border border-[#d8d6fb]/60 shrink-0">
          <ListTree size={10} strokeWidth={2.2} />
          <span>步骤流水线</span>
        </span>
        <button
          type="button"
          onClick={handleCopyId}
          title="点击复制流水线 ID"
          className="group inline-flex items-center gap-1 min-w-0 px-1 -mx-1 h-[20px] rounded-[4px] hover:bg-[#f4f4f6] transition-colors cursor-pointer"
        >
          <span className="text-[10px] font-mono text-[#a1a1aa] group-hover:text-[#63636b] truncate max-w-[240px]">
            {workflow.id}
          </span>
          <Copy size={10} className="shrink-0 text-[#c9c9d1] group-hover:text-[#63636b]" />
        </button>

        <div className="flex-1" />

        {dirty && (
          <span className="text-[11px] text-[#b45309] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
            未保存
          </span>
        )}
        <button
          type="button"
          onClick={() => setDebugOpen(true)}
          className="h-[26px] px-2.5 rounded-[6px] text-[11.5px] text-[#4b4b53] hover:bg-[#f1f1f4] flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Play size={12} strokeWidth={2.2} />
          <span>运行</span>
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="h-[26px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[11.5px] font-medium flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
          title="保存流水线（⌘S）"
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : dirty ? (
            <Save size={12} strokeWidth={2.2} />
          ) : (
            <Check size={12} strokeWidth={2.4} />
          )}
          <span>{saving ? '保存中' : dirty ? '保存' : '已保存'}</span>
        </button>
      </div>

      <div className="flex-1 flex min-h-0 gap-3 p-3.5">
        {/* 步骤 / 脚本 编辑区 */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="h-[28px] shrink-0 mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0 text-[11.5px] text-[#3f3f46]">
              <ListTree size={12} className="text-[#63636b] shrink-0" />
              <span>步骤</span>
              <span className="text-[10.5px] text-[#a1a1aa]">{cards.length} 步</span>
              {legacyNodes > 0 && (
                <span className="text-[10.5px] text-[#b45309] truncate">
                  旧画布 {legacyNodes} 个节点已下线，请用步骤重建
                </span>
              )}
            </div>
          </div>

          {unparsed && (
            <div className="mb-2 shrink-0 flex items-start gap-2 px-2.5 py-1.5 rounded-[6px] bg-[#fffbeb] border border-[#fde68a]/70 text-[10.5px] text-[#b45309] leading-[16px]">
              <AlertTriangle size={12} className="shrink-0 mt-[2px]" />
              <span>原脚本含卡片之外的逻辑（分支、循环或自定义调用），只显示可识别的步骤；保存会按卡片重写脚本。</span>
            </div>
          )}

          <PipelineCards cards={cards} onChange={setCards} />
        </div>

        {/* 右侧信息面板 */}
        <aside className="w-[300px] shrink-0 min-h-0 overflow-y-auto space-y-2.5 pb-1">
          <section className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm p-3 space-y-2.5">
            <h3 className="text-[11.5px] font-medium text-[#3f3f46]">流水线信息</h3>
            <div>
              <label className="block text-[10.5px] text-[#85858d] mb-1">描述</label>
              <textarea
                ref={descriptionRef}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="说明这条流水线做什么…"
                className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2 text-[11.5px] leading-[17px] text-[#1c1c21] outline-none resize-none focus:bg-white focus:border-[#b9b9c2]"
              />
            </div>
            <div>
              <label className="block text-[10.5px] text-[#85858d] mb-1">标签</label>
              <TagInput tags={tags} onChange={setTags} placeholder="回车添加标签…" />
            </div>
            <div className="flex items-center justify-between text-[10.5px] text-[#a1a1aa] pt-1">
              <span>最近更新 {formatTime(workflow.updatedAt)}</span>
              <span>创建 {formatTime(workflow.createdAt)}</span>
            </div>
          </section>

          <section className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setTemplateOpen((prev) => !prev)}
              className="w-full h-[32px] px-3 flex items-center justify-between text-[11.5px] text-[#3f3f46] hover:bg-[#fafafc] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                {templateOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                任务模板
              </span>
              <span className="text-[10px] text-[#a1a1aa]">
                {template.descriptionTemplate || template.acceptanceTemplate ? '已设置' : '未设置'}
              </span>
            </button>
            {templateOpen && (
              <div className="px-3 pb-3 space-y-2.5 border-t border-[#f1f1f4] pt-2.5">
                <div>
                  <label className="block text-[10.5px] text-[#85858d] mb-1">标题占位</label>
                  <input
                    value={template.titlePlaceholder || ''}
                    onChange={(event) =>
                      setWorkflow((prev) =>
                        prev
                          ? {
                              ...prev,
                              taskTemplate: {
                                ...(prev.taskTemplate || {}),
                                titlePlaceholder: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="w-full h-[26px] bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] px-2 text-[11.5px] outline-none focus:bg-white focus:border-[#b9b9c2]"
                  />
                </div>
                <div>
                  <label className="block text-[10.5px] text-[#85858d] mb-1">说明骨架</label>
                  <textarea
                    rows={4}
                    value={template.descriptionTemplate || ''}
                    onChange={(event) =>
                      setWorkflow((prev) =>
                        prev
                          ? {
                              ...prev,
                              taskTemplate: {
                                ...(prev.taskTemplate || {}),
                                descriptionTemplate: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2 text-[11px] font-mono outline-none resize-none focus:bg-white focus:border-[#b9b9c2]"
                  />
                </div>
                <div>
                  <label className="block text-[10.5px] text-[#85858d] mb-1">验收骨架</label>
                  <textarea
                    rows={3}
                    value={template.acceptanceTemplate || ''}
                    onChange={(event) =>
                      setWorkflow((prev) =>
                        prev
                          ? {
                              ...prev,
                              taskTemplate: {
                                ...(prev.taskTemplate || {}),
                                acceptanceTemplate: event.target.value,
                              },
                            }
                          : prev
                      )
                    }
                    className="w-full bg-[#f9f9fb] border border-[#e3e3e8] rounded-[6px] p-2 text-[11px] font-mono outline-none resize-none focus:bg-white focus:border-[#b9b9c2]"
                  />
                </div>
              </div>
            )}
          </section>

          <section className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden">
            <div className="h-[32px] px-3 flex items-center justify-between border-b border-[#f1f1f4]">
              <span className="text-[11.5px] text-[#3f3f46]">最近运行</span>
              <span className="text-[10px] text-[#a1a1aa]">
                {tasks.filter((task) => task.workflowId === workflowId).length} 次
              </span>
            </div>
            {recentRuns.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-[#a1a1aa]">还没有运行记录</div>
            ) : (
              <div className="divide-y divide-[#f1f1f4]">
                {recentRuns.map((task) => {
                  const meta = STATUS_META[task.status] || STATUS_META.pending;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpenTaskLogs(task.id)}
                      className="w-full px-3 py-2 flex items-center gap-2 text-left group hover:bg-[#fafafc] transition-colors cursor-pointer"
                    >
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium border shrink-0 ${meta.className}`}
                      >
                        {meta.icon}
                        <span>{meta.label}</span>
                      </span>
                      <span className="flex-1 min-w-0 text-[11px] text-[#3f3f46] truncate group-hover:text-[#4f46e5] transition-colors">
                        {task.title}
                      </span>
                      <span className="text-[10px] font-mono text-[#a1a1aa] shrink-0">
                        {formatTime(task.createdAt)}
                      </span>
                      <ExternalLink
                        size={10}
                        className="text-[#d4d4d8] group-hover:text-[#4f46e5] shrink-0"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>

      <DebugWorkflowModal
        isOpen={debugOpen}
        onClose={() => setDebugOpen(false)}
        workflow={workflow}
        onStartDebug={handleDebugStart}
      />
    </div>
  );
};
