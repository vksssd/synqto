# Nerd Buddy — Architectural & Usability Blueprint

A comprehensive, no-fluff guide for architectural scaling, gamification, stage broadcasting, and lean UI restructuring for **Nerd Buddy**.

---

## 1. UI Navigation & Screen Hierarchy Restructuring

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Bottom Tab Navigation                           │
│                                                                        │
│  [ 💬 Room & Chat ]     [ 👥 Squads ]     [ 🧭 Peers ]     [ ⚙️ Profile ] │
│    Default View         Group Hub         Online Buddies   Streaks, Badges│
│    Active Problem,      Public/Private    Wave / Poke      & Settings     │
│    Voice & P2P Chat     Study Circles     Roster           (Merged Tab)   │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.1. Default Screen: Active Problem & Integrated Chat (`Room & Chat`)
* **Layout**:
  * **Top Header**: Active problem title (e.g. *Two Sum* / *Task Scheduler*), platform pill badge, live buddy count, study timer, and Voice/Stage button.
  * **Center**: Real-time P2P Chat stream with 3-level ACKs (Sent ➜ Delivered ➜ Read), markdown bubbles, inline code highlighting, and spoiler blur tags.
  * **Bottom**: Quick-tag toolbar (`[O(N) Time]`, `[DP Memo]`, `[Two Pointers]`), interactive composer with emoji and scratchpad sharing.

### 1.2. Last Tab: Merged Profile, Gamification & Settings (`Profile & Settings`)
* **Layout**:
  * **Identity Profile Card**: Ephemeral avatar, nickname generator, custom color picker, and peer ID.
  * **🔥 GitHub-Style Activity Heatmap & Streak Board**: Visual contribution grid tracking daily problem study activity, current streak, longest streak, and total sessions.
  * **🎖️ Achievement Badges Showcase**: Collectible badges unlocked via local study milestones.
  * **⚙️ System & Network Diagnostics**: WebRTC connection health, custom STUN/TURN configuration, and storage controls.

---

## 2. Serverless Local Gamification Engine

All gamification state is stored purely client-side in `chrome.storage.local` with zero central servers or logins.

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Local Gamification Dashboard                        │
│                                                                        │
│   🔥 7 Day Streak        ⚡ 28 Problems Solved        ⏱️ 14.5 hrs Focus │
│                                                                        │
│   Contribution Grid (Last 60 Days):                                   │
│   □ □ ■ ■ ■ □ ■ ■ ■ ■ ■ □ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■          │
│   (Less  □ ■ ■ ■ ■  More)                                              │
│                                                                        │
│   Unlocked Badges:                                                    │
│   [ 🏆 Streak Master ]  [ 🧠 DP Wizard ]  [ ⚡ Night Owl ]  [ 🛡️ P2P Anchor ]│
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1. GitHub-Style Streak Heatmap Grid
* **Tracking**: Automatically increments today's activity cell when a user navigates to a supported coding platform (LeetCode, Codeforces, NeetCode, etc.) or spends $\ge 15$ minutes in a study room.
* **Rendering**: A clean 60-day CSS grid of activity squares with 4 intensity levels (`rgba(99, 102, 241, 0.2)` to `#6366f1` / `#10b981`).
* **Metrics**:
  * **Current Streak** (consecutive active days with freeze protection).
  * **Longest Streak**.
  * **Total Problems Explored / Solved**.
  * **Total Collaborative Study Time**.

### 2.2. Milestone Achievement Badges
* `🔥 Streak Pioneer`: Maintained a 3-day coding streak.
* `⚡ Speed Demon`: Solved a problem in under 15 minutes.
* `🧠 Algorithm Explorer`: Visited 10+ unique problem rooms.
* `👑 Mesh Anchor`: Served as a group leader in 5+ collaborative rooms.
* `🎓 Live Tutor`: Broadcasted a live tutorial on stage.
* `🔒 Cipher Master`: Created or joined a private password-encrypted squad.

---

## 3. Tutor / Broadcaster Stage & Live Cursor Sync

Rather than unscalable full-mesh $N \times N$ video calls, Nerd Buddy uses an asymmetric **1-Tutor / 1-Broadcaster $\to$ Many Viewers** model with up to **1–2 Guest Speakers on stage**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Live Tutor / Broadcaster Stage                    │
│                                                                        │
│   ┌─────────────────────────────┐    ┌──────────────┐ ┌──────────────┐ │
│   │   🎓 Tutor Video Stream     │    │ Guest 1 (Mic)│ │ Guest 2 (Mic)│ │
│   │   (Screen / Camera 720p)    │    │ ✋ Raised    │ │ ✋ Raised    │ │
│   └─────────────────────────────┘    └──────────────┘ └──────────────┘ │
│                                                                        │
│   Audience (O(1) Downstream):                                         │
│   • Receive 1 broadcast track (low CPU & bandwidth)                    │
│   • Live glowing Tutor Laser Cursor synced across problem page         │
│   • Raise Hand ✋ to join stage (max 2 interactive speakers)           │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1. Live Multi-Peer Laser Cursor / Tutor Pointer
* **Concept**: When a tutor points or highlights code on LeetCode/code editors, their mouse pointer broadcasts relative coordinates $(x\%, y\%)$ over the WebRTC DataChannel via `canvas:cursor` packets.
* **Overlay**: A non-intrusive glowing laser pointer and name tag rendered directly in the content script over the problem description/code editor.
* **Bandwidth**: Consumes only $\sim 200\text{ bytes/sec}$ per cursor over the existing DataChannel connection.

