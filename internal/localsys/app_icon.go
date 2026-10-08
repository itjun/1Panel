package localsys

import (
	"encoding/base64"
	"sync"
)

// appIconSize 图标渲染边长（像素）；列表显示 20px，按 3 倍屏留余量。
const appIconSize = 64

var appIconCache sync.Map // path -> string（data URL，空串表示无图标）

// AppIcon 返回已安装应用图标的 PNG data URL；平台不支持或取不到时返回空串，由前端显示默认图标。
func AppIcon(path string) string {
	if path == "" {
		return ""
	}
	if v, ok := appIconCache.Load(path); ok {
		return v.(string)
	}
	url := ""
	if png := appIconPNG(path, appIconSize); len(png) > 0 {
		url = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	}
	appIconCache.Store(path, url)
	return url
}
