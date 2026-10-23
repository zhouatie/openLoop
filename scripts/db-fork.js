const fs = require('fs');
const path = require('path');
const os = require('os');

// better-sqlite3 是 packages/core 的依赖，从 core 解析避免 pnpm 非提升布局下找不到
const Database = require(require.resolve('better-sqlite3', { paths: [path.join(__dirname, '../packages/core')] }));

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

// 使用 SQLite 官方快照语义克隆（VACUUM INTO）
// 不要直接拷贝 .db / -wal / -shm：WAL 模式下三份文件非原子，会产出页账目不匹配的残库
try {
  for (const suffix of ['', '-wal', '-shm']) {
    const stale = devDbPath + suffix;
    if (fs.existsSync(stale)) fs.rmSync(stale, { force: true });
  }

  const src = new Database(prodDbPath, { readonly: true, fileMustExist: true });
  try {
    src.exec(`VACUUM INTO '${devDbPath.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }

  const check = new Database(devDbPath, { readonly: true });
  const integrity = check.pragma('integrity_check', { simple: true });
  check.close();
  if (integrity !== 'ok') {
    throw new Error(`克隆结果未通过完整性检查: ${integrity}`);
  }

  console.log('\x1b[32m%s\x1b[0m', '✔ 数据库快照克隆成功！');
  console.log(`  来源 (稳定版): ${prodDbPath}`);
  console.log(`  目标 (开发沙箱): ${devDbPath}`);
  console.log('\x1b[36m%s\x1b[0m', '现在可以在开发环境 (端口 19889) 自由测试，完全不影响稳定版数据。');
} catch (err) {
  console.error('\x1b[31m%s\x1b[0m', '克隆数据库时发生错误:', err.message);
  process.exit(1);
}
