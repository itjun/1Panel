# 1Panel 设计规范（强制）—— 机柜面板（Rack Panel）

文档导航见 [设计文档索引](README.md)。本文代码路径均相对仓库根目录。

> **地位**：本文件是前端视觉与交互改动的**唯一强制设计准则**。
> 任何 UI / CSS / 组件 / 动效 / 主题相关变更，必须以本规范为依据；与本规范冲突的写法视为不合格，不得合入。
> **主题**：「机柜面板」—— 灵感来自服务器机柜前面板：中性浅灰金属外框 + 白色面板，**所选色系的主色负责强调，状态色与彩色图标负责活力**。本规范自成一体，不再依附任何第三方设计体系。
> **绿色只表成功与健康**：绿色用于成功状态（success，按 TDesign 官方值）与占用类指标的正常档（Meter 正常段、占用曲线 <60% 段，与 success 同源同值，对齐行业监控惯例「正常绿 / 警告橙 / 危险红」）；品牌色、按钮、装饰、其他图表不用绿色（代码编辑器语法高亮除外）。
> **扁平化**：三块纯色面（深一档的一级图标栏 + L 形灰色外框 + 白色内容平面）、无卡片、零阴影、色块表达选中。
> **实现落点**：`frontend/src/react/styles/globals.css`（色彩 / 圆角 / 间距 / 字体 / 动效 token）、`frontend/src/react/lib/motion.ts`（动效时值）、`frontend/src/react/lib/platform.ts`（平台判断唯一出口）、`frontend/src/react/components/ui/*`（共享 UI 组件）。

> **2026-10-26 配色更新**：保留默认经典蓝灰，并提供十套经预览确认的马卡龙色系，以 §2.6 和 `color-palettes.ts` 为准。默认配色恢复中性浅灰外框、白色内容与品牌蓝，深色保留原有蓝黑调。马卡龙使用柔和浅底与带少量色相的深灰底；§2.6 登记的马卡龙允许将各自主题色用于主操作、选中和普通趋势线，健康绿 / 告警橙 / 危险红的状态语义不变。

---

## 0. 适用范围与优先级

1. **适用**：React 前端全部页面与组件（含本机、主机运维、看板、终端、设置及备份与配置分区等），以及 macOS / Windows / Linux 三端的窗口壳层（chrome）。
2. **不适用**：后端 API、业务数据结构、SSH/Agent 协议本身（但错误态、空态、加载态的界面表现仍须遵守本规范）。
3. **优先级**（高 → 低）：
   1. 本文明确写出的**强制条款**与 §10 验收标准
   2. 本文各章节的通用原则（色彩 / 字体 / 布局 / 动效 / 图标 / 任务模式）
   3. 本文「已确认的本仓库特例」（见 §9）
   4. 个人审美偏好、历史 M3 做法、随意硬编码色值 —— **一律不采纳**

---

## 1. 价值观（设计决策的第一原则）

主题一句话：**所选色系贯穿外壳、内容与图表；主色负责强调，状态色表达健康状态。**

| 价值观 | 对本产品的强制含义 |
|---|---|
| **有序的活力** | 底色、容器、描边和文字使用所选色系的明暗色阶（§2.6）；主色用于主操作、选中、链接；状态色表达成功（绿） / 告警 / 错误；Meter 正常段与占用曲线正常档用健康绿（与 success 同源，对齐行业监控惯例的正常绿）；系统发行版、文件 / 文件夹、服务名色点允许彩色识别色（§6、§9）。渐变只在能表达信息时使用（§2.5），禁止光晕、彩色大面积铺底，**绿色只用于成功状态与健康档占用**。 |
| **同一** | macOS / Windows / Linux 三端**布局、颜色、尺寸一致**：同一侧栏宽度、同一行高、同一色值、同一间距；字形跟随系统和用户选择（§3.1）。除字形外唯一允许的平台差异是窗口按钮位置（Mac 系统红绿灯左上，Win/Linux 自绘按钮右上）。 |
| **密度** | 面向运维：高密度表格、终端、多主机切换优先；同一套 token 服务亮 / 暗与各模块，为终端 / 看板保留独立石墨面，但**不得另起一套互不兼容的色板**。 |
| **连接** | 侧栏、主机、本机、看板、设置之间视觉与交互语言一致；共享按钮、表、浮层、Meter、动效类，禁止复制粘贴出分叉样式。 |

**决策自检（改 UI 前必答）**

- [ ] 这次改动是在增强「理解 / 效率 / 一致性」，还是在堆装饰？
- [ ] 新增的颜色是否属于§2.6 登记色系 / 状态色 / §9 登记的彩色图标？若都不是，使用已登记 token；绿色是否只用在成功状态与健康档占用（Meter 正常段 / 占用曲线）？
- [ ] 能否用现有 token / 共享组件完成？若不能，是否先扩展 token 再改页面？
- [ ] 三端是否都想过？亮色与暗色是否同时想过？终端 / 代码区是否被误伤？

---

## 2. 色彩（Color）

### 2.1 亮色（默认）

外框为**中性浅灰**（对齐 TDesign `bg-color-page` `#F2F3F5`，不带蓝调；壳层与白色内容面之间不画分隔线、只靠色块区分，故外框灰度须足够可辨），次级面、描边、文字、Tooltip 等整套灰阶同样取中性灰，主色为「品牌蓝 `#0052D9`」。以下表格保留经典蓝灰的基础参考值；实际明暗配色统一由 `frontend/src/react/lib/color-palettes.ts` 生成明确色值并校验对比度，`globals.css` 提供启动前回退。见 §2.6。

**硬性规定**：绿色用于成功状态（success：成功 / 正常 / 在线 / 最新）与占用类指标正常档（Meter 正常段、占用曲线 <60% 段，2026-10-03 定案，对齐行业监控惯例 Grafana / htop 的「正常绿、警告橙、危险红」，正常档读作主机健康），两者同取 TDesign 官方值（与 `--color-success` 同源同值，不另造绿）；品牌色、按钮、装饰图表、识别色不用绿色（代码编辑器语法高亮除外）。读 IO 用亮蓝，写 IO 用橙。

**success 文字**：`--color-success` 只给图标 / 圆点 / 条线着色（亮色 `#2BA471` 在 surface 上 3.16、在 success-soft 上 2.86，不够作正文）；成功**文字**一律用 `--color-success-text`（`text-success-text`），含 Tag `ok` 与「success-soft 浅底 + 成功文字」。提示条按 TDesign Alert：正文 ink，只有图标用 success。

| 语义 | Token | 值 |
|---|---|---|
| 一级图标栏 | `--color-rail` | `#EAEBEE`（比 canvas 深一档；12px muted 文字在上面 4.57:1） |
| 画布 | `--color-canvas` | `#F2F3F5`（TDesign bg-color-page，对白色 surface 1.11:1） |
| 容器面 | `--color-surface` | `#FFFFFF` |
| 次级面 / hover 底 | `--color-raised` | `#F3F4F6` |
| 分隔 / 描边 | `--color-line` | `#E5E7EB` |
| 控件描边 | `--color-line-strong` | `#9CA3AF` |
| 主文字 | `--color-ink` | `#1F2937` |
| 次文字 | `--color-muted` | `#636A76`（surface 上 5.4:1、raised 上 4.9:1） |
| 主色（品牌蓝） | `--color-accent` | `#0052D9` |
| 主色 hover | `--color-accent-hover` | `#366EF4` |
| 主色 active | `--color-accent-active` | `#003CAB` |
| 主色浅底 / 选中底 | `--color-accent-soft` | `#E8EFFF` |
| 主色更浅底 | `--color-accent-tint` | `#F2F6FF` |
| 焦点外环 | `--color-accent-focus` | `#C5D6FF` |
| 文本选区 | `--color-selection` | `#C9DAFF` |
| 成功 / 正常（绿，图标 / 圆点 / 条线） | `--color-success` | `#2BA471` |
| 成功文字 | `--color-success-text` | `#1A7F52`（success-soft 上 4.52:1，surface 上 5.0:1） |
| 错误 | `--color-danger` | `#D54941` |
| 告警 | `--color-warn` | `#D35A00` |
| 信息 | `--color-info` | `#0A6FE0` |
| 成功浅底 | `--color-success-soft` | `#E3F9E9` |
| 错误浅底 | `--color-danger-soft` | `#FFECEA` |
| 告警浅底 | `--color-warn-soft` | `#FFF0E3` |
| 信息浅底 | `--color-info-soft` | `#E3F1FF` |
| 图表主线 | `--color-chart-1` | `#0052D9` |
| 读 / 流入 | `--color-io-read` / `--color-chart-2` | `#1D8CF8` |
| 写 / 流出 | `--color-io-write` / `--color-chart-3` | `#F08A24` |
| LED 分段条 正常 | `--meter-ok` | `#2BA471`（健康绿，与 `--color-success` 同源同值；三档对齐行业监控惯例 Grafana / htop：正常绿、警告橙、危险红；红绿色盲的档位区分靠亮度差与读数文字兜底；2026-10-03 定案，推翻先前「度量不是成功事件」的蓝青方案） |
| LED 分段条 警告（≥60%） | `--meter-warn` | `#F08A24` |
| LED 分段条 危险（≥85%） | `--meter-danger` | `#D54941` |
| LED 分段条 未亮格 | `--meter-off` | `#E5E7EB` |
| 浮层遮罩（Smoke 烟雾） | `--color-scrim` | `rgba(0, 0, 0, 0.6)`（透明类材质：压暗下层表面强调重要 UI，如模态对话框 / 抽屉下方的遮罩；不区分明暗模式，始终半透明黑，明暗共用此值，2026-10-03 定案） |
| 文字提示底 / 字（Tooltip） | `--color-tooltip` / `--color-tooltip-text` | `#1F2937` / `#FFFFFF`（反色小气泡，对比约 14.7:1） |

功能色用于**状态语义**（成功 / 失败 / 告警 / 主操作）。success 为绿色（TDesign 官方值），占用正常档 `--meter-ok` 与之同源同值，是全站仅有的两处绿色出处；不得用蓝色冒充错误或告警，也不得用告警橙做装饰。

### 2.2 暗色（`html.dark`）

原则：**内容优先 · 阅读舒适 · 信息层级与亮色一致**。暗色是同一块机柜面板在机房关灯后的样子，不是另一套主题。经典蓝灰保留蓝黑调，其余色系使用对应的深色底层（§2.6）。

