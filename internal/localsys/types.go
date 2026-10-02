// Package localsys 提供本机系统信息采集（概览 / 网络 / 软件 / Nginx / 磁盘空间 / Hosts）。
// 不经 SSH，直接读本机；通用采集走 gopsutil，平台差异在各平台文件（overview_common.go 钩子）。
package localsys

// Overview 本机系统概览（字段对齐 monitor.Overview，便于前端复用环图）。
type Overview struct {
	CPUPercent  float64 `json:"cpuPercent"`
	MemPercent  float64 `json:"memPercent"`
	MemTotal    uint64  `json:"memTotal"`
	MemUsed     uint64  `json:"memUsed"`
	SwapPercent float64 `json:"swapPercent"`
	SwapTotal   uint64  `json:"swapTotal"`
	SwapUsed    uint64  `json:"swapUsed"`
	Load1       float64 `json:"load1"`
	Load5       float64 `json:"load5"`
	Load15      float64 `json:"load15"`
	Uptime      uint64  `json:"uptime"`
	Kernel      string  `json:"kernel"`
	OSRelease   string  `json:"osRelease"`
	CPUCount    int     `json:"cpuCount"`
	CPUModel    string  `json:"cpuModel"`
	PerfCores   int     `json:"perfCores"` // 性能核心（Apple Silicon）；0 表示无区分
	EffCores    int     `json:"effCores"`  // 能效核心
	// 分簇使用率：有 P/E 拓扑时由 per-CPU tick 汇总；无区分时为 0
	PerfCPUPercent float64 `json:"perfCpuPercent"`
	EffCPUPercent  float64 `json:"effCpuPercent"`
	// 每个逻辑核使用率（Apple Silicon 核序：先性能核、再能效核）
	CPUCores  []CPUCoreStat `json:"cpuCores"`
	Hostname  string        `json:"hostname"`
	Arch      string        `json:"arch"`
	IPAddress string        `json:"ipAddress"` // 内网主 IP
	PublicIP  string        `json:"publicIP"`  // 出口公网 IP（缓存探测，可能为空）
	// 累计计数：前端差分算速率（对齐 monitor.Overview）
	NetRxBytes     uint64 `json:"netRxBytes"`
	NetTxBytes     uint64 `json:"netTxBytes"`
	DiskReadBytes  uint64 `json:"diskReadBytes"`
	DiskWriteBytes uint64 `json:"diskWriteBytes"`
	DiskIOCount    uint64 `json:"diskIOCount"`
	// macOS 扩展
	ModelName   string     `json:"modelName"`   // 如 Mac16,13
	ProductName string     `json:"productName"` // 如 macOS
	ProductVer  string     `json:"productVer"`  // 如 15.0
	Disks       []DiskInfo `json:"disks"`
	Runtimes    []Runtime  `json:"runtimes"`
	// 系统温度（AppleSMC；不可用时字段为 nil）
	TempC    *float64 `json:"tempC,omitempty"`    // 综合（CPU/GPU 平均）
	CpuTempC *float64 `json:"cpuTempC,omitempty"` // CPU 相关传感器平均
	GpuTempC *float64 `json:"gpuTempC,omitempty"` // GPU 相关传感器平均
}

// CPUCoreStat 单个逻辑核使用率。
// Kind: "perf" | "eff" | ""（无 P/E 拓扑或超出划分范围时为空）。
type CPUCoreStat struct {
	Index   int     `json:"index"`
	Percent float64 `json:"percent"`
	Kind    string  `json:"kind"`
}

// DiskInfo 磁盘卷或物理容器。
type DiskInfo struct {
	Mount      string  `json:"mount"`
	Device     string  `json:"device"`
	Filesystem string  `json:"filesystem"`
	FSType     string  `json:"fsType"`
	Total      uint64  `json:"total"`
	Used       uint64  `json:"used"`
	Free       uint64  `json:"free"`
	Avail      uint64  `json:"avail"`
	Percent    float64 `json:"percent"`
	Kind       string  `json:"kind"`     // disk=物理盘；mount=挂载卷
	Parent     string  `json:"parent"`   // 物理盘键：如 disk0（APFS 卷按 Physical Store 归到物理盘）
	Name       string  `json:"name"`     // 展示名：如 Macintosh HD；外置盘取卷名
	External   bool    `json:"external"` // 外置物理盘（USB / 雷雳）上的盘或卷
}

