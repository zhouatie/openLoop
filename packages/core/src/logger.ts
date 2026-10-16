export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 获取当前日志级别，默认为 debug（开发环境下记录完整链路）
function getCurrentLogLevel(): LogLevel {
  const envLevel = process.env.OPENLOOP_LOG_LEVEL?.toLowerCase();
  if (envLevel && envLevel in LEVEL_WEIGHTS) {
    return envLevel as LogLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function formatMeta(meta: any): string {
  if (meta === undefined || meta === null) return '';
  if (meta instanceof Error) {
    return `\n${meta.stack || meta.message}`;
  }
  if (typeof meta === 'object') {
    try {
      const keys = Object.keys(meta);
      if (keys.length === 0) return '';
      // 避免单行日志过长，序列化对象
      return ` ${JSON.stringify(meta)}`;
    } catch {
      return ` [Unserializable Object]`;
    }
  }
  return ` ${String(meta)}`;
}

export class Logger {
  private module: string;
  private defaultContext?: Record<string, any>;

  constructor(module: string = 'App', defaultContext?: Record<string, any>) {
    this.module = module;
    this.defaultContext = defaultContext;
  }

  public child(subModule: string, extraContext?: Record<string, any>): Logger {
    return new Logger(`${this.module}:${subModule}`, {
      ...this.defaultContext,
      ...extraContext,
    });
  }

  private shouldLog(level: LogLevel): boolean {
    const minLevel = getCurrentLogLevel();
    return LEVEL_WEIGHTS[level] >= LEVEL_WEIGHTS[minLevel];
  }

  private log(
    level: LogLevel,
    message: string,
    meta?: any,
    extraContext?: Record<string, any>
  ): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const levelTag = level.toUpperCase().padEnd(5);
    const mergedContext = { ...this.defaultContext, ...extraContext };

    let contextTags = '';
    if (mergedContext.taskId) {
      contextTags += ` [Task:${mergedContext.taskId}]`;
    }
    if (mergedContext.nodeId) {
      contextTags += ` [Node:${mergedContext.nodeId}]`;
    }

    const metaStr = formatMeta(meta);
    const line = `[${timestamp}] [${levelTag}] [${this.module}]${contextTags} ${message}${metaStr}`;

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  public debug(message: string, meta?: any, context?: Record<string, any>): void {
    this.log('debug', message, meta, context);
  }

  public info(message: string, meta?: any, context?: Record<string, any>): void {
    this.log('info', message, meta, context);
  }

  public warn(message: string, meta?: any, context?: Record<string, any>): void {
    this.log('warn', message, meta, context);
  }

  public error(message: string, meta?: any, context?: Record<string, any>): void {
    this.log('error', message, meta, context);
  }
}

export const logger = new Logger('openLoop');
export const createLogger = (module: string, context?: Record<string, any>) =>
  new Logger(module, context);
