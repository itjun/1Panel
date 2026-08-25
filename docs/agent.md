# spanel-agent 架构说明

目标主机常驻的 Go 采集代理。SSH 不再执行任何数据采集命令，只保留：HTTP 隧道通道、终端 PTY、sftp 二进制传输、agent 安装/更新/卸载（一次性管理操作）。

## 架构

```
目标主机（Linux）                              客户端（diteng-pannel 面板）
┌─────────────────────────────────────────┐
│ spanel-agent（systemd 常驻，cgroup 限资源）│
│                                         │    ┌──────────────────────┐
│ ①持续采集：每 5s 直读 /proc（零 fork）     │    │ 概览轮询 + 历史曲线    │
│    Collector → chan → WriteWorker 单写    │    │ 各视图按需采集         │
│    采集路径永不等待网络                    │    │ agent 安装/更新/卸载   │
│                                         │    └──────────┬───────────┘
│ ②SQLite（journal_mode=WAL）              │               │
│    raw_metrics(7天) agg_metrics(90天)     │◄──────────────┘
│    events(30天)   upload_state(预留)      │  HTTP over SSH direct-tcpip
│                                         │  （ssh.Client.Dial，无本地端口）
│ ③本地 HTTP API 127.0.0.1:39190 + Bearer  │
│    读库零命令 + /collect 按需(本地 exec)   │
│    /op 操作端点（杀进程/docker/删文件）    │
│                                         │
│ 00:00 清理：分批 DELETE + checkpoint      │
│ + incremental_vacuum（不卡采集）          │
└─────────────────────────────────────────┘
```

## 目录

| 路径 | 用途 |
|---|---|
| `/usr/local/bin/spanel-agent` | 二进制（`.old` 为更新前的备份） |
| `/var/lib/spanel-agent/agent.db` | SQLite（WAL） |
| `/var/lib/spanel-agent/token` | Bearer token（0600） |
| `/etc/systemd/system/spanel-agent.service` | systemd unit（含资源限制） |

## 开发

```bash
task agent:build   # 源码有改则自动升补丁号，再交叉编译到 internal/agentres/bin
task agent:test    # 构建并部署到 cdcp-beta 联调
go run ./cmd/agenttest cdcp-beta            # 数据面全链路验证（隧道+全部端点）
go run ./cmd/agentinstall-test cdcp-beta    # 安装/更新/回滚链路验证
```

版本号单一来源：`internal/agentres/VERSION`。改 `cmd/spanel-agent` / `internal/agent` 后跑 `task agent:build` 会按源码哈希升补丁号（若已手动改过 VERSION 则不重复加）。`go test ./internal/agentres` 会检查 `SOURCE.sha256` 是否跟上。需要大版本时直接改 `VERSION` 再 build。
## 关键设计

- **WAL**：`journal_mode=WAL` + `synchronous=NORMAL` + `busy_timeout=5000`（DSN 每连接生效）；`auto_vacuum=INCREMENTAL` 建库前设置；writer 独占单连接 + reader 只读连接。
- **采集不等待网络**：tick → 读 /proc → 差分算速率（负 delta 归零防回绕）→ 非阻塞投递 → 返回；HTTP 与未来 Uploader 都是读端。
- **速率 agent 侧算好落库**（netRxKBps 等）：面板离线期间速率不缺失。
- **清理**：每天 00:00，按表 `DELETE ... LIMIT 2000` 循环 + 批间 sleep 200ms；之后 `wal_checkpoint(TRUNCATE)` + `incremental_vacuum`。`POST /admin/cleanup` 可手动触发。
- **聚合**：5 分钟桶，启动补漏；>3h 的查询自动走 agg（>2000 点按 bucket 取模抽样）。
- **磁盘水位**：数据分区剩余 <5%（`-watermark-pct` 可调）停写记事件（保业务），恢复自动续写。已实测：高阈值触发停写→丢弃计数增长→恢复后继续写入。
- **资源硬限制**（systemd）：`CPUQuota=25%`（持续采集 <0.1% CPU；按需命令 fork 的 ps/docker 等子进程同 cgroup，25% 保证秒回且仍是防失控硬顶）`MemoryMax=96M` `Nice=10` `CPUWeight/IOWeight=50` `OOMScoreAdjust=500` + `GOMEMLIMIT=64MiB`。实测稳态 CPU ≈0.02%、RSS 4-12MB。
- **按需采集缓存**（agent 侧，均为惰性缓存）：Go 进程识别（`debug/buildinfo` 纯 Go 实现，15s）、docker stats（CLI 采样周期秒级，15s）、docker ps 容器映射（classifyDeploy 用，15s）、出口 IP（外网请求，10min）。各页面实时性不受影响（容器列表/连接/端口等仍每次实时）。
- **更新**：sftp 上传 → sha256 校验 → `mv` 原子替换（旧版转 `.old`）→ restart → 隧道健康检查版本号；失败自动回滚 `.old`。schema 迁移用 `PRAGMA user_version`，只加不改。
- **批量部署**：面板分组页「批量部署 Agent」→ `AgentBatchInstall`（并发 3 逐台执行，单台失败不影响其余，汇总结果报告）；主机列表有 Agent 状态徽章（版本/可更新/未装）。
- **HTTP API 契约类型**在 `internal/agentcli`（面板侧）与 `internal/agent`（agent 侧）各一份，json tag 保持一致。

## 预留：Uploader

`upload_state` 表（ACK 游标）+ 各表 rowid 天然单调序列。未来启用：按 `id > acked_seq` 分批取行、zstd 压缩、POST 监控服务器、ACK 后删除。上传永远只是 SQLite 的另一个读端。
