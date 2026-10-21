const { concurrently } = require('concurrently');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 设置开发沙箱环境变量
process.env.OPENLOOP_PORT = process.env.OPENLOOP_PORT || '19889';
process.env.OPENLOOP_STORE_DIR = process.env.OPENLOOP_STORE_DIR || path.join(os.homedir(), '.openloop-dev');
process.env.VITE_CORE_PORT = process.env.VITE_CORE_PORT || '19889';

// 确保开发数据目录存在
if (!fs.existsSync(process.env.OPENLOOP_STORE_DIR)) {
  fs.mkdirSync(process.env.OPENLOOP_STORE_DIR, { recursive: true });
}

const isDesktop = process.argv.includes('--desktop');

console.log('\x1b[36m%s\x1b[0m', '-------------------------------------------------------');
console.log('\x1b[1m\x1b[36m%s\x1b[0m', '  🚀 openLoop 独立开发沙箱环境已就绪 (Dev Sandbox)');
console.log('\x1b[36m%s\x1b[0m', `  • 开发调度端口 (Core Port): ${process.env.OPENLOOP_PORT}`);
console.log('\x1b[36m%s\x1b[0m', `  • 前端开发服务 (Vite Port): 5173`);
console.log('\x1b[36m%s\x1b[0m', `  • 沙箱数据目录 (Store Dir): ${process.env.OPENLOOP_STORE_DIR}`);
console.log('\x1b[32m%s\x1b[0m', '  ✔ 稳定生产环境严格隔离中 (生产端口: 19888, 目录: ~/.openloop)');
console.log('\x1b[36m%s\x1b[0m', '-------------------------------------------------------\n');

const commands = [
  { command: 'pnpm --filter @openloop/core start', name: 'core', prefixColor: 'cyan', env: process.env },
  { command: 'pnpm --filter @openloop/desktop dev', name: 'web', prefixColor: 'magenta', env: process.env },
];

if (isDesktop) {
  commands.push({
    command: 'npx wait-on tcp:5173 && pnpm --filter @openloop/desktop start',
    name: 'electron',
    prefixColor: 'green',
    env: process.env,
  });
}

const { result } = concurrently(commands, {
  killOthers: ['failure', 'success'],
});

result.then(
  () => process.exit(0),
  () => process.exit(1)
);
