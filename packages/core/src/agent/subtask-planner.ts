import { Store } from '../store';
import { Task, WorkflowDefinition, TaskExecutionMode } from '../types';
import { DecompositionResult, SubtaskPlan } from '../engine/task-decomposer';
import { PiRpcSessionInstance } from './pi-rpc-session';
import { createLogger } from '../logger';

const logger = createLogger('SubtaskPlanner');

/** AI 规划工序的超时兜底，避免前端无限等待 */
const PLAN_TIMEOUT_MS = 180_000;

const PLANNING_RULES = `你是 OpenLoop 的工序规划助手，负责把一条开发需求拆解为多道可独立执行的工序，并为每道工序挑选合适流水线。

只输出一个 json 代码块，结构如下，不要输出任何解释文字：
\`\`\`json
{
  "executionMode": "serial" | "parallel" | "dag",
  "concurrencyLimit": 1-3,
  "subtasks": [
    {
      "title": "工序标题",
      "workflowId": "流水线 ID",
      "description": "这道工序的具体交付内容",
      "dependencies": []
    }
  ]
}
\`\`\`

约束：
1. 工序数量 2~5 道，标题必须贴合当前需求的真实改动，禁止套用通用模板标题；
2. workflowId 只能取给定流水线列表中的 ID；
3. dependencies 只允许引用排在它前面的工序，用 "sub_1"、"sub_2" 表示第 1、2 道工序，第一道工序必须为空数组。`;

export class SubtaskPlanner {
  /**
   * 请求 AI 依据任务需求与可用流水线，真实生成工序拆解方案
   * 失败或超时返回 null，由调用方决定降级策略（不回退到模板假数据）
   */
  public static async plan(
    store: Store,
    task: Task,
    allWorkflows: WorkflowDefinition[]
  ): Promise<DecompositionResult | null> {
    if (allWorkflows.length === 0) {
      logger.warn(`[SubtaskPlanner] 当前没有可用流水线，跳过 AI 规划 (Task: ${task.id})`);
      return null;
    }

    const settings = store.getSettings();
    const existingSubtasks = (task.subTaskIds || [])
      .map((id) => store.getTask(id))
      .filter((t): t is Task => Boolean(t));

    const result = await new Promise<string | null>((resolve) => {
      let settled = false;
      let lastAssistantText = '';
      let session: PiRpcSessionInstance | null = null;

      const finish = (text: string | null, reason?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (reason) logger.warn(`[SubtaskPlanner] AI 规划未产出有效方案 (Task: ${task.id}): ${reason}`);
        session?.terminate();
        resolve(text);
      };

      const timer = setTimeout(
        () => finish(null, `等待超时 (${PLAN_TIMEOUT_MS}ms)`),
        PLAN_TIMEOUT_MS
      );

      session = new PiRpcSessionInstance({
        taskId: `subtask_plan_${task.id}`,
        taskTitle: `工序规划: ${task.title}`,
        sessionId: `subtask_plan_${task.id}_${Date.now()}`,
        agentName: 'Subtask Planner',
        model: settings.defaultModel,
        thinking: settings.reasoningLevel || 'medium',
        disableTools: true,
        initialPrompt: `${PLANNING_RULES}\n\n${this.buildContext(task, allWorkflows, existingSubtasks)}`,
        onUpdate: (state) => {
          const last = state.messages?.[state.messages.length - 1];
          if (last?.role === 'assistant' && last.content) lastAssistantText = last.content;
        },
        onFinished: (error) => {
          if (error) return finish(null, error);
          finish(lastAssistantText || null, lastAssistantText ? undefined : '模型没有输出任何内容');
        },
      });
    });

    if (!result) return null;
    return this.normalizePlan(this.extractJson(result), task, allWorkflows);
  }

  private static buildContext(
    task: Task,
    allWorkflows: WorkflowDefinition[],
    existingSubtasks: Task[]
  ): string {
    const workflowList = allWorkflows
      .map((w) => {
        const tags = (w.tags || []).length > 0 ? ` 标签: ${(w.tags || []).join('、')}` : '';
        const desc = w.description ? ` 说明: ${w.description}` : '';
        return `- [${w.id}] ${w.name}${desc}${tags}`;
      })
      .join('\n');

    const existing =
      existingSubtasks.length > 0
        ? `\n\n[已有工序，请只规划后续新增工序，不要重复已有内容]\n${existingSubtasks
            .map((s, i) => `${i + 1}. ${s.title} (流水线: ${s.workflowId})`)
            .join('\n')}`
        : '';

    return `[任务标题]\n${task.title}\n\n[任务详细说明]\n${
      task.description?.trim() || '（无）'
    }\n\n[任务当前流水线]\n${task.workflowId}\n\n[可用流水线列表]\n${workflowList}${existing}`;
  }

  /** 从模型输出中提取第一个 JSON 对象 */
  private static extractJson(text: string): Record<string, any> | null {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [fenced?.[1], text];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start < 0 || end <= start) continue;
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (_) {
        // 尝试下一个候选文本
      }
    }
    return null;
  }

  /** 校验并规整 AI 输出，剔除非法流水线与非法依赖 */
  private static normalizePlan(
    raw: Record<string, any> | null,
    task: Task,
    allWorkflows: WorkflowDefinition[]
  ): DecompositionResult | null {
    if (!raw || !Array.isArray(raw.subtasks)) return null;

    const workflowIds = new Set(allWorkflows.map((w) => w.id));
    const subtasks: SubtaskPlan[] = [];

    for (const item of raw.subtasks) {
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      if (!title) continue;
      const index = subtasks.length;
      const dependencies = Array.isArray(item.dependencies)
        ? item.dependencies
            .map((dep: any) => {
              const match = /^sub_(\d+)$/.exec(String(dep).trim());
              const target = match ? Number(match[1]) - 1 : -1;
              return target >= 0 && target < index ? `sub_${target + 1}` : null;
            })
            .filter((dep: string | null): dep is string => Boolean(dep))
        : [];

      subtasks.push({
        title,
        workflowId: workflowIds.has(item.workflowId) ? item.workflowId : task.workflowId,
        description: typeof item.description === 'string' ? item.description.trim() : undefined,
        dependencies,
      });
    }

    if (subtasks.length < 2) return null;

    const executionMode: TaskExecutionMode = ['serial', 'parallel', 'dag'].includes(raw.executionMode)
      ? raw.executionMode
      : 'serial';

    const concurrencyLimit =
      typeof raw.concurrencyLimit === 'number' && raw.concurrencyLimit >= 1
        ? Math.min(Math.round(raw.concurrencyLimit), 5)
        : executionMode === 'serial'
        ? 1
        : 3;

    return {
      shouldDecompose: true,
      reason: 'AI 依据任务需求与可用流水线生成的工序规划',
      executionMode,
      concurrencyLimit,
      subtasks,
    };
  }
}
