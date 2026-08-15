package hub

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nerdbuddy/server/internal/protocol"
)

const (
	// writeWait is the max time to wait for a write to complete.
	writeWait = 10 * time.Second

	// pongWait is the max time to wait for a pong from the client.
	pongWait = 30 * time.Second

	// pingPeriod sends pings at this interval (must be < pongWait).
	pingPeriod = 25 * time.Second

	// maxMessageSize is the max allowed incoming message size.
	maxMessageSize = 64 * 1024 // 64KB
)

// Peer represents a single connected WebSocket client.
type Peer struct {
	ID             string
	Nickname       string
	RoomID         string
	IsLeader       bool
	JoinedAt       time.Time
	PromotedAt     time.Time
	ReconnectCount int

	hub  *Hub
	conn *websocket.Conn
	send chan []byte

	mu     sync.Mutex
	closed bool
}

// NewPeer creates a new Peer wrapping the given WebSocket connection.
func NewPeer(id, nickname, roomID string, conn *websocket.Conn, h *Hub) *Peer {
	return &Peer{
		ID:       id,
		Nickname: nickname,
		RoomID:   roomID,
		JoinedAt: time.Now(),
		hub:      h,
		conn:     conn,
		send:     make(chan []byte, 256),
	}
}

// SendJSON marshals and enqueues a message for delivery to this peer.
func (p *Peer) SendJSON(msg *protocol.Envelope) {
	data, err := json.Marshal(msg)
	if err != nil {
		slog.Error("failed to marshal message", "peer", p.ID, "error", err)
		return
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}

	select {
	case p.send <- data:
	default:
		slog.Warn("send buffer full, dropping message", "peer", p.ID)
	}
}

// ReadPump reads messages from the WebSocket and dispatches them.
// Must be run in its own goroutine.
func (p *Peer) ReadPump() {
	defer func() {
		p.hub.Unregister(p)
		p.Close()
	}()

	p.conn.SetReadLimit(maxMessageSize)
	p.conn.SetReadDeadline(time.Now().Add(pongWait))
	p.conn.SetPongHandler(func(string) error {
		p.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := p.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				slog.Warn("unexpected close", "peer", p.ID, "error", err)
			}
			return
		}

		var env protocol.Envelope
		if err := json.Unmarshal(message, &env); err != nil {
			slog.Warn("invalid message format", "peer", p.ID, "error", err)
			continue
		}
		env.From = p.ID // always overwrite From with authenticated peer ID

		p.hub.HandleMessage(p, &env)
	}
}

// WritePump writes messages from the send channel to the WebSocket.
// Must be run in its own goroutine.
func (p *Peer) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		p.Close()
	}()

	for {
		select {
		case message, ok := <-p.send:
			p.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Channel closed — send close frame.
				p.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := p.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Drain queued messages into the same write for efficiency.
			n := len(p.send)
			for i := 0; i < n; i++ {
				w.Write([]byte("\n"))
				w.Write(<-p.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			p.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := p.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Close cleanly shuts down the peer connection.
func (p *Peer) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	p.closed = true
	close(p.send)
	p.conn.Close()
}
