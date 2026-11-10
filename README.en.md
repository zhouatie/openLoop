<div align="center">
  <img src="docs/branding/openloop-owl-mark.svg" width="88" alt="openLoop" />
  <h1>openLoop</h1>
  <p>Turn "request → code → verify → accept" into one observable desktop pipeline</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1c1c21" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/node-%E2%89%A522-4f46e5" alt="Node 22+" />
    <img src="https://img.shields.io/badge/pnpm-%E2%89%A510-4f46e5" alt="pnpm 10+" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-1c1c21" alt="Platform" />
    <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-4f46e5" alt="PRs welcome" /></a>
  </p>
  <p><a href="README.md">中文</a> · <a href="docs/README.md">Docs</a> · <a href="CONTRIBUTING.md">Contributing</a> · <a href="CHANGELOG.md">Changelog</a></p>
</div>

---

openLoop is a fully automated, orchestratable and plugin-extensible **desktop pipeline platform**. Pipelines are Markdown documents that live in your repository — reviewable, diffable, versioned alongside code. Tasks run in isolated Git worktrees, and acceptance is backed by screenshots and assertions instead of promises.

Three surfaces share one Core daemon:

| Surface | Entry | Best for |
| :--- | :--- | :--- |
| Desktop app | Electron | Daily orchestration, agent workbench, task board |
| Web UI | Browser against Core | Remote review, team walkthroughs |
| CLI | `openloop` | CI, scripted triggers, single-machine runs |

> Version `0.8.0`, early preview. APIs and data shapes may still change; breaking changes are recorded in the [changelog](CHANGELOG.md).

---

## Highlights

| Capability | Description |
| :--- | :--- |
| **Markdown pipelines** | A pipeline is a process document: H2 headings are steps. The orchestrator agent reads the document and calls controlled tools, so the process stays reviewable and diffable. |
| **Agent workbench** | Multi-turn sessions with session-tree branching, `@` file references, slash commands, collapsible tool cards and reasoning, per-file diff review, and task-level sub-agent orchestration. |
| **Task board lifecycle** | `Inbox → Pending → Running → Review → Done` lanes, with step timelines, step logs and human gates inside each card. |
| **Worktree isolation** | Every task gets its own Git worktree, shared `node_modules` via symlink, dynamically allocated ports and a dedicated data directory — concurrent tasks never collide. |
| **QA automation (Web / Android / iOS)** | Midscene-powered visual driving, suites, timeline replay, screenshot and GIF artifacts; on mobile it falls back to ADB / WDA source-tree mode when no model key is configured. |
| **Scheduled automation** | Poll CLI scripts, GitHub issues, social queries or custom commands on an interval and turn hits into tasks. |
| **Plugin slots** | Sidebar slots and custom pipeline nodes are decoupled from the core; third-party plugins load from Git repositories. |
| **Full observability** | WebSocket log bus, streaming terminal drawer, per-node filtering, ANSI highlighting — the CLI follows the same stream. |
| **One core, two frontends** | Desktop and CLI share the same Core daemon; the CLI degrades to an embedded engine when no daemon is running. |

---

## Repository layout

```
openLoop/
├── packages/
│   ├── core/       # Scheduling, task state machine, executors, SQLite store, agent host, QA runtime, HTTP/WebSocket server
│   ├── cli/        # openloop command-line client (daemon / workflow / task / plugin / qa / run)
│   └── desktop/    # Electron + React desktop and web UI (board, pipelines, agent workbench, plugin sandbox)
├── pipelines/      # Example pipelines (Markdown as process, editable in-app)
├── docs/           # Architecture, plugin system, design system, mobile QA and brand assets
├── scripts/        # Dev sandbox, port cleanup, data clone, packaging and deploy scripts
└── build/          # App icons and signing configuration
```

The core is a single daemon process that owns SQLite, the task state machine and the executors, and exposes one HTTP + WebSocket API to all three surfaces. Plugins run in a separate sandbox process and talk to the core over OLPP — see [docs/plugin-system/architecture.md](docs/plugin-system/architecture.md).

---

## Requirements

- **Node.js 22+** (the native `better-sqlite3` module must match the Node ABI)
- **pnpm 10+** (`corepack enable`)
- macOS packaging needs the Xcode command-line tools; iOS automation needs WebDriverAgent

---

## Quick start

```bash
pnpm install
pnpm build          # build core + cli + desktop
pnpm dev            # Core on :19889 + Vite on :5173
```

Open <http://localhost:5173>.

The dev sandbox is isolated from the stable install so debugging never touches running tasks:

| Item | Dev sandbox | Stable |
| :--- | :--- | :--- |
| Core port | `19889` | `19888` |
| Data dir | `~/.openloop-dev` | `~/.openloop` |
| Frontend | Vite `5173` | Served by Core |

