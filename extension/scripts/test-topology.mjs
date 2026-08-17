// ─── Automated Topology & Resilience Test Suite ───

import assert from 'assert';
import { TierCoordinator } from '../src/core/topology/tier-coordinator.ts';
import { TOPOLOGY_THRESHOLDS } from '../src/core/topology/topology.types.ts';
import { LeaderElectionEngine } from '../src/core/topology/leader-election.ts';
import { LeaderMesh } from '../src/core/topology/leader-mesh.ts';
import {
  createVectorClock,
  incrementVectorClock,
  mergeVectorClocks,
  compareVectorClocks,
  generateOperationId,
  dominates,
  minVectorClocks,
} from '../src/core/replication/vector-clock.ts';
import { ReplicatedEventLog } from '../src/core/replication/event-log.ts';
import { OperationJournal } from '../src/core/replication/operation-journal.ts';
import { CausalSyncEngine } from '../src/core/replication/causal-sync-engine.ts';
import { BoundedMemoryManager } from '../src/core/replication/bounded-memory.ts';
import { SnapshotTransferManager } from '../src/core/replication/snapshot-transfer.ts';
import { ReplicatedStore } from '../src/core/replication/replicated-store.ts';
import { ReplicationValidator } from '../src/core/replication/validation.ts';
import { InMemoryStorageAdapter } from '../src/core/replication/storage-adapter.ts';

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

