package agent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// CurrentPoint 最新一条采样（/metrics/current 的动态部分）
type CurrentPoint struct {
	TS             int64   `json:"ts"`
	CPUPercent     float64 `json:"cpuPercent"`
	Load1          float64 `json:"load1"`
	Load5          float64 `json:"load5"`
	Load15         float64 `json:"load15"`
	MemUsed        uint64  `json:"memUsed"`
	MemTotal       uint64  `json:"memTotal"`
	SwapUsed       uint64  `json:"swapUsed"`
	SwapTotal      uint64  `json:"swapTotal"`
	NetRxBytes     uint64  `json:"netRxBytes"`
	NetTxBytes     uint64  `json:"netTxBytes"`
	NetRxKBps      float64 `json:"netRxKBps"`
	NetTxKBps      float64 `json:"netTxKBps"`
	DiskReadBytes  uint64  `json:"diskReadBytes"`
	DiskWriteBytes uint64  `json:"diskWriteBytes"`
	DiskReadKBps   float64 `json:"diskReadKBps"`
	DiskWriteKBps  float64 `json:"diskWriteKBps"`
	DiskIOCount    uint64  `json:"diskIOCount"`
	DiskUsed       uint64  `json:"diskUsed"`
	DiskTotal      uint64  `json:"diskTotal"`
}

// RangePoint 历史序列统一数据点（raw 与 agg 两种来源都折算成它）
type RangePoint struct {
	TS            int64   `json:"ts"`
	CPUPercent    float64 `json:"cpuPercent"`
	Load1         float64 `json:"load1"`
	MemUsed       uint64  `json:"memUsed"`
	NetRxKBps     float64 `json:"netRxKBps"`
	NetTxKBps     float64 `json:"netTxKBps"`
	DiskReadKBps  float64 `json:"diskReadKBps"`
	DiskWriteKBps float64 `json:"diskWriteKBps"`
}

// SummaryRange 一个时间窗的摘要
type SummaryRange struct {
	Name       string  `json:"name"` // 1h / 6h / 24h / 7d
	CPUAvg     float64 `json:"cpuAvg"`
	CPUMax     float64 `json:"cpuMax"`
	Load1Max   float64 `json:"load1Max"`
	MemUsedMax uint64  `json:"memUsedMax"`
}

// ErrNoData 尚无任何采样（刚安装）
var ErrNoData = errors.New("尚无采样数据")

// Current 取最新一条 raw 采样
func (st *Store) Current() (*CurrentPoint, error) {
	row := st.reader.QueryRow(`SELECT ts, cpu_pct, load1, load5, load15,
		mem_used, mem_total, swap_used, swap_total,
		net_rx_bytes, net_tx_bytes, net_rx_kbps, net_tx_kbps,
		disk_read_bytes, disk_write_bytes, disk_read_kbps, disk_write_kbps,
		disk_io_count, disk_used, disk_total
		FROM raw_metrics ORDER BY id DESC LIMIT 1`)
	return scanCurrent(row)
}

func scanCurrent(row *sql.Row) (*CurrentPoint, error) {
	p := &CurrentPoint{}
	err := row.Scan(&p.TS, &p.CPUPercent, &p.Load1, &p.Load5, &p.Load15,
		&p.MemUsed, &p.MemTotal, &p.SwapUsed, &p.SwapTotal,
		&p.NetRxBytes, &p.NetTxBytes, &p.NetRxKBps, &p.NetTxKBps,
		&p.DiskReadBytes, &p.DiskWriteBytes, &p.DiskReadKBps, &p.DiskWriteKBps,
		&p.DiskIOCount, &p.DiskUsed, &p.DiskTotal)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoData
	}
	if err != nil {
		return nil, fmt.Errorf("查询最新采样: %w", err)
	}
	return p, nil
}

