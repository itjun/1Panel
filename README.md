# iPannel

一个 macOS 原生的运维管理面板，基于 Wails v2（Go + React + TypeScript）。

读取本机 `~/.ssh/config`，分组管理 SSH 主机，提供：分组概览（卡片 + 发行版 logo + 红/绿预警色）、主机详情（CPU/内存/磁盘/负载/进程/Java/Docker/服务/定时任务/软件包/终端）。

## 功能

- **主机列表**：自动解析 `~/.ssh/config`，过滤 GitHub/Gitee 等 Git 服务条目
- **分组管理**：把主机按项目分组，分组概览页卡片展示，超阈值（CPU>80% / 内存>85% / 磁盘>90% / 负载比>1.0）红色告警
- **主机详情**：
  - 概览：CPU、内存、Swap、磁盘、负载、运行时长、OS 内核版本
  - 进程：可排序/过滤的进程列表（含 PPID、累计时间、命令行）；可单独查看 Java 进程
  - Docker：容器列表 + 实时资源占用，支持启停操作
  - 服务：systemd 运行中的服务
  - 定时任务：用户 crontab、`/etc/crontab`、`/etc/cron.d/*`
  - 软件包：已安装的 apt 包
  - 终端：内嵌 xterm.js + 系统 ssh，可直接敲 Linux 命令
- **添加主机**：输入 IP/用户/密码后自动 `ssh-copy-id` 公钥并回写 `~/.ssh/config`

## 开发

依赖：Go 1.21+、Node 18+、Wails CLI v2。

```bash
# 安装 Wails CLI（首次）
go install github.com/wailsapp/wails/v2/cmd/wails@latest

# 开发模式（热重载）
wails dev

# 构建 .app（仅 Apple Silicon）
wails build -platform darwin/arm64 -clean
```

构建产物：`build/bin/ServerPanel.app`。

## 分发（给同事）

### 同事侧使用步骤

1. **解压 zip**：拿到 `ServerPanel-v1.0-arm64-mac.zip`，双击解压出 `ServerPanel.app`
2. **拖入 `/Applications`**：把 `ServerPanel.app` 拖到「应用程序」文件夹
3. **首次打开**：右键 → 打开（macOS Gatekeeper 会拦未签名应用，普通双击会被拒；右键打开后选「仍要打开」即可，只需做一次）
4. **配置 SSH**：应用读取的是同事本机的 `~/.ssh/config`，请确保：
   - 已生成密钥：`ssh-keygen -t ed25519`（一路回车）
   - `~/.ssh/config` 中已有目标主机配置（`Host`、`HostName`、`User`、`IdentityFile` 等）
   - 已通过 `ssh-copy-id user@host` 把公钥推到目标主机
5. **打开应用**：左侧分组/主机列表会自动加载，点击进入即可

### 安全说明

- 应用**不打包任何 SSH 密钥或证书**——发布包是纯二进制，不含任何 `id_ed25519`、`id_rsa`、`known_hosts` 文件
- 应用运行时只读取同事本机的 `~/.ssh/config`（只读解析），不会上传、不会泄露
- `ssh-copy-id` 流程仅在「添加主机」时由同事主动触发，需要明确输入目标主机的用户/密码

### 系统要求

- macOS 12 Monterey 或更高（Apple Silicon 架构）
- 不支持 Intel Mac（当前仅打 arm64 单架构；如需 Intel 版本请用 `wails build -platform darwin/amd64` 重新构建）
- 目标主机需为 Debian/Ubuntu 系列（其他发行版部分监控字段可能解析失败）

## 技术栈

- **后端**：Go 1.21+、Wails v2、`golang.org/x/crypto/ssh`
- **前端**：React 19、TypeScript、Tailwind CSS、shadcn/ui 风格组件、xterm.js、recharts、TanStack Table v8
- **目标主机**：通过系统 `ssh` 二进制建立长连接，运行只读采集命令（`/proc/*`、`free`、`df`、`ps`、`systemctl`、`crontab -l`、`docker ps/stats` 等）

## 项目结构

```
.
├── main.go                       # Wails 应用入口
├── app.go                        # 后端 API 绑定（前端可调用）
├── group_overview.go             # ListGroupOverview API（分组概览并发采集）
├── helpers.go                    # CopyIDInput 等辅助类型
├── internal/
│   ├── sshconfig/                # ~/.ssh/config 解析与回写
│   ├── groups/                   # 分组本地存储（~/Library/Application Support/ServerPanel/groups.json）
│   ├── sshd/                     # SSH 长连接管理
│   ├── monitor/                  # 监控采集（overview/disks/processes/docker/services）
│   └── terminal/                 # 终端会话管理（spawn 系统 ssh）
├── frontend/
│   └── src/
│       ├── store/app.tsx         # 全局状态：hosts/groups/selection
│       ├── components/
│       │   ├── layout/           # TopBar/Sidebar/MainPane
│       │   ├── overview/         # 概览/服务/定时/软件包 Tab
│       │   ├── processes/        # 进程 Tab
│       │   ├── docker/           # Docker Tab
│       │   ├── terminal/         # 终端 Tab
│       │   ├── group/            # 分组概览卡片网格
│       │   └── common/           # DistroLogo 等公共组件
│       └── hooks/usePolling.ts   # 轮询 Hook
└── build/bin/                    # 构建产物
```

## 限制

- 仅 macOS（Apple Silicon）
- 仅 Debian/Ubuntu 目标机（其他发行版的 `systemctl`、`dpkg-query` 等命令可能不可用）
- 监控采集全部为只读命令，不做任何写操作
- 终端通过系统 `ssh` 二进制启动，依赖本机 PATH 中存在 `ssh`