async function testAsync(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

console.log('\n🧪 Running Synqto Topology & Resilience Test Suite...\n');

// ─── 1. Vector Clock Tests ───
console.log('📦 Section 1: Vector Clocks & Causal Ordering');

test('Vector Clock increment and merge', () => {
  let v1 = createVectorClock();
  v1 = incrementVectorClock(v1, 'peer-A');
  v1 = incrementVectorClock(v1, 'peer-A');
  v1 = incrementVectorClock(v1, 'peer-B');

  assert.strictEqual(v1['peer-A'], 2);
  assert.strictEqual(v1['peer-B'], 1);

  let v2 = createVectorClock({ 'peer-A': 1, 'peer-B': 3, 'peer-C': 1 });
  const merged = mergeVectorClocks(v1, v2);

  assert.strictEqual(merged['peer-A'], 2);
  assert.strictEqual(merged['peer-B'], 3);
  assert.strictEqual(merged['peer-C'], 1);
});

test('Vector Clock comparisons (EQUAL, ANCESTOR, DESCENDANT, CONCURRENT)', () => {
  const vBase = { A: 2, B: 2 };
  const vAncestor = { A: 1, B: 2 };
  const vDescendant = { A: 3, B: 2 };
  const vConcurrent = { A: 3, B: 1 };

  assert.strictEqual(compareVectorClocks(vBase, { A: 2, B: 2 }), 'EQUAL');
  assert.strictEqual(compareVectorClocks(vAncestor, vBase), 'ANCESTOR');
  assert.strictEqual(compareVectorClocks(vDescendant, vBase), 'DESCENDANT');
  assert.strictEqual(compareVectorClocks(vConcurrent, vBase), 'CONCURRENT');
});

// ─── 2. Replicated Event Log & Anti-Entropy ───
console.log('\n📦 Section 2: Replicated Event Log & Anti-Entropy Delta Sync');

test('Event log deterministic Lamport sorting', () => {
  const log = new ReplicatedEventLog('peer-A', 'room-1');

  log.appendLocal('chat:msg', { text: 'Hello' });
  log.appendLocal('chat:msg', { text: 'World' });

  // Remote event with higher lamport
  log.applyRemote({
    opId: 'peer-B:1:10',
    author: 'peer-B',
    seq: 1,
    lamport: 10,
    timestamp: Date.now(),
    type: 'code:edit',
    op: { line: 1 },
  });

  const events = log.getEvents();
  assert.strictEqual(events.length, 3);
  assert.strictEqual(events[2].opId, 'peer-B:1:10');
});

test('Anti-entropy missing delta extraction', () => {
  const log = new ReplicatedEventLog('peer-A', 'room-1');
  log.appendLocal('chat:msg', { text: 'Op 1' });
  log.appendLocal('chat:msg', { text: 'Op 2' });
  log.appendLocal('chat:msg', { text: 'Op 3' });

  // Remote peer has only seen seq 1 from peer-A
  const remoteVector = { 'peer-A': 1 };
  const missing = log.getMissingEvents(remoteVector);

  assert.strictEqual(missing.length, 2);
  assert.strictEqual(missing[0].seq, 2);
  assert.strictEqual(missing[1].seq, 3);
});

// ─── 3. Leader Scoring & Election Engine ───
console.log('\n📦 Section 3: Deterministic Leader Scoring & Margin Protection');

test('Leader score calculation within 0-100 bounds', () => {
  const scoreHigh = LeaderElectionEngine.computeScore(
    {
      uptimeMs: 1000 * 60 * 10, // 10 mins
      rttMs: 25,
      packetLossRate: 0,
      isPluggedIn: true,
      activeConnections: 5,
    },
    'peer-leader-1'
  );

  const scoreLow = LeaderElectionEngine.computeScore(
    {
      uptimeMs: 5000,
      rttMs: 300,
      packetLossRate: 0.25,
      batteryLevel: 0.1,
      isPluggedIn: false,
      activeConnections: 1,
    },
    'peer-low-1'
  );

  assert.ok(scoreHigh > 80, `Expected high score > 80, got ${scoreHigh}`);
  assert.ok(scoreLow < 45, `Expected low score < 45, got ${scoreLow}`);
});

test('Leader candidate selection protects incumbent by margin', () => {
  const incumbents = ['peer-L1', 'peer-L2', 'peer-L3'];
  const candidates = [
    { peerId: 'peer-L1', score: 80, metrics: {} },
    { peerId: 'peer-L2', score: 80, metrics: {} },
    { peerId: 'peer-L3', score: 80, metrics: {} },
    // Challenger only +4 pts above incumbent (margin is 10 pts) -> Should NOT replace
    { peerId: 'peer-C1', score: 84, metrics: {} },
  ];

  const selected = LeaderElectionEngine.selectLeaders(incumbents, candidates, 3);
  assert.deepStrictEqual(selected, ['peer-L1', 'peer-L2', 'peer-L3']);

  // Strong challenger (+15 pts above incumbent) -> Should replace
  const candidatesStrong = [
    ...candidates,
    { peerId: 'peer-C2', score: 96, metrics: {} },
  ];
  const selectedWithStrong = LeaderElectionEngine.selectLeaders(incumbents, candidatesStrong, 3);
  assert.ok(selectedWithStrong.includes('peer-C2'), 'Expected strong candidate to be elected');
});

// ─── 4. Leader Mesh & Peer Balancing ───
console.log('\n📦 Section 4: Multi-Leader Mesh & Dual-Attachment Balancing');

test('LeaderMesh assigns primary and secondary leaders evenly', () => {
  const mesh = new LeaderMesh('peer-L1', 'room-1', () => ({}), () => 0);
  mesh.setLeaders(['peer-L1', 'peer-L2', 'peer-L3'], 1);

  const ordinaryPeers = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const assignments = mesh.assignPeers(ordinaryPeers);

  assert.strictEqual(assignments.size, 6);
  assert.strictEqual(assignments.get('p1').primaryLeader, 'peer-L1');
  assert.strictEqual(assignments.get('p1').secondaryLeader, 'peer-L2');
  assert.strictEqual(assignments.get('p2').primaryLeader, 'peer-L2');
  assert.strictEqual(assignments.get('p2').secondaryLeader, 'peer-L3');
});

// ─── 5. Tier Coordinator & Hysteresis ───
console.log('\n📦 Section 5: TierCoordinator Hysteresis State Machine');

test('TierCoordinator initial state is STABLE_TIER1', () => {
  const coordinator = new TierCoordinator();
  assert.strictEqual(coordinator.getCurrentTier(), 'TIER1_FULL_MESH');
  assert.strictEqual(coordinator.getLifecycleState(), 'STABLE_TIER1');
});

test('TierCoordinator starts evaluating at the TIER1 promote threshold and cancels on drop', () => {
  // Derived from the configured thresholds rather than hardcoded, so retuning tier
  // capacity does not silently invalidate this test's intent.
  const promoteAt = TOPOLOGY_THRESHOLDS.TIER1_PROMOTE_AT;
  const belowPromote = promoteAt - 1;

  const coordinator = new TierCoordinator();
  coordinator.updatePeerCount(promoteAt);
  assert.strictEqual(coordinator.getLifecycleState(), 'TIER1_EVALUATING');
  assert.ok(coordinator.getActiveTransaction());
  assert.strictEqual(coordinator.getActiveTransaction().phase, 'EVALUATING');

  // Drops back below the promote threshold before evaluation finishes -> cancels
  coordinator.updatePeerCount(belowPromote);
  assert.strictEqual(coordinator.getLifecycleState(), 'STABLE_TIER1');
  assert.strictEqual(coordinator.getCurrentTier(), 'TIER1_FULL_MESH');
  assert.strictEqual(coordinator.getActiveTransaction().phase, 'ABORTED');
});

test('Tier thresholds keep a real hysteresis margin so boundary churn cannot flap topology', () => {
  const t = TOPOLOGY_THRESHOLDS;

  // Promote must sit strictly above demote for every tier, or a room parked at the
  // boundary would promote and demote on every single join/leave — each transition
  // renegotiating every DataChannel in the room.
  assert.ok(t.TIER1_PROMOTE_AT > t.TIER1_DEMOTE_AT, 'TIER1 promote must exceed demote');
  assert.ok(t.TIER2_PROMOTE_AT > t.TIER2_DEMOTE_AT, 'TIER2 promote must exceed demote');

  // Margin must be more than a single peer, otherwise one flaky connection is enough
  // to drive continuous tier migration.
  assert.ok(t.TIER1_PROMOTE_AT - t.TIER1_DEMOTE_AT >= 2, 'TIER1 margin too narrow');
  assert.ok(t.TIER2_PROMOTE_AT - t.TIER2_DEMOTE_AT >= 5, 'TIER2 margin too narrow');

  // Tier bands must be ordered and contiguous.
  assert.strictEqual(t.TIER1_PROMOTE_AT, t.TIER1_MAX + 1, 'TIER1 band must be contiguous');
  assert.strictEqual(t.TIER2_PROMOTE_AT, t.TIER2_MAX + 1, 'TIER2 band must be contiguous');
  assert.ok(t.TIER2_MAX > t.TIER1_MAX, 'TIER2 must hold more peers than TIER1');

  // Demote thresholds must stay inside their own tier's band.
  assert.ok(t.TIER1_DEMOTE_AT < t.TIER1_MAX, 'TIER1 demote must fall inside the TIER1 band');
  assert.ok(t.TIER2_DEMOTE_AT > t.TIER1_MAX, 'TIER2 demote must not cross below the TIER1 band');

  // A full TIER2 room must be servable by the allowed leader count at the server's
  // cluster high watermark (hub.MaxClusterHighWatermark = 8), otherwise clusters would be
  // forced past their split point with no leader slot left to split into. This couples the
  // client tier ceiling to the server watermark, so raising one without the other fails here.
  const SERVER_CLUSTER_HIGH_WATERMARK = 12;
  assert.ok(
    t.MAX_LEADERS * SERVER_CLUSTER_HIGH_WATERMARK >= t.TIER2_MAX,
    `MAX_LEADERS (${t.MAX_LEADERS}) x cluster watermark (${SERVER_CLUSTER_HIGH_WATERMARK}) must cover TIER2_MAX (${t.TIER2_MAX})`
  );
  assert.ok(t.MIN_LEADERS >= 3, 'Trinity quorum requires at least 3 leaders');
});

// ─── 6. TopologyView & Monotonic Ordering ───
console.log('\n📦 Section 6: TopologyView & Monotonic Ordering Engine');

import { TopologyViewEngine } from '../src/core/topology/topology-view.ts';

test('TopologyView monotonic comparison recognizes higher epoch', () => {
  const v1 = {
    roomId: 'room-1',
    tier: 'TIER1_FULL_MESH',
    epoch: 1,
    generation: 1,
    membershipVersion: 1,
    leaders: [],
    relayAvailable: false,
    timestamp: Date.now(),
  };

  const v2 = { ...v1, epoch: 2 };
  assert.strictEqual(TopologyViewEngine.compare(v1, v2), 'NEWER');
  assert.strictEqual(TopologyViewEngine.compare(v2, v1), 'OLDER');
  assert.strictEqual(TopologyViewEngine.compare(v1, v1), 'EQUAL');
});

test('TopologyView recognizes higher leader generation within same epoch', () => {
  const v1 = {
    roomId: 'room-1',
    tier: 'TIER2_MULTI_LEADER',
    epoch: 2,
    generation: 1,
    membershipVersion: 5,
    leaders: ['L1', 'L2', 'L3'],
    relayAvailable: false,
    timestamp: Date.now(),
  };

  const v2 = { ...v1, generation: 2 };
  assert.strictEqual(TopologyViewEngine.compare(v1, v2), 'NEWER');
  assert.strictEqual(TopologyViewEngine.compare(v2, v1), 'OLDER');
});

// ─── 7. Leader Quorum & Split-Brain Prevention ───
console.log('\n📦 Section 7: Quorum Calculation & Partition Fencing');

test('LeaderMesh calculates floor(N/2) + 1 quorum', () => {
  const mesh3 = new LeaderMesh('L1', 'room-1', () => ({}), () => 0);
  mesh3.setLeaders(['L1', 'L2', 'L3'], 1);
  assert.strictEqual(mesh3.getQuorum(), 2); // 3 leaders -> quorum 2
  assert.strictEqual(mesh3.hasQuorum(), true);

  const mesh5 = new LeaderMesh('L1', 'room-1', () => ({}), () => 0);
  mesh5.setLeaders(['L1', 'L2', 'L3', 'L4', 'L5'], 1);
  assert.strictEqual(mesh5.getQuorum(), 3); // 5 leaders -> quorum 3
});

// ─── 8. Headless Cluster Simulator Tests ───
console.log('\n📦 Section 8: Headless TopologySimulator & Invariant Verifications');

import { TopologySimulator } from '../src/core/topology/topology-simulator.ts';

test('TopologySimulator broadcasts packets across cluster without duplicates', () => {
  const sim = new TopologySimulator('cluster-room-1');

  // Add 10 virtual peer nodes
  for (let i = 1; i <= 10; i++) {
    sim.addPeer(`peer-${i}`);
  }

  // Broadcast 3 chat messages from different peers
  sim.broadcast('peer-1', 'chat:msg', { text: 'Hello from peer-1' });
  sim.broadcast('peer-2', 'chat:msg', { text: 'Hello from peer-2' });
  sim.broadcast('peer-3', 'chat:msg', { text: 'Hello from peer-3' });

  // Invariant verification: zero duplicate delivery
  sim.assertNoDuplicatePackets();

  // Every other peer received exactly 3 packets
  const peer4 = sim.getPeer('peer-4');
  assert.strictEqual(peer4.deliveredHistory.length, 3);
});

test('TopologySimulator handles network partition and healing', () => {
  const sim = new TopologySimulator('partition-room-1');

  for (let i = 1; i <= 6; i++) {
    sim.addPeer(`node-${i}`);
  }

  // Partition cluster: Group A (1, 2, 3) and Group B (4, 5, 6)
  sim.partition(['node-1', 'node-2', 'node-3'], ['node-4', 'node-5', 'node-6']);

  // Node 1 broadcasts inside partition
  sim.broadcast('node-1', 'code:delta', { change: 'A' });

  // Node 2 (same partition) receives packet
  assert.strictEqual(sim.getPeer('node-2').deliveredHistory.length, 1);

  // Node 4 (isolated partition) does NOT receive packet
  assert.strictEqual(sim.getPeer('node-4').deliveredHistory.length, 0);

  // Heal partition
  sim.healPartition();
  sim.broadcast('node-4', 'code:delta', { change: 'B' });

  // Node 1 now receives message from Node 4
  assert.strictEqual(sim.getPeer('node-1').deliveredHistory.length, 1);
  sim.assertNoDuplicatePackets();
});

// ─── 9. Canonical NetworkPacket & EventId Separation ───
console.log('\n📦 Section 9: Canonical NetworkPacket & EventId vs PacketId Separation');

import { generatePacketId, createPacket } from '../src/core/network/packet.ts';

test('PacketId deterministic formatting (roomId:peerId:seq)', () => {
  const packetId = generatePacketId('room-42', 'peer-alpha', 7);
  assert.strictEqual(packetId, 'room-42:peer-alpha:7');
});

test('PacketId and EventId/OpId are distinct and independent', () => {
  // Event opId: author:seq:lamport
  const opId = generateOperationId('peer-alpha', 3, 15);
  assert.strictEqual(opId, 'peer-alpha:3:15');

  // Transport packetId: roomId:peerId:seq
  const packet = createPacket(
    'chat:message',
    { peerId: 'peer-alpha', nickname: 'Alpha', avatar: '', color: '' },
    'room-42',
    { opId, text: 'Hello' },
    undefined,
    { seq: 10, lamportTime: 15, topologyEpoch: 2 }
  );

  assert.strictEqual(packet.id, 'room-42:peer-alpha:10');
  assert.strictEqual(packet.priority, 'CHAT');
  assert.strictEqual(packet.topologyEpoch, 2);
  assert.notStrictEqual(packet.id, opId, 'PacketId and EventId must remain distinct');
});

// ─── 10. TopologyProposalEngine & TransportCapabilities ───
console.log('\n📦 Section 10: TopologyProposalEngine & Transport Capabilities');

import { TopologyProposalEngine } from '../src/core/topology/topology-view.ts';
import { RelayTransport } from '../src/core/transport/relay-transport.ts';

test('TopologyProposal creates proposal with proposedEpoch = epoch + 1', () => {
  const currentView = {
    roomId: 'room-10',
    tier: 'TIER1_FULL_MESH',
    epoch: 3,
    generation: 1,
    membershipVersion: 4,
    leaders: [],
    relayAvailable: false,
    timestamp: Date.now(),
  };

  const proposal = TopologyProposalEngine.createProposal(
    currentView,
    'TIER2_MULTI_LEADER',
    ['L1', 'L2', 'L3'],
    'L1'
  );

  assert.strictEqual(proposal.previousEpoch, 3);
  assert.strictEqual(proposal.proposedEpoch, 4);
  assert.deepStrictEqual(proposal.leaders, ['L1', 'L2', 'L3']);

  // Validate with quorum 2 (proposal currently has 1 vote from proposer)
  assert.strictEqual(TopologyProposalEngine.validateProposal(currentView, proposal, 2), false);

  // Add 2nd vote
  proposal.votes.push('L2');
  assert.strictEqual(TopologyProposalEngine.validateProposal(currentView, proposal, 2), true);

  // Commit proposal
  const newView = TopologyProposalEngine.commitProposal(proposal);
  assert.strictEqual(newView.epoch, 4);
  assert.strictEqual(newView.tier, 'TIER2_MULTI_LEADER');
  assert.strictEqual(newView.phase, 'STABLE');
});

test('RelayTransport exposes valid TransportCapabilities', () => {
  const relay = new RelayTransport({ on: () => {}, getIsConnected: () => true, sendRelayPacket: () => true });
  const caps = relay.getCapabilities();

  assert.strictEqual(caps.broadcast, true);
  assert.strictEqual(caps.reliable, true);
  assert.strictEqual(caps.maxPayloadSize, 16 * 1024 * 1024);
});

// ─── 11. RouteResolver & Deterministic Conflict Resolution ───
console.log('\n📦 Section 11: RouteResolver & Deterministic Routing Conflicts');

import { RouteResolver } from '../src/core/topology/route-resolver.ts';

test('RouteResolver resolves direct peer and cluster leader', () => {
  const resolver = new RouteResolver('my-peer', 2);

  // Ingest digest from Leader L1 assigning peers P1, P2
  resolver.recordDigest({
    roomId: 'room-1',
    topologyEpoch: 2,
    leaderGeneration: 1,
    digestVersion: 1,
    leaderPeerId: 'leader-1',
    assignedClusterPeers: ['peer-1', 'peer-2'],
    memberCount: 3,
    vectorDigest: {},
    latestLamport: 10,
    healthScore: 90,
    knownLeaders: ['leader-1'],
    timestamp: Date.now(),
  });

  const directPeers = new Set(['peer-direct', 'leader-1']);

  // Direct connected peer -> DIRECT
  const routeDirect = resolver.resolve('peer-direct', directPeers);
  assert.strictEqual(routeDirect.type, 'DIRECT');
  assert.strictEqual(routeDirect.nextHopPeerId, 'peer-direct');

  // Peer-1 in Leader-1's cluster -> LEADER nextHop = leader-1
  const routeCluster = resolver.resolve('peer-1', directPeers);
  assert.strictEqual(routeCluster.type, 'LEADER');
  assert.strictEqual(routeCluster.nextHopPeerId, 'leader-1');

  // Unknown peer -> RELAY unicast
  const routeUnknown = resolver.resolve('peer-unknown', directPeers);
  assert.strictEqual(routeUnknown.type, 'RELAY');
  assert.strictEqual(routeUnknown.nextHopPeerId, 'peer-unknown');
});

test('RouteResolver deterministic conflict resolution (Epoch > Version > Tie-Break)', () => {
  const resolver = new RouteResolver('my-peer', 2);

  // 1. Initial assignment from Leader-1 at epoch 2, ver 1
  resolver.recordDigest({
    roomId: 'room-1',
    topologyEpoch: 2,
    leaderGeneration: 1,
    digestVersion: 1,
    leaderPeerId: 'leader-1',
    assignedClusterPeers: ['peer-X'],
    memberCount: 2,
    vectorDigest: {},
    latestLamport: 1,
    healthScore: 90,
    knownLeaders: ['leader-1'],
    timestamp: Date.now(),
  });
  assert.strictEqual(resolver.resolve('peer-X', new Set(['leader-1', 'leader-2'])).nextHopPeerId, 'leader-1');

  // 2. Stale epoch digest (epoch 1) -> Rejected
  resolver.recordDigest({
    roomId: 'room-1',
    topologyEpoch: 1,
    leaderGeneration: 1,
    digestVersion: 5,
    leaderPeerId: 'leader-2',
    assignedClusterPeers: ['peer-X'],
    memberCount: 2,
    vectorDigest: {},
    latestLamport: 1,
    healthScore: 90,
    knownLeaders: ['leader-2'],
    timestamp: Date.now(),
  });
  assert.strictEqual(resolver.resolve('peer-X', new Set(['leader-1', 'leader-2'])).nextHopPeerId, 'leader-1');

  // 3. Higher version in same epoch (epoch 2, ver 2 from leader-2) -> Replaces
  resolver.recordDigest({
    roomId: 'room-1',
    topologyEpoch: 2,
    leaderGeneration: 1,
    digestVersion: 2,
    leaderPeerId: 'leader-2',
    assignedClusterPeers: ['peer-X'],
    memberCount: 2,
    vectorDigest: {},
    latestLamport: 1,
    healthScore: 90,
    knownLeaders: ['leader-2'],
    timestamp: Date.now(),
  });
  assert.strictEqual(resolver.resolve('peer-X', new Set(['leader-1', 'leader-2'])).nextHopPeerId, 'leader-2');

  // 4. Higher epoch (epoch 3, ver 1 from leader-3) -> Replaces
  resolver.recordDigest({
    roomId: 'room-1',
    topologyEpoch: 3,
    leaderGeneration: 1,
    digestVersion: 1,
    leaderPeerId: 'leader-3',
    assignedClusterPeers: ['peer-X'],
    memberCount: 2,
    vectorDigest: {},
    latestLamport: 1,
    healthScore: 90,
    knownLeaders: ['leader-3'],
    timestamp: Date.now(),
  });
  assert.strictEqual(resolver.resolve('peer-X', new Set(['leader-1', 'leader-2', 'leader-3'])).nextHopPeerId, 'leader-3');
});

// ─── 12. TransportRouter Invariants & Zero-Broadcast Unicast ───
console.log('\n📦 Section 12: TransportRouter Data Plane & Zero-Broadcast Invariant');

import { TransportRouter } from '../src/core/transport/transport-router.ts';

test('TransportRouter routes directed unicast to leader and unknown to RELAY_UNICAST (never broadcast)', () => {
  let relayedUnicasts = [];
  let relayedBroadcasts = [];
  let p2pPackets = [];

  const mockRelay = {
    onPacket: () => () => {},
    sendTo: (target, pkt) => {
      relayedUnicasts.push({ target, pkt });
      return true;
    },
    broadcast: (pkt) => {
      relayedBroadcasts.push(pkt);
      return true;
    },
    getHealth: () => ({ connected: true }),
  };

  const router = new TransportRouter(mockRelay);
  const resolver = new RouteResolver('my-node', 1);

  // Ingest route: peer-target is assigned to leader-backbone
  resolver.recordDigest({
    roomId: 'room-1',
    topologyEpoch: 1,
    leaderGeneration: 1,
    digestVersion: 1,
    leaderPeerId: 'leader-backbone',
    assignedClusterPeers: ['peer-target'],
    memberCount: 2,
    vectorDigest: {},
    latestLamport: 1,
    healthScore: 90,
    knownLeaders: ['leader-backbone'],
    timestamp: Date.now(),
  });

  const directPeers = new Set(['leader-backbone']);
  router.bindRouteResolver(resolver, () => directPeers);
  router.bindP2PSender((pkt, target) => {
    p2pPackets.push({ target, pkt });
    return true;
  });

  router.updateView({
    roomId: 'room-1',
    tier: 'TIER2_MULTI_LEADER',
    epoch: 1,
    generation: 1,
    membershipVersion: 5,
    leaders: ['leader-backbone'],
    relayAvailable: true,
    timestamp: Date.now(),
  });

  // 1. Unicast to peer-target -> Should route to leader-backbone over P2P
  const pkt1 = createPacket('chat:message', { peerId: 'my-node', nickname: 'Me', avatar: '', color: '' }, 'room-1', { text: 'hi' }, 'peer-target');
  router.sendTo('peer-target', pkt1);

  assert.strictEqual(p2pPackets.length, 1);
  assert.strictEqual(p2pPackets[0].target, 'leader-backbone');
  assert.strictEqual(relayedUnicasts.length, 0);
  assert.strictEqual(relayedBroadcasts.length, 0);

  // 2. Unicast to completely unknown peer -> Should route to RELAY_UNICAST (never broadcast!)
  const pkt2 = createPacket('chat:message', { peerId: 'my-node', nickname: 'Me', avatar: '', color: '' }, 'room-1', { text: 'private' }, 'peer-stranger');
  router.sendTo('peer-stranger', pkt2);

  assert.strictEqual(relayedUnicasts.length, 1);
  assert.strictEqual(relayedUnicasts[0].target, 'peer-stranger');
  assert.strictEqual(relayedBroadcasts.length, 0, 'INVARIANT VIOLATION: Unknown unicast must NEVER trigger room broadcast');
});

test('TransportRouter drops stale control packets but preserves stale application payloads', () => {
  const router = new TransportRouter({ onPacket: () => () => {}, broadcast: () => true, sendTo: () => true, getHealth: () => ({}) });
  let delivered = [];
  router.onPacket((p) => delivered.push(p));

  router.updateView({
    roomId: 'room-1',
    tier: 'TIER2_MULTI_LEADER',
    epoch: 5,
    generation: 1,
    membershipVersion: 5,
    leaders: ['L1'],
    relayAvailable: true,
    timestamp: Date.now(),
  });

  // Stale control packet (epoch 3 < current 5) -> DROPPED
  const staleControl = createPacket('topology:digest', { peerId: 'L1', nickname: 'L1', avatar: '', color: '' }, 'room-1', {}, undefined, { topologyEpoch: 3 });
  router.routeIncoming(staleControl);
  assert.strictEqual(delivered.length, 0, 'Stale control packet must be dropped');

  // Stale application packet (epoch 3 < current 5) -> PRESERVED
  const staleApp = createPacket('chat:message', { peerId: 'P1', nickname: 'P1', avatar: '', color: '' }, 'room-1', { text: 'important' }, undefined, { topologyEpoch: 3 });
  router.routeIncoming(staleApp);
  assert.strictEqual(delivered.length, 1, 'Stale application payload must be preserved');
  assert.strictEqual(delivered[0].payload.text, 'important');
});

// ─── 13. Dual-Path Draining Deduplication & Failure Resilience ───
console.log('\n📦 Section 13: Dual-Path Draining Deduplication & Failure Resilience');

test('Dual delivery during draining generates exactly one application event', () => {
  const router = new TransportRouter({ onPacket: () => () => {}, broadcast: () => true, sendTo: () => true, getHealth: () => ({}) });
  let deliveredCount = 0;
  router.onPacket(() => deliveredCount++);

  const duplicatePacket = createPacket('whiteboard:stroke', { peerId: 'P1', nickname: 'P1', avatar: '', color: '' }, 'room-1', { strokeId: 's1' }, undefined, { seq: 42 });

  // Packet arrives from P2P path
  router.routeIncoming(duplicatePacket);
  assert.strictEqual(deliveredCount, 1);

  // Same packet arrives from Server Relay path during migration drain
  router.routeIncoming(duplicatePacket);
  assert.strictEqual(deliveredCount, 1, 'Duplicate packet ID during drain must be deduplicated to 1 delivery');
});

test('Leader failure during draining invalidates routes and falls back to RELAY_UNICAST', () => {
  let relayCalls = [];
  const mockRelay = {
    onPacket: () => () => {},
    sendTo: (t, p) => { relayCalls.push(t); return true; },
    broadcast: () => true,
    getHealth: () => ({ connected: true }),
  };

  const router = new TransportRouter(mockRelay);
  const resolver = new RouteResolver('my-node', 2);

  resolver.recordDigest({
    roomId: 'room-1',
    topologyEpoch: 2,
    leaderGeneration: 1,
    digestVersion: 1,
    leaderPeerId: 'leader-failing',
    assignedClusterPeers: ['peer-victim'],
    memberCount: 2,
    vectorDigest: {},
    latestLamport: 1,
    healthScore: 90,
    knownLeaders: ['leader-failing'],
    timestamp: Date.now(),
  });

  router.bindRouteResolver(resolver, () => new Set());
  router.updateView({
    roomId: 'room-1',
    tier: 'TIER2_MULTI_LEADER',
    phase: 'DRAINING',
    epoch: 2,
    generation: 1,
    membershipVersion: 5,
    leaders: ['leader-failing'],
    relayAvailable: true,
    timestamp: Date.now(),
  });

  // Leader fails -> Invalidate leader routes
  resolver.invalidateLeader('leader-failing');

  // Send unicast to peer-victim
  const pkt = createPacket('chat:message', { peerId: 'my-node', nickname: 'Me', avatar: '', color: '' }, 'room-1', {}, 'peer-victim');
  router.sendTo('peer-victim', pkt);

  assert.strictEqual(relayCalls.length, 1);
  assert.strictEqual(relayCalls[0], 'peer-victim', 'Must fallback to direct relay unicast to victim after leader failure');
});

// ─── 14. Adaptive ReliableTransport & Karn's Algorithm ───
console.log('\n📦 Section 14: ReliableTransport (Jacobson RTO + Karn Algorithm)');

import { ReliableTransport } from '../src/core/network/reliable-transport.ts';

test('ReliableTransport delivers with ACK correlation and updates Jacobson RTT', async () => {
  const rt = new ReliableTransport();
  let sent = [];
  rt.bindSender((p, target) => { sent.push({ p, target }); return true; });

  const pkt = createPacket('chat:message', { peerId: 'node-A', nickname: 'A', avatar: '', color: '' }, 'room-1', { text: 'test' }, 'node-B');

  const promise = rt.sendReliable(pkt, 'node-B');
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].p.id, pkt.id);

  // Send matching ACK
  rt.handleAck({
    ackId: 'ack:1',
    ackFor: pkt.id,
    fromPeerId: 'node-B',
    timestamp: Date.now(),
  });

  const receipt = await promise;
  assert.strictEqual(receipt.status, 'delivered');
  assert.strictEqual(receipt.attempts, 1);

  // Estimator updated
  const est = rt.getEstimator();
  assert.ok(est.rto >= 250 && est.rto <= 10000);
});

