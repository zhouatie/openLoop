---
id: wf_rn_ios_chitu_qa
name: worktree + RN 开发 + iOS 真机验收
tags: 开发,QA,iOS
---

# 目标

通用参数化模板 (iOS 版)：创建 Worktree 隔离沙箱与动态端口靶机 → Agent 隔离编码 → QA 用例设计 → 局域网 Metro 就绪 → iPhone 真机与 WDA 会话就绪 → 深链直达并确定性校验渲染 → Midscene 视觉验收 → 人工门禁 → 自动合并 → 清理沙箱。项目差异全部收敛到 workflow.variables。

# 流程

## 1. Worktree 隔离沙箱就绪

调 `sandbox_create` 建立隔离 worktree 沙箱：分配端口 webPort，基础端口 5175，共享 node_modules。超时 180 秒。
就绪后报告分支、目录与端口。失败就停，把报错原文记为失败原因。

## 2. 依赖硬链接就绪

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 600 秒。
失败就停，把报错原文记为失败原因。

```bash
echo "[Deps] 工作目录: $(pwd)"

# 1. 注入指定的 Node 运行时环境 (旧版 RN/Chitu 必须依赖特定 Node 版本如 Node 14)
NODE_BIN='{{nodeBinPath}}'
case "$NODE_BIN" in
  "~"/*) NODE_BIN="$HOME/${NODE_BIN#\~/}" ;;
esac
if [ -n "$NODE_BIN" ] && [ -d "$NODE_BIN" ]; then
  export PATH="$NODE_BIN:$PATH"
  echo "[Deps] 已注入 Node 运行时目录: $NODE_BIN"
fi
echo "[Deps] 当前 Node: $(node -v 2>&1 || echo '未找到') / npm: $(npm -v 2>&1 || echo '未找到')"

# 2. 多策略智能定位宿主工作区根目录
# 在 Raven monorepo / worktree 架构下，当前沙箱位于宿主项目的 .worktrees/task-* 目录下
CUR_DIR="$(pwd)"
CANDIDATE_HOSTS=()

# 策略 A: 若当前在 .worktrees/* 隔离沙箱下，其父级目录即为直接创建沙箱的宿主工程 (兼容 Raven active 模式)
case "$CUR_DIR" in
  */.worktrees/*)
    PARENT_WT="${CUR_DIR%%/.worktrees/*}"
    if [ -d "$PARENT_WT" ]; then
      CANDIDATE_HOSTS+=("$PARENT_WT")
    fi
    ;;
esac

# 策略 B: git show-toplevel
TOP_DIR=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$TOP_DIR" ] && [ -d "$TOP_DIR" ] && [ "$TOP_DIR" != "$CUR_DIR" ]; then
  CANDIDATE_HOSTS+=("$TOP_DIR")
fi

# 策略 C: git-common-dir 上级 (主仓库/bare 根)
HOST_GIT=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
if [ -n "$HOST_GIT" ] && [ -d "$HOST_GIT" ]; then
  COMMON_ROOT=$(dirname "$HOST_GIT")
  if [ -d "$COMMON_ROOT" ] && [ "$COMMON_ROOT" != "$CUR_DIR" ]; then
    CANDIDATE_HOSTS+=("$COMMON_ROOT")
  fi
fi

# 确定宿主候选: 优先选取已有有效 node_modules 的宿主；若均无则选首个包含 package.json 的宿主
HOST_ROOT=""
for c in "${CANDIDATE_HOSTS[@]}"; do
  if [ -d "$c/node_modules" ] && [ "$(ls -1 "$c/node_modules" 2>/dev/null | wc -l | tr -d ' ')" -gt 10 ]; then
    HOST_ROOT="$c"
    break
  fi
done

if [ -z "$HOST_ROOT" ]; then
  for c in "${CANDIDATE_HOSTS[@]}"; do
    if [ -f "$c/package.json" ]; then
      HOST_ROOT="$c"
      break
    fi
  done
fi

if [ -z "$HOST_ROOT" ]; then
  HOST_ROOT="${CANDIDATE_HOSTS[0]:-$CUR_DIR}"
fi
echo "[Deps] 宿主工程定位: $HOST_ROOT"

# 3. 辅助函数：检测目录是否具备合法的 node_modules 依赖 (真实目录且包数量 >= 10)
is_valid_modules() {
  local target="$1"
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    local cnt
    cnt=$(ls -1 "$target" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$cnt" -ge 10 ]; then
      return 0
    fi
  fi
  return 1
}

# 4. 辅助函数：在指定工程目录下执行依赖安装 (智能识别包管理器与加速参数)
install_dependencies() {
  local dir="$1"
  echo "[Deps] 正在为 [$dir] 执行依赖初始化安装..."
  local lock_mgr="npm"
  local install_cmd=""

  if [ -f "$dir/pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
    lock_mgr="pnpm"
    install_cmd="pnpm install --prefer-offline"
  elif [ -f "$dir/yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
    lock_mgr="yarn"
    install_cmd="yarn install --prefer-offline"
  elif [ -f "$dir/package-lock.json" ]; then
    lock_mgr="npm"
    install_cmd="npm install --prefer-offline --no-audit --no-fund"
  else
    lock_mgr="npm"
    install_cmd="npm install --prefer-offline --no-audit --no-fund"
  fi

  echo "[Deps] 识别到包管理器: $lock_mgr，执行指令: $install_cmd"
  local start_install
  start_install=$(date +%s)
  ( cd "$dir" && eval "$install_cmd" )
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo "[Deps] 警告: 使用 $install_cmd 安装退出码异常 ($exit_code)，尝试全量 npm install 兜底..."
    ( cd "$dir" && npm install --no-audit --no-fund )
    exit_code=$?
  fi

  if [ $exit_code -ne 0 ]; then
    echo "[Deps] 错误: 依赖安装失败 (退出码 $exit_code)"
    return $exit_code
  fi

  local cost=$(( $(date +%s) - start_install ))
  echo "[Deps] 依赖安装完成，耗时 ${cost}s"
  return 0
}

# 5. 核心逻辑执行
# Metro 的文件索引不跟随符号链接，因此 node_modules 必须是真实目录或硬链接副本
if [ -L "node_modules" ]; then
  REAL=$(readlink "node_modules")
  case "$REAL" in
    /*) ;;
    *) REAL="$(cd "$(dirname "node_modules")" && cd "$REAL" 2>/dev/null && pwd)" ;;
  esac
  if [ -d "$REAL" ] && is_valid_modules "$REAL"; then
    echo "[Deps] 检测到符号链接 node_modules -> $REAL，正在替换为硬链接副本 (共享数据块，零额外占盘)..."
    rm -f "node_modules"
    START_TS=$(date +%s)
    cp -al "$REAL" "node_modules" || { echo "[Deps] 错误: 硬链接复制失败"; exit 1; }
    echo "[Deps] 硬链接转换完成，耗时 $(( $(date +%s) - START_TS ))s"
  else
    echo "[Deps] 符号链接目标失效或为空，清理后重新准备依赖..."
    rm -f "node_modules"
  fi
fi

if is_valid_modules "node_modules"; then
  echo "[Deps] 当前沙箱 node_modules 已就绪，跳过安装"
else
  # 当前无有效 node_modules，检查宿主工程
  if ! is_valid_modules "$HOST_ROOT/node_modules"; then
    echo "[Deps] 检测到宿主工程 [$HOST_ROOT] 尚未安装依赖，触发自愈安装..."
    echo "[Deps] (在宿主工程安装可确保所有后续沙箱任务秒级硬链接复用，且宿主工程直接可用)"
    if [ -f "$HOST_ROOT/package.json" ]; then
      install_dependencies "$HOST_ROOT" || {
        echo "[Deps] 宿主安装失败，尝试直接在当前沙箱安装..."
        install_dependencies "." || { echo "[Deps] 依赖自愈安装失败"; exit 1; }
      }
    else
      install_dependencies "." || { echo "[Deps] 依赖自愈安装失败"; exit 1; }
    fi
  fi

  # 宿主已有依赖，创建硬链接到当前沙箱
  if is_valid_modules "$HOST_ROOT/node_modules"; then
    echo "[Deps] 正在从宿主工程建立硬链接副本到当前沙箱 (零拷贝秒级提速)..."
    START_TS=$(date +%s)
    rm -rf "node_modules"
    cp -al "$HOST_ROOT/node_modules" "node_modules" || { echo "[Deps] 错误: 硬链接复制失败"; exit 1; }
    echo "[Deps] 硬链接建立完成，耗时 $(( $(date +%s) - START_TS ))s"
  fi
fi

COUNT=$(ls -1 "node_modules" 2>/dev/null | wc -l | tr -d ' ')
echo "[Deps] 当前依赖包数量: $COUNT"
if [ "$COUNT" -lt 10 ]; then
  echo "[Deps] 错误: 依赖目录异常, 有效包数量过少 ($COUNT < 10)"
  exit 1
fi

echo "[Deps] 依赖环境全面就绪，转入 Metro 构建与后续节点"
```

