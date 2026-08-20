package agent

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"

	"golang.org/x/sys/unix"

	_ "modernc.org/sqlite"
)

// Schema 版本号：只增不改，升级时按 user_version 逐级迁移
const schemaVersion = 1

// 磁盘水位保护默认阈值：数据目录所在分区剩余比例低于该值时停写（保业务），恢复后续写
const diskWatermarkPct = 5.0

// Store SQLite 存储：writer 独占写连接 + reader 只读连接，WAL 下读写互不阻塞。
type Store struct {
	writer *sql.DB
	reader *sql.DB
	dbPath string
	dir    string
	ch     chan writeOp // 采集 → 写协程的唯一通道，容量小（够用即可，满了丢样本）
	// 水位阈值（剩余空间百分比，低于则停写）；默认 diskWatermarkPct，可由 flag 覆盖用于测试
	watermarkPct float64

	// 水位停写状态（0 正常 / 1 停写），跨越时记一次事件
	stoppedLowDisk atomic.Bool

	// 运行统计（/health、/admin/stats 暴露）
	DroppedSamples atomic.Uint64 // 因通道满或停写丢弃的样本数
	WrittenSamples atomic.Uint64
	LastWriteErr   atomic.Value // string，最近一次写错误（空 = 无）
}

// writeOp 写通道统一载荷：采样或事件（事件量极少，与样本共用单写协程）
type writeOp struct {
	sample *Sample
	event  *Event
}

// Event agent 生命周期事件（events 表）
type Event struct {
	TS    int64  `json:"ts"`
	Level string `json:"level"` // info / warn / error
	Msg   string `json:"msg"`
}

// OpenStore 打开（必要时创建）数据库。dir 需已存在。
func OpenStore(dir string) (*Store, error) {
	dbPath := filepath.Join(dir, "agent.db")
	st := &Store{
		dbPath:       dbPath,
		dir:          dir,
		ch:           make(chan writeOp, 64),
		watermarkPct: diskWatermarkPct,
	}

	dsn := func() string {
		u := url.URL{
			Path: dbPath,
			RawQuery: "_pragma=busy_timeout(5000)" +
				"&_pragma=journal_mode(WAL)" +
				"&_pragma=synchronous(NORMAL)" +
				"&_pragma=auto_vacuum(INCREMENTAL)" +
				"&_pragma=foreign_keys(1)",
		}
		return "file:" + u.Path + "?" + u.RawQuery
	}()

	var err error
	// writer：独占单连接，全部写操作串行经它（SQLite 单写者模型）
	if st.writer, err = sql.Open("sqlite", dsn); err != nil {
		return nil, fmt.Errorf("打开写连接: %w", err)
	}
	st.writer.SetMaxOpenConns(1)
	st.writer.SetMaxIdleConns(1)
	// reader：HTTP 查询用；限制 2 个连接并定期回收，避免长连接阻碍 checkpoint
	if st.reader, err = sql.Open("sqlite", dsn); err != nil {
		return nil, fmt.Errorf("打开读连接: %w", err)
	}
	st.reader.SetMaxOpenConns(2)
	st.reader.SetMaxIdleConns(2)
	st.reader.SetConnMaxLifetime(5 * time.Minute)

	if err := st.initSchema(); err != nil {
		return nil, err
	}
	return st, nil
}

