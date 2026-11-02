package agent

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// WatchConfig /var/lib/spanel-agent/watch.yml
type WatchConfig struct {
	WecomWebhook   string         `yaml:"wecomWebhook" json:"wecomWebhook"`
	IntervalSec    int            `yaml:"intervalSec" json:"intervalSec"`
	FailStreak     int            `yaml:"failStreak" json:"failStreak"`
	DedupSec       int            `yaml:"dedupSec" json:"dedupSec"`
	ProbeTimeoutMs int            `yaml:"probeTimeoutMs" json:"probeTimeoutMs"`
	Services       []ServiceWatch `yaml:"services" json:"services"`
}

// ServiceWatch 一个微服务监视组。
// Java 只看进程+监听端口；bun 等非 Java 才用 HealthPath 做 HTTP 探活。
type ServiceWatch struct {
	Name        string `yaml:"name" json:"name"`
	Runtime     string `yaml:"runtime" json:"runtime"` // java / bun
	JarContains string `yaml:"jarContains" json:"jarContains"`
	PortFrom    int    `yaml:"portFrom" json:"portFrom"`
	PortTo      int    `yaml:"portTo" json:"portTo"`
	HealthPath  string `yaml:"healthPath,omitempty" json:"healthPath,omitempty"`
}

const defaultWatchYAML = `# spanel-agent 应用监视（Webhook 不要提交到 git）
# Java：进程在且端口起来即视为正常；仅 bun 等非 Java 配置 healthPath 做 HTTP 探活
wecomWebhook: ""
intervalSec: 15
failStreak: 2
dedupSec: 600
probeTimeoutMs: 2000
services:
  - name: oss
    jarContains: diteng-oss
    portFrom: 8011
    portTo: 8019
  - name: csp
    jarContains: diteng-csp
    portFrom: 8201
    portTo: 8209
  - name: std
    jarContains: diteng-std
    portFrom: 8301
    portTo: 8309
  - name: fpl
    jarContains: custom-fpl
    portFrom: 8401
    portTo: 8409
  - name: zhetai
    jarContains: custom-zhetai
    portFrom: 8501
    portTo: 8509
  - name: im
    runtime: java
    jarContains: diteng-im-server
    portFrom: 8101
    portTo: 8109
  - name: ai-agent
    runtime: bun
    jarContains: ai-agent
    portFrom: 3060
    portTo: 3060
    healthPath: /health
  - name: sapi-agent
    runtime: java
    jarContains: sapi-agent
    portFrom: 50000
    portTo: 50000
`

func (c *WatchConfig) normalize() {
	if c.IntervalSec <= 0 {
		c.IntervalSec = 15
	}
	if c.FailStreak <= 0 {
		c.FailStreak = 2
	}
	if c.DedupSec <= 0 {
		c.DedupSec = 600
	}
	if c.ProbeTimeoutMs <= 0 {
		c.ProbeTimeoutMs = 2000
	}
	for i := range c.Services {
		s := &c.Services[i]
		if s.Runtime == "" {
			s.Runtime = "java"
		}
		if s.Runtime == "bun" {
			if s.HealthPath == "" || s.HealthPath == "/actuator/health" {
				s.HealthPath = "/health"
			}
		} else {
			// Java 不探 HTTP
			s.HealthPath = ""
		}
		if s.PortTo < s.PortFrom {
			s.PortTo = s.PortFrom
		}
	}
}

func (c WatchConfig) interval() time.Duration {
	return time.Duration(c.IntervalSec) * time.Second
}

func (c WatchConfig) probeTimeout() time.Duration {
	return time.Duration(c.ProbeTimeoutMs) * time.Millisecond
}

func parseWatchYAML(b []byte) (WatchConfig, error) {
	var c WatchConfig
	if err := yaml.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("解析 watch.yml: %w", err)
	}
	c.normalize()
	return c, nil
}

func marshalWatchYAML(c WatchConfig) ([]byte, error) {
	return yaml.Marshal(c)
}

func watchPath(dataDir string) string {
	return filepath.Join(dataDir, "watch.yml")
}

