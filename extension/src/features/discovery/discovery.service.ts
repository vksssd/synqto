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
      // Immediately respond with our own ping so new peer sees us
      this.sendPing();
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

    this.network.on<{ text?: string }>('community:poke', (payload, packet) => {
      this.emitAlert({
        from: packet.from,
        type: 'poke',
        text: payload?.text || `${packet.from.nickname} poked you! 👉`,
      });
    });

    this.network.on<{ title: string; url: string }>('community:problem_mention', (payload, packet) => {
      this.emitAlert({
        from: packet.from,
        type: 'problem_mention',
        text: `${packet.from.nickname} shared: ${payload?.title || 'a problem'}`,
      });
    });
  }

  private handlePeerActivity(from: PeerIdentity, payload: PresencePayload) {
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
    this.emitChange();
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

  private startTimers() {
    // Ping every 5s
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, 5000);

    // Prune stale peers every 5s (peers not seen in 20s)
    this.pruneTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      this.onlinePeers.forEach((peer, id) => {
        if (now - peer.lastSeen > 20000) {
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
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.network.broadcast('presence:leave', {});
    this.onlinePeers.clear();
  }
}
