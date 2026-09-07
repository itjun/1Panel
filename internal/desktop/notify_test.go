package desktop

import "testing"

func TestNotifyNoopWithoutService(t *testing.T) {
	SetService(nil)
	SetAuthorized(false)
	if err := Notify(Payload{Title: "t", Body: "b"}); err != nil {
		t.Fatalf("未授权时应静默成功, got %v", err)
	}
}