## 3. RN 需求代码编写与交互自测

调 `agent_task` 起一个 Agent 会话，agentName 用「RN Coding Agent」。超时 600 秒。
指令：

```text
请在当前工作区中完成 React Native 需求代码开发与验证：
任务需求：{{task.title}}
详细说明：{{task.description}}
执行规范：遵循公司 RN 架构规范与极简代码原则，保持代码整洁干净；修改完毕后检查语法并确保改动闭环。
```

## 4. QA 黑盒验收用例设计

调 `run_node`，type 用 `qa-planner`，设计黑盒验收用例。超时 60 秒。
失败就停。

## 5. 开发服务靶机就绪 (局域网 Metro)

调 `run_node`，type 用 `env-prepare` 拉起开发服务靶机。超时 120 秒。
就绪检查地址用 `http://127.0.0.1:{{worktree.ports.webPort}}/status`。
预热最长等待 180000 毫秒。
config 里的 command 用下面这段命令原文，不要改写：

```bash
APP_SUB_DIR='{{appSubDir}}'
echo "[Dev Server] 当前执行目录: $(pwd)"

# 应用根目录定位: 显式变量 appSubDir 优先, 其次工作区根目录, 最后浅层自动探测
if [ -n "$APP_SUB_DIR" ]; then
  APP_SUB_DIR="${APP_SUB_DIR%/}"
  if [ ! -d "$APP_SUB_DIR" ]; then
    echo "[Dev Server] 错误: appSubDir 指向的目录不存在: $APP_SUB_DIR"
    echo "[Dev Server] 处理: 检查流水线变量 appSubDir, 或在本节点微调为正确的相对路径"
    exit 1
  fi
  cd "$APP_SUB_DIR"
  echo "[Dev Server] 按 appSubDir 切换至应用目录: $(pwd)"
elif [ -f "package.json" ]; then
  echo "[Dev Server] 当前目录即为应用根目录"
else
  FOUND_DIR=$(find . -maxdepth 3 -name "package.json" -not -path "*/node_modules/*" 2>/dev/null | head -n 1 | xargs -r dirname)
  if [ -n "$FOUND_DIR" ] && [ -d "$FOUND_DIR" ]; then
    cd "$FOUND_DIR"
    echo "[Dev Server] 自动定位到应用目录: $(pwd)"
  fi
fi

WEB_PORT={{worktree.ports.webPort}}
NODE_BIN='{{nodeBinPath}}'
DEV_CMD='{{devCommand}}'

echo "[Dev Server] 宿主端口: $WEB_PORT"

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -n "$LAN_IP" ]; then
  echo "[Dev Server] iPhone 走局域网访问 Metro: http://$LAN_IP:$WEB_PORT"
else
  echo "[Dev Server] 警告: 未识别本机局域网地址, iPhone 可能无法访问 Metro"
fi

# 展开 ~ 前缀: 引号内的波浪号不会被 shell 展开, 而 #!/usr/bin/env node 走 env 查找时会忽略它,
# 导致 npx/npm 实际用系统 Node 启动 (架构与 node_modules 里的 esbuild 二进制不匹配)
case "$NODE_BIN" in
  "~"/*) NODE_BIN="$HOME/${NODE_BIN#\~/}" ;;
esac
if [ -n "$NODE_BIN" ] && [ -d "$NODE_BIN" ]; then
  export PATH="$NODE_BIN":$PATH
  echo "[Dev Server] 已注入 Node 运行时目录: $NODE_BIN"
elif [ -n "$NODE_BIN" ]; then
  echo "[Dev Server] 警告: Node 运行时目录不存在, 沿用系统 Node ($NODE_BIN)"
fi
echo "[Dev Server] 当前 Node: $(command -v node) $(node -v 2>&1) / 架构: $(node -p 'process.arch' 2>/dev/null)"

case "$DEV_CMD" in
  *--port*) RUN_CMD="$DEV_CMD" ;;
  *) RUN_CMD="$DEV_CMD --port=$WEB_PORT" ;;
esac
echo "[Dev Server] 启动开发服务: $RUN_CMD"
$RUN_CMD
```
服务在后台常驻，失败就停。

