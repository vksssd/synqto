// ─── Network Simulation Metrics & Invariant Collector ───

import { MessageId, PeerId } from '../types/identifiers';
import { NetworkPacket } from '../network/packet';

export interface InvariantViolation {
  name: string;
  details: string;
  timestamp: number;
}

export class MetricsCollector {
  // Routing metrics
  public directRoutes = 0;
  public leaderRoutes = 0;
  public relayRoutes = 0;
  public routeChanges = 0;
  public unknownRouteCount = 0;
  public routeInvalidationCount = 0;

  // Reliability metrics
  public originalTransmissions = 0;
  public retransmissions = 0;
  public acks = 0;
  public nacks = 0;
  public ackTimeouts = 0;
  public retryExhaustions = 0;
  public latencies: number[] = [];

  // Ordering metrics
  public outOfOrderReceived = 0;
  public gapDetected = 0;
  public gapRepairRequests = 0;
  public gapRepairsSuccessful = 0;
  public gapExpired = 0;
  public orderingViolations = 0;

  // Chunking metrics
  public chunkedTransfers = 0;
  public chunksSent = 0;
  public chunksRetransmitted = 0;
  public crcFailures = 0;
  public reassemblyFailures = 0;
  public transferTimeouts = 0;

  // Topology metrics
  public leaderCrashes = 0;
  public leaderElections = 0;
  public epochChanges = 0;
  public staleControlDrops = 0;
  public partitionEvents = 0;
  public healingEvents = 0;
  public convergenceTimesMs: number[] = [];

  // Application Delivery Tracking (for Exactly-Once Invariant)
  public applicationDeliveries = 0;
  public uniqueApplicationDeliveries = 0;
  private seenDeliveryKeys: Set<string> = new Set(); // "${peerId}:${packetId}"
  private sentReliablePackets: Set<MessageId> = new Set();
  private sentPacketsMap: Map<MessageId, NetworkPacket> = new Map();
  private deliveredReliablePackets: Set<MessageId> = new Set();

  // Invariant Violations List
  public violations: InvariantViolation[] = [];

  public recordSent(packet: NetworkPacket, isReliable = false): void {
    this.originalTransmissions++;
    if (isReliable) {
      this.sentReliablePackets.add(packet.id);
      this.sentPacketsMap.set(packet.id, packet);
    }
  }

  public recordRetransmission(): void {
    this.retransmissions++;
  }

  public recordDelivery(receiverPeerId: PeerId, packet: NetworkPacket, latencyMs?: number): void {
    this.applicationDeliveries++;
    if (latencyMs !== undefined) {
      this.latencies.push(latencyMs);
    }

    const key = `${receiverPeerId}:${packet.id}`;
    if (!this.seenDeliveryKeys.has(key)) {
      this.seenDeliveryKeys.add(key);
      this.uniqueApplicationDeliveries++;
      this.deliveredReliablePackets.add(packet.id);
    }
  }

  public recordViolation(name: string, details: string): void {
    this.violations.push({
      name,
      details,
      timestamp: Date.now(),
    });
  }

  public getLatencyQuantiles(): { p50: number; p95: number; p99: number; max: number; avg: number } {
    if (this.latencies.length === 0) {
      return { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
    }
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const max = sorted[sorted.length - 1];
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / sorted.length);
    return { p50, p95, p99, max, avg };
  }

  public getReliablePacketLoss(): number {
    let unrecovered = 0;
    this.sentReliablePackets.forEach((id) => {
      if (!this.deliveredReliablePackets.has(id)) {
        unrecovered++;
      }
    });
    return unrecovered;
  }

  public verifyInvariants(): { passed: boolean; violations: InvariantViolation[] } {
    // 1. Exactly-once logical delivery check
    if (this.applicationDeliveries !== this.uniqueApplicationDeliveries) {
      this.recordViolation(
        'EXACTLY_ONCE_VIOLATION',
        `Total application deliveries (${this.applicationDeliveries}) !== unique deliveries (${this.uniqueApplicationDeliveries})`
      );
    }

    // 2. Ordering violations
    if (this.orderingViolations > 0) {
      this.recordViolation(
        'ORDERING_VIOLATION',
        `Recorded ${this.orderingViolations} sequence ordering inversions`
      );
    }

    // 3. Reliable packet loss
    const lost = this.getReliablePacketLoss();
    if (lost > 0) {
      const sampleLost: any[] = [];
      this.sentReliablePackets.forEach((id) => {
        if (!this.deliveredReliablePackets.has(id) && sampleLost.length < 5) {
          const pkt = this.sentPacketsMap.get(id);
          sampleLost.push({ id, type: pkt?.type, from: pkt?.from?.peerId, to: pkt?.to, streamId: pkt?.streamId, seq: pkt?.seq });
        }
      });
      console.log(`[MetricsCollector] Sample unrecovered packets (${lost} total):`, sampleLost);
      this.recordViolation(
        'RELIABLE_DELIVERY_LOSS',
        `Failed to deliver ${lost} reliable packets`
      );
    }

    return {
      passed: this.violations.length === 0,
      violations: [...this.violations],
    };
  }

  public printSummaryTable(scenarioName: string): void {
    const lat = this.getLatencyQuantiles();
    console.log(`\n📊 ═══════════════════════════════════════════════════════════════════════`);
    console.log(`   SIMULATION METRIC REPORT: ${scenarioName.toUpperCase()}`);
    console.log(`═══════════════════════════════════════════════════════════════════════════`);
    console.log(`  📦 Traffic & Delivery:`);
    console.log(`     • Total Sent:               ${this.originalTransmissions}`);
    console.log(`     • Retransmissions:          ${this.retransmissions} (${((this.retransmissions / Math.max(1, this.originalTransmissions)) * 100).toFixed(1)}%)`);
    console.log(`     • App Deliveries:           ${this.applicationDeliveries} (Unique: ${this.uniqueApplicationDeliveries})`);
    console.log(`     • ACKs / NACKs:             ${this.acks} / ${this.nacks}`);
    console.log(`     • Reliable Packet Loss:     ${this.getReliablePacketLoss()}`);
    console.log(`  ⏱️  Latency (ms):`);
    console.log(`     • p50: ${lat.p50}ms | p95: ${lat.p95}ms | p99: ${lat.p99}ms | max: ${lat.max}ms | avg: ${lat.avg}ms`);
    console.log(`  🔀 Routing Breakdown:`);
    console.log(`     • Direct P2P:               ${this.directRoutes}`);
    console.log(`     • Leader Backbone:          ${this.leaderRoutes}`);
    console.log(`     • Server Relay:             ${this.relayRoutes}`);
    console.log(`     • Dynamic Route Shifts:     ${this.routeChanges}`);
    console.log(`  🧩 Chunking & Integrity:`);
    console.log(`     • Chunked Transfers:        ${this.chunkedTransfers}`);
    console.log(`     • Total Chunks Sent:        ${this.chunksSent}`);
    console.log(`     • CRC Checksum Failures:    ${this.crcFailures} (Corruptions Rejected: ${this.crcFailures})`);
    console.log(`  🛡️  Fault & Topology:`);
    console.log(`     • Leader Crashes:           ${this.leaderCrashes}`);
    console.log(`     • Stale Control Drops:      ${this.staleControlDrops}`);
    console.log(`     • Invariant Violations:     ${this.violations.length}`);
    console.log(`═══════════════════════════════════════════════════════════════════════════\n`);
  }
}
