// ─── Adversarial Mesh Stress Harness ───
//
// Drives PeerSignaling and LinkMonitor against a simulated mesh whose links can be cut,
// whose server can be killed, and whose peers can churn — the failures that decide whether
// "the server is only needed for new connections" is true or merely intended.
//
// This is not a unit test. It is built to break things: every scenario below either found a
// real defect or exists because a plausible one had to be ruled out.

import assert from 'assert';
import { PeerSignaling, MAX_SIGNAL_HOPS } from '../src/core/network/peer-signaling.ts';
import { LinkMonitor, repairDelayFor, DISCONNECT_GRACE_MS } from '../src/core/network/link-monitor.ts';

let passed = 0;
let total = 0;
const failures = [];

function scenario(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
  }
}

/**
 * A mesh of peers where any link can be cut. Signals are delivered synchronously, which
 * makes ordering deterministic and failures reproducible.
 */
class SimMesh {
  constructor(peerIds, { serverUp = true } = {}) {
    this.peerIds = [...peerIds];
    this.links = new Set(); // "a|b" undirected, sorted
    this.serverUp = serverUp;
    this.serverSignals = 0;
    this.delivered = [];
    this.nodes = new Map();

    for (const id of this.peerIds) {
      const node = {
        id,
        applied: [],
        signaling: null,
      };
      node.signaling = new PeerSignaling(
        (peerId) => this.isLinked(id, peerId),
        () => this.neighbours(id),
        (targetPeerId, payload) => this.deliver(id, targetPeerId, payload),
        (targetPeerId, kind) => {
          if (!this.serverUp) return; // server down: signal is simply lost
          this.serverSignals++;
          const target = this.nodes.get(targetPeerId);
          if (target) target.applied.push({ via: 'server', kind, from: id });
        }
      );
      node.signaling.setMyPeerId(id);
      this.nodes.set(id, node);
    }
  }

  key(a, b) {
    return [a, b].sort().join('|');
  }

  link(a, b) {
    this.links.add(this.key(a, b));
  }

  linkAll() {
    for (let i = 0; i < this.peerIds.length; i++) {
      for (let j = i + 1; j < this.peerIds.length; j++) {
        this.link(this.peerIds[i], this.peerIds[j]);
      }
    }
  }

  cut(a, b) {
    this.links.delete(this.key(a, b));
  }

  isLinked(a, b) {
    return this.links.has(this.key(a, b));
  }

  neighbours(id) {
    return this.peerIds.filter((p) => p !== id && this.isLinked(id, p));
  }

  /** One mesh hop. Returns false when the link is not usable, mirroring sendPacket. */
  deliver(fromId, toId, payload) {
    if (!this.isLinked(fromId, toId)) return false;
    const target = this.nodes.get(toId);
    if (!target) return false;

    this.delivered.push({ from: fromId, to: toId, payload });
    const result = target.signaling.handleInbound(payload, { from: { peerId: fromId } });
    if (result) {
      target.applied.push({ via: 'mesh', kind: result.kind, from: result.originPeerId, seq: result.seq });
    }
    return true;
  }
}

console.log('\n🔥 Adversarial Mesh Stress — server-independence of TIER1/TIER2\n');

console.log('── Scenario A: established mesh repairs itself with the server dead ──');

scenario('broken link is renegotiated via a common neighbour, server never touched', () => {
  const mesh = new SimMesh(['a', 'b', 'c'], { serverUp: false });
  mesh.linkAll();
  mesh.cut('a', 'b'); // the link that must be repaired

  const res = mesh.nodes.get('a').signaling.route('b', 'offer', { sdp: 'v=0' });

  assert.strictEqual(res.transport, 'peer-relay', `expected peer-relay, got ${res.transport}`);
  assert.strictEqual(res.via, 'c');
  assert.strictEqual(mesh.serverSignals, 0, 'server was used despite a viable mesh path');

  const bApplied = mesh.nodes.get('b').applied;
  assert.strictEqual(bApplied.length, 1, 'offer did not reach b');
  assert.strictEqual(bApplied[0].from, 'a', 'origin lost across the relay hop');
});

