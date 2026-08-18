// ─── Link-State Routing ───
//
// Gives every peer a complete map of the room's connection graph, and from it an exact
// next-hop for any destination.
//
// This exists to replace a guess. `PeerSignaling.pickRelays` currently hands a signal to
// three arbitrary neighbours and hopes one of them can reach the target, because no peer has
// any idea who is connected to whom. That is 3x the traffic standing in for knowledge, and
// it caps how sparse the mesh can safely get: you cannot run a partial mesh without routing,
// because a partial mesh without routing is a partitioned mesh.
//
// LINK-STATE, NOT DISTANCE-VECTOR. For rooms under ~100 peers — this app's entire range —
// flooding each peer's neighbour list and running Dijkstra locally converges faster than
// distance-vector, has no count-to-infinity behaviour, and leaves every peer holding the
// full topology. That map is independently useful: partition detection, relay choice, and
// the persisted topology snapshot all read from it. Distance-vector would be the right call
// only if N were large enough that O(N) state per peer hurt, which it is not.
//
// SCOPE — this module never opens or closes a connection. LeaderMesh and the tier
// coordinator remain the sole authority on which links a peer should hold; this answers only
// "given the links that exist, where does this packet go next". See §0 of
// MESH_ROUTING_IMPLEMENTATION_PLAN.md — that separation is a deliberate decision, and two
// components disagreeing about forwarding is the bug class that severed the P2P ingress seam.

import { PeerId } from '../types/identifiers';

export interface LSANeighbour {
  peerId: PeerId;
  /** Smoothed RTT to this neighbour, from LinkMonitor. */
  costMs: number;
}

/** A peer's advertisement of its own directly-connected neighbours. */
export interface LSA {
  origin: PeerId;
  /** Monotonic per origin. Higher supersedes; equal or lower is a replay. */
  seq: number;
  neighbours: LSANeighbour[];
  issuedAt: number;
  /** Flood radius bound. Decremented per hop; 0 stops propagation. */
  ttl: number;
}

export interface LinkStateConfig {
  /** Minimum gap between our own LSA emissions. Suppresses flap storms. */
  minEmitIntervalMs: number;
  /** An LSA older than this is discarded, so departed peers leave the graph. */
  maxLsaAgeMs: number;
  /** Cap on LSDB entries. Keyed by origin, so network-reachable and must be bounded. */
  maxLsdbEntries: number;
  /** Refuse advertisements claiming more neighbours than this. */
  maxNeighboursPerLsa: number;
  /** Entries younger than this are never evicted, whatever the pressure. */
  protectRecentMs: number;
  /** Initial flood radius. */
  defaultTtl: number;
}

export const DEFAULT_LINK_STATE_CONFIG: LinkStateConfig = {
  minEmitIntervalMs: 1000,
  maxLsaAgeMs: 45_000,
  maxLsdbEntries: 300,
  maxNeighboursPerLsa: 64,
  protectRecentMs: 60_000,
  defaultTtl: 8,
};

interface LsdbEntry {
  lsa: LSA;
  receivedAt: number;
}

export interface RouteEntry {
  nextHop: PeerId;
  costMs: number;
  hops: number;
}

export class LinkStateRouter {
  private myPeerId: PeerId;
  private config: LinkStateConfig;
  private now: () => number;

  private lsdb: Map<PeerId, LsdbEntry> = new Map();
  private routes: Map<PeerId, RouteEntry> = new Map();
  private routesDirty = true;

  private mySeq = 0;
  private myNeighbours: LSANeighbour[] = [];
  private lastEmitAt = 0;
  private pendingEmit = false;

  private stats = {
    lsaAccepted: 0,
    lsaRejectedStale: 0,
    lsaRejectedMalformed: 0,
    lsaRejectedOversized: 0,
    lsaRejectedUnverified: 0,
    lsaEmitted: 0,
    emitSuppressed: 0,
    evicted: 0,
    admissionRefused: 0,
    recomputes: 0,
  };

  constructor(
    myPeerId: PeerId,
    options: Partial<LinkStateConfig> & { now?: () => number } = {}
  ) {
    const { now, ...cfg } = options;
    this.myPeerId = myPeerId;
    this.now = now ?? (() => Date.now());
    this.config = { ...DEFAULT_LINK_STATE_CONFIG, ...cfg };
  }

