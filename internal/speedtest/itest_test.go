//go:build itest

// 真机联调：SPEEDTEST_HOSTS=debian[,grok-box] go test -tags itest -run TestReal -v ./internal/speedtest
package speedtest

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"diteng-pannel/internal/sshd"
)

func sshOpt(host string) (sshd.ConnectOption, error) {
	out, err := exec.Command("ssh", "-G", host).Output()
	if err != nil {
		return sshd.ConnectOption{}, err
	}
	opt := sshd.ConnectOption{Host: host}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		k, v, _ := strings.Cut(sc.Text(), " ")
		switch k {
		case "hostname":
			opt.HostName = v
		case "user":
			opt.User = v
		case "port":
			opt.Port = v
		case "identityfile":
			if strings.HasPrefix(v, "~/") {
				home, _ := os.UserHomeDir()
				v = home + v[1:]
			}
			if _, err := os.Stat(v); err == nil {
				opt.IdentityFiles = append(opt.IdentityFiles, v)
				if opt.IdentityFile == "" {
					opt.IdentityFile = v
				}
			}
		}
	}
	return opt, nil
}

type recorder struct {
	mu     sync.Mutex
	events []string
	states chan StateEvent
}

func (r *recorder) emit(name string, data any) {
	b, _ := json.Marshal(data)
	r.mu.Lock()
	r.events = append(r.events, name+" "+string(b))
	r.mu.Unlock()
	if st, ok := data.(StateEvent); ok && (st.Phase == PhaseDone || st.Phase == PhaseFailed || st.Phase == PhaseStopped) {
		r.states <- st
	}
}

func newRealService(t *testing.T) (*Service, *recorder, []string) {
	hosts := strings.Split(os.Getenv("SPEEDTEST_HOSTS"), ",")
	if hosts[0] == "" {
		t.Skip("SPEEDTEST_HOSTS 未设置")
	}
	rec := &recorder{states: make(chan StateEvent, 8)}
	svc := New(Options{Mgr: sshd.NewManager(), ConnectOption: sshOpt, Emit: rec.emit, DataDir: t.TempDir()})
	return svc, rec, hosts
}

func waitState(t *testing.T, rec *recorder, d time.Duration) StateEvent {
	select {
	case st := <-rec.states:
		return st
	case <-time.After(d):
		t.Fatal("等待测速结束超时")
	}
	return StateEvent{}
}

func remoteIperfProcs(t *testing.T, host string) string {
	out, _ := exec.Command("ssh", host, `ps -eo pid,args | grep "[i]perf3-" || true`).Output()
	return strings.TrimSpace(string(out))
}

func TestRealDetectAndRun(t *testing.T) {
	svc, rec, hosts := newRealService(t)
	host := hosts[0]

	report, err := svc.DetectPaths(LocalID, host, 0)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.MarshalIndent(report, "", "  ")
	t.Logf("report:\n%s", b)
	if !report.LAN.Available {
		t.Fatalf("本机 ↔ %s 应识别出局域网", host)
	}
	if procs := remoteIperfProcs(t, host); procs != "" {
		t.Fatalf("探测后远端残留 iperf3：%s", procs)
	}

	for _, tc := range []Params{
		{Protocol: "tcp", Parallel: 4, Duration: 3, Direction: DirForward},
		{Protocol: "tcp", Parallel: 1, Duration: 3, Direction: DirReverse},
		{Protocol: "tcp", Parallel: 8, Duration: 3, Direction: DirBidir},
		{Protocol: "udp", Parallel: 2, Duration: 3, Direction: DirBidir, UDPBandwidthMbps: 200},
	} {
		id, err := svc.Start(StartRequest{A: LocalID, B: host, Path: *report.LAN.Best, Params: tc})
		if err != nil {
			t.Fatal(err)
		}
		st := waitState(t, rec, 60*time.Second)
		if st.Phase != PhaseDone || st.Summary == nil {
			t.Fatalf("%+v: %+v", tc, st)
		}
		t.Logf("%s %s P%d %s: AB=%.0f Mbps BA=%.0f Mbps retr=%d rtt=%.2fms jitter=%.3f lost=%.2f%%",
			id, tc.Protocol, tc.Parallel, tc.Direction, st.Summary.AB/1e6, st.Summary.BA/1e6,
			st.Summary.Retransmits, st.Summary.RTTMs, st.Summary.JitterMs, st.Summary.LostPct)
		switch tc.Direction {
		case DirForward:
			if st.Summary.AB <= 0 || st.Summary.BA != 0 {
				t.Fatalf("forward: %+v", st.Summary)
			}
		case DirReverse:
			if st.Summary.BA <= 0 || st.Summary.AB != 0 {
				t.Fatalf("reverse: %+v", st.Summary)
			}
		case DirBidir:
			if st.Summary.AB <= 0 || st.Summary.BA <= 0 {
				t.Fatalf("bidir: %+v", st.Summary)
			}
		}
	}

	// 中途停止：两端不留进程
	id, err := svc.Start(StartRequest{A: host, B: LocalID, Path: Candidate{}, Params: Params{}})
	if err == nil {
		t.Fatalf("空路径应拒绝: %s", id)
	}
	id, err = svc.Start(StartRequest{A: LocalID, B: host, Path: *report.LAN.Best, Params: Params{Duration: 30}})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(4 * time.Second)
	svc.Stop(id)
	st := waitState(t, rec, 20*time.Second)
	if st.Phase != PhaseStopped {
		t.Fatalf("stop: %+v", st)
	}
	time.Sleep(time.Second)
	if procs := remoteIperfProcs(t, host); procs != "" {
		t.Fatalf("停止后远端残留 iperf3：%s", procs)
	}
	if out, _ := exec.Command("pgrep", "-fl", "iperf3-"+"3.22").Output(); len(bytes.TrimSpace(out)) > 0 {
		t.Fatalf("停止后本机残留 iperf3：%s", out)
	}
	if n := len(svc.ListHistory()); n != 5 {
		t.Fatalf("历史应有 5 条，实际 %d", n)
	}
}

func TestRealGroup(t *testing.T) {
	svc, rec, hosts := newRealService(t)
	if len(hosts) < 2 {
		t.Skip("分组测速需要至少 2 台主机")
	}
	for _, mode := range []string{KindStar, KindMesh} {
		id, err := svc.StartGroup(GroupRequest{Group: "itest", Hosts: hosts, Mode: mode, Center: hosts[0], Params: Params{Duration: 3}})
		if err != nil {
			t.Fatal(err)
		}
		st := waitState(t, rec, 3*time.Minute)
		r, err := svc.GetHistory(id)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range r.Pairs {
			ab, ba := 0.0, 0.0
			if p.Summary != nil {
				ab, ba = p.Summary.AB/1e6, p.Summary.BA/1e6
			}
			path := ""
			if p.Path != nil {
				path = p.Path.Relation + " " + p.Path.Target.IP
			}
			t.Logf("%s %s→%s %s [%s] AB=%.0f BA=%.0f %s", mode, p.A, p.B, p.Status, path, ab, ba, p.Reason)
		}
		if st.Phase != PhaseDone {
			t.Fatalf("%s: %+v", mode, st)
		}
	}
}
