#!/usr/bin/env node
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// ==========================================
// 终端 ANSI 样式常量
// ==========================================
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PREFERRED_IDENTITY = 'openLoop Local';

// ==========================================
// 工具函数
// ==========================================
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function resolveSigningIdentity(mode) {
  if (process.env.CSC_NAME) return process.env.CSC_NAME;
  // 发布产物（DMG/ZIP）始终使用 ad-hoc，禁止本机自签名证书进入发布链路
  if (mode !== 'install') return '-';
  try {
    const out = execSync('security find-identity -v -p codesigning', { encoding: 'utf-8' });
    const names = [...out.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // 仅当存在以 openLoop Local 命名的专属本地签名时才复用（锁定系统权限）
    const localCert = names.find((n) => n.startsWith(PREFERRED_IDENTITY));
    if (localCert) return localCert;
    // 未安装本地证书时回退为 '-'（离线 ad-hoc 极速签名），避免误用 Apple 开发者证书触发网络握手超时
    return '-';
  } catch {
    return '-';
  }
}

function getHostArch() {
  return os.arch() === 'arm64' ? 'arm64' : 'x64';
}

function runStep(title, command, options = {}) {
  const start = Date.now();
  process.stdout.write(`  ${c.cyan}⏳${c.reset} ${title} ... `);

  try {
    execSync(command, {
      cwd: PROJECT_ROOT,
      stdio: options.verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    });
    const elapsed = Date.now() - start;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`  ${c.green}✔${c.reset} ${title} ${c.dim}(${formatDuration(elapsed)})${c.reset}`);
    return { success: true, duration: elapsed };
  } catch (err) {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`  ${c.red}✖${c.reset} ${title} ${c.red}失败${c.reset}`);
    if (err.stderr) {
      console.error(`\n${c.red}${err.stderr.toString().trim()}${c.reset}\n`);
    } else if (err.stdout) {
      console.error(`\n${c.red}${err.stdout.toString().trim()}${c.reset}\n`);
    } else {
      console.error(`\n${c.red}${err.message}${c.reset}\n`);
    }
    throw err;
  }
}

