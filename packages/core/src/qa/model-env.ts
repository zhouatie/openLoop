import { QaAutomationSettings } from '../types';
import { createLogger } from '../logger';

const logger = createLogger('QaModelEnv');

/** 设置项字段 → Midscene 期望的环境变量 */
const FIELD_TO_ENV: Record<keyof QaAutomationSettings, string> = {
  modelBaseUrl: 'MIDSCENE_MODEL_BASE_URL',
  modelApiKey: 'MIDSCENE_MODEL_API_KEY',
  modelName: 'MIDSCENE_MODEL_NAME',
  modelFamily: 'MIDSCENE_MODEL_FAMILY',
};

/**
 * 将界面配置的多模态模型参数同步到进程环境变量。
 * Midscene SDK 在创建 Agent 时读取这些变量，因此无需改动驱动代码。
 */
export function applyQaModelEnv(settings?: QaAutomationSettings | null): void {
  if (!settings) return;

  for (const [field, envKey] of Object.entries(FIELD_TO_ENV)) {
    const value = settings[field as keyof QaAutomationSettings];
    if (value === undefined) continue;

    const trimmed = String(value).trim();
    if (trimmed) {
      process.env[envKey] = trimmed;
    } else {
      delete process.env[envKey];
    }
  }

  logger.info('[QaModelEnv] 已同步多模态模型配置到进程环境', {
    hasApiKey: Boolean(process.env.MIDSCENE_MODEL_API_KEY),
    modelName: process.env.MIDSCENE_MODEL_NAME,
  });
}

/**
 * 当前是否已具备多模态视觉推理能力
 */
export function hasQaModelKey(): boolean {
  return Boolean(process.env.MIDSCENE_MODEL_API_KEY || process.env.OPENAI_API_KEY);
}
