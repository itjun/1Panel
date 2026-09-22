package main

import (
	"context"
	"sync"
	"time"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/sshconfig"
)

// Icons 主机发行版图标服务
type Icons App

// HostIcon 一台主机的发行版图标记录（给前端侧栏/概览用）
type HostIcon struct {
	Host      string `json:"host"`
	OSRelease string `json:"osRelease"`
	Error     string `json:"error,omitempty"`
}

// ListHostIcons 读取本地已落盘的发行版记录，不访问远程
func (s *Icons) ListHostIcons() []HostIcon {
	if s.hostIcons == nil {
		return []HostIcon{}
	}
	list := s.hostIcons.List()
	out := make([]HostIcon, 0, len(list))
	for _, r := range list {
		out = append(out, HostIcon{Host: r.Host, OSRelease: r.OSRelease})
	}
	return out
}

// RefreshHostIcon 远程探测一台主机的发行版并落盘（强制更新）
func (s *Icons) RefreshHostIcon(host string) (HostIcon, error) {
	osr, err := s.detectOSRelease(host)
	if err != nil {
		return HostIcon{Host: host, Error: err.Error()}, err
	}
	rememberOS(s.hostIcons, host, osr)
	return HostIcon{Host: host, OSRelease: osr}, nil
}

// RefreshMissingHostIcons 只探测还没有图标记录的主机，已有记录直接返回
func (s *Icons) RefreshMissingHostIcons() []HostIcon {
	return s.refreshHostIcons(true)
}

// RefreshAllHostIcons 强制重新探测全部主机并更新记录
func (s *Icons) RefreshAllHostIcons() []HostIcon {
	return s.refreshHostIcons(false)
}

func (s *Icons) refreshHostIcons(onlyMissing bool) []HostIcon {
	var hosts []sshconfig.HostConfig
	var err error
	if a := (*App)(s); a.panelStore != nil {
		hosts, err = a.panelHostConfigs(false)
	} else {
		hosts, err = listNonGitHosts()
	}
	if err != nil {
		return []HostIcon{{Error: err.Error()}}
	}

	existing := map[string]string{}
	if s.hostIcons != nil {
		for _, r := range s.hostIcons.List() {
			if r.OSRelease != "" {
				existing[r.Host] = r.OSRelease
			}
		}
	}

	var todo []sshconfig.HostConfig
	out := make([]HostIcon, 0, len(hosts))
	for _, h := range hosts {
		if onlyMissing {
			if osr, ok := existing[h.Name]; ok {
				out = append(out, HostIcon{Host: h.Name, OSRelease: osr})
				continue
			}
		}
		todo = append(todo, h)
	}

	detected := detectOSReleaseParallel(s, todo, 5)
	for _, it := range detected {
		if it.OSRelease == "" {
			if old, ok := existing[it.Host]; ok && it.Error != "" {
				// 强制刷新失败时保留旧记录，避免图标被清空
				it.OSRelease = old
			}
		}
		out = append(out, it)
	}
	return out
}

// detectOSRelease 探测主机发行版（用于图标）。已装 agent 的主机走 agent 隧道
// （零 SSH 命令）；agent 不可达（未安装/未运行）时回退原有 SSH 探测。
func (s *Icons) detectOSRelease(host string) (string, error) {
	if cli, err := s.agentPool.Get(host); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		var cur agentcli.CurrentResponse
		if err := cli.GetJSON(ctx, "/metrics/current", &cur); err == nil && cur.Info.OSRelease != "" {
			return cur.Info.OSRelease, nil
		}
	}
	opt, err := (*App)(s).connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return s.collector.DetectOSRelease(host, opt)
}

func detectOSReleaseParallel(s *Icons, hosts []sshconfig.HostConfig, limit int) []HostIcon {
	if len(hosts) == 0 {
		return []HostIcon{}
	}
	if limit <= 0 {
		limit = 5
	}
	results := make([]HostIcon, len(hosts))
	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup
	for i, h := range hosts {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int, host sshconfig.HostConfig) {
			defer wg.Done()
			defer func() { <-sem }()
			osr, err := s.detectOSRelease(host.Name)
			it := HostIcon{Host: host.Name, OSRelease: osr}
			if err != nil {
				it.Error = err.Error()
			} else if osr != "" {
				// 探测成功立刻落盘并通知前端，首启补齐时图标会逐台出现
				rememberOS(s.hostIcons, host.Name, osr)
			}
			results[idx] = it
		}(i, h)
	}
	wg.Wait()
	return results
}
