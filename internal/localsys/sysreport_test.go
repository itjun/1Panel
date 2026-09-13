//go:build darwin

package localsys

import "testing"

func TestCollectSystemReport(t *testing.T) {
	rep, err := CollectSystemReport(true)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Sections) < 3 {
		t.Fatalf("sections=%d", len(rep.Sections))
	}
	for _, s := range rep.Sections {
		t.Logf("%s (%s) items=%d first=%v", s.Title, s.ID, len(s.Items), itemPreview(s))
	}
}

func itemPreview(s ReportSection) string {
	if len(s.Items) == 0 {
		return ""
	}
	it := s.Items[0]
	if len(it.Rows) == 0 {
		return it.Name
	}
	return it.Name + " / " + it.Rows[0].Label + "=" + it.Rows[0].Value
}
