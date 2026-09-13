package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"diteng-pannel/internal/wecom"
)

// JavaAppInstance 应用监视页 Java 实例行（/watch/instances）
type JavaAppInstance struct {
	Service         string `json:"service"`
	Runtime         string `json:"runtime"` // java / bun
	PID             int    `json:"pid"`
	Port            int    `json:"port"`
	DeployVer       string `json:"deployVer"`
	LatestDeployVer string `json:"latestDeployVer"` // 该 jar 所在服务目录下最新日期版本
	StartTime       string `json:"startTime"`
	Screen          string `json:"screen"`
	JarPath         string `json:"jarPath"`
	HealthUp        bool   `json:"healthUp"`
	ProcessUp       bool   `json:"processUp"`
	IngressUp       bool   `json:"ingressUp"`
	IngressOn       bool   `json:"ingressOn"`
	Status          string `json:"status"` // UP / DOWN / UNHEALTHY
	Group           string `json:"group"`  // std / pro / other
}

var (
	// 新布局 YYYYMMDD_N（如 20260908_6）；须优先于 6 位，否则会从中误切出 260908_6
	deployVer8RE = regexp.MustCompile(`\d{8}_\d+`)
	// 旧布局 YYMMDD_N（如 260903_1）
	deployVer6RE = regexp.MustCompile(`\d{6}_\d+`)
	stdServices  = map[string]bool{
		"oss": true, "im": true, "csp": true, "std": true, "telemetry": true,
	}
	proServices = map[string]bool{
		"fpl": true, "zhetai": true,
	}
	otherServices = map[string]bool{
		"ai-agent": true, "sapi-agent": true,
	}
)

func groupForService(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	if stdServices[n] {
		return "std"
	}
	if proServices[n] {
		return "pro"
	}
	if otherServices[n] {
		return "other"
	}
	// 客制私有化归 pro
	return "pro"
}

func instanceStatus(processUp, healthUp bool) string {
	if !processUp {
		return "DOWN"
	}
	if healthUp {
		return "UP"
	}
	return "UNHEALTHY"
}

func jarFromCmdline(cmdline string) string {
	fields := strings.Fields(cmdline)
	for i, f := range fields {
		if f == "-jar" && i+1 < len(fields) {
			return fields[i+1]
		}
	}
	for _, f := range fields {
		if strings.HasSuffix(f, ".jar") {
			return f
		}
	}
	return ""
}

// resolveJarPath 相对路径用 /proc/<pid>/cwd 拼成绝对路径，便于从目录名抽部署版本。
func resolveJarPath(procRoot string, pid int, jar string) string {
	if jar == "" {
		return ""
	}
	if filepath.IsAbs(jar) {
		return filepath.Clean(jar)
	}
	if procRoot == "" {
		procRoot = "/proc"
	}
	if pid <= 0 {
		return jar
	}
	cwd, err := os.Readlink(fmt.Sprintf("%s/%d/cwd", procRoot, pid))
	if err != nil || cwd == "" {
		return jar
	}
	return filepath.Clean(filepath.Join(cwd, jar))
}

func deployVerFromPath(path string) string {
	if path == "" {
		return ""
	}
	if m := deployVer8RE.FindString(path); m != "" {
		return m
	}
	return deployVer6RE.FindString(path)
}

func isDeployVerName(name string) bool {
	if name == "" {
		return false
	}
	if deployVer8RE.FindString(name) == name {
		return true
	}
	return deployVer6RE.FindString(name) == name
}

// normalizeDeployDate 比较用：6 位 YYMMDD 补成 20YYMMDD，与 8 位对齐。
// 日为 10 时尤其关键：未对齐则 "260903" 字典序大于 "20260910"。
func normalizeDeployDate(date string) string {
	if len(date) == 6 {
		return "20" + date
	}
	return date
}

// compareDeployVer 部署版本先后：先比对齐后的日期再比序号；a>b 返回正数
func compareDeployVer(a, b string) int {
	if a == b {
		return 0
	}
	if a == "" {
		return -1
	}
	if b == "" {
		return 1
	}
	aDate, aSeq, _ := strings.Cut(a, "_")
	bDate, bSeq, _ := strings.Cut(b, "_")
	aDate = normalizeDeployDate(aDate)
	bDate = normalizeDeployDate(bDate)
	if aDate != bDate {
		return strings.Compare(aDate, bDate)
	}
	ai, _ := strconv.Atoi(aSeq)
	bi, _ := strconv.Atoi(bSeq)
	return ai - bi
}

