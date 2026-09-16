package aptsource

import "testing"

func TestParseOSReleaseUbuntu(t *testing.T) {
	d := parseOSRelease("NAME=\"Ubuntu\"\nID=ubuntu\nVERSION_ID=\"24.04\"\nVERSION_CODENAME=noble\n")
	if !d.Apt || d.ID != "ubuntu" || d.Codename != "noble" {
		t.Fatalf("%+v", d)
	}
}

func TestParseOSReleaseDebian(t *testing.T) {
	d := parseOSRelease("ID=debian\nVERSION_CODENAME=bookworm\nNAME=\"Debian GNU/Linux\"\n")
	if !d.Apt || d.Codename != "bookworm" {
		t.Fatalf("%+v", d)
	}
}

func TestParseOSReleaseAlpine(t *testing.T) {
	d := parseOSRelease("ID=alpine\nNAME=Alpine\n")
	if d.Apt {
		t.Fatalf("alpine should not be apt: %+v", d)
	}
}
