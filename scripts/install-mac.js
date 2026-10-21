const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 优先使用的固定本地签名身份；可用 CSC_NAME 覆盖
const PREFERRED_IDENTITY = 'openLoop Local';

// 复用固定签名身份，让 designated requirement 跨构建保持稳定
// ad-hoc 签名的 requirement 是 cdhash，每次构建都会变化，macOS 因此会重置已授予的系统权限
function resolveSigningIdentity() {
  if (process.env.CSC_NAME) return process.env.CSC_NAME;
  try {
    const out = execSync('security find-identity -v -p codesigning', { encoding: 'utf-8' });
    const names = [...out.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return names.find((n) => n.startsWith(PREFERRED_IDENTITY)) || names[0] || null;
  } catch {
    return null;
  }
}

console.log('\x1b[36m%s\x1b[0m', '-------------------------------------------------------');
console.log('\x1b[1m\x1b[36m%s\x1b[0m', '  📦 正在构建并就地更新本地 macOS 桌面端应用...');
console.log('\x1b[36m%s\x1b[0m', '-------------------------------------------------------\n');

try {
  const identity = resolveSigningIdentity();
  const signArg = identity ? ` --config.mac.identity="${identity}"` : '';

  // 1. 执行全量构建并打 Mac 本地解压目录包（速度极快，无需制作 DMG 镜像）
  execSync(`pnpm run build && npx electron-builder --mac --dir${signArg}`, { stdio: 'inherit' });

  // 2. 查找生成的 .app 目录
  const candidates = [
    path.join(__dirname, '../release/mac-arm64/openLoop.app'),
    path.join(__dirname, '../release/mac/openLoop.app'),
  ];

  let appPath = candidates.find((p) => fs.existsSync(p));
  if (!appPath) {
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

  // 3. 自动清除 macOS Gatekeeper 隔离属性（防止拦截与签名权限警告）
  console.log('正在解除系统隔离限制与清除 Quarantine 标识...');
  try {
    execSync(`xattr -cr "${targetApp}"`);
  } catch {}

  console.log('\x1b[32m%s\x1b[0m', '-------------------------------------------------------');
  console.log('\x1b[32m%s\x1b[0m', '  ✔ 本地稳定版已成功更新！');
  console.log(`  安装位置: ${targetApp}`);
  console.log('  已自动注入完整 Shell PATH 环境 (mws, git, pnpm, node 开箱即用)');
  console.log('  已保留原生签名与 Entitlements 特权声明');
  console.log(
    identity
      ? `  固定签名身份: ${identity}（重装不再重置系统授权）`
      : '  ⚠ 未找到可用签名身份，本次以 ad-hoc 签名打包，系统授权可能需重新确认'
  );
  console.log('\x1b[32m%s\x1b[0m', '-------------------------------------------------------');

} catch (err) {
  console.error('\x1b[31m%s\x1b[0m', '更新本地应用失败:', err.message);
  process.exit(1);
}
