import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  Target,
  Plus,
} from 'lucide-react';
import { QaSuite, QaRunRecord } from '@openloop/core';
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
  const [isLoading, setIsLoading] = useState(false);

  // 弹窗状态
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingSuite, setEditingSuite] = useState<QaSuite | null>(null);
  const [deleteTargetSuite, setDeleteTargetSuite] = useState<QaSuite | null>(null);
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
      />
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
        description={`确定要删除测试用例「${deleteTargetSuite?.name}」吗？历史运行记录仍会完整保留。`}
        confirmText="确定删除"
        cancelText="取消"
        variant="danger"
        loading={isDeleting}
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteTargetSuite(null)}
      />
    </div>
  );
};