| 语义 | Token | 值 |
|---|---|---|
| 一级图标栏 | `--color-rail` | `#0D1017`（比 canvas 深一档） |
| 画布 | `--color-canvas` | `#12161F` |
| 容器面 | `--color-surface` | `#1A1F2B` |
| 次级面 / hover 底 | `--color-raised` | `#232A38` |
| 分隔 / 描边 | `--color-line` | `#2C3445` |
| 控件描边 | `--color-line-strong` | `#5A6478` |
| 主文字 | `--color-ink` | `#E6EBF3` |
| 次文字 | `--color-muted` | `#94A1B5` |
| 主色 | `--color-accent` | `#4C8DFF` |
| 主色 hover | `--color-accent-hover` | `#6FA3FF` |
| 主色 active | `--color-accent-active` | `#3A78E8` |
| 主色浅底 / 选中底 | `--color-accent-soft` | `#1A2C52` |
| 主色更浅底 | `--color-accent-tint` | `#172440` |
| 焦点外环 | `--color-accent-focus` | `#22407A` |
| 文本选区 | `--color-selection` | `#274A8C` |
| 成功 / 正常（绿） | `--color-success` | `#56C08D` |
| 成功文字 | `--color-success-text` | `#56C08D`（同 success；success-soft 上 5.53:1，surface 上 7.31:1） |
| 错误 | `--color-danger` | `#F06C63` |
| 告警 | `--color-warn` | `#F29A4A` |
| 信息（亮蓝） | `--color-info` | `#4FB0FF` |
| 成功浅底 | `--color-success-soft` | `#1A3A2B` |
| 错误浅底 | `--color-danger-soft` | `#43201E` |
| 告警浅底 | `--color-warn-soft` | `#40280F` |
| 信息浅底 | `--color-info-soft` | `#15304A` |
| 图表主线 | `--color-chart-1` | `#4C8DFF` |
| 读 / 流入 | `--color-io-read` / `--color-chart-2` | `#4FB0FF` |
| 写 / 流出 | `--color-io-write` / `--color-chart-3` | `#F29A4A` |
| LED 分段条 正常 | `--meter-ok` | `#56C08D`（健康绿，与暗色 `--color-success` 同源同值，理由同 §2.1） |
| LED 分段条 警告 | `--meter-warn` | `#F29A4A` |
| LED 分段条 危险 | `--meter-danger` | `#F06C63` |
| LED 分段条 未亮格 | `--meter-off` | `#2C3445` |
| 浮层遮罩 | `--color-scrim` | 不覆盖：Smoke 烟雾不分明暗，共用 §2.1 的 `rgba(0, 0, 0, 0.6)` |
| 文字提示底 / 字（Tooltip） | `--color-tooltip` / `--color-tooltip-text` | `#DFE5EE` / `#1B2433`（暗色下反为浅底深字） |

- 亮 ↔ 暗切换后，**信息层级不得颠倒**（标题仍强于正文，正文强于辅助）。
- **禁止**在暗底上使用高饱和色做大面积填充；功能色只走上表对应档。
- 终端 / 代码 / 日志保留专用深色面；应用内看板使用所选色系的深色版本，独立 HTTP 看板使用经典蓝灰深色版本（见 §2.6）。

### 2.3 对比度

**强制**：正文与背景对比度 ≥ **4.5:1**（WCAG 2.1 AA）。danger / warn / info 已取可作正文的加深档，禁止改回过浅色阶当正文用；success 不作正文，成功文字用 `--color-success-text`；亮色下 `--color-muted` 与 `--color-surface`、暗色下 `--color-muted` 与 `--color-surface` 均须达标。信息文字色 `--color-info`（亮色 `#0A6FE0`）与图表亮蓝 `--color-io-read` / `--color-chart-2`（`#1D8CF8`）分开：前者可作文字，后者只用于图表线条与图形。

### 2.4 图表色

监控曲线的线条、面积渐变、采样点、浮层及亮暗主题实现统一遵守[监控曲线规范](../../DESGIN.md)（2026-10-19 选定第 1 套，保留现有布局）。

| 用途 | Token | 约定 |
|---|---|---|
| 单线主指标 | `--color-chart-1` | 所选色系主色 |
| 读 / 流入 / 接收 | `--color-io-read` / `--color-chart-2` | 亮蓝 |
| 写 / 流出 / 发送 | `--color-io-write` / `--color-chart-3` | 橙 |

图表色与状态色同源：读亮蓝、写橙的语义在全站固定。禁止在图表里引入未登记的彩虹色；确需第 4 序列以上时，先在配色定义登记 `--color-chart-N`（亮 / 暗双份）再用。

**占用类曲线分段着色**：CPU 使用率、负载、内存已用这类「有上限」的单线指标，按 §4.7 三档阈值（< 60% / 60–85% / ≥ 85%）逐段着色，走 `--meter-ok / warn / danger`，与概览圆环、Meter 同色同阈值。负载按核数折算，内存按总量折算；拿不到核数 / 总量时退回 `--color-chart-1` 单色。阈值与换算统一走 `frontend/src/react/lib/usage-tone.ts`，页面内不写 `60 / 85`。流量、磁盘 IO 没有上限，不分段，保持读亮蓝写橙。与分段曲线同图的陪衬序列（如交换）用 `--color-muted` 细虚线，不与警告橙混淆。读数到危险档时数值用 `--color-danger` 文字色，警告档不改文字色。

### 2.5 色彩使用禁令

- ❌ **成功状态与健康档占用以外的绿色**（色相约 70°–170°）：品牌色、按钮、装饰图表、识别色一律不用；例外包括 `--color-success` / `success-soft` / `success-text`、占用正常档 `--meter-ok`、代码编辑器语法高亮（Monokai 等）及 §2.6 已确认的马卡龙主题色。
- ❌ 在组件内硬编码 `#0052D9` / `#fff` 等色值（图表库读 CSS 变量、终端 ANSI、第三方编辑器主题、§9 登记的彩色图标除外；能读变量则读变量）。
- ❌ 在关键可见位置使用 `color-mix()` 生成色值（Linux 旧版 WebKitGTK 不支持，会导致三端不一致）；需要的中间色一律登记为 token。
- ❌ 用阴影、渐变或高饱和色代替层级；层级靠 **纯色色块**（外框 canvas / 内容 surface），浮层再加 1px `--color-line` 描边。
- ❌ **禁止阴影**：任何 `box-shadow` / `shadow-*` / `drop-shadow` 表达层级（唯二例外：输入类 focus 外环、Linux frameless 1px 外描边，见 §9）。
- ❌ **禁止卡片套卡片**：内容区不再用描边圆角盒子包区块，区块靠标题 + 24px 留白分段。
- ❌ **装饰性渐变**：背景、按钮、Meter、图标保持纯色，不为「好看」加渐变。渐变可以用，前提是它在表达信息且克制：例如占用曲线按阈值分段变色（§2.4）、面积图由线色向透明淡出以强调走势。判断标准：去掉渐变后是否丢失信息或可读性变差；不会，就用纯色。
- ❌ 主色大面积铺底（仅用于主按钮、选中、焦点、关键强调）。
- ❌ 除 §2.1 / §2.2 / §2.6 所列 token 与 §9 登记的彩色图标外，页面内出现任何其他彩色。


### 2.6 默认配色与十套马卡龙配色（2026-10-26）

- 默认配色（经典蓝灰）保留 `classic` 标识，是初始值、无效值回退及恢复默认值的目标。马卡龙系列：雾蓝 `mist-blue`、青瓷 `celadon`、开心果 `pistachio`、杏仁奶油 `almond`、草莓奶霜 `strawberry`、薰衣草 `lavender`、玫瑰灰紫 `rose-mauve`、灰调粉彩 `muted-pastel`、糖果什锦 `candy`、暮蓝撞色 `twilight`。十一套均含浅色和深色；明暗模式与色系独立选择。
- `color-palettes.ts` 是运行时色值来源。默认配色沿用经典蓝灰的基础值及派生规则。十套马卡龙来自配色卡网站并按已确认预览分配一级栏、画布、内容面、强调色与选中底；允许同套中的不同柔和色相形成层次，浅色以近白内容面为主，深色使用带少量色相的灰底。输出十六进制或明确 rgba，不使用 CSS `color-mix()`；文字与有效图形为满足对比度可加深/提亮。
- 旧偏好兼容迁移：`sea-salt → mist-blue`、`glacier → celadon`、`morandi → pistachio`、`latte → almond`、`rose → strawberry`、`macaron → lavender`、`iris → almond`、`graphite → rose-mauve`；不重置用户的明暗模式。
- 设置保存 `ipannel.settings.v1.colorPalette`；缺失或未知值使用 `classic`（默认经典蓝灰），保留原明暗偏好。恢复默认回到经典蓝灰与跟随系统。选择立即生效并持久化。
- 配色使用大尺寸缩略图，复用真实圆环、Meter 和曲线组件，与应用共享颜色定义；原生单选语义支持方向键，选中项有主色描边、对勾和名称强调。导航保持背景选中，不增加前置装饰条。
- 外壳、内容、控件、图表线条/面积/坐标轴/提示框及轨道整套联动。图表依赖明暗与配色签名，切换色系后立即重建 option，不等待下一轮采样。
- 资源健康维持绿/橙/红与现有 60% / 85% 阈值；色阶随色系调整。普通任务进度使用主色；输入/输出保持蓝/橙语义。主色实底前景用 `--color-on-accent`，危险实底用 `--color-on-danger`，不得固定白字。
- 正文、辅助文字、功能文字、主按钮各状态前景对比度至少 4.5:1；关键曲线、圆环有效弧、Meter 有效段与相邻表面对比度至少 3:1。健康状态同时保留读数/文字信息。
- 原生云母偏好和回退逻辑保留；十一套主题均在 Web 外壳绘制确定底色。应用内看板通过局部 `--board-*` 取同色系深色版本，其图表也显式取深色；HTTP 看板保持独立的原始深色。终端和代码编辑器语法主题独立。

---

## 3. 字体（Fonts）

### 3.1 字体族（系统字体，Mac 优先）