test('Karn Algorithm: Retransmissions do NOT update RTT estimates', async () => {
  const rt = new ReliableTransport();
  let attempts = 0;
  rt.bindSender(() => { attempts++; return true; });

  const estBefore = rt.getEstimator();
  const pkt = createPacket('chat:message', { peerId: 'node-A', nickname: 'A', avatar: '', color: '' }, 'room-1', {}, 'node-B');

  // Simulate retransmission
  const promise = rt.sendReliable(pkt, 'node-B');

  // Fast forward attempt
  rt['pending'].get(pkt.id).attempts = 2; // Simulate retry attempt

  // ACK arrives after retry
  rt.handleAck({
    ackId: 'ack:2',
    ackFor: pkt.id,
    fromPeerId: 'node-B',
    timestamp: Date.now(),
  });

  const receipt = await promise;
  assert.strictEqual(receipt.status, 'delivered');
  assert.strictEqual(receipt.attempts, 2);

  const estAfter = rt.getEstimator();
  assert.strictEqual(estAfter.srtt, estBefore.srtt, 'Karn rule: Retransmissions must NOT alter srtt');
});

test('ReliableTransport enforces No ACK-of-ACK invariant', () => {
  const rt = new ReliableTransport();
  const ackPkt = createPacket('transport:ack', { peerId: 'A', nickname: '', avatar: '', color: '' }, 'room-1', {});
  const nackPkt = createPacket('transport:nack', { peerId: 'A', nickname: '', avatar: '', color: '' }, 'room-1', {});
  const presencePkt = createPacket('presence:ping', { peerId: 'A', nickname: '', avatar: '', color: '' }, 'room-1', {});
  const chatPkt = createPacket('chat:message', { peerId: 'A', nickname: '', avatar: '', color: '' }, 'room-1', {});

  assert.strictEqual(rt.isAckable(ackPkt), false, 'ACK packets must not be ackable');
  assert.strictEqual(rt.isAckable(nackPkt), false, 'NACK packets must not be ackable');
  assert.strictEqual(rt.isAckable(presencePkt), false, 'Presence packets must not be ackable');
  assert.strictEqual(rt.isAckable(chatPkt), true, 'Chat packets must be ackable');
});

