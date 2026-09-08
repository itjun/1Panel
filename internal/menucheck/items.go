package menucheck

// Item 一条菜单检查目标。
type Item struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	URL   string `json:"url"`
}

// DefaultItems 内置检查项（URL 含会话参数，过期后需更新）。
func DefaultItems() []Item {
	return []Item{
		{
			ID:    "data-report",
			Label: "数据上报",
			URL:   "https://csp.example.com/000000/FrmPurInventoryRecord?sid=REDACTED&CLIENTID=REDACTED&device=pc&corpNo=000000",
		},
	}
}