应用**不自带字体文件**，默认使用各平台的系统字体：Mac 上英文 / 数字走 SF、中文落到苹方；Windows 走 Segoe UI + 微软雅黑；Linux 走 Noto Sans CJK / 文泉驿。**三端字形不同是有意为之**：布局、颜色、尺寸三端一致，字形跟随系统和用户选择。

| 用途 | 默认 | 说明 |
|---|---|---|
| 界面（菜单、侧栏、按钮、主机名、表格普通文字、提示条、弹窗） | 系统字体栈 `--font-sans` | 开启 `font-variant-numeric: tabular-nums`，SF 支持等宽数字，数值列能上下对齐 |
| 等宽（IP、版本号、数值列、路径、日志、配置编辑器） | 系统等宽栈 `--font-mono` | 对齐场景优先；等宽区域一律 `font-variant-ligatures: none`，用户选了带连字的字体时 `->` `!=` 不会被拼成一个字形 |

Token（`globals.css` `@theme static`，Mac 的字体排最前）：

- `--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", "Helvetica Neue", Arial, system-ui, sans-serif`
- `--font-mono: var(--app-font-mono, ui-monospace, "SF Mono", Menlo, "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Noto Sans Mono CJK SC", monospace)`

用户覆盖（设置页「字体」，存 `ipannel.settings.v1`，仅本机）：

- 界面字体 `fontFamily` → 非空时写入 `--app-font-family`，`.react-root` 以 `var(--app-font-family, var(--font-sans))` 取用。
- 等宽字体 `monoFontFamily` → 非空时写入 `--app-font-mono`，`--font-mono` 自动跟随；`board.css` / `local.css` / `code-surface.tsx` 直接引用 `var(--font-mono)` 即可，不要另写字体名。
- 选项由 `lib/fonts.ts` 按 `detectAppOs()` 生成，只列当前系统上有的字体；最后一项「自定义…」在该行下方展开**本机字体列表**（`components/font-picker.tsx`，数据来自后端 `System.ListSystemFonts` → `internal/sysfonts`：Mac 走 CoreText，Windows / Linux 扫字体目录），可搜索、可「只看等宽字体」，点一项即保存；读取失败时才退回手填字体名。具体字体与自定义值后面都自动补系统后备栈，缺字体时不会显示成乱码；已存的自定义字体本机未安装时，列表顶部提示「本机未安装，当前显示系统默认」。
- 字体列表每一项用该字体自身渲染名字与示例（内联 `fontFamily` = 列表给出的家族名 + 系统后备栈），这是下条「禁止写死字体名」的唯一例外；面板为 `bg-raised` + `--radius-panel`，列表区铺 `bg-surface`，选中项 `accent-soft` 底 + `accent` 字 + 对勾。
- 空串 = 系统默认；旧版两串「默认」选项值读取时迁到空串。

**禁止**在页面 / 组件内写死具体字体名（`font-family: Menlo` 之类），一律走 `--font-sans` / `--font-mono` 或 Tailwind `font-mono`；也禁止再引入 `@font-face` 打包字体或运行时从网络加载字体。

### 3.2 字阶（桌面端）

| 档位 | 字号 | 用途 |
|---|---|---|
| 最小 | **12px** | 辅助说明、表头次要信息、标签；**禁止再小**（桌面） |
| 正文 | **14px** | 默认正文、表单元格、多数控件 |
| 强调 | 16px | 小节标题、需要略强的标题 |
| 模块标题 | 20px | 页面 / 模块主标题（慎用） |
| 展示数字 | 24 / 28 / 36… | 看板大数字、Meter 旁的大数值等第二字阶；勿随意 +1px |

实际字号可读 `ipannel.settings.v1`（`--app-font-size`），**默认正文按 14px 设计**。

### 3.3 行高与字重

- 行高：**`line-height ≈ font-size + 8`**，避免大标题仍用 1.5 造成割裂。
- 字重仅用 **400** 与 **600**；禁止依赖 500 / 700（部分系统字体没有这两档，会触发浏览器伪粗体）。

### 3.4 字色与数字

- 主：`--color-ink`；次：`--color-muted`。
- 占位 / 禁用：在 ink 基础上降低透明度，或使用等价语义类；须仍可辨认，禁用态不可与次要文案混淆到无法区分。
- 数值列、百分比、字节数、时间戳：用 `--font-mono` 或 `tabular-nums`，保证纵向对齐。

---

## 4. 布局与间距（Layout）

### 4.1 信息架构（本产品）

本产品是**桌面端中后台运维工具**，采用 **三段式结构（一级图标栏 + 二级标签栏 + 内容）**，企业微信式；复杂主机页可在内容区再叠 Tab / 工具条（混合结构）。

| 区域 | 约定 |
|---|---|
| 壳层三块色面 | 从深到浅：一级图标栏（`--color-rail`，通顶）→ 顶栏 + 二级栏组成的 **L 形外框**（`--color-canvas`）→ 内容区一整块**白色平面**（`--color-surface`）；三者之间**不画分隔线**，只靠色块区分 |
| 一级图标栏（Rail） | 宽 **72px**，**从窗口顶端通到底**；经典模式使用不透明底色 `--color-rail`；云母模式下为轻微层次色；顶部 40px 是窗口拖拽区：Mac 系统红绿灯落在这里，Win/Linux 在此居中放 18px 应用图标；其下自上而下平铺高频模块（主机 / 本机 / 配置 / 通知 / 测速），低频模块（巡检 / 设置）固定在栏底；配置模块承载备份恢复、应用 JSON 与 SSH 配置查看；侧栏开关不影响图标栏，始终显示 |
| 顶栏工具条 | 固定 **40px**（`.shell-app-toolbar`），从图标栏右缘（x = 72px）贯通到窗口右缘；底色 `--color-canvas`（与二级栏同色），无下边线；导航按钮（侧栏开关 / 后退 / 前进 / 刷新 / 主页）贴着图标栏开始，三端 x 坐标一致；**所有模块均不在通栏重复显示名称或页面标题**，当前模块由侧栏高亮标识，页面标题保留在内容区；主机工具标签仍用于切换功能；**操作按钮不上通栏**——一律放内容区顶部的页内工具行（§4.6）。顶栏内 secondary 按钮与输入框改用 `--color-surface` 底（canvas 上 raised 对比不够） |
| Win/Linux 窗口按钮 | 最小化 / 最大化 / 关闭自绘于右上角，尺寸 **38×28**，风格与导航按钮一致（线性图标、hover 用 `--color-line`，关闭 hover 用 `--color-danger`） |
| 二级标签栏（Sider） | 当前一级模块的分区 / 已打开主机与分组；位于顶栏**下方**、图标栏右侧；默认宽度 **200px**（三端一致）；可拖拽改宽（160–400px），双击分割条复位；顶栏「侧栏开关」只收起这一栏；底色 `--color-canvas`，无右边线；分割条平时不可见，hover / 拖动时才显示 |
| 内容区 | `main` 底色 `--color-surface`，**左上角 6px 圆角**（白色平面嵌在灰框里；整套设计唯一的圆角装饰，侧栏收起时也保持）；内部贴边 `.content-float`；区块不再套卡片 |
| 区块间距 | `--spacing-section` / `--gap-section: 24px`：内容区里区块与区块之间（Tailwind `gap-section` / `space-y-section`） |
| 网格间隙 | `--gap-card: 8px`：网格内同类单元之间（巡检格、概览格、左右分栏）；监控页例外：整页一块固定面板，图表网格 `gap-px` 铺在 `bg-line` 上形成 1px 发丝分隔，单个图表不另描边 |
| Linux frameless | 无系统阴影，窗口外补 **1px `--color-line`** 描边以区分桌面 |

### 4.2 网格与间距原则

- **网格基数：8px**。新间距优先 8 的倍数；允许 **4 / 12** 小档。
- 槽（gutter）默认 **16px**；页面安全边距优先 **24px** 或 8 的倍数。
- 内容区块从「列」起止对齐，避免凭感觉 13px、15px 这类无体系间距。

### 4.3 圆角分层

| Token | 值 | 用途 |
|---|---|---|
| `--radius-panel` | **6px** | 浮层：菜单、对话框、弹出面板；内容区 `main` 左上角；页面提示条（Alert，见 §8.2） |
| `--radius-surface` | **0** | 区块、表格容器、`.surface-float`（扁平化后无圆角） |
| `--radius-control` | **4px** | 按钮、输入框、选择器 |
| `--radius-tag` | **3px** | 小标签、状态胶囊、Meter 外框 |

禁止页面内出现 2px / 5px / 8px / 10px / 12px 等未登记圆角。

### 4.4 表格

- 行高 **40px**、表头 **36px**（替代旧 48 / 40）；虚拟表常量（`ROW_HEIGHT` 等）与 CSS 变量**必须同源**。
- 文字列左对齐，数字列右对齐；数值列用 `--font-mono` 或 `tabular-nums`。
- **表头无底色**：只用 `text-xs text-muted font-normal` + 下方 1px `--color-line`；吸顶表头用 `--color-surface` 遮挡滚动内容。
- 行与行之间 1px `--color-line`；表格外框无描边、无圆角。
- hover 用 `--color-raised`，选中用 `--color-accent-soft`；不加阴影。
- 可交互表格（`InteractiveDataTable`，分组页）：
  - **列宽自适应**：默认按每列内容实测宽度（canvas 测字，跟随用户字体设置）与容器宽度分配；有富余时分给弹性列（主机、Meter 列），不够时先压弹性列、再压可截断文字列到下限，仍放不下才横向滚动。用户手动拖过的列宽固定并本地保存，双击列边界或「恢复默认列」回到自适应。
  - **列宽拖拽标记**：表头每列右缘 8px 热区（`cursor: col-resize`），悬停 / 拖动时显示贯穿表头与全部行的 2px `--color-accent` 竖线（`.table-col-resize-guide`）。
  - **列顺序拖拽**：位移超 4px 开始，松手才换位、Esc 取消；被拖列 `opacity-50`，落点显示与首页分组同款的 3px `--color-accent` 插入线 + `0 0 0 2px --color-accent-soft` 柔光（`.table-col-insert`），贯穿全表。
- 例外：首页主机列表采用**机柜式分组**（见 §9），不套用本节行间分隔线与行高。

### 4.5 滚动条

- 三端统一 **8px 细滚动条**：轨道透明、滑块 `--color-line`、hover 加深至 `--color-muted`；不再整体隐藏。
- 终端 xterm 滚动条例外，沿用 xterm 自身实现。

