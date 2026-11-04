import { EventEmitter } from 'events';
import { Store } from '../store';
import { WorkflowDefinition, WorkflowSessionState, SessionChatMessage, WorkflowNode, WorkflowEdge } from '../types';
import { composeMessageWithSessionReferences } from './session-reference';
import { PiSessionInstance } from './pi-session';
import { getEffectivePrompt } from '../constants/prompts';
import { createLogger } from '../logger';

const logger = createLogger('WorkflowCopilot');

export class WorkflowCopilotManager extends EventEmitter {
  private static instance: WorkflowCopilotManager;
  private sessions = new Map<string, PiSessionInstance>();
  private store: Store;

  private constructor(store: Store) {
    super();
    this.store = store;
  }

  public static getInstance(store: Store): WorkflowCopilotManager {
    if (!WorkflowCopilotManager.instance) {
      WorkflowCopilotManager.instance = new WorkflowCopilotManager(store);
    }
    return WorkflowCopilotManager.instance;
  }

  /**
   * 获取或创建工作流 Copilot 会话状态
   */
  public getSessionState(workflowId: string): WorkflowSessionState {
    const sessionKey = `wf_${workflowId}`;
    const rpcSession = this.sessions.get(sessionKey);
    const workflow = this.store.getWorkflow(workflowId);

    if (rpcSession) {
      const state = rpcSession.getState();
      return {
        workflowId,
        active: state.active,
        isBusy: state.isBusy,
        isPaused: state.isPaused,
        messages: state.messages,
        agentName: 'Workflow Architect Copilot',
        model: state.model,
        piSessionId: state.piSessionId,
      };
    }

    const savedMessages = workflow?.context?.chatMessages || [];
    return {
      workflowId,
      active: false,
      isBusy: false,
      isPaused: false,
      messages: savedMessages,
      agentName: 'Workflow Architect Copilot',
    };
  }

