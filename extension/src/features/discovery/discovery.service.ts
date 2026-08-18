// ─── Discovery & Presence Service ───

import { NetworkService } from '@/core/network/network.service';
import { PeerIdentity, PeerStatus, PresencePayload } from '@/core/network/packet';

export interface OnlinePeer {
  identity: PeerIdentity;
  status: PeerStatus;
  problemTitle?: string;
  problemUrl?: string;
  startedAt?: number;
  lastSeen: number;
  isLeader?: boolean;
}

export class DiscoveryService {
  private static instance: DiscoveryService | null = null;
  private network: NetworkService;

  private onlinePeers: Map<string, OnlinePeer> = new Map();
  private currentStatus: PeerStatus = 'solving';
  private currentProblemTitle = '';
  private currentProblemUrl = '';
  private sessionStartedAt = Date.now();

  private heartbeatTimer: any = null;
  private pruneTimer: any = null;
  private listeners: Set<(peers: OnlinePeer[]) => void> = new Set();
  private alertListeners: Set<(alert: { from: PeerIdentity; type: 'wave' | 'poke' | 'problem_mention'; text: string }) => void> = new Set();

  private constructor() {
    this.network = NetworkService.getInstance();
    this.setupListeners();
    this.startTimers();
  }

  public static getInstance(): DiscoveryService {
    if (!DiscoveryService.instance) {
      DiscoveryService.instance = new DiscoveryService();
    }
    return DiscoveryService.instance;
  }

  public updateContext(status: PeerStatus, problemTitle?: string, problemUrl?: string) {
    this.currentStatus = status;
    if (problemTitle !== undefined) this.currentProblemTitle = problemTitle;
    if (problemUrl !== undefined) this.currentProblemUrl = problemUrl;

    this.sendPing();
  }

  private setupListeners() {
    // 1. Presence Join
    this.network.on<PresencePayload>('presence:join', (payload, packet) => {
      this.handlePeerActivity(packet.from, payload);
      // Respond directly with targeted unicast ping to the newly joined peer to prevent O(N^2) broadcast storm
      this.sendPingTo(packet.from.peerId);
    });

    // 2. Presence Ping / Heartbeat
    this.network.on<PresencePayload>('presence:ping', (payload, packet) => {
      this.handlePeerActivity(packet.from, payload);
    });

    // 3. Presence Update
    this.network.on<PresencePayload>('presence:update', (payload, packet) => {
      this.handlePeerActivity(packet.from, payload);
    });

    // 4. Presence Leave
    this.network.on('presence:leave', (_, packet) => {
      this.onlinePeers.delete(packet.from.peerId);
      this.emitChange();
    });

    // 5. Interactive alerts (wave, poke, problem share)
    this.network.on<{ text?: string }>('community:wave', (payload, packet) => {
      this.emitAlert({
        from: packet.from,
        type: 'wave',
        text: payload?.text || `${packet.from.nickname} waved at you! 👋`,
      });
    });

    // 6. Interactive poke
    this.network.on<{ text?: string }>('community:poke', (payload, packet) => {
      this.emitAlert({
        from: packet.from,
        type: 'poke',
        text: payload?.text || `${packet.from.nickname} poked you! 👉`,
      });
    });

    // 7. Problem mention
    this.network.on<{ title: string; url: string }>('community:problem_mention', (payload, packet) => {
      this.emitAlert({
        from: packet.from,
        type: 'problem_mention',
        text: `${packet.from.nickname} shared: ${payload?.title || 'a problem'}`,
      });
    });
  }

  private handlePeerActivity(from: PeerIdentity, payload: PresencePayload) {
    if (!from || !from.peerId) return;
    const existing = this.onlinePeers.get(from.peerId);
    const updated: OnlinePeer = {
      identity: from,
      status: payload?.status || existing?.status || 'solving',
      problemTitle: payload?.problemTitle || existing?.problemTitle,
      problemUrl: payload?.problemUrl || existing?.problemUrl,
      startedAt: payload?.startedAt || existing?.startedAt || Date.now(),
      lastSeen: Date.now(),
    };
    this.onlinePeers.set(from.peerId, updated);

    // Only re-render when something a viewer can actually see changed.
    //
    // This used to emit on every ping. With a 5s heartbeat and 20 peers that is four
    // subscriber notifications per second — each one re-rendering the peer list — purely to
    // record a new `lastSeen` timestamp that is never displayed. Liveness is already
    // handled by the prune timer, so a heartbeat carrying identical status is silent.
    const visiblyChanged =
      !existing ||
      existing.status !== updated.status ||
      existing.problemTitle !== updated.problemTitle ||
      existing.problemUrl !== updated.problemUrl ||
      existing.identity?.nickname !== updated.identity?.nickname;

    if (visiblyChanged) {
      this.emitChange();
    }
  }

