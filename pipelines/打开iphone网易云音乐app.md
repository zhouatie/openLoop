---
id: wf_mvkbxeg7
name: 打开iphone网易云音乐app
tags: 工作
---

# 目标

自定义自动化编排流程

# 流程

## 1. 检查真机与 WDA 通道

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 60 秒。
失败就停，把报错原文记为失败原因。

```bash
set -e
WDA_URL="${WDA_ENDPOINT:-http://localhost:8100}"
DEV_JSON="${TMPDIR:-/tmp}/openloop_ios_devices.json"
STATUS_FILE="${TMPDIR:-/tmp}/openloop_ios_wda_status.json"

echo "[1/3] Xcode 命令行路径"
xcode-select -p

echo "[2/3] WebDriverAgent 连通性 ($WDA_URL)"
if curl -s -f -m 3 "$WDA_URL/status" -o "$STATUS_FILE"; then
  echo "WDA 已就绪"
  jq -r '"设备: \(.value.device // "未知") | 系统: \(.value.os.version // "?") | ready: \(.value.ready)"' "$STATUS_FILE" 2>/dev/null || head -c 300 "$STATUS_FILE"
  exit 0
fi
echo "WDA 不可达: $WDA_URL"

echo "[3/3] 真机连接状态"
xcrun devicectl list devices --json-output "$DEV_JSON" >/dev/null 2>&1 || true
PHONES=$(jq -r '.result.devices[] | select(.visibilityClass=="default") | "\(.deviceProperties.name) [\(.connectionProperties.transportType)/\(.connectionProperties.tunnelState)]"' "$DEV_JSON" 2>/dev/null || true)

if [ -z "$PHONES" ]; then
  echo "未发现已配对真机"
  echo "修复: 数据线连接 iPhone, 解锁并在弹窗点【信任此电脑】"
  exit 1
fi
echo "$PHONES"

if echo "$PHONES" | grep -q "/connected"; then
  echo "真机已连接, 但 WDA 未启动. 修复步骤:"
  echo "  1. Xcode 打开 WebDriverAgent.xcodeproj, 为 WebDriverAgentRunner 配置开发者签名"
  echo "  2. Scheme 选 WebDriverAgentRunner, Product > Test 运行到真机"
  echo "  3. 另开终端执行端口转发: iproxy 8100 8100"
else
  echo "真机未连接 (tunnelState 非 connected). 修复步骤:"
  echo "  1. 数据线连接 iPhone, 解锁并在弹窗点【信任此电脑】"
  echo "  2. 连接恢复后启动 WDA: WebDriverAgentRunner > Test, 再执行 iproxy 8100 8100"
fi
exit 1
```

## 2. 确保 WDA 会话可用（失效自动重启）

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 300 秒。
失败就停，把报错原文记为失败原因。

```bash
set -uo pipefail
WDA_URL="${WDA_ENDPOINT:-http://localhost:8100}"
WDA_DIR="$HOME/.openloop/tools/WebDriverAgent"
DEV_JSON="${TMPDIR:-/tmp}/openloop_wda_guard_devices.json"
LOG="$WDA_DIR/logs/guard.log"

probe() {
  local sid code
  sid=$(curl -s -m 8 -X POST "$WDA_URL/session" -H 'Content-Type: application/json' \
        -d '{"capabilities":{"alwaysMatch":{"platformName":"iOS","automationName":"XCUITest"}}}' | jq -r '.sessionId // empty' 2>/dev/null)
  if [ -z "$sid" ]; then return 1; fi
  code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$WDA_URL/session/$sid/window/size")
  curl -s -m 5 -X DELETE "$WDA_URL/session/$sid" >/dev/null 2>&1 || true
  [ "$code" = "200" ]
}

if probe; then
  echo "WDA 会话可用，无需重启"
  exit 0
fi

echo "WDA 会话不可用（UI 测试授权已失效或进程已退出），准备重启 WebDriverAgent"

if [ ! -d "$WDA_DIR/WebDriverAgent.xcodeproj" ]; then
  echo "未找到 WebDriverAgent 工程: $WDA_DIR"
  exit 1
fi

xcrun devicectl list devices --json-output "$DEV_JSON" >/dev/null 2>&1 || true
UDID="${WDA_DEVICE_UDID:-$(jq -r '[.result.devices[] | select(.hardwareProperties.reality=="physical" and .connectionProperties.tunnelState=="connected")][0].hardwareProperties.udid // empty' "$DEV_JSON" 2>/dev/null)}"
if [ -z "${UDID:-}" ]; then
  echo "未发现已连接的真机。请用数据线连接 iPhone，解锁并点【信任此电脑】"
  exit 1
fi
echo "目标真机: $UDID"

mkdir -p "$WDA_DIR/logs"
pkill -f "xcodebuild test-without-building" >/dev/null 2>&1 || true
sleep 2

python3 - "$WDA_DIR" "$UDID" <<'PY'
import os, subprocess, sys

wda_dir, udid = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(wda_dir, 'logs'), exist_ok=True)
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
print('WebDriverAgent 已在新会话中启动')
PY

for i in $(seq 1 60); do
  sleep 3
  if probe; then
    echo "WDA 会话已恢复 (耗时 $((i * 3))s)"
    exit 0
  fi
done

echo "WDA 重启超时，请检查日志: $LOG"
tail -20 "$LOG" 2>/dev/null || true
exit 1
```

## 3. iOS 现场就绪（Xcode + WDA 复检）

调 `run_node`，type 用 `env-prepare` 拉起开发服务靶机。超时 90 秒。
config 里的 command 用下面这段命令原文，不要改写：

```bash
undefined
```
服务在后台常驻，失败就停。

## 4. 打开网易云音乐并核验首页

调 `run_node`，type 用 `midscene` 执行 UI 自动化验收与视觉截帧。超时 300 秒。
platform 用 `ios`。
testUrl 用 `com.netease.cloudmusicother`。
appPackage 用 `com.netease.cloudmusicother`。
wdaEndpoint 用 `http://localhost:8100`。
instructions 用下面的清单：
- 若真机屏幕锁定或处于锁屏状态，先点亮并解锁屏幕
- 等待网易云音乐启动页结束，进入登录页或首页
- 若出现权限、通知或用户协议弹窗，点击允许或同意
- 校验当前界面正常渲染，无崩溃、白屏或异常弹窗
失败就停。

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