// serviceDeployDir 从 jar 路径取服务独立目录。
// 新：/root/workspace/oss/20260908_1/xxx.jar → /root/workspace/oss
// 旧：/root/workspace/260903_1/xxx.jar → /root/workspace
func serviceDeployDir(jarPath string) string {
	ver := deployVerFromPath(jarPath)
	if ver == "" {
		return ""
	}
	dir := filepath.Clean(filepath.Dir(jarPath))
	if filepath.Base(dir) != ver {
		return ""
	}
	return filepath.Dir(dir)
}

// latestDeployVerInDir 扫描服务目录下 YYYYMMDD_N / YYMMDD_N 子目录，取最新
func latestDeployVerInDir(dir string) string {
	if dir == "" {
		return ""
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	latest := ""
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if !isDeployVerName(name) {
			continue
		}
		if latest == "" || compareDeployVer(name, latest) > 0 {
			latest = name
		}
	}
	return latest
}

// screenFromProc 沿父进程链查找 screen，从 cmdline 解析 -dmS / -S 会话名
func screenFromProc(procRoot string, pid int) string {
	if procRoot == "" {
		procRoot = "/proc"
	}
	cur := pid
	for depth := 0; depth < 8; depth++ {
		ppid := readPPID(procRoot, cur)
		if ppid <= 1 {
			return ""
		}
		comm, err := os.ReadFile(fmt.Sprintf("%s/%d/comm", procRoot, ppid))
		if err != nil {
			return ""
		}
		if strings.TrimSpace(string(comm)) != "screen" {
			cur = ppid
			continue
		}
		cmdb, err := os.ReadFile(fmt.Sprintf("%s/%d/cmdline", procRoot, ppid))
		if err != nil {
			return ""
		}
		return screenNameFromCmdline(strings.Join(splitCmdline(cmdb), " "))
	}
	return ""
}

func screenNameFromCmdline(cmdline string) string {
	fields := strings.Fields(cmdline)
	for i, f := range fields {
		// -dmS name / -S name；-dmS 优先（与 diteng-script 启动一致）
		if (f == "-dmS" || f == "-S") && i+1 < len(fields) {
			return fields[i+1]
		}
	}
	return ""
}

// readPPID 读 /proc/<pid>/stat 的 ppid。
// 格式：pid (comm) state ppid ... —— ) 后 fields[0]=state，fields[1]=ppid
func readPPID(procRoot string, pid int) int {
	b, err := os.ReadFile(fmt.Sprintf("%s/%d/stat", procRoot, pid))
	if err != nil {
		return 0
	}
	s := string(b)
	i := strings.LastIndex(s, ")")
	if i < 0 || i+2 > len(s) {
		return 0
	}
	fields := strings.Fields(s[i+2:])
	if len(fields) < 2 {
		return 0
	}
	ppid, _ := strconv.Atoi(fields[1])
	return ppid
}

func (w *Watcher) fetchActuatorStartTime(port int) string {
	if port <= 0 {
		return ""
	}
	w.mu.Lock()
	timeout := w.cfg.probeTimeout()
	client := w.http
	w.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	url := fmt.Sprintf("http://127.0.0.1:%d/actuator/info", port)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ""
	}
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return ""
	}
	return parseActuatorStartTime(body)
}

