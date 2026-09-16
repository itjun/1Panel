package aptsource

import (
	"os"
	"path/filepath"
	"strings"
)

const maxFileBytes = 512 * 1024

// Collect 读本机 apt 源文件（agent 本地）。
func Collect() (Snapshot, error) {
	d, err := readDistro()
	if err != nil {
		d = Distro{}
	}
	if !d.Apt {
		if _, err := os.Stat("/usr/bin/apt-get"); err == nil {
			d.Apt = true
		}
	}
	snap := Snapshot{Distro: d}
	if !d.Apt {
		return snap, nil
	}
	add := func(p string) {
		st, err := os.Stat(p)
		if err != nil || !st.Mode().IsRegular() {
			return
		}
		if st.Size() > maxFileBytes {
			return
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return
		}
		snap.Files = append(snap.Files, File{
			Name:    filepath.Base(p),
			Path:    p,
			Size:    st.Size(),
			Content: string(b),
		})
	}
	add("/etc/apt/sources.list")
	ents, err := os.ReadDir("/etc/apt/sources.list.d")
	if err != nil {
		return snap, nil
	}
	for _, e := range ents {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		low := strings.ToLower(name)
		if !strings.HasSuffix(low, ".list") && !strings.HasSuffix(low, ".sources") {
			continue
		}
		if strings.Contains(low, ".bak") || strings.HasSuffix(low, ".save") ||
			strings.Contains(low, ".distupgrade") || strings.HasSuffix(low, "~") {
			continue
		}
		add(filepath.Join("/etc/apt/sources.list.d", name))
	}
	return snap, nil
}
