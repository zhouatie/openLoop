import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../logger';

/** 单条会话的可编辑元数据：标题覆盖、归档、删除、置顶标记 */
export interface AgentSessionMeta {
  title?: string;
  archived?: boolean;
  deleted?: boolean;
  /** 置顶：会话列中排在前面 */
  pinned?: boolean;
  updatedAt?: number;
}

/** 工作区（项目）的可编辑元数据：标题覆盖、隐藏、置顶、排序权重 */
export interface AgentProjectMeta {
  title?: string;
  hidden?: boolean;
  /** 置顶：项目列中排在前面 */
  pinned?: boolean;
  order?: number;
  updatedAt?: number;
}

interface MetaFile {
  version: 1;
  sessions: Record<string, AgentSessionMeta>;
  projects: Record<string, AgentProjectMeta>;
}

function emptyMeta(): MetaFile {
  return { version: 1, sessions: {}, projects: {} };
}

function resolveMetaDir(): string {
  return process.env.OPENLOOP_STORE_DIR || path.join(os.homedir(), '.openloop');
}

/**
 * pi 会话文件没有标题字段，工作区也没有持久化配置。
 * 这里用 openLoop 侧的一份 JSON 元数据补上重命名 / 归档 / 删除 / 排序能力，
 * 不改动 pi 自己的会话格式。
 */
export class AgentSessionMetaStore {
  private static instance: AgentSessionMetaStore | null = null;
  private file: string;
  private data: MetaFile = emptyMeta();
  private loaded = false;

  constructor(filePath?: string) {
    this.file = filePath || path.join(resolveMetaDir(), 'agent-meta.json');
  }

  static getInstance(): AgentSessionMetaStore {
    if (!AgentSessionMetaStore.instance) {
      AgentSessionMetaStore.instance = new AgentSessionMetaStore();
    }
    return AgentSessionMetaStore.instance;
  }

  private load(): MetaFile {
    if (this.loaded) return this.data;
    this.loaded = true;
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<MetaFile>;
        this.data = {
          version: 1,
          sessions: raw.sessions || {},
          projects: raw.projects || {},
        };
      }
    } catch (err) {
      logger.warn('[AgentMeta] 读取元数据失败，使用空配置', undefined, { error: String(err) });
      this.data = emptyMeta();
    }
    return this.data;
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      logger.warn('[AgentMeta] 写入元数据失败', undefined, { error: String(err) });
    }
  }

  public getSession(sessionId: string): AgentSessionMeta {
    return this.load().sessions[sessionId] || {};
  }

  public setSession(sessionId: string, patch: AgentSessionMeta): AgentSessionMeta {
    const data = this.load();
    const next: AgentSessionMeta = {
      ...data.sessions[sessionId],
      ...patch,
      updatedAt: Date.now(),
    };
    if (next.title !== undefined && !next.title.trim()) delete next.title;
    data.sessions[sessionId] = next;
    this.persist();
    return next;
  }

  public getProject(cwd: string): AgentProjectMeta {
    return this.load().projects[cwd] || {};
  }

  public setProject(cwd: string, patch: AgentProjectMeta): AgentProjectMeta {
    const data = this.load();
    const next: AgentProjectMeta = { ...data.projects[cwd], ...patch, updatedAt: Date.now() };
    if (next.title !== undefined && !next.title.trim()) delete next.title;
    data.projects[cwd] = next;
    this.persist();
    return next;
  }

  /** 全部项目配置，供列表合并标题与排序 */
  public listProjects(): Record<string, AgentProjectMeta> {
    return { ...this.load().projects };
  }
}

export const agentSessionMeta = AgentSessionMetaStore.getInstance();

/** 把会话文件移入 openLoop 回收目录，可手工恢复 */
export function moveSessionFileToTrash(filePath: string): { ok: boolean; target?: string; error?: string } {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: '会话文件不存在' };
    const trashDir = path.join(resolveMetaDir(), 'agent-trash');
    fs.mkdirSync(trashDir, { recursive: true });
    const target = path.join(trashDir, `${Date.now()}_${path.basename(filePath)}`);
    fs.renameSync(filePath, target);
    return { ok: true, target };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
