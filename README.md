# 1Panel

一个 macOS/Windows 原生的运维管理面板，基于 Wails v3（Go + React 19 + TypeScript）。

读取本机 `~/.ssh/config`，分组管理 SSH 主机，提供：分组概览（卡片 + 发行版 logo + 红/绿预警色）、主机详情（CPU/内存/磁盘/负载/进程/Java/Docker/服务/定时任务/软件包/终端）；同时提供本机工作区（系统概览 / 应用进程 / 软件列表 / 磁盘空间 / 网络信息 / Hosts，macOS 另有 Nginx 页）。

## 功能

- **主机列表**：自动解析 `~/.ssh/config`，过滤 GitHub/Gitee 等 Git 服务条目
- **分组管理**：把主机按项目分组，分组概览页卡片展示，超阈值（CPU≥90% / 内存>85% / 任一足够大盘/分区可用≤10GB / 负载比>2.0）红色告警
- **主机详情**：
  - 概览：CPU、内存、Swap、磁盘、负载、运行时长、OS 内核版本
  - 进程：可排序/过滤的进程列表（含 PPID、累计时间、命令行）；可单独查看 Java 进程
  - Docker：容器列表 + 实时资源占用，支持启停操作
  - 服务：systemd 运行中的服务
  - 定时任务：用户 crontab、`/etc/crontab`、`/etc/cron.d/*`
  - 软件包：已安装的 apt 包
  - 终端：内嵌 xterm.js + 系统 ssh，可直接敲 Linux 命令
- **添加主机**：输入 IP/用户/密码后自动 `ssh-copy-id` 公钥并回写 `~/.ssh/config`
- **本机工作区**（不经 SSH，直接读本机）：
  - 系统概览：CPU（整机和每核）、内存、交换、磁盘、负载、运行时长、系统版本、网络/磁盘 IO 曲线
  - 应用进程：按运行时（Java / Go / Node / Python…）归并的本机进程树，CPU/内存/IO 速率、监听端口、进程详情与结束
  - 软件列表、磁盘空间（目录树 / 大文件 / 应用占用）、网络信息（网卡 / 网关）、Hosts
- **终端打开**：
  - macOS：设置里可选择本机已安装的 1Agent、官方 Ghostty、官方 Otty 或系统「终端」。只有一个可用时固定使用它。1Agent 经 `oneagent://open` 打开；Otty 用自带的 `otty-cli` 执行系统 ssh。系统「终端」和 Otty 固定在已有窗口新建标签页，不提供新窗口选项。Otty 打开后会切到前台；系统终端没有辅助功能权限时改为新窗口
  - Windows：可选择已安装的 Windows Terminal 或 PowerShell；只有一个可用时固定使用它。Windows Terminal 支持最近窗口新标签页或新窗口，由系统 OpenSSH（`ssh.exe`）按本机 SSH 配置连接；OpenSSH 缺失时给出安装指引

## 文档

- [完整文档索引](docs/README.md)
- [项目术语](docs/glossary.md)
- [视觉与交互规范](docs/design/specification.md) 与 [各功能验收记录](docs/design/README.md)
- [发布与应用更新](docs/release-and-update.html)

## 开发

依赖：Go 1.27+、Node 22+（Vite 8 要求）、Wails v3 CLI 与 task CLI。

```bash
# 安装 Wails CLI（首次）
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.14
go install github.com/go-task/task/v3/cmd/task@latest

# 开发模式（热重载）
task dev

# 一键重新构建、打包、安装并启动（在仓库根目录运行）
python3 build.py

# 构建 + 打包 .app（macOS 只发布 arm64）
task darwin:package
```

> **版本对齐**：Wails CLI（`wails3`）、`go.mod` 中的 `github.com/wailsapp/wails/v3`、前端 `@wailsio/runtime` 必须同一版本（当前以 `go.mod` 为准）。不要自行升 beta；漂移时用 `task wails:check` 检查。

构建产物：`bin/1Panel.app`（macOS）/ `bin/1Panel.exe`（Windows）/ `bin/1Panel`（Linux）。

## 分发

### 下载

日常发版执行 `scripts/publish.sh`。它取最新正式版，把补丁号加一，用这段提交标题写成更新说明，再交给 `scripts/release.sh`（打附注 tag → 推送 → `gh run watch` 等 CI → 校验清单）。要指定版本或改说明时用 `scripts/release.sh vX.Y.Z -F notes.md`（或 `-m "说明"`）。GitHub Actions 构建三个平台并用 `gh` 发布到 **GitHub Releases**（页面右侧 Releases）。Release 同时是应用内更新源，客户端读取最新正式版里的签名清单 `latest.json`：

