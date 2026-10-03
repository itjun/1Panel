package speedtest

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

func feedFile(t *testing.T, name string, f flow) *streamParser {
	t.Helper()
	fh, err := os.Open("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	sp := &streamParser{flow: f, trustRTT: true}
	sc := bufio.NewScanner(fh)
	sc.Buffer(make([]byte, 1<<20), 1<<22)
	for sc.Scan() {
		sp.Feed(sc.Text())
	}
	return sp
}

func TestParseTCPForward(t *testing.T) {
	sp := feedFile(t, "tcp_p2.jsonl", newFlow(SideB, DirForward))
	if len(sp.samples) != 2 {
		t.Fatalf("want 2 samples, got %d", len(sp.samples))
	}
	s := sp.samples[0]
	if s.AB < 4e8 || s.BA != 0 || len(s.StreamsAB) != 2 || s.RTTMs <= 0 {
		t.Fatalf("unexpected sample %+v", s)
	}
	sum := sp.Summary()
	if sum.AB < 4e8 || sum.BA != 0 || sum.Retransmits != 1 || sum.RTTMs <= 0 {
		t.Fatalf("unexpected summary %+v", sum)
	}
}

func TestParseTCPReverseMapsToBA(t *testing.T) {
	// 本机为 A、客户端在 A：用户选反向 B→A，iperf3 带 -R
	f := newFlow(SideB, DirReverse)
	if !f.reverse {
		t.Fatal("reverse with client on A must use -R")
	}
	sp := feedFile(t, "tcp_reverse.jsonl", f)
	sum := sp.Summary()
	if sum.BA <= 0 || sum.AB != 0 {
		t.Fatalf("reverse should land on BA: %+v", sum)
	}
	if len(sp.samples) == 0 || len(sp.samples[0].StreamsBA) != 2 {
		t.Fatalf("streams should land on BA: %+v", sp.samples)
	}
}

func TestParseClientOnBFlipsDirection(t *testing.T) {
	// 客户端在 B（A 是服务端）：用户选正向 A→B 需要 -R，数据仍应落在 AB
	f := newFlow(SideA, DirForward)
	if !f.reverse || f.clientIsA {
		t.Fatalf("unexpected flow %+v", f)
	}
	sp := feedFile(t, "tcp_reverse.jsonl", f)
	if sum := sp.Summary(); sum.AB <= 0 || sum.BA != 0 {
		t.Fatalf("A→B expected: %+v", sum)
	}
}

func TestParseBidir(t *testing.T) {
	sp := feedFile(t, "tcp_bidir.jsonl", newFlow(SideB, DirBidir))
	sum := sp.Summary()
	if sum.AB <= 0 || sum.BA <= 0 {
		t.Fatalf("bidir both directions: %+v", sum)
	}
	if s := sp.samples[0]; len(s.StreamsAB) != 1 || len(s.StreamsBA) != 1 {
		t.Fatalf("bidir streams split: %+v", s)
	}
}

func TestParseUDPBidir(t *testing.T) {
	sp := feedFile(t, "udp_bidir.jsonl", newFlow(SideB, DirBidir))
	if len(sp.samples) == 0 || sp.samples[0].JitterMs <= 0 {
		t.Fatalf("udp interval should carry jitter: %+v", sp.samples)
	}
	sum := sp.Summary()
	if sum.AB < 1.9e8 || sum.BA < 1.9e8 || sum.JitterMs <= 0 {
		t.Fatalf("udp summary: %+v", sum)
	}
}

func TestParseErrorEvent(t *testing.T) {
	sp := &streamParser{}
	sp.Feed(`{"event":"error","data":"unable to connect to server: Connection refused"}`)
	if !strings.Contains(sp.errMsg, "refused") {
		t.Fatal(sp.errMsg)
	}
}

func TestProbeResult(t *testing.T) {
	ok, _, reason := probeResult([]byte(`{"start":{},"intervals":[],"end":{},"error":"unable to connect to server - server may have stopped running or use a different port, firewall issue, etc.: Operation timed out"}`), 5201)
	if ok || !strings.Contains(reason, "5201") {
		t.Fatalf("timeout: %v %s", ok, reason)
	}
	ok, _, _ = probeResult([]byte(`{"error":"the server is busy running a test. try again later"}`), 5201)
	if !ok {
		t.Fatal("busy means reachable")
	}
	ok, rtt, _ := probeResult([]byte(`{"end":{"streams":[{"sender":{"mean_rtt":850}}]}}`), 5201)
	if !ok || rtt != 0.85 {
		t.Fatalf("ok: %v %v", ok, rtt)
	}
}

func TestClientArgs(t *testing.T) {
	p := Params{Protocol: "udp", Parallel: 4, UDPBandwidthMbps: 1000, Direction: DirReverse}
	p.Normalize()
	args := strings.Join(clientArgs("10.0.0.2", 5201, p, newFlow(SideB, p.Direction), true), " ")
	for _, want := range []string{"-c 10.0.0.2", "-p 5201", "-P 4", "-u -b 250000000", "-R", "--json-stream"} {
		if !strings.Contains(args, want) {
			t.Fatalf("missing %q in %s", want, args)
		}
	}
	p = Params{Congestion: "bbr"}
	p.Normalize()
	if args := strings.Join(clientArgs("x", 1, p, newFlow(SideB, DirForward), false), " "); strings.Contains(args, "-C") {
		t.Fatalf("-C only for linux client: %s", args)
	}
}
