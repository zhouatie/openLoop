const { execSync } = require('child_process');

const ports = [19888, 5173];

for (const port of ports) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });
      const lines = out.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          execSync(`taskkill /F /PID ${pid}`);
        }
      }
    } else {
      const pids = execSync(`lsof -t -i :${port}`, { encoding: 'utf-8' }).trim().split('\n');
      for (const pid of pids) {
        if (pid) {
          process.kill(parseInt(pid, 10), 'SIGKILL');
        }
      }
    }
  } catch {
    // 端口未被占用，正常忽略
  }
}
