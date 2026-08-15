package natsbus

import (
	"sync"
	"testing"
	"time"
)

func TestInMemoryBusPubSub(t *testing.T) {
	bus := NewInMemoryBus()
	defer bus.Close()

	var wg sync.WaitGroup
	wg.Add(2)

	receivedPeer := make(chan string, 1)
	receivedRoom := make(chan string, 1)

	// Subscribe to peer
	unsubPeer, err := bus.SubscribePeer("peer-123", func(data []byte) {
		receivedPeer <- string(data)
		wg.Done()
	})
	if err != nil {
		t.Fatalf("failed to subscribe peer: %v", err)
	}
	defer unsubPeer()

	// Subscribe to room
	unsubRoom, err := bus.SubscribeRoom("room-abc", func(data []byte) {
		receivedRoom <- string(data)
		wg.Done()
	})
	if err != nil {
		t.Fatalf("failed to subscribe room: %v", err)
	}
	defer unsubRoom()

	// Publish
	if err := bus.PublishPeer("peer-123", []byte("hello-peer")); err != nil {
		t.Errorf("publish peer failed: %v", err)
	}

	if err := bus.PublishRoom("room-abc", []byte("hello-room")); err != nil {
		t.Errorf("publish room failed: %v", err)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		if p := <-receivedPeer; p != "hello-peer" {
			t.Errorf("expected 'hello-peer', got '%s'", p)
		}
		if r := <-receivedRoom; r != "hello-room" {
			t.Errorf("expected 'hello-room', got '%s'", r)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for in-memory bus messages")
	}
}
