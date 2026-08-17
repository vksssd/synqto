// ─── Headless Topology & Network Cluster Simulator ───

import { PeerId, RoomId } from '../types/identifiers';
import { NetworkPacket, createPacket } from '../network/packet';
import { TierCoordinator } from './tier-coordinator';
import { LeaderMesh } from './leader-mesh';
import { LeaderElectionEngine } from './leader-election';
import { ReplicatedEventLog } from '../replication/event-log';

export interface VirtualPeer {
  peerId: PeerId;
  tierCoordinator: TierCoordinator;
  leaderMesh: LeaderMesh;
  eventLog: ReplicatedEventLog;
  receivedPacketIds: Set<string>;
  deliveredHistory: NetworkPacket[];
}

export class TopologySimulator {
  private peers: Map<PeerId, VirtualPeer> = new Map();
  private partitionedPairs: Set<string> = new Set(); // "peerA:peerB"

  constructor(private readonly roomId: RoomId = 'sim-room-1') {}

  public addPeer(peerId: PeerId): VirtualPeer {
    const coordinator = new TierCoordinator();
    const eventLog = new ReplicatedEventLog(peerId, this.roomId);
    const leaderMesh = new LeaderMesh(
      peerId,
      this.roomId,
      () => eventLog.getDigest(),
      () => Date.now()
    );

    const peer: VirtualPeer = {
      peerId,
      tierCoordinator: coordinator,
      leaderMesh,
      eventLog,
      receivedPacketIds: new Set(),
      deliveredHistory: [],
    };

    this.peers.set(peerId, peer);
    this.syncPeerCounts();
    return peer;
  }

  public removePeer(peerId: PeerId): boolean {
    const deleted = this.peers.delete(peerId);
    if (deleted) {
      this.syncPeerCounts();
    }
    return deleted;
  }

  private syncPeerCounts(): void {
    const total = this.peers.size;
    this.peers.forEach((peer) => {
      peer.tierCoordinator.updatePeerCount(total);
    });
  }

  public partition(groupA: PeerId[], groupB: PeerId[]): void {
    groupA.forEach((pA) => {
      groupB.forEach((pB) => {
        this.partitionedPairs.add(`${pA}:${pB}`);
        this.partitionedPairs.add(`${pB}:${pA}`);
      });
    });
  }

  public healPartition(): void {
    this.partitionedPairs.clear();
  }

  public canCommunicate(fromPeerId: PeerId, toPeerId: PeerId): boolean {
    if (fromPeerId === toPeerId) return true;
    return !this.partitionedPairs.has(`${fromPeerId}:${toPeerId}`);
  }

  /**
   * Simulates broadcasting a packet from a peer across the cluster
   */
  public broadcast(fromPeerId: PeerId, type: string, payload: unknown): NetworkPacket {
    const sender = this.peers.get(fromPeerId);
    if (!sender) throw new Error(`Unknown sender peer ${fromPeerId}`);

    const packet = createPacket(
      type as any,
      { peerId: fromPeerId, nickname: fromPeerId, avatar: '🤖', color: '#10b981' },
      this.roomId,
      payload
    );

    this.peers.forEach((targetPeer) => {
      if (targetPeer.peerId === fromPeerId) return;

      if (this.canCommunicate(fromPeerId, targetPeer.peerId)) {
        // Enforce deduplication invariant
        if (!targetPeer.receivedPacketIds.has(packet.id)) {
          targetPeer.receivedPacketIds.add(packet.id);
          targetPeer.deliveredHistory.push(packet);
        }
      }
    });

    return packet;
  }

  public getPeer(peerId: PeerId): VirtualPeer | undefined {
    return this.peers.get(peerId);
  }

  public getAllPeers(): VirtualPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Asserts invariant: No peer received any duplicate packet
   */
  public assertNoDuplicatePackets(): void {
    this.peers.forEach((peer) => {
      const ids = peer.deliveredHistory.map((p) => p.id);
      const uniqueIds = new Set(ids);
      if (ids.length !== uniqueIds.size) {
        throw new Error(`Duplicate packet detected on peer ${peer.peerId}! Delivered ${ids.length}, unique ${uniqueIds.size}`);
      }
    });
  }
}
