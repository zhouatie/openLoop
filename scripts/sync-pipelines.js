#!/usr/bin/env node
/**
 * 脚本流水线与数据库的双向同步。
 *
 * 用法:
 *   node scripts/sync-pipelines.js pull      # 数据库 -> pipelines/*.mjs
 *   node scripts/sync-pipelines.js push      # pipelines/*.mjs -> 数据库
 *   node scripts/sync-pipelines.js check     # 只比对，不一致则退出码 1
 *
 * 选项:
 *   --dir <dir>        脚本目录，默认 pipelines
 *   --file <path>      只处理指定文件
 *   --data-dir <dir>   数据库目录，默认 ~/.openloop-dev
 *
 * 文件头是唯一身份来源，push 会把解析出的 id 写回文件头:
 *   // @pipeline id=wf_xxx
 *   // @name 流水线名称
 *   // @tags 开发,QA
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'packages', 'core', 'dist', 'index.js'));

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('-')) || 'check';
const single = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : fallback;
};
const dataDir = single('--data-dir', path.join(os.homedir(), '.openloop-dev'));
const dir = path.resolve(ROOT, single('--dir', 'pipelines'));
const onlyFile = single('--file', '');

const rel = (target) => path.relative(process.cwd(), target);

const HEADER_ID = '// @pipeline id=';
const HEADER_NAME = '// @name ';
const HEADER_TAGS = '// @tags ';

function slug(name) {
  return name
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** 头部注释承载身份信息，正文从第一条非 @ 注释行开始 */
function parseFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const header = { id: '', name: '', tags: [] };
  let cursor = 0;
  while (cursor < lines.length && /^\s*\/\/\s*@/.test(lines[cursor])) {
    const line = lines[cursor];
    if (line.includes('@pipeline')) {
      const hit = /id=([\w-]+)/.exec(line);
      if (hit) header.id = hit[1];
    } else if (line.startsWith(HEADER_NAME)) {
      header.name = line.slice(HEADER_NAME.length).trim();
    } else if (line.startsWith(HEADER_TAGS)) {
      header.tags = line
        .slice(HEADER_TAGS.length)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
    cursor += 1;
  }
  const body = lines.slice(cursor).join('\n').replace(/^\n+/, '');
  return { file, header, body, raw };
}

function listFiles() {
  if (onlyFile) {
    const target = path.resolve(process.cwd(), onlyFile);
    if (!fs.existsSync(target)) throw new Error(`文件不存在: ${target}`);
    return [target];
  }
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))
    .map((f) => path.join(dir, f))
    .sort();
}

function renderFile(wf) {
  const tags = Array.isArray(wf.tags) ? wf.tags : [];
  const header = [HEADER_ID + wf.id, HEADER_NAME + wf.name];
  if (tags.length) header.push(HEADER_TAGS + tags.join(','));
  header.push('// 由 scripts/sync-pipelines.js 维护，修改后执行 push');
  return `${header.join('\n')}\n\n${(wf.script || '').trim()}\n`;
}

function normalize(text) {
  return (text || '').replace(/\r\n/g, '\n').trim();
}

function ensureHeaderId(file, parsed, id) {
  if (parsed.header.id === id) return;
  const lines = parsed.raw.split('\n');
  const idx = lines.findIndex((line) => line.startsWith(HEADER_ID));
  if (idx >= 0) lines[idx] = HEADER_ID + id;
  else lines.unshift(HEADER_ID + id);
  fs.writeFileSync(file, lines.join('\n'));
}

