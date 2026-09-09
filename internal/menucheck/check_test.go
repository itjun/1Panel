package menucheck

import (
	"strings"
	"testing"
)

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
	if !strings.Contains(r.MenuText, "菜单异常") || !strings.Contains(r.DataText, "数据异常") {
		t.Fatalf("want two-item texts, got menu=%q data=%q", r.MenuText, r.DataText)
	}
	r = Check("not-a-url")
	if r.OK {
		t.Fatalf("%+v", r)
	}
}

func TestFinishTwoItems(t *testing.T) {
	r := finish(true, false, "菜单正常", "数据异常：暂无人员上报数据", "t")
	if !r.OK || r.HasData {
		t.Fatalf("%+v", r)
	}
	if r.MenuText != "菜单正常" || !strings.Contains(r.DataText, "暂无") {
		t.Fatalf("%+v", r)
	}
	if !strings.Contains(r.Message, "\n") {
		t.Fatalf("message should join two lines: %q", r.Message)
	}
}
