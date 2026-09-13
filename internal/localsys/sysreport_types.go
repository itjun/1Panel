package localsys

// SystemReport 本机系统详细报告（对齐「关于本机 / 系统信息」可读内容）。
type SystemReport struct {
	Sections    []ReportSection `json:"sections"`
	CollectedAt int64           `json:"collectedAt"` // unix 秒
	Source      string          `json:"source"`      // system_profiler
	Error       string          `json:"error,omitempty"`
}

// ReportSection 报告分类（对应 system_profiler 一类 DataType）。
type ReportSection struct {
	ID    string       `json:"id"`
	Title string       `json:"title"`
	Items []ReportItem `json:"items"`
}

// ReportItem 一个设备 / 条目（可嵌套子项）。
type ReportItem struct {
	Name     string       `json:"name"`
	Rows     []ReportRow  `json:"rows"`
	Children []ReportItem `json:"children,omitempty"`
}

// ReportRow 键值行。
type ReportRow struct {
	Label string `json:"label"`
	Value string `json:"value"`
}