  public setMyPeerId(peerId: PeerId): void {
    this.myPeerId = peerId;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Advertising
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Records our current neighbour set and returns an LSA to flood, or null.
   *
   * Null means either nothing changed, or we emitted too recently. The rate limit is the
   * storm control: a flapping link would otherwise emit an LSA per transition, and in a
   * room where many links flap at once (the exact aftermath of a network blip) that
   * multiplies across every peer. Suppressed changes are not lost — the pending flag makes
   * the next permitted call emit the current state.
   */
  public updateLocalNeighbours(neighbours: LSANeighbour[]): LSA | null {
    const sane = (neighbours || [])
      .filter((n) => n && typeof n.peerId === 'string' && n.peerId !== this.myPeerId)
      .map((n) => ({ peerId: n.peerId, costMs: Math.max(1, Math.round(n.costMs) || 1) }))
      .slice(0, this.config.maxNeighboursPerLsa);

    const changed = !this.sameNeighbours(sane, this.myNeighbours);
    if (!changed && !this.pendingEmit) return null;

    this.myNeighbours = sane;

    const now = this.now();
    if (now - this.lastEmitAt < this.config.minEmitIntervalMs) {
      this.pendingEmit = true;
      this.stats.emitSuppressed++;
      return null;
    }

    this.pendingEmit = false;
    this.lastEmitAt = now;
    this.mySeq++;
    this.stats.lsaEmitted++;

    const lsa: LSA = {
      origin: this.myPeerId,
      seq: this.mySeq,
      neighbours: sane,
      issuedAt: now,
      ttl: this.config.defaultTtl,
    };

    // Our own advertisement goes into our own database, so Dijkstra sees our edges.
    this.lsdb.set(this.myPeerId, { lsa, receivedAt: now });
    this.routesDirty = true;

    return lsa;
  }

  private sameNeighbours(a: LSANeighbour[], b: LSANeighbour[]): boolean {
    if (a.length !== b.length) return false;
    const bMap = new Map(b.map((n) => [n.peerId, n.costMs]));
    for (const n of a) {
      const other = bMap.get(n.peerId);
      if (other === undefined) return false;
      // Small cost drift should not trigger a re-flood; only a meaningful change should.
      if (Math.abs(other - n.costMs) > 15) return false;
    }
    return true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Receiving
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Validates and stores an inbound LSA. Returns whether it was accepted and whether the
   * caller should re-flood it.
   */
  public handleLSA(lsa: LSA, fromPeerId: PeerId): { accepted: boolean; reflood: boolean } {
    const reject = (counter: keyof typeof this.stats) => {
      this.stats[counter]++;
      return { accepted: false, reflood: false };
    };

    if (!this.isWellFormed(lsa)) return reject('lsaRejectedMalformed');

    // An implausible neighbour count is either a bug or an attempt to bloat every peer's
    // LSDB and Dijkstra run. Reject rather than truncate: a truncated advertisement would
    // enter the graph as a partial, misleading view of that peer's links.
    if (lsa.neighbours.length > this.config.maxNeighboursPerLsa) {
      return reject('lsaRejectedOversized');
    }

    // Never let a remote advertisement overwrite our own view of our own links.
    if (lsa.origin === this.myPeerId) return reject('lsaRejectedStale');

    const existing = this.lsdb.get(lsa.origin);
    if (existing && lsa.seq <= existing.lsa.seq) {
      // Replay or a duplicate arriving by another path. Dropping without re-flooding is
      // what stops a flood from circulating forever in a cyclic graph.
      return reject('lsaRejectedStale');
    }

    const now = this.now();
    if (!existing && !this.admit(lsa.origin)) {
      return reject('admissionRefused');
    }

    this.lsdb.set(lsa.origin, { lsa, receivedAt: now });
    this.routesDirty = true;
    this.stats.lsaAccepted++;

    void fromPeerId; // split horizon is applied by the caller, which knows the arrival link

    return { accepted: true, reflood: lsa.ttl > 1 };
  }

  private isWellFormed(lsa: unknown): lsa is LSA {
    if (!lsa || typeof lsa !== 'object') return false;
    const l = lsa as Partial<LSA>;
    if (typeof l.origin !== 'string' || l.origin.length === 0) return false;
    if (typeof l.seq !== 'number' || !Number.isFinite(l.seq) || l.seq < 0) return false;
    if (!Array.isArray(l.neighbours)) return false;
    for (const n of l.neighbours) {
      if (!n || typeof n.peerId !== 'string' || n.peerId.length === 0) return false;
      if (typeof n.costMs !== 'number' || !Number.isFinite(n.costMs) || n.costMs < 0) return false;
    }
    return true;
  }

  /**
   * Admits a new origin into the LSDB, evicting only entries that have gone cold.
   *
   * The eviction policy is a security decision, not housekeeping. Bounding a
   * network-reachable map with naive insertion-order eviction is exactly what produced the
   * replay hole in peer-signaling.ts: anyone who could reach us could displace real state by
   * flooding invented identities. Here the consequence would be worse than a replay — evict
   * a live peer's LSA and its links vanish from the graph, silently destroying working
   * routes for everyone downstream of it.
   *
   * So entries seen recently are never evicted, and when everything is recent the newcomer
   * is refused instead. Refusing an unknown peer a routing entry degrades reachability to
   * that peer; evicting a known one degrades reachability for the whole room.
   */
  private admit(_origin: PeerId): boolean {
    if (this.lsdb.size < this.config.maxLsdbEntries) return true;

    const now = this.now();
    let coldest: PeerId | null = null;
    let coldestAt = Infinity;

    for (const [id, entry] of this.lsdb) {
      if (id === this.myPeerId) continue;
      if (now - entry.receivedAt <= this.config.protectRecentMs) continue;
      if (entry.receivedAt < coldestAt) {
        coldest = id;
        coldestAt = entry.receivedAt;
      }
    }

    if (coldest === null) return false;
    this.lsdb.delete(coldest);
    this.stats.evicted++;
    this.routesDirty = true;
    return true;
  }

  /**
   * The LSAs to push to a neighbour whose link has just come up.
   *
   * Flooding alone is not sufficient, and the gap is not obvious: flooding only propagates
   * LSAs as they are *generated*, so two peers that have been apart hold databases neither
   * will ever send the other. When a partition heals, the peers at the seam re-advertise
   * their own changed neighbour lists — but nobody replays the advertisements they were
   * already holding, so each side stays ignorant of everything beyond the seam and the
   * partition persists in the routing tables long after the link is back.
   *
   * The same gap applies to an ordinary join: a peer arriving in an established room would
   * learn only about future changes, never the room as it already is.
   *
   * So a new adjacency triggers a database push, which is what OSPF does on adjacency
   * formation for exactly this reason. Entries the receiver already holds at an equal or
   * higher sequence are rejected cheaply by handleLSA, so the exchange is idempotent and
   * safe to repeat.
   */
  public getDatabaseSnapshot(): LSA[] {
    const out: LSA[] = [];
    for (const entry of this.lsdb.values()) {
      // TTL is refreshed for the push: these LSAs may have travelled far to reach us, and
      // their remaining hop budget says nothing about how far they must travel on this side.
      out.push({ ...entry.lsa, ttl: this.config.defaultTtl });
    }
    return out;
  }

  /**
   * Applies a database push from a new neighbour. Returns the LSAs that were new to us and
   * therefore need onward flooding.
   */
  public handleDatabaseSnapshot(lsas: LSA[], fromPeerId: PeerId): LSA[] {
    if (!Array.isArray(lsas)) return [];

    const novel: LSA[] = [];
    // Bounded: a peer could otherwise push an arbitrarily long list in a single message.
    for (const lsa of lsas.slice(0, this.config.maxLsdbEntries)) {
      const res = this.handleLSA(lsa, fromPeerId);
      if (res.accepted) novel.push(lsa);
    }
    return novel;
  }

  /**
   * Drops advertisements older than maxLsaAgeMs. Returns how many were removed.
   *
   * Without this a peer that leaves stays in the graph forever, and every other peer keeps
   * computing routes through a node that is not there — traffic disappears into a next-hop
   * that no longer exists.
   */
  public ageOut(): number {
    const now = this.now();
    let removed = 0;
    for (const [id, entry] of this.lsdb) {
      if (id === this.myPeerId) continue;
      if (now - entry.lsa.issuedAt > this.config.maxLsaAgeMs) {
        this.lsdb.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.routesDirty = true;
    return removed;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Route computation
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Builds the adjacency used for routing, admitting an edge only when BOTH endpoints
   * advertise it.
   *
   * This is the defence against the classic link-state blackhole. Any room member can send
   * LSAs, so a peer that claims adjacency to everyone at cost 1 becomes the shortest path
   * for all traffic, which it can then silently drop. Requiring the other endpoint to
   * confirm the link makes the claim unforgeable by one party: the liar would need the
   * cooperation of every peer it names.
   *
   * Cost is the maximum of the two reported values rather than the mean, so a peer cannot
   * make a link look attractive by understating its own side.
   */
  private buildAdjacency(): Map<PeerId, Map<PeerId, number>> {
    const adj: Map<PeerId, Map<PeerId, number>> = new Map();
    const claims: Map<string, number> = new Map();

    for (const [origin, entry] of this.lsdb) {
      for (const n of entry.lsa.neighbours) {
        claims.set(`${origin}->${n.peerId}`, n.costMs);
      }
    }

    for (const [origin, entry] of this.lsdb) {
      for (const n of entry.lsa.neighbours) {
        const reverse = claims.get(`${n.peerId}->${origin}`);
        if (reverse === undefined) continue; // unverified — one-sided claim
        const cost = Math.max(n.costMs, reverse);

        if (!adj.has(origin)) adj.set(origin, new Map());
        if (!adj.has(n.peerId)) adj.set(n.peerId, new Map());
        adj.get(origin)!.set(n.peerId, cost);
        adj.get(n.peerId)!.set(origin, cost);
      }
    }

    return adj;
  }

  /** Dijkstra from this peer, producing next-hop for every reachable destination. */
  private recompute(): void {
    this.stats.recomputes++;
    this.routes.clear();

    const adj = this.buildAdjacency();
    const dist: Map<PeerId, number> = new Map([[this.myPeerId, 0]]);
    const hops: Map<PeerId, number> = new Map([[this.myPeerId, 0]]);
    const firstHop: Map<PeerId, PeerId> = new Map();
    const visited: Set<PeerId> = new Set();

    // Small N, so a linear scan for the minimum is cheaper than maintaining a heap.
    for (;;) {
      let current: PeerId | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < best) {
          best = d;
          current = id;
        }
      }
      if (current === null) break;
      visited.add(current);

      const edges = adj.get(current);
      if (!edges) continue;

      for (const [neighbour, cost] of edges) {
        if (visited.has(neighbour)) continue;
        const candidate = best + cost;
        const known = dist.get(neighbour);
        if (known !== undefined && known <= candidate) continue;

        dist.set(neighbour, candidate);
        hops.set(neighbour, (hops.get(current) ?? 0) + 1);
        // The first hop toward `neighbour` is our own neighbour on this path: if we are
        // expanding from ourselves it is the neighbour itself, otherwise inherit it.
        firstHop.set(neighbour, current === this.myPeerId ? neighbour : firstHop.get(current)!);
      }
    }

    for (const [dest, d] of dist) {
      if (dest === this.myPeerId) continue;
      const hop = firstHop.get(dest);
      if (!hop) continue;
      this.routes.set(dest, { nextHop: hop, costMs: d, hops: hops.get(dest) ?? 1 });
    }

    this.routesDirty = false;
  }

  private ensureRoutes(): void {
    if (this.routesDirty) this.recompute();
  }

  /** Next hop toward a destination, or null when unreachable. */
  public nextHop(destination: PeerId): PeerId | null {
    this.ensureRoutes();
    return this.routes.get(destination)?.nextHop ?? null;
  }

  public getRoute(destination: PeerId): RouteEntry | null {
    this.ensureRoutes();
    return this.routes.get(destination) ?? null;
  }

  /** Every peer reachable through the current graph. Anything absent is partitioned away. */
  public getReachable(): PeerId[] {
    this.ensureRoutes();
    return Array.from(this.routes.keys());
  }

  /** The verified topology, for the persisted snapshot and for diagnostics. */
  public getTopology(): Array<{ a: PeerId; b: PeerId; costMs: number }> {
    const adj = this.buildAdjacency();
    const seen = new Set<string>();
    const out: Array<{ a: PeerId; b: PeerId; costMs: number }> = [];
    for (const [a, edges] of adj) {
      for (const [b, cost] of edges) {
        const key = [a, b].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ a, b, costMs: cost });
      }
    }
    return out;
  }

  public getLSA(origin: PeerId): LSA | null {
    return this.lsdb.get(origin)?.lsa ?? null;
  }

  public reset(): void {
    this.lsdb.clear();
    this.routes.clear();
    this.myNeighbours = [];
    this.mySeq = 0;
    this.lastEmitAt = 0;
    this.pendingEmit = false;
    this.routesDirty = true;
  }

  public getStats() {
    return {
      ...this.stats,
      lsdbSize: this.lsdb.size,
      reachable: this.getReachable().length,
    };
  }
}
