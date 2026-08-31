package monitor

// Snapshot 一次采集的全部指标快照（前端订阅这个结构）
type Snapshot struct {
	Host     string       `json:"host"`
	Overview Overview     `json:"overview"`
	Disks    []DiskInfo   `json:"disks"`
	Procs    []ProcInfo   `json:"procs"`
	Docker   DockerInfo   `json:"docker"`
	Java     []ProcInfo   `json:"java"`
	Services []Service    `json:"services"`
	Crons    []Cron       `json:"crons"`
	Packages []AptPackage `json:"packages"`
	Error    string       `json:"error,omitempty"`
}

// Overview 顶层系统指标
type Overview struct {
	CPUPercent  float64 `json:"cpuPercent"`  // 总体 CPU 使用率
	MemPercent  float64 `json:"memPercent"`  // 内存使用率
	MemTotal    uint64  `json:"memTotal"`    // 内存总量 bytes
	MemUsed     uint64  `json:"memUsed"`     // 已用内存
	SwapPercent float64 `json:"swapPercent"` // swap 使用率
	SwapTotal   uint64  `json:"swapTotal"`
	SwapUsed    uint64  `json:"swapUsed"`
	Load1       float64 `json:"load1"` // 1 分钟负载
	Load5       float64 `json:"load5"`
	Load15      float64 `json:"load15"`
	Uptime      uint64  `json:"uptime"` // 启动至今的秒数
	Kernel      string  `json:"kernel"`
	OSRelease   string  `json:"osRelease"`
	CPUCount    int     `json:"cpuCount"`
	CPUModel    string  `json:"cpuModel"`
	// 1Panel 风格概览扩展
	Hostname   string `json:"hostname"`   // 主机名
	Arch       string `json:"arch"`       // 系统架构 uname -m
	IPAddress  string `json:"ipAddress"`  // 主网卡 IP（尽力获取）
	NetRxBytes uint64 `json:"netRxBytes"` // 累计接收字节（默认路由网卡，如 eth0；探测失败则全网卡合计不含 lo）
	NetTxBytes uint64 `json:"netTxBytes"` // 累计发送字节（同上）
	// 磁盘 IO 累计值（仅物理块设备合计，不含分区/虚拟设备；前端差分算速率）
	DiskReadBytes  uint64 `json:"diskReadBytes"`  // 累计读字节（sectors_read × 512）
	DiskWriteBytes uint64 `json:"diskWriteBytes"` // 累计写字节
	DiskIOCount    uint64 `json:"diskIOCount"`    // 累计读写操作次数（reads + writes completed）
}

type DiskInfo struct {
	Filesystem string  `json:"filesystem"`
	FSType     string  `json:"fsType"`
	Mount      string  `json:"mount"`
	Total      uint64  `json:"total"`
	Used       uint64  `json:"used"`
	Avail      uint64  `json:"avail"`
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
	Available  bool            `json:"available"` // 目标机是否有 docker
	Containers []Container     `json:"containers"`
	Stats      []ContainerStat `json:"stats"`
}

type Container struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	Status string `json:"status"`
	State  string `json:"state"`
	Ports  string `json:"ports"`
}

type ContainerStat struct {
	Name       string  `json:"name"`
	CPUPercent float64 `json:"cpuPercent"`
	MemUsage   uint64  `json:"memUsage"`
	MemLimit   uint64  `json:"memLimit"`
	MemPercent float64 `json:"memPercent"`
	NetIn      uint64  `json:"netIn"`
	NetOut     uint64  `json:"netOut"`
	BlockIn    uint64  `json:"blockIn"`
	BlockOut   uint64  `json:"blockOut"`
}

type Service struct {
	Name        string `json:"name"`
	Load        string `json:"load"`
	Active      string `json:"active"` // active / failed / inactive
	Sub         string `json:"sub"`
	Description string `json:"description"`
}

// ServiceDetail 单个服务的详细信息（systemctl show 按需查询，供悬浮卡片展示）
type ServiceDetail struct {
	ID                   string `json:"id"`
	Description          string `json:"description"`
	LoadState            string `json:"loadState"`
	ActiveState          string `json:"activeState"`
	SubState             string `json:"subState"`
	MainPID              string `json:"mainPid"`
	ExecStart            string `json:"execStart"`
	FragmentPath         string `json:"fragmentPath"`
	ActiveEnterTimestamp string `json:"activeEnterTimestamp"`
	MemoryCurrent        string `json:"memoryCurrent"`
	CPUTimeNSec          string `json:"cpuTimeNsec"`
	Restart              string `json:"restart"`
	User                 string `json:"user"`
}

type Cron struct {
	User   string `json:"user"`
	Line   string `json:"line"`
	Source string `json:"source"` // user / etc-cron.d / etc-crontab
}

type AptPackage struct {
	Name    string   `json:"name"`
	Version string   `json:"version"`
	Depends int      `json:"depends"` // 依赖包数量
	DepList []string `json:"depList"` // 解析后的直接依赖名（dpkg Depends 字段）
}

// LogResult 日志采集结果（末尾 N 行）
type LogResult struct {
	Content string `json:"content"` // 日志文本
	Source  string `json:"source"`  // 数据来源（如 /var/log/syslog；空表示未找到）
}
