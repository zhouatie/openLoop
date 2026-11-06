---
id: wf_rn_dev_chitu_qa
name: RN 业务开发与自动化验收流水线 (Worktree 全闭环 · 参数化模板)
tags: RN,Chitu,研发,QA,环境切换
---

# 目标

通用参数化模板：创建 Worktree 隔离沙箱与动态端口靶机 → Agent 隔离编码 → QA 用例设计 → 开发服务就绪 → 切换 Android 网络环境 (预发/线上) → 深链直达并确定性校验文案 → Midscene 视觉验收 → 人工门禁 → 自动合并 → 清理沙箱。项目差异全部收敛到 workflow.variables，切换项目只需改变量。

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

## 5. 开发服务靶机就绪

调 `run_node`，type 用 `env-prepare` 拉起开发服务靶机。超时 120 秒。
就绪检查地址用 `http://127.0.0.1:{{worktree.ports.webPort}}/status`。
预热最长等待 180000 毫秒。
background 用 `true`：服务常驻后台，不要等它退出。
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
DEV_PORT='{{metroDevicePort}}'
NODE_BIN='{{nodeBinPath}}'
DEV_CMD='{{devCommand}}'

echo "[Dev Server] 宿主端口: $WEB_PORT, 设备端口: $DEV_PORT"

if command -v adb >/dev/null 2>&1; then
  DEVICE=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
  if [ -n "$DEVICE" ]; then
    echo "[Dev Server] 建立 ADB 反向代理: $DEVICE (设备 $DEV_PORT -> 宿主 $WEB_PORT)"
    adb -s "$DEVICE" reverse "tcp:$DEV_PORT" "tcp:$WEB_PORT" || true
  else
    echo "[Dev Server] 警告: 未检测到在线 Android 设备，跳过反向代理"
  fi
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

## 6. 切换 Android 网络环境 (预发/线上)

调 `run_node`，type 用 `sub-workflow`，subWorkflowId 用 `wf_android_env_switch`。
引用的子流水线已下线时，跳过本步并继续后续步骤。

## 7. 深链直达目标页 (保留登录态 + 登录门禁)

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 420 秒。
失败就停，把报错原文记为失败原因。

