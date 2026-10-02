//go:build windows

package localsys

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"

	"diteng-pannel/internal/prochide"
)

// CollectNginx 采集 Nginx 配置列表（Windows）。nginx 在 Windows 上并非标配，
// 找不到可执行文件时 Installed=false，前端按「未检测到 nginx」提示。
func CollectNginx() (*NginxInfo, error) {
	info := &NginxInfo{}
	bin := resolveNginxBinWin()
	if bin == "" {
		return info, nil
	}
	info.Installed = true
	verCmd := exec.Command(bin, "-v")
	prochide.Hide(verCmd)
	verOut, _ := verCmd.CombinedOutput()
	info.Version = parseNginxVersionText(string(verOut))

	conf := detectNginxConfWin(bin)
	info.ConfPath = conf
	if conf != "" {
		info.ConfDir = filepath.Dir(conf)
		info.Files = collectNginxFilesWin(conf)
	}
	if nginxIsRunningWin() {
		info.Running = true
	}
	return info, nil
}

func resolveNginxBinWin() string {
	for _, name := range []string{"nginx", "nginx.exe"} {
		if bin, err := exec.LookPath(name); err == nil {
			return bin
		}
	}
	// Windows 惯例：解压包放盘符根目录，目录名带版本（C:\nginx、C:\nginx-1.31.3）
	if bin := scanNginxUnderDriveRoots(); bin != "" {
		return bin
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		`C:\tools\nginx\nginx.exe`,
		`C:\Program Files\nginx\nginx.exe`,
		`C:\Program Files (x86)\nginx\nginx.exe`,
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, "nginx", "nginx.exe"),
			filepath.Join(home, "scoop", "apps", "nginx", "current", "nginx.exe"),
		)
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

// scanNginxUnderDriveRoots 扫描所有固定盘根目录下以 nginx 开头的文件夹（不区分大小写），
// 找里面的 nginx.exe。多个版本并存时取版本号最大的（nginx-1.31.3 > nginx-1.9）；
// 目录里没有版本号就当最低优先级。exe 优先取目录直属，再看一层子目录。
func scanNginxUnderDriveRoots() string {
	best := ""
	bestVer := nginxDirVersion("")
	eachFixedDrive(func(root string, rootPtr *uint16) bool {
		entries, err := os.ReadDir(root)
		if err != nil {
			return true
		}
		for _, e := range entries {
			name := e.Name()
			if !e.IsDir() || !strings.HasPrefix(strings.ToLower(name), "nginx") {
				continue
			}
			ver := nginxDirVersion(name)
			if best != "" && !nginxVerGreater(ver, bestVer) {
				continue
			}
			if bin := nginxExeInDir(filepath.Join(root, name)); bin != "" {
				best = bin
				bestVer = ver
			}
		}
		return true
	})
	return best
}

// nginxVerGreater 按字典序比较 a > b；-1 段（缺失）视为小于任何数字。
func nginxVerGreater(a, b [3]int) bool {
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

// nginxExeInDir 找目录直属或一层子目录里的 nginx.exe。
func nginxExeInDir(dir string) string {
	direct := filepath.Join(dir, "nginx.exe")
	if st, err := os.Stat(direct); err == nil && !st.IsDir() {
		return direct
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		nested := filepath.Join(dir, e.Name(), "nginx.exe")
		if st, err := os.Stat(nested); err == nil && !st.IsDir() {
			return nested
		}
	}
	return ""
}

// nginxDirVersion 从目录名提取 a.b.c 版本号，用于比较新旧；提取不到返回 -1。
func nginxDirVersion(name string) (ver [3]int) {
	ver = [3]int{-1, -1, -1}
	fields := strings.FieldsFunc(name, func(r rune) bool {
		return r == '-' || r == '_' || r == '.'
	})
	started := false
	i := 0
	for _, f := range fields {
		if f == "nginx" && !started {
			started = true
			continue
		}
		if !started {
			continue
		}
		if n, err := strconv.Atoi(f); err == nil {
			ver[i] = n
			i++
			if i == 3 {
				break
			}
		} else {
			break
		}
	}
	if i == 0 {
		return [3]int{-1, -1, -1}
	}
	return ver
}

func nginxIsRunningWin() bool {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(snap)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return false
	}
	for {
		name := strings.ToLower(windows.UTF16ToString(entry.ExeFile[:]))
		if name == "nginx.exe" {
			return true
		}
		if err := windows.Process32Next(snap, &entry); err != nil {
			return false
		}
	}
}

