package hub

import (
	"testing"
	"time"
)

func TestHubRoomLifecycle(t *testing.T) {
	h := New(nil)

	room1 := h.GetOrCreateRoom("room-1")
	if room1 == nil {
		t.Fatal("expected room-1 to be created")
	}

	if room1.ID != "room-1" {
		t.Errorf("expected room ID 'room-1', got '%s'", room1.ID)
	}

	// Fetch again, should return the exact same instance
	room1Again := h.GetOrCreateRoom("room-1")
	if room1Again != room1 {
		t.Error("expected GetOrCreateRoom to return existing instance")
	}

	if h.RoomCount() != 1 {
		t.Errorf("expected 1 room, got %d", h.RoomCount())
	}
}

func TestRoomPeerManagement(t *testing.T) {
	room := NewRoom("test-room")

	p1 := &Peer{
		ID:       "peer-1",
		Nickname: "Alice",
		RoomID:   "test-room",
		JoinedAt: time.Now(),
	}

	p2 := &Peer{
		ID:       "peer-2",
		Nickname: "Bob",
		RoomID:   "test-room",
		JoinedAt: time.Now(),
	}

	room.AddPeer(p1)
	if room.PeerCount() != 1 {
		t.Errorf("expected 1 peer, got %d", room.PeerCount())
	}

	room.AddPeer(p2)
	if room.PeerCount() != 2 {
		t.Errorf("expected 2 peers, got %d", room.PeerCount())
	}

	roster := room.BuildRoster("peer-1")
	if len(roster.Peers) != 2 {
		t.Errorf("expected roster to have 2 peers, got %d", len(roster.Peers))
	}
	if len(roster.Leaders) < 1 {
		t.Errorf("expected at least 1 leader, got %d", len(roster.Leaders))
	}

	room.RemovePeer("peer-2")
	if room.PeerCount() != 1 {
		t.Errorf("expected 1 peer after removal, got %d", room.PeerCount())
	}
}
