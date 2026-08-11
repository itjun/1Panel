package monitor

// Snapshot 一次采集的全部指标快照（前端订阅这个结构）
type Snapshot struct {
	Host     string     `json:"host"`
	Overview Overview   `json:"overview"`
	Disks    []DiskInfo `json:"disks"`
	Procs    []ProcInfo `json:"procs"`
	Docker   DockerInfo `json:"docker"`
	Java     []ProcInfo `json:"java"`
	Services []Service     `json:"services"`
	Crons    []Cron        `json:"crons"`
	Packages []AptPackage  `json:"packages"`
	Error    string        `json:"error,omitempty"`
}

// Overview 顶层系统指标
type Overview struct {
	CPUPercent   float64 `json:"cpuPercent"`   // 总体 CPU 使用率
	MemPercent   float64 `json:"memPercent"`   // 内存使用率
	MemTotal     uint64  `json:"memTotal"`     // 内存总量 bytes
	MemUsed      uint64  `json:"memUsed"`      // 已用内存
	SwapPercent  float64 `json:"swapPercent"`  // swap 使用率
	SwapTotal    uint64  `json:"swapTotal"`
	SwapUsed     uint64  `json:"swapUsed"`
	Load1        float64 `json:"load1"`        // 1 分钟负载
	Load5        float64 `json:"load5"`
	Load15       float64 `json:"load15"`
	Uptime       uint64  `json:"uptime"`       // 启动至今的秒数
	Kernel       string  `json:"kernel"`
	OSRelease    string  `json:"osRelease"`
	CPUCount     int     `json:"cpuCount"`
	CPUModel     string  `json:"cpuModel"`
	// 1Panel 风格概览扩展
	Hostname   string `json:"hostname"`   // 主机名
	Arch       string `json:"arch"`       // 系统架构 uname -m
	IPAddress  string `json:"ipAddress"`  // 主网卡 IP（尽力获取）
	NetRxBytes uint64 `json:"netRxBytes"` // 累计接收字节（全网卡合计，不含 lo；开机至今）
	NetTxBytes uint64 `json:"netTxBytes"` // 累计发送字节（开机至今）
	// 近 1 天 / 7 天：由本机历史采样对累计值做差分（非内核原生窗口）
	Net1d NetWindow `json:"net1d"`
	Net7d NetWindow `json:"net7d"`
}

// NetWindow 某时间窗口内的收发字节（差分）
type NetWindow struct {
	RxBytes   uint64  `json:"rxBytes"`
	TxBytes   uint64  `json:"txBytes"`
	SpanHours float64 `json:"spanHours"` // 实际覆盖小时数
	Complete  bool    `json:"complete"`  // 是否已有满窗口历史样本
}

type DiskInfo struct {
	Filesystem string `json:"filesystem"`
	Mount      string `json:"mount"`
	Total      uint64 `json:"total"`
	Used       uint64 `json:"used"`
	Avail      uint64 `json:"avail"`
	Percent    float64 `json:"percent"`
}

type ProcInfo struct {
	PID     uint32  `json:"pid"`
	PPID    uint32  `json:"ppid"`
	User    string  `json:"user"`
	CPU     float64 `json:"cpu"`
	Mem     float64 `json:"mem"`
	RSS     uint64  `json:"rss"`     // 物理内存 bytes
	Elapsed uint64  `json:"elapsed"` // 启动至今秒数
	Cmd     string  `json:"cmd"`
}

type DockerInfo struct {
	Available bool         `json:"available"` // 目标机是否有 docker
	Containers []Container `json:"containers"`
	Stats      []ContainerStat `json:"stats"`
}

type Container struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Image string `json:"image"`
	Status string `json:"status"`
	State  string `json:"state"`
	Ports  string `json:"ports"`
}

type ContainerStat struct {
	Name      string  `json:"name"`
	CPUPercent float64 `json:"cpuPercent"`
	MemUsage  uint64  `json:"memUsage"`
	MemLimit  uint64  `json:"memLimit"`
	MemPercent float64 `json:"memPercent"`
	NetIn     uint64  `json:"netIn"`
	NetOut    uint64  `json:"netOut"`
	BlockIn   uint64  `json:"blockIn"`
	BlockOut  uint64  `json:"blockOut"`
}

type Service struct {
	Name   string `json:"name"`
	Load   string `json:"load"`
	Active string `json:"active"`  // active / failed / inactive
	Sub    string `json:"sub"`
}

type Cron struct {
	User string `json:"user"`
	Line string `json:"line"`
	Source string `json:"source"` // user / etc-cron.d / etc-crontab
}

type AptPackage struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Depends int    `json:"depends"` // 依赖包数量（apt-cache depends 的 uniq 计数）
}
