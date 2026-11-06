#!/usr/bin/env node
/**
 * Markdown 流水线与数据库的双向同步。
 *
 * 用法:
 *   node scripts/sync-pipelines.js pull      # 数据库 -> pipelines/*.md
 *   node scripts/sync-pipelines.js push      # pipelines/*.md -> 数据库
 *   node scripts/sync-pipelines.js check     # 只比对，不一致则退出码 1
 *
 * 选项:
 *   --dir <dir>        文档目录，默认 pipelines
 *   --file <path>      只处理指定文件
 *   --data-dir <dir>   数据库目录，默认 ~/.openloop-dev
 *
 * 文件头的 frontmatter 是唯一身份来源，push 会把解析出的 id 写回文件头：
 *   ---
 *   id: wf_xxx
 *   name: 流水线名称
 *   tags: 开发,QA
 *   ---
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

function slug(name) {
  return name
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function parseFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = core.parseMarkdownPipeline(raw, path.basename(file).replace(/\.md$/, ''));
  return { file, header: { id: parsed.id, name: parsed.name, tags: parsed.tags }, body: parsed.body, raw };
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
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f))
    .sort();
}

const contentOf = (wf) => (wf.markdown || '').trim();

function renderFile(wf) {
  const tags = Array.isArray(wf.tags) ? wf.tags : [];
  const header = ['---', `id: ${wf.id}`, `name: ${wf.name}`];
  if (tags.length) header.push(`tags: ${tags.join(',')}`);
  header.push('---');
  return `${header.join('\n')}\n\n${contentOf(wf)}\n`;
}

function normalize(text) {
  return (text || '').replace(/\r\n/g, '\n').trim();
}

function ensureHeaderId(file, parsed, id) {
  if (parsed.header.id === id) return;
  const lines = parsed.raw.split('\n');
  const idx = lines.findIndex((line) => /^id\s*:/.test(line.trim()));
  if (idx >= 0) lines[idx] = `id: ${id}`;
  else lines.splice(1, 0, `id: ${id}`);
  fs.writeFileSync(file, lines.join('\n'));
}

function runPull() {
  const store = new core.Store(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const pipelines = store.getWorkflows().filter((w) => contentOf(w));
  if (pipelines.length === 0) {
    console.log('数据库内没有流水线');
    return 0;
  }
  const byId = new Map();
  for (const file of listFiles()) {
    const parsed = parseFile(file);
    if (parsed.header.id) byId.set(parsed.header.id, file);
  }
  let written = 0;
  for (const wf of pipelines) {
    const file = byId.get(wf.id) || path.join(dir, `${slug(wf.name)}.md`);
    if (normalize(parseFile(file).body) === normalize(contentOf(wf))) {
      console.log(`· 未变化: ${rel(file)}`);
      continue;
    }
    fs.writeFileSync(file, renderFile(wf));
    console.log(`✔ 拉取: ${rel(file)} <- ${wf.name} [${wf.id}]`);
    written += 1;
  }
  console.log(`完成: 更新 ${written} 个文件，数据库共 ${pipelines.length} 条流水线`);
  return 0;
}

function runPush() {
  const store = new core.Store(dataDir);
  const existing = store.getWorkflows();
  const byId = new Map(existing.map((w) => [w.id, w]));
  const files = listFiles();
  if (files.length === 0) {
    console.log(`流水线目录为空: ${path.relative(ROOT, dir)}`);
    return 0;
  }
  let pushed = 0;
  for (const file of files) {
    const parsed = parseFile(file);
    const name = parsed.header.name || path.basename(file, '.md').replace(/-/g, ' ');
    if (!parsed.body.trim()) {
      console.log(`· 跳过空文件: ${rel(file)}`);
      continue;
    }
    const target = (parsed.header.id && byId.get(parsed.header.id)) || existing.find((w) => w.name === name);

    if (target) {
      const sameContent = normalize(contentOf(target)) === normalize(parsed.body);
      const sameName = !parsed.header.name || parsed.header.name === target.name;
      const sameTags = parsed.header.tags.length === 0 || parsed.header.tags.join(',') === (target.tags || []).join(',');
      if (sameContent && sameName && sameTags) {
        ensureHeaderId(file, parsed, target.id);
        console.log(`· 未变化: ${rel(file)}`);
        continue;
      }
      store.saveWorkflow({
        ...target,
        name: parsed.header.name || target.name,
        tags: parsed.header.tags.length ? parsed.header.tags : target.tags,
        markdown: parsed.body,
        updatedAt: Date.now(),
      });
      ensureHeaderId(file, parsed, target.id);
      console.log(`✔ 推送: ${rel(file)} -> ${target.name} [${target.id}]`);
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
      markdown: parsed.body,
    });
    ensureHeaderId(file, parsed, id);
    console.log(`✔ 新建: ${rel(file)} -> ${name} [${id}]`);
    pushed += 1;
  }
  console.log(`完成: 推送 ${pushed} 条流水线到 ${dataDir}`);
  return 0;
}

function runCheck() {
  const store = new core.Store(dataDir);
  const byId = new Map();
  for (const file of listFiles()) {
    const parsed = parseFile(file);
    if (parsed.header.id) byId.set(parsed.header.id, { file, parsed });
  }
  const drifted = [];
  const missingInRepo = [];
  for (const wf of store.getWorkflows().filter((w) => contentOf(w))) {
    const hit = byId.get(wf.id);
    if (!hit) {
      missingInRepo.push(wf);
      continue;
    }
    if (normalize(hit.parsed.body) !== normalize(contentOf(wf))) drifted.push({ wf, file: hit.file });
    byId.delete(wf.id);
  }
  const orphanFiles = [...byId.values()].map((v) => v.file);

  drifted.forEach(({ wf, file }) => console.log(`✘ 内容不同: ${rel(file)} ↔ ${wf.name} [${wf.id}]`));
  missingInRepo.forEach((wf) => console.log(`✘ 仓库里缺少: ${wf.name} [${wf.id}]`));
  orphanFiles.forEach((file) => console.log(`✘ 数据库里没有: ${rel(file)}（执行 push 会新建）`));

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
