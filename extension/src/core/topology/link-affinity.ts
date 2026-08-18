// ─── Link Affinity ───
//
// Tracks how much latency-sensitive traffic flows between this peer and each other peer, so
// that a sparse mesh plan does not tear down the one link that actually matters.
//
// THE PROBLEM THIS SOLVES. Sparsity is a good trade in aggregate — degree 6 instead of 49 at
// a 50-peer room — but it is a bad trade for the specific pair of people typing in the same
// editor. Their traffic would take 3-4 hops instead of 1, turning ~40ms into ~150ms, and
// co-editing stops feeling live at roughly 100ms. Averaged over the room the sparse plan
// wins; for that pair it loses badly.
//
// The resolution is that the two are not in conflict, because interaction is concentrated:
// in a thirty-person room you are actively co-editing with one or two people, not thirty. So
// the plan is followed for the room at large, and a small number of links are *promoted* to
// direct on the basis of measured traffic. Cost stays near the degree target while the links
// that carry interactive traffic stay one hop.
//
// Promotion is driven by observation rather than declaration: no feature has to remember to
// register interest, and a link earns its place by being used.

import { PeerId } from '../types/identifiers';

/**
 * Packet types whose latency a user can feel directly.
 *
 * Deliberately narrow. Chat tolerates a hop — nobody perceives 100ms in a message they are
 * reading. A cursor that lags its owner by 150ms looks broken, and a co-edited keystroke
 * arriving late produces visible flicker as the local and remote states reconcile.
 */
const INTERACTIVE_TYPES = new Set([
  'code:cursor',
  'code:delta',
  'code:sync',
  'canvas:cursor',
  'canvas:click',
  'whiteboard:stroke',
  'whiteboard:temp_stroke',
  'whiteboard:laser',
]);

export function isInteractiveType(type: string): boolean {
  return INTERACTIVE_TYPES.has(type);
}

export interface AffinityConfig {
  /** Window over which interaction is measured. */
  windowMs: number;
  /** Interactive packets within the window that justify holding a direct link. */
  promoteThreshold: number;
  /** Falling below this releases the link. Lower than promote, to create hysteresis. */
  demoteThreshold: number;
  /** Hard cap on promoted links, so affinity cannot rebuild a full mesh. */
  maxPromoted: number;
  /** A freshly promoted link is held at least this long. */
  minHoldMs: number;
}

export const DEFAULT_AFFINITY_CONFIG: AffinityConfig = {
  windowMs: 10_000,
  promoteThreshold: 25,
  demoteThreshold: 5,
  maxPromoted: 4,
  minHoldMs: 30_000,
};

interface AffinityEntry {
  /** Decaying count of interactive packets exchanged. */
  score: number;
  lastUpdatedAt: number;
  promotedAt: number | null;
}

export class LinkAffinity {
  private entries: Map<PeerId, AffinityEntry> = new Map();
  private config: AffinityConfig;
  private now: () => number;

  /** Bounded: keyed by peer ID and fed from inbound traffic, so network-reachable. */
  private static readonly MAX_TRACKED = 200;

  constructor(options: Partial<AffinityConfig> & { now?: () => number } = {}) {
    const { now, ...cfg } = options;
    this.now = now ?? (() => Date.now());
    this.config = { ...DEFAULT_AFFINITY_CONFIG, ...cfg };
  }

  /**
   * Records interactive traffic with a peer, in either direction.
   *
   * Both directions count toward one score. Co-editing is inherently mutual — if they are
   * typing and you are watching, the link matters just as much as if the roles were
   * reversed — and scoring the two directions separately would let a link that is busy one
   * way fail to qualify.
   */
  public note(peerId: PeerId, packetType: string): void {
    if (!isInteractiveType(packetType)) return;

    const now = this.now();
    let entry = this.entries.get(peerId);

    if (!entry) {
      if (this.entries.size >= LinkAffinity.MAX_TRACKED && !this.evictColdest(now)) return;
      entry = { score: 0, lastUpdatedAt: now, promotedAt: null };
      this.entries.set(peerId, entry);
    }

    // Exponential decay toward the window, so the score reflects recent behaviour rather
    // than a total that would only ever grow. A pair that co-edited an hour ago should not
    // hold a link now.
    const elapsed = now - entry.lastUpdatedAt;
    if (elapsed > 0) {
      entry.score *= Math.exp(-elapsed / this.config.windowMs);
    }
    entry.score += 1;
    entry.lastUpdatedAt = now;
  }

  private decayed(entry: AffinityEntry, now: number): number {
    const elapsed = Math.max(0, now - entry.lastUpdatedAt);
    return entry.score * Math.exp(-elapsed / this.config.windowMs);
  }

  private evictColdest(now: number): boolean {
    let coldest: PeerId | null = null;
    let coldestScore = Infinity;
    for (const [peerId, entry] of this.entries) {
      if (entry.promotedAt !== null) continue; // never evict a promoted link's state
      const score = this.decayed(entry, now);
      if (score < coldestScore) {
        coldest = peerId;
        coldestScore = score;
      }
    }
    if (coldest === null) return false;
    this.entries.delete(coldest);
    return true;
  }

  /**
   * Whether a link outside the mesh plan should nonetheless be held.
   *
   * Called when the plan wants to shed a link. Answering yes keeps a connection the plan did
   * not ask for, so the two mechanisms together produce "plan, plus a few links that earned
   * their place".
   */
  public shouldKeep(peerId: PeerId): boolean {
    const entry = this.entries.get(peerId);
    if (!entry) return false;

    const now = this.now();

    // A newly promoted link is held for a minimum period regardless of score. Without this,
    // a brief pause in typing drops the link, and the next keystroke pays a full
    // reconnection — the oscillation is worse than either steady state.
    if (entry.promotedAt !== null && now - entry.promotedAt < this.config.minHoldMs) {
      return true;
    }

    const score = this.decayed(entry, now);

    if (entry.promotedAt !== null) {
      // Already promoted: hold until it falls below the lower threshold. The gap between
      // promote and demote is what stops a link hovering near the boundary from flapping.
      if (score >= this.config.demoteThreshold) return true;
      entry.promotedAt = null;
      return false;
    }

    if (score < this.config.promoteThreshold) return false;

    // Promote, if there is room. The cap matters: without it, a busy room would promote
    // every link and rebuild the full mesh that sparsity exists to avoid.
    if (this.promotedCount(now) >= this.config.maxPromoted) return false;

    entry.promotedAt = now;
    return true;
  }

  private promotedCount(now: number): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.promotedAt === null) continue;
      if (now - entry.promotedAt < this.config.minHoldMs) {
        count++;
        continue;
      }
      if (this.decayed(entry, now) >= this.config.demoteThreshold) count++;
    }
    return count;
  }

  public getPromoted(): PeerId[] {
    const now = this.now();
    return Array.from(this.entries.entries())
      .filter(([, e]) => e.promotedAt !== null)
      .filter(([, e]) => now - e.promotedAt! < this.config.minHoldMs || this.decayed(e, now) >= this.config.demoteThreshold)
      .map(([peerId]) => peerId);
  }

  public getScore(peerId: PeerId): number {
    const entry = this.entries.get(peerId);
    return entry ? this.decayed(entry, this.now()) : 0;
  }

  public forget(peerId: PeerId): void {
    this.entries.delete(peerId);
  }

  public reset(): void {
    this.entries.clear();
  }

  public getStats() {
    return {
      tracked: this.entries.size,
      promoted: this.getPromoted().length,
    };
  }
}
