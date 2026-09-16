// Package agentapi 是 spanel-agent HTTP JSON 契约的单一来源。
// agent 与 agentcli 以类型别名引用，避免两边 json tag 漂移。
package agentapi

// Health /health 响应
type Health struct {
	Version      string  `json:"version"`
	UptimeSec    int64   `json:"uptimeSec"`
	RSSKB        int64   `json:"rssKB"`      // 自身常驻内存
	CPUTimeSec   float64 `json:"cpuTimeSec"` // 自身累计 CPU 时间（秒）
	Written      uint64  `json:"writtenSamples"`
	Dropped      uint64  `json:"droppedSamples"`
	LastWriteErr string  `json:"lastWriteErr"`
	DiskLow      bool    `json:"diskLow"`
}

// HostInfo 变化频率低的主机信息
type HostInfo struct {
	Hostname    string `json:"hostname"`
	Arch        string `json:"arch"`
	Kernel      string `json:"kernel"`
	OSRelease   string `json:"osRelease"`
	CPUModel    string `json:"cpuModel"`
	CPUCount    int    `json:"cpuCount"`
	IPAddress   string `json:"ipAddress"`
	Uptime      uint64 `json:"uptime"`      // 秒
	CollectedAt int64  `json:"collectedAt"` // 本信息采集时间（Unix 秒）
}

// CurrentPoint 最新一条采样（/metrics/current 的动态部分）
type CurrentPoint struct {
	TS             int64   `json:"ts"`
	CPUPercent     float64 `json:"cpuPercent"`
	Load1          float64 `json:"load1"`
	Load5          float64 `json:"load5"`
	Load15         float64 `json:"load15"`
	MemUsed        uint64  `json:"memUsed"`
	MemTotal       uint64  `json:"memTotal"`
	SwapUsed       uint64  `json:"swapUsed"`
	SwapTotal      uint64  `json:"swapTotal"`
	NetRxBytes     uint64  `json:"netRxBytes"`
	NetTxBytes     uint64  `json:"netTxBytes"`
	NetRxKBps      float64 `json:"netRxKBps"`
	NetTxKBps      float64 `json:"netTxKBps"`
	DiskReadBytes  uint64  `json:"diskReadBytes"`
	DiskWriteBytes uint64  `json:"diskWriteBytes"`
	DiskReadKBps   float64 `json:"diskReadKBps"`
	DiskWriteKBps  float64 `json:"diskWriteKBps"`
	DiskIOCount    uint64  `json:"diskIOCount"`
	DiskUsed       uint64  `json:"diskUsed"`
	DiskTotal      uint64  `json:"diskTotal"`
}

// CurrentResponse /metrics/current 响应
type CurrentResponse struct {
	Metrics CurrentPoint `json:"metrics"`
	Info    HostInfo     `json:"info"`
}

// RangePoint 历史序列统一数据点（raw 与 agg 两种来源都折算成它）
type RangePoint struct {
	TS            int64   `json:"ts"`
	CPUPercent    float64 `json:"cpuPercent"`
	Load1         float64 `json:"load1"`
	MemUsed       uint64  `json:"memUsed"`
	NetRxKBps     float64 `json:"netRxKBps"`
	NetTxKBps     float64 `json:"netTxKBps"`
	DiskReadKBps  float64 `json:"diskReadKBps"`
	DiskWriteKBps float64 `json:"diskWriteKBps"`
}

// RangeResponse /metrics/range 响应
type RangeResponse struct {
	Src    string       `json:"src"`
	Points []RangePoint `json:"points"`
}

// SummaryRange 一个时间窗的摘要
type SummaryRange struct {
	Name       string  `json:"name"` // 1h / 6h / 24h / 7d
	CPUAvg     float64 `json:"cpuAvg"`
	CPUMax     float64 `json:"cpuMax"`
	Load1Max   float64 `json:"load1Max"`
	MemUsedMax uint64  `json:"memUsedMax"`
}

// AgentEvent /events 事件
type AgentEvent struct {
	TS    int64  `json:"ts"`
	Level string `json:"level"` // info / warn / error
	Msg   string `json:"msg"`
}

// WatchStatus /watch/status 单服务
type WatchStatus struct {
	Service   string `json:"service"`
	Runtime   string `json:"runtime"`
	ProcessUp bool   `json:"processUp"`
	HealthUp  bool   `json:"healthUp"`
	IngressUp bool   `json:"ingressUp"`
	IngressOn bool   `json:"ingressOn"`
	Instances int    `json:"instances"`
}

// JarRangePoint /watch/range 点
type JarRangePoint struct {
	TS         int64   `json:"ts"`
	Service    string  `json:"service"`
	PID        int     `json:"pid"`
	Port       int     `json:"port"`
	RSS        uint64  `json:"rss"`
	CPUPercent float64 `json:"cpuPercent"`
	HeapUsed   uint64  `json:"heapUsed"`
	HeapMax    uint64  `json:"heapMax"`
	GCPauseMs  float64 `json:"gcPauseMs"`
	HealthOK   bool    `json:"healthOk"`
}

// WatchRangeResponse /watch/range
type WatchRangeResponse struct {
	Points []JarRangePoint `json:"points"`
}

// WatchEvent 分层探活状态变化（/watch/events）
type WatchEvent struct {
	TS      int64  `json:"ts"`
	Service string `json:"service"`
	Layer   string `json:"layer"` // process / health / ingress
	Kind    string `json:"kind"`  // down / up
	Msg     string `json:"msg"`
}

// WatchYAML /admin/watch
type WatchYAML struct {
	YAML string `json:"yaml"`
}

// JavaAppInstance /watch/instances 单 Java 实例
type JavaAppInstance struct {
	Service         string `json:"service"`
	Runtime         string `json:"runtime"` // java / bun
	PID             int    `json:"pid"`
	Port            int    `json:"port"`
	DeployVer       string `json:"deployVer"`
	LatestDeployVer string `json:"latestDeployVer"` // 该 jar 所在服务目录下最新日期版本
	StartTime       string `json:"startTime"`
	Screen          string `json:"screen"`
	JarPath         string `json:"jarPath"`
	HealthUp        bool   `json:"healthUp"`
	ProcessUp       bool   `json:"processUp"`
	IngressUp       bool   `json:"ingressUp"`
	IngressOn       bool   `json:"ingressOn"`
	Status          string `json:"status"` // UP / DOWN / UNHEALTHY
	Group           string `json:"group"`  // std / pro / other
}

// AppShutdownReq POST /op/app-shutdown
type AppShutdownReq struct {
	Service string `json:"service"`
	PID     int    `json:"pid"`
	Port    int    `json:"port"`
	Screen  string `json:"screen"`
}

// AppShutdownResult POST /op/app-shutdown 响应
type AppShutdownResult struct {
	OK      bool   `json:"ok"`
	Stopped bool   `json:"stopped"`
	Msg     string `json:"msg"`
}
