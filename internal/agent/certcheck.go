package agent

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshd"
)

const certCheckFile = "cert-check.json"

// CertChecker 每天按主机本地时间 06:00 扫描 /etc/nginx/cert，结果留在数据目录。
// 06:00 时进程不在：当天晚些时候起来且今天还没扫过，立刻补扫一次。
// 06:00 之前启动：等到当天 06:00，不提前扫。同一天多次重启不重复扫。
type CertChecker struct {
	path      string
	collector *monitor.Collector
	mu        sync.Mutex
	snap      CertCheckSnapshot
}

// NewCertChecker dir 是 agent 数据目录（需已存在）。
func NewCertChecker(dir string) *CertChecker {
	c := &CertChecker{
		path:      filepath.Join(dir, certCheckFile),
		collector: monitor.NewCollector(localRunner{}),
	}
	c.load()
	return c
}

// Snapshot 返回最近一次成功扫描。还没扫过时 Scanned=false。
func (c *CertChecker) Snapshot() CertCheckSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	return cloneSnapshot(c.snap)
}

// Run 阻塞到 ctx 取消。扫描失败隔一分钟再试，避免 openssl 暂时失败时打满循环。
func (c *CertChecker) Run(ctx context.Context) {
	var failUntil time.Time
	for {
		if ctx.Err() != nil {
			return
		}
		now := time.Now()
		c.mu.Lock()
		last := c.snap.LocalDate
		c.mu.Unlock()
		scanNow, wait := certCheckDecision(now, last)
		if scanNow && now.Before(failUntil) {
			scanNow = false
			wait = failUntil.Sub(now)
		}
		if scanNow {
			if err := c.scan(now); err != nil {
				log.Printf("[cert-check] %v", err)
				failUntil = time.Now().Add(time.Minute)
				continue
			}
			failUntil = time.Time{}
			continue
		}
		if wait < time.Second {
			wait = time.Second
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (c *CertChecker) scan(now time.Time) error {
	res, err := c.collector.CollectCerts("local", sshd.ConnectOption{})
	if err != nil {
		return err
	}
	certs := make([]CertBrief, 0, len(res.Certs))
	for _, item := range res.Certs {
		certs = append(certs, CertBrief{
			Name:     item.Name,
			Domains:  append([]string{}, item.Domains...),
			Issuer:   item.Issuer,
			NotAfter: item.NotAfter,
			DaysLeft: item.DaysLeft,
		})
	}
	snap := CertCheckSnapshot{
		Scanned:     true,
		LocalDate:   now.Format("2006-01-02"),
		ScannedAt:   now.Unix(),
		Installed:   res.Installed,
		NoOpenssl:   res.NoOpenssl,
		ParseFailed: res.UnparsedCerts > 0,
		Certs:       certs,
	}
	if err := c.store(snap); err != nil {
		return err
	}
	return nil
}

func (c *CertChecker) store(snap CertCheckSnapshot) error {
	if snap.Certs == nil {
		snap.Certs = []CertBrief{}
	}
	b, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(c.path, b, 0o600); err != nil {
		return err
	}
	c.mu.Lock()
	c.snap = snap
	c.mu.Unlock()
	return nil
}

func (c *CertChecker) load() {
	b, err := os.ReadFile(c.path)
	if err != nil {
		return
	}
	var snap CertCheckSnapshot
	if json.Unmarshal(b, &snap) != nil || !snap.Scanned || snap.LocalDate == "" {
		return
	}
	if snap.Certs == nil {
		snap.Certs = []CertBrief{}
	}
	c.snap = snap
}

func cloneSnapshot(in CertCheckSnapshot) CertCheckSnapshot {
	out := in
	out.Certs = append([]CertBrief{}, in.Certs...)
	for i := range out.Certs {
		out.Certs[i].Domains = append([]string{}, in.Certs[i].Domains...)
	}
	return out
}

// certCheckDecision 决定现在要不要扫，以及不扫的话还要等多久。
// lastLocalDate 是上次成功扫描的主机本地日期（YYYY-MM-DD），空表示从未扫过。
func certCheckDecision(now time.Time, lastLocalDate string) (scanNow bool, wait time.Duration) {
	loc := now.Location()
	today := now.Format("2006-01-02")
	six := time.Date(now.Year(), now.Month(), now.Day(), 6, 0, 0, 0, loc)
	next := six
	if !now.Before(six) {
		next = six.Add(24 * time.Hour)
	}
	if lastLocalDate == today {
		return false, next.Sub(now)
	}
	if now.Before(six) {
		return false, six.Sub(now)
	}
	return true, 0
}
