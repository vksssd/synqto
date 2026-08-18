// ─── Network Packet Schema ───
// All P2P data flows as NetworkPacket instances over WebRTC DataChannels.

import { HLC, globalClock } from './hybrid-clock';

export type PacketType =
  | 'chat:message'
  | 'chat:ack'
  | 'chat:read'
  | 'chat:reaction'
  | 'chat:poll:vote'
  | 'chat:quiz:answer'
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
  | 'stage:hand_lower'
  | 'stream:announce'
  | 'stream:stopped'
  | 'whiteboard:stroke'
  | 'whiteboard:strokes_batch'
  | 'whiteboard:temp_stroke'
  | 'whiteboard:clear'
  | 'whiteboard:undo'
  | 'whiteboard:background'
  | 'whiteboard:laser'
  | 'whiteboard:page_sync'
  | 'whiteboard:sync_request'
  | 'whiteboard:sync_response'
  | 'canvas:cursor'
  | 'canvas:click'
  | 'code:sync'
  | 'code:delta'
  | 'code:cursor'
  | 'code:run'
  | 'code:run_result'
  | 'code:lang_change'
  | 'community:wave'
  | 'community:poke'
  | 'community:problem_mention'
  | 'sync:request'
  | 'sync:response'
  | 'sync:digest'
  | 'sync:delta_request'
  | 'sync:delta_response'
  | 'topology:digest'
  | 'signal:peer'
  | 'link:lsa'
  | 'link:lsdb_sync'
  | 'link:probe'
  | 'link:pong'
  | 'relay:packet'
  | 'transport:ack'
  | 'transport:nack'
  | 'transport:gap_repair'
  | 'chunk:data'
  | 'state:op'
  | 'state:sync_request'
  | 'state:sync_response'
  | 'state:snapshot_request'
  | 'state:snapshot_response';

export type PacketPriority = 'CONTROL' | 'CHAT' | 'SYNC' | 'MEDIA' | 'BULK';

/** Identity information attached to every packet. */
export interface PeerIdentity {
  peerId: string;
  nickname: string;
  avatar: string;
  color: string;
}

/**
 * Deterministic packet identifier formatting: roomId:sourcePeerId:seq
 */
export function generatePacketId(roomId: string, sourcePeerId: string, seq: number): string {
  return `${roomId}:${sourcePeerId}:${seq}`;
}

export interface AckPayload {
  ackId: string;
  ackFor: string;
  fromPeerId: string;
  streamId?: string;
  seq?: number;
  timestamp: number;
}

export interface NackPayload {
  nackId: string;
  nackFor: string;
  fromPeerId: string;
  reason: 'BUFFER_OVERFLOW' | 'EPOCH_REJECTED' | 'UNSUPPORTED' | 'RATE_LIMITED';
  streamId?: string;
  seq?: number;
}

export interface GapRepairPayload {
  streamId: string;
  fromPeerId: string;
  missingRangeStart: number;
  missingRangeEnd: number;
}

export interface ChunkPayload {
  transferId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
  checksum: number;
  originalType: PacketType;
  byteLength: number;
}

// ─── P3 State Replication Protocol Wire Payloads ───

export interface StateOpPayload<TOp = unknown> {
  storeId: string;
  opId: string; // ${author}:${seq}:${lamport}
  author: string;
  seq: number;
  lamport: number;
  dependencies: string[]; // Causal predecessor opIds
  type: string;
  op: TOp;
  timestamp: number;
  topologyEpoch?: number;
  /**
   * The BROADCASTER's contiguous vector clock at send time (not the author's).
   *
   * This piggybacks anti-entropy state onto ordinary traffic so every peer keeps a
   * live view of what its neighbours have durably received. Without it, peer vectors
   * were only ever learned from explicit sync requests, so during normal mutation
   * traffic BoundedMemoryManager never had a vector for every active participant and
   * always fell back to a purely local tail cut — compacting away operations that
   * other peers had not yet seen, which is unrecoverable once truncated.
   *
   * Contiguous (not raw) because only a gap-free prefix is safe to treat as "received".
   */
  senderVector?: Record<string, number>;
}

