import { SqliteStore } from './sqlite';
import { Task, WorkflowDefinition, LogEntry, PluginManifest, KanbanColumn, OpenLoopSettings, QaSuite, QaRunRecord } from '../types';

export { SqliteStore };

/**
 * openLoop 统一持久化存储管理器（已升级为 SQLite 底座，支持 WAL 高并发与平滑迁移）
 */
export class Store {
  private sqlite: SqliteStore;

  constructor(customDir?: string) {
    this.sqlite = new SqliteStore(customDir);
  }

  // Workflows
  public getWorkflows(): WorkflowDefinition[] {
    return this.sqlite.getWorkflows();
  }

  public getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.sqlite.getWorkflow(id);
  }

  public saveWorkflow(wf: WorkflowDefinition): WorkflowDefinition {
    return this.sqlite.saveWorkflow(wf);
  }

  public deleteWorkflow(id: string): boolean {
    return this.sqlite.deleteWorkflow(id);
  }

  public getDataDir(): string {
    return this.sqlite.getDataDir();
  }

  // Tasks
  public getTasks(): Task[] {
    return this.sqlite.getTasks();
  }

  public getTask(id: string): Task | undefined {
    return this.sqlite.getTask(id);
  }

  public saveTask(task: Task): Task {
    return this.sqlite.saveTask(task);
  }

  public updateTaskColumn(taskId: string, column: KanbanColumn): void {
    this.sqlite.updateTaskColumn(taskId, column);
  }

  public deleteTask(taskId: string): boolean {
    return this.sqlite.deleteTask(taskId);
  }

  // Logs
  public addLog(entry: LogEntry): void {
    this.sqlite.addLog(entry);
  }

  public getLogs(taskId?: string, nodeId?: string, limit?: number): LogEntry[] {
    return this.sqlite.getLogs(taskId, nodeId, limit);
  }

  public clearLogs(taskId?: string): void {
    this.sqlite.clearLogs(taskId);
  }

  // Plugins
  public getPlugins(): PluginManifest[] {
    return this.sqlite.getPlugins();
  }

  public registerPlugin(plugin: PluginManifest): PluginManifest {
    return this.sqlite.registerPlugin(plugin);
  }

  public deletePlugin(id: string): boolean {
    return this.sqlite.deletePlugin(id);
  }

  // Settings
  public getSettings(): OpenLoopSettings {
    return this.sqlite.getSettings();
  }

  public updateSettings(settings: Partial<OpenLoopSettings>): OpenLoopSettings {
    return this.sqlite.updateSettings(settings);
  }

  // QA Automation
  public getQaSuites(): QaSuite[] {
    return this.sqlite.getQaSuites();
  }

  public getQaSuiteById(id: string): QaSuite | null {
    return this.sqlite.getQaSuiteById(id);
  }

  public saveQaSuite(suite: QaSuite): QaSuite {
    return this.sqlite.saveQaSuite(suite);
  }

  public deleteQaSuite(id: string): boolean {
    return this.sqlite.deleteQaSuite(id);
  }

  public getQaRuns(suiteId?: string, taskId?: string, limit?: number): QaRunRecord[] {
    return this.sqlite.getQaRuns(suiteId, taskId, limit);
  }

  public getQaRunById(id: string): QaRunRecord | null {
    return this.sqlite.getQaRunById(id);
  }

  public saveQaRun(run: QaRunRecord): QaRunRecord {
    return this.sqlite.saveQaRun(run);
  }

  public close(): void {
    this.sqlite.close();
  }
}
