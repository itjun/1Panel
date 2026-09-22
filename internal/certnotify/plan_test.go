package certnotify

import (
	"testing"
	"time"

	"diteng-pannel/internal/agentapi"
)

func TestPlanGroupsSameCertOnce(t *testing.T) {
	loc := time.FixedZone("UTC", 0)
	exp := time.Date(2026, 10, 1, 8, 30, 0, 0, loc).Unix()
	snap := agentapi.CertCheckSnapshot{
		Scanned:   true,
		Installed: true,
		Certs: []agentapi.CertBrief{
			{Name: "a.pem", Domains: []string{"a.example"}, Issuer: "LE", NotAfter: exp, DaysLeft: 12},
			{Name: "a.crt", Domains: []string{"a.example"}, Issuer: "LE", NotAfter: exp, DaysLeft: 12},
			{Name: "b.crt", Domains: []string{"b.example"}, Issuer: "LE", NotAfter: exp, DaysLeft: 30},
		},
	}
	got := Plan("web-1", snap, nil, loc)
	if len(got.Nags) != 1 {
		t.Fatalf("nags=%d %#v", len(got.Nags), got.Nags)
	}
	n := got.Nags[0]
	if n.Title != "「web-1」a.example 证书剩余 12 天" {
		t.Fatalf("title=%q", n.Title)
	}
	if n.Expired {
		t.Fatal("12 days left is not expired")
	}
	if n.Body != "web-1 · a.example · 到期 2026-10-01 08:30 · 剩余 12 天 · a.crt、a.pem" {
		t.Fatalf("body=%q", n.Body)
	}
	if len(got.Recoveries) != 0 || len(got.NextNagging) != 1 || got.NextNagging[0] != "a.example" {
		t.Fatalf("result=%#v", got)
	}
}

func TestPlanExpiredAndCoexistence(t *testing.T) {
	loc := time.UTC
	oldExp := time.Date(2026, 9, 1, 0, 0, 0, 0, loc).Unix()
	newExp := time.Date(2027, 9, 1, 0, 0, 0, 0, loc).Unix()
	snap := agentapi.CertCheckSnapshot{
		Certs: []agentapi.CertBrief{
			{Name: "old.crt", Domains: []string{"a.example", "www.a.example"}, Issuer: "LE", NotAfter: oldExp, DaysLeft: -3},
			{Name: "new.crt", Domains: []string{"a.example", "www.a.example"}, Issuer: "LE", NotAfter: newExp, DaysLeft: 300},
		},
	}
	got := Plan("h", snap, []string{"a.example,www.a.example"}, loc)
	if len(got.Nags) != 1 || !got.Nags[0].Expired {
		t.Fatalf("nags=%#v", got.Nags)
	}
	if got.Nags[0].Title != "「h」a.example、www.a.example 证书已过期 3 天" {
		t.Fatalf("title=%q", got.Nags[0].Title)
	}
	if len(got.Recoveries) != 0 {
		t.Fatalf("coexistence must not recover: %#v", got.Recoveries)
	}
	if len(got.NextNagging) != 1 {
		t.Fatalf("next=%v", got.NextNagging)
	}
}

func TestPlanRecoveryWhenReplaced(t *testing.T) {
	loc := time.UTC
	exp := time.Date(2027, 1, 2, 3, 4, 0, 0, loc).Unix()
	snap := agentapi.CertCheckSnapshot{
		Certs: []agentapi.CertBrief{
			{Name: "new.crt", Domains: []string{"a.example"}, Issuer: "LE", NotAfter: exp, DaysLeft: 80},
		},
	}
	got := Plan("h", snap, []string{"a.example", "gone.example"}, loc)
	if len(got.Nags) != 0 || len(got.NextNagging) != 0 {
		t.Fatalf("nags/next=%#v", got)
	}
	if len(got.Recoveries) != 1 {
		t.Fatalf("recoveries=%#v", got.Recoveries)
	}
	r := got.Recoveries[0]
	if r.DomainKey != "a.example" || r.Title != "「h」a.example 证书已续期" {
		t.Fatalf("recovery=%#v", r)
	}
	if r.Body != "h · a.example · 到期 2027-01-02 03:04 · 剩余 80 天 · new.crt" {
		t.Fatalf("body=%q", r.Body)
	}
}

func TestPlanDeleteIsSilence(t *testing.T) {
	got := Plan("h", agentapi.CertCheckSnapshot{Installed: false}, []string{"a.example"}, time.UTC)
	if len(got.Nags) != 0 || len(got.Recoveries) != 0 || len(got.NextNagging) != 0 {
		t.Fatalf("%#v", got)
	}
}

func TestGroupKeyMatchesCertPage(t *testing.T) {
	got := GroupKey([]string{"a.example", "www.a.example"}, "LE", 1700000000)
	if got != "a.example,www.a.example|LE|1700000000" {
		t.Fatalf("group key=%q", got)
	}
}

func TestPlanParseFailedKeepsNagging(t *testing.T) {
	loc := time.UTC
	exp := time.Date(2027, 1, 2, 0, 0, 0, 0, loc).Unix()
	snap := agentapi.CertCheckSnapshot{
		ParseFailed: true,
		Certs: []agentapi.CertBrief{
			{Name: "new.crt", Domains: []string{"a.example"}, Issuer: "LE", NotAfter: exp, DaysLeft: 80},
		},
	}
	got := Plan("h", snap, []string{"a.example", "stuck.example"}, loc)
	if len(got.Nags) != 0 || len(got.Recoveries) != 0 {
		t.Fatalf("parse failure must not notify or recover: %#v", got)
	}
	if len(got.NextNagging) != 2 {
		t.Fatalf("next=%v", got.NextNagging)
	}
}

func TestPlanNoOpensslKeepsNagging(t *testing.T) {
	got := Plan("h", agentapi.CertCheckSnapshot{NoOpenssl: true}, []string{"a.example"}, time.UTC)
	if len(got.Nags) != 0 || len(got.Recoveries) != 0 {
		t.Fatalf("notices=%#v", got)
	}
	if len(got.NextNagging) != 1 || got.NextNagging[0] != "a.example" {
		t.Fatalf("next=%v", got.NextNagging)
	}
}
