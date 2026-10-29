# openLoop 品牌标志（Owl / 夜巡猫头鹰）

## 1. 概念

**夜巡猫头鹰 (Night-watch Owl)**：一双圆眼 = 双环 (open loop)，尾部守夜 = 7×24 自动值守。

| 项目语义 | 图形映射 |
| :--- | :--- |
| 双环 / openLoop | 两只圆形眼窝构成的双环结构 |
| 全流程可观测 | 睁开的双眼，视线始终向内（Pupil 轻微内收） |
| 全自动值守 | 猫头鹰 = 夜间工作、不需照看的执行者 |
| 开放式编排 | 耳羽张开、轮廓向上，形态开放、不收口 |
| 品牌克制色 | 主体中性墨色 `#1c1c21`，仅鸟喙使用强调色 `#4f46e5` |

## 2. 文件

| 文件 | 用途 |
| :--- | :--- |
| `openloop-owl-mark.svg` | 主标志，透明底，适用于浅色背景 |
| `openloop-owl-mark-mono.svg` | 单色版，使用 `currentColor`，可任意染色或反白 |
| `openloop-owl-icon.svg` / `.png` | 应用图标，浅色圆角面，1024×1024 |
| `openloop-owl-icon-dark.svg` / `.png` | 应用图标，深色圆角面，1024×1024 |
| `openloop-owl-mark.png` | 主标志位图预览，512×512 |

## 3. 用法规范

- 眼窝为**镂空**（evenodd 挖空），可放在任意底色上，不需另做白底版本。
- 最小尺寸：`24px`。小于该尺寸时仅保留头部与双眼，去掉耳羽。
- 强调色仅用于鸟喙。若为单色印刷，使用 `openloop-owl-mark-mono.svg`，鸟喙同色。
- 图标直角留白不小于画布 `8%`，禁止加投影、渐变描边或外发光。

## 4. 已替换的位置

| 位置 | 内容 |
| :--- | :--- |
| `packages/desktop/src/components/BrandLogo.tsx` | 侧边栏、Agent 会话列、初始化弹窗内的品牌标识（纯墨色猫头鹰，无底板） |
| `packages/desktop/public/logo.svg` | 浏览器 favicon |
| `build/icon.svg` | 桌面应用图标源文件（浅色圆角面） |
| `build/icon.png`、`build/icons/icon.icns` | 由 `python3 scripts/generate-icons.py` 从 `build/icon.svg` 渲染生成 |

图标资源统一由 `scripts/generate-icons.py` 生成：脚本优先用 `rsvg-convert` 渲染 SVG，缺少时回退 macOS `qlmanage`。

## 5. 备选方案（未出图）

| 方案 | 寓意 | 取舍 |
| :--- | :--- | :--- |
| 蜜蜂 + 蜂巢 | 工蜂协作、六边形节点 = DAG 编排 | 六边形与现有双环体系冲突 |
| 蕨芽螺旋 (Fiddlehead) | 螺旋 = 迭代闭环、生长 | 无“值守”语义，情感弱 |
| 蜂鸟图八 (∞) | 双翼成环、高频循环 | 与参考图同科，辨识度近似 |
| 蜷睡猫 | 尾巴绕成开环 = open loop | 易与既有猫类工具 Logo 混淆 |
