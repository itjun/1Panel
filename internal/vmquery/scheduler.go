package vmquery

import (
	"context"
	"fmt"
	"sync"
	"time"

	"diteng-pannel/internal/sshd"
)

// QueryScheduler 控制跨机并发、超时、缓存。
//
// 设计：
//   - 跨机并发上限 5（Mac 客户端不会同时查 100 台，面板一次只看几台）
//   - 单机串行（同一台机的多个查询合并到一个 SSH 隧道更高效，且避免压垮 VM）
//   - 缓存 TTL 15s，与 scrape_interval 对齐
//   - 超时 10s
type QueryScheduler struct {
	client *Client

	// 并发闸
	sem chan struct{}

	// 缓存：key = host|query|start|end|step
	mu    sync.Mutex
	cache map[string]cacheEntry
}

type cacheEntry struct {
	body      []byte
	err       error
	expiresAt time.Time
}

const (
	maxConcurrency = 5
	cacheTTL       = 15 * time.Second
	queryTimeout   = 10 * time.Second
)

// NewScheduler 创建查询调度器
func NewScheduler(client *Client) *QueryScheduler {
	return &QueryScheduler{
		client: client,
		sem:    make(chan struct{}, maxConcurrency),
		cache:  map[string]cacheEntry{},
	}
}

// QueryRange 带缓存与并发的 range 查询
func (s *QueryScheduler) QueryRange(host string, opt sshd.ConnectOption, query string, start, end int64, step int) ([]byte, error) {
	key := fmt.Sprintf("%s|%s|%d|%d|%d", host, query, start, end, step)

	// 命中缓存直接返回
	s.mu.Lock()
	if e, ok := s.cache[key]; ok && time.Now().Before(e.expiresAt) {
		s.mu.Unlock()
		return e.body, e.err
	}
	s.mu.Unlock()

	// 并发闸
	s.sem <- struct{}{}
	defer func() { <-s.sem }()

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	body, err := s.client.QueryRange(ctx, host, opt, query, start, end, step)

	// 写回缓存（即使出错也缓存，避免短时间疯狂重试）
	s.mu.Lock()
	s.cache[key] = cacheEntry{body: body, err: err, expiresAt: time.Now().Add(cacheTTL)}
	s.mu.Unlock()

	return body, err
}

// Query 带缓存的 instant 查询
func (s *QueryScheduler) Query(host string, opt sshd.ConnectOption, query string) ([]byte, error) {
	key := fmt.Sprintf("%s|%s|instant", host, query)

	s.mu.Lock()
	if e, ok := s.cache[key]; ok && time.Now().Before(e.expiresAt) {
		s.mu.Unlock()
		return e.body, e.err
	}
	s.mu.Unlock()

	s.sem <- struct{}{}
	defer func() { <-s.sem }()

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	body, err := s.client.Query(ctx, host, opt, query)

	s.mu.Lock()
	s.cache[key] = cacheEntry{body: body, err: err, expiresAt: time.Now().Add(cacheTTL)}
	s.mu.Unlock()

	return body, err
}

// Invalidate 清掉指定 host 的所有缓存（VM 重启后调用）
func (s *QueryScheduler) Invalidate(host string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k := range s.cache {
		if len(k) > len(host) && k[:len(host)] == host {
			delete(s.cache, k)
		}
	}
}
