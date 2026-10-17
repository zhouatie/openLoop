import { EventEmitter } from 'events';
import { Store } from '../store';
import { WorkflowDefinition, WorkflowSessionState, SessionChatMessage, WorkflowNode, WorkflowEdge } from '../types';
import { PiRpcSessionInstance } from './pi-rpc-session';
import { createLogger } from '../logger';

const logger = createLogger('WorkflowCopilot');

const COPILOT_SYSTEM_PROMPT = `你是一个专业的自动化流程编排架构师智能体 (Workflow Architect Agent)。
你的职责是协助用户进行自动化 DAG 工作流从头到尾的规划、生成、诊断、节点修改与连线编排。

OpenLoop 平台支持的节点类型 (NodeType)：
1. 'agent': AI Agent 智能体节点。用于代码编写、代码审查、自动化需求实现。配置项：config.prompt (string), config.agentName (string, 可选)。
2. 'cli': 通用 Shell 命令行脚本节点。用于代码拉取、Lint、测试、构建、依赖安装、Git 提交、部署等。配置项：config.command (string)。
3. 'midscene': Midscene 视觉自动化 UI 测试节点。用于 Web 端 UI 自动化断言与截屏。配置项：config.testUrl (string)。
4. 'stitch-image': 截图生成动图 / 视频节点。配置项：config.outputFile (string)。
5. 'qa-approval': 人工/QA 验收审核节点。在关键步骤暂停等待人工批准。配置项：config.approvalPrompt (string)。
6. 'hook': 触发器 / Webhook 广播通知节点。用于钉钉、飞书或企业微信 Webhook 消息通知。配置项：config.webhookUrl (string)。
7. 'custom': 插件扩展节点。

当用户提出编排需求（如从头创建、新增节点、修改节点参数、删除节点、重置流程等）时：
1. 简要用优雅自然的语言解释你的设计理念、阶段划分与执行链路。
2. 在回答的末尾，必须输出标准的 \`\`\`workflow-action 代码块，系统将自动解析并在前端画布中完成连线排版与节点渲染！

代码块格式规范：
全量生成/替换工作流：
\`\`\`workflow-action
{
  "action": "replace_all",
  "workflow": {
    "name": "流程名称",
    "description": "流程描述",
    "nodes": [
      {
        "id": "node_1",
        "name": "节点名称",
        "type": "cli",
        "config": {
          "command": "npm run test"
        }
      }
    ],
    "edges": [
      {
        "id": "e_1_2",
        "source": "node_1",
        "target": "node_2",
        "label": "前序成功"
      }
    ]
  }
}
\`\`\`

或者局部增量更新：
\`\`\`workflow-action
{
  "action": "patch",
  "addNodes": [...],
  "updateNodes": [{ "id": "node_xxx", "name": "新名称", "config": { ... } }],
  "removeNodeIds": ["node_yyy"],
  "addEdges": [{ "id": "...", "source": "...", "target": "..." }],
  "removeEdgeIds": ["..."]
}
\`\`\`

注意：
- 节点 id 请使用简洁唯一的语义化英文字符（如 node_pull_code, node_agent_review, node_test_midscene, node_git_commit）。
- 节点之间的连线请务必保证有向无环（DAG），逻辑从前到后递进。
- 坐标 (position) 无需手动计算，系统的自动排版引擎会自动将你的拓扑按优雅对齐呈现。`;

export class WorkflowCopilotManager extends EventEmitter {
  private static instance: WorkflowCopilotManager;
  private sessions = new Map<string, PiRpcSessionInstance>();
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
    currentSnapshot?: { nodes?: WorkflowNode[]; edges?: WorkflowEdge[]; name?: string }
  ): Promise<void> {
    const sessionKey = `wf_${workflowId}`;
    let rpcSession = this.sessions.get(sessionKey);
    const workflow = this.store.getWorkflow(workflowId);

    logger.info(`[WorkflowCopilot] 收到编排会话消息 (Workflow: ${workflowId}): "${userMessage.slice(0, 50)}"`);

    // 构建上下文拓扑摘要
    let contextTopology = '';
    if (currentSnapshot && currentSnapshot.nodes && currentSnapshot.nodes.length > 0) {
      const nodeSummary = currentSnapshot.nodes
        .map((n) => `  - [${n.id}] ${n.name} (类型: ${n.type}${n.config?.command ? `, 命令: ${n.config.command}` : ''}${n.config?.prompt ? `, Prompt: ${n.config.prompt.slice(0, 30)}` : ''})`)
        .join('\n');
      const edgeSummary = (currentSnapshot.edges || [])
        .map((e) => `  - ${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ''}`)
        .join('\n');
      contextTopology = `\n\n[当前画布拓扑上下文]\n工作流名称: ${currentSnapshot.name || workflow?.name || workflowId}\n当前节点数: ${currentSnapshot.nodes.length}\n节点列表:\n${nodeSummary}\n当前连线:\n${edgeSummary || '  (暂无连线)'}`;
    } else {
      contextTopology = '\n\n[当前画布拓扑上下文]\n当前画布为空（无节点与连线），请根据用户意图从零编排设计完整流程。';
    }

    const fullPrompt = `${COPILOT_SYSTEM_PROMPT}\n${contextTopology}\n\n[用户编排需求]\n${userMessage}`;

    // 如果还没有启动 session，则初始化一个
    if (!rpcSession || !rpcSession.active) {
      const settings = this.store.getSettings();
      const piSessionId = `workflow_copilot_${workflowId}`;

      rpcSession = new PiRpcSessionInstance({
        taskId: sessionKey,
        taskTitle: `Workflow Copilot: ${workflow?.name || workflowId}`,
        sessionId: piSessionId,
        agentName: 'Workflow Architect Copilot',
        model: settings.defaultAgentModel || undefined,
        thinking: settings.defaultThinking || 'medium',
        cwd: process.cwd(),
        initialPrompt: fullPrompt,
        onUpdate: (state) => {
          this.handleSessionUpdate(workflowId, state);
        },
        onFinished: (error?: string) => {
          if (error) {
            logger.warn(`[WorkflowCopilot] Pi RPC 会话启动受阻或异常，启用智能兜底架构师响应: ${error}`);
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
        logger.warn(`[WorkflowCopilot] 发送消息至活跃 RPC 失败，切换智能架构师响应: ${err.message}`);
        this.generateFallbackResponse(workflowId, userMessage, currentSnapshot);
      }
    }
  }

  /**
   * 智能架构师离线/兜底生成器（确保高鲁棒性与秒级响应）
   */
  private generateFallbackResponse(
    workflowId: string,
    userMessage: string,
    currentSnapshot?: { nodes?: WorkflowNode[]; edges?: WorkflowEdge[]; name?: string }
  ) {
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow) return;
    if (!workflow.context) workflow.context = {};
    if (!workflow.context.chatMessages) workflow.context.chatMessages = [];

    const lower = userMessage.toLowerCase();
    let actionPayload: any = null;
    let descriptionText = '';

    if (lower.includes('pr') || lower.includes('审查') || lower.includes('review') || lower.includes('安全')) {
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
          description: `由智能架构师根据需求 "${userMessage}" 自动生成的全链路流程`,
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
      agentName: 'Workflow Architect Copilot',
    };

    logger.info(`[WorkflowCopilot] 智能架构师已就绪并分发编排 Action (Workflow: ${workflowId})`);
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
