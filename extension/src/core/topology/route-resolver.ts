// ─── Authoritative Route Resolver & Deterministic Conflict Engine ───
// Answers WHERE a packet should be routed: DIRECT, LEADER (backbone), or RELAY.

import { PeerId, TopologyEpoch } from '../types/identifiers';
import { LeaderDigest, PeerRoute, ResolvedRoute, RouteType } from './topology.types';

export interface IRouteResolver {
  resolve(targetPeerId: PeerId, directPeers?: Set<PeerId>): ResolvedRoute;
  recordDigest(digest: LeaderDigest): void;
  invalidateRoute(peerId: PeerId): void;
  invalidateLeader(leaderId: PeerId): void;
  getRoutingTable(): Map<PeerId, PeerRoute>;
}

export class RouteResolver implements IRouteResolver {
  private peerRoutes: Map<PeerId, PeerRoute> = new Map();
  private currentEpoch: TopologyEpoch;
  private myPeerId: PeerId;

  constructor(myPeerId: PeerId, initialEpoch: TopologyEpoch = 1) {
    this.myPeerId = myPeerId;
    this.currentEpoch = initialEpoch;
  }

  public setEpoch(epoch: TopologyEpoch): void {
    this.currentEpoch = epoch;
  }

  /**
   * Records and ingests an incoming LeaderDigest with deterministic conflict resolution.
   * Invariant: Newer epoch > higher digest version > deterministic leader ID tie-break.
   */
  public recordDigest(digest: LeaderDigest): void {
    if (!digest || !digest.leaderPeerId || !Array.isArray(digest.assignedClusterPeers)) {
      return;
    }

    const digestEpoch = digest.topologyEpoch ?? 1;
    const digestVer = digest.digestVersion ?? 1;
    const leaderId = digest.leaderPeerId;
    const now = Date.now();

    for (const peerId of digest.assignedClusterPeers) {
      const existing = this.peerRoutes.get(peerId);

      if (!existing) {
        this.peerRoutes.set(peerId, {
          targetPeerId: peerId,
          leaderId,
          topologyEpoch: digestEpoch,
          digestVersion: digestVer,
          updatedAt: now,
        });
        continue;
      }

      // Conflict Resolution Rules:
      // 1. Higher Epoch wins
      if (digestEpoch > existing.topologyEpoch) {
        this.peerRoutes.set(peerId, {
          targetPeerId: peerId,
          leaderId,
          topologyEpoch: digestEpoch,
          digestVersion: digestVer,
          updatedAt: now,
        });
        continue;
      }

      if (digestEpoch < existing.topologyEpoch) {
        // Stale epoch digest — reject
        continue;
      }

      // Same Epoch:
      // 2. Higher digest version wins
      if (digestVer > existing.digestVersion) {
        this.peerRoutes.set(peerId, {
          targetPeerId: peerId,
          leaderId,
          topologyEpoch: digestEpoch,
          digestVersion: digestVer,
          updatedAt: now,
        });
        continue;
      }

      if (digestVer < existing.digestVersion) {
        // Older version within same epoch — reject
        continue;
      }

      // 3. Same Epoch & Same Version: Deterministic tie-break on leaderId string comparison
      if (leaderId < existing.leaderId) {
        this.peerRoutes.set(peerId, {
          targetPeerId: peerId,
          leaderId,
          topologyEpoch: digestEpoch,
          digestVersion: digestVer,
          updatedAt: now,
        });
      }
    }
  }

  /**
   * Resolves the target peer's destination:
   * - DIRECT: target is directly connected via local P2P link
   * - LEADER: target is reachable through their cluster leader over backbone
   * - RELAY: target route is unknown or link is broken (fallback to server relay unicast)
   * INVARIANT: Never returns a broadcast route for unicast targets.
   */
  public resolve(targetPeerId: PeerId, directPeers: Set<PeerId> = new Set()): ResolvedRoute {
    if (targetPeerId === this.myPeerId) {
      return {
        type: 'DIRECT',
        targetPeerId,
        epoch: this.currentEpoch,
      };
    }

    // 1. Check direct P2P link
    if (directPeers.has(targetPeerId)) {
      return {
        type: 'DIRECT',
        nextHopPeerId: targetPeerId,
        targetPeerId,
        epoch: this.currentEpoch,
      };
    }

    // 2. Check authoritative cluster routing table
    const route = this.peerRoutes.get(targetPeerId);
    if (route) {
      // If the target's cluster leader is directly connected to us (e.g. over backbone mesh)
      if (directPeers.has(route.leaderId)) {
        return {
          type: 'LEADER',
          nextHopPeerId: route.leaderId,
          targetPeerId,
          epoch: route.topologyEpoch,
        };
      }

      // If we are the leader for this peer, but direct link is not open
      if (route.leaderId === this.myPeerId) {
        return {
          type: 'RELAY',
          nextHopPeerId: targetPeerId,
          targetPeerId,
          epoch: route.topologyEpoch,
        };
      }

      // Route through target's leader via relay fallback if backbone link not direct
      return {
        type: 'LEADER',
        nextHopPeerId: route.leaderId,
        targetPeerId,
        epoch: route.topologyEpoch,
      };
    }

    // 3. Route unknown: Fallback to server relay unicast (NEVER ROOM BROADCAST)
    return {
      type: 'RELAY',
      nextHopPeerId: targetPeerId,
      targetPeerId,
      epoch: this.currentEpoch,
    };
  }

  public invalidateRoute(peerId: PeerId): void {
    this.peerRoutes.delete(peerId);
  }

  public invalidateLeader(leaderId: PeerId): void {
    const toDelete: PeerId[] = [];
    for (const [peerId, route] of this.peerRoutes.entries()) {
      if (route.leaderId === leaderId) {
        toDelete.push(peerId);
      }
    }
    for (const pid of toDelete) {
      this.peerRoutes.delete(pid);
    }
  }

  public getRoutingTable(): Map<PeerId, PeerRoute> {
    return new Map(this.peerRoutes);
  }
}
