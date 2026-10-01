# spanel-agent 部署说明

面板通过 SSH 把内置的 spanel-agent 部署到目标主机，用于采集监控数据。安装时会自动判断目标主机的启动方式，分成两种部署形态：**systemd 方式**和**守护进程方式**。两种方式对使用者透明，只有资源限制和重启后的自启能力有差别。

## 自动判断规则

安装前的探测脚本检查 `/run/systemd/system` 是否存在：

- 存在：PID 1 是 systemd，使用 **systemd 方式**。
- 不存在：容器（PID 1 为 tini、dumb-init、sh 等）、OpenRC（Alpine）、sysvinit 等，使用 **守护进程方式**。

> 只检查有没有 `systemctl` 命令不够：很多容器镜像里有 `systemctl`，但 systemd 并没有运行，执行时会报 `System has not been booted with systemd as init system (PID 1)`。

## 两种方式对比

| | systemd 方式 | 守护进程方式 |
|---|---|---|
| 适用主机 | 普通物理机、云主机、虚拟机 | 容器、OpenRC、sysvinit、其他无 systemd 环境 |
| 进程管理 | systemd unit `spanel-agent.service` | `spanel-agent-ctl _loop` 守护循环，经 `setsid nohup` 脱离 SSH 会话 |
| 退出后重启 | `Restart=always`，3 秒后重启 | 守护循环 3 秒后重启 |
| SSH 断开后 | 不受影响 | 不受影响（守护循环在独立会话中，不会收到 SIGHUP） |
| 开机 / 容器重启后自启 | `systemctl enable` | 有 OpenRC：`/etc/local.d/spanel-agent.start`；有 crontab：`@reboot` 和每分钟 `ensure`；都没有：等面板补拉起 |
| CPU 限制 | `CPUQuota=25%`（硬上限） | 无硬上限；用 `nice -n 10`，可用时再加 `ionice -c3` |
| 内存限制 | `MemoryMax=96M`（硬上限）+ `GOMEMLIMIT=64MiB` | 只有 `GOMEMLIMIT=64MiB`（Go 运行时软上限） |
| OOM 优先级 | `OOMScoreAdjust=500` | 守护循环写入 `/proc/self/oom_score_adj = 500`，Agent 继承 |
| 日志 | `journalctl -u spanel-agent` | `/var/lib/spanel-agent/agent.log`，超过 5MB 自动清空 |
| 状态判断 | `systemctl is-active spanel-agent` | 守护循环和 Agent 进程都在才算 `active` |

## 远端文件布局

| 路径 | 说明 | 方式 |
|---|---|---|
| `/usr/local/bin/spanel-agent` | Agent 二进制（root:root 0755） | 两种 |
| `/usr/local/bin/spanel-agent.old` | 上一版本，回滚用 | 两种 |
| `/usr/local/bin/spanel-agent-ctl` | 统一控制脚本，脚本内的 `MODE=` 记录运行方式 | 两种 |
| `/var/lib/spanel-agent/` | 数据目录（root 0700）：`agent.db`、`token` 等 | 两种 |
| `/etc/systemd/system/spanel-agent.service` | systemd unit | systemd |
| `/run/spanel-agent.pid` | 守护循环 PID（0644，`/run` 不存在时为 `/var/run`） | 守护进程 |
| `/var/lib/spanel-agent/agent.log` | Agent 输出日志 | 守护进程 |
| root crontab 中带 `# spanel-agent` 标记的两行 | `@reboot` 和每分钟 `ensure` | 守护进程（有 crontab 时） |
| `/etc/local.d/spanel-agent.start` | OpenRC 开机启动 | 守护进程（有 OpenRC 时） |

## 控制脚本 spanel-agent-ctl

面板的启动、停止、查状态、补拉起都只调用这个脚本，不直接调用 `systemctl`。排查问题时也可以在目标机上手动执行：

```bash
sudo spanel-agent-ctl status           # 输出 active / inactive（普通用户也可执行）
sudo spanel-agent-ctl start            # 启动（已在运行则重启）
sudo spanel-agent-ctl stop             # 停止
sudo spanel-agent-ctl ensure           # 未运行才启动；输出 ok 或 started
sudo spanel-agent-ctl install-hooks    # 守护进程方式：挂 cron / OpenRC 自启
sudo spanel-agent-ctl uninstall-hooks  # 删除 cron / OpenRC 自启
```