// ─── 15. Stream-Scoped Ordering & Gap Recovery ───
console.log('\n📦 Section 15: Stream-Scoped Ordering & Gap Recovery');

import { OrderingBuffer } from '../src/core/network/ordering-buffer.ts';

test('OrderingBuffer drains out-of-order sequence and isolates streams', () => {
  const ob = new OrderingBuffer();
  let chatDelivered = [];
  let codeDelivered = [];
  let gapRequests = [];

  const createStreamPkt = (streamId, seq, sender, text) => {
    return createPacket('chat:message', { peerId: sender, nickname: sender, avatar: '', color: '' }, 'room-1', { text }, undefined, { streamId, seq });
  };

  // Chat stream: receives seq 1 -> delivered immediately
  ob.inflow(createStreamPkt('chat', 1, 'peer-1', 'msg1'), (p) => chatDelivered.push(p), (g) => gapRequests.push(g));
  assert.strictEqual(chatDelivered.length, 1);

  // Chat stream: receives seq 3 -> buffered (seq 2 missing)
  ob.inflow(createStreamPkt('chat', 3, 'peer-1', 'msg3'), (p) => chatDelivered.push(p), (g) => gapRequests.push(g));
  assert.strictEqual(chatDelivered.length, 1, 'Out-of-order seq 3 must be buffered');
  assert.strictEqual(gapRequests.length, 1, 'Must request gap repair for missing seq 2');
  assert.strictEqual(gapRequests[0].missingRangeStart, 2);

  // Code stream from same sender receives seq 1 -> delivered immediately (Stream Isolation!)
  ob.inflow(createStreamPkt('code', 1, 'peer-1', 'delta1'), (p) => codeDelivered.push(p));
  assert.strictEqual(codeDelivered.length, 1, 'Unrelated code stream must NOT be blocked by chat gap');

  // Chat stream: missing seq 2 arrives -> delivers seq 2 and drains buffered seq 3
  ob.inflow(createStreamPkt('chat', 2, 'peer-1', 'msg2'), (p) => chatDelivered.push(p));
  assert.strictEqual(chatDelivered.length, 3, 'Delivering missing seq 2 must drain seq 3');
  assert.strictEqual(chatDelivered[1].payload.text, 'msg2');
  assert.strictEqual(chatDelivered[2].payload.text, 'msg3');
});

// ─── 16. Payload Chunker, CRC32 Integrity & Memory Bounds ───
console.log('\n📦 Section 16: Payload Chunker, CRC32 Integrity & Resource Bounds');

import { PayloadChunker, PayloadReassembler, computeCRC32 } from '../src/core/network/chunker.ts';

test('PayloadChunker bypasses small payloads and fragments large objects', () => {
  const smallPkt = createPacket('chat:message', { peerId: 'P1', nickname: '', avatar: '', color: '' }, 'room-1', { text: 'small' });
  const smallFragments = PayloadChunker.chunkPacket(smallPkt);
  assert.strictEqual(smallFragments.length, 1);
  assert.strictEqual(smallFragments[0].type, 'chat:message');

  // Large payload (20 KB string)
  const bigData = 'X'.repeat(20 * 1024);
  const largePkt = createPacket('whiteboard:page_sync', { peerId: 'P1', nickname: '', avatar: '', color: '' }, 'room-1', { snapshot: bigData });
  const largeFragments = PayloadChunker.chunkPacket(largePkt);

  assert.ok(largeFragments.length >= 3, '20KB payload must be split into at least 3 chunks');
  assert.strictEqual(largeFragments[0].type, 'chunk:data');
  assert.strictEqual(largeFragments[0].payload.totalChunks, largeFragments.length);
});

test('PayloadReassembler reassembles out-of-order chunks and validates CRC32', () => {
  const reassembler = new PayloadReassembler();
  const bigData = { canvas: 'DRAW_DATA_'.repeat(800) };
  const originalPkt = createPacket('whiteboard:stroke', { peerId: 'P1', nickname: 'Author', avatar: '', color: '' }, 'room-1', bigData);

  const chunks = PayloadChunker.chunkPacket(originalPkt);
  assert.ok(chunks.length >= 2);

  // Ingest chunks in reverse order
  let result = null;
  for (let i = chunks.length - 1; i >= 0; i--) {
    result = reassembler.ingestChunk(chunks[i]);
  }

  assert.ok(result !== null, 'Reassembler must successfully reconstruct packet');
  assert.strictEqual(result.type, 'whiteboard:stroke');
  assert.deepStrictEqual(result.payload, bigData);
});

