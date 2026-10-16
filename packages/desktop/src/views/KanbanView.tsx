import React, { useState } from 'react';
import {
  Check,
  X,
  FileImage,
  Terminal,
  Search,
  Sparkles,
  LayoutGrid,
  List,
  ChevronDown,
  ChevronRight,
  Trash2,
  Play,
  RotateCcw,
  CheckCircle2,
  Layers,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { Task, KanbanColumn, WorkflowDefinition, NodeRun } from '@openloop/core';
import { api } from '../services/api';

interface KanbanViewProps {
  tasks: Task[];
  workflows: WorkflowDefinition[];
  onOpenTaskLogs: (taskId: string) => void;
  onRefresh: () => void;
}

interface ColumnDef {
  key: KanbanColumn;
  title: string;
  dotColor: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'backlog', title: '待处理', dotColor: 'bg-[#85858d]' },
  { key: 'agent_executing', title: 'Agent 编码中', dotColor: 'bg-[#7c3aed]' },
  { key: 'in_progress', title: '自动化流水线', dotColor: 'bg-[#1d4ed8]' },
  { key: 'qa_review', title: 'QA 待验收', dotColor: 'bg-[#b45309]' },
  { key: 'done', title: '已完成', dotColor: 'bg-[#189a58]' },
];

