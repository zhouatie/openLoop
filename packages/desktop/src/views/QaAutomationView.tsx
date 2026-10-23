import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  Target,
  Plus,
  Smartphone,
  Clock,
} from 'lucide-react';
import { QaSuite, QaRunRecord, DeviceLeaseSnapshot } from '@openloop/core';
import { api } from '../services/api';
import { QaRunsListView } from './qa/QaRunsListView';
import { QaRunDetailView } from './qa/QaRunDetailView';
import { QaSuitesListView } from './qa/QaSuitesListView';
import { QaSuiteModal } from '../components/qa/QaSuiteModal';
import { QaLiveRunModal } from '../components/qa/QaLiveRunModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { toast } from '../components/Toast';

const STORAGE_KEY_QA_SUBTAB = 'openloop_qa_subtab';

type QaTab = 'runs' | 'suites';

export const QaAutomationView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<QaTab>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_QA_SUBTAB);
      if (saved === 'runs' || saved === 'suites') return saved;
    } catch {}
    return 'runs';
  });

  const handleTabChange = (tab: QaTab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(STORAGE_KEY_QA_SUBTAB, tab);
    } catch {}
    if (import.meta.env?.DEV) {
      console.log('[QaAutomationView] 切换 QA 自动化子 Tab:', tab);
    }
  };
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const [runs, setRuns] = useState<QaRunRecord[]>([]);
  const [suites, setSuites] = useState<QaSuite[]>([]);
  const [deviceLeases, setDeviceLeases] = useState<DeviceLeaseSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // 弹窗状态
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingSuite, setEditingSuite] = useState<QaSuite | null>(null);
  const [deleteTargetSuite, setDeleteTargetSuite] = useState<QaSuite | null>(null);
  const [deleteTargetRun, setDeleteTargetRun] = useState<QaRunRecord | null>(null);
  const [batchDeleteRunIds, setBatchDeleteRunIds] = useState<string[] | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 实时执行弹窗
  const [activeRunSuite, setActiveRunSuite] = useState<QaSuite | null>(null);

  const hasRunningQa = useMemo(() => {
    return runs.some((r) => r.status === 'running' || (r as any).status === 'in_progress');
  }, [runs]);

  const loadData = async () => {
    setIsLoading(true);
    if (import.meta.env?.DEV) {
      console.log('[QaAutomationView] 加载自动化测试套件与执行历史...');
    }
    try {
      const [suitesData, runsData] = await Promise.all([
        api.getQaSuites(),
        api.getQaRuns(),
      ]);
      setSuites(suitesData || []);
      setRuns(runsData || []);
      if (import.meta.env?.DEV) {
        console.log('[QaAutomationView] 数据加载完毕:', {
          suitesCount: suitesData?.length,
          runsCount: runsData?.length,
        });
      }
    } catch (err: any) {
      if (import.meta.env?.DEV) {
        console.error('[QaAutomationView] 加载数据失败:', err);
      }
      toast.error(`加载测试数据失败: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // 监听实时 WebSocket 广播完成事件
    const unsub = api.on('qa:run_completed', (record: QaRunRecord) => {
      if (import.meta.env?.DEV) {
        console.log('[QaAutomationView] 接收到 Core 测试完成推送:', record);
      }
      loadData();
    });

    return () => {
      unsub();
    };
  }, []);

  // 设备租约队列：展示 iOS 设备当前占用者与排队任务，避免重复发起争用
  useEffect(() => {
    api.getDeviceLeases().then(setDeviceLeases).catch(() => {});
    const unsub = api.on('qa:device_leases', (data: any) => {
      if (import.meta.env?.DEV) {
        console.log('[QaAutomationView] 设备队列更新:', data?.leases);
      }
      setDeviceLeases(data?.leases || []);
    });
    return () => {
      unsub();
    };
  }, []);

  // 快速触发测试
  const handleQuickRunSuite = (suite: QaSuite) => {
    if (import.meta.env?.DEV) {
      console.log('[QaAutomationView] 触发用例执行:', suite.id);
    }
    setActiveRunSuite(suite);
  };

  // 保存用例
  const handleSaveSuite = async (suiteData: Partial<QaSuite>) => {
    try {
      await api.saveQaSuite(suiteData);
      toast.success(suiteData.id ? '测试用例更新成功' : '测试用例创建成功');
      await loadData();
    } catch (err: any) {
      toast.error(`保存失败: ${err.message}`);
    }
  };

  // 确认删除用例
  const handleConfirmDelete = async () => {
    if (!deleteTargetSuite) return;
    setIsDeleting(true);
    try {
      await api.deleteQaSuite(deleteTargetSuite.id);
      toast.success(`用例「${deleteTargetSuite.name}」已删除`);
      setDeleteTargetSuite(null);
      await loadData();
    } catch (err: any) {
      toast.error(`删除失败: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // 若处于特定任务详情页，直接渲染详情页视图
  if (selectedRunId) {
    return (
      <>
        <QaRunDetailView
          runId={selectedRunId}
          onBack={() => {
            setSelectedRunId(null);
            loadData();
          }}
          onRerun={(suiteId) => {
            const target = suites.find((s) => s.id === suiteId);
            if (target) {
              setActiveRunSuite(target);
            } else {
              toast.error('未找到对应测试用例');
            }
          }}
          onDeleteRun={(runId) => {
            const r = runs.find((item) => item.id === runId) || ({ id: runId, suiteName: '测试运行' } as QaRunRecord);
            setDeleteTargetRun(r);
          }}
        />

        {deleteTargetRun && (
          <ConfirmModal
            isOpen={true}
            title="删除自动化测试记录"
            description="将从数据库彻底移除此条测试运行记录，并清理保存在磁盘上的所有视觉截帧与 HTML 报告文件。"
            targetName={`测试 #${deleteTargetRun.id}`}
            targetTag={deleteTargetRun.suiteName}
            confirmText="确认删除"
            variant="danger"
            loading={isDeleting}
            onConfirm={async () => {
              if (!deleteTargetRun) return;
              try {
                setIsDeleting(true);
                await api.deleteQaRun(deleteTargetRun.id);
                toast.success('已删除测试运行记录及截图产物');
                setDeleteTargetRun(null);
                setSelectedRunId(null);
                await loadData();
              } catch (err: any) {
                toast.error('删除测试记录失败');
              } finally {
                setIsDeleting(false);
              }
            }}
            onClose={() => setDeleteTargetRun(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex-1 h-full flex flex-col bg-[#f4f4f6] overflow-hidden select-none">
      {/* 顶部主子标签栏 (对齐 openLoop 极简设计系统与流程编排模块，子 Tab 切换位于左侧) */}
      <div className="px-6 pt-3 pb-1 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-[#ececf0] p-0.5 rounded-[7px] border border-[#e3e3e8]/70">
          <button
            type="button"
            onClick={() => handleTabChange('runs')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[11.5px] font-medium transition-all cursor-pointer ${
              activeTab === 'runs'
                ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                : 'text-[#63636b] hover:text-[#1c1c21]'
            }`}
          >
            <History size={13} className={activeTab === 'runs' ? 'text-[#1c1c21]' : 'text-[#85858d]'} />
            <span>任务执行记录</span>
            <span className="text-[10px] font-mono px-1.5 py-[0.5px] rounded bg-black/5 text-[#63636b]">
              {runs.length}
            </span>
            {hasRunningQa && (
              <span className="relative flex h-2 w-2 ml-0.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('suites')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[11.5px] font-medium transition-all cursor-pointer ${
              activeTab === 'suites'
                ? 'bg-white text-[#1c1c21] shadow-2xs font-semibold'
                : 'text-[#63636b] hover:text-[#1c1c21]'
            }`}
          >
            <Target size={13} className={activeTab === 'suites' ? 'text-[#1c1c21]' : 'text-[#85858d]'} />
            <span>测试用例库</span>
            <span className="text-[10px] font-mono px-1.5 py-[0.5px] rounded bg-black/5 text-[#63636b]">
              {suites.length}
            </span>
          </button>
        </div>

        {activeTab === 'suites' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (import.meta.env?.DEV) console.log('[QaAutomationView] 点击新建用例');
                setEditingSuite(null);
                setIsEditorOpen(true);
              }}
              className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs cursor-pointer"
            >
              <Plus size={13} strokeWidth={2.4} />
              <span>新建用例</span>
            </button>
          </div>
        )}
      </div>

      {/* 设备队列条：仅在设备被占用或有人排队时出现 */}
      {deviceLeases.length > 0 && (
        <div className="px-6 pt-1.5 shrink-0 flex flex-col gap-1">
          {deviceLeases.map((lease) => (
            <div
              key={lease.key}
              className="flex items-center gap-2 h-[28px] px-2.5 rounded-[6px] bg-white border border-[#e3e3e8] text-[11px] overflow-hidden"
            >
              <Smartphone size={11} className="text-[#63636b] shrink-0" />
              <span className="font-mono text-[10.5px] text-[#71717a] shrink-0">
                {lease.key.replace(/^https?:\/\//, '')}
              </span>
              <span className="text-[#1c1c21] font-medium truncate">
                {lease.holder?.label || '空闲'}
              </span>
              {lease.waiting.length > 0 && (
                <>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fffbeb] text-[#b45309] text-[10px] font-medium border border-[#fde68a]/70 shrink-0">
                    <Clock size={10} strokeWidth={2.2} />
                    <span>排队 {lease.waiting.length}</span>
                  </span>
                  <span className="text-[#85858d] truncate">
                    {lease.waiting.map((waiter) => waiter.label).join(' · ')}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 主视图内容区域 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
        {activeTab === 'runs' ? (
          <QaRunsListView
            runs={runs}
            suites={suites}
            onSelectRun={(runId) => setSelectedRunId(runId)}
            onQuickRunSuite={handleQuickRunSuite}
            onNewSuite={() => {
              setEditingSuite(null);
              setIsEditorOpen(true);
            }}
            onDeleteRun={(run) => setDeleteTargetRun(run)}
            onBatchDeleteRuns={(runIds) => setBatchDeleteRunIds(runIds)}
            onRefresh={loadData}
            isLoading={isLoading}
          />
        ) : (
          <QaSuitesListView
            suites={suites}
            onNewSuite={() => {
              setEditingSuite(null);
              setIsEditorOpen(true);
            }}
            onEditSuite={(suite) => {
              setEditingSuite(suite);
              setIsEditorOpen(true);
            }}
            onDeleteSuite={(suite) => setDeleteTargetSuite(suite)}
            onRunSuite={handleQuickRunSuite}
          />
        )}
      </div>

      {/* 新建/编辑用例 Modal */}
      {isEditorOpen && (
        <QaSuiteModal
          initialSuite={editingSuite}
          onSave={handleSaveSuite}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingSuite(null);
          }}
        />
      )}

      {/* 实时单次运行进度 Modal */}
      {activeRunSuite && (
        <QaLiveRunModal
          suite={activeRunSuite}
          onClose={() => {
            setActiveRunSuite(null);
            loadData();
          }}
          onOpenReplay={(newRun) => {
            setSelectedRunId(newRun.id);
          }}
        />
      )}

      {/* 删除确认 Modal */}
      <ConfirmModal
        isOpen={Boolean(deleteTargetSuite)}
        title="删除测试用例"
        description={`确定要删除测试用例「${deleteTargetSuite?.name}」吗？关联的历史运行记录与截图产物也将一并级联清理。`}
        confirmText="确定删除"
        cancelText="取消"
        variant="danger"
        loading={isDeleting}
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteTargetSuite(null)}
      />

      {/* 删除单个运行记录 Modal */}
      {deleteTargetRun && !selectedRunId && (
        <ConfirmModal
          isOpen={true}
          title="删除自动化测试记录"
          description="将从数据库彻底移除此条测试运行记录，并清理保存在磁盘上的所有视觉截帧与 HTML 报告文件。"
          targetName={`测试 #${deleteTargetRun.id}`}
          targetTag={deleteTargetRun.suiteName}
          confirmText="确认删除"
          variant="danger"
          loading={isDeleting}
          onConfirm={async () => {
            if (!deleteTargetRun) return;
            try {
              setIsDeleting(true);
              await api.deleteQaRun(deleteTargetRun.id);
              toast.success('已删除测试运行记录及截图产物');
              setDeleteTargetRun(null);
              await loadData();
            } catch (err: any) {
              toast.error('删除测试记录失败');
            } finally {
              setIsDeleting(false);
            }
          }}
          onClose={() => setDeleteTargetRun(null)}
        />
      )}

      {/* 批量删除测试运行记录 Modal */}
      {batchDeleteRunIds && (
        <ConfirmModal
          isOpen={true}
          title="批量删除自动化测试记录"
          description={`确定要批量删除所选的 ${batchDeleteRunIds.length} 条测试运行记录吗？相关的测试历史回放数据与磁盘截图产物也将彻底清除，不可恢复。`}
          targetName={`所选 ${batchDeleteRunIds.length} 项测试`}
          confirmText="确认批量删除"
          cancelText="取消"
          variant="danger"
          loading={isDeleting}
          onConfirm={async () => {
            if (!batchDeleteRunIds || batchDeleteRunIds.length === 0) return;
            try {
              setIsDeleting(true);
              if (import.meta.env?.DEV) console.log('[QaAutomationView] 批量删除 QA 记录:', batchDeleteRunIds);
              const res = await api.clearQaRuns({ runIds: batchDeleteRunIds });
              toast.success(`已批量删除 ${res.deletedCount} 条测试记录与相关截图产物`);
              setBatchDeleteRunIds(null);
              await loadData();
            } catch (err: any) {
              if (import.meta.env?.DEV) console.error('[QaAutomationView] 批量删除失败:', err);
              toast.error('批量删除测试记录失败');
            } finally {
              setIsDeleting(false);
            }
          }}
          onClose={() => setBatchDeleteRunIds(null)}
        />
      )}
    </div>
  );
};