scenario('full offer/answer/ICE round trip completes with the server dead', () => {
  const mesh = new SimMesh(['a', 'b', 'c'], { serverUp: false });
  mesh.linkAll();
  mesh.cut('a', 'b');

  mesh.nodes.get('a').signaling.route('b', 'offer', { sdp: 'offer' });
  mesh.nodes.get('b').signaling.route('a', 'answer', { sdp: 'answer' });
  for (let i = 0; i < 6; i++) {
    mesh.nodes.get('a').signaling.route('b', 'ice', { candidate: `a-cand-${i}` });
    mesh.nodes.get('b').signaling.route('a', 'ice', { candidate: `b-cand-${i}` });
  }

  assert.strictEqual(mesh.serverSignals, 0, 'server was needed for a repair');
  assert.strictEqual(mesh.nodes.get('a').applied.filter((x) => x.kind === 'ice').length, 6);
  assert.strictEqual(mesh.nodes.get('b').applied.filter((x) => x.kind === 'ice').length, 6);
  assert.ok(mesh.nodes.get('a').applied.some((x) => x.kind === 'answer'), 'answer never arrived');
});

scenario('direct link is preferred over relay when it is still open', () => {
  // Renegotiation (camera on, ICE restart on a degraded-but-alive link) must not take a
  // detour through another peer.
  const mesh = new SimMesh(['a', 'b', 'c'], { serverUp: false });
  mesh.linkAll();

  const res = mesh.nodes.get('a').signaling.route('b', 'offer', { sdp: 'renegotiate' });
  assert.strictEqual(res.transport, 'direct');
  assert.strictEqual(mesh.delivered.length, 1, 'renegotiation took extra hops');
});

console.log('\n── Scenario B: the server is genuinely required ──');

scenario('isolated peer with no mesh path falls back to the server', () => {
  const mesh = new SimMesh(['a', 'b'], { serverUp: true });
  // No links at all — two peers who have never met.
  const res = mesh.nodes.get('a').signaling.route('b', 'offer', { sdp: 'v=0' });

  assert.strictEqual(res.transport, 'server');
  assert.strictEqual(mesh.serverSignals, 1);
});

scenario('a partitioned mesh does not silently swallow signals', () => {
  // a-c linked, b-d linked, no path between the halves.
  const mesh = new SimMesh(['a', 'b', 'c', 'd'], { serverUp: true });
  mesh.link('a', 'c');
  mesh.link('b', 'd');

  const res = mesh.nodes.get('a').signaling.route('b', 'offer', { sdp: 'v=0' });

  // 'a' hands it to 'c', its only neighbour. 'c' cannot reach 'b' and drops it. The signal
  // is lost — which is correct and must be visible, not silent, so the caller's retry can
  // eventually reach the server.
  const cStats = mesh.nodes.get('c').signaling.getStats();
  assert.strictEqual(res.transport, 'peer-relay');
  assert.strictEqual(cStats.droppedNoRoute, 1, 'relay drop was not accounted for');
  assert.strictEqual(mesh.nodes.get('b').applied.length, 0);
});

console.log('\n── Scenario C: hostile and malformed input ──');

scenario('signal amplification is bounded and never recurses', () => {
  const mesh = new SimMesh(['a', 'b', 'c', 'd', 'e'], { serverUp: false });
  mesh.linkAll();
  mesh.cut('a', 'b');

  mesh.nodes.get('a').signaling.route('b', 'offer', { sdp: 'v=0' });

  // Relay fan-out is 3, so the worst case is 3 sends from the originator plus 3 forwards.
  // Anything beyond that means a forwarded signal was forwarded again — a loop.
  const FANOUT = 3;
  assert.ok(
    mesh.delivered.length <= FANOUT * 2,
    `signal amplified to ${mesh.delivered.length} sends, above the ${FANOUT * 2} bound`
  );

  // And the duplicates must be harmless: the target applies the offer exactly once, the
  // rest are rejected by the sequence guard.
  const applied = mesh.nodes.get('b').applied.filter((x) => x.kind === 'offer');
  assert.strictEqual(applied.length, 1, `duplicate relayed offers were applied ${applied.length} times`);
});

