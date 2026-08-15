# 🎬 Synqto Video Recording & Live Streaming Studio — Architectural Plan

> **Document Type**: Architecture & Engineering Specification  
> **Status**: Planned for Next Release Cycle  
> **Target Capabilities**: Screen / Tab / Window Capture, PiP Facecam, YouTube Coding Tutorial Templates, Mouse Proximity Auto-Fade, Chroma & Geometry FX, Audio Ducking, Multi-Platform Live Streaming (YouTube Live, Twitch, LinkedIn, Kick), App Linking, and Local Diary Integration.

---

## 1. Executive Summary & Vision

Modern coding tutorials, code reviews, live coding streams, and competitive programming walkthroughs (popularized by creators on YouTube and Twitch like *NeetCode*, *Fireship*, *Theo - t3.gg*, *ThePrimeagen*, and *Web Dev Simplified*) rely on a distinct, distraction-free visual layout:
1. High-fidelity editor / problem view with crystal-clear code readability.
2. An expressive, non-intrusive presenter facecam positioned in a corner or side column.
3. **Zero code obstruction** — when the cursor moves towards the facecam to edit code underneath, the facecam must either **fade to transparent** or **intelligently dodge** to the opposite side.
4. Professional presentation effects: mouse click ripples, keystroke shortcuts overlay, audio noise suppression, and automatic background audio ducking.
5. **1-Click Multi-Platform Live Streaming**: Broadcast live problem-solving sessions directly to **YouTube Live**, **Twitch**, **LinkedIn Live**, **Twitter/X**, and **Kick** with synchronized multi-chat overlays, without needing heavy external tools like OBS.

This plan details how Synqto will integrate an **in-browser video recording and live streaming studio** directly into the Chrome extension with zero external dependencies.

---

## 2. Capture Sources & Ingestion Pipeline

```mermaid
flowchart TD
    subgraph Capture Sources
        S1[🖥️ Entire Screen / Window / Selected Tab<br/>navigator.mediaDevices.getDisplayMedia] --> Comp[🎨 WebGL / Canvas2D Compositor Engine]
        S2[🎥 Facecam Video<br/>navigator.mediaDevices.getUserMedia] --> FX[✨ Facecam FX: Shapes, Blur, Transparency]
        FX --> Comp
        S3[🎙️ Microphone Audio] --> AM[🎛️ AudioContext Mixer & Auto-Ducker]
        S4[🔊 System / Tab Audio] --> AM
    end

    Comp --> REC[📹 MediaRecorder Engine<br/>VP9 / H.264 @ 60 FPS 1080p]
    Comp --> STR[📡 Live Streaming Bridge<br/>WHIP / WebRTC / RTMP Gateway]
    AM --> REC
    AM --> STR

    REC --> OUT1[💾 Download .webm / .mp4]
    REC --> OUT2[📔 Attach to Synqto Diary Page]
    REC --> OUT3[👥 Synqto P2P Peer Stage]

    STR --> LS1[🔴 YouTube Live]
    STR --> LS2[🟣 Twitch]
    STR --> LS3[💼 LinkedIn Live / Kick / RTMP]
```

### 2.1 Video Ingestion Options
| Source Type | API Implementation | Use Case |
| :--- | :--- | :--- |
| **Active Tab Only** | `chrome.tabCapture.getMediaStreamId` / `preferCurrentTab: true` | Record only the LeetCode/Codeforces problem tab without recording other browser tabs or desktop notifications. |
| **Specific Window** | `navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window' } })` | Record VS Code, terminal, or browser window. |
| **Entire Screen** | `navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' } })` | Full desktop capture for multi-window workflows. |
| **Camera Only** | `navigator.mediaDevices.getUserMedia({ video: { width: 1920, height: 1080 } })` | Direct webcam walkthrough or whiteboard explanation. |

### 2.2 Audio Ingestion & Mixing
- **Mic Input**: 48kHz stereo with hardware echo cancellation, noise suppression, and auto gain control.
- **System / Tab Audio**: Audio captured from browser tab/system audio stream.
- **AudioContext Ducking Node**:
  - Dynamically lowers system audio volume by **60-70%** whenever voice mic input crosses `-35dB` threshold.
  - Automatically restores volume when presenter stops speaking with a smooth 300ms release curve.

---

## 3. YouTube Coding Tutorial Layout Templates

