# OnePanel 窗口材质交付与验证

## 启动时侧栏蓝线常驻修复（2026-11-10）

原生应用实测：鼠标停在主机卡片上，刚启动仍显示整条蓝线；Tab 将焦点移至搜索框后蓝线消失，Shift+Tab 回到分隔条后再次出现。原因是 WKWebView 启动时自动聚焦分隔条，原来的 `:focus-visible` 规则也会命中这次自动焦点。

分隔条现在仅在真实 Tab 导航或方向键调宽后显示键盘焦点线，鼠标按下时清除键盘导航状态；悬停与拖动高亮继续沿用原规则。保留可聚焦语义、方向键调宽和双击复位。

验证结果：

- 类型检查、现有工作区布局测试（24 项 / 96 断言）、生产包壳层检查通过。布局测试使用分隔条 mock，不能作为本次焦点行为的证明。
- 浏览器使用现有设置 QA 页面里的真实分隔条，验证 Tab / Shift+Tab、左右方向键调宽、悬停 / 移出、拖动 / 松开与双击复位通过。Chromium 未复现 WKWebView 的启动自动焦点，回归证据以原生应用为准。
- `python3 build.py` 构建、安装并启动完成；安装签名通过，构建与安装二进制 SHA-256 一致，运行位置为 `/Applications/1Panel.app`。
- 原生应用两次启动均无常驻蓝线；实际 Tab 聚焦后仍显示蓝线。对相同分隔条区域采样 1900 行：修复前启动 1900 行为蓝色，修复后两次启动均为 0，键盘聚焦后为 1900。

截图保存在下节相同目录：`splitter-startup-before.png`、`splitter-startup-after.png`、`splitter-restart-after.png`、`splitter-keyboard-after.png`。未进行 Windows / Linux 原生验证。

## macOS 侧栏加厚底色（2026-11-10）

用户选择「原生材质 + 更厚中性底色」，以系统设置截图为视觉方向。默认配色原先浅色 60%、深色 65% 的遮罩改为复用配色 token：浅色 88%、深色 86%。默认配色也按黑 / 白底合成结果校正侧栏辅助文字及强调色，对比度至少 4.5:1；蓝色强调沿原色相校正。原生 `NSVisualEffectView` 从固定激活改为跟随窗口激活状态。壁纸来源、两级侧栏布局和选中样式保持原逻辑。

验证结果：

- 前端类型检查、49 项配色 / 窗口材质测试（4395 断言）、生产包壳层检查通过。现有配色合成测试扩展到默认配色，覆盖浅深色和黑 / 灰 / 白背景。
- Go 窗口主题相关测试、`internal/windowmaterial` 包测试通过；原生 50 次材质开关、窗口缩放、背景层复用 / 清理、红蓝壁纸实际绘制测试通过。Go 测试链接器有部署目标版本及重复 `-lobjc` 提示，构建成功。
- `python3 build.py` 完成生产构建、签名、安装与启动。安装位置 `/Applications/1Panel.app`，签名验证通过；安装文件与构建文件 SHA-256 一致，运行进程指向安装位置。
- 原生界面已检查浅色主机页、浅深色设置页及经典 → 自动半透明切换。侧栏由明显粉紫转为中性浅灰，只留淡淡的壁纸色感；用户的默认配色、跟随系统、自动材质已恢复，最终停在主机页。
- 同一壁纸与同一空白侧栏区域的截图采样：浅色 RGB 通道差从 11.8 降至 6.0，深色从 22.2 降至 12.2，仅作为本机透色减弱的辅助证据，不代表所有壁纸。前后台切换后两次采样相同，原生枚举设置已验证，未据此宣称系统焦点视觉差异已被截图证明。

截图目录：`/Users/itjun/.codex/visualizations/2026/11/10/01a1c3f0-6435-7302-8438-9336385852c1/`。改前 `sidebar-before.png` / `sidebar-before-dark.png`，改后 `sidebar-final.png` / `sidebar-after-dark.png`，浅色设置页 `sidebar-after-settings-light.png`。4096 × 2304 像素，原生窗口 2048 × 1152 点。

边界：没有更改系统壁纸、系统减少透明度设置，也未验证多显示器或动态壁纸。Windows / Linux、900px 窄窗和编辑器 / 看板完整回归的本轮范围见设计规范 §9。观感接近系统设置，未声称系统控件或材质像素完全相同。

## 历史验证环境

验证日期：2026-10-03。环境：Apple Silicon、macOS 27.0.1（26A434）、Wails v3 beta.14、Go 1.27、Bun 1.4。没有升级框架或改变 Go／React 架构。

## macOS 始终取桌面壁纸（2026-11-03）

用户明确要求：即使窗口后面挡着其他应用，也始终使用桌面壁纸。旧的 `behindWindow` 会采到其他应用，不满足这个要求；只去掉 CSS 灰色遮罩无法解决背景来源错误。

