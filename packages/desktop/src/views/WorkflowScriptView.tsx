import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Play,
  Save,
  Check,
  FileCode,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { toast } from '../components/Toast';
import { WorkflowDefinition, Task } from '@openloop/core';
import { api } from '../services/api';
import { TagInput } from '../components/TagInput';
import { DebugWorkflowModal } from '../components/DebugWorkflowModal';
import { highlightLines } from '../agent-ui/dsh/highlight';
import '../styles/script-editor.css';

export interface WorkflowScriptViewProps {
  workflowId: string;
  workflows: WorkflowDefinition[];
  tasks: Task[];
  onBack: () => void;
  onRefresh: () => void;
  onOpenTaskLogs: (taskId: string) => void;
}

const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";
const LINE_HEIGHT = 21;
const TAB_SIZE = 2;

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

interface ScriptStep {
  index: number;
  name: string;
  /** 步骤类型标签，如 沙箱 / 智能体 / 验收 / 节点·midscene */
  kind: string;
  /** 该步骤在脚本里的行号（1 起） */
  line: number;
}

const CALL_LABELS: Record<string, string> = {
  agent: '智能体',
  approve: '验收门禁',
  cli: '命令',
};

const SANDBOX_LABELS: Record<string, string> = {
  create: '沙箱',
  merge: '合并',
  cleanup: '清理',
  diff: '对比',
};

const unquote = (raw: string): string => {
  const text = raw.trim().replace(/,$/, '');
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text.replace(/,$/, ''));
    } catch {
      return text.slice(1, -1);
    }
  }
  return text.slice(1, -1);
};

