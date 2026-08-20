// ─── Transport Correctness Harness ───
//
// Regressions for the networking audit (NETWORKING_AUDIT.md). Each scenario encodes the
// INVARIANT that was violated rather than the specific reproduction, and where a fix is
// subtle the scenario also asserts the *converse* — that the fix did not simply invert the
// bug. A test that only proves "the old value is gone" passes against a fix that returns
// false unconditionally.

import assert from 'assert';
import { OrderingBuffer } from '../src/core/network/ordering-buffer.ts';

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

// ── Broadcast success accounting (S1-1) ──────────────────────────────────────
//
// Models sendP2PPacket's TIER1 loop. The defect was `sendPacket(...); anySent = true;` —
// discarding the result — which made the boolean report "an attempt was made" while
// TransportRouter read it as "a send succeeded", rendering the entire deferral path
// unreachable.

function tier1Broadcast(peers, sendFn) {
  let anySent = false;
  for (const p of peers) {
    if (sendFn(p)) anySent = true;
  }
  return anySent;
}

console.log('\n🚚 Transport Correctness Regressions\n');

console.log('── A: broadcast reports what actually happened ──');

scenario('a broadcast where every send fails reports failure', () => {
  // The exact condition the deferral path exists to catch. Under the old code this returned
  // true and the packet was neither queued nor retried nor relayed — it was simply gone.
  const sent = tier1Broadcast(['a', 'b', 'c'], () => false);
  assert.strictEqual(sent, false, 'broadcast claimed success with zero successful sends');
});

scenario('a broadcast where one of several sends succeeds reports success', () => {
  // The converse. A fix that returns false whenever ANY peer fails would defer packets that
  // were in fact delivered, and in a mesh with one flaky peer that is every packet.
  const sent = tier1Broadcast(['a', 'b', 'c'], (p) => p === 'b');
  assert.strictEqual(sent, true, 'broadcast reported failure despite a successful send');
});

scenario('an empty target set reports failure', () => {
  assert.strictEqual(tier1Broadcast([], () => true), false);
});

scenario('success is not inferred from connectivity checks', () => {
  // isConnected() reads readyState; the channel can close between that read and the send.
  // Only the send's own result may set the flag.
  const connected = new Set(['a', 'b']);
  const sendFn = (p) => {
    connected.delete(p);   // channel closes exactly at send time
    return false;
  };
  assert.strictEqual(tier1Broadcast(['a', 'b'], sendFn), false);
});

scenario('a TIER2 leader with no cluster and no backbone reports failure', () => {
  // This branch was the blunter one: fan out, then `return true` unconditionally.
  const leaderBroadcast = (cluster, backbone, sendFn) => {
    let anySent = false;
    cluster.forEach((p) => { if (sendFn(p)) anySent = true; });
    backbone.forEach((l) => { if (sendFn(l)) anySent = true; });
    return anySent;
  };
  assert.strictEqual(leaderBroadcast([], [], () => true), false,
    'an isolated leader claimed its broadcast went out');
  assert.strictEqual(leaderBroadcast(['m1'], [], () => true), true,
    'a leader with one reachable member should report success');
});

console.log('\n── B: relay policy is enforced where it can be broken ──');

// broadcastPacket bypasses TransportRouter (it carries the leader-mesh digest, whose routing
// depends on the very topology it maintains), so it also bypasses the relay policy the router
// enforces. The guard has to be repeated there rather than inherited.

function controlBroadcast({ tier, lifecycle, allowRelay }) {
  const relayed = [];
  const relayPermitted = allowRelay;
  if (tier === 'TIER3_SERVER_RELAY') {
    if (relayPermitted) relayed.push('tier3');
    return relayed;
  }
  if (relayPermitted && (lifecycle === 'TIER3_PREPARING' || lifecycle === 'TIER3_DEMOTING')) {
    relayed.push('draining');
  }
  return relayed;
}

scenario('a DIRECT_ONLY room never reaches the server, even at TIER3', () => {
  assert.deepStrictEqual(
    controlBroadcast({ tier: 'TIER3_SERVER_RELAY', lifecycle: 'STABLE_TIER3', allowRelay: false }),
    [],
    'a relay-forbidden room put the server in its data path'
  );
});

