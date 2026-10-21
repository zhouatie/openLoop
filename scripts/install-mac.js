const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('\x1b[36m%s\x1b[0m', '-------------------------------------------------------');
console.log('\x1b[1m\x1b[36m%s\x1b[0m', '  📦 正在构建并就地更新本地 macOS 桌面端应用...');
console.log('\x1b[36m%s\x1b[0m', '-------------------------------------------------------\n');

try {
  // 1. 执行全量构建并打 Mac 本地解压目录包（速度极快，无需制作 DMG 镜像）
  execSync('pnpm run build && npx electron-builder --mac --dir', { stdio: 'inherit' });

  // 2. 查找生成的 .app 目录
  const candidates = [
    path.join(__dirname, '../release/mac-arm64/openLoop.app'),
    path.join(__dirname, '../release/mac/openLoop.app'),
  ];

  let appPath = candidates.find((p) => fs.existsSync(p));
  if (!appPath) {
    // 递归查找 release/ 下以 .app 结尾的目录
    const releaseDir = path.join(__dirname, '../release');
    if (fs.existsSync(releaseDir)) {
      const files = fs.readdirSync(releaseDir);
      for (const f of files) {
        const full = path.join(releaseDir, f);
        if (f.endsWith('.app') && fs.statSync(full).isDirectory()) {
          appPath = full;
          break;
        }
        if (fs.statSync(full).isDirectory()) {
          const subFiles = fs.readdirSync(full);
          const subApp = subFiles.find((sf) => sf.endsWith('.app'));
          if (subApp) {
            appPath = path.join(full, subApp);
            break;
          }
        }
      }
    }
  }

  if (!appPath) {
    console.error('\x1b[31m%s\x1b[0m', '✖ 未在 release 目录下找到生成的 .app 包，请检查构建输出。');
    process.exit(1);
  }

  const targetApp = '/Applications/openLoop.app';
  console.log(`\n正在就地更新应用至: ${targetApp} ...`);

  if (fs.existsSync(targetApp)) {
    execSync(`rm -rf "${targetApp}"`);
  }

  execSync(`cp -R "${appPath}" "${targetApp}"`);

  console.log('\x1b[32m%s\x1b[0m', '-------------------------------------------------------');
  console.log('\x1b[32m%s\x1b[0m', '  ✔ 本地稳定版已成功更新！');
  console.log(`  安装位置: ${targetApp}`);
  console.log('  你可以直接在“启动台”或“访达”中打开最新的稳定版 openLoop。');
  console.log('\x1b[32m%s\x1b[0m', '-------------------------------------------------------\n');
} catch (err) {
  console.error('\x1b[31m%s\x1b[0m', '更新本地应用失败:', err.message);
  process.exit(1);
}
