package monitor

import "testing"

func TestParseDepends(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want []string
	}{
		{"", nil},
		{"libc6 (>= 2.34), libssl3 (>= 3.0.0), zlib1g", []string{"libc6", "libssl3", "zlib1g"}},
		{"libpython3.10 (>= 3.10), libpython3.10:amd64 | libpython3.11", []string{"libpython3.10", "libpython3.10"}},
	}
	for _, tc := range cases {
		got := parseDepends(tc.in)
		if len(got) != len(tc.want) {
			t.Fatalf("parseDepends(%q) = %v, want %v", tc.in, got, tc.want)
		}
		for i := range tc.want {
			if got[i] != tc.want[i] {
				t.Fatalf("parseDepends(%q)[%d] = %q, want %q", tc.in, i, got[i], tc.want[i])
			}
		}
	}
}

func TestParsePackages(t *testing.T) {
	t.Parallel()
	raw := "apt\t2.4.13\tlibc6 (>= 2.34), libssl3\nadduser\t3.118ubuntu5\t\n"
	pkgs := parsePackages(raw)
	if len(pkgs) != 2 {
		t.Fatalf("len = %d", len(pkgs))
	}
	if pkgs[0].Name != "apt" || pkgs[0].Depends != 2 || len(pkgs[0].DepList) != 2 {
		t.Fatalf("apt: %+v", pkgs[0])
	}
	if pkgs[1].Depends != 0 || pkgs[1].DepList != nil {
		t.Fatalf("adduser: %+v", pkgs[1])
	}
}

func TestIsValidDebPackageName(t *testing.T) {
	t.Parallel()
	if !isValidDebPackageName("apt-utils") {
		t.Fatal("apt-utils should be valid")
	}
	if isValidDebPackageName("bad name") {
		t.Fatal("space should be invalid")
	}
}
