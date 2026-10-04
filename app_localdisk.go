package main

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"diteng-pannel/internal/alerthistory"
	"diteng-pannel/internal/desktop"
	"diteng-pannel/internal/localsys"
)

var localDiskCheckOnce sync.Once

// 本机磁盘启动提醒的阈值，与前端 alerts.ts / usage-tone.ts 同一套分界：
// 使用率 ≥ 60% 预警、≥ 85% 危险；大分区另看可用空间（≤ 20 GB 预警、≤ 10 GB 危险）。
const (
	localDiskWarnPercent   = 60.0
	localDiskDangerPercent = 85.0

	localDiskMinTotal      = uint64(10) << 30  // 小于 10 GB 的分区不参与（EFI 等小分区常年接近写满）
	localDiskAvailMinTotal = uint64(100) << 30 // 可用空间条件只看大分区，否则小分区会常年报「可用 ≤ 20 GB」
	localDiskAvailWarn     = uint64(20) << 30
	localDiskAvailDanger   = uint64(10) << 30
)

// startLocalDiskStartupCheck 每次启动检查一次本机磁盘：
// 任一分区达到预警 / 危险档，写应用内告警历史 + 发本机系统通知（不发企业微信）。
// 不做跨启动去重——磁盘持续超标时每次启动都会提醒，回落到阈值内则本次启动保持安静。
func (a *App) startLocalDiskStartupCheck() {
	localDiskCheckOnce.Do(func() {
		go func() {
			// 通知授权请求在 ApplicationStarted 里异步发起，稍等它落地，
			// 避免首条系统通知赶在授权标记前被静默丢弃。
			time.Sleep(2 * time.Second)
			a.checkLocalDisk()
		}()
	})
}

func (a *App) checkLocalDisk() {
	ov, err := localsys.CollectOverview()
	if err != nil {
		if a.app != nil {
			a.app.Logger.Warn("本机磁盘启动检查失败", "error", err)
		}
		return
	}
	breaches := evaluateLocalDisk(ov.Disks)
	if len(breaches) == 0 {
		return
	}

	worst := breaches[0]
	levelLabel := "警告"
	if worst.Level == "danger" {
		levelLabel = "危险"
	}
	title := "「本机」磁盘 进入" + levelLabel + "档"
	lines := make([]string, 0, len(breaches))
	for _, b := range breaches {
		lines = append(lines, localDiskBreachText(b))
	}
	detail := strings.Join(lines, "\n")

	eventID := ""
	if a.alertHistory != nil {
		if saved, err := a.alertHistory.Append(alerthistory.Event{
			Host:      "本机",
			Kind:      "disk",
			State:     "down",
			Level:     worst.Level,
			Stage:     "fire",
			Title:     title,
			Detail:    detail,
			Metric:    "磁盘",
			Value:     localDiskBreachText(worst),
			Threshold: localDiskThresholdText(worst.Level),
			Channels:  []string{"inApp", "system"},
		}); err == nil {
			eventID = saved.ID
		}
	}
	_ = desktop.Notify(desktop.Payload{
		Title:   title,
		Body:    detail,
		Host:    "本机",
		EventID: eventID,
		Kind:    "disk",
	})
	if app := a.app; app != nil {
		app.Event.Emit("alert-history-updated", nil)
	}
}

// localDiskBreach 一块超线分区的判定结果。
type localDiskBreach struct {
	Mount   string
	Total   uint64
	Avail   uint64
	Percent float64
	Level   string // warn | danger
	ByAvail bool   // 消息取「可用空间」口径（可用条件比使用率更严重）
}

