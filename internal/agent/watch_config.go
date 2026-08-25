package agent

import (
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
	GCPauseMarkMs  float64        `yaml:"gcPauseMarkMs" json:"gcPauseMarkMs"`
	Services       []ServiceWatch `yaml:"services" json:"services"`
}

// ServiceWatch 一个微服务监视组
type ServiceWatch struct {
	Name          string       `yaml:"name" json:"name"`
	Runtime       string       `yaml:"runtime" json:"runtime"` // java / bun
	JarContains   string       `yaml:"jarContains" json:"jarContains"`
	PortFrom      int          `yaml:"portFrom" json:"portFrom"`
	PortTo        int          `yaml:"portTo" json:"portTo"`
	HealthPath    string       `yaml:"healthPath" json:"healthPath"`
	ScrapeMetrics bool         `yaml:"scrapeMetrics" json:"scrapeMetrics"`
	Ingress       IngressProbe `yaml:"ingress" json:"ingress"`
}

// IngressProbe nginx 本机反代探活（不要探 /actuator，beta-erp 会 404）
type IngressProbe struct {
	Enabled    bool   `yaml:"enabled" json:"enabled"`
	URL        string `yaml:"url" json:"url"`
	HostHeader string `yaml:"hostHeader" json:"hostHeader"`
}

const defaultWatchYAML = `# spanel-agent 应用监视（Webhook 不要提交到 git）
wecomWebhook: ""
intervalSec: 15
failStreak: 2
dedupSec: 600
probeTimeoutMs: 2000
gcPauseMarkMs: 200
services:
  - name: oss
    jarContains: diteng-oss
    portFrom: 8011
    portTo: 8019
    healthPath: /actuator/health
    scrapeMetrics: true
    ingress:
      enabled: true
      url: http://127.0.0.1/
      hostHeader: beta-erp.example.com
  - name: csp
    jarContains: diteng-csp
    portFrom: 8201
    portTo: 8209
    healthPath: /actuator/health
    scrapeMetrics: true
    ingress:
      enabled: false
      url: http://127.0.0.1/
      hostHeader: beta-erp.example.com
  - name: std
    jarContains: diteng-std
    portFrom: 8301
    portTo: 8309
    healthPath: /actuator/health
    scrapeMetrics: true
    ingress:
      enabled: false
      url: http://127.0.0.1/
      hostHeader: beta-erp.example.com
  - name: fpl
    jarContains: custom-fpl
    portFrom: 8401
    portTo: 8409
    healthPath: /actuator/health
    scrapeMetrics: true
    ingress:
      enabled: false
      url: http://127.0.0.1/
      hostHeader: beta-erp.example.com
  - name: zhetai
    jarContains: custom-zhetai
    portFrom: 8501
    portTo: 8509
    healthPath: /actuator/health
    scrapeMetrics: true
    ingress:
      enabled: false
      url: http://127.0.0.1/
      hostHeader: beta-erp.example.com
  - name: im
    runtime: java
    jarContains: diteng-im-server
    portFrom: 8101
    portTo: 8109
    healthPath: /actuator/health
    scrapeMetrics: true
    ingress:
      enabled: true
      url: http://127.0.0.1/
      hostHeader: beta.example.com
  - name: ai-agent
    runtime: bun
    jarContains: ai-agent
    portFrom: 3060
    portTo: 3060
    healthPath: /health
    scrapeMetrics: false
    ingress:
      enabled: false
      url: http://127.0.0.1:3060/health
      hostHeader: ""
  - name: sapi-agent
    runtime: java
    jarContains: sapi-agent
    portFrom: 50000
    portTo: 50000
    healthPath: /actuator/health
    scrapeMetrics: true
    ingress:
      enabled: false
      url: http://127.0.0.1:50000/
      hostHeader: ""
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
	if c.GCPauseMarkMs <= 0 {
		c.GCPauseMarkMs = 200
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
			s.ScrapeMetrics = false
		} else if s.HealthPath == "" {
			s.HealthPath = "/actuator/health"
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
	if !added && !patched {
		return raw, false, nil
	}
	out, err := yaml.Marshal(cfg)
	if err != nil {
		return raw, false, err
	}
	return out, true, nil
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
			s.ScrapeMetrics = false
			if s.HealthPath == "" || s.HealthPath == "/actuator/health" {
				s.HealthPath = "/health"
			}
		case "sapi-agent":
			if s.Runtime != "java" {
				s.Runtime = "java"
				changed = true
			}
			s.ScrapeMetrics = true
			if s.HealthPath == "" {
				s.HealthPath = "/actuator/health"
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