The compositor supports 4 preset layouts tailored for developer tutorials:

```
┌──────────────────────────────────────┐  ┌──────────────────────────────┬──────┐
│  TEMPLATE 1: Studio PiP (Corner)     │  │  TEMPLATE 2: Split Stage     │ Cam  │
│                                      │  │                              ├──────┤
│   [ Screen / Code / Whiteboard ]     │  │   [ 75% Code / Problem ]     │ Chat │
│                                      │  │                              │  &   │
│                              ┌─────┐ │  │                              │ Notes│
│                              │ Cam │ │  │                              │      │
│                              └─────┘ │  │                              │      │
└──────────────────────────────────────┘  └──────────────────────────────┴──────┘

┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│  TEMPLATE 3: Side-by-Side Dual Tutor │  │  TEMPLATE 4: Whiteboard Lecture      │
│ ┌────────────────┐┌────────────────┐ │  │  ┌─────────────────────────────────┐ │
│ │                ││                │ │  │  │  Full-Width High-DPI Canvas     │ │
│ │  Screen Share  ││ Alice    Bob   │ │  │  │  (Drawings, Tree Nodes, System) │ │
│ │  or Editor     ││ ┌───┐   ┌───┐  │ │  │  └─────────────────────────────────┘ │
│ │                ││ └───┘   └───┘  │ │  │     ┌─────────┐                      │
│ └────────────────┘└────────────────┘ │  │     │ Presenter 16:9 Bubble          │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
```

### Detailed Template Breakdown
1. **Template 1 — Studio PiP (NeetCode / Fireship Mode)**:
   - Fullscreen 1080p display of problem & code.
   - Draggable camera bubble in any corner (Bottom-Right, Bottom-Left, Top-Right, Top-Left).
   - Features **Smart Auto-Fade** when typing code underneath the bubble.
2. **Template 2 — Split Stage (ThePrimeagen / Theo Mode)**:
   - 75% width dedicated to code editor or terminal.
   - 25% right column with Facecam at top and live Synqto notes/diary/chat stream below.
3. **Template 3 — Dual-Tutor Pair Programming**:
   - Screen share on left half; dual circular avatar bubbles on right half for peer-to-peer tutoring sessions.
   - Active speaker detection highlights the speaking tutor's camera border with an animated glow.
4. **Template 4 — Architecture Whiteboard Lecture**:
   - 100% vector whiteboard drawing canvas.
   - Floating wide 16:9 presenter video bar at the bottom with adjustable backdrop blur.

---

## 4. Smart Pro FX & Developer-First Features

### 4.1 The "Never-Block-Code" Engine (Mouse Proximity Auto-Fade & Smart Dodge)
One of the most annoying flaws in tutorial videos is when the presenter's webcam blocks code, terminal output, or compiler errors at the bottom of the screen.

**Solution: Dual-Mode Obstruction Prevention**:
- **Mode A: Proximity Fade (Alpha Transparency)**:
  $$\text{Distance } d = \sqrt{(x_{\text{mouse}} - x_{\text{cam}})^2 + (y_{\text{mouse}} - y_{\text{cam}})^2}$$
  - If $d > 180\text{px}$: Camera opacity is $100\%$.
  - If $50\text{px} \le d \le 180\text{px}$: Camera opacity linearly scales down to $15\%$.
  - If $d < 50\text{px}$: Camera opacity drops to $5\%$ with a dotted outline so code behind is 100% readable.
- **Mode B: Corner Smart-Dodge**:
  - When mouse remains within the camera box for $> 400\text{ms}$ while typing, the facecam smoothly glides (CSS `cubic-bezier(0.16, 1, 0.3, 1)`) to the opposite corner.

### 4.2 Facecam Geometry, Shapes & Borders
- **Circle Avatar**: Classic clean circular facecam ($120\text{px} - 280\text{px}$ diameter).
- **Squircle (iOS Rounded Rect)**: Modern smooth corners ($r = 24\text{px}$).
- **Hexagon / Tech Badge**: Ideal for tech reviews and livestreams.
- **Aspect Ratio Toggles**: 1:1 Square, 4:3 Classic, 16:9 Widescreen.
- **Border Customization**:
  - Gradient borders (e.g. Indigo to Violet, Emerald to Cyan).
  - Speaking indicator: Audio-reactive pulsating border ring when mic is active.