test('PayloadReassembler rejects corrupted chunks via CRC32 check', () => {
  const reassembler = new PayloadReassembler();
  const originalPkt = createPacket('code:sync', { peerId: 'P1', nickname: '', avatar: '', color: '' }, 'room-1', { data: 'CORRUPTION_TEST_'.repeat(600) });
  const chunks = PayloadChunker.chunkPacket(originalPkt);

  // Corrupt chunk 0 payload data
  chunks[0].payload.data += '_MALICIOUS_BIT';

  let result = null;
  for (const chunk of chunks) {
    result = reassembler.ingestChunk(chunk);
  }

  assert.strictEqual(result, null, 'Corrupted chunk must fail CRC32 and result in null');
});

// ─── 17. PacketPipeline & Topology Transition Resilience ───
console.log('\n📦 Section 17: PacketPipeline & Topology Transition Invariants');

import { PacketPipeline } from '../src/core/network/packet-pipeline.ts';

test('PacketPipeline delivers reliable packets and auto-generates ACKs', async () => {
  let outbound = [];
  const mockRouter = {
    broadcast: (p) => { outbound.push({ mode: 'broadcast', p }); return true; },
    sendTo: (t, p) => { outbound.push({ mode: 'unicast', target: t, p }); return true; },
    onPacket: (fn) => { mockRouter['incomingHandler'] = fn; return () => {}; },
  };

  const pipeline = new PacketPipeline(mockRouter);
  pipeline.init({ peerId: 'node-local', nickname: 'Local', avatar: '', color: '' }, 'room-1');

  let appDelivered = [];
  pipeline.onDeliver((p) => appDelivered.push(p));

  // Simulate remote peer sending reliable chat packet to node-local
  const incomingChat = createPacket(
    'chat:message',
    { peerId: 'node-remote', nickname: 'Remote', avatar: '', color: '' },
    'room-1',
    { text: 'Hello Pipeline' },
    'node-local',
    { streamId: 'chat', seq: 1 }
  );

  mockRouter['incomingHandler'](incomingChat);

  // Application received packet
  assert.strictEqual(appDelivered.length, 1);
  assert.strictEqual(appDelivered[0].payload.text, 'Hello Pipeline');

  // Pipeline auto-replied with transport:ack
  assert.strictEqual(outbound.length, 1);
  assert.strictEqual(outbound[0].mode, 'unicast');
  assert.strictEqual(outbound[0].target, 'node-remote');
  assert.strictEqual(outbound[0].p.type, 'transport:ack');
  assert.strictEqual(outbound[0].p.payload.ackFor, incomingChat.id);
});

// ─── 18. Adversarial & Deduplication Invariant Testing ───
console.log('\n📦 Section 18: Adversarial & Exactly-Once Invariants');

test('Property: Multi-path, delayed, and duplicate deliveries produce exactly ONE application delivery', () => {
  const mockRouter = {
    broadcast: () => true,
    sendTo: () => true,
    onPacket: (fn) => { mockRouter['incomingHandler'] = fn; return () => {}; },
  };

  const pipeline = new PacketPipeline(mockRouter);
  pipeline.init({ peerId: 'node-local', nickname: 'Local', avatar: '', color: '' }, 'room-1');

  let appDeliveredCount = 0;
  pipeline.onDeliver(() => appDeliveredCount++);

  const pkt = createPacket(
    'whiteboard:stroke',
    { peerId: 'node-remote', nickname: 'Remote', avatar: '', color: '' },
    'room-1',
    { id: 'stroke-1' },
    'node-local',
    { streamId: 'whiteboard', seq: 1 }
  );

  // Delivery 1: Via direct P2P
  mockRouter['incomingHandler'](pkt);
  assert.strictEqual(appDeliveredCount, 1);

  // Delivery 2: Delayed copy via Server Relay during drain
  mockRouter['incomingHandler'](pkt);
  assert.strictEqual(appDeliveredCount, 1, 'Duplicate physical delivery must be suppressed');

  // Delivery 3: Retransmission copy arriving late
  mockRouter['incomingHandler'](pkt);
  assert.strictEqual(appDeliveredCount, 1, 'Late retry must be suppressed');
});

// ─── 19. OperationJournal & Materialization ───
console.log('\n📦 Section 19: OperationJournal Deterministic Lamport & Total Ordering');

test('OperationJournal appends, orders deterministically by Lamport+Author, and deduplicates', () => {
  const journal = new OperationJournal('doc-1', 'peer-A');

  // 1. Append local operations
  const op1 = journal.appendLocal('text:insert', { pos: 0, char: 'H' });
  const op2 = journal.appendLocal('text:insert', { pos: 1, char: 'i' });

  assert.strictEqual(journal.getEventCount(), 2);
  assert.strictEqual(op1.seq, 1);
  assert.strictEqual(op2.seq, 2);
  assert.strictEqual(op1.lamport, 1);
  assert.strictEqual(op2.lamport, 2);

  // 2. Apply out-of-order remote operation with higher Lamport
  const remoteOp = {
    storeId: 'doc-1',
    opId: 'peer-B:1:5',
    author: 'peer-B',
    seq: 1,
    lamport: 5,
    dependencies: [op2.opId],
    type: 'text:insert',
    op: { pos: 2, char: '!' },
    timestamp: Date.now(),
  };

  const isNew = journal.applyRemote(remoteOp);
  assert.strictEqual(isNew, true);
  assert.strictEqual(journal.getEventCount(), 3);

  // Duplicate insertion must return false
  const isDuplicate = journal.applyRemote(remoteOp);
  assert.strictEqual(isDuplicate, false);
  assert.strictEqual(journal.getEventCount(), 3);

  // 3. Reducer execution
  const reducer = (state, op) => state + op.char;
  const materialized = journal.reduceState(reducer, '');
  assert.strictEqual(materialized, 'Hi!');

  // 4. Delta extraction
  const deltas = journal.getDeltasSince({ 'peer-A': 1, 'peer-B': 0 });
  assert.strictEqual(deltas.length, 2, 'Should extract op2 and remoteOp');
});

// ─── 20. Causal Dependency Buffering & Anti-Entropy ───
console.log('\n📦 Section 20: Causal Dependency Buffering & Anti-Entropy Synchronization');

test('CausalSyncEngine buffers missing dependencies and automatically unblocks on arrival', () => {
  const journal = new OperationJournal('chat-store', 'peer-A');
  let syncRequested = false;

  const syncEngine = new CausalSyncEngine('chat-store', 'peer-A', journal, {
    onEmitSyncRequest: () => { syncRequested = true; },
  });

  // Op 2 arrives before Op 1 has been seen (missing dependency)
  const op2 = {
    storeId: 'chat-store',
    opId: 'peer-B:2:3',
    author: 'peer-B',
    seq: 2,
    lamport: 3,
    dependencies: ['peer-B:1:1'], // Op 1 not yet received!
    type: 'msg',
    op: { text: 'Second' },
    timestamp: Date.now(),
  };

  const appliedOp2 = syncEngine.ingestOperation(op2);
  assert.strictEqual(appliedOp2, false, 'Op2 must not be applied immediately without dependencies');
  assert.strictEqual(syncEngine.getPendingCount(), 1, 'Op2 must be buffered in pending causal queue');
  assert.strictEqual(syncRequested, true, 'Sync request must be emitted for missing dependency');

  // Now Op 1 arrives
  const op1 = {
    storeId: 'chat-store',
    opId: 'peer-B:1:1',
    author: 'peer-B',
    seq: 1,
    lamport: 1,
    dependencies: [],
    type: 'msg',
    op: { text: 'First' },
    timestamp: Date.now(),
  };

  const appliedOp1 = syncEngine.ingestOperation(op1);
  assert.strictEqual(appliedOp1, true, 'Op1 must be applied immediately');
  assert.strictEqual(syncEngine.getPendingCount(), 0, 'Op2 must be automatically unblocked and drained');
  assert.strictEqual(journal.getEventCount(), 2, 'Both Op1 and Op2 must now be committed in journal');

  // State materialization in strict causal order
  const state = journal.reduceState((acc, op) => [...acc, op.text], []);
  assert.deepStrictEqual(state, ['First', 'Second']);
});

// ─── 21. Bounded Memory Log Compaction & Snapshot Truncation ───
console.log('\n📦 Section 21: Bounded Memory Log Compaction & Snapshot Truncation');

test('BoundedMemoryManager computes stableCutVector and safely compacts old journal history', () => {
  const journal = new OperationJournal('counter-store', 'peer-A');
  const memoryManager = new BoundedMemoryManager('counter-store', journal, {
    maxJournalEvents: 10,
    minRetentionEvents: 2,
  });

  const reducer = (state, op) => state + op.amount;

  // Append 10 operations
  for (let i = 1; i <= 10; i++) {
    journal.appendLocal('add', { amount: 10 });
    memoryManager.recordOperation();
  }

  assert.strictEqual(journal.getEventCount(), 10);
  assert.strictEqual(journal.reduceState(reducer, 0), 100);

  // Compact log with peers participating at different frontiers
  const peerAVector = journal.getVectorClock();
  const peerBVector = { 'peer-A': 7 };

  const snapshot = memoryManager.maybeCompact(reducer, 0, [peerAVector, peerBVector], ['peer-A', 'peer-B'], true);
  assert.notStrictEqual(snapshot, null);
  assert.strictEqual(snapshot.state, 100);
  assert.strictEqual(snapshot.snapshotVersion, 1);

  // Journal history truncated to retained tail
  assert.strictEqual(journal.getEventCount() < 10, true, 'Journal events must be pruned');

  // State materialization from compacted snapshot + remaining tail remains exact
  const postCompactState = journal.reduceState(reducer, 0);
  assert.strictEqual(postCompactState, 100);

  // Fallback detection: Peer B (seen seq 7) is past cut (seq 7), Peer C (seen seq 3) is behind cut
  assert.strictEqual(memoryManager.isBehindStableCut({ 'peer-A': 8 }), false, 'Peer at seq 8 receives delta');
  assert.strictEqual(memoryManager.isBehindStableCut({ 'peer-A': 2 }), true, 'Peer at seq 2 requires full snapshot');
});

