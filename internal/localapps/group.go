package localapps

import (
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// RawProc 分组前的原始进程（由扫描器填充；IsGo 由调用方根据 buildinfo 判定）。
type RawProc struct {
	PID             int
	PPID            int
	User            string
	Kind            string
	Runtime         string
	Confidence      string
	Evidence        []string
	CPU             float64
	RSS             uint64
	ThreadCount     int
	Elapsed         uint64
	Comm            string
	Exe             string
	Cwd             string
	Cmd             string
	Args            []string
	Ports           []int
	ListenAddresses []string
	DiskRead        uint64
	DiskWrite       uint64
	NetIn           uint64
	NetOut          uint64
	DiskReadRate    uint64
	DiskWriteRate   uint64
	NetInRate       uint64
	NetOutRate      uint64
	RateKnown       bool
	IsGo            bool
	Extra           map[string]string
	Threads         []ThreadNode
}

// DetectRuntime 识别开发语言分类（写入 AppNode.Runtime）：
// java / go / javascript / python / csharp / swift / objc / ccpp / rust / ruby / php。
// JavaScript 覆盖 node / bun / deno / npm / npx（引擎细节见 Extra["engine"]）。
// exe：可执行路径；部分 Node 子进程会改写进程名（如 next-server），需靠 exe 识别。
func DetectRuntime(comm string, args []string, exe string, isGo bool) string {
	if r := detectLanguage(filepath.Base(strings.TrimSpace(comm)), args); r != "" {
		return r
	}
	if exe != "" {
		if r := detectLanguage(filepath.Base(exe), args); r != "" {
			return r
		}
	}
	if isGo {
		return "go"
	}
	return ""
}

func detectLanguage(base string, args []string) string {
	base = strings.ToLower(strings.TrimSpace(base))
	if base == "" {
		return ""
	}
	switch {
	case base == "java":
		return "java"
	case base == "bun", base == "bun-debug", base == "node", base == "nodejs", base == "deno":
		return "javascript"
	case base == "python", strings.HasPrefix(base, "python3"), strings.HasPrefix(base, "python2"):
		return "python"
	case base == "dotnet", base == "mono", base == "mono-sgen":
		return "csharp"
	case base == "swift", base == "swift-frontend", base == "swift-driver", base == "sourcekit-lsp":
		return "swift"
	case base == "ruby", strings.HasPrefix(base, "ruby"):
		return "ruby"
	case base == "php", strings.HasPrefix(base, "php"):
		return "php"
	case base == "rustc", base == "cargo":
		return "rust"
	case base == "clang++", base == "g++", base == "c++":
		return "ccpp"
	case base == "clang", base == "gcc", base == "cc":
		// clang -fobjc… 归 Objective-C；其余当 C/C++ 工具链
		joined := strings.Join(args, " ")
		if strings.Contains(joined, "-fobjc") || strings.Contains(joined, "Objective-C") {
			return "objc"
		}
		return "ccpp"
	}
	return ""
}

// jsEngine 在 javascript 语言下细分引擎：node / bun / npm / deno。
func jsEngine(comm, exe string, args []string) string {
	base := strings.ToLower(filepath.Base(strings.TrimSpace(comm)))
	if base == "bun" || base == "bun-debug" {
		return "bun"
	}
	if base == "deno" {
		return "deno"
	}
	if argsContainNPMCli(args) {
		return "npm"
	}
	exeBase := strings.ToLower(filepath.Base(strings.TrimSpace(exe)))
	if exeBase == "bun" || exeBase == "bun-debug" {
		return "bun"
	}
	if exeBase == "deno" {
		return "deno"
	}
	return "node"
}

func argsContainNPMCli(args []string) bool {
	for _, a := range args {
		base := filepath.Base(a)
		if base == "npm-cli.js" || base == "npx-cli.js" {
			return true
		}
	}
	return false
}

// GroupApps 将开发运行时和监听服务候选归并为应用节点。
func GroupApps(procs []RawProc) []AppNode {
	if len(procs) == 0 {
		return []AppNode{}
	}

	byPID := make(map[int]*RawProc, len(procs))
	for i := range procs {
		p := &procs[i]
		if p.Runtime == "" {
			p.Runtime = DetectRuntime(p.Comm, p.Args, p.Exe, p.IsGo)
		}
		if p.Kind == "" {
			if p.Runtime != "" {
				p.Kind = AppKindRuntime
				p.Confidence = ConfidenceHigh
				p.Evidence = []string{"识别到开发运行时：" + p.Runtime}
			} else if len(p.Ports) > 0 || len(p.ListenAddresses) > 0 {
				p.Kind = AppKindService
				p.Runtime = "unknown"
				p.Confidence = ConfidenceMedium
				p.Evidence = listenerEvidence(p.ListenAddresses, p.Ports)
			}
		}
		byPID[p.PID] = p
	}

	type bucket struct {
		root       *RawProc
		kind       string
		runtime    string
		confidence string
		evidence   []string
		list       []*RawProc
	}
	buckets := map[string]*bucket{}
	order := []string{}

	for i := range procs {
		p := &procs[i]
		root := findRuntimeRoot(p, byPID)
		kind := root.Kind
		runtime := root.Runtime
		if runtime == "" && kind == AppKindRuntime {
			runtime = DetectRuntime(root.Comm, root.Args, root.Exe, root.IsGo)
		}
		if kind == "" || (kind == AppKindRuntime && runtime == "") {
			continue
		}
		idKey, idName := "", ""
		if kind == AppKindService {
			idKey, idName = serviceIdentity(root)
			runtime = "unknown"
		} else {
			idKey, idName, runtime = identityOf(root)
		}
		b, ok := buckets[idKey]
		if !ok {
			b = &bucket{
				root:       root,
				kind:       kind,
				runtime:    runtime,
				confidence: root.Confidence,
			}
			buckets[idKey] = b
			order = append(order, idKey)
		}
		b.list = append(b.list, p)
		b.evidence = appendUnique(b.evidence, p.Evidence...)
		_ = idName
	}

	apps := make([]AppNode, 0, len(order))
	for _, idKey := range order {
		b := buckets[idKey]
		app := AppNode{
			Key:        idKey,
			Name:       identityName(b.root, b.kind),
			Runtime:    b.runtime,
			Kind:       b.kind,
			Confidence: b.confidence,
			Evidence:   b.evidence,
			Procs:      make([]ProcNode, 0, len(b.list)),
		}
		hasSelf := false
		for _, rp := range b.list {
			node := rawToProcNode(rp, b.runtime)
			if node.Extra != nil && node.Extra["self"] == "1" {
				hasSelf = true
			}
			app.Procs = append(app.Procs, node)
			app.ProcCount++
			app.ThreadCount += node.ThreadCount
			app.CPU += node.CPU
			app.RSS += node.RSS
			app.DiskReadRate += node.DiskReadRate
			app.DiskWriteRate += node.DiskWriteRate
			app.NetInRate += node.NetInRate
			app.NetOutRate += node.NetOutRate
			if node.RateKnown {
				app.RateKnown = true
			}
		}
		sort.Slice(app.Procs, func(i, j int) bool {
			return app.Procs[i].PID < app.Procs[j].PID
		})
		if hasSelf && !strings.Contains(app.Name, "(本程序)") {
			app.Name = app.Name + " (本程序)"
		}
		apps = append(apps, app)
	}

	sort.Slice(apps, func(i, j int) bool {
		if apps[i].CPU != apps[j].CPU {
			return apps[i].CPU > apps[j].CPU
		}
		return apps[i].Key < apps[j].Key
	})
	return apps
}

func findRuntimeRoot(p *RawProc, byPID map[int]*RawProc) *RawProc {
	cur := p
	groupKind := p.Kind
	groupRuntime := p.Runtime
	seen := map[int]bool{}
	for {
		if seen[cur.PID] {
			return cur
		}
		seen[cur.PID] = true
		parent, ok := byPID[cur.PPID]
		if !ok || parent.Kind != groupKind || parent.User != p.User ||
			(groupKind == AppKindRuntime && parent.Runtime != groupRuntime) {
			return cur
		}
		cur = parent
	}
}

func serviceIdentity(root *RawProc) (key, name string) {
	exe := root.Exe
	if exe == "" {
		exe = root.Comm
	}
	if exe == "" {
		exe = "unknown"
	}
	project := filepath.Base(root.Cwd)
	if project == "." || project == "/" {
		project = ""
	}
	exeName := filepath.Base(exe)
	name = exeName
	if project != "" && project != exeName {
		name = project + " · " + exeName
	}
	key = "service:user:" + root.User + ":exe:" + exe + ":cwd:" + root.Cwd + ":root:" + strconv.Itoa(root.PID)
	return key, name
}

func identityName(root *RawProc, kind string) string {
	if kind == AppKindService {
		_, name := serviceIdentity(root)
		return name
	}
	_, name, _ := identityOf(root)
	return name
}

func listenerEvidence(addresses []string, ports []int) []string {
	evidence := make([]string, 0, len(addresses)+len(ports))
	for _, address := range addresses {
		evidence = appendUnique(evidence, "TCP 监听："+address)
	}
	if len(addresses) == 0 {
		for _, port := range uniqueSortedPorts(ports) {
			evidence = appendUnique(evidence, "TCP 监听端口："+strconv.Itoa(port))
		}
	}
	return evidence
}

func appendUnique(values []string, additions ...string) []string {
	seen := make(map[string]bool, len(values)+len(additions))
	for _, value := range values {
		seen[value] = true
	}
	for _, value := range additions {
		if value != "" && !seen[value] {
			seen[value] = true
			values = append(values, value)
		}
	}
	return values
}

// uniqueSortedPorts 去重（丢弃非正数）并升序排序端口；跨平台通用，
// 不能放进 darwin 专属文件，否则 group.go 在 Windows/Linux 下编不过。
func uniqueSortedPorts(ports []int) []int {
	seen := make(map[int]bool, len(ports))
	unique := make([]int, 0, len(ports))
	for _, port := range ports {
		if port > 0 && !seen[port] {
			seen[port] = true
			unique = append(unique, port)
		}
	}
	sort.Ints(unique)
	return unique
}

func rawToProcNode(rp *RawProc, runtime string) ProcNode {
	extra := map[string]string{}
	for k, v := range rp.Extra {
		extra[k] = v
	}
	fillIdentityExtra(extra, runtime, rp)

	args := rp.Args
	if args == nil {
		args = []string{}
	}
	ports := rp.Ports
	if ports == nil {
		ports = []int{}
	}
	threads := rp.Threads
	if threads == nil {
		threads = []ThreadNode{}
	}

	return ProcNode{
		PID:             rp.PID,
		PPID:            rp.PPID,
		User:            rp.User,
		Kind:            rp.Kind,
		Confidence:      rp.Confidence,
		Evidence:        append([]string(nil), rp.Evidence...),
		CPU:             rp.CPU,
		RSS:             rp.RSS,
		ThreadCount:     rp.ThreadCount,
		Elapsed:         rp.Elapsed,
		Exe:             rp.Exe,
		Cwd:             rp.Cwd,
		Cmd:             rp.Cmd,
		Args:            args,
		Ports:           ports,
		ListenAddresses: append([]string(nil), rp.ListenAddresses...),
		DiskRead:        rp.DiskRead,
		DiskWrite:       rp.DiskWrite,
		NetIn:           rp.NetIn,
		NetOut:          rp.NetOut,
		DiskReadRate:    rp.DiskReadRate,
		DiskWriteRate:   rp.DiskWriteRate,
		NetInRate:       rp.NetInRate,
		NetOutRate:      rp.NetOutRate,
		RateKnown:       rp.RateKnown,
		Extra:           extra,
		Threads:         threads,
	}
}

func fillIdentityExtra(extra map[string]string, runtime string, rp *RawProc) {
	switch runtime {
	case "java":
		if jar := jarFromArgs(rp.Args); jar != "" {
			extra["jar"] = jar
		}
		if mainClass := javaMainClass(rp.Args); mainClass != "" {
			extra["mainClass"] = mainClass
		}
		if name := springAppName(rp.Args); name != "" {
			extra["springApplicationName"] = name
		}
		if xmx := javaXmx(rp.Args); xmx != "" {
			extra["xmx"] = xmx
		}
	case "javascript":
		engine := jsEngine(rp.Comm, rp.Exe, rp.Args)
		extra["engine"] = engine
		if engine == "npm" {
			if script := npmRunScript(rp.Args); script != "" {
				extra["script"] = script
			}
		} else if script := scriptFromArgs(engine, rp.Args); script != "" {
			extra["script"] = script
		}
	case "python":
		if script := scriptFromArgs("python", rp.Args); script != "" {
			extra["script"] = script
		}
	case "go":
		// module / goVersion 由扫描器写入 Extra
	}
}

// identityOf 返回分组键、展示名、语言分类。
func identityOf(p *RawProc) (key, name, runtime string) {
	runtime = DetectRuntime(p.Comm, p.Args, p.Exe, p.IsGo)
	if runtime == "" {
		return "", "", ""
	}
	switch runtime {
	case "java":
		if sn := springAppName(p.Args); sn != "" {
			return "java:spring:" + sn, sn, runtime
		}
		if jar := jarFromArgs(p.Args); jar != "" {
			base := filepath.Base(jar)
			return "java:jar:" + jar, base, runtime
		}
		if mc := javaMainClass(p.Args); mc != "" {
			return "java:main:" + mc, mc, runtime
		}
		return "java:pid:" + strconv.Itoa(p.PID), "java#" + strconv.Itoa(p.PID), runtime
	case "javascript":
		engine := jsEngine(p.Comm, p.Exe, p.Args)
		if engine == "npm" {
			run := npmRunScript(p.Args)
			cwd := p.Cwd
			if cwd == "" {
				cwd = "?"
			}
			if run != "" {
				return "js:npm:cwd:" + cwd + ":run:" + run, filepath.Base(cwd) + " · npm run " + run, runtime
			}
			return "js:npm:cwd:" + cwd, filepath.Base(cwd) + " · npm", runtime
		}
		if script := scriptFromArgs(engine, p.Args); script != "" {
			return "js:" + engine + ":script:" + script, filepath.Base(script), runtime
		}
		if p.Cwd != "" {
			return "js:" + engine + ":cwd:" + p.Cwd, filepath.Base(p.Cwd), runtime
		}
		return "js:" + engine + ":pid:" + strconv.Itoa(p.PID), engine + "#" + strconv.Itoa(p.PID), runtime
	case "python":
		if script := scriptFromArgs("python", p.Args); script != "" {
			return "python:script:" + script, filepath.Base(script), runtime
		}
		if p.Cwd != "" {
			return "python:cwd:" + p.Cwd, filepath.Base(p.Cwd), runtime
		}
		return "python:pid:" + strconv.Itoa(p.PID), "python#" + strconv.Itoa(p.PID), runtime
	case "go":
		exe := p.Exe
		if exe == "" {
			exe = p.Comm
		}
		base := filepath.Base(exe)
		if exe == "" {
			return "go:pid:" + strconv.Itoa(p.PID), "go#" + strconv.Itoa(p.PID), runtime
		}
		return "go:exe:" + exe, base, runtime
	default:
		exe := p.Exe
		if exe == "" {
			exe = p.Comm
		}
		if exe != "" {
			return runtime + ":exe:" + exe, filepath.Base(exe), runtime
		}
		return runtime + ":pid:" + strconv.Itoa(p.PID), runtime + "#" + strconv.Itoa(p.PID), runtime
	}
}

func springAppName(args []string) string {
	for _, a := range args {
		if v, ok := strings.CutPrefix(a, "-Dspring.application.name="); ok {
			return v
		}
		if v, ok := strings.CutPrefix(a, "--spring.application.name="); ok {
			return v
		}
	}
	return ""
}

func jarFromArgs(args []string) string {
	for i, a := range args {
		if a == "-jar" && i+1 < len(args) {
			return args[i+1]
		}
	}
	for _, a := range args {
		if strings.HasSuffix(a, ".jar") {
			return a
		}
	}
	return ""
}

func javaMainClass(args []string) string {
	// 跳过 java 自身与 JVM 选项，找第一个不像选项/ jar 的参数
	i := 0
	if i < len(args) {
		i++ // java 可执行路径
	}
	for i < len(args) {
		a := args[i]
		if a == "-jar" {
			return "" // 有 -jar 时入口是 jar，不是主类
		}
		if strings.HasPrefix(a, "-") {
			// 部分选项带值
			if a == "-cp" || a == "-classpath" || a == "--class-path" ||
				a == "-m" || a == "--module" ||
				a == "-p" || a == "--module-path" {
				i += 2
				continue
			}
			i++
			continue
		}
		if strings.HasSuffix(a, ".jar") {
			i++
			continue
		}
		return a
	}
	return ""
}

func javaXmx(args []string) string {
	for _, a := range args {
		if strings.HasPrefix(a, "-Xmx") {
			return a[len("-Xmx"):]
		}
		if v, ok := strings.CutPrefix(a, "-XX:MaxHeapSize="); ok {
			return v
		}
	}
	return ""
}

var bunSubcommands = map[string]bool{
	"run": true, "x": true, "dev": true, "create": true,
	"install": true, "i": true, "add": true, "remove": true,
	"update": true, "upgrade": true, "init": true, "pm": true,
	"link": true, "unlink": true, "publish": true, "outdated": true,
	"patch": true, "why": true,
}

// scriptFromArgs 取解释器后第一个非选项参数作为入口脚本。
func scriptFromArgs(runtime string, args []string) string {
	fields := args
	i := 1
	skipOptions := func() bool {
		for i < len(fields) && strings.HasPrefix(fields[i], "-") {
			if fields[i] == "-c" || fields[i] == "-e" || fields[i] == "--eval" {
				return false
			}
			i++
		}
		return true
	}
	if !skipOptions() {
		return ""
	}
	if runtime == "bun" {
		for i < len(fields) && bunSubcommands[fields[i]] {
			i++
			if !skipOptions() {
				return ""
			}
		}
	}
	if i < len(fields) {
		return fields[i]
	}
	return ""
}

func npmRunScript(args []string) string {
	for i, a := range args {
		if a == "run" && i+1 < len(args) {
			next := args[i+1]
			if !strings.HasPrefix(next, "-") {
				return next
			}
		}
	}
	return ""
}
