import type { IncomingMessage, ServerResponse } from 'http';
import { getDevServerManager } from './dev-server-manager';
import type { DevServerConfig } from './types';

/** 宿主提供的最小依赖：路由只管分发，配置存取与响应由调用方决定 */
export interface DevServerRouteDeps {
  readConfig(cwd: string): DevServerConfig;
  saveConfig(cwd: string, patch: DevServerConfig): DevServerConfig;
  /** 校验请求里的目录：必须是已存在的绝对路径，避免误把服务拉到别处 */
  resolveCwd(raw: unknown): string | null;
  sendJson(
    res: ServerResponse,
    status: number,
    body: unknown,
    meta?: { method: string; pathname: string; startTime: number }
  ): void;
  readBody(req: IncomingMessage): Promise<any>;
  log?(message: string): void;
}

export interface DevServerRouteMeta {
  method: string;
  pathname: string;
  startTime: number;
}

/** 返回 true 表示已处理并写回响应 */
export type DevServerRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  meta?: DevServerRouteMeta
) => Promise<boolean>;

export function createDevServerRoutes(deps: DevServerRouteDeps): DevServerRouteHandler {
  const { readConfig, saveConfig, resolveCwd, sendJson, readBody, log } = deps;
  const manager = () => getDevServerManager();
  const invalidCwd = (res: ServerResponse, meta?: DevServerRouteMeta) =>
    sendJson(res, 400, { error: '缺少有效的会话目录' }, meta);

  return async (req, res, url, meta) => {
    const { pathname } = url;
    if (!pathname.startsWith('/api/dev-server')) return false;
    const method = (req.method || 'GET').toUpperCase();

    if (pathname === '/api/dev-server/projects' && method === 'GET') {
      const cwd = resolveCwd(url.searchParams.get('cwd'));
      if (!cwd) {
        invalidCwd(res, meta);
        return true;
      }
      sendJson(res, 200, await manager().scan(cwd), meta);
      return true;
    }

    if (pathname === '/api/dev-server' && method === 'GET') {
      const cwd = resolveCwd(url.searchParams.get('cwd'));
      if (!cwd) {
        invalidCwd(res, meta);
        return true;
      }
      sendJson(res, 200, await manager().status(cwd, readConfig(cwd)), meta);
      return true;
    }

    if (pathname === '/api/dev-server/start' && method === 'POST') {
      const body = await readBody(req);
      const cwd = resolveCwd(body?.cwd);
      if (!cwd) {
        invalidCwd(res, meta);
        return true;
      }
      const saved = saveConfig(cwd, { command: body?.command, nodeBinPath: body?.nodeBinPath });
      log?.(`[DevServer:Start] 拉起开发服务 (目录: ${cwd}, 命令: ${saved.command || '自动'})`);
      sendJson(res, 200, await manager().start(cwd, saved), meta);
      return true;
    }

    if (pathname === '/api/dev-server/stop' && method === 'POST') {
      const body = await readBody(req);
      const cwd = resolveCwd(body?.cwd);
      if (!cwd) {
        invalidCwd(res, meta);
        return true;
      }
      log?.(`[DevServer:Stop] 停止开发服务 (目录: ${cwd})`);
      sendJson(res, 200, await manager().stop(cwd, readConfig(cwd)), meta);
      return true;
    }

    if (pathname === '/api/dev-server/config' && (method === 'PUT' || method === 'POST')) {
      const body = await readBody(req);
      const cwd = resolveCwd(body?.cwd);
      if (!cwd) {
        invalidCwd(res, meta);
        return true;
      }
      saveConfig(cwd, { command: body?.command, nodeBinPath: body?.nodeBinPath });
      sendJson(res, 200, await manager().status(cwd, readConfig(cwd)), meta);
      return true;
    }

    return false;
  };
}