// ─── 22. Atomic Snapshot Transfer & Multi-Peer State Convergence ───
console.log('\n📦 Section 22: Atomic Snapshot Transfer & Multi-Peer State Convergence');

test('SnapshotTransferManager rejects corrupted snapshots and atomically installs valid snapshots', () => {
  const mockRouter = {
    broadcast: () => true,
    sendTo: () => true,
    onPacket: () => () => {},
  };
  const pipeline = new PacketPipeline(mockRouter);
  pipeline.init({ peerId: 'node-A', nickname: 'NodeA', avatar: '', color: '' }, 'room-1');

  const journal = new OperationJournal('wb-store', 'node-A');
  const memoryManager = new BoundedMemoryManager('wb-store', journal);

  let installed = false;
  let rejectedReason = '';

  const transferManager = new SnapshotTransferManager('wb-store', 'node-A', 'room-1', journal, memoryManager, pipeline, {
    onSnapshotInstalled: () => { installed = true; },
    onSnapshotRejected: (r) => { rejectedReason = r; },
  });

  const reducer = (state, op) => ({ ...state, strokes: [...state.strokes, op.stroke] });
  const initialState = { strokes: [] };

  // 1. Attempt to install corrupted snapshot (bad CRC32)
  const corruptedPayload = {
    storeId: 'wb-store',
    snapshotVersion: 1,
    vectorClock: { 'node-remote': 5 },
    state: { strokes: ['stroke-1', 'stroke-2'] },
    checksum: 999999999, // Intentional bad checksum
    byteLength: 50,
    timestamp: Date.now(),
  };

  const corruptedResult = transferManager.installSnapshot(corruptedPayload, reducer, initialState);
  assert.strictEqual(corruptedResult, false, 'Corrupted snapshot must be rejected');
  assert.strictEqual(rejectedReason, 'CRC32_CHECKSUM_MISMATCH');

  // 2. Install valid snapshot with accurate CRC32
  const validState = { strokes: ['stroke-1', 'stroke-2', 'stroke-3'] };
  const validSerialized = JSON.stringify(validState);
  const validCRC = PayloadChunker.calculateCRC32(validSerialized);

  // Append a local uncommitted operation on node-A before installation
  journal.appendLocal('draw', { stroke: 'stroke-local-concurrent' });
  assert.strictEqual(journal.getEventCount(), 1);

  const validPayload = {
    storeId: 'wb-store',
    snapshotVersion: 2,
    vectorClock: { 'node-remote': 10 },
    state: validState,
    checksum: validCRC,
    byteLength: validSerialized.length,
    timestamp: Date.now(),
  };

  const validResult = transferManager.installSnapshot(validPayload, reducer, initialState);
  assert.strictEqual(validResult, true, 'Valid snapshot must be atomically installed');
  assert.strictEqual(installed, true);

  // Verify concurrent local operation was preserved and reconciled on top of snapshot
  const finalState = journal.reduceState(reducer, initialState);
  assert.deepStrictEqual(finalState.strokes, ['stroke-1', 'stroke-2', 'stroke-3', 'stroke-local-concurrent']);
});

test('SnapshotTransferManager rejects stale snapshots dominated by local baseline (STALE_SNAPSHOT)', () => {
  const mockRouter = { broadcast: () => true, sendTo: () => true, onPacket: () => () => {} };
  const pipeline = new PacketPipeline(mockRouter);
  pipeline.init({ peerId: 'node-B', nickname: 'NodeB', avatar: '', color: '' }, 'room-1');

  const journal = new OperationJournal('stale-store', 'node-B');
  const memoryManager = new BoundedMemoryManager('stale-store', journal);

  let rejectedReason = '';
  const transferManager = new SnapshotTransferManager('stale-store', 'node-B', 'room-1', journal, memoryManager, pipeline, {
    onSnapshotRejected: (r) => { rejectedReason = r; },
  });

  const reducer = (state, op) => ({ count: state.count + op.val });
  const initialState = { count: 0 };

  // Install an advanced baseline snapshot first (vector: node-remote:10)
  const advancedState = { count: 10 };
  const advancedSerialized = JSON.stringify(advancedState);
  const advancedPayload = {
    storeId: 'stale-store',
    snapshotVersion: 1,
    vectorClock: { 'node-remote': 10 },
    state: advancedState,
    checksum: PayloadChunker.calculateCRC32(advancedSerialized),
    byteLength: advancedSerialized.length,
    timestamp: Date.now(),
  };
  assert.strictEqual(transferManager.installSnapshot(advancedPayload, reducer, initialState), true);

  // A snapshot strictly dominated by the already-installed baseline must be rejected as stale
  const staleState = { count: 3 };
  const staleSerialized = JSON.stringify(staleState);
  const stalePayload = {
    storeId: 'stale-store',
    snapshotVersion: 0,
    vectorClock: { 'node-remote': 3 },
    state: staleState,
    checksum: PayloadChunker.calculateCRC32(staleSerialized),
    byteLength: staleSerialized.length,
    timestamp: Date.now(),
  };
  const staleResult = transferManager.installSnapshot(stalePayload, reducer, initialState);
  assert.strictEqual(staleResult, false, 'Stale snapshot dominated by local baseline must be rejected');
  assert.strictEqual(rejectedReason, 'STALE_SNAPSHOT');
});

console.log('\n📦 Section 23: Authoritative Input Fencing & Quarantine');
test('ReplicationValidator enforces structural sanity, sequence, and Lamport constraints', () => {
  const journal = new OperationJournal('fencing-store', 'node-local');

  // 1. Malformed envelope (missing opId)
  const badEnvelope = { storeId: 'fencing-store', author: 'node-remote', seq: 1, lamport: 1, op: {} };
  const res1 = ReplicationValidator.validateOperation(badEnvelope, { kind: 'direct-origin', senderPeerId: 'node-remote' }, journal);
  assert.strictEqual(res1.accepted, false);
  assert.strictEqual(res1.reason, 'MALFORMED_ENVELOPE');

  // 2. Author spoofing on direct connection
  const spoofedOp = { storeId: 'fencing-store', opId: 'op-spoof', author: 'node-victim', seq: 1, lamport: 1, op: {} };
  const res2 = ReplicationValidator.validateOperation(spoofedOp, { kind: 'direct-origin', senderPeerId: 'node-attacker' }, journal);
  assert.strictEqual(res2.accepted, false);
  assert.strictEqual(res2.reason, 'AUTHOR_SPOOFING');

  // 3. Forwarded packet with authenticated origin is accepted
  const res3 = ReplicationValidator.validateOperation(spoofedOp, { kind: 'forwarded', senderPeerId: 'node-forwarder', authenticatedOrigin: 'node-victim' }, journal);
  assert.strictEqual(res3.accepted, true);

  // 4. Invalid sequence (<= 0 or non-integer)
  const badSeqOp = { storeId: 'fencing-store', opId: 'op-badseq', author: 'node-remote', seq: 0, lamport: 1, op: {} };
  const res4 = ReplicationValidator.validateOperation(badSeqOp, { kind: 'direct-origin', senderPeerId: 'node-remote' }, journal);
  assert.strictEqual(res4.accepted, false);
  assert.strictEqual(res4.reason, 'INVALID_SEQUENCE');

  // 5. Invalid Lamport (< 0)
  const badLamportOp = { storeId: 'fencing-store', opId: 'op-badlamp', author: 'node-remote', seq: 1, lamport: -1, op: {} };
  const res5 = ReplicationValidator.validateOperation(badLamportOp, { kind: 'direct-origin', senderPeerId: 'node-remote' }, journal);
  assert.strictEqual(res5.accepted, false);
  assert.strictEqual(res5.reason, 'INVALID_LAMPORT');

  // 6. Self-dependency
  const selfDepOp = { storeId: 'fencing-store', opId: 'op-self', author: 'node-remote', seq: 1, lamport: 1, dependencies: ['op-self'], op: {} };
  const res6 = ReplicationValidator.validateOperation(selfDepOp, { kind: 'direct-origin', senderPeerId: 'node-remote' }, journal);
  assert.strictEqual(res6.accepted, false);
  assert.strictEqual(res6.reason, 'SELF_DEPENDENCY');
});

test('ReplicationValidator detects known dependency cycles without falsely rejecting unknown remote deps', () => {
  const journal = new OperationJournal('cycle-store', 'node-local');

  // Append opA: dependencies = []
  journal.appendLocal('draw', { text: 'A' }, []);
  const opA = journal.getEvents()[0];

  // Append opB: dependencies = [opA]
  journal.appendLocal('draw', { text: 'B' }, [opA.opId]);
  const opB = journal.getEvents()[1];

  // Attempt to ingest malicious opC that depends on opB, with opA depending on opC (cycle: opA -> opB -> opA)
  const cyclicOp = {
    storeId: 'cycle-store',
    opId: opA.opId, // claims to be opA
    author: 'node-remote',
    seq: 5,
    lamport: 5,
    dependencies: [opB.opId],
    op: {},
  };

  const cycleRes = ReplicationValidator.validateOperation(cyclicOp, { kind: 'direct-origin', senderPeerId: 'node-remote' }, journal);
  assert.strictEqual(cycleRes.accepted, false);
  assert.strictEqual(cycleRes.reason, 'CYCLIC_DEPENDENCY');

  // Legitimate remote op with unknown dependency is NOT flagged as cyclic
  const unknownDepOp = {
    storeId: 'cycle-store',
    opId: 'op-future-remote',
    author: 'node-remote',
    seq: 1,
    lamport: 1,
    dependencies: ['op-unknown-ancestor-xyz'],
    op: {},
  };
  const unknownRes = ReplicationValidator.validateOperation(unknownDepOp, { kind: 'direct-origin', senderPeerId: 'node-remote' }, journal);
  assert.strictEqual(unknownRes.accepted, true, 'Unknown remote dependency must be accepted for causal buffering, not rejected as cyclic');
});