### 4.3 Virtual Background & Chroma Key
- **Real-Time Background Blur**: Uses `@mediapipe/selfie_segmentation` to separate subject from background, blurring room background without requiring a physical green screen.
- **Chroma Key**: 1-click green/blue color picker with tolerance and smoothness sliders.
- **Opacity Slider**: Adjust facecam overlay opacity from $10\%$ to $100\%$.

### 4.4 Mouse Click FX & Keystroke HUD
- **Mouse Highlight Halo**: Subtle colored halo ring following the mouse pointer.
- **Click Ripple**: Concentric expanding ring animation on mouse clicks (Left click = Blue, Right click = Amber).
- **Keystroke HUD Overlay**:
  - Displays keyboard shortcuts pressed by the presenter (e.g. `Ctrl + Shift + P`, `Cmd + B`, `Alt + Enter`) in a floating glass pill in the bottom center.

---

## 5. Technical Implementation Architecture

### 5.1 High-Performance WebGL/Canvas2D Compositor Loop
To ensure 60 FPS recording with zero frame drops during heavy coding/compiling:

```typescript
export class VideoCompositor {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private screenVideo: HTMLVideoElement;
  private cameraVideo: HTMLVideoElement;
  private options: VideoRecordingOptions;

  public startRenderLoop() {
    const render = () => {
      // 1. Draw base screen capture
      this.ctx.drawImage(this.screenVideo, 0, 0, this.width, this.height);

      // 2. Compute mouse distance for auto-fade
      const alpha = this.calculateFacecamAlpha(this.mousePos, this.cameraRect);

      // 3. Clip camera to desired shape (Circle / Squircle / Hexagon)
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.applyShapeClip(this.ctx, this.cameraRect, this.options.cameraShape);
      this.ctx.drawImage(this.cameraVideo, this.cameraRect.x, this.cameraRect.y, this.cameraRect.w, this.cameraRect.h);
      this.ctx.restore();

      // 4. Draw mouse halo and click ripples
      this.drawMouseEffects(this.ctx);

      // 5. Draw Keystroke HUD
      if (this.currentKeystroke) {
        this.drawKeystrokePill(this.ctx, this.currentKeystroke);
      }

      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }
}
```

### 5.2 MediaRecorder & Encoding Options
- **Container**: WebM (`video/webm;codecs=vp9,opus`) with MP4 export fallback (`video/mp4;codecs=avc1.4d002a,mp4a.40.2`).
- **Bitrate**: Dynamic bitrate allocation ($4.5\text{ Mbps} - 8.0\text{ Mbps}$ for crisp $1080\text{p}60$).
- **Timeslice Chunking**: Saves recording chunks every $1000\text{ms}$ into IndexedDB so video is never lost even if the tab accidentally crashes.

---

## 6. Multi-Platform Live Streaming & App Linking Architecture

Live streaming from a browser extension directly to platforms like **YouTube Live**, **Twitch**, **LinkedIn Live**, and **Kick** requires handling platform authentication (OAuth2), stream key management, and protocol bridges (WebRTC WHIP / RTMP).

```mermaid
flowchart LR
    subgraph Synqto Extension Studio
        Comp[Canvas/WebGL Compositor] --> Enc[WebCodecs / MediaStream]
        Auth[OAuth2 Account Manager<br/>YouTube / Twitch] --> API[Platform REST APIs]
    end

    subgraph Synqto Ingestion Layer
        Enc -->|WHIP / WebRTC| WHIP[WHIP Ingest Server]
        Enc -->|WebTransport / Pion| GW[Go RTMP Streaming Gateway]
    end

    subgraph Streaming Destinations
        WHIP -->|Direct WebRTC| TW_W[Twitch WHIP Ingest]
        WHIP -->|Direct WebRTC| CF[Cloudflare Stream / Livepeer]
        GW -->|RTMP: rtmp://a.rtmp.youtube.com/live2| YT[🔴 YouTube Live Broadcast]
        GW -->|RTMP: rtmp://live.twitch.tv/app| TW[🟣 Twitch Channel]
        GW -->|RTMP: rtmps://...| IN[💼 LinkedIn Live / Kick / X]
    end
```

### 6.1 App Linking & Account Connection (OAuth2)
To make streaming as frictionless as possible, Synqto provides a **1-Click Connect** interface:

