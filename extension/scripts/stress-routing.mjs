// ─── Adversarial Link-State Routing Harness ───
//
// Written BEFORE the implementation, deliberately. The previous round's first-draft harness
// passed 18/18 and proved nothing; only the scenarios written expecting failure found the
// relay livelock, the replay hole, and the liveness starvation. Tests written after the code
// tend to reproduce the code's blind spots, so these exist to attack the design rather than
// confirm it.
//
// Every scenario below is a way a link-state protocol is known to fail in the wild:
// count-to-infinity, flooding storms, stale routes to departed nodes, lying advertisers,
// blackholes, and silent partitions.

import assert from 'assert';
import { LinkStateRouter } from '../src/core/topology/link-state.ts';
import { planMesh, planIsSymmetric, planFallbackTargets } from '../src/core/topology/mesh-plan.ts';
import { LinkAffinity, isInteractiveType } from '../src/core/topology/link-affinity.ts';
import { DEFAULT_TTL } from '../src/core/network/packet.ts';
import { extractFingerprint } from '../src/core/network/peer-identity-store.ts';
import { JoinTracker, JOIN_STAGES, STAGE_STALL_MS } from '../src/core/network/join-tracker.ts';

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
 * A simulated network of LinkStateRouters over a mutable undirected graph.
 *
 * Flooding is driven explicitly by settle() so convergence is observable rather than
 * assumed: a protocol that never converges shows up as a scenario that fails, not as a
 * test that hangs.
 */
class SimNet {
  constructor(peerIds, { now = () => SimNet.clock } = {}) {
    SimNet.clock = 1_000_000;
    this.peerIds = [...peerIds];
    this.edges = new Map(); // "a|b" -> costMs
    this.routers = new Map();
    this.floodCount = 0;
    this.syncPending = [];
    this.syncBytes = 0;

    for (const id of this.peerIds) {
      this.routers.set(id, new LinkStateRouter(id, { now }));
    }
  }

  static clock = 1_000_000;
  static advance(ms) {
    SimNet.clock += ms;
  }

  key(a, b) {
    return [a, b].sort().join('|');
  }

  link(a, b, costMs = 30) {
    const isNew = !this.edges.has(this.key(a, b));
    this.edges.set(this.key(a, b), costMs);
    // A new adjacency triggers a database push in both directions, mirroring what
    // TopologyService does when a data channel opens. Without this, healed partitions never
    // merge — each side only ever floods LSAs it generates itself.
    if (isNew && this.routers.has(a) && this.routers.has(b)) {
      this.syncPending.push([a, b]);
    }
  }

  /** Runs the database exchanges queued by new adjacencies. */
  drainSyncs() {
    const queued = this.syncPending.splice(0);
    const out = [];
    for (const [a, b] of queued) {
      if (!this.isLinked(a, b)) continue;
      const toB = this.routers.get(a).getDatabaseSnapshot();
      const toA = this.routers.get(b).getDatabaseSnapshot();
      this.syncBytes += toB.length + toA.length;
      for (const lsa of this.routers.get(b).handleDatabaseSnapshot(toB, a)) {
        out.push({ lsa, from: b });
      }
      for (const lsa of this.routers.get(a).handleDatabaseSnapshot(toA, b)) {
        out.push({ lsa, from: a });
      }
    }
    return out;
  }

  linkAll(costMs = 30) {
    for (let i = 0; i < this.peerIds.length; i++) {
      for (let j = i + 1; j < this.peerIds.length; j++) {
        this.link(this.peerIds[i], this.peerIds[j], costMs);
      }
    }
  }

  ring(costMs = 30) {
    const n = this.peerIds.length;
    for (let i = 0; i < n; i++) this.link(this.peerIds[i], this.peerIds[(i + 1) % n], costMs);
  }

  cut(a, b) {
    this.edges.delete(this.key(a, b));
  }

  neighbours(id) {
    const out = [];
    for (const [k, cost] of this.edges) {
      const [x, y] = k.split('|');
      if (x === id) out.push({ peerId: y, costMs: cost });
      else if (y === id) out.push({ peerId: x, costMs: cost });
    }
    return out;
  }

  isLinked(a, b) {
    return this.edges.has(this.key(a, b));
  }

  /** Each peer re-reads its own neighbours and emits an LSA if the router allows it. */
  emitAll() {
    const pending = [];
    for (const id of this.peerIds) {
      const lsa = this.routers.get(id).updateLocalNeighbours(this.neighbours(id));
      if (lsa) pending.push({ lsa, from: id });
    }
    return pending;
  }

  /**
   * Floods until quiescent. Returns the number of rounds taken — the convergence measure.
   */
  settle(maxRounds = 40) {
    let queue = [...this.drainSyncs(), ...this.emitAll()];
    let rounds = 0;

    while (queue.length > 0 && rounds < maxRounds) {
      rounds++;
      const next = [];
      for (const { lsa, from } of queue) {
        for (const { peerId: neighbour } of this.neighbours(from)) {
          if (!this.isLinked(from, neighbour)) continue;
          this.floodCount++;
          const res = this.routers.get(neighbour).handleLSA(lsa, from);
          if (res.reflood) next.push({ lsa, from: neighbour });
        }
      }
      queue = next;
    }
    return rounds;
  }

  /**
   * Simulates a TIER1 broadcast with reverse-path forwarding, mirroring
   * TopologyService.routeIncomingPacket. Returns delivery coverage and send count.
   */
  broadcast(originId, ttl = 3) {
    const received = new Set([originId]);
    let sends = 0;
    const seen = new Set(); // per-peer dedup, as the real dedup window provides

    const queue = [];
    const rootChildren = this.routers.get(originId).getBroadcastChildren(originId);
    for (const peerId of rootChildren ?? this.neighbours(originId).map((n) => n.peerId)) {
      sends++;
      queue.push({ at: peerId, from: originId, ttl });
    }

    while (queue.length) {
      const { at, from, ttl: t } = queue.shift();
      const dedupKey = `${at}`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        received.add(at);
      } else {
        continue; // duplicate: dropped at step 1 in the real path
      }

      const remaining = t - 1;
      if (remaining <= 0) continue;

      // RPF: forward only if this arrived from our next hop toward the origin.
      const upstream = this.routers.get(at).nextHop(originId);
      if (upstream && upstream !== from) continue;

      const children = this.routers.get(at).getBroadcastChildren(originId);
      const targets = children ?? this.neighbours(at).map((n) => n.peerId);
      for (const n of targets) {
        if (n === from || n === originId) continue;
        sends++;
        queue.push({ at: n, from: at, ttl: remaining });
      }
    }

