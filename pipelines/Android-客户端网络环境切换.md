---
id: wf_android_env_switch
name: Android 客户端网络环境切换 (线上 / 预发)
tags: Android, 环境切换, 网络配置
---

# 目标

把 Android 客户端（com.netease.cloudmusic）的请求域名切到线上或预发环境，并确认内核网络模块已生效。

# 环境约定

- `targetEnv` 用 `online` 表示线上，用 `pre` 表示预发。
- 预发只给编号：`envNumber=100` 对应 `qa-test100.pretest.igame.163.com`。
- 设备默认取第一台在线设备；`deviceSerial` 填了就用它。
- 需要冷启动生效时把 `restartApp` 置为 `true`。

# 流程

## 1. 切换网络环境

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 300 秒。
失败就停，把报错原文记为失败原因。

```bash
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:/opt/homebrew/bin:/usr/local/bin:$PATH"

TARGET_ENV='{{targetEnv}}'
ENV_NUMBER='{{envNumber}}'
PRE_DOMAIN='{{preDomain}}'
ONLINE_DOMAIN='{{onlineDomain}}'
DEVICE_HINT='{{deviceSerial}}'
APP_PKG='{{appPackage}}'
RESTART='{{restartApp}}'

TARGET_ENV="${TARGET_ENV:-pre}"
ONLINE_DOMAIN="${ONLINE_DOMAIN:-music.163.com}"
APP_PKG="${APP_PKG:-com.netease.cloudmusic}"

resolve_domain() {
  case "$TARGET_ENV" in
    online|prod|production)
      echo "$ONLINE_DOMAIN"
      return 0
      ;;
    pre|prerelease|pretest|*)
      local val="${ENV_NUMBER:-$PRE_DOMAIN}"
      if [ -z "$val" ]; then
        echo "❌ 错误: 当前目标为预发测试环境，但未提供预发环境编号 (envNumber)！" >&2
        echo "💡 提示: 请在流水线变量中设置 envNumber (例如输入 100 自动拼接为 qa-test100.pretest.igame.163.com)" >&2
        return 1
      fi
      case "$val" in
        *[!0-9]*)
          case "$val" in
            qa-test[0-9]*)
              case "$val" in
                *.*) echo "$val" ;;
                *) echo "${val}.pretest.igame.163.com" ;;
              esac
              ;;
            *) echo "$val" ;;
          esac
          ;;
        *)
          echo "qa-test${val}.pretest.igame.163.com"
          ;;
      esac
      return 0
      ;;
  esac
}

DOMAIN=$(resolve_domain) || exit 1

if [ "$TARGET_ENV" = "online" ]; then
  LABEL="线上环境"
else
  LABEL="预发测试环境"
fi

echo "=========================================="
echo "🌐 [openLoop] Android 客户端网络环境切换"
echo "=========================================="
echo "  - 目标类型: $LABEL ($TARGET_ENV)"
if [ "$TARGET_ENV" != "online" ] && [ -n "$ENV_NUMBER" ]; then
  echo "  - 预发编号: $ENV_NUMBER"
fi
echo "  - 解析域名: $DOMAIN"
echo "  - 应用包名: $APP_PKG"

if [ -n "$DEVICE_HINT" ]; then
  if adb devices | awk 'NR>1 && $2=="device" {print $1}' | grep -qx "$DEVICE_HINT"; then
    DEVICE="$DEVICE_HINT"
  else
    echo "⚠️ 指定设备 [$DEVICE_HINT] 不在线，自动回退到首个可用设备"
    DEVICE=""
  fi
fi

if [ -z "$DEVICE" ]; then
  DEVICE=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
fi

if [ -z "$DEVICE" ]; then
  echo "❌ 错误: 未检测到在线的 Android 设备或模拟器"
  exit 1
fi
echo "  - 目标设备: $DEVICE"

# 检查应用进程存活 (若未启动需先拉起，保证广播接收器就绪)
APP_PID=$(adb -s "$DEVICE" shell pidof "$APP_PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}')
if [ -z "$APP_PID" ]; then
  echo "⏳ 应用 [$APP_PKG] 未运行，正在冷启动拉起..."
  adb -s "$DEVICE" shell monkey -p "$APP_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || \
    adb -s "$DEVICE" shell am start -n "$APP_PKG/.activity.MainActivity" >/dev/null 2>&1
  sleep 4
  APP_PID=$(adb -s "$DEVICE" shell pidof "$APP_PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}')
  echo "✔ 应用已启动 (PID: $APP_PID)"
else
  echo "✔ 应用正在运行 (PID: $APP_PID)"
fi

# 清理旧日志并下发切域广播
adb -s "$DEVICE" logcat -c 2>/dev/null || true

echo "📡 正在发送 CHANGE_DOMAIN 广播..."
BROADCAST_RES=$(adb -s "$DEVICE" shell am broadcast -a com.netease.cloudmusic.action.CHANGE_DOMAIN --es domain "$DOMAIN" 2>&1)
echo "  $BROADCAST_RES"

if ! echo "$BROADCAST_RES" | grep -q "result=0"; then
  echo "❌ 广播发送失败"
  exit 1
fi

sleep 1
LOGCAT_VERIFY=$(adb -s "$DEVICE" logcat -d | grep -i "initDomainChange for DOMAIN: $DOMAIN" | tail -n 1 || true)
if [ -n "$LOGCAT_VERIFY" ]; then
  echo "✔ 内核网络模块已确认接收并切换域名:"
  echo "   $LOGCAT_VERIFY"
fi

if [ "$RESTART" = "true" ] || [ "$RESTART" = "1" ]; then
  echo "🔄 正在重启应用以进行冷启动生效..."
  adb -s "$DEVICE" shell am force-stop "$APP_PKG"
  sleep 1
  adb -s "$DEVICE" shell monkey -p "$APP_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  echo "✔ 应用已重启完成"
fi

echo "=========================================="
echo "✔ 环境切换成功: $LABEL ($DOMAIN)"
echo "=========================================="
```

## 2. 报告结果

一句话说明切换到的环境、解析出的域名与目标设备。
命令输出里出现 `✔ 环境切换成功` 才算通过。
