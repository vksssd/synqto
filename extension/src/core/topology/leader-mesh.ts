// ─── Multi-Leader Control Plane Mesh & Health Monitor ───

import { PeerId, RoomId, TopologyEpoch } from '../types/identifiers';
import {
  LeaderNode,
  LeaderDigest,
  LeaderHealthStatus,
  PeerAssignment,
  TOPOLOGY_TIMERS,
  TOPOLOGY_THRESHOLDS,
} from './topology.types';
import { VectorClock } from '../replication/vector-clock';

export class LeaderMesh {
  private leaders: Map<PeerId, LeaderNode> = new Map();
  private peerAssignments: Map<PeerId, PeerAssignment> = new Map();
  private heartbeatInterval: any = null;
  private healthCheckInterval: any = null;

  private onDigestBroadcastFn: ((digest: LeaderDigest) => void) | null = null;
  private onLeaderFailureCallback: ((failedPeerId: PeerId) => void) | null = null;

  constructor(
    private readonly myPeerId: PeerId,
    private readonly roomId: RoomId,
    private getVectorClockFn: () => VectorClock,
    private getLamportTimeFn: () => number
  ) {}

  public bindDigestBroadcast(sender: (digest: LeaderDigest) => void): void {
    this.onDigestBroadcastFn = sender;
  }

  public onLeaderFailed(callback: (failedPeerId: PeerId) => void): void {
    this.onLeaderFailureCallback = callback;
  }

  public setLeaders(leaderIds: PeerId[], epoch: TopologyEpoch): void {
    const existing = new Map(this.leaders);
    this.leaders.clear();

    leaderIds.forEach((pid) => {
      const prev = existing.get(pid);
      this.leaders.set(pid, {
        peerId: pid,
        generation: prev?.generation ?? 1,
        level: 0,
        score: prev?.score ?? 80,
        assignedPeers: prev?.assignedPeers ?? [],
        lastHeartbeat: Date.now(),
        health: 'HEALTHY',
      });
    });
  }

  public isLeader(peerId: PeerId = this.myPeerId): boolean {
    return this.leaders.has(peerId);
  }

  public getActiveLeaders(): PeerId[] {
    return Array.from(this.leaders.keys());
  }

  public getLeaderCount(): number {
    return this.leaders.size;
  }

  /**
   * Calculates the required majority quorum for leader consensus
   */
  public getQuorum(): number {
    return Math.floor(this.leaders.size / 2) + 1;
  }

  /**
   * Checks if current node is part of the majority leader partition
   */
  public hasQuorum(): boolean {
    let healthyCount = 0;
    this.leaders.forEach((node) => {
      if (node.health !== 'FAILED') {
        healthyCount++;
      }
    });
    return healthyCount >= this.getQuorum();
  }

  /**
   * Starts periodic control digest heartbeats and leader health checks
   */
  public start(epoch: TopologyEpoch): void {
    this.stop();

    // 1. Digest broadcast loop (only active if local node is an active leader)
    this.heartbeatInterval = setInterval(() => {
      if (this.isLeader() && this.onDigestBroadcastFn) {
        const digest: LeaderDigest = {
          roomId: this.roomId,
          topologyEpoch: epoch,
          leaderGeneration: this.leaders.get(this.myPeerId)?.generation ?? 1,
          leaderPeerId: this.myPeerId,
          memberCount: this.peerAssignments.size + this.leaders.size,
          vectorDigest: this.getVectorClockFn(),
          latestLamport: this.getLamportTimeFn(),
          healthScore: 95,
          knownLeaders: this.getActiveLeaders(),
          timestamp: Date.now(),
        };
        this.onDigestBroadcastFn(digest);
      }
    }, TOPOLOGY_TIMERS.LEADER_HEARTBEAT_MS);

    // 2. Health check state machine loop (every 2.5s)
    this.healthCheckInterval = setInterval(() => {
      this.checkLeaderHealth();
    }, 2500);
  }

  public stop(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.heartbeatInterval = null;
    this.healthCheckInterval = null;
  }

  /**
   * Processes incoming LeaderDigest from peer leader
   */
  public recordDigest(digest: LeaderDigest): void {
    const leader = this.leaders.get(digest.leaderPeerId);
    if (leader) {
      leader.lastHeartbeat = Date.now();
      leader.health = 'HEALTHY';
      leader.score = digest.healthScore;
    }
  }

  private checkLeaderHealth(): void {
    const now = Date.now();
    this.leaders.forEach((node, pid) => {
      if (pid === this.myPeerId) return;

      const elapsed = now - node.lastHeartbeat;
      if (elapsed > TOPOLOGY_TIMERS.LEADER_FAILURE_TIMEOUT_MS) {
        if (node.health !== 'FAILED') {
          node.health = 'FAILED';
          console.warn(`[LeaderMesh] Leader ${pid} declared FAILED (no heartbeat for ${elapsed}ms)`);

          // Only proceed with leader election if quorum majority is present
          if (this.hasQuorum()) {
            if (this.onLeaderFailureCallback) {
              this.onLeaderFailureCallback(pid);
            }
          } else {
            console.warn('[LeaderMesh] Insufficient leader quorum to elect replacement. Fencing state.');
          }
        }
      } else if (elapsed > TOPOLOGY_TIMERS.LEADER_SUSPECT_TIMEOUT_MS) {
        node.health = 'SUSPECTED';
      } else {
        node.health = 'HEALTHY';
      }
    });
  }

  /**
   * Rebalances and computes dual-attachment assignments (primary + secondary standby) for ordinary peers
   */
  public assignPeers(allOrdinaryPeers: PeerId[]): Map<PeerId, PeerAssignment> {
    const activeLeaderList = this.getActiveLeaders().filter(
      (id) => this.leaders.get(id)?.health !== 'FAILED'
    );

    if (activeLeaderList.length === 0) {
      return this.peerAssignments;
    }

    this.peerAssignments.clear();

    allOrdinaryPeers.forEach((peerId, index) => {
      const primaryIdx = index % activeLeaderList.length;
      const secondaryIdx = (index + 1) % activeLeaderList.length;

      const primaryLeader = activeLeaderList[primaryIdx];
      const secondaryLeader =
        activeLeaderList.length > 1 ? activeLeaderList[secondaryIdx] : undefined;

      this.peerAssignments.set(peerId, {
        primaryLeader,
        secondaryLeader,
        assignedAt: Date.now(),
      });
    });

    return this.peerAssignments;
  }

  public getAssignmentForPeer(peerId: PeerId = this.myPeerId): PeerAssignment | undefined {
    return this.peerAssignments.get(peerId);
  }
}