// NginxRead 读取配置文件内容；路径必须在 nginx 安装目录树内。
// Windows 解压布局里 conf.d、html 等与 conf 平级（include 常引平级 conf.d），
// 只按 conf 目录校验会误杀，放行范围取 conf 目录或其父目录（安装根）之内。
func NginxRead(path string) (string, error) {
	info, err := CollectNginx()
	if err != nil {
		return "", err
	}
	if info.ConfDir == "" {
		return "", os.ErrNotExist
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if !withinNginxTree(info.ConfDir, abs) {
		return "", os.ErrPermission
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// withinNginxTree 判断 target 是否落在 conf 目录或其父目录（安装根）之下。
func withinNginxTree(confDir, target string) bool {
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	allowed := []string{confDir, filepath.Dir(confDir)}
	for _, root := range allowed {
		rootAbs, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(rootAbs, targetAbs)
		if err != nil {
			continue
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		return true
	}
	return false
}

func parseNginxVersionText(raw string) string {
	raw = strings.TrimSpace(raw)
	if i := strings.LastIndex(raw, "/"); i >= 0 {
		return strings.TrimSpace(raw[i+1:])
	}
	return raw
}

func detectNginxConfWin(bin string) string {
	verCmd := exec.Command(bin, "-V")
	prochide.Hide(verCmd)
	out, _ := verCmd.CombinedOutput()
	for _, part := range strings.Fields(string(out)) {
		if v, ok := strings.CutPrefix(part, "--conf-path="); ok {
			if st, err := os.Stat(v); err == nil && !st.IsDir() {
				return v
			}
		}
	}
	// Windows 版 nginx 默认 conf 在 exe 同级 conf\nginx.conf
	cand := filepath.Join(filepath.Dir(bin), "conf", "nginx.conf")
	if st, err := os.Stat(cand); err == nil && !st.IsDir() {
		return cand
	}
	return ""
}

// collectNginxFilesWin 只列用户会改的配置：主配置 nginx.conf + conf.d 下的文件。
// mime.types、fastcgi_params 等 nginx 自带文件不进列表（一般不修改）；
// Windows 解压布局 conf.d 与 conf 平级，两处都扫。
func collectNginxFilesWin(mainConf string) []NginxFile {
	confDir := filepath.Dir(mainConf)
	seen := map[string]bool{}
	var files []NginxFile
	add := func(path string) {
		abs, err := filepath.Abs(path)
		if err != nil {
			return
		}
		if seen[abs] {
			return
		}
		st, err := os.Stat(abs)
		if err != nil || st.IsDir() {
			return
		}
		seen[abs] = true
		files = append(files, NginxFile{
			Name: filepath.Base(abs),
			Path: abs,
			Size: st.Size(),
		})
	}
	add(mainConf)
	for _, base := range []string{confDir, filepath.Dir(confDir)} {
		entries, err := os.ReadDir(filepath.Join(base, "conf.d"))
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			if strings.HasSuffix(e.Name(), ".conf") || !strings.Contains(e.Name(), ".") {
				add(filepath.Join(base, "conf.d", e.Name()))
			}
		}
	}
	return files
}

// listNginxFiles Windows：CollectNginx 未走公共层（自带 collectNginxFilesWin），占位。
func listNginxFiles(conf string) []NginxFile {
	return nil
}
