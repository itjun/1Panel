package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/aptsource"
	"diteng-pannel/internal/monitor"
)

// Monitor 监控采集服务（只读）。
// 全部数据经 SSH 隧道读取目标主机上的 spanel-agent（HTTP over direct-tcpip），
// 面板不再经 SSH 频繁执行采集命令；方法签名与返回结构与历史版本保持一致，前端零改动。
type Monitor App

// agentClient 取主机的 agent 客户端（连接配置错误时直接报错）。
// 已确认未安装的主机直接返回，避免分组轮询反复 SSH。
func (s *Monitor) agentClient(host string) (*agentcli.Client, error) {
	st := s.agentPool.Status(host, false)
	if st.NotInstalled {
		return nil, agentcli.ErrNotInstalled
	}
	return s.agentPool.Get(host)
}

// q 拼 /collect 查询串（路径/容器名等含特殊字符时正确编码）
func q(kv ...string) string {
	v := url.Values{}
	for i := 0; i+1 < len(kv); i += 2 {
		v.Set(kv[i], kv[i+1])
	}
	return v.Encode()
}

// ============ 监控采集（只读，agent 本地执行） ============

// CollectOverview 顶层系统指标：agent 持续采集的最新采样 + 静态信息，读库零命令
func (s *Monitor) CollectOverview(host string) (monitor.Overview, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.Overview{}, err
	}
	var cur agentcli.CurrentResponse
	if err := cli.GetJSON(context.Background(), "/metrics/current", &cur); err != nil {
		return monitor.Overview{}, err
	}
	ov := overviewFromAgent(cur)
	// 首次访问或概览刷新时顺手记下发行版，避免下次启动再远程探测
	rememberOS(s.hostIcons, host, ov.OSRelease)
	return ov, nil
}

// overviewFromAgent 把 agent 的 current 响应折算回 monitor.Overview（前端结构不变）
func overviewFromAgent(c agentcli.CurrentResponse) monitor.Overview {
	m, i := c.Metrics, c.Info
	ov := monitor.Overview{
		CPUPercent:     m.CPUPercent,
		MemTotal:       m.MemTotal,
		MemUsed:        m.MemUsed,
		SwapTotal:      m.SwapTotal,
		SwapUsed:       m.SwapUsed,
		Load1:          m.Load1,
		Load5:          m.Load5,
		Load15:         m.Load15,
		Uptime:         i.Uptime,
		Kernel:         i.Kernel,
		OSRelease:      i.OSRelease,
		CPUCount:       i.CPUCount,
		CPUModel:       i.CPUModel,
		Hostname:       i.Hostname,
		Arch:           i.Arch,
		IPAddress:      i.IPAddress,
		NetRxBytes:     m.NetRxBytes,
		NetTxBytes:     m.NetTxBytes,
		DiskReadBytes:  m.DiskReadBytes,
		DiskWriteBytes: m.DiskWriteBytes,
		DiskIOCount:    m.DiskIOCount,
	}
	if m.MemTotal > 0 {
		ov.MemPercent = float64(m.MemUsed) / float64(m.MemTotal) * 100
	}
	if m.SwapTotal > 0 {
		ov.SwapPercent = float64(m.SwapUsed) / float64(m.SwapTotal) * 100
	}
	return ov
}

// CollectDisks 磁盘分区列表
func (s *Monitor) CollectDisks(host string) ([]monitor.DiskInfo, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []monitor.DiskInfo
	err = cli.GetJSON(context.Background(), "/collect/disks", &v, true)
	return v, err
}

// CollectLargestFiles 扫描指定挂载点 Top N 大文件（可能较慢，勿阻塞 UI）
func (s *Monitor) CollectLargestFiles(host, root string, limit int) (monitor.LargeFilesResult, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.LargeFilesResult{}, err
	}
	var v monitor.LargeFilesResult
	err = cli.GetJSON(context.Background(),
		"/collect/largest-files?"+q("root", root, "limit", fmt.Sprint(limit)), &v, true)
	return v, err
}

// CollectProcesses 进程列表（CPU 排序 Top N）
func (s *Monitor) CollectProcesses(host string, limit int) ([]monitor.ProcInfo, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []monitor.ProcInfo
	err = cli.GetJSON(context.Background(),
		"/collect/processes?limit="+fmt.Sprint(limit), &v, true)
	return v, err
}

// CollectJava Java 进程列表
func (s *Monitor) CollectJava(host string) ([]monitor.ProcInfo, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []monitor.ProcInfo
	err = cli.GetJSON(context.Background(), "/collect/java", &v, true)
	return v, err
}