## 6. iPhone 真机与 WDA 会话就绪

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 300 秒。
失败就停，把报错原文记为失败原因。

```bash
set -uo pipefail
WDA_URL='{{wdaEndpoint}}'
WDA_DIR="$HOME/.openloop/tools/WebDriverAgent"
DEV_JSON="${TMPDIR:-/tmp}/openloop_ios_devices.json"

probe() {
  local sid code
  sid=$(curl -s -m 8 -X POST "$WDA_URL/session" -H 'Content-Type: application/json' \
        -d '{"capabilities":{"alwaysMatch":{"platformName":"iOS","automationName":"XCUITest"}}}' | jq -r '.sessionId // empty' 2>/dev/null)
  if [ -z "$sid" ]; then return 1; fi
  code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$WDA_URL/session/$sid/window/size")
  curl -s -m 5 -X DELETE "$WDA_URL/session/$sid" >/dev/null 2>&1 || true
  [ "$code" = "200" ]
}

echo "[1/3] 真机连接"
xcrun devicectl list devices --json-output "$DEV_JSON" >/dev/null 2>&1 || true
UDID="${WDA_DEVICE_UDID:-$(jq -r '
  [
    .result.devices[]
    | select(
        (.hardwareProperties.reality == "physical" or .properties.hardware.reality == "physical")
        and
        (
          .connectionProperties.tunnelState == "connected"
          or .properties.connection.state == "connected"
          or .connectionProperties.pairingState == "paired"
          or .properties.connection.pairingState == "paired"
        )
      )
  ][0]
  | (.hardwareProperties.udid // .properties.hardware.udid // empty)
' "$DEV_JSON" 2>/dev/null)}"

if [ -z "${UDID:-}" ]; then
  echo "[iOS 现场] 错误: 未发现已连接的真机"
  echo "[iOS 现场] 处理: 数据线连接 iPhone, 解锁并点【信任此电脑】"
  exit 1
fi

NAME=$(jq -r --arg u "$UDID" '
  .result.devices[]
  | select(.hardwareProperties.udid == $u or .properties.hardware.udid == $u)
  | (.deviceProperties.name // .properties.state.name // empty)
' "$DEV_JSON" 2>/dev/null)
echo "[iOS 现场] 真机: ${NAME:-未知} ($UDID)"

# 若 CoreDevice 隧道休眠，主动探测一次以唤醒隧道连接
xcrun devicectl device info lockState --device "$UDID" >/dev/null 2>&1 || true

echo "[2/3] WDA 会话探测 ($WDA_URL)"
if curl -s -f -m 3 "$WDA_URL/status" >/dev/null 2>&1; then
  curl -s -m 3 "$WDA_URL/status" | jq -r '"WDA: \(.value.device // "?") | iOS \(.value.os.version // "?") | ready \(.value.ready)"' 2>/dev/null || true
fi
if probe; then
  echo "[iOS 现场] WDA 会话可用，无需重启"
  exit 0
fi

echo "[3/3] WDA 会话不可用（UI 测试授权失效或进程已退出），重启 WebDriverAgent"
if [ ! -d "$WDA_DIR/WebDriverAgent.xcodeproj" ]; then
  echo "[iOS 现场] 错误: 未找到 WebDriverAgent 工程 ($WDA_DIR)"
  exit 1
fi
mkdir -p "$WDA_DIR/logs"
pkill -f "xcodebuild test-without-building" >/dev/null 2>&1 || true
sleep 2

python3 - "$WDA_DIR" "$UDID" <<'PY'
import os, subprocess, sys

wda_dir, udid = sys.argv[1], sys.argv[2]
log = open(os.path.join(wda_dir, 'logs', 'guard.log'), 'ab')
subprocess.Popen(
    [
        'xcodebuild', 'test-without-building',
        '-project', os.path.join(wda_dir, 'WebDriverAgent.xcodeproj'),
        '-scheme', 'WebDriverAgentRunner',
        '-destination', f'id={udid}',
        '-derivedDataPath', os.path.join(wda_dir, 'build'),
    ],
    cwd=wda_dir,
    stdin=subprocess.DEVNULL,
    stdout=log,
    stderr=log,
    start_new_session=True,
)
print('[iOS 现场] WebDriverAgent 已在新会话中启动')
PY

for i in $(seq 1 60); do
  sleep 3
  if probe; then
    echo "[iOS 现场] WDA 会话已恢复 (耗时 $((i * 3))s)"
    exit 0
  fi
done

echo "[iOS 现场] 错误: WDA 重启超时, 请检查 $WDA_DIR/logs/guard.log"
tail -20 "$WDA_DIR/logs/guard.log" 2>/dev/null || true
exit 1
```

