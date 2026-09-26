package main

import "testing"

func TestOneAgentOpenURL(t *testing.T) {
	cases := []struct {
		name    string
		hosts   []string
		want    string
		wantErr bool
	}{
		{name: "single", hosts: []string{"alpha"}, want: "oneagent://open?host=alpha"},
		{name: "batch and space", hosts: []string{"alpha", "beta box"}, want: "oneagent://open?host=alpha&host=beta%20box"},
		{name: "skip blank", hosts: []string{"  ", "gamma"}, want: "oneagent://open?host=gamma"},
		{name: "skip newline", hosts: []string{"bad\nhost", "gamma"}, want: "oneagent://open?host=gamma"},
		{name: "plus stays escaped", hosts: []string{"a+b"}, want: "oneagent://open?host=a%2Bb"},
		{name: "empty", hosts: []string{"", "  "}, wantErr: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := oneAgentOpenURL(c.hosts)
			if c.wantErr {
				if err == nil {
					t.Fatalf("oneAgentOpenURL(%q) = %q, want error", c.hosts, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("oneAgentOpenURL(%q) error: %v", c.hosts, err)
			}
			if got != c.want {
				t.Fatalf("oneAgentOpenURL(%q) = %q, want %q", c.hosts, got, c.want)
			}
		})
	}
}