scenario('the hop budget terminates forwarding', () => {
  // This scenario previously asserted a hard 1-hop limit. That limit existed only because
  // without a routing table there was no loop prevention, so refusing to forward twice was
  // the only safe rule — at the cost of making a peer two hops away unreachable through the
  // mesh. Link-state routing forwards along a shortest-path tree, which cannot cycle, so
  // the budget is now a backstop rather than the primary defence.
  //
  // The property that must still hold is unchanged: a signal cannot circulate forever.
  const mesh = new SimMesh(['a', 'b', 'c'], { serverUp: false });
  mesh.linkAll();

  const exhausted = {
    targetPeerId: 'b',
    originPeerId: 'a',
    kind: 'offer',
    data: {},
    seq: 1,
    hops: MAX_SIGNAL_HOPS, // budget spent
  };
  mesh.nodes.get('c').signaling.handleInbound(exhausted, { from: { peerId: 'a' } });

  assert.strictEqual(mesh.nodes.get('c').signaling.getStats().droppedHops, 1);
  assert.strictEqual(mesh.nodes.get('b').applied.length, 0, 'hop budget did not terminate forwarding');

  // And one hop below the budget must still be forwarded, or the budget is off by one and
  // reachability silently shrinks.
  const withinBudget = { ...exhausted, seq: 2, hops: MAX_SIGNAL_HOPS - 1 };
  mesh.nodes.get('c').signaling.handleInbound(withinBudget, { from: { peerId: 'a' } });
  assert.ok(mesh.nodes.get('b').applied.length > 0, 'a signal inside the budget was dropped');
});

scenario('stale session descriptions are rejected, ICE is not', () => {
  const mesh = new SimMesh(['a', 'b'], { serverUp: false });
  mesh.link('a', 'b');
  const b = mesh.nodes.get('b').signaling;

  const mk = (kind, seq) => ({ targetPeerId: 'b', originPeerId: 'a', kind, data: {}, seq, hops: 0 });

  assert.ok(b.handleInbound(mk('offer', 5), {}), 'fresh offer rejected');
  assert.strictEqual(b.handleInbound(mk('offer', 3), {}), null, 'stale offer applied');
  assert.strictEqual(b.handleInbound(mk('offer', 5), {}), null, 'replayed offer applied');

  // ICE must remain order-independent: candidates are additive facts, and ordering them
  // would discard usable network paths.
  assert.ok(b.handleInbound(mk('ice', 1), {}), 'out-of-order ICE was dropped');
  assert.ok(b.handleInbound(mk('ice', 2), {}), 'ICE dropped');
});

scenario('malformed payloads are rejected without throwing', () => {
  const mesh = new SimMesh(['a', 'b'], { serverUp: false });
  mesh.link('a', 'b');
  const b = mesh.nodes.get('b').signaling;

  for (const bad of [null, undefined, {}, { targetPeerId: 42 }, { targetPeerId: null }]) {
    assert.strictEqual(b.handleInbound(bad, {}), null, `accepted malformed payload ${JSON.stringify(bad)}`);
  }
});

scenario('origin tracking is bounded under a flood of distinct peers', () => {
  const mesh = new SimMesh(['victim'], { serverUp: false });
  const v = mesh.nodes.get('victim').signaling;

  for (let i = 0; i < 5000; i++) {
    v.handleInbound(
      { targetPeerId: 'victim', originPeerId: `attacker-${i}`, kind: 'offer', data: {}, seq: 1, hops: 0 },
      {}
    );
  }
  const tracked = v.originState.size;
  assert.ok(tracked <= 500, `origin map grew unbounded to ${tracked}`);
});

console.log('\n── Scenario D: link liveness under adversarial conditions ──');

