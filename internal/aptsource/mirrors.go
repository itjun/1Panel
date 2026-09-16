package aptsource

// Mirror 一个可测/可切换的归档镜像。
type Mirror struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Host string `json:"host"`
}

const (
	IDOfficial = "official"
	IDAliyun   = "aliyun"
	IDTsinghua = "tsinghua"
	IDUSTC     = "ustc"
	IDHuawei   = "huawei"
	IDTencent  = "tencent"
)

var ubuntuMirrors = []Mirror{
	{ID: IDOfficial, Name: "官方", Host: "archive.ubuntu.com"},
	{ID: IDAliyun, Name: "阿里云", Host: "mirrors.aliyun.com"},
	{ID: IDTsinghua, Name: "清华", Host: "mirrors.tuna.tsinghua.edu.cn"},
	{ID: IDUSTC, Name: "中科大", Host: "mirrors.ustc.edu.cn"},
	{ID: IDHuawei, Name: "华为云", Host: "mirrors.huaweicloud.com"},
	{ID: IDTencent, Name: "腾讯云", Host: "mirrors.cloud.tencent.com"},
}

var debianMirrors = []Mirror{
	{ID: IDOfficial, Name: "官方", Host: "deb.debian.org"},
	{ID: IDAliyun, Name: "阿里云", Host: "mirrors.aliyun.com"},
	{ID: IDTsinghua, Name: "清华", Host: "mirrors.tuna.tsinghua.edu.cn"},
	{ID: IDUSTC, Name: "中科大", Host: "mirrors.ustc.edu.cn"},
	{ID: IDHuawei, Name: "华为云", Host: "mirrors.huaweicloud.com"},
	{ID: IDTencent, Name: "腾讯云", Host: "mirrors.cloud.tencent.com"},
}

// MirrorsFor 按发行版返回测速/改写候选（含官方）。
func MirrorsFor(distroID string) []Mirror {
	if distroID == "debian" {
		return debianMirrors
	}
	return ubuntuMirrors
}

func mirrorByID(distroID, id string) (Mirror, bool) {
	for _, m := range MirrorsFor(distroID) {
		if m.ID == id || m.Host == id {
			return m, true
		}
	}
	return Mirror{}, false
}

// 已知 Ubuntu/Debian 归档主机：只改这些，PPA 等第三方不动。
var knownArchiveHosts = map[string]bool{
	"archive.ubuntu.com":              true,
	"security.ubuntu.com":             true,
	"ports.ubuntu.com":                true,
	"cn.archive.ubuntu.com":           true,
	"deb.debian.org":                  true,
	"security.debian.org":             true,
	"ftp.debian.org":                  true,
	"mirrors.aliyun.com":              true,
	"mirrors.tuna.tsinghua.edu.cn":    true,
	"mirrors.ustc.edu.cn":             true,
	"mirrors.huaweicloud.com":         true,
	"mirrors.cloud.tencent.com":       true,
	"mirrors.163.com":                 true,
	"mirrors.cloud.aliyuncs.com":      true,
}

func isArchiveHost(host string) bool {
	return knownArchiveHosts[host]
}
