package agent

import (
	"context"
	"fmt"
	"log"
	"time"
)

// Retention 各表保留时长（可由 main 的 flag 覆盖）
type Retention struct {
	Raw    time.Duration // 默认 7 天
	Agg    time.Duration // 默认 90 天
	Events time.Duration // 默认 30 天
}

func DefaultRetention() Retention {
	return Retention{
		Raw:    7 * 24 * time.Hour,
		Agg:    90 * 24 * time.Hour,
		Events: 30 * 24 * time.Hour,
	}
}

// 清理限速参数：每批删 2000 行、批间睡 200ms，写锁短促出现，不与采集抢 IO
const (
	cleanupBatchRows  = 2000
	cleanupBatchPause = 200 * time.Millisecond
)

// Cleanup 周期清理任务：每天 00:00 触发，分批删除过期数据后收缩文件
type Cleanup struct {
	store     *Store
	retention Retention
	// 上次清理结果（/admin/stats 展示）
	LastRunAt   time.Time `json:"lastRunAt"`
	LastDeleted int64     `json:"lastDeleted"`
	LastError   string    `json:"lastError"`
	lastLogWarn bool      // 上次清理是否因失败告警过（避免日志刷屏）
}

func NewCleanup(store *Store, retention Retention) *Cleanup {
	return &Cleanup{store: store, retention: retention}
}

// Run 睡到下一个本地 00:00 执行清理；此外每小时做一次 WAL checkpoint
// （长事务以外 auto-checkpoint 已足够，这里兜底防 -wal 无限增长）
func (c *Cleanup) Run(ctx context.Context) {
	for {
		now := time.Now()
		next := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location())
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Until(next)):
			c.RunOnce(ctx)
		case <-time.After(time.Hour):
			// 整点兜底 checkpoint（若恰好跨 00:00，00:00 分支优先退出 select）
			c.store.checkpoint()
		}
	}
}

// RunOnce 执行一轮完整清理。ctx 取消时尽快退出（当前批删完后停止）。
func (c *Cleanup) RunOnce(ctx context.Context) {
	start := time.Now()
	var total int64
	err := c.cleanup(ctx, &total)

	c.LastRunAt = start
	c.LastDeleted = total
	if err != nil {
		c.LastError = err.Error()
		if !c.lastLogWarn {
			log.Printf("[cleanup] 清理失败: %v", err)
			c.lastLogWarn = true
		}
		c.store.WriteEvent("error", fmt.Sprintf("清理失败（已删 %d 行）: %v", total, err))
		return
	}
	c.LastError = ""
	if c.lastLogWarn {
		c.lastLogWarn = false
	}
	log.Printf("[cleanup] 完成：删除 %d 行，耗时 %s", total, time.Since(start).Round(time.Millisecond))
}

// cleanup 按表分批删除 → checkpoint(TRUNCATE) → incremental_vacuum 收缩文件
func (c *Cleanup) cleanup(ctx context.Context, total *int64) error {
	now := time.Now()
	// keyCol 定位行；timeCol 做时间比较（agg 的主键兼时间列是 bucket）
	tables := []struct {
		name    string
		keyCol  string
		timeCol string
		cut     int64
	}{
		{"raw_metrics", "id", "ts", now.Add(-c.retention.Raw).Unix()},
		{"events", "id", "ts", now.Add(-c.retention.Events).Unix()},
		{"agg_metrics", "bucket", "bucket", now.Add(-c.retention.Agg).Unix()},
	}
	for _, t := range tables {
		n, err := c.deleteBatched(ctx, t.name, t.keyCol, t.timeCol, t.cut)
		*total += n
		if err != nil {
			return fmt.Errorf("表 %s: %w", t.name, err)
		}
	}
	// 截断 WAL + 回收空闲页，真正归还磁盘空间（失败不视为清理失败）
	if _, err := c.store.writer.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		log.Printf("[cleanup] wal_checkpoint: %v", err)
	}
	if _, err := c.store.writer.Exec(`PRAGMA incremental_vacuum`); err != nil {
		log.Printf("[cleanup] incremental_vacuum: %v", err)
	}
	return nil
}

// deleteBatched 每批独立短事务删除；ctx 取消时返回当前进度
func (c *Cleanup) deleteBatched(ctx context.Context, table, keyCol, timeCol string, cut int64) (int64, error) {
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, nil // 优雅退出：已删的生效，下轮 00:00 继续
		}
		res, err := c.store.writer.Exec(
			fmt.Sprintf(`DELETE FROM %s WHERE %s IN (SELECT %s FROM %s WHERE %s < ? LIMIT ?)`,
				table, keyCol, keyCol, table, timeCol),
			cut, cleanupBatchRows)
		if err != nil {
			return total, err
		}
		n, _ := res.RowsAffected()
		total += n
		if n < cleanupBatchRows {
			return total, nil
		}
		select {
		case <-ctx.Done():
			return total, nil
		case <-time.After(cleanupBatchPause):
		}
	}
}
