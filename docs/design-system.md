# openLoop UI 设计系统与视觉风格规范 (Design System)

本文档是 openLoop 所有前端页面、卡片、表格与交互组件的统一设计基准。
当编写、重构或美化 UI 时，必须严格遵循本文档定义的视觉层次、色彩微色阶与排版规范。

---

## 1. 核心设计哲学 (Core Philosophy)

- **简约而不简单 (Minimal yet Sophisticated)**：
  - 严禁堆砌大面积高饱和度色块、刺眼荧光色或杂乱圆点阵列，杜绝“花里胡哨”。
  - 以中性质感微冷灰（Zinc / Slate 灰阶）为主基调，状态与焦点处采用极克制的浅底微边框（Subtle Tones）。
- **严密对齐与表格秩序 (Strict Table Grid & Alignment)**：
  - 核心列表一律采用规范化表格布局（Table Layout），上下各列垂直严格对齐，消除任何参差不齐的锯齿感。
  - 列表必须配置固定高度为 `34px` 的浅灰微边框表头（Table Header），清晰界定各列语义与对齐方式。
- **单行紧凑与高信息密度 (High Density & Single-Row Precision)**：
  - 列表行高保持紧凑（行高约 `38px`~`42px`，内边距 `px-4 py-2.5`）。
  - 字段单行呈现，描述等长文本使用弹性空间配合 `truncate` 自动省略，杜绝无意义的多行上下堆叠。

---

## 2. 颜色与表面样式规范 (Colors & Surfaces)

| 场景 | Tailwind CSS 类名与属性 | 说明 |
| :--- | :--- | :--- |
| **页面全局底色** | `bg-[#f4f4f6]` | 极浅微冷灰，承托白色卡片与面板 |
| **主内容卡片容器** | `bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden flex flex-col` | 标准卡片容器 |
| **表格表头 (Header)** | `h-[34px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center text-[11px] font-medium text-[#85858d] select-none` | 固定高度、微边框、中性浅灰底 |
| **行分割线** | `divide-y divide-[#f1f1f4]` | 极浅分割线，不抢视觉重心 |
| **行悬浮态 (Hover)** | `group hover:bg-[#fafafc] transition-colors cursor-pointer` | 柔和反馈 |
| **主标题 / 任务名称** | `text-[12px]~[13px] font-medium text-[#1c1c21] group-hover:text-[#4f46e5] transition-colors truncate` | 悬浮微紫色强化交互感 |
| **次级文本 / 描述** | `text-[11.5px] text-[#71717a]` 或 `text-[#85858d] truncate` | 中性降权 |
| **数值 / ID / 代码** | `font-mono text-[10px]~[11px] text-[#71717a]` | 等宽数字字形 |

---

## 3. 状态微徽章规范 (Subtle Status Badges)

拒绝刺眼的高饱和度大绿、大红底块，一律使用极低饱和度浅底搭配微弱边框：

- **成功 / Passed / Completed**：
  ```tsx
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#ecfdf5] text-[#059669] text-[10px] font-medium border border-[#a7f3d0]/60">
    <CheckCircle2 size={10} strokeWidth={2.2} />
    <span>PASSED</span>
  </span>
  ```
- **失败 / Failed**：
  ```tsx
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#fef2f2] text-[#dc2626] text-[10px] font-medium border border-[#fecaca]/60">
    <XCircle size={10} strokeWidth={2.2} />
    <span>FAILED</span>
  </span>
  ```
- **执行中 / Running**：
  ```tsx
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#eff6ff] text-[#2563eb] text-[10px] font-medium border border-[#bfdbfe]/60">
    <Loader2 size={10} className="animate-spin" />
    <span>RUNNING</span>
  </span>
  ```
- **待处理 / Untested / Pending**：
  ```tsx
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f6] text-[#71717a] text-[10px] font-medium border border-[#e3e3e8]">
    <Clock size={10} />
    <span>UNTESTED</span>
  </span>
  ```
- **链路构成 / 节点标签微胶囊**：
  ```tsx
  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#f4f4f5] text-[#52525b] text-[10.5px] font-medium">
    Agent
  </span>
  ```

---

## 4. 图标与行级操作规范 (Icons & Micro Actions)

### 4.1 实体微图标容器 (Leading Micro Icon)
列表行首的小微图标采用统一的轻微边框中性质感方块：
```tsx
<div className="w-5 h-5 rounded-[4px] bg-[#f4f4f6] group-hover:bg-white flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60 transition-colors">
  <Workflow size={11} strokeWidth={2} />
</div>
```

### 4.2 行级微操作按钮 (Micro Action Buttons)
行内操作禁止使用臃肿的长汉字边框按钮，统一采用正方形微图标：
- **普通动作 (如 查看历史 / 编辑)**：
  `w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer`
- **高亮动作 (如 调试 / 运行 / 回放)**：
  `w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#4f46e5] hover:bg-[#eeedfd] flex items-center justify-center transition-all cursor-pointer`
