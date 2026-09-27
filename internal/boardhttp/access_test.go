package boardhttp

import (
	"net/http"
	"testing"
)

func TestAllowClient(t *testing.T) {
	cases := []struct {
		addr string
		want bool
	}{
		{"10.1.2.3:1234", true},
		{"192.168.0.1:80", true},
		{"172.16.5.6:9", true},
		{"127.0.0.1:8888", true},
		{"8.8.8.8:80", false},
		{"1.2.3.4:443", false},
		{"[::1]:8888", true},
		{"[2001:db8::1]:80", false},
		{"bad", false},
	}
	for _, c := range cases {
		r := &http.Request{RemoteAddr: c.addr}
		if got := AllowClient(r); got != c.want {
			t.Errorf("AllowClient(%q)=%v, want %v", c.addr, got, c.want)
		}
	}
}
