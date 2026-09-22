// spanel-agent：目标主机常驻采集代理。
//
// 数据面三条路径：
//  1. 持续采集：每 interval 秒直读 /proc → 差分速率 → SQLite（WAL）
//  2. 本地 HTTP API：127.0.0.1 只读查询 + 按需采集（复用面板 monitor 解析器）
//  3. Uploader：预留（见 internal/agent/uploader.go）
//
// 资源纪律：采集零 fork；HTTP 查询零命令；清理分批限速；systemd 侧有 cgroup 硬限制。
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"diteng-pannel/internal/agent"
)

// version 由构建注入：-ldflags "-X main.version=x.y.z"
var version = "dev"

func main() {
	var (
		listen          = flag.String("listen", "127.0.0.1:39190", "HTTP 监听地址（只应绑定回环）")
		dataDir         = flag.String("data", "/var/lib/spanel-agent", "数据目录（agent.db 与 token）")
		interval        = flag.Duration("interval", 5*time.Second, "持续采集间隔")
		retentionRaw    = flag.Duration("retention-raw", 7*24*time.Hour, "raw_metrics 保留时长")
		retentionAgg    = flag.Duration("retention-agg", 90*24*time.Hour, "agg_metrics 保留时长")
		retentionEvents = flag.Duration("retention-events", 30*24*time.Hour, "events 保留时长")
		tokenEnabled    = flag.Bool("token", true, "启用 Bearer token 鉴权（token 文件在数据目录）")
		watermarkPct    = flag.Float64("watermark-pct", 5.0, "数据分区剩余空间低于该百分比时停写（保业务）")
		showVersion     = flag.Bool("version", false, "打印版本后退出")
	)
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}

	// 数据目录（0700：库里有 token，不给其他用户读的机会）
	if err := os.MkdirAll(*dataDir, 0o700); err != nil {
		log.Fatalf("创建数据目录失败: %v", err)
	}

	store, err := agent.OpenStore(*dataDir)
	if err != nil {
		log.Fatalf("初始化数据库失败: %v", err)
	}
	store.SetWatermarkPct(*watermarkPct)

	token := ""
	if *tokenEnabled {
		token, err = loadOrCreateToken(*dataDir)
		if err != nil {
			log.Fatalf("初始化 token 失败: %v", err)
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	mc := agent.NewMetricCollector("")
	retention := agent.Retention{
		Raw:    *retentionRaw,
		Agg:    *retentionAgg,
		Events: *retentionEvents,
	}
	srv := agent.NewServer(store, mc, retention, version, token)
	watcher := agent.NewWatcher(store, *dataDir)
	srv.SetWatcher(watcher)
	certs := agent.NewCertChecker(*dataDir)
	srv.SetCertChecker(certs)

	// 采集循环：tick → 采样 → 非阻塞投递，永不等待网络/磁盘
	go func() {
		store.WriteEvent("info", "agent 启动 version="+version)
		ticker := time.NewTicker(*interval)
		defer ticker.Stop()
		collect := func() {
			s, err := mc.Collect()
			if err != nil {
				log.Printf("[collect] %v", err)
				return
			}
			store.EnqueueWrite(&s)
		}
		collect() // 启动立即采一次（首轮建立差分基线）
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				collect()
			}
		}
	}()

	// 写协程 / 聚合 / 清理
	go store.RunLoop(ctx)
	go agent.NewAggregator(store).Run(ctx)
	go agent.NewCleanup(store, retention).Run(ctx)
	go watcher.Run(ctx)
	go certs.Run(ctx)

	// HTTP 服务
	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Fatalf("监听 %s 失败: %v", *listen, err)
	}
	log.Printf("spanel-agent %s 监听 %s（数据目录 %s，采样间隔 %s）", version, *listen, *dataDir, *interval)

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()
	if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatalf("HTTP 服务异常: %v", err)
	}

	// 等 store.RunLoop 完成收尾 checkpoint 再退出
	<-time.After(300 * time.Millisecond)
	log.Printf("spanel-agent 已退出")
}

// loadOrCreateToken 读取数据目录下的 token 文件；不存在则生成 32 字节随机 hex（0600）
func loadOrCreateToken(dir string) (string, error) {
	p := filepath.Join(dir, "token")
	if b, err := os.ReadFile(p); err == nil {
		if t := trimToken(string(b)); t != "" {
			return t, nil
		}
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	t := hex.EncodeToString(raw)
	if err := os.WriteFile(p, []byte(t+"\n"), 0o600); err != nil {
		return "", err
	}
	return t, nil
}

func trimToken(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == ' ') {
		s = s[:len(s)-1]
	}
	return s
}
