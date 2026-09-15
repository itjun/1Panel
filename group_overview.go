package main

import (
	"context"
	"sync"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/groups"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshconfig"
	"diteng-pannel/internal/sshd"
)

// Overview 分组概览服务
type Overview App

// HostOverviewSnapshot 一台主机的概览快照
type HostOverviewSnapshot struct {
	Name     string             `json:"name"`     // Host 别名
	HostName string             `json:"hostName"` // 实际 IP/域名
	User     string             `json:"user"`
	Overview monitor.Overview   `json:"overview"`
	Disks    []monitor.DiskInfo `json:"disks"` // 物理盘/池(kind=disk) + 挂载分区(kind=mount)
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
func (s *Overview) ListGroupOverview() ([]GroupOverview, error) {
	buckets, err := s.buildGroupBuckets()
	if err != nil {
		return nil, err
	}
	out := make([]GroupOverview, 0, len(buckets))
	for _, b := range buckets {
		snapshots := s.collectHostSnapshots(b.hosts, 5, func(h, os string) { rememberOS(s.hostIcons, h, os) })
		out = append(out, GroupOverview{
			GroupID:   b.id,
			GroupName: b.name,
			Hosts:     snapshots,
		})
	}
	return out, nil
}

// ListOneGroupOverview 只采集指定分组子树内全部主机
func (s *Overview) ListOneGroupOverview(groupID string) (GroupOverview, error) {
	hosts, err := sshconfig.Parse()
	if err != nil {
		return GroupOverview{}, err
	}
	hostMap := map[string]sshconfig.HostConfig{}
	for _, h := range hosts {
		if sshconfig.IsGitHost(h) {
			continue
		}
		hostMap[h.Name] = h
	}

	if groupID == "__ungrouped__" {
		assigned := map[string]bool{}
		if s.groups != nil {
			for _, g := range s.groups.List() {
				for _, name := range g.Hosts {
					assigned[name] = true
				}
			}
		}
		var hs []sshconfig.HostConfig
		for _, h := range hostMap {
			if !assigned[h.Name] {
				hs = append(hs, h)
			}
		}
		return GroupOverview{
			GroupID:   groupID,
			GroupName: "未分组",
			Hosts:     s.collectHostSnapshots(hs, 5, func(h, os string) { rememberOS(s.hostIcons, h, os) }),
		}, nil
	}

	name := groupID
	var names []string
	if s.groups != nil {
		for _, g := range s.groups.List() {
			if g.ID == groupID {
				name = g.Name
				break
			}
		}
		names = s.groups.SubtreeHostNames(groupID)
	}
	var hs []sshconfig.HostConfig
	seen := map[string]bool{}
	for _, n := range names {
		if seen[n] {
			continue
		}
		seen[n] = true
		if h, ok := hostMap[n]; ok {
			hs = append(hs, h)
		}
	}
	return GroupOverview{
		GroupID:   groupID,
		GroupName: name,
		Hosts:     s.collectHostSnapshots(hs, 5, func(h, os string) { rememberOS(s.hostIcons, h, os) }),
	}, nil
}

type groupBucket struct {
	id    string
	name  string
	hosts []sshconfig.HostConfig
}

func (s *Overview) buildGroupBuckets() ([]groupBucket, error) {
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
	if s.groups != nil {
		gs = s.groups.List()
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

// collectHostSnapshots 并发采集多台主机（经各自 agent 读库），sem 限制并发数
func (s *Overview) collectHostSnapshots(hosts []sshconfig.HostConfig, limit int, remember func(host, osRelease string)) []HostOverviewSnapshot {
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
			cli, err := s.agentPool.GetWithOpt(host.Name, connectOptionFromHostConfig(host))
			if err != nil {
				snap.Error = err.Error()
				results[idx] = snap
				return
			}
			ctx := context.Background()
			var cur agentcli.CurrentResponse
			if err := cli.GetJSON(ctx, "/metrics/current", &cur); err != nil {
				snap.Error = err.Error()
				results[idx] = snap
				return
			}
			ov := overviewFromAgent(cur)
			snap.Overview = ov
			if remember != nil && ov.OSRelease != "" {
				remember(host.Name, ov.OSRelease)
			}
			// 全部真实分区，前端按物理容量汇总展示
			var disks []monitor.DiskInfo
			_ = cli.GetJSON(ctx, "/collect/disks", &disks, true)
			snap.Disks = disks
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
