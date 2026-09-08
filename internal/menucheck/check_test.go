package menucheck

import "testing"

func TestCheckEmptyMarkers(t *testing.T) {
	html := `<html><head><title>每日上游进销存(1665)</title></head><body>
数据上报信息
暂无人员上报数据
</body></html>`
	// 不走网络：直接测判定辅助逻辑
	if !looksLikeLoginOrExpired(`<title>登录</title>`, "登录") {
		t.Fatal("login title should be expired")
	}
	if looksLikeLoginOrExpired(html, "每日上游进销存(1665)") {
		t.Fatal("data page should not look like login")
	}
	if extractTitle(html) != "每日上游进销存(1665)" {
		t.Fatalf("title=%q", extractTitle(html))
	}
}

func TestCheckInvalidURL(t *testing.T) {
	r := Check("")
	if r.OK || r.HasData {
		t.Fatalf("%+v", r)
	}
	r = Check("not-a-url")
	if r.OK {
		t.Fatalf("%+v", r)
	}
}
