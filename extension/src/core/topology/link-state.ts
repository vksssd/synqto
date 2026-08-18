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

  /**
   * Derived state, invalidated together with the routes whenever the LSDB changes.
   *
   * getBroadcastChildren is on the per-packet forwarding path, and rebuilding the adjacency
   * and rerunning Dijkstra for every forwarded broadcast measured 62us against 0.06us for a
   * cached nextHop — a thousandfold difference for a tree that only changes when the
   * topology does. Uncached, a busy 24-peer room spent milliseconds per second recomputing
   * an identical answer, and the cost grows with both room size and traffic.
   */
  private adjacencyCache: Map<PeerId, Map<PeerId, number>> | null = null;
  private broadcastTreeCache: Map<PeerId, PeerId[]> = new Map();

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
    seqRecovered: 0,
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

    // pendingEmit is checked alongside `changed` so a sequence recovery (or a suppressed
    // emission) still produces an LSA even when our neighbour set is identical — after a
    // reload the links are usually unchanged, and that is exactly when re-advertising
    // matters most.
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
    this.invalidate();

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

    // An advertisement claiming to be from us.
    //
    // Never adopt it — our own links are something only we can observe. But it is not
    // useless: it tells us what sequence number the room believes we are at, and that is the
    // only way to recover from a restart.
    //
    // This matters more here than in a router network, because the dominant lifecycle event
    // for a browser extension is the user refreshing the page. The peer keeps its identity
    // and starts a fresh sequence at 1, while everyone else still holds, say, seq 47 — so
    // every advertisement the returning peer sends is rejected as a replay, and it stays
    // absent from the routing graph until its stale LSA ages out. For up to maxLsaAgeMs
    // nobody can route to a peer that is sitting right there, connected.
    //
    // Jumping ahead of the stale sequence makes the next advertisement supersede it, which
    // is what OSPF does on restart for the same reason. The database push on adjacency
    // formation is what delivers our own stale LSA back to us, so the two mechanisms
    // together close the loop.
    if (lsa.origin === this.myPeerId) {
      if (lsa.seq >= this.mySeq) {
        this.mySeq = lsa.seq + 1;
        this.pendingEmit = true; // re-advertise at the new sequence on the next tick
        this.stats.seqRecovered++;
      }
      return reject('lsaRejectedStale');
    }

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
    this.invalidate();
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
    this.invalidate();
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
      if (out.length >= this.config.maxLsdbEntries) break;
      // TTL is refreshed for the push: these LSAs may have travelled far to reach us, and
      // their remaining hop budget says nothing about how far they must travel on this side.
      out.push({ ...entry.lsa, ttl: this.config.defaultTtl });
    }
    return out;
  }

  /**
   * The database push, split into messages that fit the transport.
   *
   * syncDatabaseWith sends directly over the DataChannel, bypassing the PacketPipeline on
   * purpose — repair must work even when the pipeline is unhealthy, since an unhealthy
   * pipeline is one of the things repair exists to fix. The price of that choice is that
   * nothing chunks the message, so the snapshot has to bound itself.
   *
   * It was not doing so, and the numbers were not marginal. Measured serialized payloads
   * against the project's own 7 KiB chunking threshold:
   *
   *     24-peer room, degree 6      10 KB    1.4x over
   *     50-peer room, degree 6      21 KB    3.0x over
   *     LSDB at cap, degree 6      127 KB   17.7x over
   *     LSDB at cap, max degree      1 MB  151.2x over
   *
   * So a room at the current TIER1_MAX already exceeded it on every adjacency formation.
   * The consequence is worse than a dropped message: the database push is what merges
   * healed partitions, so a push that fails to send leaves two halves of a room permanently
   * unable to see each other — the exact failure the push was introduced to fix, silently
   * reintroduced by the size of the thing being pushed.
   *
   * An LSA larger than the budget on its own is sent alone rather than dropped: losing it
   * would leave a permanent hole in every receiver's map, which is far worse than one
   * oversized message.
   */
  public getDatabaseSnapshotBatches(maxBytes = 6144): LSA[][] {
    const all = this.getDatabaseSnapshot();
    const batches: LSA[][] = [];

    let current: LSA[] = [];
    let currentBytes = 2; // the enclosing array's brackets

    for (const lsa of all) {
      const size = JSON.stringify(lsa).length + 1;

      if (size > maxBytes) {
        // Too big to share a batch with anything. Flush what we have and ship it alone.
        if (current.length > 0) {
          batches.push(current);
          current = [];
          currentBytes = 2;
        }
        batches.push([lsa]);
        continue;
      }

      if (currentBytes + size > maxBytes && current.length > 0) {
        batches.push(current);
        current = [];
        currentBytes = 2;
      }

      current.push(lsa);
      currentBytes += size;
    }

    if (current.length > 0) batches.push(current);
    return batches;
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
    if (removed > 0) this.invalidate();
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
  /** Drops every derived structure. Called wherever the LSDB changes. */
  private invalidate(): void {
    this.routesDirty = true;
    this.adjacencyCache = null;
    this.broadcastTreeCache.clear();
  }

  private buildAdjacency(): Map<PeerId, Map<PeerId, number>> {
    if (this.adjacencyCache) return this.adjacencyCache;

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

    this.adjacencyCache = adj;
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
    // Deterministic tie-breaking, for the same reason as getBroadcastChildren: reverse-path
    // forwarding compares a receiver's next-hop against the sender, so if two peers resolve
    // an equal-cost tie differently the RPF check fails and the broadcast is dropped.
    for (;;) {
      let current: PeerId | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (visited.has(id)) continue;
        if (d < best || (d === best && current !== null && id < current)) {
          best = d;
          current = id;
        }
      }
      if (current === null) break;
      visited.add(current);

      const edges = Array.from(adj.get(current) ?? []).sort((a, b) => (a[0] < b[0] ? -1 : 1));

      for (const [neighbour, cost] of edges) {
        if (visited.has(neighbour)) continue;
        const candidate = best + cost;
        const known = dist.get(neighbour);

        if (known !== undefined && known < candidate) continue;
        if (known !== undefined && known === candidate) {
          const incumbentHop = firstHop.get(neighbour);
          const proposedHop = current === this.myPeerId ? neighbour : firstHop.get(current)!;
          if (incumbentHop !== undefined && incumbentHop <= proposedHop) continue;
        }

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

  /**
   * The neighbours to forward a broadcast to, given where it originated.
   *
   * Plain reverse-path forwarding filters at the *receiver*: a peer accepts a broadcast only
   * from its upstream neighbour and drops the rest. That is correct but only half the
   * saving, because the duplicates were still transmitted — measured at 111 sends across a
   * 30-peer mesh where the shortest-path tree needs 29.
   *
   * The other half is available for free here. Every peer holds the same verified topology,
   * so each can compute the same shortest-path tree rooted at the origin and send only to
   * the peers for which it is the parent. No tree is stored or agreed: it is derived from
   * the map on demand, and re-derives itself whenever the map changes.
   *
   * Returns null when the origin is not in our map, meaning we cannot compute the tree and
   * the caller should fall back to forwarding broadly. Losing the packet would be worse than
   * a few duplicates.
   */
  public getBroadcastChildren(origin: PeerId): PeerId[] | null {
    if (!this.lsdb.has(origin)) return null;

    const cached = this.broadcastTreeCache.get(origin);
    if (cached) return cached;

    const adj = this.buildAdjacency();
    if (!adj.has(origin)) return null;

    // Dijkstra rooted at the ORIGIN, not at us, so the parent pointers describe the tree the
    // broadcast actually travels.
    const dist = new Map<PeerId, number>([[origin, 0]]);
    const parent = new Map<PeerId, PeerId>();
    const visited = new Set<PeerId>();

    // TIE-BREAKING MUST BE DETERMINISTIC, and this is not a detail.
    //
    // Every peer computes this tree independently and then forwards only to its own
    // children, so the trees must agree exactly. An earlier version selected the frontier by
    // scanning a Map, which iterates in insertion order — and insertion order differs per
    // peer, because each learned its LSAs in a different sequence. Equal-cost paths were
    // therefore resolved differently on different peers, and the "tree" was really several
    // disagreeing trees stitched together.
    //
    // The damage was not subtle. A node whose parent believed someone else was responsible
    // received nothing, while nodes claimed by two parents received duplicates: measured at
    // 110 sends for a 50-peer broadcast (against 49 for a full mesh) and, worse, one peer
    // never reached at all. Sorting the frontier and preferring the lexicographically
    // smaller parent on ties makes the computation a pure function of the graph, which is
    // what makes independent computation safe.
    for (;;) {
      let current: PeerId | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (visited.has(id)) continue;
        if (d < best || (d === best && current !== null && id < current)) {
          best = d;
          current = id;
        }
      }
      if (current === null) break;
      visited.add(current);

      const edges = Array.from(adj.get(current) ?? []).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      for (const [neighbour, cost] of edges) {
        if (visited.has(neighbour)) continue;
        const candidate = best + cost;
        const known = dist.get(neighbour);

        if (known !== undefined && known < candidate) continue;
        if (known !== undefined && known === candidate) {
          // Equal cost: keep whichever parent has the smaller ID, so every peer resolves
          // this tie the same way.
          const incumbent = parent.get(neighbour);
          if (incumbent !== undefined && incumbent <= current) continue;
        }

        dist.set(neighbour, candidate);
        parent.set(neighbour, current);
      }
    }

    const children: PeerId[] = [];
    for (const [node, par] of parent) {
      if (par === this.myPeerId) children.push(node);
    }

    // Bounded by the LSDB, which is itself bounded, so this cannot grow without limit.
    this.broadcastTreeCache.set(origin, children);
    return children;
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
    this.invalidate();
  }

  public getStats() {
    return {
      ...this.stats,
      lsdbSize: this.lsdb.size,
      reachable: this.getReachable().length,
    };
  }
}
