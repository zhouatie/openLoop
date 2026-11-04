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
