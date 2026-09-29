package main

import (
	"runtime/debug"
	"fmt"
	"net/url"
	"runtime"
	"strings"

	"diteng-pannel/internal/agentres"
)

// 应用元信息（「关于」分区展示）。
// 仓库地址与发布页来源：git remote（github.com:itjun/1Panel）。
const (
	appCopyright   = "© 2026 itjun"
	appRepoHTTP    = "https://github.com/itjun/1Panel"
	appReleasesURL = "https://github.com/itjun/1Panel/releases"
	appIssuesURL   = "https://github.com/itjun/1Panel/issues"
	appShortDesc   = "macOS / Windows 原生运维管理面板"
)

// buildVersion 发布构建时经 -ldflags -X 注入（如 v1.2.0）；本地开发为空。
var buildVersion = ""

// AppInfo 「关于」信息。
type AppInfo struct {
	AppName     string `json:"appName"`
	Version     string `json:"version"`
	Commit      string `json:"commit"`
	CommitTime  string `json:"commitTime"`
	GoVersion   string `json:"goVersion"`
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	AgentVer    string `json:"agentVer"`
	Description string `json:"description"`
	Copyright   string `json:"copyright"`
	RepoURL     string `json:"repoUrl"`
	ReleasesURL string `json:"releasesUrl"`
	IssuesURL   string `json:"issuesUrl"`
}

// GetAppInfo 返回应用与运行环境信息（设置页「关于」）。
func (s *System) GetAppInfo() AppInfo {
	info := AppInfo{
		AppName:     "1Panel",
		Version:     resolveAppVersion(),
		GoVersion:   runtime.Version(),
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		AgentVer:    agentres.AgentVersion,
		Description: appShortDesc,
		Copyright:   appCopyright,
		RepoURL:     appRepoHTTP,
		ReleasesURL: appReleasesURL,
		IssuesURL:   appIssuesURL,
	}
	commit, commitTime, isDirty := buildVCSInfo()
	info.Commit = commit
	info.CommitTime = commitTime
	if isDirty {
		info.Commit = commit + "（含未提交修改）"
	}
	return info
}

// resolveAppVersion 版本来源优先级：ldflags 注入 > 模块版本（go install/tag 构建）> 开发构建。
func resolveAppVersion() string {
	if v := strings.TrimSpace(buildVersion); v != "" {
		return v
	}
	if bi, ok := readBuildInfo(); ok {
		if v := strings.TrimSpace(bi.Main.Version); v != "" && v != "(devel)" {
			return v
		}
	}
	return "开发构建"
}

// buildVCSInfo 从 buildinfo 读 vcs.revision / vcs.time（go build 默认写入；
// 发布构建 -trimpath -buildvcs=false 时为空，前端显示「—」）。
func buildVCSInfo() (commit, commitTime string, isDirty bool) {
	bi, ok := readBuildInfo()
	if !ok {
		return "", "", false
	}
	for _, kv := range bi.Settings {
		switch kv.Key {
		case "vcs.revision":
			commit = kv.Value
		case "vcs.time":
			commitTime = kv.Value
		case "vcs.modified":
			isDirty = kv.Value == "true"
		}
	}
	if len(commit) > 12 {
		commit = commit[:12]
	}
	return commit, commitTime, isDirty
}

// OpenExternalURL 用系统默认浏览器打开 http(s) 链接（「关于」页链接按钮）。
func (s *System) OpenExternalURL(target string) error {
	u, err := url.Parse(target)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("仅支持打开 http(s) 链接")
	}
	return openSystemURL(target)
}

func readBuildInfo() (*debug.BuildInfo, bool) {
	bi, ok := debug.ReadBuildInfo()
	if !ok || bi == nil {
		return nil, false
	}
	return bi, true
}
