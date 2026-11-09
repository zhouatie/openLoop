/**
 * 开发服务的进程名册键
 *
 * 会话内启动的服务按工程根登记，与任务进程名册互不冲突；
 * 沙箱回收时按同一规则回收，避免 worktree 已删除、Metro 还占着端口。
 */
export function devServerProcessKey(root: string): string {
  return `devserver:${root}`;
}