| Platform | Authentication / App Link Scope | Capabilities Enabled |
| :--- | :--- | :--- |
| **YouTube Live** | Google OAuth2 (`youtube.force-ssl`) | Auto-creates scheduled or instant live broadcasts, fetches RTMP stream keys, streams live chat into Synqto, and displays live viewer counts. |
| **Twitch** | Twitch OAuth2 (`channel:manage:broadcast`, `chat:read`) | Automatically sets stream category (*Software & Game Development*), updates stream title, fetches ingest endpoints, and embeds Twitch IRC chat. |
| **LinkedIn Live** | LinkedIn Live API / RTMP Stream Key | Broadcasts tech tutorials and resume review workshops to professional networks. |
| **Custom RTMP / WHIP** | Direct `rtmp://` / `https://` Ingest URL + Key | Stream to Kick, Twitter/X, Facebook Live, Restream.io, or private RTMP servers. |

### 6.2 Browser-to-RTMP Transmission Protocols
Because browsers cannot open raw TCP sockets to RTMP port 1935 directly, Synqto implements two high-performance protocols:

1. **Protocol A — Native WHIP (WebRTC HTTP Ingestion Protocol)**:
   - Modern streaming standard supported natively by Twitch, Cloudflare Stream, and Livepeer.
   - Pushes WebRTC stream directly over HTTP `POST` requests.
   - **Zero server bridge needed** — ultra-low latency ($< 500\text{ms}$).
2. **Protocol B — Synqto Go RTMP Gateway (Pion WebRTC + FFmpeg)**:
   - For platforms requiring RTMP/RTMPS (like YouTube and LinkedIn), the Synqto Go Server acts as a lightweight streamer.
   - Receives the browser's WebRTC stream and repackages it into RTMP packets sent to the destination platform.
   - Supports **Simulcasting**: Broadcasts to YouTube, Twitch, and Synqto P2P Study Rooms simultaneously with 1 single upload stream from the user!

### 6.3 Unified Multi-Platform Chat & Stream HUD
When streaming live, creators can toggle a non-intrusive stream overlay:
- **Unified Chat Box**: Aggregates YouTube live messages, Twitch chat, and Synqto room peer messages into a single dark-mode floating chat widget.
- **Stream Alerts**: Animated toast overlay for new YouTube subscribers, Twitch followers, or Synqto peer room joins.
- **Stream Health Indicator**:
  - Live FPS counter ($60\text{ FPS}$).
  - Output bitrate monitor ($6000\text{ kbps}$).
  - Dropped frame alarm & audio volume VU meter.

---

## 7. Integration with Synqto Diary & Journal

When recording finishes:
1. **Instant Preview Modal**: Playback with seekbar, duration, file size, and trim controls.
2. **1-Click Download**: Saves file as `leetcode-two-sum-walkthrough-2026-08-15.mp4`.
3. **Diary Attachment**: Automatically creates or updates the problem's **Diary Page** with:
   - Video duration & thumbnail preview.
   - Markdown summary with timestamped notes (e.g. `01:24 - Hash map approach`, `03:45 - Complexity analysis`).
   - Attached whiteboard architecture drawings.

---

## 8. Engineering Roadmap & Milestones

| Milestone | Deliverables | Target Timeline |
| :--- | :--- | :--- |
| **Phase 1: Ingestion & Core Mixer** | Screen capture, tab capture, webcam stream, Web Audio mixer with audio ducking. | Sprint 1 |
| **Phase 2: Layout Compositor & Shapes** | WebGL/2D Compositor, 4 layout presets, Circle/Squircle shapes, draggable positioning. | Sprint 2 |
| **Phase 3: Smart FX & Auto-Fade** | Mouse proximity fade, smart corner dodge, mouse click ripples, keystroke HUD. | Sprint 3 |
| **Phase 4: Multi-Platform Live Streaming** | YouTube & Twitch OAuth app linking, WHIP / Go RTMP gateway, unified live chat. | Sprint 4 |
| **Phase 5: Diary Integration & Export** | Fast MP4 remuxing, IndexedDB crash recovery, 1-click export to Synqto Diary note. | Sprint 5 |

---

## 9. Summary
This studio engine transforms Synqto into a self-contained, professional broadcast and tutorial creation platform for students, tutors, competitive programmers, and content creators.
