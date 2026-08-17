// ─── Universal Network Envelope & Delivery Guarantees ───

import { MessageId, RoomId, PeerId, SessionId, TopologyEpoch } from '../types/identifiers';
import { PeerIdentity, PacketType, NetworkPacket } from './packet';

export type DeliveryClass = 'ephemeral' | 'bestEffort' | 'reliable' | 'durable';

export interface NetworkEnvelope<T = unknown> {
  /** Unique message / envelope identifier for tracking and deduplication */
  messageId: MessageId;
  /** Collaborative room or namespace */
  roomId: RoomId;
  /** Originating peer identity */
  from: PeerIdentity;
  /** Target peer for directed/unicast packets, undefined for broadcast */
  targetPeerId?: PeerId;
  /** Discriminated packet / operation type */
  type: PacketType | string;
  /** Delivery guarantee class */
  delivery: DeliveryClass;
  /** Monotonic sequence counter from sender */
  seq?: number;
  /** Lamport logical clock for causal ordering */
  lamport?: number;
  /** Topology epoch when envelope was originated */
  topologyEpoch?: TopologyEpoch;
  /** Hop countdown to prevent relay loops */
  ttl: number;
  /** Creation epoch timestamp (ms) */
  createdAt: number;
  /** Sender runtime session ID */
  senderSessionId?: SessionId;
  /** Payload object */
  payload: T;
}

export const DEFAULT_TTL = 3;

/**
 * Creates a standard NetworkEnvelope with delivery semantics
 */
export function createEnvelope<T = unknown>(params: {
  type: PacketType | string;
  from: PeerIdentity;
  roomId: RoomId;
  payload: T;
  delivery?: DeliveryClass;
  targetPeerId?: PeerId;
  seq?: number;
  lamport?: number;
  topologyEpoch?: TopologyEpoch;
  ttl?: number;
  senderSessionId?: SessionId;
  messageId?: MessageId;
}): NetworkEnvelope<T> {
  // Infer delivery class if not explicitly provided
  const inferredDelivery: DeliveryClass =
    params.delivery ?? inferDeliveryClass(params.type);

  return {
    messageId: params.messageId ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    roomId: params.roomId,
    from: params.from,
    targetPeerId: params.targetPeerId,
    type: params.type,
    delivery: inferredDelivery,
    seq: params.seq,
    lamport: params.lamport,
    topologyEpoch: params.topologyEpoch,
    ttl: params.ttl ?? DEFAULT_TTL,
    createdAt: Date.now(),
    senderSessionId: params.senderSessionId,
    payload: params.payload,
  };
}

/**
 * Helper to determine delivery class based on packet type
 */
export function inferDeliveryClass(type: string): DeliveryClass {
  if (
    type === 'canvas:cursor' ||
    type === 'canvas:click' ||
    type === 'whiteboard:laser' ||
    type === 'whiteboard:temp_stroke' ||
    type === 'code:cursor'
  ) {
    return 'ephemeral';
  }

  if (
    type.startsWith('presence:') ||
    type.startsWith('community:') ||
    type === 'stage:hand_raise'
  ) {
    return 'bestEffort';
  }

  if (
    type.startsWith('chat:') ||
    type.startsWith('voice:') ||
    type.startsWith('stage:') ||
    type.startsWith('sync:')
  ) {
    return 'reliable';
  }

  if (
    type.startsWith('code:') ||
    type.startsWith('whiteboard:') ||
    type.startsWith('group:')
  ) {
    return 'durable';
  }

  return 'bestEffort';
}

/**
 * Converts a NetworkEnvelope to a backward-compatible NetworkPacket
 */
export function envelopeToPacket(env: NetworkEnvelope): NetworkPacket {
  return {
    id: env.messageId,
    type: env.type as PacketType,
    from: env.from,
    to: env.targetPeerId,
    roomId: env.roomId,
    payload: env.payload,
    timestamp: env.createdAt,
    ttl: env.ttl,
    seq: env.seq,
    lamportTime: env.lamport,
    channelPriority: env.delivery === 'durable' ? 'bulk' : 'control',
  };
}
