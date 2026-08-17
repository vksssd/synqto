// ─── Adaptive Topology Types & Threshold Constants ───

import { PeerId, RoomId, TopologyEpoch } from '../types/identifiers';
import { VectorClock } from '../replication/vector-clock';

export type TopologyTier = 'TIER1_FULL_MESH' | 'TIER2_MULTI_LEADER' | 'TIER3_SERVER_RELAY';

export type TopologyLifecycleState =
  | 'STABLE_TIER1'
  | 'TIER1_EVALUATING'
  | 'TIER2_PREPARING'
  | 'STABLE_TIER2'
  | 'TIER3_PREPARING'
  | 'STABLE_TIER3'
  | 'TIER3_DEMOTING'
  | 'TIER2_DEMOTING';

export type LeaderHealthStatus = 'HEALTHY' | 'SUSPECTED' | 'FAILED';

/**
 * Tier capacity thresholds and their hysteresis margins.
 *
 * ARCHITECTURE — there are exactly THREE topology tiers, and the tier is a statement
 * about *what topology the room runs*, not about how many sockets the server can hold:
 *
 *   TIER1_FULL_MESH     small groups   every peer connects to every other peer
 *   TIER2_MULTI_LEADER  medium groups  clustered mesh with a leader backbone
 *   TIER3_SERVER_RELAY  large groups   server joins the data path
 *
 * TIER3 is the scalability escape hatch. Growth beyond TIER2 is absorbed by moving a
 * room INTO relay mode, NOT by stretching TIER2 to hold more peers. Server capacity and
 * room topology capacity are independent concerns: the signaling server comfortably
 * holds thousands of connections (see SERVER_AUDIT_AND_CAPACITY.md), but that says
 * nothing about how many RTCPeerConnections a browser can sustain inside one room.
 *
 * SIZING — raised in P3.9 on the strength of the post-fix measurements, and shaped by the
 * production target of a 512 MB / 0.1 vCPU instance:
 *
 * TIER1 4 -> 8. Every peer holds N-1 RTCPeerConnections, so per-peer cost is O(N).
 * Data-channel-only connections are far cheaper than media ones, and 8 keeps each peer at
 * 7 connections — comfortably inside what a browser sustains. Raising TIER1 is also the
 * single best lever for the constrained server: rooms that stay in full mesh never consult
 * the server for topology at all beyond initial signaling.
 *
 * TIER2 19 -> 50. Post-fix the roster broadcast is O(N) and drops zero state messages
 * through 500 peers/room, so the previous ceiling was set by a defect rather than by the
 * architecture. 50 matches the measured safe band with margin.
 *
 * TIER3 remains the escape hatch: growth past TIER2 is absorbed by moving a room INTO
 * relay mode, never by stretching TIER2 further.
 *
 * CPU CAVEAT (0.1 vCPU): the binding constraint on a Render free instance is CPU, not
 * memory. Roster fan-out is O(N) work per membership change and is serialised on a tenth
 * of a core, so a room's CHURN rate matters as much as its size. The wide hysteresis below
 * exists partly for this reason — every avoided tier migration is a burst of renegotiation
 * the server does not have the CPU budget to absorb.
 *
 * MARGINS: each tier's demote threshold sits well below its promote threshold so a room
 * hovering at a boundary cannot oscillate. Tier migration renegotiates every DataChannel in
 * the room, so it must never be triggered by a single peer joining and leaving repeatedly.
 * The invariants these must satisfy are asserted in the test suite.
 */
