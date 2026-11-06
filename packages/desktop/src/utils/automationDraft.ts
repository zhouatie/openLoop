import type { AutomationTask } from '@openloop/core';

const CHINESE_NUMBERS: Record<string, number> = {
  半: 0.5,
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const UNIT_SECONDS: Record<string, number> = {
  秒: 1,
  分钟: 60,
  分: 60,
  小时: 3600,
  钟头: 3600,
  天: 86400,
  日: 86400,
};

const INTERVAL_PATTERN =
  /每(?:隔)?\s*(半|[一二两三四五六七八九十\d.]+)?\s*(秒|分钟|分|小时|钟头|天|日)(?:一次)?[，,、]?\s*/;

/** 模糊时间表述（无具体数值），周期已在字段中定义，无需保留在目标描述里 */
const VAGUE_INTERVAL_PATTERN = /^每(?:隔)?(?:一段时间|一阵子|一会儿?|段时间)\s*(?:就|再)?\s*/;

/** 末尾的通知动作不属于扫描目标，剔除后由流水线自身负责 */
const TRAILING_NOTIFY_PATTERN = /[，,；;]?\s*(?:并|然后|再)?\s*(?:将|把)?(?:结果|报告)?\s*(?:推送到?|发送到?|通知)\s*.*$/;

/** 周期快捷选项（秒） */
export const INTERVAL_PRESETS = [300, 1800, 3600, 21600, 86400];

const DEFAULT_INTERVAL_SEC = 1800;

export function formatInterval(sec: number): string {
  if (!sec || sec <= 0) return '未设置';
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  if (sec < 86400) return `${Math.round((sec / 3600) * 10) / 10} 小时`;
  return `${Math.round((sec / 86400) * 10) / 10} 天`;
}

/** 从一句话中提取周期（秒），未命中时返回默认 30 分钟 */
export function parseIntervalSec(text: string): number {
  const match = text.match(INTERVAL_PATTERN);
  if (!match) return DEFAULT_INTERVAL_SEC;

  const rawNumber = match[1];
  const unit = match[2];
  const amount = rawNumber ? CHINESE_NUMBERS[rawNumber] ?? Number(rawNumber) : 1;
  const unitSec = UNIT_SECONDS[unit] || 60;
  const value = Number.isFinite(amount) && amount > 0 ? amount * unitSec : DEFAULT_INTERVAL_SEC;
  return Math.max(Math.round(value), 5);
}

/**
 * 将一句自然语言描述转换为自动化任务草稿。
 * 解析为纯本地规则：无网络请求，输入即反馈。
 */
export function buildAutomationDraft(
  input: string,
  workflows: Array<{ id: string; name: string }> = []
): { draft: Partial<AutomationTask>; hint: string; intervalMatched: boolean } {
  const text = input.trim().replace(/[。.!！?？\s]+$/, '');
  const intervalMatched = INTERVAL_PATTERN.test(text);
  const intervalSec = parseIntervalSec(text);

  const goal = text
    .replace(/^(请|帮我|帮忙|麻烦|我想|我要|想要|需要|给我)+/, '')
    .replace(VAGUE_INTERVAL_PATTERN, '')
    .replace(INTERVAL_PATTERN, '')
    .replace(TRAILING_NOTIFY_PATTERN, '')
    .trim();

  const rawName = goal || text;
  const name = rawName.length > 26 ? `${rawName.slice(0, 26)}…` : rawName || '未命名自动化任务';

  // GitHub 监控：文本中出现 owner/repo 时切换数据源
  const repoMatch = text.match(/github\s*[:：]?\s*([\w.-]+\/[\w.-]+)/i) || text.match(/\b([\w-]+\/[\w.-]+)\b/);
  const useRepo = /github|issue|仓库/i.test(text) && Boolean(repoMatch?.[1]);

  // 提到看板即保留卡片流转，否则默认直连运行
  const keepOnKanban = /看板|kanban|卡片/i.test(text);

  const draft: Partial<AutomationTask> = {
    name,
    description: goal,
    enabled: true,
    intervalSec,
    sourceType: useRepo ? 'github_issues' : 'schedule',
    sourceConfig: useRepo ? { repo: repoMatch![1] } : { prompt: goal || text },
    actionType: 'run_workflow',
    actionConfig: {
      workflowId: workflows[0]?.id,
      autoRun: true,
      directRun: !keepOnKanban,
    },
  };

  const hint = [
    `每 ${formatInterval(intervalSec)}`,
    useRepo ? `监控 GitHub ${repoMatch![1]}` : '纯定时驱动流水线',
    keepOnKanban ? '写入看板' : '不落看板',
  ].join(' · ');

  return { draft, hint, intervalMatched };
}
