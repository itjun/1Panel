//go:build darwin

package localapps

import (
	"errors"
	"net"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
)

func TestParseLsofFieldOutputPreservesValuesWithSpaces(t *testing.T) {
	output := []byte("p42\x00cdev server\x00u501\x00R1\x00fcwd\x00a \x00tDIR\x00n/Users/me/Project With Spaces\x00\nf17\x00ar\x00tIPv6\x00PTCP\x00TST=LISTEN\x00n[::1]:43123\x00\n")
	entries := parseLsofFieldOutput(output)
	if len(entries) != 2 {
		t.Fatalf("解析出 %d 条资源，期望 2 条: %+v", len(entries), entries)
	}
	if entries[0].PID != 42 || entries[0].FD != "cwd" || entries[0].Name != "/Users/me/Project With Spaces" {
		t.Fatalf("cwd 字段解析错误: %+v", entries[0])
	}
	if entries[1].Command != "dev server" || entries[1].Protocol != "TCP" || entries[1].State != "LISTEN" {
		t.Fatalf("进程或 socket 元数据解析错误: %+v", entries[1])
	}
	if got := parseListenPort(entries[1].Name); got != 43123 {
		t.Fatalf("IPv6 端口=%d，期望 43123", got)
	}
}

func TestParseListenPortHandlesIPv4IPv6AndSocketState(t *testing.T) {
	cases := []struct {
		address string
		want    int
	}{
		{"*:4173 (LISTEN)", 4173},
		{"TCP 127.0.0.1:8080 (LISTEN)", 8080},
		{"[::1]:8443", 8443},
		{"127.0.0.1:8080->127.0.0.1:55220 (ESTABLISHED)", 8080},
		{"*:https", 0},
	}
	for _, test := range cases {
		if got := parseListenPort(test.address); got != test.want {
			t.Errorf("parseListenPort(%q)=%d, want %d", test.address, got, test.want)
		}
	}
}

func TestParseLsofFieldOutputHandlesResourceTypesAndMissingFields(t *testing.T) {
	output := []byte("p99\x00capi worker\x00u501\x00R3\x00f10\x00ar\x00tREG\x00n/tmp/data file\x00\nf11\x00au\x00tIPv4\x00PTCP\x00TST=LISTEN\x00n127.0.0.1:8080\x00\nf12\x00tIPv6\x00PTCP\x00TST=LISTEN\x00n[::1]:8443\x00\nf13\x00au\x00tunix\x00nunix socket\x00\nf14\x00tFIFO\x00npipe\x00\n")
	entries := parseLsofFieldOutput(output)
	if len(entries) != 5 {
		t.Fatalf("解析出 %d 条资源，期望 5 条: %+v", len(entries), entries)
	}
	if entries[0].FD != "10" || entries[0].Type != "REG" || entries[0].Access != "r" || entries[0].Name != "/tmp/data file" {
		t.Fatalf("普通文件字段解析错误: %+v", entries[0])
	}
	if entries[1].Type != "IPv4" || entries[1].State != "LISTEN" || parseListenPort(entries[1].Name) != 8080 {
		t.Fatalf("IPv4 socket 字段解析错误: %+v", entries[1])
	}
	if entries[2].Type != "IPv6" || entries[2].State != "LISTEN" || parseListenPort(entries[2].Name) != 8443 {
		t.Fatalf("IPv6 socket 字段解析错误: %+v", entries[2])
	}
	if entries[3].FD != "13" || entries[3].Type != "unix" || entries[3].Access != "u" {
		t.Fatalf("Unix socket 的缺失字段处理错误: %+v", entries[3])
	}
	if entries[4].Type != "FIFO" || entries[4].Name != "pipe" {
		t.Fatalf("pipe 字段解析错误: %+v", entries[4])
	}
}

func TestLsofWarningReportsMissingBinaryAndPermission(t *testing.T) {
	if warning := lsofWarning(exec.ErrNotFound, ""); !strings.Contains(warning, "找不到 lsof") {
		t.Fatalf("缺少 lsof 的提示不正确: %q", warning)
	}
	if warning := lsofWarning(errors.New("exit status 1"), "lsof: status error: Operation not permitted"); !strings.Contains(warning, "权限限制") {
		t.Fatalf("权限错误提示不正确: %q", warning)
	}
	if warning := lsofWarning(nil, ""); warning != "" {
		t.Fatalf("成功且无 stderr 时不应产生提示: %q", warning)
	}
}

func TestCollectListeningSocketsFindsCurrentProcess(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		if errors.Is(err, syscall.EPERM) {
			t.Skipf("当前沙箱禁止绑定本机监听端口: %v", err)
		}
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port

	byPID, warnings := collectListeningSockets()
	if len(warnings) > 0 {
		t.Fatalf("读取监听端口出现警告: %v", warnings)
	}
	found := false
	for _, address := range byPID[os.Getpid()] {
		if parseListenPort(address) == port {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("lsof 未发现当前测试进程监听端口 %d: %+v", port, byPID[os.Getpid()])
	}
}

func TestCollectWorkingDirectoriesBatchesCurrentPID(t *testing.T) {
	want, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	cwds, warnings := collectWorkingDirectories([]int{os.Getpid(), os.Getpid()})
	if len(warnings) > 0 {
		t.Fatalf("读取工作目录出现警告: %v", warnings)
	}
	if got := cwds[os.Getpid()]; got != want {
		t.Fatalf("cwd=%q, want %q", got, want)
	}
}
