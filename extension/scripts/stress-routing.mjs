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

console.log(`\n========================================`);
console.log(`🏁 Routing Stress: ${passed}/${total} scenarios passed (${Math.round((passed / total) * 100)}%)`);
console.log(`========================================\n`);

if (failures.length > 0) {
  console.error('Failures:');
  failures.forEach((f) => console.error(`  - ${f.name}: ${f.err.message}`));
  process.exit(1);
}
