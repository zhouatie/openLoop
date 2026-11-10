# openLoop 架构与开发文档库

本文档库包含 openLoop 系统的核心技术规格、扩展机制与插件开发指南。

---

## 插件系统规范 (Plugin System)

为保证 openLoop 基座与外部插件生态的完全解耦，系统采用零侵入的微内核插槽架构。

| 文档 | 描述 |
| :--- | :--- |
| **[架构与通信协议规范](plugin-system/architecture.md)** | 定义插件沙箱物理隔离模型、双向通信协议（OLPP v1）、握手机制、RPC 与事件总线。 |
| **[接口与能力规范](plugin-system/api-spec.md)** | 详细定义基座开放的能力命名空间（`workspace`、`task`、`ui`、`agent`）与 Manifest 清单字段。 |
| **[开发实战指南](plugin-system/quickstart.md)** | 指导开发者如何以独立的 Git 仓库构建插件，并以抽取既有界面为例演示实操流程。 |

---

## 沙箱与真机调试 (Sandbox & Device)

| 文档 | 描述 |
| :--- | :--- |
| **[手机扫码预览](dev-server-scan.md)** | 开发服务靶机启动后扫码直达 RN / 移动端页面，以及 `scanUrl` 配置约定。 |
| **[会话内启动 RN 开发服务](agent-dev-server.md)** | 不建任务也能在 Agent 会话里拉起 Metro：入口、启动配置与进程安全约定。 |

---

## 流水线与 Agent (Pipeline & Agent)

| 文档 | 描述 |
| :--- | :--- |
| **[流水线 Markdown 语法](pipeline-markdown.md)** | 二级标题即步骤的语义、变量渲染与受控工具调用约定。 |

---

## 界面与品牌 (UI & Branding)

| 文档 | 描述 |
| :--- | :--- |
| **[设计系统](design-system.md)** | 颜色、间距、字号、动效与组件规范；前端改动必读。 |
| **[品牌标志](branding/README.md)** | 猫头鹰标志的概念、资源清单与使用规范。 |

---

## 移动端 QA (Mobile QA)

| 文档 | 描述 |
| :--- | :--- |
| **[Android 自动化](qa-android.md)** | ADB 直通、模拟器常驻与用例执行约定。 |
| **[iOS 自动化](qa-ios.md)** | WebDriverAgent 接入与真机调试约定。 |

---

返回：[仓库主页](../README.md) · [贡献指南](../CONTRIBUTING.md) · [更新日志](../CHANGELOG.md)