export const TOPOLOGY_THRESHOLDS = {
  // ── TIER 1: Full mesh ──
  TIER1_MAX: 8,
  TIER1_PROMOTE_AT: 9, // 9+ peers => leave full mesh
  TIER1_DEMOTE_AT: 6,  // fall back only at <=6, a 3-peer margin below promotion

  // ── TIER 2: Multi-leader clustered mesh ──
  TIER2_MAX: 50,
  TIER2_PROMOTE_AT: 51, // 51+ peers => server-assisted relay (TIER3)
  TIER2_DEMOTE_AT: 38,  // fall back only at <=38, a 13-peer margin below promotion

  // ── Leader backbone ──
  // MIN_LEADERS is the Trinity quorum: 3 interconnected leaders keep a 2/3 majority
  // through a single leader loss, which a 2-leader setup cannot.
  // MAX_LEADERS rises with TIER2: at a 12-peer cluster watermark a full 50-peer room needs
  // ~5 clusters, and headroom above that avoids forcing oversized clusters during churn.
  // It is not raised further because every leader adds a backbone edge to every other
  // leader — leader-to-leader connections are O(L^2).
  MIN_LEADERS: 3,
  MAX_LEADERS: 9,

  // Candidate must exceed the incumbent by this margin to displace a healthy leader.
  // Widened with the tier margins: leader churn invalidates routes for an entire cluster,
  // which on 0.1 vCPU is an expensive burst, so a marginally better candidate is not worth
  // the disruption.
  PROMOTION_SCORE_MARGIN: 15,
} as const;

export const TOPOLOGY_TIMERS = {
  // Sustained-count windows before acting. Promotion is comparatively urgent (the room
  // is already over its tier's capacity and degrading); demotion is not, so its window
  // is longer to bias against tearing down a working topology for a transient dip.
  // These are timing/anti-flap tuning, not tier boundaries, so they are safe to widen
  // ahead of P3.9.
  PROMOTION_STABILITY_MS: 10_000,   // 10s sustained count before promoting tier
  DEMOTION_STABILITY_MS: 45_000,    // 45s sustained count before demoting tier

  LEADER_HEARTBEAT_MS: 3_000,       // Leaders broadcast control digest every 3s
  LEADER_SUSPECT_TIMEOUT_MS: 9_000, // Suspect after 9s of silence (3 missed beats)
  LEADER_FAILURE_TIMEOUT_MS: 15_000,// Declare failed after 15s (5 missed beats)
  MIGRATION_TIMEOUT_MS: 30_000,     // Grace period for dual-path migration
} as const;

export interface LeaderScoreMetrics {
  uptimeMs: number;
  rttMs: number;
  packetLossRate: number;
  batteryLevel?: number;
  isPluggedIn?: boolean;
  activeConnections: number;
}

export interface LeaderNode {
  peerId: PeerId;
  generation: number;
  level: number;
  score: number;
  assignedPeers: PeerId[];
  lastHeartbeat: number;
  health: LeaderHealthStatus;
}

export interface PeerAssignment {
  primaryLeader: PeerId;
  secondaryLeader?: PeerId;
  assignedAt: number;
}

export interface PeerRoute {
  targetPeerId: PeerId;
  leaderId: PeerId;
  topologyEpoch: TopologyEpoch;
  digestVersion: number;
  updatedAt: number;
}

export type RouteType = 'DIRECT' | 'LEADER' | 'RELAY' | 'UNKNOWN';

export interface ResolvedRoute {
  type: RouteType;
  nextHopPeerId?: PeerId;
  targetPeerId: PeerId;
  epoch: TopologyEpoch;
}

export interface LeaderDigest {
  roomId: RoomId;
  topologyEpoch: TopologyEpoch;
  leaderGeneration: number;
  digestVersion: number;
  leaderPeerId: PeerId;
  assignedClusterPeers: PeerId[];
  memberCount: number;
  vectorDigest: VectorClock;
  latestLamport: number;
  healthScore: number;
  knownLeaders: PeerId[];
  timestamp: number;
}

export interface LeaderHeartbeatPayload {
  digest: LeaderDigest;
}

export interface TopologySnapshot {
  tier: TopologyTier;
  lifecycleState: TopologyLifecycleState;
  epoch: TopologyEpoch;
  activeLeaders: PeerId[];
  primaryLeader: PeerId | null;
  secondaryLeader: PeerId | null;
  totalPeers: number;
  isLeader: boolean;
}
