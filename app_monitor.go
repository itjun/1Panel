package main

import (
	"fmt"
	"path"
	"strings"

	"diteng-pannel/internal/monitor"
)

// Monitor 监控采集服务（只读）
type Monitor App

// ============ 监控采集（只读） ============

// CollectOverview 采集顶层系统指标（按需/手动刷新，不做秒级轮询落盘）
func (s *Monitor) CollectOverview(host string) (monitor.Overview, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return monitor.Overview{}, err
	}
	ov, err := s.collector.CollectOverview(host, opt)
	if err != nil {
		return ov, err
	}
	// 首次访问或概览刷新时顺手记下发行版，避免下次启动再远程探测
	rememberOS(s.hostIcons, host, ov.OSRelease)
	return ov, nil
}

func (s *Monitor) CollectDisks(host string) ([]monitor.DiskInfo, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return s.collector.CollectDisks(host, opt)
}

// CollectLargestFiles 异步场景：扫描指定挂载点 Top N 大文件（可能较慢，勿阻塞 UI）
func (s *Monitor) CollectLargestFiles(host, root string, limit int) (monitor.LargeFilesResult, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return monitor.LargeFilesResult{}, err
	}
	return s.collector.CollectLargestFiles(host, opt, root, limit)
}

func (s *Monitor) CollectProcesses(host string, limit int) ([]monitor.ProcInfo, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return s.collector.CollectProcesses(host, opt, limit)
}

func (s *Monitor) CollectJava(host string) ([]monitor.ProcInfo, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return s.collector.CollectJava(host, opt)
}

// CollectRuntimeProcs 采集指定运行时（java/go/node/bun/python）的进程列表
// 含部署方式/端口/入口（jar/脚本/可执行文件），进程页各运行时视图主列表
func (s *Monitor) CollectRuntimeProcs(host, runtime string) ([]monitor.RuntimeProc, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return s.collector.CollectRuntimeProcs(host, runtime, opt)
}

// CollectRuntimeCounts 各运行时（java/go/node/bun/python）正在运行的进程数
// 进程页顶部标签的数字徽标，轻量轮询
func (s *Monitor) CollectRuntimeCounts(host string) (monitor.RuntimeCounts, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return monitor.RuntimeCounts{}, err
	}
	return s.collector.CollectRuntimeCounts(host, opt)
}

// CollectJavaProcDetail 单个 Java 进程的补充详情（悬浮卡片按需查询）
func (s *Monitor) CollectJavaProcDetail(host string, pid uint32) (monitor.JavaProcDetail, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return monitor.JavaProcDetail{}, err
	}
	return s.collector.CollectJavaProcDetail(host, pid, opt)
}

// CollectNetwork 网卡 / IP 分类 / TCP 连接 / 疑似卡顿连接
func (s *Monitor) CollectNetwork(host string) (monitor.NetworkSnapshot, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return monitor.NetworkSnapshot{}, err
	}
	return s.collector.CollectNetwork(host, opt)
}

func (s *Monitor) CollectDocker(host string) (monitor.DockerInfo, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return monitor.DockerInfo{}, err
	}
	return s.collector.CollectDocker(host, opt)
}

func (s *Monitor) CollectServices(host string) ([]monitor.Service, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return s.collector.CollectServices(host, opt)
}

func (s *Monitor) CollectCrons(host string) ([]monitor.Cron, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return s.collector.CollectCrons(host, opt)
}

// CollectRuntimes 识别常用运行环境版本（java/go/python/node/bun）
func (s *Monitor) CollectRuntimes(host string) ([]monitor.RuntimeInfo, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return s.collector.CollectRuntimes(host, opt)
}

func (s *Monitor) CollectPackages(host string) ([]monitor.AptPackage, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return s.collector.CollectPackages(host, opt)
}

// ============ 文件浏览（只读） ============

// GetHomeDir 返回远程登录用户的家目录（$HOME）。
// 文件管理器默认打开此路径，而不是系统根 /。
// 远程查询失败时按 SSH User 回退：root → /root，其它 → /home/<user>。
func (s *Monitor) GetHomeDir(host string) (string, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return fallbackHomeDir(opt.User), err
	}
	out, err := s.sshMgr.Run(host, opt, `printf '%s' "$HOME"`)
	home := strings.TrimSpace(string(out))
	if err == nil && home != "" && strings.HasPrefix(home, "/") {
		// 去掉多余尾部斜杠（根目录本身除外）
		if len(home) > 1 {
			home = strings.TrimRight(home, "/")
		}
		return home, nil
	}
	return fallbackHomeDir(opt.User), nil
}

