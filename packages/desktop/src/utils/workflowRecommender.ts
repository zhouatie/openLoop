import type { WorkflowDefinition } from '@openloop/core';

export interface WorkflowRecommendation {
  workflowId: string;
  workflowName: string;
  score: number;
  reason: string;
  matchHighlights: string[];
}

export class WorkflowRecommender {
  /**
   * 仅根据用户显式输入的任务名称 title (和工程 workspace 特征) 计算推荐工作流
   * 严禁将 workflow 自动填充的 description 作为推荐输入，避免循环自激振荡
   */
  public static recommend(
    workflows: WorkflowDefinition[],
    input: { title: string; workspace?: string }
  ): WorkflowRecommendation[] {
    if (!workflows || workflows.length === 0) return [];

    const rawTitle = (input.title || '').trim();
    // 只有用户键入了有意义的任务名称时才触发推荐
    if (rawTitle.length < 2) {
      return [];
    }

    const titleLower = rawTitle.toLowerCase();
    const wsLower = (input.workspace || '').toLowerCase().trim();

    const recommendations: WorkflowRecommendation[] = [];

    for (const wf of workflows) {
      let score = 0;
      const reasons: string[] = [];
      const highlights: string[] = [];

      const wfName = (wf.name || '').toLowerCase();
      const wfDesc = (wf.description || '').toLowerCase();
      const wfTags = (wf.tags || []).map((t) => t.toLowerCase());

      // 1. 缺陷修复 / Bugfix
      const isBug = /bug|fix|修复|缺陷|异常|报错|崩溃|404|500|失败/.test(titleLower);
      if (isBug) {
        if (wfTags.includes('qa') || wfDesc.includes('qa') || wfDesc.includes('测试') || wfName.includes('修复')) {
          score += 40;
          reasons.push('检测到缺陷修复需求');
          highlights.push('缺陷修复');
        }
      }

      // 2. 界面与 UI / 视觉 / 验收
      const isUi = /ui|页面|样式|css|视觉|截图|回放|midscene|验收|还原|骨架屏|弹窗|组件/.test(titleLower);
      if (isUi) {
        if (wfDesc.includes('worktree') || wfDesc.includes('截图') || wfDesc.includes('验收') || wfName.includes('worktree')) {
          score += 50;
          reasons.push('检测到前端界面与视觉变更，推荐 Worktree 独立沙箱与自动化回放验收');
          highlights.push('UI 自动化验收');
        }
      }

      // 3. 构建 / 打包 / 部署 / CI/CD
      const isDeploy = /构建|打包|部署|发布|docker|ci|cd|build|deploy|上线|release/.test(titleLower);
      if (isDeploy) {
        if (wfTags.includes('部署') || wfTags.includes('ci/cd') || wfDesc.includes('构建') || wfName.includes('部署')) {
          score += 50;
          reasons.push('检测到构建与交付动作，推荐标准编译构建与部署流水线');
          highlights.push('CI/CD 交付');
        }
      }

      // 4. 新功能 / 特性开发 / 重构
      const isFeat = /feat|新功能|特性|开发|重构|模块|设计|接口|api|重写/.test(titleLower);
      if (isFeat) {
        if (wfTags.includes('研发') || wfTags.includes('ai agent') || wfDesc.includes('编码')) {
          score += 35;
          reasons.push('检测到特性研发需求，推荐全闭环 AI 编码流水线');
          highlights.push('特性研发');
        }
      }

      // 5. 工作流名称或标签直接包含标题关键词
      for (const tag of wfTags) {
        if (tag && tag.length >= 2 && titleLower.includes(tag)) {
          score += 20;
          highlights.push(tag);
        }
      }

      // 6. 工作区匹配加权（仅做轻微辅助，+5）
      if (wsLower && score > 0) {
        if (wf.requireWorkspace || wf.nodes?.some((n) => n.type === 'worktree-setup' || n.type === 'cli')) {
          score += 5;
        }
      }

      if (score >= 20) {
        recommendations.push({
          workflowId: wf.id,
          workflowName: wf.name,
          score,
          reason: reasons[0] || '匹配任务名称关键词',
          matchHighlights: Array.from(new Set(highlights)),
        });
      }
    }

    // 按匹配得分降序排序
    return recommendations.sort((a, b) => b.score - a.score);
  }
}