// evaluateLocalDisk 挑出超线的本机分区，按严重度降序返回；空切片表示本次无需提醒。
// 判定口径对齐前端 diskAlertReading：使用率与可用空间双条件取更差的一档。
func evaluateLocalDisk(disks []localsys.DiskInfo) []localDiskBreach {
	// Windows 每卷带 disk + mount 两条重复记录，优先取挂载卷；没有 mount 信息时退回物理盘。
	list := make([]localsys.DiskInfo, 0, len(disks))
	for _, d := range disks {
		if d.Kind == "mount" {
			list = append(list, d)
		}
	}
	if len(list) == 0 {
		for _, d := range disks {
			if d.Kind == "disk" {
				list = append(list, d)
			}
		}
	}

	var out []localDiskBreach
	for _, d := range list {
		// U 盘 / 移动硬盘不属于「本地磁盘」的日常健康信号，不参与启动提醒
		if d.External || d.Total < localDiskMinTotal {
			continue
		}
		pct := 0.0
		if d.Total > 0 {
			pct = float64(d.Used) / float64(d.Total) * 100
		}

		pctLevel := localDiskTone(pct)
		availLevel, byAvail := "", false
		var availSev float64
		if d.Total >= localDiskAvailMinTotal {
			switch {
			case d.Avail <= localDiskAvailDanger:
				availLevel, availSev = "danger", localDiskAvailSeverity(d.Avail)
			case d.Avail <= localDiskAvailWarn:
				availLevel, availSev = "warn", localDiskAvailSeverity(d.Avail)
			}
		}
		level := pctLevel
		if availLevel != "" &&
			(localDiskRank(availLevel) > localDiskRank(pctLevel) ||
				(availLevel == pctLevel && availSev > pct)) {
			level, byAvail = availLevel, true
		}
		if level == "" {
			continue
		}
		out = append(out, localDiskBreach{
			Mount:   localDiskMountLabel(d),
			Total:   d.Total,
			Avail:   d.Avail,
			Percent: pct,
			Level:   level,
			ByAvail: byAvail,
		})
	}

	sort.SliceStable(out, func(i, j int) bool {
		if localDiskRank(out[i].Level) != localDiskRank(out[j].Level) {
			return localDiskRank(out[i].Level) > localDiskRank(out[j].Level)
		}
		return out[i].Percent > out[j].Percent
	})
	return out
}

// localDiskBreachText 与前端 alerts.ts 的读数文字同构；
// 「已用 x.x%」的写法被消息详情页 usagePercent 用来画占用条，不能改动。
func localDiskBreachText(b localDiskBreach) string {
	if b.ByAvail {
		return fmt.Sprintf("%s 可用 %s（已用 %.1f%%）", b.Mount, formatDiskBytes(b.Avail), b.Percent)
	}
	return fmt.Sprintf("%s 已用 %.1f%%（可用 %s）", b.Mount, b.Percent, formatDiskBytes(b.Avail))
}

// localDiskThresholdText 对齐前端 alertThresholdText(disk) 的阈值一栏。
func localDiskThresholdText(level string) string {
	if level == "danger" {
		return "危险 使用率 ≥ 85% 或可用 ≤ 10 GB"
	}
	return "警告 使用率 ≥ 60% 或可用 ≤ 20 GB"
}

func localDiskMountLabel(d localsys.DiskInfo) string {
	if s := strings.TrimSpace(d.Mount); s != "" {
		return s
	}
	if s := strings.TrimSpace(d.Filesystem); s != "" {
		return s
	}
	return "磁盘"
}

func localDiskTone(pct float64) string {
	switch {
	case pct >= localDiskDangerPercent:
		return "danger"
	case pct >= localDiskWarnPercent:
		return "warn"
	default:
		return ""
	}
}

func localDiskRank(level string) int {
	switch level {
	case "danger":
		return 2
	case "warn":
		return 1
	default:
		return 0
	}
}

// localDiskAvailSeverity 把可用空间折到和使用率同一把尺（20 GB→60、10 GB→85、越少越大），
// 与前端 availSeverity 同式，保证两端口径挑选出的读数文字一致。
func localDiskAvailSeverity(avail uint64) float64 {
	gb := float64(avail) / float64(uint64(1)<<30)
	return localDiskWarnPercent + (20-gb)*(localDiskDangerPercent-localDiskWarnPercent)/(20-10)
}

// formatDiskBytes 二进制单位、一位小数、去掉末尾 .0（对齐前端 formatBytes）。
func formatDiskBytes(b uint64) string {
	if b == 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB", "PB"}
	v := float64(b)
	i := 0
	for v >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	s := fmt.Sprintf("%.1f", v)
	if strings.HasSuffix(s, ".0") {
		s = s[:len(s)-2]
	}
	return s + " " + units[i]
}
