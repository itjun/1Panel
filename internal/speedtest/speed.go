package speedtest

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"diteng-pannel/internal/prochide"
)

// 合法协商速率上限（400GbE）；驱动以 -1 / 0xFFFFFFFF 表示未知
const maxLinkMbps = 400000

func validSpeed(v int) int {
	if v <= 0 || v > maxLinkMbps {
		return 0
	}
	return v
}

// sysSpeedScript 远端 Linux：逐网卡输出「名称 速率」；网桥自身无速率时取成员网卡的最大值
const sysSpeedScript = `for d in /sys/class/net/*; do n=${d##*/}; s=$(cat "$d/speed" 2>/dev/null)
if [ -z "$s" ] || [ "$s" -le 0 ] 2>/dev/null; then s=0; for m in "$d"/brif/*; do [ -e "$m" ] || continue
v=$(cat "/sys/class/net/${m##*/}/speed" 2>/dev/null); [ -n "$v" ] && [ "$v" -gt "$s" ] 2>/dev/null && s=$v; done; fi
echo "$n $s"; done; true`

// parseSysSpeeds 解析 sysSpeedScript 输出
func parseSysSpeeds(out string) map[string]int {
	m := map[string]int{}
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) != 2 {
			continue
		}
		v, err := strconv.Atoi(f[1])
		if err != nil {
			continue
		}
		if v = validSpeed(v); v > 0 {
			m[f[0]] = v
		}
	}
	return m
}

var (
	reIfconfigHead  = regexp.MustCompile(`^([^\s:]+):\s+flags=`)
	reIfconfigMedia = regexp.MustCompile(`(?i)media:.*?\b(\d+)(G?)base`)
)

// parseIfconfigSpeeds 解析 macOS `ifconfig` 的 media 行（如 autoselect (2500Base-T <full-duplex>)）；
// 无线网卡没有 xxxbase 字样，不计入
func parseIfconfigSpeeds(out string) map[string]int {
	m := map[string]int{}
	cur := ""
	for _, line := range strings.Split(out, "\n") {
		if h := reIfconfigHead.FindStringSubmatch(line); h != nil {
			cur = h[1]
			continue
		}
		if cur == "" {
			continue
		}
		if g := reIfconfigMedia.FindStringSubmatch(line); g != nil {
			v, _ := strconv.Atoi(g[1])
			if g[2] != "" {
				v *= 1000
			}
			if v = validSpeed(v); v > 0 {
				m[cur] = v
			}
		}
	}
	return m
}

// parseWinSpeeds 解析「名称|bps」行（Get-NetAdapter 的 ReceiveLinkSpeed）
func parseWinSpeeds(out string) map[string]int {
	m := map[string]int{}
	for _, line := range strings.Split(out, "\n") {
		i := strings.LastIndexByte(line, '|')
		if i <= 0 {
			continue
		}
		bps, err := strconv.ParseInt(strings.TrimSpace(line[i+1:]), 10, 64)
		if err != nil {
			continue
		}
		if v := validSpeed(int(bps / 1_000_000)); v > 0 {
			m[strings.TrimSpace(line[:i])] = v
		}
	}
	return m
}

// localSpeeds 本机各网卡协商速率；读取失败返回空表
func localSpeeds(ctx context.Context) map[string]int {
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	switch runtime.GOOS {
	case "linux":
		return linuxSysSpeeds()
	case "darwin":
		out, err := exec.CommandContext(cctx, "ifconfig").Output()
		if err != nil {
			return nil
		}
		return parseIfconfigSpeeds(string(out))
	case "windows":
		cmd := exec.CommandContext(cctx, "powershell", "-NoProfile", "-NonInteractive", "-Command",
			// 中文系统默认 GBK 输出，网卡名会与 net.Interfaces 对不上
			`[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-NetAdapter | ForEach-Object { $_.Name + '|' + $_.ReceiveLinkSpeed }`)
		prochide.Hide(cmd)
		out, err := cmd.Output()
		if err != nil {
			return nil
		}
		return parseWinSpeeds(string(out))
	}
	return nil
}

func linuxSysSpeeds() map[string]int {
	read := func(name string) int {
		b, err := os.ReadFile(filepath.Join("/sys/class/net", name, "speed"))
		if err != nil {
			return 0
		}
		v, _ := strconv.Atoi(strings.TrimSpace(string(b)))
		return validSpeed(v)
	}
	dirs, _ := os.ReadDir("/sys/class/net")
	m := map[string]int{}
	for _, d := range dirs {
		v := read(d.Name())
		if v == 0 {
			members, _ := os.ReadDir(filepath.Join("/sys/class/net", d.Name(), "brif"))
			for _, mb := range members {
				v = max(v, read(mb.Name()))
			}
		}
		if v > 0 {
			m[d.Name()] = v
		}
	}
	return m
}

// applySpeeds 按网卡名回填协商速率
func applySpeeds(addrs []Addr, speeds map[string]int) []Addr {
	for i := range addrs {
		if addrs[i].Iface != "" {
			addrs[i].SpeedMbps = speeds[addrs[i].Iface]
		}
	}
	return addrs
}

// linkMbps 链路上限：两端已知速率取较小者，只知一端时取该端
func linkMbps(a, b int) int {
	switch {
	case a > 0 && b > 0:
		return min(a, b)
	case a > 0:
		return a
	default:
		return b
	}
}