### 4.6 导航选用

- 模块多、需频繁切换 → 侧栏 / 纵向导航。
- 同一模块内少量互斥视图（约 2–5 项）→ 分段控件或 Tabs。
- 主机功能等多入口 → 顶栏 / 页内 Tabs，保持单行可扫，禁止挤成多行杂乱按钮堆。
- 主机与本机功能标签固定在整窗通栏导航按钮右侧，仅保留一排；按实际可用宽度自动收纳到“更多”，当前工具始终可见，宽度足够时按原顺序展示全部工具（2026-10-17 用户确认方案 A）。2026-10-17 用户复核后确认标签恢复通栏，主机身份信息仅在概览页集中展示，其他工具页不重复占用身份栏高度；**所有页面**（主机页、本机页、测速 / 通知 / 设置等）自己的操作（时间范围、恢复默认、路径提示、双栏文件标题条、筛选 / 搜索簇等）放内容区顶部的页内工具行，左对齐，不上通栏。
- 功能维度全局：侧栏只选主机，通栏标签只选功能；切换主机沿用当前功能，不回跳到该主机上次停留的功能。

### 4.7 资源仪表（Meter / ResourceRing）

负载 / CPU / 内存 / 磁盘 / 网络占比等「资源占比」默认使用共享 `Meter` 组件（`components/ui/`）；远程概览按 §9 使用共享 `ResourceRing`，以连续圆弧表达占比；本机概览恢复独立 `RingMeter compact` 和原有悬浮明细，使用分段 Meter 表达占比，状态色与阈值仍遵循本节：

| 项 | 规定 |
|---|---|
| 结构 | **8 格** LED 分段条 + 右侧数字（`tabular-nums`） |
| 格尺寸 | 每格 **4px** 高（`--meter-cell-h`），间隔 **2px**，圆角 **1px** |
| < 60% | 亮格 `--meter-ok` |
| 60% – 85% | 亮格 `--meter-warn` |
| ≥ 85% | 亮格 `--meter-danger` |
| 未亮格 | `--meter-off` |
| 亮格数 | `round(percent / 100 × 8)`，0% 至少不亮，100% 全亮 |

- ❌ 禁止再用「细线进度条 + 粗体数字」的老写法。
- ❌ 禁止在 Meter 上加渐变、发光、动画（数值变化用 `--duration-base` 颜色过渡即可）。
- 除 Meter / ResourceRing 外，**不再加任何其他装饰性视觉元素**。
- **告警与 Meter 同一套分档，全局固定、不可调**：所有资源告警都折成占比后按上表判定（警告 ≥ 60%、危险 ≥ 85%），统一走 `utils/alerts.ts` 的 `alertReading`。CPU / 内存取使用率；负载取设置的窗口（load1 / 5 / 15）÷ 核数；磁盘取容量大于 10 GB 的分区使用率，容量 ≥ 100 GB 的分区另判可用空间（≤ 20 GB 警告、≤ 10 GB 危险），两者取更差的一档；网络收发按 1 Gbps（125 MB/s）、磁盘读写按 200 MB/s 折算。看板、分组、主机页圆环标红仍只看 `resourceReading` 的危险档。

---

## 5. 动效（Motion）

实现：`globals.css` Motion 区、`lib/motion.ts`。

### 5.1 原则

**理解 · 聚焦 · 反馈** —— 动效服务于理解与反馈，不是装饰。机柜面板是静的，只有灯在变。

添加动效前自查：

1. 解决了什么问题？是否降低理解成本？
2. 能否被明确感知（桌面端时长区间内）？
3. 是否过度编排？删除后静态是否仍能传达必要信息？
4. 运维场景下是否过于吸睛？若是则削弱。

### 5.2 运动模式选型

| 关系 | 模式 | 本仓库用法 |
|---|---|---|
| 有空间指向（Tab 横滑、菜单出现） | **轴运动** | `motion-axis-x/y/z-*` |
| 共享容器形变 | **容器转换** | 慎用；优先简单轴运动 |
| 无强空间关系 | **淡入淡出** | `motion-fade-*`、overlay |

- 入画：ease-out；出画：ease-in；画面内：standard；伴随渐变可用 linear。
- **桌面端固定时值**（强制，保持不变）：

| Token | 时长 | 用途 |
|---|---|---|
| `--duration-base` / `MOTION_MS.base` | **200ms** | 微观、颜色、淡入淡出、Meter 颜色过渡 |
| `--duration-moderate` | **240ms** | Tab、菜单、列表反馈 |
| `--duration-slow` | **280ms** | 抽屉、全局提示、对话框 |
| `TOAST_DISMISS_MS`（`lib/motion.ts`） | **3000ms** | 操作成功提示条的停留时长（非动画时值）；到点后以 `--duration-base` + `--ease-in` 淡出（`.motion-notice-out`） |
| 文字提示（Tooltip） | **0ms** | 悬停 / 键盘聚焦立即出现、移开立即消失，**无打开延迟、无入场 / 出场动画**（刻意不同于浏览器原生 title 的约 1 秒延迟） |
| `.motion-switch-knob` | `--duration-base` | 开关滑块位移（`transform`，`--ease-standard`） |
| `.motion-segment` | `--duration-moderate` | 单选按钮组选中块滑动（`left` / `width`，`--ease-standard`） |

缓动曲线（保持不变）：

- `--ease-standard`: `cubic-bezier(0.38, 0, 0.24, 1)`
- `--ease-out`: `cubic-bezier(0, 0, 0.15, 1)`
- `--ease-in`: `cubic-bezier(0.82, 0, 1, 0.9)`

### 5.3 动效禁令

- ❌ 首屏内容做逐条顺序入场动画（中后台应直接呈现或轻淡入）。
- ❌ Elastic / 弹跳类 UI 动效（非插画）。
- ❌ 忽略 `prefers-reduced-motion`（须降为无动画，已有全局处理须保持）。
- ❌ 随意使用 150ms、300ms、500ms 等未登记时长。
- ❌ Meter 亮格逐格点亮、呼吸灯、闪烁等仿真动画。

---

## 6. 图标（Icon）

- 风格：**线性、简洁、表意精确**；同系列视觉重量一致。
- 尺寸：**16 / 20 / 24**；绘制栅格按 24，交付可缩至 16。
- 描边粗细统一 **1.5**；禁止混用粗细悬殊的图标集。
- 功能图标（按钮、导航、窗控）颜色一律 `currentColor`，随所在文字色继承；状态图标用功能色 + 清晰形状，不靠颜色单独表意。
- **彩色识别图标**：系统发行版图标（彩色圆角底 + 白色图形）、文件 / 文件夹图标（文件夹蓝色实心、文件浅灰页面）、服务名色点允许使用彩色（品牌 / 识别色），见 §9；**不得使用绿色色相**。
- 顶栏导航按钮与 Win/Linux 窗口按钮用同一图标集、同一描边。

---

## 7. 中后台高频任务模式

实现筛选、批量、导入、状态变更、引导时，**先选模式再堆组件**：

| 任务 | 模式要点（择一说清） |
|---|---|
| 筛选查询 | 查询后生效 vs 立即生效；条件过多则折叠 |
| 表格批量 | 所见即所得（主操作常显）vs 选中后浮出操作区 |
| 效果预览 | 异步集中预览 vs 局部同步预览 |
| 新手 / 任务引导 | 阻断（Dialog）vs 非阻断（气泡 / 提示） |
| 数据导入 | 单文件快速 vs 批量确认 |
| 状态流转 | 须看详情再改 vs 列表摘要即可改 |
| 资源占比展示 | 默认 Meter（§4.7）；概览使用连续圆环，列表内用 Meter 单行 |

本产品中：主机列表多选、进程操作、文件上传、配置导入等，均应对号入座，避免「按钮到处都是、反馈却不统一」。

---

## 8. 组件与表面（本仓库落地）

### 8.1 表面层级

0. **一级图标栏** `--color-rail`：通顶的 72px 竖栏，比外框深一档
1. **外框** `--color-canvas`：顶栏 + 二级栏组成的 L 形中性浅灰底
2. **内容平面** `--color-surface`：`main` 整块白底（左上 6px 圆角）；`.surface-float` 与内容平面同色、无描边 / 圆角 / 阴影，仅作为语义容器保留；`.content-float` 仅为可滚动内容区
3. **浮层**（菜单 / 对话框 / 抽屉）：`--color-surface` + 1px `--color-line` 描边，**无阴影**；菜单与对话框圆角 `--radius-panel`（6px），贴边抽屉只画一侧描边；动画走 Motion token
4. **石墨面**（终端 / 代码 / 日志）：独立深色，保留 ANSI / 编辑器主题，**亮色下也不洗成浅底**
5. **看板**：深色专用表面，与石墨面共用中性色阶

### 8.2 控件