- `1Panel-v<版本>-mac-arm64.zip` —— macOS arm64 包（Apple 芯片，含 `1Panel.app`）
- `1Panel-v<版本>-win-amd64.zip` —— Windows 64 位包（含 `1Panel.exe`）
- `1Panel-v<版本>-linux-amd64.tar.gz` —— Linux 64 位包
- `latest.json` / `latest.json.sig` —— 应用内更新清单及 ed25519 签名

详细流程见 [`docs/release-and-update.html`](docs/release-and-update.html)。

### macOS 同事侧使用步骤

1. **解压 zip**：双击解压出 `1Panel.app`
2. **拖入 `/Applications`**：把 `1Panel.app` 拖到「应用程序」文件夹
3. **首次打开**：右键 → 打开（macOS Gatekeeper 会拦未签名应用，普通双击会被拒；右键打开后选「仍要打开」即可，只需做一次）
4. **配置 SSH**：应用读取的是同事本机的 `~/.ssh/config`，请确保：
   - 已生成密钥：`ssh-keygen -t ed25519`（一路回车）
   - `~/.ssh/config` 中已有目标主机配置（`Host`、`HostName`、`User`、`IdentityFile` 等）
   - 已通过 `ssh-copy-id user@host` 把公钥推到目标主机
5. **打开应用**：左侧分组/主机列表会自动加载，点击进入即可

### Windows 同事侧使用步骤

1. **解压 zip**：解压出 `1Panel.exe`
2. **运行**：双击 `1Panel.exe`；首次运行 SmartScreen 会提示「Windows 已保护你的电脑」（未签名应用），点「更多信息」→「仍要运行」即可
3. **配置 SSH**：与 macOS 相同，读取本机 `%USERPROFILE%\.ssh\config`，确保已有目标主机配置与密钥
4. **解锁**：Windows 无系统认证面板，直接进入主界面
5. **「终端打开」依赖**（可选，仅影响终端打开，不影响面板内监控）：
   - **OpenSSH 客户端**（Win10 1809+ / Win11 一般已内置）：确认 `%SystemRoot%\System32\OpenSSH\ssh.exe` 存在；缺失时到 设置 → 应用 → 可选功能 → 添加功能 →「OpenSSH 客户端」
   - **Windows Terminal**（推荐）：Microsoft Store 搜索「Windows Terminal」安装；未安装时面板会自动降级为在 PowerShell 窗口中连接

### 安全说明

- 应用**不打包任何 SSH 密钥或证书**——发布包是纯二进制，不含任何 `id_ed25519`、`id_rsa`、`known_hosts` 文件
- 应用运行时只读取同事本机的 `~/.ssh/config`（只读解析），不会上传、不会泄露
- `ssh-copy-id` 流程仅在「添加主机」时由同事主动触发，需要明确输入目标主机的用户/密码

### 系统要求

- macOS 12 Monterey 或更高（仅 Apple 芯片 / arm64）
- Windows 10/11 64 位（本机采集经系统 API（NtQuery / 注册表 / IP Helper）完成，不依赖 PowerShell 文本解析）
- 目标主机需为 Debian/Ubuntu 系列（其他发行版部分监控字段可能解析失败）

## 技术栈

- **后端**：Go 1.27+、Wails v3、`golang.org/x/crypto/ssh`
- **前端**：React 19、TypeScript、Tailwind CSS 4（自研 TDesign 风格组件）、xterm.js、ECharts
- **本机采集**：macOS 走 sysctl/libproc 等；Windows 走 `NtQuerySystemInformation`、注册表、IP Helper（`GetAdaptersAddresses` / `GetExtendedTcpTable`）等系统 API
- **目标主机**：通过系统 `ssh` 二进制建立长连接，运行只读采集命令（`/proc/*`、`free`、`df`、`ps`、`systemctl`、`crontab -l`、`docker ps/stats` 等）

## Agent 部署

单机监控依赖目标主机上的 spanel-agent，由面板经 SSH 一键安装。安装时自动判断运行方式：有 systemd 的主机注册为 systemd 服务；容器、OpenRC 等无 systemd 的主机改用自带守护进程（SSH 断开后保持运行、退出自动重启）。普通用户登录时自动用 sudo 提权。两种方式的差异、资源限制、自启能力与排查方法见 [docs/agent-deployment.md](docs/agent-deployment.md)。

## 关于与版本信息

设置页最后一项「关于」展示应用图标、应用名、版权、当前版本（构建时经 `git describe` 注入：tag 优先，无 tag 用提交短 SHA）、构建提交（本地 `go build` 默认写入 VCS 信息）、系统与架构、内置 spanel-agent 版本，并提供源码仓库 / 发布页（检查更新）/ 问题反馈链接（系统浏览器打开）。