## 7. 冷启 App 并深链直达目标页 (iOS 真机)

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 420 秒。
失败就停，把报错原文记为失败原因。

```bash
echo "[iOS DeepLink] 经深链直达目标页 (复用已登录进程, 不做登录门禁)"

WEB_PORT={{worktree.ports.webPort}}
WDA_URL='{{wdaEndpoint}}'
APP_PKG='{{appPackage}}'
LINK='{{deepLink}}'
MIN_TEXT={{minTextNodes}}
SETTLE_SEC=20

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -z "$LAN_IP" ]; then
  echo "[iOS DeepLink] 错误: 未识别本机局域网地址, iPhone 无法访问 Metro"
  exit 1
fi
echo "[iOS DeepLink] 本机局域网地址: $LAN_IP, Metro 端口: $WEB_PORT"

wait_metro() {
  i=0
  while [ "$i" -lt 60 ]; do
    if curl -s -m 2 "http://$LAN_IP:$WEB_PORT/status" 2>/dev/null | grep -q "packager-status:running"; then
      echo "[iOS DeepLink] Metro 已就绪 (http://$LAN_IP:$WEB_PORT)"
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "[iOS DeepLink] 错误: Metro 未就绪 (http://$LAN_IP:$WEB_PORT/status), 已等待 120 秒"
  echo "[iOS DeepLink] 处理: 从节点 [5. 开发服务靶机就绪] 重试, 该节点负责拉起 Metro"
  return 1
}

if [ -z "$LINK" ]; then
  COMPONENT='{{rnComponent}}'
  if [ -z "$COMPONENT" ] && [ -f ./appJson.json ]; then
    COMPONENT=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' ./appJson.json | head -n 1)
  fi
  if [ -z "$COMPONENT" ]; then
    echo "[iOS DeepLink] 错误: 无法确定 RN 组件名 (未提供 rnComponent, 工作区根目录也无可解析的 appJson.json)"
    exit 1
  fi
  BUNDLE_URL="http%3A%2F%2F$LAN_IP%3A$WEB_PORT%2Findex.ios.bundle%3Fdev%3Dtrue"
  LINK="orpheus://rnpage?url=$BUNDLE_URL&component=$COMPONENT"
  QUERY='{{deepLinkQuery}}'
  if [ -n "$QUERY" ]; then
    LINK="$LINK&$QUERY"
  fi
  echo "[iOS DeepLink] 组件名: $COMPONENT (来源: appJson.json 或 rnComponent)"
fi
echo "[iOS DeepLink] 目标 URL: $LINK"

wait_metro || exit 1

SID=$(curl -s -m 10 -X POST "$WDA_URL/session" -H 'Content-Type: application/json' \
      -d '{"capabilities":{"alwaysMatch":{"platformName":"iOS","automationName":"XCUITest"}}}' | jq -r '.sessionId // empty')
if [ -z "$SID" ]; then
  echo "[iOS DeepLink] 错误: 无法创建 WDA 会话 ($WDA_URL)"
  exit 1
fi
cleanup() { curl -s -m 5 -X DELETE "$WDA_URL/session/$SID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# 冷启: 先终止目标应用, 保证每次验收都从全新进程进入, 避免上次残留页面干扰
if [ -n "$APP_PKG" ]; then
  echo "[iOS DeepLink] 冷启目标应用: 先终止 $APP_PKG"
  curl -s -m 10 -X POST "$WDA_URL/session/$SID/wda/apps/terminate" -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg b "$APP_PKG" '{bundleId:$b}')" >/dev/null 2>&1 || true
  sleep 2
  STILL=$(curl -s -m 10 "$WDA_URL/session/$SID/wda/activeAppInfo" | jq -r '.value.bundleId // empty' 2>/dev/null)
  echo "[iOS DeepLink] 终止后前台应用: ${STILL:-未知}"
else
  echo "[iOS DeepLink] 警告: 未配置 appPackage, 跳过冷启"
fi

curl -s -m 30 -X POST "$WDA_URL/session/$SID/url" -H 'Content-Type: application/json' \
  -d "$(jq -cn --arg u "$LINK" --arg b "$APP_PKG" '{url:$u, bundleId:$b}')" >/dev/null
echo "[iOS DeepLink] 深链已下发, 等待页面渲染完成..."

active_bundle() {
  curl -s -m 10 "$WDA_URL/session/$SID/wda/activeAppInfo" | jq -r '.value.bundleId // empty' 2>/dev/null
}

page_source() {
  curl -s -m 20 "$WDA_URL/session/$SID/source" | jq -r '.value // empty' 2>/dev/null
}

READY_HITS=0
SETTLED=0
i=0
while [ "$i" -lt 40 ]; do
  i=$((i + 1))
  sleep 3

  BUNDLE=$(active_bundle)
  if [ -n "$BUNDLE" ] && [ "$BUNDLE" != "$APP_PKG" ]; then
    echo "[iOS DeepLink] 探测 $i/40: 前台应用为 $BUNDLE, 等待目标应用前置"
    READY_HITS=0
    continue
  fi

  # 自动关闭底层 APM/Heimdall 误报弹窗
  EID=$(curl -s -m 5 -X POST "$WDA_URL/session/$SID/element" -H 'Content-Type: application/json'         -d '{"using":"name","value":"好的"}' | jq -r '.value.ELEMENT // empty' 2>/dev/null)
  if [ -n "$EID" ]; then
    echo "[iOS DeepLink] 检测到底层提示弹窗, 自动点击【好的】"
    curl -s -m 5 -X POST "$WDA_URL/session/$SID/element/$EID/click" -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 || true
    sleep 1
  fi

  SRC=$(page_source)
  if [ -z "$SRC" ]; then
    echo "[iOS DeepLink] 探测 $i/40: 界面树暂不可读, 继续等待"
    READY_HITS=0
    continue
  fi

  if printf '%s' "$SRC" | grep -qE 'Could not connect to development server|Unable to resolve module|No bundle URL present|REDBOX'; then
    echo "[iOS DeepLink] 错误: RN 红屏, bundle 未能加载"
    printf '%s' "$SRC" | grep -oE 'http://[^"< ]+' | head -n 2
    exit 1
  fi

  COUNT=$(printf '%s' "$SRC" | grep -o 'label="[^"]\+"' | grep -vc 'label=""')
  if [ "$COUNT" -ge "$MIN_TEXT" ]; then
    READY_HITS=$((READY_HITS + 1))
    echo "[iOS DeepLink] 探测 $i/40: 页面已渲染 (文本节点 $COUNT, 连续确认 $READY_HITS/2)"
    if [ "$READY_HITS" -ge 2 ] && [ "$SETTLED" -eq 0 ]; then
      SETTLED=1
      READY_HITS=0
      echo "[iOS DeepLink] 首次渲染完成, 观察 ${SETTLE_SEC}s 以确认页面不再重载..."
      sleep "$SETTLE_SEC"
      continue
    fi
    if [ "$READY_HITS" -ge 2 ] && [ "$SETTLED" -eq 1 ]; then
      echo "[iOS DeepLink] 页面渲染稳定, 交由后续 QA 自动化执行验收"
      exit 0
    fi
    continue
  fi

  echo "[iOS DeepLink] 探测 $i/40: 文本节点 $COUNT, 等待首屏内容"
  READY_HITS=0
done

echo "[iOS DeepLink] 等待超时: 页面未在限定时间内渲染完成"
exit 1
```

