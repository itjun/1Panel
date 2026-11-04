# Debian GNOME 更新与任务栏图标验证

验证日期：2026-11-03。环境：Debian 13，GNOME Wayland，GTK 4.18.6、WebKitGTK 2.54.0。

## 问题和证据

- 用户界面报“安装包内没有可执行文件 1Panel.old”。实际运行路径为 `~/.local/bin/1Panel.old`，正式的 `1Panel` 文件也存在。
- Linux 更新通过 rename 将运行文件改成 `.old`，之后 `os.Executable()` 随之改变。旧重启代码再次读取它，启动旧版；再更新时就按备份名查找安装包。
- 桌面入口 `com.itjun.panel.desktop` 和 `1Panel.png` 均存在，GTK 图标主题能找到图标。旧二进制的真实 Wayland 协议输出却是 `set_app_id("org.wails._1panel")`，与桌面入口不符。

## 修复

- Linux 在进程初始化时保存安装路径，更新和重启共用它；若从旧版留下的 `1Panel.old` 启动，检查正式文件存在且可执行后恢复正式路径。
- 显式设置 Wails `ApplicationID` 和 `ProgramName` 为 `com.itjun.panel`，桌面入口的 `StartupWMClass` 同步修改。移除旧版 Wails 的 GTK 链接器兼容补丁及其已失效的测试。
- 非 Linux 平台的重启路径仍由 `os.Executable()` 获取。

## 验证结果

1. `TestLinuxUpdateKeepsExecutableIdentity` 在独立 Linux 进程内替换真实运行文件。修复前正常启动场景在第二次更新失败，备份启动场景在第一次更新失败，均为用户截图中的完整报错；修复后连续更新、重启和备份清理均通过。
2. Debian 原生 `go test ./internal/updater`、`go test ./internal/app -run 'Update|Retry' -count=1` 通过。
3. macOS `go test ./internal/updater ./internal/app` 通过。新增 Linux 测试带平台约束；初次漏加约束导致的 macOS 测试失败已纠正并重跑。
4. `bun run build`、Debian GTK 原生生产构建和 `git diff --check` 通过。
5. `python3 scripts/test-linux-desktop-identity.py /path/to/1Panel` 在独立 D-Bus 和临时用户目录中启动真实应用，检查 Wayland 协议和已安装图标。旧二进制的标识断言失败；修复二进制通过，窗口标识为 `com.itjun.panel`。

## 本机交付和限制

修复构建 `v1.3.26+linuxfix` 已安装到 Debian 的 `/home/debian/.local/bin/1Panel`，桌面入口同步更新。安装文件与构建文件 SHA-256 一致：`8b8664ef9d2b5011bfaf576234155ef9e5ec1b5485ca277b892086d16efd7e55`。已启动正式路径，启动日志未发现 error、critical 或 panic。

原二进制、旧备份和桌面入口保留在 `/home/debian/.local/share/1Panel/backup-linux-fix-20261103-150518/`。旧进程拦截 SIGTERM 后未退出，安装前核对其可执行路径，再结束该旧实例。Debian 仓库中原有未提交改动保持不变，构建使用独立临时目录。

尚未通过 NoMachine 截图确认 Dash to Panel 最终外观：计算机工具读取该窗口超时。X11 窗口归组未实测；未发布新版本，也未走公开更新服务器的完整升级链路。更新回归使用本地生成的安装包，不替代发布后的验收。
