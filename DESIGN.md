# 1Panel 设计规范（强制）

> **地位**：本文件是前端视觉与交互改动的**唯一强制设计准则**。
> 任何 UI / CSS / 组件 / 动效 / 主题相关变更，必须以本规范为依据；与本规范冲突的写法视为不合格，不得合入。
> **上游依据**：[TDesign 设计体系](https://tdesign.tencent.com/design/values)（价值观 · 全局样式 · 中后台指南）。
> **实现落点**：`frontend/src/react/styles/globals.css`、`frontend/src/react/lib/motion.ts`、共享 UI 组件。

---

## 0. 适用范围与优先级

1. **适用**：React 前端全部页面与组件（含本机、主机运维、看板、终端、设置、配置中心等）。
2. **不适用**：后端 API、业务数据结构、SSH/Agent 协议本身（但错误态、空态、加载态的界面表现仍须遵守本规范）。
3. **优先级**（高 → 低）：
   1. 本文明确写出的**本仓库强制条款**与验收标准
   2. TDesign 官方规范（价值观 / Color / Fonts / Motion / Icon / Layout / Dark / 中后台指南）
   3. 本文「已确认的本仓库特例」（见 §9）
   4. 个人审美偏好、历史 M3 做法、随意硬编码色值 —— **一律不采纳**

---

## 1. 价值观（设计决策的第一原则）

来源：[价值观](https://tdesign.tencent.com/design/values) —— **包容 · 多元 · 进化 · 连接**。

| 价值观 | 对本产品的强制含义 |
|---|---|
| **包容** | 先理解运维场景（高密度表格、终端、告警、多主机切换），再定视觉；同一套 token 服务亮/暗与各模块，为终端/看板等场景保留合理定制面，但**不得另起一套互不兼容的色板**。 |
| **多元** | 允许场景差异（列表 / 详情 / 终端 / 看板），但差异必须映射到同一语义 token；禁止为单页发明「只在这一页生效」的品牌色或字号体系。 |
| **进化** | 可迭代布局与组件，但须保持 token 与交互语义的延续；大改视觉必须先改 token / 本文件，再改页面。 |
| **连接** | 侧栏、主机、本机、看板、设置之间视觉与交互语言一致；共享按钮、表、浮层、动效类，禁止复制粘贴出分叉样式。 |

**决策自检（改 UI 前必答）**

- [ ] 这次改动是在增强「理解 / 效率 / 一致性」，还是在堆装饰？
- [ ] 能否用现有 token / 共享组件完成？若不能，是否先扩展 token 再改页面？
- [ ] 亮色与暗色是否同时想过？终端/代码区是否被误伤？

---

## 2. 色彩（Color）

来源：[Color 色彩](https://tdesign.tencent.com/design/color)、[Dark Mode](https://tdesign.tencent.com/design/dark)。

### 2.1 品牌与功能色（亮色默认）

| 语义 | TDesign | Token（本仓库） | 色值 |
|---|---|---|---|
| 品牌 / 主操作 | Blue7 | `--color-accent` | `#0052d9` |
| 品牌 Hover | Blue6 | `--color-accent-hover` | `#366ef4` |
| 品牌 Active | Blue8 | `--color-accent-active` | `#003cab` |
| 品牌浅底 / 选中底 | Blue1 | `--color-accent-soft` | `#f2f3ff` |
| 焦点外环 | Blue2 | `--color-accent-focus` | `#d9e1ff` |
| 成功（正文级） | Green7 系加深 | `--color-success` | `#006c45` |
| 错误（正文级） | Red7 系加深 | `--color-danger` | `#ad352f` |
| 告警（正文级） | Orange7 系加深 | `--color-warn` | `#954500` |
| 信息 / 链接倾向 | Blue6 | `--color-info` | `#366ef4` |
| 成功浅底 | Green1 | `--color-success-soft` | `#e3f9e9` |
| 错误浅底 | Red1 | `--color-danger-soft` | `#fff0ed` |
| 告警浅底 | Orange1 | `--color-warn-soft` | `#fff1e9` |

功能色用于**状态语义**（成功/失败/告警/链接），不得用品牌蓝冒充错误或告警。

### 2.2 中性色与文字

| 语义 | TDesign | Token | 亮色 |
|---|---|---|---|
| 画布 / 页面底 | Gray1 | `--color-canvas` | `#f3f3f3` |
| 容器面 | White | `--color-surface` | `#ffffff` |
| 次级面 / Hover 底 | Gray1 | `--color-raised` | `#f3f3f3` |
| 分隔 / 描边 | Gray3 | `--color-line` | `#e8e8e8` |
| 主文字 | Font Gy1（黑 90%） | `--color-ink` | `rgba(0,0,0,0.9)` |
| 次文字 | Font Gy2（黑 60%） | `--color-muted` | `rgba(0,0,0,0.6)` |

**对比度强制**：正文与背景对比度 ≥ **4.5:1**（WCAG AA）。小字功能色已取加深档，禁止改回过浅的色阶当正文用。

### 2.3 暗色模式

原则（TDesign）：**内容优先 · 阅读舒适 · 信息层级与亮色一致 · 满足 WCAG 2.0**。

- 页面底 / 容器 / 次级面 / 描边：对齐 Gray14 / Gray13 / Gray12 / Gray11 思路（见 `html.dark` 与看板注释）。
- 主/次文字：白 90% / 白约 55%（本仓库 `--color-muted` 为 `0.55`）。
- **禁止**在暗底上使用高饱和「抖动」色做大面积填充；品牌与功能色用暗色色板对应档（已映射在 `html.dark`）。
- 亮 ↔ 暗切换后，**信息层级不得颠倒**（标题仍强于正文，正文强于辅助）。

### 2.4 图表色

| 用途 | Token | 约定 |
|---|---|---|
| 单线主指标 | `--color-chart-1` | 品牌蓝 |
| 读 / 下行 / 接收 | `--color-io-read` / `--color-chart-2` | 绿 `#2ba471` |
| 写 / 上行 / 发送 | `--color-io-write` / `--color-chart-3` | 橙 `#e37318` |

禁止在图表里随意引入未登记的彩虹色；扩展色（Cyan / Purple / Pink / Yellow）仅在多序列且现有三色不够时，经 token 登记后再用。

### 2.5 色彩使用禁令

- ❌ 在组件内硬编码 `#0052d9` / `#fff` 等色值（图表库读 CSS 变量、终端 ANSI、第三方编辑器主题除外；能读变量则读变量）。
- ❌ 用阴影或高饱和色代替层级；容器层级靠 **中性色阶 + 1px `--color-line` 描边**。
- ❌ 品牌色大面积铺底（仅用于主按钮、选中、焦点、关键强调）。

---

## 3. 字体（Fonts）

来源：[Fonts 字体](https://tdesign.tencent.com/design/fonts)。

### 3.1 字体族

- UI：`--font-sans`（Helvetica Neue / PingFang SC / Microsoft YaHei 等系统栈）。
- 等宽：`--font-mono`（终端、代码、日志、需对齐的数字列优先）。
- 实际字号/字体族可读 `ipannel.settings.v1`（`--app-font-family` / `--app-font-size`），**默认正文按 14px 设计**。

### 3.2 字阶（桌面端）

| 档位 | 字号 | 用途 |
|---|---|---|
| 最小 | **12px** | 辅助说明、表头次要信息、标签；**禁止再小**（桌面） |
| 正文 | **14px** | 默认正文、表单元格、多数控件 |
| 强调 | 16px | 小节标题、需要略强的标题 |
| 模块标题 | 20px | 页面/模块主标题（慎用） |
| 展示数字 | 24 / 28 / 36… | 看板大数字等第二字阶；步进按 TDesign 第二字阶，勿随意 +1px |

### 3.3 行高与字重

- 行高优先：**`line-height ≈ font-size + 8`**（TDesign），避免大标题仍用 1.5 造成割裂。
- 字重仅用 **400** 与 **600**（对应 Regular / Semibold·Bold），禁止依赖 500 作为唯一层级手段（Windows 上易失效）。

### 3.4 字色

- 主：`--color-ink`；次：`--color-muted`。
- 占位 / 禁用：在 ink 基础上降低透明度，或使用等价语义类；须仍可辨认，禁用态不可与次要文案混淆到无法区分。

---

## 4. 布局与间距（Layout）

来源：[Layout 布局](https://tdesign.tencent.com/design/layout)、[如何搭建整体框架](https://tdesign.tencent.com/design/offices)。

### 4.1 信息架构（本产品）

本产品是**桌面端中后台运维工具**，默认采用 **左右结构（侧栏 + 内容）**，复杂主机页可在内容区再叠 Tab / 工具条（混合结构）。

| 区域 | 约定 |
|---|---|
| 侧栏（Sider） | 整站导航；展开/收起由应用状态控制；位于整窗通栏**下方**；默认宽对齐通栏主页图标右缘；可拖拽改宽（160–480px），双击分割条复位 |
| 顶栏工具条 | 固定 **40px**（`.shell-app-toolbar`），**整窗贯通**至红绿灯旁（Firefox 式）；与侧栏同色；页面标题/操作经 portal 挂入 |
| 内容区 | `.content-float`；卡片用 `.surface-float` |
| 卡片间隙 | `--gap-card`（见 §9 特例） |

### 4.2 网格与间距原则

- **网格基数：8px**。新间距优先 8 的倍数；允许 **4 / 12** 小档（TDesign）。
- 槽（gutter）思维默认 **16px**；页面安全边距优先 **24px** 或 8 的倍数。
- 内容区块从「列」起止对齐，避免凭感觉 13px、15px 这类无体系间距。
- 圆角：控件 `--radius-control: 4px`；卡片/表格/弹窗表面 `--radius-surface: 0`（直角，见 §9）。

### 4.3 导航选用

- 模块多、需频繁切换 → 侧栏 / 纵向导航。
- 同一模块内少量互斥视图（约 2–5 项）→ 分段控件或 Tabs。
- 主机功能等多入口 → 顶栏/页内 Tabs，保持单行可扫，禁止挤成多行杂乱按钮堆。

---

## 5. 动效（Motion）

来源：[Motion 动效](https://tdesign.tencent.com/design/motion)；实现：`globals.css` Motion 区、`lib/motion.ts`。

### 5.1 原则

**理解 · 聚焦 · 共情** —— 动效服务于理解与反馈，不是装饰。

添加动效前用 TDesign 自查：

1. 解决了什么问题？是否降低理解成本？
2. 能否被明确感知（桌面端时长区间内）？
3. 是否过度编排？删除后静态是否仍能传达必要信息？
4. B 端场景是否过于吸睛？若是则削弱。

### 5.2 运动模式选型

| 关系 | 模式 | 本仓库用法 |
|---|---|---|
| 有空间指向（Tab 横滑、菜单出现） | **轴运动** | `motion-axis-x/y/z-*` |
| 共享容器形变 | **容器转换** | 慎用；优先简单轴运动 |
| 无强空间关系 | **淡入淡出** | `motion-fade-*`、overlay |

- 入画：ease-out；出画：ease-in；画面内：standard；伴随渐变可用 linear。
- **桌面端固定时值**（强制）：

| Token | 时长 | 用途 |
|---|---|---|
| `--duration-base` / `MOTION_MS.base` | **200ms** | 微观、颜色、淡入淡出 |
| `--duration-moderate` | **240ms** | Tab、菜单、列表反馈 |
| `--duration-slow` | **280ms** | 抽屉、全局提示、对话框 |

缓动曲线：

- `--ease-standard`: `cubic-bezier(0.38, 0, 0.24, 1)`
- `--ease-out`: `cubic-bezier(0, 0, 0.15, 1)`
- `--ease-in`: `cubic-bezier(0.82, 0, 1, 0.9)`

### 5.3 动效禁令

- ❌ 首屏内容做逐条顺序入场动画（中后台应直接呈现或轻淡入）。
- ❌ Elastic / 弹跳类 UI 动效（非插画）。
- ❌ 忽略 `prefers-reduced-motion`（须降为无动画，已有全局处理须保持）。
- ❌ 随意使用 150ms、300ms、500ms 等未登记时长。

---

## 6. 图标（Icon）

来源：[Icon 图标](https://tdesign.tencent.com/design/icon)。

- 风格：**线性、简洁、表意精确**；同系列视觉重量一致。
- 常用尺寸：16 / 20 / 24 / 32；绘制栅格按 24，交付可缩至 16。
- 描边观感保持一致（勿混用粗细悬殊的图标集）。
- 命名与含义准确；禁止含糊图形；状态（成功/警告）优先用功能色 + 清晰形状。

---

## 7. 中后台高频任务模式

来源：[如何设计高频任务](https://tdesign.tencent.com/design/offices-task)。

实现筛选、批量、导入、状态变更、引导时，**先选模式再堆组件**：

| 任务 | 模式要点（择一说清） |
|---|---|
| 筛选查询 | 查询后生效 vs 立即生效；条件过多则折叠 |
| 表格批量 | 所见即所得（主操作常显）vs 选中后浮出操作区 |
| 效果预览 | 异步集中预览 vs 局部同步预览 |
| 新手/任务引导 | 阻断（Dialog）vs 非阻断（气泡/提示） |
| 数据导入 | 单文件快速 vs 批量确认 |
| 状态流转 | 须看详情再改 vs 列表摘要即可改 |

本产品中：主机列表多选、进程操作、文件上传、配置导入等，均应对号入座，避免「按钮到处都是、反馈却不统一」。

---

## 8. 组件与表面（本仓库落地）

### 8.1 表面层级

1. **画布** `--color-canvas`（磨砂/窗口底之上的逻辑底）
2. **悬浮内容面** `.surface-float`：`--color-surface` + `1px solid var(--color-line)` + `--radius-surface`，**默认无阴影**
3. **浮层**（菜单/对话框）：可用克制阴影；仍用 surface + line，动画走 Motion token
4. **终端 / 代码 / 日志**：石墨表面，保留 ANSI / 编辑器主题，**不随亮色主题洗成浅底**

### 8.2 控件

- 按钮：共享 `Button`（primary / secondary / danger / ghost）；主操作才用 `primary`。
- 焦点：可见 `focus-visible`，输入类可用 `--color-accent-focus` 外环。
- 表格：行高、表头高度与虚拟表常量一致（见 §9）；hover 用 raised/状态层，不加夸张阴影。
- 卡片：Outlined 风格（描边 + 白底），hover **不加 elevation**，可用轻微底色变化。

### 8.3 技术栈约束

- React + Tailwind + 共享 UI；颜色进 `@theme` / CSS 变量，不进业务魔法数。
- Tailwind 预检**不得破坏** `.xterm`、CodeMirror 光标与选区。
- 不改公开 API / 后端数据结构来「迁就样式」。

---

## 9. 已确认的本仓库特例（允许偏离 TDesign 默认处）

以下为产品已拍板的特例；**改特例须先更新本节，再改代码**。

| 特例 | 现行值 | 说明 |
|---|---|---|
| 表面圆角 | `--radius-surface: 0` | 卡片/表/弹窗直角，区别于部分 TDesign 模板圆角 |
| 控件圆角 | `--radius-control: 4px` | 按钮、输入等 |
| 卡片间隙 | `--gap-card: 5px` | 历史密度选择；新间距仍优先 8 倍数，勿再扩散更多「5px 体系」 |
| 顶栏高度 | 40px | 对齐桌面窗口控件带；整窗贯通，侧栏在其下 |
| 侧栏宽度 | 默认对齐主页图标右缘（Mac ≈232px）；可拖 160–480px；双击分割条复位 | Firefox 式分割条 |
| 表行 / 表头 | 48px / 40px | 运维密度；虚拟表与 CSS 必须同源 |
| 终端/代码/日志 | 独立暗色石墨面 | 不随亮色主题变浅 |
| 看板 | 深色专用表面 | 可沿用 TDesign Dark 中性色阶注释 |
| 进程等超高密虚拟表 | 可低于 48px | 仅限已论证的数据密度场景，并在代码旁注释 |

---

## 10. 验收标准（Definition of Done）

下列清单在 **UI 相关 PR / 改动交付前** 必须全部勾选或明示豁免（豁免须写入 §9）。

### 10.1 Token 与色彩

- [ ] 无新增未登记硬编码色；新色已写入 `globals.css` token 并在亮/暗双份定义（若适用）
- [ ] 品牌/功能/中性色用法符合 §2；正文对比度达标
- [ ] 暗色下无高饱和大面积色块；层级与亮色一致

### 10.2 字体与布局

- [ ] 桌面字号 ≥ 12px；正文默认 14px 体系
- [ ] 字重主要为 400/600；行高无明显割裂
- [ ] 间距服从 8 点网格（或 §9 已列特例）；未引入随机 px
- [ ] 侧栏/顶栏/内容层级清晰；工具条高度未破坏 40px 约定（除非改 §9）

### 10.3 动效

- [ ] 时长仅使用 200 / 240 / 280ms（或动态时值有据）
- [ ] 缓动使用 standard / in / out token
- [ ] 有 `prefers-reduced-motion` 安全网
- [ ] 通过 §5.1 自查：非纯装饰、非过度编排

### 10.4 组件与任务模式

- [ ] 复用共享 Button / surface / table / dialog / motion 类，无分叉私货皮肤
- [ ] 筛选/批量/导入/引导等符合 §7 某一种明确模式
- [ ] 终端、代码、图表未回归错误浅色或错误色语义（读绿写橙）

### 10.5 回归

- [ ] 亮色 + 暗色各扫一眼关键路径
- [ ] 窄窗/侧栏收起下顶栏与内容仍可用
- [ ] 未破坏 xterm / CodeMirror / 看板可读性

---

## 11. 改动流程（强制）

1. **读**：先读本文件相关章节 + 现行 token。
2. **选**：能用 token / 共享组件则直接用；否则先扩 token 与本文，再改页面。
3. **做**：最小 diff；禁止顺手整文件格式化或回退到 M3 紫题。
4. **验**：按 §10 勾选。
5. **记**：若引入长期特例，更新 §9；若修正规范，更新本文件并保持与 `globals.css` 同步。

官方速查：

- 价值观 <https://tdesign.tencent.com/design/values>
- 色彩 <https://tdesign.tencent.com/design/color>
- 字体 <https://tdesign.tencent.com/design/fonts>
- 动效 <https://tdesign.tencent.com/design/motion>
- 图标 <https://tdesign.tencent.com/design/icon>
- 布局 <https://tdesign.tencent.com/design/layout>
- 深色 <https://tdesign.tencent.com/design/dark>
- 框架 <https://tdesign.tencent.com/design/offices>
- 高频任务 <https://tdesign.tencent.com/design/offices-task>
