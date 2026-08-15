// ─── NATS & In-Memory Distributed Message Bus for Scalable Signaling ───

package natsbus

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

// Unsubscriber cancels a subscription.
type Unsubscriber func()

// MessageBus handles cross-server message routing for distributed signaling.
type MessageBus interface {
	PublishPeer(peerID string, data []byte) error
	PublishRoom(roomID string, data []byte) error
	SubscribePeer(peerID string, handler func(data []byte)) (Unsubscriber, error)
	SubscribeRoom(roomID string, handler func(data []byte)) (Unsubscriber, error)
	Close()
}

// ─── NATS Implementation (Horizontally Scalable Cluster) ───

type NATSBus struct {
	nc *nats.Conn
}

func NewNATSBus(natsURL string) (*NATSBus, error) {
	opts := []nats.Option{
		nats.Name("synqto-signaling-broker"),
		nats.ReconnectWait(2 * time.Second),
		nats.MaxReconnects(-1), // keep reconnecting forever
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			slog.Warn("NATS disconnected", "error", err)
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			slog.Info("NATS reconnected", "url", nc.ConnectedUrl())
		}),
		nats.ClosedHandler(func(nc *nats.Conn) {
			slog.Info("NATS connection closed")
		}),
	}

	nc, err := nats.Connect(natsURL, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS at %s: %w", natsURL, err)
	}

	slog.Info("connected to NATS cluster", "url", nc.ConnectedUrl())
	return &NATSBus{nc: nc}, nil
}

func (n *NATSBus) PublishPeer(peerID string, data []byte) error {
	subject := fmt.Sprintf("synqto.peers.%s", peerID)
	return n.nc.Publish(subject, data)
}

func (n *NATSBus) PublishRoom(roomID string, data []byte) error {
	subject := fmt.Sprintf("synqto.rooms.%s", roomID)
	return n.nc.Publish(subject, data)
}

func (n *NATSBus) SubscribePeer(peerID string, handler func(data []byte)) (Unsubscriber, error) {
	subject := fmt.Sprintf("synqto.peers.%s", peerID)
	sub, err := n.nc.Subscribe(subject, func(m *nats.Msg) {
		handler(m.Data)
	})
	if err != nil {
		return nil, err
	}
	return func() {
		sub.Unsubscribe()
	}, nil
}

func (n *NATSBus) SubscribeRoom(roomID string, handler func(data []byte)) (Unsubscriber, error) {
	subject := fmt.Sprintf("synqto.rooms.%s", roomID)
	sub, err := n.nc.Subscribe(subject, func(m *nats.Msg) {
		handler(m.Data)
	})
	if err != nil {
		return nil, err
	}
	return func() {
		sub.Unsubscribe()
	}, nil
}

func (n *NATSBus) Close() {
	if n.nc != nil {
		n.nc.Drain()
		n.nc.Close()
	}
}

// ─── In-Memory Implementation (Zero-Dependency Single Node Fallback) ───

type InMemoryBus struct {
	mu            sync.RWMutex
	peerSubs      map[string][]func([]byte)
	roomSubs      map[string][]func([]byte)
	isClosed      bool
}

func NewInMemoryBus() *InMemoryBus {
	return &InMemoryBus{
		peerSubs: make(map[string][]func([]byte)),
		roomSubs: make(map[string][]func([]byte)),
	}
}

func (b *InMemoryBus) PublishPeer(peerID string, data []byte) error {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.isClosed {
		return nil
	}

	handlers, ok := b.peerSubs[peerID]
	if !ok {
		return nil
	}

	for _, h := range handlers {
		go h(data)
	}
	return nil
}

func (b *InMemoryBus) PublishRoom(roomID string, data []byte) error {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.isClosed {
		return nil
	}

	handlers, ok := b.roomSubs[roomID]
	if !ok {
		return nil
	}

	for _, h := range handlers {
		go h(data)
	}
	return nil
}

func (b *InMemoryBus) SubscribePeer(peerID string, handler func(data []byte)) (Unsubscriber, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.peerSubs[peerID] = append(b.peerSubs[peerID], handler)
	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		delete(b.peerSubs, peerID)
	}, nil
}

func (b *InMemoryBus) SubscribeRoom(roomID string, handler func(data []byte)) (Unsubscriber, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.roomSubs[roomID] = append(b.roomSubs[roomID], handler)
	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		delete(b.roomSubs, roomID)
	}, nil
}

func (b *InMemoryBus) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.isClosed = true
	b.peerSubs = make(map[string][]func([]byte))
	b.roomSubs = make(map[string][]func([]byte))
}

// ─── Factory Constructor ───

// New creates a NATS message bus if natsURL is non-empty, otherwise falls back to InMemoryBus.
func New(natsURL string) MessageBus {
	if natsURL != "" {
		bus, err := NewNATSBus(natsURL)
		if err != nil {
			slog.Error("failed to initialize NATS bus, falling back to in-memory bus", "error", err)
			return NewInMemoryBus()
		}
		return bus
	}

	slog.Info("using high-speed in-memory message bus (set NATS_URL for horizontal cluster scaling)")
	return NewInMemoryBus()
}
