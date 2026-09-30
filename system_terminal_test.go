package main

import "testing"

func TestGhosttyOpenURL(t *testing.T) {
	cases := []struct {
		name    string
		hosts   []string
		want    string
		wantErr bool
	}{
		{name: "single", hosts: []string{"alpha"}, want: "ghostty://open?host=alpha&reuse=1"},
		{name: "batch and space", hosts: []string{"alpha", "beta box"}, want: "ghostty://open?host=alpha&host=beta%20box&reuse=1"},
		{name: "skip blank", hosts: []string{"  ", "gamma"}, want: "ghostty://open?host=gamma&reuse=1"},
		{name: "skip newline", hosts: []string{"bad\nhost", "gamma"}, want: "ghostty://open?host=gamma&reuse=1"},
		{name: "plus stays escaped", hosts: []string{"a+b"}, want: "ghostty://open?host=a%2Bb&reuse=1"},
		{name: "empty", hosts: []string{"", "  "}, wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ghosttyOpenURL(c.hosts)
			if c.wantErr {
				if err == nil {
					t.Fatalf("ghosttyOpenURL(%q) = %q, want error", c.hosts, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("ghosttyOpenURL(%q) error: %v", c.hosts, err)
			}
			if got != c.want {
				t.Fatalf("ghosttyOpenURL(%q) = %q, want %q", c.hosts, got, c.want)
			}
		})
	}
}
