// ─── Virtual Network Physical Link Simulator ───
// Emulates physical links (P2P DataChannels & Relay WebSockets) with latency, loss, jitter, and partitions.

import { PeerId } from '../types/identifiers';
import { NetworkPacket } from '../network/packet';
import { SeededPRNG } from './prng';
import { MetricsCollector } from './metrics-collector';

export interface NetworkProfile {
  latencyMs: number;
  jitterMs: number;
  lossRate: number;        // 0.0 to 1.0
  duplicationRate: number; // 0.0 to 1.0
  reorderRate: number;     // 0.0 to 1.0
}

export interface QueuedPacket {
  packet: NetworkPacket;
  toPeerId: PeerId;
  deliverAt: number;
}

export class VirtualNetwork {
  private peers: Map<PeerId, (packet: NetworkPacket) => void> = new Map();
  private stepCallbacks: Set<(now: number) => void> = new Set();
  private partitionedPairs: Set<string> = new Set(); // "${peerA}:${peerB}"
  private packetQueue: QueuedPacket[] = [];
  private currentTime: number = 0;

  constructor(
    public profile: NetworkProfile,
    private prng: SeededPRNG = new SeededPRNG(42),
    private metrics?: MetricsCollector
  ) {}

  public registerPeer(peerId: PeerId, receiver: (packet: NetworkPacket) => void, onTick?: (now: number) => void): void {
    this.peers.set(peerId, receiver);
    if (onTick) this.stepCallbacks.add(onTick);
  }

  public unregisterPeer(peerId: PeerId): void {
    this.peers.delete(peerId);
  }

  public getCurrentTime(): number {
    return this.currentTime;
  }

  public partition(groupA: PeerId[], groupB: PeerId[]): void {
    groupA.forEach((a) => {
      groupB.forEach((b) => {
        this.partitionedPairs.add(`${a}:${b}`);
        this.partitionedPairs.add(`${b}:${a}`);
      });
    });
    if (this.metrics) this.metrics.partitionEvents++;
  }

  public healPartition(): void {
    this.partitionedPairs.clear();
    if (this.metrics) this.metrics.healingEvents++;
  }

  public canCommunicate(fromPeerId: PeerId, toPeerId: PeerId): boolean {
    if (fromPeerId === toPeerId) return true;
    return !this.partitionedPairs.has(`${fromPeerId}:${toPeerId}`);
  }

  /**
   * Physical P2P transmission through virtual network link.
   */
  public sendP2P(fromPeerId: PeerId, toPeerId: PeerId, packet: NetworkPacket): boolean {
    if (!this.peers.has(toPeerId)) return false;

    // Check partition
    if (!this.canCommunicate(fromPeerId, toPeerId)) {
      return false; // Dropped by partition
    }

    this.scheduleTransmission(toPeerId, packet);
    return true;
  }

  /**
   * Server Relay transmission (relayed via server to target peer or room broadcast).
   */
  public sendRelay(fromPeerId: PeerId, toPeerId: PeerId | undefined, packet: NetworkPacket): boolean {
    if (toPeerId) {
      // Unicast relay
      if (!this.peers.has(toPeerId)) return false;
      this.scheduleTransmission(toPeerId, packet, 15); // +15ms server hop overhead
      return true;
    } else {
      // Broadcast relay
      this.peers.forEach((_, targetId) => {
        if (targetId !== fromPeerId) {
          this.scheduleTransmission(targetId, packet, 15);
        }
      });
      return true;
    }
  }

  private scheduleTransmission(toPeerId: PeerId, packet: NetworkPacket, extraDelay = 0): void {
    // 1. Packet Loss Simulation
    if (this.prng.chance(this.profile.lossRate)) {
      // Packet dropped
      return;
    }

    // 2. Latency & Jitter calculation
    const jitter = this.prng.nextInt(-this.profile.jitterMs, this.profile.jitterMs);
    const latency = Math.max(1, this.profile.latencyMs + jitter + extraDelay);
    const deliverAt = this.currentTime + latency;

    // Deep copy packet to simulate wire serialization
    const wirePacket: NetworkPacket = JSON.parse(JSON.stringify(packet));

    this.packetQueue.push({
      packet: wirePacket,
      toPeerId,
      deliverAt,
    });

    // 3. Packet Duplication Simulation
    if (this.prng.chance(this.profile.duplicationRate)) {
      const dupDelay = deliverAt + this.prng.nextInt(5, 30);
      this.packetQueue.push({
        packet: JSON.parse(JSON.stringify(wirePacket)),
        toPeerId,
        deliverAt: dupDelay,
      });
    }

    // 4. Packet Reordering Simulation
    if (this.prng.chance(this.profile.reorderRate)) {
      // Delay this packet slightly so next packet arrives first
      const last = this.packetQueue[this.packetQueue.length - 1];
      last.deliverAt += this.prng.nextInt(20, 60);
      if (this.metrics) this.metrics.outOfOrderReceived++;
    }
  }

  /**
   * Steps the simulated virtual network clock forward by deltaMs.
   */
  public async step(deltaMs: number): Promise<void> {
    this.currentTime += deltaMs;

    // Advance peer retry timers with simulated clock
    this.stepCallbacks.forEach((tick) => tick(this.currentTime));

    // Find all packets ready for delivery
    const readyIndices: number[] = [];
    for (let i = 0; i < this.packetQueue.length; i++) {
      if (this.packetQueue[i].deliverAt <= this.currentTime) {
        readyIndices.push(i);
      }
    }

    if (readyIndices.length === 0) return;

    // Extract ready packets
    const readyPackets: QueuedPacket[] = [];
    readyIndices.sort((a, b) => b - a).forEach((idx) => {
      readyPackets.push(this.packetQueue.splice(idx, 1)[0]);
    });

    // Deliver ready packets to peer physical handlers
    for (const item of readyPackets) {
      const receiver = this.peers.get(item.toPeerId);
      if (receiver) {
        try {
          receiver(item.packet);
        } catch (err) {
          console.error(`[VirtualNetwork] Error delivering packet to ${item.toPeerId}:`, err);
        }
      }
    }
  }

  /**
   * Flushes all in-flight packets in the network queue until empty or maxSteps reached.
   */
  public async flush(maxSteps = 100): Promise<void> {
    let steps = 0;
    while (this.packetQueue.length > 0 && steps < maxSteps) {
      await this.step(50);
      steps++;
    }
  }

  public getInFlightCount(): number {
    return this.packetQueue.length;
  }

  public clear(): void {
    this.packetQueue = [];
    this.partitionedPairs.clear();
    this.stepCallbacks.clear();
  }
}
