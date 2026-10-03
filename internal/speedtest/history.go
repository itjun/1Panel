package speedtest

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// 记录类型
const (
	KindPair = "pair"
	KindStar = "star"
	KindMesh = "mesh"
)

const historyMax = 200

// PairResult 分组测速中的一轮
type PairResult struct {
	A       string     `json:"a"`
	B       string     `json:"b"`
	Status  string     `json:"status"` // pending / running / done / failed / nolan / stopped
	Reason  string     `json:"reason,omitempty"`
	Path    *Candidate `json:"path,omitempty"`
	Summary *Summary   `json:"summary,omitempty"`
	Samples []Sample   `json:"samples,omitempty"`
}

// Record 一条历史记录
type Record struct {
	ID        string       `json:"id"`
	Kind      string       `json:"kind"`
	CreatedAt int64        `json:"createdAt"`
	Status    string       `json:"status"` // done / failed / stopped
	Error     string       `json:"error,omitempty"`
	Params    Params       `json:"params"`
	A         string       `json:"a,omitempty"`
	B         string       `json:"b,omitempty"`
	AID       string       `json:"aId,omitempty"`
	BID       string       `json:"bId,omitempty"`
	Path      *Candidate   `json:"path,omitempty"`
	Summary   *Summary     `json:"summary,omitempty"`
	Samples   []Sample     `json:"samples,omitempty"`
	Group     string       `json:"group,omitempty"`
	Hosts     []string     `json:"hosts,omitempty"`
	Center    string       `json:"center,omitempty"`
	Pairs     []PairResult `json:"pairs,omitempty"`
}

// HistoryItem 列表行（不带采样序列）
type HistoryItem struct {
	ID        string     `json:"id"`
	Kind      string     `json:"kind"`
	CreatedAt int64      `json:"createdAt"`
	Status    string     `json:"status"`
	Error     string     `json:"error,omitempty"`
	Params    Params     `json:"params"`
	A         string     `json:"a,omitempty"`
	B         string     `json:"b,omitempty"`
	Path      *Candidate `json:"path,omitempty"`
	Summary   *Summary   `json:"summary,omitempty"`
	Group     string     `json:"group,omitempty"`
	Center    string     `json:"center,omitempty"`
	PairCount int        `json:"pairCount"`
	PairOK    int        `json:"pairOk"`
	AvgAB     float64    `json:"avgAB"` // 分组：成功轮次的平均吞吐
}

// History 落盘到应用数据目录 speedtest_history.json，新记录在前
type History struct {
	mu   sync.Mutex
	path string
}

func newHistory(dir string) *History {
	return &History{path: filepath.Join(dir, "speedtest_history.json")}
}

func (h *History) load() []Record {
	b, err := os.ReadFile(h.path)
	if err != nil {
		return nil
	}
	var list []Record
	if json.Unmarshal(b, &list) != nil {
		return nil
	}
	return list
}

func (h *History) save(list []Record) error {
	if err := os.MkdirAll(filepath.Dir(h.path), 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(list)
	if err != nil {
		return err
	}
	tmp := h.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, h.path)
}

// Add 新增一条（超过上限丢最旧）
func (h *History) Add(r Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	list := append([]Record{r}, h.load()...)
	if len(list) > historyMax {
		list = list[:historyMax]
	}
	return h.save(list)
}

// List 列表
func (h *History) List() []HistoryItem {
	h.mu.Lock()
	defer h.mu.Unlock()
	list := h.load()
	out := make([]HistoryItem, 0, len(list))
	for _, r := range list {
		it := HistoryItem{
			ID: r.ID, Kind: r.Kind, CreatedAt: r.CreatedAt, Status: r.Status, Error: r.Error,
			Params: r.Params, A: r.A, B: r.B, Path: r.Path, Summary: r.Summary,
			Group: r.Group, Center: r.Center, PairCount: len(r.Pairs),
		}
		var sum float64
		for _, p := range r.Pairs {
			if p.Status == PhaseDone && p.Summary != nil {
				it.PairOK++
				sum += p.Summary.AB
			}
		}
		if it.PairOK > 0 {
			it.AvgAB = sum / float64(it.PairOK)
		}
		out = append(out, it)
	}
	return out
}

// Get 单条
func (h *History) Get(id string) (Record, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, r := range h.load() {
		if r.ID == id {
			return r, nil
		}
	}
	return Record{}, errors.New("记录不存在")
}

// Delete 删除；id 为空清空
func (h *History) Delete(id string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if id == "" {
		return h.save([]Record{})
	}
	list := h.load()
	out := list[:0]
	for _, r := range list {
		if r.ID != id {
			out = append(out, r)
		}
	}
	return h.save(out)
}
