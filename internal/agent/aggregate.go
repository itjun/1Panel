package agent

import (
	"context"
	"database/sql"
	"log"
	"time"
)

// aggInterval 聚合桶宽度：5 分钟
const aggInterval = int64(300)

// Aggregator 把已关闭的 raw_metrics 桶聚合成 agg_metrics 一行。
// 与采集/查询互不干扰：直接经 writer 连接（与 RunLoop 共用单连接，天然串行）。
type Aggregator struct {
	store *Store
	// 上次已聚合完成的桶起点；0 表示待初始化
	lastBucket int64
}

func NewAggregator(store *Store) *Aggregator {
	return &Aggregator{store: store}
}

// Run 每 5 分钟把「上一个已关闭的桶」聚合落库；启动时补齐缺失的历史桶
// （agent 停机期间 raw 可能一直有洞，聚合只在有数据的桶上产出）。
func (a *Aggregator) Run(ctx context.Context) {
	a.backfill()
	// 对齐到下一个桶边界 + 10s 缓冲（确保桶内最后一条样本已写入）
	for {
		now := time.Now().Unix()
		next := (now/aggInterval + 1) * aggInterval
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(next+10-now) * time.Second):
			a.aggregateClosedBuckets(time.Now().Unix())
		}
	}
}

// backfill 初始化 lastBucket：从已有的最后一个聚合桶继续；冷启动无聚合时从 raw 最早数据开始
func (a *Aggregator) backfill() {
	var lastAgg sql.NullInt64
	_ = a.store.reader.QueryRow(`SELECT MAX(bucket) FROM agg_metrics`).Scan(&lastAgg)
	if lastAgg.Valid && lastAgg.Int64 > 0 {
		a.lastBucket = lastAgg.Int64
		return
	}
	// 无聚合记录：从 raw 最早一条所在桶的前一个桶起（循环内 +300 推进）
	var minTS sql.NullInt64
	_ = a.store.reader.QueryRow(`SELECT MIN(ts) FROM raw_metrics`).Scan(&minTS)
	if minTS.Valid && minTS.Int64 > 0 {
		a.lastBucket = (minTS.Int64/aggInterval - 1) * aggInterval
	}
}

// aggregateClosedBuckets 把 (lastBucket, closedEdge] 内所有已关闭桶聚合
func (a *Aggregator) aggregateClosedBuckets(now int64) {
	closedEdge := now/aggInterval*aggInterval - aggInterval // 最近一个确定已关闭的桶起点
	for b := a.lastBucket + aggInterval; b <= closedEdge; b += aggInterval {
		if err := a.aggregateBucket(b); err != nil {
			log.Printf("[aggregate] 桶 %d 聚合失败: %v", b, err)
			return // 失败停住，下轮从同一桶重试
		}
		a.lastBucket = b
	}
}

// aggregateBucket 聚合单个桶 [b, b+300)；无样本时写零值行占位（时间轴连续）
func (a *Aggregator) aggregateBucket(b int64) error {
	_, err := a.store.writer.Exec(`INSERT OR REPLACE INTO agg_metrics
		(bucket, cpu_avg, cpu_max, load1_avg, load1_max,
		 mem_used_avg, mem_used_max, net_rx_sum_mb, net_tx_sum_mb,
		 disk_read_sum_mb, disk_write_sum_mb)
		SELECT ?, IFNULL(AVG(cpu_pct),0), IFNULL(MAX(cpu_pct),0),
		 IFNULL(AVG(load1),0), IFNULL(MAX(load1),0),
		 IFNULL(AVG(mem_used),0), IFNULL(MAX(mem_used),0),
		 IFNULL(SUM(net_rx_kbps),0)*5/1024.0,
		 IFNULL(SUM(net_tx_kbps),0)*5/1024.0,
		 IFNULL(SUM(disk_read_kbps),0)*5/1024.0,
		 IFNULL(SUM(disk_write_kbps),0)*5/1024.0
		FROM raw_metrics WHERE ts >= ? AND ts < ?`, b, b, b+aggInterval)
	return err
}
