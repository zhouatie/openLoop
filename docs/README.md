# openLoop 架构与开发文档库

本文档库包含 openLoop 系统的核心技术规格、扩展机制与插件开发指南。

---

## 插件系统规范 (Plugin System)

为保证 openLoop 基座与外部插件生态的完全解耦，系统采用零侵入的微内核插槽架构。

| 文档 | 描述 |
| :--- | :--- |
| **[架构与通信协议规范](plugin-system/architecture.md)** | 定义插件沙箱物理隔离模型、双向通信协议（OLPP v1）、握手机制、RPC 与事件总线。 |
| **[接口与能力规范](plugin-system/api-spec.md)** | 详细定义基座开放的能力命名空间（`workspace`、`task`、`ui`、`agent`）与 Manifest 清单字段。 |
| **[开发实战指南](plugin-system/quickstart.md)** | 指导开发者如何以独立的 Git 仓库构建插件，并以接入 `pi-desktop` 为例演示实操流程。 |