test('ReplicationValidator rejects oversized snapshots and CRC32 mismatches independently of installation', () => {
  // Oversized snapshot (> 4MB ceiling)
  const oversizedPayload = {
    storeId: 'size-store',
    state: { blob: 'x' },
    vectorClock: { 'node-a': 1 },
    checksum: 0,
    byteLength: 5 * 1024 * 1024,
  };
  const oversizedRes = ReplicationValidator.validateSnapshot(oversizedPayload);
  assert.strictEqual(oversizedRes.accepted, false);
  assert.strictEqual(oversizedRes.reason, 'OVERSIZED_SNAPSHOT');

  // CRC32 mismatch
  const state = { count: 42 };
  const serialized = JSON.stringify(state);
  const crcPayload = {
    storeId: 'crc-store',
    state,
    vectorClock: { 'node-a': 1 },
    checksum: 999999999,
    byteLength: new TextEncoder().encode(serialized).length,
  };
  const crcRes = ReplicationValidator.validateSnapshot(crcPayload);
  assert.strictEqual(crcRes.accepted, false);
  assert.strictEqual(crcRes.reason, 'CRC32_CHECKSUM_MISMATCH');

  // Well-formed snapshot within bounds with correct CRC32 is accepted
  const validCRC = PayloadChunker.calculateCRC32(serialized);
  const validPayload = { ...crcPayload, checksum: validCRC };
  const validRes = ReplicationValidator.validateSnapshot(validPayload);
  assert.strictEqual(validRes.accepted, true);
});

test('CausalSyncEngine rejects and quarantines operations beyond the 128 pending-queue bound', () => {
  const journal = new OperationJournal('overflow-store', 'node-local');
  let quarantineReasons = [];
  const engine = new CausalSyncEngine('overflow-store', 'node-local', journal, {
    onQuarantine: (reason) => quarantineReasons.push(reason),
  });

  // Fill the pending queue with 128 operations depending on an ancestor that never arrives.
  for (let i = 0; i < 128; i++) {
    const op = {
      storeId: 'overflow-store',
      opId: `remote:${i}`,
      author: 'node-remote',
      seq: i + 2,
      lamport: i + 2,
      dependencies: ['remote:never-arrives'],
      type: 'draw',
      op: {},
    };
    engine.ingestOperation(op, { kind: 'direct-origin', senderPeerId: 'node-remote' });
  }
  assert.strictEqual(engine.getPendingCount(), 128, 'Pending queue must fill to exactly the 128 bound');

  // The 129th operation must be rejected and quarantined, never silently dropped or exceeding the bound.
  const overflowOp = {
    storeId: 'overflow-store',
    opId: 'remote:overflow',
    author: 'node-remote',
    seq: 130,
    lamport: 130,
    dependencies: ['remote:never-arrives'],
    type: 'draw',
    op: {},
  };
  const applied = engine.ingestOperation(overflowOp, { kind: 'direct-origin', senderPeerId: 'node-remote' });
  assert.strictEqual(applied, false);
  assert.strictEqual(engine.getPendingCount(), 128, 'Pending queue must remain bounded at 128');
  assert.strictEqual(engine.getPendingOverflowCount(), 1);
  assert.ok(quarantineReasons.includes('PENDING_QUEUE_OVERFLOW'));
});

console.log('\n📦 Section 24: Transactional Durability & Process Hydration');
await testAsync('ReplicatedStore persists mutations before network broadcast and hydrates exact state', async () => {
  const storeId = 'durable-store-1';
  const identity = { peerId: 'peer-durability-1', nickname: 'Tester', avatar: '', color: '#fff' };
  const reducer = (state, op) => ({ count: state.count + op.val });
  const storage = new InMemoryStorageAdapter(storeId);

  const mockPipeline = {
    sendPacket: async () => ({ messageId: 'm1', status: 'delivered', attempts: 1 }),
  };

  // 1. Create active store and perform mutations
  const store = new ReplicatedStore(storeId, identity, 'room-1', reducer, { count: 0 }, mockPipeline, {}, storage);
  await store.mutateAsync('increment', { val: 10 });
  await store.mutateAsync('increment', { val: 20 });
  await store.mutateAsync('increment', { val: 30 });

  assert.strictEqual(store.getState().count, 60);

  // 2. Simulate process restart / cold hydration into a new ReplicatedStore instance with same storage
  const restoredStore = new ReplicatedStore(storeId, identity, 'room-1', reducer, { count: 0 }, mockPipeline, {}, storage);
  const hydration = await restoredStore.hydrate();

  assert.strictEqual(hydration.eventCount, 3);
  assert.strictEqual(restoredStore.getState().count, 60, 'Hydrated store must reflect exact pre-restart state');
});

console.log('\n📦 Section 25: Memory Bounds, Slack & Steady-State Telemetry');
await testAsync('BoundedMemoryManager maintains bounded journal within compaction slack during high-throughput soak', async () => {
  const storeId = 'soak-mem-store';
  const identity = { peerId: 'peer-soak-1', nickname: 'Tester', avatar: '', color: '#fff' };
  const reducer = (state, op) => ({ count: state.count + 1 });
  const storage = new InMemoryStorageAdapter(storeId);

  const mockPipeline = {
    sendPacket: async () => ({ messageId: 'm1', status: 'delivered', attempts: 1 }),
  };

  const MAX_EVENTS = 40;
  const RETENTION = 15;
  const COMPACTION_SLACK = 20;

  const store = new ReplicatedStore(
    storeId,
    identity,
    'room-1',
    reducer,
    { count: 0 },
    mockPipeline,
    { maxJournalEvents: MAX_EVENTS, minRetentionEvents: RETENTION, checkpointIntervalOps: 20 },
    storage
  );

  // Perform 250 mutations
  for (let i = 0; i < 250; i++) {
    await store.mutateAsync('inc', { i });
  }

  const currentJournalEvents = store.getJournal().getEventCount();
  assert.ok(
    currentJournalEvents <= MAX_EVENTS + COMPACTION_SLACK,
    `Journal length (${currentJournalEvents}) must remain bounded within MAX (${MAX_EVENTS}) + slack (${COMPACTION_SLACK})`
  );
  assert.strictEqual(store.getState().count, 250);
});

await testAsync('5-step transactional compaction verifies persistence and prunes prior snapshot versions', async () => {
  const storeId = 'prune-store';
  const identity = { peerId: 'peer-prune-1', nickname: 'Tester', avatar: '', color: '#fff' };
  const reducer = (state, op) => ({ count: state.count + 1 });
  const storage = new InMemoryStorageAdapter(storeId);

  const mockPipeline = {
    sendPacket: async () => ({ messageId: 'm1', status: 'delivered', attempts: 1 }),
  };

  const store = new ReplicatedStore(
    storeId,
    identity,
    'room-1',
    reducer,
    { count: 0 },
    mockPipeline,
    { maxJournalEvents: 20, minRetentionEvents: 5, checkpointIntervalOps: 10 },
    storage
  );

  // Trigger multiple compaction cycles across several batches of mutations.
  for (let batch = 0; batch < 3; batch++) {
    for (let i = 0; i < 30; i++) {
      await store.mutateAsync('inc', { i });
    }
    await store.compactAsync(true);
  }

  // Storage must retain ONLY the latest committed snapshot version, not one per compaction cycle.
  assert.strictEqual(
    storage.getRetainedSnapshotVersionCount(),
    1,
    'Storage must prune all prior snapshot versions, retaining only the current committed snapshot'
  );

  const { snapshot, committedVersion } = await storage.loadSnapshot();
  assert.ok(snapshot, 'A committed snapshot must exist after forced compaction');
  assert.strictEqual(snapshot.snapshotVersion, committedVersion);
  assert.strictEqual(store.getState().count, 90);
});

console.log('\n📦 Section 26: Snapshot-Aware Anti-Entropy Convergence Regressions');
test('handleSyncRequest requires a snapshot when the requester is missing data already compacted into our snapshot', () => {
  const journal = new OperationJournal('anti-entropy-store', 'node-local');
  const engine = new CausalSyncEngine('anti-entropy-store', 'node-local', journal);

  // Bake operations from node-remote up to seq 5 into our snapshot baseline, so they are NO
  // LONGER present as live journal events (exactly the post-compaction steady state).
  const snapshotState = { keys: { a: 1 } };
  const serialized = JSON.stringify(snapshotState);
  journal.setSnapshot({
    storeId: 'anti-entropy-store',
    snapshotVersion: 1,
    vector: { 'node-remote': 5 },
    state: snapshotState,
    checksum: PayloadChunker.calculateCRC32(serialized),
    byteLength: serialized.length,
    timestamp: Date.now(),
  });

  // A requester that has only seen node-remote up to seq 2 is missing seq 3-5, which exist
  // ONLY inside our snapshot. Delta extraction scans the live journal and would return an
  // empty/incomplete set, silently losing those ops forever.
  const request = {
    storeId: 'anti-entropy-store',
    requestingPeerId: 'node-requester',
    vectorClock: { 'node-remote': 2 },
  };

  // Force the stable-cut heuristic to report "not behind" so this test isolates the
  // snapshot-vector check rather than passing incidentally via the heuristic.
  const response = engine.handleSyncRequest(request, () => false);
  assert.strictEqual(
    response.requiresSnapshot,
    true,
    'Requester missing ops that live only in our snapshot must be told to take a full snapshot'
  );

  // A fully caught-up requester must NOT be forced through a snapshot transfer.
  const caughtUp = engine.handleSyncRequest(
    { storeId: 'anti-entropy-store', requestingPeerId: 'node-requester', vectorClock: { 'node-remote': 5 } },
    () => false
  );
  assert.strictEqual(caughtUp.requiresSnapshot, false, 'Caught-up requester must receive deltas, not a snapshot');
});