- 按钮（填充式）：共享 `Button`；primary = accent 实色 + 白字；secondary = `bg-raised`、hover `bg-line`；ghost = 透明、hover `bg-raised`；danger = danger 实色；全部无描边、无阴影，圆角 `--radius-control`；主操作才用 `primary`。
- 输入框 / 下拉 / 搜索框（填充式，`.motion-field`）：`bg-raised`、边框透明、圆角 4px；focus 时边框 `--color-accent`、底色 `--color-surface`，外加 2px `--color-accent-focus` 外环。
- 下拉选择（`components/ui/select.tsx`，结构与交互照 TDesign Select）：触发器沿用 `.motion-field`，高 32px（`sm` 28 / `lg` 36 与表单输入框对齐），右侧 16px `ChevronDown`（描边 1.5，打开时旋转 180°、`--duration-base`），打开态与 focus 同样式（`.motion-field-active`）；面板走共享浮层 `components/ui/popup.tsx`（portal 到 body、触发器下方 4px、空间不足翻到上方、`bg-surface` + 1px `--color-line` + `--radius-panel`、**无阴影**、入场 `motion-axis-y-in`），最小宽 = 触发器宽，内边距 4px，最高 280px 可滚动；选项行高 32px、`--radius-control`、左右内边距 8px，hover `bg-raised`，选中 `bg-accent-soft` + `text-accent` + 右侧 16px 对勾，禁用项 muted 半透明；键盘上下 / Home / End 移动高亮、Enter / 空格选中、Esc 关闭并回焦。选项多（如主机列表）时开 `filterable`（照 TDesign Select filterable）：打开后触发器原位变输入框，placeholder 显示当前选中项，按 value / 字符串 label / `keywords`（如 HostName、分组名）不区分大小写包含匹配，高亮自动落到第一个匹配项，此时空格是输入、只有 Enter 选中；无结果显示一行 muted「无匹配项」。**禁止再用原生 `<select>`**。
- 日期时间区间（`components/ui/date-range-picker.tsx`，照 TDesign DateRangePicker + enableTimePicker）：触发器一个 `.motion-field`，`font-mono tabular-nums` 显示 `YYYY-MM-DD HH:mm ~ YYYY-MM-DD HH:mm`，右侧 `Calendar` 图标；面板内边距 12px：顶部开始 / 结束两个框（当前编辑侧 `.motion-field-active`），左侧月历（宽 224px，周一起始，6×7 格 32px，标题 `font-semibold`，非本月 muted，今天 1px `--color-accent` 描边，端点 `bg-accent` 白字，区间内 `bg-accent-soft text-accent`，hover `bg-raised`），右侧时 / 分两列（行高 28px，选中 `bg-accent-soft text-accent`）以 1px `--color-line` 竖线分隔；底部 1px 分隔线 + 左「此刻」文字按钮（accent）+ 右 primary 小按钮「确定」；先选开始自动切到结束，两端齐才可确定，结束早于开始自动交换，Esc / 外点不回写。值格式 `YYYY-MM-DDTHH:mm`（本地时间）。**禁止再用原生 `datetime-local`**。
- 多选框（`components/ui/checkbox.tsx`，照 TDesign Checkbox）：16px 方框 `--radius-tag`，未选 1px `--color-line-strong` + `bg-surface`，hover 描边 accent；选中 / 半选 `bg-accent` 白色 ✓ / −；文字 `text-sm` 间距 8px；同组横排间距 24px；键盘聚焦 2px `--color-accent-focus` 外环。订阅矩阵格子传 `className="sub-check"` 铺满单元格（hover `accent-soft`、选中 `accent-tint`）。只用于多选。
- 开关（`components/ui/switch.tsx`，照 TDesign Switch）：36×20 胶囊，开 `bg-accent`、关 `bg-line-strong`，16px 白色圆钮 `.motion-switch-knob` 滑动；`loading` 时圆钮内转圈并禁用；可带右侧文字（间距 8px）。用于「开 / 关」即时生效的设置。
- 单选按钮组（`components/ui/radio-group.tsx`，照 TDesign RadioGroup variant="default-filled"）：轨道 `bg-raised` + `--radius-control` + 2px 内边距，选项高 28px、左右 12px，选中块 `bg-surface` + `--radius-tag` 以 `.motion-segment` 滑动、文字 `text-accent font-semibold`；方向键切换（roving tabindex）。用于 2–5 个互斥选项。
- 滑块（`components/ui/slider.tsx`，照 TDesign Slider）：4px 轨道 `bg-line`、已选段 `bg-accent`，16px 圆钮 2px accent 描边 + `bg-surface`；拖动 / 悬停 / 聚焦时圆钮上方即时显示 Tooltip 数值；方向键 / PageUp / PageDown / Home / End。
- 数字输入（`components/ui/input-number.tsx`，照 TDesign InputNumber）：`.motion-field` 高 32px，左 − 右 + 两个按钮夹中间输入，失焦 / Enter / ↑↓ / 按钮时按 min / max 夹值并提交。
- 文字提示（`components/ui/tooltip.tsx`，照 TDesign Tooltip）：全局一层 `TooltipLayer`（`main.tsx` 挂载）按事件委托识别 `data-tip`；`Tooltip` 组件等价于给子元素加 `data-tip`；截断文字用 `Ellipsis` 或 `data-tip-overflow`，只有真正溢出才提示。气泡 `bg-tooltip text-tooltip-text text-xs`、内边距 4px 8px、`--radius-control`、最宽 320px 可换行、8px 小三角，默认在目标上方居中、空间不足翻到下方；**立即出现、无动画**（§5.2）。纯图标按钮须另写 `aria-label`（`data-tip` 不提供无障碍名）。
- 确认 / 告知对话框（`components/ui/confirm-dialog.tsx`，照 TDesign DialogPlugin.confirm / alert）：`await confirmDialog({ title, body, theme })` 返回布尔，`alertDialog(...)` 只有一个「知道了」；宽 420px，标题前 20px 主题图标（info / warning / danger），danger 时确认按钮用 danger 样式。宿主 `<DialogHost />` 挂在 `App.tsx`。
- **禁止**：原生 `<input type="checkbox|radio|range|number">`（封装组件内部除外）、`window.alert` / `window.confirm`、Wails `Dialogs.Question` 做确认、DOM 元素上的 `title` 属性（改用 `data-tip`；组件自身名为 `title` 的 prop 不在此列）。
- 焦点：可见 `focus-visible`，输入类用 `--color-accent-focus` 外环。
- 表格：行高 40 / 表头 36 与虚拟表常量一致（见 §4.4、§9）；表头无底色；hover 用 raised，不加阴影。
- 区块：内容区不再用卡片；`Card` / `.surface-float` 只是无描边、无圆角的普通区块，区块之间 24px（`gap-section`），区块标题 `text-sm font-semibold text-ink`。
- 数据卡片悬停 / 聚焦：`Card` 及内容区数据块（含监控图表）**不显示悬停 / 聚焦边框**，保持扁平，区块读作一个整体；不加阴影，不另改底色。表格行用已有 hover 底色，不再叠加描边。看板主机选择走总览表行底色，见 §9「看板」。
- 网格色块单元：同类单元平铺成网格（巡检项、Docker 容器等）用 `bg-raised p-4` 纯色块区分，块间距 `gap-card`，无描边 / 阴影；可点整块时 hover `bg-line`；块内 secondary 按钮与 neutral 标签改 `bg-surface`（hover `bg-line`），否则与色块同色。**不要在 `Card` 上写 `bg-*`**：`.surface-float` 不在 Tailwind 层内，会盖掉 `bg-*` 工具类，色块单元用普通 `div`。
- 环图（`RingMeter`）直接落在内容平面上，不再垫 raised 色块（环图所在区块本身就是平面，再垫一层即卡片套卡片）。
- 二级栏选中：`bg-accent-soft text-accent` **纯色块，无左侧指示条**；二级栏 hover 用 `bg-line`（canvas 上 raised 对比不够）；行高 40px，左右内缩 8px。
- 一级图标栏（`components/module-rail.tsx`，`.module-rail-item`）：每项 **56×52** 方块（`--radius-control`），20px lucide 线性图标（描边 1.5）+ 下方 4px + 12px 文字，项间距 4px；第一项顶边紧贴顶栏下沿（y = 40px），与二级栏第一行、内容区白色平面的顶边在同一条线上，栏底留 8px；顶部依次为主机 / 本机 / 通知 / 测速，底部依次为巡检 / 配置 / 设置；图标：主机 `Server`、本机 `Laptop`、巡检 `ScanSearch`、通知 `Bell`、测速 `Gauge`、配置 `FileCog`、设置 `Settings`。静止 `text-muted` 无底；hover `bg-line` + `text-ink`；选中底色 `--color-canvas`（与二级栏同色，读作向右打开到二级栏）+ 图标与文字 `--color-accent`、文字 600，无指示条；通知未读数是图标右上角的 accent 小 Tag（等宽数字，>99 显示 99+），配置待处理是图标右上角 6px `--color-danger` 圆点；键盘焦点 2px `--color-accent-focus` 外环。图标与名称始终同时显示，不提供隐藏名称的开关，图标栏无右键菜单。
- 二级栏结构：只列当前一级模块的标签，不再有模块区与横线；第一行顶边紧贴顶栏下沿，不留上内边距；主机模块顶部固定一行「全部主机」（回首页，首页时为选中态），其下 8px 留白再列已打开的主机与分组（可拖拽排序、右键菜单）。从全部主机打开主机时，侧栏只加入这台主机，不自动打开所属分组；分组要单独打开才出现在侧栏，其下仍列出该组里已打开的主机。巡检即使只有一项也照常显示二级栏，避免切模块时版面跳动；整栏独立滚动。图标栏与二级栏各自有一处选中色块，属正常。
- 页面提示条（`Notice` / `FlashNotices` + `useFlashMessage`），视觉按 TDesign Alert：
  - 四种 theme：success（`--color-success` / `success-soft`，绿，同 TDesign）、info（`info` / `info-soft`）、warning（`warn` / `warn-soft`，组件里旧名 `warn` 等价）、error（`danger` / `danger-soft`）。
  - 结构：左侧 16px 实心圆状态图标（圆面 = 主题色，符号用 `--color-surface`；success ✓、info i、warning / error !）+ 8px 间距 + 正文（`text-sm`、行高 24px、`--color-ink`，不用主题色）+ 右侧可选关闭 ×（16px、描边 1.5，`--color-muted`，hover / 聚焦变 `--color-ink`，`aria-label="关闭提示"`，可键盘聚焦）。
  - 尺寸：内边距 8px 16px，最小高 40px，圆角 `--radius-panel`（对应 TDesign medium），底色 = 主题 `*-soft`，无边框、无阴影；长文字换行，图标与关闭按钮对齐首行。
  - 位置：`Notice` 单独使用时（常驻状态说明、表单内报错）在内容区按文档流占位；`FlashNotices`（操作结果提示）一律浮层、不占位，见 §9「操作提示条浮层」行。淡出结束后元素移除。
  - 操作成功（已保存 / 已复制 / 已置顶…）：success，停留 `TOAST_DISMISS_MS`（3 秒）后淡出；鼠标悬停暂停计时、移开重新计时；连续触发重新计时；可点 × 立即关闭。
  - 需要用户处理的事项（如「预览存在冲突，请逐项处理」）：warning，常驻至手动关闭或被下一条提示替换。
  - 操作失败：error，常驻至手动关闭或被下一条提示替换，不自动消失。
  - 成功 / 待处理 / 错误三者互斥，同一时刻最多一条。
  - 常驻状态说明（如「未检测到 nginx」「远程缺少 openssl」）用 warning、不带关闭按钮；warning 不得用于操作成功或失败。
