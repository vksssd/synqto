# 🏛️ Nerd Buddy — Architecture Specification

## 1. System Philosophy & Motivation

In traditional WebRTC collaborative tools, nodes either rely on heavy central media servers (SFUs / MCUs) or naive peer-to-peer full meshes ($O(N^2)$ connections).

- **Full Mesh ($O(N^2)$)**: Each node maintains $N-1$ connections and must upload every message/media packet $N-1$ times. At 15 peers, this consumes immense client upload bandwidth and causes browser freezing.
- **Central SFU/MCU**: Heavy server costs, single point of failure, data privacy concerns.

**Nerd Buddy solves this with a Hierarchical Cluster-Leader Topology + Minimalist Go Signaling Broker**:

```
                               ┌─────────────────────────┐
                               │   Go Signaling Server   │
                               │   (In-Memory Broker)    │
                               └────────────┬────────────┘
                                            │
                     WebSocket Signaling    │  (SDP Offer/Answer & ICE only)
                     Zero Data Relaying     │  Zero Message Storage
                                            │
             ┌──────────────────────────────┴──────────────────────────────┐
             ▼                                                             ▼
     ┌───────────────┐              Backbone Mesh                  ┌───────────────┐
     │  Leader A 👑  │◄═══════════════════════════════════════════►│  Leader B 👑  │
     └───┬───────┬───┘             (Inter-cluster)                 └───┬───────┬───┘
         │       │                                                     │       │
      ┌──▼─┐   ┌─▼──┐             Intra-cluster                     ┌──▼─┐   ┌─▼──┐
      │ P1 │   │ P2 │                 Relay                         │ P3 │   │ P4 │
      └────┘   └────┘                                               └────┘   └────┘
```

---

## 2. Server Architecture (Golang)

The server is built in Go for maximum concurrency and minimal memory overhead.

- **Zero-Storage Philosophy**: The server does NOT persist messages, user accounts, or presence. Rooms exist only in memory while at least 1 peer is connected.
- **Garbage Collection**: A background goroutine cleans up empty rooms every 30 seconds.
- **Goroutine-per-Connection**: Each connected peer runs lightweight `ReadPump` and `WritePump` goroutines.
- **Role Assignment**:
  - The first peer to join an empty room is auto-promoted to **Group Leader**.
  - Subsequent peers are assigned to the least-loaded leader in the room.
  - If a leader's cluster exceeds `MaxClusterSize = 8`, the server triggers `splitCluster` and promotes the most stable peer to lead the new cluster.
  - When a leader disconnects, the server promotes the best candidate from that cluster (`score = 0.6 * uptime + 0.4 * stability`) and re-routes orphans.

---

## 3. Client Hierarchical Routing Algorithm

### Node Roles

1. **Regular Peer**:
   - Maintains **exactly 1 WebRTC DataChannel** to its assigned leader.
   - Forwards all outgoing packets to its leader.
   - Receives inbound packets from its leader.
   - Total connections = $1$.

2. **Cluster Leader**:
   - Maintains DataChannels to members of its cluster ($\le 8$ connections).
   - Maintains DataChannels to all other Leaders in the room (Backbone Mesh).
   - Relays intra-cluster and inter-cluster packets.

### Loop Prevention & Deduplication

1. **TTL (Time to Live)**: Every packet starts with `ttl = 3`. Each relay hop decrements `ttl`. Packets with `ttl <= 0` are immediately dropped.
2. **Sliding Window UUID Deduplication**: Each node remembers the last 1000 packet IDs in a FIFO ring buffer. Duplicate packets are discarded before local dispatch or relaying.
3. **Directed Message Routing**: Targeted packets (e.g. private ACKs, read receipts) are routed directly if the destination is connected, or relayed through the backbone.

---

## 4. Multi-Layer Transport Pipeline

```
+-------------------------------------------------------------------------+
|                              NetworkService                             |
+--------------------+--------------------------------+-------------------+
                     |                                |
                     v                                v
+------------------------------------+   +--------------------------------+
|       Layer 1: Local IPC           |   |       Layer 2: Remote P2P      |
| BroadcastChannel                   |   | WebRTC DataChannels + Audio    |
| (nerd-buddy:room:<roomId>)         |   | (Hierarchical Topology)        |
| - 0ms latency, zero network cost   |   | - 1 connection per regular peer|
+------------------------------------+   +--------------------------------+
```

---

## 5. Voice Chat Architecture

- **Web Audio Volume Analyser**: Samples local microphone volume every 60ms using FFT size 64. When energy exceeds threshold 18, triggers active speaking pulse animation.
- **MediaStream Negotiation**: Local audio tracks are attached to active `RTCPeerConnection` instances.
- **Glare Prevention**: Lexicographical comparison on `peerId` resolves symmetric offer collisions.