export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks,
  workflows,
  onOpenTaskLogs,
  onRefresh,
}) => {
  // 默认使用用户最喜爱的会话列表模式，同时支持无缝切看板泳道
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<{ name: string; path: string } | null>(null);
  const [selectedWorkflowFilter, setSelectedWorkflowFilter] = useState<string>('all');
  const [isGroupOpen, setIsGroupOpen] = useState(true);

  const wfMap = new Map(workflows.map((w) => [w.id, w]));

  const filteredTasks = tasks.filter((t) => {
    if (selectedWorkflowFilter !== 'all' && t.workflowId !== selectedWorkflowFilter) {
      return false;
    }
    if (!searchTerm) return true;
    return (
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.id.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const handleApprove = async (taskId: string, approved: boolean) => {
    setApprovingId(taskId);
    try {
      await api.resumeTask(taskId, approved, approved ? 'QA 查验通过' : '验收驳回');
      onRefresh();
    } catch (e: any) {
      alert(`审批失败: ${e.message}`);
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f4f4f6] overflow-hidden select-none">
      {/* 1:1 magpie 风格次级工具栏 (Sub-header) */}
      <div className="px-6 py-2 bg-transparent flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {/* 下拉选择器 (如截图中的 Pi 1792 ▾) */}
          <div className="flex items-center gap-1.5 px-2.5 h-[28px] rounded-[6px] bg-white border border-[#e3e3e8] shadow-[0_1px_2px_rgba(0,0,0,0.06)] text-[12px] font-medium text-[#1c1c21] cursor-pointer hover:bg-[#f9f9fb]">
            <span className="font-semibold">openLoop</span>
            <span className="text-[#85858d] font-mono text-[11px]">{tasks.length}</span>
            <ChevronDown size={12} className="text-[#85858d]" />
          </div>

          {/* 搜索框 (如截图中的搜索会话) */}
          <div className="relative w-56 ml-1">
            <input
              type="text"
              placeholder="搜索任务或会话..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-[28px] bg-white border border-[#e3e3e8] rounded-[6px] px-2.5 text-[12px] text-[#1c1c21] placeholder-[#85858d] outline-none shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#b9b9c2]"
            />
          </div>
        </div>

        {/* 右侧：视图切换与回收站 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-[#e6e6eb] p-[2px] rounded-[6px]">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-2.5 h-[24px] rounded-[4px] text-[11.5px] transition-all ${
                viewMode === 'list'
                  ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <List size={12} />
              <span>会话列表</span>
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1 px-2.5 h-[24px] rounded-[4px] text-[11.5px] transition-all ${
                viewMode === 'kanban'
                  ? 'bg-white text-[#1c1c21] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)]'
                  : 'text-[#63636b] hover:text-[#1c1c21]'
              }`}
            >
              <LayoutGrid size={12} />
              <span>看板泳道</span>
            </button>
          </div>

          <button
            onClick={() => onRefresh()}
            className="flex items-center gap-1 text-[11.5px] text-[#85858d] hover:text-[#1c1c21] transition-colors"
          >
            <Trash2 size={12} />
            <span>回收站</span>
          </button>
        </div>
      </div>

      {/* 主展示区 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3">
        {/* 横幅卡片 (1:1 还原参考图中的“记录网关对话”卡片) */}
        <div className="bg-white border border-[#e3e3e8] rounded-[10px] p-3.5 flex items-center justify-between shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3">
            {/* 黑色 macOS 胶囊 Switch 开关 (开启态) */}
            <div className="w-[34px] h-[20px] rounded-full bg-[#1c1c21] flex items-center px-[2px] cursor-pointer shadow-inner">
              <div className="w-[16px] h-[16px] rounded-full bg-white ml-auto shadow-sm" />
            </div>

            <div>
              <div className="text-[13px] font-medium text-[#1c1c21]">
                全自动流水线状态机
              </div>
              <div className="text-[11.5px] text-[#85858d] mt-0.5">
                已开启：CLI 触发 → AI Agent 接入 → 完成 Hook → Midscene 自动化 UI 测试 → 截图拼接动图 → QA 人工/用例验收。
              </div>
            </div>
          </div>

          <button
            onClick={() => onRefresh()}
            className="flex items-center gap-1 text-[11.5px] text-[#85858d] hover:text-[#d64545] transition-colors"
          >
            <Trash2 size={12} />
            <span>清空已完成任务</span>
          </button>
        </div>

        {/* 说明副文 (参考图中的浅灰说明) */}
        <div className="text-[11px] text-[#85858d] px-1 leading-relaxed">
          「自动化调度」下的任务由 openLoop Core 守护进程执行。每个流程节点的流转条件与 CLI 工具均可在流程编排中自由编辑；支持随时审批恢复。
        </div>

        {/* 批量操作条 (如参考图中的 “1792 个会话 / 删除”) */}
        <div className="flex items-center justify-between px-1 pt-1 text-[11.5px] text-[#85858d]">
          <div className="flex items-center gap-2">
            <input type="checkbox" className="w-3.5 h-3.5 rounded border-[#e3e3e8] text-[#4f46e5]" />
            <span>{filteredTasks.length} 个任务流转</span>
          </div>
          <button className="flex items-center gap-1 hover:text-[#1c1c21]">
            <Trash2 size={12} />
            <span>删除</span>
          </button>
        </div>

        {/* 视图模式 1：会话列表 (1:1 像素级还原参考图) */}
        {viewMode === 'list' && (
          <div className="space-y-2">
            {/* 目录分组行 (如参考图中的 `∨ 评论发布实验与分人群-OMMUSIC-3810670 /Users/... 17 个会话`) */}
            <div className="bg-white border border-[#e3e3e8] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <div
                onClick={() => setIsGroupOpen(!isGroupOpen)}
                className="h-[34px] px-3 flex items-center justify-between bg-[#fbfbfd] border-b border-[#ececf0] cursor-pointer hover:bg-[#f4f4f7] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[#85858d]">
                    {isGroupOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </span>
                  <span className="text-[12px] font-medium text-[#1c1c21] truncate">
                    全自动化研发与 QA 测试工作流
                  </span>
                  <span className="text-[11px] font-mono text-[#b9b9c2] truncate">
                    /Users/zhoushitie/My/openLoop
                  </span>
                </div>
                <span className="text-[11px] font-mono text-[#85858d]">
                  {filteredTasks.length} 个会话任务
                </span>
              </div>

              {/* 会话列表行 */}
              {isGroupOpen && (
                <div className="divide-y divide-[#ececf0]">
                  {filteredTasks.length === 0 ? (
                    <div className="p-8 text-center text-[12px] text-[#85858d]">
                      暂无任务。可在终端使用 openloop task create 发起自动化流程。
                    </div>
                  ) : (
                    filteredTasks.map((task) => {
                      const wf = wfMap.get(task.workflowId);
                      const currentNode = wf?.nodes.find((n) => n.id === task.currentNodeId);
                      const isWaiting = task.status === 'waiting_approval';
                      const isSuccess = task.status === 'completed';
                      const nodeRuns = Object.values(task.nodeRuns || {});

                      return (
                        <div
                          key={task.id}
                          onClick={() => setSelectedTask(task)}
                          className="min-h-[50px] px-3 py-2 flex items-center gap-3 hover:bg-[#f9f9fb] transition-colors cursor-pointer group"
                        >
                          {/* 复选框 */}
                          <input
                            type="checkbox"
                            onClick={(e) => e.stopPropagation()}
                            className="w-3.5 h-3.5 rounded border-[#e3e3e8] text-[#4f46e5] shrink-0"
                          />

                          {/* 标题与副信息 */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-[#1c1c21] truncate">
                                {task.title}
                              </span>
                              <span className="text-[10px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                                {task.id}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#85858d] flex items-center gap-2 mt-0.5 truncate">
                              <span>刚刚</span>
                              <span>·</span>
                              <span>Agent: {currentNode?.name || 'OpenLoop Agent'}</span>
                              <span>·</span>
                              <span>流程: {wf?.name || task.workflowId}</span>
                              {nodeRuns.some((r) => r.artifacts && r.artifacts.length > 0) && (
                                <>
                                  <span>·</span>
                                  <span className="text-[#4f46e5] font-medium flex items-center gap-1">
                                    <FileImage size={11} />
                                    <span>含 Midscene 动图产物</span>
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* 统计指标 (参考图中 176K 与绿色标签 ≈¥1.17 样式) */}
                          <div className="text-right shrink-0">
                            <div className="text-[12px] font-mono font-medium text-[#1c1c21]">
                              {nodeRuns.length} 节点
                            </div>
                            <div className="text-[11px] font-mono text-[#189a58] inline-block">
                              {isSuccess ? '已完成' : isWaiting ? '待 QA 验收' : '自动化运行中'}
                            </div>
                          </div>

                          {/* 状态操作胶囊按钮组 (1:1 还原参考图) */}
                          <div
                            className="flex items-center gap-1.5 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isWaiting ? (
                              <button
                                onClick={() => handleApprove(task.id, true)}
                                className="h-[24px] px-2.5 rounded-[5px] bg-[#189a58] hover:bg-[#147e48] text-white text-[11.5px] font-medium flex items-center gap-1 transition-all active:scale-95 shadow-sm"
                              >
                                <Check size={11} strokeWidth={2.4} />
                                <span>验收通过</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => onOpenTaskLogs(task.id)}
                                className="h-[24px] px-2.5 rounded-[5px] border border-[#e3e3e8] bg-white text-[#1c1c21] hover:bg-[#f1f1f4] text-[11.5px] font-medium transition-all shadow-sm"
                              >
                                <span>查看日志</span>
                              </button>
                            )}

                            {/* 类似截图中的换 Agent 操作 */}
                            <button
                              onClick={() => setSelectedTask(task)}
                              className="h-[24px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[#4b4b53] hover:bg-[#f1f1f4] text-[11.5px] flex items-center gap-1 transition-all shadow-sm"
                            >
                              <span>流转节点</span>
                              <ChevronDown size={11} />
                            </button>

                            <button
                              onClick={() => onOpenTaskLogs(task.id)}
                              className="w-[24px] h-[24px] rounded-[5px] border border-[#e3e3e8] bg-white text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] flex items-center justify-center transition-all shadow-sm"
                              title="实时终端"
                            >
                              <Terminal size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 视图模式 2：看板泳道 (Kanban) */}
        {viewMode === 'kanban' && (
          <div className="flex gap-3.5 overflow-x-auto pb-4">
            {COLUMNS.map((col) => {
              const colTasks = filteredTasks.filter((t) => t.kanbanColumn === col.key);

              return (
                <div
                  key={col.key}
                  className="w-[280px] shrink-0 bg-[#ebebef] border border-[#e3e3e8] rounded-[10px] flex flex-col max-h-[calc(100vh-230px)]"
                >
                  {/* 泳道头 */}
                  <div className="h-[36px] px-3 flex items-center justify-between border-b border-[#e3e3e8]">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                      <span className="text-[12px] font-medium text-[#1c1c21]">{col.title}</span>
                    </div>
                    <span className="h-[18px] px-1.5 rounded-[4px] bg-white border border-[#e3e3e8] text-[11px] font-mono text-[#85858d] flex items-center">
                      {colTasks.length}
                    </span>
                  </div>

                  {/* 泳道卡片列表 */}
                  <div className="flex-1 p-2.5 overflow-y-auto space-y-2">
                    {colTasks.length === 0 ? (
                      <div className="h-24 border border-dashed border-[#d1d1d8] rounded-[8px] flex items-center justify-center text-[11px] text-[#85858d]">
                        暂无任务
                      </div>
                    ) : (
                      colTasks.map((task) => {
                        const wf = wfMap.get(task.workflowId);
                        const currentNode = wf?.nodes.find((n) => n.id === task.currentNodeId);
                        const nodeRuns = Object.values(task.nodeRuns || {});
                        const completedCount = nodeRuns.filter((r) => r.status === 'success').length;
                        const totalNodes = wf?.nodes.length || 1;
                        const progressPct = Math.round((completedCount / totalNodes) * 100);

                        return (
                          <div
                            key={task.id}
                            onClick={() => setSelectedTask(task)}
                            className={`group bg-white border rounded-[8px] p-3 transition-all cursor-pointer ${
                              task.status === 'waiting_approval'
                                ? 'border-[#b45309] shadow-sm'
                                : 'border-[#e3e3e8] hover:border-[#b9b9c2] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10.5px] font-mono text-[#85858d] bg-[#f4f4f6] px-1.5 py-[1px] rounded border border-[#ececf0]">
                                {task.id}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenTaskLogs(task.id);
                                }}
                                className="p-1 rounded text-[#85858d] hover:text-[#1c1c21] hover:bg-[#f1f1f4] opacity-0 group-hover:opacity-100 transition-opacity"
                                title="查看实时终端"
                              >
                                <Terminal size={12} strokeWidth={1.8} />
                              </button>
                            </div>

                            <h4 className="text-[12.5px] font-medium text-[#1c1c21] leading-snug line-clamp-2 mb-1">
                              {task.title}
                            </h4>

                            <div className="text-[11px] text-[#85858d] mb-2 truncate">
                              {wf?.name || task.workflowId}
                            </div>

                            {task.status === 'running' && currentNode && (
                              <div className="mb-2 px-2 py-1 rounded-[6px] bg-[#eeedfd] border border-[#d8d6fb] flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5] animate-ping inline-block" />
                                <span className="text-[10.5px] text-[#4f46e5] font-medium truncate">
                                  正在执行: {currentNode.name}
                                </span>
                              </div>
                            )}

                            {task.status === 'waiting_approval' && (
                              <div className="my-2 p-2 rounded-[6px] bg-[#fbf0df] border border-[#f3d0a1]">
                                <div className="text-[11px] font-medium text-[#b45309] mb-1.5">
                                  Midscene 动图已就绪，等待验收
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    disabled={approvingId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleApprove(task.id, true);
                                    }}
                                    className="flex-1 h-[22px] rounded-[5px] bg-[#189a58] hover:bg-[#147e48] text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-50"
                                  >
                                    <Check size={11} strokeWidth={2.4} />
                                    验收通过
                                  </button>
                                  <button
                                    disabled={approvingId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleApprove(task.id, false);
                                    }}
                                    className="h-[22px] px-2 rounded-[5px] border border-[#e3e3e8] bg-white text-[#d64545] hover:bg-[#fbe9e9] text-[11px] font-medium transition-all"
                                  >
                                    驳回
                                  </button>
                                </div>
                              </div>
                            )}

                            {nodeRuns.some((r) => r.artifacts && r.artifacts.length > 0) && (
                              <div className="mb-2 flex flex-wrap gap-1">
                                {nodeRuns
                                  .flatMap((r) => r.artifacts || [])
                                  .map((art, idx) => (
                                    <button
                                      key={idx}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPreviewArtifact(art);
                                      }}
                                      className="flex items-center gap-1 px-1.5 h-[20px] rounded-[4px] bg-[#f1f1f4] border border-[#e3e3e8] text-[10.5px] text-[#4b4b53] hover:bg-[#e9e9ee]"
                                    >
                                      <FileImage size={10} className="text-[#4f46e5]" />
                                      <span>{art.name}</span>
                                    </button>
                                  ))}
                              </div>
                            )}

                            <div className="pt-1.5 border-t border-[#ececf0] flex items-center justify-between text-[10.5px] text-[#85858d]">
                              <span>
                                节点 {completedCount}/{totalNodes}
                              </span>
                              <div className="w-16 bg-[#e6e6eb] rounded-full h-[3px] overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    task.status === 'completed'
                                      ? 'bg-[#189a58]'
                                      : task.status === 'failed'
                                      ? 'bg-[#d64545]'
                                      : 'bg-[#4f46e5]'
                                  }`}
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                              <span className="font-mono">{progressPct}%</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 产物预览弹窗 */}
      {previewArtifact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-100">
          <div className="w-[480px] bg-white border border-[#e3e3e8] rounded-[12px] p-5 shadow-[0_16px_44px_rgba(20,22,30,0.16)]">
            <div className="flex items-center justify-between pb-3 border-b border-[#ececf0]">
              <div className="flex items-center gap-2">
                <FileImage className="text-[#4f46e5]" size={16} />
                <span className="font-medium text-[13px] text-[#1c1c21]">{previewArtifact.name}</span>
              </div>
              <button
                onClick={() => setPreviewArtifact(null)}
                className="w-6 h-6 rounded flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21]"
              >
                <X size={15} />
              </button>
            </div>

            <div className="my-4 p-5 border border-dashed border-[#e3e3e8] rounded-[8px] bg-[#f9f9fb] flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-[10px] bg-white border border-[#e3e3e8] flex items-center justify-center mb-2.5 shadow-sm">
                <Sparkles className="text-[#4f46e5] w-7 h-7" />
              </div>
              <p className="text-[12.5px] font-medium text-[#1c1c21]">Midscene 自动化 UI 测试已合成</p>
              <p className="text-[11px] text-[#85858d] font-mono mt-0.5">{previewArtifact.path}</p>
              <div className="mt-3 px-2.5 py-0.5 rounded bg-[#e4f6ec] text-[#189a58] text-[11px] font-medium">
                包含步骤截图及交互操作动画帧
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setPreviewArtifact(null)}
                className="h-[28px] px-3.5 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 任务详情侧抽屉 */}
      {selectedTask && (
        <div className="fixed inset-y-0 right-0 w-[400px] bg-white border-l border-[#e3e3e8] p-5 z-40 shadow-[0_16px_44px_rgba(20,22,30,0.16)] flex flex-col animate-in slide-in-from-right duration-150">
          <div className="flex items-center justify-between pb-3.5 border-b border-[#ececf0]">
            <div>
              <div className="text-[10.5px] font-mono text-[#85858d]">{selectedTask.id}</div>
              <h3 className="text-[13.5px] font-medium text-[#1c1c21] mt-0.5">{selectedTask.title}</h3>
            </div>
            <button
              onClick={() => setSelectedTask(null)}
              className="w-6 h-6 rounded flex items-center justify-center text-[#85858d] hover:bg-[#f1f1f4] hover:text-[#1c1c21]"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 py-4 overflow-y-auto space-y-4 text-[12px]">
            <div className="flex items-center gap-4 text-[#4b4b53]">
              <div>
                状态: <span className="font-medium text-[#1c1c21] capitalize">{selectedTask.status}</span>
              </div>
              <div>
                泳道: <span className="font-medium text-[#4f46e5]">{selectedTask.kanbanColumn}</span>
              </div>
            </div>

            <div>
              <div className="font-medium text-[#1c1c21] mb-2">节点执行时序</div>
              <div className="space-y-1.5">
                {Object.entries(selectedTask.nodeRuns).map(([nid, run]) => (
                  <div
                    key={nid}
                    className="p-2.5 rounded-[7px] border border-[#ececf0] bg-[#f9f9fb] flex items-center justify-between"
                  >
                    <div>
                      <div className="font-mono text-[#1c1c21] text-[12px] font-medium">{nid}</div>
                      {run.finishedAt && run.startedAt && (
                        <div className="text-[10.5px] text-[#85858d]">
                          耗时: {((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s
                        </div>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10.5px] font-medium ${
                        run.status === 'success'
                          ? 'bg-[#e4f6ec] text-[#189a58]'
                          : run.status === 'waiting_approval'
                          ? 'bg-[#fbf0df] text-[#b45309]'
                          : run.status === 'running'
                          ? 'bg-[#eeedfd] text-[#4f46e5]'
                          : 'bg-[#fbe9e9] text-[#d64545]'
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-3.5 border-t border-[#ececf0]">
            <button
              onClick={() => {
                onOpenTaskLogs(selectedTask.id);
                setSelectedTask(null);
              }}
              className="w-full h-[32px] rounded-[7px] bg-[#1c1c21] hover:bg-[#2e2f36] text-[12px] font-medium text-white flex items-center justify-center gap-1.5 transition-all"
            >
              <Terminal size={13} />
              <span>查看此任务实时日志</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