function runPull() {
  const store = new core.Store(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const scripts = store.getWorkflows().filter((w) => (w.script || '').trim());
  if (scripts.length === 0) {
    console.log('数据库内没有脚本流水线');
    return 0;
  }
  const files = listFiles();
  const byId = new Map();
  for (const file of files) {
    const parsed = parseFile(file);
    if (parsed.header.id) byId.set(parsed.header.id, file);
  }
  let written = 0;
  for (const wf of scripts) {
    const existing = byId.get(wf.id);
    const file = existing || path.join(dir, `${slug(wf.name)}.mjs`);
    if (existing && normalize(parseFile(existing).body) === normalize(wf.script)) {
      console.log(`· 未变化: ${rel(file)}`);
      continue;
    }
    fs.writeFileSync(file, renderFile(wf));
    console.log(`✔ 拉取: ${rel(file)} <- ${wf.name} [${wf.id}]`);
    written += 1;
  }
  console.log(`完成: 更新 ${written} 个文件，数据库共 ${scripts.length} 条脚本流水线`);
  return 0;
}

function runPush() {
  const store = new core.Store(dataDir);
  const existing = store.getWorkflows();
  const byId = new Map(existing.map((w) => [w.id, w]));
  const files = listFiles();
  if (files.length === 0) {
    console.log(`脚本目录为空: ${path.relative(ROOT, dir)}`);
    return 0;
  }
  let pushed = 0;
  for (const file of files) {
    const parsed = parseFile(file);
    const name = parsed.header.name || path.basename(file).replace(/\.m?js$/, '').replace(/-/g, ' ');
    if (!parsed.body.trim()) {
      console.log(`· 跳过空文件: ${rel(file)}`);
      continue;
    }
    const target =
      (parsed.header.id && byId.get(parsed.header.id)) || existing.find((w) => w.name === name);

    if (target) {
      const graphNodes = (target.nodes || []).length;
      const sameScript = normalize(target.script) === normalize(parsed.body);
      const sameName = !parsed.header.name || parsed.header.name === target.name;
      const sameTags =
        parsed.header.tags.length === 0 ||
        parsed.header.tags.join(',') === (target.tags || []).join(',');
      if (sameScript && sameName && sameTags) {
        ensureHeaderId(file, parsed, target.id);
        console.log(`· 未变化: ${rel(file)}`);
        continue;
      }
      store.saveWorkflow({
        ...target,
        name: parsed.header.name || target.name,
        tags: parsed.header.tags.length ? parsed.header.tags : target.tags,
        nodes: [],
        edges: [],
        script: parsed.body,
        updatedAt: Date.now(),
      });
      ensureHeaderId(file, parsed, target.id);
      console.log(
        `✔ 推送: ${rel(file)} -> ${target.name} [${target.id}]` +
          (graphNodes ? `（已清空 ${graphNodes} 个画布节点）` : '')
      );
      pushed += 1;
      continue;
    }

    const id = parsed.header.id || `wf_${Date.now().toString(36)}`;
    store.saveWorkflow({
      id,
      name,
      description: '',
      tags: parsed.header.tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodes: [],
      edges: [],
      script: parsed.body,
    });
    ensureHeaderId(file, parsed, id);
    console.log(`✔ 新建: ${rel(file)} -> ${name} [${id}]`);
    pushed += 1;
  }
  console.log(`完成: 推送 ${pushed} 条脚本流水线到 ${dataDir}`);
  return 0;
}

function runCheck() {
  const store = new core.Store(dataDir);
  const files = listFiles();
  const byId = new Map();
  for (const file of files) {
    const parsed = parseFile(file);
    if (!parsed.header.id) continue;
    byId.set(parsed.header.id, { file, parsed });
  }
  const drifted = [];
  const missingInRepo = [];
  for (const wf of store.getWorkflows().filter((w) => (w.script || '').trim())) {
    const hit = byId.get(wf.id);
    if (!hit) {
      missingInRepo.push(wf);
      continue;
    }
    if (normalize(hit.parsed.body) !== normalize(wf.script)) drifted.push({ wf, file: hit.file });
    byId.delete(wf.id);
  }
  const orphanFiles = [...byId.values()].map((v) => v.file);

  drifted.forEach(({ wf, file }) =>
    console.log(`✘ 内容不同: ${rel(file)} ↔ ${wf.name} [${wf.id}]`)
  );
  missingInRepo.forEach((wf) => console.log(`✘ 仓库里缺少: ${wf.name} [${wf.id}]`));
  orphanFiles.forEach((file) =>
    console.log(`✘ 数据库里没有: ${rel(file)}（执行 push 会新建）`)
  );

  if (drifted.length + missingInRepo.length + orphanFiles.length === 0) {
    console.log('✔ 仓库与数据库一致');
    return 0;
  }
  console.log('执行 pull 或 push 对齐，再记录到 git');
  return 1;
}

try {
  const runners = { pull: runPull, push: runPush, check: runCheck };
  const runner = runners[mode];
  if (!runner) {
    console.error(`未知命令: ${mode}（可用: pull / push / check）`);
    process.exit(1);
  }
  process.exit(runner());
} catch (err) {
  console.error(`同步失败: ${err.message}`);
  process.exit(1);
}
