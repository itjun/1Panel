package localapps

const (
	AppKindRuntime = "runtime"
	AppKindService = "service"

	ConfidenceHigh   = "high"
	ConfidenceMedium = "medium"
)

// Snapshot 一次本机应用扫描结果。
type Snapshot struct {
	SampledAt int64     `json:"sampledAt"`
	Apps      []AppNode `json:"apps"`
	Warnings  []string  `json:"warnings"`
}

// AppNode 按身份归并后的应用节点（可含多进程）。
type AppNode struct {
	Key           string     `json:"key"`
	Name          string     `json:"name"`
	Runtime       string     `json:"runtime"`    // 语言：java / go / javascript / python / csharp / swift / …
	Kind          string     `json:"kind"`       // runtime / service
	Confidence    string     `json:"confidence"` // high / medium
	Evidence      []string   `json:"evidence"`
	ProcCount     int        `json:"procCount"`
	ThreadCount   int        `json:"threadCount"`
	CPU           float64    `json:"cpu"`
	RSS           uint64     `json:"rss"`
	DiskReadRate  uint64     `json:"diskReadRate"`  // bytes/s；无数据时为 0，前端用 RateKnown 判断
	DiskWriteRate uint64     `json:"diskWriteRate"` // bytes/s
	NetInRate     uint64     `json:"netInRate"`     // bytes/s
	NetOutRate    uint64     `json:"netOutRate"`    // bytes/s
	RateKnown     bool       `json:"rateKnown"`     // 是否已有速率采样
	Procs         []ProcNode `json:"procs"`
}

// ProcNode 单个运行时进程。
type ProcNode struct {
	PID             int               `json:"pid"`
	PPID            int               `json:"ppid"`
	User            string            `json:"user"`
	Kind            string            `json:"kind"`
	Confidence      string            `json:"confidence"`
	Evidence        []string          `json:"evidence"`
	CPU             float64           `json:"cpu"`
	RSS             uint64            `json:"rss"`
	ThreadCount     int               `json:"threadCount"`
	Elapsed         uint64            `json:"elapsed"`
	Exe             string            `json:"exe"`
	Cwd             string            `json:"cwd"`
	Cmd             string            `json:"cmd"`
	Args            []string          `json:"args"`
	Ports           []int             `json:"ports"`
	ListenAddresses []string          `json:"listenAddresses"`
	DiskRead        uint64            `json:"diskRead"`
	DiskWrite       uint64            `json:"diskWrite"`
	NetIn           uint64            `json:"netIn"`
	NetOut          uint64            `json:"netOut"`
	DiskReadRate    uint64            `json:"diskReadRate"`
	DiskWriteRate   uint64            `json:"diskWriteRate"`
	NetInRate       uint64            `json:"netInRate"`
	NetOutRate      uint64            `json:"netOutRate"`
	RateKnown       bool              `json:"rateKnown"`
	Extra           map[string]string `json:"extra"` // java: jar/mainClass/xmx；go: module/goVersion；node: script；self: "1"
	Threads         []ThreadNode      `json:"threads"`
}

// ResourceSnapshot 单个进程按需读取的文件描述符快照。
type ResourceSnapshot struct {
	PID       int            `json:"pid"`
	Resources []ProcResource `json:"resources"`
	Warnings  []string       `json:"warnings"`
}

// ProcResource 单个进程打开的文件、目录、socket 或 pipe。
type ProcResource struct {
	FD            string `json:"fd"`
	Type          string `json:"type"`
	Name          string `json:"name"`
	Access        string `json:"access"`
	Protocol      string `json:"protocol"`
	State         string `json:"state"`
	LocalAddress  string `json:"localAddress"`
	RemoteAddress string `json:"remoteAddress"`
}

// ThreadNode 进程内线程摘要。
type ThreadNode struct {
	TID   uint64  `json:"tid"`
	Name  string  `json:"name"`
	CPU   float64 `json:"cpu"`
	State string  `json:"state"`
}
