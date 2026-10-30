import {
  Task,
  WorkflowDefinition,
  LogEntry,
  PluginManifest,
  TaskSessionState,
  OpenLoopSettings,
  KanbanColumn,
  TaskAttachment,
  WorkflowSessionState,
  QaSuite,
  QaRunRecord,
  SelectedQaArtifacts,
  AndroidDeviceInfo,
  IosDevicesSnapshot,
  DeviceLeaseSnapshot,
  AutomationTask,
  AutomationLogRecord,
  TaskWorktreeDiffResult,
  FileDiffItem,
  RuntimeSettingsApplySummary,
  StorageStats,
  StorageCleanOptions,
  StorageCleanResult,
  SessionChatMessage,
} from '@openloop/core';
import type { OpenInAppTarget, SessionTreeSnapshot } from '@openloop/core/types';

function resolveBackendUrls(): { httpUrl: string; wsUrl: string } {
  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port, search } = window.location;
    const portNum = port ? parseInt(port, 10) : 0;

    // 0. 最高优先级：从 URL 查询参数解析 ?corePort=... (彻底解决靶机跨环境精准对齐)
    let explicitCorePort = '';
    try {
      const sp = new URLSearchParams(search);
      const qPort = sp.get('corePort');
      if (qPort && /^\d+$/.test(qPort)) {
        explicitCorePort = qPort;
      }
    } catch {}

    // Vite 本地开发模式或独立靶机沙箱端口 (5170 - 5200)
    // 默认指向开发沙箱 Core 调度服务 19889，或由环境变量 VITE_CORE_PORT 注入
    if (explicitCorePort || import.meta.env.DEV || (portNum >= 5170 && portNum <= 5200)) {
      const corePort = explicitCorePort || import.meta.env.VITE_CORE_PORT || (import.meta.env.DEV ? '19889' : '19888');
      let host = hostname || '127.0.0.1';
      if (host === '0.0.0.0' || host === 'localhost') {
        host = '127.0.0.1';
      }
      if (import.meta.env.DEV) {
        console.log(`[UI:Init] 开发模式已连接沙箱调度服务: http://${host}:${corePort}${explicitCorePort ? ' (via URL param ?corePort)' : ''}`);
      }
      return {
        httpUrl: `http://${host}:${corePort}`,
        wsUrl: `ws://${host}:${corePort}`,
      };
    }
    // 生产部署模式或 Core 静态托管模式：动态复用当前主机与端口
    if (hostname) {
      const isHttps = protocol === 'https:';
      const wsProto = isHttps ? 'wss:' : 'ws:';
      const portPart = port ? `:${port}` : '';
      return {
        httpUrl: `${protocol}//${hostname}${portPart}`,
        wsUrl: `${wsProto}//${hostname}${portPart}`,
      };
    }
  }
  return {
    httpUrl: 'http://127.0.0.1:19888',
    wsUrl: 'ws://127.0.0.1:19888',
  };
}

const { httpUrl: BASE_URL, wsUrl: WS_URL } = resolveBackendUrls();

/** 后端相对路径转完整 URL：Electron 生产环境页面来自 file://，相对路径会解析失败 */
export function backendUrl(pathname: string): string {
  return `${BASE_URL}${pathname}`;
}

const isDev = import.meta.env?.DEV;

/** 文件预览查询串：base 是会话工作区，用来解析相对路径 */
function fsQuery(path: string, base?: string): string {
  const query = `path=${encodeURIComponent(path)}`;
  return base ? `${query}&base=${encodeURIComponent(base)}` : query;
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const method = options?.method || 'GET';
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (isDev) {
        console.warn(`[UI:API Warning] ${method} ${url} - Status: ${res.status}`, errText);
      }
      let parsedErr: any;
      try {
        parsedErr = JSON.parse(errText);
      } catch {}
      const errMsg =
        parsedErr?.error || parsedErr?.message || errText || res.statusText || `HTTP ${res.status}`;
      throw new Error(errMsg);
    }
    return await res.json();
  } catch (error: any) {
    if (isDev) {
      console.error(`[UI:API Error] ${method} ${url} 发生异常:`, error);
    }
    throw error;
  }
}

export class DesktopApiService {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private isConnected = false;
  private reconnectTimer: any = null;
  private autoHealInterval: any = null;
  private isChecking = false;

  constructor() {
    this.checkHttpConnection();
    this.connectWs();
    this.initLifecycleAutoHeal();
  }

