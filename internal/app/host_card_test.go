package app

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"diteng-pannel/internal/agentcli"
	"diteng-pannel/internal/monitor"
	"diteng-pannel/internal/sshd"
)

// 此读取器只允许三个 GET；快照路径若增加控制/安装操作，测试会直接失败。
type cardReader struct {
	calls []string
	fail  map[string]error
}

func (r *cardReader) GetJSON(_ context.Context, path string, out any, _ ...bool) error {
	r.calls = append(r.calls, path)
	if err := r.fail[path]; err != nil {
		return err
	}
	switch path {
	case "/health":
		*out.(*agentcli.Health) = agentcli.Health{Version: "1.2.3"}
	case "/metrics/current":
		out.(*agentcli.CurrentResponse).Metrics.TS = time.Now().Unix()
		out.(*agentcli.CurrentResponse).Metrics.CPUPercent = 0
		out.(*agentcli.CurrentResponse).Metrics.MemTotal = 100
		out.(*agentcli.CurrentResponse).Metrics.MemUsed = 25
	case "/collect/disks":
		*out.(*[]monitor.DiskInfo) = []monitor.DiskInfo{{Total: 100, Used: 50}}
	default:
		return fmt.Errorf("不允许的读取：%s", path)
	}
	return nil
}

func TestHostCardReadOnlySnapshot(t *testing.T) {
	r := &cardReader{}
	s := readHostCardSnapshot(context.Background(), r, "test", true)
	if s.Connection != "online" || s.AgentState != "running" || s.AgentVersion != "1.2.3" || s.Overview == nil || s.Overview.CPUPercent != 0 || len(s.Disks) != 1 {
		t.Fatalf("有效零读数或健康信息丢失：%+v", s)
	}
	if !reflect.DeepEqual(r.calls, []string{"/health", "/metrics/current", "/collect/disks"}) {
		t.Fatalf("非预期读取：%v", r.calls)
	}
	r.calls = nil
	s = readHostCardSnapshot(context.Background(), r, "test", false)
	if s.DetailsIncluded || !reflect.DeepEqual(r.calls, []string{"/metrics/current"}) {
		t.Fatalf("普通刷新不得重复读取健康与磁盘：%+v / %v", s, r.calls)
	}
}

func TestHostCardSeparatesConnectionAndAgent(t *testing.T) {
	for _, tc := range []struct {
		name, connection, agent string
		err                     error
	}{
		{"未安装", "online", "missing", agentcli.ErrNotInstalled},
		{"未运行", "online", "stopped", agentcli.ErrAgentUnreachable},
		{"SSH 失败", "failed", "unknown", fmt.Errorf("%w: handshake", agentcli.ErrSSHConnection)},
		{"无权限", "unknown", "unknown", sshd.ErrNoRoot},
		{"响应异常", "online", "running", agentcli.ErrAgentResponse},
		{"超时", "unknown", "unknown", context.DeadlineExceeded},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := &cardReader{fail: map[string]error{"/health": tc.err}}
			s := readHostCardSnapshot(context.Background(), r, "test", true)
			if s.Connection != tc.connection || s.AgentState != tc.agent || s.Error == "" || s.Overview != nil || len(r.calls) != 1 {
				t.Fatalf("状态误判或失败后继续采集：%+v / %v", s, r.calls)
			}
		})
	}
}

func TestHostCardPartialFailure(t *testing.T) {
	r := &cardReader{fail: map[string]error{"/collect/disks": errors.New("disk failed")}}
	s := readHostCardSnapshot(context.Background(), r, "test", true)
	if s.Overview == nil || s.DiskError == "" || s.Disks != nil || s.Connection != "online" {
		t.Fatalf("磁盘失败不得抹掉有效 CPU/内存：%+v", s)
	}
	r.fail = map[string]error{"/metrics/current": errors.New("尚无采样数据")}
	s = readHostCardSnapshot(context.Background(), r, "test", true)
	if s.Overview != nil || s.OverviewError == "" || len(s.Disks) != 1 || s.Connection != "online" || s.AgentState != "running" {
		t.Fatalf("无采样不能伪造指标或误报离线：%+v", s)
	}
}