/** 从脚本里识别步骤：const stepN = await xxx(...) 调用块里的 name 或 title */
function parseScriptSteps(code: string): ScriptStep[] {
  const rows = code.split('\n');
  const steps: ScriptStep[] = [];
  const stringField = /^\s*(name|title):\s*("[^"\\]*(?:\\.[^"\\]*)*"|'[^']*'|`[^`]*`),?\s*$/m;

  rows.forEach((row, rowIndex) => {
    const call = row.match(
      /^\s*const\s+step(\d+)\s*=\s*await\s+([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?\s*\(/
    );
    if (!call) return;

    const [, indexText, callee, method] = call;
    let kind = method ? `${callee}.${method}` : callee;
    if (callee === 'sandbox') {
      kind = SANDBOX_LABELS[method || ''] || '沙箱';
    } else if (callee === 'node') {
      const typeMatch = row.match(/node\(\s*['"]([^'"]+)['"]/);
      kind = typeMatch ? `节点·${typeMatch[1]}` : '节点';
    } else if (CALL_LABELS[callee]) {
      kind = CALL_LABELS[callee];
    }

    // 步骤块边界：下一个 const stepN 或结尾的失败守卫
    let end = rowIndex + 1;
    while (
      end < rows.length &&
      !/^\s*const\s+step\d+\s*=/.test(rows[end]) &&
      !/^\s*if\s*\(!step\d+\.ok\)/.test(rows[end])
    ) {
      end += 1;
    }

    const block = rows.slice(rowIndex, end).join('\n');
    const named = block.match(stringField);
    const raw = named ? named[2] : '';
    steps.push({
      index: Number(indexText),
      name: raw ? unquote(raw) : `step${indexText}`,
      kind,
      line: rowIndex + 1,
    });
  });

  return steps;
}

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
  const [code, setCode] = useState(base?.script || '');
  const [savedCode, setSavedCode] = useState(base?.script || '');
  const [saving, setSaving] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [debugOpen, setDebugOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

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
        setCode(fresh.script || '');
        setSavedCode(fresh.script || '');
      } catch (err: any) {
        if (import.meta.env?.DEV) {
          console.warn('[WorkflowScriptView] 拉取流水线定义失败:', err?.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const lines = useMemo(() => code.split('\n'), [code]);
  const highlighted = useMemo(() => {
    try {
      return highlightLines(code, 'typescript');
    } catch {
      return undefined;
    }
  }, [code]);

  // 描述框按内容自适应高度，最多 12 行后内部滚动
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 12 * 17 + 18)}px`;
  }, [description, workflowId]);

  const steps = useMemo(() => parseScriptSteps(code), [code]);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [stepsOpen, setStepsOpen] = useState(true);

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

  const updateCursor = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const upto = el.value.slice(0, el.selectionStart);
    const rows = upto.split('\n');
    setCursor({ line: rows.length, column: rows[rows.length - 1].length + 1 });
  }, []);

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
        console.log('[WorkflowScriptView] 脚本已保存:', { id: updated.id, length: code.length });
      }
      setWorkflow({ ...updated, ...(saved || {}) });
      setSavedCode(code);
      toast.success('脚本已保存');
      onRefresh();
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[WorkflowScriptView] 保存失败:', err);
      }
      toast.error(`保存失败: ${err?.message || '未知错误'}`);
    } finally {
      setSaving(false);
    }
  }, [workflow, saving, name, description, tags, code, onRefresh]);

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

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = event.currentTarget;
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSave();
        return;
      }

      // Tab / Shift+Tab 缩进，保持编辑器手感
      if (event.key === 'Tab') {
        event.preventDefault();
        const indent = ' '.repeat(TAB_SIZE);
        const start = el.selectionStart;
        const end = el.selectionEnd;
        if (start === end) {
          const next = code.slice(0, start) + indent + code.slice(start);
          setCode(next);
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = start + TAB_SIZE;
            updateCursor();
          });
        } else {
          const next = code.slice(0, start) + indent + code.slice(start);
          setCode(next);
          requestAnimationFrame(() => {
            el.selectionStart = start + TAB_SIZE;
            el.selectionEnd = end + TAB_SIZE;
            updateCursor();
          });
        }
        return;
      }

      // 回车延续当前行缩进
      if (event.key === 'Enter') {
        const start = el.selectionStart;
        const lineStart = code.lastIndexOf('\n', start - 1) + 1;
        const indentMatch = /^[ \t]*/.exec(code.slice(lineStart, start));
        const indent = indentMatch ? indentMatch[0] : '';
        if (indent) {
          event.preventDefault();
          const next = `${code.slice(0, start)}\n${indent}${code.slice(el.selectionEnd)}`;
          setCode(next);
          const caret = start + 1 + indent.length;
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = caret;
            updateCursor();
          });
        }
      }
    },
    [code, handleSave, updateCursor]
  );

  /** 点击步骤标签：把光标和视图移到对应行 */
  const jumpToStep = useCallback(
    (step: ScriptStep) => {
      const el = textareaRef.current;
      if (!el) return;
      const offset = lines
        .slice(0, step.line - 1)
        .reduce((total, line) => total + line.length + 1, 0);
      el.focus();
      el.setSelectionRange(offset, offset);
      const top = Math.max(0, (step.line - 1) * LINE_HEIGHT - LINE_HEIGHT * 2);
      el.scrollTop = top;
      setScroll({ top, left: el.scrollLeft });
      setCursor({ line: step.line, column: 1 });
      setActiveStep(step.index);
    },
    [lines]
  );

  const handleScroll = useCallback((event: React.UIEvent<HTMLTextAreaElement>) => {
    setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
  }, []);

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

  const legacyGraph = (workflow.nodes || []).length > 0;
  const template = workflow.taskTemplate || {};

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
          <FileCode size={10} strokeWidth={2.2} />
          <span>脚本流水线</span>
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
          title="保存脚本（⌘S）"
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
        {/* 脚本编辑区 */}
        <div className="flex-1 min-w-0 bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm flex flex-col overflow-hidden">
          <div className="h-[32px] px-3 flex items-center justify-between border-b border-[#f1f1f4] shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <FileCode size={12} className="text-[#63636b] shrink-0" />
              <span className="text-[11.5px] text-[#3f3f46] font-mono truncate">
                {workflow.id}.mjs
              </span>
              <span className="text-[10.5px] text-[#a1a1aa] shrink-0">{lines.length} 行</span>
            </div>
            <span className="text-[10.5px] text-[#a1a1aa] shrink-0">
              {legacyGraph ? '原画布已下线' : '一条流水线就是一段 JS'}
            </span>
          </div>

          <div className="flex-1 flex min-h-0 relative script-editor-scope">
            <div
              ref={gutterRef}
              className="w-[46px] shrink-0 bg-[#fafafc] border-r border-[#f1f1f4] overflow-hidden select-none"
            >
              <div
                className="py-3 text-right pr-2.5 font-mono text-[#b9b9c2]"
                style={{ fontSize: 11.5, lineHeight: `${LINE_HEIGHT}px`, transform: `translateY(${-scroll.top}px)` }}
              >
                {lines.map((_, index) => (
                  <div key={index}>{index + 1}</div>
                ))}
              </div>
            </div>

            <div className="relative flex-1 min-w-0">
              <pre
                aria-hidden
                className="absolute inset-0 m-0 font-mono whitespace-pre overflow-hidden pointer-events-none"
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  lineHeight: `${LINE_HEIGHT}px`,
                  color: '#3f3f46',
                }}
              >
                {/* 内层位移：外层负责裁剪，避免整体移出视口后出现空白 */}
                <div
                  style={{
                    padding: '12px 14px',
                    width: 'max-content',
                    transform: `translate(${-scroll.left}px, ${-scroll.top}px)`,
                  }}
                >
                  {lines.map((line, index) => {
                    const spans = highlighted?.[index];
                    return (
                      <div key={index}>
                        {spans && spans.length > 0
                          ? spans.map((span, spanIndex) => (
                              <span key={spanIndex} style={span.style as React.CSSProperties}>
                                {span.text || '\u200b'}
                              </span>
                            ))
                          : line || '\u200b'}
                      </div>
                    );
                  })}
                </div>
              </pre>
              {/* 空脚本提示：避免空白编辑器让人以为页面出错 */}
              {!code.trim() && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-center pointer-events-none">
                  <FileCode size={20} strokeWidth={1.6} className="text-[#c4c4cc]" />
                  <div className="text-[12.5px] font-medium text-[#3f3f46]">这条流水线还没有脚本</div>
                  <p className="text-[11px] text-[#85858d] max-w-[280px] leading-relaxed">
                    在 pipelines/ 目录维护脚本后执行 pnpm pipeline:push，或直接在这里开始编写。
                  </p>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  requestAnimationFrame(updateCursor);
                }}
                onKeyDown={handleKeyDown}
                onKeyUp={updateCursor}
                onClick={updateCursor}
                onScroll={handleScroll}
                onSelect={updateCursor}
                spellCheck={false}
                wrap="off"
                className="absolute inset-0 w-full h-full font-mono bg-transparent resize-none outline-none text-transparent caret-[#1c1c21] selection:bg-[#c7d2fe]/60"
                style={{
                  padding: '12px 14px',
                  fontSize: 12.5,
                  lineHeight: `${LINE_HEIGHT}px`,
                  tabSize: TAB_SIZE,
                }}
              />
            </div>
          </div>

          <div className="h-[26px] px-3 flex items-center justify-between border-t border-[#f1f1f4] text-[10.5px] text-[#a1a1aa] shrink-0">
            <span className="font-mono">
              {cursor.line}:{cursor.column} · {code.length} 字符 · Tab {TAB_SIZE} 空格
            </span>
            <span className="font-mono">⌘S 保存</span>
          </div>
        </div>

        {/* 右侧信息面板 */}
        <aside className="w-[300px] shrink-0 min-h-0 overflow-y-auto space-y-2.5 pb-1">
          {steps.length > 0 && (
            <section className="bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => setStepsOpen((prev) => !prev)}
                className="w-full h-[32px] px-3 flex items-center justify-between text-[11.5px] text-[#3f3f46] hover:bg-[#fafafc] transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  {stepsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  步骤
                </span>
                <span className="text-[10px] text-[#a1a1aa]">{steps.length} 步</span>
              </button>
              {stepsOpen && (
                <div className="border-t border-[#f1f1f4] py-1">
                  {steps.map((step) => {
                    const active = activeStep === step.index;
                    return (
                      <button
                        key={`${step.index}-${step.line}`}
                        type="button"
                        onClick={() => jumpToStep(step)}
                        title={`跳到第 ${step.line} 行 · ${step.kind}`}
                        className={`w-full h-[22px] px-2.5 flex items-center gap-2 text-left transition-colors cursor-pointer ${
                          active ? 'bg-[#f4f4f6]' : 'hover:bg-[#fafafc]'
                        }`}
                      >
                        <span
                          className={`w-[15px] h-[15px] rounded-[4px] flex items-center justify-center text-[9px] font-medium shrink-0 ${
                            active ? 'bg-[#1c1c21] text-white' : 'bg-[#f4f4f6] text-[#71717a]'
                          }`}
                        >
                          {step.index}
                        </span>
                        <span
                          className={`flex-1 min-w-0 truncate text-[11px] ${
                            active ? 'text-[#1c1c21]' : 'text-[#52525b]'
                          }`}
                        >
                          {step.name}
                        </span>
                        <span className="text-[9px] text-[#a1a1aa] shrink-0">{step.kind}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

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