// LoadOrInitWatch 读取 watch.yml；不存在则写入默认模板
func LoadOrInitWatch(dataDir string) (WatchConfig, error) {
	p := watchPath(dataDir)
	b, err := os.ReadFile(p)
	if err != nil {
		if !os.IsNotExist(err) {
			return WatchConfig{}, err
		}
		if err := os.WriteFile(p, []byte(defaultWatchYAML), 0o600); err != nil {
			return WatchConfig{}, err
		}
		b = []byte(defaultWatchYAML)
	}
	merged, changed, err := mergeMissingServices(b)
	if err != nil {
		return WatchConfig{}, err
	}
	if changed {
		if err := os.WriteFile(p, merged, 0o600); err != nil {
			return WatchConfig{}, err
		}
		b = merged
	}
	return parseWatchYAML(b)
}

func mergeMissingServices(raw []byte) ([]byte, bool, error) {
	cfg, err := parseWatchYAML(raw)
	if err != nil {
		return raw, false, err
	}
	def, err := parseWatchYAML([]byte(defaultWatchYAML))
	if err != nil {
		return raw, false, err
	}
	have := map[string]bool{}
	for _, s := range cfg.Services {
		have[s.Name] = true
	}
	added := false
	for _, s := range def.Services {
		if have[s.Name] {
			continue
		}
		cfg.Services = append(cfg.Services, s)
		added = true
	}
	patched := patchKnownRuntimes(&cfg)
	obsolete := watchRawHasObsoleteKeys(raw)
	if !added && !patched && !obsolete {
		return raw, false, nil
	}
	out, err := yaml.Marshal(cfg)
	if err != nil {
		return raw, false, err
	}
	return out, true, nil
}

// watchRawHasObsoleteKeys 旧模板残留：actuator 探活、JVM 指标刮取、入口层、GC 阈值
func watchRawHasObsoleteKeys(raw []byte) bool {
	for _, key := range [][]byte{
		[]byte("scrapeMetrics:"),
		[]byte("gcPauseMarkMs:"),
		[]byte("ingress:"),
		[]byte("healthPath: /actuator"),
		[]byte("healthPath: /actuator/health"),
	} {
		if bytes.Contains(raw, key) {
			return true
		}
	}
	return false
}

func patchKnownRuntimes(cfg *WatchConfig) bool {
	changed := false
	for i := range cfg.Services {
		s := &cfg.Services[i]
		switch s.Name {
		case "ai-agent":
			if s.Runtime != "bun" {
				s.Runtime = "bun"
				changed = true
			}
			if s.HealthPath == "" || s.HealthPath == "/actuator/health" {
				if s.HealthPath != "/health" {
					changed = true
				}
				s.HealthPath = "/health"
			}
		case "sapi-agent":
			if s.Runtime != "java" {
				s.Runtime = "java"
				changed = true
			}
			if s.HealthPath != "" {
				s.HealthPath = ""
				changed = true
			}
		default:
			if s.Runtime == "java" || s.Runtime == "" {
				if s.HealthPath != "" {
					s.HealthPath = ""
					changed = true
				}
			}
		}
	}
	return changed
}

func saveWatchYAML(dataDir string, raw []byte) (WatchConfig, error) {
	c, err := parseWatchYAML(raw)
	if err != nil {
		return c, err
	}
	if err := os.WriteFile(watchPath(dataDir), raw, 0o600); err != nil {
		return c, err
	}
	return c, nil
}

func matchService(s ServiceWatch, cmdline string, ports []int) bool {
	cmd := strings.ToLower(cmdline)
	jar := strings.ToLower(s.JarContains)
	if jar != "" && strings.Contains(cmd, jar) {
		return true
	}
	for _, p := range ports {
		if p >= s.PortFrom && p <= s.PortTo {
			return true
		}
	}
	return false
}

func matchWatched(s ServiceWatch, p javaProc) bool {
	rt := s.Runtime
	if rt == "" {
		rt = "java"
	}
	comm := strings.ToLower(p.Comm)
	if rt == "bun" {
		if comm != "bun" && comm != "node" && comm != "nodejs" {
			return false
		}
	} else if comm != "java" {
		return false
	}
	return matchService(s, p.Cmdline, p.Ports)
}
