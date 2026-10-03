# OnePanel 窗口材质交付与验证

验证日期：2026-10-03。环境：Apple Silicon、macOS 27.0.1（26A434）、Wails v3 beta.14、Go 1.27、Bun 1.4。没有升级框架或改变 Go／React 架构。

## Smoke 增量交付（2026-10-03）

补齐 Fluent 三种材质的最后一块：Mica（遮挡类基础层）、亚克力（遮挡类临时层）之后，Smoke（烟雾）是透明类材质，通过压暗下层表面来强调重要的 UI，用于模态对话框 / 抽屉下方的遮罩；不区分明暗模式，始终是半透明黑色。

Smoke 不是窗口背景材质，DWM 的 `DWMWA_SYSTEMBACKDROP_TYPE` 没有对应取值，因此不进入窗口材质偏好（`validWindowMaterial`）与设置页选项，只落为前端遮罩规格：

- `--color-scrim` 明暗统一为 `rgba(0, 0, 0, 0.6)`；`html.dark` 不再覆盖为 0.7，与微软「not mode aware; always translucent black in both light and dark mode」一致。
- 遮罩使用点不变，仍一律 `bg-scrim`：对话框（`ui/dialog.tsx`）、文件预览抽屉、本地应用页对话框三处。

原生依据：[Materials used in Windows apps](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials)。

## Mica 增量交付（2026-10-03）

窗口材质增加「云母」，仍保存到同一个 `theme.json`。旧的自动／经典／亚克力配置保持有效。自动选择现改为：Mac → 亚克力，Windows 11 22H2（build 22621）及以上 → 云母，其余环境 → 经典。

Windows 通过 `DWMWA_SYSTEMBACKDROP_TYPE=DWMSBT_MAINWINDOW` 应用原生 Mica，`DWMWA_USE_IMMERSIVE_DARK_MODE` 同步原有颜色模式；没有使用桌面截图、模拟模糊、旧版未公开 Mica 属性或 Win10 模糊替代。内建激活／非激活状态由 DWM 管理。Mac／Linux 手动选择云母会保存选择并显示经典回退原因。

前端仅清除云母壳层的 WebView 覆盖，露出原生不透明云母基础层；一级功能条增加轻微层次色，内容区和控件仍实色。云母不叠加亚克力颗粒。Windows 支持版本在创建窗口时使用当前 Wails 的透明 WebView2 表面，以便即时开关材质，经典界面仍由完整实色 CSS 覆盖。

Windows 每秒检测桌面合成、透明效果、高对比度、节电和系统颜色变化；条件变化时重新解析保存偏好。低端设备等更细的系统降级由 DWM 自行处理，应用不能仅凭 API 成功判断视觉上一定有壁纸着色。

增量检查：Go 全量测试、材质／策略测试与竞态检查通过，前端 5 项测试（26 个断言）、类型检查、生产构建和壳层检查通过，Windows amd64 交叉构建与 Linux server 构建通过。Mac 原生桥 50 次复用／还原测试再次通过。新版已安装且签名校验通过。

本次 Mac 桌面窗口捕捉也出现 `SCStreamErrorDomain -3811`；重置工具、确认唯一 1Panel 进程并按应用标识重新连接仍失败。未完成新增云母选项的桌面点击／视觉验收，当前旧进程未被强制结束，查看新选项需要正常退出后重启。Mac 原生能力测试确认云母不可用且自动仍选择亚克力。**本机是 Mac，Windows 原生 Mica、壁纸着色、焦点切换及真实系统设置切换尚未实机验收。**

Windows 实机验收应依次检查：自动选云母；手动经典／云母切换和重启记忆；浅色／深色／跟随系统；壁纸变化；激活／非激活；关闭透明效果、高对比度、节电开关及恢复；拖动／缩放／全屏；内容区实色；Win10 和 Win11 build 22000 使用经典。

原生接口依据：[DWM_SYSTEMBACKDROP_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)、[Mica 材质](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)。

## 亚克力首版实现与历史验收

- 设置 → 外观：窗口材质「自动／经典／亚克力」与原有颜色模式独立；显示实际生效效果和回退原因。
- Go 是材质偏好的唯一持久来源：`os.UserConfigDir()/ServerPanel/theme.json`，Mac 对应 `~/Library/Application Support/ServerPanel/theme.json`。临时文件写入、同步后原子替换；保存失败不改变原选择。
- 主窗口创建前读取偏好；原生效果和前端颜色、材质完成就绪握手后显示。1.5 秒未就绪则切回经典骨架并显示，前端恢复后重新读取保存偏好。
- Mac 使用单个可复用的 `NSVisualEffectView`，behindWindow／underWindowBackground；原生操作在 AppKit 主线程执行，不重建窗口或 WebView。
- WKWebView 透明化沿用固定版本 Wails 的 `drawsBackground` 处理，并捕获原生异常、恢复背景；这是框架当前采用的内部属性，后续升级框架时仍需重新验收。
- 监听减少透明度的系统通知；系统禁止透明效果时回退经典，关闭限制后重新解析保存偏好。原生失败也保留偏好，后续启动重新检测。
- 亚克力仅覆盖顶部栏、一级图标栏、二级侧栏；浅色覆盖 80%、深色 75%，静态纹理约 1%（8 位 Alpha 为 3/255）。内容、输入、浮层维持原实色。
- Windows（包括 11）与 Linux 当前返回「本版本尚未提供原生亚克力」；浏览器和 HTTP 看板保持经典，不进入桌面材质握手。