    return { covered: received.size, sends };
  }

  /** Injects a raw LSA at one peer without it passing through a real neighbour. */
  inject(atPeerId, lsa, fromPeerId) {
    return this.routers.get(atPeerId).handleLSA(lsa, fromPeerId);
  }

  /** Follows next-hop pointers from src to dst, detecting loops. */
  trace(src, dst, maxHops = 30) {
    const path = [src];
    const seen = new Set([src]);
    let cur = src;

    for (let i = 0; i < maxHops; i++) {
      if (cur === dst) return { path, looped: false, reached: true };
      const hop = this.routers.get(cur).nextHop(dst);
      if (!hop) return { path, looped: false, reached: false };
      if (seen.has(hop)) return { path: [...path, hop], looped: true, reached: false };
      if (!this.isLinked(cur, hop)) {
        return { path: [...path, hop], looped: false, reached: false, brokenAt: cur };
      }
      seen.add(hop);
      path.push(hop);
      cur = hop;
    }
    return { path, looped: true, reached: false };
  }
}

console.log('\n🔥 Adversarial Link-State Routing\n');

console.log('── Correctness: does it route at all ──');

scenario('every peer can reach every other over a ring', () => {
  const net = new SimNet(['a', 'b', 'c', 'd', 'e', 'f']);
  net.ring();
  net.settle();

  for (const src of net.peerIds) {
    for (const dst of net.peerIds) {
      if (src === dst) continue;
      const t = net.trace(src, dst);
      assert.ok(t.reached, `${src} -> ${dst} unreachable (path ${t.path.join('->')})`);
      assert.ok(!t.looped, `${src} -> ${dst} looped`);
    }
  }
});

scenario('shortest path is chosen when a chord exists', () => {
  // Ring of 6 plus a chord a-d. a->d should be 1 hop, not 3 around the ring.
  const net = new SimNet(['a', 'b', 'c', 'd', 'e', 'f']);
  net.ring();
  net.link('a', 'd', 10);
  net.settle();

  const t = net.trace('a', 'd');
  assert.deepStrictEqual(t.path, ['a', 'd'], `took ${t.path.join('->')} instead of the chord`);
});

scenario('cost metric is honoured, not just hop count', () => {
  //   a -- b -- c   (fast, 2 hops, total 20)
  //   a --------- c (slow, 1 hop, 500)
  // A latency-aware router must prefer the 2-hop path.
  const net = new SimNet(['a', 'b', 'c']);
  net.link('a', 'b', 10);
  net.link('b', 'c', 10);
  net.link('a', 'c', 500);
  net.settle();

  assert.strictEqual(net.routers.get('a').nextHop('c'), 'b', 'ignored the cost metric');
});

console.log('\n── Convergence and churn ──');

scenario('converges after a link is cut, with no stale next-hop', () => {
  const net = new SimNet(['a', 'b', 'c', 'd']);
  net.ring();
  net.link('a', 'c');
  net.settle();

  net.cut('a', 'c');
  SimNet.advance(2000);
  net.settle();

  const t = net.trace('a', 'c');
  assert.ok(t.reached, 'no route after the cut');
  assert.ok(!t.brokenAt, `next-hop pointed down a dead link at ${t.brokenAt}`);
});

scenario('a departed peer stops being routable instead of lingering forever', () => {
  const net = new SimNet(['a', 'b', 'c']);
  net.ring();
  net.settle();

  // 'c' vanishes: all its links go, and it stops advertising.
  net.cut('b', 'c');
  net.cut('a', 'c');
  SimNet.advance(2000);
  net.settle();

  // Age out beyond the LSA lifetime.
  SimNet.advance(120_000);
  for (const id of ['a', 'b']) net.routers.get(id).ageOut();

  assert.strictEqual(net.routers.get('a').nextHop('c'), null, 'still routing to a departed peer');
  assert.ok(!net.routers.get('a').getReachable().includes('c'));
});

scenario('no routing loops across randomized topology mutation', () => {
  const peers = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const net = new SimNet(peers);
  net.ring();
  net.settle();

  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let round = 0; round < 400; round++) {
    const a = peers[Math.floor(rand() * peers.length)];
    const b = peers[Math.floor(rand() * peers.length)];
    if (a !== b) {
      if (rand() < 0.5) net.cut(a, b);
      else net.link(a, b, 10 + Math.floor(rand() * 90));
    }
    SimNet.advance(2000);
    net.settle();

    for (const src of peers) {
      for (const dst of peers) {
        if (src === dst) continue;
        const t = net.trace(src, dst);
        assert.ok(!t.looped, `loop ${src}->${dst} at round ${round}: ${t.path.join('->')}`);
      }
    }
  }
});

scenario('flooding does not amplify without bound during a mass flap', () => {
  const peers = Array.from({ length: 12 }, (_, i) => `n${i}`);
  const net = new SimNet(peers);
  net.linkAll();
  net.settle();

  const before = net.floodCount;
  // Every peer flaps at once — the storm case.
  for (let i = 0; i < 12; i++) net.cut(peers[i], peers[(i + 1) % 12]);
  SimNet.advance(2000);
  net.settle();
  const storm = net.floodCount - before;

  // Each LSA should traverse each edge at most a small constant number of times. With 12
  // peers and ~60 remaining edges, anything in the thousands means re-flooding is not
  // being suppressed by sequence dedup.
  assert.ok(storm < 4000, `flood storm produced ${storm} transmissions`);
});

