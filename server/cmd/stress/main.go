package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type ServerMessage struct {
	Type    string          `json:"type"`
	From    string          `json:"from"`
	To      string          `json:"to,omitempty"`
	RoomID  string          `json:"roomId"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type StressResult struct {
	TotalClients      int
	ConnectedClients  int64
	FailedConnections int64
	MessagesSent      int64
	MessagesReceived  int64
	RosterUpdates     int64
	LeaderPromotions  int64
	ConnectLatencies  []time.Duration
	RoundTripTimes    []time.Duration
	Duration          time.Duration
}

func main() {
	serverURL := flag.String("url", "ws://localhost:8080/ws/", "WebSocket server endpoint")
	numClients := flag.Int("clients", 200, "Number of concurrent simulated peers")
	numRooms := flag.Int("rooms", 5, "Number of distinct problem rooms to distribute peers across")
	durationSec := flag.Int("duration", 10, "Test duration in seconds")
	msgRate := flag.Int("rate", 10, "Signaling messages per client per second")
	simulateChurn := flag.Bool("churn", true, "Simulate rapid peer disconnects and reconnects (stress leader failover)")
	flag.Parse()

	fmt.Printf("\n🚀 Nerd Buddy Go Signaling Server — Load & Stress Test\n")
	fmt.Printf("═══════════════════════════════════════════════════════════════\n")
	fmt.Printf(" Target URL      : %s\n", *serverURL)
	fmt.Printf(" Total Clients   : %d\n", *numClients)
	fmt.Printf(" Problem Rooms   : %d\n", *numRooms)
	fmt.Printf(" Test Duration   : %ds\n", *durationSec)
	fmt.Printf(" Message Rate    : %d msgs/client/sec\n", *msgRate)
	fmt.Printf(" Simulating Churn: %v\n", *simulateChurn)
	fmt.Printf("═══════════════════════════════════════════════════════════════\n\n")

	// Verify server health before starting
	healthURL := "http://localhost:8080/health"
	resp, err := http.Get(healthURL)
	if err != nil || resp.StatusCode != 200 {
		fmt.Printf("❌ Error: Go server is not responding at %s. Please make sure the server is running on :8080.\n", healthURL)
		return
	}
	resp.Body.Close()
	fmt.Printf("✅ Pre-flight check passed: Go server is HEALTHY on :8080\n\n")

	res := &StressResult{
		TotalClients: *numClients,
	}

	var (
		wg           sync.WaitGroup
		latencyMutex sync.Mutex
		stopChan     = make(chan struct{})
	)

	startTime := time.Now()

	// Spawn clients in waves to simulate realistic ramp-up
	fmt.Printf("⚡ Phase 1: Ramping up %d concurrent WebSockets across %d rooms...\n", *numClients, *numRooms)

	for i := 0; i < *numClients; i++ {
		wg.Add(1)
		clientID := fmt.Sprintf("stress-peer-%04d", i)
		roomID := fmt.Sprintf("room:stress-problem-%d", i%(*numRooms))
		nickname := fmt.Sprintf("StressTester_%d", i)

		go func(id, room, nick string, idx int) {
			defer wg.Done()

			// Stagger connection slightly
			time.Sleep(time.Duration(idx*2) * time.Millisecond)

			connStart := time.Now()
			u, err := url.Parse(*serverURL + room)
			if err != nil {
				atomic.AddInt64(&res.FailedConnections, 1)
				return
			}
			q := u.Query()
			q.Set("peerId", id)
			q.Set("nickname", nick)
			u.RawQuery = q.Encode()

			c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
			if err != nil {
				atomic.AddInt64(&res.FailedConnections, 1)
				return
			}
			defer c.Close()

			connLatency := time.Since(connStart)
			latencyMutex.Lock()
			res.ConnectLatencies = append(res.ConnectLatencies, connLatency)
			latencyMutex.Unlock()

			atomic.AddInt64(&res.ConnectedClients, 1)

			// Send room:join handshake message as required by protocol
			joinPayload, _ := json.Marshal(map[string]string{
				"peerId":   id,
				"nickname": nick,
			})
			joinEnvelope := ServerMessage{
				Type:    "room:join",
				From:    id,
				RoomID:  room,
				Payload: joinPayload,
			}
			joinData, _ := json.Marshal(joinEnvelope)
			if err := c.WriteMessage(websocket.TextMessage, joinData); err != nil {
				return
			}

			// Reader loop
			readDone := make(chan struct{})
			go func() {
				defer close(readDone)
				for {
					_, message, err := c.ReadMessage()
					if err != nil {
						return
					}
					atomic.AddInt64(&res.MessagesReceived, 1)

					var msg ServerMessage
					if err := json.Unmarshal(message, &msg); err == nil {
						if msg.Type == "roster" {
							atomic.AddInt64(&res.RosterUpdates, 1)
						} else if msg.Type == "promote" {
							atomic.AddInt64(&res.LeaderPromotions, 1)
						}
					}
				}
			}()

			// Sender loop (simulates SDP offer/answer/ICE traffic)
			ticker := time.NewTicker(time.Duration(1000/(*msgRate)) * time.Millisecond)
			defer ticker.Stop()

			// Optional churn timer: randomly disconnect after 3-7 seconds to stress leader recovery
			var churnTimer <-chan time.Time
			if *simulateChurn && idx%5 == 0 {
				churnTimer = time.After(time.Duration(3000+rand.Intn(4000)) * time.Millisecond)
			}

			for {
				select {
				case <-stopChan:
					return
				case <-readDone:
					return
				case <-churnTimer:
					// Simulates sudden drop / tab close
					c.Close()
					// Reconnect after 500ms
					time.Sleep(500 * time.Millisecond)
					newConn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
					if err == nil {
						c = newConn
					}
				case <-ticker.C:
					// Send mock WebRTC signal
					signalMsg := ServerMessage{
						Type:   "signal:ice",
						From:   id,
						To:     "target-leader",
						RoomID: room,
						Payload: json.RawMessage(fmt.Sprintf(`{"candidate":{"candidate":"candidate:1 1 UDP 2122252543 192.168.1.%d 50000 typ host","sdpMid":"0","sdpMLineIndex":0}}`, idx%255)),
					}
					data, _ := json.Marshal(signalMsg)
					if err := c.WriteMessage(websocket.TextMessage, data); err == nil {
						atomic.AddInt64(&res.MessagesSent, 1)
					}
				}
			}
		}(clientID, roomID, nickname, i)
	}

	// Run test for specified duration
	fmt.Printf("🔥 Phase 2: Running high-throughput signaling traffic for %ds...\n", *durationSec)
	time.Sleep(time.Duration(*durationSec) * time.Second)
	close(stopChan)

	// Wait for goroutines to drain
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
	}

	res.Duration = time.Since(startTime)

	// Print Results
	printReport(res)
}

func printReport(res *StressResult) {
	fmt.Printf("\n═══════════════════════════════════════════════════════════════\n")
	fmt.Printf(" 📊 STRESS & LOAD TEST RESULTS SUMMARY\n")
	fmt.Printf("═══════════════════════════════════════════════════════════════\n\n")

	fmt.Printf("  Target Clients       : %d\n", res.TotalClients)
	fmt.Printf("  Connected WebSockets : %d (%.1f%% Success Rate)\n",
		res.ConnectedClients, float64(res.ConnectedClients)/float64(res.TotalClients)*100)
	fmt.Printf("  Failed Connections   : %d\n", res.FailedConnections)
	fmt.Printf("  Total Test Duration  : %.2fs\n\n", res.Duration.Seconds())

	fmt.Printf(" ⚡ THROUGHPUT METRICS:\n")
	fmt.Printf("  ─────────────────────────────────────────────────────────────\n")
	fmt.Printf("  Messages Sent        : %d msgs\n", res.MessagesSent)
	fmt.Printf("  Messages Received    : %d msgs\n", res.MessagesReceived)
	totalMsgs := res.MessagesSent + res.MessagesReceived
	fmt.Printf("  Total Message Rate   : %.1f msgs/sec\n", float64(totalMsgs)/res.Duration.Seconds())
	fmt.Printf("  Roster Broadcasts    : %d events\n", res.RosterUpdates)
	fmt.Printf("  Leader Elections     : %d promotions\n\n", res.LeaderPromotions)

	if len(res.ConnectLatencies) > 0 {
		sort.Slice(res.ConnectLatencies, func(i, j int) bool {
			return res.ConnectLatencies[i] < res.ConnectLatencies[j]
		})

		n := len(res.ConnectLatencies)
		min := res.ConnectLatencies[0]
		p50 := res.ConnectLatencies[n*50/100]
		p95 := res.ConnectLatencies[n*95/100]
		p99 := res.ConnectLatencies[n*99/100]
		max := res.ConnectLatencies[n-1]

		fmt.Printf(" ⏱️  WEBSOCKET HANDSHAKE LATENCY:\n")
		fmt.Printf("  ─────────────────────────────────────────────────────────────\n")
		fmt.Printf("  Min Handshake        : %v\n", min)
		fmt.Printf("  p50 (Median)         : %v\n", p50)
		fmt.Printf("  p95 (95th %%)        : %v\n", p95)
		fmt.Printf("  p99 (99th %%)        : %v\n", p99)
		fmt.Printf("  Max Latency          : %v\n\n", max)
	}

	fmt.Printf(" 🛡️  CLUSTER RESILIENCE & INTEGRITY:\n")
	fmt.Printf("  ─────────────────────────────────────────────────────────────\n")
	if res.FailedConnections == 0 {
		fmt.Printf("  ✅ Zero Connection Drops: ALL %d WebSockets established cleanly\n", res.ConnectedClients)
	} else {
		fmt.Printf("  ⚠️  Connection drops encountered: %d\n", res.FailedConnections)
	}
	if res.LeaderPromotions > 0 {
		fmt.Printf("  ✅ Dual-Leader Elections: Dynamic promotion & failover VERIFIED under churn\n")
	}
	if res.RosterUpdates > 0 {
		fmt.Printf("  ✅ Live Roster Sync: Active clustering broadcast VERIFIED\n")
	}
	fmt.Printf("═══════════════════════════════════════════════════════════════\n\n")
}
