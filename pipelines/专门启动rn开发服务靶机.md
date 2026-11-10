---
id: wf_mvqbtjst
name: 专门启动rn开发服务靶机
tags: RN,工作
---

# 目标

独立拉起 React Native 开发环境靶机并探活，支持 Node 14 运行时与端口自动清理

# 流程

## 1. 开发服务靶机就绪 (局域网 Metro)

调 `run_node`，type 用 `env-prepare` 拉起开发服务靶机。超时 120 秒。
就绪检查地址用 `http://127.0.0.1:{{webPort}}/status`。
预热最长等待 180000 毫秒。
config 里的 command 用下面这段命令原文，不要改写：

```bash
APP_SUB_DIR='{{appSubDir}}'
echo "[Dev Server] 当前执行目录: $(pwd)"

# 1. 应用根目录定位: 显式变量 appSubDir 优先, 其次当前目录 package.json, 最后浅层自动探测
if [ -n "$APP_SUB_DIR" ] && [ "$APP_SUB_DIR" != "{{appSubDir}}" ]; then
  APP_SUB_DIR="${APP_SUB_DIR%/}"
  if [ ! -d "$APP_SUB_DIR" ]; then
    echo "[Dev Server] 错误: appSubDir 指向的目录不存在: $APP_SUB_DIR"
    echo "[Dev Server] 处理: 检查流水线变量 appSubDir, 或在启动前微调为正确的相对路径"
    exit 1
  fi
  cd "$APP_SUB_DIR"
  echo "[Dev Server] 按 appSubDir 切换至应用目录: $(pwd)"
elif [ -f "package.json" ]; then
  echo "[Dev Server] 当前目录即为应用根目录: $(pwd)"
else
  FOUND_DIR=$(find . -maxdepth 3 -name "package.json" -not -path "*/node_modules/*" 2>/dev/null | head -n 1 | xargs -r dirname)
  if [ -n "$FOUND_DIR" ] && [ -d "$FOUND_DIR" ]; then
    cd "$FOUND_DIR"
    echo "[Dev Server] 自动定位到应用目录: $(pwd)"
  else
    echo "[Dev Server] 错误: 未能在当前目录或子目录找到 package.json, 请确认是否已选择正确的工作区工程"
    exit 1
  fi
fi

# 2. 依赖检查提示
if [ ! -d "node_modules" ]; then
  echo "[Dev Server] 警告: 当前工程目录下未检测到 node_modules, 若未安装依赖可能导致启动失败"
fi

# 3. 端口解析与旧进程释放
WEB_PORT='{{webPort}}'
if [ -z "$WEB_PORT" ] || [ "$WEB_PORT" = "{{webPort}}" ]; then
  WEB_PORT=8081
fi

OLD_PID=$(lsof -t -i :$WEB_PORT 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  echo "[Dev Server] 检测到端口 $WEB_PORT 已被进程占用 (PID: $OLD_PID)，清理释放..."
  kill -9 $OLD_PID 2>/dev/null || true
  sleep 1
fi
echo "[Dev Server] 目标监听端口: $WEB_PORT"

# 4. 局域网真机访问地址提示
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -n "$LAN_IP" ]; then
  echo "[Dev Server] 移动设备局域网访问 Metro: http://$LAN_IP:$WEB_PORT"
else
  echo "[Dev Server] 警告: 未识别本机局域网地址, 移动设备可能无法通过局域网访问 Metro"
fi

# 5. 注入指定的 Node 14 运行时环境
NODE_BIN='{{nodeBinPath}}'
case "$NODE_BIN" in
  "~"/*) NODE_BIN="$HOME/${NODE_BIN#\~/}" ;;
esac
if [ -n "$NODE_BIN" ] && [ -d "$NODE_BIN" ]; then
  export PATH="$NODE_BIN:$PATH"
  echo "[Dev Server] 已注入 Node 运行时目录: $NODE_BIN"
elif [ -n "$NODE_BIN" ] && [ "$NODE_BIN" != "{{nodeBinPath}}" ]; then
  echo "[Dev Server] 警告: Node 运行时目录不存在 ($NODE_BIN), 沿用系统 Node"
fi
echo "[Dev Server] 当前 Node: $(command -v node) $(node -v 2>&1) / 架构: $(node -p 'process.arch' 2>/dev/null)"

# 6. 启动开发服务
DEV_CMD='{{devCommand}}'
if [ -z "$DEV_CMD" ] || [ "$DEV_CMD" = "{{devCommand}}" ]; then
  DEV_CMD="npx react-native start"
fi

case "$DEV_CMD" in
  *--port*) RUN_CMD="$DEV_CMD" ;;
  *) RUN_CMD="$DEV_CMD --port=$WEB_PORT" ;;
esac
echo "[Dev Server] 启动开发服务: $RUN_CMD"
$RUN_CMD
```
服务在后台常驻，失败就停。

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
