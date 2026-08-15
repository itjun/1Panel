package monitor

import "testing"

func TestParseOSReleaseText(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "pretty name wins",
			in:   "NAME=\"Ubuntu\"\nPRETTY_NAME=\"Ubuntu 22.04.5 LTS\"\n",
			want: "Ubuntu 22.04.5 LTS",
		},
		{
			name: "name fallback",
			in:   "NAME=\"Debian GNU/Linux\"\n",
			want: "Debian GNU/Linux",
		},
		{
			name: "ignores kernel line from overview",
			in:   "6.8.0-60-generic\nPRETTY_NAME=\"Ubuntu 24.04.2 LTS\"\nNAME=\"Ubuntu\"",
			want: "Ubuntu 24.04.2 LTS",
		},
		{
			name: "empty",
			in:   "",
			want: "",
		},
		{
			name: "unquoted",
			in:   "PRETTY_NAME=Alpine Linux v3.20",
			want: "Alpine Linux v3.20",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseOSReleaseText(tc.in)
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}
