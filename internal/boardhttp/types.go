package boardhttp

import (
	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/monitor"
)

// HostBrief 看板主机摘要（只读）。
type HostBrief struct {
	Name     string `json:"name"`
	HostName string `json:"hostName"`
}

// GroupInfo 分组看板元数据。
type GroupInfo struct {
	Name       string      `json:"name"`
	BoardTitle string      `json:"boardTitle"`
	Hosts      []HostBrief `json:"hosts"`
}

// BoardSettings 浏览器看板所需的只读设置切片。
type BoardSettings struct {
	HostAppNotifySubs map[string][]string `json:"hostAppNotifySubs"`
}

// DataSource 由主进程实现，供只读 API 调用。
type DataSource interface {
	FindGroup(name string) (GroupInfo, bool)
	HostInGroup(group, host string) bool
	CollectOverview(host string) (monitor.Overview, error)
	CollectDisks(host string) ([]monitor.DiskInfo, error)
	AgentRange(host string, from, to int64, src string) (agentcli.RangeResponse, error)
	AgentWatchInstances(host string) ([]agentcli.JavaAppInstance, error)
	BoardSettings() BoardSettings
}