scenario('a half-open channel is detected and declared dead', () => {
  // The channel still reports itself open, but nothing ever answers — a suspended tab.
  let now = 0;
  const dead = [];
  const monitor = new LinkMonitor(
    () => ['ghost'],
    () => true, // probes "send" successfully into the void
    (peerId) => dead.push(peerId),
    { sweepIntervalMs: 1000, silenceThresholdMs: 5000, maxOutstandingProbes: 3 }
  );

  monitor.noteInbound('ghost');
  const realNow = Date.now;
  try {
    // Advance past the silence threshold, then sweep until the probe budget is spent.
    Date.now = () => realNow.call(Date) + 10_000;
    for (let i = 0; i < 5; i++) monitor['sweep']();
  } finally {
    Date.now = realNow;
  }

  assert.deepStrictEqual(dead, ['ghost'], 'half-open link was never declared dead');
});

scenario('a busy link is never probed', () => {
  let probes = 0;
  const monitor = new LinkMonitor(
    () => ['busy'],
    () => {
      probes++;
      return true;
    },
    () => {},
    { sweepIntervalMs: 100, silenceThresholdMs: 5000, maxOutstandingProbes: 3 }
  );

  for (let i = 0; i < 20; i++) {
    monitor.noteInbound('busy'); // ordinary traffic is its own proof of life
    monitor['sweep']();
  }
  assert.strictEqual(probes, 0, 'probed a link that was carrying traffic');
});

scenario('a peer that answers late recovers instead of being killed', () => {
  let dead = 0;
  const monitor = new LinkMonitor(
    () => ['flaky'],
    () => true,
    () => dead++,
    { sweepIntervalMs: 1000, silenceThresholdMs: 1, maxOutstandingProbes: 3 }
  );

  monitor.noteInbound('flaky');
  monitor['sweep'](); // probe 1 unanswered
  monitor['sweep'](); // probe 2 unanswered
  monitor.notePong('flaky', Date.now() - 40); // finally answers
  for (let i = 0; i < 2; i++) monitor['sweep']();

  assert.strictEqual(dead, 0, 'killed a link that recovered within the probe budget');
  const h = monitor.getHealth().find((x) => x.peerId === 'flaky');
  assert.ok(h && h.rttMs !== null, 'RTT was not recorded');
});

scenario('health map does not grow with departed peers', () => {
  let connected = Array.from({ length: 50 }, (_, i) => `p${i}`);
  const monitor = new LinkMonitor(
    () => connected,
    () => true,
    () => {},
    { sweepIntervalMs: 1000, silenceThresholdMs: 999_999, maxOutstandingProbes: 3 }
  );

  connected.forEach((p) => monitor.noteInbound(p));
  assert.strictEqual(monitor.getStats().tracked, 50);

  connected = ['p0']; // everyone else leaves
  monitor['sweep']();
  assert.strictEqual(monitor.getStats().tracked, 1, 'departed peers leaked health entries');
});

scenario('tracked links are bounded against a flood', () => {
  const monitor = new LinkMonitor(() => [], () => true, () => {});
  for (let i = 0; i < 10_000; i++) monitor.noteInbound(`flood-${i}`);
  assert.ok(monitor.getStats().tracked <= 300, `health map grew to ${monitor.getStats().tracked}`);
});

console.log('\n── Scenario E: churn and scale ──');

scenario('20-peer mesh losing half its links still repairs entirely off-server', () => {
  const peers = Array.from({ length: 20 }, (_, i) => `peer-${String(i).padStart(2, '0')}`);
  const mesh = new SimMesh(peers, { serverUp: false });
  mesh.linkAll();

  // Cut every link involving the first five peers to each other.
  const broken = [];
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      mesh.cut(peers[i], peers[j]);
      broken.push([peers[i], peers[j]]);
    }
  }

  let relayed = 0;
  for (const [a, b] of broken) {
    const res = mesh.nodes.get(a).signaling.route(b, 'offer', { sdp: 'repair' });
    if (res.transport === 'peer-relay') relayed++;
  }

  assert.strictEqual(relayed, broken.length, 'some repairs could not find a mesh path');
  assert.strictEqual(mesh.serverSignals, 0, 'server was needed despite a dense mesh');

  for (const [, b] of broken) {
    assert.ok(mesh.nodes.get(b).applied.length > 0, `${b} never received its repair offer`);
  }
});

