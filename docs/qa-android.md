# QA 自动化 · Android 端支持

openLoop QA 自动化支持 Web、Android、iOS 三端执行（iOS 见 [qa-ios.md](qa-ios.md)）。
Android 端基于 Midscene 官方`@midscene/android` SDK，可驱动真机与模拟器（AVD、MuMu、雷电等）。

## 前置条件

1. 安装 ADB（Android Studio 或 command-line tools），并确保 `adb version` 可执行。
2. 设备开启 **USB 调试**（部分机型还需开启「USB 调试（安全设置）」），并在设备上
   确认「允许 USB 调试」授权弹窗。
3. 验证连接：`adb devices -l`，状态应为 `device`。

## 多模态模型配置（可选，缺失时自动降级）

Midscene 的视觉推理需要模型密钥。未配置时 Android 驱动自动降级为 ADB 直通模式
（物理按键、坐标点击、UIAutomator 文本定位），用例仍可执行但语义理解能力有限。

推荐在 **设置 → 自动化测试** 中填写「模型服务地址 / 接口密钥 / 模型名称 / 模型家族」，
保存后立即生效，无需重启服务。配置写入本地 SQLite，由 Core 在启动与保存时同步到进程环境变量。

也可以直接用环境变量（优先级相同，设置页留空即沿用环境变量）：

```bash
export MIDSCENE_MODEL_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
export MIDSCENE_MODEL_API_KEY="your-api-key"
export MIDSCENE_MODEL_NAME="qwen3.7-plus"
export MIDSCENE_MODEL_FAMILY="qwen3"
```

### 已验证组合：本地 Magpie 网关

```
模型服务地址: http://127.0.0.1:3425/v1
接口密钥:     magpie
模型名称:     deepseek/deepseek-flash
模型家族:     deepseek
```

DeepSeek 通过 Magpie 可正常识图，且 Midscene 内置 DeepSeek 专用的坐标解析器。
已在 Pixel 6 模拟器（Android 16）上跑通「截图定位 → 点击 → 视觉断言」全链路。

## 使用流程

1. 进入 QA 自动化 → 用例 Tab → 新建用例。
2. 平台切换选择 **Android 移动端**。
3. 选择目标设备（或保留「自动调度首个可用设备」）。
4. 填写目标应用包名，可点击「抓取前台 App」自动读取设备当前前台包名与 Activity。
5. 编排步骤：`aiAction`（操作）、`aiAssert`（视觉断言）、`aiWaitFor`（智能等待）。
6. 保存并执行。

局域网无线调试：在设备选择区点击「WiFi 远程连接」，输入 `IP:5555` 即可免 USB 直连。

## 性能策略

| 环节 | 策略 |
| :--- | :--- |
| 画面采集 | 优先复用 Midscene 设备截图管道（scrcpy 视频流），失败回退 `adb exec-out screencap` |
| 文本输入 | `imeStrategy: always-yadb`，绕开输入法改写，不弹软键盘 |
| 键盘收起 | `keyboardDismissStrategy: back-first`，避免 ESC 误触发 WebView 行为 |
| 应用唤起 | Midscene `agent.launch()`，自动处理包名/URL/Activity 三种形态 |

## 相关接口

- `GET /api/qa/devices/android` — 在线设备与模拟器列表
- `GET /api/qa/devices/android/current-app?serial=` — 前台应用包名
- `POST /api/qa/devices/android/connect` — WiFi ADB 连接（`{ address }`）
- `POST /api/qa/devices/android/disconnect` — 断开 WiFi ADB

## 产物位置与清理

| 产物 | 位置 | 说明 |
| :--- | :--- | :--- |
| 步骤截图 | `~/.openloop/artifacts/<runId>/step_N.png` | 时间线回放用，随运行记录删除 |
| Midscene 调试产物 | `~/.openloop/midscene/` | dump、规划日志、报告，纯诊断数据 |
| 任务附件 | `~/.openloop/attachments/` | 任务上传的图片 |

Midscene 默认把调试产物写进进程工作目录的 `midscene_run/`。Core 启动时会把
`MIDSCENE_RUN_DIR` 重定向到数据目录，避免污染仓库，并纳入存储统计。

清理入口：设置 → 存储与清理。内置清理会一并删除调试产物目录。

## 执行状态语义

驱动启动失败（无设备、ADB 不可用、浏览器拉起失败）时，本次运行直接判定为
`FAILED`，所有步骤标记为失败并附带同一个启动错误。不会产生“模拟通过”的结果。

## 常见问题

- **`INJECT_EVENTS` 权限异常**：设备未解锁或未开启 USB 调试，解锁屏幕后重试。
- **输入后文本被清空**：目标控件监听 ESC 键，驱动已默认使用 BACK 键收起键盘。
- **安全页面截图为黑屏**：`FLAG_SECURE` 保护，可在驱动构造参数中切换
  `screenshotStrategy: 'always-yadb'`。