scenario('own LSA emission is rate limited under rapid flapping', () => {
  const net = new SimNet(['a', 'b', 'c']);
  net.ring();
  net.settle();

  let emitted = 0;
  for (let i = 0; i < 50; i++) {
    // Flap without advancing the clock at all.
    net.cut('a', 'b');
    if (net.routers.get('a').updateLocalNeighbours(net.neighbours('a'))) emitted++;
    net.link('a', 'b');
    if (net.routers.get('a').updateLocalNeighbours(net.neighbours('a'))) emitted++;
  }

  assert.ok(emitted <= 2, `emitted ${emitted} LSAs in one instant; rate limit not applied`);
});

console.log('\n── Hostile advertisers ──');

scenario('a peer cannot attract traffic by claiming links it does not have', () => {
  // The classic link-state blackhole: 'liar' advertises adjacency to everyone, so every
  // shortest path runs through it, and it drops what it receives.
  const net = new SimNet(['a', 'b', 'c', 'liar']);
  net.link('a', 'b', 50);
  net.link('b', 'c', 50);
  net.settle();

  const forged = {
    origin: 'liar',
    seq: 999,
    neighbours: [
      { peerId: 'a', costMs: 1 },
      { peerId: 'b', costMs: 1 },
      { peerId: 'c', costMs: 1 },
    ],
    issuedAt: SimNet.clock,
    ttl: 8,
  };
  net.inject('a', forged, 'b');

  // 'a' has not advertised a link to 'liar', so the claim is unverified in both directions
  // and must not enter the graph.
  assert.strictEqual(
    net.routers.get('a').nextHop('c'),
    'b',
    'traffic was diverted through a peer that forged its adjacency'
  );
  assert.strictEqual(net.routers.get('a').nextHop('liar'), null, 'routed to an unverified peer');
});

scenario('an oversized neighbour list is rejected', () => {
  const net = new SimNet(['a', 'b']);
  net.link('a', 'b');
  net.settle();

  const bloated = {
    origin: 'attacker',
    seq: 1,
    neighbours: Array.from({ length: 5000 }, (_, i) => ({ peerId: `fake-${i}`, costMs: 1 })),
    issuedAt: SimNet.clock,
    ttl: 8,
  };
  const res = net.inject('a', bloated, 'b');

  assert.strictEqual(res.accepted, false, 'accepted an implausible neighbour list');
});

scenario('LSDB is bounded against a forged-origin flood', () => {
  const net = new SimNet(['a', 'b']);
  net.link('a', 'b');
  net.settle();

  for (let i = 0; i < 10_000; i++) {
    net.inject(
      'a',
      {
        origin: `ghost-${i}`,
        seq: 1,
        neighbours: [{ peerId: 'b', costMs: 1 }],
        issuedAt: SimNet.clock,
        ttl: 8,
      },
      'b'
    );
  }

  const size = net.routers.get('a').getStats().lsdbSize;
  assert.ok(size <= 400, `LSDB grew to ${size} under a forged-origin flood`);
});

scenario('a flood cannot evict the LSA of an active peer', () => {
  // Same trap as the peer-signaling replay hole: bounding a network-reachable map with a
  // naive eviction policy lets an attacker displace real state.
  const net = new SimNet(['a', 'b', 'c']);
  net.ring();
  net.settle();

  const realRoute = net.routers.get('a').nextHop('c');
  assert.ok(realRoute, 'precondition: a route to c exists');

  for (let i = 0; i < 10_000; i++) {
    net.inject(
      'a',
      {
        origin: `ghost-${i}`,
        seq: 1,
        neighbours: [{ peerId: 'b', costMs: 1 }],
        issuedAt: SimNet.clock,
        ttl: 8,
      },
      'b'
    );
  }

  assert.strictEqual(
    net.routers.get('a').nextHop('c'),
    realRoute,
    'a flood of forged origins evicted a live peer and destroyed a working route'
  );
});

scenario('replayed old LSAs cannot roll the topology backwards', () => {
  const net = new SimNet(['a', 'b', 'c']);
  net.ring();
  net.settle();

  const stale = net.routers.get('a').getLSA('b');
  assert.ok(stale, 'precondition: a has b\'s LSA');

  net.cut('b', 'c');
  SimNet.advance(2000);
  net.settle();

  // Replay b's pre-cut advertisement.
  const res = net.inject('a', stale, 'b');
  assert.strictEqual(res.accepted, false, 'accepted a replayed LSA with a stale sequence');
});

scenario('malformed LSAs are rejected without throwing', () => {
  const net = new SimNet(['a', 'b']);
  net.link('a', 'b');
  net.settle();

  const bad = [
    null,
    undefined,
    {},
    { origin: 'x' },
    { origin: 'x', seq: 'not-a-number', neighbours: [] },
    { origin: 'x', seq: 1, neighbours: 'nope' },
    { origin: 'x', seq: 1, neighbours: [{ peerId: null, costMs: 1 }] },
    { origin: 'x', seq: -5, neighbours: [] },
    { origin: 'x', seq: 1, neighbours: [{ peerId: 'y', costMs: -100 }] },
  ];

  for (const lsa of bad) {
    const res = net.inject('a', lsa, 'b');
    assert.strictEqual(res.accepted, false, `accepted malformed LSA ${JSON.stringify(lsa)}`);
  }
});

console.log('\n── Partition and heal ──');

scenario('a partition is detected rather than silently routed into a black hole', () => {
  const net = new SimNet(['a', 'b', 'c', 'd']);
  net.link('a', 'b');
  net.link('c', 'd');
  net.settle();

  assert.strictEqual(net.routers.get('a').nextHop('c'), null, 'claimed a route across a partition');
  const reachable = net.routers.get('a').getReachable();
  assert.ok(reachable.includes('b'));
  assert.ok(!reachable.includes('c'), 'unreachable peer reported as reachable');
});

scenario('both halves converge and merge after a partition heals', () => {
  const net = new SimNet(['a', 'b', 'c', 'd']);
  net.link('a', 'b');
  net.link('c', 'd');
  net.settle();

  net.link('b', 'c'); // heal
  SimNet.advance(2000);
  net.settle();

  for (const src of net.peerIds) {
    for (const dst of net.peerIds) {
      if (src === dst) continue;
      const t = net.trace(src, dst);
      assert.ok(t.reached, `${src} -> ${dst} unreachable after heal`);
      assert.ok(!t.looped, `${src} -> ${dst} looped after heal`);
    }
  }
});

