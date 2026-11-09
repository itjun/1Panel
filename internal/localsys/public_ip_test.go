package localsys

import "testing"

func TestParsePublicIPFromIPIP(t *testing.T) {
	ip, loc := parsePublicIPFromIPIP("当前 IP：203.0.113.67  来自于：中国 天津 天津  联通")
	if ip != "203.0.113.67" || loc != "中国 天津 天津  联通" {
		t.Fatalf("got %q, %q", ip, loc)
	}
	ip, _ = parsePublicIPFromIPIP("")
	if ip != "" {
		t.Fatalf("empty raw should yield empty ip, got %q", ip)
	}
}

func TestParsePublicIPLocationMissingOrInvalid(t *testing.T) {
	for _, raw := range []string{"当前 IP：203.0.113.67", "来自于：中国 天津 天津  联通", ""} {
		_, loc := parsePublicIPFromIPIP(raw)
		if loc != "" {
			t.Fatalf("%q: unexpected location %q", raw, loc)
		}
	}
}
