package agentres

import "testing"

func TestBumpPatch(t *testing.T) {
	got, err := bumpPatch("0.2.0")
	if err != nil || got != "0.2.1" {
		t.Fatalf("got %q err %v", got, err)
	}
}

func TestAgentSourceStampMatches(t *testing.T) {
	root, err := ModuleRoot("")
	if err != nil {
		t.Fatal(err)
	}
	hash, err := HashAgentSources(root)
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := ReadSourceStamp(root)
	if err != nil {
		t.Fatal(err)
	}
	if got == "" {
		t.Fatal("缺少 internal/agentres/SOURCE.sha256：请运行 task agent:build")
	}
	if got != hash {
		t.Fatalf("spanel-agent 源码已改但未升级版本。请运行 task agent:build（会自动升补丁号并刷新 SOURCE.sha256）")
	}
}
