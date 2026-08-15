package hub

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/nerdbuddy/server/internal/natsbus"
	"github.com/nerdbuddy/server/internal/protocol"
)

// Hub is the central coordinator for all rooms and peers.
type Hub struct {
	mu       sync.RWMutex
	rooms    map[string]*Room
	bus      natsbus.MessageBus
	peerSubs map[string]natsbus.Unsubscriber
	roomSubs map[string]natsbus.Unsubscriber
}

// New creates a new Hub and starts the room garbage collector.
func New(bus natsbus.MessageBus) *Hub {
	if bus == nil {
		bus = natsbus.New("")
	}

	h := &Hub{
		rooms:    make(map[string]*Room),
		bus:      bus,
		peerSubs: make(map[string]natsbus.Unsubscriber),
		roomSubs: make(map[string]natsbus.Unsubscriber),
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

		// Subscribe room on distributed message bus
		sub, err := h.bus.SubscribeRoom(roomID, func(data []byte) {
			var env protocol.Envelope
			if err := json.Unmarshal(data, &env); err == nil {
				h.mu.RLock()
				r, exists := h.rooms[roomID]
				h.mu.RUnlock()
				if exists {
					r.BroadcastDirect(&env)
				}
			}
		})
		if err == nil {
			h.roomSubs[roomID] = sub
		}
	}
	return room
}

// RoomCount returns the current count of active rooms.
func (h *Hub) RoomCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms)
}

// Register adds a peer to their room and subscribes to their NATS subject.
func (h *Hub) Register(p *Peer) {
	room := h.GetOrCreateRoom(p.RoomID)
	room.AddPeer(p)
	room.BroadcastRoster()

	// Subscribe peer to distributed message bus for direct cross-server signaling
	sub, err := h.bus.SubscribePeer(p.ID, func(data []byte) {
		var env protocol.Envelope
		if err := json.Unmarshal(data, &env); err == nil {
			p.SendJSON(&env)
		}
	})
	if err == nil {
		h.mu.Lock()
		h.peerSubs[p.ID] = sub
		h.mu.Unlock()
	}

	slog.Info("peer registered",
		"peer", p.ID,
		"room", p.RoomID,
		"peerCount", room.PeerCount(),
	)
}

// Unregister removes a peer from their room and unsubscribes from the bus.
func (h *Hub) Unregister(p *Peer) {
	h.mu.Lock()
	if sub, ok := h.peerSubs[p.ID]; ok {
		sub()
		delete(h.peerSubs, p.ID)
	}
	h.mu.Unlock()

	h.mu.RLock()
	room, ok := h.rooms[p.RoomID]
	h.mu.RUnlock()

	if !ok {
		return
	}

	room.RemovePeer(p.ID)

	if room.IsEmpty() {
		h.mu.Lock()
		if rSub, ok := h.roomSubs[p.RoomID]; ok {
			rSub()
			delete(h.roomSubs, p.RoomID)
		}
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

	env.From = sender.ID

	h.mu.RLock()
	room, ok := h.rooms[sender.RoomID]
	h.mu.RUnlock()

	if !ok {
		slog.Warn("signal for unknown room", "room", sender.RoomID, "peer", sender.ID)
		return
	}

	// 1. If target is connected locally on this server node, deliver directly
	target := room.GetPeer(env.To)
	if target != nil {
		target.SendJSON(env)
		slog.Debug("relayed signal locally", "type", env.Type, "from", sender.ID, "to", env.To)
		return
	}

	// 2. Otherwise forward across NATS distributed message bus to other server instances
	data, err := json.Marshal(env)
	if err == nil {
		if err := h.bus.PublishPeer(env.To, data); err == nil {
			slog.Debug("relayed signal via NATS bus", "type", env.Type, "from", sender.ID, "to", env.To)
			return
		}
	}

	slog.Warn("signal target not found on any cluster node",
		"target", env.To,
		"from", sender.ID,
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
				if rSub, ok := h.roomSubs[id]; ok {
					rSub()
					delete(h.roomSubs, id)
				}
				delete(h.rooms, id)
				slog.Info("garbage collected empty room", "roomId", id)
			}
		}
		h.mu.Unlock()
	}
}