console.log('\n── Scale ──');

scenario('30-peer sparse mesh: all pairs reachable within 4 hops', () => {
  const peers = Array.from({ length: 30 }, (_, i) => `s${String(i).padStart(2, '0')}`);
  const net = new SimNet(peers);
  net.ring(); // connectivity guarantee
  // Chords to cut the diameter — deterministic, so every peer computes the same graph.
  for (let i = 0; i < 30; i++) {
    net.link(peers[i], peers[(i + 7) % 30]);
    net.link(peers[i], peers[(i + 13) % 30]);
  }
  net.settle();

  let worst = 0;
  for (const src of peers) {
    for (const dst of peers) {
      if (src === dst) continue;
      const t = net.trace(src, dst);
      assert.ok(t.reached, `${src} -> ${dst} unreachable`);
      worst = Math.max(worst, t.path.length - 1);
    }
  }
  assert.ok(worst <= 4, `worst-case hop count was ${worst}, above the 4-hop budget`);
});


console.log('\n── Restart and identity reuse ──');

scenario('a peer that reloads is not invisible until its old LSA expires', () => {
  // The dominant real-world event for a browser extension: the user refreshes the page.
  // The peer keeps its identity but its sequence counter restarts, so every peer holding a
  // higher sequence rejects its advertisements as replays. Without recovery the returning
  // peer is absent from the routing graph until age-out — up to 45 seconds during which
  // nobody can route to it.
  const net = new SimNet(['a', 'b', 'c']);
  net.ring();
  net.settle();

  // 'b' advertises several times so its sequence climbs.
  for (let i = 0; i < 5; i++) {
    SimNet.advance(2000);
    net.link('b', 'c', 20 + i * 10); // cost changes force new LSAs
    net.settle();
  }
  const seqBefore = net.routers.get('a').getLSA('b').seq;
  assert.ok(seqBefore > 1, 'precondition: b has advertised more than once');

  // 'b' reloads: brand new router object, same peer ID, sequence back to zero.
  net.routers.set('b', new LinkStateRouter('b', { now: () => SimNet.clock }));
  SimNet.advance(2000);

  // Reconnecting triggers the adjacency database push, which is how the returning peer
  // learns that the room holds a newer sequence for its own identity.
  net.syncPending.push(['a', 'b'], ['b', 'c']);
  net.settle();
  SimNet.advance(2000);
  net.settle();

  const t = net.trace('a', 'b');
  assert.ok(t.reached, 'a cannot route to the reloaded peer');
  assert.ok(
    net.routers.get('a').getLSA('b').seq > seqBefore,
    'reloaded peer never superseded its stale advertisement'
  );
});

scenario('a database push cannot be used to flood one peer in a single message', () => {
  const net = new SimNet(['a', 'b']);
  net.link('a', 'b');
  net.settle();

  const huge = Array.from({ length: 50_000 }, (_, i) => ({
    origin: `bulk-${i}`,
    seq: 1,
    neighbours: [{ peerId: 'b', costMs: 1 }],
    issuedAt: SimNet.clock,
    ttl: 8,
  }));
  net.routers.get('a').handleDatabaseSnapshot(huge, 'b');

  assert.ok(
    net.routers.get('a').getStats().lsdbSize <= 400,
    'a single oversized database push bypassed the LSDB bound'
  );
});


console.log('\n── Sparse mesh planning ──');

scenario('plan is symmetric for every roster size', () => {
  // Asymmetry is not cosmetic: one peer dials while the other tears down, producing a
  // connect/disconnect loop indistinguishable from a flaky network.
  for (let n = 2; n <= 60; n++) {
    const peers = Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`);
    assert.ok(planIsSymmetric(peers), `asymmetric plan at n=${n}`);
  }
});

scenario('plan is symmetric for unsorted and irregular peer IDs', () => {
  // Real peer IDs are UUIDs, not p000..p0NN. Sorting must be the only thing that matters.
  const peers = [
    'zeta-9', 'alpha-1', 'Mike-3', '0001', 'omega', 'b', 'A', 'zz', 'm-42', 'q7',
    'peer-with-a-very-long-identifier-0000000001', '~tilde', '99bottles',
  ];
  assert.ok(planIsSymmetric(peers), 'asymmetric plan with irregular IDs');
});

scenario('the graph is connected at every size, never merely probably', () => {
  for (let n = 2; n <= 60; n++) {
    const peers = Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`);
    const adj = new Map(peers.map((p) => [p, planMesh(p, peers).desired]));

    const seen = new Set([peers[0]]);
    const queue = [peers[0]];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of adj.get(cur)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    assert.strictEqual(seen.size, n, `graph partitioned at n=${n}: reached ${seen.size}/${n}`);
  }
});

scenario('degree stays bounded as the room grows', () => {
  for (const n of [12, 20, 30, 50, 80]) {
    const peers = Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`);
    let worst = 0;
    for (const p of peers) worst = Math.max(worst, planMesh(p, peers).desired.size);
    assert.ok(worst <= 8, `degree grew to ${worst} at n=${n}`);
  }
});

scenario('small rooms stay a full mesh', () => {
  // Sparsity below the threshold would add hops to cursor traffic while saving nothing.
  const peers = Array.from({ length: 6 }, (_, i) => `p${i}`);
  const plan = planMesh('p0', peers);
  assert.ok(plan.isFullMesh);
  assert.strictEqual(plan.desired.size, 5);
});

scenario('diameter stays inside the hop budget across room sizes', () => {
  // Measured behaviour of the geometric chord ladder at degree 6. Diameter grows
  // logarithmically while degree stays flat, which is the whole point: a 50-peer room costs
  // each peer 6 connections instead of 49.
  const budget = { 10: 2, 20: 3, 30: 4, 50: 4, 80: 5, 100: 5 };

  for (const [sizeStr, maxHops] of Object.entries(budget)) {
    const n = Number(sizeStr);
    const peers = Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`);
    const adj = new Map(peers.map((p) => [p, planMesh(p, peers).desired]));

    let diameter = 0;
    for (const src of peers) {
      const dist = new Map([[src, 0]]);
      const queue = [src];
      while (queue.length) {
        const cur = queue.shift();
        for (const next of adj.get(cur)) {
          if (!dist.has(next)) {
            dist.set(next, dist.get(cur) + 1);
            queue.push(next);
          }
        }
      }
      assert.strictEqual(dist.size, n, `${src} cannot reach the whole room at n=${n}`);
      for (const d of dist.values()) diameter = Math.max(diameter, d);
    }
    assert.ok(diameter <= maxHops, `n=${n}: diameter ${diameter} exceeds the ${maxHops}-hop budget`);
  }
});