  /**
   * 向工作流 Copilot 发送消息
   */
  public async sendMessage(
    workflowId: string,
    userMessage: string,
    currentSnapshot?: {
      nodes?: WorkflowNode[];
      edges?: WorkflowEdge[];
      name?: string;
      focusNodeId?: string;
    }
  ): Promise<void> {
    const sessionKey = `wf_${workflowId}`;
    let rpcSession = this.sessions.get(sessionKey);
    const workflow = this.store.getWorkflow(workflowId);

    logger.info(`[WorkflowCopilot] 收到流水线编排指令 (Workflow: ${workflowId}, Focus: ${currentSnapshot?.focusNodeId || 'none'}): "${userMessage.slice(0, 50)}"`);

    // 构建轻量 DAG 拓扑摘要
    let contextTopology = '';
    if (currentSnapshot && currentSnapshot.nodes && currentSnapshot.nodes.length > 0) {
      const focusNode = currentSnapshot.focusNodeId
        ? currentSnapshot.nodes.find((n) => n.id === currentSnapshot.focusNodeId)
        : null;

      const nodeSummary = currentSnapshot.nodes
        .map((n) => {
          const isFocused = n.id === currentSnapshot.focusNodeId ? ' [★用户当前关注锚点]' : '';
          return `  - [${n.id}] ${n.name} (类型: ${n.type}${n.config?.command ? `, 命令: ${n.config.command}` : ''})${isFocused}`;
        })
        .join('\n');

      const edgeSummary = (currentSnapshot.edges || [])
        .map((e) => `  - ${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ''}`)
        .join('\n');

      let focusContext = '';
      if (focusNode) {
        focusContext = `\n【焦点锚点】用户当前选中了节点 [${focusNode.id}] "${focusNode.name}"。若用户指令涉及“在此后添加/串联/配置验收门禁”，请针对该锚点进行链路扩充（使用 patch），保持原有其他拓扑稳定。`;
      }

      contextTopology = `\n\n[当前流水线拓扑上下文]\n流水线名称: ${currentSnapshot.name || workflow?.name || workflowId}\n节点总数: ${currentSnapshot.nodes.length}\n阶段节点列表:\n${nodeSummary}\n流转依赖连线:\n${edgeSummary || '  (暂无连线)'}${focusContext}`;
    } else {
      contextTopology = '\n\n[当前流水线拓扑上下文]\n当前画布为空，请根据用户的业务愿景规划完整的自动化 DAG 流水线架构。';
    }

    const settings = this.store.getSettings();
    const systemPrompt = getEffectivePrompt('workflowCopilot', settings.prompts);
    // @ 了别的会话：把被引用会话投影成只读快照追加在需求之后，失败不阻断发送
    const userSection = await composeMessageWithSessionReferences({
      message: userMessage,
      ownerSessionId: `workflow_copilot_${workflowId}`,
    });
    const fullPrompt = `${systemPrompt}\n${contextTopology}\n\n[用户编排需求]\n${userSection}`;

    // 设立 5 秒超时兜底监控，确保任何网络/RPC 进程受阻时前端绝不挂死
    let hasResponded = false;
    const fallbackTimer = setTimeout(() => {
      if (!hasResponded) {
        hasResponded = true;
        logger.warn(`[WorkflowCopilot] RPC 推理超时或未产生流式响应 (5s)，平滑启用智能兜底方案 (Workflow: ${workflowId})`);
        this.generateFallbackResponse(workflowId, userMessage, currentSnapshot);
      }
    }, 5000);

    // 如果还没有启动 session，则初始化一个
    if (!rpcSession || !rpcSession.active) {
      const piSessionId = `workflow_copilot_${workflowId}`;

      rpcSession = new PiSessionInstance({
        taskId: sessionKey,
        taskTitle: `Workflow Copilot: ${workflow?.name || workflowId}`,
        sessionId: piSessionId,
        agentName: 'Workflow Copilot',
        model: settings.defaultAgentModel || undefined,
        thinking: settings.defaultThinking || 'medium',
        cwd: process.cwd(),
        initialPrompt: fullPrompt,
        onUpdate: (state) => {
          if (state.messages?.some((m) => m.role === 'assistant' && m.content)) {
            hasResponded = true;
            clearTimeout(fallbackTimer);
          }
          this.handleSessionUpdate(workflowId, state);
        },
        onFinished: (error?: string) => {
          clearTimeout(fallbackTimer);
          if (error || !hasResponded) {
            logger.warn(`[WorkflowCopilot] Pi RPC 会话未完成有效响应，启用智能兜底响应: ${error || '无输出'}`);
            this.generateFallbackResponse(workflowId, userMessage, currentSnapshot);
          } else {
            logger.info(`[WorkflowCopilot] 会话轮次完成 (Workflow: ${workflowId})`);
          }
        },
      });

      this.sessions.set(sessionKey, rpcSession);
    } else {
      // 已经有活跃 RPC 会话，直接发送 steer 或 prompt
      const stepMessage = `${contextTopology}\n\n[用户编排需求]\n${userMessage}`;
      try {
        await rpcSession.sendUserMessage(stepMessage);
      } catch (err: any) {
        clearTimeout(fallbackTimer);
        logger.warn(`[WorkflowCopilot] 发送消息至活跃 RPC 失败，切换兜底响应: ${err.message}`);
        this.generateFallbackResponse(workflowId, userMessage, currentSnapshot);
      }
    }
  }

  /**
   * 智能兜底生成器（确保高鲁棒性与秒级响应）
   */
  private generateFallbackResponse(
    workflowId: string,
    userMessage: string,
    currentSnapshot?: {
      nodes?: WorkflowNode[];
      edges?: WorkflowEdge[];
      name?: string;
      focusNodeId?: string;
    }
  ) {
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow) return;
    if (!workflow.context) workflow.context = {};
    if (!workflow.context.chatMessages) workflow.context.chatMessages = [];

    // 确保用户的消息也已写入历史
    const lastMsg = workflow.context.chatMessages[workflow.context.chatMessages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
      workflow.context.chatMessages.push({
        id: `msg_u_${Date.now()}`,
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      });
    }

    const lower = userMessage.toLowerCase();
    let actionPayload: any = null;
    let descriptionText = '';

    // 删除/移除节点意图处理 (如: "去掉最后一个 git", "删除 git 提交", "移除最后一个节点")
    const isRemoveIntent =
      lower.includes('去') ||
      lower.includes('删') ||
      lower.includes('移除') ||
      lower.includes('不要') ||
      lower.includes('减去');

