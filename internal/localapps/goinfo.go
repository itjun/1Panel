package localapps

import (
	"debug/buildinfo"
	"time"
)

// Go 二进制识别（macOS / Windows 共用）：路径缓存 15s。
const goPathCacheTTL = 15 * time.Second

type goCacheEntry struct {
	at        time.Time
	isGo      bool
	module    string
	goVersion string
}

var goPathCache = map[string]goCacheEntry{}

func lookupGoInfo(exe string) goCacheEntry {
	if exe == "" {
		return goCacheEntry{}
	}
	if e, ok := goPathCache[exe]; ok && time.Since(e.at) < goPathCacheTTL {
		return e
	}
	e := goCacheEntry{at: time.Now()}
	bi, err := buildinfo.ReadFile(exe)
	if err == nil && bi != nil {
		e.isGo = true
		e.goVersion = bi.GoVersion
		e.module = bi.Path
		if bi.Main.Path != "" {
			e.module = bi.Main.Path
		}
	}
	goPathCache[exe] = e
	return e
}
