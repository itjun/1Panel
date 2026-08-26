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

func TestServerPortFromArg(t *testing.T) {
	if serverPortFromArg("--server.port=8301") != 8301 {
		t.Fatal("--server.port")
	}
	if serverPortFromArg("-Dserver.port=8101") != 8101 {
		t.Fatal("-Dserver.port")
	}
	if serverPortFromArg("-jar") != 0 {
		t.Fatal("非端口参数")
	}
}

func TestPortsFromCmdlineDashD(t *testing.T) {
	got := portsFromCmdline("java -Dserver.port=8101 -jar app.jar")
	if len(got) != 1 || got[0] != 8101 {
		t.Fatalf("%v", got)
	}
}

func TestPickPort(t *testing.T) {
	if pickPort([]int{39665, 8011}, 8011, 8019) != 8011 {
		t.Fatal("应优先区间内端口")
	}
	if pickPort([]int{39665}, 8011, 8019) != 39665 {
		t.Fatal("单监听口应回退使用")
	}
	if pickPort([]int{1, 2}, 8011, 8019) != 0 {
		t.Fatal("多口且都不在区间应放弃")
	}
}
