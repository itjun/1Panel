package main

import (
	"fmt"
	"io/fs"
	"log"
	"strings"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/boardhttp"
	"diteng-pannel/internal/groupid"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshconfig"
)

// boardData 把 App 的只读能力接到看板 HTTP 网关。
type boardData struct {
	app *App
}

func (b *boardData) FindGroup(name string) (boardhttp.GroupInfo, bool) {
	name = strings.TrimSpace(name)
	if name == "" || groupid.Validate(name) != nil {
		return boardhttp.GroupInfo{}, false
	}
	groups := (*Groups)(b.app).ListGroups()
	var boardTitle string
	var hostNames []string
	found := false
	for _, g := range groups {
		if g.ID == name || g.Name == name {
			boardTitle = strings.TrimSpace(g.BoardTitle)
			hostNames = append([]string{}, g.Hosts...)
			found = true
			break
		}
	}
	if !found {
		return boardhttp.GroupInfo{}, false
	}

	all, err := listNonGitHosts()
	if err != nil {
		all = nil
	}
	byName := map[string]sshconfig.HostConfig{}
	for _, h := range all {
		byName[h.Name] = h
	}
	briefs := make([]boardhttp.HostBrief, 0, len(hostNames))
	for _, n := range hostNames {
		h, ok := byName[n]
		if !ok {
			briefs = append(briefs, boardhttp.HostBrief{Name: n})
			continue
		}
		briefs = append(briefs, boardhttp.HostBrief{Name: h.Name, HostName: h.HostName})
	}
	return boardhttp.GroupInfo{
		Name:       name,
		BoardTitle: boardTitle,
		Hosts:      briefs,
	}, true
}

func (b *boardData) HostInGroup(group, host string) bool {
	info, ok := b.FindGroup(group)
	if !ok {
		return false
	}
	host = strings.TrimSpace(host)
	for _, h := range info.Hosts {
		if h.Name == host {
			return true
		}
	}
	return false
}

func (b *boardData) CollectOverview(host string) (monitor.Overview, error) {
	return (*Monitor)(b.app).CollectOverview(host)
}

func (b *boardData) CollectDisks(host string) ([]monitor.DiskInfo, error) {
	return (*Monitor)(b.app).CollectDisks(host)
}

func (b *boardData) AgentRange(host string, from, to int64, src string) (agentcli.RangeResponse, error) {
	return (*Agent)(b.app).AgentRange(host, from, to, src)
}

func (b *boardData) AgentWatchInstances(host string) ([]agentcli.JavaAppInstance, error) {
	return (*Agent)(b.app).AgentWatchInstances(host)
}

func (b *boardData) BoardSettings() boardhttp.BoardSettings {
	out := boardhttp.BoardSettings{HostAppNotifySubs: map[string][]string{}}
	if b.app == nil || b.app.notifySubs == nil {
		return out
	}
	d := b.app.notifySubs.Get()
	if d.HostAppNotifySubs != nil {
		out.HostAppNotifySubs = d.HostAppNotifySubs
	}
	return out
}

func (a *App) startBoardHTTP() {
	sub, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		if a.app != nil {
			a.app.Logger.Error("看板 HTTP 前端资源不可用", "error", err)
		}
		return
	}
	srv := boardhttp.New(sub, &boardData{app: a}, log.Default())
	cfg := boardhttp.LoadConfig("ServerPanel")
	a.boardHTTP = srv
	if err := srv.Start(cfg); err != nil {
		if a.app != nil {
			a.app.Logger.Error("启动看板 HTTP 失败", "error", err)
		} else {
			fmt.Printf("启动看板 HTTP 失败: %v\n", err)
		}
	}
}
