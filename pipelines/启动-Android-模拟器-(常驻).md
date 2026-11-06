---
id: wf_android_emulator_start
name: 启动 Android 模拟器 (常驻)
tags: Android,模拟器,环境准备
---

# 目标

仅用于拉起本地 Android 模拟器并等待开机就绪。模拟器以独立会话后台常驻，流水线节点结束后不会被回收，可直接供 QA 自动化、ADB 调试等后续任务复用。

# 流程

## 1. 拉起模拟器并等待开机就绪

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 360 秒。
失败就停，把报错原文记为失败原因。

```bash
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:/opt/homebrew/bin:/usr/local/bin:$PATH"

TARGET_AVD="${AVD_NAME:-Pixel_6_useful}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-240}"

echo "=========================================="
echo "🤖 [openLoop] 启动 Android 模拟器: $TARGET_AVD"
echo "=========================================="

if ! command -v adb >/dev/null 2>&1; then
  echo "❌ 未找到 adb 命令，请检查 Android SDK platform-tools"
  exit 1
fi
if ! command -v emulator >/dev/null 2>&1; then
  echo "❌ 未找到 emulator 命令，请检查 Android SDK emulator"
  exit 1
fi
echo "🔧 emulator: $(command -v emulator)"

# 目标 AVD 是否已在线（按 AVD 名匹配，避免误判其他模拟器）
find_online_target() {
  for dev in $(adb devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {print $1}'); do
    name=$(adb -s "$dev" emu avd name 2>/dev/null | head -n 1 | tr -d '\r')
    if [ "$name" = "$TARGET_AVD" ]; then
      echo "$dev"
      return 0
    fi
  done
  return 1
}

EMU_LOG="$HOME/Library/Logs/openloop/emulator-${TARGET_AVD}.log"

DEVICE=$(find_online_target) || true
if [ -n "$DEVICE" ]; then
  echo "✔ 目标 AVD 已在线，直接复用: $DEVICE"
else
  mkdir -p "$(dirname "$EMU_LOG")"
  : > "$EMU_LOG"
  echo "🚀 后台拉起模拟器（独立会话，节点结束后不被回收）"
  echo "   日志: $EMU_LOG"

  # 双 fork + setsid：模拟器进入独立会话与进程组，
  # 流水线节点结束时对节点进程组的 SIGKILL 不会波及模拟器进程
  python3 - "$(command -v emulator)" -avd "$TARGET_AVD" >"$EMU_LOG" 2>&1 <<'PY'
import os, sys
args = sys.argv[1:]
if os.fork() > 0:
    os._exit(0)
os.setsid()
if os.fork() > 0:
    os._exit(0)
n = os.open(os.devnull, os.O_RDONLY)
os.dup2(n, 0)
os.execvp(args[0], args)
PY

  echo "✔ 启动命令已派发，等待 ADB 通信建立..."
  WAITED=0
  DEVICE=""
  while [ -z "$DEVICE" ]; do
    if [ "$WAITED" -ge "$BOOT_TIMEOUT" ]; then
      echo "❌ 等待 ADB 通信超时 (${BOOT_TIMEOUT}s)，最近日志:"
      tail -n 30 "$EMU_LOG"
      exit 1
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    if [ $((WAITED % 20)) -eq 0 ]; then
      echo "  等待 ADB 通信中... (${WAITED}s/${BOOT_TIMEOUT}s)"
    fi
    DEVICE=$(find_online_target) || true
  done
  echo "✔ ADB 通信已建立: $DEVICE"
fi

echo "⏳ 等待系统完成开机 (sys.boot_completed)..."
ELAPSED=0
while [ "$(adb -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
  if [ "$ELAPSED" -ge "$BOOT_TIMEOUT" ]; then
    echo "❌ 等待开机完成超时 (${BOOT_TIMEOUT}s)"
    exit 1
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ $((ELAPSED % 20)) -eq 0 ]; then
    echo "  开机自检中... (${ELAPSED}s/${BOOT_TIMEOUT}s)"
  fi
done

q() { adb -s "$DEVICE" shell "$1" 2>/dev/null | tr -d '\r'; }
echo "=========================================="
echo "✔ Android 模拟器已就绪并常驻"
echo "  - AVD:     $TARGET_AVD"
echo "  - 设备编号: $DEVICE"
echo "  - 设备型号: $(q 'getprop ro.product.model')"
echo "  - 系统版本: Android $(q 'getprop ro.build.version.release') (API $(q 'getprop ro.build.version.sdk'))"
echo "  - 分辨率:   $(q 'wm size')"
echo "  - 日志:     $EMU_LOG"
echo "=========================================="
```

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。
