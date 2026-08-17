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

export const TOPOLOGY_THRESHOLDS = {
  TIER1_MAX: 4,
  TIER1_PROMOTE_AT: 5,
  TIER1_DEMOTE_AT: 3,

  TIER2_MAX: 19,
  TIER2_PROMOTE_AT: 20,
  TIER2_DEMOTE_AT: 15,

  MIN_LEADERS: 3,
  MAX_LEADERS: 5,
  PROMOTION_SCORE_MARGIN: 10, // Candidate must exceed incumbent by 10 points to replace healthy leader
} as const;

export const TOPOLOGY_TIMERS = {
  PROMOTION_STABILITY_MS: 10_000,   // 10s sustained count before promoting tier
  DEMOTION_STABILITY_MS: 30_000,    // 30s sustained count before demoting tier
  LEADER_HEARTBEAT_MS: 3_000,       // Leaders broadcast control digest every 3s
  LEADER_SUSPECT_TIMEOUT_MS: 6_000, // Suspect after 6s of silence (2 missed beats)
  LEADER_FAILURE_TIMEOUT_MS: 10_000,// Declare failed after 10s of silence
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