// ==========================================
// 构建执行器
// ==========================================
async function executeBuild(mode) {
  const hostArch = getHostArch();
  const identity = resolveSigningIdentity(mode);
  const signArg = identity ? ` --config.mac.identity="${identity}"` : '';

  console.log('\n' + c.cyan + '┌────────────────────────────────────────────────────────┐' + c.reset);
  console.log(c.cyan + '│' + c.bold + '  ⚡ openLoop 极速构建与打包控制台                     ' + c.cyan + '│' + c.reset);
  console.log(c.cyan + '└────────────────────────────────────────────────────────┘' + c.reset);

  const modeDescriptions = {
    install: `🚀 极速本地安装 (/Applications, ${hostArch})`,
    current: `📦 当前架构安装包 (${hostArch} DMG + ZIP)`,
    all: `🌐 全平台双架构发布包 (arm64 + x64 DMG + ZIP)`,
    dir: `📂 应用解压目录 (Unpacked, ${hostArch})`,
  };

  console.log(`${c.dim}  • 目标方案 :${c.reset} ${c.bold}${modeDescriptions[mode] || mode}${c.reset}`);
  console.log(`${c.dim}  • 宿主架构 :${c.reset} ${hostArch}`);
  console.log(
    `${c.dim}  • 签名身份 :${c.reset} ${identity ? `${c.green}${identity}${c.reset}` : `${c.yellow}ad-hoc (无固定签名)${c.reset}`}`
  );
  console.log(`${c.dim}  • 增量缓存 :${c.reset} ${c.green}已启用 (TypeScript Incremental)${c.reset}`);
  if (mode === 'install' && identity === '-') {
    console.log(
      `${c.dim}  • 权限提示 :${c.reset} ${c.yellow}未安装 "${PREFERRED_IDENTITY}" 证书，ad-hoc 签名会让 macOS 重置磁盘权限${c.reset}`
    );
  }
  console.log('');

  const totalStart = Date.now();
  const stepDurations = [];

  try {
    // 步骤 1: 编译 Core 服务（跳过无关的 CLI）
    const s1 = runStep('编译核心引擎 (@openloop/core)', 'pnpm --filter @openloop/core build');
    stepDurations.push({ name: 'Core 引擎', duration: s1.duration });

    // 步骤 2: 构建前端渲染层（Vite manualChunks 分包）
    const s2 = runStep('构建前端渲染层 (Vite)', 'pnpm --filter @openloop/desktop build:renderer');
    stepDurations.push({ name: '前端渲染层', duration: s2.duration });

    // 步骤 3: 编译桌面主进程（Electron Main TS 增量编译）
    const s3 = runStep('构建桌面主进程 (Electron)', 'pnpm --filter @openloop/desktop build:electron');
    stepDurations.push({ name: '桌面主进程', duration: s3.duration });

    // 步骤 4: 执行 electron-builder
    let builderCmd = '';
    let stepTitle = '';

    if (mode === 'install') {
      builderCmd = `npx electron-builder --mac --dir --${hostArch}${signArg}`;
      stepTitle = `生成应用目录 (electron-builder --dir --${hostArch})`;
    } else if (mode === 'dir') {
      builderCmd = `npx electron-builder --mac --dir --${hostArch}${signArg}`;
      stepTitle = `生成应用目录 (electron-builder --dir --${hostArch})`;
    } else if (mode === 'current') {
      builderCmd = `npx electron-builder --mac --${hostArch}${signArg}`;
      stepTitle = `打包当前架构镜像 (electron-builder --${hostArch})`;
    } else if (mode === 'all') {
      builderCmd = `npx electron-builder --mac${signArg}`;
      stepTitle = `打包双架构完整镜像 (electron-builder --mac)`;
    }

    const s4 = runStep(stepTitle, builderCmd);
    stepDurations.push({ name: 'Electron 打包', duration: s4.duration });

    // 步骤 5: 如果是 install 模式，执行就地热替换与权限声明
    if (mode === 'install') {
      const s5Start = Date.now();
      process.stdout.write(`  ${c.cyan}⏳${c.reset} 就地同步至 /Applications/openLoop.app ... `);

      const candidates = [
        path.join(PROJECT_ROOT, `release/mac-${hostArch}/openLoop.app`),
        path.join(PROJECT_ROOT, 'release/mac/openLoop.app'),
      ];

      let appPath = candidates.find((p) => fs.existsSync(p));
      if (!appPath) {
        const releaseDir = path.join(PROJECT_ROOT, 'release');
        if (fs.existsSync(releaseDir)) {
          const files = fs.readdirSync(releaseDir);
          for (const f of files) {
            const full = path.join(releaseDir, f);
            if (f.endsWith('.app') && fs.statSync(full).isDirectory()) {
              appPath = full;
              break;
            }
          }
        }
      }

      if (!appPath) {
        throw new Error('未在 release 目录下找到生成的 .app 文件');
      }

      const targetApp = '/Applications/openLoop.app';
      if (fs.existsSync(targetApp)) {
        execSync(`rm -rf "${targetApp}"`);
      }
      execSync(`cp -R "${appPath}" "${targetApp}"`);

      try {
        execSync(`xattr -cr "${targetApp}"`);
      } catch {}

      const s5Elapsed = Date.now() - s5Start;
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${c.green}✔${c.reset} 同步至 /Applications/openLoop.app ${c.dim}(${formatDuration(s5Elapsed)})${c.reset}`);
      stepDurations.push({ name: '本地安装部署', duration: s5Elapsed });
    }

    const totalElapsed = Date.now() - totalStart;

    // ==========================================
    // 优雅卡片汇报
    // ==========================================
    console.log('\n' + c.green + '┌────────────────────────────────────────────────────────┐' + c.reset);
    console.log(c.green + '│' + c.bold + '  🎉 构建成功！(Build Completed Successfully)            ' + c.green + '│' + c.reset);
    console.log(c.green + '└────────────────────────────────────────────────────────┘' + c.reset);

    console.log(`  ${c.bold}⏱  总计耗时:${c.reset} ${c.green}${c.bold}${formatDuration(totalElapsed)}${c.reset}`);
    const breakdown = stepDurations.map((s) => `${s.name}: ${formatDuration(s.duration)}`).join('  |  ');
    console.log(`  ${c.dim}分步耗时:${c.reset} ${c.dim}${breakdown}${c.reset}\n`);

    if (mode === 'install') {
      console.log(`  ${c.bold}📍 安装路径:${c.reset} ${c.cyan}/Applications/openLoop.app${c.reset}`);
      console.log(`  ${c.dim}提示: 应用已具备完整签名与 PATH 环境，可直接在启动台或终端启动。${c.reset}\n`);
    } else {
      const releaseDir = path.join(PROJECT_ROOT, 'release');
      if (fs.existsSync(releaseDir)) {
        console.log(`  ${c.bold}📦 输出产物 (release/):${c.reset}`);
        const files = fs.readdirSync(releaseDir);
        for (const file of files) {
          if (file.endsWith('.dmg') || file.endsWith('.zip') || file.endsWith('.app')) {
            const stat = fs.statSync(path.join(releaseDir, file));
            const sizeStr = stat.isDirectory() ? '目录包' : formatBytes(stat.size);
            console.log(`    • ${c.cyan}${file}${c.reset} ${c.dim}(${sizeStr})${c.reset}`);
          }
        }
        console.log(`\n  ${c.dim}如需在 Finder 查看产物，可执行: open release/${c.reset}\n`);
      }
    }
  } catch (err) {
    console.error(`\n${c.red}✖ 构建流程异常中止${c.reset}`);
    process.exit(1);
  }
}

// ==========================================
// 交互式菜单入口
// ==========================================
function promptInteractive() {
  const hostArch = getHostArch();
  console.log('\n' + c.cyan + '┌────────────────────────────────────────────────────────┐' + c.reset);
  console.log(c.cyan + '│' + c.bold + '  ⚡ openLoop 构建目标选择                              ' + c.cyan + '│' + c.reset);
  console.log(c.cyan + '└────────────────────────────────────────────────────────┘' + c.reset);
  console.log(`  ${c.bold}请选择本次构建操作 (直接回车默认选 1):${c.reset}\n`);
  console.log(`    ${c.green}${c.bold}1${c.reset}  🚀 极速本地安装 (/Applications, ${hostArch}, 约 10s) ${c.dim}[推荐日常测试]${c.reset}`);
  console.log(`    ${c.blue}${c.bold}2${c.reset}  📦 当前架构发布包 (${hostArch} DMG + ZIP, 约 25s)`);
  console.log(`    ${c.magenta}${c.bold}3${c.reset}  🌐 全平台双架构包 (arm64 + x64 DMG + ZIP, 适合正式发版)`);
  console.log(`    ${c.yellow}${c.bold}4${c.reset}  📂 仅生成应用目录 (release/mac-${hostArch}/openLoop.app)`);
  console.log(`    ${c.red}${c.bold}0${c.reset}  退出\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(`  输入选项 [1]: `, (answer) => {
    rl.close();
    const choice = answer.trim() || '1';
    switch (choice) {
      case '1':
        executeBuild('install');
        break;
      case '2':
        executeBuild('current');
        break;
      case '3':
        executeBuild('all');
        break;
      case '4':
        executeBuild('dir');
        break;
      case '0':
        console.log('已取消构建。');
        process.exit(0);
        break;
      default:
        console.log(`无效选项: ${choice}，已取消。`);
        process.exit(1);
    }
  });
}

// ==========================================
// 主函数
// ==========================================
function main() {
  const args = process.argv.slice(2);

  if (args.includes('--install') || args.includes('-i')) {
    return executeBuild('install');
  }
  if (args.includes('--current') || args.includes('--mac') || args.includes('-c')) {
    return executeBuild('current');
  }
  if (args.includes('--all') || args.includes('-a')) {
    return executeBuild('all');
  }
  if (args.includes('--dir') || args.includes('-d')) {
    return executeBuild('dir');
  }

  // 无参数时，如果处于 TTY 交互终端则弹出菜单，否则默认使用 install 模式
  if (process.stdin.isTTY) {
    promptInteractive();
  } else {
    executeBuild('install');
  }
}

main();
