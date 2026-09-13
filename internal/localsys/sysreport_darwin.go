//go:build darwin

package localsys

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 采集的 system_profiler 类型：覆盖「系统信息」里常用硬件/网络/软件分类。
var sysReportDataTypes = []struct {
	Type  string
	Title string
}{
	{"SPHardwareDataType", "硬件概览"},
	{"SPSoftwareDataType", "软件"},
	{"SPMemoryDataType", "内存"},
	{"SPDisplaysDataType", "图形卡/显示器"},
	{"SPStorageDataType", "储存"},
	{"SPNVMeDataType", "NVMe"},
	{"SPPowerDataType", "电源"},
	{"SPAudioDataType", "音频"},
	{"SPBluetoothDataType", "蓝牙"},
	{"SPAirPortDataType", "Wi‑Fi"},
	{"SPNetworkDataType", "网络"},
	{"SPEthernetDataType", "以太网"},
	{"SPThunderboltDataType", "雷雳/USB4"},
	{"SPUSBDataType", "USB"},
	{"SPCameraDataType", "相机"},
	{"SPFirewallDataType", "防火墙"},
}

var (
	sysReportMu    sync.Mutex
	sysReportCache *SystemReport
	sysReportAt    time.Time
)

const sysReportCacheTTL = 60 * time.Second

// CollectSystemReport 采集本机系统详细报告（带短缓存，避免频繁拉起 system_profiler）。
func CollectSystemReport(force bool) (*SystemReport, error) {
	sysReportMu.Lock()
	defer sysReportMu.Unlock()
	if !force && sysReportCache != nil && time.Since(sysReportAt) < sysReportCacheTTL {
		cp := *sysReportCache
		cp.Sections = append([]ReportSection(nil), sysReportCache.Sections...)
		return &cp, nil
	}
	rep, err := collectSystemReportNow()
	if err != nil {
		return nil, err
	}
	sysReportCache = rep
	sysReportAt = time.Now()
	cp := *rep
	cp.Sections = append([]ReportSection(nil), rep.Sections...)
	return &cp, nil
}

func collectSystemReportNow() (*SystemReport, error) {
	args := make([]string, 0, len(sysReportDataTypes)+1)
	for _, d := range sysReportDataTypes {
		args = append(args, d.Type)
	}
	args = append(args, "-json")

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "system_profiler", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("system_profiler: %s", msg)
	}

	var raw map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &raw); err != nil {
		return nil, fmt.Errorf("解析 system_profiler JSON: %w", err)
	}

	rep := &SystemReport{
		CollectedAt: time.Now().Unix(),
		Source:      "system_profiler",
		Sections:    make([]ReportSection, 0, len(sysReportDataTypes)+1),
	}
	rep.Sections = append(rep.Sections, buildSummarySection())

	for _, d := range sysReportDataTypes {
		v, ok := raw[d.Type]
		if !ok {
			continue
		}
		items := parseSPValue(v)
		if len(items) == 0 {
			continue
		}
		if d.Type == "SPHardwareDataType" {
			for i := range items {
				items[i] = enhanceHardwareItem(items[i])
			}
		}
		rep.Sections = append(rep.Sections, ReportSection{
			ID:    d.Type,
			Title: d.Title,
			Items: items,
		})
	}
	return rep, nil
}