export interface StateSyncRequestPayload {
  storeId: string;
  requestingPeerId: string;
  vectorClock: Record<string, number>;
  lastKnownSnapshotVersion?: number;
}

export interface StateSyncResponsePayload<TOp = unknown> {
  storeId: string;
  targetPeerId: string;
  missingEvents: StateOpPayload<TOp>[];
  requiresSnapshot: boolean;
  snapshotVersion?: number;
  vectorClock: Record<string, number>;
}

export interface StateSnapshotRequestPayload {
  storeId: string;
  requestingPeerId: string;
  currentVector: Record<string, number>;
}

export interface StateSnapshotPayload<TState = unknown> {
  storeId: string;
  snapshotVersion: number;
  vectorClock: Record<string, number>;
  state: TState;
  checksum: number; // IEEE 802.3 CRC32
  byteLength: number;
  timestamp: number;
}

/**
 * NetworkPacket is the universal wire format for all P2P and relay communication.
 *
 * TTL (Time To Live) prevents infinite relay loops in multi-tier topologies.
 * Each relay hop decrements TTL by 1. Packets with TTL ≤ 0 are dropped.
 */
export interface NetworkPacket {
  /** Unique packet ID for transport deduplication (roomId:sourcePeerId:seq or UUID). */
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
  /** Monotonic timestamp (Date.now()). */
  timestamp: number;
  /** Hop counter — decremented by each relay, dropped at 0. */
  ttl: number;
  /** Traffic priority class */
  priority?: PacketPriority;
  /** Channel routing priority: 'control' for low-latency reliable, 'bulk' for large streams/blobs. */
  channelPriority?: 'control' | 'bulk';
  /** Logical stream ID for stream-scoped ordering (e.g. 'chat', 'whiteboard', 'code'). */
  streamId?: string;
  /** Monotonically increasing sequence number from the originating peer within stream. */
  seq?: number;
  /** Logical Lamport clock for deterministic causal ordering of application events. */
  lamportTime?: number;
  /**
   * Hybrid logical timestamp — the field receivers should sort on.
   *
   * `timestamp` above is a raw Date.now() from the sender's machine and is NOT safely
   * sortable across peers: clock skew routinely reorders it, so a reply can land before the
   * message it answers. `hlc` carries the same wall-clock meaning while remaining causally
   * correct. See core/network/hybrid-clock.ts.
   *
   * Optional only for wire compatibility with pre-0.5 peers; every packet this client sends
   * has it.
   */
  hlc?: HLC;
  /** Topology epoch under which this packet was created. */
  topologyEpoch?: number;
}

/** Default TTL for new packets. */
export const DEFAULT_TTL = 3;

