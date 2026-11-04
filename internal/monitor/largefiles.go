package monitor

// LargeFile 磁盘上体积较大的普通文件
type LargeFile struct {
	Name string `json:"name"` // 文件名
	Dir  string `json:"dir"`  // 所在目录
	Path string `json:"path"` // 完整路径
	Size uint64 `json:"size"` // 字节
}

// LargeFilesResult 扫描结果
type LargeFilesResult struct {
	Files      []LargeFile `json:"files"`
	Incomplete bool        `json:"incomplete"` // 超时/截断
	Message    string      `json:"message,omitempty"`
	ElapsedMs  int64       `json:"elapsedMs"`
}