// RangeRange 查询历史序列。src: "raw" / "agg" / "auto"（跨度 ≤ rawMaxSpan 用 raw，否则 agg）。
// 返回点数封顶 maxPoints，agg 来源超限时按 bucket 取模均匀抽样。
func (st *Store) Range(ctx context.Context, from, to int64, src string) ([]RangePoint, string, error) {
	if from >= to {
		return nil, "", fmt.Errorf("时间范围无效: from >= to")
	}
	if src == "" {
		src = "auto"
	}
	const rawMaxSpan = int64(3 * 3600) // raw 全量上限 3 小时（约 2160 点）
	const maxPoints = 2000
	const bucketSec = int64(300)

	if src == "auto" {
		if to-from > rawMaxSpan {
			src = "agg"
		} else {
			src = "raw"
		}
	}

	if src == "raw" {
		pts, err := st.queryRawRange(ctx, from, to)
		return pts, "raw", err
	}
	if src != "agg" {
		return nil, "", fmt.Errorf("未知数据源: %s", src)
	}

	// agg：桶数 = (to-from)/300，超限时按 step 个桶取 1 个
	buckets := (to - from) / bucketSec
	step := int64(1)
	if buckets > maxPoints {
		step = (buckets + maxPoints - 1) / maxPoints
	}
	pts, err := st.queryAggRange(ctx, from, to, step)
	return pts, "agg", err
}

func (st *Store) queryRawRange(ctx context.Context, from, to int64) ([]RangePoint, error) {
	rows, err := st.reader.QueryContext(ctx, `SELECT ts, cpu_pct, load1, mem_used,
		net_rx_kbps, net_tx_kbps, disk_read_kbps, disk_write_kbps
		FROM raw_metrics WHERE ts >= ? AND ts <= ? ORDER BY ts`, from, to)
	if err != nil {
		return nil, fmt.Errorf("查询 raw 序列: %w", err)
	}
	defer rows.Close()
	var pts []RangePoint
	for rows.Next() {
		var p RangePoint
		if err := rows.Scan(&p.TS, &p.CPUPercent, &p.Load1, &p.MemUsed,
			&p.NetRxKBps, &p.NetTxKBps, &p.DiskReadKBps, &p.DiskWriteKBps); err != nil {
			return nil, err
		}
		pts = append(pts, p)
	}
	return pts, rows.Err()
}

// queryAggRange 桶对齐到 300s；step>1 时 WHERE bucket % step = 0 均匀抽样。
// agg 的吞吐量是累计和（sum），折回平均速率 KB/s = sum_mb*1024/300
func (st *Store) queryAggRange(ctx context.Context, from, to, step int64) ([]RangePoint, error) {
	q := `SELECT bucket, cpu_avg, load1_avg, mem_used_max,
		net_rx_sum_mb, net_tx_sum_mb, disk_read_sum_mb, disk_write_sum_mb
		FROM agg_metrics WHERE bucket >= ? AND bucket <= ?`
	args := []any{alignBucket(from), alignBucket(to)}
	if step > 1 {
		q += " AND bucket % ? = 0"
		args = append(args, step)
	}
	q += " ORDER BY bucket"
	rows, err := st.reader.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("查询 agg 序列: %w", err)
	}
	defer rows.Close()
	var pts []RangePoint
	for rows.Next() {
		var p RangePoint
		var rxSum, txSum, rdSum, wrSum float64
		if err := rows.Scan(&p.TS, &p.CPUPercent, &p.Load1, &p.MemUsed,
			&rxSum, &txSum, &rdSum, &wrSum); err != nil {
			return nil, err
		}
		p.NetRxKBps = rxSum * 1024 / 300
		p.NetTxKBps = txSum * 1024 / 300
		p.DiskReadKBps = rdSum * 1024 / 300
		p.DiskWriteKBps = wrSum * 1024 / 300
		pts = append(pts, p)
	}
	return pts, rows.Err()
}

func alignBucket(ts int64) int64 {
	return ts / 300 * 300
}

// Summary 最近 1h/6h/24h/7d 摘要（全部走 agg，避免扫大表）
func (st *Store) Summary() ([]SummaryRange, error) {
	windows := []struct {
		name string
		span int64
	}{
		{"1h", 3600},
		{"6h", 6 * 3600},
		{"24h", 24 * 3600},
		{"7d", 7 * 86400},
	}
	now := time.Now().Unix()
	out := make([]SummaryRange, 0, len(windows))
	for _, w := range windows {
		var r SummaryRange
		r.Name = w.name
		err := st.reader.QueryRow(`SELECT IFNULL(AVG(cpu_avg),0), IFNULL(MAX(cpu_max),0),
			IFNULL(MAX(load1_max),0), IFNULL(MAX(mem_used_max),0)
			FROM agg_metrics WHERE bucket > ?`, alignBucket(now-w.span)).
			Scan(&r.CPUAvg, &r.CPUMax, &r.Load1Max, &r.MemUsedMax)
		if err != nil {
			return nil, fmt.Errorf("查询摘要: %w", err)
		}
		out = append(out, r)
	}
	return out, nil
}