  // 初始化窗口聚焦与可见性变化时的秒级自愈机制
  private initLifecycleAutoHeal() {
    if (typeof window === 'undefined') return;

    const handleWake = () => {
      if (!this.isConnected) {
        if (isDev) console.log('[UI:API] 窗口唤醒/聚焦，触发后台服务轻量探活自愈');
        this.retryConnection();
      }
    };

    window.addEventListener('focus', handleWake);
    window.addEventListener('online', handleWake);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        handleWake();
      }
    });

    // 轻量后台探活：仅当未连接时，每 2.5 秒尝试一次探活（连接成功后自动静默，零资源浪费）
    this.autoHealInterval = setInterval(() => {
      if (!this.isConnected && !this.isChecking) {
        this.checkHttpConnection();
      }
    }, 2500);
  }

  public getBaseUrl(): string {
    return BASE_URL;
  }

  public getWsUrl(): string {
    return WS_URL;
  }

  public async checkHttpConnection(): Promise<boolean> {
    if (this.isChecking) return this.isConnected;
    this.isChecking = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${BASE_URL}/api/status`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);

      const ok = res.ok;
      if (ok !== this.isConnected) {
        this.isConnected = ok;
        this.emit('connection:change', ok);
        if (ok && (!this.ws || this.ws.readyState === WebSocket.CLOSED)) {
          this.connectWs();
        }
      }
      return ok;
    } catch {
      if (this.isConnected) {
        this.isConnected = false;
        this.emit('connection:change', false);
      }
      return false;
    } finally {
      this.isChecking = false;
    }
  }

  // 立即重试连接（供用户点击与快速恢复链路调用）
  public async retryConnection(): Promise<boolean> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ok = await this.checkHttpConnection();
    if (isDev) {
      console.log(`[UI:API] 手动触发重试探活结果: ${ok ? '成功' : '失败'}`);
    }
    if (ok) {
      this.connectWs();
    }
    return ok;
  }

  // 一键重启后台调度引擎（桌面原生调用 IPC，浏览器模式友好提示）
  public async restartCoreServer(): Promise<{ success: boolean; port?: string; message?: string }> {
    if (isDev) {
      console.log('[UI:API] 触发重启核心调度服务');
    }
    if (window.electronAPI?.restartCoreServer) {
      try {
        const res = await window.electronAPI.restartCoreServer();
        // 重启完成后主动立即探活更新状态
        await this.retryConnection();
        return res;
      } catch (err: any) {
        return { success: false, message: err?.message || '重启调用失败' };
      }
    }

    // 浏览器 Web 模式：尝试探活
    const ok = await this.retryConnection();
    return {
      success: ok,
      message: ok ? '核心服务已恢复就绪' : 'Web 模式请在终端运行 pnpm run service:restart 重启服务',
    };
  }

  private connectWs() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        if (!this.isConnected) {
          this.isConnected = true;
          this.emit('connection:change', true);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type) {
            this.emit(payload.type, payload.data);
          }
        } catch {
          // ignore
        }
      };

      this.ws.onclose = () => {
        if (this.isConnected) {
          this.isConnected = false;
          this.emit('connection:change', false);
        }
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        // 动态退避重连（2 秒）
        this.reconnectTimer = setTimeout(() => this.connectWs(), 2000);
      };

      this.ws.onerror = () => {
        this.isConnected = false;
      };
    } catch {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connectWs(), 2000);
    }
  }

  public on(event: string, callback: (data: any) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  /** 客户端上行消息：WebSocket 保证到达顺序，用于对顺序敏感的指令（如终端按键） */
  private sendWs(type: string, data: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, data }));
    return true;
  }

  // 连接状态订阅：注册即回推当前快照（电平信号），避免初始化阶段早于订阅的状态变更丢失
  public onConnectionChange(callback: (connected: boolean) => void): () => void {
    const off = this.on('connection:change', callback);
    if (isDev) {
      console.log(`[UI:API] 订阅连接状态，当前快照: ${this.isConnected ? '已连接' : '未连接'}`);
    }
    callback(this.isConnected);
    return off;
  }

  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // Workflows
  async getWorkflows(): Promise<WorkflowDefinition[]> {
    return requestJson<WorkflowDefinition[]>(`${BASE_URL}/api/workflows`);
  }

  async saveWorkflow(wf: WorkflowDefinition): Promise<WorkflowDefinition> {
    return requestJson<WorkflowDefinition>(`${BASE_URL}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wf),
    });
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const data = await requestJson<{ success: boolean }>(`${BASE_URL}/api/workflows/${id}`, { method: 'DELETE' });
    return data.success;
  }

  // Workflow Copilot (AI 协助与零手动编排)
  async getWorkflowSession(workflowId: string): Promise<WorkflowSessionState> {
    return requestJson<WorkflowSessionState>(`${BASE_URL}/api/workflows/${workflowId}/session`);
  }

  async sendWorkflowChatMessage(
    workflowId: string,
    message: string,
    snapshot?: { nodes?: any[]; edges?: any[]; name?: string; focusNodeId?: string }
  ): Promise<{ success: boolean }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:WorkflowCopilot] 发送流程编排指令 (${workflowId}${snapshot?.focusNodeId ? `, 聚焦: ${snapshot.focusNodeId}` : ''}):`, message.slice(0, 40));
    }
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/workflows/${workflowId}/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, snapshot }),
    });
  }

  async resetWorkflowSession(workflowId: string): Promise<{ success: boolean }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:WorkflowCopilot] 请求重置编排助手会话 (${workflowId})`);
    }
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/workflows/${workflowId}/session/reset`, {
      method: 'POST',
    });
  }

  // Tasks
  async getTasks(): Promise<Task[]> {
    return requestJson<Task[]>(`${BASE_URL}/api/tasks`);
  }

  async getTask(id: string): Promise<Task> {
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}`);
  }

  async createTask(params: {
    title: string;
    workflowId: string;
    description?: string;
    acceptanceCriteria?: string;
    qaInstructions?: string[];
    context?: Record<string, any>;
    autoRun?: boolean;
    kanbanColumn?: KanbanColumn;
    workspace?: string;
    attachments?: TaskAttachment[];
    triggerSource?: 'shortcut' | 'debug' | 'kanban' | 'api' | 'manual';
    kind?: 'single' | 'group' | 'subtask';
    parentTaskId?: string;
    subTaskIds?: string[];
    dependencies?: string[];
    executionMode?: 'serial' | 'parallel' | 'dag';
    concurrencyLimit?: number;
    subtasks?: Array<{ id?: string; title: string; workflowId?: string; description?: string; dependencies?: string[]; workspace?: string }>;
  }): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 创建新任务/任务组:', params);
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async addSubTask(
    parentId: string,
    params: {
      title: string;
      workflowId?: string;
      description?: string;
      dependencies?: string[];
      attachments?: TaskAttachment[];
      workspace?: string;
    }
  ): Promise<{ success: boolean; subtask: Task; parent: Task }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 为任务组 [${parentId}] 添加子任务:`, params);
    }
    return requestJson<{ success: boolean; subtask: Task; parent: Task }>(`${BASE_URL}/api/tasks/${parentId}/subtasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async batchAddSubTasks(
    parentId: string,
    params: {
      subtasks: Array<{
        id?: string;
        title: string;
        workflowId?: string;
        description?: string;
        dependencies?: string[];
        attachments?: TaskAttachment[];
        workspace?: string;
      }>;
      executionMode?: 'serial' | 'parallel' | 'dag';
      concurrencyLimit?: number;
    }
  ): Promise<{ success: boolean; subtasks: Task[]; parent: Task }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 为任务组 [${parentId}] 批量追加子工序:`, params);
    }
    return requestJson<{ success: boolean; subtasks: Task[]; parent: Task }>(
      `${BASE_URL}/api/tasks/${parentId}/subtasks/batch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }
    );
  }

  async planSubtasks(taskId: string): Promise<{
    success: boolean;
    plan: {
      shouldDecompose: boolean;
      reason?: string;
      executionMode?: 'serial' | 'parallel' | 'dag';
      concurrencyLimit?: number;
      subtasks?: Array<{
        title: string;
        workflowId?: string;
        dependencies?: string[];
      }>;
    };
  }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 请求 AI 规划任务 [${taskId}] 的工序方案`);
    }
    return requestJson<{ success: boolean; plan: any }>(
      `${BASE_URL}/api/tasks/${taskId}/plan-subtasks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  async deleteSubTask(
    parentId: string,
    subId: string
  ): Promise<{ success: boolean; parent: Task }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 从任务组 [${parentId}] 移除子工序 [${subId}]`);
    }
    return requestJson<{ success: boolean; parent: Task }>(
      `${BASE_URL}/api/tasks/${parentId}/subtasks/${subId}`,
      {
        method: 'DELETE',
      }
    );
  }

  async unlinkSubTask(
    parentId: string,
    subId: string
  ): Promise<{ success: boolean; parent: Task; subtask: Task }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 从任务组 [${parentId}] 解绑子工序 [${subId}] 恢复为独立任务`);
    }
    return requestJson<{ success: boolean; parent: Task; subtask: Task }>(
      `${BASE_URL}/api/tasks/${parentId}/subtasks/${subId}/unlink`,
      {
        method: 'POST',
      }
    );
  }

  async setTaskParent(
    taskId: string,
    parentTaskId: string | null
  ): Promise<{ success: boolean; task: Task; parent?: Task; previousParent?: Task }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 设置任务 [${taskId}] 的父任务归属:`, parentTaskId);
    }
    return requestJson<{ success: boolean; task: Task; parent?: Task; previousParent?: Task }>(
      `${BASE_URL}/api/tasks/${taskId}/parent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentTaskId }),
      }
    );
  }

  async linkSubtasks(
    parentId: string,
    subTaskIds: string[]
  ): Promise<{ success: boolean; parent: Task; linkedTasks: Task[] }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 批量为任务组 [${parentId}] 关联已有子工序:`, subTaskIds);
    }
    return requestJson<{ success: boolean; parent: Task; linkedTasks: Task[] }>(
      `${BASE_URL}/api/tasks/${parentId}/link-subtasks`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subTaskIds }),
      }
    );
  }

  async recommendWorkflow(params: { title: string; description?: string; workspace?: string }): Promise<{
    success: boolean;
    recommendations: Array<{
      workflowId: string;
      workflowName: string;
      score: number;
      reason: string;
      matchHighlights: string[];
    }>;
    topRecommendation: {
      workflowId: string;
      workflowName: string;
      score: number;
      reason: string;
      matchHighlights: string[];
    } | null;
  }> {
    return requestJson(`${BASE_URL}/api/recommend-workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async runTask(id: string): Promise<void> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 触发任务启动:', id);
    }
    await requestJson(`${BASE_URL}/api/tasks/${id}/run`, { method: 'POST' });
  }

  async cancelTask(id: string): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 请求终止任务:', id);
    }
    const res = await requestJson<{ success: boolean; task: Task }>(`${BASE_URL}/api/tasks/${id}/cancel`, {
      method: 'POST',
    });
    return res.task;
  }

  async updateTask(
    id: string,
    params: {
      title?: string;
      description?: string;
      workflowId?: string;
      acceptanceCriteria?: string;
      qaInstructions?: string[];
      context?: Record<string, any>;
      kanbanColumn?: KanbanColumn;
      workspace?: string;
      attachments?: TaskAttachment[];
      triggerSource?: 'shortcut' | 'debug' | 'kanban' | 'api' | 'manual';
    }
  ): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 更新任务 [${id}]:`, params);
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async moveTaskColumn(id: string, column: KanbanColumn): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 流转任务 [${id}] 至泳道: ${column}`);
    }
    return this.updateTask(id, { kanbanColumn: column });
  }

  async deleteTask(id: string): Promise<{ success: boolean; id: string }> {
    return requestJson<{ success: boolean; id: string }>(`${BASE_URL}/api/tasks/${id}`, {
      method: 'DELETE',
    });
  }

  /**
   * 上传图片附件 (零内存消耗流式写入核心服务并落盘)
   */
  async uploadAttachment(file: File): Promise<TaskAttachment> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 正在上传图片附件:', { name: file.name, size: file.size, type: file.type });
    }
    const query = `filename=${encodeURIComponent(file.name)}`;
    const res = await fetch(`${BASE_URL}/api/attachments?${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'image/png',
      },
      body: file,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`上传失败 (${res.status}): ${errText || res.statusText}`);
    }
    const attachment: TaskAttachment = await res.json();
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 图片附件上传成功:', attachment);
    }
    return attachment;
  }

  /**
   * 删除指定的附件文件
   */
  async deleteAttachment(filenameOrId: string): Promise<boolean> {
    if (import.meta.env?.DEV) {
      console.log('[UI:API] 请求删除图片附件:', filenameOrId);
    }
    const filename = filenameOrId.startsWith('/api/attachments/')
      ? filenameOrId.replace('/api/attachments/', '')
      : filenameOrId;
    const res = await fetch(`${BASE_URL}/api/attachments/${filename}`, {
      method: 'DELETE',
    });
    return res.ok;
  }

  /**
   * 将附件的相对/绝对路径解析为可渲染的完整 HTTP URL
   */
  getAttachmentUrl(pathOrUrl: string): string {
    if (!pathOrUrl) return '';
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('blob:')) {
      return pathOrUrl;
    }
    if (pathOrUrl.includes('artifacts/')) {
      return this.getArtifactUrl(pathOrUrl);
    }
    if (pathOrUrl.startsWith('/api/')) {
      return `${BASE_URL}${pathOrUrl}`;
    }
    return `${BASE_URL}/api/attachments/${pathOrUrl}`;
  }

  async resumeTask(id: string, approved: boolean, feedback?: string): Promise<Task> {
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved, feedback }),
    });
  }

  async skipNode(id: string, nodeId?: string): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 请求跳过任务 [${id}] 的节点:`, nodeId || '自动判定');
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/skip-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
  }

  async completeNode(id: string, nodeId?: string): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 请求确认任务 [${id}] 的节点已完成:`, nodeId || '自动判定');
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/complete-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
  }

  async retryNode(id: string, nodeId?: string): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 请求单独重试任务 [${id}] 的节点:`, nodeId || '自动判定');
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/retry-node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    });
  }

  async customRetryTask(id: string, payload: { selectedNodeIds: string[]; fromNodeId?: string }): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 请求流水线定制重试任务 [${id}]:`, payload);
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/custom-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // 任务级节点覆盖：只改本任务执行时的节点配置/参数，流水线模板不受影响
  async setTaskNodeOverride(
    id: string,
    payload: {
      nodeId: string;
      params?: Record<string, string> | null;
      config?: Record<string, any> | null;
      reset?: boolean;
    }
  ): Promise<Task> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 更新任务级节点覆盖 [${id}]:`, payload);
    }
    return requestJson<Task>(`${BASE_URL}/api/tasks/${id}/node-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async getTaskSandboxStatus(id: string): Promise<{ status: 'running' | 'stopped' | 'none'; port?: number; targetUrl?: string }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 探测任务 [${id}] 沙箱靶机状态`);
    }
    return requestJson<{ status: 'running' | 'stopped' | 'none'; port?: number; targetUrl?: string }>(
      `${BASE_URL}/api/tasks/${id}/sandbox/status`
    );
  }

  async getTaskWorktreeDiff(id: string): Promise<TaskWorktreeDiffResult> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 获取任务 [${id}] 的完整代码 Diff 与变更统计`);
    }
    return requestJson<TaskWorktreeDiffResult>(`${BASE_URL}/api/tasks/${id}/diff`);
  }

  async startTaskSandbox(id: string): Promise<{ success: boolean; status: string; port?: number; targetUrl?: string; message?: string }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 启动/唤醒任务 [${id}] 沙箱靶机服务`);
    }
    return requestJson<{ success: boolean; status: string; port?: number; targetUrl?: string; message?: string }>(
      `${BASE_URL}/api/tasks/${id}/sandbox/start`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  async stopTaskSandbox(id: string): Promise<{ success: boolean; status: string }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 关停任务 [${id}] 沙箱靶机服务`);
    }
    return requestJson<{ success: boolean; status: string }>(
      `${BASE_URL}/api/tasks/${id}/sandbox/stop`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  async cleanupAllSandboxes(): Promise<{ success: boolean; message: string }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 全局清空所有任务的沙箱靶机服务与端口占用`);
    }
    return requestJson<{ success: boolean; message: string }>(
      `${BASE_URL}/api/sandbox/cleanup-all`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  async getTaskLogs(id: string): Promise<LogEntry[]> {
    return requestJson<LogEntry[]>(`${BASE_URL}/api/tasks/${id}/logs`);
  }

  async getGlobalLogs(limit = 2000): Promise<LogEntry[]> {
    return requestJson<LogEntry[]>(`${BASE_URL}/api/logs?limit=${limit}`);
  }

  // Plugins
  async getPlugins(): Promise<PluginManifest[]> {
    return requestJson<PluginManifest[]>(`${BASE_URL}/api/plugins`);
  }

  async registerPlugin(plugin: PluginManifest): Promise<PluginManifest> {
    return requestJson<PluginManifest>(`${BASE_URL}/api/plugins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plugin),
    });
  }

  async deletePlugin(id: string): Promise<{ success: boolean; id: string }> {
    return requestJson<{ success: boolean; id: string }>(`${BASE_URL}/api/plugins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // Settings
  async getSettings(): Promise<OpenLoopSettings> {
    return requestJson<OpenLoopSettings>(`${BASE_URL}/api/settings`);
  }

  /** 会话进程可装载的 pi 扩展：已启用名单 + 本机已安装清单 */
  async getPiExtensions(): Promise<{
    enabled: string[];
    defaults: string[];
    installed: Array<{ name: string; version?: string; description?: string }>;
  }> {
    return requestJson(`${BASE_URL}/api/settings/pi-extensions`);
  }

  async updateSettings(
    settings: Partial<OpenLoopSettings>
  ): Promise<OpenLoopSettings & { runtime?: RuntimeSettingsApplySummary }> {
    return requestJson<OpenLoopSettings & { runtime?: RuntimeSettingsApplySummary }>(`${BASE_URL}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  }

  // Resume task session in terminal
  async resumeTerminal(taskId: string): Promise<{ success: boolean; command: string; sessionId: string }> {
    return requestJson<{ success: boolean; command: string; sessionId: string }>(`${BASE_URL}/api/tasks/${taskId}/resume-terminal`, {
      method: 'POST',
    });
  }

  // Agent RPC Session & Chat
  async getTaskSession(taskId: string): Promise<TaskSessionState> {
    return requestJson<TaskSessionState>(`${BASE_URL}/api/tasks/${taskId}/session`);
  }

  async sendTaskChatMessage(
    taskId: string,
    message: string,
    attachments?: TaskAttachment[],
    options?: { includeQaArtifacts?: boolean; selectedQaArtifacts?: SelectedQaArtifacts }
  ): Promise<any> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 发送任务会话消息 (${taskId}):`, {
        message: message ? message.slice(0, 40) : '',
        attachmentsCount: attachments?.length || 0,
        includeQaArtifacts: !!options?.includeQaArtifacts,
        hasSelectedQaArtifacts: !!options?.selectedQaArtifacts,
      });
    }
    return requestJson<any>(`${BASE_URL}/api/tasks/${taskId}/session/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        attachments,
        includeQaArtifacts: options?.includeQaArtifacts ?? false,
        selectedQaArtifacts: options?.selectedQaArtifacts,
      }),
    });
  }

  async pauseTaskSession(taskId: string): Promise<{ success: boolean }> {
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/tasks/${taskId}/session/pause`, {
      method: 'POST',
    });
  }

  async resumeTaskSession(taskId: string): Promise<{ success: boolean }> {
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/tasks/${taskId}/session/resume`, {
      method: 'POST',
    });
  }

  /** 撤回一条还没被采纳的用户输入（排队中的插话） */
  async withdrawTaskPending(taskId: string, pendingId: string): Promise<{ success: boolean }> {
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/tasks/${taskId}/session/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingId }),
    });
  }

  async respondTaskUiRequest(
    taskId: string,
    payload: { id: string; value?: string; confirmed?: boolean; cancelled?: boolean }
  ): Promise<{ success: boolean }> {
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/tasks/${taskId}/session/ui-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async regenerateTaskSession(taskId: string): Promise<TaskSessionState> {
    return requestJson<TaskSessionState>(`${BASE_URL}/api/tasks/${taskId}/session/regenerate`, {
      method: 'POST',
    });
  }

  // 全局 Agent 会话（不绑定任务）：pi 会话浏览 + 直接对话
  async getAgentSessions(params?: { cwd?: string; limit?: number }): Promise<{
    root: string;
    total: number;
    sessions: Array<{
      id: string;
      path: string;
      cwd: string;
      createdAt: string;
      modifiedAt: string;
      messageCount: number;
      firstUserMessage: string;
      lastModel?: string;
      /** openLoop 侧元数据：标题覆盖 / 归档 / 置顶 / 所属工作区标题 */
      title?: string;
      archived?: boolean;
      pinned?: boolean;
      projectTitle?: string;
      projectHidden?: boolean;
      projectOrder?: number;
    }>;
  }> {
    const search = new URLSearchParams();
    if (params?.cwd) search.set('cwd', params.cwd);
    if (params?.limit) search.set('limit', String(params.limit));
    const qs = search.toString() ? `?${search.toString()}` : '';
    return requestJson(`${BASE_URL}/api/agent/sessions${qs}`);
  }

  /** 会话全文搜索：返回命中会话与上下文片段 */
  async searchAgentSessions(query: string, limit = 20): Promise<{
    query: string;
    results: Array<{
      id: string;
      path: string;
      cwd: string;
      modifiedAt: string;
      snippet: string;
      matches: number;
    }>;
  }> {
    const qs = new URLSearchParams({ q: query, limit: String(limit) });
    return requestJson(`${BASE_URL}/api/agent/sessions/search?${qs.toString()}`);
  }

  async getAgentSession(sessionId: string, limit?: number): Promise<{
    summary: any;
    messages: SessionChatMessage[];
    leafEntryId?: string;
    model?: string;
  }> {
    const qs = limit ? `?limit=${limit}` : '';
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}${qs}`);
  }

  async getLiveAgentSessions(): Promise<{ sessions: string[]; busy: string[] }> {
    return requestJson(`${BASE_URL}/api/agent/live`);
  }

  async getLiveAgentSessionState(sessionId: string): Promise<{ state: TaskSessionState | null }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/live`);
  }

  async openAgentSession(
    sessionId: string,
    options?: { cwd?: string; model?: string; thinking?: string; permission?: 'full' | 'readonly' | 'noshell' }
  ): Promise<{ sessionId: string; state: TaskSessionState; created: boolean }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options || {}),
    });
  }

  async sendAgentSessionMessage(
    sessionId: string,
    message: string,
    options?: {
      cwd?: string;
      model?: string;
      thinking?: string;
      attachments?: TaskAttachment[];
      permission?: 'full' | 'readonly' | 'noshell';
    }
  ): Promise<TaskSessionState> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 发送全局 Agent 会话消息 (${sessionId}):`, message.slice(0, 40));
    }
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, ...(options || {}) }),
    });
  }

  async pauseAgentSession(sessionId: string): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/pause`, {
      method: 'POST',
    });
  }

  async resumeAgentSession(sessionId: string): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/resume`, {
      method: 'POST',
    });
  }

  async stopAgentSession(sessionId: string): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
    });
  }

  /** 撤回一条排队中的输入（尚未被 Agent 采纳） */
  async withdrawAgentPending(sessionId: string, pendingId: string): Promise<{ success: boolean }> {
    if (import.meta.env?.DEV) console.log('[UI:API] 撤回排队输入:', { sessionId, pendingId });
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingId }),
    });
  }

  // ---- 会话元数据：重命名 / 归档 / 删除 ----

  async setAgentSessionMeta(
    sessionId: string,
    patch: { title?: string; archived?: boolean; pinned?: boolean }
  ): Promise<{ sessionId: string; meta: any }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  async deleteAgentSession(
    sessionId: string,
    purge = false
  ): Promise<{ success: boolean; purged: boolean; target?: string }> {
    const qs = purge ? '?purge=1' : '';
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}${qs}`, {
      method: 'DELETE',
    });
  }

  async setAgentProjectMeta(
    cwd: string,
    patch: { title?: string; hidden?: boolean; pinned?: boolean; order?: number }
  ): Promise<{ cwd: string; meta: any }> {
    return requestJson(`${BASE_URL}/api/agent/projects`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, ...patch }),
    });
  }

  async getAgentProjects(): Promise<{ projects: Record<string, any> }> {
    return requestJson(`${BASE_URL}/api/agent/projects`);
  }

  async respondAgentUiRequest(
    sessionId: string,
    payload: { id: string; value?: string; confirmed?: boolean; cancelled?: boolean }
  ): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/ui-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async getAgentSessionModels(sessionId: string): Promise<{ models: Array<{ id: string; provider: string }> }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/models`);
  }

  // ---- 模型 / 权限 / 重发 ----

  async setAgentSessionModel(
    sessionId: string,
    model?: string,
    thinking?: string
  ): Promise<{ applied: boolean; queued: boolean }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, thinking }),
    });
  }

  async setAgentSessionPermission(
    sessionId: string,
    preset: 'full' | 'readonly' | 'noshell'
  ): Promise<{ applied: boolean; restarted: boolean; settings: any }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset }),
    });
  }

  async regenerateAgentSession(sessionId: string): Promise<TaskSessionState> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/regenerate`, {
      method: 'POST',
    });
  }

  /** 从某条消息分叉出新会话（新会话保留到这条为止，标题带序号） */
  async forkAgentSession(
    sessionId: string,
    entryId: string
  ): Promise<{ sessionId: string; cwd: string; title?: string; cancelled?: boolean }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/fork`, {
      method: 'POST',
      body: JSON.stringify({ entryId }),
    });
  }

  /** 会话树：节点 + 当前活动分支 */
  async getAgentSessionTree(sessionId: string): Promise<SessionTreeSnapshot> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/tree`);
  }

  /** 在同一个会话文件内切到某条历史条目 */
  async navigateAgentSessionTree(
    sessionId: string,
    entryId: string
  ): Promise<{ sessionId: string; leafEntryId: string | null }> {
    return requestJson(`${BASE_URL}/api/agent/sessions/${encodeURIComponent(sessionId)}/navigate`, {
      method: 'POST',
      body: JSON.stringify({ entryId }),
    });
  }

  // ---- 文件浏览 / 预览 ----
  async listAgentFs(path: string): Promise<{
    path: string;
    parent: string | null;
    entries: Array<{ name: string; path: string; isDir: boolean; size: number; mtime: number }>;
  }> {
    return requestJson(`${BASE_URL}/api/agent/fs/list?path=${encodeURIComponent(path)}`);
  }

  /** @ 引用候选：工作区路径模糊排序，带 / 的查询直列该层目录 */
  async searchAgentFs(
    path: string,
    query: string
  ): Promise<{ entries: Array<{ path: string; isDir: boolean }> }> {
    return requestJson(
      `${BASE_URL}/api/agent/fs/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(query)}`
    );
  }

  /** 在浏览面板里新建子目录 */
  async createAgentFsDir(parent: string, name: string): Promise<{ path: string }> {
    return requestJson(`${BASE_URL}/api/agent/fs/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent, name }),
    });
  }

  async readAgentFsFile(path: string, base?: string): Promise<{
    path: string;
    content: string;
    size: number;
    truncated: boolean;
  }> {
    return requestJson(`${BASE_URL}/api/agent/fs/read?${fsQuery(path, base)}`);
  }

  /** 只取文件 stat：用来判断会话文件是否被外部写入 */
  async statAgentFs(path: string): Promise<{
    path: string;
    size: number;
    mtime: number;
    mime: string;
  }> {
    return requestJson(`${BASE_URL}/api/agent/fs/stat?path=${encodeURIComponent(path)}`);
  }

  /** 轮内改动的两侧原文：工作台 diff 页签用 changeId 取 */
  async getAgentChangeDiff(changeId: string): Promise<{
    path: string;
    kind: 'text' | 'binary' | 'oversized';
    before: string | null;
    after: string | null;
  }> {
    return requestJson(`${BASE_URL}/api/agent/changes/diff?changeId=${encodeURIComponent(changeId)}`);
  }

  agentFsRawUrl(path: string, base?: string): string {
    return `${BASE_URL}/api/agent/fs/raw?${fsQuery(path, base)}`;
  }

  // ---- 终端 ----

  /** 打开一个 PTY 终端：首次挂载时把格子尺寸一起带上，避免先出 80x24 再重排 */
  async openTerminal(cwd?: string, cols?: number, rows?: number): Promise<{
    id: string;
    cwd: string;
    replay: string;
  }> {
    if (import.meta.env?.DEV) console.log('[UI:API] 打开终端', { cwd, cols, rows });
    return requestJson(`${BASE_URL}/api/agent/terminal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, cols, rows }),
    });
  }

  /**
   * 终端按键 / 终端查询应答：走 WebSocket 而不是逐条 POST。
   * 一条通道天然有序，TUI 程序（lazygit、yazi 等）收到的转义序列不会被打乱。
   */
  writeTerminal(id: string, data: string): boolean {
    const sent = this.sendWs('terminal:input', { id, data });
    if (!sent && import.meta.env?.DEV) {
      console.warn('[UI:API] 终端输入通道未就绪，丢弃按键', { id, bytes: data.length });
    }
    return sent;
  }

  /** 同步 PTY 窗口大小：面板拖宽或窗口缩放后调用 */
  async resizeTerminal(id: string, cols: number, rows: number): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/agent/terminal/${encodeURIComponent(id)}/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows }),
    });
  }

  async closeTerminal(id: string): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/agent/terminal/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async clearTaskSession(taskId: string): Promise<{ success: boolean }> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:API] 请求清空任务 [${taskId}] 的 Agent 会话消息`);
    }
    return requestJson<{ success: boolean }>(`${BASE_URL}/api/tasks/${taskId}/session/clear`, {
      method: 'POST',
    });
  }

  async getTaskWorkspaceFiles(
    taskId: string,
    query?: string,
    limit?: number
  ): Promise<{ files: string[]; workspace: string; total: number; matched: number }> {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return requestJson<{ files: string[]; workspace: string; total: number; matched: number }>(
      `${BASE_URL}/api/tasks/${taskId}/files${qs}`
    );
  }

  async getAgentCommandsAndSkills(
    taskId?: string
  ): Promise<{
    commands: Array<{
      name: string;
      label: string;
      description: string;
      type: 'command';
      template?: string;
      action?: 'clear' | 'pause' | 'resume';
    }>;
    skills: Array<{
      name: string;
      label: string;
      description: string;
      type: 'skill';
      path: string;
      template: string;
    }>;
  }> {
    const url = taskId
      ? `${BASE_URL}/api/tasks/${taskId}/agent/commands-and-skills`
      : `${BASE_URL}/api/agent/commands-and-skills`;
    return requestJson<{ commands: any[]; skills: any[] }>(url);
  }

  // System Dialog & File Manager
  /**
   * 调起系统原生文件管理器（访达/资源管理器）进行目录选择
   * 优先走 Electron IPC，极速且原生；独立 Web 调试时自动回退至 Core Server 系统调用
   */
  async selectDirectory(options?: { defaultPath?: string }): Promise<string | null> {
    if (import.meta.env?.DEV) {
      console.log('[UI:System] 请求打开系统原生文件管理器选择工作区目录...', options);
    }

    if (window.electronAPI?.openDirectory) {
      try {
        const dir = await window.electronAPI.openDirectory(options);
        if (import.meta.env?.DEV) {
          console.log('[UI:System] Electron 原生访达目录选择返回:', dir);
        }
        return dir || null;
      } catch (err) {
        if (import.meta.env?.DEV) {
          console.warn('[UI:System] Electron 目录选择调用失败，尝试回退:', err);
        }
      }
    }

    // Web Fallback: 调用本地 Core Server 提供的系统对话框接口
    try {
      const res = await requestJson<{ canceled: boolean; path?: string }>(
        `${BASE_URL}/api/system/select-directory`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options || {}),
        }
      );
      if (import.meta.env?.DEV) {
        console.log('[UI:System] Core 服务端目录选择返回:', res);
      }
      return res.canceled ? null : res.path || null;
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[UI:System] 唤起系统目录选择失败:', err);
      }
      return null;
    }
  }

  /**
   * 在系统原生文件管理器（访达 Finder / 资源管理器 Explorer）中打开并定位目录
   */
  async openPath(dirPath: string): Promise<boolean> {
    if (!dirPath) return false;
    if (import.meta.env?.DEV) {
      console.log(`[UI:System] 请求在访达中打开目录: ${dirPath}`);
    }

    if (window.electronAPI?.openPath) {
      try {
        return await window.electronAPI.openPath(dirPath);
      } catch (err) {
        if (import.meta.env?.DEV) {
          console.warn('[UI:System] Electron openPath 调用失败，尝试服务端回退:', err);
        }
      }
    }

    try {
      const res = await requestJson<{ success: boolean }>(`${BASE_URL}/api/system/open-path`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      return !!res.success;
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[UI:System] 服务端打开系统目录失败:', err);
      }
      return false;
    }
  }

  /**
   * 本机可用的「打开方式」应用（访达 / 编辑器 / 终端），含内联图标
   */
  async getOpenInAppTargets(): Promise<OpenInAppTarget[]> {
    if (import.meta.env?.DEV) {
      console.log('[UI:System] 拉取本机「打开方式」应用表');
    }
    try {
      const res = await requestJson<{ targets: OpenInAppTarget[] }>(`${BASE_URL}/api/system/open-targets`);
      return Array.isArray(res?.targets) ? res.targets : [];
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[UI:System] 拉取本机应用表失败:', err);
      }
      return [];
    }
  }

  /**
   * 用指定应用打开工作区目录
   */
  async openInApp(app: string, dirPath: string): Promise<boolean> {
    if (import.meta.env?.DEV) {
      console.log(`[UI:System] 用 ${app} 打开目录: ${dirPath}`);
    }
    try {
      const res = await requestJson<{ success: boolean }>(`${BASE_URL}/api/system/open-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app, path: dirPath }),
      });
      return !!res.success;
    } catch (err) {
      if (import.meta.env?.DEV) {
        console.error('[UI:System] 打开目录失败:', err);
      }
      return false;
    }
  }

  // ================= QA Automation Midscene API =================

  async getQaSuites(): Promise<QaSuite[]> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 拉取 QA 自动化测试用例清单');
    }
    return requestJson<QaSuite[]>(`${BASE_URL}/api/qa/suites`);
  }

  async getQaSuiteById(id: string): Promise<QaSuite | null> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 获取测试套件详情:', id);
    }
    return requestJson<QaSuite>(`${BASE_URL}/api/qa/suites/${encodeURIComponent(id)}`);
  }

  async saveQaSuite(suite: Partial<QaSuite>): Promise<QaSuite> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 保存测试套件:', suite);
    }
    return requestJson<QaSuite>(`${BASE_URL}/api/qa/suites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(suite),
    });
  }

  async deleteQaSuite(id: string): Promise<boolean> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 删除测试套件:', id);
    }
    const res = await requestJson<{ success: boolean }>(`${BASE_URL}/api/qa/suites/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return !!res.success;
  }

  async runQaSuite(payload: { suiteId: string; targetUrl?: string; ownerId?: string }): Promise<QaRunRecord> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 发起 Midscene 测试执行:', payload);
    }
    return requestJson<QaRunRecord>(`${BASE_URL}/api/qa/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async getQaRuns(suiteId?: string, taskId?: string): Promise<QaRunRecord[]> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 获取 QA 运行记录列表, suiteId:', suiteId, 'taskId:', taskId);
    }
    const params = new URLSearchParams();
    if (suiteId) params.append('suiteId', suiteId);
    if (taskId) params.append('taskId', taskId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return requestJson<QaRunRecord[]>(`${BASE_URL}/api/qa/runs${query}`);
  }

  async getQaRunById(id: string): Promise<QaRunRecord | null> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 获取 QA 运行详情:', id);
    }
    return requestJson<QaRunRecord>(`${BASE_URL}/api/qa/runs/${encodeURIComponent(id)}`);
  }

  async deleteQaRun(id: string): Promise<boolean> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 删除 QA 运行记录与磁盘截图产物:', id);
    }
    const res = await requestJson<{ success: boolean }>(`${BASE_URL}/api/qa/runs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return Boolean(res?.success);
  }

  async getAndroidDevices(): Promise<AndroidDeviceInfo[]> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 拉取 Android 在线设备与模拟器列表');
    }
    return requestJson<AndroidDeviceInfo[]>(`${BASE_URL}/api/qa/devices/android`);
  }

  async openAndroidMirror(serial?: string): Promise<{ success: boolean; message: string }> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 打开 Android 设备镜像窗口:', serial || '首个在线设备');
    }
    return requestJson<{ success: boolean; message: string }>(`${BASE_URL}/api/qa/devices/android/mirror`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial }),
    });
  }

  async getAndroidCurrentApp(serial?: string): Promise<{ packageName: string; activityName?: string }> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 获取 Android 设备前台应用:', serial);
    }
    const query = serial ? `?serial=${encodeURIComponent(serial)}` : '';
    return requestJson<{ packageName: string; activityName?: string }>(`${BASE_URL}/api/qa/devices/android/current-app${query}`);
  }

  async connectAndroidWifi(address: string): Promise<{ success: boolean; message: string }> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 连接 WiFi ADB 设备:', address);
    }
    return requestJson<{ success: boolean; message: string }>(`${BASE_URL}/api/qa/devices/android/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
  }

  async disconnectAndroidWifi(address: string): Promise<{ success: boolean; message: string }> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 断开 WiFi ADB 设备:', address);
    }
    return requestJson<{ success: boolean; message: string }>(`${BASE_URL}/api/qa/devices/android/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
  }

  async getIosDevices(endpoint?: string): Promise<IosDevicesSnapshot> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 拉取 iOS 模拟器与 WebDriverAgent 状态:', endpoint || '默认端点');
    }
    const query = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : '';
    return requestJson<IosDevicesSnapshot>(`${BASE_URL}/api/qa/devices/ios${query}`);
  }

  async getDeviceLeases(): Promise<DeviceLeaseSnapshot[]> {
    const data = await requestJson<{ leases: DeviceLeaseSnapshot[] }>(`${BASE_URL}/api/qa/device-leases`);
    return data.leases || [];
  }

  async clearQaRuns(params?: { suiteId?: string; olderThanDays?: number; keepLatestPerSuite?: number; runIds?: string[] }): Promise<{ deletedCount: number }> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 批量清理 QA 运行记录:', params);
    }
    const res = await requestJson<{ success: boolean; deletedCount: number }>(`${BASE_URL}/api/qa/runs`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
    return { deletedCount: res?.deletedCount || 0 };
  }

  async generateQaPlan(payload: { title: string; description?: string; workspace?: string }): Promise<{ success: boolean; steps: string[]; text: string; fallback?: boolean }> {
    if (import.meta.env?.DEV) {
      console.log('[UI:QA] 请求 AI 规划验收用例:', payload);
    }
    return requestJson<{ success: boolean; steps: string[]; text: string; fallback?: boolean }>(`${BASE_URL}/api/qa/generate-plan`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getArtifactUrl(pathOrUrl: string): string {
    if (!pathOrUrl) return '';
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('blob:')) {
      return pathOrUrl;
    }
    // 智能提取 /artifacts/ 相对路径，兼顾绝对磁盘路径与相对静态资源路径
    let clean = pathOrUrl;
    const artIdx = clean.indexOf('artifacts/');
    if (artIdx !== -1) {
      clean = clean.slice(artIdx);
    }
    clean = clean.startsWith('/') ? clean : `/${clean}`;
    return `${BASE_URL}${clean}`;
  }

  // ===== 自动化任务 (Automation Tasks) =====

  async getAutomations(): Promise<AutomationTask[]> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Automation] 获取自动化任务列表');
    }
    const res = await requestJson<AutomationTask[]>(`${BASE_URL}/api/automations`);
    return Array.isArray(res) ? res : [];
  }

  async getAutomation(id: string): Promise<AutomationTask> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Automation] 获取自动化任务详情:', id);
    }
    return requestJson<AutomationTask>(`${BASE_URL}/api/automations/${encodeURIComponent(id)}`);
  }

  async saveAutomation(task: Partial<AutomationTask> & { name: string }): Promise<AutomationTask> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Automation] 保存自动化任务:', task);
    }
    return requestJson<AutomationTask>(`${BASE_URL}/api/automations`, {
      method: 'POST',
      body: JSON.stringify(task),
    });
  }

  async deleteAutomation(id: string): Promise<boolean> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Automation] 删除自动化任务:', id);
    }
    const res = await requestJson<{ success: boolean }>(`${BASE_URL}/api/automations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return Boolean(res?.success);
  }

  async toggleAutomation(id: string, enabled?: boolean): Promise<AutomationTask> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Automation] 切换自动化任务启停状态:', { id, enabled });
    }
    return requestJson<AutomationTask>(`${BASE_URL}/api/automations/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  async triggerAutomation(id: string): Promise<{ success: boolean; message: string; createdTaskId?: string }> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Automation] 手动触发自动化任务:', id);
    }
    return requestJson<{ success: boolean; message: string; createdTaskId?: string }>(
      `${BASE_URL}/api/automations/${encodeURIComponent(id)}/trigger`,
      { method: 'POST' }
    );
  }

  async getAutomationLogs(id?: string): Promise<AutomationLogRecord[]> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Automation] 获取自动化任务日志, id:', id);
    }
    const path = id ? `/api/automations/${encodeURIComponent(id)}/logs` : '/api/automations/all/logs';
    const res = await requestJson<AutomationLogRecord[]>(`${BASE_URL}${path}`);
    return Array.isArray(res) ? res : [];
  }

  async clearAutomationLogs(params?: { automationId?: string; olderThanDays?: number }): Promise<{ deletedCount: number }> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Automation] 清理自动化任务日志:', params);
    }
    const queryParts: string[] = [];
    if (params?.automationId) queryParts.push(`automationId=${encodeURIComponent(params.automationId)}`);
    if (params?.olderThanDays !== undefined) queryParts.push(`olderThanDays=${params.olderThanDays}`);
    const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    const res = await requestJson<{ success: boolean; deletedCount: number }>(`${BASE_URL}/api/automations/logs${query}`, {
      method: 'DELETE',
    });
    return { deletedCount: res?.deletedCount || 0 };
  }

  // ================= Storage & Maintenance API =================

  async getStorageStats(): Promise<StorageStats> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Storage] 拉取系统存储与数据分布统计');
    }
    return requestJson<StorageStats>(`${BASE_URL}/api/storage/stats`);
  }

  async cleanStorage(options: StorageCleanOptions): Promise<StorageCleanResult> {
    if (import.meta.env?.DEV) {
      console.log('[UI:Storage] 触发数据优化与垃圾清理:', options);
    }
    return requestJson<StorageCleanResult>(`${BASE_URL}/api/storage/clean`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

}

export const api = new DesktopApiService();
