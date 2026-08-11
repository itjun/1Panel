package nethist

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Sample 一次网卡累计字节快照（对应 /proc/net/dev 合计，不含 lo）
type Sample struct {
	Ts  int64  `json:"ts"`  // unix 秒
	Rx  uint64 `json:"rx"`
	Tx  uint64 `json:"tx"`
}

// Window 某时间窗口内的流量差分
type Window struct {
	RxBytes   uint64  `json:"rxBytes"`
	TxBytes   uint64  `json:"txBytes"`
	SpanHours float64 `json:"spanHours"` // 实际有样本覆盖的时长（小时）
	Complete  bool    `json:"complete"`  // 是否覆盖满目标窗口（有 ≥ 窗口起点的样本）
}

// Store 本机持久化各 host 的网卡采样，用于 1 天 / 7 天差分
type Store struct {
	path string
	mu   sync.Mutex
	// host -> 按时间升序的采样
	data map[string][]Sample
}

const (
	// 两次落盘采样最小间隔，避免 3s 轮询撑爆文件
	minSampleInterval = 60 * time.Second
	// 保留略长于 7 天，便于窗口对齐
	retainDuration = 8 * 24 * time.Hour
)

// NewStore 数据目录与分组一致：~/Library/Application Support/<app>/net_history.json
func NewStore(appName string) (*Store, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(base, appName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("创建应用数据目录失败: %w", err)
	}
	s := &Store{
		path: filepath.Join(dir, "net_history.json"),
		data: map[string][]Sample{},
	}
	_ = s.load() // 文件不存在时忽略
	return s, nil
}

// RecordAndWindows 写入当前累计值（节流），并返回近 1 天 / 7 天流量
func (s *Store) RecordAndWindows(host string, rx, tx uint64) (d1, d7 Window) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	s.recordLocked(host, now, rx, tx)
	s.pruneLocked(host, now)
	// 异步落盘失败不影响返回值
	_ = s.saveLocked()

	samples := s.data[host]
	d1 = windowFrom(samples, now, 24*time.Hour, rx, tx)
	d7 = windowFrom(samples, now, 7*24*time.Hour, rx, tx)
	return d1, d7
}

func (s *Store) recordLocked(host string, now time.Time, rx, tx uint64) {
	list := s.data[host]
	if n := len(list); n > 0 {
		last := list[n-1]
		if now.Unix()-last.Ts < int64(minSampleInterval.Seconds()) {
			// 节流：只刷新末尾点的计数（同分钟内用最新值算差分）
			list[n-1] = Sample{Ts: now.Unix(), Rx: rx, Tx: tx}
			s.data[host] = list
			return
		}
	}
	s.data[host] = append(list, Sample{Ts: now.Unix(), Rx: rx, Tx: tx})
}

func (s *Store) pruneLocked(host string, now time.Time) {
	cut := now.Add(-retainDuration).Unix()
	list := s.data[host]
	i := 0
	for i < len(list) && list[i].Ts < cut {
		i++
	}
	if i > 0 {
		// 保留 cut 前最后一个点，方便窗口起点插值
		if i > 1 {
			list = list[i-1:]
		} else {
			list = list[i:]
		}
		s.data[host] = list
	}
}

// windowFrom 用「窗口起点附近样本」与「当前累计」做差分
// 若中途重启导致计数回绕，则从重启后第一个样本算起（Complete=false）
func windowFrom(samples []Sample, now time.Time, win time.Duration, curRx, curTx uint64) Window {
	if len(samples) == 0 {
		return Window{}
	}
	target := now.Add(-win).Unix()
	// 找最后一个 ts <= target 的样本作为基线；若无则用最早样本
	baseIdx := -1
	for i := len(samples) - 1; i >= 0; i-- {
		if samples[i].Ts <= target {
			baseIdx = i
			break
		}
	}
	complete := baseIdx >= 0
	if baseIdx < 0 {
		baseIdx = 0
	}
	base := samples[baseIdx]

	// 从 base 到当前之间若发生重启（计数变小），改用重启后的最低点
	start := base
	for i := baseIdx; i < len(samples); i++ {
		s := samples[i]
		if s.Rx < start.Rx || s.Tx < start.Tx {
			start = s
			complete = false
		}
	}
	// 当前值也可能相对 start 回绕
	if curRx < start.Rx || curTx < start.Tx {
		return Window{
			RxBytes:   curRx,
			TxBytes:   curTx,
			SpanHours: hoursBetween(start.Ts, now.Unix()),
			Complete:  false,
		}
	}

	span := hoursBetween(start.Ts, now.Unix())
	// 目标窗口完整且基线够老
	if complete && now.Unix()-base.Ts >= int64(win.Seconds())-60 {
		// 用 base（窗口起点）差分
		if curRx >= base.Rx && curTx >= base.Tx && base.Ts == start.Ts {
			return Window{
				RxBytes:   curRx - base.Rx,
				TxBytes:   curTx - base.Tx,
				SpanHours: hoursBetween(base.Ts, now.Unix()),
				Complete:  true,
			}
		}
	}

	return Window{
		RxBytes:   curRx - start.Rx,
		TxBytes:   curTx - start.Tx,
		SpanHours: span,
		Complete:  complete && span+0.1 >= win.Hours(),
	}
}

func hoursBetween(a, b int64) float64 {
	if b <= a {
		return 0
	}
	return float64(b-a) / 3600
}

func (s *Store) load() error {
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var data map[string][]Sample
	if err := json.Unmarshal(b, &data); err != nil {
		return err
	}
	if data == nil {
		data = map[string][]Sample{}
	}
	s.data = data
	return nil
}

func (s *Store) saveLocked() error {
	b, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