// CollectRuntimeProcs 指定运行时（java/go/node…）的进程列表
func (s *Monitor) CollectRuntimeProcs(host, runtime string) ([]monitor.RuntimeProc, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []monitor.RuntimeProc
	err = cli.GetJSON(context.Background(), "/collect/runtime-procs?runtime="+runtime, &v, true)
	return v, err
}

// CollectRuntimeCounts 各运行时进程计数
func (s *Monitor) CollectRuntimeCounts(host string) (monitor.RuntimeCounts, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.RuntimeCounts{}, err
	}
	var v monitor.RuntimeCounts
	err = cli.GetJSON(context.Background(), "/collect/runtime-counts", &v, true)
	return v, err
}

// CollectJavaProcDetail 单个 Java 进程详情（jstack/jmap 摘要）
func (s *Monitor) CollectJavaProcDetail(host string, pid uint32) (monitor.JavaProcDetail, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.JavaProcDetail{}, err
	}
	var v monitor.JavaProcDetail
	err = cli.GetJSON(context.Background(),
		"/collect/java-proc-detail?pid="+fmt.Sprint(pid), &v, true)
	return v, err
}

// CollectNetwork 网络快照（网卡/连接/监听端口）
func (s *Monitor) CollectNetwork(host string) (monitor.NetworkSnapshot, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.NetworkSnapshot{}, err
	}
	var v monitor.NetworkSnapshot
	err = cli.GetJSON(context.Background(), "/collect/network", &v, true)
	return v, err
}

// CollectHosts 目标主机 /etc/hosts（只读，解析后条目 + 原文）
func (s *Monitor) CollectHosts(host string) (monitor.HostsInfo, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.HostsInfo{}, err
	}
	var v monitor.HostsInfo
	err = cli.GetJSON(context.Background(), "/collect/hosts", &v, true)
	return v, err
}

// CollectDocker Docker 容器列表与 stats
func (s *Monitor) CollectDocker(host string) (monitor.DockerInfo, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.DockerInfo{}, err
	}
	var v monitor.DockerInfo
	err = cli.GetJSON(context.Background(), "/collect/docker", &v, true)
	return v, err
}

// CollectServices systemd 服务列表
func (s *Monitor) CollectServices(host string) ([]monitor.Service, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []monitor.Service
	err = cli.GetJSON(context.Background(), "/collect/services", &v, true)
	return v, err
}

// CollectCrons 定时任务列表
func (s *Monitor) CollectCrons(host string) ([]monitor.Cron, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []monitor.Cron
	err = cli.GetJSON(context.Background(), "/collect/crons", &v, true)
	return v, err
}

// CollectRuntimes 运行时版本（java/go/node/python…）
func (s *Monitor) CollectRuntimes(host string) ([]monitor.RuntimeInfo, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []monitor.RuntimeInfo
	err = cli.GetJSON(context.Background(), "/collect/runtimes", &v, true)
	return v, err
}

// CollectPackages apt 包列表（重查询）
func (s *Monitor) CollectPackages(host string) ([]monitor.AptPackage, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []monitor.AptPackage
	err = cli.GetJSON(context.Background(), "/collect/packages", &v, true)
	return v, err
}

// CollectPackageDepends 单个软件包的直接依赖名列表（按需查询，兼容旧 agent 列表无 depList）
func (s *Monitor) CollectPackageDepends(host, pkgName string) ([]string, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []string
	err = cli.GetJSON(context.Background(), "/collect/package-depends?"+q("name", pkgName), &v, true)
	return v, err
}

// ============ 文件浏览（只读） ============

// GetHomeDir 返回远程登录用户的家目录（$HOME）。
// 文件管理器默认打开此路径；agent 以 root 运行时即 /root。
func (s *Monitor) GetHomeDir(host string) (string, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return "", err
	}
	var r struct {
		Home string `json:"home"`
	}
	if err := cli.GetJSON(context.Background(), "/collect/home-dir", &r); err != nil {
		return "", err
	}
	home := strings.TrimSpace(r.Home)
	if home == "" || !strings.HasPrefix(home, "/") {
		return "/root", nil
	}
	if len(home) > 1 {
		home = strings.TrimRight(home, "/")
	}
	return home, nil
}