脚本由面板生成，每次安装或更新都会覆盖，不要手工修改。

## 注意事项

### 权限：普通用户自动用 sudo

安装、回滚、卸载和读取 token 都需要 root。面板按以下顺序自动提权（`sshd.Manager.RunAsRoot`）：

1. 登录用户已经是 root：直接执行。
2. 配置了免密 sudo：用 `sudo -n`。
3. 面板保存了该主机的密码：用 `sudo -S`，密码经标准输入传入，不出现在远端进程列表里。
4. 以上都不行：报错，并提示「配置免密 sudo / 在主机设置里填写密码 / 改用 root 登录」三种解决办法。

只用公钥登录、面板里没存密码的普通用户，需要在目标机配置免密 sudo，例如：

```bash
echo 'box ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/box
```

### 守护进程方式没有硬资源限制

没有 cgroup，CPU 和内存无法像 systemd 那样硬封顶，只能靠降低优先级、Go 内存软上限、提高 OOM 优先级来约束。Agent 自身持续采集的 CPU 占用低于 0.1%，按需采集（进程列表、Docker 等）会短暂升高。对资源特别敏感的容器，应在容器层面（`docker run --cpus/--memory`）设置限制。

### 容器重启后的自启

- 守护循环是普通后台进程，容器重启后不会自动恢复。
- 镜像里有 crontab **并且 crond 在运行**时，`@reboot` 和每分钟 `ensure` 会把它拉起来。只装了 crontab 命令、crond 没在运行时，这两条不会生效。
- 两者都没有时，依赖**面板补拉起**：面板查询 Agent 状态发现连不上，就通过 SSH 执行一次 `spanel-agent-ctl ensure`（每台主机 2 分钟内最多一次，需要时自动 sudo）。在面板访问这台主机之前，监控数据会缺失。
- 容器被删除后重建（不是重启）时，容器内的文件全部丢失，需要在面板里重新安装 Agent。

### 安装失败与回滚

- 安装后会先确认服务进入 `active`，再通过 SSH 隧道请求 `/health` 核对版本号。任一步失败都会用 `spanel-agent.old` 自动回滚。
- 守护进程方式下，二进制损坏导致 Agent 反复崩溃时，`status` 会报 `inactive`，从而触发回滚。不会出现守护循环活着就被误判为健康的情况。

### 卸载

卸载会停止服务、删除 cron / OpenRC 自启、删除二进制、控制脚本、unit 和 pid 文件。选择「保留数据」时保留 `/var/lib/spanel-agent/`，重装后可以继续查看历史数据。

### 兼容旧版本安装

引入 `spanel-agent-ctl` 之前装的主机没有控制脚本。面板在没有 ctl 时自动退回 `systemctl` 命令；在面板里点一次「更新 Agent」即可补上控制脚本。

### 不支持的情况

- 非 Linux 系统（探测到 `uname -s` 不是 Linux 时阻止安装）。
- 数据分区剩余空间低于 5% 或 64MB、`/tmp` 剩余低于 32MB、可用内存低于 96MB 时阻止安装，提示先清理。

## 排查

```bash
# 判断运行方式
[ -d /run/systemd/system ] && echo systemd || echo supervisor
grep '^MODE=' /usr/local/bin/spanel-agent-ctl

# 查看状态和进程
spanel-agent-ctl status
ps -eo pid,ppid,sid,etime,args | grep '[s]panel-agent'

# 查看日志
journalctl -u spanel-agent -n 50                 # systemd 方式
sudo tail -n 50 /var/lib/spanel-agent/agent.log  # 守护进程方式

# 查看 cron 自启（守护进程方式）
sudo crontab -l | grep spanel-agent
```

## 相关代码

- `internal/agentinstall/runctl.go`：控制脚本模板与运行方式常量
- `internal/agentinstall/install.go`：探测、安装、回滚、卸载
- `internal/agentcli/client.go`：token 读取与面板补拉起（`Pool.tryHeal`）
- `internal/sshd/run.go`：`RunAsRoot` 自动提权
- `cmd/agentinstall-test`：端到端联调，`SPANEL_TEST_ADDR=user@ip go run ./cmd/agentinstall-test <别名>`
