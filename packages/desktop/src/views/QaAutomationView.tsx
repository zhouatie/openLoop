import React, { useState, useEffect } from 'react';
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

type QaTab = 'runs' | 'suites';

export const QaAutomationView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<QaTab>('runs');
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
      {/* 顶部工具栏 (符合 openLoop 统一极简风格，白底、细边框) */}
      <div className="bg-white border-b border-[#e3e3e8] px-6 py-3.5 flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-[#1c1c21]">QA 自动化测试</h2>
            <span className="text-[11px] font-mono text-[#85858d] bg-[#f4f4f6] border border-[#e3e3e8] px-2 py-[1px] rounded-[5px]">
              {activeTab === 'runs' ? `${runs.length} 次任务记录` : `${suites.length} 个用例`}
            </span>
          </div>
          <p className="text-[12px] text-[#85858d] mt-0.5">
            基于 Midscene 多模态视觉模型驱动浏览器 UI 自动化验证，支持时间轴与截图逐帧回放。
          </p>
        </div>

        {/* 顶部右侧：Tab 标签切换与新建按钮 */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1 bg-[#ececf0] p-0.5 rounded-[6px]">
            <button
              onClick={() => setActiveTab('runs')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all cursor-pointer ${
                activeTab === 'runs'
                  ? 'bg-white text-[#1c1c21] shadow-2xs'
                  : 'text-[#71717a] hover:text-[#1c1c21]'
              }`}
            >
              <History size={12} />
              <span>任务执行记录</span>
            </button>

            <button
              onClick={() => setActiveTab('suites')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-[11.5px] font-medium transition-all cursor-pointer ${
                activeTab === 'suites'
                  ? 'bg-white text-[#1c1c21] shadow-2xs'
                  : 'text-[#71717a] hover:text-[#1c1c21]'
              }`}
            >
              <Target size={12} />
              <span>测试用例库</span>
            </button>
          </div>

          <button
            onClick={() => {
              setEditingSuite(null);
              setIsEditorOpen(true);
            }}
            className="flex items-center gap-1 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs cursor-pointer"
          >
            <Plus size={12} strokeWidth={2.4} />
            <span>新建用例</span>
          </button>
        </div>
      </div>

      {/* 主视图内容区域 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-3.5">
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