/** Create a new NetworkPacket with sensible defaults. */
export function createPacket(
  type: PacketType,
  from: PeerIdentity,
  roomId: string,
  payload: unknown,
  to?: string,
  options?: {
    channelPriority?: 'control' | 'bulk';
    priority?: PacketPriority;
    streamId?: string;
    seq?: number;
    lamportTime?: number;
    topologyEpoch?: number;
  }
): NetworkPacket {
  const isBulk =
    options?.channelPriority === 'bulk' ||
    type === 'whiteboard:page_sync' ||
    type === 'whiteboard:sync_response' ||
    type === 'chat:history:response' ||
    type === 'sync:delta_response' ||
    type === 'chunk:data';

  const defaultPriority: PacketPriority =
    options?.priority ||
    (type.startsWith('presence:') || type.startsWith('sync:') || type.startsWith('transport:')
      ? 'CONTROL'
      : type.startsWith('chat:')
      ? 'CHAT'
      : isBulk
      ? 'BULK'
      : 'SYNC');

  const id = options?.seq !== undefined
    ? generatePacketId(roomId, from.peerId, options.seq)
    : typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `pkt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  return {
    id,
    type,
    from,
    to,
    roomId,
    payload,
    timestamp: Date.now(),
    // Stamped here rather than at each call site: createPacket is the single chokepoint
    // every outbound packet passes through, so this is the only place that can guarantee
    // no packet type is ever missed.
    hlc: globalClock.tick(),
    ttl: DEFAULT_TTL,
    priority: defaultPriority,
    channelPriority: options?.channelPriority || (isBulk ? 'bulk' : 'control'),
    streamId: options?.streamId,
    seq: options?.seq,
    lamportTime: options?.lamportTime,
    topologyEpoch: options?.topologyEpoch ?? 1,
  };
}

// ─── Chat-specific payload types ───

export type ChatMessageType = 'text' | 'image' | 'screenshot' | 'code' | 'poll' | 'quiz' | 'file';

export interface CodeSnippetData {
  code: string;
  language: string;
  title?: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: string[]; // array of peerIds
}

export interface PollData {
  id: string;
  question: string;
  options: PollOption[];
  isMultiChoice?: boolean;
  expiresAt?: number;
}

export interface QuizData {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
  answers: Record<string, number>; // peerId -> selectedOptionIndex
}

export interface FileAttachmentData {
  name: string;
  size: number;
  type: string;
  dataUrl: string;
}

export interface ChatMessagePayload {
  messageId: string;
  text: string;
  messageType?: ChatMessageType;
  replyTo?: string;
  replyPreview?: string;
  imageUrl?: string;
  imageCaption?: string;
  codeSnippet?: CodeSnippetData;
  poll?: PollData;
  quiz?: QuizData;
  fileAttachment?: FileAttachmentData;
  mentions?: string[]; // array of peerIds or 'everyone'
  reactions?: Record<string, string[]>; // emoji -> array of peerIds
}

export interface ChatReactionPayload {
  messageId: string;
  emoji: string;
  remove?: boolean;
}

export interface ChatPollVotePayload {
  messageId: string;
  pollId: string;
  optionId: string;
  isMultiChoice?: boolean;
}

export interface ChatQuizAnswerPayload {
  messageId: string;
  quizId: string;
  selectedOptionIndex: number;
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
  messageType?: ChatMessageType;
  replyTo?: string;
  replyPreview?: string;
  imageUrl?: string;
  imageCaption?: string;
  codeSnippet?: CodeSnippetData;
  poll?: PollData;
  quiz?: QuizData;
  fileAttachment?: FileAttachmentData;
  mentions?: string[];
  reactions?: Record<string, string[]>;
  status?: 'pending' | 'sent' | 'delivered' | 'read';
  /**
   * Ordering keys must survive persistence.
   *
   * Without these, every message restored from chrome.storage on reload came back with no
   * ordering key and was sorted purely by raw epoch-ms against live messages that had one —
   * so reopening a room could rearrange the whole conversation.
   */
  seq?: number;
  lamportTime?: number;
  hlc?: HLC;
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

// ─── Anti-Entropy Delta Sync payload types ───

export interface SyncDigestPayload {
  lastSeqByPeer: Record<string, number>;
  latestLamport: number;
}

export interface SyncDeltaRequestPayload {
  peerId: string;
  sinceSeq: number;
}

export interface SyncDeltaResponsePayload {
  messages: StoredChatMessage[];
  latestLamport: number;
}

// ─── Code Together Collaborative Coding payload types ───

export interface CodeSyncPayload {
  code: string;
  language: string;
  version: number;
  updatedBy: string;
  timestamp: number;
}

export interface CodeDeltaPayload {
  code: string;
  language: string;
  version: number;
  cursorLine?: number;
  cursorCol?: number;
}

export interface CodeCursorPayload {
  peerId: string;
  nickname: string;
  color: string;
  line: number;
  ch: number;
}

export interface CodeRunPayload {
  code: string;
  language: string;
  input?: string;
  initiatedBy: string;
}

export interface CodeRunResultPayload {
  stdout: string;
  stderr?: string;
  executionTimeMs: number;
  status: 'success' | 'error' | 'timeout';
}
