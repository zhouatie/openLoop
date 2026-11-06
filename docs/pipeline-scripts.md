# 脚本流水线

一条流水线 = 一段 JS。逻辑用 `if-else` 编排，交互与卡点走系统方法。

编排画布已下线：脚本保存在数据库 `workflows.script` 字段，脚本存在时以脚本为准，节点与连线不再生效。

编辑入口是独立页面（`流程编排` -> 点击流水线），默认以步骤卡片呈现，右侧是流水线信息、任务模板与最近运行。

## 步骤卡片

卡片是脚本的编辑视图：一张卡片对应一次调用，可增删、上下移动。

| 卡片 | 生成的调用 | 作用 |
| :--- | :--- | :--- |
| 创建 Worktree | `sandbox.create({...})` | 隔离沙箱、分配端口、共享依赖 |
| AI Agent | `agent({...})` | 起 Agent 会话执行一轮 |
| 人工验收 | `approve({...})` | 卡点挂起，等人工通过或驳回 |
| 通用节点 | `node("cli", {...})` | 任意执行器：`cli`、`midscene`、`hook`、`qa-planner`… |
| 合并代码 | `sandbox.merge({...})` | 合并特性分支 |
| 清理沙箱 | `sandbox.cleanup({...})` | 释放端口与沙箱目录 |

卡片参数按字段填写，每个字段一行：常见字段显示中文名，其余显示键名。

| 字段类型 | 输入方式 | 写进脚本 |
| :--- | :--- | :--- |
| 文本 | 输入框 | 字符串 |
| 数字 | 输入框 | 数字字面量 |
| 开关 | 是 / 否 | `true` / `false` |
| 列表 | 多行，一行一项 | 字符串数组 |
| JSON | 多行原文 | 原样 |

- 「字段」按钮可以补一个自定义参数：填键名、选类型、填值。
- 卡片标题写回参数对象的 `name`（`approve` 用 `title`），通用节点写回第三个参数 `{ name }`。
- 步骤按顺序执行，任一步失败即终止整条流水线。
- 保存时按卡片重写整段脚本，`pipelines/*.mjs` 与列表展示照旧。
- 原脚本含 `for`、`if` 等卡片之外的逻辑时，页面顶部给出提示，卡片只显示能识别的步骤。

## 怎么写

```js
// 也可以 import { sandbox, agent, cli, approve, log, task } from 'openloop'
export default async function ({ task, sandbox, agent, cli, approve, node, log }) {
  await sandbox.create()

  await agent({ prompt: `实现：${task.title}` })

  const build = await cli('pnpm build')
  if (!build.ok) return { status: 'failed', error: '构建失败' }

  const verdict = await approve({ title: '验收', checklist: ['构建通过', '改动符合需求'] })
  if (!verdict.ok) return { status: 'failed', error: verdict.feedback }

  await sandbox.merge()
  await sandbox.cleanup()
  return { status: 'success' }
}
```

返回值 `{ status: 'success' | 'failed', error? }`。抛异常等同失败。

## API

| 方法 | 作用 | 返回 |
| :--- | :--- | :--- |
| `sandbox.create(opts?)` | 建立 Worktree 隔离沙箱，切换任务工作区 | `{ ok, output }`，`output` 含分支、目录、端口 |
| `sandbox.diff()` | 采集沙箱代码改动 | `{ changedFiles, diffSummary, diffResult }` |
| `sandbox.merge()` | 合并特性分支到本地开发分支 | `{ ok }` |
| `sandbox.cleanup()` | 释放端口与沙箱目录 | `{ ok }` |
| `sandbox.info()` | 当前沙箱信息 | worktree 对象或 `null` |
| `agent(opts)` | 起 Agent 会话执行一轮 | `{ ok, sessionId }` |
| `cli(command, opts?)` | 执行一条命令 | `{ ok, exitCode, output }` |
| `approve(opts)` | 人工卡点，挂起等决策 | `{ ok, feedback }` |
| `node(type, config, opts?)` | 执行任意注册节点类型 | `{ ok, output }` |
| `log(message, stream?)` | 写一条流水线日志 | — |

上下文另有 `task`、`params`、`workspace`。节点配置里的 `{{task.title}}`、`{{worktree.ports.webPort}}` 插值在节点内部照常生效。

`agent()` 默认每次新会话；传 `session: 'coder'` 则复用同名会话继续多轮。

## 执行模型

- 脚本在独立子进程内运行，宿主负责超时、进程组回收与日志落库。
- 每个 `await` 的系统调用都会写一条步骤记录，界面时间轴与节点日志复用同一套视图。
- `approve()` 挂起时脚本进程驻留等待。**daemon 重启后挂起中的任务作废**，需要重新创建任务。
- 任务被终止时脚本进程立即被杀，任务保持 `cancelled` 状态。

## 维护：仓库存源码，数据库跑运行时

脚本以 `pipelines/*.mjs` 为准，数据库是运行时副本。git 承担版本历史。

```bash
pnpm pipeline:pull     # 数据库 -> 文件（补齐历史流水线）
pnpm pipeline:push     # 文件 -> 数据库（改完就推）
pnpm pipeline:check    # 只比对两边；有漂移退出码 1
pnpm pipeline:run pipelines/dev-pipeline.mjs --workspace ~/My/openLoop   # 本地试跑
```

文件头是身份来源，`push` 会把解析出的 id 写回文件头：

```js
// @pipeline id=wf_worktree_auto_dev_qa_merge
// @name openLoop 开发专用流水线
// @tags 开发,QA
```

### 四个日常动作

| 动作 | 操作 |
| :--- | :--- |
| 改 | 在编辑器里改 `pipelines/xxx.mjs`，试跑到通过，`pnpm pipeline:push` |
| 增 | 新建文件写好 `@name`，`pnpm pipeline:push` 自动建库记录 |
| 复用 | 不复制脚本，脚本开头读 `params`（见下） |
| 回滚 | `git checkout pipelines/xxx.mjs && pnpm pipeline:push` |

### 参数化而不是复制

```js
export default async function ({ task, params, cli }) {
  // 老任务不带参数也能跑
  const { baseBranch = 'main', skipMidscene = false } = params || {}
  await cli(`git fetch origin ${baseBranch}`)
}
```

任务模板里填 `baseBranch=release`，同一条流水线不需要改代码。

### 本地试跑

`run-pipeline.js` 用临时数据目录启动宿主，直接执行脚本，不建看板任务。

- 遇到 `approve()` 在终端里询问，`--yes` 自动通过。
- `--workspace` 决定沙箱与命令的真实工作目录，默认当前目录。
- `--keep` 保留临时数据目录，便于查看步骤记录。
- 脚本里的 `cli` 与沙箱会真实产生副作用，执行前先确认工作目录正确。

## 转译已有编排流水线

```bash
# 只生成脚本文件到 pipelines/
node scripts/transpile-workflow.js --name "openLoop 开发专用流水线"

# 写回数据库（脚本生效，节点与连线清空）
node scripts/transpile-workflow.js --name "openLoop 开发专用流水线" --apply --data-dir ~/.openloop
```

只支持线性链路。存在分支或回环时脚本会报错并跳过该流水线，需要手写 JS。
