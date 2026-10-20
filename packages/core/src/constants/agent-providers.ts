import type { AgentProviderType } from '../types';

export interface AgentProviderMeta {
  id: AgentProviderType;
  label: string;
  /** 非 pi 引擎的执行命令模板，支持 {prompt} 占位符；pi 由内置 RPC 会话驱动 */
  runCommand?: string;
  /** 终端接管命令模板，支持 {sessionId} 占位符 */
  resumeCommand: string;
}

/** 受支持的代码智能体引擎，模型与思考强度对所有引擎统一生效 */
export const AGENT_PROVIDERS: AgentProviderMeta[] = [
  {
    id: 'pi',
    label: 'Pi Agent',
    resumeCommand: 'pi --session {sessionId}',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    runCommand: 'claude -p {prompt} --permission-mode acceptEdits',
    resumeCommand: 'claude --resume {sessionId}',
  },
  {
    id: 'codex',
    label: 'Codex',
    runCommand: 'codex exec {prompt}',
    resumeCommand: 'codex resume {sessionId}',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    runCommand: 'opencode run {prompt}',
    resumeCommand: 'opencode --session {sessionId}',
  },
];

export const getAgentProviderMeta = (id?: string): AgentProviderMeta =>
  AGENT_PROVIDERS.find((p) => p.id === id) || AGENT_PROVIDERS[0];

/** 单花括号占位符替换，未声明的占位符保持原样 */
export function fillCommandPlaceholders(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (raw, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : raw
  );
}

/** 安全地把文本嵌入 shell 单引号参数 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 解析引擎的终端接管命令 */
export function resolveResumeCommand(provider: string | undefined, sessionId: string): string {
  return getDefaultResumeCommand(provider, sessionId);
}

/** 引擎的内置终端接管命令，sessionId 可传占位符用于界面预览 */
export function getDefaultResumeCommand(provider: string | undefined, sessionId: string): string {
  return fillCommandPlaceholders(getAgentProviderMeta(provider).resumeCommand, { sessionId });
}

/** 解析非 pi 引擎的执行命令，模型可选 */
export function resolveRunCommand(provider: string, prompt: string, model?: string): string {
  const meta = getAgentProviderMeta(provider);
  if (!meta.runCommand) return '';
  const command = fillCommandPlaceholders(meta.runCommand, { prompt: shellQuote(prompt) });
  return model?.trim() ? `${command} --model ${shellQuote(model.trim())}` : command;
}