```bash
echo "[DeepLink] 经深链直达目标页 (默认复用已登录进程), 仅等待页面渲染完成"

WEB_PORT={{worktree.ports.webPort}}
DEV_PORT='{{metroDevicePort}}'
APP_PKG='{{appPackage}}'
DEVICE_HINT='{{deviceSerial}}'
LINK='{{deepLink}}'
RESTART='{{restartApp}}'
REQUIRE_LOGIN='{{requireLogin}}'
if [ -z "$LINK" ]; then
  # 组件名优先级: 任务上下文 rnComponent > 工作区根目录 appJson.json 的 name 字段
  COMPONENT='{{rnComponent}}'
  if [ -z "$COMPONENT" ] && [ -f ./appJson.json ]; then
    COMPONENT=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' ./appJson.json | head -n 1)
  fi
  if [ -z "$COMPONENT" ]; then
    echo "[DeepLink] 错误: 无法确定 RN 组件名 (未提供 rnComponent, 工作区根目录也无可解析的 appJson.json)"
    exit 1
  fi
  # 业务路由参数由 deepLinkQuery 提供, 允许为空
  QUERY='{{deepLinkQuery}}'
  LINK="orpheus://rnpage?url=http%3A%2F%2F127.0.0.1%3A${DEV_PORT}%2Findex.android.bundle%3Fdev%3Dtrue&component=${COMPONENT}"
  if [ -n "$QUERY" ]; then
    LINK="$LINK&$QUERY"
  fi
  echo "[DeepLink] 组件名: ${COMPONENT} (来源: appJson.json 或 rnComponent)"
fi
echo "[DeepLink] 目标 URL: $LINK"
MIN_TEXT={{minTextNodes}}
SETTLE_SEC=35

pick_device() {
  if [ -n "$DEVICE_HINT" ]; then
    if adb devices | awk 'NR>1 && $2=="device" {print $1}' | grep -qx "$DEVICE_HINT"; then
      echo "$DEVICE_HINT"
      return 0
    fi
    echo "[DeepLink] 警告: 指定设备 $DEVICE_HINT 不在线, 回退首个在线设备" >&2
  fi
  adb devices | awk 'NR>1 && $2=="device" {print $1; exit}'
}

ensure_reverse() {
  adb -s "$DEVICE" reverse "tcp:$DEV_PORT" "tcp:$WEB_PORT" >/dev/null 2>&1 || true
}

wait_metro() {
  i=0
  while [ "$i" -lt 60 ]; do
    if curl -s -m 2 "http://127.0.0.1:$WEB_PORT/status" 2>/dev/null | grep -q "packager-status:running"; then
      echo "[DeepLink] 开发服务已就绪 (端口 $WEB_PORT)"
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "[DeepLink] 错误: 开发服务未就绪 (端口 $WEB_PORT), 已等待 120 秒"
  echo "[DeepLink] 原因: 本节点只等待开发服务, 不负责拉起开发服务"
  echo "[DeepLink] 处理: 请改从节点 [5. 开发服务靶机就绪] 重试, 该节点会拉起开发服务并完成探活"
  echo "[DeepLink] 检查: 手动确认命令为 curl -s http://127.0.0.1:$WEB_PORT/status"
  return 1
}

dump_ui() {
  adb -s "$DEVICE" shell uiautomator dump /sdcard/openloop_ui.xml >/dev/null 2>&1
  adb -s "$DEVICE" shell cat /sdcard/openloop_ui.xml 2>/dev/null
}

# 读取当前获得焦点的窗口, 用于判断应用是否停在登录页
login_focus() {
  adb -s "$DEVICE" shell "dumpsys window 2>/dev/null | grep -m2 -E 'mCurrentFocus|mFocusedApp'" 2>/dev/null | tr -d '\r'
}

# 登录态门禁: 登录页不承载业务页面, 直接跑验收只会产生无效结论
fail_login_gate() {
  echo "[DeepLink] 错误: 应用停在登录页, 无法验收目标页面"
  echo "[DeepLink] 焦点窗口: $1"
  echo "[DeepLink] 原因: 设备当前没有有效登录态 (切换环境或冷启动都会清空会话)"
  echo "[DeepLink] 处理: 请先在设备上完成一次登录 ($APP_PKG), 再从本节点重试"
  echo "[DeepLink] 关闭: 将工作流变量 requireLogin 设为 false 可跳过该校验"
  exit 1
}

deeplink_open() {
  ensure_reverse
  echo "[DeepLink] 正在打开 URL: $LINK"
  adb -s "$DEVICE" shell "am start -a android.intent.action.VIEW -d '$LINK'" >/dev/null 2>&1
}

# 冷启动: 必须确认进程真正退出后再拉起, 否则会复用旧进程继续渲染上一版 bundle
cold_launch_app() {
  adb -s "$DEVICE" shell am force-stop "$APP_PKG" >/dev/null 2>&1
  n=0
  while [ "$n" -lt 15 ]; do
    if [ -z "$(adb -s "$DEVICE" shell pidof "$APP_PKG" 2>/dev/null | tr -d '\r')" ]; then
      break
    fi
    n=$((n + 1))
    sleep 1
  done
  if [ "$n" -ge 15 ]; then
    echo "[DeepLink] 警告: 应用进程未在 15s 内退出, 继续拉起"
  fi
  sleep 1
  deeplink_open
}

# 应用已在运行时不杀进程: 强杀会让客户端丢失登录态, 重启后落回登录页
launch_app() {
  APP_PID=$(adb -s "$DEVICE" shell pidof "$APP_PKG" 2>/dev/null | tr -d '\r')
  if [ "$1" = "cold" ] || [ -z "$APP_PID" ] || [ "$RESTART" = "true" ]; then
    echo "[DeepLink] 冷启动应用 (进程: ${APP_PID:-未运行}, restartApp: ${RESTART:-false})"
    cold_launch_app
  else
    echo "[DeepLink] 应用已在运行 (PID: $APP_PID), 保留登录态, 仅下发深链"
    deeplink_open
  fi
}

is_page_ready() {
  UI="$1"
  # RN 容器常驻性能调试面板(API预加载/预下载/拆包预热/兜底包)不是加载态, 也不是业务内容, 先剔除
  UI_CLEAN=$(printf '%s' "$UI" | tr '>' '\n' | grep -vE 'API预加载|预下载|拆包预热|兜底包')
  printf '%s' "$UI_CLEAN" | grep -qE "Could not connect to development server|App崩溃|屡次停止运行|Unable to resolve module|REDBOX" && return 2
  printf '%s' "$UI_CLEAN" | grep -qE "正在加载|加载中|预加载|拆包预热|预下载|兜底包" && return 3
  COUNT=$(printf '%s' "$UI_CLEAN" | grep -oE 'text="[^"]+"' | grep -vc 'text=""')
  if [ "$COUNT" -ge "$MIN_TEXT" ]; then
    echo "$COUNT"
    return 0
  fi
  echo "$COUNT"
  return 1
}

DEVICE=$(pick_device)
if [ -z "$DEVICE" ]; then
  echo "[DeepLink] 错误: 未检测到在线 Android 设备"
  exit 1
fi
echo "[DeepLink] 目标设备: $DEVICE, 宿主端口: $WEB_PORT, 应用: $APP_PKG"

wait_metro || exit 1

launch_app
echo "[DeepLink] 深链已发出, 等待页面渲染完成..."

READY_HITS=0
LOGIN_HITS=0
SETTLED=0
i=0
while [ "$i" -lt 40 ]; do
  i=$((i + 1))
  sleep 3
  ensure_reverse
  UI=$(dump_ui)

  if [ -z "$UI" ]; then
    echo "[DeepLink] 探测 $i/40: 界面树暂不可读, 继续等待"
    READY_HITS=0
    continue
  fi

  if [ "$REQUIRE_LOGIN" != "false" ] && [ "$REQUIRE_LOGIN" != "0" ]; then
    FOCUS=$(login_focus)
    if printf '%s' "$FOCUS" | grep -q 'LoginActivity'; then
      LOGIN_HITS=$((LOGIN_HITS + 1))
      echo "[DeepLink] 探测 $i/40: 当前焦点为登录页 (连续确认 $LOGIN_HITS/2)"
      if [ "$LOGIN_HITS" -ge 2 ]; then
        fail_login_gate "$FOCUS"
      fi
      continue
    fi
    LOGIN_HITS=0
  fi

  CODE=0
  COUNT=$(is_page_ready "$UI") || CODE=$?

  if [ "$CODE" -eq 2 ]; then
    echo "[DeepLink] 探测 $i/40: 检测到红屏或崩溃, 冷启动重新拉起应用"
    launch_app cold
    READY_HITS=0
    continue
  fi

  if [ "$CODE" -eq 3 ]; then
    echo "[DeepLink] 探测 $i/40: 拆包加载中"
    READY_HITS=0
    continue
  fi

  if [ "$CODE" -eq 0 ]; then
    READY_HITS=$((READY_HITS + 1))
    echo "[DeepLink] 探测 $i/40: 页面已渲染 (文本节点 $COUNT, 连续确认 $READY_HITS/2)"
    if [ "$READY_HITS" -ge 2 ] && [ "$SETTLED" -eq 0 ]; then
      # 首次就绪后再观察一轮: 客户端会先渲染上一版缓存 bundle, 随后静默拉取新 bundle 重载页面
      SETTLED=1
      echo "[DeepLink] 首次渲染完成, 观察 ${SETTLE_SEC}s 以确认页面不再重载..."
      sleep "$SETTLE_SEC"
      READY_HITS=0
      continue
    fi
    if [ "$READY_HITS" -ge 2 ] && [ "$SETTLED" -eq 1 ]; then
      echo "[DeepLink] 页面渲染稳定, 交由后续 QA 自动化执行验收"
      exit 0
    fi
    continue
  fi

  echo "[DeepLink] 探测 $i/40: 文本节点 $COUNT, 等待首屏内容"
  READY_HITS=0
done

echo "[DeepLink] 等待超时: 页面未在限定时间内渲染完成"
exit 1
```

