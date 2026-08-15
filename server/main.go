package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nerdbuddy/server/internal/hub"
	"github.com/nerdbuddy/server/internal/natsbus"
	"github.com/nerdbuddy/server/internal/protocol"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

func main() {
	// Structured logging.
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	natsURL := os.Getenv("NATS_URL")
	bus := natsbus.New(natsURL)
	defer bus.Close()

	h := hub.New(bus)

	mux := http.NewServeMux()

	// WebSocket signaling endpoint: /ws/{roomId}
	mux.HandleFunc("/ws/", func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(h, w, r)
	})

	// Health check.
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Room stats (diagnostic).
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		setCORS(w)
		data, err := h.ServeStats()
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)
	})

	// CORS preflight.
	handler := corsMiddleware(mux)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown.
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		slog.Info("nerd-buddy signaling server starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-done
	slog.Info("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("shutdown error", "error", err)
	}

	slog.Info("server stopped")
}

// handleWebSocket upgrades the HTTP connection to WebSocket and registers the peer.
func handleWebSocket(h *hub.Hub, w http.ResponseWriter, r *http.Request) {
	// Extract room ID from path: /ws/{roomId}
	path := strings.TrimPrefix(r.URL.Path, "/ws/")
	roomID := strings.TrimRight(path, "/")
	if roomID == "" {
		http.Error(w, "room ID required", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}

	// Read the first message which must be a room:join.
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		slog.Warn("failed to read join message", "error", err)
		conn.Close()
		return
	}
	conn.SetReadDeadline(time.Time{}) // reset deadline

	var env protocol.Envelope
	if err := json.Unmarshal(msg, &env); err != nil || env.Type != protocol.MsgRoomJoin {
		slog.Warn("first message must be room:join", "error", err)
		conn.Close()
		return
	}

	var joinData protocol.JoinPayload
	if err := json.Unmarshal(env.Payload, &joinData); err != nil {
		slog.Warn("invalid join payload", "error", err)
		conn.Close()
		return
	}

	if joinData.PeerID == "" {
		slog.Warn("join payload missing peerId")
		conn.Close()
		return
	}

	peer := hub.NewPeer(joinData.PeerID, joinData.Nickname, roomID, conn, h)

	// Register the peer (this also assigns leader and broadcasts roster).
	h.Register(peer)

	// Start read/write pumps in separate goroutines.
	go peer.WritePump()
	peer.ReadPump() // blocks until disconnect
}

// corsMiddleware adds CORS headers to all responses.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setCORS(w)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func setCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}