  public sendWave(targetPeerId?: string) {
    if (targetPeerId) {
      this.network.send(targetPeerId, 'community:wave', { text: 'waved at you! 👋' });
    } else {
      this.network.broadcast('community:wave', { text: 'waved at everyone! 👋' });
    }
  }

  public sendPoke(targetPeerId?: string) {
    if (targetPeerId) {
      this.network.send(targetPeerId, 'community:poke', { text: 'poked you! 👉' });
    } else {
      this.network.broadcast('community:poke', { text: 'poked the room! 👉' });
    }
  }

  private sendPing() {
    const payload: PresencePayload = {
      status: this.currentStatus,
      problemTitle: this.currentProblemTitle,
      problemUrl: this.currentProblemUrl,
      startedAt: this.sessionStartedAt,
    };
    this.network.broadcast('presence:ping', payload);
  }

  private sendPingTo(targetPeerId: string) {
    const payload: PresencePayload = {
      status: this.currentStatus,
      problemTitle: this.currentProblemTitle,
      problemUrl: this.currentProblemUrl,
      startedAt: this.sessionStartedAt,
    };
    this.network.send(targetPeerId, 'presence:ping', payload);
  }

  /**
   * Heartbeat period, scaled to room size.
   *
   * Presence is a full mesh broadcast, so its cost is O(N^2) in the room: a fixed 5s period
   * meant 20 peers spent ~76 packets/sec on keepalive alone before anyone typed anything,
   * competing with chat and cursors for the same send buffers. Widening the period with N
   * keeps aggregate presence traffic roughly linear.
   *
   * The prune threshold is derived from this (see PRUNE_MULTIPLIER) so peers are never
   * pruned faster than their peers can plausibly ping.
   */
  private static readonly BASE_HEARTBEAT_MS = 5000;
  private static readonly MAX_HEARTBEAT_MS = 20000;
  private static readonly PRUNE_MULTIPLIER = 4;

  private heartbeatIntervalMs(): number {
    const n = Math.max(1, this.onlinePeers.size);
    return Math.min(
      DiscoveryService.MAX_HEARTBEAT_MS,
      DiscoveryService.BASE_HEARTBEAT_MS * Math.max(1, Math.ceil(n / 5))
    );
  }

  private startTimers() {
    // Self-rescheduling rather than setInterval: the period depends on the current peer
    // count, which changes as people join and leave.
    const scheduleHeartbeat = () => {
      this.heartbeatTimer = setTimeout(() => {
        this.sendPing();
        scheduleHeartbeat();
      }, this.heartbeatIntervalMs());
    };
    scheduleHeartbeat();

    // Prune peers that have gone quiet for several heartbeat periods.
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      const staleAfter = this.heartbeatIntervalMs() * DiscoveryService.PRUNE_MULTIPLIER;
      let changed = false;
      this.onlinePeers.forEach((peer, id) => {
        if (now - peer.lastSeen > staleAfter) {
          this.onlinePeers.delete(id);
          changed = true;
        }
      });
      if (changed) {
        this.emitChange();
      }
    }, 5000);
  }

  public getOnlinePeers(): OnlinePeer[] {
    return Array.from(this.onlinePeers.values());
  }

  public onChange(listener: (peers: OnlinePeer[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getOnlinePeers());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onAlert(
    listener: (alert: { from: PeerIdentity; type: 'wave' | 'poke' | 'problem_mention'; text: string }) => void
  ): () => void {
    this.alertListeners.add(listener);
    return () => {
      this.alertListeners.delete(listener);
    };
  }

  private emitChange() {
    const list = this.getOnlinePeers();
    this.listeners.forEach((fn) => fn(list));
  }

  private emitAlert(alert: { from: PeerIdentity; type: 'wave' | 'poke' | 'problem_mention'; text: string }) {
    this.alertListeners.forEach((fn) => fn(alert));
  }

  public destroy() {
    // heartbeatTimer is a self-rescheduling setTimeout, not an interval.
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.heartbeatTimer = null;
    this.pruneTimer = null;
    this.network.broadcast('presence:leave', {});
    this.onlinePeers.clear();
  }
}
