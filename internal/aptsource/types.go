package aptsource

// Distro 从 /etc/os-release 解析出的发行版。
type Distro struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Version  string `json:"version"`
	Codename string `json:"codename"`
	Apt      bool   `json:"apt"`
}

// File 一份 apt 源文件。
type File struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	Content string `json:"content"`
}

// Snapshot GET /collect/apt-sources
type Snapshot struct {
	Distro Distro `json:"distro"`
	Files  []File `json:"files"`
}

// ProbeHit 单个镜像测速结果。
type ProbeHit struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Host  string `json:"host"`
	OK    bool   `json:"ok"`
	MS    int64  `json:"ms"`
	Error string `json:"error,omitempty"`
}

// ApplyReq POST /op/apt-apply
type ApplyReq struct {
	Mirror   string `json:"mirror"`
	Official bool   `json:"official"`
}

// ApplyResult POST /op/apt-apply 响应
type ApplyResult struct {
	BackupDir string `json:"backupDir"`
	Mirror    string `json:"mirror"`
	Name      string `json:"name"`
	Changed   int    `json:"changed"`
	UpdateOut string `json:"updateOut"`
	// 换源本身成功，但 apt-get update 未通过（多为第三方源签名/失效）。
	// 源文件已按预期改写，不该当成换源失败处理。
	UpdateFailed bool   `json:"updateFailed,omitempty"`
	UpdateErr    string `json:"updateErr,omitempty"`
}
