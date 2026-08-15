// ─── Network Packet Schema ───
// All P2P data flows as NetworkPacket instances over WebRTC DataChannels.

export type PacketType =
  | 'chat:message'
  | 'chat:ack'
  | 'chat:read'
  | 'chat:history:request'
  | 'chat:history:response'
  | 'presence:join'
  | 'presence:ping'
  | 'presence:leave'
  | 'presence:update'
  | 'voice:offer'
  | 'voice:answer'
  | 'voice:ice'
  | 'voice:hangup'
  | 'stage:state'
  | 'stage:hand_raise'
  | 'stage:hand_response'
  | 'canvas:cursor'
  | 'canvas:click'
  | 'community:wave'
  | 'community:poke'
  | 'community:problem_mention'
  | 'sync:request'
  | 'sync:response';

/** Identity information attached to every packet. */
export interface PeerIdentity {
  peerId: string;
  nickname: string;
  avatar: string;
  color: string;
}

/**
 * NetworkPacket is the universal wire format for all P2P communication.
 *
 * TTL (Time To Live) prevents infinite relay loops in the leader backbone.
 * Each relay hop decrements TTL by 1. Packets with TTL ≤ 0 are dropped.
 * Default TTL = 3: peer → leader → backbone leader → destination peer.
 */
export interface NetworkPacket {
  /** Unique packet ID for deduplication. */
  id: string;
  /** Discriminated packet type. */
  type: PacketType;
  /** Sender identity. */
  from: PeerIdentity;
  /** Target peer ID for directed messages. Omit/null for broadcast. */
  to?: string;
  /** Room this packet belongs to. */
  roomId: string;
  /** Packet-specific payload data. */
  payload: unknown;
  /** Monotonic-ish timestamp (Date.now()). */
  timestamp: number;
  /** Hop counter — decremented by each relay, dropped at 0. */
  ttl: number;
}

/** Default TTL for new packets. */
export const DEFAULT_TTL = 3;

/** Create a new NetworkPacket with sensible defaults. */
export function createPacket(
  type: PacketType,
  from: PeerIdentity,
  roomId: string,
  payload: unknown,
  to?: string
): NetworkPacket {
  return {
    id: crypto.randomUUID(),
    type,
    from,
    to,
    roomId,
    payload,
    timestamp: Date.now(),
    ttl: DEFAULT_TTL,
  };
}

// ─── Chat-specific payload types ───

export interface ChatMessagePayload {
  messageId: string;
  text: string;
  replyTo?: string;
  replyPreview?: string;
}

export interface ChatAckPayload {
  messageId: string;
}

export interface ChatHistoryPayload {
  sinceTimestamp: number;
}

export interface ChatHistoryResponsePayload {
  messages: StoredChatMessage[];
}

export interface StoredChatMessage {
  id: string;
  from: PeerIdentity;
  text: string;
  timestamp: number;
  replyTo?: string;
  replyPreview?: string;
}

// ─── Presence payload types ───

export type PeerStatus =
  | 'solving'
  | 'reading'
  | 'watching'
  | 'discussing'
  | 'stuck'
  | 'submitted'
  | 'idle';

export interface PresencePayload {
  status: PeerStatus;
  problemTitle?: string;
  problemUrl?: string;
  startedAt?: number;
}
