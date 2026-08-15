package protocol

import "encoding/json"

// MessageType enumerates all signaling protocol message types.
type MessageType string

const (
	MsgRoomJoin      MessageType = "room:join"
	MsgRoomLeave     MessageType = "room:leave"
	MsgRoomRoster    MessageType = "room:roster"
	MsgSignalOffer   MessageType = "signal:offer"
	MsgSignalAnswer  MessageType = "signal:answer"
	MsgSignalICE     MessageType = "signal:ice"
	MsgLeaderPromote MessageType = "leader:promote"
	MsgLeaderDemote  MessageType = "leader:demote"
	MsgPing          MessageType = "ping"
	MsgPong          MessageType = "pong"
)

// Envelope is the top-level wire format for all messages exchanged over WebSocket.
type Envelope struct {
	Type    MessageType     `json:"type"`
	From    string          `json:"from"`
	To      string          `json:"to,omitempty"`
	RoomID  string          `json:"roomId"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// JoinPayload is sent by the client when joining a room.
type JoinPayload struct {
	PeerID   string `json:"peerId"`
	Nickname string `json:"nickname"`
}

// RosterEntry represents a single peer in a room roster broadcast.
type RosterEntry struct {
	PeerID   string `json:"peerId"`
	Nickname string `json:"nickname"`
	IsLeader bool   `json:"isLeader"`
}

// RosterPayload is broadcast by the server whenever the room membership changes.
type RosterPayload struct {
	Peers      []RosterEntry `json:"peers"`
	Leaders    []string      `json:"leaders"`
	YourLeader string        `json:"yourLeader"`
}

// PromotePayload is sent to a peer being promoted to leader.
type PromotePayload struct {
	ClusterPeers    []string `json:"clusterPeers"`
	BackboneLeaders []string `json:"backboneLeaders"`
}

// DemotePayload is sent to a peer being demoted from leader.
type DemotePayload struct {
	NewLeader string `json:"newLeader"`
}

// SignalPayload carries SDP or ICE candidate data for WebRTC negotiation.
type SignalPayload struct {
	SDP       json.RawMessage `json:"sdp,omitempty"`
	Candidate json.RawMessage `json:"candidate,omitempty"`
}
