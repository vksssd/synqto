// ─── Peer-Assisted Signaling ───
//
// The premise of a P2P mesh is that the server is a rendezvous point, not infrastructure:
// once peers can talk to each other, the server should be irrelevant. That was not true.
// Every offer, answer and ICE candidate went out over the signaling WebSocket, including
// the ones needed to *repair* an already-established mesh. So a server restart, a Render
// cold start, or thirty seconds of WebSocket flakiness would leave a room full of peers who
// could all still reach each other unable to fix a single broken link between them.
//
// This module removes that dependency by treating signaling as ordinary routable traffic.
// A signaling message is small, infrequent, and needs delivery rather than low latency —
// which is exactly what the existing mesh already provides.
//
// Transport is chosen by preference, best first:
//
//   1. DIRECT      — the data channel to the target is still open.
//                    Covers renegotiation: turning a camera on, adding a track, an ICE
//                    restart on a link that is degraded but not yet dead. The server is not
//                    involved at all, even today, in the common case.
//
//   2. PEER-RELAY  — the direct link is down, but some third peer is connected to both of
//                    us. That peer forwards the signaling. This is the case that matters:
//                    it is precisely when a link breaks that the old code fell back to the
//                    server, and precisely when a mesh has the most alternative paths.
//
//   3. SERVER      — no path exists through the mesh. Genuinely new peers with no common
//                    neighbour, or the first two peers in an empty room. This is the only
//                    case that legitimately needs a rendezvous point.
//
// The result: an established mesh heals itself, and the server is required only to admit
// peers who are not yet part of it.

import { NetworkPacket, PeerIdentity } from './packet';

export type SignalKind = 'offer' | 'answer' | 'ice';

export interface PeerSignalPayload {
  /** Who this signal is ultimately for. */
  targetPeerId: string;
  /** Who originated it. Not taken from packet.from, which is the forwarder on a relay hop. */
  originPeerId: string;
  kind: SignalKind;
  /** RTCSessionDescriptionInit for offer/answer, RTCIceCandidateInit for ice. */
  data: unknown;
  /**
   * Monotonic per-origin counter, used to discard signals that arrive out of order.
   *
   * Signals can take different paths with different latencies — a relayed offer and a later
   * direct one can overtake each other. Applying a stale offer after a newer one would
   * desynchronise the negotiation and, with perfect negotiation's rollback, can wedge the
   * connection in `have-local-offer` until something else restarts it.
   */
  seq: number;
  /** Hop budget. Signals travel at most one relay hop; see MAX_SIGNAL_HOPS. */
  hops: number;
}

export type SignalTransport = 'direct' | 'peer-relay' | 'server' | 'dropped';

export interface SignalRouteResult {
  transport: SignalTransport;
  /** For peer-relay, the first neighbour it was handed to. */
  via?: string;
  /** For peer-relay, how many neighbours accepted it. See pickRelays. */
  fanout?: number;
}

/**
 * Signals take at most one relay hop.
 *
 * Multi-hop forwarding would need loop prevention and a routing table, and buys very
 * little: if no single common neighbour exists, the mesh is partitioned badly enough that
 * the server is the honest answer. One hop covers every topology this app builds — TIER1 is
 * a full mesh (any peer is a common neighbour) and TIER2 clusters share a leader.
 */
export const MAX_SIGNAL_HOPS = 1;

export class PeerSignaling {
  private myPeerId = '';
  private seqCounter = 0;

  /** Highest seq applied per origin, plus when we last heard from them. */
  private originState: Map<string, { seq: number; lastSeenAt: number }> = new Map();

  /**
   * Bounded because it is keyed by remote peer IDs. A long-lived session in a busy room
   * would otherwise accumulate an entry per peer ever seen.
   */
  private static readonly MAX_TRACKED_ORIGINS = 500;