- 标签 / 状态胶囊：`--radius-tag`，底色用 `*-soft`，文字用对应功能色。
- 状态灯（`components/notify/incident-detail.tsx` `StatusLed`）：8px 方块、`--radius-tag`，实色 `danger`（进行中）/ `warn`（警告档进行中、到期提醒）/ `success`（已回落）/ `line-strong`（未记录回落）；旁边**必须**配状态文字，不单靠颜色表意。时间线节点同款：「进入警告档」`warn`、「进入危险档」「升到危险档」`danger`，升级节点插在首发与回落之间；「等待回落」用 1px `line-strong` 空心。
- 告警档位标签：消息列表主机名后、详情状态标签后各放一枚 `Tag`，警告 `warn`、危险 `danger`，取事件到过的最高档；旧记录无档位不显示。
- 档位订阅（通知设置「通知什么」CPU / 内存 / 磁盘 / 负载每行，`ResourceRuleRow`）：规则说明在左，右侧两个 `Checkbox`「警告 ≥ 60%」「危险 ≥ 85%」，可同时勾选；至少保留一档（仅剩一档时禁用并用 `data-tip` 说明），整类不要用左侧类型勾选；该类型未勾选时两个复选框都禁用。两档都订时，预览矩阵对应类型多出一行「升级」。
- 告警全局控件组（「通知什么」类型列表下方，1px `line` 分隔线 + 16px 间距，与上方同一套 `120px_1fr` grid）：「连续」`InputNumber`（1–12 次采样）、「重复提醒」`InputNumber`（0–1440 分钟，0 为关闭）、「负载取」`RadioGroup`（1 / 5 / 15 分钟），控件右侧 `text-xs text-muted` 写含义。不开放阈值输入。
- 时间线重复提醒节点：颜色按该条档位（`warn` / `danger`），只列最近 3 次，更早的合并成一行「另提醒 N 次」（空心 `line-strong` 节点）。
- 消息页（通知 → 指标消息 / 应用消息）：一次「告警 + 回落」按 `incidentId` 合并为一条事件；`Page flush` 左右分栏，左列表宽 360px、右边 1px `--color-line` 分隔，按日期分组（组标题 32px 吸顶、`text-xs text-muted`），每条两行（主机 + 类型 + 时间 / 峰值 + 持续时长），未读主机名 600 字重 + 6px accent 方点，选中 `accent-soft`，上下方向键切换；右侧详情内边距 24px、区块间 `gap-section`，唯一的大数字是峰值（`text-2xl` 等宽 600，危险档 `text-danger`）配 `Meter`。筛选收拢为顶栏 `Select` + `RadioGroup` + `Switch`，不再堆按钮组。
- 网络测速（测速 → 两机测速 / 分组测速 / 历史记录，`components/speedtest/`）：路径卡片左右两块（局域网 / 广域网），可用 `bg-raised` + 6px `--color-success` 状态灯 + 「可连通 · RTT」，选中 `accent-soft` 底 + accent 标题，不可用 `opacity-60` + `line-strong` 灯 + 原因文字，只有可用卡可点；卡下列出 A、B 两端网段 Tag（公网 warn、虚拟内网 info），读到网卡协商速率时在 Tag 内追加「 · 2.5G」；局域网候选行在 RTT 前用 muted 等宽数字写「上限 1G」（两端协商速率较小者），选中该路径时 UDP 目标带宽自动填为此上限，并在字段旁用 muted 小字说明来源。测速完成后在指标条上方放「结论」块（`bg-raised` + `--radius-panel` + 16px 内边距，无描边无阴影）：20px semibold 等级字（很快 `success-text` / 正常 `info` / 偏慢 `warn` / 很差 `danger`）+ 14px 一句换算（每秒多少 MB/GB、10 GB 文件几秒传完），下列逐条大白话解释，每条前 6px 同语义色圆点；分组星型表加「评价」列（同色 Tag），矩阵格在吞吐下方用 12px 同色字写等级。「开始测速 / 停止」放在各自操作行末尾（两机：端点行「重新识别」后；分组：分组与方式行末），不放页头。实时曲线 A→B（A 发送）用 `--color-io-write`、B→A 用 `--color-io-read`，与监控「发送 / 接收」同义，单位按峰值在 Kbps / Mbps / Gbps 间切换，「分流」开关叠加同色 35% 不透明细线；指标条全部等宽数字。矩阵热力格只用三档已有 token：`bg-raised` / `bg-accent-tint` / `bg-accent-soft` + accent 字，不引入新色。
- 通知预览矩阵（通知设置「正文带上」正下方，`components/notify/channel-preview.tsx`）：**全部展开、不做下拉 / 切换**——行 = 消息类型（CPU / 内存 / 磁盘 / 负载 / 应用探活）× 告警 / 升级（警告、危险两档都订时）/ 重复（开了重复提醒时）/ 恢复，列 = 系统通知 / 应用内 / 企业微信，列头 32px 吸顶。每格一张预览卡，模拟对应渠道的消息外观：`bg-raised` + `--radius-panel` + 12px 内边距，无描边无阴影（模拟的是浮出的通知，故用浮层圆角）；渠道关闭整列 `opacity-50`、列头标「未开启，不会发送」；类型或「恢复」未勾选整行 `opacity-50`，行头用 `text-warn` 写原因。企业微信卡渲染后端 `PreviewHostAlertMarkdown` 原文：`<font color>` 映射 red→`danger`、warning→`warn`、info→`success-text`、comment→`muted`，引用行左侧 2px `line-strong` 竖线。
- Meter / ResourceRing：见 §4.7，用于表达实际资源占比。
- 窗口壳层：顶栏、侧栏、Win/Linux 窗口按钮全部走共享组件，平台判断只从 `lib/platform.ts` 引入。

### 8.3 技术栈约束

- React + Tailwind 4 + 共享 UI；颜色进 `@theme` / CSS 变量，不进业务魔法数。
- 不打包字体文件、不写 `@font-face`，字体只走系统字体栈与用户设置（§3.1）；禁止运行时从网络加载字体。
- Tailwind 预检**不得破坏** `.xterm`、CodeMirror 光标与选区。
- 不改公开 API / 后端数据结构来「迁就样式」。

---

## 9. 已确认的本仓库特例（允许偏离通用原则处）

以下为产品已拍板的特例；**改特例须先更新本节，再改代码**。

