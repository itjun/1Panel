# 通知中心：独立侧栏页面验收

final result: passed

## 交付范围

- 主机系统：消息记录 / 主机订阅 / 告警规则。
- 应用服务：消息记录 / 应用订阅 / 告警规则。
- 证书提醒：消息记录 / 提醒规则。
- 发送渠道保持全局共用。订阅与规则使用独立页面，没有标签页，也没有左右并排的订阅与规则编辑区。
- 已更新并启动 `/Applications/1Panel.app`，构建来源为当前工作区。

## 视觉目标与证据

- 选定方案的规则图：[reference-rules.png](reference-rules.png)。原始视觉目录：`/Users/itjun/.codex/visualizations/2026/10/18/01a14f84-5da2-7e40-bef6-94681bf4ae98/notification-design-v1/assets/`。
- 主要原生证据：[主机订阅](native-host-subscriptions-final.png)、[主机规则](native-host-rules.png)、[应用订阅](native-app-subscriptions.png)、[应用规则](native-app-rules.png)、[应用订阅定位](native-app-focus.png)、[消息](native-messages.png)、[发送渠道](native-channels.png)、[证书规则](native-cert-rules.png)。
- 完整并排比较：[规则最终比较](comparison-final.png)、[订阅最终比较](comparison-subscriptions-final.png)、[消息比较](comparison-messages.png)、[渠道比较](comparison-channels.png)。
- 局部比较：[侧栏与规则细节](comparison-focused.png)。
- 原始视觉为 1584×993 像素。原生规则、最终订阅截图为 3378×2104 像素，Retina 约 2×，对应约 1689×1052 CSS 点；首次规则截图为 3416×2142。比较图等比缩到每列最大 1200×800；局部比较将原生截图先按 2×密度归一化。原图均保留。
- 浏览器补充验证为 1584×993、900×700 CSS 像素，截图密度 1。它复用正式通知组件和样式，使用独立端口上的内存适配器；并非对原生后端的替代验证。
- 比较状态：浅色、规则默认危险档；订阅定位到 `diteng-main / 内存`。原生使用现有真实主机与历史，参考图使用示例数据，日期、数量、排序、读数及记录状态存在预期差异，未据此评价像素一致性。

## 比较迭代

1. [首次规则比较](comparison-before.png) 发现 P2：选中入口的文字仍为灰色，背景已选中但导航层级不够清楚。修正通知侧栏选中样式的优先级，沿用 accent 和 600 字重。最终原生规则图及局部图确认变为蓝色；浏览器测得亮色 `rgb(0, 82, 217)`，暗色沿用 `rgb(76, 141, 255)`。
2. [首次订阅比较](comparison-subscriptions.png) 发现 P2：定位靠后的主机时，`scrollIntoView` 同时移动外层容器，使页头和返回按钮被卷走。改为只调整表格容器的纵横滚动，随后聚焦目标复选框并阻止焦点再次滚动祖先。
3. [最终订阅比较](comparison-subscriptions-final.png) 确认页头、分组筛选与返回按钮保持可见，目标主机仍位于表格中部。[900×700 长表定位](browser-long-list-focus.png) 复验第 23 台主机：外层滚动值为 0，表格滚动值为 962.5，焦点为 `host-20 mem`，页头顶部仍在 y=40。
4. 最终无未解决的 P0/P1/P2 问题。

## 必查视觉面

- **字体与排版**：沿用 DESIGN.md 的系统字体、14px 正文、12px 辅助信息、20px 页面标题及 400/600 字重；数字使用等宽字体或 tabular-nums。没有照搬示意图中更大的标题字号。
- **布局与间距**：沿用 72px 一级栏、40px 通栏和 200px 二级栏。参考图侧栏较宽，实际应用保留既有壳层尺寸，这是明确的产品约束。订阅矩阵占满可用宽度，表内滚动并固定主机列、表头；规则页独立纵向滚动。
- **色彩与状态**：继续使用现有亮暗 token、蓝色选中及语义状态色。成功文字用 success-text；状态同时有图标和文字。窄窗没有根页面横向溢出。
- **图像与图标**：本次没有位图内容或装饰资产需求，图标复用现有 Lucide；截图仅作为验收材料。对比图的裁切和缩放仅用于密度归一化，原生证据原图未改动。
- **内容**：页面明确区分主机指标、应用探活、证书提醒及共享渠道。展示触发值、记录值、回落值，避免把历史数值称为实时值；渠道记录不冒充送达回执。应用侧栏也拆为三个入口，这是用户后续要求，优先于参考图里旧的“订阅与规则”合并项。