func parseActuatorStartTime(body []byte) string {
	var raw map[string]json.RawMessage
	if json.Unmarshal(body, &raw) != nil {
		return ""
	}
	for _, key := range []string{"系统启动时间", "startTime"} {
		if v, ok := raw[key]; ok {
			var s string
			if json.Unmarshal(v, &s) == nil && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

func formatProcStart(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01-02 15:04:05")
}

func (w *Watcher) buildJavaInstance(svc ServiceWatch, p javaProc, healthOK bool) JavaAppInstance {
	port := pickPort(p.Ports, svc.PortFrom, svc.PortTo)
	rt := svc.Runtime
	if rt == "" {
		rt = "java"
	}
	jar := jarFromCmdline(p.Cmdline)
	if jar == "" && rt == "bun" {
		jar = wecom.EntryFromCmdline(p.Cmdline)
	}
	jar = resolveJarPath(w.proc, p.PID, jar)
	inst := JavaAppInstance{
		Service:   svc.Name,
		Runtime:   rt,
		PID:       p.PID,
		Port:      port,
		DeployVer: deployVerFromPath(jar),
		Screen:    screenFromProc(w.proc, p.PID),
		JarPath:   jar,
		HealthUp:  healthOK,
		ProcessUp: true,
		Group:     groupForService(svc.Name),
	}
	if port > 0 && rt == "java" {
		inst.StartTime = w.fetchActuatorStartTime(port)
	}
	if inst.StartTime == "" {
		inst.StartTime = formatProcStart(p.StartedAt)
	}
	inst.Status = instanceStatus(true, healthOK)
	return inst
}

func (w *Watcher) layerFlags(service string) (processUp, healthUp, ingressUp, ingressOn bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if st := w.st[service+"/"+layerProcess]; st != nil {
		processUp = st.up
	}
	if st := w.st[service+"/"+layerHealth]; st != nil {
		healthUp = st.up
	}
	if st := w.st[service+"/"+layerIngress]; st != nil {
		ingressUp = st.up
	}
	for _, svc := range w.cfg.Services {
		if svc.Name == service {
			ingressOn = svc.Ingress.Enabled
			break
		}
	}
	return
}

func (w *Watcher) rebuildInstances(cfg WatchConfig, procs []javaProc, instHealth map[string]bool) {
	rows := make([]JavaAppInstance, 0, len(cfg.Services))
	latestByDir := map[string]string{}
	for _, svc := range cfg.Services {
		rt := svc.Runtime
		if rt == "" {
			rt = "java"
		}
		var matched []javaProc
		for _, p := range procs {
			if matchWatched(svc, p) {
				matched = append(matched, p)
			}
		}
		procUp, healthUp, ingressUp, ingressOn := w.layerFlags(svc.Name)
		if len(matched) == 0 {
			rows = append(rows, JavaAppInstance{
				Service:   svc.Name,
				Runtime:   rt,
				Group:     groupForService(svc.Name),
				ProcessUp: procUp,
				HealthUp:  healthUp,
				IngressUp: ingressUp,
				IngressOn: ingressOn,
				Status:    "DOWN",
			})
			continue
		}
		for _, p := range matched {
			key := fmt.Sprintf("%s/%d", svc.Name, p.PID)
			ok := instHealth[key]
			row := w.buildJavaInstance(svc, p, ok)
			row.IngressUp = ingressUp
			row.IngressOn = ingressOn
			if dir := serviceDeployDir(row.JarPath); dir != "" {
				if _, ok := latestByDir[dir]; !ok {
					latestByDir[dir] = latestDeployVerInDir(dir)
				}
				row.LatestDeployVer = latestByDir[dir]
			}
			rows = append(rows, row)
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		order := map[string]int{"std": 0, "pro": 1, "other": 2}
		gi, gj := order[rows[i].Group], order[rows[j].Group]
		if gi != gj {
			return gi < gj
		}
		if rows[i].Service != rows[j].Service {
			return rows[i].Service < rows[j].Service
		}
		return rows[i].Port < rows[j].Port
	})
	w.mu.Lock()
	w.instances = rows
	w.mu.Unlock()
}

func (w *Watcher) InstancesSnapshot() []JavaAppInstance {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.instances) == 0 {
		return []JavaAppInstance{}
	}
	out := make([]JavaAppInstance, len(w.instances))
	copy(out, w.instances)
	return out
}

func serviceInWatch(cfg WatchConfig, name string) (*ServiceWatch, bool) {
	for i := range cfg.Services {
		if cfg.Services[i].Name == name {
			return &cfg.Services[i], true
		}
	}
	return nil, false
}

func portInService(svc *ServiceWatch, port int) bool {
	if svc == nil || port <= 0 {
		return false
	}
	return port >= svc.PortFrom && port <= svc.PortTo
}
