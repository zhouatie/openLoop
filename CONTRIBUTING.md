# 贡献指南

感谢你愿意为 openLoop 出力。本文说明环境准备、开发约定与提交流程。

## 行为准则

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 开始之前

- 请先搜索 [已有 Issue](https://github.com/zhouatie/openLoop/issues)，避免重复。
- 较大的改动（新增插件能力、改动调度模型、调整数据库结构）请先开 Issue 对齐方案，再写代码。
- 小修复（文档、错别字、明显的边界条件）可以直接提 PR。

## 环境准备

- Node.js 22+
- pnpm 10+（`corepack enable` 即可启用）
- macOS 打包需要 Xcode 命令行工具；iOS 自动化需要 WebDriverAgent

```bash
pnpm install
pnpm build      # core + cli + desktop 全量编译
pnpm dev        # Core :19889 + Vite :5173
```

国内网络下 Electron 二进制安装较慢，仓库 `.npmrc` 已指向镜像源；如需官方源，删除该行即可。

## 开发约定

- 前端改动必读 [docs/design-system.md](docs/design-system.md)。
- 开发态新增链路请补日志（`import.meta.env.DEV`），便于真机排查。
- 业务代码不与特定任务、特定流水线耦合。
- 结构说明与架构取舍写进 `docs/`，不要只留在 PR 描述里。
- 提交信息用祈使句，一行说清一件事；关联 Issue 时在正文写 `Closes #123`。

## 分支与提交

```bash
git checkout -b feat/short-description
pnpm build                 # 提交前确保编译通过
git commit -m "add: 支持插件侧边栏自定义入口"
```

- 分支前缀：`feat/`、`fix/`、`docs/`、`refactor/`、`chore/`。
- 一个 PR 只做一件事。格式化、重命名等无行为改动请单独提交。

## 提交 PR

1. Fork 仓库并推送分支，向 `main` 发起 PR。
2. 填写 PR 模板：动机、方案、验证方式、影响面。
3. 确保 CI 通过（安装 + 全量编译）。
4. 涉及界面时附截图或 GIF。

维护者会在 7 个工作日内给出第一次反馈。

## 文档与品牌

- 文档入口：[docs/README.md](docs/README.md)。
- 品牌资源与用法：[docs/branding/README.md](docs/branding/README.md)。使用标志时请遵守其中的尺寸与配色规范。

## 安全问题

请勿公开提交安全 Issue，按 [SECURITY.md](SECURITY.md) 私密报告。

## 许可证

提交的代码按 [MIT](LICENSE) 授权。
