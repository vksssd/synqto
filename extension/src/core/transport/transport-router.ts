// ─── Unified Transport Router & Delegation Engine ───
// Answers HOW a packet is transmitted given route resolution and topology tier policy.

import { PeerId } from '../types/identifiers';
import { NetworkPacket } from '../network/packet';
import { TransportHealth } from './transport.types';
import { TopologyView } from '../topology/topology-view';
import { RelayTransport } from './relay-transport';
import { IRouteResolver } from '../topology/route-resolver';

export class TransportRouter {
  private activeView: TopologyView | null = null;
  private relayTransport: RelayTransport;
  private routeResolver: IRouteResolver | null = null;
  /**
   * Whether the server relay may carry this room's traffic. True preserves the pre-CoFocus
   * behaviour for every existing room type; DIRECT_ONLY rooms set it false. See setRelayAllowed.
   */
  private relayAllowed = true;
  private getDirectPeersFn: (() => Set<PeerId>) | null = null;
  private p2pSenderFn: ((packet: NetworkPacket, targetPeerId?: PeerId) => boolean) | null = null;
  private packetListeners: Set<(packet: NetworkPacket) => void> = new Set();

  /**
   * Tier 1 / Tier 2 packets awaiting a usable P2P path. See deferOrDrop: these are held
   * locally rather than pushed to the server relay, so backpressure stays per-peer.
   */
  private pendingP2P: Array<{ packet: NetworkPacket; targetPeerId?: PeerId; queuedAt: number }> = [];
  private flushTimer: number | null = null;
  private droppedBestEffort = 0;
  private droppedDeferred = 0;
  private static readonly MAX_PENDING_P2P = 200;
  private static readonly PENDING_TTL_MS = 20_000;
  private static readonly FLUSH_INTERVAL_MS = 250;

  private seenPacketIds: Set<string> = new Set();
  private packetOrder: string[] = [];
  private readonly MAX_SEEN = 2000;

  constructor(relayTransport: RelayTransport = new RelayTransport()) {
    this.relayTransport = relayTransport;

    this.relayTransport.onPacket((packet) => {
      this.routeIncoming(packet);
    });
  }

  public bindRouteResolver(resolver: IRouteResolver, getDirectPeers?: () => Set<PeerId>): void {
    this.routeResolver = resolver;
    if (getDirectPeers) {
      this.getDirectPeersFn = getDirectPeers;
    }
  }

  public bindP2PSender(sender: (packet: NetworkPacket, targetPeerId?: PeerId) => boolean): void {
    this.p2pSenderFn = sender;
  }

  public updateView(view: TopologyView): void {
    this.activeView = view;
    // A view change usually means peers connected or a migration completed, which is the
    // most likely moment for deferred traffic to become deliverable.
    this.flushPendingP2P();
  }

  /**
   * Sets whether the server relay may be used as a transport for this room.
   *
   * Defaults to true, which is the behaviour every room had before CoFocus: if a direct P2P
   * link fails, traffic silently falls back through the signaling server so the message still
   * lands. That fallback is correct for adaptive rooms and WRONG for CoFocus sessions, whose
   * whole guarantee is that the server never joins the data path (TopologyPolicy.allowRelay).
   * Without this switch a single flaky DataChannel would quietly route a "direct P2P only"
   * session through the server, and nothing would surface that the invariant had been broken.
   *
   * When false, relay is never used: a failed P2P send returns false and the caller's normal
   * retry/repair machinery (ReliableTransport ACK/NACK, anti-entropy sync) handles it, exactly
   * as it would for any other dropped packet.
   */
  public setRelayAllowed(allowed: boolean): void {
    this.relayAllowed = allowed;
  }

  /** True if the server relay may carry this room's traffic. */
  public isRelayAllowed(): boolean {
    return this.relayAllowed;
  }