scenario('a peer missing from the roster gets an empty plan rather than a wrong one', () => {
  const peers = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const plan = planMesh('stranger', peers);
  assert.strictEqual(plan.desired.size, 0, 'planned links from a position it does not hold');
});

scenario('planned mesh actually routes end to end', () => {
  // The plan and the router must agree: build the planned graph, run link-state over it,
  // and confirm every pair resolves. A plan that routing cannot use is worthless.
  const peers = Array.from({ length: 20 }, (_, i) => `q${String(i).padStart(2, '0')}`);
  const net = new SimNet(peers);
  for (const p of peers) {
    for (const other of planMesh(p, peers).desired) net.link(p, other, 30);
  }
  net.settle();

  for (const src of peers) {
    for (const dst of peers) {
      if (src === dst) continue;
      const t = net.trace(src, dst);
      assert.ok(t.reached, `${src} -> ${dst} unreachable over the planned mesh`);
      assert.ok(!t.looped, `${src} -> ${dst} looped`);
    }
  }
});


console.log('\n── Link affinity: protecting co-editing from sparsity ──');

scenario('a co-editing pair keeps a direct link the plan would shed', () => {
  let t = 0;
  const aff = new LinkAffinity({ now: () => t });

  // Sparsity is the right trade for the room and the wrong trade for this pair: routed 3-4
  // hops their keystrokes go from ~40ms to ~150ms, past where co-editing feels live.
  for (let i = 0; i < 60; i++) {
    t += 50;
    aff.note('partner', 'code:delta');
  }
  assert.ok(aff.shouldKeep('partner'), 'tore down the link between two people co-editing');
});

scenario('an idle peer does not hold a link open', () => {
  let t = 0;
  const aff = new LinkAffinity({ now: () => t });
  for (let i = 0; i < 3; i++) {
    t += 50;
    aff.note('acquaintance', 'code:cursor');
  }
  assert.ok(!aff.shouldKeep('acquaintance'), 'held a link for negligible traffic');
});

scenario('chat traffic alone never promotes a link', () => {
  // Chat tolerates a hop; nobody perceives 100ms in a message they are reading. Promoting on
  // chat would rebuild the full mesh in any busy room.
  let t = 0;
  const aff = new LinkAffinity({ now: () => t });
  for (let i = 0; i < 500; i++) {
    t += 10;
    aff.note('chatty', 'chat:message');
  }
  assert.ok(!aff.shouldKeep('chatty'), 'chat volume promoted a link');
  assert.ok(!isInteractiveType('chat:message'));
  assert.ok(isInteractiveType('code:delta'));
});

scenario('a promoted link is not dropped by a brief pause in typing', () => {
  // Without a minimum hold, pausing to think drops the link and the next keystroke pays a
  // full reconnection. The oscillation is worse than either steady state.
  let t = 0;
  const aff = new LinkAffinity({ now: () => t });
  for (let i = 0; i < 60; i++) {
    t += 50;
    aff.note('partner', 'code:delta');
  }
  assert.ok(aff.shouldKeep('partner'));

  t += 8000; // eight seconds of thinking
  assert.ok(aff.shouldKeep('partner'), 'a pause in typing tore down an active collaboration');
});

scenario('affinity releases the link once collaboration really stops', () => {
  let t = 0;
  const aff = new LinkAffinity({ now: () => t });
  for (let i = 0; i < 60; i++) {
    t += 50;
    aff.note('partner', 'code:delta');
  }
  assert.ok(aff.shouldKeep('partner'));

  t += 10 * 60 * 1000; // ten minutes later
  assert.ok(!aff.shouldKeep('partner'), 'held a link long after collaboration ended');
});

scenario('affinity cannot rebuild a full mesh in a busy room', () => {
  // Every pair interacting must not defeat sparsity — that would restore the N-1 cost the
  // plan exists to remove.
  let t = 0;
  const aff = new LinkAffinity({ now: () => t });
  const peers = Array.from({ length: 30 }, (_, i) => `p${i}`);

  for (let round = 0; round < 60; round++) {
    for (const p of peers) {
      t += 1;
      aff.note(p, 'canvas:cursor');
    }
  }

  const kept = peers.filter((p) => aff.shouldKeep(p));
  assert.ok(kept.length <= 4, `promoted ${kept.length} links, defeating the degree target`);
});

scenario('affinity state is bounded against a flood', () => {
  let t = 0;
  const aff = new LinkAffinity({ now: () => t });
  for (let i = 0; i < 10_000; i++) {
    t += 1;
    aff.note(`flood-${i}`, 'code:cursor');
  }
  assert.ok(aff.getStats().tracked <= 200, `affinity map grew to ${aff.getStats().tracked}`);
});

scenario('a promoted link survives the flood that follows it', () => {
  // The eviction trap again: a promoted link losing its state would be silently demoted, and
  // the pair would drop to multi-hop mid-collaboration.
  let t = 0;
  const aff = new LinkAffinity({ now: () => t });
  for (let i = 0; i < 60; i++) {
    t += 50;
    aff.note('partner', 'code:delta');
  }
  assert.ok(aff.shouldKeep('partner'), 'precondition: promoted');

  for (let i = 0; i < 5000; i++) {
    t += 1;
    aff.note(`flood-${i}`, 'code:cursor');
  }
  assert.ok(aff.shouldKeep('partner'), 'a flood evicted an actively promoted link');
});


console.log('\n── Broadcast over a sparse mesh ──');

