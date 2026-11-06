---
id: wf_launch_android_emulator
name: 启动 Android 模拟器与环境探活
tags: Android,模拟器,环境准备
---

# 目标

自动检测在线 Android 模拟器，若未启动则在后台拉起 AVD 并等待系统完全开机就绪（无需绑定代码仓库）

# 流程

## 1. 检测并拉起 Android 模拟器

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。
失败就停，把报错原文记为失败原因。

```bash
# Android SDK 的 emulator / platform-tools 必须优先于 homebrew 目录:
# /usr/local/bin/emulator 是旧版 x86_64 tools/emulator 的软链, 在 Apple Silicon 上会启动即失败
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "=========================================="
echo "🤖 [openLoop] 检查 Android 运行环境"
echo "=========================================="

if ! command -v adb >/dev/null 2>&1; then
  echo "❌ 未检测到 adb 命令，请确保已安装 Android SDK platform-tools"
  exit 1
fi

if ! command -v emulator >/dev/null 2>&1; then
  echo "❌ 未检测到 emulator 命令，请确保已配置 Android SDK emulator 路径"
  exit 1
fi

echo "🔧 emulator 路径: $(command -v emulator)"
echo "   版本: $(emulator -version 2>/dev/null | head -n 1)"

# 1. 检查是否已有运行中的模拟器
RUNNING_EMU=$(adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {print $1; exit}')

if [ -n "$RUNNING_EMU" ]; then
  echo "✔ 检测到已有在线的 Android 模拟器: $RUNNING_EMU"
else
  # 2. 列出并确定目标 AVD
  AVAILABLE_AVDS=$(emulator -list-avds 2>/dev/null || true)
  echo "📋 本地已安装的 AVD 列表:"
  echo "$AVAILABLE_AVDS" | sed "s/^/  - /"

  TARGET_AVD="${AVD_NAME:-Pixel_6_useful}"
  if ! echo "$AVAILABLE_AVDS" | grep -qx "$TARGET_AVD"; then
    echo "⚠️ 指定 AVD [$TARGET_AVD] 不存在, 回退首个可用 AVD"
    TARGET_AVD=$(echo "$AVAILABLE_AVDS" | head -n 1)
  fi

  if [ -z "$TARGET_AVD" ]; then
    echo "❌ 本地未检测到任何 AVD，请先在 Android Studio 创建模拟器"
    exit 1
  fi

  # 模拟器输出必须落盘, 否则启动失败时无法定位原因
  EMU_LOG="$HOME/Library/Logs/openloop/emulator-${TARGET_AVD}.log"
  mkdir -p "$(dirname "$EMU_LOG")"
  : > "$EMU_LOG"

  echo "🚀 正在后台拉起模拟器: [$TARGET_AVD] ..."
  echo "   日志: $EMU_LOG"
  nohup emulator -avd "$TARGET_AVD" >"$EMU_LOG" 2>&1 &
  EMU_PID=$!
  echo "✔ 模拟器已派发启动 (PID: $EMU_PID)，等待 ADB 通信建立..."

  # 等待设备上线: 同时监控进程存活与超时, 避免模拟器静默退出后无限阻塞
  WAIT_MAX=180
  WAITED=0
  RUNNING_EMU=""
  while [ "$WAITED" -lt "$WAIT_MAX" ]; do
    RUNNING_EMU=$(adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {print $1; exit}')
    [ -n "$RUNNING_EMU" ] && break
    if ! kill -0 "$EMU_PID" 2>/dev/null; then
      echo "❌ 模拟器进程已退出 (PID: $EMU_PID)，最近日志:"
      tail -n 30 "$EMU_LOG"
      exit 1
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $((WAITED % 20)) -eq 0 ]; then
      echo "  等待 ADB 通信中... (${WAITED}s/${WAIT_MAX}s)"
    fi
  done

  if [ -z "$RUNNING_EMU" ]; then
    echo "❌ 等待 ADB 通信超时 (${WAIT_MAX}s)，模拟器仍在运行但未连上 adb。最近日志:"
    tail -n 30 "$EMU_LOG"
    exit 1
  fi
  echo "✔ ADB 通信已建立: $RUNNING_EMU"
fi

# 3. 轮询等待系统完全启动 (boot_completed = 1)
echo "⏳ 等待 Android 系统启动完成 (sys.boot_completed)..."
MAX_WAIT=180
ELAPSED=0

until [ "$(adb -s "$RUNNING_EMU" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "❌ 等待模拟器完全开机超时 (${MAX_WAIT}s)"
    exit 1
  fi
  if [ $((ELAPSED % 10)) -eq 0 ]; then
    echo "  仍在开机自检中... (${ELAPSED}s/${MAX_WAIT}s)"
  fi
done

# 4. 获取并展示设备元信息
MODEL=$(adb -s "$RUNNING_EMU" shell getprop ro.product.model 2>/dev/null | tr -d '\r')
VERSION=$(adb -s "$RUNNING_EMU" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')
API_LEVEL=$(adb -s "$RUNNING_EMU" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')
WM_SIZE=$(adb -s "$RUNNING_EMU" shell wm size 2>/dev/null | tr -d '\r')

echo "=========================================="
echo "✔ Android 模拟器已完全就绪！"
echo "  - 设备编号: $RUNNING_EMU"
echo "  - 设备型号: $MODEL"
echo "  - 系统版本: Android $VERSION (API $API_LEVEL)"
echo "  - 屏幕分辨率: $WM_SIZE"
echo "=========================================="
```

## 2. 移动端环境与 ADB 探活校验

调 `run_node`，type 用 `env-prepare` 拉起开发服务靶机。
预热最长等待 15000 毫秒。
config 里的 command 用下面这段命令原文，不要改写：

```bash
undefined
```
服务在后台常驻，失败就停。

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
