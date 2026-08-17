// ─── Automated Topology & Resilience Test Suite ───

import assert from 'assert';
import { TierCoordinator } from '../src/core/topology/tier-coordinator.ts';
import { LeaderElectionEngine } from '../src/core/topology/leader-election.ts';
import { LeaderMesh } from '../src/core/topology/leader-mesh.ts';
import {
  createVectorClock,
  incrementVectorClock,
  mergeVectorClocks,
  compareVectorClocks,
  generateOperationId,
} from '../src/core/replication/vector-clock.ts';
import { ReplicatedEventLog } from '../src/core/replication/event-log.ts';

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

test('TierCoordinator starts evaluating on 5 peers and cancels on drop', () => {
  const coordinator = new TierCoordinator();
  coordinator.updatePeerCount(5);
  assert.strictEqual(coordinator.getLifecycleState(), 'TIER1_EVALUATING');

  // Drops to 4 peers before evaluation finishes -> cancels
  coordinator.updatePeerCount(4);
  assert.strictEqual(coordinator.getLifecycleState(), 'STABLE_TIER1');
  assert.strictEqual(coordinator.getCurrentTier(), 'TIER1_FULL_MESH');
});

console.log(`\n========================================`);
console.log(`🏁 Test Summary: ${passed}/${total} tests passed (${Math.round((passed / total) * 100)}%)`);
console.log(`========================================\n`);

if (passed !== total) {
  process.exit(1);
}
