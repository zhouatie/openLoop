const fs = require('fs');
const path = require('path');
const os = require('os');

const prodDir = path.join(os.homedir(), '.openloop');
const devDir = path.join(os.homedir(), '.openloop-dev');

const prodDbPath = path.join(prodDir, 'openloop.db');
const devDbPath = path.join(devDir, 'openloop.db');

if (!fs.existsSync(prodDbPath)) {
  console.log('\x1b[33m%s\x1b[0m', `未找到稳定版数据库: ${prodDbPath}`);
  console.log('请先在稳定版中运行任务产生数据后再执行克隆。');
  process.exit(0);
}

if (!fs.existsSync(devDir)) {
  fs.mkdirSync(devDir, { recursive: true });
}

// 安全拷贝数据库文件（保留原文件，只做单向快照）
try {
  fs.copyFileSync(prodDbPath, devDbPath);
  
  // 若存在 wal / shm 临时文件一并安全同步
  if (fs.existsSync(`${prodDbPath}-wal`)) {
    fs.copyFileSync(`${prodDbPath}-wal`, `${devDbPath}-wal`);
  }
  if (fs.existsSync(`${prodDbPath}-shm`)) {
    fs.copyFileSync(`${prodDbPath}-shm`, `${devDbPath}-shm`);
  }

  console.log('\x1b[32m%s\x1b[0m', '✔ 数据库快照克隆成功！');
  console.log(`  来源 (稳定版): ${prodDbPath}`);
  console.log(`  目标 (开发沙箱): ${devDbPath}`);
  console.log('\x1b[36m%s\x1b[0m', '现在可以在开发环境 (端口 19889) 自由测试，完全不影响稳定版数据。');
} catch (err) {
  console.error('\x1b[31m%s\x1b[0m', '克隆数据库时发生错误:', err.message);
  process.exit(1);
}
