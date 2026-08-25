package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func notifyWecom(webhook, text string) error {
	if webhook == "" {
		return nil
	}
	url := webhook
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		url = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=" + strings.TrimSpace(url)
	}
	body, err := json.Marshal(map[string]any{
		"msgtype": "text",
		"text":    map[string]string{"content": text},
	})
	if err != nil {
		return err
	}
	cli := &http.Client{Timeout: 8 * time.Second}
	resp, err := cli.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("企微 HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var wr struct {
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	if json.Unmarshal(raw, &wr) == nil && wr.ErrCode != 0 {
		return fmt.Errorf("企微 errcode=%d %s", wr.ErrCode, wr.ErrMsg)
	}
	return nil
}
