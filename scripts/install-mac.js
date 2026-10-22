#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');

// 直接调用优化后的 pack.js 执行极速本地更新安装
const packScript = path.join(__dirname, 'pack.js');
const child = spawn(process.execPath, [packScript, '--install'], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
