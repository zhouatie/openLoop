import type { ChildProcess } from 'child_process';

/** 开发服务（RN Metro）的用户覆盖配置；不填则用工程自动探测值 */
export interface DevServerConfig {
  /** 启动命令：端口由命令里的 --port 决定，不额外拼接 */
  command?: string;
  /** 额外注入 PATH 的 Node 运行时目录，兼容旧版 RN 需要的 Node 14 */
  nodeBinPath?: string;
}

export interface DevServerSettings {
  workspaces?: Record<string, DevServerConfig>;
}

/** 开发服务快照：Agent 工具与界面共用同一份口径 */
export interface DevServerSnapshot {
  /** 工作目录（可能是工程根的子目录） */
  cwd: string;
  /** 定位到的工程根；未找到 package.json 时为 null */
  root: string | null;
  /** 是否识别为 RN 工程，界面据此决定是否露出入口 */
  detected: boolean;
  /** 端口是否已在监听 */
  running: boolean;
  /** 监听属于本模块拉起的进程，可安全停止 */
  owned: boolean;
  /** 已拉起但端口尚未就绪 */
  starting: boolean;
  port: number;
  command: string;
  nodeBinPath?: string;
  url: string | null;
  lanUrl: string | null;
  startedAt?: number;
  pid?: number;
  error?: string;
  /** 最近日志行，用于界面与工具排查启动失败 */
  logs: string[];
}

/** 工作区里的一个可启动工程：由「启动服务」面板列出并单独管理 */
export interface DevServerProject {
  /** 工程根的绝对路径 */
  path: string;
  /** 目录名，列表主标题 */
  name: string;
  /** 相对工作区根的路径，根目录为 '.' */
  relative: string;
  command: string;
  port: number;
  /** 已保存的 Node 运行时目录（注入 PATH） */
  nodeBinPath?: string;
  /** 端口已在监听（可能是外部手动拉起的 Metro） */
  running: boolean;
  /** 监听属于本模块拉起的进程 */
  owned: boolean;
  starting: boolean;
  /** 端口被别的进程 / 别的工程占用 */
  portBusy?: boolean;
  error?: string;
}

/** 进程登记表：宿主可换成自己的后台进程管理器，缺省直接操作子进程 */
export interface DevServerProcessRegistry {
  register(key: string, child: ChildProcess, meta: { name: string; port?: number }): void;
  stopAll(key: string): void;
}

/** 面板所需的最小宿主能力：任何实现这四个方法的宿主都能复用界面 */
export interface DevServerClient {
  scan(cwd: string): Promise<{ root: string; projects: DevServerProject[] }>;
  start(cwd: string, config?: DevServerConfig): Promise<DevServerSnapshot>;
  stop(cwd: string): Promise<DevServerSnapshot>;
  saveConfig(cwd: string, config: DevServerConfig): Promise<DevServerSnapshot>;
}
