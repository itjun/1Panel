package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseTCPListenAndMerge(t *testing.T) {
	dir := t.TempDir()
	tcp := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 11111 1 0000000000000000 100 0 0 10 0
`
	if err := os.WriteFile(filepath.Join(dir, "tcp"), []byte(tcp), 0o644); err != nil {
		t.Fatal(err)
	}
	m := map[uint64]int{}
	parseTCPListen(filepath.Join(dir, "tcp"), m)
	if m[11111] != 8080 {
		t.Fatalf("inode map: %+v", m)
	}
	got := mergePorts([]int{8080}, []int{8080, 8301})
	if len(got) != 2 {
		t.Fatalf("merge %+v", got)
	}
}