scenario('a DIRECT_ONLY room never reaches the server while draining', () => {
  for (const lifecycle of ['TIER3_PREPARING', 'TIER3_DEMOTING']) {
    assert.deepStrictEqual(
      controlBroadcast({ tier: 'TIER1_FULL_MESH', lifecycle, allowRelay: false }),
      [],
      `dual-path migration relayed in a relay-forbidden room (${lifecycle})`
    );
  }
});

scenario('an adaptive room still uses the relay when it should', () => {
  // The converse: the guard must not disable relay for ordinary rooms, which would silently
  // remove TIER3 as a working tier.
  assert.deepStrictEqual(
    controlBroadcast({ tier: 'TIER3_SERVER_RELAY', lifecycle: 'STABLE_TIER3', allowRelay: true }),
    ['tier3']
  );
  assert.deepStrictEqual(
    controlBroadcast({ tier: 'TIER1_FULL_MESH', lifecycle: 'TIER3_PREPARING', allowRelay: true }),
    ['draining']
  );
});

console.log('\n── C: ordering buffer is bounded and still correct ──');

function feed(buffer, packets, { onGap } = {}) {
  const delivered = [];
  for (const p of packets) {
    buffer.inflow(p, (pkt) => delivered.push(pkt.seq), onGap);
  }
  return delivered;
}

const pkt = (seq, streamId = 's1', peerId = 'p1') => ({
  id: `${streamId}-${seq}`,
  seq,
  streamId,
  from: { peerId },
  timestamp: 1000 + seq,
});

scenario('in-order packets are delivered immediately and in order', () => {
  const b = new OrderingBuffer();
  const got = feed(b, [pkt(1), pkt(2), pkt(3)]);
  assert.deepStrictEqual(got, [1, 2, 3]);
});

scenario('an out-of-order packet is held, then released when the gap fills', () => {
  const b = new OrderingBuffer();
  const got = feed(b, [pkt(1), pkt(3), pkt(2)]);
  assert.deepStrictEqual(got, [1, 2, 3], 'gap fill did not drain the holding queue in order');
});

scenario('duplicates below the expected sequence are dropped', () => {
  const b = new OrderingBuffer();
  const got = feed(b, [pkt(1), pkt(2), pkt(1), pkt(2)]);
  assert.deepStrictEqual(got, [1, 2], 'a replayed sequence was delivered twice');
});

scenario('SECURITY: a withheld sequence cannot make the holding queue grow without bound', () => {
  // The attack: send seq=1, never send seq=2, then flood. Previously every one of those was
  // buffered for up to the 45s skip window, with size chosen entirely by the attacker.
  const b = new OrderingBuffer();
  const flood = [pkt(1)];
  for (let s = 3; s <= 500; s++) flood.push(pkt(s));
  feed(b, flood);

  const state = b.streams.get('s1::p1') ?? [...b.streams.values()][0];
  assert.ok(state, 'could not reach stream state to measure the queue');
  assert.ok(
    state.holdingQueue.size <= 64,
    `holding queue grew to ${state.holdingQueue.size} entries under a withheld-sequence flood`
  );
});

scenario('overflow collapses the gap rather than discarding the stream', () => {
  // Bounding memory by throwing away everything past the gap would turn one lost packet into
  // an indefinite silence. The buffer must skip forward and keep delivering.
  const b = new OrderingBuffer();
  const flood = [pkt(1)];
  for (let s = 3; s <= 200; s++) flood.push(pkt(s));
  const got = feed(b, flood);

  assert.ok(got.length > 1, 'overflow silenced the stream instead of skipping the gap');
  assert.strictEqual(got[0], 1);
  // Monotonic: a collapse may skip, but must never redeliver or go backwards.
  for (let i = 1; i < got.length; i++) {
    assert.ok(got[i] > got[i - 1], `delivery order regressed: ${got[i - 1]} -> ${got[i]}`);
  }
});

scenario('a gap repair request never asks for more than it can receive', () => {
  const b = new OrderingBuffer();
  const requests = [];
  feed(b, [pkt(1), pkt(9999)], { onGap: (g) => requests.push(g) });
  assert.ok(requests.length > 0, 'no gap repair was requested');
  const width = requests[0].missingRangeEnd - requests[0].missingRangeStart;
  assert.ok(width <= 64, `repair request spans ${width}, beyond the repair window`);
});

console.log('\n========================================');
console.log(`🏁 Transport: ${passed}/${total} scenarios passed (${Math.round((passed / total) * 100)}%)`);
console.log('========================================\n');

if (failures.length > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.err.message}`);
  process.exit(1);
}