func buildSummarySection() ReportSection {
	rows := []ReportRow{
		{Label: "主机名称", Value: nz(hostname())},
		{Label: "系统类型", Value: nz(runtime.GOARCH)},
		{Label: "机型标识", Value: nz(sysctl("hw.model"))},
		{Label: "内核版本", Value: nz(sysctl("kern.osrelease"))},
	}
	o := &Overview{}
	parseSWVers(o)
	if o.OSRelease != "" {
		rows = append(rows, ReportRow{Label: "发行版本", Value: o.OSRelease})
	}
	parseBootTime(o)
	if o.Uptime > 0 {
		rows = append(rows, ReportRow{Label: "运行时间", Value: formatUptime(o.Uptime)})
	}
	parseCPULevels(o)
	if n, err := strconv.Atoi(strings.TrimSpace(sysctl("hw.ncpu"))); err == nil {
		o.CPUCount = n
	}
	if o.PerfCores > 0 || o.EffCores > 0 {
		rows = append(rows, ReportRow{
			Label: "CPU 核心",
			Value: fmt.Sprintf("性能 %d · 能效 %d · 共 %d", o.PerfCores, o.EffCores, o.CPUCount),
		})
	} else if o.CPUCount > 0 {
		rows = append(rows, ReportRow{Label: "CPU 核心", Value: fmt.Sprintf("%d 核", o.CPUCount)})
	}
	if ip := primaryIPv4(); ip != "" {
		rows = append(rows, ReportRow{Label: "内网地址", Value: ip})
	}
	if pub := publicIPCached(); pub != "" {
		rows = append(rows, ReportRow{Label: "外网地址", Value: pub})
	}
	return ReportSection{
		ID:    "summary",
		Title: "摘要",
		Items: []ReportItem{{Name: "本机摘要", Rows: rows}},
	}
}

func formatUptime(sec uint64) string {
	if sec == 0 {
		return "—"
	}
	d := sec / 86400
	h := (sec % 86400) / 3600
	m := (sec % 3600) / 60
	s := sec % 60
	parts := []string{}
	if d > 0 {
		parts = append(parts, fmt.Sprintf("%d天", d))
	}
	if h > 0 || d > 0 {
		parts = append(parts, fmt.Sprintf("%d小时", h))
	}
	parts = append(parts, fmt.Sprintf("%d分钟", m), fmt.Sprintf("%d秒", s))
	return strings.Join(parts, " ")
}

func nz(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return s
}

func parseSPValue(v any) []ReportItem {
	switch t := v.(type) {
	case []any:
		out := make([]ReportItem, 0, len(t))
		for _, el := range t {
			if m, ok := el.(map[string]any); ok {
				out = append(out, parseSPObject(m))
			}
		}
		return out
	case map[string]any:
		return []ReportItem{parseSPObject(t)}
	default:
		return nil
	}
}

func parseSPObject(obj map[string]any) ReportItem {
	name := ""
	if n, ok := obj["_name"]; ok {
		name = formatSPScalar(n)
	}
	if name == "" {
		name = "详情"
	}

	var rows []ReportRow
	var children []ReportItem
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		if strings.HasPrefix(k, "_") {
			continue
		}
		v := obj[k]
		switch val := v.(type) {
		case []any:
			if len(val) == 0 {
				continue
			}
			if allScalars(val) {
				parts := make([]string, 0, len(val))
				for _, el := range val {
					parts = append(parts, formatSPScalar(el))
				}
				rows = append(rows, ReportRow{Label: localizeSPKey(k), Value: strings.Join(parts, ", ")})
				continue
			}
			for _, el := range val {
				if m, ok := el.(map[string]any); ok {
					ch := parseSPObject(m)
					if ch.Name == "详情" || ch.Name == "" {
						ch.Name = localizeSPKey(k)
					}
					children = append(children, ch)
				}
			}
		case map[string]any:
			ch := parseSPObject(val)
			if ch.Name == "详情" || ch.Name == "" {
				ch.Name = localizeSPKey(k)
			}
			children = append(children, ch)
		default:
			s := formatSPScalar(val)
			if s == "" {
				continue
			}
			rows = append(rows, ReportRow{Label: localizeSPKey(k), Value: localizeSPValue(k, s)})
		}
	}
	return ReportItem{Name: localizeSPValue("_name", name), Rows: rows, Children: children}
}

func allScalars(arr []any) bool {
	for _, el := range arr {
		switch el.(type) {
		case map[string]any, []any:
			return false
		}
	}
	return true
}

