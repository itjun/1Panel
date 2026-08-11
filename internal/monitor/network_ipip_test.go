package monitor

import "testing"

func TestParseEgressFromIPIP(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantIP  string
		wantLoc string
	}{
		{
			"normal",
			"当前 IP：203.0.113.67  来自于：中国 示例 示例  示例运营商\n",
			"203.0.113.67",
			"中国 示例 示例 示例运营商",
		},
		{
			"ascii colon",
			"当前 IP: 1.2.3.4  来自于：中国 北京 北京 电信",
			"1.2.3.4",
			"中国 北京 北京 电信",
		},
		{
			"ip only fallback",
			"something 203.0.113.55 junk",
			"203.0.113.55",
			"",
		},
		{
			"empty",
			"",
			"",
			"",
		},
		{
			"html wrapped",
			"<html><body>当前 IP：8.8.8.8  来自于：美国</body></html>",
			"8.8.8.8",
			"美国",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ip, loc := parseEgressFromIPIP(c.raw)
			if ip != c.wantIP {
				t.Fatalf("ip=%q want %q", ip, c.wantIP)
			}
			if loc != c.wantLoc {
				t.Fatalf("loc=%q want %q", loc, c.wantLoc)
			}
		})
	}
}
