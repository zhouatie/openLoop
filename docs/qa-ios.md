# QA 自动化 · iOS 端支持

openLoop QA 自动化支持 Web、Android、iOS 三端执行。iOS 端基于 Midscene 官方
`@midscene/ios` SDK，通过 **WebDriverAgent（WDA）** 驱动模拟器与真机。

## 前置条件

1. 运行环境为 **macOS**，并安装 Xcode（`xcrun simctl list devices -j` 可执行）。
2. 启动 iOS 模拟器（`xcrun simctl boot <设备名>`）或连接已信任的真机。
3. 启动 WebDriverAgent：在 Xcode 中运行 `WebDriverAgentRunner`（模拟器可直接运行，
   真机需配置开发者签名）。
4. 验证连通：`curl http://localhost:8100/status`，返回 `value.ready=true`。

一个 WDA 端点对应一台设备，因此 iOS 用例以 **WDA 地址**作为连接入口（默认
`http://localhost:8100`），不以设备序列号作为连接参数。

## 多模态模型配置（可选，缺失时自动降级）

视觉推理需要模型密钥，配置方式与 Android 端一致：**设置 → 自动化测试**，
或使用 `MIDSCENE_MODEL_BASE_URL / MIDSCENE_MODEL_API_KEY / MIDSCENE_MODEL_NAME /
MIDSCENE_MODEL_FAMILY` 环境变量。

未配置密钥时 iOS 驱动降级为 **WDA 页面源码树直通模式**（读取 `/source?format=json`）：
按元素文案定位点击、滑动、主屏操作，断言按页面源码树文案校验。
无法定位的操作直接判定失败，不产生假通过。

## 使用流程

1. 进入 QA 自动化 → 用例 Tab → 新建用例。
2. 平台切换选择 **iOS 移动端**。
3. 在「WebDriverAgent 地址」填写 WDA 端点，点击「检测连接」确认设备就绪。
4. 填写目标 **Bundle ID**（如 `com.apple.mobilesafari`、`com.apple.Preferences`），
   或直接填写启动 URL。
5. 编排步骤：`aiAction`（操作）、`aiAssert`（视觉断言）、`aiWaitFor`（智能等待）。
6. 保存并执行。

## 相关接口

- `GET /api/qa/devices/ios?endpoint=http://localhost:8100` — 返回运行环境、
  WDA 连接状态与已启动的模拟器列表

## 产物位置与清理

与 Android 端一致：步骤截图位于 `~/.openloop/artifacts/<runId>/step_N.png`，
Midscene 调试产物位于 `~/.openloop/midscene/`，随运行记录与存储清理一并删除。

## 执行状态语义

WDA 不可达、Xcode 命令行工具缺失、`@midscene/ios` 初始化失败时，本次运行直接判定为
`FAILED`，所有步骤标记为失败并附带同一个启动错误，不会产生“模拟通过”的结果。

## 常见问题

- **`WebDriverAgent is not reachable`**：WDA 未启动或端口不一致，先用
  `curl <端点>/status` 确认，再检查用例中的 WDA 地址。
- **真机无法启动 WDA**：需要在 Xcode 中为 WebDriverAgentRunner 配置开发者证书，
  并在设备上信任该证书。
- **页面源码树为空**：目标 App 使用了非原生渲染（如自绘 Canvas），页面源码树无法定位，
  此时必须配置视觉模型走截图推理路径。