// initSchema 建表 + user_version 记录。auto_vacuum=INCREMENTAL 已在 DSN 设置（建表前生效）
func (st *Store) initSchema() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS raw_metrics (
			id              INTEGER PRIMARY KEY,
			ts              INTEGER NOT NULL,
			cpu_pct         REAL NOT NULL,
			load1           REAL NOT NULL,
			load5           REAL NOT NULL,
			load15          REAL NOT NULL,
			mem_used        INTEGER NOT NULL,
			mem_total       INTEGER NOT NULL,
			swap_used       INTEGER NOT NULL,
			swap_total      INTEGER NOT NULL,
			net_rx_bytes    INTEGER NOT NULL,
			net_tx_bytes    INTEGER NOT NULL,
			net_rx_kbps     REAL NOT NULL,
			net_tx_kbps     REAL NOT NULL,
			disk_read_bytes  INTEGER NOT NULL,
			disk_write_bytes INTEGER NOT NULL,
			disk_read_kbps  REAL NOT NULL,
			disk_write_kbps REAL NOT NULL,
			disk_io_count   INTEGER NOT NULL,
			disk_used       INTEGER NOT NULL,
			disk_total      INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_raw_ts ON raw_metrics(ts)`,
		`CREATE TABLE IF NOT EXISTS agg_metrics (
			bucket          INTEGER PRIMARY KEY,
			cpu_avg         REAL NOT NULL,
			cpu_max         REAL NOT NULL,
			load1_avg       REAL NOT NULL,
			load1_max       REAL NOT NULL,
			mem_used_avg    INTEGER NOT NULL,
			mem_used_max    INTEGER NOT NULL,
			net_rx_sum_mb   REAL NOT NULL,
			net_tx_sum_mb   REAL NOT NULL,
			disk_read_sum_mb  REAL NOT NULL,
			disk_write_sum_mb REAL NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS events (
			id    INTEGER PRIMARY KEY,
			ts    INTEGER NOT NULL,
			level TEXT NOT NULL,
			msg   TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)`,
		// Uploader 预留：ACK 游标（本期只建表，不实现上传）
		`CREATE TABLE IF NOT EXISTS upload_state (
			id        INTEGER PRIMARY KEY CHECK (id = 1),
			acked_seq INTEGER NOT NULL DEFAULT 0
		)`,
		`INSERT OR IGNORE INTO upload_state (id, acked_seq) VALUES (1, 0)`,
	}
	tx, err := st.writer.Begin()
	if err != nil {
		return fmt.Errorf("初始化建库: %w", err)
	}
	for _, s := range stmts {
		if _, err := tx.Exec(s); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("初始化建库: %w", err)
		}
	}
	if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", schemaVersion)); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("写 user_version: %w", err)
	}
	return tx.Commit()
}

// EnqueueWrite 非阻塞投递一条采样：通道满时直接丢弃并计数，采集路径绝不等待
func (st *Store) EnqueueWrite(s *Sample) bool {
	select {
	case st.ch <- writeOp{sample: s}:
		return true
	default:
		st.DroppedSamples.Add(1)
		return false
	}
}

// enqueue 非阻塞投递内部写操作（事件等）
func (st *Store) enqueue(op writeOp) bool {
	select {
	case st.ch <- op:
		return true
	default:
		return false
	}
}

// RunLoop 消费写通道。5 秒一条的量级下逐条自动事务即可（单行 WAL commit 为微秒级），
// 无需攒批；所有写（样本+事件+聚合+清理）都经 writer 单连接，天然串行。
func (st *Store) RunLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			st.checkpoint()
			_ = st.writer.Close()
			_ = st.reader.Close()
			return
		case op := <-st.ch:
			st.apply(op)
		}
	}
}

// apply 执行一次写；磁盘水位不足时丢弃样本并记录状态切换
func (st *Store) apply(op writeOp) {
	low := st.diskLow()
	if low && !st.stoppedLowDisk.Swap(true) {
		st.LastWriteErr.Store("disk watermark: 写入暂停")
		// 水位事件本身也写不进去的概率高，尽力写一条
		st.insertEvent(writeOp{event: &Event{TS: time.Now().Unix(), Level: "warn",
			Msg: fmt.Sprintf("数据分区剩余空间不足 %.0f%%，暂停写入保护业务", st.watermarkPct)}})
	}
	if !low && st.stoppedLowDisk.Swap(false) {
		st.insertEvent(writeOp{event: &Event{TS: time.Now().Unix(), Level: "info",
			Msg: "磁盘水位恢复，继续写入"}})
	}
	if low {
		if op.sample != nil {
			st.DroppedSamples.Add(1)
		}
		return
	}
	if op.sample != nil {
		if err := st.insertSample(op.sample); err != nil {
			st.LastWriteErr.Store(err.Error())
			return
		}
		st.WrittenSamples.Add(1)
		st.LastWriteErr.Store("")
	} else if op.event != nil {
		st.insertEvent(op)
	}
}

func (st *Store) insertSample(s *Sample) error {
	_, err := st.writer.Exec(`INSERT INTO raw_metrics
		(ts, cpu_pct, load1, load5, load15,
		 mem_used, mem_total, swap_used, swap_total,
		 net_rx_bytes, net_tx_bytes, net_rx_kbps, net_tx_kbps,
		 disk_read_bytes, disk_write_bytes, disk_read_kbps, disk_write_kbps,
		 disk_io_count, disk_used, disk_total)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		s.TS, s.CPUPercent, s.Load1, s.Load5, s.Load15,
		s.MemUsed, s.MemTotal, s.SwapUsed, s.SwapTotal,
		s.NetRxBytes, s.NetTxBytes, s.NetRxKBps, s.NetTxKBps,
		s.DiskReadBytes, s.DiskWriteBytes, s.DiskReadKBps, s.DiskWriteKBps,
		s.DiskIOCount, s.DiskUsed, s.DiskTotal)
	return err
}

func (st *Store) insertEvent(op writeOp) {
	_, _ = st.writer.Exec(`INSERT INTO events (ts, level, msg) VALUES (?,?,?)`,
		op.event.TS, op.event.Level, op.event.Msg)
}

// WriteEvent 供各组件记事件（经通道串行写入）
func (st *Store) WriteEvent(level, msg string) {
	st.enqueue(writeOp{event: &Event{TS: time.Now().Unix(), Level: level, Msg: msg}})
}

// SetWatermarkPct 覆盖磁盘水位阈值（0 < p ≤ 100）；测试停写保护时用高阈值触发
func (st *Store) SetWatermarkPct(p float64) {
	if p > 0 && p <= 100 {
		st.watermarkPct = p
	}
}

// diskLow 检查数据目录所在分区剩余空间比例
func (st *Store) diskLow() bool {
	var stt unix.Statfs_t
	if err := unix.Statfs(st.dir, &stt); err != nil {
		return false // 探测失败不阻断写入
	}
	total := uint64(stt.Blocks)
	if total == 0 {
		return false
	}
	avail := uint64(stt.Bavail)
	return float64(avail)/float64(total)*100 < st.watermarkPct
}

// checkpoint 收尾时截断 WAL 文件（失败不影响退出）
func (st *Store) checkpoint() {
	_, _ = st.writer.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
}

// Close 供测试使用；正常运行走 RunLoop 的 ctx 退出路径
func (st *Store) Close() {
	st.checkpoint()
	_ = st.writer.Close()
	_ = st.reader.Close()
}

// DBPath 数据库文件路径（/health 展示大小用）
func (st *Store) DBPath() string { return st.dbPath }

// FileSizes 返回 db 与 wal 文件字节数
func (st *Store) FileSizes() (dbSize, walSize int64) {
	if fi, err := os.Stat(st.dbPath); err == nil {
		dbSize = fi.Size()
	}
	if fi, err := os.Stat(st.dbPath + "-wal"); err == nil {
		walSize = fi.Size()
	}
	return
}