- **危险动作 (如 删除)**：
  `w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#dc2626] hover:bg-[#fef2f2] flex items-center justify-center transition-all cursor-pointer`
- **更多低频操作收纳**：
  使用 `MoreHorizontal (···)` 按钮呼出紧凑悬浮下拉菜单（`w-[120px] rounded-[6px] shadow-[0_8px_20px_rgba(0,0,0,0.08)] py-1`），避免界面被次要动作占据。

### 4.3 顶部主功能按钮 (Primary Action Button)
```tsx
<button className="flex items-center gap-1.5 h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs cursor-pointer">
  <Plus size={12} strokeWidth={2.4} />
  <span>新建</span>
</button>
```

---

## 5. 两段式视口与滚动规范 (Layout & Scrolling)

所有一级管理视图（如看板、工作流编排、QA 自动化测试）一律统一布局结构：

```tsx
<div className="flex-1 h-full flex flex-col bg-[#f4f4f6] overflow-hidden select-none">
  {/* 1. 固定顶部 Header: 白底、细下边框、微弱弥散投影，绝不随滚动移动 */}
  <div className="bg-white border-b border-[#e3e3e8] px-6 py-3.5 flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
    {/* 标题、计数微标与副标题 */}
    ...
    {/* 右侧 Tab 切换器与新建主按钮 */}
    ...
  </div>

  {/* 2. 独立内容滚动区: 对称外边距，内部独立纵向滚动 */}
  <div className="flex-1 overflow-y-auto px-6 pb-6 pt-3.5 space-y-3">
    {/* 次级工具栏 (搜索框、Segmented Control 过滤器、刷新按钮) */}
    ...
    {/* 统一规范表格卡片 */}
    ...
  </div>
</div>
```

## 6. 智能体面板例外条款 (Agent Panel Exception)

`packages/desktop/src/agent-ui/` 采用 DSH（DeepSeek Harness）的视觉层，与上文 Zinc 规范并存但不混用：

| 维度 | 主界面 | 智能体面板 |
|---|---|---|
| 底色 | 页面 `#f4f4f6` + 白卡片 | `--dsw-alias-bg-base` / `--dsw-specific-sidebar-fill` |
| 字号 | 12px 为主 | 正文 14px，流程行 13px，时间戳 10-11px |
| 行高 | 38-42px 单行 | 项目行 34px、会话行 32px、工具行 24px |
| 圆角 | 8px | 12px（md）、20px（xl）、28px（panel） |
| 样式方案 | Tailwind + 设计令牌 | CSS Modules + `tokens.css` |

约束：

- 令牌必须落在 `.agent-scope` 作用域内，禁止泄漏到主界面。
- 面板内禁止再用 Tailwind 原子类，几何取 DSH 源值。
- 不引入 DeepSeek 品牌资产（鱼形 logo、wordmark、Montserrat 字体）。
- 语法高亮统一走 `dsh/highlight.ts` 的 shiki 内核（`shiki` + `@shikijs/langs` 已加入 desktop 依赖），颜色只取 `--shiki-*` 令牌；不要再引入 Prism 或自写分词。
- 门户层（Tooltip、图片预览、用量明细等 portal 到 `document.body` 的节点）必须自带 `agent-scope` 类，否则令牌失效、背景变透明。
- 直接搬运的 DSH 原语放在 `packages/desktop/src/agent-ui/dsh/`，文件头保留 MIT 归属注释；改动仅限于替换图标导入与文案，结构与样式取原值。

### 6.1 已搬运的 DSH 原语

| 本项目文件 | DSH 来源 | 用途 |
|---|---|---|
| `dsh/TextShimmer.tsx` | ui-primitives | 运行中文字的扫光装饰 |
| `dsh/DisclosureRow.tsx` | ui-primitives | 24px 单行披露（思考行、工具行） |
| `dsh/Tooltip.tsx` | ui-primitives | 所有图标按钮的悬浮说明 |
| `dsh/CodeToolbar.tsx` + `CodeCard.module.css` | ui-primitives | 代码卡头部：语言 + 折行 + 复制 |
| `dsh/CodeBlock.tsx` + `dsh/highlight.ts` + `dsh/useViewportHighlighting.ts` | ui-primitives/markdown | shiki 语法高亮代码卡（流式增量臂 + 行号槽 + 可视区激活） |
| `dsh/DiffBlock.tsx` | ui-primitives | 写入类工具的逐行差分卡 |
| `dsh/ImageLightbox.tsx` | ui-primitives | 原图预览（portal、焦点还原） |
| `dsh/ReasoningRow.tsx` | ui-chat | 思考行（摘要 + 展开正文） |
| `dsh/MessageActions.tsx` | ui-chat | 消息操作条 |
| `dsh/TurnUsagePanel.tsx` | ui-chat | 本轮用量药丸 + 明细对话框 |
