#!/usr/bin/env node
/**
 * 校验入口文档里的相对链接是否指向真实文件，避免改名后文档失链。
 * 只扫仓库根目录与 docs/ 下的 markdown，跳过外链、锚点与图片以外的引用协议。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  'README.md',
  'README.en.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'docs',
];

const isExternal = (link) => /^(https?:|mailto:|tel:|#)/i.test(link);

function collectMarkdown(entry, out = []) {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) return out;
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(abs)) {
      if (name === 'node_modules') continue;
      collectMarkdown(path.join(entry, name), out);
    }
    return out;
  }
  if (entry.endsWith('.md')) out.push(entry);
  return out;
}

function linksOf(content) {
  const links = [];
  const pattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) links.push(match[1]);
  return links;
}

const broken = [];

for (const file of TARGETS.flatMap((entry) => collectMarkdown(entry))) {
  const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const raw of linksOf(content)) {
    const link = raw.split('#')[0];
    if (!link || isExternal(link)) continue;
    const target = path.resolve(ROOT, path.dirname(file), decodeURIComponent(link));
    if (!target.startsWith(ROOT) || !fs.existsSync(target)) {
      broken.push(`${file} -> ${raw}`);
    }
  }
}

if (broken.length > 0) {
  console.error(`[docs-links] ${broken.length} 个失效链接:`);
  for (const item of broken) console.error(`  - ${item}`);
  process.exit(1);
}

console.log('[docs-links] 入口文档链接全部有效');
