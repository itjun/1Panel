//go:build darwin

package localsys

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStorageCacheRoundTrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	// UserConfigDir on macOS is ~/Library/Application Support
	cfg := filepath.Join(dir, "Library", "Application Support", storageCacheApp)
	if err := os.MkdirAll(cfg, 0o755); err != nil {
		t.Fatal(err)
	}

	eng := &storageEngine{
		state:        "done",
		startedAt:    100,
		finishedAt:   200,
		roots:        []string{"/tmp/a"},
		scannedBytes: 1234,
		scannedFiles: 5,
		scannedDirs:  2,
		dirs: map[string]*scanDir{
			"/tmp/a": {path: "/tmp/a", name: "a", size: 1234, files: 5, dirs: 0, kids: nil},
		},
		largeList: []StorageFile{{Path: "/tmp/a/f", Size: 100, ModTime: 1}},
		apps:      []StorageApp{{Name: "Demo", Path: "/Applications/Demo.app", Total: 50}},
	}
	if err := eng.saveCacheLocked(); err != nil {
		t.Fatal(err)
	}
	path, err := storageCachePath()
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var c storageCache
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	if c.Version != storageCacheVer || c.ScannedBytes != 1234 || len(c.Dirs) != 1 {
		t.Fatalf("bad cache: %+v", c)
	}

	eng2 := &storageEngine{state: "idle", dirs: map[string]*scanDir{}}
	if err := eng2.loadCache(); err != nil {
		t.Fatal(err)
	}
	if eng2.state != "done" || eng2.finishedAt != 200 {
		t.Fatalf("load state=%s finished=%d", eng2.state, eng2.finishedAt)
	}
	if eng2.dirs["/tmp/a"] == nil || eng2.dirs["/tmp/a"].size != 1234 {
		t.Fatalf("dirs=%v", eng2.dirs)
	}
	if len(eng2.apps) != 1 || eng2.apps[0].Name != "Demo" {
		t.Fatalf("apps=%v", eng2.apps)
	}
}
