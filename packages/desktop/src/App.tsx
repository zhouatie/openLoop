import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LogTerminalDrawer } from './components/LogTerminalDrawer';
import { CreateTaskModal } from './components/CreateTaskModal';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutProvider } from './context/ShortcutContext';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { KanbanView } from './views/KanbanView';
import { WorkflowListView } from './views/WorkflowListView';
import { WorkflowEditorView } from './views/WorkflowEditorView';
import { PluginManagerView } from './views/PluginManagerView';
import { SettingsView } from './views/SettingsView';
import { api } from './services/api';
import { Task, WorkflowDefinition, LogEntry, PluginManifest, KanbanColumn, TaskAttachment } from '@openloop/core';
import { Puzzle } from 'lucide-react';
import { BUILTIN_PLUGINS, BUILTIN_VIEW_TITLES } from './constants/builtinPlugins';

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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isDaemonConnected, setIsDaemonConnected] = useState<boolean>(api.getConnectionStatus());

  // 绑定全局快捷键（高频事件委托，极致性能与输入保护）
  useGlobalShortcuts({
    onNavigateKanban: () => {
      setActivePluginId('kanban');
    },
    onNavigateWorkflows: () => {
      setActivePluginId('workflow-editor');
      setEditingWorkflowId(null);
    },
    onNavigatePlugins: () => {
      setActivePluginId('plugin-manager');
    },
    onNavigateSettings: () => {
      setActivePluginId('settings-agent');
    },
    onOpenCreateTask: () => {
      setIsCreateTaskModalOpen(true);
    },
    onToggleCommandPalette: () => {
      setIsCommandPaletteOpen((prev) => !prev);
    },
    onEscape: () => {
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
      setWorkflows(workflowsRes);
      setTasks(tasksRes);
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
    autoRun: boolean;
    kanbanColumn?: KanbanColumn;
    workspace?: string;
    attachments?: TaskAttachment[];
  }) => {
    if (import.meta.env?.DEV) {
      console.log('[App] 创建任务请求:', params);
    }
    await api.createTask(params);
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

  const currentPlugin = plugins.find((p) => p.id === activePluginId);
  const isSettings = activePluginId.startsWith('settings');
  const category = isSettings
    ? '设置'
    : activePluginId === 'kanban' || activePluginId === 'workflow-editor'
    ? '使用'
    : '扩展';
  
  const editingWorkflow = workflows.find((w) => w.id === editingWorkflowId);
  const pageTitle = isSettings
    ? activePluginId === 'settings-general'
      ? '常规与工作区'
      : activePluginId === 'settings-about'
      ? '关于与核心'
      : 'Agent 驱动'
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
        />

        <main className="flex-1 relative overflow-hidden bg-[#f4f4f6]">
          {activePluginId === 'kanban' && (
            <KanbanView
              tasks={tasks}
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
              onSelectWorkflow={(id) => setEditingWorkflowId(id)}
              onRefresh={refreshData}
              onOpenTaskLogs={handleOpenTaskLogs}
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

          {activePluginId === 'plugin-manager' && (
            <PluginManagerView plugins={plugins} onRefresh={refreshData} />
          )}

          {isSettings && (
            <SettingsView
              activeSubTab={activePluginId}
              onSelectSubTab={setActivePluginId}
            />
          )}

          {/* 第三方插件 */}
          {activePluginId !== 'kanban' &&
            activePluginId !== 'workflow-editor' &&
            activePluginId !== 'plugin-manager' &&
            !isSettings && (
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
            )}
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
        onOpenCreateTask={() => setIsCreateTaskModalOpen(true)}
        onToggleLogs={handleToggleLogs}
        onRefresh={refreshData}
      />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ShortcutProvider>
      <AppContent />
    </ShortcutProvider>
  );
};