Clone stable data into the sandbox with `pnpm db:fork`.

### Desktop app

```bash
pnpm dev:desktop    # Vite HMR + Electron window
pnpm desktop:start  # run the built app
```

### Production (single port)

```bash
pnpm deploy         # clean ports + full build + artifact check
pnpm start:prod     # :19888 serves API, WebSocket and the web UI
```

### Docker

```bash
pnpm deploy:docker  # equals docker compose up -d --build
```

The image exposes `19888`, persists SQLite in the `openloop-data` volume, and ships an `/api/status` health check.

### macOS packages

```bash
pnpm electron:build:mac   # DMG (bring your own signing)
pnpm pack:mac             # package for the current arch
pnpm pack:install         # package and install into /Applications
```

---

## CLI

The CLI prefers a running daemon and falls back to an embedded engine, which makes it usable in plain scripts.

```bash
pnpm cli daemon start --port 19888
pnpm cli daemon status

pnpm cli workflow list
pnpm cli plugin list

pnpm cli task create --workflow <workflow_id> --title "Login flow rework" --follow
pnpm cli run "build and deploy the app"

pnpm cli task list
pnpm cli task show <task_id>
pnpm cli task logs <task_id> -f

pnpm cli task approve <task_id> -c "GIF matches expectation"
pnpm cli task approve <task_id> --reject -c "Page assertion failed"

pnpm cli qa list
pnpm cli qa run <suiteId>
```

---

## Environment variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OPENLOOP_PORT` | `19888` | Core service port |
| `OPENLOOP_HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` in containers |
| `OPENLOOP_STORE_DIR` | `~/.openloop` | Data dir (SQLite, logs, QA artifacts) |
| `OPENLOOP_STATIC_DIR` | derived | Static dir served in production |
| `OPENLOOP_LOG_LEVEL` | `info` prod, `debug` dev | Service log level |
| `VITE_CORE_PORT` | `19889` | Core port used by the Vite dev proxy |
| `MIDSCENE_MODEL_BASE_URL` / `_API_KEY` / `_NAME` / `_FAMILY` | empty | Multimodal model for QA; also configurable in-app |

---

## The loop

```
Create a task (UI / CLI / scheduled poll)
        │
        ▼
(1) worktree-setup: branch, symlinked deps, ports, boot the app under test
        │
        ▼
(2) agent step: pi / Claude Code / Codex / OpenCode writes the code
        │
        ▼
(3) quality gates: lint, tsc, unit tests, build
        │
        ▼
(4) Midscene step: drive the UI from a prompt, capture screenshots
        │
        ▼
(5) GIF composition from the screenshot sequence
        │
        ▼
(6) qa-approval: human gate, task waits in Review
        │
        ├─ approved ──► worktree-merge / cleanup ──► done
        └─ rejected ──► back to fix or abort
```

`pipelines/` holds ready-to-use examples; copy one and adapt it. Syntax: [docs/pipeline-markdown.md](docs/pipeline-markdown.md) (Chinese).

---

## Docs

| Document | Content |
| :--- | :--- |
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/pipeline-markdown.md](docs/pipeline-markdown.md) | Pipeline Markdown syntax and execution semantics |
| [docs/plugin-system/architecture.md](docs/plugin-system/architecture.md) | Plugin sandbox model and OLPP protocol |
| [docs/plugin-system/api-spec.md](docs/plugin-system/api-spec.md) | Core capability namespaces and manifest fields |
| [docs/plugin-system/quickstart.md](docs/plugin-system/quickstart.md) | Build and wire your first plugin |
| [docs/design-system.md](docs/design-system.md) | UI design system (required reading for frontend changes) |
| [docs/qa-android.md](docs/qa-android.md) / [docs/qa-ios.md](docs/qa-ios.md) | Android / iOS QA automation |
| [AGENTS.md](AGENTS.md) | Conventions for AI coding agents |

Most documents are written in Chinese; English sections expand as the project grows. Issues and PRs in English are welcome.

---

## Contributing

Issues and PRs are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first.

- Bugs: use the [bug template](https://github.com/zhouatie/openLoop/issues/new?template=bug_report.yml) with version, environment and steps.
- Features: use the [feature template](https://github.com/zhouatie/openLoop/issues/new?template=feature_request.yml) and describe the problem, not only the solution.
- Security: report privately per [SECURITY.md](SECURITY.md).
- Doc links: `node scripts/check-docs-links.js`.

## License

[MIT](LICENSE) © openLoop contributors

Trademark and logo usage: [docs/branding/README.md](docs/branding/README.md).
