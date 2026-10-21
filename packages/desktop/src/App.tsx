import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LogTerminalDrawer } from './components/LogTerminalDrawer';
import { CreateTaskModal } from './components/CreateTaskModal';
import { QuickRunWorkflowModal } from './components/QuickRunWorkflowModal';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutProvider } from './context/ShortcutContext';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { ToastProvider } from './components/Toast';
import { KanbanView } from './views/KanbanView';
import { WorkflowListView } from './views/WorkflowListView';
import { WorkflowEditorView } from './views/WorkflowEditorView';
import { AutomationListView } from './views/AutomationListView';
import { QaAutomationView } from './views/QaAutomationView';
import { PluginManagerView } from './views/PluginManagerView';
import { SettingsView } from './views/SettingsView';
import { PluginSandboxContainer } from './components/PluginSandboxContainer';
import { api } from './services/api';
import { Task, WorkflowDefinition, LogEntry, PluginManifest, KanbanColumn, TaskAttachment } from '@openloop/core';
import { Puzzle } from 'lucide-react';
import { BUILTIN_PLUGINS, BUILTIN_VIEW_TITLES } from './constants/builtinPlugins';
import { getStoredSidebarOrder } from './utils/sidebarOrder';

export const AppContent: React.FC = () => {
  const [activePluginId, setActivePluginId] = useState<string>('kanban');
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<PluginManifest[]>(BUILTIN_PLUGINS);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLogsOpen, setIsLogsOpen] = useState<boolean>(false);
  const [unreadLogsCount, setUnreadLogsCount] = useState<number>(0);
  const [activeNodeFilter, setActiveNodeFilter] = useState<string>('all');
  const [selectedWorkspaceFilter, setSelectedWorkspaceFilter] = useState<string>(() => {
    try {
      return localStorage.getItem('openloop_kanban_selected_workspace_filter') || 'all';
    } catch {
      return 'all';
    }
  });
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState<boolean>(false);
  const [isQuickRunModalOpen, setIsQuickRunModalOpen] = useState<boolean>(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [workflowSubTab, setWorkflowSubTab] = useState<'workflows' | 'runs'>('workflows');
  const [selectedRunTaskId, setSelectedRunTaskId] = useState<string | null>(null);
  const [filterWorkflowId, setFilterWorkflowId] = useState<string | null>(null);
  const [isDaemonConnected, setIsDaemonConnected] = useState<boolean>(api.getConnectionStatus());
  const [sidebarOrder, setSidebarOrder] = useState<string[]>(() => getStoredSidebarOrder());
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem('openloop_sidebar_open');
      if (cached !== null) {
        return cached === 'true';
      }
    } catch {}
    return true;
  });

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('openloop_sidebar_open', String(next));
      } catch {}
      if (import.meta.env?.DEV) {
        console.log('[App] 切换侧边栏展开状态:', { previous: prev, current: next });
      }
      return next;
    });
  }, []);

  // 绑定全局快捷键（高频事件委托，极致性能与输入保护）
  useGlobalShortcuts({
    onNavigateKanban: () => {
      setActivePluginId('kanban');
    },
    onNavigateWorkflows: () => {
      setActivePluginId('workflow-editor');
      setEditingWorkflowId(null);
    },
    onNavigateAutomations: () => {
      setActivePluginId('automations');
    },
    onNavigateQa: () => {
      setActivePluginId('qa-automation');
    },
    onNavigateSettings: () => {
      setActivePluginId('settings-agent');
    },
    onOpenCreateTask: () => {
      setIsCreateTaskModalOpen(true);
    },
    onQuickRunWorkflow: () => {
      setIsQuickRunModalOpen(true);
    },
    onToggleCommandPalette: () => {
      setIsCommandPaletteOpen((prev) => !prev);
    },
    onToggleSidebar: handleToggleSidebar,
    onEscape: () => {
      if (isQuickRunModalOpen) {
        setIsQuickRunModalOpen(false);
      }
      if (isCommandPaletteOpen) {
        setIsCommandPaletteOpen(false);
      }
    },
  });

  const handleWorkspaceFilterChange = (workspace: string) => {
    setSelectedWorkspaceFilter(workspace);
    try {
      localStorage.setItem('openloop_kanban_selected_workspace_filter', workspace);
    } catch {}
    if (import.meta.env?.DEV) {
      console.log('[App] 看板聚焦工程项目变更:', workspace);
    }
  };

  const refreshData = async () => {
    try {
      const [pluginsRes, workflowsRes, tasksRes] = await Promise.all([
        api.getPlugins(),
        api.getWorkflows(),
        api.getTasks(),
      ]);
      if (import.meta.env?.DEV) {
        console.log('[App] 刷新数据完成:', {
          pluginsCount: pluginsRes?.length,
          workflowsCount: workflowsRes?.length,
          tasksCount: tasksRes?.length,
        });
      }
      if (pluginsRes && Array.isArray(pluginsRes)) {
        // 合并预置插件与远端加载的扩展插件，保持预置插件顺序与元数据完备
        const mergedPlugins = [...BUILTIN_PLUGINS];
        for (const p of pluginsRes) {
          const idx = mergedPlugins.findIndex((m) => m.id === p.id);
          if (idx >= 0) {
            mergedPlugins[idx] = { ...mergedPlugins[idx], ...p };
          } else {
            mergedPlugins.push(p);
          }
        }
        setPlugins(mergedPlugins);
      }
      setWorkflows((prev) => {
        if (!workflowsRes) return prev;
        if (
          prev.length === workflowsRes.length &&
          prev.every((w, i) => w.id === workflowsRes[i]?.id && w.updatedAt === workflowsRes[i]?.updatedAt)
        ) {
          return prev;
        }
        return workflowsRes;
      });

      setTasks((prev) => {
        if (!tasksRes) return prev;
        const prevMap = new Map(prev.map((t) => [t.id, t]));
        let hasChanges = prev.length !== tasksRes.length;
        const merged = tasksRes.map((t) => {
          const old = prevMap.get(t.id);
          if (
            old &&
            old.updatedAt === t.updatedAt &&
            old.status === t.status &&
            old.kanbanColumn === t.kanbanColumn &&
            old.currentNodeId === t.currentNodeId
          ) {
            return old;
          }
          hasChanges = true;
          return t;
        });
        return hasChanges ? merged : prev;
      });
    } catch (err) {
      console.warn('[App] Fetch error, will retry with WS', err);
    }
  };

  useEffect(() => {
    refreshData();

    const unsubConn = api.on('connection:change', (status: boolean) => {
      setIsDaemonConnected(status);
      if (status) refreshData();
    });

    const unsubTaskUpdate = api.on('task:update', (updatedTask: Task) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === updatedTask.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updatedTask;
          return next;
        }
        return [updatedTask, ...prev];
      });
    });

    const unsubTaskNew = api.on('task:new', (newTask: Task) => {
      setTasks((prev) => [newTask, ...prev]);
    });

    const unsubLog = api.on('log:new', (newLog: LogEntry) => {
      setLogs((prev) => [...prev, newLog]);
      if (!isLogsOpen) {
        setUnreadLogsCount((c) => c + 1);
      }
    });

    return () => {
      unsubConn();
      unsubTaskUpdate();
      unsubTaskNew();
      unsubLog();
    };
  }, [isLogsOpen]);

  const handleOpenTaskLogs = async (taskId: string, nodeId?: string) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[App] handleOpenTaskLogs:', { taskId, nodeId });
    }
    try {
      const taskLogs = await api.getTaskLogs(taskId);
      setLogs((prev) => {
        const existingIds = new Set(prev.map((l) => l.id));
        const newOnes = taskLogs.filter((l) => !existingIds.has(l.id));
        return [...prev, ...newOnes];
      });
      setActiveNodeFilter(nodeId || 'all');
      setIsLogsOpen(true);
      setUnreadLogsCount(0);
    } catch {
      setActiveNodeFilter(nodeId || 'all');
      setIsLogsOpen(true);
    }
  };

  const handleToggleLogs = () => {
    setIsLogsOpen(!isLogsOpen);
    if (!isLogsOpen) {
      setUnreadLogsCount(0);
    }
  };

  const handleCreateTask = async (params: {
    title: string;
    workflowId: string;
    description: string;
    acceptanceCriteria?: string;
    autoRun: boolean;
    kanbanColumn?: KanbanColumn;
    workspace?: string;
    attachments?: TaskAttachment[];
    kind?: 'single' | 'group' | 'subtask';
    executionMode?: 'serial' | 'parallel' | 'dag';
    concurrencyLimit?: number;
    autoDecompose?: boolean;
    subtasks?: Array<{ id?: string; title: string; workflowId?: string; description?: string; dependencies?: string[]; workspace?: string }>;
  }) => {
    if (import.meta.env?.DEV) {
      console.log('[App] 创建任务/任务组请求:', params);
    }
    await api.createTask({
      ...params,
      triggerSource: 'kanban',
    });
    refreshData();
  };

  const handleTaskUpdate = (updatedTask: Task) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === updatedTask.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updatedTask;
        return next;
      }
      return [updatedTask, ...prev];
    });
  };

  // 看板仅展示看板管理任务，排除快捷运行(shortcut)与调试运行(debug)等纯流水线执行记录
  const kanbanTasks = useMemo(() => {
    const list = tasks.filter((t) => t.triggerSource !== 'shortcut' && t.triggerSource !== 'debug');
    if (import.meta.env?.DEV) {
      console.log('[App] 过滤看板有效任务列表:', { total: tasks.length, kanban: list.length });
    }
    return list;
  }, [tasks]);

  const currentPlugin = plugins.find((p) => p.id === activePluginId);
  const isSettings = activePluginId.startsWith('settings') || activePluginId === 'plugin-manager';
  const category = isSettings ? '设置' : '功能';

  let settingsSubTitle = '系统设置';
  if (activePluginId.includes('plugin') || activePluginId === 'plugin-manager') {
    settingsSubTitle = '插件扩展';
  } else if (activePluginId.includes('sidebar')) {
    settingsSubTitle = '侧边栏排序';
  } else if (activePluginId.includes('general') || activePluginId.includes('workspace')) {
    settingsSubTitle = '工作区与环境';
  } else if (activePluginId.includes('shortcut')) {
    settingsSubTitle = '快捷键';
  } else if (activePluginId.includes('agent')) {
    settingsSubTitle = '智能体驱动';
  }

  const editingWorkflow = workflows.find((w) => w.id === editingWorkflowId);
  const pageTitle = isSettings
    ? settingsSubTitle
    : activePluginId === 'workflow-editor' && editingWorkflow
    ? `流程编排 / ${editingWorkflow.name}`
    : currentPlugin?.sidebarItem?.title ||
      currentPlugin?.name ||
      BUILTIN_VIEW_TITLES[activePluginId] ||
      '任务看板';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f4f4f6] text-[#1c1c21]">
      {/* 侧边栏 */}
      <Sidebar
        plugins={plugins}
        sidebarOrder={sidebarOrder}
        activePluginId={activePluginId}
        onSelectPlugin={(id) => {
          if (import.meta.env?.DEV) {
            console.log('[App] 切换视图插件:', id);
          }
          setActivePluginId(id);
          if (id === 'workflow-editor') {
            setEditingWorkflowId(null); // 回到流程列表
          }
        }}
        isDaemonConnected={isDaemonConnected}
        isOpen={isSidebarOpen}
      />

      {/* 主视图 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Header
          category={category}
          title={pageTitle}
          isDaemonConnected={isDaemonConnected}
          onOpenCreateTask={() => setIsCreateTaskModalOpen(true)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onToggleLogs={handleToggleLogs}
          isLogsOpen={isLogsOpen}
          unreadLogsCount={unreadLogsCount}
          onRefresh={refreshData}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={handleToggleSidebar}
        />

        <main className="flex-1 relative overflow-hidden bg-[#f4f4f6]">
          {activePluginId === 'kanban' && (
            <KanbanView
              tasks={kanbanTasks}
              workflows={workflows}
              onOpenTaskLogs={handleOpenTaskLogs}
              onRefresh={refreshData}
              onTaskUpdate={handleTaskUpdate}
              selectedWorkspaceFilter={selectedWorkspaceFilter}
              onWorkspaceFilterChange={handleWorkspaceFilterChange}
            />
          )}

          {activePluginId === 'workflow-editor' && !editingWorkflowId && (
            <WorkflowListView
              workflows={workflows}
              tasks={tasks}
              onSelectWorkflow={(id) => setEditingWorkflowId(id)}
              onRefresh={refreshData}
              onOpenTaskLogs={handleOpenTaskLogs}
              initialSubTab={workflowSubTab}
              initialSelectedTaskId={selectedRunTaskId}
              initialFilteredWorkflowId={filterWorkflowId}
              onClearSelectedTask={() => setSelectedRunTaskId(null)}
            />
          )}

          {activePluginId === 'workflow-editor' && editingWorkflowId && (
            <WorkflowEditorView
              workflowId={editingWorkflowId}
              workflows={workflows}
              onBack={() => setEditingWorkflowId(null)}
              onRefresh={refreshData}
              onOpenTaskLogs={handleOpenTaskLogs}
              onSelectWorkflow={(id) => setEditingWorkflowId(id)}
            />
          )}

          {activePluginId === 'automations' && (
            <AutomationListView
              workflows={workflows}
              tasks={tasks}
              onOpenTaskLogs={handleOpenTaskLogs}
              onRefreshAll={refreshData}
            />
          )}

          {activePluginId === 'qa-automation' && (
            <QaAutomationView />
          )}

          {isSettings && (
            <SettingsView
              activeSubTab={activePluginId === 'plugin-manager' ? 'settings-plugins' : activePluginId}
              onSelectSubTab={setActivePluginId}
              plugins={plugins}
              sidebarOrder={sidebarOrder}
              onUpdateSidebarOrder={(newOrder) => {
                if (import.meta.env?.DEV) {
                  console.log('[App] 更新侧边栏排序状态:', newOrder);
                }
                setSidebarOrder(newOrder);
              }}
              onRefreshPlugins={refreshData}
            />
          )}

          {/* 第三方插件 */}
          {activePluginId !== 'kanban' &&
            activePluginId !== 'workflow-editor' &&
            activePluginId !== 'automations' &&
            activePluginId !== 'qa-automation' &&
            activePluginId !== 'plugin-manager' &&
            !isSettings &&
            (currentPlugin?.entry ? (
              <PluginSandboxContainer
                plugin={currentPlugin}
                currentWorkspace={
                  selectedWorkspaceFilter !== 'all' && selectedWorkspaceFilter !== 'none'
                    ? selectedWorkspaceFilter
                    : undefined
                }
              />
            ) : (
              <div className="flex-1 h-full p-8 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-[10px] bg-white border border-[#e3e3e8] shadow-sm flex items-center justify-center text-[#4f46e5] mb-3">
                  <Puzzle size={22} />
                </div>
                <h3 className="text-[14px] font-semibold text-[#1c1c21] mb-1">
                  第三方插件沙箱槽位: {currentPlugin?.name}
                </h3>
                <p className="text-[12px] text-[#85858d] max-w-sm mb-4 leading-relaxed">
                  插件已成功挂载至 openLoop 侧边栏插槽。可通过 Webview 加载前端组件，通过 openLoop API 与引擎通信。
                </p>
                <div className="px-3 py-1 rounded-[6px] bg-white border border-[#e3e3e8] text-[11px] font-mono text-[#85858d]">
                  Plugin ID: {currentPlugin?.id} · Version: v{currentPlugin?.version}
                </div>
              </div>
            ))}
        </main>
      </div>

      {/* 实时终端抽屉 */}
      <LogTerminalDrawer
        isOpen={isLogsOpen}
        onClose={() => setIsLogsOpen(false)}
        logs={logs}
        onClearLogs={() => setLogs([])}
        workflows={workflows}
        activeNodeFilter={activeNodeFilter}
        onFilterChange={setActiveNodeFilter}
      />

      {/* 新建任务弹窗 */}
      <CreateTaskModal
        isOpen={isCreateTaskModalOpen}
        onClose={() => setIsCreateTaskModalOpen(false)}
        workflows={workflows}
        onCreate={handleCreateTask}
        defaultWorkspace={
          selectedWorkspaceFilter !== 'all' && selectedWorkspaceFilter !== 'none'
            ? selectedWorkspaceFilter
            : undefined
        }
      />

      {/* 快捷流水线执行弹窗 (Super+R) */}
      <QuickRunWorkflowModal
        isOpen={isQuickRunModalOpen}
        onClose={() => setIsQuickRunModalOpen(false)}
        workflows={workflows}
        onTaskCreated={() => {
          refreshData();
        }}
        onNavigateKanban={() => {
          setActivePluginId('kanban');
        }}
        onNavigateRuns={(taskId?: string, wfId?: string) => {
          setActivePluginId('workflow-editor');
          setEditingWorkflowId(null);
          setWorkflowSubTab('runs');
          if (taskId) setSelectedRunTaskId(taskId);
          if (wfId) setFilterWorkflowId(wfId);
        }}
      />

      {/* 全局命令面板 (Super+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={(id) => {
          setActivePluginId(id);
          if (id === 'workflow-editor') {
            setEditingWorkflowId(null);
          }
        }}
        onNavigateWorkflowRuns={() => {
          setActivePluginId('workflow-editor');
          setEditingWorkflowId(null);
          setWorkflowSubTab('runs');
        }}
        onOpenCreateTask={() => setIsCreateTaskModalOpen(true)}
        onOpenQuickRun={() => setIsQuickRunModalOpen(true)}
        onToggleLogs={handleToggleLogs}
        onRefresh={refreshData}
        onToggleSidebar={handleToggleSidebar}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <ShortcutProvider>
        <AppContent />
      </ShortcutProvider>
    </ToastProvider>
  );
};
