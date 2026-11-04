package app

import (
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"diteng-pannel/internal/updater"
)

func TestLocalBuildUpdateCheck(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	data := []byte(`{"version":"v1.3.28","minSupportedVersion":"v1.3.26","notes":"更新说明"}`)
	sig := updater.Sign(priv, data)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latest.json":
			_, _ = w.Write(data)
		case "/latest.json.sig":
			_, _ = w.Write(sig)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	cases := []struct {
		name        string
		current     string
		manual      bool
		poke        bool
		autoCheck   bool
		skipped     string
		remindAfter time.Time
		hasUpdate   bool
		mandatory   bool
		prompt      bool
	}{
		{name: "自动发现新版本", current: "v1.3.27-1-g4766b4a", autoCheck: true, hasUpdate: true, prompt: true},
		{name: "恢复窗口后检查", current: "v1.3.27-1-g4766b4a", poke: true, autoCheck: true, hasUpdate: true, prompt: true},
		{name: "同版本不更新", current: "v1.3.28-1-g4766b4a", autoCheck: true},
		{name: "较新版本不降级", current: "v1.3.29-1-g4766b4a", autoCheck: true},
		{name: "未提交修改也检查", current: "v1.3.27-dirty", autoCheck: true, hasUpdate: true, prompt: true},
		{name: "关闭自动提醒", current: "v1.3.27-1-g4766b4a", hasUpdate: true},
		{name: "已跳过版本", current: "v1.3.27-1-g4766b4a", autoCheck: true, skipped: "v1.3.28", hasUpdate: true},
		{name: "稍后提醒", current: "v1.3.27-1-g4766b4a", autoCheck: true, remindAfter: time.Now().Add(time.Hour), hasUpdate: true},
		{name: "手动检查仍返回新版本", current: "v1.3.27-1-g4766b4a", manual: true, skipped: "v1.3.28", hasUpdate: true},
		{name: "低于最低支持版本", current: "v1.3.25-1-g4766b4a", skipped: "v1.3.28", hasUpdate: true, mandatory: true, prompt: true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			base, isDev, isOK := updater.ParseCurrent(tt.current)
			if !isOK {
				t.Fatalf("本地版本无法比较：%s", tt.current)
			}
			c := &updateController{
				app: &App{}, client: &updater.Client{BaseURL: srv.URL, PublicKey: pub, Dir: t.TempDir()},
				current: base, started: true,
				prefs: updatePrefs{AutoCheck: tt.autoCheck, SkippedVersion: tt.skipped, RemindVersion: "v1.3.28", RemindAfter: tt.remindAfter},
				state: UpdateState{Enabled: true, Current: tt.current, DevBuild: isDev, Status: updateIdle},
			}
			if tt.poke {
				c.poke()
				deadline := time.Now().Add(3 * time.Second)
				for c.snapshot().LastChecked == "" && time.Now().Before(deadline) {
					time.Sleep(time.Millisecond)
				}
			} else if _, err := c.check(tt.manual); err != nil {
				t.Fatal(err)
			}
			st := c.snapshot()
			if st.LastChecked == "" || st.Latest != "v1.3.28" || st.Current != tt.current || st.Status != updateIdle ||
				st.HasUpdate != tt.hasUpdate || st.Mandatory != tt.mandatory || st.Prompt != tt.prompt {
				t.Fatalf("本地构建检查结果不符：%+v", st)
			}
		})
	}
}