| 特例 | 现行值 | 说明 |
|---|---|---|
| 表面圆角 | `--radius-surface: 0` | 扁平化：区块 / 表格容器无圆角 |
| 浮层圆角 | `--radius-panel: 6px` | 菜单 / 对话框仍需轻微圆角与内容平面区分 |
| 内容区左上圆角 | `main` `border-top-left-radius: var(--radius-panel)` | 整套设计唯一的圆角装饰；侧栏收起时也保持 |
| 壳层 chrome | 三段式：72px 一级图标栏通顶；顶栏 + 二级栏使用 canvas 色调；内容区始终为实色 `--color-surface`；三者无分隔线 | 窗口材质可选自动 / 经典 / 云母，与浅色 / 深色 / 跟随系统独立。自动默认按实际能力选择：Windows 11 22H2（build 22621）及以上优先原生 Mica，其他平台回退经典。Mica 是由 DWM 绘制的不透明壁纸着色基础层，激活 / 非激活外观由系统管理；壳层清除 WebView 覆盖以露出 Mica，内容区始终实色。云母下壳层内（一级图标栏 / 二级栏 / 设置菜单）的选中与悬停底色改为半透明覆盖（accent veil / line veil），直接融入底下的材质，经典模式保持实底设计。Windows 关闭透明效果 / 高对比度 / 节电模式时回退经典，条件恢复后重新应用保存偏好。Mac / Linux 手动选 Mica 时保留偏好并说明回退原因。Mac 红绿灯与 Win/Linux 应用图标共用图标栏顶部 40px |
| 顶栏内控件 | secondary 按钮与 `.motion-field` 在顶栏里改用 `--color-surface` 底 | canvas 与 raised 太接近，按钮会“消失” |
| 控件圆角 | `--radius-control: 4px` | 按钮、输入等 |
| 区块间距 | `--spacing-section` / `--gap-section: 24px` | 取代卡片描边做分段 |
| 远程概览 | 负载、CPU、内存、磁盘按固定顺序横向并排，以连续圆环表达占比；窄内容区为 2×2。状态色沿用 Meter 三档，告警不交换指标位置；单分区达到危险档时以该分区替代磁盘汇总，并标挂载点。主机身份、SSH 地址、Agent 状态与操作、采样信息集中到顶部；下方近期趋势与完整系统信息左右排列，再展示内外网地址。趋势为最近 30 分钟；无历史不造样本，采集失败保留缓存读数但圆环不显示有效占比。内容沿用页面 16px 安全边距，铺满可用宽度，与全部主机对齐；四个资源指标分别使用与首页主机卡一致的 raised 色块、control 圆角、12px 内边距及 12px 卡间距，最小高 160px；96px 圆环只放主读数，指标标签和容量明细位于环下。趋势、系统信息和连接区沿用同款色块，16px 内边距；主机身份区直接位于内容平面，区块之间 24px 留白。卡片不加描边、阴影或彩色侧边线，圆环之间不画竖向分隔线。图表轴线、网格与浮层描边仍为 0.5px。系统信息列宽 280–360px，内外网地址与下方两列对齐；窄窗口自适应。系统信息始终展开。页面字阶为 12 / 14 / 20 / 24px，20px 用于主机标题、24px 用于仪表主读数，不使用中点分隔文案；避免解释性说明和重复数据，错误 / 空态只保留必要状态。不添加装饰性眉题 / Overline；移除“资源状态”“系统信息”泛化标题，分组保留可访问名称；资源区保留带圆点的运行状态，正常时显示“运行正常”。趋势时间范围、告警和必要数据标签保留；连接区不添加重复标题。四项资源复用原有 TooltipLayer，悬停或键盘聚焦显示 CPU 型号 / 核心数 / 使用率、负载 1 / 5 / 15 分钟、内存容量 / 已用 / 可用 / Swap、磁盘范围与容量；危险磁盘明细对应圆环中的告警分区，过期数据明确标注“上次读数”，首次无数据不伪造明细。标题同基线，数据使用等宽数字；分段选择器内圆角为外圆角减 2px 内距，保持同心 | 2026-10-25 用户要求全部主机和单机概览的 UI 风格匹配，远程概览以现有首页浅灰监控卡为基准统一；保留连续圆环、运行状态和核心数明细，不画圆环之间的竖线；保留此前顶部连接及采样信息、紧凑列宽 / 间距、精简文案、图表 0.5px 描边、最多四档字号与光学对齐。趋势指标选择留在趋势区，完整监控通过已有顶部标签进入；Agent 安装 / 更新进度仍使用 8 格 Meter |
| 本机概览 | 恢复本轮改版前的独立实现，不与远程概览统一布局。资源为 `RingMeter compact` 数值与分段 Meter，保留鼠标悬停及键盘聚焦明细：负载 1 / 5 / 15 分钟；CPU 型号、核心拓扑、使用率与性能核 / 能效核使用率；内存总量、已用、可用、Swap；磁盘汇总范围与容量。系统明细、物理磁盘、分区表、查看占用入口、内外网 IP、默认网关、主网卡及完整网卡表全部保留，虚拟网卡沿用折叠交互。恢复本机样式时保留 0.5px 边框、不使用中点分隔文案、不加资源竖线 | 2026-10-24 用户明确要求恢复原版，不能通过统一布局删减本机数据或悬浮交互；本次清理重复概览标题、资源及系统明细标题、表格上方“分区”“网卡”小标签，保留相应可访问名称；CPU 型号和 Swap 保留于系统数据与悬浮明细，不在摘要里重复显示 |
| 数据卡片悬停边框 | `Card` 与内容区数据块无悬停边框 | 内容区区块扁平读作整体，悬停描边只会打碎版面。看板主机选择走总览表行底色，见「看板」行 |
| 网格间隙 | `--gap-card: 8px` | 网格内同类单元之间；回归 8 点网格 |
| 允许的“阴影” | 输入类 focus 外环（2px `--color-accent-focus`）；Linux frameless 1px 外描边（outline）；拖拽插入线柔光环（`0 0 0 2px --color-accent-soft`：首页分组拖拽，见「首页主机列表」行；表格列顺序拖拽，见 §4.4） | 这三处表达焦点 / 窗口边界 / 拖拽落点，不表达层级；Tailwind `--shadow-*` / `--inset-shadow-*` / `--drop-shadow-*` 命名空间已清空 |
| 顶栏高度 | 40px | 对齐桌面窗口控件带；从图标栏右缘贯通到窗口右缘，二级栏在其下 |
| 图标栏宽度 | 固定 72px，不可拖 | 等于原左上角红绿灯预留宽度，导航钮 x 坐标三端不变 |
| 二级栏宽度 | 默认 200px（三端一致）；可拖 160–400px；双击分割条复位 | Firefox 式分割条 |
| 表行 / 表头 | 40px / 36px | 运维密度；虚拟表常量与 CSS 必须同源 |
| 首页主机列表 | 页内工具行（左对齐）：搜索框（`.motion-field` 容器，宽 `min(20rem,40vw)`，左放大镜图标，空时右侧 `kbd` 显示 `⌘F` / `Ctrl+F`，有值时换成清空按钮）→ 紧跟 secondary「＋ 新建 ▾」按钮（菜单从按钮左下展开：添加主机 / 新建分组）→ 右端 `text-xs text-muted` 概况（台数 · 分组数，筛选时为匹配数）；工具行下内边距 12px，内容滚动后底部显示 1px `--color-line` 分隔线，未滚动时透明。机柜式分组：每组一个 `.host-rack-block`（透明底，无内边距、无边框无阴影）；分排布局：首页由若干「排」纵向堆叠，排间距为本页局部 `--gap-section: 24px`；每排（`.host-rack-lane`）使用横向网格，按内容区实测宽度、`--host-rack-card-min: 240px` 与本页局部 24px 分组间距计算列数，宽屏最多六列，剩余宽度均分；分组占可见主机数对应的列数、上限为整排列数，组内主机按从左到右、从上到下排列，超出列数在组内换行；空分组和折叠分组占一列，筛选后按匹配数量占列；分组严格按已有顺序自然换行，不密集回填空洞，绝不横向滚动；每排放哪些分组由用户拖拽决定，存为 UI 偏好 `hostHomeRacks: { id, name, groups }[]`（旧 `hostHomeRows` 自动迁移，并保留二维投影兼容排序）（`ipannel.settings.v1`，与其它设置同路径，仅存本机）；设置页「恢复默认」保留该布局不清空（分组折叠状态独立存于 `1pannel-host-group-collapsed`，本就不受影响）；对账：丢弃不存在的 id，未在布局中的分组按 `order` 追加到最后一排末尾，未命名普通空机柜移除，固定置顶机柜及已命名机柜保留身份，首次无布局时全部分组按 `order` 放一排；分组改名换 id 时布局同步替换；每次拖完保存布局并按「从上到下、从左到右」展开调用 `ReorderGroups` 同步 `order`；每次加载分组（`session.refresh`）时若后端 `order` 与布局展开不一致也会写回，保证全站分组列表（测速、新建主机、通知订阅等）与首页同序；跨分组的主机列表统一取 `session.orderedHosts`（分组顺序 → 组内顺序 → 未分组），不按 SSH Config 原序或字母排序；每个机柜上方显示小号 muted 名称，铅笔图标默认透明占位，仅名称按钮悬停或键盘聚焦时显示，点击打开共享 Dialog 编辑，支持中文、最多 80 字符、留空恢复默认名；名称跟随稳定机柜 id 持久化，恢复默认设置保留布局和名称。「置顶」固定归属 `rack-pinned` 机柜（有置顶主机才显示；同机柜照常放其他分组；拖走最后一个普通分组后仍保留此机柜，下方机柜不得自动并入；筛选不改变归属），「未分组」单独占最下一排（有主机或拖主机中才显示），二者不可拖、不是分组拖拽落点（分组插不到置顶之前），用户自建空分组照常显示；组标题行 36px：折叠箭头 + 组名（semibold）+ 台数（muted），整行为分组拖拽把手（`cursor: grab`，位移超 4px 才开始拖动，折叠箭头点击仍为折叠）；不另设把手图标 / 右键移位等冗余入口，拖拽 + 落点预览即全部交互；分组拖拽：被拖块 `opacity-50`；落点先定排（按排容器 rect，排下方空白到下一排之前都算该排），排内先按块顶部分子行再按指针 x 与块中线求插入点，排内末块右侧空白 = 插到该排末尾，3px `--color-accent` 竖向插入线（外加 `0 0 0 2px --color-accent-soft` 柔光环；§10.4 阴影禁令特例——落点指示与 focus 外环同性质，不表达层级）画在目标块左侧（或末块右侧）间距中线、高度同该块；指针位于两排之间的间隙时显示横向 3px `--color-accent` 线 + 同款柔光（排间距中线），松手在此插入新排；固定置顶机柜为最高层，其上方不出横线，指针在此按机柜内落点处理；空的置顶机柜在拖拽时显示接收区；拖拽中最后一个普通排下方出现「拖到这里新建一排」落区（高 56px、宽同内容区、`--radius-panel`、1px 虚线 `--color-line-strong` 边框、`--color-muted` 文字居中，指针进入变 `--color-accent-soft` 底 + `--color-accent` 边框 / 文字），松手在最后新增一排；未命名普通机柜拖空后自动消失，命名机柜保留空落区；只有置顶块的机柜仍可接收普通分组；分组 / 主机拖拽贴近主内容区上下边缘 48px 时纵向自动滚动；置顶 / 未分组不可拖、不可越过，筛选生效时禁用分组拖拽；组内每台主机为独立监控卡，最小高 160px、组内卡间距 12px、内边距 12px、`--radius-control` 圆角、`--color-raised` 色块，无描边和阴影；精细指针悬停时卡片保持原位，非选中卡使用 line 中性灰底，主机名保留 ink 正文色；只有选中卡使用 accent-soft 蓝底和 accent 主机名。选中卡悬停时继续保留选中样式，通过中性灰 / 蓝色两种视觉语义区分悬停与选择。底色及主机名颜色采用 base 200ms / standard 过渡，不加阴影、描边、缩放或弹跳；沿用原裁剪容器和排序 transform，减少动态效果时取消过渡及按钮位移。顶部为 22px 系统图标、14px 半粗主机名（溢出 Tooltip）与编辑按钮；第二行为连接状态与 Agent 状态/版本，不显示 SSH 地址；下方固定 CPU / 内存 / 磁盘三个 52px 圆环，数值 16px、标签 12px，复用 60% / 85% 阈值与危险磁盘分区规则；采集失败、无采样或过期读数显示 —，不画有效圆弧；磁盘单独失败不影响 CPU/内存；页内工具行按唯一主机显示正常 / 需关注 / 待确认数量，分组标题显示异常数量，折叠后仍可见；置顶与原分组共享快照，最多并发采集 5 台，概览约 5 秒、健康与磁盘约 30 秒，页面离开或窗口隐藏时暂停，恢复后刷新过期数据；首页专用只读快照不得自动拉起或安装远端 Agent；组内主机拖拽按目标卡左右半区判断前后，使用竖向插入线，跨换行仍按阅读顺序排序；选中卡使用 accent-soft 底与 accent 主机名，键盘焦点 2px accent 内描边；编辑按钮仅悬停或卡片内聚焦时显示，始终占位，从右侧 4px 以 base 200ms / standard 滑入并淡入；移出时反向退出，完成后隐藏，键盘访问不受影响，Tooltip 保持即时显示；拖拽投放目标块改 `--color-accent-soft` 底 + 2px `--color-accent` 内描边 | 保留机柜导航与拖拽，同时通过主机卡直接扫读状态；不套用 §4.4 表格行间线 |
| 操作提示条浮层 | 所有页面的 `FlashNotices` 不按文档流占位：portal 到 `body`，`fixed` 浮在顶栏下方 16px、按整个窗口水平居中（与对话框同轴），宽随内容、最大 560px；层级 `z-[100]`，压过对话框遮罩（`z-50`）与右键菜单（`z-[61]`），仅低于 tooltip；外层 `pointer-events: none`，只有提示条本身可悬停 / 点关闭，且点它不会被对话框当作外部点击而关闭；视觉仍按 §8.2（`*-soft` 实底、无边框、无阴影），停留 / 淡出规则不变 | 占位会把页面内容顶下去再弹回；对话框打开期间操作失败（如安装 Agent）时，提示若在遮罩下就看不清 |
| 终端 / 代码 / 日志 | 独立深色石墨面 | 不随亮色主题变浅 |
| 看板 | 深色专用表面；根据可用宽高和主机数，优先完整展示带曲线的主机网格，空间不足时回退总览表 / 多列机柜 | 用户于 2026-10-16 要求少量主机直接显示曲线，更新 2026-10-15 的总览策略。曲线面板最小宽 400px / 高 288px，按屏幕放大 1–1.5 倍；优先列数为 1 台 1 列、2 台 2 列、3 台 3 列、4 台 2 列、5–6 台 3 列、7 台起 4 列，不足时尝试其他列数。面板使用完整可用高度，较高且较窄时 CPU / 内存两图上下排列。16 台在 4K 下可用 4×4；1080p 放不下曲线时回退紧凑总览。回退沿用表头 44px、行高 84px、网格最小宽 350px / 高 172px 与最大 +25% 留白分配，仍放不下时仅纵向滚动，不压小字号。曲线仅在可见或弹窗打开时加载与每 30 秒更新，复用同主机历史，不伪造样本；主机名和趋势按钮仍可放大查看，关闭后恢复焦点。应用最多两行，异常优先，折叠入口显示隐藏异常 / 待确认数，展开查看完整列表；已知离线显示红色 0，未知显示 —。应用紧凑行间 4px、卡片内边距 12px 是此密度场景特例。复用 Meter、Button、Dialog、ECharts 与已有深色 token，无卡片套卡片。 |
| 进程等超高密虚拟表 | 可低于 40px | 仅限已论证的数据密度场景，并在代码旁注释 |
| 编辑器主题色 | CodeMirror 行号 / 当前行、Monokai 语法高亮允许硬编码 | 代码面板是独立石墨面，语法配色需与 Monokai 原色一致，不走全局 token |
| 彩色识别图标 | 系统发行版图标（`distro-badge.tsx`，`#F4511E` 底 + 白色图形，圆角 `side × 0.26`）；SFTP 文件夹 `#4C8DFF` 实心、文件 `#F7F8FA` / `#C5CDD6` / `#E4E9EE`；服务名色点（`host-apps.tsx` `serviceNameColors`，hsl 色相跳过 70–170）；本机软件列表的应用图标（`local/packages-page.tsx`，20px，名称前 8px，取系统原图，取不到时用 lucide `AppWindow` 描边 1.5 `--color-muted` 兜底） | 属品牌 / 识别色，允许硬编码、允许彩色、发行版徽标与色点圆角不受 §4.3 四档限制；**不得使用绿色色相**（系统应用原图不受此限） |
| 胶囊 / 圆形控件 | Switch 轨道与圆钮、Slider 圆钮用 `rounded-full` | 形态即语义（TDesign 同款），不受 §4.3 四档限制；其余控件仍走四档 |
| 文字提示无动效 | Tooltip 0ms 出现 / 消失、无入场动画 | 用户明确要求「秒弹出」；例外于 §5 浮层入场动效 |
| 浮层遮罩 | 一律用 `bg-scrim`（`--color-scrim`，Smoke 烟雾） | Smoke 是透明类材质，压暗下层表面以强调重要 UI（模态对话框 / 抽屉遮罩），不区分明暗模式、始终半透明黑；禁止 `bg-black/xx` 等透明度修饰符（会生成 `color-mix`，Linux 旧版 WebKitGTK 不支持） |

