// ─── Mixed Multi-Modal Traffic Generator ───
// Generates realistic collaborative workload (Chat 40%, Whiteboard 25%, Code 15%, Presence 10%, Files 5%, Topology 5%)

import { PeerId } from '../types/identifiers';
import { PacketType } from '../network/packet';
import { SeededPRNG } from './prng';
import { SimulatedPeer } from './simulated-peer';

export class TrafficGenerator {
  constructor(private prng: SeededPRNG = new SeededPRNG(42)) {}

  /**
   * Emits a random domain packet from a sender peer.
   */
  public emitRandomPacket(
    sender: SimulatedPeer,
    allPeers: SimulatedPeer[],
    forceLargePayload = false
  ): void {
    const aliveTargets = allPeers.filter((p) => p.peerId !== sender.peerId && p.isAlive);
    if (aliveTargets.length === 0) return;

    const target = this.prng.pick(aliveTargets);
    const roll = forceLargePayload ? 96 : this.prng.nextInt(1, 100);

    if (roll <= 40) {
      // 1. Chat Message (40%) - Reliable, stream: 'chat'
      sender.send(
        'chat:message',
        { text: `Chat message at ${Date.now()} from ${sender.peerId}` },
        target.peerId,
        { streamId: 'chat', isReliable: true }
      );
    } else if (roll <= 65) {
      // 2. Whiteboard Operation (25%) - Causal, stream: 'wb'
      sender.send(
        'whiteboard:stroke',
        { id: `stroke-${Date.now()}`, points: [[10, 20], [30, 40], [50, 60]], color: '#f43f5e' },
        target.peerId,
        { streamId: 'wb', isReliable: true }
      );
    } else if (roll <= 80) {
      // 3. Code Sync Delta (15%) - Durable, stream: 'code'
      sender.send(
        'code:sync',
        { file: 'main.rs', patch: `+ fn compute_${Date.now()}() {}` },
        target.peerId,
        { streamId: 'code', isReliable: true }
      );
    } else if (roll <= 90) {
      // 4. Presence Ping (10%) - Ephemeral, no stream
      sender.send(
        'presence:ping',
        { status: 'active', clientTime: Date.now() },
        target.peerId,
        { isReliable: false }
      );
    } else if (roll <= 95) {
      // 5. Topology Digest (5%) - Control
      sender.send(
        'topology:digest',
        { epoch: sender.topologyView.epoch, version: 1, members: [sender.peerId] },
        target.peerId,
        { isReliable: false }
      );
    } else {
      // 6. Large File / Snapshot (5%) - Large Payload (> 18 KB) triggering Chunker + CRC32
      const largeData = 'LARGE_OBJECT_BLOB_'.repeat(1000); // ~18 KB
      sender.send(
        'whiteboard:page_sync',
        { snapshotId: `snap-${Date.now()}`, data: largeData },
        target.peerId,
        { streamId: 'wb_snapshot', isReliable: true }
      );
    }
  }
}
