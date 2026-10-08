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
  - macOS：经 Ghostty（`ghostty://open`）打开
  - Windows：默认用 Windows Terminal（`wt.exe`）在最近使用的窗口新建标签页（可设置为新窗口），由系统 OpenSSH（`ssh.exe`）按本机 SSH 配置连接；Windows Terminal 缺失时自动降级为 PowerShell 窗口，OpenSSH 缺失时给出安装指引

## 开发

依赖：Go 1.26+、Node 22+（Vite 8 要求）、Wails v3 CLI 与 task CLI。

```bash
# 安装 Wails CLI（首次）
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.14
go install github.com/go-task/task/v3/cmd/task@latest

# 开发模式（热重载）
task dev

# 构建 + 打包 .app（macOS 只发布 arm64）
task darwin:package
```

> **版本对齐**：Wails CLI（`wails3`）、`go.mod` 中的 `github.com/wailsapp/wails/v3`、前端 `@wailsio/runtime` 必须同一版本（当前以 `go.mod` 为准）。不要自行升 beta；漂移时用 `task wails:check` 检查。

构建产物：`build/bin/1Panel.app`（macOS）/ `build/bin/1Panel.exe`（Windows）。

## 分发

### 下载

执行 `scripts/release.sh vX.Y.Z -F notes.md`（打附注 tag → 推送 → `gh run watch` 等 CI → 校验清单），GitHub Actions 构建三个平台并用 `gh` 发布到 **GitHub Releases**（页面右侧 Releases）。Release 同时是应用内更新源，客户端读取最新正式版里的签名清单 `latest.json`：

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

- **后端**：Go 1.26+、Wails v3、`golang.org/x/crypto/ssh`
- **前端**：React 19、TypeScript、Tailwind CSS 4（自研 TDesign 风格组件）、xterm.js、ECharts
- **本机采集**：macOS 走 sysctl/libproc 等；Windows 走 `NtQuerySystemInformation`、注册表、IP Helper（`GetAdaptersAddresses` / `GetExtendedTcpTable`）等系统 API
- **目标主机**：通过系统 `ssh` 二进制建立长连接，运行只读采集命令（`/proc/*`、`free`、`df`、`ps`、`systemctl`、`crontab -l`、`docker ps/stats` 等）

## Agent 部署

单机监控依赖目标主机上的 spanel-agent，由面板经 SSH 一键安装。安装时自动判断运行方式：有 systemd 的主机注册为 systemd 服务；容器、OpenRC 等无 systemd 的主机改用自带守护进程（SSH 断开后保持运行、退出自动重启）。普通用户登录时自动用 sudo 提权。两种方式的差异、资源限制、自启能力与排查方法见 [docs/agent-deployment.md](docs/agent-deployment.md)。

## 关于与版本信息

设置页最后一项「关于」展示应用图标、应用名、版权、当前版本（构建时经 `git describe` 注入：tag 优先，无 tag 用提交短 SHA）、构建提交（本地 `go build` 默认写入 VCS 信息）、系统与架构、内置 spanel-agent 版本，并提供源码仓库 / 发布页（检查更新）/ 问题反馈链接（系统浏览器打开）。

## 项目结构

```
.
├── main.go                       # Wails v3 应用入口
├── app.go                        # 应用核心（窗口/菜单/拖放/服务装配）
├── groups.go                     # Groups 服务（分组增删改查/分配）
├── group_overview.go             # Overview 服务（分组概览并发采集）
├── helpers.go                    # CopyIDInput 等辅助类型
├── internal/
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
└── build/bin/                    # 构建产物
```

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

`scripts/bootstrap-zsh.sh` —— 一键在远程 Debian/Ubuntu 主机上初始化 zsh 环境：安装 zsh、Oh My Zsh、ys 主题、代码高亮插件（zsh-syntax-highlighting）、历史提示插件（zsh-autosuggestions），写入 `.zshrc` 并切换默认 shell。脚本幂等，可重复执行；下载的 install.sh 临时文件在任何退出情况下都会自动清理。

```bash
# scp 到远程后执行
scp scripts/bootstrap-zsh.sh user@host:/tmp/ && ssh user@host 'bash /tmp/bootstrap-zsh.sh'

# 直接远程拉起（脚本本身不落地）
ssh user@host 'bash -s' < scripts/bootstrap-zsh.sh
```

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

Copyright (c) 2026 黄荣君 (itjun)

## 致谢

本项目的灵感来自 [1Panel](https://1panel.cn/)——一款优秀的开源 Linux 服务器运维管理面板。

感谢 1Panel 团队和社区的开源贡献，为本项目带来了大量启发。