  /**
   * Broadcasts a packet across the active topology.
   * If topology is DRAINING during a tier migration, dual-transmits on both old and new paths.
   */
  public broadcast(packet: NetworkPacket): boolean {
    this.markSeen(packet.id);
    this.deliverLocally(packet);

    if (this.activeView?.epoch) {
      packet.topologyEpoch = this.activeView.epoch;
    }

    if (!this.activeView) {
      // No topology view yet. Under DIRECT_ONLY there is nothing to fall back TO, so attempt
      // P2P and report honestly rather than silently relaying.
      if (!this.relayAllowed) {
        return this.p2pSenderFn ? this.p2pSenderFn(packet) : false;
      }
      return this.relayTransport.broadcast(packet);
    }

    // 0. DIRECT_ONLY: P2P is the only permitted path. No draining (tier migration cannot
    // happen), no relay tier, no fallback.
    if (!this.relayAllowed) {
      return this.p2pSenderFn ? this.p2pSenderFn(packet) : false;
    }

    // 1. Dual-Path Transmission during DRAINING transition state
    const isDraining = this.activeView.phase === 'DRAINING' || this.activeView.transitionId?.includes('drain');
    if (isDraining) {
      let sentP2P = false;
      if (this.p2pSenderFn) {
        sentP2P = this.p2pSenderFn(packet);
      }
      const sentRelay = this.relayTransport.broadcast(packet);
      return sentP2P || sentRelay;
    }

    // 2. Tier 3 Relay Transport
    if (this.activeView.tier === 'TIER3_SERVER_RELAY') {
      return this.relayTransport.broadcast(packet);
    }

    // 3. P2P Transport (Tier 1 Full Mesh or Tier 2 Multi-Leader)
    if (this.p2pSenderFn) {
      const ok = this.p2pSenderFn(packet);
      if (ok) return true;
    }

    // NO SILENT RELAY FALLBACK IN TIER 1 / TIER 2.
    //
    // This previously fell through to relayTransport.broadcast(). The failure mode that
    // creates is subtle and expensive: for the first seconds of EVERY room, WebRTC is still
    // negotiating, so p2pSenderFn returns false for everything. Presence pings, chat,
    // cursor moves and whiteboard strokes therefore all poured into the server relay —
    // in a two-peer room that is supposed to never put the server in its data path. That
    // is the origin of "send buffer full" warnings during ordinary operation.
    //
    // Tier 1 and Tier 2 are defined as peer-driven. A missing direct path is a DIRECT-PATH
    // FAILURE, not a licence to use the server. Reliable traffic is deferred and flushed
    // when the mesh comes up; best-effort traffic is dropped here, locally and quietly,
    // instead of being pushed into a shared server queue.
    return this.deferOrDrop(packet);
  }

  /**
   * Handles a Tier 1 / Tier 2 packet that could not go out over P2P.
   *
   * Best-effort classes (presence, cursors, transient strokes) are dropped: they are
   * superseded by the next update within milliseconds, so relaying or queueing them buys
   * nothing and costs shared server capacity.
   *
   * Everything else is queued locally, bounded, and flushed once P2P is available. Local
   * backpressure is strictly better than server backpressure: it is per-peer, it cannot
   * affect other rooms, and it disappears the moment the mesh connects.
   */
  private deferOrDrop(packet: NetworkPacket, targetPeerId?: PeerId): boolean {
    if (TransportRouter.isBestEffort(packet.type)) {
      this.droppedBestEffort++;
      return false;
    }

    if (this.pendingP2P.length >= TransportRouter.MAX_PENDING_P2P) {
      // Drop the OLDEST: for chat and state the newest messages are the ones the user is
      // waiting on, and an unbounded queue would simply move the memory problem client-side.
      this.pendingP2P.shift();
      this.droppedDeferred++;
    }
    this.pendingP2P.push({ packet, targetPeerId, queuedAt: Date.now() });
    this.scheduleFlush();
    return false;
  }

