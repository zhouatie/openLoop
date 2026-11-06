// @pipeline id=wf_rn_ios_chitu_qa
// @name worktree + RN 开发 + iOS 真机验收
// @tags 开发,QA,iOS

/**
 * worktree + RN 开发 + iOS 真机验收
 * 由编排画布转译生成的脚本流水线。
 */
export default async function (ctx) {
  const { sandbox, agent, approve, node, log } = ctx

  log("启动流水线: worktree + RN 开发 + iOS 真机验收")

  // Worktree 隔离沙箱就绪 (worktree-setup)
  const step1 = await sandbox.create({
    allocatePorts: [
      "webPort"
    ],
    basePort: 5175,
    sharedPaths: [
      "node_modules"
    ],
    timeoutSec: 180,
    name: "Worktree 隔离沙箱就绪",
  })
  if (!step1.ok) return { status: 'failed', error: "节点「Worktree 隔离沙箱就绪」执行未通过" }

  // 依赖硬链接就绪 (hook)
  const step2 = await node("hook", {
    command: "echo \"[Deps] 工作目录: $(pwd)\"\n\n# 1. 注入指定的 Node 运行时环境 (旧版 RN/Chitu 必须依赖特定 Node 版本如 Node 14)\nNODE_BIN='{{nodeBinPath}}'\ncase \"$NODE_BIN\" in\n  \"~\"/*) NODE_BIN=\"$HOME/${NODE_BIN#\\~/}\" ;;\nesac\nif [ -n \"$NODE_BIN\" ] && [ -d \"$NODE_BIN\" ]; then\n  export PATH=\"$NODE_BIN:$PATH\"\n  echo \"[Deps] 已注入 Node 运行时目录: $NODE_BIN\"\nfi\necho \"[Deps] 当前 Node: $(node -v 2>&1 || echo '未找到') / npm: $(npm -v 2>&1 || echo '未找到')\"\n\n# 2. 多策略智能定位宿主工作区根目录\n# 在 Raven monorepo / worktree 架构下，当前沙箱位于宿主项目的 .worktrees/task-* 目录下\nCUR_DIR=\"$(pwd)\"\nCANDIDATE_HOSTS=()\n\n# 策略 A: 若当前在 .worktrees/* 隔离沙箱下，其父级目录即为直接创建沙箱的宿主工程 (兼容 Raven active 模式)\ncase \"$CUR_DIR\" in\n  */.worktrees/*)\n    PARENT_WT=\"${CUR_DIR%%/.worktrees/*}\"\n    if [ -d \"$PARENT_WT\" ]; then\n      CANDIDATE_HOSTS+=(\"$PARENT_WT\")\n    fi\n    ;;\nesac\n\n# 策略 B: git show-toplevel\nTOP_DIR=$(git rev-parse --show-toplevel 2>/dev/null)\nif [ -n \"$TOP_DIR\" ] && [ -d \"$TOP_DIR\" ] && [ \"$TOP_DIR\" != \"$CUR_DIR\" ]; then\n  CANDIDATE_HOSTS+=(\"$TOP_DIR\")\nfi\n\n# 策略 C: git-common-dir 上级 (主仓库/bare 根)\nHOST_GIT=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)\nif [ -n \"$HOST_GIT\" ] && [ -d \"$HOST_GIT\" ]; then\n  COMMON_ROOT=$(dirname \"$HOST_GIT\")\n  if [ -d \"$COMMON_ROOT\" ] && [ \"$COMMON_ROOT\" != \"$CUR_DIR\" ]; then\n    CANDIDATE_HOSTS+=(\"$COMMON_ROOT\")\n  fi\nfi\n\n# 确定宿主候选: 优先选取已有有效 node_modules 的宿主；若均无则选首个包含 package.json 的宿主\nHOST_ROOT=\"\"\nfor c in \"${CANDIDATE_HOSTS[@]}\"; do\n  if [ -d \"$c/node_modules\" ] && [ \"$(ls -1 \"$c/node_modules\" 2>/dev/null | wc -l | tr -d ' ')\" -gt 10 ]; then\n    HOST_ROOT=\"$c\"\n    break\n  fi\ndone\n\nif [ -z \"$HOST_ROOT\" ]; then\n  for c in \"${CANDIDATE_HOSTS[@]}\"; do\n    if [ -f \"$c/package.json\" ]; then\n      HOST_ROOT=\"$c\"\n      break\n    fi\n  done\nfi\n\nif [ -z \"$HOST_ROOT\" ]; then\n  HOST_ROOT=\"${CANDIDATE_HOSTS[0]:-$CUR_DIR}\"\nfi\necho \"[Deps] 宿主工程定位: $HOST_ROOT\"\n\n# 3. 辅助函数：检测目录是否具备合法的 node_modules 依赖 (真实目录且包数量 >= 10)\nis_valid_modules() {\n  local target=\"$1\"\n  if [ -d \"$target\" ] && [ ! -L \"$target\" ]; then\n    local cnt\n    cnt=$(ls -1 \"$target\" 2>/dev/null | wc -l | tr -d ' ')\n    if [ \"$cnt\" -ge 10 ]; then\n      return 0\n    fi\n  fi\n  return 1\n}\n\n# 4. 辅助函数：在指定工程目录下执行依赖安装 (智能识别包管理器与加速参数)\ninstall_dependencies() {\n  local dir=\"$1\"\n  echo \"[Deps] 正在为 [$dir] 执行依赖初始化安装...\"\n  local lock_mgr=\"npm\"\n  local install_cmd=\"\"\n\n  if [ -f \"$dir/pnpm-lock.yaml\" ] && command -v pnpm >/dev/null 2>&1; then\n    lock_mgr=\"pnpm\"\n    install_cmd=\"pnpm install --prefer-offline\"\n  elif [ -f \"$dir/yarn.lock\" ] && command -v yarn >/dev/null 2>&1; then\n    lock_mgr=\"yarn\"\n    install_cmd=\"yarn install --prefer-offline\"\n  elif [ -f \"$dir/package-lock.json\" ]; then\n    lock_mgr=\"npm\"\n    install_cmd=\"npm install --prefer-offline --no-audit --no-fund\"\n  else\n    lock_mgr=\"npm\"\n    install_cmd=\"npm install --prefer-offline --no-audit --no-fund\"\n  fi\n\n  echo \"[Deps] 识别到包管理器: $lock_mgr，执行指令: $install_cmd\"\n  local start_install\n  start_install=$(date +%s)\n  ( cd \"$dir\" && eval \"$install_cmd\" )\n  local exit_code=$?\n  if [ $exit_code -ne 0 ]; then\n    echo \"[Deps] 警告: 使用 $install_cmd 安装退出码异常 ($exit_code)，尝试全量 npm install 兜底...\"\n    ( cd \"$dir\" && npm install --no-audit --no-fund )\n    exit_code=$?\n  fi\n\n  if [ $exit_code -ne 0 ]; then\n    echo \"[Deps] 错误: 依赖安装失败 (退出码 $exit_code)\"\n    return $exit_code\n  fi\n\n  local cost=$(( $(date +%s) - start_install ))\n  echo \"[Deps] 依赖安装完成，耗时 ${cost}s\"\n  return 0\n}\n\n# 5. 核心逻辑执行\n# Metro 的文件索引不跟随符号链接，因此 node_modules 必须是真实目录或硬链接副本\nif [ -L \"node_modules\" ]; then\n  REAL=$(readlink \"node_modules\")\n  case \"$REAL\" in\n    /*) ;;\n    *) REAL=\"$(cd \"$(dirname \"node_modules\")\" && cd \"$REAL\" 2>/dev/null && pwd)\" ;;\n  esac\n  if [ -d \"$REAL\" ] && is_valid_modules \"$REAL\"; then\n    echo \"[Deps] 检测到符号链接 node_modules -> $REAL，正在替换为硬链接副本 (共享数据块，零额外占盘)...\"\n    rm -f \"node_modules\"\n    START_TS=$(date +%s)\n    cp -al \"$REAL\" \"node_modules\" || { echo \"[Deps] 错误: 硬链接复制失败\"; exit 1; }\n    echo \"[Deps] 硬链接转换完成，耗时 $(( $(date +%s) - START_TS ))s\"\n  else\n    echo \"[Deps] 符号链接目标失效或为空，清理后重新准备依赖...\"\n    rm -f \"node_modules\"\n  fi\nfi\n\nif is_valid_modules \"node_modules\"; then\n  echo \"[Deps] 当前沙箱 node_modules 已就绪，跳过安装\"\nelse\n  # 当前无有效 node_modules，检查宿主工程\n  if ! is_valid_modules \"$HOST_ROOT/node_modules\"; then\n    echo \"[Deps] 检测到宿主工程 [$HOST_ROOT] 尚未安装依赖，触发自愈安装...\"\n    echo \"[Deps] (在宿主工程安装可确保所有后续沙箱任务秒级硬链接复用，且宿主工程直接可用)\"\n    if [ -f \"$HOST_ROOT/package.json\" ]; then\n      install_dependencies \"$HOST_ROOT\" || {\n        echo \"[Deps] 宿主安装失败，尝试直接在当前沙箱安装...\"\n        install_dependencies \".\" || { echo \"[Deps] 依赖自愈安装失败\"; exit 1; }\n      }\n    else\n      install_dependencies \".\" || { echo \"[Deps] 依赖自愈安装失败\"; exit 1; }\n    fi\n  fi\n\n  # 宿主已有依赖，创建硬链接到当前沙箱\n  if is_valid_modules \"$HOST_ROOT/node_modules\"; then\n    echo \"[Deps] 正在从宿主工程建立硬链接副本到当前沙箱 (零拷贝秒级提速)...\"\n    START_TS=$(date +%s)\n    rm -rf \"node_modules\"\n    cp -al \"$HOST_ROOT/node_modules\" \"node_modules\" || { echo \"[Deps] 错误: 硬链接复制失败\"; exit 1; }\n    echo \"[Deps] 硬链接建立完成，耗时 $(( $(date +%s) - START_TS ))s\"\n  fi\nfi\n\nCOUNT=$(ls -1 \"node_modules\" 2>/dev/null | wc -l | tr -d ' ')\necho \"[Deps] 当前依赖包数量: $COUNT\"\nif [ \"$COUNT\" -lt 10 ]; then\n  echo \"[Deps] 错误: 依赖目录异常, 有效包数量过少 ($COUNT < 10)\"\n  exit 1\nfi\n\necho \"[Deps] 依赖环境全面就绪，转入 Metro 构建与后续节点\"\n",
    timeoutSec: 600,
  }, {
    name: "依赖硬链接就绪",
  })
  if (!step2.ok) return { status: 'failed', error: "节点「依赖硬链接就绪」执行未通过" }

  // RN 需求代码编写与交互自测 (agent)
  const step3 = await agent({
    prompt: "请在当前工作区中完成 React Native 需求代码开发与验证：\n任务需求：{{task.title}}\n详细说明：{{task.description}}\n执行规范：遵循公司 RN 架构规范与极简代码原则，保持代码整洁干净；修改完毕后检查语法并确保改动闭环。",
    agentName: "RN Coding Agent",
    timeoutSec: 600,
    name: "RN 需求代码编写与交互自测",
  })
  if (!step3.ok) return { status: 'failed', error: "节点「RN 需求代码编写与交互自测」执行未通过" }

  // QA 黑盒验收用例设计 (qa-planner)
  const step4 = await node("qa-planner", {
    timeoutSec: 60,
  }, {
    name: "QA 黑盒验收用例设计",
  })
  if (!step4.ok) return { status: 'failed', error: "节点「QA 黑盒验收用例设计」执行未通过" }

  // 开发服务靶机就绪 (局域网 Metro) (env-prepare)
  const step5 = await node("env-prepare", {
    command: "APP_SUB_DIR='{{appSubDir}}'\necho \"[Dev Server] 当前执行目录: $(pwd)\"\n\n# 应用根目录定位: 显式变量 appSubDir 优先, 其次工作区根目录, 最后浅层自动探测\nif [ -n \"$APP_SUB_DIR\" ]; then\n  APP_SUB_DIR=\"${APP_SUB_DIR%/}\"\n  if [ ! -d \"$APP_SUB_DIR\" ]; then\n    echo \"[Dev Server] 错误: appSubDir 指向的目录不存在: $APP_SUB_DIR\"\n    echo \"[Dev Server] 处理: 检查流水线变量 appSubDir, 或在本节点微调为正确的相对路径\"\n    exit 1\n  fi\n  cd \"$APP_SUB_DIR\"\n  echo \"[Dev Server] 按 appSubDir 切换至应用目录: $(pwd)\"\nelif [ -f \"package.json\" ]; then\n  echo \"[Dev Server] 当前目录即为应用根目录\"\nelse\n  FOUND_DIR=$(find . -maxdepth 3 -name \"package.json\" -not -path \"*/node_modules/*\" 2>/dev/null | head -n 1 | xargs -r dirname)\n  if [ -n \"$FOUND_DIR\" ] && [ -d \"$FOUND_DIR\" ]; then\n    cd \"$FOUND_DIR\"\n    echo \"[Dev Server] 自动定位到应用目录: $(pwd)\"\n  fi\nfi\n\nWEB_PORT={{worktree.ports.webPort}}\nNODE_BIN='{{nodeBinPath}}'\nDEV_CMD='{{devCommand}}'\n\necho \"[Dev Server] 宿主端口: $WEB_PORT\"\n\nLAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)\nif [ -n \"$LAN_IP\" ]; then\n  echo \"[Dev Server] iPhone 走局域网访问 Metro: http://$LAN_IP:$WEB_PORT\"\nelse\n  echo \"[Dev Server] 警告: 未识别本机局域网地址, iPhone 可能无法访问 Metro\"\nfi\n\n# 展开 ~ 前缀: 引号内的波浪号不会被 shell 展开, 而 #!/usr/bin/env node 走 env 查找时会忽略它,\n# 导致 npx/npm 实际用系统 Node 启动 (架构与 node_modules 里的 esbuild 二进制不匹配)\ncase \"$NODE_BIN\" in\n  \"~\"/*) NODE_BIN=\"$HOME/${NODE_BIN#\\~/}\" ;;\nesac\nif [ -n \"$NODE_BIN\" ] && [ -d \"$NODE_BIN\" ]; then\n  export PATH=\"$NODE_BIN\":$PATH\n  echo \"[Dev Server] 已注入 Node 运行时目录: $NODE_BIN\"\nelif [ -n \"$NODE_BIN\" ]; then\n  echo \"[Dev Server] 警告: Node 运行时目录不存在, 沿用系统 Node ($NODE_BIN)\"\nfi\necho \"[Dev Server] 当前 Node: $(command -v node) $(node -v 2>&1) / 架构: $(node -p 'process.arch' 2>/dev/null)\"\n\ncase \"$DEV_CMD\" in\n  *--port*) RUN_CMD=\"$DEV_CMD\" ;;\n  *) RUN_CMD=\"$DEV_CMD --port=$WEB_PORT\" ;;\nesac\necho \"[Dev Server] 启动开发服务: $RUN_CMD\"\n$RUN_CMD\n\n",
    healthUrl: "http://127.0.0.1:{{worktree.ports.webPort}}/status",
    warmupTimeoutMs: 180000,
    timeoutSec: 120,
    platform: "web",
    editableParams: [
      {
        "key": "appSubDir",
        "label": "应用子目录",
        "placeholder": "febase/rn-xxx",
        "hint": "相对工作区根目录, 留空则自动探测"
      }
    ],
  }, {
    name: "开发服务靶机就绪 (局域网 Metro)",
  })
  if (!step5.ok) return { status: 'failed', error: "节点「开发服务靶机就绪 (局域网 Metro)」执行未通过" }

  // iPhone 真机与 WDA 会话就绪 (cli)
  const step6 = await node("cli", {
    command: "set -uo pipefail\nWDA_URL='{{wdaEndpoint}}'\nWDA_DIR=\"$HOME/.openloop/tools/WebDriverAgent\"\nDEV_JSON=\"${TMPDIR:-/tmp}/openloop_ios_devices.json\"\n\nprobe() {\n  local sid code\n  sid=$(curl -s -m 8 -X POST \"$WDA_URL/session\" -H 'Content-Type: application/json' \\\n        -d '{\"capabilities\":{\"alwaysMatch\":{\"platformName\":\"iOS\",\"automationName\":\"XCUITest\"}}}' | jq -r '.sessionId // empty' 2>/dev/null)\n  if [ -z \"$sid\" ]; then return 1; fi\n  code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' \"$WDA_URL/session/$sid/window/size\")\n  curl -s -m 5 -X DELETE \"$WDA_URL/session/$sid\" >/dev/null 2>&1 || true\n  [ \"$code\" = \"200\" ]\n}\n\necho \"[1/3] 真机连接\"\nxcrun devicectl list devices --json-output \"$DEV_JSON\" >/dev/null 2>&1 || true\nUDID=\"${WDA_DEVICE_UDID:-$(jq -r '\n  [\n    .result.devices[]\n    | select(\n        (.hardwareProperties.reality == \"physical\" or .properties.hardware.reality == \"physical\")\n        and\n        (\n          .connectionProperties.tunnelState == \"connected\"\n          or .properties.connection.state == \"connected\"\n          or .connectionProperties.pairingState == \"paired\"\n          or .properties.connection.pairingState == \"paired\"\n        )\n      )\n  ][0]\n  | (.hardwareProperties.udid // .properties.hardware.udid // empty)\n' \"$DEV_JSON\" 2>/dev/null)}\"\n\nif [ -z \"${UDID:-}\" ]; then\n  echo \"[iOS 现场] 错误: 未发现已连接的真机\"\n  echo \"[iOS 现场] 处理: 数据线连接 iPhone, 解锁并点【信任此电脑】\"\n  exit 1\nfi\n\nNAME=$(jq -r --arg u \"$UDID\" '\n  .result.devices[]\n  | select(.hardwareProperties.udid == $u or .properties.hardware.udid == $u)\n  | (.deviceProperties.name // .properties.state.name // empty)\n' \"$DEV_JSON\" 2>/dev/null)\necho \"[iOS 现场] 真机: ${NAME:-未知} ($UDID)\"\n\n# 若 CoreDevice 隧道休眠，主动探测一次以唤醒隧道连接\nxcrun devicectl device info lockState --device \"$UDID\" >/dev/null 2>&1 || true\n\necho \"[2/3] WDA 会话探测 ($WDA_URL)\"\nif curl -s -f -m 3 \"$WDA_URL/status\" >/dev/null 2>&1; then\n  curl -s -m 3 \"$WDA_URL/status\" | jq -r '\"WDA: \\(.value.device // \"?\") | iOS \\(.value.os.version // \"?\") | ready \\(.value.ready)\"' 2>/dev/null || true\nfi\nif probe; then\n  echo \"[iOS 现场] WDA 会话可用，无需重启\"\n  exit 0\nfi\n\necho \"[3/3] WDA 会话不可用（UI 测试授权失效或进程已退出），重启 WebDriverAgent\"\nif [ ! -d \"$WDA_DIR/WebDriverAgent.xcodeproj\" ]; then\n  echo \"[iOS 现场] 错误: 未找到 WebDriverAgent 工程 ($WDA_DIR)\"\n  exit 1\nfi\nmkdir -p \"$WDA_DIR/logs\"\npkill -f \"xcodebuild test-without-building\" >/dev/null 2>&1 || true\nsleep 2\n\npython3 - \"$WDA_DIR\" \"$UDID\" <<'PY'\nimport os, subprocess, sys\n\nwda_dir, udid = sys.argv[1], sys.argv[2]\nlog = open(os.path.join(wda_dir, 'logs', 'guard.log'), 'ab')\nsubprocess.Popen(\n    [\n        'xcodebuild', 'test-without-building',\n        '-project', os.path.join(wda_dir, 'WebDriverAgent.xcodeproj'),\n        '-scheme', 'WebDriverAgentRunner',\n        '-destination', f'id={udid}',\n        '-derivedDataPath', os.path.join(wda_dir, 'build'),\n    ],\n    cwd=wda_dir,\n    stdin=subprocess.DEVNULL,\n    stdout=log,\n    stderr=log,\n    start_new_session=True,\n)\nprint('[iOS 现场] WebDriverAgent 已在新会话中启动')\nPY\n\nfor i in $(seq 1 60); do\n  sleep 3\n  if probe; then\n    echo \"[iOS 现场] WDA 会话已恢复 (耗时 $((i * 3))s)\"\n    exit 0\n  fi\ndone\n\necho \"[iOS 现场] 错误: WDA 重启超时, 请检查 $WDA_DIR/logs/guard.log\"\ntail -20 \"$WDA_DIR/logs/guard.log\" 2>/dev/null || true\nexit 1\n",
    timeoutSec: 300,
  }, {
    name: "iPhone 真机与 WDA 会话就绪",
  })
  if (!step6.ok) return { status: 'failed', error: "节点「iPhone 真机与 WDA 会话就绪」执行未通过" }

  // 冷启 App 并深链直达目标页 (iOS 真机) (hook)
  const step7 = await node("hook", {
    command: "echo \"[iOS DeepLink] 经深链直达目标页 (复用已登录进程, 不做登录门禁)\"\n\nWEB_PORT={{worktree.ports.webPort}}\nWDA_URL='{{wdaEndpoint}}'\nAPP_PKG='{{appPackage}}'\nLINK='{{deepLink}}'\nMIN_TEXT={{minTextNodes}}\nSETTLE_SEC=20\n\nLAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)\nif [ -z \"$LAN_IP\" ]; then\n  echo \"[iOS DeepLink] 错误: 未识别本机局域网地址, iPhone 无法访问 Metro\"\n  exit 1\nfi\necho \"[iOS DeepLink] 本机局域网地址: $LAN_IP, Metro 端口: $WEB_PORT\"\n\nwait_metro() {\n  i=0\n  while [ \"$i\" -lt 60 ]; do\n    if curl -s -m 2 \"http://$LAN_IP:$WEB_PORT/status\" 2>/dev/null | grep -q \"packager-status:running\"; then\n      echo \"[iOS DeepLink] Metro 已就绪 (http://$LAN_IP:$WEB_PORT)\"\n      return 0\n    fi\n    i=$((i + 1))\n    sleep 2\n  done\n  echo \"[iOS DeepLink] 错误: Metro 未就绪 (http://$LAN_IP:$WEB_PORT/status), 已等待 120 秒\"\n  echo \"[iOS DeepLink] 处理: 从节点 [5. 开发服务靶机就绪] 重试, 该节点负责拉起 Metro\"\n  return 1\n}\n\nif [ -z \"$LINK\" ]; then\n  COMPONENT='{{rnComponent}}'\n  if [ -z \"$COMPONENT\" ] && [ -f ./appJson.json ]; then\n    COMPONENT=$(sed -n 's/.*\"name\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' ./appJson.json | head -n 1)\n  fi\n  if [ -z \"$COMPONENT\" ]; then\n    echo \"[iOS DeepLink] 错误: 无法确定 RN 组件名 (未提供 rnComponent, 工作区根目录也无可解析的 appJson.json)\"\n    exit 1\n  fi\n  BUNDLE_URL=\"http%3A%2F%2F$LAN_IP%3A$WEB_PORT%2Findex.ios.bundle%3Fdev%3Dtrue\"\n  LINK=\"orpheus://rnpage?url=$BUNDLE_URL&component=$COMPONENT\"\n  QUERY='{{deepLinkQuery}}'\n  if [ -n \"$QUERY\" ]; then\n    LINK=\"$LINK&$QUERY\"\n  fi\n  echo \"[iOS DeepLink] 组件名: $COMPONENT (来源: appJson.json 或 rnComponent)\"\nfi\necho \"[iOS DeepLink] 目标 URL: $LINK\"\n\nwait_metro || exit 1\n\nSID=$(curl -s -m 10 -X POST \"$WDA_URL/session\" -H 'Content-Type: application/json' \\\n      -d '{\"capabilities\":{\"alwaysMatch\":{\"platformName\":\"iOS\",\"automationName\":\"XCUITest\"}}}' | jq -r '.sessionId // empty')\nif [ -z \"$SID\" ]; then\n  echo \"[iOS DeepLink] 错误: 无法创建 WDA 会话 ($WDA_URL)\"\n  exit 1\nfi\ncleanup() { curl -s -m 5 -X DELETE \"$WDA_URL/session/$SID\" >/dev/null 2>&1 || true; }\ntrap cleanup EXIT\n\n# 冷启: 先终止目标应用, 保证每次验收都从全新进程进入, 避免上次残留页面干扰\nif [ -n \"$APP_PKG\" ]; then\n  echo \"[iOS DeepLink] 冷启目标应用: 先终止 $APP_PKG\"\n  curl -s -m 10 -X POST \"$WDA_URL/session/$SID/wda/apps/terminate\" -H 'Content-Type: application/json' \\\n    -d \"$(jq -cn --arg b \"$APP_PKG\" '{bundleId:$b}')\" >/dev/null 2>&1 || true\n  sleep 2\n  STILL=$(curl -s -m 10 \"$WDA_URL/session/$SID/wda/activeAppInfo\" | jq -r '.value.bundleId // empty' 2>/dev/null)\n  echo \"[iOS DeepLink] 终止后前台应用: ${STILL:-未知}\"\nelse\n  echo \"[iOS DeepLink] 警告: 未配置 appPackage, 跳过冷启\"\nfi\n\ncurl -s -m 30 -X POST \"$WDA_URL/session/$SID/url\" -H 'Content-Type: application/json' \\\n  -d \"$(jq -cn --arg u \"$LINK\" --arg b \"$APP_PKG\" '{url:$u, bundleId:$b}')\" >/dev/null\necho \"[iOS DeepLink] 深链已下发, 等待页面渲染完成...\"\n\nactive_bundle() {\n  curl -s -m 10 \"$WDA_URL/session/$SID/wda/activeAppInfo\" | jq -r '.value.bundleId // empty' 2>/dev/null\n}\n\npage_source() {\n  curl -s -m 20 \"$WDA_URL/session/$SID/source\" | jq -r '.value // empty' 2>/dev/null\n}\n\nREADY_HITS=0\nSETTLED=0\ni=0\nwhile [ \"$i\" -lt 40 ]; do\n  i=$((i + 1))\n  sleep 3\n\n  BUNDLE=$(active_bundle)\n  if [ -n \"$BUNDLE\" ] && [ \"$BUNDLE\" != \"$APP_PKG\" ]; then\n    echo \"[iOS DeepLink] 探测 $i/40: 前台应用为 $BUNDLE, 等待目标应用前置\"\n    READY_HITS=0\n    continue\n  fi\n\n  # 自动关闭底层 APM/Heimdall 误报弹窗\n  EID=$(curl -s -m 5 -X POST \"$WDA_URL/session/$SID/element\" -H 'Content-Type: application/json'         -d '{\"using\":\"name\",\"value\":\"好的\"}' | jq -r '.value.ELEMENT // empty' 2>/dev/null)\n  if [ -n \"$EID\" ]; then\n    echo \"[iOS DeepLink] 检测到底层提示弹窗, 自动点击【好的】\"\n    curl -s -m 5 -X POST \"$WDA_URL/session/$SID/element/$EID/click\" -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 || true\n    sleep 1\n  fi\n\n  SRC=$(page_source)\n  if [ -z \"$SRC\" ]; then\n    echo \"[iOS DeepLink] 探测 $i/40: 界面树暂不可读, 继续等待\"\n    READY_HITS=0\n    continue\n  fi\n\n  if printf '%s' \"$SRC\" | grep -qE 'Could not connect to development server|Unable to resolve module|No bundle URL present|REDBOX'; then\n    echo \"[iOS DeepLink] 错误: RN 红屏, bundle 未能加载\"\n    printf '%s' \"$SRC\" | grep -oE 'http://[^\"< ]+' | head -n 2\n    exit 1\n  fi\n\n  COUNT=$(printf '%s' \"$SRC\" | grep -o 'label=\"[^\"]\\+\"' | grep -vc 'label=\"\"')\n  if [ \"$COUNT\" -ge \"$MIN_TEXT\" ]; then\n    READY_HITS=$((READY_HITS + 1))\n    echo \"[iOS DeepLink] 探测 $i/40: 页面已渲染 (文本节点 $COUNT, 连续确认 $READY_HITS/2)\"\n    if [ \"$READY_HITS\" -ge 2 ] && [ \"$SETTLED\" -eq 0 ]; then\n      SETTLED=1\n      READY_HITS=0\n      echo \"[iOS DeepLink] 首次渲染完成, 观察 ${SETTLE_SEC}s 以确认页面不再重载...\"\n      sleep \"$SETTLE_SEC\"\n      continue\n    fi\n    if [ \"$READY_HITS\" -ge 2 ] && [ \"$SETTLED\" -eq 1 ]; then\n      echo \"[iOS DeepLink] 页面渲染稳定, 交由后续 QA 自动化执行验收\"\n      exit 0\n    fi\n    continue\n  fi\n\n  echo \"[iOS DeepLink] 探测 $i/40: 文本节点 $COUNT, 等待首屏内容\"\n  READY_HITS=0\ndone\n\necho \"[iOS DeepLink] 等待超时: 页面未在限定时间内渲染完成\"\nexit 1\n",
    timeoutSec: 420,
    editableParams: [
      {
        "key": "appPackage",
        "label": "目标 App 包名 (Bundle ID)",
        "placeholder": "com.netease.cloudmusicother",
        "hint": "iOS Bundle ID (如 com.netease.cloudmusicother / com.netease.cloudmusicinhouse / com.netease.cloudmusic)"
      },
      {
        "key": "deepLink",
        "label": "启动地址",
        "placeholder": "orpheus://event?id=37854606436&userId=67288227",
        "hint": "留空则自动拼接 orpheus://rnpage 默认深链"
      },
      {
        "key": "deepLinkQuery",
        "label": "query 参数",
        "placeholder": "id=37854606436&userId=67288227",
        "hint": "启动地址留空时生效: 只填业务参数, 自动追加到自动拼接的深链后面"
      }
    ],
  }, {
    name: "冷启 App 并深链直达目标页 (iOS 真机)",
  })
  if (!step7.ok) return { status: 'failed', error: "节点「冷启 App 并深链直达目标页 (iOS 真机)」执行未通过" }

  // 自动化验收执行与视觉截帧 (iOS) (midscene)
  const step8 = await node("midscene", {
    testUrl: "{{deepLink}}",
    instructions: [
      "校验当前界面正常渲染，无红屏或崩溃提示",
      "校验当前界面无异常空白与元素错位"
    ],
    timeoutSec: 180,
    platform: "ios",
    deviceSerial: null,
    appPackage: "{{appPackage}}",
    skipLaunch: true,
    wdaEndpoint: "http://localhost:8100",
    editableParams: [
      {
        "key": "appPackage",
        "label": "目标 App 包名 (Bundle ID)",
        "placeholder": "com.netease.cloudmusicother",
        "hint": "iOS Bundle ID (如 com.netease.cloudmusicother / com.netease.cloudmusicinhouse / com.netease.cloudmusic)"
      }
    ],
  }, {
    name: "自动化验收执行与视觉截帧 (iOS)",
  })
  if (!step8.ok) return { status: 'failed', error: "节点「自动化验收执行与视觉截帧 (iOS)」执行未通过" }

  // 视觉复核与人工验收门禁 (qa-approval)
  const step9 = await approve({
    title: "视觉复核与人工验收门禁",
    prompt: "Agent 已完成代码修改，iPhone 真机现场就绪，自动化验收已执行。请查看截帧与实际设备画面，确认无误后点击【验收通过】，系统将自动合并代码并清理沙箱。",
    checklist: [
      "代码 Diff 干净规范，无调试残留与冗余代码",
      "iPhone 真机页面正常渲染，无红屏与报错",
      "验收截帧显示页面交互与文案符合预期"
    ],
  })
  if (!step9.ok) return { status: 'failed', error: "节点「视觉复核与人工验收门禁」执行未通过" }

  // 验收通过后自动合并代码 (worktree-merge)
  const step10 = await sandbox.merge({
    name: "验收通过后自动合并代码",
  })
  if (!step10.ok) return { status: 'failed', error: "节点「验收通过后自动合并代码」执行未通过" }

  // 沙箱环境清理与分支回收 (worktree-cleanup)
  const step11 = await sandbox.cleanup({
    name: "沙箱环境清理与分支回收",
  })
  if (!step11.ok) return { status: 'failed', error: "节点「沙箱环境清理与分支回收」执行未通过" }

  return { status: 'success' }
}
