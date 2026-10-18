# openLoop 核心规范与设计指南

## 一、通用准则与开发规范
- **体验至上**：UI、交互与动画要求极致优雅，遵循“简约而不简单”的极简工程美学。
- **开发日志**：所有操作链路、执行流程、网络请求或自动化执行在开发环境（`import.meta.env.DEV`）必须打上清晰语义化的控制台日志。

---

## 二、UI 视觉风格与主题设计系统 (Design System)

### 1. 核心设计哲学
- **简约而不简单 (Minimal yet Sophisticated)**：
  - 严禁堆砌五彩斑斓、高饱和度的大色块或大面积刺眼圆点，拒绝“花里胡哨”。
  - 以高质感的中性灰阶（Zinc / Slate 微冷灰）为主旋律，仅在状态和操作焦点处施加克制的微色阶（Subtle Tones）。
- **秩序感与严密对齐 (Strict Table Grid & Alignment)**：
  - 核心列表一律采用规范化表格视图（Table Layout）。
  - 必须提供高度为 `34px` 的浅灰微边框表头（Table Header），定义明确的列宽与对齐方式（文本居左、状态/计数居中、时间/耗时居右）。
- **单行紧凑与高信息密度 (High Density & Single-Row Precision)**：
  - 列表行高保持紧凑（行高约 `38px`~`42px`，内边距 `px-4 py-2.5`）。
  - 单行排布核心字段，避免多行堆砌造成的臃肿松散；描述与细节采用弹性自适应并带有 `truncate` 省略。

---

### 2. 颜色与表面样式规范 (Colors & Surfaces)
- **页面背景**：`bg-[#f4f4f6]`（温和护眼的极浅中性灰，承托白色卡片）。
- **主内容卡片**：`bg-white border border-[#e3e3e8] rounded-[8px] shadow-sm overflow-hidden flex flex-col`。
- **表头 (Table Header)**：`h-[34px] bg-[#fafafc] border-b border-[#e3e3e8] px-4 flex items-center text-[11px] font-medium text-[#85858d] select-none`。
- **行分割线**：`divide-y divide-[#f1f1f4]`。
- **行悬浮态**：`group hover:bg-[#fafafc] transition-colors cursor-pointer`。
- **文本颜色层级**：
  - 标题/主名称：`text-[#1c1c21]`（微 hover 强化 `hover:text-[#4f46e5]`）。
  - 次级说明/副标题：`text-[#71717a]` 或 `text-[#85858d]`。
  - 等宽数值/时间/ID：`font-mono text-[10px]~[11px] text-[#71717a]`。

---

### 3. 状态微徽章规范 (Subtle Status Badges)
徽章使用极低饱和度底色搭配微边框，保持克制：
- **成功 / Passed / Completed**：`bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0]/60`（字号 `text-[10px] font-medium`）。
- **失败 / Failed**：`bg-[#fef2f2] text-[#dc2626] border border-[#fecaca]/60`。
- **运行中 / Running**：`bg-[#eff6ff] text-[#2563eb] border border-[#bfdbfe]/60`。
- **等待 / Pending / Untested**：`bg-[#f4f4f6] text-[#71717a] border border-[#e3e3e8]`。
- **中性标签 / 节点微标 / 计数字符**：`bg-[#f4f4f5] text-[#52525b] text-[10.5px] font-medium rounded-[4px]`。

---

### 4. 图标与操作按钮交互 (Icons & Actions)
- **实体微图标**：
  - 统一容器：`w-5 h-5 rounded-[4px] bg-[#f4f4f6] group-hover:bg-white flex items-center justify-center text-[#63636b] shrink-0 border border-[#e3e3e8]/60 transition-colors`。
  - 内部 Lucide 图标尺寸一律控制在 `11px`~`12px`，线宽 `strokeWidth={1.8~2.0}`。
- **行级微操作按钮 (Micro Action Buttons)**：
  - 拒绝粗重文字按钮，统一采用极简正方形微图标：`w-6 h-6 rounded-[4px] text-[#63636b] hover:text-[#1c1c21] hover:bg-[#ececf0] flex items-center justify-center transition-all cursor-pointer`。
  - 运行/调试动作高亮：`hover:text-[#4f46e5] hover:bg-[#eeedfd]`。
  - 危险/删除动作高亮：`hover:text-[#dc2626] hover:bg-[#fef2f2]`。
  - 二级低频操作收纳：使用 `MoreHorizontal (···)` 弹出紧凑悬浮菜单（`w-[120px] rounded-[6px] shadow-[0_8px_20px_rgba(0,0,0,0.08)]`），防止界面喧宾夺主。
- **主功能按钮 (Primary Buttons)**：
  - `h-[28px] px-3 rounded-[6px] bg-[#1c1c21] hover:bg-[#2e2f36] text-white text-[12px] font-medium transition-all active:scale-95 shadow-xs cursor-pointer`。

---

### 5. 视图布局与滚动规范 (Layout & Scrolling)
- 根容器固定视口高度：`flex-1 h-full flex flex-col bg-[#f4f4f6] overflow-hidden select-none`。
- 顶部 Header 固定不随页面晃动：`bg-white border-b border-[#e3e3e8] px-6 py-3.5 flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)]`。
- 内容区具备独立内部纵向滚动：`flex-1 overflow-y-auto px-6 pb-6 pt-3.5`，边距与左右布局严格对称统一。

