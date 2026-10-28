/**
 * openLoop 会话树桥
 *
 * pi 的 RPC 协议只暴露了「从提问分叉」，按条目定位的树导航与分叉都在扩展的
 * CommandContext 上，因此这里注册一个内部命令 `openloop-tree`：
 * - `openloop-tree nav <id>`：同一个会话文件内把叶子移到目标条目
 * - `openloop-tree fork <id>`：以该条目为末尾复制出一个新会话文件（源会话不动）
 * 两者都不产生模型调用。
 */

interface TreeCommandContext {
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<unknown>;
  fork: (entryId: string, options?: { position?: 'before' | 'at' }) => Promise<{ cancelled: boolean }>;
}

interface ExtensionApi {
  registerCommand: (
    name: string,
    options: { description: string; handler: (args: string, ctx: TreeCommandContext) => Promise<void> }
  ) => void;
}

function factory(pi: ExtensionApi) {
  pi.registerCommand('openloop-tree', {
    description: 'openLoop 会话树导航与分叉（内部使用）',
    handler: async (args, ctx) => {
      const [action, entryId] = String(args || '')
        .trim()
        .split(/\s+/);
      if (!entryId) return;
      if (action === 'nav') {
        await ctx.navigateTree(entryId, { summarize: false });
        return;
      }
      if (action === 'fork') {
        await ctx.fork(entryId, { position: 'at' });
      }
    },
  });
}

export = factory;
