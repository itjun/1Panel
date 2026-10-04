package speedtest

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestParsePingAvg(t *testing.T) {
	cases := []struct {
		name string
		out  string
		want float64
	}{
		{"posix", "rtt min/avg/max/mdev = 0.191/0.311/0.501/0.101 ms", 0.311},
		{"win-en", "Approximate round trip times in milli-seconds:\n    Minimum = 1ms, Maximum = 3ms, Average = 2ms", 2},
		{"win-zh", "大约需要的时间（以毫秒为单位）:\n    最短 = 1ms，最长 = 3ms，平均 = 2ms", 2},
		// 中文 Windows 的 ping 输出为 GBK 编码，被按 UTF-8 读入后中文成乱码，「= xms」结构仍在
		{"win-zh-gbk", string([]byte("\xd7\xee\xb6\xcc = 1ms\xa3\xac\xd7\xee\xb3\xa4 = 3ms\xa3\xac\xc6\xbd\xbe\xf9 = 2ms")), 2},
		{"win-timeout", "Request timed out.\nRequest timed out.", 0},
		{"win-unreachable", "无法访问目标主机 4 个已丢失 = 4", 0},
		{"empty", "", 0},
	}
	for _, c := range cases {
		if got := parsePingAvg(c.out); got != c.want {
			t.Errorf("%s: parsePingAvg = %v，期望 %v", c.name, got, c.want)
		}
	}
}

// 本机端到端 provision：内置产物未下载时跳过
func TestLocalProvision(t *testing.T) {
	ctx := context.Background()
	l := &localEP{svc: &Service{dataDir: t.TempDir()}}
	if err := l.provision(context.Background()); err != nil {
		t.Skipf("内置产物未下载：%v", err)
	}
	if _, err := os.Stat(l.bin); err != nil {
		t.Fatalf("入口二进制不存在：%v", err)
	}
	out, err := exec.CommandContext(ctx, l.bin, "--version").CombinedOutput()
	if err != nil || !strings.Contains(string(out), "iperf") {
		t.Fatalf("入口二进制无法运行：%v\n%s", err, out)
	}
	// 再跑一遍应命中复用路径
	if err := l.provision(context.Background()); err != nil {
		t.Fatalf("复用失败：%v", err)
	}
}
