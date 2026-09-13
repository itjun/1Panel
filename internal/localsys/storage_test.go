//go:build darwin

package localsys

import (
	"container/heap"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
)

func TestPushLargeTopN(t *testing.T) {
	h := &fileMinHeap{}
	heap.Init(h)
	for i := 1; i <= 50; i++ {
		pushLarge(h, StorageFile{
			Path: filepath.Join("/f", filepath.Join("x", string(rune('0'+i%10)))),
			Size: uint64(i * 100),
		}, 10)
	}
	out := dumpLarge(h)
	if len(out) != 10 {
		t.Fatalf("len=%d want 10", len(out))
	}
	if out[0].Size != 5000 {
		t.Fatalf("top=%d want 5000", out[0].Size)
	}
	if out[9].Size != 4100 {
		t.Fatalf("10th=%d want 4100", out[9].Size)
	}
}

func TestWalkDirAggregateAndHardlink(t *testing.T) {
	root := t.TempDir()
	mustWrite := func(rel string, n int) {
		p := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		b := make([]byte, n)
		for i := range b {
			b[i] = 'x'
		}
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("a/big.bin", 8192)
	mustWrite("a/small.bin", 100)
	mustWrite("b/other.bin", 4096)

	src := filepath.Join(root, "a/big.bin")
	link := filepath.Join(root, "b/big-link.bin")
	if err := os.Link(src, link); err != nil {
		t.Fatal(err)
	}

	dirs := map[string]*scanDir{}
	seen := map[inodeKey]struct{}{}
	var filesNoted int

	info, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	stat := info.Sys().(*syscall.Stat_t)

	total, nFiles, nDirs := walkDir(
		root, filepath.Base(root), stat.Dev,
		&sync.Mutex{}, seen,
		func(d *scanDir) { dirs[d.path] = d },
		func(string) {},
		func(string, uint64, int64) { filesNoted++ },
		func(uint64, int64, int64) {},
	)

	if nFiles != 3 {
		t.Fatalf("nFiles=%d want 3 (hardlink dedup)", nFiles)
	}
	if nDirs < 2 {
		t.Fatalf("nDirs=%d", nDirs)
	}
	if total == 0 {
		t.Fatal("total=0")
	}
	a := dirs[filepath.Join(root, "a")]
	if a == nil || a.size == 0 {
		t.Fatalf("dir a missing: %+v", a)
	}
	bigSz := diskSizeOf(mustStat(t, src))
	smallSz := diskSizeOf(mustStat(t, filepath.Join(root, "a/small.bin")))
	otherSz := diskSizeOf(mustStat(t, filepath.Join(root, "b/other.bin")))
	if total >= bigSz*2+smallSz+otherSz {
		t.Fatalf("hardlink not deduped: total=%d big=%d", total, bigSz)
	}
	if filesNoted != 3 {
		t.Fatalf("filesNoted=%d want 3", filesNoted)
	}
}

func mustStat(t *testing.T, p string) os.FileInfo {
	t.Helper()
	st, err := os.Lstat(p)
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func TestCollectAppPartsMatch(t *testing.T) {
	home := t.TempDir()
	bid := "com.example.Demo"
	name := "Demo"
	paths := []string{
		filepath.Join(home, "Library", "Containers", bid),
		filepath.Join(home, "Library", "Application Support", bid),
		filepath.Join(home, "Library", "Caches", bid),
		filepath.Join(home, "Library", "Group Containers", "TEAM."+bid),
		filepath.Join(home, "Library", "Logs", name),
	}
	for _, p := range paths {
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(p, "data"), []byte("hello-world-data"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pref := filepath.Join(home, "Library", "Preferences", bid+".plist")
	if err := os.MkdirAll(filepath.Dir(pref), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pref, []byte("plist"), 0o644); err != nil {
		t.Fatal(err)
	}

	sizes := map[string]uint64{}
	for _, p := range paths {
		sizes[p] = 1000
	}
	parts := collectAppParts(home, appMeta{Name: name, BundleID: bid, Path: "/Applications/Demo.app"},
		func(p string) uint64 { return sizes[p] },
		func(p string) uint64 {
			if p == pref {
				return 50
			}
			return 0
		},
	)
	var sum uint64
	labels := map[string]bool{}
	for _, p := range parts {
		sum += p.Size
		labels[p.Label] = true
	}
	if sum < 4050 {
		t.Fatalf("sum=%d parts=%+v", sum, parts)
	}
	if !labels["Containers"] || !labels["Group Containers"] || !labels["Preferences"] {
		t.Fatalf("missing labels: %v", labels)
	}
}
