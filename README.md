# ⚡ Synqto v0.2.0

> **Live P2P Collaborative Problem Solving Platform** with Next-Gen Resilient Mesh Networking, High-Performance Go Signaling Server, and Chrome Extension (Manifest V3).

When you open any coding problem (LeetCode, Codeforces, NeetCode, HackerRank, GeeksforGeeks), research paper (ArXiv), or educational lecture (YouTube), **Synqto automatically detects the context and connects you to a real-time study room** with peers studying the exact same material worldwide.

---

## ⚡ Key Architectural Innovation: The Trinity (3-Leader Backbone Mesh)

Unlike traditional full-mesh WebRTC topologies ($O(N^2)$ connection blowup) or 2-node leader setups vulnerable to split-brain network partitions, **Synqto v0.2.0 establishes a Trinity Backbone ($K_3$ Triangular Quorum Mesh)**:

```
                       ┌─────────────────────────┐
                       │   Go Signaling Server   │
                       │  (SDP / ICE broker only)│
                       └────────────┬────────────┘
                                    │ (Initial signaling)
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
       ┌─────────────┐        ┌─────────────┐       ┌─────────────┐
       │  Leader A   │◄══════►│  Leader B   │◄═════►│  Leader C   │
       └──────┬──────┘        └──────┬──────┘       └──────┬──────┘
              ▲                      │                     ▲
              └══════════════════════╧═════════════════════┘
                        Triangular Backbone Mesh (K3)
              │                      │                     │
           Active                 Active                Active
              ▼                      ▼                     ▼
         ┌─────────┐            ┌─────────┐           ┌─────────┐
         │ Cluster │            │ Cluster │           │ Cluster │
         │ Peers 1 │            │ Peers 2 │           │ Peers 3 │
         └─────────┘            └─────────┘           └─────────┘
```

1. **Trinity Quorum Mesh ($K_3$ Graph)**: Whenever a room has $\ge 3$ peers, the server maintains at least **3 interconnected leaders**. With 3 leaders, a majority quorum ($2/3$) is always maintained even during a node crash, preventing split-brain partitions.
2. **Multi-Path Bridging**: If direct communication between Leader A and Leader B experiences packet loss or ISP routing issues, Leader C acts as a live WebRTC bridge ($A \leftrightarrow C \leftrightarrow B$).
3. **Dual-Leader Warm Standby Topology**: Every regular peer maintains an active DataChannel to their Primary Leader and a pre-warmed standby DataChannel to a Shadow Leader for **sub-300ms failover** with zero renegotiation delay.
4. **W3C Perfect Negotiation**: Eliminates SDP offer/answer collisions and glare during concurrent reconnections.
5. **Dual DataChannels per Connection**:
   - `synqto_control` (`ordered: true, maxRetransmits: 5`): Latency-critical chat ACKs, laser pointers, voice signaling, and cursor coordinates.
   - `synqto_bulk` (`ordered: false`): Unordered high throughput for screenshots, whiteboard state sync, and file attachments without Head-of-Line blocking.
6. **Anti-Entropy Delta Sync & Vector Clocks**: Guarantees zero dropped messages across leader failovers and reconnections via monotonic sequence digests.
7. **Lightweight Go Server**: Handles ONLY initial WebSocket signaling (SDP offer/answer and ICE candidate exchange) and room/leader registry. **Zero message, chat, voice, or presence relaying.**
8. **Instant Local IPC**: Multiple tabs on the same computer communicate with **0ms latency** over `BroadcastChannel` without touching the network.

---

## 🚀 Quick Start

### 1. Start the Go Signaling Server
```bash
cd synqto-server
go run .
# Server starts on http://localhost:8080 (WebSocket endpoint at ws://localhost:8080/ws/{roomId})
```

### 2. Build the Chrome Extension
```bash
cd synqto/extension
npm install
npm run build
npm run package
```

### 3. Load the Extension into Google Chrome
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `synqto/extension/dist` folder
5. Pin **Synqto** to your toolbar and open any problem (e.g., [LeetCode Two Sum](https://leetcode.com/problems/two-sum/))!

---

## 📦 Project Structure

```
nerd-buddy/
├── server/                         # Go Signaling Server
│   ├── go.mod
│   ├── main.go                     # HTTP server, WebSocket handler, CORS, shutdown
│   └── internal/
│       ├── hub/
│       │   ├── hub.go              # Central room coordinator & GC
│       │   ├── room.go             # Room state, leader assignment, cluster split
│       │   └── peer.go             # WebSocket peer, Read/Write pumps
│       ├── protocol/
│       │   └── messages.go         # Strongly-typed wire protocol envelopes
│       └── election/
│           └── election.go         # Leader scoring & promotion algorithm
│
├── extension/                      # Chrome Extension (Manifest V3)
│   ├── public/
│   │   ├── manifest.json           # MV3 manifest (sidepanel, offscreen, storage)
│   │   └── icons/                  # 16, 48, 128 PNG extension icons
│   ├── sidepanel.html              # Side panel UI frame
│   ├── offscreen.html              # Background WebRTC runner frame
│   ├── vite.config.ts              # Multi-target Vite bundler (ESM & IIFE)
│   └── src/
│       ├── app/
│       │   ├── App.tsx             # Root React shell & state coordinator
│       │   └── index.css           # Ultra-premium Dark Glassmorphism CSS
│       ├── background/
│       │   └── service-worker.ts   # MV3 service worker & tab observer
│       ├── content/
│       │   ├── resource-detector.ts# Multi-platform parser (LeetCode, CF, YouTube, etc.)
│       │   ├── page-observer.ts    # SPA route mutation observer
│       │   └── content-script.ts   # Injected observer bridge
│       ├── core/
│       │   └── network/
│       │       ├── packet.ts       # Unified NetworkPacket schema + TTL
│       │       ├── signaling.service.ts # Go WebSocket client
│       │       ├── webrtc.service.ts    # Native RTCPeerConnection & DataChannels
│       │       ├── topology.service.ts  # Hierarchical router & loop prevention
│       │       └── network.service.ts   # Unified transport (BroadcastChannel + P2P)
│       ├── features/
│       │   ├── chat/               # 3-level ACK state machine, markdown, history sync
│       │   ├── discovery/          # 5s heartbeats, 20s pruning, live roster, wave/poke
│       │   ├── identity/           # Nicknames, avatars, HSL colors, local persistence
│       │   ├── room/               # Deterministic 64-bit FNV-1a room hashing
│       │   ├── status/             # Rich presence badges & study timers
│       │   ├── voice/              # WebRTC audio calling & Web Audio FFT volume detection
│       │   └── sync/               # Topology inspector & role monitor
│       └── offscreen/
│           └── offscreen.ts        # Background WebRTC & desktop notifications
└── docs/
    ├── architecture.md
    └── protocol.md
```

---

## 🌟 Supported Platforms

- **LeetCode**: `leetcode.com/problems/<slug>`
- **NeetCode**: `neetcode.io/problems/<slug>`
- **Codeforces**: Contests, Gym, Problemset (`codeforces.com/contest/*/problem/*`)
- **HackerRank**: Challenges & practice problems
- **CodeChef**: Problem solving
- **GeeksforGeeks**: Problem directory
- **YouTube**: Lectures & solution videos (`watch?v=`, `shorts/`, `youtu.be`)
- **ArXiv**: Research papers (`arxiv.org/abs/*`, `arxiv.org/pdf/*`)
- **GitHub**: Repositories, issues & pull requests
- **Custom Study Rooms**: Create/join any named lounge on demand
