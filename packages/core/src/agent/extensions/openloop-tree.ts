/**
 * openLoop 会话树导航桥
 *
 * pi 的 RPC 协议没有暴露会话树导航（navigateTree 只在扩展的 CommandContext 上），
 * 因此这里注册一个内部命令 `openloop-tree`：openLoop 用 prompt("/openloop-tree nav <id>")
 * 触发它，pi 会在同一个会话文件内把叶子移到目标条目，不产生模型调用。
 */

interface TreeCommandContext {
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<unknown>;
}

interface ExtensionApi {
  registerCommand: (
    name: string,
    options: { description: string; handler: (args: string, ctx: TreeCommandContext) => Promise<void> }
  ) => void;
}

function factory(pi: ExtensionApi) {
  pi.registerCommand('openloop-tree', {
    description: 'openLoop 会话树导航（内部使用）',
    handler: async (args, ctx) => {
      const [action, entryId] = String(args || '')
        .trim()
        .split(/\s+/);
      if (action !== 'nav' || !entryId) return;
      await ctx.navigateTree(entryId, { summarize: false });
    },
  });
}

export = factory;