// ListDir 列出远程主机某目录下的内容（只读，不修改）
func (s *Monitor) ListDir(host, dir string) ([]monitor.FileEntry, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return nil, err
	}
	var v []monitor.FileEntry
	err = cli.GetJSON(context.Background(), "/collect/dir?"+q("path", dir), &v, true)
	return v, err
}

// ReadFileText 读远程文本文件内容（最多 512KB，只读）
func (s *Monitor) ReadFileText(host, file string) (string, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return "", err
	}
	// agent 端此端点返回纯 string（文件内容）
	var content string
	err = cli.GetJSON(context.Background(), "/collect/file-text?"+q("path", file), &content, true)
	return content, err
}

// CollectLog 读取指定类型日志的末尾 N 行
// logType: system / auth / kernel / nginx_access / nginx_error
func (s *Monitor) CollectLog(host, logType string, lines int) (monitor.LogResult, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.LogResult{}, err
	}
	var v monitor.LogResult
	err = cli.GetJSON(context.Background(),
		"/collect/logs?type="+logType+"&lines="+fmt.Sprint(lines), &v, true)
	return v, err
}

// CollectCertCheck 读取 spanel-agent 留下的证书日检快照（不在面板侧临时扫 openssl）。
// 旧版 agent 没有该端点时返回错误，调用方应跳过，不要当成「没有证书」。
func (s *Monitor) CollectCertCheck(host string) (agentcli.CertCheckSnapshot, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return agentcli.CertCheckSnapshot{}, err
	}
	var v agentcli.CertCheckSnapshot
	err = cli.GetJSON(context.Background(), "/collect/cert-check", &v, false)
	return v, err
}

// CollectCerts 识别远程主机 /etc/nginx/cert 下的证书（目录不存在时 installed=false）
func (s *Monitor) CollectCerts(host string) (monitor.CertListResult, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.CertListResult{}, err
	}
	var v monitor.CertListResult
	err = cli.GetJSON(context.Background(), "/collect/certs", &v, true)
	return v, err
}

// CollectServiceDetail 查询单个 systemd 服务的详情（服务页悬浮卡片按需调用）
func (s *Monitor) CollectServiceDetail(host, name string) (monitor.ServiceDetail, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return monitor.ServiceDetail{}, err
	}
	var v monitor.ServiceDetail
	err = cli.GetJSON(context.Background(), "/collect/service-detail?name="+name, &v, true)
	return v, err
}

// ============ 远程操作（写操作，agent 本地执行） ============

// DeletePaths 删除远程主机上的多个文件或目录（递归，不可恢复）。
// 路径必须是绝对路径；系统根目录（/、/etc、/usr 等）禁止删除（agent 侧同样校验）。
func (s *Monitor) DeletePaths(host string, paths []string) (string, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return "", err
	}
	var r struct {
		Output string `json:"output"`
	}
	err = cli.PostJSON(context.Background(), "/op/delete-paths",
		map[string]any{"paths": paths}, &r)
	return r.Output, err
}

// KillProcess 在远程主机上杀掉指定 PID
func (s *Monitor) KillProcess(host string, pid uint32, force bool) error {
	cli, err := s.agentClient(host)
	if err != nil {
		return err
	}
	return cli.PostJSON(context.Background(), "/op/kill",
		map[string]any{"pid": pid, "force": force}, nil)
}

// ============ Docker 操作 ============

// DockerAction 对容器执行 start/stop/restart 等操作
func (s *Monitor) DockerAction(host string, action string, container string) (string, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return "", err
	}
	var r struct {
		Output string `json:"output"`
	}
	err = cli.PostJSON(context.Background(), "/op/docker",
		map[string]any{"action": action, "container": container}, &r)
	return r.Output, err
}

// DockerInspect 查询单个容器的 docker inspect 原始 JSON（Docker 页悬浮卡片按需调用）
func (s *Monitor) DockerInspect(host string, container string) (string, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return "", err
	}
	// agent 端此端点返回纯 string（docker inspect 的 JSON 文本）
	var raw string
	err = cli.GetJSON(context.Background(), "/collect/docker-inspect?"+q("container", container), &raw, true)
	return raw, err
}

// CollectAptSources 远程 /etc/apt 源文件 + 发行版（只读查看）。
func (s *Monitor) CollectAptSources(host string) (aptsource.Snapshot, error) {
	cli, err := s.agentClient(host)
	if err != nil {
		return aptsource.Snapshot{}, err
	}
	var v aptsource.Snapshot
	err = cli.GetJSON(context.Background(), "/collect/apt-sources", &v, true)
	return v, err
}
