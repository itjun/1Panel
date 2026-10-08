package menucheck

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCheckSendsMethodQueryHeadersBody(t *testing.T) {
	var gotMethod, gotQuery, gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotQuery = r.URL.RawQuery
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`<title>OK页</title>{"code":0}`))
	}))
	defer srv.Close()

	r := Check(Item{
		Method: "post",
		URL:    srv.URL + "/api?a=1",
		Query: []KV{
			{Key: "b", Value: "2", Enabled: true},
			{Key: "skip", Value: "x", Enabled: false},
		},
		Headers:     []KV{{Key: "Authorization", Value: "Bearer t", Enabled: true}},
		Body:        `{"x":1}`,
		MustContain: []string{`"code":0`},
	})
	if !r.Passed() {
		t.Fatalf("want pass, got %+v", r)
	}
	if gotMethod != "POST" || gotQuery != "a=1&b=2" || gotAuth != "Bearer t" || gotBody != `{"x":1}` {
		t.Fatalf("method=%q query=%q auth=%q body=%q", gotMethod, gotQuery, gotAuth, gotBody)
	}
	if r.StatusCode != 200 || r.Title != "OK页" || !strings.Contains(r.BodyPreview, "code") {
		t.Fatalf("%+v", r)
	}
}

func TestCheckStatusAssertion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	r := Check(Item{URL: srv.URL})
	if r.OK || r.HasData || !strings.Contains(r.MenuText, "HTTP 500") {
		t.Fatalf("default expect should fail on 500: %+v", r)
	}
	r = Check(Item{URL: srv.URL, ExpectStatus: "5xx"})
	if !r.Passed() {
		t.Fatalf("5xx should pass: %+v", r)
	}
	r = Check(Item{URL: srv.URL, ExpectStatus: "200,204"})
	if r.OK {
		t.Fatalf("200,204 should fail on 500: %+v", r)
	}
}

func TestCheckContentAssertions(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("数据上报信息 暂无人员上报数据"))
	}))
	defer srv.Close()

	r := Check(Item{URL: srv.URL, MustContain: []string{"数据上报信息"}, MustNotContain: []string{"暂无人员上报数据"}})
	if !r.OK || r.HasData || !strings.Contains(r.DataText, "包含了") {
		t.Fatalf("mustNot should fail content: %+v", r)
	}
	r = Check(Item{URL: srv.URL, MustContain: []string{"不存在的文本"}})
	if !r.OK || r.HasData || !strings.Contains(r.DataText, "未包含") {
		t.Fatalf("must should fail content: %+v", r)
	}
	r = Check(Item{URL: srv.URL})
	if !r.Passed() || !strings.Contains(r.DataText, "未配置") {
		t.Fatalf("no assertions should pass: %+v", r)
	}
}

func TestCheckInvalidURL(t *testing.T) {
	for _, u := range []string{"", "not-a-url", "ftp://x"} {
		r := Check(Item{URL: u})
		if r.OK || r.HasData || !strings.Contains(r.Message, "\n") {
			t.Fatalf("%q: %+v", u, r)
		}
	}
}

func TestParseExpectStatus(t *testing.T) {
	if _, err := parseExpectStatus("abc"); err == nil {
		t.Fatal("abc should be invalid")
	}
	rules, err := parseExpectStatus("200, 3xx")
	if err != nil {
		t.Fatal(err)
	}
	if !statusMatches(200, rules) || !statusMatches(302, rules) || statusMatches(404, rules) {
		t.Fatalf("rules=%+v", rules)
	}
}
