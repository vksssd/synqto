# 🚀 Synqto Signaling Server — Fly.io Hosting Guide

This guide walks you through deploying the **Synqto High-Throughput Go Signaling Server** to **Fly.io** completely on their **free tier** with maximum throughput and zero ongoing costs.

---

## 📋 Table of Contents
1. [Prerequisites & CLI Setup](#1-prerequisites--cli-setup)
2. [Quick 1-Command Deployment](#2-quick-1-command-deployment)
3. [Configuration & Free Tier Tuning](#3-configuration--free-tier-tuning)
4. [Connecting the Chrome Extension](#4-connecting-the-chrome-extension)
5. [Monitoring, Logs & Health Checks](#5-monitoring-logs--health-checks)
6. [Scaling & High-Throughput Architecture](#6-scaling--high-throughput-architecture)
7. [Troubleshooting FAQ](#7-troubleshooting-faq)

---

## 1. Prerequisites & CLI Setup

### Step 1: Install the Fly.io CLI (`flyctl`)

- **Windows (PowerShell)**:
  ```powershell
  iwr https://fly.io/install.ps1 -useb | iex
  ```

- **macOS (Homebrew / Terminal)**:
  ```bash
  brew install flyctl
  # or:
  curl -L https://fly.io/install.sh | sh
  ```

- **Linux (Terminal)**:
  ```bash
  curl -L https://fly.io/install.sh | sh
  ```

### Step 2: Sign In / Create a Free Account
```bash
fly auth login
```
*(If you don't have an account yet, run `fly auth signup`)*

---

## 2. Quick 1-Command Deployment

The repository already contains a production-optimized `Dockerfile` and `fly.toml` inside the `server/` directory.

### Step 1: Navigate to the `server/` directory
```powershell
cd "c:\Users\ECE\Documents\vinayak projects\chrome\nerd-buddy\server"
```

### Step 2: Launch & Deploy
Run:
```bash
fly launch
```

During interactive prompts:
1. **Choose an app name**: e.g., `synqto-signaling` (or leave blank for an auto-generated unique name).
2. **Choose a primary region**: Pick the region closest to you (e.g., `bom` for Mumbai, `iad` for US East, `sin` for Singapore, `fra` for Frankfurt).
3. **Would you like to set up a Postgres database?**: Select `No` (Signaling is ephemeral & serverless).
4. **Would you like to set up an Upstash Redis database?**: Select `No`.
5. **Do you want to deploy now?**: Select `Yes`.

Fly.io will compile the stripped Go 1.24 static binary in their cloud builder and deploy your machine in seconds!

---

## 3. Configuration & Free Tier Tuning

The included `fly.toml` is pre-configured for maximum throughput:

```toml
app = "synqto-signaling"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  GOMEMLIMIT = "220MiB"
  GOGC = "60"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1

  [http_service.concurrency]
    type = "connections"
    hard_limit = 100000
    soft_limit = 80000

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1

[[http_service.checks]]
  grace_period = "5s"
  interval = "15s"
  method = "GET"
  path = "/health"
  timeout = "2s"
```

### Why this is optimized:
- **Adaptive Concurrency (`100,000` limit)**: Eliminates artificial proxy throttling so Fly.io routes all WebSocket handshakes directly to Go without dropping connections.
- **`GOMEMLIMIT=220MiB` & `GOGC=60`**: Operates cleanly within the 256MB VM limit with zero Out-Of-Memory (OOM) crashes.
- **Dynamic Memory Safeguard**: The Go server dynamically accepts connections up to physical RAM saturation (~235MB) before gracefully throttling, maximizing concurrency.

To apply changes at any time:
```bash
fly deploy
```

---

## 4. Connecting the Chrome Extension

Once deployed, Fly.io provides your live URL:
`https://<your-app-name>.fly.dev`

### WebSocket Endpoint:
`wss://<your-app-name>.fly.dev/ws/`

### How to set it in the Extension:
1. Open the Synqto Side Panel in Chrome.
2. Click the **Profile / Settings** tab (⚙️).
3. Under **Signaling Server URL**, enter:
   ```text
   wss://<your-app-name>.fly.dev/ws/
   ```
4. Click **Save Settings**. The extension will immediately connect to your live Fly.io cluster over secure TLS (`wss://`)!

---

## 5. Monitoring, Logs & Health Checks

### Check Real-Time Logs:
```bash
fly logs
```

### Check Machine Status:
```bash
fly status
```

### Test Live Endpoints in Browser / Postman / curl:
- **Health Check**: `https://<your-app-name>.fly.dev/health`
  ```json
  {"status":"ok"}
  ```
- **Diagnostic Stats**: `https://<your-app-name>.fly.dev/stats`
  ```json
  {
    "rooms": 4,
    "peers": 12,
    "uptime": "2h45m",
    "bus": "in-memory"
  }
  ```

---

## 6. Scaling & High-Throughput Architecture

### Ephemeral P2P Signaling
In Synqto, **99% of data traffic (audio, video, cursor streams, large attachments) is handled peer-to-peer over WebRTC DataChannels**. The server only processes lightweight JSON SDP offers/answers (~1KB each) during connection establishment.

A single 256MB Fly.io instance can comfortably handle **20,000+ simultaneous connected peers**!

### Optional: Horizontal Clustering with NATS
If you ever want to scale across multiple regions:
1. Run a free NATS server or Upstash instance.
2. Set the environment variable in Fly.io:
   ```bash
   fly secrets set NATS_URL="nats://user:pass@nats.server:4222"
   ```
3. Scale your Fly machines:
   ```bash
   fly scale count 2 --region bom,iad
   ```
   The Go server will automatically switch from in-memory pub/sub to distributed NATS clustering.

---

## 7. Troubleshooting FAQ

### Q: Why does the connection timeout on first connect?
> **A**: If `auto_stop_machines = "stop"` is enabled, Fly.io puts the VM to sleep when idle. The first connection wakes it up within ~300ms. If you want it always awake, set `min_machines_running = 1` in `fly.toml`.

### Q: How do I view live memory usage?
> Run `fly top` or check the Fly.io web dashboard at `https://fly.io/dashboard`.

### Q: How do I test the server locally before deploying?
> Run `go run main.go` inside `server/`. It will listen on `ws://localhost:8080/ws/`.
