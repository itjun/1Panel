package desktop

import (
	"os/exec"
	"runtime"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

var (
	notifyMu   sync.RWMutex
	notifySvc  *notifications.NotificationService
	authorized bool
)

// Payload 本机系统通知内容；Host/EventID/Kind 写入 Data，供点击回调使用。
type Payload struct {
	Title   string
	Body    string
	Host    string
	EventID string
	Kind    string
}

// SetService 注入 Wails 通知服务（启动时调用一次）。
func SetService(ns *notifications.NotificationService) {
	notifyMu.Lock()
	notifySvc = ns
	notifyMu.Unlock()
}

// SetAuthorized 标记系统通知授权结果；未授权时 Notify 静默空操作（不回退 osascript）。
func SetAuthorized(ok bool) {
	notifyMu.Lock()
	authorized = ok
	notifyMu.Unlock()
}

// Notify 通过 Wails 原生通知中心发送；未授权或服务未就绪时直接返回 nil。
func Notify(p Payload) error {
	p.Title = strings.TrimSpace(p.Title)
	p.Body = strings.TrimSpace(p.Body)
	if p.Title == "" && p.Body == "" {
		return nil
	}
	if p.Title == "" {
		p.Title = "1Panel"
	}

	notifyMu.RLock()
	svc := notifySvc
	ok := authorized
	notifyMu.RUnlock()

	playAlertSound()

	if !ok || svc == nil {
		return nil
	}

	id := strings.TrimSpace(p.EventID)
	if id == "" {
		id = uuid.NewString()
	}
	data := map[string]interface{}{}
	if h := strings.TrimSpace(p.Host); h != "" {
		data["host"] = h
	}
	if id != "" {
		data["eventId"] = id
	}
	if k := strings.TrimSpace(p.Kind); k != "" {
		data["kind"] = k
	}

	return svc.SendNotification(notifications.NotificationOptions{
		ID:    id,
		Title: p.Title,
		Body:  p.Body,
		Data:  data,
	})
}

func playAlertSound() {
	if runtime.GOOS != "darwin" {
		return
	}
	go func() {
		_ = exec.Command("afplay", "/System/Library/Sounds/Purr.aiff").Run()
	}()
}