## 已完成检查

| 检查 | 结果 |
| --- | --- |
| Go 全量测试 | `go test ./...` 通过 |
| Go 材质逻辑与竞态 | `go test -race . -run 'TestWindowTheme\|TestWindowMaterial'` 通过 |
| 首次／旧配置／空值／损坏／无效配置 | 默认自动；测试通过 |
| 手动优先／系统禁止／原生失败／超时恢复／恢复默认 | 测试通过；失败时保留请求偏好 |
| 保存失败／无效输入 | 不改选择、不触发新的原生切换；测试通过 |
| 前端状态测试 | 3 项、16 个断言通过；覆盖预览、就绪、系统事件、过期事件、保存失败、不支持平台与恢复自动 |
| 前端类型检查、生产构建、壳层契约检查 | 全部通过；保留已有大分包提示 |
| Windows amd64 交叉构建 | 通过，未在 Windows 实机运行 |
| Linux amd64 server 构建 | 通过；不等同于 GTK 桌面构建 |
| Mac 原生桥测试 | 50 次开关复用同一层；关闭后恢复窗口／WebView；离线缩放后重新开启尺寸正确；系统通知监听通过 |
| Mac 桌面实机运行 | 自动模式实际显示亚克力，浅色／深色／跟随系统和经典模式切换正常，内容区保持实色 |
| Mac 重启与窗口交互 | 经典偏好重启后保留；自动模式正常；侧栏折叠／恢复、窗口最大化／恢复、全屏进入／退出通过 |
| Mac 连续切换 | 设置页实际切换 50 次，无崩溃；与原生层复用测试共同验证背景层不累积 |

最终版本通过 `task darwin:install` 打包并安装到 `/Applications/1Panel.app`，`codesign --verify --deep --strict` 通过。正常退出旧进程并启动最终版本后，再次确认材质「自动」实际启用亚克力、原有颜色「跟随系统」保留。

## 性能观察与验收边界

切换期间对 1Panel 主进程进行 12 次、约每秒一次采样：CPU 0–7.6%，RSS 114816–116032 KiB；稳定经典状态约 119104 KiB，50 次切换后约 114608 KiB。本次短时采样没有发现主进程持续内存增长，不能替代长期泄漏检测，也不包含独立 WebKit 子进程的完整内存。

同期全系统 GPU 样本为 43–60%；捕捉窗口和其他应用同时运行，这些数值不能归因于 1Panel，不能据此宣称亚克力 GPU 开销已达标。

以下仍未完成验收：

- 系统设置窗口的自动捕捉连续出现 `SCStreamErrorDomain -3811`，未实际改变「减少透明度」开关。能力解析、原生通知监听已测试，真实系统开关仍需补验。
- 大列表滚动、高频监控图表、持续窗口拖动／缩放的 CPU／GPU 对照压测，及 WebKit 子进程长期资源观察。
- Windows 实机、Linux GTK 桌面构建与实机运行；本机没有 Linux GTK 工具链。Linux server 编译只证明该编译路径兼容。（2026-10-03 补：Linux GTK 桌面已在一台 Debian 13 / GNOME 48 实机构建并运行，材质按预期回退经典；该次实机同时修复并验收了「跟随系统」深浅色跟随门户的问题，见 docs/linux-appearance.md。）

## 复现命令

在仓库根目录执行：

```sh
CGO_CFLAGS=-mmacosx-version-min=13.0 CGO_LDFLAGS=-mmacosx-version-min=13.0 go test ./...
CGO_CFLAGS=-mmacosx-version-min=13.0 CGO_LDFLAGS=-mmacosx-version-min=13.0 go test -race . -run 'TestWindowTheme|TestWindowMaterial'
CGO_CFLAGS=-mmacosx-version-min=13.0 CGO_LDFLAGS=-mmacosx-version-min=13.0 go test -race ./internal/windowmaterial
python3 scripts/test-window-material-native.py
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o /tmp/OnePanel-theme-windows.exe .
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags server -o /tmp/OnePanel-theme-linux-server .
task darwin:install
```

在 `frontend/` 执行：

```sh
bun run test:window-theme
bun run type-check
bun run build
bun run verify:shell
```

原生测试直接提取生产桥代码，在临时目录编译真实 AppKit 窗口与 WKWebView 的测试程序，不添加产品调试接口，不修改用户偏好。
