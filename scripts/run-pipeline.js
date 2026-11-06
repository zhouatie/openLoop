#!/usr/bin/env node
/**
 * 本地试跑一条 Markdown 流水线，不建看板任务。
 *
 * 用法:
 *   node scripts/run-pipeline.js pipelines/dev-pipeline.md
 *   node scripts/run-pipeline.js pipelines/dev-pipeline.md --workspace ~/My/openLoop --yes
 *
 * 选项:
 *   --workspace <dir>  流水线工作目录，默认当前目录
 *   --title <text>     注入的 task.title，默认文件名
 *   --yes              遇到验收卡点自动通过
 *   --data-dir <dir>   指定数据目录（默认临时目录，跑完删除）
 *   --keep             保留临时数据目录，便于查看步骤与日志
 *
 * 注意: 流水线会真实执行命令与沙箱操作，请先确认 --workspace 指向正确的仓库。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'packages', 'core', 'dist', 'index.js'));

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('-'));
const single = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : fallback;
};

const autoYes = args.includes('--yes');
const keep = args.includes('--keep');
const dataDirArg = single('--data-dir', '');
const workspace = path.resolve(single('--workspace', process.cwd()));

if (!file) {
  console.error('用法: node scripts/run-pipeline.js <流程文档.md> [--workspace <dir>] [--yes]');
  process.exit(1);
}

const pipelinePath = path.resolve(process.cwd(), file);
if (!fs.existsSync(pipelinePath)) {
  console.error(`流程文档不存在: ${pipelinePath}`);
  process.exit(1);
}
if (!pipelinePath.endsWith('.md')) {
  console.error('只支持 Markdown 流水线（.md）');
  process.exit(1);
}

const source = fs.readFileSync(pipelinePath, 'utf8');
const taskTitle = single('--title', path.basename(pipelinePath).replace(/\.md$/, ''));
const dataDir = dataDirArg
  ? path.resolve(dataDirArg.replace(/^~/, os.homedir()))
  : fs.mkdtempSync(path.join(os.tmpdir(), 'openloop-run-'));

const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;

async function main() {
  const store = new core.Store(dataDir);
  const registry = new core.ExecutorRegistry();

  console.log(cyan(`\n▶ 试跑流水线: ${path.relative(process.cwd(), pipelinePath)}`));
  console.log(dim(`  工作目录: ${workspace}`));
  console.log(dim(`  数据目录: ${dataDir}${keep ? '（保留）' : '（临时，结束后删除）'}\n`));

  const host = {
    emit: (event, payload) => {
      if (event === 'node:status' && payload?.status !== 'running') {
        const mark = payload.status === 'success' ? green('✔') : red('✘');
        console.log(`  ${mark} 步骤 ${payload.nodeId} ${payload.status}`);
      }
    },
    log: (taskId, nodeId, stream, message) => {
      const prefix = stream === 'stderr' ? red('!') : dim('·');
      console.log(`  ${prefix} ${dim(`[${nodeId || 'run'}]`)} ${message}`);
    },
  };

  const runtime = new core.MarkdownRuntime(store, registry, host);
  const workflow = store.saveWorkflow({
    id: 'wf_local_run',
    name: taskTitle,
    description: '本地试跑',
    nodes: [],
    edges: [],
    markdown: source,
  });
  store.saveTask({
    id: 'task_local_run',
    title: taskTitle,
    workflowId: workflow.id,
    status: 'pending',
    kanbanColumn: 'inbox',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workspace,
    context: {},
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) =>
    new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    console.log(yellow('\n收到中断，正在终止流水线...'));
    runtime.cancel('task_local_run');
  };
  process.on('SIGINT', onSigint);

  const running = runtime.run(store.getTask('task_local_run'), workflow);

  // 卡点接管：终端里直接决策
  let waiting = false;
  const ticker = setInterval(async () => {
    if (waiting) return;
    const task = store.getTask('task_local_run');
    if (!task || task.status !== 'waiting_approval') return;
    waiting = true;
    const step = task.currentNodeId ? task.nodeRuns[task.currentNodeId] : null;
    const output = step?.output || {};
    console.log(yellow(`\n⏸ 卡点: ${output.stepName || '验收'}`));
    if (output.approvalPrompt) console.log(`  ${output.approvalPrompt}`);
    (output.checklist || []).forEach((item) => console.log(`  - ${item}`));
    const changed = task.context?.worktree?.diffSummary;
    if (changed) console.log(dim(`  改动: ${changed}`));

    let approved;
    if (autoYes) {
      approved = true;
      console.log(green('  自动通过（--yes）'));
    } else {
      const answer = await ask(yellow('  通过？(y/N) '));
      approved = /^y(es)?$/i.test(answer);
    }
    waiting = false;
    runtime.resolveApproval('task_local_run', approved, approved ? '本地试跑通过' : '本地试跑驳回');
  }, 300);

  let exitError = null;
  try {
    await running;
  } catch (err) {
    exitError = err;
  }
  clearInterval(ticker);
  rl.close();
  process.off('SIGINT', onSigint);

  const task = store.getTask('task_local_run');
  const steps = Object.entries(task?.nodeRuns || {});
  console.log('');
  for (const [nodeId, run] of steps) {
    const label = run.output?.stepName || nodeId;
    const mark = run.status === 'success' ? green('✔') : red('✘');
    const cost = run.finishedAt && run.startedAt ? ` ${dim(`${run.finishedAt - run.startedAt}ms`)}` : '';
    console.log(`  ${mark} ${nodeId} ${label}${cost}${run.error ? red(` — ${run.error}`) : ''}`);
  }

  const status = task?.status;
  const ok = status === 'completed';
  console.log(
    ok
      ? green(`\n试跑通过: ${status} / ${task?.kanbanColumn}\n`)
      : red(`\n试跑未通过: ${status} / ${task?.kanbanColumn}${exitError ? ` — ${exitError.message}` : ''}\n`)
  );

  if (!keep && !dataDirArg) fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(red(`试跑启动失败: ${err.message}`));
  process.exit(1);
});