## 8. 自动化验收执行与视觉截帧 (iOS)

调 `run_node`，type 用 `midscene` 执行 UI 自动化验收与视觉截帧。超时 180 秒。
platform 用 `ios`。
testUrl 用 `{{deepLink}}`。
appPackage 用 `{{appPackage}}`。
wdaEndpoint 用 `http://localhost:8100`。
skipLaunch 用 `true`：应用已由上一步拉起，不要冷启。
instructions 用下面的清单：
- 校验当前界面正常渲染，无红屏或崩溃提示
- 校验当前界面无异常空白与元素错位
失败就停。

## 9. 视觉复核与人工验收门禁

调 `ask_human` 提交人工验收门禁。
标题用「视觉复核与人工验收门禁」。
说明用「Agent 已完成代码修改，iPhone 真机现场就绪，自动化验收已执行。请查看截帧与实际设备画面，确认无误后点击【验收通过】，系统将自动合并代码并清理沙箱。」。
清单：

- 代码 Diff 干净规范，无调试残留与冗余代码
- iPhone 真机页面正常渲染，无红屏与报错
- 验收截帧显示页面交互与文案符合预期
等我决策；驳回就把驳回意见作为失败原因，整条流水线终止。

## 10. 验收通过后自动合并代码

调 `sandbox_merge` 把特性分支合并回本地开发分支。失败就停，把冲突原文记为失败原因。

## 11. 沙箱环境清理与分支回收

调 `sandbox_cleanup` 释放端口与沙箱目录。

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