  /** Message classes where a newer update supersedes the old one within milliseconds. */
  private static isBestEffort(type: string): boolean {
    return (
      type.startsWith('presence:') ||
      type === 'canvas:cursor' ||
      type === 'canvas:click' ||
      type === 'code:cursor' ||
      type === 'whiteboard:temp_stroke' ||
      type === 'whiteboard:laser'
    );
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPendingP2P();
    }, TransportRouter.FLUSH_INTERVAL_MS) as unknown as number;
  }

  /**
   * Retries deferred packets once P2P is usable. Entries older than the TTL are discarded
   * rather than delivered late — a chat message that arrives a minute after it was typed is
   * more confusing than one that never arrives.
   */
  public flushPendingP2P(): void {
    if (this.pendingP2P.length === 0) return;
    if (!this.p2pSenderFn) return;

    const now = Date.now();
    const retry = this.pendingP2P;
    this.pendingP2P = [];

    for (const entry of retry) {
      if (now - entry.queuedAt > TransportRouter.PENDING_TTL_MS) {
        this.droppedDeferred++;
        continue;
      }
      const ok = this.p2pSenderFn(entry.packet, entry.targetPeerId);
      if (!ok) {
        this.pendingP2P.push(entry);
      }
    }

    if (this.pendingP2P.length > 0) {
      this.scheduleFlush();
    }
  }

  /** Deferral counters, surfaced so backpressure is observable rather than guessed at. */
  public getDeferralStats(): { pending: number; droppedBestEffort: number; droppedDeferred: number } {
    return {
      pending: this.pendingP2P.length,
      droppedBestEffort: this.droppedBestEffort,
      droppedDeferred: this.droppedDeferred,
    };
  }

  /**
   * Routes a directed unicast packet to targetPeerId.
   * INVARIANT: Never falls back to room broadcast for unicast traffic.
   * If route is unknown or P2P fails, sends via RELAY_UNICAST.
   */
  public sendTo(targetPeerId: PeerId, packet: NetworkPacket): boolean {
    this.markSeen(packet.id);

    if (this.activeView?.epoch) {
      packet.topologyEpoch = this.activeView.epoch;
    }

    // DIRECT_ONLY: unicast goes over the direct P2P link or not at all. A CoFocus session is
    // always a 2-peer full mesh, so the target is always a direct neighbour — there is no
    // legitimate route through a leader or the server, and pretending otherwise would put the
    // server in the data path of a session that guarantees it never is.
    if (!this.relayAllowed) {
      return this.p2pSenderFn ? this.p2pSenderFn(packet, targetPeerId) : false;
    }

    if (!this.activeView || this.activeView.tier === 'TIER3_SERVER_RELAY') {
      return this.relayTransport.sendTo(targetPeerId, packet);
    }

    if (this.routeResolver) {
      const directPeers = this.getDirectPeersFn ? this.getDirectPeersFn() : new Set<PeerId>();
      const route = this.routeResolver.resolve(targetPeerId, directPeers);

      if (route.type === 'DIRECT') {
        if (this.p2pSenderFn && this.p2pSenderFn(packet, targetPeerId)) {
          return true;
        }
        // A resolved DIRECT route that fails to send means the link is not up YET (typically
        // mid-WebRTC-negotiation), not that the server should carry this. Defer and flush.
        return this.deferOrDrop(packet, targetPeerId);
      }

      if (route.type === 'LEADER') {
        const nextHop = route.nextHopPeerId;
        if (nextHop && this.p2pSenderFn && this.p2pSenderFn(packet, nextHop)) {
          return true;
        }
        // Same reasoning for the Tier 2 backbone hop: a leader link that is still coming up
        // is a direct-path failure, and Tier 2 is defined as peer-driven.
        return this.deferOrDrop(packet, nextHop || targetPeerId);
      }

      // route.type === 'RELAY' or 'UNKNOWN'
      return this.relayTransport.sendTo(targetPeerId, packet);
    }

    // Fallback if no route resolver attached
    if (this.p2pSenderFn && this.p2pSenderFn(packet, targetPeerId)) {
      return true;
    }
    return this.relayTransport.sendTo(targetPeerId, packet);
  }

  /**
   * Ingests incoming network packet from any physical transport.
   * Implements strict deduplication and packet-type aware epoch fencing.
   */
  public routeIncoming(packet: NetworkPacket): void {
    if (this.seenPacketIds.has(packet.id)) {
      return; // Drop transport duplicate (e.g. from dual-path draining)
    }
    this.markSeen(packet.id);

    const isControlPacket =
      packet.type.startsWith('topology:') ||
      packet.type.startsWith('leader:') ||
      packet.type.startsWith('stage:');

    // Epoch fencing
    if (this.activeView && packet.topologyEpoch) {
      if (packet.topologyEpoch < this.activeView.epoch) {
        if (isControlPacket) {
          // Drop stale control/topology mutation
          console.debug(`[TransportRouter] Fenced stale control packet ${packet.type} from epoch ${packet.topologyEpoch} (current: ${this.activeView.epoch})`);
          return;
        } else {
          // Preserve application state payload for causal replication
          console.debug(`[TransportRouter] Preserving application payload ${packet.type} from prior epoch ${packet.topologyEpoch}`);
        }
      }
    }

    this.deliverLocally(packet);
  }

  private markSeen(id: string): void {
    this.seenPacketIds.add(id);
    this.packetOrder.push(id);
    if (this.packetOrder.length > this.MAX_SEEN) {
      const oldest = this.packetOrder.shift();
      if (oldest) this.seenPacketIds.delete(oldest);
    }
  }

  private deliverLocally(packet: NetworkPacket): void {
    this.packetListeners.forEach((fn) => {
      try {
        fn(packet);
      } catch (err) {
        console.error('[TransportRouter] Error in packet listener:', err);
      }
    });
  }

  public onPacket(handler: (packet: NetworkPacket) => void): () => void {
    this.packetListeners.add(handler);
    return () => {
      this.packetListeners.delete(handler);
    };
  }

  public getRelayHealth(): TransportHealth {
    return this.relayTransport.getHealth();
  }
}
