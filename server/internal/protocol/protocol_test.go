package protocol

import (
	"encoding/json"
	"testing"
)

func TestEnvelopeSerialization(t *testing.T) {
	join := JoinPayload{
		PeerID:   "peer-123",
		Nickname: "AlexCoder",
	}

	payloadBytes, err := json.Marshal(join)
	if err != nil {
		t.Fatalf("failed to marshal join payload: %v", err)
	}

	env := Envelope{
		Type:    MsgRoomJoin,
		From:    "peer-123",
		RoomID:  "room:leetcode:two-sum",
		Payload: payloadBytes,
	}

	wireBytes, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("failed to marshal envelope: %v", err)
	}

	var parsedEnv Envelope
	if err := json.Unmarshal(wireBytes, &parsedEnv); err != nil {
		t.Fatalf("failed to unmarshal envelope: %v", err)
	}

	if parsedEnv.Type != MsgRoomJoin {
		t.Errorf("expected type %s, got %s", MsgRoomJoin, parsedEnv.Type)
	}
	if parsedEnv.From != "peer-123" {
		t.Errorf("expected from 'peer-123', got '%s'", parsedEnv.From)
	}
	if parsedEnv.RoomID != "room:leetcode:two-sum" {
		t.Errorf("expected roomId 'room:leetcode:two-sum', got '%s'", parsedEnv.RoomID)
	}

	var parsedJoin JoinPayload
	if err := json.Unmarshal(parsedEnv.Payload, &parsedJoin); err != nil {
		t.Fatalf("failed to unmarshal join payload: %v", err)
	}
	if parsedJoin.Nickname != "AlexCoder" {
		t.Errorf("expected nickname 'AlexCoder', got '%s'", parsedJoin.Nickname)
	}
}

func TestRosterPayload(t *testing.T) {
	roster := RosterPayload{
		Peers: []RosterEntry{
			{PeerID: "peer-1", Nickname: "Alice", IsLeader: true},
			{PeerID: "peer-2", Nickname: "Bob", IsLeader: false},
		},
		Leaders:    []string{"peer-1"},
		YourLeader: "peer-1",
	}

	bytes, err := json.Marshal(roster)
	if err != nil {
		t.Fatalf("failed to marshal roster: %v", err)
	}

	var parsed RosterPayload
	if err := json.Unmarshal(bytes, &parsed); err != nil {
		t.Fatalf("failed to unmarshal roster: %v", err)
	}

	if len(parsed.Peers) != 2 {
		t.Fatalf("expected 2 peers, got %d", len(parsed.Peers))
	}
	if parsed.Leaders[0] != "peer-1" {
		t.Errorf("expected leader 'peer-1', got '%s'", parsed.Leaders[0])
	}
}
