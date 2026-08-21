// ─── Link Liveness Monitor ───
//
// WebRTC's own connection state is not a timely liveness signal. `iceConnectionState` only
// moves to `disconnected` after its consent-freshness checks lapse, and on to `failed` after
// a further timeout — typically 30 seconds or more, and browser-dependent. Worse, a data
// channel whose peer has been suspended (a backgrounded tab, a laptop lid closing, a phone
// switching networks) stays `open` indefinitely: `readyState` is a property of the local
// object, not evidence that anyone is listening. So `isConnected()` could return true for a
// peer that had been gone for minutes, and every message sent to them vanished silently.
//
// This monitor gives the transport an application-level truth source. It is deliberately
// cheap: a probe is only sent to a link that has been *silent*, so a busy connection carries
// no extra traffic at all — ordinary packets are themselves proof of life. In a room where
// people are actively working, this costs nothing.
//
// Failure is declared after repeated unanswered probes rather than one, because a single
// missed probe is a normal event on a congested or mobile link, and tearing down a healthy
// connection is more disruptive than waiting one more interval.

export interface LinkHealth {
  peerId: string;
  lastInboundAt: number;
  lastProbeAt: number;
  outstandingProbes: number;
  rttMs: number | null;
  state: 'healthy' | 'silent' | 'suspect' | 'dead';
}

export interface LinkMonitorConfig {
  /** How often the monitor sweeps. */
  sweepIntervalMs: number;
  /** Silence after which a link is probed rather than assumed alive. */
  silenceThresholdMs: number;
  /** Unanswered probes tolerated before the link is declared dead. */
  maxOutstandingProbes: number;
}

export const DEFAULT_LINK_MONITOR_CONFIG: LinkMonitorConfig = {
  sweepIntervalMs: 4000,
  silenceThresholdMs: 9000,
  maxOutstandingProbes: 3,
};

export class LinkMonitor {
  private health: Map<string, LinkHealth> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private config: LinkMonitorConfig;

  /**
   * Health entries are keyed by remote peer ID and created from inbound traffic, so this map
   * is reachable from the network and must be bounded. Well above any real room size —
   * exceeding it means something is wrong, and refusing new entries is the safe response.
   */
  private static readonly MAX_TRACKED_LINKS = 300;

  private deadDeclared = 0;
  private probesSent = 0;

  constructor(
    private getConnectedPeers: () => string[],
    private sendProbe: (peerId: string, probeId: string) => boolean,
    private onDead: (peerId: string) => void,
    config: Partial<LinkMonitorConfig> = {}
  ) {
    this.config = { ...DEFAULT_LINK_MONITOR_CONFIG, ...config };
  }