### 3.2. Broadcaster Video & Audio Stage
* **Tutor Mode**: Any leader or room member can click **"Go Live on Stage"** to stream their microphone + optional camera or code screen share.
* **Audience Role**: Viewers receive the single media stream without sending upstream video, preventing laptop overheating and battery drain.
* **Stage Guests (Max 2)**:
  * Audience members can click **"Raise Hand ✋"**.
  * The Tutor can approve up to 2 students to join the audio/video stage simultaneously for interactive Q&A.
  * Keeps the connection graph bounded to maximum 3 media senders ($O(1)$ complexity).

---

## 4. Live Stream Discovery & Broadcaster Awareness

When a peer starts a live screen share, video lecture, or voice stage, room members and visitors who are not actively in the stream need immediate, non-intrusive visibility to discover and tune in.

```
┌────────────────────────────────────────────────────────────────────────┐
│               Stream Discovery & Broadcaster Awareness Flow            │
│                                                                        │
│   [ 🎓 Tutor Starts Stream ]                                           │
│             │                                                          │
│             ▼                                                          │
│   [ Broadcast 'stage:state' Packet (DataChannel & Presence) ]          │
│             │                                                          │
│             ├─► [ 1. In-Browser Floating Button (FAB) Pulse Banner ]   │
│             │     "🔴 LIVE: Alex is explaining Two Sum [Watch]"       │
│             │                                                          │
│             ├─► [ 2. Sidepanel Top Header Banner & Audio Ring ]        │
│             │     Glowing red badge + 1-click "Tune In"                │
│             │                                                          │
│             ├─► [ 3. Squads Hub Roster Tag ]                           │
│             │     "🔴 ON AIR (3 Viewers)" badge next to group name     │
│             │                                                          │
│             └─► [ 4. PiP Floating Mini-Player on Webpage ]             │
│                   Watch tutor's screen while writing code on LeetCode   │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.1. Visual "🔴 LIVE" Alerts & Awareness Touchpoints
1. **In-Browser Floating Button (FAB)**:
   * When a live stream begins, the floating widget on the webpage transforms from a static icon to an **animated red pulsing badge**:
     `🔴 LIVE: <TutorName> is streaming screen & code [Tune In 🎧]`.
   * Allows users solving problems on LeetCode to immediately notice that an active peer is explaining the solution.
2. **Sidepanel Top Header Alert**:
   * Pinned banner across all tabs:
     `🎓 <TutorName> is Live on Stage (Screen Share) — [Watch Stream 📺]`.
   * 1-click connects the viewer's downstream media receiver without forcing them to broadcast their own mic/camera.
3. **Squads & Groups Hub Presence Indicator**:
   * Any group or problem room with an active stream displays a prominent **"🔴 ON AIR"** tag with viewer count in the **Squads** tab, allowing students browsing different topics to jump into live sessions.
4. **Browser Toolbar Icon Badge**:
   * The Chrome extension action icon displays a red `LIVE` badge text when a stream is happening in your current problem circle.

### 4.2. Picture-in-Picture (PiP) Floating Mini-Player
* When tuning into a tutor's screen share, students can click the **PiP button** (`requestPictureInPicture()`).
* The tutor's code broadcast detaches into a floating, resizable OS window, enabling students to type their own code in LeetCode/VS Code while watching the explanation simultaneously.

### 4.3. Passive Downstream Tuning ($O(1)$ Scalability)
* Joining as a viewer is purely **listen/watch-only** (zero CPU/bandwidth upload overhead from the student).
* WebRTC media tracks (`RTCRtpReceiver`) are subscribed without adding sender tracks, preserving laptop battery and network performance.

---

## 5. Zero-Backend / Serverless WebRTC Roadmap (No Self-Hosted Servers)

To achieve $0 maintenance and eliminate the Go signaling server, the architecture migrates to public, decentralized primitives:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   100% Serverless WebRTC Architecture                  │
│                                                                        │
│   NAT Traversal:       Public Google & Cloudflare STUN Servers         │
│                        (stun:stun.l.google.com:19302)                  │
│                                                                        │
│   SDP Signaling:       Redundant Public WebTorrent Trackers            │
│                        (wss://tracker.openwebtorrent.com, etc.)        │
│                        OR Public MQTT / NATS WebSocket Brokers         │
│                                                                        │
│   Mesh Topology:       Client-Elected Dual-Leader Backbone             │
│                        (In-browser auto-promotion & orphan recovery)   │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Public STUN Pool**: `stun:stun.l.google.com:19302`, `stun:stun.cloudflare.com:3478` (100% free built-in NAT resolution).
2. **Public BitTorrent/WebTorrent Trackers**: Automatic SDP offer/answer exchange matched by deterministic problem hash (`info_hash = sha1(roomId)`).
3. **Zero Maintenance & Cost**: $0 hosting costs with global redundancy.

---

## 6. Future Work: Direct YouTube Live & Synchronized Watch Party Integration

Integrating YouTube Live and video synchronization expands Nerd Buddy from ephemeral peer calls to global public streaming, synchronized algorithm watch parties, and persistent solution video archives.

```
┌────────────────────────────────────────────────────────────────────────┐
│               YouTube Live & Watch Party Architecture                  │
│                                                                        │
│   [ 🎓 Tutor / Broadcaster ]                                           │
│        │                                                               │
│        ├─► [ 1. Direct YouTube Live Stream (RTMP / WebCodecs) ]        │
│        │     Stream screen & mic directly to YouTube channel           │
│        │                                                               │
│        ├─► [ 2. P2P YouTube Watch Party Sync (DataChannel) ]           │
│        │     Synchronize video Play/Pause/Seek across room peers       │
│        │                                                               │
│        ├─► [ 3. Bi-Directional YouTube Live Chat Relay ]              │
│        │     Mirror YouTube Live comments into P2P room chat           │
│        │                                                               │
│        └─► [ 4. Automated Solution VOD Archival ]                      │
│              Auto-save recorded problem sessions as YouTube VODs       │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.1. Direct In-Extension YouTube Live Streaming (Tutor Mode)
* **Goal**: Enable educators, mentors, and problem solvers to broadcast live to their public or unlisted YouTube channels directly from the Chrome Extension without installing OBS or third-party desktop software.
* **Architecture**:
  * **Media Capture**: Captures code screen + microphone audio via `navigator.mediaDevices.getDisplayMedia`.
  * **Encoding**: Uses the native **WebCodecs API** (`VideoEncoder`, `AudioEncoder`) or `MediaRecorder` with H.264/AAC for hardware-accelerated, low-CPU compression.
  * **Streaming Protocol**:
    * **Option A (WebRTC-to-WHIP / WebRTC Ingest)**: Directly ingest WebRTC streams into YouTube Live if supported.
    * **Option B (WebSocket-to-RTMP Gateway / Cloudflare Stream)**: Streams encoded chunks to YouTube's RTMP endpoint (`rtmp://a.rtmp.youtube.com/live2/<stream_key>`).
  * **Authentication**: Broadcasters can either enter their YouTube Stream Key directly into Settings or authenticate with 1 click using Google OAuth2 (`chrome.identity` with `https://www.googleapis.com/auth/youtube.force-ssl`).

