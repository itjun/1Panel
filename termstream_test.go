package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type termStreamInputCall struct {
	sid  string
	data string
}

func termStreamURL(httpServer *httptest.Server, token, sid string) string {
	return strings.Replace(httpServer.URL, "http://", "ws://", 1) +
		"?t=" + url.QueryEscape(token) + "&sid=" + url.QueryEscape(sid)
}

func termStreamInputFrame(data string) []byte {
	return append([]byte{termStreamFrameInput}, []byte(data)...)
}

func TestTermStreamWebSocketIsolatedPerSession(t *testing.T) {
	server := newTermStreamServer()
	var mu sync.Mutex
	calls := make([]termStreamInputCall, 0, 2)
	gotCall := make(chan struct{}, 2)
	server.writeInput = func(sid string, data string) error {
		mu.Lock()
		calls = append(calls, termStreamInputCall{sid: sid, data: data})
		mu.Unlock()
		gotCall <- struct{}{}
		return nil
	}
	httpServer := httptest.NewServer(http.HandlerFunc(server.handleWS))
	defer httpServer.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	connA, _, err := websocket.Dial(ctx, termStreamURL(httpServer, server.token, "session-a"), nil)
	if err != nil {
		t.Fatalf("dial session-a websocket: %v", err)
	}
	defer connA.CloseNow()
	connB, _, err := websocket.Dial(ctx, termStreamURL(httpServer, server.token, "session-b"), nil)
	if err != nil {
		t.Fatalf("dial session-b websocket: %v", err)
	}
	defer connB.CloseNow()

	if err := connA.Write(ctx, websocket.MessageBinary, termStreamInputFrame("a1")); err != nil {
		t.Fatalf("write session-a input: %v", err)
	}
	if err := connB.Write(ctx, websocket.MessageBinary, termStreamInputFrame("b1")); err != nil {
		t.Fatalf("write session-b input: %v", err)
	}
	for range 2 {
		select {
		case <-gotCall:
		case <-ctx.Done():
			t.Fatalf("input was not delivered: %v", ctx.Err())
		}
	}

	mu.Lock()
	got := append([]termStreamInputCall(nil), calls...)
	mu.Unlock()
	if len(got) != 2 {
		t.Fatalf("got %d input calls, want 2: %#v", len(got), got)
	}
	seen := map[string]string{}
	for _, call := range got {
		seen[call.sid] = call.data
	}
	if seen["session-a"] != "a1" || seen["session-b"] != "b1" {
		t.Fatalf("input was routed to the wrong session: %#v", got)
	}

	if !server.pushTerminalEvent("data", "session-a", "pane-a", "a-out") {
		t.Fatal("session-a output was not accepted")
	}
	if !server.pushTerminalEvent("data", "session-b", "pane-b", "b-out") {
		t.Fatal("session-b output was not accepted")
	}

	typA, frameA, err := connA.Read(ctx)
	if err != nil {
		t.Fatalf("read session-a output: %v", err)
	}
	typB, frameB, err := connB.Read(ctx)
	if err != nil {
		t.Fatalf("read session-b output: %v", err)
	}
	if typA != websocket.MessageBinary || len(frameA) < 2 || frameA[0] != termStreamFrameData || string(frameA[1:]) != "a-out" {
		t.Fatalf("session-a received wrong output: type=%v frame=%q", typA, frameA)
	}
	if typB != websocket.MessageBinary || len(frameB) < 2 || frameB[0] != termStreamFrameData || string(frameB[1:]) != "b-out" {
		t.Fatalf("session-b received wrong output: type=%v frame=%q", typB, frameB)
	}
}

func TestTermStreamInputDoesNotBlockAnotherSession(t *testing.T) {
	server := newTermStreamServer()
	aStarted := make(chan struct{})
	releaseA := make(chan struct{})
	bDelivered := make(chan struct{})
	var onceA sync.Once
	server.writeInput = func(sid string, data string) error {
		if sid == "session-a" && data == "a1" {
			onceA.Do(func() { close(aStarted) })
			<-releaseA
		}
		if sid == "session-b" && data == "b1" {
			close(bDelivered)
		}
		return nil
	}
	httpServer := httptest.NewServer(http.HandlerFunc(server.handleWS))
	defer httpServer.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	connA, _, err := websocket.Dial(ctx, termStreamURL(httpServer, server.token, "session-a"), nil)
	if err != nil {
		t.Fatalf("dial session-a websocket: %v", err)
	}
	defer connA.CloseNow()
	connB, _, err := websocket.Dial(ctx, termStreamURL(httpServer, server.token, "session-b"), nil)
	if err != nil {
		t.Fatalf("dial session-b websocket: %v", err)
	}
	defer connB.CloseNow()

	if err := connA.Write(ctx, websocket.MessageBinary, termStreamInputFrame("a1")); err != nil {
		t.Fatalf("write session-a input: %v", err)
	}
	select {
	case <-aStarted:
	case <-ctx.Done():
		t.Fatalf("session-a input did not start: %v", ctx.Err())
	}
	if err := connB.Write(ctx, websocket.MessageBinary, termStreamInputFrame("b1")); err != nil {
		t.Fatalf("write session-b input: %v", err)
	}
	select {
	case <-bDelivered:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("session-b input was blocked by session-a")
	}
	close(releaseA)
}

func TestTermStreamSameSessionInputOrder(t *testing.T) {
	server := newTermStreamServer()
	var mu sync.Mutex
	var got []string
	delivered := make(chan struct{}, 3)
	server.writeInput = func(sid string, data string) error {
		if sid != "session-a" {
			t.Fatalf("input was routed to %q", sid)
		}
		mu.Lock()
		got = append(got, data)
		mu.Unlock()
		delivered <- struct{}{}
		return nil
	}
	httpServer := httptest.NewServer(http.HandlerFunc(server.handleWS))
	defer httpServer.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, termStreamURL(httpServer, server.token, "session-a"), nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.CloseNow()
	for _, data := range []string{"a1", "a2", "a3"} {
		if err := conn.Write(ctx, websocket.MessageBinary, termStreamInputFrame(data)); err != nil {
			t.Fatalf("write input %q: %v", data, err)
		}
	}
	for range 3 {
		select {
		case <-delivered:
		case <-ctx.Done():
			t.Fatalf("input was not delivered: %v", ctx.Err())
		}
	}
	mu.Lock()
	got = append([]string(nil), got...)
	mu.Unlock()
	if strings.Join(got, ",") != "a1,a2,a3" {
		t.Fatalf("same-session input order changed: %#v", got)
	}
}

func TestTermStreamRejectsMissingSessionID(t *testing.T) {
	server := newTermStreamServer()
	httpServer := httptest.NewServer(http.HandlerFunc(server.handleWS))
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	wsURL := strings.Replace(httpServer.URL, "http://", "ws://", 1) + "?t=" + url.QueryEscape(server.token)
	if _, _, err := websocket.Dial(ctx, wsURL, nil); err == nil {
		t.Fatal("websocket without sid unexpectedly connected")
	}
}
