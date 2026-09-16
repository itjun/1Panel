package aptsource

import "testing"

func TestProbeURLUbuntu(t *testing.T) {
	d := Distro{ID: "ubuntu", Codename: "noble"}
	u := ProbeURL(d, Mirror{ID: IDAliyun, Host: "mirrors.aliyun.com"})
	if u != "http://mirrors.aliyun.com/ubuntu/dists/noble/Release" {
		t.Fatal(u)
	}
	u = ProbeURL(d, Mirror{ID: IDOfficial, Host: "archive.ubuntu.com"})
	if u != "http://archive.ubuntu.com/ubuntu/dists/noble/Release" {
		t.Fatal(u)
	}
}

func TestBest(t *testing.T) {
	_, ok := Best(nil)
	if ok {
		t.Fatal("empty")
	}
	hits := []ProbeHit{
		{ID: "a", OK: false, MS: 1},
		{ID: "b", OK: true, MS: 80},
		{ID: "c", OK: true, MS: 20},
	}
	b, ok := Best(hits)
	if !ok || b.ID != "c" {
		t.Fatalf("%+v %v", b, ok)
	}
}