设置 → 应用中的「开机启动」在正式桌面版首次运行时默认开启，登录系统后启动 1Panel。通过 Wails 原生接口适配 macOS 登录项、Windows 当前用户启动项和 Linux XDG 桌面自启动；不需要管理员权限。关闭后后续启动保留选择，在系统设置中关闭也不会被应用重新开启。「恢复默认值」会重新开启。开发预览和无界面服务版不注册自启动，系统拒绝注册时会显示失败原因。

## 项目结构

```
.
├── main.go                       # Wails v3 应用入口
├── assets.go                     # 嵌入前端、图标、初始化脚本与安装包，传入应用层
├── build.py                      # 一键构建、打包、安装并启动
├── docs/
│   ├── README.md                 # 完整文档索引
│   ├── glossary.md               # 项目术语
│   └── design/                   # 设计规范及按功能归档的验收记录
├── internal/
│   ├── app/                      # 桌面应用层及对应测试（package app）
│   │   ├── app.go                # 共享状态、窗口/菜单/拖放/功能装配
│   │   ├── app_hosts.go           # 主机管理等前端调用接口
│   │   ├── resources.go           # 入口传入的内嵌资源
│   │   └── *_test.go              # 应用层测试，与实现同包
│   ├── sshconfig/                # ~/.ssh/config 解析与回写
│   ├── groups/                   # 分组本地存储（~/Library/Application Support/ServerPanel/groups.json）
│   ├── sshd/                     # SSH 长连接管理
│   ├── monitor/                  # 远程主机监控采集（overview/disks/processes/docker/services）
│   ├── localsys/                 # 本机系统采集（gopsutil 跨平台 + 各平台钩子：darwin / windows / linux）
│   └── localapps/                # 本机应用进程扫描与归并（共享骨架 + 各平台钩子：darwin / windows / linux）
├── frontend/
│   └── src/
│       ├── react/                # React 前端（pages / components / state / lib）
│       ├── api/index.ts          # Wails v3 绑定统一封装（bindings/ 自动生成）
│       └── utils/                # 格式化、剪贴板、echarts 按需注册
└── bin/                          # 构建产物
```

根目录只负责启动和资源嵌入。应用层通过 `app.NewApp(resources)` 接收编译期资源，不依赖启动时的工作目录；底层功能继续放在 `internal/` 对应模块中。Wails 绑定从 `./internal/app` 生成到 `frontend/bindings/diteng-pannel/internal/app/`，前端统一通过 `frontend/src/api/index.ts` 调用。

在项目根目录运行 `go test ./...` 验证全部 Go 包，运行 `go test ./internal/app` 单独验证应用层；macOS 桌面构建运行 `wails3 task darwin:build`。

## 限制

- 桌面端支持 macOS（Apple 芯片 arm64）、Windows 10/11 x64 与 Linux（Debian 13 验证，deb/rpm/AppImage 任务见 build/linux）
- 仅 Debian/Ubuntu 目标机（其他发行版的 `systemctl`、`dpkg-query` 等命令可能不可用）
- 监控采集全部为只读命令，不做任何写操作
- 终端通过系统 `ssh` 二进制启动，依赖本机存在 `ssh`（Windows 为系统 OpenSSH）
- Windows 本机工作区的已知边界：
  - CPU / GPU 温度无统一系统接口，显示为「—」
  - 进程网络收发速率无免管理员接口，应用进程页网络速率列为 0（附提示）；磁盘 IO 速率正常
  - 负载用「处理器队列长度」近似 Unix loadavg（仅 1 分钟值）
  - 磁盘空间扫描不做 NTFS 硬链接去重（稀疏极少见，避免逐文件打开句柄拖慢扫描）
  - Nginx 页在 Windows 上依赖手动安装的 nginx.exe（PATH / 常见目录探测），未安装时提示「未检测到」
- Linux 本机工作区的已知边界：
  - 进程网络速率经 `ss` 的 TCP 连接计数（bytes_acked / bytes_received）差分统计，UDP / ICMP 不计入；缺 iproute2（ss）时网络列显示 0 并提示
  - CPU/GPU 温度走 hwmon，虚拟机 / 无传感器设备显示「—」
  - 软件列表按存在的包管理器展示（dpkg / rpm / pacman / flatpak / snap + 桌面应用）
  - 磁盘空间「应用占用」按 .desktop 入口归并 XDG 数据目录（~/.config、~/.cache、~/.local/share 等），无 bundle 概念

## 初始化脚本