scenario('server-free ratio stays high across sustained churn', () => {
  const peers = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const mesh = new SimMesh(peers, { serverUp: true });
  mesh.linkAll();

  // Repeatedly break and repair random links.
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let round = 0; round < 200; round++) {
    const a = peers[Math.floor(rand() * peers.length)];
    const b = peers[Math.floor(rand() * peers.length)];
    if (a === b) continue;
    mesh.cut(a, b);
    mesh.nodes.get(a).signaling.route(b, 'offer', { sdp: 'v=0' });
    mesh.link(a, b); // repaired
  }

  const totals = peers.reduce(
    (acc, p) => {
      const s = mesh.nodes.get(p).signaling.getStats();
      acc.direct += s.direct;
      acc.relay += s.peerRelay;
      acc.server += s.server;
      return acc;
    },
    { direct: 0, relay: 0, server: 0 }
  );

  const ratio = (totals.direct + totals.relay) / (totals.direct + totals.relay + totals.server);
  assert.ok(ratio > 0.95, `only ${(ratio * 100).toFixed(1)}% of signals avoided the server`);
});

scenario('the last two peers in a collapsing room fall back cleanly', () => {
  // Everyone leaves until no relay exists. This must degrade to the server, not wedge.
  const mesh = new SimMesh(['x', 'y', 'z'], { serverUp: true });
  mesh.linkAll();
  mesh.cut('x', 'y');

  // z departs entirely.
  mesh.cut('x', 'z');
  mesh.cut('y', 'z');

  const res = mesh.nodes.get('x').signaling.route('y', 'offer', { sdp: 'v=0' });
  assert.strictEqual(res.transport, 'server', 'did not fall back when the mesh emptied');
  assert.strictEqual(mesh.serverSignals, 1);
});


console.log('\n── Scenario F: cases designed to break the design, not confirm it ──');

scenario('a relay that cannot reach the target does not livelock the repair', () => {
  // The nasty one. 'a' must reach 'd'. Its neighbours are 'b' (which cannot reach 'd') and
  // 'c' (which can). Relay selection is deterministic, so if it always picks the same wrong
  // neighbour, every retry takes the identical dead path and the link NEVER repairs — the
  // roster is unchanged, so nothing makes the choice self-correct.
  const mesh = new SimMesh(['a', 'b', 'c', 'd'], { serverUp: false });
  mesh.link('a', 'b');
  mesh.link('a', 'c');
  mesh.link('c', 'd');
  // deliberately: no b-d link, no a-d link

  for (let attempt = 0; attempt < 5; attempt++) {
    mesh.nodes.get('a').signaling.route('d', 'offer', { sdp: `attempt-${attempt}` });
  }

  assert.ok(
    mesh.nodes.get('d').applied.length > 0,
    'repair never reached the target: relay selection retried the same dead path every time'
  );
});

scenario('a flood of unknown origins cannot evict an active negotiation', () => {
  // Replay protection is keyed per origin in a bounded map. If eviction is purely
  // insertion-ordered, an attacker can push a real peer's entry out and then replay that
  // peer's stale offers.
  const mesh = new SimMesh(['victim'], { serverUp: false });
  const v = mesh.nodes.get('victim').signaling;

  const legit = (seq) => ({
    targetPeerId: 'victim', originPeerId: 'real-peer', kind: 'offer', data: {}, seq, hops: 0,
  });

  assert.ok(v.handleInbound(legit(100), {}), 'legit offer rejected');

  for (let i = 0; i < 2000; i++) {
    v.handleInbound(
      { targetPeerId: 'victim', originPeerId: `flood-${i}`, kind: 'offer', data: {}, seq: 1, hops: 0 },
      {}
    );
  }

  assert.strictEqual(
    v.handleInbound(legit(50), {}),
    null,
    'stale offer accepted after a flood evicted the real peer\'s sequence state'
  );
});

