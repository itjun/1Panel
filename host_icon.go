package main

import (
	"strings"
	"sync"

	"diteng-pannel/internal/sshconfig"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// HostIcon 一台主机的发行版图标记录（给前端侧栏/概览用）
type HostIcon struct {
	Host      string `json:"host"`
	OSRelease string `json:"osRelease"`
	Error     string `json:"error,omitempty"`
}

// ListHostIcons 读取本地已落盘的发行版记录，不访问远程
func (a *App) ListHostIcons() []HostIcon {
	if a.hostIcons == nil {
		return []HostIcon{}
	}
	list := a.hostIcons.List()
	out := make([]HostIcon, 0, len(list))
	for _, r := range list {
		out = append(out, HostIcon{Host: r.Host, OSRelease: r.OSRelease})
	}
	return out
}

// RefreshHostIcon 远程探测一台主机的发行版并落盘（强制更新）
func (a *App) RefreshHostIcon(host string) (HostIcon, error) {
	osr, err := a.detectOSRelease(host)
	if err != nil {
		return HostIcon{Host: host, Error: err.Error()}, err
	}
	a.rememberOS(host, osr)
	return HostIcon{Host: host, OSRelease: osr}, nil
}

// RefreshMissingHostIcons 只探测还没有图标记录的主机，已有记录直接返回
func (a *App) RefreshMissingHostIcons() []HostIcon {
	return a.refreshHostIcons(true)
}

// RefreshAllHostIcons 强制重新探测全部主机并更新记录
func (a *App) RefreshAllHostIcons() []HostIcon {
	return a.refreshHostIcons(false)
}

func (a *App) refreshHostIcons(onlyMissing bool) []HostIcon {
	hosts, err := a.ListHosts()
	if err != nil {
		return []HostIcon{{Error: err.Error()}}
	}

	existing := map[string]string{}
	if a.hostIcons != nil {
		for _, r := range a.hostIcons.List() {
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

	detected := detectOSReleaseParallel(a, todo, 5)
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

func (a *App) detectOSRelease(host string) (string, error) {
	opt, err := a.connectOptionFor(host)
	if err != nil {
		return "", err
	}
	return a.collector.DetectOSRelease(host, opt)
}

// rememberOS 把发行版写入本地记录，并通知前端即时换图标
func (a *App) rememberOS(host, osRelease string) {
	host = strings.TrimSpace(host)
	osRelease = strings.TrimSpace(osRelease)
	if host == "" || osRelease == "" {
		return
	}
	if a.hostIcons != nil {
		if existing, ok := a.hostIcons.Get(host); ok && existing.OSRelease == osRelease {
			return
		}
		if err := a.hostIcons.Put(host, osRelease); err != nil && a.ctx != nil {
			runtime.LogWarningf(a.ctx, "保存主机图标失败 %s: %v", host, err)
		}
	}
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "host-icon-updated", HostIcon{
			Host:      host,
			OSRelease: osRelease,
		})
	}
}

func detectOSReleaseParallel(a *App, hosts []sshconfig.HostConfig, limit int) []HostIcon {
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
			osr, err := a.detectOSRelease(host.Name)
			it := HostIcon{Host: host.Name, OSRelease: osr}
			if err != nil {
				it.Error = err.Error()
			} else if osr != "" {
				// 探测成功立刻落盘并通知前端，首启补齐时图标会逐台出现
				a.rememberOS(host.Name, osr)
			}
			results[idx] = it
		}(i, h)
	}
	wg.Wait()
	return results
}
