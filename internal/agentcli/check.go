package agentcli

import (
	"fmt"
	"strings"
	"time"
)

// CheckItem 一项检查结果
type CheckItem struct {
	Key    string `json:"key"`
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
}

// CheckReport agent 自检报告（服务 / 通信 / 版本 / 采集）
type CheckReport struct {
	OK      bool        `json:"ok"`
	Summary string      `json:"summary"`
	Items   []CheckItem `json:"items"`
}

// CheckInput BuildCheckReport 入参（纯函数，便于单测）
type CheckInput struct {
	PanelVersion string
	HasBinary    bool
	ServiceState string
	ProbeErr     error
	Health       Health
	HealthErr    error
	CurrentErr   error
}

// IsNoSampleData agent 已连通但库里还没有 raw_metrics
func IsNoSampleData(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "尚无采样数据")
}

// BuildCheckReport 把探测 /health /current 折成一份检查清单。
func BuildCheckReport(in CheckInput) CheckReport {
	items := make([]CheckItem, 0, 6)

	svc := CheckItem{Key: "service", Name: "服务"}
	switch {
	case in.ProbeErr != nil:
		svc.Detail = "探测失败：" + in.ProbeErr.Error()
	case !in.HasBinary:
		svc.Detail = "未找到 /usr/local/bin/spanel-agent"
	case in.ServiceState != "active":
		st := in.ServiceState
		if st == "" {
			st = "unknown"
		}
		svc.Detail = "systemd 状态 " + st + "（需要 active）"
	default:
		svc.OK = true
		svc.Detail = "systemd active"
	}
	items = append(items, svc)

	comm := CheckItem{Key: "comm", Name: "通信"}
	if in.HealthErr != nil {
		comm.Detail = in.HealthErr.Error()
	} else {
		comm.OK = true
		comm.Detail = fmt.Sprintf("隧道正常，已运行 %s", fmtUptime(in.Health.UptimeSec))
	}
	items = append(items, comm)

	ver := CheckItem{Key: "version", Name: "版本"}
	switch {
	case in.HealthErr != nil:
		ver.Detail = "未能读取版本"
	case in.Health.Version == "":
		ver.Detail = "远端未返回版本号"
	case in.PanelVersion != "" && in.Health.Version != in.PanelVersion:
		ver.Detail = fmt.Sprintf("远端 v%s，面板内置 v%s", in.Health.Version, in.PanelVersion)
	default:
		ver.OK = true
		if in.PanelVersion != "" {
			ver.Detail = "v" + in.Health.Version + "（与面板一致）"
		} else {
			ver.Detail = "v" + in.Health.Version
		}
	}
	items = append(items, ver)

	col := CheckItem{Key: "collect", Name: "采集"}
	switch {
	case in.HealthErr != nil:
		col.Detail = "未能读取采集状态"
	case in.Health.DiskLow:
		col.Detail = "磁盘水位过低，已停写"
	case in.Health.LastWriteErr != "":
		col.Detail = "写入失败：" + in.Health.LastWriteErr
	case in.Health.Written == 0 || IsNoSampleData(in.CurrentErr):
		col.Detail = fmt.Sprintf("尚无采样（已写入 %d 条）", in.Health.Written)
	case in.CurrentErr != nil:
		col.Detail = "读取最新采样失败：" + in.CurrentErr.Error()
	default:
		col.OK = true
		col.Detail = fmt.Sprintf("已写入 %d 条", in.Health.Written)
		if in.Health.Dropped > 0 {
			col.Detail += fmt.Sprintf("，丢弃 %d 条", in.Health.Dropped)
		}
	}
	items = append(items, col)

	disk := CheckItem{Key: "disk", Name: "磁盘"}
	switch {
	case in.HealthErr != nil:
		disk.Detail = "未能检测"
	case in.Health.DiskLow:
		disk.Detail = "数据分区剩余过低，采集已暂停"
	default:
		disk.OK = true
		disk.Detail = "水位正常"
	}
	items = append(items, disk)

	mem := CheckItem{Key: "memory", Name: "内存"}
	if in.HealthErr != nil {
		mem.Detail = "未能读取"
	} else {
		mem.OK = true
		mem.Detail = fmt.Sprintf("RSS %d KB", in.Health.RSSKB)
	}
	items = append(items, mem)

	ok := true
	fail := 0
	for _, it := range items {
		if it.Key == "memory" {
			continue
		}
		if !it.OK {
			ok = false
			fail++
		}
	}
	sum := "Agent 工作正常"
	if !ok {
		sum = fmt.Sprintf("%d 项异常", fail)
	}
	return CheckReport{OK: ok, Summary: sum, Items: items}
}

func fmtUptime(sec int64) string {
	if sec < 0 {
		sec = 0
	}
	d := time.Duration(sec) * time.Second
	if d < time.Minute {
		return fmt.Sprintf("%d 秒", sec)
	}
	if d < time.Hour {
		return fmt.Sprintf("%d 分 %d 秒", int(d.Minutes()), int(d.Seconds())%60)
	}
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	return fmt.Sprintf("%d 小时 %d 分", h, m)
}
