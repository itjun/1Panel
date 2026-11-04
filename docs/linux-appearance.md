# Linux「跟随系统」深浅色修复与验证

验证日期：2026-10-03。环境：Debian 13（trixie）、GNOME 48 Wayland（NoMachine 会话）、GTK 4.18.6、WebKitGTK 2.54、Wails v3 beta.14、Go 1.27、Bun 1.4。

## 症状

系统外观为浅色时，面板设置里选「跟随系统」仍显示深色（黑色界面）。

## 根因

三层因素叠加，全部在本机实测确认：

1. `~/.config/gtk-3.0/settings.ini` 与 `~/.config/gtk-4.0/settings.ini` 里写死了 `gtk-application-prefer-dark-theme=1`，把所有 GTK 应用钉在暗色；而桌面真实的深浅色（GNOME `color-scheme='default'`、portal `org.freedesktop.appearance color-scheme=0`）是浅色。
2. WebKitGTK 的 `prefers-color-scheme` 跟随上述 GTK 属性（实测：属性翻转，求值结果同步翻转），前端 `resolveAppearance("system")` 读 `matchMedia` 于是拿到 dark。
3. WebKitGTK 不为该属性的运行时翻转派发 `matchMedia` change 事件（实测 0 次）；但重新求值能拿到新值（随查随新）。

## 实现

- 新增 `internal/syscolor`：优先问 xdg-desktop-portal 的 `org.freedesktop.appearance/color-scheme`（GNOME/KDE 等通用），门户不可用退回 `gsettings get org.gnome.desktop.interface color-scheme`；同时可订阅 portal `SettingChanged` 广播。解析与信号体解析为纯函数，带单元测试。
- 新增 `window_appearance_linux.go`（其余平台 `window_appearance_other.go` 空实现）：cgo 在 GTK 主线程写 `gtk-application-prefer-dark-theme`。`SetThemeAppearance(light/dark)` 直接落值；`auto` 以门户深浅色为准（两种来源都查不到时不动 GTK，维持现状）。门户变化时：仅跟随系统模式下同步 GTK 并 `Emit("system-appearance-changed", dark)`。
- 前端：`setThemeAppearance` 返回后重读一次主题（消除首帧停留在旧值）；新增 `applySystemAppearanceHint` 接收上述事件直接落值（`initializeWindowTheme` 内订阅，浏览器预览不订阅）。
- `themeAppearance` 读写加锁（Linux 监听 goroutine 并发读）；退出时停监听。

macOS（WKWebView 如实报告且发 change 事件）与 Windows（WebView2 自带）不受影响，逻辑未动。

## 2026-11-04 加固：失败可重试、聚焦自愈

Wails 升级 3.0.0 后复测「跟随系统」，健康环境下全链路正常（启动四种系统/ini 组合、实机双向翻转、设置页交互，X11 与 Wayland 双后端；另实测 WebKitGTK 2.54 会为 GTK 属性翻转派发 matchMedia change 事件，早期版本不发，`system-appearance-changed` 事件仍是跨版本保障）。但链路有两处一坏就永久失效的缺口，本次补上：

1. **订阅失败永不重试**：登录自启（`~/.config/autostart/1panel.desktop`）早于会话总线就绪时，`WatchSystemPrefersDark` 返回空 stop 且被 `stopAppearanceWatch != nil` 误判为「已在监听」，此后整个进程寿命内不再订阅。现在订阅失败返回 nil（`syscolor` 契约变更），每次 `SetThemeAppearance` 与窗口聚焦都会重试。
2. **无信号丢失自愈**：门户信号漏发（订阅建立前的变化、门户重启窗口期、登录竞态）后界面永久停留旧值。现在主窗口聚焦（`events.Linux.WindowFocusIn` 钩子）时向门户核对当前深浅色，与上次落到 GTK 的值不一致才重设并通知前端；查询失败维持现状。

实机验证：杀掉 `xdg-desktop-portal` 后翻转系统色（信号必丢），界面滞留旧值；真实焦点转换（unmap/remap，等价用户点回窗口）后 3 秒内自愈到正确深浅色，门户被按需激活；门户恢复后常规翻转链路不受影响。

另确认：Wails 3.0.0 起 localStorage 在 Linux 持久化（旧备忘「重启即失」作废），外观偏好跨重启存活——存了浅色/深色的机器表现为「不跟随系统」，属偏好生效而非缺陷，设置里改回「跟随系统」即可。

## 已完成检查

| 检查 | 结果 |
| --- | --- |
| Go 全量测试 `go test ./...` | 27 个包通过 |
| 2026-11-04 加固单测（订阅失败重试、聚焦核对自愈、非 auto 忽略、查询失败维持现状；syscolor 总线不可用返回 nil） | 通过 |
| syscolor 单测（门户优先级、gsettings 兜底、非法值、信号体过滤） | 通过；`-race` 通过 |
| 前端 type-check / build / verify:shell | 通过 |
| `bun run test:window-theme`（4 例，含新事件接线） / `test:system-appearance`（2 例） | 通过 |
| Linux amd64 交叉 `-tags server`、Windows amd64 交叉构建 | 通过 |
| 主包 `-race` | 本机缺 `webkitgtk-6.0-dev`/`libsoup-3.0-dev`（`-race` 使缓存失效需重编 wails cgo），无法执行；并发访问已由 `themeMu`/`appearanceWatchMu` 收敛 |
| 桌面实机（默认外观临时改为 system 的验证构建） | 启动即浅色（截图灰度均值 0.953）；`gsettings` 翻 prefer-dark 后 2–3 秒内变深色（0.124），翻回 default 复原；连续三轮稳定 |
| 干净构建（默认 light）复测 | 同上两轮稳定 |
| `test:group-table-state` | 在未改动的 main 上同样失败（`resolveResizeTarget` 导出缺失），系历史遗留，与本修复无关 |

实机验证方式：`GDK_BACKEND=x11` 运行（GNOME Wayland 下 X root 抓不到顶层窗口，按 X 窗口 ID 用 ImageMagick `import` 抓像素量灰度均值）。截图另见验证记录。

## 已知边界

- 桌面既无 portal 又无 gsettings 时（极少数窗口管理器），跟随系统退回 GTK 现状（即修复前行为）；聚焦自愈也只能在门户恢复应答后生效。
- 首次截图曾抓到过期像图（窗口未重绘时 `import` 返回旧像素、两次均值完全相同），属抓屏方式问题，非应用行为。

## 复现命令

仓库根目录：

```sh
go test ./... ./internal/syscolor
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags server -o /tmp/OnePanel-linux-server .
```

frontend/：

```sh
bun run test:window-theme
bun run test:system-appearance
bun run type-check && bun run build && bun run verify:shell
```

实机翻转验证：运行面板后执行 `gsettings set org.gnome.desktop.interface color-scheme prefer-dark`，观察界面随系统变深；`default` 复原。