---

### 9.1 首页拖拽反馈

- 主机 / 分组超过拖动阈值后，鼠标旁只显示当前主机名 / 分组名的一行半透明预览。宽度随名称、最大 `--host-rack-column`，40px 行高、左右 12px、control 圆角、accent-soft 底和 ink 字，整体 75% 不透明度；无图标、描边、阴影、操作提示、台数或快捷键文案。不参与落点命中，靠近窗口边缘自动换到指针另一侧。
- 预览随指针逐帧移动，不做入场缩放或滞后的跟随缓动；有效落点继续由原列表高亮 / 插入线表达。被拖源项保持占位、透明度降至 45%。现有多选语义不变，一次拖动实际按下的主机。
- 分组开合与落地后的列表换位使用 moderate 240ms、standard 缓动；落点颜色使用 base 200ms。遵循 `prefers-reduced-motion`，关闭非必要动画后仍保留预览、源项与落点反馈。
- 松手前不修改分组 / 排序；Esc、指针取消、失焦或页面卸载均清理拖拽。点击与双击、多选、编辑和右键菜单保持原行为。

## 10. 验收标准（Definition of Done）

下列清单在 **UI 相关 PR / 改动交付前** 必须全部勾选或明示豁免（豁免须写入 §9）。

### 10.1 Token 与色彩

- [ ] 无新增未登记硬编码色；新色已写入 `globals.css` token 并在亮 / 暗双份定义
- [ ] 页面内彩色只出现在§2.6 登记色系 / 状态色 / Meter / §9 登记的彩色图标；其余为中性色
- [ ] 绿色只出现在成功状态与健康档占用 `--meter-ok`（代码编辑器语法高亮除外）；成功文字用 `success-text`
- [ ] 正文对比度 ≥ 4.5:1（WCAG 2.1 AA）
- [ ] 关键可见位置无 `color-mix()`（Linux 旧版 WebKitGTK 兼容）
- [ ] 暗色下无高饱和大面积色块；层级与亮色一致

### 10.2 字体与布局

- [ ] 默认使用系统字体栈（`--font-sans` / `--font-mono`），页面内无写死的字体名；设置页「字体」按当前系统给出选项，界面字体与等宽字体可分别切换，「自定义…」通过本机字体列表选择
- [ ] 桌面字号 ≥ 12px；正文默认 14px 体系；字重仅 400 / 600
- [ ] 数值列使用 `--font-mono` 或 `tabular-nums`，右对齐
- [ ] 间距服从 8 点网格（或 §9 已列特例）；圆角只用 §4.3 四档
- [ ] 顶栏 40px、一级图标栏 72px 通顶、二级栏默认 200px、表行 40 / 表头 36 未被破坏（除非改 §9）
- [ ] 三端同一页面截图对照：侧栏宽度、行高、颜色、间距一致；字形按系统不同属预期，另一差异为窗口按钮位置

### 10.3 动效

- [ ] 时长仅使用 200 / 240 / 280ms（或动态时值有据）
- [ ] 缓动使用 standard / in / out token
- [ ] 有 `prefers-reduced-motion` 安全网
- [ ] 通过 §5.1 自查：非纯装饰、非过度编排

### 10.4 组件与任务模式

- [ ] 复用共享 Button / surface / table / dialog / Meter / motion 类，无分叉私货皮肤
- [ ] 无任何 `box-shadow` / `shadow-*` / `ring-*` 生效（§9 列出的 focus 外环、Linux 外描边、首页分组 / 表格列拖拽插入线柔光环除外）
- [ ] 内容区不嵌套描边卡片（无 `border border-line rounded-*` 包区块）；区块间距用 `gap-section`
- [ ] 表头无底色（不再 `bg-raised`），只有下方 1px line
- [ ] 无装饰性渐变；用到的渐变都在表达信息（§2.5）
- [ ] 资源占比使用 Meter 或概览专用 ResourceRing 组件，无残留细线进度条
- [ ] 平台判断只从 `frontend/src/react/lib/platform.ts` 引入，无散落的 `navigator.platform` / UA 判断
- [ ] 筛选 / 批量 / 导入 / 引导等符合 §7 某一种明确模式
- [ ] 终端、代码、图表未回归错误浅色或错误色语义（读亮蓝写橙）
- [ ] CPU / 负载 / 内存曲线按 §2.4 三档分段着色，阈值来自 `usage-tone.ts`；流量 / IO 曲线未被分段

### 10.5 回归

- [ ] 亮色 + 暗色各扫一眼关键路径
- [ ] 窄窗 / 侧栏收起下顶栏与内容仍可用
- [ ] Linux frameless 窗口有 1px 外描边；滚动条三端一致
- [ ] 未破坏 xterm / CodeMirror / 看板可读性

---

## 11. 改动流程（强制）

1. **读**：先读本文件相关章节 + 现行 token。
2. **选**：能用 token / 共享组件则直接用；否则先扩 token 与本文，再改页面。
3. **做**：最小 diff；禁止顺手整文件格式化，禁止回退到 M3 紫题，禁止在成功状态与健康档占用以外引入绿色。
4. **验**：按 §10 勾选，三端各截一张对照图。
5. **记**：若引入长期特例，更新 §9；若修正规范，更新本文件并保持与 `globals.css` 同步。

上游依据：

- 本规范自成一体，不再以任何第三方设计体系为准。
- 可访问性：WCAG 2.1 AA <https://www.w3.org/TR/WCAG21/>


## 12. 2026-10-18 已确认的原型落地边界

- 保留 72px 一级栏、40px 原生窗口通栏与现有主题/字体/材质；原型的信息层级与布局映射到现有 token，不复制模拟数据或业务逻辑。
- 主机、本机工具共用通栏，以各标签实际宽度计算“更多”；活动项始终可见。本机不再在二级栏重复列出工具，其他工作区保留既有分区。
- 原生窗口最小 900×700。窗口宽度 ≤1050 时二级导航为可关闭浮层，尺寸变化不覆盖用户保存的开关与宽度；浮层与工具菜单互斥，关闭浮层保留选择与排序。
- 远程工具继续沿用 §4.6 的全局选择语义，文件路径与导航历史仍按主机隔离；不因视觉调整改变业务操作。
- 文件页默认当前远程设备单栏，展开传输时显示已有本机对端；保留上传/下载、拖放、冲突处理、预览与删除确认，不新增远程间传输。
- 配置五分区与原有配置快照/迁移保留；业务数据备份、恢复点、统一任务中心、本机监控历史/导出与巡检历史等原型新增能力不实施。正式已有能力（含网络历史）不删减。
- 内容区保留完整数据及操作入口，优先去掉重复标题与摘要。表格、编辑器内部滚动，不允许通过隐藏功能换取窄窗适配。
- 设备表头保持单行，宽表通过表内滚动查看。本机与远程 Hosts 只展示固定 Hosts 文件的内容与路径，不为该单文件重复占用列表栏；文件大小等原有信息保留在路径旁。Nginx、软件源继续保留多文件列表。
