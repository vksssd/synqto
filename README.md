# ⚡ Synqto

> **Live P2P Collaborative Problem Solving Platform** with a High-Performance Go Signaling Server and Chrome Extension (Manifest V3).

When you open any coding problem (LeetCode, Codeforces, NeetCode, HackerRank, GeeksforGeeks), research paper (ArXiv), or educational lecture (YouTube), **Synqto automatically detects the context and connects you to a real-time study room** with peers studying the exact same material worldwide.

---

## ⚡ Key Architectural Innovation: Hierarchical Leader Mesh

Unlike traditional full-mesh WebRTC topologies that suffer from $O(N^2)$ connection blowup and massive bandwidth requirements for every single peer, **Synqto uses a hierarchical cluster topology**:

```
                       ┌─────────────────────────┐
                       │   Go Signaling Server   │
                       │  (SDP / ICE broker only)│
                       └────────────┬────────────┘
                                    │ (Initial signaling)
              ┌─────────────────────┴─────────────────────┐
              ▼                                           ▼
      ┌───────────────┐     Backbone Mesh        ┌───────────────┐
      │   Leader A    │◄════════════════════════►│   Leader B    │
      └───┬───────┬───┘   (Inter-cluster relay)  └───┬───────┬───┘
          │       │                                  │       │
       ┌──▼─┐   ┌─▼──┐   Intra-cluster            ┌──▼─┐   ┌─▼──┐
       │ P1 │   │ P2 │   Relay                    │ P3 │   │ P4 │
       └────┘   └────┘                            └────┘   └────┘
```

1. **Lightweight Go Server**: Handles ONLY initial WebSocket signaling (SDP offer/answer and ICE candidate exchange) and room/leader registry. **Zero message, chat, voice, or presence relaying.**
2. **Auto-Promoted Leaders**: The most stable peer in each cluster is elected Leader (`score = 0.6 * uptime + 0.4 * stability`). Clusters split automatically at 8 peers.
3. **Bandwidth Efficiency**: Regular peers maintain **exactly 1 WebRTC connection** to their assigned leader ($O(1)$ connections per peer, $O(N)$ system total).
4. **Loop-Free TTL Routing**: Packets carry a hop TTL (default 3) and UUID deduplication sliding window to guarantee zero cycles across backbone leaders.
5. **Instant Local IPC**: Multiple tabs on the same computer communicate with **0ms latency** over `BroadcastChannel` without touching the network.

---

## 🚀 Quick Start

### 1. Start the Go Signaling Server
```bash
cd server
go run .
# Server starts on http://localhost:8080 (WebSocket endpoint at ws://localhost:8080/ws/{roomId})
```

### 2. Build the Chrome Extension
```bash
cd extension
npm install
npm run build
```

### 3. Load the Extension into Google Chrome
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `nerd-buddy/extension/dist` folder
5. Pin **Nerd Buddy** to your toolbar and open any problem (e.g., [LeetCode Two Sum](https://leetcode.com/problems/two-sum/))!

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