  /**
   * How long an origin's replay-protection state is protected from eviction.
   *
   * Plain LRU was not enough, and the failure was worse than a leak. Eviction by insertion
   * order let anyone who could reach us push a real peer's sequence state out of the map by
   * sending signals under many invented origin IDs — and once that entry was gone, `last`
   * fell back to 0 and the attacker could replay that peer's old offers, which perfect
   * negotiation will happily act on. Bounding the map had quietly created a replay hole.
   *
   * An entry seen within this window is treated as an active negotiation and is never
   * evicted; when everything is protected, the *new* origin is refused instead. That is the
   * safe direction to fail: an unknown peer temporarily loses replay protection it never
   * had, rather than an established one losing protection it was relying on.
   */
  private static readonly ORIGIN_PROTECT_MS = 60_000;

  /** Number of neighbours a relayed signal is handed to. See pickRelays. */
  private static readonly RELAY_FANOUT = 3;

  private counters = {
    direct: 0,
    peerRelay: 0,
    server: 0,
    forwarded: 0,
    droppedStale: 0,
    droppedNoRoute: 0,
    droppedHops: 0,
    untrackedOrigins: 0,
    admissionRefused: 0,
  };

  constructor(
    /** True when a data channel to this peer is open right now. */
    private isDirectlyConnected: (peerId: string) => boolean,
    /** Every peer we currently hold an open data channel to. */
    private getConnectedPeers: () => string[],
    /** Sends over the mesh. Returns false if it could not be sent. */
    private sendViaMesh: (targetPeerId: string, payload: PeerSignalPayload) => boolean,
    /** Last resort. */
    private sendViaServer: (targetPeerId: string, kind: SignalKind, data: unknown) => void
  ) {}

  public setMyPeerId(peerId: string): void {
    this.myPeerId = peerId;
  }

  /**
   * Routes an outbound signal by the preference order described at the top of this file.
   */
  public route(targetPeerId: string, kind: SignalKind, data: unknown): SignalRouteResult {
    const payload: PeerSignalPayload = {
      targetPeerId,
      originPeerId: this.myPeerId,
      kind,
      data,
      seq: ++this.seqCounter,
      hops: 0,
    };

    // 1. Direct.
    if (this.isDirectlyConnected(targetPeerId)) {
      if (this.sendViaMesh(targetPeerId, payload)) {
        this.counters.direct++;
        return { transport: 'direct' };
      }
    }

    // 2. Peer-relay through common neighbours.
    const relays = this.pickRelays(targetPeerId);
    if (relays.length > 0) {
      let sent = 0;
      for (const relay of relays) {
        if (this.sendViaMesh(relay, payload)) sent++;
      }
      if (sent > 0) {
        this.counters.peerRelay++;
        return { transport: 'peer-relay', via: relays[0], fanout: sent };
      }
    }

    // 3. Server.
    this.counters.server++;
    this.sendViaServer(targetPeerId, kind, data);
    return { transport: 'server' };
  }

  /**
   * Chooses neighbours to carry a signal to an unreachable target.
   *
   * We cannot know from here which of our neighbours can actually reach the target — that
   * is remote state we do not hold, and gossiping it for a message this rare would cost
   * more than it saves. So we send to several and let the forwarding rule drop the ones
   * that cannot deliver.
   *
   * The fan-out is the fix for a livelock. Picking a single deterministic relay meant that
   * if that one neighbour could not reach the target, *every* retry took the identical dead
   * path. Nothing made the choice self-correct: the backoff changed the timing, not the
   * route, so a repairable link could stay broken indefinitely while a perfectly good relay
   * sat unused one position further down the list.
   *
   * Sending to RELAY_FANOUT neighbours is cheap — a signal is a few hundred bytes and
   * happens on repair, not per frame — and duplicate arrival is harmless: session
   * descriptions are guarded by seq, and duplicate ICE candidates are ignored by the
   * browser. Trading a little redundant traffic for "the repair actually completes" is
   * clearly the right side of that bargain.
   *
   * Sorted for determinism, so logs and tests stay reproducible.
   */
  private pickRelays(targetPeerId: string): string[] {
    return this.getConnectedPeers()
      .filter((p) => p !== targetPeerId && p !== this.myPeerId)
      .sort()
      .slice(0, PeerSignaling.RELAY_FANOUT);
  }