## 8. 自动化验收执行与视觉截帧

调 `run_node`，type 用 `midscene` 执行 UI 自动化验收与视觉截帧。超时 180 秒。
platform 用 `android`。
testUrl 用 `{{deepLink}}`。
skipLaunch 用 `true`：应用已由上一步拉起，不要冷启。
instructions 用下面的清单：
- 校验当前界面正常渲染，无红屏或崩溃提示
- 校验当前界面无异常空白与元素错位
失败就停。

## 9. 视觉复核与人工验收门禁

调 `ask_human` 提交人工验收门禁。
标题用「9. 视觉复核与人工验收门禁」。
说明用「Agent 已完成代码修改，开发服务靶机就绪，自动化验收已执行。请查看截帧与实际效果，确认无误后点击【验收通过】，系统将自动合并代码并清理沙箱。」。
清单：

- 代码 Diff 干净规范，无调试残留与冗余代码
- 开发服务正常启动，页面无红屏与报错
- 验收截帧显示页面交互与文案符合预期
等我决策；驳回就把驳回意见作为失败原因，整条流水线终止。

## 10. 验收通过后自动合并代码

调 `sandbox_merge` 把特性分支合并回本地开发分支。失败就停，把冲突原文记为失败原因。

## 11. 沙箱环境清理与分支回收

调 `sandbox_cleanup` 释放端口与沙箱目录。

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