func formatSPScalar(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(t)
	case bool:
		if t {
			return "是"
		}
		return "否"
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case json.Number:
		return t.String()
	default:
		return strings.TrimSpace(fmt.Sprint(t))
	}
}

func enhanceHardwareItem(it ReportItem) ReportItem {
	for i, row := range it.Rows {
		if row.Label == "处理器数量" {
			it.Rows[i].Value = formatProcCount(row.Value)
		}
		if row.Label == "激活锁状态" {
			it.Rows[i].Value = formatActivationLock(row.Value)
		}
	}
	return it
}

func formatProcCount(raw string) string {
	s := strings.TrimSpace(raw)
	if !strings.HasPrefix(s, "proc ") {
		return s
	}
	parts := strings.Split(strings.TrimPrefix(s, "proc "), ":")
	if len(parts) < 4 {
		return s
	}
	return fmt.Sprintf("%s 核（性能 %s · 能效 %s）", parts[0], parts[2], parts[3])
}

func formatActivationLock(raw string) string {
	switch strings.TrimSpace(raw) {
	case "activation_lock_enabled":
		return "已启用"
	case "activation_lock_disabled":
		return "已关闭"
	default:
		return raw
	}
}

func localizeSPValue(key, value string) string {
	if key == "activation_lock_status" {
		return formatActivationLock(value)
	}
	if key == "number_processors" {
		return formatProcCount(value)
	}
	return value
}

func localizeSPKey(key string) string {
	if label, ok := spKeyLabels[key]; ok {
		return label
	}
	return strings.ReplaceAll(key, "_", " ")
}

var spKeyLabels = map[string]string{
	"machine_name":                 "型号名称",
	"machine_model":                "型号标识",
	"model_number":                 "型号号码",
	"chip_type":                    "芯片",
	"cpu_type":                     "处理器",
	"current_processor_speed":      "处理器速度",
	"number_processors":            "处理器数量",
	"packages":                     "封装数量",
	"physical_memory":              "内存",
	"boot_rom_version":             "系统固件版本",
	"os_loader_version":            "OS 加载程序版本",
	"serial_number":                "序列号",
	"platform_UUID":                "硬件 UUID",
	"provisioning_UDID":            "预置 UDID",
	"activation_lock_status":       "激活锁状态",
	"os_version":                   "系统版本",
	"kernel_version":               "内核版本",
	"boot_volume":                  "启动卷宗",
	"boot_mode":                    "启动模式",
	"computer_name":                "电脑名称",
	"user_name":                    "用户名称",
	"secure_virtual_memory":        "安全虚拟内存",
	"system_integrity":             "系统完整性保护",
	"time_since_boot":              "启动后时间",
	"dimm_size":                    "大小",
	"dimm_speed":                   "速度",
	"dimm_type":                    "类型",
	"dimm_status":                  "状态",
	"dimm_manufacturer":            "制造商",
	"dimm_part_number":             "零件号码",
	"spdisplays_resolution":        "分辨率",
	"spdisplays_pixelresolution":   "像素分辨率",
	"spdisplays_display_type":      "显示器类型",
	"spdisplays_connection_type":   "连接",
	"spdisplays_main":              "主显示器",
	"spdisplays_online":            "在线",
	"size":                         "大小",
	"device_name":                  "设备名称",
	"device_model":                 "设备型号",
	"device_serial":                "设备序列号",
	"bsd_name":                     "BSD 名称",
	"file_system":                  "文件系统",
	"mount_point":                  "装载点",
	"volume_uuid":                  "卷 UUID",
	"writable":                     "可写",
	"sppower_battery_health":       "电池健康",
	"sppower_ac_charger_connected": "电源适配器已连接",
	"version":                      "版本",
	"manufacturer":                 "制造商",
	"ip_address":                   "IP 地址",
	"spfirewall_globalstate":       "防火墙状态",
	"spfirewall_allowsigned":       "允许已签名软件",
	"spfirewall_stealth":           "隐蔽模式",
}