### 6.2. Synchronized YouTube Watch Parties & Problem Video Sync
* **Goal**: Enable study groups and coding squads to watch solution walkthroughs (e.g. NeetCode, MIT OpenCourseWare, or community video tutorials) in perfect lockstep.
* **Mechanism (`player:sync` over WebRTC DataChannel)**:
  * Embeds the **YouTube IFrame Player API** inside the sidepanel or in-page popup.
  * When any authorized peer hits **Play**, **Pause**, **Seek**, or changes playback speed ($1.25\times, 1.5\times$), a lightweight `player:sync` packet is broadcast over WebRTC.
  * Target timestamp reconciliation ensures all peers remain synchronized within $\pm 80\text{ ms}$.
* **Timestamped Code Bookmarks**:
  * Chat messages can contain clickable timestamps (e.g. `[03:45] Two Pointer Optimization`). Clicking the timestamp jumps the synchronized video player to that exact frame for everyone in the room.

### 6.3. Bi-Directional Live Chat & Comment Relay Bridge
* **Integration**:
  * Leverages the **YouTube Live Streaming API** (`liveChatMessages.list` and `liveChatMessages.insert`).
  * Questions and comments from public YouTube viewers automatically mirror into the Nerd Buddy room chat.
  * Squad member responses in Nerd Buddy can be relayed back to the YouTube Live chat, unifying the public audience and the private study squad into one cohesive thread.

### 6.4. Automated Solution VOD Archival
* **Session Recording**:
  * When a live stage session ends, the recorded stream is automatically processed and uploaded as an Unlisted/Public YouTube VOD.
  * The permanent video link is pinned to the problem's Squad Card so future buddies solving that problem can re-watch the community's recorded explanation.