## 交互与回归

| 验证项 | 结果与证据 |
| --- | --- |
| 主机、应用、证书分类 | 原生页面分别进入，各自消息没有混排；旧系统记录仍可查看。 |
| 主机消息定位订阅 | 原生焦点 `diteng-main mem`，最终页头保持可见。 |
| 应用消息定位订阅及返回 | 原生焦点 `cdcp-raven im`；返回仍选中原应用消息。 |
| 订阅和规则保存 | 隔离环境修改应用订阅及 CPU 档位，适配器收到写入，控件同步；支持可见标签点击及 Space 键。 |
| 分类未读范围 | 隔离环境标记主机分类后，主机=0、应用=1、证书=1、一级总数=2；[截图](browser-scoped-read.png)。 |
| 视图恢复 | 切到应用订阅再回主机消息，“已恢复”筛选仍为选中状态。 |
| 窄窗列表与详情 | 900×700 下列表和详情前后切换，详情有返回列表；[列表](browser-narrow-list.png)、[详情](browser-narrow-detail.png)。 |
| 暗色与宽表 | [暗色规则](browser-narrow-dark-rules.png)、[窄窗应用订阅](browser-narrow-app-subscriptions.png)，根文档未横向溢出。 |
| 窄窗发送渠道 | [900×700 暗色渠道](browser-narrow-dark-channels.png)，网格为单列 585px，预览排在设置下方，根文档未横向溢出。 |
| 空状态与失败恢复 | [空筛选](browser-empty-filter.png)有重置筛选；[读取失败](browser-read-error.png)有重试，恢复适配器后正常加载。 |
| 渠道预览 | 原生切换告警和恢复，三个预览同步更新，没有执行测试发送。 |
| 浏览器控制台 | 最终冷加载无 error；只有 Wails 的浏览器预览提示。隔离适配器最初误将字符串响应写成对象，已改正并冷加载复验；热更新重复 createRoot 的提示也通过 dispose 清理。它们未出现在原生生产构建中。 |

隔离页位于 `frontend/scripts/notify-qa.html` 与 `notify-qa.tsx`。复现：在 frontend 运行 `bunx --no-install vite --host 127.0.0.1 --port 9257 --strictPort`，打开 `/scripts/notify-qa.html`。该入口不包含在正式构建入口中，数据不来自用户配置。

## 自动检查

- `bun run type-check`：通过。
- `bun test scripts/notify-model.test.ts scripts/cert-alerts.test.ts`：5 passed，16 assertions。
- `bun run build` 和 `bun run verify:shell`：通过。
- `go test . ./internal/alerthistory ./internal/notifysubs ./internal/certnotify`：通过。
- `wails3 task darwin:package`：通过；已安装 bundle 的 codesign 校验通过。
- `git diff --check`：通过。前端体积及 macOS 链接器保留已有非阻塞警告。

## 数据边界与剩余验证范围

- 原生验证没有修改现有订阅、阈值、渠道配置，没有清理用户历史，也没有向企业微信群发送消息。正常打开消息产生的已读状态按产品行为更新。
- 通知订阅配置验证前后 SHA-256 均为 `ea0f285c66e4ed376c33a7624fa7f3b8e644d8af41b445ef26c02dc1b6720009`。
- 旧应用回滚副本：`/tmp/1panel-notification-qa-20261019-001925/1Panel-before.app`。
- 真实后端的 macOS 原生路径已验证；Windows/Linux 未运行实机验证。亮暗及窄窗补充覆盖来自复用正式组件的浏览器隔离环境。企业微信真实发送、用户数据的删除/清理不属于此次实际执行的验证范围。

## 完成清单

- [x] 主机订阅、告警规则分别进入侧栏，去掉标签页和并排编辑。
- [x] 应用服务采用同样的消息 / 订阅 / 规则结构。
- [x] 证书与资源消息分离，共享发送渠道保留。
- [x] 真实消息定位、返回、长表、窄窗、暗色及操作范围完成验证。
- [x] 两个 P2 问题修正后重新截图比较；保留原有不相关工作区改动。
