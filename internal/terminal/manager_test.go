package terminal

import (
	"bytes"
	"context"
	"io"
	"sync"
	"testing"
	"time"
)

type gatedReader struct {
	first    []byte
	returned bool
	release  <-chan struct{}
}

func (r *gatedReader) Read(p []byte) (int, error) {
	if !r.returned {
		r.returned = true
		return copy(p, r.first), nil
	}
	<-r.release
	return 0, io.EOF
}

func TestPumpToEventSendsInteractiveChunkWithoutCoalesceDelay(t *testing.T) {
	release := make(chan struct{})
	sent := make(chan []byte, 1)
	reader := &gatedReader{first: []byte("echo"), release: release}

	done := make(chan struct{})
	go func() {
		pumpToEvent(context.Background(), reader, func(data []byte) {
			copyOfData := append([]byte(nil), data...)
			sent <- copyOfData
		})
		close(done)
	}()

	select {
	case got := <-sent:
		if string(got) != "echo" {
			t.Fatalf("got first output %q, want %q", got, "echo")
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("interactive output waited for the coalesce window")
	}

	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("pumpToEvent did not stop after reader EOF")
	}
}

func TestPumpToEventPreservesOutputAcrossChunksAndEOF(t *testing.T) {
	reader := bytes.NewBufferString("first\x1b[31msecond\x1b[0m\n")
	var mu sync.Mutex
	var got []byte

	pumpToEvent(context.Background(), reader, func(data []byte) {
		mu.Lock()
		got = append(got, data...)
		mu.Unlock()
	})

	mu.Lock()
	defer mu.Unlock()
	if string(got) != "first\x1b[31msecond\x1b[0m\n" {
		t.Fatalf("output changed while batching: %q", got)
	}
}

func BenchmarkPumpToEvent(b *testing.B) {
	payload := bytes.Repeat([]byte("line with ansi \x1b[32moutput\x1b[0m\n"), 1024)
	b.SetBytes(int64(len(payload)))
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		var received int
		pumpToEvent(context.Background(), bytes.NewReader(payload), func(data []byte) {
			received += len(data)
		})
		if received != len(payload) {
			b.Fatalf("received %d bytes, want %d", received, len(payload))
		}
	}
}