现在通过 `NSWorkspace.desktopImageURLForScreen` 读取当前屏幕壁纸，在 WebView 下方绘制与屏幕位置对应的图像，再用 `NSVisualEffectView` 的 `withinWindow` 模式模糊。移动／缩放只重画缓存；跨屏重新读取来源；每 3 秒检查壁纸 URL、修改时间和缩放选项。关闭材质时清理背景、定时器和窗口通知。初次读取失败通过现有主题状态回退经典，系统降低透明度的回退保留。

验证：

- `python3 scripts/test-window-wallpaper-native.py`：测试进程内替换系统壁纸读取接口，以红／蓝图片检查生产背景实际绘制的像素及定时更新，不改变用户壁纸。旧实现失败（读取红色来源后仍绘制灰色），新实现通过。
- `python3 scripts/test-window-material-native.py`：50 次开关、背景层复用、系统壁纸来源、窗口内模糊、缩放与屏幕坐标、定时器清理通过。
- Go 窗口主题与材质测试、macOS 生产构建和签名校验通过。
- 已安装应用实机可见壁纸的蓝紫色及明暗轮廓；浅色／跟随系统、经典／自动切换通过。设置恢复为自动材质、跟随系统。

验收边界：单窗口截图会丢失 `behindWindow` 的窗后合成，纯 AppKit 对照也出现灰底，不能把这种截图当作旧方案已经透出壁纸的证据。新方案的壁纸属于本窗口内容，可在截图中直接观察。多显示器与动态／视频壁纸的当前时刻画面未实机验证；当前读取系统公开接口返回的静态图像，不捕捉视频壁纸实时帧。


## Windows 11 云母失效修复与实机验收（2026-10-29）

环境：Windows 11 build 26300（浅色系统、透明效果开启、壁纸 Desktop Spotlight）、Wails v3 beta.14、Go 1.27.3、Bun 1.4。修复前实机取证（每 250ms 采样 DWM / 类属性）确认三处缺陷叠加导致云母失效：

1. `setClassErase` 把 `GCLP_HBRBACKGROUND` 写成 -26（实为 `GCL_STYLE`，正确值 -10）：清类刷从未生效，BTNFACE 类刷整面盖住 DWM 材质；恢复路径还把刷子句柄 0x63 当类样式写入（含 CS_OWNDC／CS_CLASSDC 位，实测 classStyle 被污染）。
2. `setClassErase` 的 `if erase == classEraseCleared` 守卫方向反了：首次进云母（false==false）直接早退，连错误的写入都被跳过。
3. 前端 `applyColorPalette` 对 classic 色系也写 `data-color-palette`，CSS 的 `[data-color-palette]` 云母壳层实底覆盖因此永远命中，壳层被强制画成实色 canvas／rail，云母永远不可见。

修复：GCL 索引改 -10、守卫改 `!=`、CSS 两条覆盖规则加 `:not([data-color-palette="classic"])`。另核实 Wails beta.14 的 `WS_EX_NOREDIRECTIONBITMAP` 常量是错值 0x00200000（真实 0x02000000），窗口实际是普通重定向表面——这不影响材质（清类刷即透出 backdrop，与既往实验一致），升级框架时该常量修正与否需重新观察。

修复后实机时间线：启动 0.8s backdrop=2 且类刷(-10)=0x0（真正清除），1.5s 启动超时切经典时刷子正确恢复为 BTNFACE 句柄（类样式全程保持 0x3 未被污染），1.9s 前端恢复云母后稳定在 backdrop=2 + 类刷 0。视觉验收：工具栏由 CSS 经典 #F2F3F5 变为 DWM 浅色云母 #F3F3F3；图标栏 #EBEBEB 恰为设计的 `rgba(0,0,0,0.03)` veil 叠在云母上的合成值（243×0.97≈235），内容区保持实色 #FFFFFF。启动期间经典→云母的短暂切换（约 0.4s）来自既有 1.5s 就绪超时与前端恢复链路，非本次缺陷。

增量检查：`go vet`、`go test ./internal/windowmaterial`、`go test ./internal/app -run "TestWindowTheme|TestWindowMaterial"` 通过；前端 `bun run test:window-theme`（5 项 24 断言）、`bun run type-check`、`bun run verify:shell` 通过；`task windows:build` 与 Linux server 交叉构建通过。Windows 宿主上 `go test ./...` 的其余失败均为环境固有差异（Unix 0600 权限断言、符号链接特权、Linux-only syscall、路径分隔符），与本次改动无关。仍待补验：设置页手动经典／云母切换、系统透明效果开关切换、节电／高对比度回退的实机点击验收。


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
| Go 材质逻辑与竞态 | `go test -race ./internal/app -run 'TestWindowTheme\|TestWindowMaterial'` 通过 |
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
CGO_CFLAGS=-mmacosx-version-min=13.0 CGO_LDFLAGS=-mmacosx-version-min=13.0 go test -race ./internal/app -run 'TestWindowTheme|TestWindowMaterial'
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