// Events 事件列表（倒序）
func (st *Store) Events(from, to int64, limit int) ([]Event, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := st.reader.Query(`SELECT ts, level, msg FROM events
		WHERE ts >= ? AND ts <= ? ORDER BY id DESC LIMIT ?`, from, to, limit)
	if err != nil {
		return nil, fmt.Errorf("查询事件: %w", err)
	}
	defer rows.Close()
	var evs []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.TS, &e.Level, &e.Msg); err != nil {
			return nil, err
		}
		evs = append(evs, e)
	}
	return evs, rows.Err()
}

// JarRangePoint JAR 时间序列
type JarRangePoint struct {
	TS         int64   `json:"ts"`
	Service    string  `json:"service"`
	PID        int     `json:"pid"`
	Port       int     `json:"port"`
	RSS        uint64  `json:"rss"`
	CPUPercent float64 `json:"cpuPercent"`
	HeapUsed   uint64  `json:"heapUsed"`
	HeapMax    uint64  `json:"heapMax"`
	GCPauseMs  float64 `json:"gcPauseMs"`
	HealthOK   bool    `json:"healthOk"`
}

// QueryJarRange 按服务查 jar_samples
func (st *Store) QueryJarRange(from, to int64, service string) ([]JarRangePoint, error) {
	if from >= to {
		return nil, fmt.Errorf("时间范围无效")
	}
	q := `SELECT ts, service, pid, port, rss, cpu_pct, heap_used, heap_max, gc_pause_ms, health_ok
		FROM jar_samples WHERE ts >= ? AND ts <= ?`
	args := []any{from, to}
	if service != "" {
		q += ` AND service = ?`
		args = append(args, service)
	}
	q += ` ORDER BY ts`
	rows, err := st.reader.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pts []JarRangePoint
	for rows.Next() {
		var p JarRangePoint
		var ok int
		if err := rows.Scan(&p.TS, &p.Service, &p.PID, &p.Port, &p.RSS, &p.CPUPercent,
			&p.HeapUsed, &p.HeapMax, &p.GCPauseMs, &ok); err != nil {
			return nil, err
		}
		p.HealthOK = ok != 0
		pts = append(pts, p)
	}
	return pts, rows.Err()
}

// QueryWatchEvents 分层探活事件
func (st *Store) QueryWatchEvents(from, to int64, service string, limit int) ([]WatchEvent, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	q := `SELECT ts, service, layer, kind, msg FROM watch_events WHERE ts >= ? AND ts <= ?`
	args := []any{from, to}
	if service != "" {
		q += ` AND service = ?`
		args = append(args, service)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := st.reader.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var evs []WatchEvent
	for rows.Next() {
		var e WatchEvent
		if err := rows.Scan(&e.TS, &e.Service, &e.Layer, &e.Kind, &e.Msg); err != nil {
			return nil, err
		}
		evs = append(evs, e)
	}
	return evs, rows.Err()
}

// TableStats /admin/stats 的行数信息
type TableStats struct {
	RawCount   int64 `json:"rawCount"`
	AggCount   int64 `json:"aggCount"`
	EventCount int64 `json:"eventCount"`
	OldestTS   int64 `json:"oldestTs"` // raw 最早一条的 ts（0 = 空）
}

// Stats 各表行数（量级 10 万内，COUNT 毫秒级；仅 /admin/stats 与 /health 调用，非高频）
func (st *Store) Stats() (TableStats, error) {
	var t TableStats
	err := st.reader.QueryRow(`SELECT
		(SELECT COUNT(*) FROM raw_metrics),
		(SELECT COUNT(*) FROM agg_metrics),
		(SELECT COUNT(*) FROM events),
		(SELECT IFNULL(MIN(ts), 0) FROM raw_metrics)`).
		Scan(&t.RawCount, &t.AggCount, &t.EventCount, &t.OldestTS)
	return t, err
}