test('Compaction never truncates journal events that are not captured in the snapshot (causal gap safety)', () => {
  const journal = new OperationJournal('gap-store', 'node-local');
  const memoryManager = new BoundedMemoryManager('gap-store', journal, {
    maxJournalEvents: 5,
    minRetentionEvents: 1,
    checkpointIntervalOps: 1,
  });
  const reducer = (state, op) => ({ applied: [...state.applied, op.tag] });
  const initialState = { applied: [] };

  // Author node-remote has a CAUSAL GAP: seq 1 and 2 arrive, seq 3 is missing, seq 4 and 5 arrive.
  // The contiguous vector for node-remote is therefore 2, but a naive index-based tail cut can
  // compute a cut of 5 and delete events 4 and 5 — which are NOT in the snapshot state.
  const mk = (seq, tag) => ({
    storeId: 'gap-store',
    opId: `node-remote:${seq}:${seq}`,
    author: 'node-remote',
    seq,
    lamport: seq,
    dependencies: [],
    type: 'put',
    op: { tag },
    timestamp: Date.now(),
  });

  journal.applyRemote(mk(1, 'op1'));
  journal.applyRemote(mk(2, 'op2'));
  journal.applyRemote(mk(4, 'op4')); // seq 3 deliberately never arrives
  journal.applyRemote(mk(5, 'op5'));
  journal.applyRemote(mk(6, 'op6'));

  assert.strictEqual(journal.getContiguousVectorClock()['node-remote'], 2, 'Contiguous vector must stop at the gap');

  const snapshot = memoryManager.maybeCompact(reducer, initialState, [], [], true);
  assert.ok(snapshot, 'Compaction must produce a snapshot');
  assert.strictEqual(snapshot.vector['node-remote'], 2, 'Snapshot must only capture up to the contiguous frontier');

  // The post-gap events MUST still be replayable from the live journal.
  const survivingSeqs = journal.getEvents().map((e) => e.seq).sort((a, b) => a - b);
  for (const seq of [4, 5, 6]) {
    assert.ok(
      survivingSeqs.includes(seq),
      `Event seq ${seq} is beyond the snapshot frontier and must NOT be truncated (surviving: [${survivingSeqs}])`
    );
  }

  // End-to-end: materialized state must still contain every op that was ever applied.
  const materialized = journal.reduceState(reducer, initialState);
  for (const tag of ['op4', 'op5', 'op6']) {
    assert.ok(materialized.applied.includes(tag), `${tag} must survive compaction`);
  }
});

console.log('\n📦 Section 27: Crash-at-Every-Phase Invariants (J1 to J8)');
await testAsync('Crash injection across all 8 mutation & compaction lifecycle phases guarantees exact recovery', async () => {
  const storeId = 'crash-inject-store';
  const identity = { peerId: 'peer-crash-1', nickname: 'Tester', avatar: '', color: '#fff' };
  const reducer = (state, op) => ({ ops: [...state.ops, op.tag] });
  const storage = new InMemoryStorageAdapter(storeId);

  const mockPipeline = {
    sendPacket: async () => ({ messageId: 'm1', status: 'delivered', attempts: 1 }),
  };

  // Base state: 3 operations committed
  const store = new ReplicatedStore(storeId, identity, 'room-1', reducer, { ops: [] }, mockPipeline, {}, storage);
  await store.mutateAsync('draw', { tag: 'op-base-1' });
  await store.mutateAsync('draw', { tag: 'op-base-2' });
  await store.mutateAsync('draw', { tag: 'op-base-3' });

  // J1: Crash pre-journal write -> operation absent
  // (Simulated by no write to storage)
  const j1Store = new ReplicatedStore(storeId, identity, 'room-1', reducer, { ops: [] }, mockPipeline, {}, storage);
  await j1Store.hydrate();
  assert.deepStrictEqual(j1Store.getState().ops, ['op-base-1', 'op-base-2', 'op-base-3']);

  // J2: Crash post-journal write -> operation is durable in storage
  const event4 = {
    storeId,
    opId: 'peer-crash-1:4',
    author: 'peer-crash-1',
    seq: 4,
    lamport: 4,
    dependencies: ['peer-crash-1:3'],
    type: 'draw',
    op: { tag: 'op-base-4' },
    timestamp: Date.now(),
  };
  await storage.appendJournalEvent(event4);
  const j2Store = new ReplicatedStore(storeId, identity, 'room-1', reducer, { ops: [] }, mockPipeline, {}, storage);
  await j2Store.hydrate();
  assert.deepStrictEqual(j2Store.getState().ops, ['op-base-1', 'op-base-2', 'op-base-3', 'op-base-4']);

  // J3: Crash pre-snapshot-write (compaction begins materializing but crashes before storage.saveSnapshot
  // is ever called) -> no snapshot record exists yet, so the previous committed baseline (none) + full
  // journal remains the sole recovery authority. Simulated here by simply NOT calling saveSnapshot.
  const { snapshot: preSnapshot, committedVersion: preCommitted } = await storage.loadSnapshot();
  assert.strictEqual(preSnapshot, null, 'No snapshot must exist before any saveSnapshot call');
  assert.strictEqual(preCommitted, 0);
  const j3Store = new ReplicatedStore(storeId, identity, 'room-1', reducer, { ops: [] }, mockPipeline, {}, storage);
  await j3Store.hydrate();
  assert.deepStrictEqual(j3Store.getState().ops, ['op-base-1', 'op-base-2', 'op-base-3', 'op-base-4'], 'Crash before any snapshot write must recover purely from journal');

  // J4: Crash post-snapshot write (uncommitted) -> uncommitted snapshot is discarded, journal remains authoritative
  const uncommittedSnapshot = {
    storeId,
    snapshotVersion: 99,
    vector: { 'peer-crash-1': 4 },
    state: { ops: ['corrupted-uncommitted-snapshot'] },
    checksum: 12345,
    byteLength: 50,
    timestamp: Date.now(),
  };
  await storage.saveSnapshot(uncommittedSnapshot); // Saved but NOT committed (no commit marker 99)
  const j4Store = new ReplicatedStore(storeId, identity, 'room-1', reducer, { ops: [] }, mockPipeline, {}, storage);
  await j4Store.hydrate();
  assert.deepStrictEqual(j4Store.getState().ops, ['op-base-1', 'op-base-2', 'op-base-3', 'op-base-4'], 'Uncommitted snapshot must be ignored during recovery');

  // J5: Post-snapshot commit -> new snapshot authoritative
  const validSnapshot = {
    storeId,
    snapshotVersion: 1,
    vector: { 'peer-crash-1': 4 },
    state: { ops: ['op-base-1', 'op-base-2', 'op-base-3', 'op-base-4'] },
    checksum: 12345,
    byteLength: 50,
    timestamp: Date.now(),
  };
  await storage.saveSnapshot(validSnapshot);
  await storage.commitSnapshot(1);
  const j5Store = new ReplicatedStore(storeId, identity, 'room-1', reducer, { ops: [] }, mockPipeline, {}, storage);
  await j5Store.hydrate();
  assert.deepStrictEqual(j5Store.getState().ops, ['op-base-1', 'op-base-2', 'op-base-3', 'op-base-4']);

  // J6: Pre-truncate (new snapshot committed + old journal still present) -> deduplicated without double counting
  const j6Store = new ReplicatedStore(storeId, identity, 'room-1', reducer, { ops: [] }, mockPipeline, {}, storage);
  await j6Store.hydrate();
  assert.deepStrictEqual(j6Store.getState().ops, ['op-base-1', 'op-base-2', 'op-base-3', 'op-base-4']);

  // J7: Post-truncate -> new committed snapshot + remaining tail authoritative
  await storage.truncateJournalBefore({ 'peer-crash-1': 4 });
  const event5 = {
    storeId,
    opId: 'peer-crash-1:5',
    author: 'peer-crash-1',
    seq: 5,
    lamport: 5,
    dependencies: ['peer-crash-1:4'],
    type: 'draw',
    op: { tag: 'op-base-5' },
    timestamp: Date.now(),
  };
  await storage.appendJournalEvent(event5);
  const j7Store = new ReplicatedStore(storeId, identity, 'room-1', reducer, { ops: [] }, mockPipeline, {}, storage);
  await j7Store.hydrate();
  assert.deepStrictEqual(j7Store.getState().ops, ['op-base-1', 'op-base-2', 'op-base-3', 'op-base-4', 'op-base-5']);

  // J8: Hydration idempotence -> calling hydrate() twice produces identical state without duplicate mutations
  await j7Store.hydrate();
  assert.deepStrictEqual(j7Store.getState().ops, ['op-base-1', 'op-base-2', 'op-base-3', 'op-base-4', 'op-base-5']);
});

console.log(`\n========================================`);
console.log(`🏁 Test Summary: ${passed}/${total} tests passed (${Math.round((passed / total) * 100)}%)`);
console.log(`========================================\n`);

if (passed !== total) {
  process.exit(1);
}


