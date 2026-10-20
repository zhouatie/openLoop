import { Task, WorkflowDefinition, TaskExecutionMode } from '../types';
import { createLogger } from '../logger';

const logger = createLogger('TaskDecomposer');

export interface SubtaskPlan {
  title: string;
  workflowId?: string;
  description?: string;
  dependencies?: string[];
}

export interface DecompositionResult {
  shouldDecompose: boolean;
  reason?: string;
  executionMode?: TaskExecutionMode;
  concurrencyLimit?: number;
  subtasks?: SubtaskPlan[];
}

export class TaskDecomposer {
  private static instance: TaskDecomposer;

  public static getInstance(): TaskDecomposer {
    if (!TaskDecomposer.instance) {
      TaskDecomposer.instance = new TaskDecomposer();
    }
    return TaskDecomposer.instance;
  }

  /**
   * 分析任务复杂度，判断是否需要动态拆解为多子任务组 (串行 / 并行 / DAG 拓扑)
   */
  public analyze(task: Task, workflow: WorkflowDefinition, allWorkflows: WorkflowDefinition[] = []): DecompositionResult {
    // 已经属于子任务或已经显式指定为单任务的不重复拆解
    if (task.parentTaskId || task.kind === 'subtask') {
      return { shouldDecompose: false };
    }

    const title = (task.title || '').trim();
    const desc = (task.description || '').trim();
    const fullText = `${title}\n${desc}`;

    // 1. 显式多步骤模式匹配 (如 "1. ... 2. ..." 或 "步骤一...步骤二..." 或 "先...然后...最后...")
    const explicitStepPatterns = [
      /(?:步骤\s*[1-9一二三四]|step\s*[1-9]|\b[1-9]\s*[.、：:])/i,
      /(?:首先|第一步)[\s\S]+?(?:然后|接下来|第二步)[\s\S]+?(?:最后|最终|第三步)/i,
    ];

    const hasExplicitSteps = explicitStepPatterns.some((pattern) => pattern.test(fullText));

    // 2. 复合任务特征词识别 (跨模块、全链路、多端、重构+验收、开发+部署)
    const multiScopeKeywords = [
      '全链路',
      '端到端',
      '重构并',
      '开发并测试',
      '实现并验收',
      '以及自动化测试',
      '与接口联调',
      '模块拆分',
      '多端适配',
      '前后端联调',
      '自动化验收与合入',
    ];

    const matchedKeywords = multiScopeKeywords.filter((kw) => fullText.includes(kw));

    // 3. 并行特征识别 (如 "同时", "独立测试", "并行", "多端同步")
    const parallelKeywords = ['并行', '同时', '独立执行', '分别测试', '多端同步'];
    const isParallelIntended = parallelKeywords.some((kw) => fullText.includes(kw));

    if (import.meta.env?.DEV) {
      logger.info(`[TaskDecomposer] 分析任务 "${title}":`, {
        hasExplicitSteps,
        matchedKeywords,
        isParallelIntended,
      });
    }

    // 如果文本中包含显式分步列表，直接提取为工序
    if (hasExplicitSteps) {
      const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean);
      const stepLines = lines.filter((l) => /^(?:步骤\s*[1-9一二三四]|step\s*[1-9]|\b[1-9]\s*[.、：:])\s*/i.test(l));

      if (stepLines.length >= 2) {
        const subtasks: SubtaskPlan[] = stepLines.map((line, idx) => {
          const cleanTitle = line.replace(/^(?:步骤\s*[1-9一二三四]|step\s*[1-9]|\b[1-9]\s*[.、：:])\s*/i, '').trim();
          return {
            title: cleanTitle,
            workflowId: task.workflowId,
            dependencies: idx > 0 ? [`sub_${idx}`] : [],
          };
        });

        return {
          shouldDecompose: true,
          reason: '用户需求中包含显式多步骤工序划分',
          executionMode: isParallelIntended ? 'parallel' : 'serial',
          concurrencyLimit: isParallelIntended ? 3 : 1,
          subtasks,
        };
      }
    }

    // 如果命中了复合任务特征，智能生成「研发-验证-闭环」标准自适应工序
    if (matchedKeywords.length > 0 || (title.length > 25 && (title.includes('并') || title.includes('以及')))) {
      // 提取核心子目标
      const subtasks = this.generateAdaptiveSubtasks(task, workflow, allWorkflows, isParallelIntended);
      if (subtasks.length >= 2) {
        return {
          shouldDecompose: true,
          reason: `识别为复合任务 (命中特征: ${matchedKeywords.join(', ') || '多目标长需求'})`,
          executionMode: isParallelIntended ? 'parallel' : 'serial',
          concurrencyLimit: isParallelIntended ? 3 : 1,
          subtasks,
        };
      }
    }

    return { shouldDecompose: false };
  }

  /**
   * 根据当前工作流与需求特征，自适应生成标准的高质量串/并行工序
   */
  private generateAdaptiveSubtasks(
    task: Task,
    workflow: WorkflowDefinition,
    allWorkflows: WorkflowDefinition[],
    isParallel: boolean
  ): SubtaskPlan[] {
    const title = task.title.trim();

    // 寻找是否有专门的自动化 QA 或构建部署流程作为子工序工作流
    const qaWorkflow = allWorkflows.find((w) => w.tags?.includes('QA') || w.id.includes('qa'));
    const deployWorkflow = allWorkflows.find((w) => w.tags?.includes('CI/CD') || w.id.includes('deploy'));

    const plans: SubtaskPlan[] = [
      {
        title: `1. 核心业务功能编码与特性实现: ${title}`,
        workflowId: task.workflowId,
        dependencies: [],
      },
      {
        title: `2. 模块联调与基础用例自测: ${title}`,
        workflowId: task.workflowId,
        dependencies: isParallel ? [] : ['sub_1'],
      },
      {
        title: `3. 自动化 UI 截帧回归与验收巡检: ${title}`,
        workflowId: qaWorkflow ? qaWorkflow.id : task.workflowId,
        dependencies: isParallel ? [] : ['sub_2'],
      },
    ];

    return plans;
  }
}
