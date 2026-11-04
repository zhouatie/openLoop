/**
 * 内置 Agent 引擎固定为 pi：会话跑在核心进程内，会话文件落在 pi 的 agent 目录。
 * 用户可以直接在终端用同一条命令接管同一个会话。
 */
export function resolveResumeCommand(sessionId: string): string {
  return `pi --session ${sessionId}`;
}
