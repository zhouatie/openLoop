#!/usr/bin/env node
/**
 * 把编排画布里的流水线转译成脚本流水线。
 *
 * 用法:
 *   node scripts/transpile-workflow.js --name "openLoop 开发专用流水线"
 *   node scripts/transpile-workflow.js --name "A" --name "B" --apply --data-dir ~/.openloop-dev
 *
 * 不带 --apply 时只生成脚本文件到 pipelines/，不改数据库。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const core = require(path.join(__dirname, '..', 'packages', 'core', 'dist', 'index.js'));

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const pickAll = (flag) => args.reduce((acc, cur, idx) => (cur === flag ? acc.concat(args[idx + 1]) : acc), []);
const names = pickAll('--name');
const single = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : fallback;
};
const dataDir = single('--data-dir', path.join(os.homedir(), '.openloop-dev'));
const outDir = path.join(__dirname, '..', 'pipelines');

/** 线性链路改写：只支持单入口、每个节点出度 <= 1 */
function orderNodes(wf) {
  const incoming = new Map(wf.nodes.map((n) => [n.id, 0]));
  for (const e of wf.edges) incoming.set(e.target, (incoming.get(e.target) || 0) + 1);
  const outgoing = new Map(wf.nodes.map((n) => [n.id, []]));
  for (const e of wf.edges) {
    const list = outgoing.get(e.source);
    if (list) list.push(e.target);
  }
  for (const [id, list] of outgoing) {
    if (list.length > 1) throw new Error(`节点 ${id} 存在分支，转译仅支持线性链路`);
  }
  const starts = wf.nodes.filter((n) => (incoming.get(n.id) || 0) === 0);
  if (starts.length !== 1) throw new Error(`流水线存在 ${starts.length} 个入口节点，转译仅支持线性链路`);

  const byId = new Map(wf.nodes.map((n) => [n.id, n]));
  const ordered = [];
  let cursor = starts[0];
  const seen = new Set();
  while (cursor) {
    if (seen.has(cursor.id)) throw new Error('流水线存在回环，转译仅支持线性链路');
    seen.add(cursor.id);
    ordered.push(cursor);
    const next = outgoing.get(cursor.id) || [];
    cursor = next.length ? byId.get(next[0]) : undefined;
  }
  if (ordered.length !== wf.nodes.length) throw new Error('流水线存在游离节点，转译仅支持线性链路');
  return ordered;
}

const isIdent = (key) => /^[A-Za-z_$][\w$]*$/.test(key);
const keyText = (key) => (isIdent(key) ? key : JSON.stringify(key));

/** 生成缩进对齐的对象字面量，键名能省引号就省 */
function objLiteral(obj, indent) {
  const entries = Object.entries(obj).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return '{}';
  const pad = ' '.repeat(indent);
  const body = entries
    .map(([key, value]) => {
      const text = JSON.stringify(value, null, 2).replace(/\n/g, `\n${pad}  `);
      return `${pad}  ${keyText(key)}: ${text}`;
    })
    .join(',\n');
  return `{\n${body},\n${pad}}`;
}

/** 节点名自带编号时不再重复编号 */
function stepLabel(node) {
  return node.name.replace(/^\s*\d+[.、]\s*/, '').trim() || node.id;
}

function emitStep(node, index) {
  const label = stepLabel(node);
  const config = node.config || {};
  const varName = `step${index + 1}`;
  const call = { name: label };
  let expr;

  if (node.type === 'worktree-setup') {
    expr = `sandbox.create(${objLiteral({ ...config, name: label }, 2)})`;
  } else if (node.type === 'worktree-merge') {
    expr = `sandbox.merge(${objLiteral(call, 2)})`;
  } else if (node.type === 'worktree-cleanup') {
    expr = `sandbox.cleanup(${objLiteral(call, 2)})`;
  } else if (node.type === 'agent') {
    expr = `agent(${objLiteral(
      {
        prompt: config.prompt || '',
        agentName: config.agentName || 'OpenLoop Agent',
        timeoutSec: config.timeoutSec,
        name: label,
      },
      2
    )})`;
  } else if (node.type === 'qa-approval') {
    expr = `approve(${objLiteral(
      {
        title: label,
        prompt: config.approvalPrompt || '',
        checklist: Array.isArray(config.checklist) ? config.checklist : [],
      },
      2
    )})`;
  } else {
    expr = `node(${JSON.stringify(node.type)}, ${objLiteral(config, 2)}, ${objLiteral(call, 2)})`;
  }

  return [
    `  // ${label} (${node.type})`,
    `  const ${varName} = await ${expr}`,
    `  if (!${varName}.ok) return { status: 'failed', error: ${JSON.stringify(`节点「${label}」执行未通过`)} }`,
  ].join('\n');
}

function buildScript(wf) {
  const ordered = orderNodes(wf);
  const body = ordered.map((node, idx) => emitStep(node, idx)).join('\n\n');
  return `/**\n * ${wf.name}\n * 由编排画布转译生成的脚本流水线。\n */\nexport default async function (ctx) {\n  const { sandbox, agent, approve, node, log } = ctx\n\n  log(${JSON.stringify(`启动流水线: ${wf.name}`)})\n\n${body}\n\n  return { status: 'success' }\n}\n`;
}

/** 读取文件头部的 @ 元数据行，用于重跑时保留身份 */
function readHeader(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const kept = [];
  for (const line of lines) {
    if (!/^\s*\/\/\s*@/.test(line)) break;
    kept.push(line);
  }
  return kept.length ? `${kept.join('\n')}\n\n` : '';
}

function slug(name) {
  return name
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

const store = new core.Store(dataDir);
const all = store.getWorkflows();
const targets = names.length
  ? names.map((name) => {
      const hit = all.find((w) => w.name === name) || all.find((w) => w.name.includes(name));
      if (!hit) throw new Error(`未找到流水线: ${name}`);
      return hit;
    })
  : [];

if (targets.length === 0) {
  console.error('请用 --name 指定要转译的流水线名称');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

for (const wf of targets) {
  let script;
  try {
    script = buildScript(wf);
  } catch (err) {
    console.error(`✘ ${wf.name}: ${err.message}`);
    continue;
  }

  const file = path.join(outDir, `${slug(wf.name)}.mjs`);
  // 重跑时保留文件头（id/name/tags），否则同步命令会把它当成新流水线
  const header = fs.existsSync(file) ? readHeader(file) : '';
  fs.writeFileSync(file, header + script);
  console.log(`✔ 生成脚本: ${path.relative(process.cwd(), file)} (${script.length} 字节)`);

  if (apply) {
    store.saveWorkflow({
      ...wf,
      nodes: [],
      edges: [],
      script,
    });
    console.log(`✔ 已写入数据库(${dataDir}): ${wf.name} [${wf.id}]`);
  }
}

if (!apply) console.log('提示: 加 --apply 才会写回数据库');
