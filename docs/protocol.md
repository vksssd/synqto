# 📡 Nerd Buddy — Network Protocol Specification

## 1. WebSocket Signaling Protocol (Client ↔ Go Server)

All signaling messages use a JSON envelope over WebSocket (`ws://localhost:8080/ws/{roomId}`).

### Envelope Format

```json
{
  "type": "room:join | room:leave | room:roster | signal:offer | signal:answer | signal:ice | leader:promote | leader:demote | ping | pong",
  "from": "peer-id",
  "to": "target-peer-id (optional)",
  "roomId": "room-id",
  "payload": { ... }
}
```

### Protocol Messages

#### 1. `room:join` (Client → Server)
First message sent immediately upon WebSocket connection.
```json
{
  "type": "room:join",
  "from": "nb-e7a18b2c",
  "roomId": "room:two-sum-e7a18b2c",
  "payload": {
    "peerId": "nb-e7a18b2c",
    "nickname": "SwiftFox"
  }
}
```

#### 2. `room:roster` (Server → All Room Clients)
Broadcast by the server on peer join, leave, or leader changes.
```json
{
  "type": "room:roster",
  "roomId": "room:two-sum-e7a18b2c",
  "payload": {
    "peers": [
      { "peerId": "nb-e7a18b2c", "nickname": "SwiftFox", "isLeader": true },
      { "peerId": "nb-8b2cf10a", "nickname": "AsyncCheetah", "isLeader": false }
    ],
    "leaders": ["nb-e7a18b2c"],
    "yourLeader": "nb-e7a18b2c"
  }
}
```

#### 3. `leader:promote` (Server → Newly Elected Leader)
Notifies a regular peer that they have been promoted to Group Leader.
```json
{
  "type": "leader:promote",
  "roomId": "room:two-sum-e7a18b2c",
  "payload": {
    "clusterPeers": ["nb-12345678", "nb-87654321"],
    "backboneLeaders": ["nb-e7a18b2c"]
  }
}
```

#### 4. `signal:offer`, `signal:answer`, `signal:ice` (Client ↔ Server ↔ Client)
SDP and ICE candidate relays. The server transparently forwards these to the peer specified in `to`.
```json
{
  "type": "signal:offer",
  "from": "nb-8b2cf10a",
  "to": "nb-e7a18b2c",
  "roomId": "room:two-sum-e7a18b2c",
  "payload": {
    "sdp": { "type": "offer", "sdp": "v=0\r\no=- ..." }
  }
}
```

---

## 2. P2P Data Protocol (WebRTC DataChannels)

All peer-to-peer data flows directly over WebRTC DataChannels formatted as `NetworkPacket`:

```typescript
export interface NetworkPacket {
  id: string;              // UUID for deduplication
  type: PacketType;        // Discriminator
  from: PeerIdentity;      // Sender info
  to?: string;             // Optional target peer ID
  roomId: string;          // Room ID
  payload: unknown;        // Typed payload
  timestamp: number;       // Sender timestamp (ms)
  ttl: number;             // Hop counter (default 3)
}
```

### Packet Types

| Packet Type | Description | Payload Schema |
| :--- | :--- | :--- |
| `chat:message` | Rich chat message | `{ messageId, text, replyTo?, replyPreview? }` |
| `chat:ack` | Delivery receipt (✓✓) | `{ messageId }` |
| `chat:read` | Read receipt (✓✓ blue) | `{ messageId }` |
| `chat:history:request` | History catch-up request | `{ sinceTimestamp }` |
| `chat:history:response` | History response batch | `{ messages: StoredChatMessage[] }` |
| `presence:ping` | 5s presence heartbeat | `{ status, problemTitle?, problemUrl?, startedAt }` |
| `presence:join` | Peer entry announcement | `{ status, startedAt }` |
| `presence:leave` | Peer exit announcement | `{}` |
| `community:wave` | Interactive wave 👋 | `{ text?: string }` |
| `community:poke` | Interactive poke 👉 | `{ text?: string }` |