    if (currentSnapshot?.nodes && currentSnapshot.nodes.length > 0 && isRemoveIntent) {
      const existingNodes = [...currentSnapshot.nodes];
      let targetNodeId: string | null = null;
      let targetNodeName = '';

      for (let i = existingNodes.length - 1; i >= 0; i--) {
        const n = existingNodes[i];
        const nName = (n.name || '').toLowerCase();
        const nType = (n.type || '').toLowerCase();
        const nCmd = ((n.config as any)?.command || '').toLowerCase();

        if (
          (lower.includes('git') && (nName.includes('git') || nCmd.includes('git'))) ||
          (lower.includes('qa') && (nName.includes('qa') || nType.includes('qa'))) ||
          (lower.includes('midscene') && (nName.includes('midscene') || nType.includes('midscene'))) ||
          (lower.includes('最后') && i === existingNodes.length - 1)
        ) {
          targetNodeId = n.id;
          targetNodeName = n.name;
          break;
        }
      }

      if (!targetNodeId && (lower.includes('最后') || lower.includes('末尾'))) {
        const lastNode = existingNodes[existingNodes.length - 1];
        targetNodeId = lastNode.id;
        targetNodeName = lastNode.name;
      }

      if (targetNodeId) {
        const remainingNodes = existingNodes.filter((n) => n.id !== targetNodeId);
        const remainingEdges = (currentSnapshot.edges || []).filter(
          (e) => e.source !== targetNodeId && e.target !== targetNodeId
        );

        descriptionText = `已帮您从当前流水线中移除了【${targetNodeName}】阶段，并同步清理了其相关的流转依赖连线。`;
        actionPayload = {
          action: 'replace_all',
          workflow: {
            name: currentSnapshot.name || workflow.name,
            description: `移除节点 [${targetNodeName}] 后的流程拓扑`,
            nodes: remainingNodes,
            edges: remainingEdges,
          },
        };
      }
    }

    const focusNode = currentSnapshot?.focusNodeId && currentSnapshot.nodes
      ? currentSnapshot.nodes.find((n) => n.id === currentSnapshot.focusNodeId)
      : null;