  public start(): void {
    this.stop();
    this.timer = setInterval(() => this.sweep(), this.config.sweepIntervalMs);
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Records evidence of life. Any inbound packet counts — a probe is only needed when a peer
   * has gone quiet, so normal traffic suppresses probing entirely.
   */
  public noteInbound(peerId: string): void {
    const existing = this.health.get(peerId);
    if (existing) {
      existing.lastInboundAt = Date.now();
      existing.outstandingProbes = 0;
      existing.state = 'healthy';
      return;
    }
    if (this.health.size >= LinkMonitor.MAX_TRACKED_LINKS && !this.makeRoom()) return;
    this.health.set(peerId, {
      peerId,
      lastInboundAt: Date.now(),
      lastProbeAt: 0,
      outstandingProbes: 0,
      rttMs: null,
      state: 'healthy',
    });
  }

  /** Records a probe response and its round-trip time. */
  public notePong(peerId: string, sentAt: number): void {
    this.noteInbound(peerId);
    const h = this.health.get(peerId);
    if (h && sentAt > 0) {
      const rtt = Date.now() - sentAt;
      // Smoothed, so one slow sample does not swing the reading.
      h.rttMs = h.rttMs === null ? rtt : Math.round(h.rttMs * 0.7 + rtt * 0.3);
    }
  }

  /**
   * Frees a slot for a new link, or returns false if every slot is genuinely in use.
   *
   * The naive bound — refuse new entries once full — was a denial-of-service on our own
   * liveness. Entries are created from inbound traffic, so anything that could reach us
   * could fill the table with peers we are not connected to; a *real* peer connecting
   * afterwards would then never be tracked, never probed, and so never detected when it
   * died. The bound meant to prevent a memory leak had instead disabled repair.
   *
   * Reclaim in order of how sure we are the entry is useless: first links we no longer
   * hold a connection to at all, then the coldest remaining entry.
   */
  private makeRoom(): boolean {
    const connected = new Set(this.getConnectedPeers());

    for (const [peerId] of this.health) {
      if (!connected.has(peerId)) {
        this.health.delete(peerId);
        return true;
      }
    }

    let coldest: string | null = null;
    let coldestAt = Infinity;
    for (const [peerId, h] of this.health) {
      if (h.lastInboundAt < coldestAt) {
        coldest = peerId;
        coldestAt = h.lastInboundAt;
      }
    }
    if (coldest !== null) {
      this.health.delete(coldest);
      return true;
    }
    return false;
  }

  public forget(peerId: string): void {
    this.health.delete(peerId);
  }

  public reset(): void {
    this.health.clear();
  }

  private sweep(): void {
    const now = Date.now();
    const connected = new Set(this.getConnectedPeers());

    // Drop health for links that are no longer connected; they are someone else's problem
    // now (the reconnection path), and keeping them would leak an entry per departed peer.
    for (const peerId of Array.from(this.health.keys())) {
      if (!connected.has(peerId)) this.health.delete(peerId);
    }

    for (const peerId of connected) {
      let h = this.health.get(peerId);
      if (!h) {
        this.noteInbound(peerId);
        h = this.health.get(peerId);
        if (!h) continue;
      }

      const silentFor = now - h.lastInboundAt;
      if (silentFor < this.config.silenceThresholdMs) {
        h.state = 'healthy';
        continue;
      }

      if (h.outstandingProbes >= this.config.maxOutstandingProbes) {
        // Repeated probes unanswered while the channel still claims to be open. This is the
        // half-open case the monitor exists for: the local object says `open`, the peer is
        // not there. Declare it dead so the repair path can run now rather than waiting for
        // ICE consent to lapse.
        h.state = 'dead';
        this.deadDeclared++;
        this.health.delete(peerId);
        this.onDead(peerId);
        continue;
      }

      h.state = h.outstandingProbes === 0 ? 'silent' : 'suspect';
      h.lastProbeAt = now;
      h.outstandingProbes++;
      this.probesSent++;
      this.sendProbe(peerId, String(now));
    }
  }

  public getHealth(): LinkHealth[] {
    return Array.from(this.health.values());
  }

  public getStats() {
    return {
      tracked: this.health.size,
      probesSent: this.probesSent,
      deadDeclared: this.deadDeclared,
    };
  }
}


/**
 * How long to wait before repairing a link, given the state WebRTC reported.
 *
 * `disconnected` is transient by specification: it means ICE consent checks are currently
 * failing, and the spec explicitly allows a return to `connected` without any intervention.
 * A Wi-Fi roam, a brief burst of loss, or an interface change all produce it routinely.
 *
 * Repairing immediately on `disconnected` is therefore worse than waiting twice over — it
 * spends a fresh offer and a full ICE gather on a link that was about to recover, and the
 * restart itself disrupts the recovery in progress. Repeated across a room, that is a
 * plausible source of unexplained offer and candidate volume.
 *
 * `failed` is terminal: ICE has exhausted its candidate pairs and will not recover by
 * itself, so waiting only adds dead time to a link that is already gone.
 */
export const DISCONNECT_GRACE_MS = 5000;

export function repairDelayFor(status: 'disconnected' | 'failed'): number {
  return status === 'failed' ? 0 : DISCONNECT_GRACE_MS;
}
