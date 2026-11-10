# AGENTS.md

面向 AI 编码代理（pi / Claude Code / Codex / OpenCode 等）的仓库约定。人类贡献者请读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 代码约定

- 前端页面、组件与样式改动必须遵循 [docs/design-system.md](docs/design-system.md)，目标是「简约而不简单」。
- 开发态新增的操作链路与自动化链路要打日志（`import.meta.env.DEV` 分支），便于真机与模拟器排查。
- 业务代码不与特定任务、特定流水线、特定客户耦合。
- 不写兼容性兜底代码，除非用户明确要求。

## 运行环境

| | 开发沙箱 | 稳定版 |
| :--- | :--- | :--- |
| Core 端口 | `19889` | `19888` |
| 数据目录 | `~/.openloop-dev/`（SQLite：`openloop.db`） | `~/.openloop/` |
| 前端 | Vite `5173` | Core 单端口托管 |

- 默认排查范围是开发沙箱：端口 `19889` 与 `~/.openloop-dev/`。
- 仅当用户明确说明「稳定版」「生产任务」「桌面客户端异常」时，才检索生产端口 `19888` 与 `~/.openloop/`。
- 严禁强杀生产端口 `19888` 或在运行的生产任务进程。

## 检索与验证

- 代码检索用 `rg`，文件查找用 `fd`；不要用未排除目录的 `grep -rn` / `find .`，避免扫描 `node_modules/`、`dist/` 等目录。
- 改动后先保证 `pnpm build` 通过，再做界面或真机验证。
- 文档改动后跑 `node scripts/check-docs-links.js`，确认相对链接有效。
