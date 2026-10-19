# 配置与数据：方案 3 验证记录

final result: passed

## 视觉目标与实现

- 用户选择的第 3 张效果图：[reference.png](docs/design/config-data/reference.png)。
- 实现截图：[implementation.png](docs/design/config-data/implementation.png)。
- 完整并排比较：[comparison-final.png](docs/design/config-data/comparison-final.png)，左侧为设计，右侧为实现。
- 局部比较：[comparison-detail.png](docs/design/config-data/comparison-detail.png)，上方为设计，下方为实现。
- 参考像素：1583 × 994。最终浏览器视口与截图：1583 × 994 CSS/图像像素，密度 1。最初截图为 1583 × 995，比较时仅将高度归一化到 994。
- 状态：浅色、配置模块、首条备份展开恢复预览。浏览器使用可控模拟数据；磁盘备份与恢复由 Go 集成测试独立验证。

## 比较历史

1. 第一轮：[comparison-initial.png](docs/design/config-data/comparison-initial.png)。发现 P2：标题、操作按钮及正文偏小，整体左边距偏窄，信息显得过密。调整为 36px 主标题、24px 分区标题、16px 主体文字，放大备份操作按钮并调整内容边距。删除恢复预览中无须始终展示的文件计数。
2. 第二轮：恢复确认按钮仍偏小，已调整为至少 112 × 38px。重新捕获最终实现并完成全幅与恢复预览局部比较。
3. 最终比较：无未解决的 P0/P1/P2 差异。

## 必查视觉面

- 字体：沿用系统字体栈，macOS 为 SF Pro / 苹方；标题字重 600，正文层级与效果图一致。路径使用现有等宽字体。
- 布局：单页、无配置二级导航；顶部两个直接操作、备份表及行内恢复预览、下方当前配置。分隔线与留白代替卡片。800 × 720 下检查 document/body 宽度均为 800，无横向溢出；内容可纵向滚动。
- 色彩：沿用现有 token；浏览器计算主按钮背景为 rgb(0, 82, 217)，文字为白色。无新增渐变、阴影或卡片描边。
- 图像与图标：本设计没有新增位图资产。复用现有应用外壳与 Lucide 折叠图标；没有用 CSS 绘图替代图片。
- 文案：使用“备份应用数据 / 恢复应用数据 / 查看配置 / 查看 SSH”。明确完整备份内容、覆盖范围、自动备份及重启行为。补充密码与密钥保管提示。

## 交互验证

- 新备份成功后列表刷新；取消操作不会提交恢复。
- 本地备份展开/收起；选择外部文件后先展示恢复预览。
- 确认恢复提交备份路径、预览校验值及完整应用偏好，进入忙碌状态，阻止重复提交。
- SSH 查看器可以在主配置与关联文件间切换；可编辑 input/textarea/contenteditable 控件数量为 0。[SSH 截图](docs/design/config-data/ssh-readonly.png)。
- 当前应用配置只读显示，密码为掩码。
- [窄窗口截图](docs/design/config-data/narrow.png)：文字换行、按钮可达，保持纵向滚动。
- 浏览器控制台没有应用错误。原生系统文件对话框与真实进程重启未在浏览器中冒充执行。

## 数据验证

- `go test ./... -count=1` 通过。
- `bun test scripts/application-data.test.ts`：3 通过，覆盖偏好采集、全量替换、失败回滚。
- 前端 `type-check`、`build`、`verify:shell` 通过。
- macOS 原生生产编译 `go build -tags production` 通过；没有安装或替换正在运行的应用。
- Go 临时目录集成测试覆盖：主机与分组、密码、SSH 私钥/公钥/证书、known_hosts、通知与历史、布局偏好、窗口/主题、历史配置快照、未来新增数据文件、恢复前自动备份、校验失配、旧版包识别、跨目录恢复、外部私钥迁移、路径穿越/符号链接拒绝、注入写入失败后的回滚。
- 恢复会去掉备份之后新增的应用生成 SSH 段，避免重启导回较新的主机，同时保留手写 SSH 内容。

## 已说明的边界

- 当前完整应用备份用于同操作系统恢复；旧跨平台主机迁移接口仍保留。
- SSH Include 目前要求位于 `~/.ssh` 内；无法完整还原的外部引用会阻止生成备份，不会静默漏备。当前本机根配置的 Include 为 `~/.ssh/config.d/*`。
- 下载的更新/iperf3 二进制、未完成的临时写入、备份包自身与恢复暂存区不递归打包；历史配置快照仍包含在内。
- 浏览器预览使用独立模拟数据，不能消费桌面应用的待恢复偏好。恢复偏好先于桌面设置模块初始化。
- 没有在用户现有数据上执行覆盖恢复，也没有替换正在运行的已安装应用。

## 实现检查清单

- [x] 按选定方案完成页面和只读查看器。
- [x] 完整应用备份、预览校验、恢复前备份、重启前暂存、启动时应用、偏好恢复接入。
- [x] 完成视觉迭代、局部检查、窄窗口和核心交互检查。
- [x] Go / 前端验证通过；保留原有不相关工作区改动。

## 后续微调

无阻塞项。浏览器不显示 macOS 原生红绿灯，一级导航尺寸沿用仓库现有应用外壳，这是运行环境与既有规范的有意差异。

## 通知中心独立侧栏页面（2026-10-19）

final result: passed

主机系统采用“消息记录 / 主机订阅 / 告警规则”，应用服务采用“消息记录 / 应用订阅 / 告警规则”。证书提醒与共享发送渠道分别保留独立入口。订阅与规则没有标签页，也没有并排编辑区。

完整证据与验证边界见 [通知中心验收记录](docs/design/notification-center/design-qa.md)。[最终订阅对照](docs/design/notification-center/comparison-subscriptions-final.png) 和 [规则局部对照](docs/design/notification-center/comparison-focused.png) 已打开比较，修正选中文字颜色及长列表定位卷走页头两个 P2 问题。原生应用验证、900×700 窄窗与暗色隔离验证、类型检查、通知分类及证书测试、构建和壳层检查通过。Windows/Linux 实机及企业微信真实发送未在本轮执行。


## 2026-10-19 设置页实现验收

- final result: passed
- 详细记录：[设置页设计验收](docs/design/settings/design-qa.md)。
- 确认稿与实现组合证据：[完整对照](docs/design/settings/comparison.png)、[外观与字体对照](docs/design/settings/appearance-comparison.png)。
- 保留原有设置功能，按运行系统显示快捷键、字体与材质能力；六个模块连续滚动，目录按阅读位置跟随。
- 类型检查、生产构建、壳检查、13 项前端针对性测试与窗口材质相关 Go 测试通过。Windows/Linux 已验证前端分支，原生实机外观尚未验证。