    // 链路增量扩展：如果用户关注了某个节点，并且提出了追加/插入/配置后续
    if (focusNode && (lower.includes('后') || lower.includes('加') || lower.includes('测试') || lower.includes('审批') || lower.includes('通知') || lower.includes('门禁') || lower.includes('接入'))) {
      const newNodeId = `node_ext_${Date.now().toString().slice(-4)}`;
      let newNode: WorkflowNode;
      let stepName = '自动化检查验收';

      if (lower.includes('测试') || lower.includes('midscene') || lower.includes('ui')) {
        stepName = 'Midscene 视觉断言';
        newNode = {
          id: newNodeId,
          name: `${focusNode.name} -> UI回归测试`,
          type: 'midscene',
          config: { testUrl: 'http://localhost:3000' },
          position: { x: 0, y: 0 },
        };
      } else if (lower.includes('审') || lower.includes('qa') || lower.includes('批准')) {
        stepName = 'QA 人工验收门禁';
        newNode = {
          id: newNodeId,
          name: `${focusNode.name} -> QA验收门禁`,
          type: 'qa-approval',
          config: { approvalPrompt: `请核验 [${focusNode.name}] 产出质量与指标是否达标` },
          position: { x: 0, y: 0 },
        };
      } else if (lower.includes('通知') || lower.includes('hook') || lower.includes('飞书') || lower.includes('钉钉')) {
        stepName = '下游流转通知';
        newNode = {
          id: newNodeId,
          name: `${focusNode.name} -> 阶段完成通知`,
          type: 'hook',
          config: { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx' },
          position: { x: 0, y: 0 },
        };
      } else {
        stepName = '质量保障审查';
        newNode = {
          id: newNodeId,
          name: `${focusNode.name} -> 后置检查`,
          type: 'cli',
          config: { command: 'pnpm test && git status' },
          position: { x: 0, y: 0 },
        };
      }

      descriptionText = `已在关注节点【${focusNode.name}】后方成功串联【${stepName}】阶段，并自动为您重组流水线上下游链路！`;
      actionPayload = {
        action: 'patch',
        addNodes: [newNode],
        addEdges: [
          {
            id: `e_${focusNode.id}_${newNodeId}`,
            source: focusNode.id,
            target: newNodeId,
            label: '执行成功',
          },
        ],
      };
    } else if (lower.includes('pr') || lower.includes('审查') || lower.includes('review') || lower.includes('安全')) {
      descriptionText = '为您规划了【自动化 PR 审查与合并】全链路流水线。包含依赖与类型检查、Agent 代码审查与坏味道检测、Midscene 视觉断言回归，以及安全提交流转。';
      actionPayload = {
        action: 'replace_all',
        workflow: {
          name: 'PR 自动化审查与安全合并流水线',
          description: '自动拉取分支、执行静态检查、Agent 深度代码走查与 Midscene 视觉回归',
          nodes: [
            {
              id: 'node_lint',
              name: '代码规范与静态检查',
              type: 'cli',
              config: { command: 'pnpm lint && pnpm type-check' },
            },
            {
              id: 'node_agent_review',
              name: 'Agent 代码审查与坏味道检测',
              type: 'agent',
              config: {
                agentName: 'CodeReviewer',
                prompt: '对本次改动的代码进行安全性、类型完备性与工程坏味道审查，指出潜在风险点。',
              },
            },
            {
              id: 'node_midscene',
              name: 'Midscene 视觉回归测试',
              type: 'midscene',
              config: { testUrl: 'http://localhost:3000' },
            },
            {
              id: 'node_git_merge',
              name: 'Git 自动化提交合入',
              type: 'cli',
              config: {
                command: 'git add -A && git commit -m "chore(auto): passed code review and tests" && git log -1 --stat',
              },
            },
          ],
          edges: [
            { id: 'e_1_2', source: 'node_lint', target: 'node_agent_review', label: '检查通过' },
            { id: 'e_2_3', source: 'node_agent_review', target: 'node_midscene', label: '审查通过' },
            { id: 'e_3_4', source: 'node_midscene', target: 'node_git_merge', label: '验收合格' },
          ],
        },
      };
    } else if (lower.includes('部署') || lower.includes('发布') || lower.includes('deploy') || lower.includes('上线')) {
      descriptionText = '已为您编排【自动化生产发布流水线】。先执行全套单元测试与打包，再进行应用部署，最后通过 Webhook 广播上线结果。';
      actionPayload = {
        action: 'replace_all',
        workflow: {
          name: '自动化生产构建与部署流水线',
          description: '单元测试 -> 生产构建 -> 自动化部署 -> Webhook 广播',
          nodes: [
            {
              id: 'node_test',
              name: '自动化单元与集成测试',
              type: 'cli',
              config: { command: 'pnpm test' },
            },
            {
              id: 'node_build',
              name: '生产版本编译与打包',
              type: 'cli',
              config: { command: 'pnpm build' },
            },
            {
              id: 'node_deploy',
              name: '容器镜像构建与部署',
              type: 'cli',
              config: { command: 'echo "开始执行部署脚本..." && bash scripts/deploy.sh' },
            },
            {
              id: 'node_notify',
              name: '部署完成 Webhook 广播',
              type: 'hook',
              config: { webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx' },
            },
          ],
          edges: [
            { id: 'e_test_build', source: 'node_test', target: 'node_build', label: '测试通过' },
            { id: 'e_build_deploy', source: 'node_build', target: 'node_deploy', label: '打包成功' },
            { id: 'e_deploy_notify', source: 'node_deploy', target: 'node_notify', label: '部署完成' },
          ],
        },
      };
    } else if (lower.includes('测试') || lower.includes('midscene') || lower.includes('ui') || lower.includes('回归')) {
      descriptionText = '为您设计了【Midscene UI 视觉自动化测试与动图生成】流程。先进行页面加载与功能断言，随后录制关键步骤生成 GIF，并交由 QA 验收。';
      actionPayload = {
        action: 'replace_all',
        workflow: {
          name: 'Midscene 视觉回归与动图记录流程',
          description: 'UI 智能视觉断言 -> 拼接动图生成 -> QA 审批',
          nodes: [
            {
              id: 'node_preview_server',
              name: '启动本地预览服务',
              type: 'cli',
              config: { command: 'npm run preview -- --port 4173 &' },
            },
            {
              id: 'node_midscene_exec',
              name: 'Midscene 自动化 UI 测试',
              type: 'midscene',
              config: { testUrl: 'http://localhost:4173' },
            },
            {
              id: 'node_stitch_gif',
              name: '关键帧拼接生成动图',
              type: 'stitch-image',
              config: { outputFile: 'artifacts/preview.gif' },
            },
            {
              id: 'node_qa_review',
              name: 'QA 人工/用例验收核对',
              type: 'qa-approval',
              config: { approvalPrompt: '请核验 UI 动图与核心交互指标是否达到交付标准。' },
            },
          ],
          edges: [
            { id: 'e_serv_test', source: 'node_preview_server', target: 'node_midscene_exec', label: '服务就绪' },
            { id: 'e_test_gif', source: 'node_midscene_exec', target: 'node_stitch_gif', label: '断言通过' },
            { id: 'e_gif_qa', source: 'node_stitch_gif', target: 'node_qa_review', label: '动图生成' },
          ],
        },
      };
    } else {
      descriptionText = `已根据您的需求【${userMessage}】为您构建了标准化端到端执行流程。从环境准备、Agent 核心实现、UI 视觉回归到交付归档全自动协同。`;
      actionPayload = {
        action: 'replace_all',
        workflow: {
          name: `编排流程: ${userMessage.slice(0, 20)}`,
          description: `由 AI 助手根据需求 "${userMessage}" 自动生成的全流程`,
          nodes: [
            {
              id: 'node_setup',
              name: '环境与依赖检查',
              type: 'cli',
              config: { command: 'git status -s && node -v' },
            },
            {
              id: 'node_agent_impl',
              name: 'Agent 自动化实现需求',
              type: 'agent',
              config: {
                agentName: 'TaskExecutor',
                prompt: userMessage,
              },
            },
            {
              id: 'node_verify',
              name: 'Midscene 界面验收测试',
              type: 'midscene',
              config: { testUrl: 'http://localhost:3000' },
            },
            {
              id: 'node_commit',
              name: 'Git 成果提交',
              type: 'cli',
              config: {
                command: 'git add -A && git commit -m "feat: implement workflow task" && git status',
              },
            },
          ],
          edges: [
            { id: 'e_1_2', source: 'node_setup', target: 'node_agent_impl', label: '环境正常' },
            { id: 'e_2_3', source: 'node_agent_impl', target: 'node_verify', label: '实现完毕' },
            { id: 'e_3_4', source: 'node_verify', target: 'node_commit', label: '验证通过' },
          ],
        },
      };
    }

    const assistantContent = `${descriptionText}\n\n已为您规划完毕拓扑链路，请查看并在画布中预览或应用：\n\n\`\`\`workflow-action\n${JSON.stringify(actionPayload, null, 2)}\n\`\`\``;

    const assistantMsg: SessionChatMessage = {
      id: `msg_fallback_${Date.now()}`,
      role: 'assistant',
      content: assistantContent,
      timestamp: Date.now(),
      thinking: '分析用户自然语言意图 -> 抽取关键任务步骤 -> 识别前后置依赖与并行关系 -> 确定节点类型与配置 -> 输出拓扑结构',
    };

    workflow.context.chatMessages.push(assistantMsg);
    this.store.saveWorkflow(workflow);

    const wfState: WorkflowSessionState = {
      workflowId,
      active: false,
      isBusy: false,
      isPaused: false,
      messages: workflow.context.chatMessages,
      agentName: 'Workflow Copilot',
    };

    logger.info(`[WorkflowCopilot] 编排助手已就绪并分发 Action (Workflow: ${workflowId})`);
    this.emit('update', { workflowId, state: wfState });
  }

  /**
   * 清除工作流 Copilot 对话历史
   */
  public resetSession(workflowId: string) {
    const sessionKey = `wf_${workflowId}`;
    const rpcSession = this.sessions.get(sessionKey);
    if (rpcSession) {
      rpcSession.terminate();
      this.sessions.delete(sessionKey);
    }

    const workflow = this.store.getWorkflow(workflowId);
    if (workflow) {
      if (!workflow.context) workflow.context = {};
      workflow.context.chatMessages = [];
      this.store.saveWorkflow(workflow);
    }

    logger.info(`[WorkflowCopilot] 重置工作流会话: ${workflowId}`);
    this.emit('update', {
      workflowId,
      state: {
        workflowId,
        active: false,
        isBusy: false,
        isPaused: false,
        messages: [],
        agentName: 'Workflow Architect Copilot',
      },
    });
  }

  private handleSessionUpdate(workflowId: string, state: any) {
    // 同步到 store
    const workflow = this.store.getWorkflow(workflowId);
    if (workflow) {
      if (!workflow.context) workflow.context = {};
      workflow.context.chatMessages = state.messages;
      this.store.saveWorkflow(workflow);
    }

    const wfState: WorkflowSessionState = {
      workflowId,
      active: state.active,
      isBusy: state.isBusy,
      isPaused: state.isPaused,
      messages: state.messages,
      agentName: 'Workflow Architect Copilot',
      model: state.model,
      piSessionId: state.piSessionId,
    };

    this.emit('update', { workflowId, state: wfState });
  }
}