scenario('DEFAULT_TTL is large enough for the planned mesh diameter', () => {
  // A TTL below the diameter silently truncates every broadcast: peers beyond the hop
  // budget never receive it, and nothing reports an error.
  const peers = Array.from({ length: 30 }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const net = new SimNet(peers);
  for (const p of peers) for (const o of planMesh(p, peers).desired) net.link(p, o, 30);
  net.settle();

  const withDefaultTtl = net.broadcast(peers[0], DEFAULT_TTL);
  assert.strictEqual(
    withDefaultTtl.covered,
    30,
    `DEFAULT_TTL=${DEFAULT_TTL} reached only ${withDefaultTtl.covered}/30 peers`
  );
});

scenario('every peer receives a broadcast over a 30-peer sparse mesh', () => {
  const peers = Array.from({ length: 30 }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const net = new SimNet(peers);
  for (const p of peers) for (const o of planMesh(p, peers).desired) net.link(p, o, 30);
  net.settle();

  for (const origin of peers) {
    const { covered } = net.broadcast(origin, 12);
    assert.strictEqual(covered, 30, `broadcast from ${origin} reached only ${covered}/30`);
  }
});

scenario('RPF keeps broadcast cost near tree size, not mesh size', () => {
  const peers = Array.from({ length: 30 }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const net = new SimNet(peers);
  for (const p of peers) for (const o of planMesh(p, peers).desired) net.link(p, o, 30);
  net.settle();

  const { sends, covered } = net.broadcast(peers[0], 12);
  assert.strictEqual(covered, 30);

  // A full mesh would be 29 sends from the origin alone. Plain flooding over this graph
  // would be about 2*|E| = ~180. RPF should land far below flooding.
  assert.ok(sends < 90, `RPF used ${sends} sends, no better than flooding`);
});


console.log('\n── Persistent identity ──');

scenario('DTLS fingerprint is extracted from real-shaped SDP', () => {
  const sdp = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=ice-ufrag:F7gI',
    'a=ice-pwd:x9cml/YzichV2+XlhiMu8g',
    'a=fingerprint:sha-256 D1:2C:BE:AD:C4:F6:64:2F:22:8B:71:C1:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
    'a=setup:actpass',
  ].join('\r\n');

  assert.strictEqual(
    extractFingerprint(sdp),
    'D1:2C:BE:AD:C4:F6:64:2F:22:8B:71:C1:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89'
  );
});

scenario('fingerprint extraction is safe on malformed or absent SDP', () => {
  // Identity pinning must never throw on input from the network.
  for (const bad of [undefined, '', 'v=0', 'a=fingerprint:', 'a=fingerprint']) {
    assert.doesNotThrow(() => extractFingerprint(bad));
  }
  assert.strictEqual(extractFingerprint(undefined), undefined);
  assert.strictEqual(extractFingerprint('v=0\r\na=setup:actpass'), undefined);
});


console.log('\n── Connectivity fallback: sparsity must not strand peers ──');

scenario('an isolated peer escalates to trying everyone', () => {
  // The regression case. Under a full mesh this peer had N-1 chances to find someone it
  // could reach; the plan gives it 6, and connection failure is peer-correlated (two hosts
  // behind symmetric NAT cannot connect at all), so those 6 are not independent draws.
  const peers = Array.from({ length: 24 }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const targets = planFallbackTargets('p000', peers, { connected: [], reachable: [] });

  assert.strictEqual(targets.length, 23, 'an isolated peer was not given every option');
  assert.ok(!targets.includes('p000'), 'proposed connecting to itself');
});

scenario('a healthy peer proposes no extra links', () => {
  // The fallback must be inert when the plan is working, or it silently rebuilds the full
  // mesh and undoes the entire point of sparsity.
  const peers = Array.from({ length: 24 }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const plan = planMesh('p000', peers);
  const targets = planFallbackTargets('p000', peers, {
    connected: [...plan.desired],
    reachable: peers.filter((p) => p !== 'p000'),
  });

  assert.deepStrictEqual(targets, [], 'widened a mesh that was already delivering');
});

scenario('a partitioned peer reaches only toward the unreachable side', () => {
  const peers = Array.from({ length: 24 }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const plan = planMesh('p000', peers);
  // Half the room is unreachable through the mesh.
  const reachable = peers.slice(0, 12).filter((p) => p !== 'p000');
  const targets = planFallbackTargets('p000', peers, {
    connected: [...plan.desired].filter((p) => reachable.includes(p)),
    reachable,
  });

  assert.ok(targets.length > 0, 'a partitioned peer proposed no repair');
  for (const t of targets) {
    assert.ok(!reachable.includes(t), `proposed ${t}, which was already reachable`);
    assert.ok(!plan.desired.has(t), `proposed ${t}, which the plan already covers`);
  }
});

scenario('fallback is bounded so a split room cannot rebuild the full mesh', () => {
  // A room splitting down the middle is the worst moment to trigger an O(N^2) dial storm.
  const peers = Array.from({ length: 40 }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const plan = planMesh('p000', peers);
  const reachable = peers.slice(0, 5).filter((p) => p !== 'p000');
  const targets = planFallbackTargets('p000', peers, {
    connected: [...plan.desired].filter((p) => reachable.includes(p)),
    reachable,
  });

  assert.ok(targets.length <= 4, `fallback proposed ${targets.length} links, defeating the bound`);
});

scenario('escalation actually rescues a peer whose whole plan is unreachable', () => {
  // End to end: a peer behind symmetric NAT whose six planned neighbours are all also
  // behind symmetric NAT. Under the plan alone it is stranded; the fallback must surface at
  // least one peer it can actually reach.
  const peers = Array.from({ length: 24 }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const me = 'p000';
  const plan = planMesh(me, peers);

  // Everyone in my plan is unreachable; a few others are fine.
  const canReach = new Set(peers.filter((p) => p !== me && !plan.desired.has(p)));
  const targets = planFallbackTargets(me, peers, { connected: [], reachable: [] });
  const usable = targets.filter((t) => canReach.has(t));

  assert.ok(usable.length > 0, 'fallback surfaced no peer the stranded node could reach');
});


console.log('\n── Derived-state caching ──');

scenario('the broadcast tree is cached but never served stale', () => {
  // getBroadcastChildren is on the per-packet forwarding path, so it is cached — 62us
  // uncached against 0.13us cached. A stale tree would be far worse than a slow one:
  // packets would be forwarded to the wrong children and peers would silently stop
  // receiving broadcasts, which is indistinguishable from the app being broken.
  let clock = 1_000_000;
  const a = new LinkStateRouter('a', { now: () => clock });
  const mk = (origin, seq, nbs) => ({ origin, seq, neighbours: nbs, issuedAt: clock, ttl: 8 });

  a.updateLocalNeighbours([{ peerId: 'b', costMs: 10 }]);
  a.handleLSA(mk('b', 1, [{ peerId: 'a', costMs: 10 }, { peerId: 'c', costMs: 10 }]), 'b');
  a.handleLSA(mk('c', 1, [{ peerId: 'b', costMs: 10 }]), 'b');

  a.getBroadcastChildren('c');
  assert.ok(a['broadcastTreeCache'].size > 0, 'tree was not cached at all');

  clock += 5000;
  a.handleLSA(mk('c', 2, [{ peerId: 'b', costMs: 10 }, { peerId: 'a', costMs: 10 }]), 'c');
  assert.strictEqual(
    a['broadcastTreeCache'].size,
    0,
    'a topology change left a cached broadcast tree in place'
  );
});

scenario('the adjacency cache is dropped when an LSA ages out', () => {
  // Age-out mutates the LSDB without going through handleLSA, so it is a separate path that
  // must invalidate too — otherwise routes keep pointing at a departed peer.
  let clock = 1_000_000;
  const a = new LinkStateRouter('a', { now: () => clock, maxLsaAgeMs: 10_000 });
  const mk = (origin, seq, nbs) => ({ origin, seq, neighbours: nbs, issuedAt: clock, ttl: 8 });

  a.updateLocalNeighbours([{ peerId: 'b', costMs: 10 }]);
  a.handleLSA(mk('b', 1, [{ peerId: 'a', costMs: 10 }]), 'b');
  assert.strictEqual(a.nextHop('b'), 'b', 'precondition: b is routable');

  clock += 60_000;
  a.ageOut();
  assert.strictEqual(a.nextHop('b'), null, 'stale route survived age-out — cache not invalidated');
});


console.log('\n── Wire limits: database sync must fit the transport ──');

scenario('a database push never exceeds the chunker threshold', () => {
  // syncDatabaseWith sends directly over the DataChannel, deliberately bypassing the
  // PacketPipeline so that repair works even when the pipeline is unhealthy. The cost of
  // that choice is that nothing chunks it — so the snapshot must bound its own size.
  //
  // This matters more than a generic size limit: the database push is what merges healed
  // partitions. If it silently fails to send, two halves of a room never reconverge, which
  // is precisely the bug the push was added to fix.
  let clock = 1_000_000;
  const CHUNK_RAW_SIZE = 7168;

  for (const [n, degree] of [[24, 6], [50, 6], [300, 6], [300, 64]]) {
    const peers = Array.from({ length: n }, (_, i) => `peer-${'x'.repeat(20)}-${String(i).padStart(3, '0')}`);
    const r = new LinkStateRouter(peers[0], { now: () => clock });

    for (let i = 0; i < n; i++) {
      const nbs = Array.from({ length: degree }, (_, j) => ({
        peerId: peers[(i + j + 1) % n],
        costMs: 30,
      }));
      if (i === 0) r.updateLocalNeighbours(nbs);
      else r.handleLSA({ origin: peers[i], seq: 1, neighbours: nbs, issuedAt: clock, ttl: 8 }, peers[1]);
    }

    const batches = r.getDatabaseSnapshotBatches();
    assert.ok(batches.length > 0, `n=${n} deg=${degree}: produced no batches`);

    for (const batch of batches) {
      const bytes = JSON.stringify({ lsas: batch }).length;
      assert.ok(
        bytes <= CHUNK_RAW_SIZE,
        `n=${n} deg=${degree}: a batch was ${bytes}B, over the ${CHUNK_RAW_SIZE}B limit`
      );
    }

    // And nothing may be silently dropped in the process.
    const total = batches.reduce((sum, b) => sum + b.length, 0);
    assert.strictEqual(total, r.getDatabaseSnapshot().length, `n=${n}: batching lost LSAs`);
  }
});

scenario('a single oversized LSA still ships rather than being silently dropped', () => {
  // An LSA at the neighbour cap could in principle exceed a batch on its own. Losing it
  // would leave a permanent hole in every other peer's map.
  let clock = 1_000_000;
  const r = new LinkStateRouter('me', { now: () => clock });
  const huge = Array.from({ length: 64 }, (_, i) => ({
    peerId: `enormous-peer-identifier-${'y'.repeat(60)}-${i}`,
    costMs: 30,
  }));
  r.updateLocalNeighbours(huge);

  const batches = r.getDatabaseSnapshotBatches();
  const total = batches.reduce((sum, b) => sum + b.length, 0);
  assert.strictEqual(total, 1, 'an oversized LSA was dropped instead of sent alone');
});

scenario('batches reassemble into the same database on the receiver', () => {
  let clock = 1_000_000;
  const n = 40;
  const peers = Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const sender = new LinkStateRouter(peers[0], { now: () => clock });
  for (let i = 0; i < n; i++) {
    const nbs = [{ peerId: peers[(i + 1) % n], costMs: 30 }, { peerId: peers[(i + 2) % n], costMs: 30 }];
    if (i === 0) sender.updateLocalNeighbours(nbs);
    else sender.handleLSA({ origin: peers[i], seq: 1, neighbours: nbs, issuedAt: clock, ttl: 8 }, peers[1]);
  }

  const receiver = new LinkStateRouter('fresh', { now: () => clock });
  for (const batch of sender.getDatabaseSnapshotBatches()) {
    receiver.handleDatabaseSnapshot(batch, peers[0]);
  }

  assert.strictEqual(
    receiver.getStats().lsdbSize,
    sender.getStats().lsdbSize,
    'receiver database did not match after batched transfer'
  );
});


console.log('\n── Join admission ladder ──');

scenario('a completed join reaches ACTIVE through every stage in order', () => {
  let t = 0;
  const jt = new JoinTracker(() => t);
  jt.begin('room-1', 'peer-1');

  for (const stage of JOIN_STAGES.slice(1)) {
    t += 50;
    jt.advance(stage);
  }

  const snap = jt.getSnapshot();
  assert.strictEqual(snap.stage, 'ACTIVE');
  assert.strictEqual(snap.stalled, false, 'a completed join must never report stalled');
  assert.strictEqual(snap.events.length, JOIN_STAGES.length);
});

scenario('a join that stops at REGISTERED is identified as exactly that', () => {
  // The reported symptom: the server has the peer, the client is not a participant. The
  // tracker must name the stage rather than saying "join failed".
  let t = 0;
  const jt = new JoinTracker(() => t);
  jt.begin('room-1', 'ghost');
  jt.advance('REGISTERING');
  jt.advance('REGISTERED');

  t += STAGE_STALL_MS + 1000;

  const snap = jt.getSnapshot();
  assert.strictEqual(snap.stage, 'REGISTERED');
  assert.ok(snap.stalled, 'a join sitting past the stall threshold was not flagged');
  assert.match(snap.failureHint, /roster/i, `hint did not point at roster delivery: ${snap.failureHint}`);
});

scenario('each stall stage produces a distinguishable hint', () => {
  // The diagnostic value is entirely in telling these apart: "no roster" and "ICE never
  // completed" are different bugs with the same user-visible symptom.
  const hints = new Set();
  for (const stage of JOIN_STAGES) {
    if (stage === 'ACTIVE') continue;
    let t = 0;
    const jt = new JoinTracker(() => t);
    jt.begin('r', 'p');
    for (const s of JOIN_STAGES) {
      jt.advance(s);
      if (s === stage) break;
    }
    t += STAGE_STALL_MS + 1;
    const snap = jt.getSnapshot();
    assert.ok(snap.stalled, `${stage} did not report stalled`);
    if (snap.failureHint) hints.add(snap.failureHint);
  }
  assert.ok(hints.size >= 7, `only ${hints.size} distinct hints across the ladder`);
});

scenario('progress is monotonic — a lost link cannot un-join a peer', () => {
  // Links break after admission all the time. If that dragged the join state backwards,
  // "did this peer ever join?" would become unanswerable, which is the question the tracker
  // exists to answer.
  let t = 0;
  const jt = new JoinTracker(() => t);
  jt.begin('r', 'p');
  for (const s of JOIN_STAGES.slice(1)) { t += 10; jt.advance(s); }

  jt.advance('REGISTERED');            // a late/stale event
  jt.advance('NEIGHBORS_SELECTED');    // a repair re-selecting neighbours

  assert.strictEqual(jt.getSnapshot().stage, 'ACTIVE', 'join state moved backwards');
});

scenario('ACTIVE is never reported as stalled however long it persists', () => {
  let t = 0;
  const jt = new JoinTracker(() => t);
  jt.begin('r', 'p');
  for (const s of JOIN_STAGES.slice(1)) jt.advance(s);

  t += 60 * 60 * 1000; // an hour in the room
  assert.strictEqual(jt.getSnapshot().stalled, false, 'a healthy long session was flagged stalled');
});

scenario('link progress is reported against the tier requirement', () => {
  // TIER1 with 3 peers requires 2 links each. Partial admission must be visible as partial.
  let t = 0;
  const jt = new JoinTracker(() => t);
  jt.begin('trio', 'p3');
  jt.setLinkProgress(1, 2);

  const snap = jt.getSnapshot();
  assert.strictEqual(snap.connectedLinks, 1);
  assert.strictEqual(snap.requiredLinks, 2);
  assert.ok(snap.connectedLinks < snap.requiredLinks, 'partial admission looked complete');
});

scenario('the event trail survives a long repair sequence without growing unbounded', () => {
  let t = 0;
  const jt = new JoinTracker(() => t);
  jt.begin('r', 'p');
  for (let i = 0; i < 5000; i++) {
    t += 1;
    jt.advance(JOIN_STAGES[i % JOIN_STAGES.length]);
  }
  assert.ok(jt.getSnapshot().events.length <= 64, 'join event trail grew without bound');
});

scenario('the formatted trace names the stall point', () => {
  let t = 0;
  const jt = new JoinTracker(() => t);
  jt.begin('room-x', 'peer-y');
  jt.advance('REGISTERING');
  jt.advance('REGISTERED');
  jt.advance('ROSTER_SYNCED');
  jt.advance('TOPOLOGY_SYNCED');
  jt.advance('NEIGHBORS_SELECTED');
  jt.setLinkProgress(0, 2);
  t += STAGE_STALL_MS + 1;

  const line = jt.format();
  assert.match(line, /peer-y/);
  assert.match(line, /room-x/);
  assert.match(line, /0\/2 links/);
  assert.match(line, /STALLED/);
  assert.match(line, /signalling|signaling/i, `trace did not name the stall cause: ${line}`);
});

scenario('3-peer TIER1 admission: the third peer requires both existing links', () => {
  // P0-04/P0-15. The invariant a third joiner must satisfy, expressed against the real plan
  // rather than against an assumption about it.
  const peers = ['p1', 'p2', 'p3'];
  for (const me of peers) {
    const plan = planMesh(me, peers);
    assert.ok(plan.isFullMesh, '3 peers should be a full mesh');
    assert.strictEqual(plan.desired.size, 2, `${me} requires 2 links in a 3-peer room`);
  }

  // And the plan must be mutual, or the third peer dials someone who never dials back.
  assert.ok(planIsSymmetric(peers), '3-peer plan is not symmetric');
});

console.log(`\n========================================`);
console.log(`🏁 Routing Stress: ${passed}/${total} scenarios passed (${Math.round((passed / total) * 100)}%)`);
console.log(`========================================\n`);

if (failures.length > 0) {
  console.error('Failures:');
  failures.forEach((f) => console.error(`  - ${f.name}: ${f.err.message}`));
  process.exit(1);
}
