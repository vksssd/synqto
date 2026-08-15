package hub

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/nerdbuddy/server/internal/protocol"
)

// Hub is the central coordinator for all rooms and peers.
type Hub struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

// New creates a new Hub and starts the room garbage collector.
func New() *Hub {
	h := &Hub{
		rooms: make(map[string]*Room),
	}
	go h.gcLoop()
	return h
}

// GetOrCreateRoom returns the room for the given ID, creating it if necessary.
func (h *Hub) GetOrCreateRoom(roomID string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[roomID]
	if !ok {
		room = NewRoom(roomID)
		h.rooms[roomID] = room
		slog.Info("created room", "roomId", roomID)
	}
	return room
}

// Register adds a peer to their room.
func (h *Hub) Register(p *Peer) {
	room := h.GetOrCreateRoom(p.RoomID)
	room.AddPeer(p)
	room.BroadcastRoster()

	slog.Info("peer registered",
		"peer", p.ID,
		"room", p.RoomID,
		"peerCount", room.PeerCount(),
	)
}

// Unregister removes a peer from their room.
func (h *Hub) Unregister(p *Peer) {
	h.mu.RLock()
	room, ok := h.rooms[p.RoomID]
	h.mu.RUnlock()

	if !ok {
		return
	}

	room.RemovePeer(p.ID)

	if room.IsEmpty() {
		h.mu.Lock()
		delete(h.rooms, p.RoomID)
		h.mu.Unlock()
		slog.Info("room destroyed (empty)", "roomId", p.RoomID)
	} else {
		room.BroadcastRoster()
	}

	slog.Info("peer unregistered", "peer", p.ID, "room", p.RoomID)
}

// HandleMessage dispatches an incoming message from a peer.
func (h *Hub) HandleMessage(sender *Peer, env *protocol.Envelope) {
	switch env.Type {
	case protocol.MsgSignalOffer, protocol.MsgSignalAnswer, protocol.MsgSignalICE:
		h.relaySignal(sender, env)

	case protocol.MsgRoomJoin:
		// Already handled during WebSocket upgrade — ignore duplicate.
		slog.Debug("ignoring duplicate room:join", "peer", sender.ID)

	case protocol.MsgRoomLeave:
		h.Unregister(sender)

	case protocol.MsgPing:
		sender.SendJSON(&protocol.Envelope{
			Type:   protocol.MsgPong,
			From:   "server",
			RoomID: sender.RoomID,
		})

	default:
		slog.Warn("unknown message type", "type", env.Type, "peer", sender.ID)
	}
}

// relaySignal forwards a signaling message (offer/answer/ice) to the target peer.
func (h *Hub) relaySignal(sender *Peer, env *protocol.Envelope) {
	if env.To == "" {
		slog.Warn("signal message missing 'to' field", "type", env.Type, "peer", sender.ID)
		return
	}

	h.mu.RLock()
	room, ok := h.rooms[sender.RoomID]
	h.mu.RUnlock()

	if !ok {
		slog.Warn("signal for unknown room", "room", sender.RoomID, "peer", sender.ID)
		return
	}

	target := room.GetPeer(env.To)
	if target == nil {
		slog.Warn("signal target not found",
			"target", env.To,
			"from", sender.ID,
			"room", sender.RoomID,
		)
		return
	}

	// Forward with the sender's ID stamped.
	env.From = sender.ID
	target.SendJSON(env)

	slog.Debug("relayed signal",
		"type", env.Type,
		"from", sender.ID,
		"to", env.To,
		"room", sender.RoomID,
	)
}

// RoomStats returns a snapshot of all rooms for diagnostics.
func (h *Hub) RoomStats() []RoomInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()

	stats := make([]RoomInfo, 0, len(h.rooms))
	for id, room := range h.rooms {
		stats = append(stats, RoomInfo{
			ID:        id,
			PeerCount: room.PeerCount(),
		})
	}
	return stats
}

// RoomInfo is a diagnostic snapshot of a room.
type RoomInfo struct {
	ID        string `json:"id"`
	PeerCount int    `json:"peerCount"`
}

// ServeStats writes a JSON stats response (used by the /stats endpoint).
func (h *Hub) ServeStats() ([]byte, error) {
	stats := h.RoomStats()
	return json.Marshal(map[string]any{
		"rooms":     stats,
		"roomCount": len(stats),
	})
}

// gcLoop periodically removes empty rooms.
func (h *Hub) gcLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		h.mu.Lock()
		for id, room := range h.rooms {
			if room.IsEmpty() {
				delete(h.rooms, id)
				slog.Debug("gc: removed empty room", "roomId", id)
			}
		}
		h.mu.Unlock()
	}
}