func fallbackHomeDir(user string) string {
	u := strings.TrimSpace(user)
	if u == "" || u == "root" {
		return "/root"
	}
	return "/home/" + u
}

// ListDir 列出远程主机某目录下的内容（只读，不修改）
func (s *Monitor) ListDir(host, dir string) ([]monitor.FileEntry, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return nil, err
	}
	return s.collector.ListDir(host, opt, dir)
}

// ReadFileText 读远程文本文件内容（最多 512KB，只读）
func (s *Monitor) ReadFileText(host, file string) (string, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return s.collector.ReadFileText(host, opt, file, 512*1024)
}

// CollectLog 读取指定类型日志的末尾 N 行
// logType: system / auth / kernel / nginx_access / nginx_error
func (s *Monitor) CollectLog(host, logType string, lines int) (monitor.LogResult, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return monitor.LogResult{}, err
	}
	return s.collector.CollectLog(host, logType, opt, lines)
}

// CollectCerts 识别远程主机 /etc/nginx/cert 下的证书（目录不存在时 installed=false）
func (s *Monitor) CollectCerts(host string) (monitor.CertListResult, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return monitor.CertListResult{}, err
	}
	return s.collector.CollectCerts(host, opt)
}

// CollectServiceDetail 查询单个 systemd 服务的详情（服务页悬浮卡片按需调用）
func (s *Monitor) CollectServiceDetail(host, name string) (monitor.ServiceDetail, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return monitor.ServiceDetail{}, err
	}
	return s.collector.CollectServiceDetail(host, name, opt)
}

// ============ 远程操作（写操作） ============

// DeletePaths 删除远程主机上的多个文件或目录（递归，不可恢复）
// 路径必须是绝对路径；系统根目录（/、/etc、/usr 等）禁止删除
func (s *Monitor) DeletePaths(host string, paths []string) (string, error) {
	if len(paths) == 0 {
		return "", fmt.Errorf("未选择任何文件")
	}
	opt, err := connectOptionFor(host)
	if err != nil {
		return "", err
	}
	// 系统根目录黑名单：禁止删除这些目录本身（其下的子目录可正常删）
	systemRoots := map[string]bool{
		"/": true, "/bin": true, "/boot": true, "/dev": true,
		"/etc": true, "/home": true, "/lib": true, "/lib64": true,
		"/opt": true, "/proc": true, "/root": true, "/sbin": true,
		"/sys": true, "/usr": true, "/var": true,
	}
	args := make([]string, 0, len(paths))
	for _, p := range paths {
		c := path.Clean(p)
		if !strings.HasPrefix(c, "/") {
			return "", fmt.Errorf("路径必须为绝对路径: %s", p)
		}
		// 单引号包裹防 shell 注入；含单引号的路径直接拒绝
		if strings.Contains(c, "'") {
			return "", fmt.Errorf("路径含非法字符: %s", p)
		}
		if systemRoots[c] {
			return "", fmt.Errorf("禁止删除系统目录: %s", c)
		}
		args = append(args, "'"+c+"'")
	}
	cmd := "rm -rf " + strings.Join(args, " ")
	out, err := s.sshMgr.Run(host, opt, cmd)
	if err != nil {
		return string(out), fmt.Errorf("删除失败: %w", err)
	}
	return string(out), nil
}

// KillProcess 在远程主机上杀掉指定 PID
func (s *Monitor) KillProcess(host string, pid uint32, force bool) error {
	opt, err := connectOptionFor(host)
	if err != nil {
		return err
	}
	sig := "TERM"
	if force {
		sig = "KILL"
	}
	cmd := fmt.Sprintf("kill -%s %d 2>&1 || true", sig, pid)
	_, err = s.sshMgr.Run(host, opt, cmd)
	return err
}

// ============ Docker 操作 ============

// DockerAction 对容器执行 start/stop/restart 等操作
func (s *Monitor) DockerAction(host string, action string, container string) (string, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return "", err
	}
	// action 仅允许白名单
	switch action {
	case "start", "stop", "restart", "pause", "unpause":
	default:
		return "", fmt.Errorf("不支持的 docker 操作: %s", action)
	}
	cmd := fmt.Sprintf("docker %s %s 2>&1", action, container)
	out, err := s.sshMgr.Run(host, opt, cmd)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// DockerInspect 查询单个容器的 docker inspect 原始 JSON（Docker 页悬浮卡片按需调用）
func (s *Monitor) DockerInspect(host string, container string) (string, error) {
	opt, err := connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return s.collector.CollectDockerInspect(host, container, opt)
}