// Runtime 已安装的运行时版本。
type Runtime struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Path    string `json:"path"`
}

// NetworkSnapshot 本机网络摘要（不做连接表）。
type NetworkSnapshot struct {
	Interfaces     []NetInterface `json:"interfaces"`
	PrivateIPs     []string       `json:"privateIPs"`
	DefaultGateway string         `json:"defaultGateway"`
	PrimaryIP      string         `json:"primaryIP"`
	PrimaryIface   string         `json:"primaryIface"`
}

// NetInterface 网卡。
type NetInterface struct {
	Name    string `json:"name"`
	Display string `json:"display"` // hardware port 名，如 Wi-Fi
	Kind    string `json:"kind"`    // wifi / ethernet / thunderbolt / vpn / other
	State   string `json:"state"`   // up / down
	MTU     int    `json:"mtu"`
	MAC     string `json:"mac"`
	IPv4    string `json:"ipv4"`
	IPv6    string `json:"ipv6"`
	RxBytes uint64 `json:"rxBytes"`
	TxBytes uint64 `json:"txBytes"`
}

// Package 已安装软件。
type Package struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Source  string `json:"source"` // app / formula / cask
	Path    string `json:"path"`
}

// NginxInfo Nginx 配置概览。
type NginxInfo struct {
	Installed bool         `json:"installed"`
	Running   bool         `json:"running"`
	Version   string       `json:"version"`
	ConfPath  string       `json:"confPath"`
	ConfDir   string       `json:"confDir"`
	Files     []NginxFile  `json:"files"`
}

// NginxFile 配置文件条目（不含内容）。
type NginxFile struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// HostsInfo /etc/hosts 内容。
type HostsInfo struct {
	Raw     string       `json:"raw"`
	Entries []HostEntry  `json:"entries"`
}

// HostEntry 解析后的 hosts 行。
type HostEntry struct {
	IP       string   `json:"ip"`
	Names    []string `json:"names"`
	Comment  string   `json:"comment"`
	Disabled bool     `json:"disabled"`
	Raw      string   `json:"raw"`
}

// StorageStatus 磁盘占用扫描状态。
// state: idle | running | done | error
type StorageStatus struct {
	State          string   `json:"state"`
	ScannedBytes   uint64   `json:"scannedBytes"`
	ScannedFiles   int64    `json:"scannedFiles"`
	ScannedDirs    int64    `json:"scannedDirs"`
	DeniedDirs     int      `json:"deniedDirs"`
	DeniedPaths    []string `json:"deniedPaths"` // 最多保留若干条示例
	Error          string   `json:"error,omitempty"`
	StartedAt      int64    `json:"startedAt"`  // unix 秒；0=未开始
	FinishedAt     int64    `json:"finishedAt"` // unix 秒
	Roots          []string `json:"roots"`
	ContainerTotal uint64   `json:"containerTotal"`
	ContainerUsed  uint64   `json:"containerUsed"`
	ContainerAvail uint64   `json:"containerAvail"`
}

// StorageNode 目录树节点（children 仅一层）。
type StorageNode struct {
	Name     string        `json:"name"`
	Path     string        `json:"path"`
	Size     uint64        `json:"size"`
	Files    int           `json:"files"`
	Dirs     int           `json:"dirs"`
	IsDir    bool          `json:"isDir"`
	Children []StorageNode `json:"children,omitempty"`
}

// StorageAppPart 应用关联的一块占用。
type StorageAppPart struct {
	Label string `json:"label"`
	Path  string `json:"path"`
	Size  uint64 `json:"size"`
}

// StorageApp 按应用汇总的占用。
type StorageApp struct {
	Name       string           `json:"name"`
	BundleID   string           `json:"bundleId"`
	Path       string           `json:"path"`
	BundleSize uint64           `json:"bundleSize"`
	DataSize   uint64           `json:"dataSize"`
	Total      uint64           `json:"total"`
	Parts      []StorageAppPart `json:"parts,omitempty"`
}

// StorageFile 大文件条目。
type StorageFile struct {
	Path    string `json:"path"`
	Size    uint64 `json:"size"`
	ModTime int64  `json:"modTime"` // unix 秒
}