在首页右键目标主机 →「初始化」→「开始初始化」。任务窗口展示目标、安装范围与日志，不切换当前主机或页面。一次安装 [itjun-tools](https://gitee.com/shenzhenitjun/itjun-tools) 的基础软件清单（openssh-server、vim、curl、wget、sudo、tree、ca-certificates），APT 主机另外安装 htop、btop 监控工具，加上 zsh、Git、完整 Oh My Zsh、命令高亮和历史建议；使用 ys 主题，将当前 SSH 登录用户的默认 Shell 设为 zsh，并启用 SSH 开机启动。关闭窗口后任务继续，可右键同一主机重新查看。

支持使用 apt、dnf、yum、apk 的远程 Linux 主机。主机初始化需要 root 或免密 sudo；沿用目标系统现有软件源，不替换为 Debian trixie 源，也不执行整机升级。Alpine 的 SSH 软件包使用 openssh，RPM 与 Alpine 额外补齐 chsh 所需软件。[zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting) 和 [zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions) 使用官方固定版本，随应用内置并校验，目标主机无需访问 GitHub；来源、许可证和校验值见 `scripts/zsh-plugins/`。拼写纠错默认关闭：初始化配置末尾执行 `unsetopt correct correctall`，覆盖 Oh My Zsh 或原配置启用的纠错选项；高亮不保证参数或执行结果正确。APT 遇到其他安装任务持有锁时最多等待 300 秒，索引锁繁忙时自动重试；不会删除锁文件或终止其他升级任务。

`scripts/bootstrap-zsh.sh` 可独立执行。脚本保留原 `.zshrc`（遵循远程环境中的 `ZDOTDIR`），只替换末尾的 1Panel 标记块，插件与配置保存在 `~/.local/share/1panel/zsh/`。完整 Oh My Zsh（全部内置插件、主题、工具）来自官方仓库的固定版本，随应用内置（来源、许可证和校验值见 `scripts/oh-my-zsh/`），通过面板安装框架无需远程访问 GitHub。已有完整框架会复用并避免重复加载，保留原插件列表及个人 PATH；首次安装默认启用 git、svn，高亮和历史建议另外加载。全新用户安装到 `~/.oh-my-zsh/`；该目录已有不完整内容时，保留它并使用 `~/.local/share/1panel/zsh/oh-my-zsh-full/`。独立脚本优先读取相邻的 `oh-my-zsh/oh-my-zsh.tar.gz` 和 `zsh-plugins/` 安装包；没有相邻安装包时才从官方源下载。每次写配置前产生独立备份与 `restore.sh`，语法或主题/功能加载验证失败时自动恢复配置；下载失败时不写入 `.zshrc`。恢复命令会覆盖备份之后的个人配置编辑，不卸载系统软件或插件，也不删除命令历史。

日志只保留当前应用会话中每台主机的最近一次任务（最多 2000 行）；重启面板后仍可从环境检测取到主机上最近的配置恢复命令。任务总时限为 30 分钟，以容纳慢速软件下载与安装锁等待。SSH 中断或超时时，请先在终端确认远端任务状态再重试。

```bash
# scp 到远程后执行
scp scripts/bootstrap-zsh.sh user@host:/tmp/ && ssh user@host 'sh /tmp/bootstrap-zsh.sh --apply --base-packages --default-shell'

# 直接远程拉起（脚本本身不落地）
ssh user@host 'sh -s -- --apply --base-packages --default-shell' < scripts/bootstrap-zsh.sh

# 只读检测；可选参数：--no-highlighting --no-suggestions --no-correction --correction --default-shell --base-packages
ssh user@host 'sh -s -- --inspect' < scripts/bootstrap-zsh.sh
```

真机联调需要显式指定主机，普通 `go test` 不会连接或修改远程主机：

```bash
ONEPANEL_ZSH_LIVE_HOST=template go test ./internal/app -run TestZshLiveHost -v -count=1 -timeout 45m
ssh -T template 'python3 -' < scripts/verify-zsh-pty.py
```

第一项通过真实 `System` 服务验证依赖安装、SFTP 上传、流式日志、并发保护、重复执行、默认 Shell 切换与备份恢复，测试结束后保留 zsh 配置并恢复原登录 Shell。第二项通过远程 PTY 验证命令着色、纠错询问、灰字历史建议和右方向键接受建议，使用临时历史文件，不写入个人命令历史。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

Copyright (c) 2026 黄荣君 (itjun)

## 致谢

本项目的灵感来自 [1Panel](https://1panel.cn/)——一款优秀的开源 Linux 服务器运维管理面板。

感谢 1Panel 团队和社区的开源贡献，为本项目带来了大量启发。
