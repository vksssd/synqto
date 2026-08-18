// ─── Sparse Mesh Planning ───
//
// Decides which links a peer should hold, so that a room can grow past the point where
// "everyone connects to everyone" stops being viable.
//
// A full mesh costs each peer N-1 PeerConnections and N-1 sends per broadcast. That is what
// pinned TIER1_MAX at 8: at 30 peers it would be 29 connections each and 435 links in the
// room, which no browser will sustain. Cutting degree to a constant makes room size almost
// irrelevant to per-peer cost — which is what let TIER1_MAX rise to 24, with hop count
// rather than connection count as the new binding constraint.
//
// CONNECTIVITY MUST BE GUARANTEED, NOT LIKELY. A random k-regular graph is *usually*
// connected, and usually is not good enough for a room that would split silently — two
// halves that cannot see each other, each believing it is the whole room, is the worst
// failure this system can produce. So the plan is a deterministic ring plus chords:
//
//   RING    every peer links to its neighbours in peer-ID order. A ring over N nodes is
//           connected by construction, and survives any single node failure. This is where
//           a ring belongs — as the connectivity substrate, not the data path, because its
//           O(N) diameter would be ruinous for cursor traffic.
//
//   CHORDS  each peer additionally links to peers at fixed offsets around that ordering.
//           Chords collapse the diameter from O(N) to O(log N): a 30-peer ring is 15 hops
//           across, the same ring with two chord sets measures 3.
//
// Every peer computes the same plan from the same sorted peer list with no negotiation, so
// two peers always agree on whether a link between them should exist. That property is what
// makes the plan safe to act on unilaterally — there is no protocol to disagree about.
//
// SCOPE — this module is pure. It computes a desired link set; TopologyService decides what
// to do about the difference between desired and actual. See §0 of
// MESH_ROUTING_IMPLEMENTATION_PLAN.md: shape decisions stay with the topology layer.

import { PeerId } from '../types/identifiers';

export interface MeshPlanConfig {
  /**
   * Room size at or below which a full mesh is kept.
   *
   * Below this, sparsity is a pessimisation: every peer is one hop away anyway, the
   * connection count is already trivial, and multi-hop forwarding would add latency to
   * cursor and co-editing traffic for no saving. Sparse planning only pays once the full
   * mesh actually hurts.
   */
  fullMeshUpTo: number;
  /** Target links per peer once sparse. Must be >= 2 for the ring plus one chord. */
  targetDegree: number;
}

export const DEFAULT_MESH_PLAN_CONFIG: MeshPlanConfig = {
  fullMeshUpTo: 8,
  targetDegree: 6,
};

/**
 * Chord offsets, applied around the sorted peer ordering.
 *
 * Coprime with typical room sizes and spread across the ring so the chords of different
 * peers do not collapse onto the same few nodes. These are what take the diameter from
 * O(N) to O(log N).
 */
function chordOffsets(n: number, count: number): number[] {
  if (count <= 0 || n < 4) return [];

  // A geometric ladder, offset_j = N^((j+1)/(count+1)).
  //
  // The obvious construction — halving from N/2 — is worse than it looks. N/2 is its own
  // inverse on a ring, so +N/2 and -N/2 are the same peer and a chord slot is silently
  // wasted; and the remaining offsets cluster in the top half of the range, leaving short
  // distances reachable only by walking the ring one step at a time. That is how a 30-peer
  // room ended up with a diameter of 5 rather than the 4 the budget allows.
  //
  // Spacing the offsets geometrically balances the two: each hop multiplies reach by
  // roughly the same factor, so both short and long distances are covered in a similar
  // number of hops. For N=30 with two chords this yields 3 and 10 — which combined with
  // the ring's +/-1 reaches every offset on the ring within four hops.
  const offsets: number[] = [];
  for (let j = 1; j <= count; j++) {
    const raw = Math.round(Math.pow(n, j / (count + 1)));
    // Keep clear of 1 (the ring already covers it) and of N/2 (self-inverse).
    let off = Math.max(2, Math.min(raw, Math.floor(n / 2) - 1));
    while (offsets.includes(off) && off < Math.floor(n / 2)) off++;
    if (off >= 2 && !offsets.includes(off)) offsets.push(off);
  }
  return offsets;
}

export interface MeshPlan {
  /** Peers this peer should hold a link to. */
  desired: Set<PeerId>;
  /** True when the plan is a full mesh (small room). */
  isFullMesh: boolean;
  /** Ring neighbours — the links that must never be dropped for load reasons. */
  ringLinks: Set<PeerId>;
}

/**
 * Computes the links `myPeerId` should hold, given the room roster.
 *
 * Deterministic and symmetric: if A's plan contains B, then B's plan contains A. Symmetry is
 * verified by the stress harness, because an asymmetric plan would mean one side keeps
 * dialling a peer that keeps hanging up.
 */
export function planMesh(
  myPeerId: PeerId,
  allPeers: Iterable<PeerId>,
  config: Partial<MeshPlanConfig> = {}
): MeshPlan {
  const cfg = { ...DEFAULT_MESH_PLAN_CONFIG, ...config };

  const peers = Array.from(new Set(allPeers)).filter((p) => typeof p === 'string' && p).sort();
  const n = peers.length;
  const desired = new Set<PeerId>();
  const ringLinks = new Set<PeerId>();

  if (n <= 1) return { desired, isFullMesh: true, ringLinks };

  const myIndex = peers.indexOf(myPeerId);
  if (myIndex === -1) {
    // Not in the roster — nothing to plan. Happens transiently between join and first
    // roster; returning an empty plan is safer than guessing a position in the ring.
    return { desired, isFullMesh: n <= cfg.fullMeshUpTo, ringLinks };
  }

  if (n <= cfg.fullMeshUpTo) {
    for (const p of peers) if (p !== myPeerId) desired.add(p);
    return { desired, isFullMesh: true, ringLinks: desired };
  }

  // Ring: predecessor and successor in the sorted ordering.
  const succ = peers[(myIndex + 1) % n];
  const pred = peers[(myIndex - 1 + n) % n];
  desired.add(succ);
  desired.add(pred);
  ringLinks.add(succ);
  ringLinks.add(pred);

  // Chords fill the remaining degree budget. Each is added in both directions (+off and
  // -off) so the resulting graph is symmetric: if A links to A+off, then that same peer sees
  // A at -off and links back.
  const chordBudget = Math.max(0, cfg.targetDegree - 2);
  for (const off of chordOffsets(n, Math.ceil(chordBudget / 2))) {
    if (desired.size >= cfg.targetDegree) break;
    const forward = peers[(myIndex + off) % n];
    const backward = peers[(myIndex - off + n * 2) % n];
    if (forward !== myPeerId) desired.add(forward);
    if (desired.size < cfg.targetDegree && backward !== myPeerId) desired.add(backward);
  }

  return { desired, isFullMesh: false, ringLinks };
}

/**
 * Whether two peers agree that a link between them should exist.
 *
 * Used by the harness to assert symmetry across every roster it generates. An asymmetric
 * plan is not a cosmetic flaw: one peer would dial while the other tears down, producing a
 * connect/disconnect loop that looks exactly like a flaky network.
 */
export function planIsSymmetric(peers: PeerId[], config?: Partial<MeshPlanConfig>): boolean {
  const plans = new Map(peers.map((p) => [p, planMesh(p, peers, config)]));
  for (const a of peers) {
    for (const b of plans.get(a)!.desired) {
      if (!plans.get(b)?.desired.has(a)) return false;
    }
  }
  return true;
}
