/**
 * 把 tsc 不会处理的静态资源复制进 dist
 * 目前只有 ESM 桥 assets/pi-sdk.mjs，缺了它运行时会话建不起来。
 */
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'src', 'agent', 'assets');
const target = path.join(__dirname, '..', 'dist', 'agent', 'assets');

fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });
console.log(`[core] 静态资源已复制: ${path.relative(process.cwd(), target)}`);

const binSource = path.join(__dirname, '..', 'bin');
const binTarget = path.join(__dirname, '..', 'dist', 'bin');
if (fs.existsSync(binSource)) {
  fs.mkdirSync(binTarget, { recursive: true });
  fs.cpSync(binSource, binTarget, { recursive: true });
  console.log(`[core] 驱动工具已复制: ${path.relative(process.cwd(), binTarget)}`);
}
