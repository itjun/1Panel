package main

import (
	"sync"

	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
)

// HostOverviewSnapshot 一台主机的概览快照
type HostOverviewSnapshot struct {
	Name     string             `json:"name"`     // Host 别名
	HostName string             `json:"hostName"` // 实际 IP/域名
	User     string             `json:"user"`
	Overview monitor.Overview   `json:"overview"`
	Disks    []monitor.DiskInfo `json:"disks"` // 仅保留根分区一行（用于卡片显示）
	Error    string             `json:"error,omitempty"`
}

// GroupOverview 一个分组的概览数据
type GroupOverview struct {
	GroupID   string                  `json:"groupId"`   // 分组 ID（"__ungrouped__" 表示未分组）
	GroupName string                  `json:"groupName"` // 分组显示名
	Hosts     []HostOverviewSnapshot `json:"hosts"`
}

// ListGroupOverview 采集所有分组的所有主机概览（较慢，慎用）
// 并发上限 5；单台失败不拖垮其它主机
func (a *App) ListGroupOverview() ([]GroupOverview, error) {
	buckets, err := a.buildGroupBuckets()
	if err != nil {
		return nil, err
	}
	out := make([]GroupOverview, 0, len(buckets))
	for _, b := range buckets {
		snapshots := collectHostSnapshotsParallel(a.collector, b.hosts, 5, a.rememberOS)
		out = append(out, GroupOverview{
			GroupID:   b.id,
			GroupName: b.name,
			Hosts:     snapshots,
		})
	}
	return out, nil
}

// ListOneGroupOverview 只采集指定分组，避免「打开一个分组却扫全库」导致长时间加载中
func (a *App) ListOneGroupOverview(groupID string) (GroupOverview, error) {
	buckets, err := a.buildGroupBuckets()
	if err != nil {
		return GroupOverview{}, err
	}
	for _, b := range buckets {
		if b.id == groupID {
			return GroupOverview{
				GroupID:   b.id,
				GroupName: b.name,
				Hosts:     collectHostSnapshotsParallel(a.collector, b.hosts, 5, a.rememberOS),
			}, nil
		}
	}
	return GroupOverview{GroupID: groupID, GroupName: groupID, Hosts: []HostOverviewSnapshot{}}, nil
}

type groupBucket struct {
	id    string
	name  string
	hosts []sshconfig.HostConfig
}

func (a *App) buildGroupBuckets() ([]groupBucket, error) {
	hosts, err := sshconfig.Parse()
	if err != nil {
		return nil, err
	}
	filtered := hosts[:0]
	for _, h := range hosts {
		if !sshconfig.IsGitHost(h) {
			filtered = append(filtered, h)
		}
	}
	hostMap := map[string]sshconfig.HostConfig{}
	for _, h := range filtered {
		hostMap[h.Name] = h
	}

	var gs []groups.Group
	if a.groups != nil {
		gs = a.groups.List()
	}

	var buckets []groupBucket
	assigned := map[string]bool{}
	for _, g := range gs {
		var hs []sshconfig.HostConfig
		for _, name := range g.Hosts {
			if h, ok := hostMap[name]; ok {
				hs = append(hs, h)
				assigned[name] = true
			}
		}
		buckets = append(buckets, groupBucket{id: g.ID, name: g.Name, hosts: hs})
	}
	var ungrouped []sshconfig.HostConfig
	for _, h := range filtered {
		if !assigned[h.Name] {
			ungrouped = append(ungrouped, h)
		}
	}
	if len(ungrouped) > 0 {
		buckets = append(buckets, groupBucket{id: "__ungrouped__", name: "未分组", hosts: ungrouped})
	}
	return buckets, nil
}

// collectHostSnapshotsParallel 并发采集多台主机，sem 限制并发数
func collectHostSnapshotsParallel(c *monitor.Collector, hosts []sshconfig.HostConfig, limit int, remember func(host, osRelease string)) []HostOverviewSnapshot {
	if len(hosts) == 0 {
		return []HostOverviewSnapshot{}
	}
	if limit <= 0 {
		limit = 5
	}

	results := make([]HostOverviewSnapshot, len(hosts))
	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup

	for i, h := range hosts {
		wg.Add(1)
		sem <- struct{}{}
		go func(idx int, host sshconfig.HostConfig) {
			defer wg.Done()
			defer func() { <-sem }()

			snap := HostOverviewSnapshot{
				Name:     host.Name,
				HostName: host.HostName,
				User:     host.User,
			}
			opt := connectOptionFromHostConfig(host)
			ov, err := c.CollectOverview(host.Name, opt)
			if err != nil {
				snap.Error = err.Error()
				results[idx] = snap
				return
			}
			snap.Overview = ov
			if remember != nil && ov.OSRelease != "" {
				remember(host.Name, ov.OSRelease)
			}
			// 只取根分区（mount == "/"），用于卡片显示
			disks, _ := c.CollectDisks(host.Name, opt)
			for _, d := range disks {
				if d.Mount == "/" {
					snap.Disks = []monitor.DiskInfo{d}
					break
				}
			}
			results[idx] = snap
		}(i, h)
	}
	wg.Wait()
	return results
}

// connectOptionFromHostConfig 把 HostConfig 转成 sshd.ConnectOption
func connectOptionFromHostConfig(h sshconfig.HostConfig) sshd.ConnectOption {
	return sshd.ConnectOption{
		Host:         h.Name,
		HostName:     h.HostName,
		User:         h.User,
		Port:         h.Port,
		IdentityFile: h.IdentityFile,
	}
}