scenario('a flood of unknown links cannot starve a real peer of liveness tracking', () => {
  // If the health map refuses new entries once full, a genuine peer that connects after a
  // flood is never tracked, never probed, and so never repaired when it dies.
  let connected = [];
  const dead = [];
  const monitor = new LinkMonitor(
    () => connected,
    () => true,
    (p) => dead.push(p),
    { sweepIntervalMs: 1000, silenceThresholdMs: 1, maxOutstandingProbes: 2 }
  );

  for (let i = 0; i < 400; i++) monitor.noteInbound(`flood-${i}`);

  connected = ['real-peer'];
  monitor.noteInbound('real-peer');

  const realNow = Date.now;
  try {
    Date.now = () => realNow.call(Date) + 60_000;
    for (let i = 0; i < 6; i++) monitor['sweep']();
  } finally {
    Date.now = realNow;
  }

  assert.deepStrictEqual(dead, ['real-peer'], 'a real dead link went undetected after a flood');
});

scenario('simultaneous repair from both ends does not double-count or wedge', () => {
  // Both endpoints notice the dead link in the same tick and both initiate. Nothing in the
  // repair path elects a single initiator, so this is the common case, not a rare race.
  const mesh = new SimMesh(['a', 'b', 'c'], { serverUp: false });
  mesh.linkAll();
  mesh.cut('a', 'b');

  const ra = mesh.nodes.get('a').signaling.route('b', 'offer', { sdp: 'from-a' });
  const rb = mesh.nodes.get('b').signaling.route('a', 'offer', { sdp: 'from-b' });

  assert.strictEqual(ra.transport, 'peer-relay');
  assert.strictEqual(rb.transport, 'peer-relay');
  assert.ok(mesh.nodes.get('b').applied.length > 0, 'a\'s offer lost to glare');
  assert.ok(mesh.nodes.get('a').applied.length > 0, 'b\'s offer lost to glare');
});

scenario('relay forwarding cannot be used to amplify traffic', () => {
  // A malicious peer sends one signal; the mesh must not turn it into many.
  const mesh = new SimMesh(['a', 'b', 'c', 'd', 'e', 'f'], { serverUp: false });
  mesh.linkAll();

  const before = mesh.delivered.length;
  mesh.nodes.get('a').signaling.handleInbound(
    { targetPeerId: 'f', originPeerId: 'attacker', kind: 'offer', data: {}, seq: 1, hops: 0 },
    {}
  );
  const amplification = mesh.delivered.length - before;

  assert.ok(amplification <= 3, `one signal produced ${amplification} sends`);
});


console.log('\n── Scenario G: ICE restart discipline ──');

scenario('a transient disconnect is given time to recover before repair', () => {
  // WebRTC's `disconnected` is transient by specification — consent checks are failing and
  // the connection may return to `connected` unaided, which a Wi-Fi roam or a burst of loss
  // produces routinely. Repairing immediately spends an offer and a full ICE gather on a
  // link that was recovering, and the restart disrupts the recovery itself.
  assert.ok(
    repairDelayFor('disconnected') > 0,
    'a transient disconnect triggers an immediate ICE restart'
  );
  assert.strictEqual(repairDelayFor('disconnected'), DISCONNECT_GRACE_MS);
});

scenario('a failed connection is repaired immediately, with no grace', () => {
  // `failed` is terminal: ICE has exhausted its candidate pairs and will not recover on its
  // own, so waiting only adds dead time to a link that is already gone.
  assert.strictEqual(
    repairDelayFor('failed'),
    0,
    'a terminal failure was made to wait out the transient grace period'
  );
});

scenario('the grace window sits between a network blip and the link monitor probe budget', () => {
  // Too short and it repairs blips; too long and a genuinely dead link waits behind it while
  // the monitor is already declaring it dead by its own route.
  const monitorBudget = 9000 + 3 * 4000; // silenceThreshold + probes * sweepInterval
  assert.ok(DISCONNECT_GRACE_MS >= 2000, 'grace too short to outlast a typical blip');
  assert.ok(
    DISCONNECT_GRACE_MS < monitorBudget,
    'grace outlasts the link monitor, so the two repair paths would race'
  );
});

console.log(`\n========================================`);
console.log(`🏁 Stress Summary: ${passed}/${total} scenarios passed (${Math.round((passed / total) * 100)}%)`);
console.log(`========================================\n`);

if (failures.length > 0) {
  console.error('Failures:');
  failures.forEach((f) => console.error(`  - ${f.name}: ${f.err.message}`));
  process.exit(1);
}
