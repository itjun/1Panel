package app

import "testing"

func TestSaveDialogInitialName(t *testing.T) {
	cases := []struct {
		in  string
		out string
	}{
		{"nginx-logs-20261021-110405.tar.zst", "nginx-logs-20261021-110405.tar.zst"},
		{"/home/user/Downloads/nginx-logs-20261021-110405.tar.zst", "nginx-logs-20261021-110405.tar.zst"},
		{"", ""},
		{".", ""},
		{"..", ""},
	}
	for _, tc := range cases {
		got := saveDialogInitialName(tc.in)
		if got != tc.out {
			t.Fatalf("saveDialogInitialName(%q)=%q, want %q", tc.in, got, tc.out)
		}
	}
}