  /**
   * Handles an inbound peer-signal packet: either apply it, or forward it one hop.
   *
   * Returns the signal to apply locally, or null when the packet was forwarded, dropped as
   * stale, or is not for us.
   */
  public handleInbound(
    payload: PeerSignalPayload,
    _packet: NetworkPacket
  ): PeerSignalPayload | null {
    if (!payload || typeof payload.targetPeerId !== 'string') return null;

    // Not for us — forward if we can, within the hop budget.
    if (payload.targetPeerId !== this.myPeerId) {
      if (payload.hops >= MAX_SIGNAL_HOPS) {
        this.counters.droppedHops++;
        return null;
      }
      if (!this.isDirectlyConnected(payload.targetPeerId)) {
        // We were picked as a relay but cannot reach the target either. Dropping is correct:
        // the originator's retry will pick a different neighbour as the roster changes, and
        // forwarding onward would need loop prevention we deliberately do not have.
        this.counters.droppedNoRoute++;
        return null;
      }
      const forwarded: PeerSignalPayload = { ...payload, hops: payload.hops + 1 };
      if (this.sendViaMesh(payload.targetPeerId, forwarded)) {
        this.counters.forwarded++;
      }
      return null;
    }

    // For us. Reject signals older than one we have already applied from this origin.
    //
    // ICE is exempt: candidates are independent facts that can legitimately arrive in any
    // order and are additive, so ordering them would discard usable paths. Only the
    // session-description exchange is order-sensitive.
    if (payload.kind !== 'ice') {
      const existing = this.originState.get(payload.originPeerId);
      if (existing) {
        // Refresh liveness even for a rejected signal: a replay attempt is still evidence
        // that this origin is active, and letting the entry go cold would eventually make
        // it evictable and reopen the very hole we are closing.
        existing.lastSeenAt = Date.now();
        if (payload.seq <= existing.seq) {
          this.counters.droppedStale++;
          return null;
        }
        existing.seq = payload.seq;
      } else if (!this.admitOrigin(payload.originPeerId, payload.seq)) {
        // Could not track this origin (table full of active negotiations). Apply the signal
        // — refusing it would let a flood deny service to genuine new peers — but it goes
        // unprotected against replay until capacity frees up.
        this.counters.untrackedOrigins++;
      }
    }

    return payload;
  }

  /**
   * Admits a new origin into the replay-protection table, evicting only entries that have
   * gone quiet for longer than ORIGIN_PROTECT_MS. Returns false when everything present is
   * still active, in which case the newcomer is not tracked.
   */
  private admitOrigin(originPeerId: string, seq: number): boolean {
    const now = Date.now();

    if (this.originState.size >= PeerSignaling.MAX_TRACKED_ORIGINS) {
      let coldest: string | null = null;
      let coldestAt = Infinity;
      for (const [id, st] of this.originState) {
        if (now - st.lastSeenAt > PeerSignaling.ORIGIN_PROTECT_MS && st.lastSeenAt < coldestAt) {
          coldest = id;
          coldestAt = st.lastSeenAt;
        }
      }
      if (coldest === null) {
        this.counters.admissionRefused++;
        return false;
      }
      this.originState.delete(coldest);
    }

    this.originState.set(originPeerId, { seq, lastSeenAt: now });
    return true;
  }

  /** Forgets negotiation state for a peer that has left. */
  public forget(peerId: string): void {
    this.originState.delete(peerId);
  }

  public reset(): void {
    this.originState.clear();
    this.seqCounter = 0;
  }

  public getStats() {
    const total = this.counters.direct + this.counters.peerRelay + this.counters.server;
    return {
      ...this.counters,
      total,
      trackedOrigins: this.originState.size,
      /** Share of signals that did not need the server. Should approach 1 in a warm room. */
      serverFreeRatio: total === 0 ? 1 : (this.counters.direct + this.counters.peerRelay) / total,
    };
  }
}
