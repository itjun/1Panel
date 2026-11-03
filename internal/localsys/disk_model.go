package localsys

import (
	"strings"
	"sync"
	"time"
)

type diskModelKey struct {
	device string
	name   string
	total  uint64
}

type diskModelEntry struct {
	model   string
	err     string
	expires time.Time
}

type diskModelCache struct {
	mu      sync.Mutex
	entries map[diskModelKey]diskModelEntry
}

var localDiskModels diskModelCache

// 型号不随实时使用率变化；缓存一分钟，拔出的设备随下一次采集移除。
func (c *diskModelCache) fill(disks []DiskInfo, now time.Time, read func(string) (string, error)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	next := make(map[diskModelKey]diskModelEntry)
	for i := range disks {
		d := &disks[i]
		if d.Kind != "disk" || d.Device == "" {
			continue
		}
		key := diskModelKey{d.Device, d.Name, d.Total}
		entry, isCached := c.entries[key]
		if !isCached || !now.Before(entry.expires) {
			model, err := read(d.Device)
			entry = diskModelEntry{model: strings.TrimSpace(model), expires: now.Add(time.Minute)}
			if err != nil {
				entry.model = ""
				entry.err = err.Error()
				entry.expires = now.Add(5 * time.Second)
			}
		}
		d.Model, d.ModelError = entry.model, entry.err
		next[key] = entry
	}
	c.entries = next
}
