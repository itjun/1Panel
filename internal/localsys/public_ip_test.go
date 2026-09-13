package localsys

import "testing"

func TestParsePublicIPFromIPIP(t *testing.T) {
	ip, _ := parsePublicIPFromIPIP("当前 IP：203.0.113.67  来自于：中国 示例 示例  示例运营商")
	if ip != "203.0.113.67" {
		t.Fatalf("got %q", ip)
	}
	ip, _ = parsePublicIPFromIPIP("")
	if ip != "" {
		t.Fatalf("empty raw should yield empty ip, got %q", ip)
	}
}
